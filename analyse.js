/* ===== TrendScope · Faktor-Analyse ===== */
(function () {
  let HIST = null, SECT = null, REG = null, chart = null;
  let view = 'bars';                 // 'bars' | 'line'
  let xFactor = 'pe';
  let factorMonth = 1;               // gewählter Monat m -> perf[m-1] (Performance seit Aufnahme)
  // Performance-Funktion für Faktor-Kurve & -Wichtigkeit beim gewählten Monat
  const perfForMonth = s => (s.perf || [])[factorMonth - 1] ?? null;
  // jüngster vorhandener Monatswert einer Aktie (kumulierte Performance seit Aufnahme)
  const lastPerf = s => { const p = s.perf; if (!Array.isArray(p)) return null; for (let i = p.length - 1; i >= 0; i--) if (p[i] != null) return p[i]; return null; };
  // wie viele Monate hat diese Aktie schon? (Anzahl gemessener Punkte)
  const monthsOf = s => Array.isArray(s.perf) ? s.perf.filter(v => v != null).length : 0;
  const FACTORS = [
    { key: 'pe', label: 'KGV' }, { key: 'outperformPct', label: 'Outperform' },
    { key: 'buyPct', label: 'Kaufempfehlung' }, { key: 'upside', label: 'Kursziel' },
    { key: 'div', label: 'Dividende' }, { key: 'analysts', label: 'Analysten' },
    { key: 'perf1mBefore', label: '1M vor Aufnahme' },
  ];
  const filt = {};

  async function load() {
    if (HIST) return;
    const [h, d] = await Promise.all([
      fetch('history.json?v=' + Date.now()).then(r => r.ok ? r.json() : { entries: {} }).catch(() => ({ entries: {} })),
      fetch('sectordata.json?v=' + Date.now()).then(r => r.json()).catch(() => ({})),
    ]);
    // Nur Perlen mit mindestens einem echten Performance-Wert zählen für die Analyse.
    // Frisch aufgenommene Perlen (perf:[] leer) haben noch keine auswertbaren Daten ->
    // Analyse bleibt "0/0", bis nach ~1 Monat die ersten echten Monatswerte reifen.
    HIST = Object.values(h.entries || {}).filter(x => monthsOf(x) > 0);
    SECT = d.sectors || []; REG = d.regions || [];
    HIST._kiObj = h;
  }
  const secName = id => (SECT.find(s => s.id === id) || {}).name || id;
  const regName = id => (REG.find(s => s.id === id) || {}).name || id;
  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  // Median (robust gegen Ausreißer) — für die Bin-Mittelung der Faktor-Kurve.
  const median = arr => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const flabel = key => (FACTORS.find(f => f.key === key) || {}).label || key;

  /* ---------- Filter ---------- */
  function passes(s) {
    if (filt.sector && s.sector !== filt.sector) return false;
    if (filt.region && s.region !== filt.region) return false;
    if (filt.peMin != null && !(s.pe != null && s.pe >= filt.peMin)) return false;
    if (filt.peMax != null && !(s.pe != null && s.pe <= filt.peMax)) return false;
    if (filt.buy != null && !(s.buyPct != null && s.buyPct >= filt.buy)) return false;
    if (filt.outp != null && !(s.outperformPct != null && s.outperformPct >= filt.outp)) return false;
    if (filt.upside != null && !(s.upside != null && s.upside >= filt.upside)) return false;
    if (filt.div != null && !(s.div != null && s.div >= filt.div)) return false;
    if (filt.analysts != null && !(s.analysts != null && s.analysts >= filt.analysts)) return false;
    return true;
  }

  /* ---------- Faktor-Kurve: gebinnte Ø-Performance über Faktorwert ----------
     Teilt den Faktor-Wertebereich in Bins, mittelt je Bin die Performance.
     Liefert {points:[{x,y}], slope} — slope = Ø |Steigung| (= Wirkungsstärke).   */
  function factorCurve(data, factorKey, perfFn) {
    const pf = typeof perfFn === 'function' ? perfFn : (s => s[perfFn]);
    const pts = data.map(s => ({ x: s[factorKey], y: pf(s) }))
      .filter(p => p.x != null && isFinite(p.x) && p.y != null && isFinite(p.y))
      .sort((a, b) => a.x - b.x);
    if (pts.length < 4) return { points: [], slope: 0, n: pts.length };
    const xMin = pts[0].x, xMax = pts[pts.length - 1].x;
    const span = (xMax - xMin) || 1;
    const BINS = Math.min(8, Math.max(3, Math.round(pts.length / 4)));
    const bins = Array.from({ length: BINS }, () => []);
    pts.forEach(p => {
      let bi = Math.floor(((p.x - xMin) / span) * BINS);
      if (bi >= BINS) bi = BINS - 1;
      bins[bi].push(p);
    });
    const curve = [];
    bins.forEach(arr => {
      if (!arr.length) return;
      const cx = avg(arr.map(p => p.x));
      // Y robust mitteln: Median statt arithm. Mittel, damit einzelne Ausreißer-Aktien
      // (eine extrem gut/schlecht laufende Perle) den Bin-Wert nicht verzerren.
      const cy = median(arr.map(p => p.y));
      curve.push({ x: +cx.toFixed(2), y: +cy.toFixed(2), n: arr.length });
    });
    if (curve.length < 2) return { points: curve, slope: 0, n: pts.length };
    // Wirkungsstärke = Spannweite zwischen bester/schlechtester Bin-Ø, ABER nur über
    // Bins mit ausreichend Aktien (>=5), damit zufällig streuende Kleingruppen (z.B.
    // wenige Hochdividenden-Werte) keine Schein-Wirkung erzeugen.
    const solid = curve.filter(c => c.n >= 5);
    const basis = solid.length >= 2 ? solid : curve;
    const ys = basis.map(c => c.y);
    const slope = +(Math.max(...ys) - Math.min(...ys)).toFixed(2);
    const best = basis.reduce((a, b) => b.y > a.y ? b : a, basis[0]);
    return { points: curve, slope, best, n: pts.length, raw: pts };
  }

  /* Trendlinie über ALLE Rohpunkte: lineare ODER quadratische Regression (Least Squares).
     Parabel nur, wenn sie deutlich besser passt UND ihr Scheitel im x-Bereich liegt
     (echtes Extremum zwischen den Daten); sonst Gerade. Liefert geglättete Linienpunkte. */
  function fitTrend(raw) {
    const N = raw.length;
    if (N < 6) return null;
    const xs = raw.map(p => p.x), ys = raw.map(p => p.y);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    if (xMax === xMin) return null;
    // Lineare Regression y = a + b x
    const sum = a => a.reduce((u, v) => u + v, 0);
    const mx = sum(xs) / N, my = sum(ys) / N;
    let sxx = 0, sxy = 0;
    for (let i = 0; i < N; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
    const bLin = sxx ? sxy / sxx : 0, aLin = my - bLin * mx;
    const yLin = x => aLin + bLin * x;
    // Quadratische Regression y = c0 + c1 x + c2 x^2 (Normalgleichungen, 3x3)
    let S0 = N, S1 = 0, S2 = 0, S3 = 0, S4 = 0, T0 = 0, T1 = 0, T2 = 0;
    for (let i = 0; i < N; i++) {
      const x = xs[i], y = ys[i], x2 = x * x;
      S1 += x; S2 += x2; S3 += x2 * x; S4 += x2 * x2;
      T0 += y; T1 += x * y; T2 += x2 * y;
    }
    const quad = solve3([[S0, S1, S2], [S1, S2, S3], [S2, S3, S4]], [T0, T1, T2]);
    // Bestimmtheitsmaß R² je Modell
    const sst = sum(ys.map(y => (y - my) ** 2)) || 1;
    const r2 = pred => 1 - sum(raw.map(p => (p.y - pred(p.x)) ** 2)) / sst;
    const r2Lin = r2(yLin);
    let useQuad = false, yQuad = null, vertex = null;
    if (quad) {
      const [c0, c1, c2] = quad;
      yQuad = x => c0 + c1 * x + c2 * x * x;
      const vx = c2 !== 0 ? -c1 / (2 * c2) : null;          // Scheitelstelle
      const inRange = vx != null && vx > xMin && vx < xMax; // Extremum zwischen den Daten
      const r2Q = r2(yQuad);
      // Parabel nur, wenn Scheitel im Bereich UND merklich besser als die Gerade
      if (inRange && r2Q > r2Lin + 0.04 && Math.abs(c2) > 1e-9) { useQuad = true; vertex = vx; }
    }
    const f = useQuad ? yQuad : yLin;
    const STEPS = 48;
    const line = Array.from({ length: STEPS + 1 }, (_, i) => {
      const x = xMin + (xMax - xMin) * i / STEPS;
      return { x: +x.toFixed(3), y: +f(x).toFixed(2) };
    });
    return { line, kind: useQuad ? 'parabel' : 'gerade', vertex, slope: bLin };
  }
  // 3x3-Gleichungssystem lösen (Cramer); null bei Singularität.
  function solve3(M, v) {
    const d = det3(M);
    if (Math.abs(d) < 1e-12) return null;
    const col = (m, i, c) => m.map((row, r) => row.map((val, k) => k === i ? c[r] : val));
    return [0, 1, 2].map(i => det3(col(M, i, v)) / d);
  }
  function det3(m) {
    return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
         - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
         + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  }

  /* ---------- Diagramm rendern (Balken oder Linie) ---------- */
  function render() {
    const matched = HIST.filter(passes);
    document.getElementById('anaCount').textContent = matched.length + ' / ' + HIST.length + ' Aktien';
    document.getElementById('anaMatch').textContent = matched.length
      ? matched.length + ' Aktien im Filter' + (matched.some(s => s.prov) ? ' · vorläufige 1M-Werte' : '')
      : 'Keine Aktien im aktuellen Filter.';

    const ctx = document.getElementById('anaChart');
    if (chart) chart.destroy();

    if (view === 'line') {
      document.getElementById('anaTitle').innerHTML = 'Performance über ' + flabel(xFactor);
      // Faktor-Kurve: alle Perlen (keine Wert-Filter), x = Faktor, y = Performance im gewählten Monat.
      const { points, slope, n, raw } = factorCurve(HIST, xFactor, perfForMonth);
      const trend = raw ? fitTrend(raw) : null;
      const datasets = [{
        label: 'Ø je Wertebereich', data: points, parsing: false,
        borderColor: 'rgba(129,140,248,0.55)', borderWidth: 2, backgroundColor: 'rgba(129,140,248,0.10)', fill: true,
        tension: 0.45, pointRadius: 3, pointBackgroundColor: '#c084fc', pointHoverRadius: 5,
      }];
      if (trend) datasets.push({
        label: 'Trend (' + trend.kind + ')', data: trend.line, parsing: false,
        borderColor: '#f59e0b', borderWidth: 2.6, backgroundColor: 'transparent', fill: false,
        tension: trend.kind === 'parabel' ? 0.4 : 0, pointRadius: 0, borderDash: [],
      });
      chart = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
          responsive: true, maintainAspectRatio: false, animation: { duration: 450 },
          plugins: { legend: { display: true, labels: { color: '#cbd5e1', boxWidth: 12, boxHeight: 3, font: { size: 11, weight: '700' } } }, tooltip: { enabled: false } },
          scales: {
            x: { type: 'linear', title: { display: true, text: flabel(xFactor), color: '#94a3b8', font: { size: 11 } },
                 grid: { color: 'rgba(148,163,184,0.12)' }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } } },
            y: { title: { display: true, text: 'Ø Performance seit Aufnahme', color: '#94a3b8', font: { size: 11 } },
                 grid: { color: 'rgba(148,163,184,0.12)', drawTicks: false }, border: { display: false }, ticks: { color: '#94a3b8', callback: v => v + '%', font: { size: 10 } } },
          },
        },
        plugins: [zeroLine],
      });
      const trendTxt = trend ? ' · Trend: ' + (trend.kind === 'parabel' ? 'Parabel (Extremum)' : 'linear') : '';
      document.getElementById('anaMatch').textContent = HIST.length + ' Aktien · '
        + (n >= 4 ? 'Wirkung ' + flabel(xFactor) + ': ' + (slope > 6 ? 'stark' : slope > 2.5 ? 'mittel' : 'gering') + ' (Δ ' + slope + '%)' + trendTxt : 'zu wenige Datenpunkte für die Kurve');
    } else {
      // Balken: Ø kumulierte Performance je Monat seit Aufnahme (Monat 1..max vorhanden)
      document.getElementById('anaTitle').innerHTML = 'Ø&nbsp;Performance seit Aufnahme';
      const maxM = Math.max(0, ...matched.map(monthsOf));
      const months = Math.max(1, maxM);
      const labels = Array.from({ length: months }, (_, i) => (i + 1) + 'M');
      const values = labels.map((_, i) => {
        const v = avg(matched.map(s => (s.perf || [])[i]).filter(x => x != null));
        return v != null ? +v.toFixed(2) : null;
      });
      const colors = values.map(v => v == null ? 'rgba(148,163,184,0.3)' : v >= 0 ? '#34d399' : '#f87171');
      chart = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ data: values.map(v => v ?? 0), backgroundColor: colors, borderRadius: 7, maxBarThickness: 60 }] },
        options: {
          responsive: true, maintainAspectRatio: false, animation: { duration: 450 },
          layout: { padding: { top: 18 } },
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
          scales: {
            x: { grid: { display: false }, border: { display: false }, ticks: { color: '#cbd5e1', font: { size: 12, weight: '700' } } },
            y: { grace: '12%', grid: { color: 'rgba(148,163,184,0.14)', drawTicks: false }, border: { display: false }, ticks: { color: '#94a3b8', callback: v => v + '%', font: { size: 11 } } },
          },
        },
        plugins: [barLabels(values)],
      });
    }
    renderFactors();
  }

  const zeroLine = {
    id: 'anaZero',
    afterDraw(c) {
      const y = c.scales.y; if (!y) return;
      const yPos = y.getPixelForValue(0);
      if (yPos < c.chartArea.top || yPos > c.chartArea.bottom) return;
      const { ctx, chartArea } = c;
      ctx.save(); ctx.beginPath(); ctx.moveTo(chartArea.left, yPos); ctx.lineTo(chartArea.right, yPos);
      ctx.strokeStyle = 'rgba(148,163,184,0.4)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.restore();
    },
  };
  function barLabels(values) {
    return { id: 'anaBarVals', afterDatasetsDraw(c) {
      const { ctx } = c; const meta = c.getDatasetMeta(0);
      ctx.save(); ctx.font = '700 12px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
      meta.data.forEach((bar, i) => { const v = values[i];
        ctx.fillStyle = v == null ? '#6b769a' : v >= 0 ? '#34d399' : '#f87171';
        ctx.fillText(v == null ? '—' : (v > 0 ? '+' : '') + v + '%', bar.x, bar.y + (v >= 0 ? -8 : 16)); });
      ctx.restore();
    } };
  }

  /* ---------- Wichtigste Faktoren: gerankt nach Performance-Spanne (jüngster Monat) ---------- */
  function renderFactors() {
    const el = document.getElementById('anaFactors');
    // Linien-Modus: alle Aktien (keine Filter); Balken-Modus: gefilterte Auswahl.
    const data = view === 'line' ? HIST : HIST.filter(passes);
    const rows = [];
    for (const f of FACTORS) {
      const { slope, best, n } = factorCurve(data, f.key, perfForMonth);
      if (n < 4 || !best) continue;
      rows.push({ label: f.label, slope, bestX: best.x, bestY: best.y });
    }
    syncMonthOptions();
    rows.sort((a, b) => b.slope - a.slope);
    const maxSlope = rows.length ? Math.max(...rows.map(r => r.slope), 0.1) : 1;

    el.innerHTML = '';
    if (!rows.length) { el.innerHTML = '<div class="sek-stocks-empty">Noch zu wenige Daten für die Faktor-Analyse.</div>'; return; }
    rows.forEach(r => {
      const row = document.createElement('div');
      row.className = 'ana-factor';
      row.innerHTML =
        '<div class="ana-factor-top"><span class="ana-factor-name">' + r.label + '</span>' +
        '<span class="ana-factor-spread">Δ ' + r.slope.toFixed(1) + '%</span></div>' +
        '<div class="ana-factor-bar"><span style="width:' + Math.round((r.slope / maxSlope) * 100) + '%"></span></div>' +
        '<div class="ana-factor-best">am besten bei <b>' + r.bestX + '</b> (Ø ' + (r.bestY > 0 ? '+' : '') + r.bestY.toFixed(1) + '%)</div>';
      el.appendChild(row);
    });
  }

  // Monats-Auswahl (für Faktor-Kurve & -Wichtigkeit) an die real vorhandenen Monate anpassen.
  // Nur konkrete Monatszahlen (1..maxM), KEIN "neuester" — die Auswahl ist immer eindeutig.
  function syncMonthOptions() {
    const sel = document.getElementById('anaFactorMonth');
    if (!sel) return;
    const maxM = Math.max(1, ...HIST.map(monthsOf));
    if (sel.options.length === maxM) return;       // schon korrekt befüllt
    const cur = factorMonth;
    sel.innerHTML = '';
    for (let m = 1; m <= maxM; m++) {
      const o = document.createElement('option'); o.value = String(m); o.textContent = m + ' Monat' + (m === 1 ? '' : 'e');
      sel.appendChild(o);
    }
    factorMonth = (cur >= 1 && cur <= maxM) ? cur : 1;
    sel.value = String(factorMonth);
  }

  /* ---------- KI-Analyse (3 beste Kombis) ---------- */
  function renderKi() {
    const el = document.getElementById('anaKi');
    const txt = (HIST._kiObj && HIST._kiObj.kiAnalysis && HIST._kiObj.kiAnalysis.text) || null;
    el.textContent = txt || 'Die KI nennt hier die stärksten Faktor-Kombinationen, sobald der Backtest läuft. Aktuell liegt erst ein vorläufiger 1-Monats-Wert je Perle vor; die Aussage aktualisiert sich monatlich.';
  }

  /* ---------- KGV-Doppelregler (von/bis) ---------- */
  const PE_LO = 0, PE_HI = 60;       // HI = offenes Ende ("kein Limit")
  function updatePeRange() {
    const lo = document.getElementById('afPeMin'), hi = document.getElementById('afPeMax');
    let a = +lo.value, b = +hi.value;
    if (a > b) { if (document.activeElement === lo) b = a, hi.value = b; else a = b, lo.value = a; }   // Kreuzen verhindern
    // Filterwerte: an den Endanschlägen = offen (null)
    filt.peMin = a > PE_LO ? a : null;
    filt.peMax = b < PE_HI ? b : null;
    // Füllbalken + Beschriftung
    const fill = document.getElementById('afPeFill');
    const span = PE_HI - PE_LO;
    fill.style.left = ((a - PE_LO) / span * 100) + '%';
    fill.style.right = ((PE_HI - b) / span * 100) + '%';
    const lbl = document.getElementById('afPeVal');
    lbl.textContent = (a <= PE_LO && b >= PE_HI) ? 'alle'
      : (a <= PE_LO ? '≤ ' + b : (b >= PE_HI ? '≥ ' + a : a + '–' + b));
  }
  function wirePeRange() {
    const lo = document.getElementById('afPeMin'), hi = document.getElementById('afPeMax');
    const on = () => { updatePeRange(); render(); };
    lo.addEventListener('input', on); hi.addEventListener('input', on);
    updatePeRange();
  }
  function resetPeRange() {
    document.getElementById('afPeMin').value = PE_LO;
    document.getElementById('afPeMax').value = PE_HI;
    updatePeRange();
  }

  /* ---------- Wiring ---------- */
  function fillSelect(id, items, nameFn) {
    const sel = document.getElementById(id);
    items.forEach(it => { const o = document.createElement('option'); o.value = it.id; o.textContent = nameFn(it.id); sel.appendChild(o); });
  }
  let wired = false;
  function wire() {
    const num = (id, key) => document.getElementById(id).addEventListener('input', e => {
      const raw = e.target.value.trim().replace(',', '.'); const n = parseFloat(raw);
      filt[key] = (raw === '' || isNaN(n)) ? null : n; render();
    });
    document.getElementById('afSector').addEventListener('change', e => { filt.sector = e.target.value || null; render(); });
    document.getElementById('afRegion').addEventListener('change', e => { filt.region = e.target.value || null; render(); });
    wirePeRange();
    num('afBuy', 'buy'); num('afOutp', 'outp');
    num('afUpside', 'upside'); num('afDiv', 'div'); num('afAnalysts', 'analysts');
    document.getElementById('afClear').addEventListener('click', () => {
      Object.keys(filt).forEach(k => delete filt[k]);
      document.querySelectorAll('#anaFilters input[type="text"]').forEach(i => i.value = '');
      document.getElementById('afSector').value = ''; document.getElementById('afRegion').value = '';
      resetPeRange();
      render();
    });
    // Diagramm-Toggle: Faktor-Kurve blendet die Wert-Filter aus (nur Monat zählt dort),
    // Zeitfenster-Modus zeigt sie. X-Achsen-Wahl nur in der Faktor-Kurve.
    document.getElementById('anaViewToggle').addEventListener('click', e => {
      const btn = e.target.closest('button[data-view]'); if (!btn || btn.dataset.view === view) return;
      view = btn.dataset.view;
      document.querySelectorAll('#anaViewToggle button').forEach(b => b.classList.toggle('active', b === btn));
      document.getElementById('anaAxis').hidden = (view !== 'line');
      document.getElementById('anaFilters').hidden = (view === 'line');
      render();
    });
    document.getElementById('anaXFactor').addEventListener('change', e => { xFactor = e.target.value; render(); });
    document.getElementById('anaFactorMonth').addEventListener('change', e => { factorMonth = parseInt(e.target.value, 10) || 1; render(); });
  }

  window.initAnalyse = async function () {
    const loading = document.getElementById('anaLoading');
    try {
      loading.classList.add('show');
      await load();
      if (!wired) { fillSelect('afSector', SECT, secName); fillSelect('afRegion', REG, regName); wire(); wired = true; }
      render();
      renderKi();
    } catch (e) {
      console.error(e);
      document.getElementById('anaMatch').textContent = 'Analyse-Daten konnten nicht geladen werden.';
    } finally {
      loading.classList.remove('show');
      setTimeout(() => { if (chart) chart.resize(); }, 60);
    }
  };
})();
