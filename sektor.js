/* ===== SektorScope ===== */
(function () {
  let DATA = null;
  let barChart = null;
  let sortKey = 'upside';
  let sortDir = -1;          // -1 = absteigend, 1 = aufsteigend
  let barRows = [];          // aktuelle Reihenfolge im Balkenchart
  let view = 'sectors';      // 'sectors' | 'regions'

  // Items (Sektoren oder Regionen) + Performance-Reihe je nach Ansicht
  function viewItems() { return (view === 'regions' ? DATA.regions : DATA.sectors) || []; }
  function viewBars() { return (view === 'regions' ? DATA.bars30Region : DATA.bars30) || []; }
  function itemById(id) { return viewItems().find(s => s.id === id) || { name: id, color: '#94a3b8' }; }
  // Aktien tragen immer einen Sektor (unabhängig von der Diagramm-Ansicht)
  function sectorById(id) { return (DATA.sectors || []).find(s => s.id === id) || { name: id, color: '#94a3b8' }; }

  async function loadData() {
    if (DATA) return DATA;
    const res = await fetch('sectordata.json?v=' + Date.now());
    if (!res.ok) throw new Error('sectordata.json nicht gefunden');
    DATA = await res.json();
    return DATA;
  }

  const fmtPct = (v, dp = 1) => (Number(v) > 0 ? '+' : '') + (Number(v) || 0).toFixed(dp) + '%';

  /* ---------- Balkendiagramm: 30-Tage-Performance + Ø-360T-Referenz ---------- */
  function renderBars() {
    barRows = [...viewBars()].sort((a, b) => b.perf - a.perf);
    const values = barRows.map(r => +Number(r.perf).toFixed(2));
    const avgValues = barRows.map(r => (r.avg30 != null ? +Number(r.avg30).toFixed(2) : null));
    const hasAvg = avgValues.some(v => v != null);
    const colors = barRows.map(r => {
      const base = itemById(r.id).color;
      return r.perf >= 0 ? base : mix(base, '#ef4444', 0.45);
    });
    const avgColors = barRows.map(r => hexA(itemById(r.id).color, 0.20));

    renderBarNames();

    const ctx = document.getElementById('sekBars');
    if (barChart) barChart.destroy();

    const datasets = [];
    if (hasAvg) {
      datasets.push({
        label: 'Ø 30T über 360 Tage', data: avgValues, backgroundColor: avgColors,
        borderRadius: 5, borderSkipped: false, barPercentage: 0.72, categoryPercentage: 0.84, order: 2,
      });
    }
    datasets.push({
      label: '30 Tage aktuell', data: values, backgroundColor: colors,
      borderRadius: 5, borderSkipped: false, barPercentage: 0.72, categoryPercentage: 0.84, order: 1,
    });

    barChart = new Chart(ctx, {
      type: 'bar',
      data: { labels: barRows.map(r => itemById(r.id).name), datasets },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 650, easing: 'easeOutCubic' },
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: {
            grace: '12%',   // Puffer an beiden Enden, damit Wert-Labels nicht abschneiden
            grid: { color: 'rgba(148,163,184,0.14)', drawTicks: false },
            border: { display: false },
            ticks: { color: '#94a3b8', callback: v => (v > 0 ? '+' : '') + v + '%', font: { size: 11 } },
          },
          y: { display: false, grid: { display: false } },
        },
        layout: { padding: { right: 44, left: 4 } },
      },
      plugins: [zeroBarLine, valueLabels],
    });
  }

  // Sektornamen als klickbare HTML-Liste links neben dem Chart (öffnet Lage-Modal)
  function renderBarNames() {
    const wrap = document.getElementById('sekBarsNames');
    wrap.innerHTML = '';
    barRows.forEach(r => {
      const sec = itemById(r.id);
      const b = document.createElement('button');
      b.className = 'sek-bar-name';
      b.innerHTML = '<i style="background:' + sec.color + '"></i><span>' + sec.name + '</span>';
      b.addEventListener('click', () => openSectorModal(r.id));
      wrap.appendChild(b);
    });
  }

  const zeroBarLine = {
    id: 'zeroBarLine',
    afterDraw(chart) {
      const x = chart.scales.x; if (!x) return;
      const xPos = x.getPixelForValue(0);
      const { ctx, chartArea } = chart;
      ctx.save();
      ctx.beginPath(); ctx.moveTo(xPos, chartArea.top); ctx.lineTo(xPos, chartArea.bottom);
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(148,163,184,0.45)'; ctx.setLineDash([3, 3]); ctx.stroke();
      ctx.restore();
    },
  };

  const valueLabels = {
    id: 'valueLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const di = chart.data.datasets.findIndex(d => d.label === '30 Tage aktuell');
      if (di < 0) return;
      const meta = chart.getDatasetMeta(di);
      const data = chart.data.datasets[di].data;
      ctx.save();
      ctx.font = '700 11px Inter, system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      meta.data.forEach((bar, i) => {
        const v = data[i]; const pos = v >= 0;
        ctx.fillStyle = pos ? '#34d399' : '#f87171';
        ctx.textAlign = pos ? 'left' : 'right';
        ctx.fillText(fmtPct(v), bar.x + (pos ? 8 : -8), bar.y);
      });
      ctx.restore();
    },
  };

  /* ---------- Analysten-Perlen mit Filter + Sortierung ---------- */
  const filters = { pe: null, perf6m: null, buyPct: null, upside: null };

  function passesFilter(s) {
    // KGV höchstens; 6M-Performance HÖCHSTENS (Aktien, die noch nicht durch die Decke sind);
    // Kauf-% und Ziel-Potenzial mindestens. Aktien ohne den jeweiligen Wert fallen raus.
    if (filters.pe != null && !(s.pe != null && s.pe <= filters.pe)) return false;
    if (filters.perf6m != null && !(s.perf6m != null && s.perf6m <= filters.perf6m)) return false;
    if (filters.buyPct != null && !(s.buyPct != null && s.buyPct >= filters.buyPct)) return false;
    if (filters.upside != null && !(s.upside != null && s.upside >= filters.upside)) return false;
    return true;
  }

  function renderStocks() {
    const list = document.getElementById('sekStockList');
    const countEl = document.getElementById('sekStockCount');
    const all = Array.isArray(DATA.topStocks) ? DATA.topStocks.slice() : [];
    const stocks = all.filter(passesFilter).sort(cmp);
    const anyFilter = Object.values(filters).some(v => v != null);
    countEl.textContent = anyFilter ? stocks.length + ' / ' + all.length : all.length + ' Treffer';

    list.innerHTML = '';
    if (!stocks.length) {
      list.innerHTML = '<div class="sek-stocks-empty">' +
        (anyFilter ? 'Keine Aktie passt zu diesem Filter.' : 'Noch keine Treffer — der tägliche Scan füllt die Liste.') +
        '</div>';
      return;
    }

    stocks.forEach(st => {
      const sec = sectorById(st.sector);
      const row = document.createElement('div');
      row.className = 'sek-stock';
      const metric = stockMetric(st);
      const meta = [];
      if (st.buyPct != null) meta.push('Kauf ' + st.buyPct + '%');
      if (st.outperformPct != null) meta.push('Outp. ' + st.outperformPct + '%');
      if (st.analysts != null) meta.push(st.analysts + ' Analyst' + (st.analysts === 1 ? '' : 'en'));
      row.innerHTML =
        '<span class="sek-stock-dot" style="background:' + sec.color + '"></span>' +
        '<div class="sek-stock-main">' +
          '<div class="sek-stock-top"><span class="sek-stock-tk">' + (st.ticker || '') + '</span>' +
          '<span class="sek-stock-nm">' + (st.name || '') + '</span></div>' +
          '<div class="sek-stock-meta">' + sec.name + (meta.length ? ' · ' + meta.join(' · ') : '') + '</div>' +
        '</div>' + metric;
      list.appendChild(row);
    });
  }

  // Rechts an der Zeile: der aktuell sortierte Wert, hervorgehoben
  function stockMetric(st) {
    let v, label, cls = 'sek-stock-val';
    if (sortKey === 'perf6m') { v = st.perf6m; label = v != null ? fmtPct(v) : '—'; cls += v >= 0 ? ' up' : ' down'; }
    else if (sortKey === 'outperformPct') { v = st.outperformPct; label = v != null ? v + '%' : '—'; }
    else if (sortKey === 'analysts') { v = st.analysts; label = v != null ? v + ' An.' : '—'; }
    else if (sortKey === 'pe') { v = st.pe; label = v != null ? 'KGV ' + v : 'KGV —'; }
    else { v = st.upside; label = v != null ? '+' + Math.round(v) + '%' : '—'; cls += ' up'; }
    return '<span class="' + cls + '">' + label + '</span>';
  }

  function cmp(a, b) {
    const va = a[sortKey], vb = b[sortKey];
    // fehlende Werte immer ans Ende
    const miss = v => v == null || !isFinite(v);
    if (miss(va) && miss(vb)) return (b.upside ?? -999) - (a.upside ?? -999);
    if (miss(va)) return 1;
    if (miss(vb)) return -1;
    if (va === vb) return (b.upside ?? -999) - (a.upside ?? -999);
    return sortDir === -1 ? vb - va : va - vb;
  }

  function wireSort() {
    document.getElementById('sekSort').addEventListener('click', e => {
      const btn = e.target.closest('button[data-key]');
      if (!btn) return;
      const key = btn.dataset.key;
      if (key === sortKey) { sortDir = -sortDir; }      // gleicher Button -> Richtung umdrehen
      else { sortKey = key; sortDir = key === 'pe' ? 1 : -1; } // KGV: klein zuerst
      document.querySelectorAll('#sekSort button').forEach(b => {
        b.classList.toggle('active', b === btn);
        b.classList.remove('asc', 'desc');
      });
      btn.classList.add(sortDir === -1 ? 'desc' : 'asc');
      renderStocks();
    });
  }

  function wireFilter() {
    const map = { fltPe: 'pe', fltPerf6m: 'perf6m', fltBuy: 'buyPct', fltUpside: 'upside' };
    Object.keys(map).forEach(id => {
      document.getElementById(id).addEventListener('input', e => {
        // erlaubt negative Werte und Komma; ungültige Eingabe -> kein Filter
        const raw = e.target.value.trim().replace(',', '.');
        const num = parseFloat(raw);
        filters[map[id]] = (raw === '' || isNaN(num)) ? null : num;
        renderStocks();
      });
    });
    document.getElementById('fltClear').addEventListener('click', () => {
      Object.keys(map).forEach(id => { document.getElementById(id).value = ''; });
      filters.pe = filters.perf6m = filters.buyPct = filters.upside = null;
      renderStocks();
    });
  }

  /* ---------- Lage-Modal (Sektor oder Region) ---------- */
  function openSectorModal(id) {
    const sec = itemById(id);
    const bar = viewBars().find(b => b.id === id) || {};
    // KI-Lagetexte gibt es nur für Sektoren
    const note = view === 'sectors' ? (DATA.sectorNotes || {})[id] : null;

    document.getElementById('sekModalTitle').textContent = sec.name;
    document.getElementById('sekModalDot').style.background = sec.color;

    const stat = (lbl, val, cls) => '<div class="sek-mstat"><span>' + lbl + '</span><b class="' + (cls || '') + '">' + val + '</b></div>';
    const cl = v => v == null ? '' : (v >= 0 ? 'up' : 'down');
    document.getElementById('sekModalStats').innerHTML =
      stat('30 Tage', bar.perf != null ? fmtPct(bar.perf) : '—', cl(bar.perf)) +
      stat('Ø 30T (360T)', bar.avg30 != null ? fmtPct(bar.avg30) : '—', cl(bar.avg30)) +
      stat('6 Monate', bar.perf6m != null ? fmtPct(bar.perf6m) : '—', cl(bar.perf6m));

    const insightBox = document.querySelector('.sek-modal-insight');
    if (view === 'regions') {
      insightBox.style.display = 'none';
    } else {
      insightBox.style.display = '';
      document.getElementById('sekModalText').textContent = note?.text || 'Für diesen Sektor liegt noch kein KI-Text vor — er wird in den nächsten Tagen ergänzt (die Analyse läuft rollierend, um das Kontingent zu schonen).';
      document.getElementById('sekModalDate').textContent = note?.date ? 'Stand: ' + note.date : '';
    }

    const m = document.getElementById('sekModal');
    m.hidden = false;
    requestAnimationFrame(() => m.classList.add('show'));
  }
  function closeModal() {
    const m = document.getElementById('sekModal');
    m.classList.remove('show');
    setTimeout(() => { m.hidden = true; }, 200);
  }
  function wireModal() {
    document.getElementById('sekModal').addEventListener('click', e => {
      if (e.target.closest('[data-close]')) closeModal();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  }

  /* ---------- Ansicht-Toggle: Sektoren <-> Regionen ---------- */
  function applyViewLabels() {
    const isReg = view === 'regions';
    document.getElementById('sekBarsTitle').textContent =
      (isReg ? 'Regionen-Performance' : 'Sektor-Performance') + ' · 30 Tage';
    document.getElementById('sekBarsSub').textContent = isReg
      ? 'Weltregionen gerankt nach 30-Tage-Kurs. Klick auf einen Namen zeigt die Kennzahlen.'
      : 'Gerankt nach 30-Tage-Kurs. Klick auf einen Namen zeigt die aktuelle Lage.';
  }
  function wireViewToggle() {
    document.getElementById('sekViewToggle').addEventListener('click', e => {
      const btn = e.target.closest('button[data-view]');
      if (!btn || btn.dataset.view === view) return;
      view = btn.dataset.view;
      document.querySelectorAll('#sekViewToggle button').forEach(b => b.classList.toggle('active', b === btn));
      applyViewLabels();
      renderBars();
    });
  }

  /* ---------- Header: Stand mit Uhrzeit ---------- */
  function renderStand() {
    const el = document.getElementById('sekUpdated');
    let txt = 'Stand: ' + (DATA.updated || '—');
    if (DATA.updatedAt) {
      const d = new Date(DATA.updatedAt);
      if (!isNaN(d)) {
        const t = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        txt = 'Stand: ' + d.toLocaleDateString('de-DE') + ', ' + t + ' Uhr';
      }
    }
    el.textContent = txt;
  }

  /* ---------- Farbhilfen ---------- */
  function mix(hex, hex2, t) {
    const a = h2rgb(hex), b = h2rgb(hex2);
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * t) + ',' + Math.round(a[1] + (b[1] - a[1]) * t) + ',' + Math.round(a[2] + (b[2] - a[2]) * t) + ')';
  }
  function h2rgb(h) { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function hexA(hex, a) { const [r, g, b] = h2rgb(hex); return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')'; }

  /* ---------- Init ---------- */
  let wired = false;
  window.initSektor = async function () {
    const loading = document.getElementById('sekLoading');
    try {
      loading.classList.add('show');
      await loadData();
      renderStand();
      if (!wired) { wireSort(); wireFilter(); wireModal(); wireViewToggle(); wired = true; }
      applyViewLabels();
      renderBars();
      renderStocks();
    } catch (err) {
      console.error(err);
      document.getElementById('sekUpdated').textContent = 'Daten konnten nicht geladen werden';
    } finally {
      loading.classList.remove('show');
      setTimeout(() => { if (barChart) barChart.resize(); }, 60);
    }
  };
})();
