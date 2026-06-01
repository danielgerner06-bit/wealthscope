// Finnhub-Anbindung: Sektor-Performance (ETFs) + rollierender Analysten-Scan.
import { SECTORS, sectorForFinnhub } from './sectors.mjs';

const BASE = 'https://finnhub.io/api/v1';

// Einfache Ratenbegrenzung: Free-Tier erlaubt 60 Calls/Min -> ~1.05s Abstand.
const MIN_GAP_MS = Number(process.env.FINNHUB_GAP_MS || 1100);
let lastCall = 0;
async function throttle() {
  const wait = lastCall + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCall = Date.now();
}

async function fh(path, key) {
  await throttle();
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}token=${key}`;
  const res = await fetch(url);
  if (res.status === 429) { // Rate-Limit: kurz warten, einmal erneut
    await new Promise(r => setTimeout(r, 2000));
    return fh(path, key);
  }
  if (!res.ok) throw new Error('Finnhub HTTP ' + res.status + ' (' + path.split('?')[0] + ')');
  return res.json();
}

/* ---------- Sektor-Performance (30 Tage) über Sektor-ETFs ---------- */
export async function fetchSectorPerformance(key) {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 40 * 24 * 3600; // ~40 Tage Puffer für 30 Handelstage
  const out = [];
  for (const s of SECTORS) {
    try {
      // /quote liefert aktuellen Kurs (c) und Vortagesschluss; für 30T brauchen wir Kerzen.
      const candle = await fh(`/stock/candle?symbol=${s.etf}&resolution=D&from=${from}&to=${to}`, key);
      if (candle.s === 'ok' && Array.isArray(candle.c) && candle.c.length > 1) {
        const close = candle.c;
        const last = close[close.length - 1];
        // 30 Kalendertage ~ 21 Handelstage zurück
        const refIdx = Math.max(0, close.length - 22);
        const ref = close[refIdx];
        out.push({ id: s.id, perf: +(((last - ref) / ref) * 100).toFixed(2) });
      } else {
        out.push({ id: s.id, perf: 0 });
      }
    } catch (e) {
      out.push({ id: s.id, perf: 0 });
    }
  }
  return out;
}

/* ---------- Aktien-Universum (US-Common-Stocks) ---------- */
async function loadUniverse(key) {
  const syms = await fh('/stock/symbol?exchange=US', key);
  return (Array.isArray(syms) ? syms : [])
    .filter(x => x.type === 'Common Stock' && x.symbol && /^[A-Z.]{1,6}$/.test(x.symbol))
    .map(x => x.symbol)
    .sort();
}

/* ---------- Rollierender Analysten-Scan ----------
   Prüft je Lauf bis zu `budget` Symbole ab dem letzten Cursor. Für jedes Symbol:
   - recommendation trends -> Kauf-% und (als Outperform-Näherung) Strong-Buy-Anteil
   - Treffer = Kauf >= 95% UND Outperform >= 80%; nur die kommen in die DB.
   Bekannte Treffer werden re-validiert; fallen sie durch, werden sie entfernt.    */
export async function scanAnalystStocks(key, state, budget) {
  let universe = state._universe;
  if (!universe || state.scan.universe === 0) {
    universe = await loadUniverse(key);
    state.scan.universe = universe.length;
  }
  const n = universe.length;
  let cursor = state.scan.lastCursor % (n || 1);

  const checked = [];
  let used = 0;
  while (used < budget && used < n) {
    const sym = universe[cursor];
    cursor = (cursor + 1) % n;
    used++;
    try {
      const rec = await fh(`/stock/recommendation?symbol=${sym}`, key);
      if (Array.isArray(rec) && rec.length) {
        const r = rec[0]; // neueste Periode
        const total = (r.strongBuy || 0) + (r.buy || 0) + (r.hold || 0) + (r.sell || 0) + (r.strongSell || 0);
        if (total > 0) {
          const buyPct = Math.round(((r.strongBuy + r.buy) / total) * 100);
          const outperformPct = Math.round((r.strongBuy / total) * 100);
          if (buyPct >= 95 && outperformPct >= 80) {
            checked.push({ ticker: sym, buyPct, outperformPct, analysts: total });
          } else {
            delete state.db[sym]; // war evtl. mal Treffer -> jetzt nicht mehr
          }
        }
      }
    } catch { /* einzelne Symbole überspringen */ }
  }

  // Treffer mit Profil (Name, Sektor) und Kursziel anreichern.
  for (const hit of checked) {
    try {
      const prof = await fh(`/stock/profile2?symbol=${hit.ticker}`, key);
      const sector = sectorForFinnhub(prof.finnhubIndustry);
      if (!sector) { continue; } // ohne klaren Sektor nicht aufnehmen
      let upside = null;
      try {
        const pt = await fh(`/stock/price-target?symbol=${hit.ticker}`, key);
        const q = await fh(`/quote?symbol=${hit.ticker}`, key);
        if (pt.targetMean && q.c) upside = Math.round(((pt.targetMean - q.c) / q.c) * 100);
      } catch { /* Kursziel optional */ }
      state.db[hit.ticker] = {
        ...state.db[hit.ticker],
        ticker: hit.ticker,
        name: prof.name || hit.ticker,
        sector,
        buyPct: hit.buyPct,
        outperformPct: hit.outperformPct,
        analysts: hit.analysts,
        upside: upside != null ? upside : (state.db[hit.ticker]?.upside ?? null),
        via: 'finnhub', source: 'Finnhub',
        seen: new Date().toISOString().slice(0, 10),
      };
    } catch { /* Profil-Fehler ignorieren */ }
  }

  state.scan.lastCursor = cursor;
  state.scan.scanned = Math.min(state.scan.scanned + used, n);

  // Top-Liste: nach Kursziel-Potenzial, dann Kauf-%, begrenzt auf 40 Einträge.
  const topStocks = Object.values(state.db)
    .sort((a, b) => (b.upside ?? -999) - (a.upside ?? -999) || b.buyPct - a.buyPct)
    .slice(0, 40);

  return { topStocks, scan: state.scan };
}
