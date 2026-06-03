// Cloudflare Worker: holt STÜNDLICH (pünktlich) die Yahoo-Kursdaten und committet sie
// zurück ins GitHub-Repo. Ersetzt den unzuverlässigen GitHub-Actions-Cron für den
// Yahoo-Teil. Gemini/Finnhub/News bleiben beim GitHub-Actions-Workflow (alle ~6h).
//
// Aktualisiert nur Yahoo-Felder, lässt alles andere (topStocks-Liste, scan, news,
// Gemini-Texte) unangetastet. Schreibt sectordata.json + history.json.

import { SECTORS, REGIONS } from './sectors.js';
import { getFile, putFile } from './github.js';
import {
  fetchSectorPerformance, fetchRegionPerformance, fetchStockPerf6m, enrichStock, perfBetween, priceAtDate,
} from './yahoo.js';

const STALE = 5 * 86400000;   // 5 Tage
const MS_DAY = 86400000;
const MONTHS = 12;
const today = () => new Date().toISOString().slice(0, 10);
const dayMs = d => new Date((d || today()) + 'T00:00:00Z').getTime();

function num(env, key, def) { const v = Number(env[key]); return isFinite(v) && v > 0 ? v : def; }

export default {
  // pünktlicher Cron (in wrangler.toml konfiguriert)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env).catch(e => console.error('Worker-Lauf fehlgeschlagen:', e.message)));
  },
  // manueller Trigger zum Testen: GET /run?key=...
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname === '/run' && u.searchParams.get('key') === env.RUN_KEY) {
      try { const r = await run(env, true); return Response.json({ ok: true, ...r }); }
      catch (e) { return Response.json({ ok: false, error: e.message }, { status: 500 }); }
    }
    return new Response('wealthscope yahoo worker', { status: 200 });
  },
};

