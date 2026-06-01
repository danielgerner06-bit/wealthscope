// Diagnose: Kann Gemini mit Google-Search-Grounding echte Analystenratings
// auch für Nebenwerte liefern? Testet 2 kleine Aktien. Loggt KEINEN Key.
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('kein GEMINI_API_KEY'); process.exit(1); }
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const stocks = ['innoscripta SE (XETRA)', 'wallstreet:online AG (WSO1)'];

for (const name of stocks) {
  const prompt = `Suche im Web die aktuellen Analysten-Empfehlungen für die Aktie ${name}. Gib zurück, wie viele Analysten sie covern und die Verteilung (Strong Buy / Buy / Hold / Sell). Wenn du nichts findest, sage das klar. Antworte in 2 Sätzen.`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
      }),
    });
    const txt = await res.text();
    console.log('\n=== ' + name + ' === HTTP ' + res.status);
    if (!res.ok) { console.log(txt.slice(0, 400)); continue; }
    const j = JSON.parse(txt);
    const cand = j.candidates?.[0];
    const text = cand?.content?.parts?.map(p => p.text).filter(Boolean).join('').trim();
    console.log('Antwort:', text || '(leer, finishReason=' + cand?.finishReason + ')');
    const chunks = cand?.groundingMetadata?.groundingChunks || [];
    console.log('Quellen:', chunks.length, chunks.slice(0, 4).map(c => c.web?.title || c.web?.uri).join(' | '));
  } catch (e) {
    console.log('Fehler bei ' + name + ':', e.message);
  }
}
