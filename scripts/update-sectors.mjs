// Aktualisiert sectordata.json mit ECHTEN Daten.
//
// Datenquellen:
//  - Finnhub  (FINNHUB_API_KEY): 30-Tage-Sektor-Performance über Sektor-ETFs
//    + Analystenratings, rollierend über das US-Aktien-Universum gescannt.
//  - Gemini + Google-Search-Grounding (GEMINI_API_KEY):
//      * prüft eine wachsende Kandidatenliste (Nebenwerte) per Websuche,
//      * schlägt täglich NEUE unbekannte Treffer vor (kennt die bereits gefundenen),
//      * schreibt den kurzen Marktlage-Text.
//
// Alle Analysten-Treffer landen in einer gemeinsamen, über Tage gepflegten DB.
// Robust: fehlende Keys / Fehler lassen den jeweils alten Stand erhalten.

import fs from 'node:fs';
import { SECTORS } from './sectors.mjs';
import { buildSectorNotes } from './insight.mjs';
import { scanAnalystStocks } from './finnhub.mjs';
import { fetchSectorPerformance, fetchStockPerf6m } from './prices.mjs';
import { checkCandidates, discoverNew } from './gemini-stocks.mjs';
import { SEED_CANDIDATES } from './candidates.mjs';

const OUT = 'sectordata.json';
const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

const SCAN_BUDGET = Number(process.env.SCAN_BUDGET || 700);   // Finnhub-Symbole pro Lauf
const CAND_BUDGET = Number(process.env.CAND_BUDGET || 12);    // Kandidaten je Lauf (Gemini)

function readPrev() {
  try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { return null; }
}
const today = () => new Date().toISOString().slice(0, 10);