async function run(env, force = false) {
  const nowMs = Date.now();
  const sd = await getFile(env, 'sectordata.json');
  const data = sd.json;
  if (!data) throw new Error('sectordata.json nicht gefunden');

  // Mindestabstand: höchstens ~1×/Stunde Yahoo holen (verhindert Doppelläufe, falls
  // Cron + Action sich überschneiden). Bei /run?force wird die Sperre übersprungen.
  const MIN_GAP_MIN = num(env, 'MIN_GAP_MIN', 50);
  const lastMs = data.yahooAt ? Date.parse(data.yahooAt) : 0;
  if (!force && lastMs && (nowMs - lastMs) < MIN_GAP_MIN * 60000) {
    return { skipped: true, sinceMin: Math.round((nowMs - lastMs) / 60000) };
  }

  const topStocks = Array.isArray(data.topStocks) ? data.topStocks : [];

  // Cloudflare-Free erlaubt 50 fetch-Subrequests/Lauf. Sektor+Region (~23) laufen immer;
  // die rollierenden Budgets sind so dimensioniert, dass die Summe < 50 bleibt. Zusätzlich
  // ein konservativer Cap, der die Budgets bei Bedarf auf null kürzt (Reihenfolge = Priorität).
  // Gesamt-fetch-Budget für KURSE. Overhead separat: 2× getFile + 2× crumb + 2× commit ≈ 6,
  // dazu Sektor+Region. SUBREQ_CAP (Default 40) lässt Puffer zum 50er-Free-Limit.
  let budget = num(env, 'SUBREQ_CAP', 40) - (SECTORS.length + REGIONS.length);   // Rest für rollierende Aktien-Fetches
  const take = (want, perItem) => { const n = Math.max(0, Math.min(want, Math.floor(budget / perItem))); budget -= n * perItem; return n; };

  // 1) Sektor- & Regionen-Performance (immer, schnell) — das ist das stündlich Frische
  try { data.bars30 = await fetchSectorPerformance(SECTORS); } catch (e) { console.error('Sektor-Perf:', e.message); }
  try { data.bars30Region = await fetchRegionPerformance(REGIONS); } catch (e) { console.error('Region-Perf:', e.message); }

  // 2) 6M-Performance je Aktie (rollierend, Budget)
  const needPerf = topStocks.filter(s => s.perf6m == null || !s.perf6mAt || (nowMs - Date.parse(s.perf6mAt)) > STALE)
    .slice(0, take(num(env, 'PERF6M_BUDGET', 8), 1));
  for (const s of needPerf) {
    const v = await fetchStockPerf6m(s.yahoo || s.ticker);
    if (v != null) { s.perf6m = v; s.perf6mAt = today(); }
  }

  // 3) 1M-vor-Aufnahme (einmalig je Perle) — 2 Fetches je Aktie
  const needPre = topStocks.filter(s => s.perf1mBefore === undefined).slice(0, take(num(env, 'PRE1M_BUDGET', 6), 2));
  for (const s of needPre) {
    const seenMs = dayMs(s.seen);
    const v = await perfBetween(s.yahoo || s.ticker, seenMs - 30 * MS_DAY, seenMs);
    s.perf1mBefore = (v == null ? null : v);
  }

  // 4) Anreicherung (Kursziel/KGV/EPS/Analysten/Div) rollierend — ~2 Fetches je Aktie
  const needEnrich = topStocks.filter(s =>
    s.enrichAt == null || (nowMs - Date.parse(s.enrichAt)) > STALE || s.div === undefined)
    .slice(0, take(num(env, 'ENRICH_BUDGET', 8), 2));
  for (const s of needEnrich) {
    let e = await enrichStock(s.yahoo || s.ticker);
    if (!e && !s.yahoo && /^[A-Z0-9]{1,5}$/.test(s.ticker)) {
      e = await enrichStock(s.ticker + '.DE');
      if (e) s.yahoo = s.ticker + '.DE';
    }
    if (!e) { s.enrichAt = today(); if (s.div === undefined) s.div = null; continue; }
    if (e.upside != null) s.upside = e.upside;
    s.pe = (e.eps != null && e.eps < 0) ? null : e.pe;
    if (e.eps != null) s.eps = e.eps;
    if (e.analysts != null) s.analysts = e.analysts;
    s.div = e.divYield;
    s.enrichAt = today();
  }

  data.yahooAt = new Date(nowMs).toISOString();
  data.updatedAt = data.yahooAt;

  // 5) History: neue Perlen aufnehmen (Snapshot) + fällige Monatswerte messen
  const hist = await getFile(env, 'history.json');
  const h = hist.json || { entries: {} };
  const snapped = await snapshotStocks(h, topStocks, take(num(env, 'SNAPSHOT_BUDGET', 4), 1));
  const measured = await measureMilestones(h, take(num(env, 'MILESTONE_BUDGET', 6), 2));
  pruneHistory(h);

  // 6) Zurückschreiben (mit Konflikt-Retry: bei 409 neu lesen & sha aktualisieren)
  await commitWithRetry(env, 'sectordata.json', data, sd.sha, `Yahoo-Kurse aktualisiert (${today()}) [worker]`);
  await commitWithRetry(env, 'history.json', h, hist.sha, `Backtest-Historie aktualisiert (${today()}) [worker]`);

  return { perf6m: needPerf.length, pre1m: needPre.length, enrich: needEnrich.length, snapped, measured, pearls: topStocks.length };
}

// Commit; bei Konflikt (paralleler Action-Commit) Datei neu lesen, Yahoo-Felder mergen, erneut.
async function commitWithRetry(env, path, obj, sha, msg) {
  for (let i = 0; i < 3; i++) {
    try { return await putFile(env, path, obj, sha, msg); }
    catch (e) {
      if (!e.conflict || i === 2) throw e;
      const fresh = await getFile(env, path);   // neuesten Stand holen
      sha = fresh.sha;
      // Bei sectordata: unsere Yahoo-Felder auf den frischen Stand übertragen, Rest (Action) behalten.
      if (path === 'sectordata.json' && fresh.json) obj = mergeYahoo(fresh.json, obj);
      else if (fresh.json) obj = obj;   // history: unsere Version (wir sind primärer Schreiber)
    }
  }
}

