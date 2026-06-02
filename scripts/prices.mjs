// Kursdaten über Yahoo-Finance-Chart-API (kostenlos, kein Key).
//  - Sektor-Performance je ETF: perf30 (aktuell ~30 Handelstage), avg30 (Ø rollierende
//    30T-Returns über ~360 Tage), perf6m (~126 Handelstage).
//  - Einzelaktien-Performance (6 Monate) für die Sortierung der Analysten-Perlen.
//
// Robust gegen Yahoo-Ausreißer: End-/Startkurs = Median über ein kleines Fenster,
// damit ein einzelner fehlerhafter Tageskurs die Prozentwerte nicht verfälscht.
import { SECTORS, REGIONS } from './sectors.mjs';

const W30 = 21;    // ~30 Kalendertage
const W6M = 126;   // ~6 Monate

function median(a) {
  const x = a.filter(v => typeof v === 'number' && isFinite(v)).sort((m, n) => m - n);
  if (!x.length) return null;
  const mid = Math.floor(x.length / 2);
  return x.length % 2 ? x[mid] : (x[mid - 1] + x[mid]) / 2;
}
// Median der k Werte ENDEND bei Index i (trailing) — robust am Rand gegen Ausreißer.
// Yahoos jeweils letzter Tageskurs ist oft ein Intraday-Spike; der 3-Tage-Median
// trifft die offiziellen Monatswerte (validiert gegen etfdb/NAV).
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

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

async function closes(symbol, range = '1y') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=1d`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('Yahoo HTTP ' + res.status + ' (' + symbol + ')');
  const j = await res.json();
  const r = j?.chart?.result?.[0];
  const arr = r?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(arr)) throw new Error('keine Kursdaten für ' + symbol);
  return arr.filter(x => typeof x === 'number' && isFinite(x));
}

/* ---------- Yahoo quoteSummary (Kursziel, KGV, EPS) ----------
   Braucht Cookie + Crumb. Beides einmal holen und cachen.                       */
let _cookie = null, _crumb = null;
async function ensureCrumb() {
  if (_crumb) return;
  // 1) Cookie holen
  const r1 = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': UA } });
  _cookie = (r1.headers.get('set-cookie') || '').split(';')[0] || '';
  // 2) Crumb mit Cookie holen
  const r2 = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, 'Cookie': _cookie },
  });
  const c = await r2.text();
  if (c && !c.startsWith('{') && c.length < 40) _crumb = c;
  else throw new Error('kein Yahoo-Crumb');
}

// Nur der Yahoo-Sektor/-Branche einer Aktie (für Trefferquoten-Zählung; kein Kontingent).
export async function fetchSectorOf(symbol) {
  try {
    await ensureCrumb();
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`
      + `?modules=assetProfile&crumb=${encodeURIComponent(_crumb)}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Cookie': _cookie } });
    if (res.status === 401 || res.status === 403) { _crumb = null; return null; }
    if (!res.ok) return null;
    const a = (await res.json())?.quoteSummary?.result?.[0]?.assetProfile;
    if (!a) return null;
    return { sector: a.sector || null, industry: a.industry || null };
  } catch { return null; }
}

// Liefert { price, target, upside, pe, eps, analysts } für ein Symbol (oder Teilwerte/null).
export async function enrichStock(symbol) {
  try {
    await ensureCrumb();
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`
      + `?modules=financialData,summaryDetail,price,defaultKeyStatistics&crumb=${encodeURIComponent(_crumb)}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Cookie': _cookie } });
    if (res.status === 401 || res.status === 403) { _crumb = null; throw new Error('crumb abgelaufen'); }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const r = (await res.json())?.quoteSummary?.result?.[0];
    if (!r) return null;
    const fd = r.financialData || {}, sd = r.summaryDetail || {}, pr = r.price || {}, ks = r.defaultKeyStatistics || {};
    const price = fd.currentPrice?.raw ?? pr.regularMarketPrice?.raw ?? null;
    const target = fd.targetMeanPrice?.raw ?? null;
    const upside = (price && target) ? Math.round((target / price - 1) * 100) : null;
    let pe = sd.trailingPE?.raw ?? fd.trailingPE?.raw ?? null;
    pe = (pe != null && isFinite(pe) && pe > 0 && pe <= 500) ? +pe.toFixed(1) : null;  // Verlust/absurd -> kein KGV
    const eps = ks.trailingEps?.raw ?? null;
    const analysts = fd.numberOfAnalystOpinions?.raw ?? null;
    // Dividendenrendite in % (Yahoo liefert Dezimal, z. B. 0.0258 -> 2.58)
    let divYield = sd.dividendYield?.raw ?? sd.trailingAnnualDividendYield?.raw ?? null;
    divYield = (divYield != null && isFinite(divYield) && divYield >= 0 && divYield < 1) ? +(divYield * 100).toFixed(2) : null;
    return {
      price, target,
      // Kursziel-Potenzial plausibel begrenzen (extreme Werte = oft Datenfehler/Penny-Stocks)
      upside: (upside != null && upside >= -60 && upside <= 100) ? upside : null,
      pe, eps: (eps != null && isFinite(eps)) ? +eps.toFixed(2) : null,
      analysts: analysts || null,
      divYield,
    };
  } catch {
    return null;
  }
}

// Performance für eine Liste von { id, etf } (Sektoren ODER Regionen).
async function fetchPerf(list) {
  const out = [];
  for (const s of list) {
    try {
      const c = await closes(s.etf, '1y');
      if (c.length <= W30 + 2) { out.push({ id: s.id, perf: 0, avg30: 0, perf6m: 0 }); continue; }
      const perf = pctBack(c, W30) ?? 0;
      const perf6m = pctBack(c, Math.min(W6M, c.length - 2)) ?? 0;

      // Ø der rollierenden 30T-Returns über die letzten ~252 Handelstage (geglättet).
      const lookback = Math.min(252, c.length - 1 - W30);
      let sum = 0, cnt = 0;
      for (let i = c.length - 1; i > c.length - 1 - lookback && i - W30 >= 0; i--) {
        const a = trailMed(c, i), b = trailMed(c, i - W30);
        if (a && b) { sum += ((a - b) / b) * 100; cnt++; }
      }
      const avg30 = cnt ? +(sum / cnt).toFixed(2) : perf;
      out.push({ id: s.id, perf, avg30, perf6m });
    } catch (e) {
      out.push({ id: s.id, perf: 0, avg30: 0, perf6m: 0 });
    }
  }
  return out;
}

export const fetchSectorPerformance = () => fetchPerf(SECTORS);
export const fetchRegionPerformance = () => fetchPerf(REGIONS);

// 6-Monats-Performance für eine einzelne Aktie (oder null bei Fehler).
// Der 6mo-Range liefert ~124 Handelstage -> Anfang (3er-Median) vs. Ende (3er-Median).
export async function fetchStockPerf6m(ticker) {
  try {
    const c = await closes(ticker, '6mo');
    if (c.length < 10) return null;
    const start = trailMed(c, 2);                 // Median der ersten 3 Tage
    const end = trailMed(c, c.length - 1);        // Median der letzten 3 Tage
    if (!start || !end) return null;
    return +(((end - start) / start) * 100).toFixed(2);
  } catch {
    return null;
  }
}
