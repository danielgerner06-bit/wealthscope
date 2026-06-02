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
import { SECTORS, REGIONS } from './sectors.mjs';
import { buildNotes, buildNews } from './insight.mjs';
import { scanAnalystStocks, fetchMetric } from './finnhub.mjs';
import { fetchSectorPerformance, fetchRegionPerformance, fetchStockPerf6m } from './prices.mjs';
import { checkCandidates, discoverNew } from './gemini-stocks.mjs';
import { SEED_CANDIDATES } from './candidates.mjs';

const OUT = 'sectordata.json';
const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

const SCAN_BUDGET = Number(process.env.SCAN_BUDGET || 300);   // Finnhub-Symbole pro Lauf (8x/Tag = 2400)
const CAND_BUDGET = Number(process.env.CAND_BUDGET || 14);    // Kandidaten je Lauf (Gemini)

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

  /* 1) Sektor- & Regions-Performance (30T + 360T-Schnitt + 6M) via Yahoo (kein Key) -- */
  let bars30 = prev?.bars30 || [];
  let bars30Region = prev?.bars30Region || [];
  try { bars30 = await fetchSectorPerformance(); console.log('Sektor-Performance aktualisiert.'); }
  catch (e) { console.error('Sektor-Performance fehlgeschlagen, behalte alte:', e.message); }
  try { bars30Region = await fetchRegionPerformance(); console.log('Regions-Performance aktualisiert.'); }
  catch (e) { console.error('Regions-Performance fehlgeschlagen, behalte alte:', e.message); }

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

  /* 2b2) Bestehende Gemini-Perlen rollierend RE-VALIDIEREN -----------------
     Per Websuche erneut prüfen; wer das Kriterium (Kauf >= 80%) nicht mehr
     erfüllt, fliegt aus der DB. Finnhub-Werte werden ohnehin im Scan geprüft. */
  if (GEMINI_KEY) {
    try {
      const geminiTickers = Object.values(db)
        .filter(s => s.via && s.via.startsWith('gemini'))
        .map(s => ({ ticker: s.ticker, name: s.name }));
      if (geminiTickers.length) {
        const rn = geminiTickers.length;
        const rstart = (scan.recheckCursor || 0) % rn;
        const batch = [];
        for (let i = 0; i < Math.min(Number(process.env.RECHECK_BUDGET || 10), rn); i++) batch.push(geminiTickers[(rstart + i) % rn]);
        scan.recheckCursor = (rstart + batch.length) % rn;

        const names = batch.map(b => b.name + ' (' + b.ticker + ')');
        const stillOk = await checkCandidates(GEMINI_KEY, names);
        const okSet = new Set(stillOk.map(s => s.ticker));
        for (const s of stillOk) db[s.ticker] = { ...db[s.ticker], ...s };
        let dropped = 0;
        for (const b of batch) {
          if (!okSet.has(b.ticker) && db[b.ticker]) { delete db[b.ticker]; dropped++; }
        }
        console.log(`Re-Validierung: ${batch.length} Perlen geprüft, ${dropped} entfernt (Kriterium nicht mehr erfüllt).`);
      }
    } catch (e) { console.error('Re-Validierung fehlgeschlagen:', e.message); }
  }

  /* 2c) Gemini: neue unbekannte Werte entdecken (mehrere Foki pro Lauf) ---- */
  // Rotierende Schwerpunkte, damit über die Läufe breit gestreut neue Werte kommen.
  const FOCI = [
    'deutsche Small- und Mid-Caps (XETRA, SDAX, TecDAX)',
    'europäische Nebenwerte (Skandinavien, Benelux, Frankreich, Italien)',
    'US-amerikanische Small-Caps abseits der Mega-Caps',
    'asiatische Aktien (Japan, Südkorea, Taiwan, Indien)',
    'Technologie, Software und Halbleiter weltweit',
    'Gesundheit, Biotech und Medizintechnik weltweit',
    'Industrie, Energie und Rohstoffe weltweit',
    'Finanzwerte und Versorger weltweit',
  ];
  if (GEMINI_KEY) {
    const perRun = Number(process.env.DISCOVER_PER_RUN || 2);
    const start = (scan.focusCursor || 0) % FOCI.length;
    let added = 0, total = 0;
    for (let k = 0; k < perRun; k++) {
      const focus = FOCI[(start + k) % FOCI.length];
      try {
        const knownNames = Object.values(db).map(s => s.name).concat(candidates);
        const found = await discoverNew(GEMINI_KEY, knownNames, focus);
        total += found.length;
        for (const f of found) {
          if (!db[f.ticker]) added++;
          db[f.ticker] = { ...db[f.ticker], ...f };
          if (f.name && !candidates.includes(f.name)) candidates.push(f.name);
        }
      } catch (e) { console.error(`Discovery (${focus}) fehlgeschlagen:`, e.message); }
    }
    scan.focusCursor = (start + perRun) % FOCI.length;
    console.log(`Gemini-Discovery: ${total} Vorschläge, ${added} neu in der DB.`);
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
    const v = await fetchStockPerf6m(s.yahoo || s.ticker);   // Yahoo-Symbol bevorzugen (z. B. KTN.DE)
    if (v != null) { s.perf6m = v; s.perf6mAt = today(); db[s.ticker] = { ...db[s.ticker], perf6m: v, perf6mAt: s.perf6mAt }; }
  }
  if (needPerf.length) console.log(`6M-Performance für ${needPerf.length} Aktien aktualisiert.`);

  /* 3b) Echtes KGV je Aktie über Finnhub (verlässlicher als Gemini-Schätzung) ---
     Setzt pe sauber: Verlustfirmen bekommen null (kein KGV). Rollierend, mit Budget. */
  if (FINNHUB_KEY) {
    const needPe = topStocks.filter(s => s.peAt == null || (nowMs - Date.parse(s.peAt)) > STALE)
      .slice(0, Number(process.env.PE_BUDGET || 30));
    let peCount = 0;
    for (const s of needPe) {
      const { pe, eps } = await fetchMetric(s.ticker, FINNHUB_KEY);
      s.eps = eps; s.peAt = today();
      // Finnhub-KGV bevorzugen; wenn keins (z. B. Nicht-US-Wert), Gemini-KGV als Fallback,
      // aber nur plausibel (0–500) und nur wenn EPS nicht negativ ist.
      let peFinal = pe;
      if (peFinal == null && s.peGemini != null && s.peGemini > 0 && s.peGemini <= 500 && !(eps != null && eps < 0)) {
        peFinal = s.peGemini;
      }
      s.pe = peFinal;
      db[s.ticker] = { ...db[s.ticker], pe: peFinal, eps, peAt: s.peAt };
      if (peFinal != null) peCount++;
    }
    if (needPe.length) console.log(`KGV für ${needPe.length} Aktien geprüft, ${peCount} mit Wert (Finnhub + Gemini-Fallback).`);
  }

  /* 4) Knappe Lage-Texte rollierend: Sektoren UND Regionen ------------ */
  let sectorNotes = prev?.sectorNotes || {};
  let regionNotes = prev?.regionNotes || {};
  if (GEMINI_KEY) {
    const PER = Number(process.env.NOTES_PER_RUN || 3);
    try {
      const ids = SECTORS.map(s => s.id);
      const start = (scan.noteCursor || 0) % ids.length;
      const todo = []; for (let i = 0; i < PER; i++) todo.push(ids[(start + i) % ids.length]);
      scan.noteCursor = (start + PER) % ids.length;
      const fresh = await buildNotes(GEMINI_KEY, todo, bars30, topStocks, 'Sektor');
      sectorNotes = { ...sectorNotes, ...fresh };
      console.log(`Sektor-Lage: ${Object.keys(fresh).length}/${todo.length} (${todo.join(', ')}).`);
    } catch (e) { console.error('Sektor-Lage fehlgeschlagen:', e.message); }
    try {
      const rids = REGIONS.map(r => r.id);
      const rstart = (scan.regionNoteCursor || 0) % rids.length;
      const rtodo = []; for (let i = 0; i < PER; i++) rtodo.push(rids[(rstart + i) % rids.length]);
      scan.regionNoteCursor = (rstart + PER) % rids.length;
      const rfresh = await buildNotes(GEMINI_KEY, rtodo, bars30Region, topStocks, 'Region');
      regionNotes = { ...regionNotes, ...rfresh };
      console.log(`Region-Lage: ${Object.keys(rfresh).length}/${rtodo.length} (${rtodo.join(', ')}).`);
    } catch (e) { console.error('Region-Lage fehlgeschlagen:', e.message); }
  }

  /* 5) Markt-News-Ticker (max 3 wichtigste, via Google-Search) -------- */
  let news = prev?.news || null;
  if (GEMINI_KEY) {
    try { news = await buildNews(GEMINI_KEY); console.log(`News: ${news.items.length} Schlagzeilen.`); }
    catch (e) { console.error('News fehlgeschlagen, behalte alte:', e.message); }
  }

  const out = {
    updated: today(),
    updatedAt: new Date().toISOString(),
    source: [FINNHUB_KEY && 'Finnhub', GEMINI_KEY && 'Gemini (Websuche & Analyse)'].filter(Boolean).join(' · '),
    sectors: SECTORS,
    regions: REGIONS,
    bars30,
    bars30Region,
    topStocks,
    sectorNotes,
    regionNotes,
    news,
    scan,
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`sectordata.json geschrieben (${out.updated}). Treffer gesamt: ${topStocks.length}.`);
})().catch(err => { console.error('Update abgebrochen:', err.message); process.exit(1); });
