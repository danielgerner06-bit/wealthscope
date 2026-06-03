// Backtest-Historie: für jede je aufgenommene Perle ein Snapshot der Kennzahlen
// beim Hinzufügen + monatliche Kursperformance seit Aufnahme (perf[0..11] = Monat 1..12,
// jeweils kumuliert seit dem Aufnahmetag). Bleibt 1 Jahr, auch wenn die Aktie nicht mehr
// in den aktuellen Perlen ist.
import fs from 'node:fs';
import { priceAtDate, perfBetween } from './prices.mjs';

const FILE = 'history.json';
const MS_DAY = 86400000;
const MONTHS = 12;

export function loadHistory() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { entries: {} }; }
}
export function saveHistory(h) { fs.writeFileSync(FILE, JSON.stringify(h, null, 2)); }

const dayMs = d => new Date(d + 'T00:00:00Z').getTime();
const todayStr = () => new Date().toISOString().slice(0, 10);

// Grobe Region aus dem Yahoo-Börsensuffix (US ohne Suffix).
function regionOf(sym) {
  if (!sym) return null;
  const suf = sym.includes('.') ? sym.split('.').pop() : '';
  const map = { DE: 'europe', PA: 'europe', AS: 'europe', MI: 'europe', L: 'europe', SW: 'europe', ST: 'europe', HE: 'europe', BR: 'europe', VI: 'europe', MC: 'europe',
    T: 'japan', HK: 'china', SS: 'china', SZ: 'china', KS: 'apac', TW: 'apac', NS: 'india', BO: 'india', AX: 'apac', SA: 'latam', MX: 'latam' };
  return suf ? (map[suf] || 'world') : 'usa';
}

// gemeinsame Kennzahlen-Felder aus einer aktuellen Perle übernehmen
function metaFrom(s, sym) {
  return {
    ticker: s.ticker, name: s.name, yahoo: sym,
    sector: s.sector, region: regionOf(sym),
    buyPct: s.buyPct ?? null, outperformPct: s.outperformPct ?? null,
    upside: s.upside ?? null, pe: s.pe ?? null, perf6mAtAdd: s.perf6m ?? null,
    perf1mBefore: s.perf1mBefore ?? null,
    analysts: s.analysts ?? null, div: s.div ?? null,
  };
}

// Snapshot je aktueller Perle anlegen/auffrischen (mit Aufnahmekurs + leerem perf-Array).
export async function snapshotStocks(hist, topStocks, budget = 30) {
  const e = hist.entries;
  let added = 0;
  for (const s of topStocks) {
    if (e[s.ticker]) {
      const x = e[s.ticker];
      Object.assign(x, metaFrom(s, x.yahoo || s.yahoo || s.ticker));   // Kennzahlen auffrischen, Aufnahmedaten bleiben
      continue;
    }
    if (added >= budget) continue;
    const seenStr = s.seen || todayStr();
    const sym = s.yahoo || s.ticker;
    const startMs = dayMs(seenStr);
    const startPrice = await priceAtDate(sym, startMs);
    if (startPrice == null) continue;
    e[s.ticker] = { ...metaFrom(s, sym), seen: seenStr, seenMs: startMs, startPrice, perf: [] };
    added++;
  }
  return added;
}

// Fällige Monats-Messpunkte berechnen: für jeden vergangenen Monat seit Aufnahme die
// kumulierte Performance (Aufnahmekurs -> Kurs nach m Monaten), einmalig & fix gespeichert.
export async function measureMilestones(hist, budget = 30) {
  const now = Date.now();
  let measured = 0;
  for (const x of Object.values(hist.entries)) {
    if (measured >= budget) break;
    if (x.startPrice == null || !x.seenMs) continue;
    x.perf = x.perf || [];
    for (let m = 1; m <= MONTHS; m++) {
      if (x.perf[m - 1] != null && !(x.prov && m === 1)) continue;   // schon fix gemessen
      const dueMs = x.seenMs + m * 30 * MS_DAY;
      if (now < dueMs) break;                                        // noch nicht fällig (spätere auch nicht)
      const v = await perfBetween(x.yahoo || x.ticker, x.seenMs, dueMs);
      if (v != null) { x.perf[m - 1] = v; if (m === 1) x.prov = false; measured++; }
      if (measured >= budget) break;
    }
  }
  return measured;
}

