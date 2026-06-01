# Jira Dashboard

Een volledige Laravel 11 rewrite van het Jira servicedesk-dashboard, opgebouwd rond MySQL, Tailwind CSS en Livewire.

## Stack

- PHP 8.2+
- Laravel 11
- MySQL 8
- Livewire 3
- Tailwind CSS
- Vite

## Lokale setup

1. Installeer PHP 8.2+, Composer, Node.js 20+ en MySQL 8 lokaal.
2. Kopieer de voorbeeldconfiguratie:

```bash
cp .env.example .env
```

3. Installeer dependencies:

```bash
composer install
npm install
```

4. Genereer de app key en maak de database klaar:

```bash
php artisan key:generate
php artisan migrate
```

5. Start de applicatie:

```bash
make dev
```

Dit start:
- de Laravel webserver
- de Vite dev server
- de Laravel scheduler voor automatische syncs

## Sync live volgen

Als je de Jira-sync net als vroeger direct in je terminal wilt volgen, gebruik dan:

```bash
make sync-now
```

Voor een volledige sync:

```bash
make sync-full-now
```

Deze commando's draaien de sync in de voorgrond en tonen live:
- Jira requests per pagina
- response tijden
- batch upserts
- totalen en afronding

## Automatische sync

De oude dashboard-opzet synchroniseerde automatisch. Deze Laravel-versie doet dat nu ook weer via de scheduler.

- `AUTO_SYNC_ENABLED=true` zet automatische sync aan
- `SYNC_INCREMENTAL_INTERVAL_SECONDS=45` bepaalt de interval voor incremental syncs

Lokaal wordt dit automatisch meegenomen door `make dev`. Los starten kan ook met:

```bash
make schedule
```

Automatische full syncs zijn uitgeschakeld. Een full sync start alleen nog handmatig via `/status` of `make sync-full-now`.

## Belangrijkste onderdelen

- `/` toont het Livewire-dashboard
- `/status` toont sync- en queue-status
- `/api/*` bevat JSON-endpoints voor filters, metrics, alerts, insights, vakanties en sync-beheer
- `app/Services` bevat de businesslogica voor Jira-sync, metrics, alerts en configuratie
- `database/migrations` bevat de volledige MySQL-schema-opbouw

## Historische data

De rewrite is voorbereid op een schone MySQL-start. Als historische data mee moet, voeg dan een eenmalige importstap toe via een artisan command voordat de oude omgeving definitief wordt uitgefaseerd.
