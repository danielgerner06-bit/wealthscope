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
  // MarketScreener-Skala (best->schlecht): Buy, Outperform, Hold, Underperform, Sell.
  // Kaufempfehlung = Buy + Outperform; "Strong Buy"-Wert (outperformPct) = NUR Outperform.
  // BEVORZUGT rohe Zähler -> WIR rechnen die Prozente (Gemini kann nicht "100" raten).
  const cnt = k => { const v = Number(o[k]); return isFinite(v) && v >= 0 ? Math.round(v) : null; };
  const buy = cnt('buy');
  const outp = cnt('outperform') ?? cnt('outperformCount') ?? cnt('accumulate');
  const hold = cnt('hold');
  const under = cnt('underperform') ?? 0;
  const sell = (cnt('sell') ?? 0) + (cnt('strongSell') ?? cnt('strong_sell') ?? 0);
  let buyPct, outperformPct, analysts, countsBad = false;
  const haveCounts = [buy, outp, hold].some(x => x != null);
  if (haveCounts) {
    const BUY = buy ?? 0, OUTP = outp ?? 0, H = hold ?? 0, U = under ?? 0, S = sell ?? 0;
    const total = BUY + OUTP + H + U + S;
    // Konsistenz-Check: Geminis separat genannte Analystenzahl MUSS zur Stufen-Summe passen.
    // Weicht sie stark ab (z. B. analysts:17 aber Counts ergeben 3), hat Gemini die Tabelle
    // falsch abgelesen -> Daten verwerfen statt Müll speichern.
    const declared = Number(o.analysts ?? o.analystCount ?? o.anzahlAnalysten);
    if (isFinite(declared) && declared > 0 && Math.abs(declared - total) > Math.max(1, total * 0.15)) {
      countsBad = true;
    } else if (total > 0) {
      buyPct = Math.round(((BUY + OUTP) / total) * 100);   // Kaufempfehlung = Buy + Outperform
      outperformPct = Math.round((OUTP / total) * 100);    // nur die Outperform-Stufe
      analysts = total;
    }
  }
  // KEIN Fallback auf fertige Prozente mehr: wir wollen NUR Aktien mit echten,
  // konsistenten Stufen-Zählern. Ohne saubere Counts -> countsBad -> nicht aufnehmen.
  if (buyPct == null) {
    countsBad = true;
    buyPct = Math.round(Number(o.buyPct ?? o.buy_percent ?? o.kaufProzent));   // nur für Anzeige/Sortierung
    const rawOutp = o.outperformPct ?? o.outperform_percent ?? o.outperformProzent;
    const outpNum = Math.round(Number(rawOutp));
    outperformPct = (rawOutp == null || !isFinite(outpNum)) ? null : outpNum;
    analysts = Number(o.analysts ?? o.analystCount ?? o.anzahlAnalysten) || null;
  }
  let upside = (o.upside != null && isFinite(Number(o.upside))) ? Math.round(Number(o.upside)) : null;
  // Plausibilität: unrealistische Kursziele (oft veraltete/falsche Websuche-Treffer) verwerfen.
  if (upside != null && (upside < -50 || upside > 120)) upside = null;
  let pe = (o.pe ?? o.kgv ?? o.peRatio) != null ? +Number(o.pe ?? o.kgv ?? o.peRatio).toFixed(1) : null;
  if (pe != null && (!isFinite(pe) || pe <= 0 || pe > 500)) pe = null;  // negatives/absurdes KGV verwerfen
  let sector = o.sector;
  if (!SECTOR_IDS.includes(sector)) sector = sectorForFinnhub(o.industry || o.branche || sector) || null;
  // Yahoo-Symbol für die Kursabfrage (z. B. KTN.DE, FRA.DE); fällt sonst auf Ticker zurück.
  const yahoo = (o.yahoo || o.yahooSymbol || '').toString().trim().toUpperCase() || null;
  // rohe Zähler zur Transparenz im Detail-Popup mitgeben (MarketScreener-Stufen)
  const counts = haveCounts ? { buy: buy ?? 0, outperform: outp ?? 0, hold: hold ?? 0, underperform: under ?? 0, sell: sell ?? 0 } : null;
  // MarketScreener-Direktlink validieren: nur echte Consensus-/quote-URLs übernehmen.
  let msUrl = (o.marketScreenerUrl || o.marketscreenerUrl || o.msUrl || '').toString().trim();
  if (!/^https?:\/\/(www\.)?marketscreener\.com\/quote\/stock\//i.test(msUrl)) msUrl = null;
  else if (!/consensus\/?$/i.test(msUrl)) msUrl = msUrl.replace(/\/?$/, '/').replace(/\/+$/, '/') + 'consensus/';
  return { buyPct, outperformPct, analysts, upside, pe, sector, yahoo, ratingCounts: counts, msUrl, countsBad };
}

