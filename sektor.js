/* ===== SektorScope ===== */
(function () {
  let DATA = null;
  let perfChart = null;
  let analystChart = null;
  let currentRange = '1j';
  let hidden = {};          // sectorId -> true wenn ausgeblendet
  let initialized = false;

  const RANGE_LABEL = { '1m': '1M', '3m': '3M', '6m': '6M', '1j': '1J', '3j': '3J', '5j': '5J' };

  function sectorById(id) {
    return DATA.sectors.find(s => s.id === id);
  }

  // Chart.js Grunddesign passend zum dunklen Theme
  function baseGridColor() { return 'rgba(58,67,100,0.35)'; }
  function tickColor() { return '#8b93b0'; }

  async function loadData() {
    if (DATA) return DATA;
    const res = await fetch('sectordata.json?v=' + Date.now());
    if (!res.ok) throw new Error('sectordata.json nicht gefunden');
    DATA = await res.json();
    return DATA;
  }

  function fmtPct(v) {
    const n = Number(v);
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }

  /* ---------- Performance-Liniendiagramm ---------- */
  function buildPerfDatasets() {
    const block = DATA.performance[currentRange];
    return DATA.sectors.map(s => ({
      label: s.name,
      sectorId: s.id,
      data: block.series[s.id],
      borderColor: s.color,
      backgroundColor: s.color,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHoverBorderColor: '#fff',
      pointHoverBorderWidth: 1.5,
      tension: 0.32,
      hidden: !!hidden[s.id],
    }));
  }

  function renderPerfChart() {
    const block = DATA.performance[currentRange];
    const ctx = document.getElementById('sekPerfChart');
    if (perfChart) perfChart.destroy();

    perfChart = new Chart(ctx, {
      type: 'line',
      data: { labels: block.labels.map((_, i) => i), datasets: buildPerfDatasets() },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 600, easing: 'easeOutCubic' },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#161b2e',
            borderColor: '#3a4364',
            borderWidth: 1,
            titleColor: '#f1f5f9',
            bodyColor: '#cbd5e1',
            padding: 12,
            cornerRadius: 10,
            displayColors: true,
            boxWidth: 9, boxHeight: 9, boxPadding: 4, usePointStyle: true,
            callbacks: {
              title: () => RANGE_LABEL[currentRange] + ' Zeitraum',
              label: c => '  ' + c.dataset.label + ': ' + fmtPct(c.parsed.y),
            },
            itemSort: (a, b) => b.parsed.y - a.parsed.y,
          },
        },
        scales: {
          x: { display: false, grid: { display: false } },
          y: {
            grid: { color: baseGridColor() },
            border: { display: false },
            ticks: { color: tickColor(), callback: v => v + '%', font: { size: 11 } },
          },
        },
      },
    });
  }

  /* ---------- Legende (klickbar) ---------- */
  function renderLegend() {
    const el = document.getElementById('sekLegend');
    el.innerHTML = '';
    DATA.sectors.forEach(s => {
      const item = document.createElement('div');
      item.className = 'sek-leg-item' + (hidden[s.id] ? ' off' : '');
      item.innerHTML = '<span class="sek-leg-swatch" style="background:' + s.color + '"></span>' + s.name;
      item.addEventListener('click', () => {
        hidden[s.id] = !hidden[s.id];
        item.classList.toggle('off', hidden[s.id]);
        const ds = perfChart.data.datasets.find(d => d.sectorId === s.id);
        const idx = perfChart.data.datasets.indexOf(ds);
        perfChart.setDatasetVisibility(idx, !hidden[s.id]);
        perfChart.update();
      });
      el.appendChild(item);
    });
  }

  /* ---------- Rangliste-Balken ---------- */
  function renderRanking() {
    const block = DATA.performance[currentRange];
    const rows = DATA.sectors.map(s => {
      const series = block.series[s.id];
      return { s, val: series[series.length - 1] };
    }).sort((a, b) => b.val - a.val);

    const maxAbs = Math.max(...rows.map(r => Math.abs(r.val)), 1);
    const wrap = document.getElementById('sekBars');
    wrap.innerHTML = '';

    rows.forEach(r => {
      const row = document.createElement('div');
      row.className = 'sek-bar-row';
      const pct = (Math.abs(r.val) / maxAbs) * 100;
      const cls = r.val >= 0 ? 'pos' : 'neg';
      row.innerHTML =
        '<span class="sek-bar-label">' + r.s.name + '</span>' +
        '<span class="sek-bar-val ' + cls + '">' + fmtPct(r.val) + '</span>' +
        '<span class="sek-bar-track"><span class="sek-bar-fill" style="width:0%;background:' + r.s.color + '"></span></span>';
      wrap.appendChild(row);
      requestAnimationFrame(() => {
        row.querySelector('.sek-bar-fill').style.width = pct + '%';
      });
    });

    document.getElementById('sekRankRange').textContent = RANGE_LABEL[currentRange];
  }

  /* ---------- Analysten-Liniendiagramm ---------- */
  function renderAnalystChart() {
    const a = DATA.analyst;
    const ctx = document.getElementById('sekAnalystChart');
    if (analystChart) analystChart.destroy();

    analystChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: a.labels,
        datasets: DATA.sectors.map(s => ({
          label: s.name,
          data: a.series[s.id],
          borderColor: s.color,
          backgroundColor: s.color,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.32,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#161b2e', borderColor: '#3a4364', borderWidth: 1,
            titleColor: '#f1f5f9', bodyColor: '#cbd5e1', padding: 12, cornerRadius: 10,
            usePointStyle: true, boxWidth: 9, boxHeight: 9, boxPadding: 4,
            callbacks: { label: c => '  ' + c.dataset.label + ': ' + c.parsed.y.toFixed(1) + '%' },
            itemSort: (x, y) => y.parsed.y - x.parsed.y,
          },
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: tickColor(), font: { size: 10 }, maxRotation: 0, autoSkipPadding: 14 } },
          y: { grid: { color: baseGridColor() }, border: { display: false }, ticks: { color: tickColor(), callback: v => v + '%', font: { size: 10 } } },
        },
      },
    });
  }

  /* ---------- Top-Aktien-Tabelle ---------- */
  function renderStockTable() {
    const body = document.getElementById('sekStockBody');
    body.innerHTML = '';
    [...DATA.topStocks].sort((a, b) => b.upside - a.upside).forEach(st => {
      const sec = sectorById(st.sector) || { name: st.sector, color: '#888' };
      const ratingCls = /strong/i.test(st.rating) ? 'strong' : 'buy';
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td><span class="sek-stock-tk">' + st.ticker + '</span><div class="sek-stock-nm">' + st.name + '</div></td>' +
        '<td><span class="sek-sec-pill"><i style="background:' + sec.color + '"></i>' + sec.name + '</span></td>' +
        '<td><span class="sek-rating ' + ratingCls + '">' + st.rating + '</span></td>' +
        '<td class="num"><span class="sek-upside">+' + Number(st.upside).toFixed(0) + '%</span></td>';
      body.appendChild(tr);
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
      renderPerfChart();
      // Sichtbarkeit aus Legende beibehalten
      DATA.sectors.forEach((s, i) => {
        if (hidden[s.id]) perfChart.setDatasetVisibility(i, false);
      });
      perfChart.update();
      renderRanking();
    });
  }

  /* ---------- Init ---------- */
  window.initSektor = async function () {
    const loading = document.getElementById('sekLoading');
    try {
      loading.classList.add('show');
      await loadData();

      document.getElementById('sekUpdated').textContent = 'Aktualisiert: ' + (DATA.updated || '—');

      if (!initialized) {
        wireRanges();
        initialized = true;
      }
      renderPerfChart();
      renderLegend();
      renderRanking();
      renderAnalystChart();
      renderStockTable();
    } catch (err) {
      console.error(err);
      document.getElementById('sekUpdated').textContent = 'Daten konnten nicht geladen werden';
    } finally {
      loading.classList.remove('show');
      // Charts nach Layout neu vermessen (Grid-Höhe steht erst jetzt)
      setTimeout(() => { if (perfChart) perfChart.resize(); if (analystChart) analystChart.resize(); }, 60);
    }
  };
})();
