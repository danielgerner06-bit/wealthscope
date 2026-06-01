// Aktualisiert sectordata.json mit ECHTEN Daten.
//
// Datenquellen:
//  - Finnhub  (Secret FINNHUB_API_KEY): 30-Tage-Sektor-Performance über Sektor-ETFs
//    sowie Analystenratings, rollierend über ein großes Aktien-Universum gescannt.
//  - Gemini   (Secret GEMINI_API_KEY) : kurzer Analysetext zur Marktlage.
//
// Robust: fehlt ein Key oder schlägt eine Quelle fehl, bleibt der jeweils alte
// Stand erhalten (die Seite bekommt nie kaputte Daten). Der Aktien-Scan ist
// rollierend: pro Lauf wird nur ein Teil des Universums geprüft (Free-Tier-Limit),
// die Treffer werden in sectordata.json über die Tage aufgebaut und gepflegt.

import fs from 'node:fs';
import { SECTORS, SECTOR_IDS, sectorForFinnhub } from './sectors.mjs';
import { buildInsight } from './insight.mjs';
import {
  loadState, fetchSectorPerformance, scanAnalystStocks,
} from './finnhub.mjs';

const OUT = 'sectordata.json';
const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

// Wie viele Symbole pro Lauf maximal prüfen (Free-Tier: 60 Calls/Min).
const SCAN_BUDGET = Number(process.env.SCAN_BUDGET || 700);

function readPrev() {
  try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { return null; }
}

(async () => {
  const prev = readPrev();

  if (!FINNHUB_KEY) {
    console.error('FINNHUB_API_KEY fehlt – ohne Finnhub keine echten Daten. Bestehende Datei bleibt.');
    process.exit(1);
  }

  // Persistenter Zustand (Scan-Cursor, gesammelte Treffer-Datenbank).
  const state = loadState(prev);

  // 1) Sektor-Performance (30 Tage) über Sektor-ETFs.
  let bars30 = prev?.bars30 || [];
  try {
    bars30 = await fetchSectorPerformance(FINNHUB_KEY);
    console.log('Sektor-Performance aktualisiert.');
  } catch (e) {
    console.error('Performance-Abruf fehlgeschlagen, behalte alte Werte:', e.message);
  }

  // 2) Analystenratings rollierend scannen, Treffer-DB pflegen.
  let topStocks = prev?.topStocks || [];
  try {
    const result = await scanAnalystStocks(FINNHUB_KEY, state, SCAN_BUDGET);
    topStocks = result.topStocks;
    state.scan = result.scan;
    console.log(`Analysten-Scan: ${result.scan.scanned}/${result.scan.universe} geprüft, ${topStocks.length} Treffer in der DB.`);
  } catch (e) {
    console.error('Analysten-Scan fehlgeschlagen, behalte alte Treffer:', e.message);
  }

  // 3) Gemini-Analysetext (optional – ohne Key bleibt der alte Text).
  let insight = prev?.insight || '';
  if (GEMINI_KEY) {
    try {
      insight = await buildInsight(GEMINI_KEY, bars30, topStocks);
      console.log('Insight-Text aktualisiert.');
    } catch (e) {
      console.error('Insight-Generierung fehlgeschlagen, behalte alten Text:', e.message);
    }
  }

  const out = {
    updated: new Date().toISOString().slice(0, 10),
    source: 'Finnhub (Kurse & Analystenratings)' + (GEMINI_KEY ? ' · Gemini (Analyse)' : ''),
    sectors: SECTORS,
    bars30,
    topStocks,
    insight,
    scan: state.scan,
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log('sectordata.json geschrieben (' + out.updated + ').');
})().catch(err => {
  console.error('Update abgebrochen:', err.message);
  process.exit(1);
});
