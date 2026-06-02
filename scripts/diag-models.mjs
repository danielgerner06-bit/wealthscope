// Prüft, welche Modelle der Key darf + ob flash-lite mit Grounding geht (1 Call je Modell).
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('kein Key'); process.exit(1); }

const models = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-lite-latest'];
for (const m of models) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${KEY}`;
  try {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Antworte nur mit OK.' }] }],
        tools: [{ google_search: {} }],
      }),
    });
    const t = await res.text();
    let info = 'OK';
    try { const j = JSON.parse(t); if (j.error) info = 'ERR ' + j.error.code + ' ' + (j.error.status || ''); } catch {}
    console.log(m.padEnd(28), res.status, info.slice(0, 60));
  } catch (e) { console.log(m.padEnd(28), 'fetch-fail', e.message); }
}
