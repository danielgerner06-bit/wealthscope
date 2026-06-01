// Sektor-Performance über Sektor-ETFs via Yahoo-Finance-Chart-API (kostenlos, kein Key).
// Liefert je Sektor: perf (aktuelle ~30-Handelstage-Performance) und avg30
// (Durchschnitt der rollierenden 30-Handelstage-Returns über die letzten ~360 Tage).
import { SECTORS } from './sectors.mjs';

const WIN = 21; // ~21 Handelstage ≈ 30 Kalendertage

async function closes(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1y&interval=1d`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error('Yahoo HTTP ' + res.status + ' (' + symbol + ')');
  const j = await res.json();
  const r = j?.chart?.result?.[0];
  const arr = r?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(arr)) throw new Error('keine Kursdaten für ' + symbol);
  return arr.filter(x => typeof x === 'number' && isFinite(x));
}

export async function fetchSectorPerformance() {
  const out = [];
  for (const s of SECTORS) {
    try {
      const c = await closes(s.etf);
      if (c.length <= WIN + 1) { out.push({ id: s.id, perf: 0, avg30: 0 }); continue; }
      const last = c[c.length - 1];
      const ref = c[c.length - 1 - WIN];
      const perf = ((last - ref) / ref) * 100;

      const lookback = Math.min(252, c.length - 1 - WIN);
      let sum = 0, cnt = 0;
      for (let i = c.length - 1; i > c.length - 1 - lookback && i - WIN >= 0; i--) {
        const a = c[i], b = c[i - WIN];
        if (b > 0) { sum += ((a - b) / b) * 100; cnt++; }
      }
      const avg = cnt ? sum / cnt : perf;
      out.push({ id: s.id, perf: +perf.toFixed(2), avg30: +avg.toFixed(2) });
    } catch (e) {
      out.push({ id: s.id, perf: 0, avg30: 0 });
    }
  }
  return out;
}
