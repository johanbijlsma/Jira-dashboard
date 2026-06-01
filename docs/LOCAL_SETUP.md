# Local setup

## Vereisten

- PHP 8.2+
- Composer
- Node.js 20+
- MySQL 8

## Setup

1. Maak een lokale database aan, bijvoorbeeld `jira_dashboard`.
2. Kopieer `.env.example` naar `.env`.
3. Installeer dependencies:

```bash
composer install
npm install
```

4. Genereer de app key:

```bash
php artisan key:generate
```

5. Draai de migraties:

```bash
php artisan migrate
```

6. Start de applicatie:

```bash
make dev
```

Dit start in een keer:
- `php artisan serve`
- `npm run dev`
- `php artisan schedule:work`

## Sync live in terminal volgen

Voor zichtbare sync-output in je terminal:

```bash
make sync-now
```

Voor een full sync:

```bash
make sync-full-now
```

## Automatische sync

De app start lokaal ook automatische syncs, net als de oude Python-versie.

- `AUTO_SYNC_ENABLED=true`
- `SYNC_INCREMENTAL_INTERVAL_SECONDS=45`

De scheduler draait standaard mee via `make dev`. Alleen de scheduler starten kan met:

```bash
make schedule
```

Automatische full syncs zijn uitgeschakeld. Voor een full sync gebruik je handmatig `/status` of `make sync-full-now`.

## Beschikbare URLs

- `http://127.0.0.1:8000/`
- `http://127.0.0.1:8000/status`
- `http://127.0.0.1:8000/api/status`
