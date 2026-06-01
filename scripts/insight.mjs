// Erzeugt mit Gemini einen kurzen Analysetext zur Marktlage.
// Greift bewusst nur 2-3 auffällige Sektoren heraus (nicht alle), täglich wechselnd.
import { SECTORS } from './sectors.mjs';

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

function nameOf(id) { return (SECTORS.find(s => s.id === id) || {}).name || id; }

export async function buildInsight(key, bars30, topStocks) {
  const ranked = [...(bars30 || [])].sort((a, b) => b.perf - a.perf);
  const top = ranked.slice(0, 3).map(r => `${nameOf(r.id)} ${r.perf > 0 ? '+' : ''}${r.perf}%`);
  const bottom = ranked.slice(-3).map(r => `${nameOf(r.id)} ${r.perf > 0 ? '+' : ''}${r.perf}%`);
  // Streuung der Analysten-Treffer über Sektoren (welche Branchen haben gerade viele "Perlen"?)
  const bySector = {};
  for (const s of (topStocks || [])) bySector[s.sector] = (bySector[s.sector] || 0) + 1;
  const hotAnalyst = Object.entries(bySector).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([id, c]) => `${nameOf(id)} (${c})`);

  // Tageswechselnder Fokus, damit nicht immer dieselben Sektoren drankommen.
  const dayIdx = Math.floor(Date.now() / 86400000) % Math.max(1, ranked.length);
  const focusSector = nameOf(ranked[dayIdx]?.id);

  const prompt = `Du bist Finanzmarkt-Analyst. Schreibe einen KURZEN deutschen Fließtext (3-4 Sätze, höchstens ~70 Wörter) zur aktuellen sektoralen Lage am Aktienmarkt.

Daten (30-Tage-Kursentwicklung):
- Stärkste: ${top.join(', ')}
- Schwächste: ${bottom.join(', ')}
- Sektoren mit aktuell vielen hoch bewerteten Analysten-Favoriten: ${hotAnalyst.join(', ') || 'k. A.'}

Aufgabe: Greife NICHT alle Sektoren auf, sondern 2-3 auffällige. Erkläre plausibel und konkret, warum sie gerade gut bzw. schwach laufen (Zinsen, KI-Investitionen, Energiepreise, Konjunktur o. Ä.). Beziehe den Sektor "${focusSector}" mit ein. Sachlich, kein Hype, keine Aufzählung, keine Anlageberatung, keine Floskeln wie "es bleibt spannend". Nur der Text.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  if (!res.ok) throw new Error('Gemini HTTP ' + res.status + ': ' + (await res.text()).slice(0, 300));
  const json = await res.json();
  const cand = json?.candidates?.[0];
  const text = cand?.content?.parts?.map(p => p.text).filter(Boolean).join('').trim();
  if (!text) throw new Error('Leere Gemini-Antwort' + (cand?.finishReason ? ' (' + cand.finishReason + ')' : ''));
  return text;
}
