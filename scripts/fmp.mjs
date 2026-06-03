// Financial Modeling Prep (FMP) — strukturierte Analysten-Ratings als EXAKTE Counts.
// Free-Tier: 250 Calls/Tag, US-Aktien. Zweite verlässliche Quelle neben Finnhub für
// US-Werte (bestätigt/ersetzt die Websuche-Schätzung). KEINE DE/EU-Abdeckung im Free-Tier.
//
// grades-consensus liefert je Symbol die Zahl der Analysten je Stufe:
//   { symbol, strongBuy, buy, hold, sell, strongSell }
// Daraus: buyPct = (strongBuy+buy)/total*100, outperformPct = strongBuy/total*100.

const KEY = process.env.FMP_API_KEY;
const BASE = 'https://financialmodelingprep.com';

export const fmpEnabled = () => !!KEY;

// robuste Feld-Extraktion (FMP-Felder heißen je nach Endpoint leicht anders)
function pickCounts(o) {
  if (!o || typeof o !== 'object') return null;
  const n = k => { const v = Number(o[k]); return isFinite(v) ? v : 0; };
  const strongBuy = n('strongBuy') || n('strong_buy') || n('analystRatingsStrongBuy');
  const buy = n('buy') || n('analystRatingsbuy') || n('analystRatingsBuy');
  const hold = n('hold') || n('analystRatingsHold');
  const sell = n('sell') || n('analystRatingsSell');
  const strongSell = n('strongSell') || n('strong_sell') || n('analystRatingsStrongSell');
  const total = strongBuy + buy + hold + sell + strongSell;
  if (total <= 0) return null;
  return { strongBuy, buy, hold, sell, strongSell, total };
}

// Liefert { buyPct, outperformPct, analysts } für ein US-Symbol — oder null.
// Versucht mehrere Endpoints (stable -> v4), da der Free-Zugang variiert.
export async function fmpRating(symbol) {
  if (!KEY) return null;
  const sym = encodeURIComponent(symbol);
  const urls = [
    `${BASE}/stable/grades-consensus?symbol=${sym}&apikey=${KEY}`,   // exakte Counts (Doku)
    `${BASE}/stable/grades-summary?symbol=${sym}&apikey=${KEY}`,      // alt. Name "Grades Summary"
    `${BASE}/api/v4/upgrades-downgrades-consensus?symbol=${sym}&apikey=${KEY}`,
    `${BASE}/api/v3/analyst-stock-recommendations/${sym}?apikey=${KEY}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const j = await res.json();
      const rec = Array.isArray(j) ? j[0] : j;
      const c = pickCounts(rec);
      if (!c) continue;
      return {
        buyPct: Math.round(((c.strongBuy + c.buy) / c.total) * 100),
        outperformPct: Math.round((c.strongBuy / c.total) * 100),
        analysts: c.total,
        _counts: c,   // zum Debuggen
      };
    } catch { /* nächsten Endpoint versuchen */ }
  }
  return null;
}

// nur US-Symbole sinnvoll (Free-Tier). Symbole mit Börsensuffix (.DE etc.) -> skip.
export const isUsSymbol = sym => !!sym && !sym.includes('.');
