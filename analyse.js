/* ===== TrendScope · Faktor-Analyse ===== */
(function () {
  let HIST = null, SECT = null, REG = null, chart = null;
  let view = 'bars';                 // 'bars' | 'line'
  let xFactor = 'pe';
  let factorMonth = 0;               // 0 = neuester Monat (lastPerf), sonst Monat m -> perf[m-1]
  // Performance-Funktion für die Faktor-Wichtigkeit je nach gewähltem Zeitraum
  const perfForMonth = s => factorMonth === 0 ? lastPerf(s) : ((s.perf || [])[factorMonth - 1] ?? null);
  // jüngster vorhandener Monatswert einer Aktie (kumulierte Performance seit Aufnahme)
  const lastPerf = s => { const p = s.perf; if (!Array.isArray(p)) return null; for (let i = p.length - 1; i >= 0; i--) if (p[i] != null) return p[i]; return null; };
  // wie viele Monate hat diese Aktie schon? (Anzahl gemessener Punkte)
  const monthsOf = s => Array.isArray(s.perf) ? s.perf.filter(v => v != null).length : 0;
  const FACTORS = [
    { key: 'pe', label: 'KGV' }, { key: 'outperformPct', label: 'Outperform' },
    { key: 'buyPct', label: 'Kaufempfehlung' }, { key: 'upside', label: 'Kursziel' },
    { key: 'div', label: 'Dividende' }, { key: 'analysts', label: 'Analysten' },
  ];
  const filt = {};

  async function load() {
    if (HIST) return;
    const [h, d] = await Promise.all([
      fetch('history.json?v=' + Date.now()).then(r => r.ok ? r.json() : { entries: {} }).catch(() => ({ entries: {} })),
      fetch('sectordata.json?v=' + Date.now()).then(r => r.json()).catch(() => ({})),
    ]);
    HIST = Object.values(h.entries || {});
    SECT = d.sectors || []; REG = d.regions || [];
    HIST._kiObj = h;
  }
  const secName = id => (SECT.find(s => s.id === id) || {}).name || id;
  const regName = id => (REG.find(s => s.id === id) || {}).name || id;
  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
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
      const cy = avg(arr.map(p => p.y));
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
    return { points: curve, slope, best, n: pts.length };
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
      // Im Linien-Modus KEINE Filter (alle Aktien); x = Faktor, y = Performance seit Aufnahme (jüngster Monat)
      const { points, slope, n } = factorCurve(HIST, xFactor, lastPerf);
      chart = new Chart(ctx, {
        type: 'line',
        data: { datasets: [{
          data: points, parsing: false,
          borderColor: '#818cf8', borderWidth: 2.4, backgroundColor: 'rgba(129,140,248,0.12)', fill: true,
          tension: 0.45, pointRadius: 3, pointBackgroundColor: '#c084fc', pointHoverRadius: 5,
        }] },
        options: {
          responsive: true, maintainAspectRatio: false, animation: { duration: 450 },
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
          scales: {
            x: { type: 'linear', title: { display: true, text: flabel(xFactor), color: '#94a3b8', font: { size: 11 } },
                 grid: { color: 'rgba(148,163,184,0.12)' }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } } },
            y: { title: { display: true, text: 'Ø Performance seit Aufnahme', color: '#94a3b8', font: { size: 11 } },
                 grid: { color: 'rgba(148,163,184,0.12)', drawTicks: false }, border: { display: false }, ticks: { color: '#94a3b8', callback: v => v + '%', font: { size: 10 } } },
          },
        },
        plugins: [zeroLine],
      });
      document.getElementById('anaMatch').textContent = HIST.length + ' Aktien · '
        + (n >= 4 ? 'Wirkung ' + flabel(xFactor) + ': ' + (slope > 6 ? 'stark' : slope > 2.5 ? 'mittel' : 'gering') + ' (Δ ' + slope + '%)' : 'zu wenige Datenpunkte für die Kurve');
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

  // Zeitraum-Auswahl der Faktor-Wichtigkeit an die real vorhandenen Monate anpassen.
  function syncMonthOptions() {
    const sel = document.getElementById('anaFactorMonth');
    if (!sel) return;
    const maxM = Math.max(0, ...HIST.map(monthsOf));
    if (sel.options.length === maxM + 1) return;   // schon korrekt befüllt
    const cur = factorMonth;
    sel.innerHTML = '<option value="0">neuester</option>';
    for (let m = 1; m <= maxM; m++) {
      const o = document.createElement('option'); o.value = String(m); o.textContent = m + ' Monat' + (m === 1 ? '' : 'e');
      sel.appendChild(o);
    }
    sel.value = String(cur <= maxM ? cur : 0);
    if (cur > maxM) factorMonth = 0;
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
    // Diagramm-Toggle: Linien-Modus blendet Filter aus (gilt für alle Aktien), zeigt X-Achsen-Wahl
    document.getElementById('anaViewToggle').addEventListener('click', e => {
      const btn = e.target.closest('button[data-view]'); if (!btn || btn.dataset.view === view) return;
      view = btn.dataset.view;
      document.querySelectorAll('#anaViewToggle button').forEach(b => b.classList.toggle('active', b === btn));
      document.getElementById('anaAxis').hidden = (view !== 'line');
      document.getElementById('anaFilters').hidden = (view === 'line');
      render();
    });
    document.getElementById('anaXFactor').addEventListener('change', e => { xFactor = e.target.value; render(); });
    document.getElementById('anaFactorMonth').addEventListener('change', e => { factorMonth = parseInt(e.target.value, 10) || 0; renderFactors(); });
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
