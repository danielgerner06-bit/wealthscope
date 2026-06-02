# SektorScope – tägliche Datenaktualisierung

Die Seite lädt ihre Daten aus `sectordata.json` (Projekt-Root). Diese Datei wird
**täglich automatisch** per GitHub Action aktualisiert.

## Datenquellen

- **Finnhub** (`FINNHUB_API_KEY`) – echte Kurse & US-Analystenratings
  - 30-Tage-Sektor-Performance über Sektor-ETFs (IGV, SOXX, XLK, XLF …)
  - Analystenratings, **rollierend** über das US-Aktien-Universum gescannt
- **Gemini + Google-Search-Grounding** (`GEMINI_API_KEY`) – findet Analysten-Perlen
  per echter Websuche (auch für Nebenwerte wie innoscripta, die keine Gratis-API hat):
  - prüft eine **wachsende Kandidatenliste** rollierend auf die Kriterien
  - **entdeckt täglich neue unbekannte Werte** und kennt dabei die bereits gefundenen
  - schreibt zusätzlich den kurzen **Marktlage-Text**

Treffer-Kriterium überall: **Kaufempfehlungs-Anteil ≥ 80 %** (Buy + Strong Buy; Schwelle via `MIN_BUY_PCT`, Default 80).
Alle Treffer (Finnhub + Gemini) landen in einer gemeinsamen, über Tage gepflegten DB
(`topStocks`); jeder Eintrag trägt `via` (finnhub / gemini / gemini-discover) und `source`.

## Einrichtung (einmalig)

1. **Finnhub-Key** (kostenlos): https://finnhub.io → „Get free API key"
2. **Gemini-Key** (kostenlos): https://aistudio.google.com/apikey
3. Auf GitHub: **Settings → Secrets and variables → Actions → New repository secret**
   - `FINNHUB_API_KEY` = dein Finnhub-Key
   - `GEMINI_API_KEY` = dein Gemini-Key
4. Fertig. Die Action `.github/workflows/update-sectors.yml` läuft täglich 05:00 UTC.

> Beide Keys liegen **nur** als GitHub-Secret und sind nie im öffentlichen Code sichtbar.

## Rollierender Scan

Analystenratings für zehntausende Aktien einzeln abzufragen sprengt das Free-Tier
(60 Calls/Min). Deshalb prüft die Action pro Lauf nur einen Teil des Universums
(`SCAN_BUDGET`, Standard 700 Symbole) ab dem letzten Cursor und baut die Treffer-
Datenbank in `sectordata.json` über mehrere Tage auf. Fällt ein bekannter Treffer
bei erneuter Prüfung durch die Kriterien, wird er entfernt.

State steckt in `sectordata.json` unter `scan` (`universe`, `scanned`, `lastCursor`)
und in `topStocks` (die gepflegte Treffer-Datenbank).

## Manuell auslösen

Im Repo unter **Actions → „Sektordaten aktualisieren" → Run workflow**.

## Lokal testen

```bash
FINNHUB_API_KEY=... GEMINI_API_KEY=... node scripts/update-sectors.mjs
```

Fehlt der Finnhub-Key, bricht das Skript ab und `sectordata.json` bleibt unverändert
– die Seite zeigt nie kaputte Daten.

## Dateien

- `update-sectors.mjs` – Orchestrierung aller Quellen
- `finnhub.mjs` – Kurse, Universum, rollierender US-Analysten-Scan
- `gemini-stocks.mjs` – Gemini-Grounding: Kandidaten prüfen + neue Werte entdecken
- `candidates.mjs` – Startstamm der Nebenwert-Kandidatenliste (wächst zur Laufzeit)
- `sectors.mjs` – Sektordefinition + Mapping Finnhub-Industrie → Sektor-ID
- `insight.mjs` – Gemini-Analysetext (greift 2–3 auffällige Sektoren heraus)
