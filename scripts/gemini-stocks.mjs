// Analysten-Perlen via Gemini + Google-Search-Grounding.
//
// Zwei Funktionen:
//  (A) checkCandidates: prüft eine Handvoll Kandidaten-Aktien per Websuche auf das
//      Kriterium (Kaufempfehlungs-Anteil >= 80 %) und liefert Treffer mit Quelle.
//  (B) discoverNew: lässt Gemini NEUE, unbekannte Werte vorschlagen — bekommt dazu
//      die Liste bereits bekannter Namen, damit es nichts doppelt vorschlägt.
//
// Beide nutzen google_search-Grounding und liefern strukturierte Objekte.

import { sectorForFinnhub, SECTOR_IDS } from './sectors.mjs';

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const SECTOR_LIST = SECTOR_IDS.join(', ');

// Aufnahmekriterium: Kaufempfehlungs-Anteil (Buy + Strong Buy) = 100 %.
export const MIN_BUY_PCT = Number(process.env.MIN_BUY_PCT || 100);
const qualifies = r => !r.countsBad && isFinite(r.buyPct) && r.buyPct >= MIN_BUY_PCT;

// Firmenname auf vergleichbaren Kern reduzieren (Rechtsformen/Füllwörter weg, nur a-z0-9).
function nameKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\b(se|ag|nv|sa|corp|corporation|inc|incorporated|ltd|limited|plc|co|kgaa|group|holding|holdings|company|the|vz|vorzugsaktien|adr|spa|oyj|asa|ab|as)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

async function groundedJSON(key, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.3 },
  });
  let lastErr = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    if (res.status === 429) {                        // RPM-Grounding-Limit -> warten & erneut versuchen
      lastErr = 'Gemini HTTP 429';
      await new Promise(r => setTimeout(r, 20000 * (attempt + 1)));   // 20s, 40s, 60s, 80s
      continue;
    }
    if (!res.ok) throw new Error('Gemini HTTP ' + res.status + ': ' + (await res.text()).slice(0, 250));
    const j = await res.json();
    const cand = j.candidates?.[0];
    const text = cand?.content?.parts?.map(p => p.text).filter(Boolean).join('').trim() || '';
    const sources = (cand?.groundingMetadata?.groundingChunks || [])
      .map(c => c.web?.title || c.web?.uri).filter(Boolean);
    return { text, sources };
  }
  throw new Error(lastErr);
}

