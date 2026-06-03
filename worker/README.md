# wealthscope Yahoo-Worker (Cloudflare)

Holt **stündlich, pünktlich** die Yahoo-Kursdaten und committet sie ins GitHub-Repo.
Ersetzt den unzuverlässigen GitHub-Actions-Cron (der 2–3h-Lücken hatte) für den
Yahoo-Teil. **Gemini/Finnhub/News bleiben** beim GitHub-Actions-Workflow (alle ~6h).

Was der Worker aktualisiert: Sektor-/Regionen-Performance, 6M-Performance,
1M-vor-Aufnahme, KGV/Kursziel/EPS/Analysten/Dividende (rollierend), Backtest-Historie.
Alles andere (Perlen-Liste, Scan-Zustand, News, Gemini-Texte) bleibt unangetastet.

## Free-Tier-Limit (wichtig)
Cloudflare Free erlaubt **50 fetch-Subrequests pro Lauf**. Daher:
- **Sektor- & Regionen-Performance** (23 Fetches) laufen JEDE Stunde komplett — das
  ist das, was stündlich frisch sein soll. ✅
- Die **rollierende Aktien-Anreicherung** (6M/1M-vor/KGV/…) teilt sich die restlichen
  ~17 Fetches und rotiert über die Perlen. Da der Worker **stündlich** läuft (24×/Tag
  statt 4× beim alten 6h-Action-Takt), ist der Tagesdurchsatz trotzdem höher.
- Reicht das nicht, hebt Workers Paid ($5/Mon, 1000 Subrequests) alle Budgets auf 40.

## Einrichtung (einmalig)

### 1. GitHub-Token erstellen
1. GitHub → Settings → Developer settings → **Fine-grained tokens** → *Generate new token*
2. **Repository access**: Only select repositories → `danielgerner06-bit/wealthscope`
3. **Permissions** → Repository permissions → **Contents: Read and write** (nur das!)
4. Token generieren und kopieren (`github_pat_…`).

### 2. Worker deployen
```bash
cd worker
npm install
npx wrangler login            # Browser-Login bei Cloudflare
npx wrangler secret put GITHUB_TOKEN   # das github_pat_… einfügen
npx wrangler secret put RUN_KEY        # frei wählbares Test-Passwort
npx wrangler deploy
```

### 3. Testen
```bash
# manueller Lauf (force = ignoriert die 50-min-Sperre):
curl "https://wealthscope-yahoo.<dein-subdomain>.workers.dev/run?key=<RUN_KEY>"
```
Antwort z. B. `{"ok":true,"perf6m":40,"pre1m":40,"enrich":40,"snapped":3,"measured":0,"pearls":462}`.
Danach im Repo prüfen: Commit „Yahoo-Kurse aktualisiert … [worker]“.

## Betrieb
- Cron läuft jede volle Stunde (`0 * * * *`), Cloudflare führt das zuverlässig aus.
- Mindestabstand-Sperre (`MIN_GAP_MIN=50`) verhindert Doppelläufe, falls sich Worker
  und GitHub-Action überschneiden.
- Bei Commit-Konflikt (paralleler Action-Commit) liest der Worker neu, merged die
  Yahoo-Felder in den frischen Stand und committet erneut (3 Versuche).
- Logs live ansehen: `npx wrangler tail`

## GitHub-Action anpassen (optional, empfohlen)
Da der Worker jetzt Yahoo macht, kann der GitHub-Workflow seltener laufen (nur noch
für Gemini/Finnhub alle 6h). Das ist nicht zwingend — beide schreiben konfliktfrei.
