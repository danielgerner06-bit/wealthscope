// Gemini-Texte: knappe Lage-Notizen je Sektor/Region (rollierend) + Markt-News-Ticker.
import { SECTORS, REGIONS } from './sectors.mjs';

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const nameOf = id => (SECTORS.find(s => s.id === id) || REGIONS.find(s => s.id === id) || {}).name || id;

async function gen(key, prompt, useSearch = false) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.6, maxOutputTokens: 6144, thinkingConfig: { thinkingBudget: 0 } },
  };
  if (useSearch) payload.tools = [{ google_search: {} }];
  const body = JSON.stringify(payload);
  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {   // flash-lite liefert sporadisch leer -> mehr Versuche
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    if (!res.ok) { lastErr = 'HTTP ' + res.status; if (res.status === 429) break; continue; }
    const j = await res.json();
    const cand = j?.candidates?.[0];
    const text = cand?.content?.parts?.map(p => p.text).filter(Boolean).join('').trim();
    if (text) return text;
    lastErr = 'leer' + (cand?.finishReason ? ' (' + cand.finishReason + ')' : '');
    await new Promise(r => setTimeout(r, 600));     // kurz warten vor erneutem Versuch
  }
  throw new Error(lastErr);
}

// Knappe Lage-Notizen für Sektoren ODER Regionen. items = [{id, perf, avg30, perf6m}, ...]
// Liefert { id: { text, date } }. Text ist SEHR kurz (1-2 Sätze).
export async function buildNotes(key, ids, bars, topStocks, kind = 'Sektor') {
  const out = {};
  const today = new Date().toISOString().slice(0, 10);
  for (const id of ids) {
    const bar = (bars || []).find(b => b.id === id);
    const perf = bar ? `${bar.perf > 0 ? '+' : ''}${bar.perf}%` : 'k. A.';
    const perf6m = bar && bar.perf6m != null ? `${bar.perf6m > 0 ? '+' : ''}${bar.perf6m}%` : 'k. A.';
    const avg = bar && bar.avg30 != null ? `${bar.avg30 > 0 ? '+' : ''}${bar.avg30}%` : 'k. A.';
    const perlen = kind === 'Sektor'
      ? (topStocks || []).filter(s => s.sector === id).slice(0, 3).map(s => s.ticker).join(', ')
      : '';

    const prompt = `${kind === 'Region' ? 'Weltregion' : 'Aktienmarkt-Sektor'} "${nameOf(id)}".
Zahlen: 30-Tage ${perf} (Normalniveau ${avg}), 6 Monate ${perf6m}${perlen ? `, auffällige Werte: ${perlen}` : ''}.

Schreibe MAXIMAL 2 sehr knappe deutsche Sätze (zusammen höchstens 30 Wörter), die SOFORT klar machen, was gerade abgeht und warum. Konkret (Zinsen, KI, Energie, Konjunktur, Geopolitik …), kein Geschwafel, keine Floskeln, keine Anlageberatung. Nur den Text.`;
    try {
      out[id] = { text: await gen(key, prompt), date: today };
    } catch (e) {
      console.error(`  ${kind}-Text ${id} fehlgeschlagen:`, e.message);
    }
  }
  return out;
}

// Markt-News-Ticker: die wichtigsten (max 3) marktbewegenden News, sehr knapp.
// Liefert { items: ["...", "..."], date } per Google-Search-Grounding.
export async function buildNews(key) {
  const today = new Date().toISOString().slice(0, 10);
  const COUNT = Number(process.env.NEWS_COUNT || 6);
  const prompt = `Suche über Google die AKTUELL wichtigsten Nachrichten der letzten ~24 Stunden, die die globalen Finanzmärkte bewegen — politisch, wirtschaftlich, geopolitisch, Notenbanken, große Unternehmen.

Gib die ${COUNT} WICHTIGSTEN als JSON-Array zurück. Jedes Element ist ein Objekt:
{ "h": "kurze deutsche Schlagzeile (max 9 Wörter, konkret)", "t": "Veröffentlichungszeit als ISO 8601, z.B. 2026-06-02T15:30:00Z" }
Sortiere nach Wichtigkeit (wichtigste zuerst). Nur das JSON-Array, kein weiterer Text.`;
  const text = await gen(key, prompt, true);
  let raw = [];
  try {
    const t = text.replace(/```json/gi, '').replace(/```/g, '');
    const a = t.indexOf('['), b = t.lastIndexOf(']');
    if (a >= 0 && b > a) raw = JSON.parse(t.slice(a, b + 1));
  } catch { /* ignore */ }

  // -> [{ text, stamp }] mit Zeitstempel TT.MM.JJ HH:MM
  const fmt = iso => {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d)) return '';
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${String(d.getUTCFullYear()).slice(2)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  };
  const items = (Array.isArray(raw) ? raw : []).map(o => {
    if (typeof o === 'string') return { text: o.trim(), stamp: '' };
    return { text: String(o.h || o.headline || o.text || '').trim(), stamp: fmt(o.t || o.time || o.date) };
  }).filter(x => x.text).slice(0, COUNT);
  if (!items.length) throw new Error('keine News geparst');
  return { items, date: today };
}
