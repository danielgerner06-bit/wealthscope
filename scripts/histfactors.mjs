// Sechs Faktoren zur VORGESCHICHTE einer Perle, alle aus dem Tageschart
// vor dem Aufnahmedatum. Kein zusaetzliches API-Kontingent noetig — die
// Pipeline holt den Chart fuer perf6m ohnehin.
//
//   perf12mBefore  Kursentwicklung 12 Monate vor Aufnahme (%)
//   hitRate24m     Anteil positiver Monate in 24 Monaten davor (%)
//   vol12m         annualisierte Tagesvolatilitaet 12 Monate davor (%)
//   maxDd24m       tiefster Rueckschlag in 24 Monaten davor (%, negativ)
//   distTo3yHigh   Abstand zum 3-Jahres-Hoch am Aufnahmetag (%, <= 0)
//   trendR2_24m    Bestimmtheitsmass einer Geraden durch die Log-Kurse (0..1)

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DAY = 86400000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function chartRows(symbol, fromMs, toMs) {
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
    + `?period1=${Math.floor(fromMs / 1000)}&period2=${Math.floor(toMs / 1000)}&interval=1d`;
  const r = await fetch(u, { headers: { 'User-Agent': UA } });
  if (!r.ok) return null;
  const res = (await r.json())?.chart?.result?.[0];
  const ts = res?.timestamp || [];
  const cl = res?.indicators?.quote?.[0]?.close || [];
  const rows = [];
  for (let i = 0; i < ts.length; i++) {
    if (cl[i] != null) rows.push({ t: ts[i] * 1000, c: cl[i] });
  }
  return rows.length ? rows : null;
}

export function historyFactors(rows, seenMs) {
  const upto = rows.filter((r) => r.t <= seenMs);
  if (upto.length < 40) return null;
  const price = upto[upto.length - 1].c;
  const f2 = (v) => (Number.isFinite(v) ? +v.toFixed(2) : null);
  const since = (ms) => upto.filter((r) => r.t >= seenMs - ms);

  const out = {};

  // 12M-Performance davor
  const w12 = since(365 * DAY);
  out.perf12mBefore = w12.length >= 60 && w12[0].c > 0
    ? f2((price / w12[0].c - 1) * 100) : null;

  // Volatilitaet 12M (annualisiert)
  if (w12.length >= 60) {
    const rets = [];
    for (let i = 1; i < w12.length; i++) {
      if (w12[i - 1].c > 0) rets.push(w12[i].c / w12[i - 1].c - 1);
    }
    const m = rets.reduce((s, v) => s + v, 0) / rets.length;
    const sd = Math.sqrt(rets.reduce((s, v) => s + (v - m) ** 2, 0) / (rets.length - 1));
    out.vol12m = f2(sd * Math.sqrt(252) * 100);
  } else out.vol12m = null;

  const w24 = since(730 * DAY);

  // Monats-Trefferquote 24M: Anteil der Kalendermonate mit positivem Ergebnis
  if (w24.length >= 120) {
    const byMonth = new Map();
    for (const r of w24) {
      const d = new Date(r.t);
      const k = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
      if (!byMonth.has(k)) byMonth.set(k, { first: r.c, last: r.c });
      else byMonth.get(k).last = r.c;
    }
    const months = [...byMonth.values()].filter((m) => m.first > 0);
    const pos = months.filter((m) => m.last > m.first).length;
    out.hitRate24m = months.length >= 6
      ? f2((pos / months.length) * 100) : null;
  } else out.hitRate24m = null;

  // Groesster Rueckschlag 24M
  if (w24.length >= 120) {
    let peak = -Infinity, worst = 0;
    for (const r of w24) {
      if (r.c > peak) peak = r.c;
      if (peak > 0) {
        const dd = (r.c / peak - 1) * 100;
        if (dd < worst) worst = dd;
      }
    }
    out.maxDd24m = f2(worst);
  } else out.maxDd24m = null;

  // Abstand zum 3-Jahres-Hoch
  const w36 = since(1095 * DAY);
  if (w36.length >= 150) {
    const hi = Math.max(...w36.map((r) => r.c));
    out.distTo3yHigh = hi > 0 ? f2((price / hi - 1) * 100) : null;
  } else out.distTo3yHigh = null;

  // Trendguete 24M: R^2 einer Geraden durch ln(Kurs)
  if (w24.length >= 120) {
    const xs = w24.map((r, i) => i);
    const ys = w24.map((r) => Math.log(Math.max(r.c, 1e-9)));
    const n = xs.length;
    const mx = xs.reduce((s, v) => s + v, 0) / n;
    const my = ys.reduce((s, v) => s + v, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my);
      sxx += (xs[i] - mx) ** 2;
      syy += (ys[i] - my) ** 2;
    }
    out.trendR2_24m = (sxx > 0 && syy > 0)
      ? f2((sxy * sxy) / (sxx * syy)) : null;
  } else out.trendR2_24m = null;

  return out;
}

