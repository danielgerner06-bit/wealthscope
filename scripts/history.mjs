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

// Faktor-Befunde aus der Historie berechnen (für die KI-Analyse): je Faktor die
// beste/schlechteste Stufe nach Ø-6M-Performance + die stärkste Zweier-Kombination.
export function computeFindings(hist) {
  const data = Object.values(hist.entries);
  const perfKey = 'perf6m';
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const buckets = {
    KGV: s => s.pe == null ? null : s.pe < 15 ? '<15' : s.pe < 25 ? '15-25' : s.pe < 40 ? '25-40' : '40+',
    Outperform: s => s.outperformPct == null ? null : s.outperformPct < 70 ? '<70%' : s.outperformPct < 85 ? '70-85%' : s.outperformPct < 95 ? '85-95%' : '95%+',
    Kursziel: s => s.upside == null ? null : s.upside < 10 ? '<10%' : s.upside < 25 ? '10-25%' : s.upside < 40 ? '25-40%' : '40%+',
    Dividende: s => s.div == null ? null : s.div === 0 ? 'keine' : s.div < 2 ? '<2%' : s.div < 4 ? '2-4%' : '4%+',
    Analysten: s => s.analysts == null ? null : s.analysts < 5 ? '1-4' : s.analysts < 15 ? '5-14' : '15+',
  };
  const factors = [];
  for (const [name, fn] of Object.entries(buckets)) {
    const g = {};
    data.forEach(s => { const k = fn(s), p = s[perfKey]; if (k != null && p != null) (g[k] = g[k] || []).push(p); });
    const stages = Object.entries(g).filter(([, a]) => a.length >= 3).map(([k, a]) => ({ k, avg: +avg(a).toFixed(1), n: a.length }));
    if (stages.length < 2) continue;
    stages.sort((a, b) => b.avg - a.avg);
    factors.push({ name, spread: +(stages[0].avg - stages[stages.length - 1].avg).toFixed(1), best: stages[0], worst: stages[stages.length - 1] });
  }
  factors.sort((a, b) => b.spread - a.spread);

  // stärkste Zweier-Kombi der beiden wichtigsten Faktoren
  let combo = null;
  if (factors.length >= 2) {
    const [f1, f2] = factors;
    const fn1 = buckets[f1.name], fn2 = buckets[f2.name];
    const sub = data.filter(s => fn1(s) === f1.best.k && fn2(s) === f2.best.k).map(s => s[perfKey]).filter(p => p != null);
    if (sub.length >= 3) combo = { f1: f1.name + ' ' + f1.best.k, f2: f2.name + ' ' + f2.best.k, avg: +avg(sub).toFixed(1), n: sub.length };
  }
  return { factors: factors.slice(0, 5), combo, sampleSize: data.length };
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
