// Diagnose: welche Gemini-Modelle darf dieser Key? (loggt KEINEN Key)
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('kein Key'); process.exit(1); }

const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + KEY);
console.log('HTTP', res.status);
const j = await res.json();
if (j.error) { console.log('ERROR:', JSON.stringify(j.error).slice(0, 600)); process.exit(0); }
for (const m of (j.models || [])) {
  if ((m.supportedGenerationMethods || []).includes('generateContent')) {
    console.log(m.name);
  }
}
