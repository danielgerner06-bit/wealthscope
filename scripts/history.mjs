// Backtest-Historie: für jede je aufgenommene Perle ein Snapshot der Kennzahlen
// beim Hinzufügen + feste Performance-Meilensteine (1M/3M/6M/1J) seit Aufnahme.
// Bleibt 1 Jahr erhalten, auch wenn die Aktie nicht mehr in den aktuellen Perlen ist.
import fs from 'node:fs';
import { priceAtDate, perfBetween } from './prices.mjs';

const FILE = 'history.json';
const MS_DAY = 86400000;
const MILESTONES = [['perf1m', 30], ['perf3m', 90], ['perf6m', 182], ['perf1j', 365]];

export function loadHistory() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { entries: {} }; }
}
export function saveHistory(h) { fs.writeFileSync(FILE, JSON.stringify(h, null, 2)); }

const dayMs = d => new Date(d + 'T00:00:00Z').getTime();

// Grobe Region aus dem Yahoo-Börsensuffix (US ohne Suffix).
function regionOf(sym) {
  if (!sym) return null;
  const suf = sym.includes('.') ? sym.split('.').pop() : '';
  const map = { DE: 'europe', PA: 'europe', AS: 'europe', MI: 'europe', L: 'europe', SW: 'europe', ST: 'europe', HE: 'europe', BR: 'europe', VI: 'europe', MC: 'europe',
    T: 'japan', HK: 'china', SS: 'china', SZ: 'china', KS: 'apac', TW: 'apac', NS: 'india', BO: 'india', AX: 'apac', SA: 'latam', MX: 'latam' };
  return suf ? (map[suf] || 'world') : 'usa';
}

// Snapshot je aktueller Perle anlegen (einmalig, mit Aufnahmekurs aus Yahoo-Historie).
// budget = max. Startkurs-Abrufe pro Lauf (Yahoo, kein Kontingent, aber Zeit).
export async function snapshotStocks(hist, topStocks, budget = 30) {
  const e = hist.entries;
  let added = 0;
  for (const s of topStocks) {
    if (e[s.ticker]) {
      // bestehenden Snapshot mit ggf. neuen Kennzahlen auffrischen (Aufnahmedaten bleiben)
      const x = e[s.ticker];
      x.sector = s.sector ?? x.sector; x.buyPct = s.buyPct ?? x.buyPct;
      x.outperformPct = s.outperformPct ?? x.outperformPct; x.upside = s.upside ?? x.upside;
      x.pe = s.pe ?? x.pe; x.perf6mAtAdd = x.perf6mAtAdd ?? s.perf6m;
      x.analysts = s.analysts ?? x.analysts; x.div = s.div ?? x.div;
      continue;
    }
    if (added >= budget) continue;
    const seenStr = s.seen || new Date().toISOString().slice(0, 10);
    const sym = s.yahoo || s.ticker;
    const startMs = dayMs(seenStr);
    const startPrice = await priceAtDate(sym, startMs);
    if (startPrice == null) { continue; }   // ohne Startkurs kein Backtest -> später erneut versuchen
    e[s.ticker] = {
      ticker: s.ticker, name: s.name, yahoo: sym,
      seen: seenStr, seenMs: startMs, startPrice,
      sector: s.sector, region: regionOf(sym),
      buyPct: s.buyPct ?? null, outperformPct: s.outperformPct ?? null,
      upside: s.upside ?? null, pe: s.pe ?? null, perf6mAtAdd: s.perf6m ?? null,
      analysts: s.analysts ?? null, div: s.div ?? null,
      perf1m: null, perf3m: null, perf6m: null, perf1j: null,
    };
    added++;
  }
  return added;
}

// Fällige Meilensteine messen: wenn Aktie alt genug & Wert noch nicht gesetzt -> einmal berechnen.
export async function measureMilestones(hist, budget = 30) {
  const now = Date.now();
  let measured = 0;
  for (const x of Object.values(hist.entries)) {
    if (measured >= budget) break;
    if (x.startPrice == null) continue;
    for (const [key, days] of MILESTONES) {
      if (x[key] != null) continue;                       // schon gemessen -> fix
      const dueMs = x.seenMs + days * MS_DAY;
      if (now < dueMs) continue;                           // noch nicht fällig
      const v = await perfBetween(x.yahoo || x.ticker, x.seenMs, dueMs);
      if (v != null) { x[key] = v; measured++; }
      if (measured >= budget) break;
    }
  }
  return measured;
}

// Einträge älter als 1 Jahr entfernen + abgelaufene Demo-Aktien (fake) löschen.
export function pruneHistory(hist) {
  const now = Date.now();
  const cutoff = now - 366 * MS_DAY;
  const todayStr = new Date().toISOString().slice(0, 10);
  let removed = 0;
  for (const [tk, x] of Object.entries(hist.entries)) {
    const old = x.seenMs && x.seenMs < cutoff;
    const fakeExpired = x.fake && (!x.fakeUntil || x.fakeUntil <= todayStr); // Demo-Aktien nach Ablauf weg
    if (old || fakeExpired) { delete hist.entries[tk]; removed++; }
  }
  return removed;
}
