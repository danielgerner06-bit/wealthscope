# SektorScope – tägliche Datenaktualisierung

Die Seite lädt ihre Daten aus `sectordata.json` im Projekt-Root. Diese Datei wird
**täglich automatisch** per GitHub Action und der Gemini-API aktualisiert.

## Einrichtung (einmalig)

1. **Gemini-API-Key besorgen** (kostenlos): https://aistudio.google.com/apikey
2. Auf GitHub im Repo: **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `GEMINI_API_KEY`
   - Value: dein Key
3. Fertig. Die Action `.github/workflows/update-sectors.yml` läuft täglich um 05:00 UTC,
   ruft Gemini auf, schreibt `sectordata.json` und committet sie automatisch.

> Der Key liegt **nur** als GitHub-Secret und ist nie im öffentlichen Code sichtbar.

## Manuell auslösen

Im Repo unter **Actions → "Sektordaten aktualisieren" → Run workflow**.

## Lokal testen

```bash
GEMINI_API_KEY=dein_key node scripts/update-sectors.mjs
```

Schlägt der KI-Aufruf fehl oder ist die Antwort ungültig, bricht das Skript ab und
die bestehende `sectordata.json` bleibt unverändert – die Seite zeigt nie kaputte Daten.

Optional: anderes Modell via `GEMINI_MODEL=...` (Standard: `gemini-2.5-flash`).
Hinweis: `gemini-2.0-flash` hat im Free Tier dieses Keys kein Kontingent (HTTP 429),
deshalb ist `gemini-2.5-flash` voreingestellt.
