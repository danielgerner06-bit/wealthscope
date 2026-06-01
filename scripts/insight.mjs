// Erzeugt mit Gemini kurze Lage-Texte je Sektor (rollierend, nicht alle pro Tag).
import { SECTORS } from './sectors.mjs';

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const nameOf = id => (SECTORS.find(s => s.id === id) || {}).name || id;

async function gen(key, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  if (!res.ok) throw new Error('Gemini HTTP ' + res.status + ': ' + (await res.text()).slice(0, 200));
  const j = await res.json();
  const cand = j?.candidates?.[0];
  const text = cand?.content?.parts?.map(p => p.text).filter(Boolean).join('').trim();
  if (!text) throw new Error('Leere Antwort' + (cand?.finishReason ? ' (' + cand.finishReason + ')' : ''));
  return text;
}

// Liefert { sectorId: { text, date } } für die übergebenen Sektor-IDs.
export async function buildSectorNotes(key, sectorIds, bars30, topStocks) {
  const out = {};
  const today = new Date().toISOString().slice(0, 10);
  for (const id of sectorIds) {
    const bar = (bars30 || []).find(b => b.id === id);
    const perf = bar ? `${bar.perf > 0 ? '+' : ''}${bar.perf}%` : 'k. A.';
    const perf6m = bar && bar.perf6m != null ? `${bar.perf6m > 0 ? '+' : ''}${bar.perf6m}%` : 'k. A.';
    const avg = bar && bar.avg30 != null ? `${bar.avg30 > 0 ? '+' : ''}${bar.avg30}%` : 'k. A.';
    const perlen = (topStocks || []).filter(s => s.sector === id).slice(0, 4)
      .map(s => s.name + (s.ticker ? ` (${s.ticker})` : '')).join(', ');

    const prompt = `Du bist Aktienmarkt-Analyst. Schreibe einen KURZEN deutschen Fließtext (3-4 Sätze, ~60-80 Wörter) zur AKTUELLEN Lage des Sektors "${nameOf(id)}" am globalen Aktienmarkt.

Kennzahlen dieses Sektors:
- 30-Tage-Kursentwicklung: ${perf} (sein typischer 30-Tage-Schnitt über 360 Tage: ${avg})
- 6-Monats-Entwicklung: ${perf6m}
- Hoch bewertete Analysten-Favoriten hier: ${perlen || 'derzeit keine markanten'}

Erkläre konkret und plausibel, WARUM der Sektor gerade so läuft (z. B. Zinsen, KI-/Investitionszyklus, Energiepreise, Konjunktur, Regulierung). Beziehe dich auf die Zahlen (über/unter Normalniveau). Sachlich, kein Hype, keine Anlageberatung, keine Floskeln. Nur den Text, keine Überschrift.`;

    try {
      out[id] = { text: await gen(key, prompt), date: today };
    } catch (e) {
      // einzelnen Sektor überspringen, Rest läuft weiter
    }
  }
  return out;
}