// Extrahiert das erste JSON-Array/-Objekt aus einem Text (Grounding erlaubt kein responseMimeType=json).
function extractJSON(text) {
  if (!text) return null;
  let t = text.replace(/```json/gi, '```').replace(/```/g, '');
  const start = t.search(/[[{]/);
  if (start < 0) return null;
  // vom ersten Klammerzeichen bis zum passenden Ende grob schneiden
  const lastArr = t.lastIndexOf(']');
  const lastObj = t.lastIndexOf('}');
  const end = Math.max(lastArr, lastObj);
  if (end < start) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
}

function normRating(o) {
  // AUSSCHLIESSLICH MarketScreener-Consensus: Buy, Outperform, Hold, Underperform, Sell.
  // Kaufempfehlung = Buy + Outperform; Outperform-Wert = nur die Outperform-Stufe.
  // Kriterium 100%: NUR Buy/Outperform > 0, Hold/Underperform/Sell = 0.
  // WIR rechnen aus den Zählern; Link muss eine echte MS-Consensus-URL sein, sonst countsBad.
  const cnt = k => { const v = Number(o[k]); return isFinite(v) && v >= 0 ? Math.round(v) : null; };
  const buy = cnt('buy');
  const outp = cnt('outperform') ?? cnt('outperformCount') ?? cnt('accumulate');
  const hold = cnt('hold');
  const under = cnt('underperform') ?? 0;
  const sell = (cnt('sell') ?? 0) + (cnt('strongSell') ?? cnt('strong_sell') ?? 0);

  // Link MUSS eine MarketScreener-Consensus-URL sein (keine andere Quelle akzeptiert).
  const rawUrl = (o.url || o.sourceUrl || o.marketScreenerUrl || o.msUrl || '').toString().trim();
  const msMatch = /^https?:\/\/(www\.)?marketscreener\.com\/quote\/stock\/[^\/]+\//i.test(rawUrl);
  const link = msMatch ? (/consensus\/?$/i.test(rawUrl) ? rawUrl : rawUrl.replace(/\/+$/, '/') + 'consensus/') : null;

  let buyPct, outperformPct = null, analysts, countsBad = false;
  const haveCounts = [buy, outp, hold].some(x => x != null);
  if (!link || !haveCounts) {
    countsBad = true;   // ohne gültige MS-URL oder Zähler -> raus
  } else {
    const BUY = buy ?? 0, OUTP = outp ?? 0, H = hold ?? 0, U = under ?? 0, S = sell ?? 0;
    const total = BUY + OUTP + H + U + S;
    const declared = Number(o.analysts ?? o.analystCount ?? o.anzahlAnalysten);
    // EXAKTER Ablauf: Hold/Underperform/Sell MÜSSEN alle 0 sein (sonst nicht 100% -> raus).
    // Gemini MUSS die Gesamtzahl separat nennen und sie muss EXAKT der Summe entsprechen.
    if (total <= 0) countsBad = true;
    else if (H > 0 || U > 0 || S > 0) countsBad = true;                         // kein 100%
    else if (!isFinite(declared) || declared <= 0 || declared !== total) countsBad = true;
    else {
      buyPct = 100;                                  // per Definition (nur Buy+Outperform)
      outperformPct = Math.round((OUTP / total) * 100);
      analysts = total;
    }
  }

  let upside = (o.upside != null && isFinite(Number(o.upside))) ? Math.round(Number(o.upside)) : null;
  if (upside != null && (upside < -50 || upside > 120)) upside = null;
  let pe = (o.pe ?? o.kgv ?? o.peRatio) != null ? +Number(o.pe ?? o.kgv ?? o.peRatio).toFixed(1) : null;
  if (pe != null && (!isFinite(pe) || pe <= 0 || pe > 500)) pe = null;
  let sector = o.sector;
  if (!SECTOR_IDS.includes(sector)) sector = sectorForFinnhub(o.industry || o.branche || sector) || null;
  const yahoo = (o.yahoo || o.yahooSymbol || '').toString().trim().toUpperCase() || null;
  const counts = (!countsBad) ? { buy: buy ?? 0, outperform: outp ?? 0, hold: hold ?? 0, underperform: under ?? 0, sell: sell ?? 0 } : null;
  return { buyPct, outperformPct, analysts, upside, pe, sector, yahoo, ratingCounts: counts, ratingSource: 'marketscreener', ratingUrl: link, countsBad };
}

// EXAKTER, EINZIG ERLAUBTER Ablauf (vom Nutzer vorgegeben) — nur MarketScreener.
const RATING_RULES = `
GENAUER ABLAUF (nur dieser ist erlaubt, sonst Aktie weglassen):
1) Suche die Aktie auf MarketScreener und finde ihre EXAKTE Consensus-URL im Format:
   https://www.marketscreener.com/quote/stock/FIRMENNAME-ID/consensus/
   (Beispiel: https://www.marketscreener.com/quote/stock/AUTODESK-INC-40246776/consensus/)
2) Öffne GENAU diese Seite und sieh dir das Widget "Analyst Consensus Detail" an.
3) Prüfe dort die Stufen: Buy, Outperform, Hold, Underperform, Sell.
   -> Hold, Underperform und Sell MÜSSEN ALLE = 0 sein.
4) Wenn ja: zähle Buy und Outperform und gib die Aktie aus (mit genau dieser URL).
   Wenn nein (irgendein Hold/Underperform/Sell > 0): Aktie NICHT ausgeben.

KEINE andere Quelle (kein TipRanks, kein Investing.com). Keine Schätzung, keine geratene URL.
Pflichtfelder je ausgegebener Aktie:
 - source: "marketscreener"
 - url: die VOLLSTÄNDIGE Consensus-URL aus Schritt 1 (…/quote/stock/…/consensus/)
 - analysts: Gesamtzahl (= Buy + Outperform, da Hold/Underperform/Sell = 0)
 - buy, outperform   (Anzahl je Stufe)
 - hold, underperform, sell  (müssen 0 sein)
 - ticker, name, land, yahoo (Yahoo-Symbol inkl. Suffix z.B. "KTN.DE","NVDA")
 - sector: GENAU eine dieser IDs: ${SECTOR_LIST}
 - upside (% oder null), pe (KGV-Zahl oder null bei Verlust)
Summe der Stufen MUSS = analysts. Unsicher oder Aktie nicht eindeutig gefunden -> WEGLASSEN.`;

/* (A) Kandidaten prüfen ------------------------------------------------ */
export async function checkCandidates(key, names) {
  if (!names.length) return [];
  const prompt = `Du recherchierst Analysten-Empfehlungen für Aktien.
Prüfe GENAU diese Aktien: ${names.map(n => '"' + n + '"').join(', ')}.
${RATING_RULES}

Gib NUR ein JSON-Array zurück, ein Objekt je Aktie, die du sicher belegen konntest.
Kein Text außerhalb des JSON.`;

  const { text, sources } = await groundedJSON(key, prompt);
  const arr = extractJSON(text);
  if (!Array.isArray(arr)) return [];
  // Identitäts-Schutz: zurückgegebenes Objekt muss zu EINER angefragten Aktie passen
  // (Ticker ODER Firmenname-Kern), sonst hat Gemini eine ANDERE Firma erwischt -> verwerfen.
  const wantTickers = new Set(names.map(n => (n.match(/\(([^)]+)\)/) || [])[1]).filter(Boolean).map(t => t.toUpperCase()));
  const wantNameKeys = names.map(n => nameKey(n.replace(/\([^)]*\)/, ''))).filter(Boolean);
  const out = [];
  for (const o of arr) {
    if (!o || !o.ticker) continue;
    const tk = String(o.ticker).toUpperCase();
    const nk = nameKey(o.name || '');
    const idOk = wantTickers.has(tk) || wantNameKeys.some(w => nk && (w.includes(nk) || nk.includes(w)));
    if (!idOk) continue;   // andere Firma als angefragt -> nicht übernehmen
    const r = normRating(o);
    if (!r.sector) continue;
    if (qualifies(r)) {
      out.push({
        ticker: String(o.ticker).toUpperCase(),
        name: o.name || o.ticker,
        sector: r.sector,
        buyPct: r.buyPct, outperformPct: r.outperformPct,
        analysts: r.analysts, upside: r.upside, yahoo: r.yahoo, peGemini: r.pe,
        ratingCounts: r.ratingCounts, ratingSource: r.ratingSource, ratingUrl: r.ratingUrl,
        via: 'gemini', source: r.ratingSource,
        seen: new Date().toISOString().slice(0, 10),
      });
    }
  }
  return out;
}

/* (B) Neue unbekannte Werte entdecken ---------------------------------
   `focus` lenkt die Suche auf eine Region/Branche, damit über mehrere Läufe
   verschiedene Werte gefunden werden (z. B. "deutsche Small-Caps", "Biotech").  */
export async function discoverNew(key, knownNames, focus = '') {
  const known = knownNames.slice(0, 140).join(', ');
  const focusLine = focus
    ? `Lege diesmal den Schwerpunkt auf: ${focus}. `
    : '';
  const prompt = `Du suchst über die Google-Suche WELTWEIT kleine bis mittelgroße, eher UNBEKANNTE Aktien (Small-/Mid-Caps, gern aus Deutschland/Europa, aber auch USA/Asien), bei denen ALLE Analysten zum Kauf raten (nur Buy/Outperform, KEIN Hold/Sell). ${focusLine}
Unternehmensgröße egal — je unbekannter/kleiner, desto besser. KEINE Mega-Caps (kein Apple, Microsoft, Nvidia, Amazon, Alphabet, Meta usw.).
Schlage NUR Aktien vor, die NICHT in dieser Liste bereits bekannter Werte stehen: ${known || '(noch keine)'}.
${RATING_RULES}

Gib NUR ein JSON-Array mit bis zu 10 Aktien zurück, deren Verteilung du auf einer der beiden
Quellen sicher belegt hast. Kein Text außerhalb des JSON.`;

  const { text, sources } = await groundedJSON(key, prompt);
  const arr = extractJSON(text);
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const o of arr) {
    if (!o || !o.ticker) continue;
    const r = normRating(o);
    if (!r.sector) continue;
    if (qualifies(r)) {
      out.push({
        ticker: String(o.ticker).toUpperCase(),
        name: o.name || o.ticker,
        sector: r.sector,
        buyPct: r.buyPct, outperformPct: r.outperformPct,
        analysts: r.analysts, upside: r.upside, yahoo: r.yahoo, peGemini: r.pe,
        ratingCounts: r.ratingCounts, ratingSource: r.ratingSource, ratingUrl: r.ratingUrl,
        via: 'gemini-discover', source: r.ratingSource,
        seen: new Date().toISOString().slice(0, 10),
      });
    }
  }
  return out;
}
