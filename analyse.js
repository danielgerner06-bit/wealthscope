/* ===== TrendScope · Faktor-Analyse ===== */
(function () {
  let HIST = null, SECT = null, REG = null, chart = null;
  let view = 'bars';                 // 'bars' | 'line'
  let xFactor = 'pe';
  // Alle Perlen VOR diesem Datum wurden fehlerhaft gefunden (falsche frühe Läufe) und
  // gehören NICHT in die Analyse. Erst ab dem 5.6.2026 sind die Funde korrekt (die 6
  // ältesten aktuellen Perlen: Smartbroker, All for One, Init, Kontron, Hypoport,
  // innoscripta). Die Alt-Einträge bleiben in history.json (für PSI/Verteilung).
  const PEARL_CUTOFF = '2026-06-05';
  let factorMonth = 1;               // gewählter Monat m -> perf[m-1] (Performance seit Aufnahme)
  // Performance-Funktion für Faktor-Kurve & -Wichtigkeit beim gewählten Monat
  const perfForMonth = s => (s.perf || [])[factorMonth - 1] ?? null;
  // jüngster vorhandener Monatswert einer Aktie (kumulierte Performance seit Aufnahme)
  const lastPerf = s => { const p = s.perf; if (!Array.isArray(p)) return null; for (let i = p.length - 1; i >= 0; i--) if (p[i] != null) return p[i]; return null; };
  // wie viele Monate hat diese Aktie schon? (höchster gefüllter Monats-Index + 1,
  // passt zur positionsbasierten Balken-/Monatslogik auch bei einer evtl. Lücke)
  const monthsOf = s => { const p = s.perf; if (!Array.isArray(p)) return 0; for (let i = p.length - 1; i >= 0; i--) if (p[i] != null) return i + 1; return 0; };
  // step = feste Bündelungs-Schrittweite je Faktor (z. B. KGV in 5er-Schritten)
  const FACTORS = [
    { key: 'pe', label: 'KGV', step: 5 },
    { key: 'strongBuyPct', label: 'Strong Buy', step: 10 },
    { key: 'upside', label: 'Kursziel', step: 10 },
    { key: 'div', label: 'Dividende', step: 1 },
    { key: 'analysts', label: 'Analysten', step: 5 },
    { key: 'perf1mBefore', label: '1M vor Aufnahme', step: 10 },
    // Sektor-PSI bei Aufnahme ×1000 (eingefroren; sonst zu kleine Werte für die Bündelung)
    { key: 'sektorPsiX', label: 'Ψ Sektor', step: 5 },
  ];
  const stepOf = key => (FACTORS.find(f => f.key === key) || {}).step || 5;
  const filt = {};

  async function load() {
    if (HIST) return;
    const [h, d] = await Promise.all([
      fetch('history.json?v=' + Date.now()).then(r => r.ok ? r.json() : { entries: {} }).catch(() => ({ entries: {} })),
      fetch('sectordata.json?v=' + Date.now()).then(r => r.json()).catch(() => ({})),
    ]);
    // NUR echte Perlen analysieren: eine Perle ist eine Aktie mit 100% Kaufempfehlung.
    // history.json speichert AUCH schon geprüfte Aktien, die (noch) keine 100% haben —
    // die bleiben für PSI/Verteilung erhalten, gehören aber NICHT in die Faktor-Analyse.
    // Zusätzlich: nur Perlen mit mindestens einem echten Performance-Wert (monthsOf>0);
    // frisch aufgenommene (perf:[] leer) reifen erst ~1 Monat, bis echte Monatswerte da sind.
    // Und: nur korrekt gefundene Perlen ab PEARL_CUTOFF (frühere Funde waren fehlerhaft).
    HIST = Object.values(h.entries || {})
      .filter(x => x.buyPct === 100 && monthsOf(x) > 0 && (x.seen || '') >= PEARL_CUTOFF);
    SECT = d.sectors || []; REG = d.regions || [];
    // Eingefrorenen Sektor-PSI bei Aufnahme (×1000, für die Bündelung) je Ticker anhängen.
    const psiByTicker = {};
    (d.topStocks || []).forEach(s => { if (s.sektorPsiAtAdd != null) psiByTicker[s.ticker] = s.sektorPsiAtAdd; });
    HIST.forEach(x => {
      const p = x.sektorPsiAtAdd != null ? x.sektorPsiAtAdd : psiByTicker[x.ticker];
      x.sektorPsiX = p != null ? +(p * 1000).toFixed(2) : null;
    });
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

  /* ---------- Filter ----------
     Alle Wert-Filter sind Doppelregler (von–bis). Je Faktor gibt es filt[key+'Min'] und
     filt[key+'Max'] (null = jeweilige Seite offen). RANGE_FIELDS ordnet den Filter-Key
     dem Feld der Aktie zu. */
  const RANGE_FIELDS = { pe: 'pe', sbuy: 'strongBuyPct', upside: 'upside', div: 'div', analysts: 'analysts' };
  function passes(s) {
    if (filt.sector && s.sector !== filt.sector) return false;
    if (filt.region && s.region !== filt.region) return false;
    for (const [key, field] of Object.entries(RANGE_FIELDS)) {
      const lo = filt[key + 'Min'], hi = filt[key + 'Max'];
      if (lo == null && hi == null) continue;
      const v = s[field];
      if (v == null) return false;                 // Wert fehlt, Filter aktiv -> raus
      if (lo != null && v < lo) return false;
      if (hi != null && v > hi) return false;
    }
    return true;
  }

  /* ---------- Faktor-Kurve: feste Schritt-Bündelung ----------
     Bündelt den Faktor in FESTE Schritte (z. B. KGV in 5er-Schritten: 0-5,5-10,…),
     mittelt je Schritt die Performance (Median, ausreißer-robust) und gibt eine Linie
     über alle Schritte zurück. x = Schritt-Mitte. Liefert {points, slope, best, n, raw}. */
  function factorCurve(data, factorKey, perfFn) {
    const pf = typeof perfFn === 'function' ? perfFn : (s => s[perfFn]);
    const step = stepOf(factorKey);
    const pts = data.map(s => ({ x: s[factorKey], y: pf(s) }))
      .filter(p => p.x != null && isFinite(p.x) && p.y != null && isFinite(p.y));
    if (pts.length < 4) return { points: [], slope: 0, n: pts.length, raw: pts };
    // je Schritt-Index (floor(x/step)) sammeln
    const groups = new Map();
    pts.forEach(p => { const k = Math.floor(p.x / step); (groups.get(k) || groups.set(k, []).get(k)).push(p); });
    const curve = [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([k, arr]) => ({
        x: +(k * step + step / 2).toFixed(2),   // Schritt-Mitte (z. B. 2.5, 7.5, …)
        y: +median(arr.map(p => p.y)).toFixed(2),
        n: arr.length,
        lo: k * step, hi: (k + 1) * step,
      }));
    if (curve.length < 2) return { points: curve, slope: 0, best: curve[0], n: pts.length, raw: pts };
    // Wirkung = Spanne zwischen bester/schlechtester Stufe; nur Stufen mit >=3 Aktien zählen
    const solid = curve.filter(c => c.n >= 3);
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
        label: 'Ø je ' + stepOf(xFactor) + '-Schritt', data: points, parsing: false,
        borderColor: '#818cf8', borderWidth: 2.4, backgroundColor: 'rgba(129,140,248,0.12)', fill: true,
        tension: 0.4, pointRadius: 4, pointBackgroundColor: '#c084fc', pointHoverRadius: 6,
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
      // beste Stufe als Bereich (z. B. "10–15") statt Einzelwert
      const range = (best.lo != null) ? best.lo + '–' + best.hi : best.x;
      rows.push({ label: f.label, slope, bestX: range, bestY: best.y, n });
    }
    syncMonthOptions();
    rows.sort((a, b) => b.slope - a.slope);
    const maxSlope = rows.length ? Math.max(...rows.map(r => r.slope), 0.1) : 1;

    el.innerHTML = '';
    if (!rows.length) { el.innerHTML = '<div class="sek-stocks-empty">Noch zu wenige Daten für die Faktor-Analyse.</div>'; return; }

    // Konfidenz: Aussagekraft hängt an der Stichprobe (Aktien mit Daten) und der gereiften
    // Historie. Bei wenig Daten ist die "stärkste"-Faktor-Reihung oft nur Zufall -> warnen.
    const sample = Math.max(...rows.map(r => r.n));
    const conf = sample >= 60 ? 'hoch' : sample >= 25 ? 'mittel' : 'gering';
    if (conf !== 'hoch') {
      const warn = document.createElement('div');
      warn.className = 'ana-conf ana-conf-' + conf;
      warn.innerHTML = (conf === 'gering' ? '⚠ ' : 'ⓘ ') +
        'Geringe Datenbasis (' + sample + ' Aktien' + (factorMonth ? ', Monat ' + factorMonth : '') + '). ' +
        'Die Reihenfolge ist noch ' + (conf === 'gering' ? 'stark zufallsanfällig' : 'wenig belastbar') + ' — erst mit mehr Perlen & Monaten aussagekräftig.';
      el.appendChild(warn);
    }

    rows.forEach(r => {
      const row = document.createElement('div');
      row.className = 'ana-factor' + (conf === 'gering' ? ' ana-factor-weak' : '');
      row.innerHTML =
        '<div class="ana-factor-top"><span class="ana-factor-name">' + r.label + '</span>' +
        '<span class="ana-factor-spread">Δ ' + r.slope.toFixed(1) + '%</span></div>' +
        '<div class="ana-factor-bar"><span style="width:' + Math.round((r.slope / maxSlope) * 100) + '%"></span></div>' +
        '<div class="ana-factor-best">am besten bei <b>' + r.bestX + '</b> (Ø ' + (r.bestY > 0 ? '+' : '') + r.bestY.toFixed(1) + '%) · n=' + r.n + '</div>';
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

  /* ---------- Doppelregler (von–bis) für ALLE Faktoren ----------
     Jede .ana-range[data-range] wird zu einem Schieberegler mit ZWEI Griffen (Minimum
     und Maximum), genau wie das KGV. An den Endanschlägen ist die jeweilige Seite „offen"
     (null): Griff ganz links = kein Minimum, Griff ganz rechts = kein Maximum. Der Filter
     schreibt filt[key+'Min'] / filt[key+'Max']. Füllbalken + Beschriftung live.
     Registriert einen Reset-Callback für „Filter zurücksetzen". */
  const rangeSliders = [];   // {reset} je Regler — für den Clear-Button
  function wireRange(box) {
    const key = box.dataset.key;
    const lo = +box.dataset.min, hi = +box.dataset.max;
    const unit = box.dataset.unit || '', off = box.dataset.off || 'alle';
    const span = (hi - lo) || 1;
    const inMin = box.querySelector('input.range-min');
    const inMax = box.querySelector('input.range-max');
    const fill = box.querySelector('.ana-range-fill');
    const lbl = box.querySelector('.ana-range-label b');
    const fmt = v => (Math.round(v * 10) / 10).toString();
    const update = e => {
      let a = +inMin.value, b = +inMax.value;
      // Kreuzen der Griffe verhindern (der gerade bewegte Griff schiebt den anderen mit).
      if (a > b) { if (e && e.target === inMin) { b = a; inMax.value = b; } else { a = b; inMin.value = a; } }
      filt[key + 'Min'] = a > lo ? a : null;     // linker Anschlag = kein Minimum
      filt[key + 'Max'] = b < hi ? b : null;     // rechter Anschlag = kein Maximum
      fill.style.left = ((a - lo) / span * 100) + '%';
      fill.style.right = ((hi - b) / span * 100) + '%';
      lbl.textContent = (a <= lo && b >= hi) ? off
        : (a <= lo ? '≤ ' + fmt(b) + unit
        : (b >= hi ? '≥ ' + fmt(a) + unit
        : fmt(a) + '–' + fmt(b) + unit));
    };
    inMin.addEventListener('input', e => { update(e); render(); });
    inMax.addEventListener('input', e => { update(e); render(); });
    update();
    rangeSliders.push({ reset: () => { inMin.value = lo; inMax.value = hi; update(); } });
  }

  /* ---------- Wiring ---------- */
  function fillSelect(id, items, nameFn) {
    const sel = document.getElementById(id);
    items.forEach(it => { const o = document.createElement('option'); o.value = it.id; o.textContent = nameFn(it.id); sel.appendChild(o); });
  }
  let wired = false;
  function wire() {
    document.getElementById('afSector').addEventListener('change', e => { filt.sector = e.target.value || null; render(); });
    document.getElementById('afRegion').addEventListener('change', e => { filt.region = e.target.value || null; render(); });
    // Alle Wert-Faktoren als Doppelregler (KGV, Strong Buy, Ziel, Dividende, Analysten).
    document.querySelectorAll('#anaFilters .ana-range[data-range]').forEach(wireRange);
    document.getElementById('afClear').addEventListener('click', () => {
      Object.keys(filt).forEach(k => delete filt[k]);
      document.getElementById('afSector').value = ''; document.getElementById('afRegion').value = '';
      rangeSliders.forEach(s => s.reset());
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
