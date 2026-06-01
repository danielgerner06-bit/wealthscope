// Diagnose: testet, mit welchem Modell ein echter generateContent-Call klappt.
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('kein Key'); process.exit(1); }

const candidates = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash-lite',
];

for (const model of candidates) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Antworte nur mit OK.' }] }] }),
    });
    const txt = await res.text();
    let short = txt;
    try { const j = JSON.parse(txt); short = j.error ? ('ERR ' + j.error.code + ' ' + (j.error.status || '')) : 'OK'; } catch {}
    console.log(model.padEnd(28), res.status, short.slice(0, 80));
  } catch (e) {
    console.log(model.padEnd(28), 'fetch-fail', e.message);
  }
}
