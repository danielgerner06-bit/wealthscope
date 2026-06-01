/* ===== SektorScope ===== */
(function () {
  let DATA = null;
  let momentumChart = null;
  let analystChart = null;
  let currentRange = '1m';
  let hidden = {};          // sectorId -> ausgeblendet (Momentum)
  let initialized = false;

  const RANGE_LABEL = { '1m': '1M', '3m': '3M', '6m': '6M', '1j': '1J', '3j': '3J', '5j': '5J' };
  // Wie viele Wochen umfasst ein Zeitfenster ungefähr (für die x-Achsenskalierung der Steigung).
  const RANGE_WEEKS = { '1m': 4.3, '3m': 13, '6m': 26, '1j': 52, '3j': 156, '5j': 260 };

  function sectorById(id) { return DATA.sectors.find(s => s.id === id); }

  async function loadData() {
    if (DATA) return DATA;
    const res = await fetch('sectordata.json?v=' + Date.now());
    if (!res.ok) throw new Error('sectordata.json nicht gefunden');
    DATA = await res.json();
    return DATA;
  }

  function fmtPct(v, dp = 2) {
    const n = Number(v);
    return (n > 0 ? '+' : '') + n.toFixed(dp) + '%';
  }

  /* ---------- Momentum: gleitende Steigung der kumulativen %-Kurve ----------
     Eingang: kumulatives Wachstum in % (Array). Ausgang: durchschnittliche
     Wachstumsrate je WOCHE in %, gleitend über ein ~1-Wochen-Fenster geglättet.  */
  function computeMomentum(cumArr, range) {
    const n = cumArr.length;
    if (n < 2) return cumArr.map(() => 0);
    const totalWeeks = RANGE_WEEKS[range];
    const weeksPerStep = totalWeeks / (n - 1);   // wie viele Wochen ein Datenpunkt-Abstand abdeckt
    // Schritt-Differenz der kumulativen Kurve = Zuwachs über weeksPerStep Wochen
    // -> auf "pro Woche" normieren
    const slope = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
      slope[i] = (cumArr[i] - cumArr[i - 1]) / weeksPerStep;
    }
    slope[0] = slope[1];
    // Glättung: gleitender Mittelwert über ein ~1-Wochen-Fenster
    const win = Math.max(1, Math.round(1 / weeksPerStep));   // Punkte pro Woche
    const half = Math.floor(win / 2);
    const out = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let sum = 0, cnt = 0;
      for (let k = i - half; k <= i + half; k++) {
        if (k >= 0 && k < n) { sum += slope[k]; cnt++; }
      }
      out[i] = +(sum / cnt).toFixed(3);
    }
    return out;
  }

  /* ---------- Chart-Theme (hell, clean) ---------- */
  const GRID = 'rgba(15,23,42,0.07)';
  const ZERO = 'rgba(15,23,42,0.28)';
  const TICK = '#64748b';

  function lineDatasets(seriesObj, ids, withFill) {
    return ids.map(id => {
      const s = sectorById(id);
      return {
        label: s.name,
        sectorId: id,
        data: seriesObj[id],
        borderColor: s.color,
        backgroundColor: s.color,
        borderWidth: 2.2,
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

  /* ---------- Momentum-Chart (links) ---------- */
  function momentumSeries() {
    const block = DATA.performance[currentRange];
    const out = {};
    DATA.sectors.forEach(s => { out[s.id] = computeMomentum(block.series[s.id], currentRange); });
    return out;
  }

  function renderMomentumChart() {
    const block = DATA.performance[currentRange];
    const series = momentumSeries();
    const ctx = document.getElementById('sekMomentumChart');
    if (momentumChart) momentumChart.destroy();

    momentumChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: block.labels.map((_, i) => i),
        datasets: lineDatasets(series, DATA.sectors.map(s => s.id)),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 500, easing: 'easeOutCubic' },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: tooltipCfg('%/Woche'),
        },
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
      data: {
        labels: a.labels,
        datasets: lineDatasets(a.series, DATA.sectors.map(s => s.id)),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 500 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: tooltipCfg('% Anteil', 1),
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: TICK, font: { size: 10 }, maxRotation: 0, autoSkipPadding: 16 } },
          y: { grid: { color: GRID, drawTicks: false }, border: { display: false }, ticks: { color: TICK, callback: v => v + '%', font: { size: 10 }, padding: 6 } },
        },
      },
    });
  }

  function tooltipCfg(unit, dp = 2) {
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

  // Nulllinie im Momentum-Chart hervorheben
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

  /* ---------- Legenden (klickbar) ---------- */
  function buildLegend(elId, chartRef, small) {
    const el = document.getElementById(elId);
    el.innerHTML = '';
    DATA.sectors.forEach((s, i) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'sek-leg-item' + (hidden[s.id] ? ' off' : '');
      item.innerHTML = '<span class="sek-leg-swatch" style="background:' + s.color + '"></span>' + s.name;
      item.addEventListener('click', () => {
        hidden[s.id] = !hidden[s.id];
        // beide Legenden + beide Charts synchron
        syncVisibility(s.id);
      });
      el.appendChild(item);
    });
  }

  function syncVisibility(sectorId) {
    const off = !!hidden[sectorId];
    [momentumChart, analystChart].forEach(ch => {
      if (!ch) return;
      const idx = ch.data.datasets.findIndex(d => d.sectorId === sectorId);
      if (idx >= 0) ch.setDatasetVisibility(idx, !off);
      ch.update();
    });
    document.querySelectorAll('.sek-leg-item').forEach(it => {
      if (it.textContent.trim() === (sectorById(sectorId).name)) it.classList.toggle('off', off);
    });
  }

  function applyHiddenToCharts() {
    DATA.sectors.forEach(s => {
      if (!hidden[s.id]) return;
      [momentumChart, analystChart].forEach(ch => {
        if (!ch) return;
        const idx = ch.data.datasets.findIndex(d => d.sectorId === s.id);
        if (idx >= 0) ch.setDatasetVisibility(idx, false);
      });
    });
    if (momentumChart) momentumChart.update();
    if (analystChart) analystChart.update();
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
      renderMomentumChart();
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

      if (!initialized) { wireRanges(); initialized = true; }

      renderMomentumChart();
      renderAnalystChart();
      buildLegend('sekLegend', () => momentumChart);
      buildLegend('sekAnalystLegend', () => analystChart, true);
      applyHiddenToCharts();
    } catch (err) {
      console.error(err);
      document.getElementById('sekUpdated').textContent = 'Daten konnten nicht geladen werden';
    } finally {
      loading.classList.remove('show');
      setTimeout(() => { if (momentumChart) momentumChart.resize(); if (analystChart) analystChart.resize(); }, 60);
    }
  };
})();
