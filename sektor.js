/* ===== SektorScope ===== */
(function () {
  let DATA = null;
  let barChart = null;
  let sectorFilter = null;   // aktiver Sektor-Filter für die Aktienliste (null = alle)

  function sectorById(id) { return (DATA.sectors || []).find(s => s.id === id) || { name: id, color: '#94a3b8' }; }

  async function loadData() {
    if (DATA) return DATA;
    const res = await fetch('sectordata.json?v=' + Date.now());
    if (!res.ok) throw new Error('sectordata.json nicht gefunden');
    DATA = await res.json();
    return DATA;
  }

  function fmtPct(v, dp = 1) {
    const n = Number(v) || 0;
    return (n > 0 ? '+' : '') + n.toFixed(dp) + '%';
  }

  /* ---------- Balkendiagramm: 30-Tage-Performance, gerankt ---------- */
  function renderBars() {
    const rows = [...(DATA.bars30 || [])].sort((a, b) => b.perf - a.perf);
    const labels = rows.map(r => sectorById(r.id).name);
    const values = rows.map(r => +Number(r.perf).toFixed(2));
    const colors = rows.map(r => {
      const base = sectorById(r.id).color;
      return r.perf >= 0 ? base : mix(base, '#ef4444', 0.45);
    });

    const ctx = document.getElementById('sekBars');
    if (barChart) barChart.destroy();

    barChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors.map(c => c),
          borderRadius: 7,
          borderSkipped: false,
          barThickness: 'flex',
          maxBarThickness: 26,
          categoryPercentage: 0.82,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 700, easing: 'easeOutCubic' },
        onClick: (e, els) => {
          if (!els.length) { setSectorFilter(null); return; }
          const id = rows[els[0].index].id;
          setSectorFilter(sectorFilter === id ? null : id);
        },
        onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(17,21,40,0.96)', borderColor: 'rgba(148,163,184,0.25)', borderWidth: 1,
            titleColor: '#fff', bodyColor: '#cbd5e1', padding: 11, cornerRadius: 10,
            callbacks: {
              label: c => '  30-Tage: ' + fmtPct(c.parsed.x) + '  ·  Klick = filtern',
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(148,163,184,0.14)', drawTicks: false },
            border: { display: false },
            ticks: { color: '#94a3b8', callback: v => (v > 0 ? '+' : '') + v + '%', font: { size: 11 } },
          },
          y: {
            grid: { display: false },
            border: { display: false },
            ticks: { color: '#e2e8f0', font: { size: 12, weight: '600' }, crossAlign: 'far', padding: 6 },
          },
        },
      },
      plugins: [zeroBarLine, valueLabels],
    });
  }

  // Nulllinie betonen
  const zeroBarLine = {
    id: 'zeroBarLine',
    afterDraw(chart) {
      const x = chart.scales.x; if (!x) return;
      const xPos = x.getPixelForValue(0);
      const { ctx, chartArea } = chart;
      ctx.save();
      ctx.beginPath(); ctx.moveTo(xPos, chartArea.top); ctx.lineTo(xPos, chartArea.bottom);
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(148,163,184,0.5)'; ctx.setLineDash([3, 3]); ctx.stroke();
      ctx.restore();
    },
  };

  // Wert am Balkenende
  const valueLabels = {
    id: 'valueLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(0);
      const data = chart.data.datasets[0].data;
      ctx.save();
      ctx.font = '700 11px Inter, system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      meta.data.forEach((bar, i) => {
        const v = data[i];
        const pos = v >= 0;
        ctx.fillStyle = pos ? '#34d399' : '#f87171';
        ctx.textAlign = pos ? 'left' : 'right';
        const pad = pos ? 8 : -8;
        ctx.fillText(fmtPct(v), bar.x + pad, bar.y);
      });
      ctx.restore();
    },
  };

  /* ---------- Analystenliste ---------- */
  function renderStocks() {
    const list = document.getElementById('sekStockList');
    const countEl = document.getElementById('sekStockCount');
    let stocks = Array.isArray(DATA.topStocks) ? DATA.topStocks.slice() : [];
    if (sectorFilter) stocks = stocks.filter(s => s.sector === sectorFilter);
    stocks.sort((a, b) => (b.upside || 0) - (a.upside || 0));

    countEl.textContent = sectorFilter
      ? sectorById(sectorFilter).name + ' · ' + stocks.length
      : (DATA.topStocks ? DATA.topStocks.length + ' Treffer' : '');

    list.innerHTML = '';
    if (!stocks.length) {
      list.innerHTML = '<div class="sek-stocks-empty">Keine Treffer' + (sectorFilter ? ' in diesem Sektor.' : '.') + '</div>';
      return;
    }
    stocks.forEach(st => {
      const sec = sectorById(st.sector);
      const row = document.createElement('div');
      row.className = 'sek-stock';
      const up = (st.upside != null) ? '<span class="sek-stock-up">+' + Number(st.upside).toFixed(0) + '%</span>' : '';
      const meta = [];
      if (st.buyPct != null) meta.push('Kauf ' + st.buyPct + '%');
      if (st.outperformPct != null) meta.push('Outperf. ' + st.outperformPct + '%');
      if (st.analysts != null) meta.push(st.analysts + ' Analyst' + (st.analysts === 1 ? '' : 'en'));
      row.innerHTML =
        '<span class="sek-stock-dot" style="background:' + sec.color + '"></span>' +
        '<div class="sek-stock-main">' +
          '<div class="sek-stock-top"><span class="sek-stock-tk">' + (st.ticker || '') + '</span>' +
          '<span class="sek-stock-nm">' + (st.name || '') + '</span></div>' +
          '<div class="sek-stock-meta">' + sec.name + (meta.length ? ' · ' + meta.join(' · ') : '') + '</div>' +
        '</div>' + up;
      list.appendChild(row);
    });
  }

  function setSectorFilter(id) {
    sectorFilter = id;
    renderStocks();
  }

  /* ---------- Insight-Text ---------- */
  function renderInsight() {
    const el = document.getElementById('sekInsight');
    el.textContent = DATA.insight || '—';
  }

  /* ---------- kleine Farbhilfe ---------- */
  function mix(hex, hex2, t) {
    const a = h2rgb(hex), b = h2rgb(hex2);
    const r = Math.round(a[0] + (b[0] - a[0]) * t);
    const g = Math.round(a[1] + (b[1] - a[1]) * t);
    const bl = Math.round(a[2] + (b[2] - a[2]) * t);
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }
  function h2rgb(h) {
    h = h.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  /* ---------- Init ---------- */
  window.initSektor = async function () {
    const loading = document.getElementById('sekLoading');
    try {
      loading.classList.add('show');
      await loadData();

      const stand = DATA.updated || '—';
      document.getElementById('sekUpdated').textContent =
        (DATA.isPlaceholder ? 'Demo-Daten · ' : 'Stand: ') + stand;

      sectorFilter = null;
      renderBars();
      renderStocks();
      renderInsight();
    } catch (err) {
      console.error(err);
      document.getElementById('sekUpdated').textContent = 'Daten konnten nicht geladen werden';
    } finally {
      loading.classList.remove('show');
      setTimeout(() => { if (barChart) barChart.resize(); }, 60);
    }
  };
})();
