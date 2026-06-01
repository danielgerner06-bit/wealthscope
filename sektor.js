/* ===== SektorScope ===== */
(function () {
  let DATA = null;
  let rsChart = null;        // relative Stärke (links)
  let analystChart = null;   // Analysten-Verteilung (rechts)
  let currentRange = '1m';
  let hidden = {};           // sectorId -> ausgeblendet (für beide Charts synchron)
  let initialized = false;

  const RANGE_LABEL = { '1m': '1M', '3m': '3M', '6m': '6M', '1j': '1J', '3j': '3J', '5j': '5J' };

  function sectorById(id) { return DATA.sectors.find(s => s.id === id); }

  async function loadData() {
    if (DATA) return DATA;
    const res = await fetch('sectordata.json?v=' + Date.now());
    if (!res.ok) throw new Error('sectordata.json nicht gefunden');
    DATA = await res.json();
    return DATA;
  }

  function fmtPct(v, dp = 1) {
    const n = Number(v);
    return (n > 0 ? '+' : '') + n.toFixed(dp) + '%';
  }

  /* ---------- Relative Stärke ----------
     Pro Zeitpunkt: kumulatives %-Wachstum des Sektors minus Durchschnitt
     aller Sektoren. > 0 = schlägt den Markt, < 0 = hinkt nach.            */
  function relativeStrengthSeries(range) {
    const block = DATA.performance[range];
    const ids = DATA.sectors.map(s => s.id);
    const n = Math.max(...ids.map(id => block.series[id].length));
    // Marktdurchschnitt je Zeitpunkt
    const avg = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let sum = 0, cnt = 0;
      for (const id of ids) {
        const v = block.series[id][i];
        if (typeof v === 'number') { sum += v; cnt++; }
      }
      avg[i] = cnt ? sum / cnt : 0;
    }
    const out = {};
    for (const id of ids) {
      out[id] = block.series[id].map((v, i) => +(v - avg[i]).toFixed(2));
    }
    return out;
  }

  // letzter Wert je Sektor -> zum Ranking / Default-Auswahl
  function lastValues(series) {
    const r = {};
    for (const id of Object.keys(series)) {
      const a = series[id];
      r[id] = a[a.length - 1];
    }
    return r;
  }

  // Standard: nur die 2 besten + 2 schwächsten Sektoren sichtbar
  function defaultHidden(series) {
    const lv = lastValues(series);
    const sorted = Object.keys(lv).sort((a, b) => lv[b] - lv[a]);
    const show = new Set([...sorted.slice(0, 2), ...sorted.slice(-2)]);
    const h = {};
    DATA.sectors.forEach(s => { h[s.id] = !show.has(s.id); });
    return h;
  }

  /* ---------- Chart-Theme (hell, clean) ---------- */
  const GRID = 'rgba(15,23,42,0.07)';
  const ZERO = 'rgba(15,23,42,0.30)';
  const TICK = '#64748b';

  function lineDatasets(seriesObj, ids) {
    return ids.map(id => {
      const s = sectorById(id);
      return {
        label: s.name,
        sectorId: id,
        data: seriesObj[id],
        borderColor: s.color,
        backgroundColor: s.color,
        borderWidth: 2.4,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: s.color,
        pointHoverBorderColor: '#fff',
        pointHoverBorderWidth: 2,
        tension: 0.35,
        fill: false,
        hidden: !!hidden[id],
      };
    });
  }

  function tooltipCfg(unit, dp = 1) {
    return {
      backgroundColor: '#ffffff',
      borderColor: 'rgba(15,23,42,0.12)',
      borderWidth: 1,
      titleColor: '#0f172a',
      bodyColor: '#334155',
      padding: 12,
      cornerRadius: 12,
      usePointStyle: true,
      boxWidth: 8, boxHeight: 8, boxPadding: 5,
      titleFont: { weight: '700' },
      callbacks: {
        title: () => RANGE_LABEL[currentRange] + ' · ' + unit,
        label: c => '  ' + c.dataset.label + ': ' + fmtPct(c.parsed.y, dp),
      },
      itemSort: (a, b) => b.parsed.y - a.parsed.y,
    };
  }

  // Nulllinie hervorheben
  const zeroLinePlugin = {
    id: 'zeroLine',
    afterDraw(chart) {
      const y = chart.scales.y;
      if (!y) return;
      const yPos = y.getPixelForValue(0);
      if (yPos < chart.chartArea.top || yPos > chart.chartArea.bottom) return;
      const { ctx, chartArea } = chart;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(chartArea.left, yPos);
      ctx.lineTo(chartArea.right, yPos);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = ZERO;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.restore();
    },
  };

  /* ---------- Relative-Stärke-Chart (links) ---------- */
  function renderRsChart() {
    const block = DATA.performance[currentRange];
    const series = relativeStrengthSeries(currentRange);
    const ctx = document.getElementById('sekMomentumChart');
    if (rsChart) rsChart.destroy();

    rsChart = new Chart(ctx, {
      type: 'line',
      data: { labels: block.labels.map((_, i) => i), datasets: lineDatasets(series, DATA.sectors.map(s => s.id)) },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 500, easing: 'easeOutCubic' },
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: tooltipCfg('vs. Markt') },
        scales: {
          x: { display: false, grid: { display: false } },
          y: {
            grid: { color: GRID, drawTicks: false },
            border: { display: false },
            ticks: { color: TICK, callback: v => (v > 0 ? '+' : '') + v + '%', font: { size: 11 }, padding: 8 },
          },
        },
      },
      plugins: [zeroLinePlugin],
    });
  }

  /* ---------- Analysten-Chart (rechts) ---------- */
  function renderAnalystChart() {
    const a = DATA.analyst;
    const ctx = document.getElementById('sekAnalystChart');
    if (analystChart) analystChart.destroy();

    analystChart = new Chart(ctx, {
      type: 'line',
      data: { labels: a.labels, datasets: lineDatasets(a.series, DATA.sectors.map(s => s.id)) },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 500 },
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: tooltipCfg('% Anteil', 1) },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: TICK, font: { size: 10 }, maxRotation: 0, autoSkipPadding: 16 } },
          y: { grid: { color: GRID, drawTicks: false }, border: { display: false }, ticks: { color: TICK, callback: v => v + '%', font: { size: 10 }, padding: 6 } },
        },
      },
    });
  }

  /* ---------- Legenden (klickbar, beide synchron) ---------- */
  function buildLegend(elId) {
    const el = document.getElementById(elId);
    el.innerHTML = '';
    DATA.sectors.forEach(s => {
      const item = document.createElement('button');
      item.type = 'button';
      item.dataset.sectorId = s.id;
      item.className = 'sek-leg-item' + (hidden[s.id] ? ' off' : '');
      item.innerHTML = '<span class="sek-leg-swatch" style="background:' + s.color + '"></span>' + s.name;
      item.addEventListener('click', () => {
        hidden[s.id] = !hidden[s.id];
        syncVisibility(s.id);
      });
      el.appendChild(item);
    });
  }

  function syncVisibility(sectorId) {
    const off = !!hidden[sectorId];
    [rsChart, analystChart].forEach(ch => {
      if (!ch) return;
      const idx = ch.data.datasets.findIndex(d => d.sectorId === sectorId);
      if (idx >= 0) ch.setDatasetVisibility(idx, !off);
      ch.update();
    });
    document.querySelectorAll('.sek-leg-item[data-sector-id="' + sectorId + '"]').forEach(it => it.classList.toggle('off', off));
  }

  function applyHiddenToCharts() {
    [rsChart, analystChart].forEach(ch => {
      if (!ch) return;
      DATA.sectors.forEach(s => {
        const idx = ch.data.datasets.findIndex(d => d.sectorId === s.id);
        if (idx >= 0) ch.setDatasetVisibility(idx, !hidden[s.id]);
      });
      ch.update();
    });
  }

  /* ---------- Top-Aktien-Liste ---------- */
  function renderStocks() {
    const list = document.getElementById('sekStockList');
    const countEl = document.getElementById('sekStockCount');
    const stocks = Array.isArray(DATA.topStocks) ? DATA.topStocks : [];
    countEl.textContent = stocks.length ? '(' + stocks.length + ')' : '';
    list.innerHTML = '';
    if (!stocks.length) {
      list.innerHTML = '<div class="sek-stocks-empty">Keine Aktien in den Daten.</div>';
      return;
    }
    [...stocks].sort((a, b) => (b.upside || 0) - (a.upside || 0)).forEach(st => {
      const sec = sectorById(st.sector) || { name: st.sector, color: '#94a3b8' };
      const row = document.createElement('div');
      row.className = 'sek-stock';
      const up = (st.upside != null) ? '<span class="sek-stock-up">+' + Number(st.upside).toFixed(0) + '%</span>' : '';
      row.innerHTML =
        '<span class="sek-stock-dot" style="background:' + sec.color + '"></span>' +
        '<span class="sek-stock-tk">' + (st.ticker || '') + '</span>' +
        '<span class="sek-stock-nm">' + (st.name || '') + '</span>' +
        '<span class="sek-stock-sec">' + sec.name + '</span>' +
        up;
      list.appendChild(row);
    });
  }

  /* ---------- Range-Umschalter ---------- */
  function wireRanges() {
    document.getElementById('sekRanges').addEventListener('click', e => {
      const btn = e.target.closest('button[data-range]');
      if (!btn) return;
      const r = btn.dataset.range;
      if (r === currentRange) return;
      currentRange = r;
      document.querySelectorAll('#sekRanges button').forEach(b => b.classList.toggle('active', b === btn));
      renderRsChart();
      applyHiddenToCharts();
    });
  }

  /* ---------- Init ---------- */
  window.initSektor = async function () {
    const loading = document.getElementById('sekLoading');
    try {
      loading.classList.add('show');
      await loadData();
      document.getElementById('sekUpdated').textContent = 'Stand: ' + (DATA.updated || '—');

      // Default-Sichtbarkeit aus aktueller relativer Stärke (nur beim ersten Mal)
      if (!initialized) {
        hidden = defaultHidden(relativeStrengthSeries(currentRange));
        wireRanges();
        initialized = true;
      }

      renderRsChart();
      renderAnalystChart();
      buildLegend('sekLegend');
      buildLegend('sekAnalystLegend');
      renderStocks();
      applyHiddenToCharts();
    } catch (err) {
      console.error(err);
      document.getElementById('sekUpdated').textContent = 'Daten konnten nicht geladen werden';
    } finally {
      loading.classList.remove('show');
      setTimeout(() => { if (rsChart) rsChart.resize(); if (analystChart) analystChart.resize(); }, 60);
    }
  };
})();
