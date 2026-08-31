# Local Setup

Use the same native stack locally as in production: Postgres, FastAPI, and Next.js.

## 1) Configure `.env`

Create `.env` from `.env.example` and use local values:

```bash
cp .env.example .env
```

Recommended local defaults:
- `POSTGRES_HOST=localhost`
- `POSTGRES_PORT=5432`
- `POSTGRES_DB=jsm_analytics`
- `NEXT_PUBLIC_API_BASE=http://127.0.0.1:8000`
- `BACKEND_CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000`

## 2) Start Postgres

Install and start a native Postgres instance on your machine, then create the database and user from `.env`.

## 3) Install dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
npm --prefix dashboard ci
```

## 4) Run the app

In one terminal:

```bash
make dev-api
```

In a second terminal:

```bash
make dev-frontend
```

## 5) Verify health

```bash
make db-check
make dev-check
```

Open:
- `http://127.0.0.1:8000/status`
- `http://127.0.0.1:3000`

## Lichte lokale modus

Gebruik dit wanneer je alleen in het dashboard wilt kijken of handmatig wilt synchroniseren:

```bash
make local-light
```

De eerste keer bouwt deze opdracht de frontend en start daarna de productie-servers lokaal. Daarna
wordt dezelfde build hergebruikt. Daardoor zijn Next.js Hot Module Reloading en de Python
file-watcher uitgeschakeld. Ook worden er geen automatische Jira-syncs, Weekly Insights-generaties
of Teams-alerts gestart. De backend gebruikt hierbij de standaard `asyncio`-eventloop in plaats van
`uvloop`, om onnodige idle-CPU-belasting op macOS te voorkomen. Gebruik de statuspagina of `make sync`
wanneer je gegevens wilt verversen. Na een wijziging aan de frontend vernieuw je de build met
`make local-light-build`.

## Safe local mode without Teams alerts

If you want to use the dashboard locally without sending duplicate Teams alerts, use:

```bash
make dev-local-no-alerts
```

This starts both the API and the frontend locally, with:
- `ALERT_TEAMS_NOTIFICATIONS_ENABLED=false`, so no Teams notifications are sent
- auto-sync left enabled, so local SLA/live warning data keeps updating as usual

You can still trigger a manual sync from the status page or by running `make sync`.
