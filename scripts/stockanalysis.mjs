// Direkter Reader für stockanalysis.com — liefert die Analysten-Empfehlungsverteilung
// (Buy/Outperform/Hold/Underperform/Sell) als HARTE Zahlen, serverseitig & kostenlos.
//
// Warum diese Quelle:
//  • stockanalysis.com bezieht seine Analystendaten von TipRanks + S&P Global ("estimatesSource:spg")
//    -> nur ECHTE Sell-Side-Analysten (keine Algo-Dienste wie Weiss/Wall Street Zen).
//  • Die Zahlen stehen als TEXT im HTML (im eingebetteten recommendations:[...]-Array),
//    nicht in einem JS-Diagramm wie bei MarketScreener (das ist 403-gesperrt + Bild).
//  • Wir nehmen den AKTUELLSTEN Monatseintrag (höchstes date).
//
// stockanalysis-Skala: strongBuy, buy, hold, sell, strongSell.
// Mapping auf unsere MS-Skala: Buy = strongBuy, Outperform = buy, Hold = hold,
// Underperform = (kein direktes Pendant -> 0), Sell = sell + strongSell.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Kandidaten-Pfade für ein Symbol. US-Ticker direkt; .DE/.PA/... als quote/<exchange>/<sym>.
function urlsFor(ticker, yahoo) {
  const t = String(ticker || '').trim();
  const y = String(yahoo || '').trim();
  const out = [];
  const base = 'https://stockanalysis.com';
  // reines US-Symbol (1-5 Großbuchstaben, kein Suffix)
  const plain = (t.match(/^[A-Z]{1,5}$/) ? t : (y.match(/^[A-Z]{1,5}$/) ? y : null));
  if (plain) out.push(`${base}/stocks/${plain.toLowerCase()}/forecast/`);
  // Yahoo-Suffix -> Börsenpfad (z.B. KTN.DE -> quote/etr/ktn, AIR.PA -> quote/epa/air)
  const suf = (y.match(/\.([A-Z]+)$/) || t.match(/\.([A-Z]+)$/) || [])[1];
  const sym = (y || t).replace(/\.[A-Z]+$/, '').toLowerCase();
  const exMap = { DE: 'etr', PA: 'epa', SW: 'swx', AS: 'ams', MI: 'bit', ST: 'sto',
                  HE: 'hel', OL: 'ose', CO: 'cph', L: 'lon', BR: 'ebr', VI: 'vie', MC: 'bme' };
  if (suf && exMap[suf] && sym) out.push(`${base}/quote/${exMap[suf]}/${sym}/forecast/`);
  return [...new Set(out)];
}

// Extrahiert den aktuellsten recommendations-Eintrag aus dem HTML.
function parseLatest(html) {
  const i = html.indexOf('recommendations:[');
  if (i < 0) return null;
  // grob das Array bis zur schließenden Klammer schneiden
  const seg = html.slice(i, i + 8000);
  // alle {…}-Objekte mit den Rating-Feldern einsammeln
  const re = /\{[^{}]*?\bdate:"(\d{4}-\d{2}-\d{2})"[^{}]*?\}/g;
  let m, best = null, bestDate = '';
  const num = (obj, k) => { const r = new RegExp('\\b' + k + ':(-?\\d+)').exec(obj); return r ? Number(r[1]) : null; };
  while ((m = re.exec(seg))) {
    const obj = m[0], date = m[1];
    if (date <= bestDate) continue;
    const strongBuy = num(obj, 'strongBuy'), buy = num(obj, 'buy'),
          hold = num(obj, 'hold'), sell = num(obj, 'sell'), strongSell = num(obj, 'strongSell');
    if (strongBuy == null && buy == null) continue;
    bestDate = date;
    best = { strongBuy: strongBuy || 0, buy: buy || 0, hold: hold || 0, sell: sell || 0, strongSell: strongSell || 0, date };
  }
  return best;
}

/* Liefert für ein Symbol die Rating-Counts auf unserer MS-Skala oder null.
   { buy, outperform, hold, underperform, sell, analysts, date, source:'stockanalysis' } */
export async function fetchRatingCounts(ticker, yahoo) {
  for (const url of urlsFor(ticker, yahoo)) {
    let html;
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) continue;
      html = await res.text();
    } catch { continue; }
    const r = parseLatest(html);
    if (!r) continue;
    // Mapping: Buy=strongBuy, Outperform=buy, Hold=hold, Sell=sell+strongSell
    const buy = r.strongBuy, outperform = r.buy, hold = r.hold, underperform = 0,
          sell = r.sell + r.strongSell;
    const analysts = buy + outperform + hold + underperform + sell;
    if (analysts <= 0) continue;
    return { buy, outperform, hold, underperform, sell, analysts, date: r.date, source: 'stockanalysis' };
  }
  return null;
}
