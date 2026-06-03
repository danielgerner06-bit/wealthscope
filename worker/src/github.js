// GitHub Contents API: Datei lesen (mit sha) + committen. Token = Fine-grained PAT
// mit "Contents: Read and write" auf genau dieses eine Repo.

const API = 'https://api.github.com';

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'wealthscope-worker',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

// Datei holen: { json, sha } — sha wird zum Committen gebraucht.
export async function getFile(env, path) {
  const url = `${API}/repos/${env.REPO}/contents/${path}?ref=${env.BRANCH}`;
  const res = await fetch(url, { headers: ghHeaders(env.GITHUB_TOKEN) });
  if (res.status === 404) return { json: null, sha: null };
  if (!res.ok) throw new Error(`GitHub GET ${path}: HTTP ${res.status}`);
  const data = await res.json();
  // Inhalt ist base64; in Worker via atob dekodieren (UTF-8-sicher)
  const bin = atob(data.content.replace(/\n/g, ''));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  const text = new TextDecoder().decode(bytes);
  return { json: JSON.parse(text), sha: data.sha };
}

// Datei committen. `sha` = aktueller Blob-sha (oder null bei Neuanlage).
// Gibt den neuen sha zurück; wirft bei 409 (Konflikt) -> Aufrufer kann neu lesen.
export async function putFile(env, path, obj, sha, message) {
  const text = JSON.stringify(obj, null, 2);
  // UTF-8 -> base64 (btoa kann kein UTF-8 direkt)
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const content = btoa(bin);
  const body = { message, content, branch: env.BRANCH };
  if (sha) body.sha = sha;
  const res = await fetch(`${API}/repos/${env.REPO}/contents/${path}`, {
    method: 'PUT', headers: ghHeaders(env.GITHUB_TOKEN), body: JSON.stringify(body),
  });
  if (res.status === 409 || res.status === 422) { const e = new Error('conflict'); e.conflict = true; throw e; }
  if (!res.ok) throw new Error(`GitHub PUT ${path}: HTTP ${res.status} ${await res.text()}`);
  return (await res.json())?.content?.sha || null;
}