// Yahoo-Felder aus `mine` in den frischen Action-Stand `base` übernehmen.
function mergeYahoo(base, mine) {
  base.bars30 = mine.bars30; base.bars30Region = mine.bars30Region;
  base.yahooAt = mine.yahooAt; base.updatedAt = mine.updatedAt;
  const m = Object.fromEntries((mine.topStocks || []).map(s => [s.ticker, s]));
  base.topStocks = (base.topStocks || []).map(s => {
    const y = m[s.ticker]; if (!y) return s;
    return { ...s, perf6m: y.perf6m, perf6mAt: y.perf6mAt, perf1mBefore: y.perf1mBefore,
      upside: y.upside, pe: y.pe, eps: y.eps, analysts: y.analysts, div: y.div, enrichAt: y.enrichAt, yahoo: y.yahoo };
  });
  return base;
}

/* ---- History-Helfer (portiert aus scripts/history.mjs) ---- */
function regionOf(sym) {
  if (!sym) return 'usa';
  const suf = sym.includes('.') ? sym.split('.').pop() : '';
  const map = { DE: 'europe', PA: 'europe', AS: 'europe', MI: 'europe', L: 'europe', SW: 'europe', ST: 'europe', HE: 'europe', BR: 'europe', VI: 'europe', MC: 'europe',
    T: 'japan', HK: 'china', SS: 'china', SZ: 'china', KS: 'apac', TW: 'apac', NS: 'india', BO: 'india', AX: 'apac', SA: 'latam', MX: 'latam' };
  return suf ? (map[suf] || 'world') : 'usa';
}
function metaFrom(s, sym) {
  return {
    ticker: s.ticker, name: s.name, yahoo: sym, sector: s.sector, region: regionOf(sym),
    buyPct: s.buyPct ?? null, outperformPct: s.outperformPct ?? null,
    upside: s.upside ?? null, pe: s.pe ?? null, perf6mAtAdd: s.perf6m ?? null,
    perf1mBefore: s.perf1mBefore ?? null, analysts: s.analysts ?? null, div: s.div ?? null,
  };
}
async function snapshotStocks(hist, topStocks, budget) {
  const e = hist.entries; let added = 0;
  for (const s of topStocks) {
    if (e[s.ticker]) { Object.assign(e[s.ticker], metaFrom(s, e[s.ticker].yahoo || s.yahoo || s.ticker)); continue; }
    if (added >= budget) continue;
    const seenStr = s.seen || today();
    const sym = s.yahoo || s.ticker;
    const startMs = dayMs(seenStr);
    const startPrice = await priceAtDate(sym, startMs);
    if (startPrice == null) continue;
    e[s.ticker] = { ...metaFrom(s, sym), seen: seenStr, seenMs: startMs, startPrice, perf: [] };
    added++;
  }
  return added;
}
async function measureMilestones(hist, budget) {
  const now = Date.now(); let measured = 0;
  for (const x of Object.values(hist.entries)) {
    if (measured >= budget) break;
    if (x.startPrice == null || !x.seenMs) continue;
    x.perf = x.perf || [];
    for (let m = 1; m <= MONTHS; m++) {
      if (x.perf[m - 1] != null && !(x.prov && m === 1)) continue;
      const dueMs = x.seenMs + m * 30 * MS_DAY;
      if (now < dueMs) break;
      const v = await perfBetween(x.yahoo || x.ticker, x.seenMs, dueMs);
      if (v != null) { x.perf[m - 1] = v; if (m === 1) x.prov = false; measured++; }
      if (measured >= budget) break;
    }
  }
  return measured;
}
function pruneHistory(hist) {
  const cutoff = Date.now() - 366 * MS_DAY;
  for (const [tk, x] of Object.entries(hist.entries))
    if ((x.seenMs && x.seenMs < cutoff) || x.fake) delete hist.entries[tk];
}