// Provisorischer 1-Monats-Punkt JETZT: tut so, als wäre die Perle vor 1 Monat gefunden
// worden, und berechnet die echte 1M-Performance (vor 1M -> heute) aus Yahoo. Nur wenn
// noch kein echter perf[0] da ist. prov:true -> wird durch echten Wert ersetzt.
export async function seedBacktest1m(hist, topStocks, budget = 60) {
  const e = hist.entries;
  const now = Date.now();
  const startMs = now - 30 * MS_DAY;
  let done = 0;
  for (const s of topStocks) {
    if (done >= budget) break;
    const ex = e[s.ticker];
    if (ex && ex.perf && ex.perf[0] != null && !ex.prov) continue;        // echter 1M-Wert existiert
    if (ex && ex.prov && ex.provDay === todayStr()) continue;             // heute schon gerechnet
    const sym = s.yahoo || s.ticker;
    const v = await perfBetween(sym, startMs, now);
    if (v == null) continue;
    const base = ex || { ...metaFrom(s, sym), seen: new Date(startMs).toISOString().slice(0, 10), seenMs: startMs, startPrice: null, perf: [] };
    Object.assign(base, metaFrom(s, sym));
    base.perf = base.perf || [];
    base.perf[0] = v;                  // Monat 1 (provisorisch)
    base.prov = true; base.provDay = todayStr();
    e[s.ticker] = base;
    done++;
  }
  return done;
}

// Faktor-Befunde (für KI-Analyse): je Faktor beste/schlechteste Stufe nach Ø-Performance
// im jüngsten verfügbaren Monat + stärkste Zweier-Kombination.
export function computeFindings(hist) {
  const data = Object.values(hist.entries).map(x => ({ ...x, perfLast: lastPerf(x), months: monthsOf(x) })).filter(x => x.perfLast != null);
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
    data.forEach(s => { const k = fn(s), p = s.perfLast; if (k != null && p != null) (g[k] = g[k] || []).push(p); });
    const stages = Object.entries(g).filter(([, a]) => a.length >= 3).map(([k, a]) => ({ k, avg: +avg(a).toFixed(1), n: a.length }));
    if (stages.length < 2) continue;
    stages.sort((a, b) => b.avg - a.avg);
    factors.push({ name, spread: +(stages[0].avg - stages[stages.length - 1].avg).toFixed(1), best: stages[0], worst: stages[stages.length - 1] });
  }
  factors.sort((a, b) => b.spread - a.spread);
  let combo = null;
  if (factors.length >= 2) {
    const [f1, f2] = factors;
    const fn1 = buckets[f1.name], fn2 = buckets[f2.name];
    const sub = data.filter(s => fn1(s) === f1.best.k && fn2(s) === f2.best.k).map(s => s.perfLast).filter(p => p != null);
    if (sub.length >= 3) combo = { f1: f1.name + ' ' + f1.best.k, f2: f2.name + ' ' + f2.best.k, avg: +avg(sub).toFixed(1), n: sub.length };
  }
  // Reifegrad der Datenbasis: längster real gemessener Zeitraum + ob (noch) provisorisch.
  const maxMonths = data.length ? Math.max(...data.map(s => s.months || 0)) : 0;
  const allProvisional = data.length > 0 && Object.values(hist.entries).every(x => x.prov || lastPerf(x) == null);
  return { factors: factors.slice(0, 5), combo, sampleSize: data.length, maxMonths, provisional: allProvisional };
}
// jüngster vorhandener Monatswert einer Aktie
function lastPerf(x) { if (!x.perf || !x.perf.length) return null; for (let i = x.perf.length - 1; i >= 0; i--) if (x.perf[i] != null) return x.perf[i]; return null; }
// Anzahl real vorhandener Monatspunkte (höchster gesetzter Index + 1)
function monthsOf(x) { if (!x.perf || !x.perf.length) return 0; for (let i = x.perf.length - 1; i >= 0; i--) if (x.perf[i] != null) return i + 1; return 0; }

// Einträge älter als 1 Jahr + alte Voll-Fake-Aktien (Altbestand) entfernen.
export function pruneHistory(hist) {
  const cutoff = Date.now() - 366 * MS_DAY;
  let removed = 0;
  for (const [tk, x] of Object.entries(hist.entries)) {
    if ((x.seenMs && x.seenMs < cutoff) || x.fake) { delete hist.entries[tk]; removed++; }
  }
  return removed;
}
