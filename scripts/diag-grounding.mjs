// Diagnose: testet die echten Pipeline-Funktionen checkCandidates + discoverNew.
import { checkCandidates, discoverNew } from './gemini-stocks.mjs';

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('kein GEMINI_API_KEY'); process.exit(1); }

console.log('=== checkCandidates: 4 Nebenwerte prüfen ===');
try {
  const hits = await checkCandidates(KEY, ['innoscripta SE', 'Nagarro SE', 'PVA TePla AG', 'Atoss Software SE']);
  console.log('Treffer (Kauf>=95 & Outperf>=80):', hits.length);
  for (const h of hits) console.log(`  ${h.ticker}  ${h.name}  [${h.sector}]  Kauf ${h.buyPct}%  Outp ${h.outperformPct}%  ${h.analysts}A  up=${h.upside}  src=${h.source}`);
} catch (e) { console.log('FEHLER checkCandidates:', e.message); }

console.log('\n=== discoverNew: neue unbekannte Werte (kennt schon: Apple, Microsoft, Nvidia) ===');
try {
  const found = await discoverNew(KEY, ['Apple', 'Microsoft', 'Nvidia']);
  console.log('Vorgeschlagen:', found.length);
  for (const f of found) console.log(`  ${f.ticker}  ${f.name}  [${f.sector}]  Kauf ${f.buyPct}%  Outp ${f.outperformPct}%  ${f.analysts}A  src=${f.source}`);
} catch (e) { console.log('FEHLER discoverNew:', e.message); }
