/* ===== TrendScope · Faktor-Analyse ===== */
(function () {
  let HIST = null, SECT = null, REG = null, chart = null;
  const FW = [['perf1m', '1M'], ['perf3m', '3M'], ['perf6m', '6M'], ['perf1j', '1J']];
  const filt = {};

  async function load() {
    if (HIST) return;
    const [h, d] = await Promise.all([
      fetch('history.json?v=' + Date.now()).then(r => r.ok ? r.json() : { entries: {} }).catch(() => ({ entries: {} })),
      fetch('sectordata.json?v=' + Date.now()).then(r => r.json()).catch(() => ({})),
    ]);
    HIST = Object.values(h.entries || {});
    SECT = d.sectors || []; REG = d.regions || [];
    HIST._kiObj = h;   // enthält kiAnalysis (Text) + findings
  }
  const secName = id => (SECT.find(s => s.id === id) || {}).name || id;
  const regName = id => (REG.find(s => s.id === id) || {}).name || id;
  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

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

  /* ---------- Balkendiagramm: Ø-Performance je Zeitfenster ---------- */
  function render() {
    const matched = HIST.filter(passes);
    document.getElementById('anaCount').textContent = matched.length + ' / ' + HIST.length + ' Aktien';
    document.getElementById('anaMatch').textContent = matched.length
      ? matched.length + ' Aktien im Filter' + (matched.some(s => s.fake) ? ' (enthält Demo-Daten, bis echte vorliegen)' : '')
      : 'Keine Aktien im aktuellen Filter.';

    const labels = FW.map(f => f[1]);
    const values = FW.map(([key]) => {
      const v = avg(matched.map(s => s[key]).filter(x => x != null));
      return v != null ? +v.toFixed(2) : null;
    });
    const colors = values.map(v => v == null ? 'rgba(148,163,184,0.3)' : v >= 0 ? '#34d399' : '#f87171');

    const ctx = document.getElementById('anaChart');
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ data: values.map(v => v ?? 0), backgroundColor: colors, borderRadius: 7, maxBarThickness: 70 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 500 },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => '  Ø ' + (values[c.dataIndex] == null ? 'keine Daten' : (values[c.dataIndex] > 0 ? '+' : '') + values[c.dataIndex] + '%') } },
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: '#cbd5e1', font: { size: 13, weight: '700' } } },
          y: { grid: { color: 'rgba(148,163,184,0.14)', drawTicks: false }, border: { display: false }, ticks: { color: '#94a3b8', callback: v => v + '%', font: { size: 11 } } },
        },
      },
      plugins: [valueLabels(values)],
    });
    renderFactors();
  }

  // Wertlabels über/unter den Balken
  function valueLabels(values) {
    return {
      id: 'anaVals',
      afterDatasetsDraw(c) {
        const { ctx } = c; const meta = c.getDatasetMeta(0);
        ctx.save(); ctx.font = '700 12px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
        meta.data.forEach((bar, i) => {
          const v = values[i];
          ctx.fillStyle = v == null ? '#6b769a' : v >= 0 ? '#34d399' : '#f87171';
          const txt = v == null ? '—' : (v > 0 ? '+' : '') + v + '%';
          ctx.fillText(txt, bar.x, bar.y + (v >= 0 ? -8 : 16));
        });
        ctx.restore();
      },
    };
  }

  /* ---------- Faktor-Wichtigkeit ----------
     Für jeden Faktor: teile die (gefilterten) Aktien in Stufen, berechne je Stufe die
     Ø-6M-Performance; die SPANNWEITE zwischen bester und schlechtester Stufe = Wichtigkeit.
     Großer Unterschied -> Faktor trennt gut. Kein Unterschied -> schwacher Indikator.   */
  function renderFactors() {
    const el = document.getElementById('anaFactors');
    const data = HIST.filter(passes);
    const perfKey = 'perf6m';
    const buckets = {
      'KGV': s => s.pe == null ? null : s.pe < 15 ? '<15' : s.pe < 25 ? '15–25' : s.pe < 40 ? '25–40' : '40+',
      'Outperform': s => s.outperformPct == null ? null : s.outperformPct < 70 ? '<70%' : s.outperformPct < 85 ? '70–85%' : s.outperformPct < 95 ? '85–95%' : '95%+',
      'Kursziel': s => s.upside == null ? null : s.upside < 10 ? '<10%' : s.upside < 25 ? '10–25%' : s.upside < 40 ? '25–40%' : '40%+',
      'Dividende': s => s.div == null ? null : s.div === 0 ? 'keine' : s.div < 2 ? '<2%' : s.div < 4 ? '2–4%' : '4%+',
      'Analysten': s => s.analysts == null ? null : s.analysts < 5 ? '1–4' : s.analysts < 15 ? '5–14' : '15+',
      'Sektor': s => s.sector || null,
      'Region': s => s.region || null,
    };
    const rows = [];
    for (const [name, fn] of Object.entries(buckets)) {
      const groups = {};
      data.forEach(s => { const k = fn(s); const p = s[perfKey]; if (k != null && p != null) (groups[k] = groups[k] || []).push(p); });
      const stages = Object.entries(groups).filter(([, a]) => a.length >= 2).map(([k, a]) => ({ k, avg: avg(a), n: a.length }));
      if (stages.length < 2) continue;
      stages.sort((a, b) => b.avg - a.avg);
      const spread = stages[0].avg - stages[stages.length - 1].avg;   // Wichtigkeit
      rows.push({ name, spread, best: stages[0], worst: stages[stages.length - 1] });
    }
    rows.sort((a, b) => b.spread - a.spread);
    const maxSpread = rows.length ? Math.max(...rows.map(r => r.spread), 1) : 1;

    el.innerHTML = '';
    if (!rows.length) { el.innerHTML = '<div class="sek-stocks-empty">Noch zu wenige Daten für die Faktor-Analyse.</div>'; return; }
    rows.forEach(r => {
      const row = document.createElement('div');
      row.className = 'ana-factor';
      const bestLabel = r.name === 'Sektor' ? secName(r.best.k) : r.name === 'Region' ? regName(r.best.k) : r.best.k;
      row.innerHTML =
        '<div class="ana-factor-top"><span class="ana-factor-name">' + r.name + '</span>' +
        '<span class="ana-factor-spread">Δ ' + r.spread.toFixed(1) + '%</span></div>' +
        '<div class="ana-factor-bar"><span style="width:' + Math.round((r.spread / maxSpread) * 100) + '%"></span></div>' +
        '<div class="ana-factor-best">am besten: <b>' + bestLabel + '</b> (Ø ' + (r.best.avg > 0 ? '+' : '') + r.best.avg.toFixed(1) + '%)</div>';
      el.appendChild(row);
    });
  }

  /* ---------- KI-Analyse-Text ---------- */
  function renderKi() {
    const el = document.getElementById('anaKi');
    const txt = (HIST._kiObj && HIST._kiObj.kiAnalysis && HIST._kiObj.kiAnalysis.text) || null;
    el.textContent = txt || 'Sobald genügend echte Performance-Daten vorliegen, steht hier eine KI-Analyse der stärksten Faktor-Kombinationen. (Aktuell laufen die Daten auf — Demo-Werte überbrücken die Zeit.)';
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
  }

  window.initAnalyse = async function () {
    const loading = document.getElementById('anaLoading');
    try {
      loading.classList.add('show');
      await load();
      if (!wired) {
        fillSelect('afSector', SECT, secName);
        fillSelect('afRegion', REG, regName);
        wire(); wired = true;
      }
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
