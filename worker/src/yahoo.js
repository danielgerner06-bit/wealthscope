// Yahoo-Kurslogik, portiert aus scripts/prices.mjs (1:1 gleiche Berechnung).
// Reines fetch -> Cloudflare-Worker-kompatibel. KEIN User-Agent-Header (Worker
// dürfen den nicht frei setzen; Yahoo akzeptiert auch ohne).

const W30 = 21;    // ~30 Kalendertage
const W6M = 126;   // ~6 Monate
const MS_DAY = 86400000;

function median(a) {
  const x = a.filter(v => typeof v === 'number' && isFinite(v)).sort((m, n) => m - n);
  if (!x.length) return null;
  const mid = Math.floor(x.length / 2);
  return x.length % 2 ? x[mid] : (x[mid - 1] + x[mid]) / 2;
}
function trailMed(arr, i, k = 3) {
  const lo = Math.max(0, i - k + 1);
  return median(arr.slice(lo, i + 1));
}
function pctBack(c, win) {
  if (c.length <= win + 2) return null;
  const last = trailMed(c, c.length - 1);
  const ref = trailMed(c, c.length - 1 - win);
  if (!last || !ref) return null;
  return +(((last - ref) / ref) * 100).toFixed(2);
}

// Yahoo blockt Requests OHNE User-Agent (429 "Too Many Requests"). Cloudflare erlaubt
// das Setzen des UA bei fetch -> zwingend nötig, sonst kommen nur Nullen zurück.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

async function closes(symbol, range = '1y') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('Yahoo HTTP ' + res.status + ' (' + symbol + ')');
  const j = await res.json();
  const r = j?.chart?.result?.[0];
  const arr = r?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(arr)) throw new Error('keine Kursdaten für ' + symbol);
  return arr.filter(x => typeof x === 'number' && isFinite(x));
}

async function history(symbol, fromMs, toMs) {
  const p1 = Math.floor(fromMs / 1000), p2 = Math.floor(toMs / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('Yahoo HTTP ' + res.status);
  const r = (await res.json())?.chart?.result?.[0];
  const ts = r?.timestamp || [];
  const cl = r?.indicators?.quote?.[0]?.close || [];
  const out = [];
  for (let i = 0; i < ts.length; i++) if (typeof cl[i] === 'number' && isFinite(cl[i])) out.push({ t: ts[i] * 1000, c: cl[i] });
  return out;
}

export async function priceAtDate(symbol, dateMs) {
  try {
    const data = await history(symbol, dateMs - 5 * MS_DAY, dateMs + 9 * MS_DAY);
    if (!data.length) return null;
    let idx = data.findIndex(d => d.t >= dateMs);
    if (idx < 0) idx = data.length - 1;
    const lo = Math.max(0, idx - 1), hi = Math.min(data.length, idx + 2);
    const m = median(data.slice(lo, hi).map(d => d.c));
    return m != null ? m : data[idx].c;
  } catch { return null; }
}

export async function perfBetween(symbol, fromMs, toMs) {
  try {
    const start = await priceAtDate(symbol, fromMs);
    const end = await priceAtDate(symbol, toMs);
    if (start == null || end == null || start === 0) return null;
    return +(((end - start) / start) * 100).toFixed(2);
  } catch { return null; }
}

// Yahoo quoteSummary braucht Cookie + Crumb. Pro Worker-Invocation einmal holen.
let _cookie = null, _crumb = null;
async function ensureCrumb() {
  if (_crumb) return;
  const r1 = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': UA } });
  _cookie = (r1.headers.get('set-cookie') || '').split(';')[0] || '';
  const r2 = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, Cookie: _cookie } });
  const c = await r2.text();
  if (c && !c.startsWith('{') && c.length < 40) _crumb = c;
  else throw new Error('kein Yahoo-Crumb');
}

export async function enrichStock(symbol) {
  try {
    await ensureCrumb();
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`
      + `?modules=financialData,summaryDetail,price,defaultKeyStatistics&crumb=${encodeURIComponent(_crumb)}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA, Cookie: _cookie } });
    if (res.status === 401 || res.status === 403) { _crumb = null; throw new Error('crumb abgelaufen'); }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const r = (await res.json())?.quoteSummary?.result?.[0];
    if (!r) return null;
    const fd = r.financialData || {}, sd = r.summaryDetail || {}, pr = r.price || {}, ks = r.defaultKeyStatistics || {};
    const price = fd.currentPrice?.raw ?? pr.regularMarketPrice?.raw ?? null;
    const target = fd.targetMeanPrice?.raw ?? null;
    const upside = (price && target) ? Math.round((target / price - 1) * 100) : null;
    let pe = sd.trailingPE?.raw ?? fd.trailingPE?.raw ?? null;
    pe = (pe != null && isFinite(pe) && pe > 0 && pe <= 500) ? +pe.toFixed(1) : null;
    const eps = ks.trailingEps?.raw ?? null;
    const analysts = fd.numberOfAnalystOpinions?.raw ?? null;
    let divYield = sd.dividendYield?.raw ?? sd.trailingAnnualDividendYield?.raw ?? null;
    divYield = (divYield != null && isFinite(divYield) && divYield >= 0 && divYield < 1) ? +(divYield * 100).toFixed(2) : null;
    return {
      price, target,
      upside: (upside != null && upside >= -60 && upside <= 100) ? upside : null,
      pe, eps: (eps != null && isFinite(eps)) ? +eps.toFixed(2) : null,
      analysts: analysts || null, divYield,
    };
  } catch { return null; }
}

async function fetchPerf(list) {
  const out = [];
  for (const s of list) {
    try {
      const c = await closes(s.etf, '1y');
      if (c.length <= W30 + 2) { out.push({ id: s.id, perf: 0, avg30: 0, perf6m: 0 }); continue; }
      const perf = pctBack(c, W30) ?? 0;
      const perf6m = pctBack(c, Math.min(W6M, c.length - 2)) ?? 0;
      const lookback = Math.min(252, c.length - 1 - W30);
      let sum = 0, cnt = 0;
      for (let i = c.length - 1; i > c.length - 1 - lookback && i - W30 >= 0; i--) {
        const a = trailMed(c, i), b = trailMed(c, i - W30);
        if (a && b) { sum += ((a - b) / b) * 100; cnt++; }
      }
      const avg30 = cnt ? +(sum / cnt).toFixed(2) : perf;
      out.push({ id: s.id, perf, avg30, perf6m });
    } catch { out.push({ id: s.id, perf: 0, avg30: 0, perf6m: 0 }); }
  }
  return out;
}

export const fetchSectorPerformance = (sectors) => fetchPerf(sectors);
export const fetchRegionPerformance = (regions) => fetchPerf(regions);

export async function fetchStockPerf6m(ticker) {
  try {
    const c = await closes(ticker, '6mo');
    if (c.length < 10) return null;
    const start = trailMed(c, 2);
    const end = trailMed(c, c.length - 1);
    if (!start || !end) return null;
    return +(((end - start) / start) * 100).toFixed(2);
  } catch { return null; }
}
