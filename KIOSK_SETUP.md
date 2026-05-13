# Raspberry Pi Kiosk Setup

Dit document beschrijft de twee bestanden die samen de kiosk-weergave op de Raspberry Pi bepalen.

## 1. Kioskscript

Dit is het shellscript dat Chromium opstart. De exacte bestandsnaam of locatie kan per Pi verschillen, maar dit script regelt het runtime-gedrag van de browser.

### Verantwoordelijkheden

- wacht kort na boot of sessiestart zodat `labwc` en Wayland volledig opgestart zijn
- sluit oude Chromium-processen af om dubbele kioskvensters te voorkomen
- zoekt automatisch `chromium` of `chromium-browser`
- start een achtergrondlus die periodiek een nette refresh uitvoert via `wtype`
- start Chromium in kioskmodus op het dashboard

### Belangrijkste opties

- `--kiosk`
  Start Chromium fullscreen zonder normale browser-UI.
- `--incognito`
  Voorkomt dat een normale browsersessie of profielgeschiedenis in de weg zit.
- `--high-dpi-support=1`
  Zet HiDPI-ondersteuning aan.
- `--force-device-scale-factor=1.75`
  Vergroot de volledige UI zodat het dashboard leesbaar blijft op de 4K-tv.

### Auto-refresh

De refresh gebeurt via `wtype` onder Wayland:

```bash
wtype -M ctrl -k r -m ctrl
```

Dit verstuurt een normale `Ctrl+R` naar Chromium, wat netter is dan het browserproces killen en opnieuw starten.

### Voorbeeldscript

```bash
#!/usr/bin/env bash
set -euo pipefail

URL="https://jira-dashboard.planningsagenda.dev/"

sleep 10

pkill -f chromium || true
pkill -f chromium-browser || true

if command -v chromium >/dev/null 2>&1; then
  BROWSER="$(command -v chromium)"
elif command -v chromium-browser >/dev/null 2>&1; then
  BROWSER="$(command -v chromium-browser)"
else
  echo "Chromium niet gevonden"
  exit 1
fi

if command -v wtype >/dev/null 2>&1; then
  (
    sleep 8
    wtype -k F12 || true

    while true; do
      sleep 300
      wtype -M ctrl -k r -m ctrl || true
    done
  ) &
fi

exec "$BROWSER" \
  --kiosk \
  --incognito \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --password-store=basic \
  --high-dpi-support=1 \
  --force-device-scale-factor=1.75 \
  "$URL"
```

## 2. labwc-config

Bestand:

`/home/twentecs-sd-dashboard/.config/labwc/rc.xml`

Dit bestand regelt gedrag van de Wayland compositor `labwc`. In deze setup wordt het gebruikt om de cursor te verbergen.

### Verantwoordelijkheden

- laadt standaard `labwc` keybindings
- definieert een extra `F12` keybinding
- verplaatst de cursor naar de rand van het scherm
- verbergt daarna de cursor

### Waarom dit nodig is

De kiosk draait onder `labwc` op Wayland. In deze setup is de cursor niet op een eenvoudige X11-manier uit te schakelen. Daarom gebruikt de kiosk een `labwc`-actie om de cursor eenmalig te verbergen. Omdat er geen muis is aangesloten, blijft hij daarna uit beeld.

### Inhoud van `rc.xml`

```xml
<?xml version="1.0" ?>
<labwc_config>
  <keyboard>
    <default />
    <keybind key="F12">
      <action name="WarpCursor" to="output" x="-1" y="-1" />
      <action name="HideCursor" />
    </keybind>
  </keyboard>
</labwc_config>
```

### Hoe dit samenwerkt met het kioskscript

Het kioskscript verstuurt vlak na het starten van Chromium één keer `F12` via `wtype`:

```bash
wtype -k F12
```

Daardoor voert `labwc` automatisch deze twee acties uit:

- `WarpCursor`
  Verplaatst de cursor naar de rand of hoek zodat hover-effecten niet in beeld blijven.
- `HideCursor`
  Verbergt de cursor.

## Samenvatting

- het kioskscript regelt browserstart, schaal en refresh
- `rc.xml` regelt het verbergen van de cursor binnen `labwc`
- de combinatie van beide zorgt voor een stabiele, leesbare tv-weergave op de Raspberry Pi
