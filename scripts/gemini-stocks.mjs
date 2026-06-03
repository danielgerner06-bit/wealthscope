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
const qualifies = r => isFinite(r.buyPct) && r.buyPct >= MIN_BUY_PCT;

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
  const buyPct = Math.round(Number(o.buyPct ?? o.buy_percent ?? o.kaufProzent));
  // Outperform = Strong-Buy-Anteil. Ist Teil der Kaufempfehlung (Buy + Strong Buy), wird
  // also IMMER mitermittelt, wenn buyPct bekannt ist. 0 ist eine echte, gültige Angabe
  // (alle "Buy", keiner "Strong Buy") -> NICHT als unbekannt behandeln.
  const rawOutp = o.outperformPct ?? o.outperform_percent ?? o.outperformProzent;
  const outpNum = Math.round(Number(rawOutp));
  const outperformPct = (rawOutp == null || !isFinite(outpNum)) ? null : outpNum;
  const analysts = Number(o.analysts ?? o.analystCount ?? o.anzahlAnalysten) || null;
  let upside = (o.upside != null && isFinite(Number(o.upside))) ? Math.round(Number(o.upside)) : null;
  // Plausibilität: unrealistische Kursziele (oft veraltete/falsche Websuche-Treffer) verwerfen.
  if (upside != null && (upside < -50 || upside > 120)) upside = null;
  let pe = (o.pe ?? o.kgv ?? o.peRatio) != null ? +Number(o.pe ?? o.kgv ?? o.peRatio).toFixed(1) : null;
  if (pe != null && (!isFinite(pe) || pe <= 0 || pe > 500)) pe = null;  // negatives/absurdes KGV verwerfen
  let sector = o.sector;
  if (!SECTOR_IDS.includes(sector)) sector = sectorForFinnhub(o.industry || o.branche || sector) || null;
  // Yahoo-Symbol für die Kursabfrage (z. B. KTN.DE, FRA.DE); fällt sonst auf Ticker zurück.
  const yahoo = (o.yahoo || o.yahooSymbol || '').toString().trim().toUpperCase() || null;
  return { buyPct, outperformPct, analysts, upside, pe, sector, yahoo };
}

/* (A) Kandidaten prüfen ------------------------------------------------ */
export async function checkCandidates(key, names) {
  if (!names.length) return [];
  const prompt = `Du recherchierst Analysten-Empfehlungen für Aktien über die Google-Suche (Quellen wie investing.com, marketscreener.com, finanzen.net, wallstreet-online).

Prüfe GENAU diese Aktien: ${names.map(n => '"' + n + '"').join(', ')}.

Für jede Aktie ermittle aus aktuellen Quellen:
- ticker (Börsenkürzel), name, land
- analysts: Anzahl coverender Analysten (auch 1 zählt)
- buyPct: Prozent ALLER Empfehlungen, die Buy ODER Strong Buy sind (0-100)
- outperformPct: davon der Anteil, der NUR "Strong Buy" (höchste Stufe, oft "Outperform" genannt) ist (0-100). Da Strong Buy Teil der Kaufempfehlung ist, kennst du diesen Wert, wenn du buyPct kennst. 0 ist gültig (alle nur "Buy", keiner "Strong Buy").
- sector: GENAU eine dieser IDs anhand der Branche: ${SECTOR_LIST}
- upside: Kursziel-Potenzial in % falls auffindbar, sonst null
- pe: aktuelles KGV (Kurs-Gewinn-Verhältnis) als Zahl; bei Verlust null
- yahoo: das Yahoo-Finance-Symbol inkl. Börsensuffix (z. B. "KTN.DE", "FRA.DE", "NVDA"), für Kursabfragen
- source: kurze Quellenangabe

Gib NUR ein JSON-Array zurück, ein Objekt je Aktie, die du sicher gefunden hast. Aktien ohne auffindbare Analystendaten weglassen. Kein Text außerhalb des JSON.`;

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
        via: 'gemini', source: o.source || sources[0] || 'web',
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
  const prompt = `Du suchst über die Google-Suche WELTWEIT kleine bis mittelgroße, eher UNBEKANNTE Aktien (Small-/Mid-Caps, gern aus Deutschland/Europa, aber auch USA/Asien), die von Analysten überwiegend mit Kaufempfehlungen bewertet werden. ${focusLine}

Kriterium: buyPct (Buy + Strong Buy) >= ${MIN_BUY_PCT} (Prozent aller Empfehlungen). Anzahl Analysten egal (auch 1-3 reicht). Unternehmensgröße egal — je unbekannter/kleiner, desto besser. KEINE Mega-Caps (kein Apple, Microsoft, Nvidia, Amazon, Alphabet, Meta usw.).

Schlage NUR Aktien vor, die NICHT in dieser Liste bereits bekannter Werte stehen: ${known || '(noch keine)'}.

Für jeden Vorschlag gib aus aktuellen Quellen:
- ticker, name, land
- analysts, buyPct (0-100) = Anteil Buy+Strong Buy; outperformPct (0-100) = davon der Anteil NUR "Strong Buy" (Teil von buyPct, also bekannt wenn buyPct bekannt; 0 ist gültig)
- sector: GENAU eine dieser IDs: ${SECTOR_LIST}
- upside (% oder null)
- pe: aktuelles KGV als Zahl; bei Verlust null
- yahoo: Yahoo-Finance-Symbol inkl. Börsensuffix (z. B. "KTN.DE", "NVDA")
- source: kurze Quellenangabe

Gib NUR ein JSON-Array mit bis zu 10 solcher Aktien zurück. Kein Text außerhalb des JSON.`;

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
        via: 'gemini-discover', source: o.source || sources[0] || 'web',
        seen: new Date().toISOString().slice(0, 10),
      });
    }
  }
  return out;
}
