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
  // Faktoren ziehen
  const pe = Math.random() < 0.2 ? null : Math.round(rnd(5, 60));      // 20% Verlust (kein KGV)
  const buyPct = Math.round(rnd(80, 100));
  const outperformPct = Math.round(rnd(40, 100));
  const upside = Math.round(rnd(2, 60));
  const analysts = Math.round(rnd(1, 40));
  const div = Math.random() < 0.45 ? +rnd(0.5, 6).toFixed(2) : 0;
  const sector = pick(sids);
  const region = pick(rids);

  // "Wahrheit": Performance hängt (mit Rauschen) von einigen Faktoren ab, damit die
  // Analyse echte Muster findet: niedriges KGV, hohe Outperformance + Upside -> besser.
  const peFactor = pe == null ? -3 : (pe < 15 ? 8 : pe < 25 ? 4 : pe < 40 ? 0 : -4);
  const base = peFactor + (outperformPct - 70) * 0.18 + (upside - 20) * 0.15;
  const noise = () => rnd(-8, 8);
  const perf1m = +(base * 0.25 + noise()).toFixed(2);
  const perf3m = +(base * 0.6 + noise() * 1.4).toFixed(2);
  const perf6m = +(base * 1.0 + noise() * 2).toFixed(2);
  const perf1j = +(base * 1.8 + noise() * 3).toFixed(2);

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
