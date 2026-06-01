// Aktualisiert sectordata.json täglich per Gemini API.
// Läuft in GitHub Actions; der API-Key kommt aus dem Secret GEMINI_API_KEY.
// Schlägt der KI-Aufruf fehl oder ist die Antwort ungültig, bleibt die alte Datei
// erhalten (kein Commit), damit die Seite nie kaputte Daten bekommt.

import fs from 'node:fs';

const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const OUT = 'sectordata.json';

if (!KEY) {
  console.error('GEMINI_API_KEY fehlt.');
  process.exit(1);
}

// Sektoren sind fix vorgegeben (Farben/Reihenfolge stabil halten).
const SECTORS = [
  { id: 'software',   name: 'Software & Cloud',       color: '#6366f1' },
  { id: 'ai_semi',    name: 'KI & Halbleiter',        color: '#a855f7' },
  { id: 'hardware',   name: 'Hardware & Geräte',      color: '#8b5cf6' },
  { id: 'comm',       name: 'Kommunikation & Medien', color: '#ec4899' },
  { id: 'health',     name: 'Gesundheit & Pharma',    color: '#22c55e' },
  { id: 'finance',    name: 'Finanzen & Banken',      color: '#0ea5e9' },
  { id: 'cons_cycl',  name: 'Konsum zyklisch',        color: '#f59e0b' },
  { id: 'cons_def',   name: 'Konsum defensiv',        color: '#84cc16' },
  { id: 'industrial', name: 'Industrie',              color: '#64748b' },
  { id: 'energy',     name: 'Energie',                color: '#ef4444' },
  { id: 'materials',  name: 'Rohstoffe',              color: '#d97706' },
  { id: 'utilities',  name: 'Versorger',              color: '#14b8a6' },
  { id: 'realestate', name: 'Immobilien',             color: '#a16207' },
];

const SECTOR_IDS = SECTORS.map(s => s.id);
const RANGES = ['1m', '3m', '6m', '1j', '3j', '5j'];
const POINTS = { '1m': 22, '3m': 13, '6m': 26, '1j': 12, '3j': 12, '5j': 12 };

const prompt = `Du bist Finanzdatenanalyst. Gib AUSSCHLIESSLICH gültiges JSON zurück (kein Markdown, keine Erklärung).

Schätze auf Basis deines Wissens über die globalen Aktienmärkte realistische Werte. Heutiges Datum: ${new Date().toISOString().slice(0, 10)}.

Sektoren (genau diese IDs verwenden): ${SECTOR_IDS.join(', ')}.

Liefere ein Objekt mit dieser exakten Struktur:
{
  "performance": {
    ${RANGES.map(r => `"${r}": { "${SECTOR_IDS[0]}": [Zahlen], ... für alle Sektoren }`).join(',\n    ')}
  },
  "analyst": {
    "labels": ["Q1 23", ... 12 Quartalslabels bis heute],
    "series": { "<sektorId>": [12 Zahlen], ... für alle Sektoren }
  },
  "topStocks": [
    { "ticker": "AAPL", "name": "Apple", "sector": "<eine der IDs>", "upside": Zahl }
  ]
}

Definition "Top-Aktie": eine weltweit gehandelte Aktie, die BEIDE Kriterien erfüllt:
  (1) Kaufempfehlungs-Anteil ("Buy" + "Strong Buy") mindestens 95 % der abgebenden Analysten, UND
  (2) Outperform-Empfehlungs-Anteil mindestens 80 %.
Anzahl der Analysten egal (auch nur 1 reicht); Unternehmensgröße egal.

Regeln:
- performance[range][sektorId] ist ein Array von kumulativem prozentualem Kurswachstum, START bei 0, mit Anzahl Punkten: ${RANGES.map(r => `${r}=${POINTS[r]}`).join(', ')}. Letzter Wert = Gesamt-Performance des Sektors über den Zeitraum (z.B. 1m kleine Werte, 5j große). Werte plausibel, mit etwas Verlauf/Schwankung, eine Nachkommastelle.
- analyst.series[sektorId] = prozentualer ANTEIL der Top-Aktien (siehe Definition), der in den jeweiligen Sektor fällt; alle Sektoren zusammen ergeben pro Quartal ~100. Realistischer Trend über die Zeit (z.B. KI & Halbleiter zuletzt steigend).
- topStocks: 12–20 konkrete reale Aktien, die HEUTE die Top-Aktien-Definition erfüllen. "sector" = eine der IDs, "upside" = durchschnittliches Kursziel-Potenzial in % (ganze Zahl). Quer über mehrere Sektoren.
Gib NUR das JSON.`;

async function callGemini() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) throw new Error('Gemini HTTP ' + res.status + ': ' + (await res.text()).slice(0, 500));
  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Leere Gemini-Antwort');
  return JSON.parse(text);
}

function validate(d) {
  if (!d.performance || !d.analyst) throw new Error('Felder fehlen');
  for (const r of RANGES) {
    const block = d.performance[r];
    if (!block) throw new Error('performance.' + r + ' fehlt');
    for (const id of SECTOR_IDS) {
      const arr = block[id];
      if (!Array.isArray(arr) || arr.length < 4) throw new Error('performance.' + r + '.' + id + ' ungültig');
      if (arr.some(v => typeof v !== 'number' || !isFinite(v))) throw new Error('NaN in ' + r + '.' + id);
    }
  }
  if (!Array.isArray(d.analyst.labels) || !d.analyst.series) throw new Error('analyst ungültig');
  for (const id of SECTOR_IDS) {
    if (!Array.isArray(d.analyst.series[id])) throw new Error('analyst.series.' + id + ' fehlt');
  }
}

// topStocks tolerant aufbereiten: nur gültige Einträge mit bekanntem Sektor übernehmen.
function cleanStocks(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(s => s && s.ticker && SECTOR_IDS.includes(s.sector))
    .map(s => ({ ticker: String(s.ticker), name: String(s.name || s.ticker), sector: s.sector, upside: Number(s.upside) || 0 }));
}

// Wandelt das KI-Performance-Objekt ins Frontend-Format (mit labels) um.
function toFrontendPerformance(perf) {
  const out = {};
  for (const r of RANGES) {
    const series = {};
    let n = 0;
    for (const id of SECTOR_IDS) { series[id] = perf[r][id]; n = Math.max(n, perf[r][id].length); }
    out[r] = { labels: Array.from({ length: n }, (_, i) => (i === 0 ? 'Start' : '')), series };
  }
  return out;
}

(async () => {
  try {
    const ai = await callGemini();
    validate(ai);

    const out = {
      updated: new Date().toISOString().slice(0, 10),
      source: 'Gemini ' + MODEL + ' – KI-Schätzung globaler Marktdaten',
      sectors: SECTORS,
      performance: toFrontendPerformance(ai.performance),
      analyst: ai.analyst,
      topStocks: cleanStocks(ai.topStocks),
    };

    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log('sectordata.json aktualisiert (' + out.updated + ').');
  } catch (err) {
    console.error('Update fehlgeschlagen, bestehende Datei bleibt erhalten:', err.message);
    process.exit(1);
  }
})();