/* (A) Kandidaten prüfen ------------------------------------------------ */
export async function checkCandidates(key, names) {
  if (!names.length) return [];
  const prompt = `Du recherchierst Analysten-Empfehlungen für Aktien über die Google-Suche.

WICHTIG: Finde für jede Aktie die EXAKTE MarketScreener-Consensus-Seite über die Google-Suche.
Das URL-Format ist: https://www.marketscreener.com/quote/stock/FIRMENNAME-ID/consensus/
(z. B. .../quote/stock/MICROSOFT-CORPORATION-4835/consensus/). Lies die Analysten-Verteilung
GENAU von dieser Seite. Findest du die Aktie dort nicht eindeutig -> NICHT ausgeben.

Prüfe GENAU diese Aktien: ${names.map(n => '"' + n + '"').join(', ')}.

MarketScreener-Skala (best zu schlecht): Buy, Outperform, Hold, Underperform, Sell. Lies die
ANZAHL der Analysten JE Stufe AB und gib diese ZÄHLER zurück — NICHT selbst Prozente rechnen.
ENTSCHEIDEND: Die SUMME aller Stufen-Zähler MUSS exakt der Gesamtzahl der Analysten entsprechen.
Verteile ALLE Analysten auf die richtigen Stufen — packe nicht einfach alle in eine Stufe.
Beispiel: 17 Analysten gesamt, davon 9 Buy, 5 Outperform, 3 Hold -> buy:9, outperform:5, hold:3
(Summe 17). Wenn du die genaue Verteilung nicht sicher ablesen kannst -> Aktie WEGLASSEN.
- ticker (Börsenkürzel), name, land
- marketScreenerUrl: die VOLLSTÄNDIGE URL der Consensus-Seite (…/quote/stock/…/consensus/)
- analysts: Gesamtzahl der Analysten (muss = Summe der Stufen sein)
- buy: Anzahl "Buy" (höchste Stufe)
- outperform: Anzahl "Outperform" (zweithöchste)
- hold: Anzahl "Hold"
- underperform: Anzahl "Underperform"
- sell: Anzahl "Sell"
- sector: GENAU eine dieser IDs anhand der Branche: ${SECTOR_LIST}
- upside: Kursziel-Potenzial in % falls auffindbar, sonst null
- pe: aktuelles KGV (Kurs-Gewinn-Verhältnis) als Zahl; bei Verlust null
- yahoo: das Yahoo-Finance-Symbol inkl. Börsensuffix (z. B. "KTN.DE", "FRA.DE", "NVDA"), für Kursabfragen

Gib NUR ein JSON-Array zurück, ein Objekt je Aktie, deren Analysten-Verteilung du bei
MarketScreener sicher gefunden hast. Ohne klare Zähler weglassen. Kein Text außerhalb des JSON.`;

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
        analysts: r.analysts, upside: r.upside, yahoo: r.yahoo, peGemini: r.pe, ratingCounts: r.ratingCounts, msUrl: r.msUrl,
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

WICHTIG für konsistente, nachprüfbare Daten: Prüfe die Analysten-Verteilung jeder vorgeschlagenen
Aktie AUSSCHLIESSLICH auf MarketScreener (marketscreener.com, Consensus-Seite). Findest du sie
dort nicht oder ist die Verteilung unklar -> Aktie NICHT vorschlagen (nicht aus anderer Quelle raten).

Kriterium: buyPct (Buy + Strong Buy) >= ${MIN_BUY_PCT} (Prozent aller Empfehlungen). Anzahl Analysten egal (auch 1-3 reicht). Unternehmensgröße egal — je unbekannter/kleiner, desto besser. KEINE Mega-Caps (kein Apple, Microsoft, Nvidia, Amazon, Alphabet, Meta usw.).

Schlage NUR Aktien vor, die NICHT in dieser Liste bereits bekannter Werte stehen: ${known || '(noch keine)'}.

Prüfe jede Aktie auf ihrer EXAKTEN MarketScreener-Consensus-Seite
(https://www.marketscreener.com/quote/stock/FIRMENNAME-ID/consensus/) und lies die Verteilung
GENAU dort ab. MarketScreener-Skala (best->schlecht): Buy, Outperform, Hold, Underperform, Sell.
Gib die ZÄHLER zurück (NICHT selbst Prozente rechnen). Die SUMME der Stufen MUSS = Gesamtzahl
Analysten sein; verteile ALLE Analysten (nicht alle in eine Stufe). Unsicher -> weglassen.
- ticker, name, land
- marketScreenerUrl: vollständige URL der Consensus-Seite
- analysts: Gesamtzahl (= Summe der Stufen)
- buy / outperform / hold / underperform / sell = Anzahl Analysten je Stufe (Buy=höchste)
- sector: GENAU eine dieser IDs: ${SECTOR_LIST}
- upside (% oder null)
- pe: aktuelles KGV als Zahl; bei Verlust null
- yahoo: Yahoo-Finance-Symbol inkl. Börsensuffix (z. B. "KTN.DE", "NVDA")

Gib NUR ein JSON-Array mit bis zu 10 Aktien zurück, deren Verteilung du bei MarketScreener sicher gefunden hast. Kein Text außerhalb des JSON.`;

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
        analysts: r.analysts, upside: r.upside, yahoo: r.yahoo, peGemini: r.pe, ratingCounts: r.ratingCounts, msUrl: r.msUrl,
        via: 'gemini-discover', source: o.source || sources[0] || 'web',
        seen: new Date().toISOString().slice(0, 10),
      });
    }
  }
  return out;
}
