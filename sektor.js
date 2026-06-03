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
        // Klick auf einen Balken filtert die Perlen nach diesem Sektor (nur Sektoransicht)
        onClick: (e, els) => {
          if (view !== 'sectors' || !els.length) return;
          const id = barRows[els[0].index]?.id;
          if (!id) return;
          sectorFilter = (sectorFilter === id) ? null : id;
          renderStocks();
        },
        onHover: (e, els) => { if (e.native?.target) e.native.target.style.cursor = (view === 'sectors' && els.length) ? 'pointer' : 'default'; },
        onResize: () => requestAnimationFrame(positionBarNames),
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
      plugins: [zeroBarLine, valueLabels, {
        id: 'syncNames',
        afterRender: () => positionBarNames(),  // nach jedem Frame Namen auf Balkenhöhe halten
      }],
    });
  }

  // Sektornamen als klickbare Labels — absolut auf die exakte Balkenhöhe gesetzt
  // (aus Chart.js ausgelesen), damit Name und Balken immer auf einer Linie liegen.
  function renderBarNames() {
    const wrap = document.getElementById('sekBarsNames');
    wrap.innerHTML = '';
    wrap.style.position = 'relative';
    barRows.forEach((r, i) => {
      const sec = itemById(r.id);
      const b = document.createElement('button');
      b.className = 'sek-bar-name';
      b.dataset.idx = i;
      b.innerHTML = '<i style="background:' + sec.color + '"></i><span>' + sec.name + '</span>';
      b.addEventListener('click', () => openSectorModal(r.id));
      wrap.appendChild(b);
    });
    positionBarNames();
  }

  // Liest die y-Mittelpunkte der Balken aus Chart.js und positioniert die Namen darauf.
  function positionBarNames() {
    if (!barChart) return;
    const wrap = document.getElementById('sekBarsNames');
    const meta = barChart.getDatasetMeta(barChart.data.datasets.length - 1);
    const chartTop = barChart.canvas.getBoundingClientRect().top;
    const wrapTop = wrap.getBoundingClientRect().top;
    const offset = chartTop - wrapTop; // Canvas kann minimal versetzt zum Namen-Container sein
    [...wrap.children].forEach((el, i) => {
      const bar = meta.data[i];
      if (!bar) return;
      el.style.position = 'absolute';
      el.style.left = '0'; el.style.right = '0';
      el.style.top = (offset + bar.y) + 'px';
      el.style.transform = 'translateY(-50%)';
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
  const filters = { pe: null, perf6m: null, perf1mBefore: null, outperformPct: null, upside: null, analysts: null, div: null };
  let sectorFilter = null;   // aktiver Sektor-Filter (Klick auf Balken)
  let rankSort = { key: 'anteil', dir: -1 };   // Sortierung im Sektor-Ranking-Popup

  // nur die Wert-Filter (KGV/6M/Outperform/Ziel/Analysten), OHNE Sektor-Filter
  function passesValueFilter(s) {
    // KGV: Eingabe 0 => nur Aktien OHNE KGV (unprofitabel); sonst KGV höchstens.
    if (filters.pe != null) {
      if (filters.pe === 0) { if (s.pe != null) return false; }
      else if (!(s.pe != null && s.pe <= filters.pe)) return false;
    }
    // 6M HÖCHSTENS (Aktien, die noch nicht durch die Decke sind); Outperform & Ziel mindestens.
    if (filters.perf6m != null && !(s.perf6m != null && s.perf6m <= filters.perf6m)) return false;
    // 1M-vor-Aufnahme HÖCHSTENS (Momentum-Filter: nicht schon vorher explodiert)
    if (filters.perf1mBefore != null && !(s.perf1mBefore != null && s.perf1mBefore <= filters.perf1mBefore)) return false;
    if (filters.outperformPct != null && !(s.outperformPct != null && s.outperformPct >= filters.outperformPct)) return false;
    if (filters.upside != null && !(s.upside != null && s.upside >= filters.upside)) return false;
    if (filters.analysts != null && !(s.analysts != null && s.analysts >= filters.analysts)) return false;
    if (filters.div != null && !(s.div != null && s.div >= filters.div)) return false;
    return true;
  }
  function passesFilter(s) {
    if (!passesValueFilter(s)) return false;
    if (sectorFilter && s.sector !== sectorFilter) return false;
    return true;
  }

  function renderStocks() {
    const list = document.getElementById('sekStockList');
    const countEl = document.getElementById('sekStockCount');
    const all = Array.isArray(DATA.topStocks) ? DATA.topStocks.slice() : [];
    const stocks = all.filter(passesFilter).sort(cmp);
    // Ranking-Popup mitziehen, falls offen (soll nur gefilterte Perlen zeigen)
    if (!document.getElementById('sekRankPop').hidden) renderRankPop();
    const anyFilter = sectorFilter || Object.values(filters).some(v => v != null);
    countEl.textContent = sectorFilter
      ? sectorById(sectorFilter).name + ' · ' + stocks.length
      : (anyFilter ? stocks.length + ' / ' + all.length : all.length + ' Treffer');

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
      if (st.outperformPct != null) meta.push('S.Buy ' + st.outperformPct + '%');
      if (st.analysts != null) meta.push(st.analysts + ' Analyst' + (st.analysts === 1 ? '' : 'en'));
      if (st.div != null && st.div > 0) meta.push('Div ' + st.div + '%');
      row.innerHTML =
        '<span class="sek-stock-dot" style="background:' + sec.color + '"></span>' +
        '<div class="sek-stock-main">' +
          '<div class="sek-stock-top"><span class="sek-stock-tk">' + (st.ticker || '') + '</span>' +
          '<span class="sek-stock-nm">' + (st.name || '') + '</span></div>' +
          '<div class="sek-stock-meta">' + sec.name + (meta.length ? ' · ' + meta.join(' · ') : '') + '</div>' +
        '</div>' + metric;
      row.addEventListener('click', () => openStockModal(st));   // Klick -> Detail-Feld mit allen Daten
      list.appendChild(row);
    });
  }

  /* ---------- Aktien-Detail-Modal: alle Daten einer Perle ---------- */
  function openStockModal(st) {
    const sec = sectorById(st.sector);
    document.getElementById('stkModalTk').textContent = st.ticker || '';
    document.getElementById('stkModalNm').textContent = st.name || '';
    document.getElementById('stkModalDot').style.background = sec.color;
    const pct = v => v == null ? '–' : fmtPct(v);
    const seenStr = st.seen ? st.seen.split('-').reverse().join('.') : '–';
    // Bewertung 0..1 (0=schlecht/rot, 1=gut/grün); null = neutral. KGV invers (niedrig=gut).
    const sc = (v, lo, hi) => v == null ? null : Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
    const scInv = (v, lo, hi) => v == null ? null : 1 - Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
    const hsl = s => s == null ? '#cbd5e1' : 'hsl(' + Math.round(s * 130) + ',78%,60%)';

    // Kopf-Badges: Sektor + Region + Quelle der Ratings
    const region = regionName(st.region || regionOfSym(st.yahoo || st.ticker));
    document.getElementById('stkModalBadges').innerHTML =
      '<span class="stk-badge" style="border-color:' + sec.color + '55;color:' + sec.color + '">' + sec.name + '</span>' +
      '<span class="stk-badge">' + region + '</span>' +
      '<span class="stk-badge stk-badge-src">' + ratingSrcLabel(st) + '</span>';

    // 3 große Highlight-Kacheln (die wichtigsten Zahlen, ring-gefärbt)
    const hero = [
      { lbl: 'Kursziel-Potenzial', val: pct(st.upside), s: sc(st.upside, 0, 50) },
      { lbl: 'Kaufempfehlung', val: st.buyPct == null ? '–' : st.buyPct + '%', s: sc(st.buyPct, 50, 100) },
      { lbl: 'Strong Buy', val: st.outperformPct == null ? '–' : st.outperformPct + '%', s: sc(st.outperformPct, 0, 100) },
    ];
    document.getElementById('stkModalHero').innerHTML = hero.map(h =>
      '<div class="stk-hero" style="--c:' + hsl(h.s) + '">' +
        '<div class="stk-hero-val">' + h.val + '</div>' +
        '<div class="stk-hero-lbl">' + h.lbl + '</div>' +
      '</div>').join('');

    // kompakte Stat-Kacheln im Grid (kein Scrollen, alles auf einen Blick)
    const stats = [
      { lbl: 'Analysten', val: st.analysts == null ? '–' : String(st.analysts), s: sc(st.analysts, 1, 20) },
      { lbl: 'KGV', val: st.pe == null ? '–' : String(st.pe), s: scInv(st.pe, 10, 50) },
      { lbl: 'Dividende', val: st.div == null ? '–' : st.div + '%', s: sc(st.div, 0, 5) },
      { lbl: '6 Monate', val: pct(st.perf6m), s: sc(st.perf6m, -20, 30) },
      { lbl: '1M vor Aufn.', val: pct(st.perf1mBefore), s: sc(st.perf1mBefore, -20, 30) },
      { lbl: 'Gefunden', val: seenStr, s: null },
    ];
    document.getElementById('stkModalStats').innerHTML = stats.map(t =>
      '<div class="stk-stat"><div class="stk-stat-val" style="color:' + hsl(t.s) + '">' + t.val + '</div>' +
      '<div class="stk-stat-lbl">' + t.lbl + '</div></div>').join('');

    // rohe Analysten-Verteilung (volle Transparenz, MarketScreener-Stufen).
    // Nur das aktuelle MS-Format (buy/outperform) anzeigen; altes Format (strongBuy) ignorieren.
    const rc = st.ratingCounts;
    const cntsEl = document.getElementById('stkModalCounts');
    if (rc && !('strongBuy' in rc) && (rc.buy || rc.outperform || rc.hold || rc.underperform || rc.sell)) {
      const parts = [];
      if (rc.buy) parts.push('<b style="color:#34d399">' + rc.buy + '</b> Buy');
      if (rc.outperform) parts.push('<b style="color:#86efac">' + rc.outperform + '</b> Outperform');
      if (rc.hold) parts.push('<b style="color:#fbbf24">' + rc.hold + '</b> Hold');
      if (rc.underperform) parts.push('<b style="color:#fb923c">' + rc.underperform + '</b> Underperform');
      if (rc.sell) parts.push('<b style="color:#f87171">' + rc.sell + '</b> Sell');
      cntsEl.innerHTML = 'Analysten: ' + parts.join(' · ');
      cntsEl.hidden = false;
    } else { cntsEl.hidden = true; }

    // Nachschau-Links: extern auf Analysten-Seiten zum Selber-Prüfen
    document.getElementById('stkModalLinks').innerHTML =
      verifyLinks(st).map(l => '<a class="stk-link" href="' + l.url + '" target="_blank" rel="noopener">' + l.name + ' ↗</a>').join('');

    // Lösch-Leiste (nur mit Admin-Passwort): Aktie löschen & 3 Monate sperren
    renderDeleteBar(st);

    const m = document.getElementById('stkModal');
    m.hidden = false;
    requestAnimationFrame(() => m.classList.add('show'));   // Einblend-Animation
  }

  // MarketScreener-Direktlink (von Gemini hinterlegt) — genau diese Aktie, eindeutig.
  // Fällt zurück auf die MarketScreener-Suche, wenn (noch) keine Direkt-URL da ist.
  function verifyLinks(st) {
    const url = st.msUrl
      ? { name: 'MarketScreener öffnen', url: st.msUrl }
      : { name: 'Auf MarketScreener suchen', url: 'https://www.marketscreener.com/search/?q=' + encodeURIComponent(st.name || st.ticker || '') };
    return [url];
  }
  function closeStockModal() { const m = document.getElementById('stkModal'); m.classList.remove('show'); setTimeout(() => { m.hidden = true; }, 200); }

  /* ---------- Admin-Modus (Session) + Aktie löschen + 3 Monate sperren ---------- */
  // adminKey nur in dieser Session (NICHT localStorage) -> bei Reload wieder aus.
  let adminKey = null;
  const DELETE_ENDPOINT = 'https://wealthscope-yahoo.daniel-gerner06.workers.dev/blacklist';

  // zentraler Login-Button im Header: an = Admin-Modus, aus = normal
  function wireAdminBtn() {
    const btn = document.getElementById('sekAdminBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (adminKey) { adminKey = null; btn.classList.remove('on'); btn.title = 'Admin-Login (Aktien löschen)'; return; }
      const k = prompt('Admin-Passwort:');
      if (k) { adminKey = k; btn.classList.add('on'); btn.title = 'Admin-Modus aktiv – klicken zum Abmelden'; }
    });
  }

  // Lösch-Leiste im Popup: nur im Admin-Modus sichtbar, sonst leer.
  function renderDeleteBar(st) {
    const el = document.getElementById('stkModalVerify');
    if (adminKey) {
      el.innerHTML = '<button class="stk-del" id="stkDelBtn">🗑 Aktie löschen & 3 Monate sperren</button>';
      document.getElementById('stkDelBtn').onclick = () => deleteStock(st, el);
    } else {
      el.innerHTML = '';
    }
  }

  async function deleteStock(st, el) {
    if (!confirm('"' + (st.name || st.ticker) + '" löschen? Wird 3 Monate nicht mehr aufgenommen.')) return;
    const btn = document.getElementById('stkDelBtn'); if (btn) { btn.disabled = true; btn.textContent = 'lösche…'; }
    try {
      const res = await fetch(DELETE_ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: adminKey, ticker: st.ticker }),
      });
      if (res.status === 401) { alert('Falsches Admin-Passwort.'); adminKey = null; const ab = document.getElementById('sekAdminBtn'); if (ab) ab.classList.remove('on'); renderDeleteBar(st); return; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      // lokal sofort entfernen (Repo zieht beim nächsten Lauf nach)
      DATA.topStocks = (DATA.topStocks || []).filter(s => s.ticker !== st.ticker);
      closeStockModal();
      renderStocks();
    } catch (e) {
      alert('Löschen fehlgeschlagen: ' + e.message);
      if (btn) { btn.disabled = false; btn.textContent = '🗑 Aktie löschen & 3 Monate sperren'; }
    }
  }
  function regionName(id) { return ({ usa: 'USA', europe: 'Europa', germany: 'Deutschland', japan: 'Japan', china: 'China', em: 'Schwellenländer', apac: 'Asien-Pazifik', india: 'Indien', latam: 'Lateinamerika', world: 'Welt' }[id]) || id || '–'; }
  // Region aus dem Yahoo-Börsensuffix ableiten (US = ohne Suffix), wenn kein region-Feld da ist
  function regionOfSym(sym) {
    if (!sym) return null;
    const suf = sym.includes('.') ? sym.split('.').pop() : '';
    const map = { DE: 'germany', PA: 'europe', AS: 'europe', MI: 'europe', L: 'europe', SW: 'europe', ST: 'europe', HE: 'europe', BR: 'europe', VI: 'europe', MC: 'europe', T: 'japan', HK: 'china', SS: 'china', SZ: 'china', KS: 'apac', TW: 'apac', NS: 'india', BO: 'india', AX: 'apac', SA: 'latam', MX: 'latam' };
    return suf ? (map[suf] || 'world') : 'usa';
  }
  function viaLabel(v) { if (!v) return '–'; if (v.startsWith('gemini')) return 'KI-Websuche (Gemini)'; if (v === 'finnhub') return 'Finnhub (US-Analysten)'; return v; }
  // Herkunft der Rating-Zahlen: FMP/Finnhub = exakte Counts, Gemini = Websuche-Schätzung
  function ratingSrcLabel(st) {
    if (st.ratingSrc === 'twelvedata') return '✓ exakte Daten (Twelve Data)';
    if (st.ratingSrc === 'fmp') return '✓ exakte Daten (FMP)';
    if (st.via === 'finnhub') return '✓ exakte Daten (Finnhub)';
    return '≈ Websuche-Schätzung';
  }
  function wireStockModal() {
    const m = document.getElementById('stkModal');
    m.addEventListener('click', e => { if (e.target.closest('[data-close]') || e.target === m || e.target.classList.contains('sek-modal-backdrop')) closeStockModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !m.hidden) closeStockModal(); });
  }

  /* ---------- Popup: Sektoren gerankt nach Perlen-Anzahl ---------- */
  function renderRankPop() {
    const listEl = document.getElementById('sekRankList');
    // Nur die wert-gefilterten Perlen einbeziehen (KGV/6M/Outperform/Ziel/Analysten),
    // damit das Ranking zum aktiven Filter passt. Sektor-Filter bewusst NICHT anwenden,
    // sonst bliebe nur ein Sektor übrig.
    const all = (Array.isArray(DATA.topStocks) ? DATA.topStocks : []).filter(passesValueFilter);
    const counts = {};
    all.forEach(s => { counts[s.sector] = (counts[s.sector] || 0) + 1; });
    const totalN = all.length || 1;
    const rows = Object.keys(counts).map(id => ({ id, n: counts[id] })).sort((a, b) => b.n - a.n);
    const max = rows.length ? rows[0].n : 1;

    // 30T-Kursperformance je Sektor + Spanne (für relPos / Value-Score)
    const perfMap = {};
    (DATA.bars30 || []).forEach(b => { perfMap[b.id] = b.perf; });
    const perfs = rows.map(r => perfMap[r.id]).filter(v => v != null);
    const perfMin = perfs.length ? Math.min(...perfs) : 0;
    const perfMax = perfs.length ? Math.max(...perfs) : 1;
    const perfSpan = (perfMax - perfMin) || 1;

    // Geprüfte Aktien je Sektor = abgelehnte (Scan) + Perlen (akzeptiert). Die Perle ist selbst
    // ein geprüfter Treffer, daher ist der Nenner nie 0, wenn der Sektor eine Perle hat.
    // evaluatedBySector enthält bereits abgelehnte + Perlen; Fallback (ältere Daten / fehlende
    // Pipeline-Felder): abgelehnte aus seenBySector + die Perlenzahl r.n.
    const evaluated = (DATA.scan && DATA.scan.evaluatedBySector) || null;
    const rejectedMap = (DATA.scan && DATA.scan.seenBySector) || {};

    // je Sektor die drei Kennzahlen berechnen (für Anzeige + Sortierung)
    const items = rows.map(r => {
      const perf = perfMap[r.id];
      const seenTotal = evaluated ? (evaluated[r.id] || r.n) : ((rejectedMap[r.id] || 0) + r.n);
      const anteil = r.n / totalN;
      // Trefferquote = Perlen / geprüfte Aktien des Sektors. Immer berechenbar (Perlen ⊆ geprüfte),
      // auf 100% gedeckelt für den Fall unvollständiger Scan-Buchhaltung.
      const hitRate = Math.min(1, r.n / Math.max(r.n, seenTotal));
      const relPos = perf != null ? Math.max(0.05, (perf - perfMin) / perfSpan) : 1;
      const psi = hitRate / relPos;
      return { id: r.id, n: r.n, anteil, hitRate, psi };
    });

    // nach aktivem Sortierschlüssel sortieren (fehlende Trefferquote ans Ende)
    // Spalten-data-sort -> Item-Feld (Spalte "treffer" liest hitRate)
    const COL2FIELD = { anteil: 'anteil', treffer: 'hitRate', psi: 'psi' };
    const dir = rankSort.dir;
    const key = COL2FIELD[rankSort.key] || rankSort.key;
    items.sort((a, b) => {
      const va = a[key], vb = b[key];
      const ma = (va == null || !isFinite(va)), mb = (vb == null || !isFinite(vb));
      if (ma && mb) return b.anteil - a.anteil;
      if (ma) return 1; if (mb) return -1;
      return dir === -1 ? vb - va : va - vb;
    });

    listEl.innerHTML = '';
    if (!items.length) { listEl.innerHTML = '<div class="sek-stocks-empty">Keine Perlen im aktuellen Filter.</div>'; return; }
    items.forEach(it => {
      const sec = sectorById(it.id);
      const pct = Math.round(it.anteil * 100);
      const hitTxt = it.hitRate != null ? Math.round(it.hitRate * 100) + '%' : '–';
      const scoreTxt = it.psi.toFixed(2).replace('.', ',');
      const barPct = Math.round((it.n / max) * 100);
      const row = document.createElement('button');
      row.className = 'sek-rank-row' + (sectorFilter === it.id ? ' active' : '');
      row.innerHTML =
        '<span class="sek-rank-name">' + sec.name + '</span>' +
        '<span class="sek-rank-n">' + pct + '%</span>' +
        '<span class="sek-rank-hit">' + hitTxt + '</span>' +
        '<span class="sek-rank-perfv">' + scoreTxt + '</span>';
      row.addEventListener('click', () => {
        sectorFilter = (sectorFilter === it.id) ? null : it.id;  // Klick filtert die Liste
        renderStocks();
        toggleRankPop(false);
      });
      listEl.appendChild(row);
    });
    // aktive Sortierspalte markieren
    document.querySelectorAll('#sekRankCols .sortable').forEach(c => {
      const on = c.dataset.sort === rankSort.key;
      c.classList.toggle('active', on);
      c.classList.toggle('asc', on && dir === 1);
      c.classList.toggle('desc', on && dir === -1);
    });
  }
  function toggleRankPop(show) {
    const pop = document.getElementById('sekRankPop');
    const btn = document.getElementById('sekRankBtn');
    const open = show != null ? show : pop.hidden;
    if (open) renderRankPop();
    pop.hidden = !open;
    btn.classList.toggle('active', open);
  }
  function wireRankPop() {
    document.getElementById('sekRankBtn').addEventListener('click', e => { e.stopPropagation(); toggleRankPop(); });
    // Klick außerhalb schließt das Popup
    document.addEventListener('click', e => {
      const pop = document.getElementById('sekRankPop');
      if (!pop.hidden && !e.target.closest('#sekRankPop') && !e.target.closest('#sekRankBtn')) toggleRankPop(false);
    });
    // Spalten-Überschriften: Klick sortiert; erneuter Klick dreht die Richtung
    document.getElementById('sekRankCols').addEventListener('click', e => {
      const col = e.target.closest('.sortable'); if (!col) return;
      const k = col.dataset.sort;
      if (rankSort.key === k) rankSort.dir = -rankSort.dir;
      else { rankSort.key = k; rankSort.dir = -1; }
      renderRankPop();
    });
  }

  // Rechts an der Zeile: der aktuell sortierte Wert, hervorgehoben
  function stockMetric(st) {
    let v, label, cls = 'sek-stock-val';
    if (sortKey === 'perf6m') { v = st.perf6m; label = v != null ? fmtPct(v) : '—'; cls += v >= 0 ? ' up' : ' down'; }
    else if (sortKey === 'perf1mBefore') { v = st.perf1mBefore; label = v != null ? fmtPct(v) : '—'; cls += v >= 0 ? ' up' : ' down'; }
    else if (sortKey === 'outperformPct') { v = st.outperformPct; label = v != null ? v + '%' : '—'; }
    else if (sortKey === 'analysts') { v = st.analysts; label = v != null ? v + ' An.' : '—'; }
    else if (sortKey === 'pe') { v = st.pe; label = v != null ? 'KGV ' + v : 'KGV —'; }
    else if (sortKey === 'div') { v = st.div; label = v != null ? v + '% Div' : '— Div'; }
    // Ziel (Kursziel-Potenzial): Vorzeichen über fmtPct (kein "+-"), Farbe nach Richtung
    else { v = st.upside; label = v != null ? fmtPct(Math.round(v)) : '—'; cls += (v != null && v < 0) ? ' down' : ' up'; }
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
    const map = { fltPe: 'pe', fltPerf6m: 'perf6m', fltPre1m: 'perf1mBefore', fltOutperf: 'outperformPct', fltUpside: 'upside', fltAnalysts: 'analysts', fltDiv: 'div' };
    Object.keys(map).forEach(id => {
      const el = document.getElementById(id);
      // Browser-Autovervollständigung aus -> keine alten Eingaben poppen mehr auf
      el.setAttribute('autocomplete', 'off');
      el.addEventListener('input', e => {
        // erlaubt negative Werte und Komma; ungültige Eingabe -> kein Filter
        const raw = e.target.value.trim().replace(',', '.');
        const num = parseFloat(raw);
        filters[map[id]] = (raw === '' || isNaN(num)) ? null : num;
        renderStocks();
      });
    });
    document.getElementById('fltClear').addEventListener('click', () => {
      Object.keys(map).forEach(id => { document.getElementById(id).value = ''; });
      filters.pe = filters.perf6m = filters.perf1mBefore = filters.outperformPct = filters.upside = filters.analysts = filters.div = null;
      sectorFilter = null;
      renderStocks();
    });
  }

  /* ---------- Lage-Modal (Sektor oder Region) ---------- */
  function openSectorModal(id) {
    const sec = itemById(id);
    const bar = viewBars().find(b => b.id === id) || {};
    // KI-Lagetext je nach Ansicht aus sectorNotes bzw. regionNotes
    const note = (view === 'regions' ? (DATA.regionNotes || {}) : (DATA.sectorNotes || {}))[id];

    document.getElementById('sekModalTitle').textContent = sec.name;
    document.getElementById('sekModalDot').style.background = sec.color;

    const stat = (lbl, val, cls) => '<div class="sek-mstat"><span>' + lbl + '</span><b class="' + (cls || '') + '">' + val + '</b></div>';
    const cl = v => v == null ? '' : (v >= 0 ? 'up' : 'down');
    document.getElementById('sekModalStats').innerHTML =
      stat('30 Tage', bar.perf != null ? fmtPct(bar.perf) : '—', cl(bar.perf)) +
      stat('Ø 30T (360T)', bar.avg30 != null ? fmtPct(bar.avg30) : '—', cl(bar.avg30)) +
      stat('6 Monate', bar.perf6m != null ? fmtPct(bar.perf6m) : '—', cl(bar.perf6m));

    document.querySelector('.sek-modal-insight').style.display = '';
    document.getElementById('sekModalText').textContent = note?.text ||
      'Hier liegt noch kein KI-Text vor — er wird in den nächsten Läufen ergänzt.';
    document.getElementById('sekModalDate').textContent =
      note?.date ? 'Stand: ' + note.date : (note?.seed ? 'Startwert — wird per KI aktualisiert' : '');

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

  /* ---------- News-Ticker ----------
     Nahtloser Endlos-Lauf: eine "Hälfte" muss breiter als der sichtbare Bereich
     sein (sonst entsteht eine Lücke und es wirkt, als stoppe der Ticker). Daher
     den verbundenen Block so oft wiederholen, bis er den Viewport füllt, und
     dann verdoppeln — die CSS-Animation läuft genau um -50%.                     */
  function renderNews() {
    const track = document.getElementById('sekNewsTrack');
    const wrap = document.getElementById('sekNews');
    const viewport = wrap.querySelector('.sek-news-viewport');
    const items = DATA.news?.items || [];
    if (!items.length) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';

    const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    // jede News: farbiger Trenner + fetter Zeitstempel + Schlagzeile
    const itemHTML = it => {
      if (typeof it === 'string') return '<b class="nw-sep">›</b><span class="nw-h">' + esc(it) + '</span>';
      // Sicherheitsnetz: evtl. noch gespeicherte " HH:MM"-Uhrzeit aus dem Datum entfernen
      const stamp = (it.stamp || '').replace(/\s+\d{1,2}:\d{2}$/, '');
      return '<b class="nw-sep">›</b>' + (stamp ? '<b class="nw-t">' + esc(stamp) + '</b>' : '') +
             '<span class="nw-h">' + esc(it.text) + '</span>';
    };
    const unitHTML = items.map(itemHTML).join('');

    track.innerHTML = '<span>' + unitHTML + '</span>';
    requestAnimationFrame(() => {
      const vw = viewport.clientWidth || 400;
      let halfHTML = unitHTML;
      let guard = 0;
      track.innerHTML = '<span>' + halfHTML + '</span>';
      while (track.firstChild.offsetWidth < vw + 60 && guard < 12) {
        halfHTML += unitHTML;
        track.firstChild.innerHTML = halfHTML;
        guard++;
      }
      // zwei identische Hälften -> -50% ist nahtlos
      track.innerHTML = '<span>' + halfHTML + '</span><span aria-hidden="true">' + halfHTML + '</span>';
      const halfW = track.firstChild.offsetWidth || vw;
      track.style.animationDuration = Math.max(18, Math.round(halfW / 70)) + 's';
    });
  }

  /* ---------- Ansicht-Toggle: Sektoren <-> Regionen ---------- */
  function applyViewLabels() {
    const isReg = view === 'regions';
    document.getElementById('sekBarsTitle').textContent =
      (isReg ? 'Regionen-Performance' : 'Sektor-Performance') + ' · 30 Tage';
  }
  function wireViewToggle() {
    document.getElementById('sekViewToggle').addEventListener('click', e => {
      const btn = e.target.closest('button[data-view]');
      if (!btn || btn.dataset.view === view) return;
      view = btn.dataset.view;
      document.querySelectorAll('#sekViewToggle button').forEach(b => b.classList.toggle('active', b === btn));
      if (view === 'regions' && sectorFilter) { sectorFilter = null; renderStocks(); } // Sektorfilter bei Regionansicht lösen
      applyViewLabels();
      renderBars();
    });
  }

  /* ---------- Header: Stand im Format TT.MM.JJ HH:MM ---------- */
  function renderStand() {
    const el = document.getElementById('sekUpdated');
    let txt = 'Stand: ' + (DATA.updated || '—');
    if (DATA.updatedAt) {
      const d = new Date(DATA.updatedAt);
      if (!isNaN(d)) {
        const p = n => String(n).padStart(2, '0');
        txt = 'Stand: ' + p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + String(d.getFullYear()).slice(2) +
              ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
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
      if (!wired) { wireSort(); wireFilter(); wireModal(); wireViewToggle(); wireRankPop(); wireStockModal(); wireAdminBtn(); wired = true; }
      applyViewLabels();
      renderNews();
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
