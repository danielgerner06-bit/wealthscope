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
import { SECTORS, REGIONS, sectorForFinnhub } from './sectors.mjs';
import { buildNotes, buildNews, buildFactorInsight } from './insight.mjs';
import { scanAnalystStocks } from './finnhub.mjs';
import { fetchSectorPerformance, fetchRegionPerformance, fetchStockPerf6m, enrichStock, fetchSectorOf, perfBetween } from './prices.mjs';
import { checkCandidates, discoverNew, verifyNoHold, MIN_BUY_PCT } from './gemini-stocks.mjs';
import { SEED_CANDIDATES } from './candidates.mjs';
import { SEED_SECTOR_NOTES, SEED_REGION_NOTES } from './seed-notes.mjs';
import { loadHistory, saveHistory, snapshotStocks, measureMilestones, pruneHistory, computeFindings } from './history.mjs';

const OUT = 'sectordata.json';
const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

const SCAN_BUDGET = Number(process.env.SCAN_BUDGET || 300);   // Finnhub-Symbole pro Lauf (kostet KEIN Gemini)
const CAND_BUDGET = Number(process.env.CAND_BUDGET || 8);     // Kandidaten je Lauf

// Gemini-Budget pro Lauf. Paid Tier (1.500 grounded Calls/Tag frei) -> großzügiger
// als früher (Free war eng). Reihenfolge im Code = Priorität.
const GEMINI_BUDGET = Number(process.env.GEMINI_BUDGET || 20);
let geminiUsed = 0;
let geminiDailyDead = false;   // gesetzt, sobald ein Call trotz Backoff am 429 scheitert (Tageslimit)
const geminiBudgetLeft = () => geminiUsed < GEMINI_BUDGET && !geminiDailyDead;
const useGemini = () => { geminiUsed++; };
// Wenn ein Gemini-Aufruf endgültig mit 429 scheitert, ist das Tageskontingent vermutlich leer
// -> restliche Gemini-Schritte dieses Laufs überspringen (statt je 20 min Backoff zu verbrennen).
const noteGeminiError = e => { if (/\b429\b/.test(String(e && e.message))) geminiDailyDead = true; };

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

  // Zeit-Konstanten früh definieren (werden in mehreren Schritten genutzt).
  const STALE = 5 * 86400000; // 5 Tage
  const nowMs = Date.now();

  // DB der Treffer (ticker -> Eintrag) aus bisherigem Stand laden.
  const db = {};
  for (const s of (prev?.topStocks || [])) db[s.ticker] = s;

  // Blacklist (vom Lösch-Button gesetzt): { TICKER: 'YYYY-MM-DD' bis wann gesperrt }.
  // Abgelaufene Sperren entfernen; gesperrte Ticker aus der DB werfen.
  const blacklist = prev?.blacklist || {};
  const todayISO = today();
  for (const [tk, until] of Object.entries(blacklist)) {
    if (until < todayISO) delete blacklist[tk];          // Sperre abgelaufen
    else if (db[tk]) delete db[tk];                       // noch gesperrt -> raus
  }
  const isBlacklisted = tk => blacklist[tk] && blacklist[tk] >= todayISO;

  // Einmalige Bereinigung: "Geister-Treffer" aus dem früheren breiten Finnhub-Scan
  // entfernen — 5-stellige OTC-/Pink-Sheet-Ticker (ohne Yahoo-Daten), die via=finnhub
  // sind und kein eigenes Yahoo-Symbol haben. Gemini-Funde (DE-Werte) bleiben unberührt.
  let purged = 0;
  for (const tk of Object.keys(db)) {
    const s = db[tk];
    if (s.via === 'finnhub' && !/^[A-Z]{1,4}$/.test(tk)) { delete db[tk]; purged++; }
  }
  // Einmalig (REVALIDATE_TAG): alle Gemini-Perlen zur Neuprüfung gegen die feste Quelle
  // (MarketScreener) freigeben -> recheckAt löschen, damit die Re-Validierung sie über die
  // nächsten Läufe neu bewertet und inkonsistente Altdaten (gemischte Quellen) ersetzt/aussortiert.
  const REVALIDATE_TAG = 'ms-verify-v7';   // unabhängige Gegenprüfung (verifyNoHold) -> alle neu prüfen
  if (purged) console.log(`Bereinigt: ${purged} OTC-Geister-Treffer entfernt.`);

  // Kriteriums-Bereinigung: bereits aufgenommene Treffer, die das aktuelle Kauf-%-Kriterium
  // nicht mehr erfüllen, sofort entfernen (nicht erst beim nächsten Scan ihres Symbols).
  // buyPct == null (noch nicht bewertet) bleibt drin, damit nichts vorschnell fliegt.
  let belowCut = 0;
  for (const tk of Object.keys(db)) {
    const bp = db[tk].buyPct;
    if (bp != null && bp < MIN_BUY_PCT) { delete db[tk]; belowCut++; }
  }
  if (belowCut) console.log(`Bereinigt: ${belowCut} Treffer unter ${MIN_BUY_PCT}% Kauf entfernt.`);

  // Bereinigung (am Anfang UND am Ende): entfernt Gemini-Perlen, die den strengen MS-Ablauf
  // NICHT (mehr) erfüllen — inkonsistente Counts ODER (nach mind. 1 Re-Validierungs-Versuch)
  // weiterhin ohne gültige MS-Counts + /consensus/-Link. So bleibt nur, was den Ablauf besteht.
  const validMsLink = u => !!u && /^https?:\/\/(www\.)?marketscreener\.com\/quote\/stock\/[^\/]+\//i.test(u) && /consensus\/?$/i.test(u);
  const cleanInconsistent = (label) => {
    let nInc = 0, nNo = 0;
    for (const tk of Object.keys(db)) {
      const s = db[tk];
      if (!(s.via && s.via.startsWith('gemini'))) continue;
      const c = s.ratingCounts;
      const cleanCounts = c && !('strongBuy' in c);
      if (cleanCounts) {
        const sum = (c.buy || 0) + (c.outperform || 0) + (c.hold || 0) + (c.underperform || 0) + (c.sell || 0);
        // inkonsistent ODER Hold/Under/Sell>0 ODER ungültiger Link -> raus
        if ((s.analysts && sum > 0 && s.analysts !== sum) || c.hold || c.underperform || c.sell || !validMsLink(s.ratingUrl)) { delete db[tk]; nInc++; }
      } else {
        // Gemini-Perle OHNE saubere MS-Counts (Altbestand/nie sauber gelesen) -> raus.
        // Erfüllt sie den strengen Ablauf wirklich (100%, Link), findet die Discovery sie neu.
        delete db[tk]; nNo++;
      }
    }
    if (nInc || nNo) console.log(`Bereinigt (${label}): ${nInc} inkonsistent, ${nNo} ohne gültige MS-Daten entfernt.`);
  };
  cleanInconsistent('Start');

  // Persistenter Scan-/Kandidaten-Zustand.
  const scan = prev?.scan || { universe: 0, scanned: 0, lastCursor: 0, candCursor: 0 };
  let candidates = Array.isArray(prev?.scan?.candidates) && prev.scan.candidates.length
    ? prev.scan.candidates.slice()
    : SEED_CANDIDATES.slice();

  // Einmalige Neuprüfungs-Freigabe (s. REVALIDATE_TAG): recheckAt aller Gemini-Perlen löschen
  // + alte ratingCounts (anderes Format) verwerfen -> saubere Neuermittlung mit MS-Skala.
  if (scan.revalidateTag !== REVALIDATE_TAG) {
    let freed = 0;
    for (const s of Object.values(db)) if (s.via && s.via.startsWith('gemini')) {
      if (s.recheckAt) { delete s.recheckAt; freed++; }
      if (s.ratingCounts) delete s.ratingCounts;   // altes strongBuy-Format raus
    }
    scan.revalidateTag = REVALIDATE_TAG;
    if (freed) console.log(`Re-Validierung freigegeben: ${freed} Gemini-Perlen werden mit MS-Skala neu geprüft.`);
  }

  // Takt-Trennung: Yahoo-Daten (Kurse/Performance, kein Limit) laufen JEDEN Lauf (stündlich).
  // Die limitierten Quellen Gemini + Finnhub nur, wenn seit dem letzten "schweren" Lauf
  // >= HEAVY_GAP_H Stunden vergangen sind (Default 6h). Spart das Gemini-Free-Tier-Kontingent.
  const HEAVY_GAP_MS = Number(process.env.HEAVY_GAP_H || 6) * 3600000 - 5 * 60000; // 5 min Toleranz für Cron-Jitter
  const heavyDue = !scan.heavyAt || (nowMs - Date.parse(scan.heavyAt)) >= HEAVY_GAP_MS;

  // Mehrere Cron-Slots pro Stunde (gegen GitHubs unzuverlässige :00-Zustellung) könnten
  // kurz hintereinander feuern. Ein NICHT-schwerer Lauf, dessen letzter Lauf < MIN_GAP_MIN
  // her ist, bricht hier ab -> Yahoo wird höchstens ~1×/Stunde geholt, keine Doppelläufe.
  const MIN_GAP_MIN = Number(process.env.MIN_GAP_MIN || 50);
  const lastRunMs = prev?.updatedAt ? Date.parse(prev.updatedAt) : 0;
  const tooSoon = lastRunMs && (nowMs - lastRunMs) < MIN_GAP_MIN * 60000;
  if (tooSoon && !heavyDue && !process.env.FORCE_RUN) {
    const mins = Math.round((nowMs - lastRunMs) / 60000);
    console.log(`Übersprungen: letzter Lauf vor ${mins} min (< ${MIN_GAP_MIN} min), kein schwerer Lauf fällig.`);
    return;   // nichts schreiben -> Git-Diff leer -> kein Commit
  }

  console.log(heavyDue ? 'Lauf-Typ: VOLL (Yahoo + Gemini + Finnhub).' : 'Lauf-Typ: leicht (nur Yahoo-Kurse/Performance).');
  if (heavyDue) scan.heavyAt = new Date(nowMs).toISOString();   // Zeitstempel für die 6h-Taktung

  /* 1) Sektor- & Regions-Performance (30T + 360T-Schnitt + 6M) via Yahoo (kein Key) -- */
  let bars30 = prev?.bars30 || [];
  let bars30Region = prev?.bars30Region || [];
  try { bars30 = await fetchSectorPerformance(); console.log('Sektor-Performance aktualisiert.'); }
  catch (e) { console.error('Sektor-Performance fehlgeschlagen, behalte alte:', e.message); }
  try { bars30Region = await fetchRegionPerformance(); console.log('Regions-Performance aktualisiert.'); }
  catch (e) { console.error('Regions-Performance fehlgeschlagen, behalte alte:', e.message); }

  /* 1b) Markt-News ZUERST (höchste Priorität im Gemini-Budget) */
  let news = prev?.news || null;
  if (GEMINI_KEY && heavyDue && geminiBudgetLeft()) {
    useGemini();
    try { news = await buildNews(GEMINI_KEY); console.log(`News: ${news.items.length} Schlagzeilen.`); }
    catch (e) { noteGeminiError(e); console.error('News fehlgeschlagen, behalte alte:', e.message); }
  }

  /* 2a) Finnhub-Analysten-Scan (US, rollierend) ---------------------- */
  scan.seenBySector = scan.seenBySector || {};   // geprüfte Aktien je Sektor (für Trefferquote)
  scan.pendingReject = scan.pendingReject || []; // abgelehnte Ticker, deren Sektor noch via Yahoo zu klären ist
  if (FINNHUB_KEY && heavyDue) {
    try {
      const state = { scan, db };
      const r = await scanAnalystStocks(FINNHUB_KEY, state, SCAN_BUDGET);
      Object.assign(scan, r.scan);
      // abgelehnte Ticker zur Sektor-Auflösung vormerken (max. 300 in der Queue)
      for (const t of (state._rejected || [])) if (!scan.pendingReject.includes(t)) scan.pendingReject.push(t);
      if (scan.pendingReject.length > 2000) scan.pendingReject = scan.pendingReject.slice(-2000);
      console.log(`Finnhub-Scan: ${scan.scanned}/${scan.universe} geprüft, ${(state._rejected || []).length} abgelehnt.`);
    } catch (e) { console.error('Finnhub-Scan fehlgeschlagen:', e.message); }
  }

  /* 2a2) Sektor abgelehnter Aktien via Yahoo klären (kein Kontingent) -> Trefferquote.
     Yahoo hat kein Tageslimit, daher großzügiges Budget pro Lauf. */
  if (scan.pendingReject.length) {
    const batch = scan.pendingReject.splice(0, Number(process.env.SECTORRESOLVE_BUDGET || 150));
    let resolved = 0;
    for (const sym of batch) {
      const info = await fetchSectorOf(sym);
      const sid = info ? sectorForFinnhub(info.industry || info.sector) : null;
      if (sid) { scan.seenBySector[sid] = (scan.seenBySector[sid] || 0) + 1; resolved++; }
      // ohne klaren Sektor: verwerfen (nicht zurück in die Queue, sonst Endlosschleife)
    }
    if (batch.length) console.log(`Sektor-Auflösung: ${resolved}/${batch.length} abgelehnte Aktien zugeordnet.`);
  }

  /* 2c) Gemini: neue unbekannte Werte entdecken (1 Fokus/Lauf, rotierend) -- */
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
  if (GEMINI_KEY && heavyDue && geminiBudgetLeft()) {
    useGemini();
    const focus = FOCI[(scan.focusCursor || 0) % FOCI.length];
    scan.focusCursor = ((scan.focusCursor || 0) + 1) % FOCI.length;
    try {
      const knownNames = Object.values(db).map(s => s.name).concat(candidates);
      const found = await discoverNew(GEMINI_KEY, knownNames, focus);
      // Discovery erzeugt NIE direkt Perlen — nur Kandidaten. Aufnahme erst über
      // checkCandidates + unabhängige Gegenprüfung (verifyNoHold). "Im Zweifel raus".
      let queued = 0;
      for (const f of found) {
        if (f.name && !candidates.includes(f.name)) { candidates.push(f.name); queued++; }
      }
      console.log(`Gemini-Discovery (${focus}): ${found.length} Vorschläge, ${queued} als Kandidat vorgemerkt (Aufnahme erst nach Gegenprüfung).`);
    } catch (e) { noteGeminiError(e); console.error('Discovery fehlgeschlagen:', e.message); }
  }

  /* 2b) Gemini: Kandidaten prüfen (rollierend) ---------------------- */
  if (GEMINI_KEY && heavyDue && geminiBudgetLeft() && candidates.length) {
    useGemini();
    try {
      const n = candidates.length;
      const start = (scan.candCursor || 0) % n;
      const slice = [];
      for (let i = 0; i < Math.min(CAND_BUDGET, n); i++) slice.push(candidates[(start + i) % n]);
      scan.candCursor = (start + slice.length) % n;
      const hits = await checkCandidates(GEMINI_KEY, slice);
      // Stufe 1: nur Treffer mit sauberen MS-Counts kommen in die engere Wahl.
      const clean = hits.filter(h => h.ratingCounts && !('strongBuy' in h.ratingCounts) && !h.countsBad);
      // Stufe 2: UNABHÄNGIGE Gegenprüfung über mehrere Quellen ("im Zweifel raus").
      // Nur Aktien, die KEINEN Hold/Sell haben, werden tatsächlich Perle.
      let confirmed = new Set();
      if (clean.length) { useGemini(); confirmed = await verifyNoHold(GEMINI_KEY, clean); }
      let kept = 0;
      for (const h of clean) {
        if (!confirmed.has(h.ticker.toUpperCase())) continue;   // Gegenprüfung nicht bestanden -> NICHT aufnehmen
        db[h.ticker] = { ...db[h.ticker], ...h, verifiedAt: today() }; kept++;
      }
      console.log(`Gemini-Kandidaten: ${slice.length} geprüft, ${clean.length} mit Counts, ${kept} nach Gegenprüfung aufgenommen.`);
    } catch (e) { noteGeminiError(e); console.error('Gemini-Kandidatencheck fehlgeschlagen:', e.message); }
  }

  /* 2b2) Bestehende Gemini-Perlen RE-VALIDIEREN — nur 1× pro WOCHE je Perle.
     Analysten-Kaufempfehlungen ändern sich langsam; häufiger zu prüfen wäre
     verschwendetes Kontingent. Nur Perlen ohne/mit >7 Tage altem recheckAt. */
  const RECHECK_AGE = 7 * 86400000;
  if (GEMINI_KEY && heavyDue && geminiBudgetLeft()) {
    const allDue = Object.values(db)
      .filter(s => s.via && s.via.startsWith('gemini'))
      .filter(s => !s.verifiedAt || !s.recheckAt || (nowMs - Date.parse(s.recheckAt)) > RECHECK_AGE)
      // noch nie unabhängig gegengeprüfte Perlen zuerst (Bestand schnell verifizieren/aussortieren)
      .sort((a, b) => (a.verifiedAt ? 1 : 0) - (b.verifiedAt ? 1 : 0));
    const BATCH = Number(process.env.RECHECK_BUDGET || 8);        // Namen pro Gemini-Call (klein -> saubere Daten je Aktie)
    const ROUNDS = Number(process.env.RECHECK_ROUNDS || 3);       // Batches pro Lauf (Paid Tier -> schnellerer Abbau des Rückstands)
    const MAX_MISS = Number(process.env.RECHECK_MAX_MISS || 3);
    let checked = 0, dropped = 0, round = 0;
    while (round < ROUNDS && geminiBudgetLeft()) {
      const due = allDue.slice(round * BATCH, round * BATCH + BATCH);
      if (!due.length) break;
      round++; useGemini();
      try {
        const names = due.map(b => b.name + ' (' + b.ticker + ')');
        const stillOk = (await checkCandidates(GEMINI_KEY, names))
          .filter(s => s.ratingCounts && !('strongBuy' in s.ratingCounts) && !s.countsBad);  // nur saubere Counts gelten als "ok"
        // UNABHÄNGIGE Gegenprüfung ("im Zweifel raus"): bestätigt eine skeptische
        // Mehrquellen-Prüfung 0 Hold/Sell? Nur dann bleibt die Perle.
        let confirmed = new Set();
        if (stillOk.length) { useGemini(); confirmed = await verifyNoHold(GEMINI_KEY, stillOk); }
        const okSet = new Set(stillOk.filter(s => confirmed.has(s.ticker.toUpperCase())).map(s => s.ticker));
        // Bestätigte Treffer -> Daten aktualisieren, miss zurücksetzen.
        for (const s of stillOk) if (confirmed.has(s.ticker.toUpperCase())) {
          db[s.ticker] = { ...db[s.ticker], ...s, miss: 0, recheckAt: today(), verifiedAt: today() };
        }
        // Alles, was die Gegenprüfung NICHT besteht (Hold/Sell gefunden ODER unsicher),
        // wird SOFORT entfernt — gemäß Vorgabe lieber raus als fälschlich drin lassen.
        for (const b of due) {
          if (okSet.has(b.ticker) || !db[b.ticker]) continue;
          delete db[b.ticker]; dropped++;
        }
        checked += due.length;
      } catch (e) { noteGeminiError(e); console.error('Re-Validierung fehlgeschlagen:', e.message); break; }
    }
    if (checked) console.log(`Re-Validierung: ${checked} geprüft (${round} Batches), ${dropped} entfernt, ${Math.max(0, allDue.length - checked)} verbleibend.`);
    else console.log('Re-Validierung: keine Perle fällig.');
  }

  // Kandidatenliste begrenzen, damit sie nicht unbegrenzt wächst.
  if (candidates.length > 400) candidates = candidates.slice(candidates.length - 400);
  scan.candidates = candidates;

  // Top-Liste: nach Kursziel-Potenzial, dann Kauf-%. KEINE Obergrenze — alle
  // qualifizierten Treffer (> 50 % Kauf) werden angezeigt. Sortierung = beste zuerst.
  // gesperrte Ticker (Lösch-Button, 3-Monats-Sperre) NICHT aufnehmen — auch wenn der
  // Scan/Discovery sie zwischenzeitlich wieder gefunden hat.
  for (const tk of Object.keys(db)) if (isBlacklisted(tk)) delete db[tk];
  cleanInconsistent('Ende');   // von Discovery/Re-Validierung neu eingebrachte Fehler vor dem Speichern raus
  let topStocks = Object.values(db)
    .sort((a, b) => (b.upside ?? -999) - (a.upside ?? -999) || (b.buyPct || 0) - (a.buyPct || 0));

  /* 3) 6-Monats-Kursperformance je Aktie (Yahoo), rollierend nachladen --- */
  // Pro Lauf nur für Aktien ohne/alten 6M-Wert, damit es schnell bleibt.
  const needPerf = topStocks.filter(s => s.perf6m == null || !s.perf6mAt || (nowMs - Date.parse(s.perf6mAt)) > STALE)
    .slice(0, Number(process.env.PERF6M_BUDGET || 40));
  for (const s of needPerf) {
    const v = await fetchStockPerf6m(s.yahoo || s.ticker);   // Yahoo-Symbol bevorzugen (z. B. KTN.DE)
    if (v != null) { s.perf6m = v; s.perf6mAt = today(); db[s.ticker] = { ...db[s.ticker], perf6m: v, perf6mAt: s.perf6mAt }; }
  }
  if (needPerf.length) console.log(`6M-Performance für ${needPerf.length} Aktien aktualisiert.`);

  /* 3a2) 1-Monats-Performance VOR Aufnahme (Momentum) je Perle, EINMALIG aus Yahoo.
     = Kursentwicklung im Monat vor dem seen-Datum. Fix gespeichert (ändert sich nicht). */
  const dayMs = d => new Date((d || today()) + 'T00:00:00Z').getTime();
  const needPre = topStocks.filter(s => s.perf1mBefore === undefined)
    .slice(0, Number(process.env.PRE1M_BUDGET || 40));
  for (const s of needPre) {
    const seenMs = dayMs(s.seen);
    const v = await perfBetween(s.yahoo || s.ticker, seenMs - 30 * 86400000, seenMs);
    s.perf1mBefore = (v == null ? null : v);   // null = nicht ermittelbar (verhindert erneutes Versuchen)
    db[s.ticker] = { ...db[s.ticker], perf1mBefore: s.perf1mBefore };
  }
  if (needPre.length) console.log(`1M-vor-Aufnahme für ${needPre.length} Perlen gesetzt.`);


  /* 3b) Kursziel + KGV + EPS + Analysten je Aktie über Yahoo (1 Call, kein Key,
     funktioniert auch für deutsche Werte). Ersetzt die alte Finnhub-Anreicherung. */
  {
    // Anreichern wenn: noch nie, veraltet (>STALE), ODER ein neues Feld fehlt noch ganz
    // (z. B. div nach Feature-Einführung) -> zieht neue Datenfelder einmalig nach.
    const needEnrich = topStocks.filter(s =>
      s.enrichAt == null || (nowMs - Date.parse(s.enrichAt)) > STALE || s.div === undefined)
      .slice(0, Number(process.env.ENRICH_BUDGET || 40));
    // Kandidaten-Yahoo-Symbole (Name -> Symbol) aus früheren Gemini-Funden, zum Nachschlagen
    let upCount = 0, peCount = 0;
    for (const s of needEnrich) {
      // Symbol bestimmen: explizites yahoo-Feld, sonst Ticker; bei Fehlschlag .DE-Fallback
      let e = await enrichStock(s.yahoo || s.ticker);
      if (!e && !s.yahoo && /^[A-Z0-9]{1,5}$/.test(s.ticker)) {
        // deutsche/europäische Nebenwerte hängen an .DE (z. B. KTN -> KTN.DE)
        e = await enrichStock(s.ticker + '.DE');
        if (e) { s.yahoo = s.ticker + '.DE'; }
      }
      if (!e) {
        // auch bei Fehlschlag markieren (sonst jeder Lauf erneut). div explizit auf null,
        // damit "s.div === undefined" nicht endlos sofortige Re-Enrichments triggert.
        s.enrichAt = today(); if (s.div === undefined) s.div = null;
        db[s.ticker] = { ...db[s.ticker], enrichAt: s.enrichAt, div: s.div ?? null };
        continue;
      }
      if (e.upside != null) { s.upside = e.upside; upCount++; }
      // KGV: Yahoo-Wert; bei Verlust (EPS < 0) bewusst kein KGV
      s.pe = (e.eps != null && e.eps < 0) ? null : e.pe;
      if (e.eps != null) s.eps = e.eps;
      // Analystenzahl: bei sauberen MS-Counts ist deren Summe maßgeblich (100%-Kriterium).
      // Yahoos Zahl zählt ALLE Analysten (auch Hold/Sell) -> würde analysts!==sum machen
      // und die Konsistenzprüfung brechen. Nur als Fallback ohne MS-Counts übernehmen.
      const hasMsCounts = s.ratingCounts && !('strongBuy' in s.ratingCounts);
      if (e.analysts != null && !hasMsCounts) s.analysts = e.analysts;
      s.div = e.divYield;   // Dividendenrendite in % (null = keine Dividende)
      s.enrichAt = today();
      if (s.pe != null) peCount++;
      db[s.ticker] = { ...db[s.ticker], upside: s.upside, pe: s.pe, eps: s.eps, analysts: s.analysts, div: s.div, yahoo: s.yahoo, enrichAt: s.enrichAt };
    }
    if (needEnrich.length) console.log(`Yahoo-Anreicherung: ${needEnrich.length} Aktien, ${upCount} mit Kursziel, ${peCount} mit KGV.`);
  }

  /* 4) Lage-Texte: NUR 1× pro Tag je 1 Sektor + 1 Region (rollierend) -- */
  let sectorNotes = prev?.sectorNotes || {};
  let regionNotes = prev?.regionNotes || {};
  // Start-Texte einsetzen, wo noch keiner steht -> sofort überall etwas da,
  // Gemini überarbeitet sie dann rollierend. seed=true markiert Platzhalter.
  for (const id of Object.keys(SEED_SECTOR_NOTES)) {
    if (!sectorNotes[id]) sectorNotes[id] = { text: SEED_SECTOR_NOTES[id], date: null, seed: true };
  }
  for (const id of Object.keys(SEED_REGION_NOTES)) {
    if (!regionNotes[id]) regionNotes[id] = { text: SEED_REGION_NOTES[id], date: null, seed: true };
  }
  const todayStr = today();
  const notesDoneToday = scan.notesDay === todayStr;
  if (GEMINI_KEY && heavyDue && !notesDoneToday) {
    let ok = false;   // mind. EIN Lagetext erfolgreich -> erst dann "heute erledigt"
    if (geminiBudgetLeft()) {
      useGemini();
      try {
        const ids = SECTORS.map(s => s.id);
        const id = ids[(scan.noteCursor || 0) % ids.length];
        scan.noteCursor = ((scan.noteCursor || 0) + 1) % ids.length;
        const fresh = await buildNotes(GEMINI_KEY, [id], bars30, topStocks, 'Sektor');
        sectorNotes = { ...sectorNotes, ...fresh };
        console.log(`Sektor-Lage: ${Object.keys(fresh).length}/1 (${id}).`); ok = true;
      } catch (e) { noteGeminiError(e); console.error('Sektor-Lage fehlgeschlagen:', e.message); }
    }
    if (geminiBudgetLeft()) {
      useGemini();
      try {
        const rids = REGIONS.map(r => r.id);
        const rid = rids[(scan.regionNoteCursor || 0) % rids.length];
        scan.regionNoteCursor = ((scan.regionNoteCursor || 0) + 1) % rids.length;
        const rfresh = await buildNotes(GEMINI_KEY, [rid], bars30Region, topStocks, 'Region');
        regionNotes = { ...regionNotes, ...rfresh };
        console.log(`Region-Lage: ${Object.keys(rfresh).length}/1 (${rid}).`); ok = true;
      } catch (e) { noteGeminiError(e); console.error('Region-Lage fehlgeschlagen:', e.message); }
    }
    if (ok) scan.notesDay = todayStr;   // nur bei Erfolg "heute erledigt" -> bei 429 erneut versuchen
  }

  /* 6) Backtest-Historie pflegen (Snapshots + Monats-Performance; Yahoo, kein Kontingent) */
  try {
    const hist = loadHistory();
    const snapped = await snapshotStocks(hist, topStocks, Number(process.env.SNAPSHOT_BUDGET || 30));
    // NUR echte Monatswerte: für jeden vergangenen Monat seit Aufnahme die Performance messen.
    // KEIN provisorischer 1M-Wert mehr (seedBacktest1m) — echte Daten reifen über die Monate.
    const measured = await measureMilestones(hist, Number(process.env.MILESTONE_BUDGET || 40));
    const pruned = pruneHistory(hist);
    console.log(`Historie: ${Object.keys(hist.entries).length} Aktien (${snapped} neu, ${measured} Monatspunkte, ${pruned} entfernt).`);

    // KI-Analyse der stärksten Faktoren — 1× pro Tag (Budget-schonend)
    const findings = computeFindings(hist);
    hist.findings = findings;
    if (GEMINI_KEY && heavyDue && geminiBudgetLeft() && hist.kiDay !== today() && findings.factors.length) {
      useGemini();
      try { hist.kiAnalysis = await buildFactorInsight(GEMINI_KEY, findings); hist.kiDay = today(); console.log('Faktor-KI-Analyse aktualisiert.'); }
      catch (e) { noteGeminiError(e); console.error('Faktor-KI fehlgeschlagen:', e.message); }
    }
    saveHistory(hist);
  } catch (e) { console.error('Historie fehlgeschlagen:', e.message); }

  /* Trefferquoten-Basis je Sektor: geprüfte Aktien = abgelehnte (Scan) + Perlen (akzeptiert).
     Die Perlen sind selbst geprüfte Treffer und gehören in den Nenner. So hat JEDER Sektor
     mit mindestens einer Perle immer eine berechenbare Quote (nie „unbekannt"). */
  scan.seenBySector = scan.seenBySector || {};
  const evaluatedBySector = { ...scan.seenBySector };
  for (const s of topStocks) {
    if (!s.sector) continue;
    evaluatedBySector[s.sector] = (evaluatedBySector[s.sector] || 0) + 1;   // Perle = geprüfter Treffer
  }
  scan.evaluatedBySector = evaluatedBySector;

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
    blacklist,
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`sectordata.json geschrieben (${out.updated}). Treffer gesamt: ${topStocks.length}.`);
})().catch(err => { console.error('Update abgebrochen:', err.message); process.exit(1); });
