// Twelve Data — strukturierte Analysten-Ratings als EXAKTE Counts, AUCH für DE/EU.
// Free-Tier: 8 Calls/Min (~800/Tag). Liefert je Symbol:
//   trends.current_month = { strong_buy, buy, hold, sell, strong_sell }
// Daraus: buyPct = (strong_buy+buy)/total*100, outperformPct = strong_buy/total*100.
//
// Symbol-Mapping: Yahoo-Suffix -> Twelve-Data exchange-Code.

const KEY = process.env.TWELVEDATA_API_KEY;
const BASE = 'https://api.twelvedata.com';

export const twelveEnabled = () => !!KEY;

// Yahoo-Suffix -> Twelve-Data exchange-Code (für nicht-US-Börsen)
const EXCHANGE = {
  DE: 'XETR', F: 'FSX', PA: 'Euronext', AS: 'Euronext', BR: 'Euronext', MI: 'MTA',
  L: 'LSE', SW: 'SIX', ST: 'OMX', HE: 'OMX', VI: 'VSE', MC: 'BME',
  T: 'TSE', HK: 'HKEX', SS: 'SSE', SZ: 'SZSE', KS: 'KRX', TW: 'TWSE',
  NS: 'NSE', BO: 'BSE', AX: 'ASX', SA: 'B3', MX: 'BMV',
};

// Yahoo-Symbol -> { symbol, exchange } für Twelve Data
function mapSymbol(yahoo) {
  if (!yahoo) return null;
  if (!yahoo.includes('.')) return { symbol: yahoo };                 // US: nur Ticker
  const [base, suf] = [yahoo.slice(0, yahoo.lastIndexOf('.')), yahoo.split('.').pop()];
  const exchange = EXCHANGE[suf];
  return exchange ? { symbol: base, exchange } : { symbol: base };
}

function countsToRating(c) {
  if (!c) return null;
  const n = k => { const v = Number(c[k]); return isFinite(v) ? v : 0; };
  const strongBuy = n('strong_buy'), buy = n('buy'), hold = n('hold'), sell = n('sell'), strongSell = n('strong_sell');
  const total = strongBuy + buy + hold + sell + strongSell;
  if (total <= 0) return null;
  return {
    buyPct: Math.round(((strongBuy + buy) / total) * 100),
    outperformPct: Math.round((strongBuy / total) * 100),
    analysts: total,
    _counts: { strongBuy, buy, hold, sell, strongSell },
  };
}

// Liefert { buyPct, outperformPct, analysts } für ein Yahoo-Symbol (US ODER DE/EU) — oder null.
export async function twelveRating(yahoo) {
  if (!KEY) return null;
  const m = mapSymbol(yahoo);
  if (!m) return null;
  const qs = new URLSearchParams({ symbol: m.symbol, apikey: KEY });
  if (m.exchange) qs.set('exchange', m.exchange);
  try {
    const res = await fetch(`${BASE}/recommendations?${qs}`);
    if (!res.ok) return null;
    const j = await res.json();
    if (j.status === 'error' || !j.trends) return null;
    // jüngste verfügbare Monatsverteilung nehmen
    const t = j.trends.current_month || j.trends.previous_month;
    return countsToRating(t);
  } catch { return null; }
}
