// Multi-Quellen-Konsens für Analysten-Empfehlungen.
//
// Prinzip (Nutzer-Vorgabe): Eine Aktie wird auf MEHREREN seriösen, echten Quellen abgeglichen.
// Sie gilt nur dann als 100%-Perle, wenn sie auf ALLEN Quellen, die sie kennen, ÜBEREINSTIMMEND
// 0 Hold UND 0 Sell zeigt. Widerspricht auch nur EINE seriöse Quelle (Hold/Sell > 0) -> RAUS.
//
// Quellen (alle echte Sell-Side-Analysten, KEINE Algo-Dienste wie Weiss/Wall Street Zen):
//  • stockanalysis.com  (Daten von S&P Global + TipRanks; HTML als Text lesbar)
//  • Yahoo Finance recommendationTrend  (kostenlos, Crumb)
//  • Finnhub recommendation  (US, API-Key)
// Erweiterbar: weitere Quellen einfach als async fn(ticker,yahoo)->counts|null ergänzen.

import { fetchRatingCounts as saRatings } from './stockanalysis.mjs';
import { fetchYahooRatings } from './prices.mjs';
import { fetchFinnhubRatings } from './finnhub.mjs';

// Jede Quelle: Funktion + ob sie das (ggf. Yahoo-)Symbol oder den US-Ticker braucht.
const SOURCES = [
  { name: 'stockanalysis', fn: (t, y) => saRatings(t, y) },
  { name: 'yahoo',         fn: (t, y) => fetchYahooRatings(y || t) },
  { name: 'finnhub',       fn: (t, y) => fetchFinnhubRatings((y || t).replace(/\..*$/, '')) },  // Finnhub: US-Ticker ohne Suffix
];

/* Prüft eine Aktie über ALLE Quellen. Rückgabe:
   { ok, sources, counts? }
   - ok=true  : mind. 1 Quelle kennt die Aktie UND ALLE kennenden Quellen zeigen 0 Hold/0 Sell.
   - ok=false : keine Quelle kennt sie ODER mind. eine zeigt Hold/Sell > 0.
   counts = die Werte der ergiebigsten Quelle (meiste Analysten) für die Anzeige. */
export async function verifyAcrossSources(ticker, yahoo) {
  const results = [];
  for (const src of SOURCES) {
    let r = null;
    try { r = await src.fn(ticker, yahoo); } catch {}
    if (r && r.analysts > 0) results.push({ ...r, src: src.name });
  }
  if (!results.length) return { ok: false, sources: [], reason: 'keine-quelle' };

  // ALLE kennenden Quellen müssen NULL nicht-Kauf-Empfehlungen haben. 'neg' deckt JEDE
  // negative/neutrale Stufe ab (Hold, Sell, Strong Sell, Underperform, Neutral, Without
  // Opinion ...) — egal wie die jeweilige Seite sie benennt. Eine einzige reicht zum Ausschluss.
  const negOf = r => (r.neg != null ? r.neg : ((r.hold || 0) + (r.underperform || 0) + (r.sell || 0)));
  const bad = results.find(r => negOf(r) > 0);
  if (bad) return {
    ok: false, sources: results.map(r => r.src),
    reason: `${bad.src}: ${negOf(bad)} nicht-Kauf (hold=${bad.hold} sell=${bad.sell})`,
  };

  // alle einig auf 0/0 -> bestätigt. Anzeige-Counts von der Quelle mit den meisten Analysten.
  const best = results.reduce((a, b) => (b.analysts > a.analysts ? b : a));
  return {
    ok: true,
    sources: results.map(r => r.src),
    counts: { buy: best.buy, outperform: best.outperform, hold: 0, underperform: 0, sell: 0 },
    analysts: best.analysts,
  };
}
