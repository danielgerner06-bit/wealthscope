// Kursdaten über Yahoo-Finance-Chart-API (kostenlos, kein Key).
//  - Sektor-Performance je ETF: perf30 (aktuell ~30 Handelstage), avg30 (Ø rollierende
//    30T-Returns über ~360 Tage), perf6m (~126 Handelstage).
//  - Einzelaktien-Performance (6 Monate) für die Sortierung der Analysten-Perlen.
//
// Robust gegen Yahoo-Ausreißer: End-/Startkurs = Median über ein kleines Fenster,
// damit ein einzelner fehlerhafter Tageskurs die Prozentwerte nicht verfälscht.
import { SECTORS, REGIONS } from './sectors.mjs';

const W30 = 21;    // ~30 Kalendertage
const W6M = 126;   // ~6 Monate

function median(a) {
  const x = a.filter(v => typeof v === 'number' && isFinite(v)).sort((m, n) => m - n);
  if (!x.length) return null;
  const mid = Math.floor(x.length / 2);
  return x.length % 2 ? x[mid] : (x[mid - 1] + x[mid]) / 2;
}
// Median der k Werte ENDEND bei Index i (trailing) — robust am Rand gegen Ausreißer.
// Yahoos jeweils letzter Tageskurs ist oft ein Intraday-Spike; der 3-Tage-Median
// trifft die offiziellen Monatswerte (validiert gegen etfdb/NAV).
function trailMed(arr, i, k = 3) {
  const lo = Math.max(0, i - k + 1);
  return median(arr.slice(lo, i + 1));
}
function pctBack(c, win) {
  if (c.length <= win + 2) return null;
  const last = trailMed(c, c.length - 1);
  const ref = trailMed(c, c.length - 1 - win);
  if (!last || !ref) return null;
  return +(((last - ref) / ref) * 100).toFixed(2);
}

async function closes(symbol, range = '1y') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=1d`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error('Yahoo HTTP ' + res.status + ' (' + symbol + ')');
  const j = await res.json();
  const r = j?.chart?.result?.[0];
  const arr = r?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(arr)) throw new Error('keine Kursdaten für ' + symbol);
  return arr.filter(x => typeof x === 'number' && isFinite(x));
}

// Performance für eine Liste von { id, etf } (Sektoren ODER Regionen).
async function fetchPerf(list) {
  const out = [];
  for (const s of list) {
    try {
      const c = await closes(s.etf, '1y');
      if (c.length <= W30 + 2) { out.push({ id: s.id, perf: 0, avg30: 0, perf6m: 0 }); continue; }
      const perf = pctBack(c, W30) ?? 0;
      const perf6m = pctBack(c, Math.min(W6M, c.length - 2)) ?? 0;

      // Ø der rollierenden 30T-Returns über die letzten ~252 Handelstage (geglättet).
      const lookback = Math.min(252, c.length - 1 - W30);
      let sum = 0, cnt = 0;
      for (let i = c.length - 1; i > c.length - 1 - lookback && i - W30 >= 0; i--) {
        const a = trailMed(c, i), b = trailMed(c, i - W30);
        if (a && b) { sum += ((a - b) / b) * 100; cnt++; }
      }
      const avg30 = cnt ? +(sum / cnt).toFixed(2) : perf;
      out.push({ id: s.id, perf, avg30, perf6m });
    } catch (e) {
      out.push({ id: s.id, perf: 0, avg30: 0, perf6m: 0 });
    }
  }
  return out;
}

export const fetchSectorPerformance = () => fetchPerf(SECTORS);
export const fetchRegionPerformance = () => fetchPerf(REGIONS);

// 6-Monats-Performance für eine einzelne Aktie (oder null bei Fehler).
export async function fetchStockPerf6m(ticker) {
  try {
    const c = await closes(ticker, '6mo');
    return pctBack(c, Math.min(W6M, c.length - 2));
  } catch {
    return null;
  }
}
