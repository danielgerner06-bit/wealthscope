/* ===== TrendScope · Faktor-Analyse ===== */
(function () {
  let HIST = null, SECT = null, REG = null, chart = null;
  let view = 'bars';                 // 'bars' | 'line'
  let xFactor = 'pe', xWindow = 'perf6m';
  const FW = [['perf1m', '1M'], ['perf3m', '3M'], ['perf6m', '6M'], ['perf1j', '1J']];
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
  function factorCurve(data, factorKey, perfKey) {
    const pts = data.map(s => ({ x: s[factorKey], y: s[perfKey] }))
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
    bins.forEach((arr, i) => {
      if (!arr.length) return;
      const cx = avg(arr.map(p => p.x));
      const cy = avg(arr.map(p => p.y));
      curve.push({ x: +cx.toFixed(2), y: +cy.toFixed(2) });
    });
    if (curve.length < 2) return { points: curve, slope: 0, n: pts.length };
    // mittlere |Steigung| pro normierter x-Einheit: Summe |Δy| über den Verlauf / x-Spanne
    let totalDy = 0;
    for (let i = 1; i < curve.length; i++) totalDy += Math.abs(curve[i].y - curve[i - 1].y);
    const slope = +(totalDy / (curve.length - 1)).toFixed(2);   // Ø Performance-Änderung je Bin-Schritt
    return { points: curve, slope, n: pts.length };
  }

  /* ---------- Diagramm rendern (Balken oder Linie) ---------- */
  function render() {
    const matched = HIST.filter(passes);
    document.getElementById('anaCount').textContent = matched.length + ' / ' + HIST.length + ' Aktien';
    document.getElementById('anaMatch').textContent = matched.length
      ? matched.length + ' Aktien im Filter' + (matched.some(s => s.fake) ? ' · enthält Demo-Daten' : '')
      : 'Keine Aktien im aktuellen Filter.';

    const ctx = document.getElementById('anaChart');
    if (chart) chart.destroy();

    if (view === 'line') {
      document.getElementById('anaTitle').innerHTML = 'Performance über ' + flabel(xFactor);
      const { points, slope, n } = factorCurve(matched, xFactor, xWindow);
      chart = new Chart(ctx, {
        type: 'line',
        data: { datasets: [{
          data: points, parsing: false,
          borderColor: '#818cf8', borderWidth: 2.4,
          backgroundColor: 'rgba(129,140,248,0.12)', fill: true,
          tension: 0.45, pointRadius: 3, pointBackgroundColor: '#c084fc', pointHoverRadius: 5,
        }] },
        options: {
          responsive: true, maintainAspectRatio: false, animation: { duration: 450 },
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: c => flabel(xFactor) + ' ' + c.parsed.x + ' → Ø ' + (c.parsed.y > 0 ? '+' : '') + c.parsed.y + '%' } },
          },
          scales: {
            x: { type: 'linear', title: { display: true, text: flabel(xFactor), color: '#94a3b8', font: { size: 11 } },
                 grid: { color: 'rgba(148,163,184,0.12)' }, border: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } } },
            y: { title: { display: true, text: 'Ø Performance (' + FW.find(f => f[0] === xWindow)[1] + ')', color: '#94a3b8', font: { size: 11 } },
                 grid: { color: 'rgba(148,163,184,0.12)', drawTicks: false }, border: { display: false }, ticks: { color: '#94a3b8', callback: v => v + '%', font: { size: 10 } } },
          },
        },
        plugins: [zeroLine],
      });
      document.getElementById('anaMatch').textContent +=
        n >= 4 ? ' · Wirkung ' + flabel(xFactor) + ': ' + (slope > 4 ? 'stark' : slope > 1.5 ? 'mittel' : 'gering') + ' (Ø ' + slope + '%/Stufe)' : ' · zu wenige Datenpunkte für die Kurve';
    } else {
      document.getElementById('anaTitle').innerHTML = 'Ø&nbsp;Performance seit Aufnahme';
      const labels = FW.map(f => f[1]);
      const values = FW.map(([key]) => { const v = avg(matched.map(s => s[key]).filter(x => x != null)); return v != null ? +v.toFixed(2) : null; });
      const colors = values.map(v => v == null ? 'rgba(148,163,184,0.3)' : v >= 0 ? '#34d399' : '#f87171');
      chart = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ data: values.map(v => v ?? 0), backgroundColor: colors, borderRadius: 7, maxBarThickness: 70 }] },
        options: {
          responsive: true, maintainAspectRatio: false, animation: { duration: 450 },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => '  Ø ' + (values[c.dataIndex] == null ? 'keine Daten' : (values[c.dataIndex] > 0 ? '+' : '') + values[c.dataIndex] + '%') } } },
          scales: {
            x: { grid: { display: false }, border: { display: false }, ticks: { color: '#cbd5e1', font: { size: 13, weight: '700' } } },
            y: { grid: { color: 'rgba(148,163,184,0.14)', drawTicks: false }, border: { display: false }, ticks: { color: '#94a3b8', callback: v => v + '%', font: { size: 11 } } },
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

  /* ---------- Wichtigste Faktoren: gerankt nach Ø-Spline-Steigung ---------- */
  function renderFactors() {
    const el = document.getElementById('anaFactors');
    const data = HIST.filter(passes);
    const rows = [];
    for (const f of FACTORS) {
      const { points, slope, n } = factorCurve(data, f.key, xWindow);
      if (n < 4 || points.length < 2) continue;
      // bester Wert = x-Bin mit höchster Ø-Performance
      const best = points.reduce((a, b) => b.y > a.y ? b : a, points[0]);
      rows.push({ label: f.label, slope, bestX: best.x, bestY: best.y });
    }
    rows.sort((a, b) => b.slope - a.slope);
    const maxSlope = rows.length ? Math.max(...rows.map(r => r.slope), 0.1) : 1;

    el.innerHTML = '';
    if (!rows.length) { el.innerHTML = '<div class="sek-stocks-empty">Noch zu wenige Daten für die Faktor-Analyse.</div>'; return; }
    rows.forEach(r => {
      const row = document.createElement('div');
      row.className = 'ana-factor';
      row.innerHTML =
        '<div class="ana-factor-top"><span class="ana-factor-name">' + r.label + '</span>' +
        '<span class="ana-factor-spread">' + r.slope.toFixed(1) + '%/Stufe</span></div>' +
        '<div class="ana-factor-bar"><span style="width:' + Math.round((r.slope / maxSlope) * 100) + '%"></span></div>' +
        '<div class="ana-factor-best">am besten bei <b>' + r.bestX + '</b> (Ø ' + (r.bestY > 0 ? '+' : '') + r.bestY.toFixed(1) + '%)</div>';
      el.appendChild(row);
    });
  }

  /* ---------- KI-Analyse (3 beste Kombis) ---------- */
  function renderKi() {
    const el = document.getElementById('anaKi');
    const txt = (HIST._kiObj && HIST._kiObj.kiAnalysis && HIST._kiObj.kiAnalysis.text) || null;
    el.textContent = txt || 'Sobald genügend echte Performance-Daten vorliegen, nennt die KI hier die stärksten Faktor-Kombinationen. (Aktuell überbrücken Demo-Werte.)';
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
    num('afPeMin', 'peMin'); num('afPeMax', 'peMax'); num('afBuy', 'buy'); num('afOutp', 'outp');
    num('afUpside', 'upside'); num('afDiv', 'div'); num('afAnalysts', 'analysts');
    document.getElementById('afClear').addEventListener('click', () => {
      Object.keys(filt).forEach(k => delete filt[k]);
      document.querySelectorAll('#anaFilters input').forEach(i => i.value = '');
      document.getElementById('afSector').value = ''; document.getElementById('afRegion').value = '';
      render();
    });
    // Diagramm-Toggle
    document.getElementById('anaViewToggle').addEventListener('click', e => {
      const btn = e.target.closest('button[data-view]'); if (!btn || btn.dataset.view === view) return;
      view = btn.dataset.view;
      document.querySelectorAll('#anaViewToggle button').forEach(b => b.classList.toggle('active', b === btn));
      document.getElementById('anaAxis').hidden = (view !== 'line');
      render();
    });
    document.getElementById('anaXFactor').addEventListener('change', e => { xFactor = e.target.value; render(); });
    document.getElementById('anaXWindow').addEventListener('change', e => { xWindow = e.target.value; render(); });
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