(async () => {
  const prev = readPrev();

  if (!FINNHUB_KEY && !GEMINI_KEY) {
    console.error('Weder FINNHUB_API_KEY noch GEMINI_API_KEY gesetzt. Bestehende Datei bleibt.');
    process.exit(1);
  }

  // DB der Treffer (ticker -> Eintrag) aus bisherigem Stand laden.
  const db = {};
  for (const s of (prev?.topStocks || [])) db[s.ticker] = s;

  // Persistenter Scan-/Kandidaten-Zustand.
  const scan = prev?.scan || { universe: 0, scanned: 0, lastCursor: 0, candCursor: 0 };
  let candidates = Array.isArray(prev?.scan?.candidates) && prev.scan.candidates.length
    ? prev.scan.candidates.slice()
    : SEED_CANDIDATES.slice();

  /* 1) Sektor-Performance (30 Tage + 360-Tage-Schnitt) via Yahoo (kein Key) -- */
  let bars30 = prev?.bars30 || [];
  try { bars30 = await fetchSectorPerformance(); console.log('Performance aktualisiert.'); }
  catch (e) { console.error('Performance-Abruf fehlgeschlagen, behalte alte:', e.message); }

  /* 2a) Finnhub-Analysten-Scan (US, rollierend) ---------------------- */
  if (FINNHUB_KEY) {
    try {
      const r = await scanAnalystStocks(FINNHUB_KEY, { scan, db }, SCAN_BUDGET);
      Object.assign(scan, r.scan);
      console.log(`Finnhub-Scan: ${scan.scanned}/${scan.universe} geprüft.`);
    } catch (e) { console.error('Finnhub-Scan fehlgeschlagen:', e.message); }
  }

  /* 2b) Gemini: Kandidaten prüfen (rollierend über die Liste) -------- */
  if (GEMINI_KEY) {
    try {
      const n = candidates.length;
      const start = (scan.candCursor || 0) % n;
      const slice = [];
      for (let i = 0; i < Math.min(CAND_BUDGET, n); i++) slice.push(candidates[(start + i) % n]);
      scan.candCursor = (start + slice.length) % n;

      const hits = await checkCandidates(GEMINI_KEY, slice);
      for (const h of hits) db[h.ticker] = { ...db[h.ticker], ...h };
      console.log(`Gemini-Kandidaten: ${slice.length} geprüft, ${hits.length} Treffer.`);
    } catch (e) { console.error('Gemini-Kandidatencheck fehlgeschlagen:', e.message); }
  }

  /* 2c) Gemini: neue unbekannte Werte entdecken ---------------------- */
  if (GEMINI_KEY) {
    try {
      const knownNames = Object.values(db).map(s => s.name).concat(candidates);
      const found = await discoverNew(GEMINI_KEY, knownNames);
      let added = 0;
      for (const f of found) {
        if (!db[f.ticker]) added++;
        db[f.ticker] = { ...db[f.ticker], ...f };
        // neu entdeckte Namen dauerhaft in die Kandidatenliste aufnehmen
        if (f.name && !candidates.includes(f.name)) candidates.push(f.name);
      }
      console.log(`Gemini-Discovery: ${found.length} Treffer, ${added} neu in der DB.`);
    } catch (e) { console.error('Gemini-Discovery fehlgeschlagen:', e.message); }
  }

  // Kandidatenliste begrenzen, damit sie nicht unbegrenzt wächst.
  if (candidates.length > 400) candidates = candidates.slice(candidates.length - 400);
  scan.candidates = candidates;

  // Top-Liste: nach Kursziel-Potenzial, dann Kauf-%. Bis zu 80 Perlen.
  let topStocks = Object.values(db)
    .sort((a, b) => (b.upside ?? -999) - (a.upside ?? -999) || (b.buyPct || 0) - (a.buyPct || 0))
    .slice(0, 80);

  /* 3) 6-Monats-Kursperformance je Aktie (Yahoo), rollierend nachladen --- */
  // Pro Lauf nur für Aktien ohne/alten 6M-Wert, damit es schnell bleibt.
  const STALE = 5 * 86400000; // 5 Tage
  const nowMs = Date.now();
  const needPerf = topStocks.filter(s => s.perf6m == null || !s.perf6mAt || (nowMs - Date.parse(s.perf6mAt)) > STALE)
    .slice(0, Number(process.env.PERF6M_BUDGET || 30));
  for (const s of needPerf) {
    const v = await fetchStockPerf6m(s.ticker);
    if (v != null) { s.perf6m = v; s.perf6mAt = today(); db[s.ticker] = { ...db[s.ticker], perf6m: v, perf6mAt: s.perf6mAt }; }
  }
  if (needPerf.length) console.log(`6M-Performance für ${needPerf.length} Aktien aktualisiert.`);

  /* 4) Sektor-Lage-Texte rollierend (2-3 Sektoren pro Lauf) ----------- */
  let sectorNotes = prev?.sectorNotes || {};
  if (GEMINI_KEY) {
    try {
      const ids = SECTORS.map(s => s.id);
      const start = (scan.noteCursor || 0) % ids.length;
      const PER = Number(process.env.NOTES_PER_RUN || 3);
      const todo = [];
      for (let i = 0; i < PER; i++) todo.push(ids[(start + i) % ids.length]);
      scan.noteCursor = (start + PER) % ids.length;
      const fresh = await buildSectorNotes(GEMINI_KEY, todo, bars30, topStocks);
      sectorNotes = { ...sectorNotes, ...fresh };
      console.log(`Sektor-Lage: ${Object.keys(fresh).length} Texte aktualisiert (${todo.join(', ')}).`);
    } catch (e) { console.error('Sektor-Lage fehlgeschlagen, behalte alte:', e.message); }
  }

  const out = {
    updated: today(),
    updatedAt: new Date().toISOString(),
    source: [FINNHUB_KEY && 'Finnhub', GEMINI_KEY && 'Gemini (Websuche & Analyse)'].filter(Boolean).join(' · '),
    sectors: SECTORS,
    bars30,
    topStocks,
    sectorNotes,
    scan,
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`sectordata.json geschrieben (${out.updated}). Treffer gesamt: ${topStocks.length}.`);
})().catch(err => { console.error('Update abgebrochen:', err.message); process.exit(1); });
