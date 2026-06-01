// Analysten-Perlen via Gemini + Google-Search-Grounding.
//
// Zwei Funktionen:
//  (A) checkCandidates: prüft eine Handvoll Kandidaten-Aktien per Websuche auf die
//      Kriterien (Kauf >= 95% UND Outperform >= 80%) und liefert Treffer mit Quelle.
//  (B) discoverNew: lässt Gemini NEUE, unbekannte Werte vorschlagen — bekommt dazu
//      die Liste bereits bekannter Namen, damit es nichts doppelt vorschlägt.
//
// Beide nutzen google_search-Grounding und liefern strukturierte Objekte.

import { sectorForFinnhub, SECTOR_IDS } from './sectors.mjs';

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const SECTOR_LIST = SECTOR_IDS.join(', ');

async function groundedJSON(key, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.3 },
    }),
  });
  if (!res.ok) throw new Error('Gemini HTTP ' + res.status + ': ' + (await res.text()).slice(0, 250));
  const j = await res.json();
  const cand = j.candidates?.[0];
  const text = cand?.content?.parts?.map(p => p.text).filter(Boolean).join('').trim() || '';
  const sources = (cand?.groundingMetadata?.groundingChunks || [])
    .map(c => c.web?.title || c.web?.uri).filter(Boolean);
  return { text, sources };
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
  const outperformPct = Math.round(Number(o.outperformPct ?? o.outperform_percent ?? o.outperformProzent));
  const analysts = Number(o.analysts ?? o.analystCount ?? o.anzahlAnalysten) || null;
  let upside = (o.upside != null && isFinite(Number(o.upside))) ? Math.round(Number(o.upside)) : null;
  // Plausibilität: unrealistische Kursziele (oft veraltete/falsche Websuche-Treffer) verwerfen.
  if (upside != null && (upside < -50 || upside > 120)) upside = null;
  let pe = (o.pe ?? o.kgv ?? o.peRatio) != null ? +Number(o.pe ?? o.kgv ?? o.peRatio).toFixed(1) : null;
  if (pe != null && (!isFinite(pe) || pe <= 0 || pe > 500)) pe = null;  // negatives/absurdes KGV verwerfen
  let sector = o.sector;
  if (!SECTOR_IDS.includes(sector)) sector = sectorForFinnhub(o.industry || o.branche || sector) || null;
  return { buyPct, outperformPct, analysts, upside, pe, sector };
}

/* (A) Kandidaten prüfen ------------------------------------------------ */
export async function checkCandidates(key, names) {
  if (!names.length) return [];
  const prompt = `Du recherchierst Analysten-Empfehlungen für Aktien über die Google-Suche (Quellen wie investing.com, marketscreener.com, finanzen.net, wallstreet-online).

Prüfe GENAU diese Aktien: ${names.map(n => '"' + n + '"').join(', ')}.

Für jede Aktie ermittle aus aktuellen Quellen:
- ticker (Börsenkürzel), name, land
- analysts: Anzahl coverender Analysten (auch 1 zählt)
- buyPct: Prozent der Empfehlungen, die Buy ODER Strong Buy sind (0-100)
- outperformPct: Prozent, die Strong Buy / Outperform sind (0-100)
- sector: GENAU eine dieser IDs anhand der Branche: ${SECTOR_LIST}
- upside: Kursziel-Potenzial in % falls auffindbar, sonst null
- pe: aktuelles KGV (Kurs-Gewinn-Verhältnis), Zahl oder null
- source: kurze Quellenangabe

Gib NUR ein JSON-Array zurück, ein Objekt je Aktie, die du sicher gefunden hast. Aktien ohne auffindbare Analystendaten weglassen. Kein Text außerhalb des JSON.`;

  const { text, sources } = await groundedJSON(key, prompt);
  const arr = extractJSON(text);
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const o of arr) {
    if (!o || !o.ticker) continue;
    const r = normRating(o);
    if (!r.sector || !isFinite(r.buyPct) || !isFinite(r.outperformPct)) continue;
    if (r.buyPct >= 95 && r.outperformPct >= 80) {
      out.push({
        ticker: String(o.ticker).toUpperCase(),
        name: o.name || o.ticker,
        sector: r.sector,
        buyPct: r.buyPct, outperformPct: r.outperformPct,
        analysts: r.analysts, upside: r.upside, pe: r.pe,
        via: 'gemini', source: o.source || sources[0] || 'web',
        seen: new Date().toISOString().slice(0, 10),
      });
    }
  }
  return out;
}

/* (B) Neue unbekannte Werte entdecken --------------------------------- */
export async function discoverNew(key, knownNames) {
  const known = knownNames.slice(0, 120).join(', ');
  const prompt = `Du suchst über die Google-Suche WELTWEIT kleine bis mittelgroße, eher UNBEKANNTE Aktien (Small-/Mid-Caps, gern aus Deutschland/Europa, aber auch USA/Asien), die von Analysten fast ausschließlich mit Kaufempfehlungen bewertet werden.

Kriterium: buyPct (Buy + Strong Buy) >= 95 UND outperformPct (Strong Buy/Outperform) >= 80. Anzahl Analysten egal (auch 1-3 reicht). Unternehmensgröße egal — je unbekannter/kleiner, desto besser. KEINE Mega-Caps (kein Apple, Microsoft, Nvidia, Amazon, Alphabet, Meta usw.).

Schlage NUR Aktien vor, die NICHT in dieser Liste bereits bekannter Werte stehen: ${known || '(noch keine)'}.

Für jeden Vorschlag gib aus aktuellen Quellen:
- ticker, name, land
- analysts, buyPct (0-100), outperformPct (0-100)
- sector: GENAU eine dieser IDs: ${SECTOR_LIST}
- upside (% oder null)
- pe: aktuelles KGV (Zahl oder null)
- source: kurze Quellenangabe

Gib NUR ein JSON-Array mit bis zu 8 solcher Aktien zurück. Kein Text außerhalb des JSON.`;

  const { text, sources } = await groundedJSON(key, prompt);
  const arr = extractJSON(text);
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const o of arr) {
    if (!o || !o.ticker) continue;
    const r = normRating(o);
    if (!r.sector || !isFinite(r.buyPct) || !isFinite(r.outperformPct)) continue;
    if (r.buyPct >= 95 && r.outperformPct >= 80) {
      out.push({
        ticker: String(o.ticker).toUpperCase(),
        name: o.name || o.ticker,
        sector: r.sector,
        buyPct: r.buyPct, outperformPct: r.outperformPct,
        analysts: r.analysts, upside: r.upside, pe: r.pe,
        via: 'gemini-discover', source: o.source || sources[0] || 'web',
        seen: new Date().toISOString().slice(0, 10),
      });
    }
  }
  return out;
}
