// Erzeugt 100 imaginäre Demo-Aktien für die Analyse-Seite, damit sie SOFORT
// befüllt ist. Markiert mit fake:true + fakeUntil (1 Monat). Die Pipeline löscht
// sie automatisch, sobald echte Meilenstein-Daten vorliegen bzw. nach Ablauf.
import fs from 'node:fs';
import { SECTORS, REGIONS } from './sectors.mjs';

const FILE = 'history.json';
const sids = SECTORS.map(s => s.id);
const rids = REGIONS.map(r => r.id);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function makeStock(i) {
  // Faktoren ziehen (Perlen erfüllen Kauf>=80%, daher etwas verzerrte Verteilungen)
  const pe = Math.random() < 0.18 ? null : Math.round(rnd(6, 55));     // ~18% Verlust (kein KGV)
  const buyPct = Math.round(rnd(80, 100));
  const outperformPct = Math.round(rnd(45, 100));
  const upside = Math.round(rnd(3, 55));
  const analysts = Math.round(rnd(1, 38));
  const div = Math.random() < 0.45 ? +rnd(0.3, 6).toFixed(2) : 0;
  const sector = pick(sids);
  const region = pick(rids);

  // "Wahrheit" nach empirischer Faktorforschung: schwache, aber erkennbare Effekte,
  // viel Rauschen (kein Faktor ist ein starker Einzelprädiktor). Werte = jährlicher
  // Beitrag in %, später aufs Zeitfenster skaliert.
  //  - Value (niedriges KGV): leichte Prämie (~+2..4% p.a.), Verlustfirmen leicht schlechter
  //  - Quality-Proxy hoher Analystenkonsens: nur SCHWACHER Effekt (Analysten oft daneben)
  //  - Kursziel-Potenzial: minimaler Effekt
  //  - Dividende: leichter positiver Yield-Effekt
  //  - Analystenzahl: praktisch kein Effekt (Coverage ≠ Rendite)
  const valueEff = pe == null ? -2 : (pe < 12 ? 4 : pe < 20 ? 2.5 : pe < 30 ? 0.5 : pe < 45 ? -1 : -3);
  const consensusEff = (outperformPct - 72) * 0.05;     // ±~1.5%
  const upsideEff = (upside - 25) * 0.04;               // ±~1.2%
  const yieldEff = div > 0 ? (div - 1) * 0.5 : -0.5;    // leichte Yield-Prämie
  const annual = valueEff + consensusEff + upsideEff + yieldEff;  // ~ -6..+9 % p.a.
  // Marktdrift (alle Aktien teilen einen Teil) + idiosynkratisches Rauschen je Aktie
  const marketDrift = rnd(2, 9);                         // allgemeiner Aufwärtsmarkt
  const sigmaAnnual = 28;                                // realistische Einzelaktien-Vola p.a.
  // gaußähnliches Rauschen (Summe von Uniforms) skaliert je Zeitfenster mit √t
  const z = () => (rnd(-1, 1) + rnd(-1, 1) + rnd(-1, 1));   // ~N(0, ~0.58)
  const perfFor = years => {
    const drift = (annual + marketDrift) * years;
    const noise = z() * sigmaAnnual * Math.sqrt(years);
    return +(drift + noise).toFixed(2);
  };
  const perf1m = perfFor(1 / 12);
  const perf3m = perfFor(0.25);
  const perf6m = perfFor(0.5);
  const perf1j = perfFor(1);

  return {
    ticker: 'DEMO' + String(i).padStart(3, '0'),
    name: 'Demo-Wert ' + i, yahoo: null,
    seen: new Date().toISOString().slice(0, 10), seenMs: Date.now(), startPrice: 100,
    sector, region,
    buyPct, outperformPct, upside, pe, perf6mAtAdd: perf6m, analysts, div,
    perf1m, perf3m, perf6m, perf1j,
    fake: true, fakeUntil: new Date(Date.now() + 31 * 86400000).toISOString().slice(0, 10),
  };
}

const hist = (() => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { entries: {} }; } })();
for (let i = 1; i <= 100; i++) { const s = makeStock(i); hist.entries[s.ticker] = s; }
fs.writeFileSync(FILE, JSON.stringify(hist, null, 2));
console.log('100 Demo-Aktien in history.json erzeugt (fake:true, löschen sich nach ~1 Monat).');
