# QA Checklist (JSM Dashboard)

Datum: ____________________

## Servers
- Backend gestart: `uvicorn api:app --port 8000`
- Frontend gestart: `cd dashboard && npm run dev`

## Backfill (bij nieuwe DB kolommen)
- Full sync endpoint: `POST /sync/full`
- Of run `import_issues.py` om alles opnieuw te laden
- Zie ook `DB_CHANGE_REMINDER.md`

## Hotkeys
- `m` → toast “Datumselectie: laatste maand”, grafieken updaten
- `j` → toast “Datumselectie: laatste jaar”, grafieken updaten
- `r` → toast “Filters gereset”
- `s` → toast “Sync gestart” (of “Sync is al bezig”)

## Grafieken
- “Volume per week” toont lijnen per type + “Totaal”
- Klik op type‑lijn opent drilldown
- Klik op “Totaal” opent drilldown zonder type‑filter

## Onderwerp logging
- Switch werkt: Line ↔ Pie
- Line‑grafiek toont lijnen per onderwerp (week‑serie)
- Pie‑grafiek toont totaal per onderwerp, gesorteerd groot → klein
- Pie‑legend is verborgen
- Klik op onderwerp‑lijn opent drilldown met onderwerp‑filter
- Klik op pie‑slice opent drilldown met onderwerp‑filter
- Na klik wordt onderwerp‑dropdown gesynchroniseerd

## Drilldown paneel
- Slide‑in opent rechts bij klik op line/pie
- Overlay zichtbaar; klik op overlay sluit paneel
- `Esc` sluit paneel
- Focus blijft in paneel (Tab/Shift+Tab)

## Filters & Data
- Datumselectie (handmatig) werkt en toont data
- Request type filter werkt en kleurt lijnen/labels
- Onderwerp filter werkt en beïnvloedt p90 + onderwerp‑grafiek
