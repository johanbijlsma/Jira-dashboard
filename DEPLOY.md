# Deploy (Server)

Before deploying, run through `PRE_FLIGHT_CHECKLIST.md`.

Production uses the same native stack as local development:
- FastAPI runs as a normal process or service manager unit
- Next.js runs as a normal Node.js process after `npm run build`
- Postgres runs as a standard Postgres service

## 1) Environment
Create `.env` in project root based on `.env.example`.

Required backend values:
- `POSTGRES_HOST`
- `POSTGRES_PORT`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `JIRA_BASE`
- `JIRA_EMAIL`
- `JIRA_TOKEN`
- `JIRA_PROJECT`
- `BACKEND_CORS_ORIGINS` (comma-separated, e.g. `https://dashboard.example.com`)
- `NEXT_PUBLIC_API_BASE` (external API URL used when building the frontend)

Local development uses the same `.env` shape with local values:
- `POSTGRES_HOST=localhost`
- `POSTGRES_PORT=5432`
- `NEXT_PUBLIC_API_BASE=http://127.0.0.1:8000`

Recommended sync/alert values for production:
- `AUTO_SYNC_ENABLED=true`
- `SYNC_INCREMENTAL_INTERVAL_SECONDS=45`
- `SYNC_FULL_INTERVAL_HOURS=24`
- `SLA_WARNING_MINUTES=30`
- `SLA_CRITICAL_MINUTES=5`
- `SLA_OVERDUE_MAX_AGE_HOURS=24` (voorkomt ruis van oude verlopen TTFR-issues in live alerts)

### Weekly insights PDF

De backend genereert standaard iedere maandag om **08:00 Europe/Amsterdam** een PDF over de vorige volledige week. De volgende waarden maken dit instelbaar:

- `WEEKLY_INSIGHTS_ENABLED=true`
- `WEEKLY_INSIGHTS_WEEKDAY=0` (maandag; 0 = maandag t/m 6 = zondag)
- `WEEKLY_INSIGHTS_HOUR=8` en `WEEKLY_INSIGHTS_MINUTE=0`
- `WEEKLY_INSIGHTS_REPORT_DIR=/srv/jira-dashboard/weekly-insights` — gebruik in productie een persistente, beschrijfbare directory buiten een tijdelijke map.
- `WEEKLY_INSIGHTS_RETENTION_DAYS=28` — PDF's ouder dan deze termijn worden na elke generatie verwijderd.

Distributie is optioneel en gebeurt direct na generatie:

- Voor e-mail met de PDF als bijlage: configureer bij voorkeur Resend met `RESEND_API_KEY=re_xxxxxxxxx` en `RESEND_FROM="Weekly Insights <weekly-insights@jouwdomein.nl>"`. Verifieer het afzenderdomein bij Resend. Ontvangers beheer je in Dashboard configuratie; `WEEKLY_INSIGHTS_EMAIL_TO=team@example.com,...` blijft beschikbaar als serverbrede aanvullende lijst. De bestaande SMTP-configuratie (`SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, optioneel `SMTP_USERNAME`, `SMTP_PASSWORD` en `SMTP_USE_TLS=true`) blijft als fallback werken wanneer Resend niet is geconfigureerd.
- De testknop op de statuspagina verstuurt uitsluitend de meest recente bewaarde PDF naar `WEEKLY_INSIGHTS_TEST_EMAIL_TO` (standaard `johan+test@planningsagenda.nl`).
- Bij iedere Jira-sync worden, waar Jira ze beschikbaar stelt, de e-mailadressen van assignees opgeslagen. Geselecteerde servicemedewerkers met zo'n adres worden automatisch als ontvanger toegevoegd. Jira kan dit veld door profielprivacy of ontbrekende rechten verbergen; in dat geval blijft het losse adres in Dashboard configuratie beschikbaar.
- Voor Teams: configureer `WEEKLY_INSIGHTS_TEAMS_WEBHOOK_URL` en `WEEKLY_INSIGHTS_PUBLIC_BASE_URL=https://dashboard.intern`. Teams ontvangt dan een interne knop naar de bewaarde PDF. Een Incoming Webhook kan geen PDF-bijlage uploaden; gebruik daarom e-mail voor ontvangers buiten het kantoornetwerk.

Create `dashboard/.env.production` based on `dashboard/.env.example`:
- `NEXT_PUBLIC_API_BASE=https://api.example.com`
- `NEXT_PUBLIC_AUTO_SYNC_INTERVAL_SECONDS=120` (fallback only; frontend skips auto-trigger when backend autosync is enabled)
- `NEXT_PUBLIC_AUTO_RESET_IDLE_SECONDS=120` (auto-reset filters naar standaardweergave na 2 minuten inactiviteit)

Set `NEXT_PUBLIC_API_BASE=https://api.example.com` in root `.env` before running `npm run build` for production.
Note: for Next.js this value is embedded at build time. Rebuild frontend when it changes.

## 2) Local development bootstrap

Install and start a native Postgres instance, then create the development database and user from your `.env`.

Recommended local workflow:

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
cd dashboard && npm ci
```

Start the app locally:

```bash
make dev-api
make dev-frontend
```

Verify local health:

```bash
make db-check
make dev-check
```

## 3) Database check
If not present yet:

```sql
ALTER TABLE issues ADD COLUMN IF NOT EXISTS assignee text;
```

## 4) Backend run (FastAPI)

```bash
python3 -m pip install -r requirements.txt
uvicorn api:app --host 0.0.0.0 --port 8000
```

Recommended production process management:
- `systemd` or `supervisor` for FastAPI
- `systemd` or `pm2` for Next.js

Example backend `systemd` command:

```bash
/usr/bin/env bash -lc 'cd /srv/Jira-dashboard && source .venv/bin/activate && exec uvicorn api:app --host 0.0.0.0 --port 8000'
```

## 5) Frontend build and run (Next.js)

```bash
cd dashboard
npm ci
npm run build
npm run start
```

Optional custom port:

```bash
PORT=3000 npm run start
```

Example frontend `systemd` or `pm2` command:

```bash
/usr/bin/env bash -lc 'cd /srv/Jira-dashboard/dashboard && exec npm run start'
```

## 6) Reverse proxy
Recommended:
- Route `https://dashboard.example.com` -> Next.js (`localhost:3000`)
- Route `https://api.example.com` -> FastAPI (`localhost:8000`)

Ensure `BACKEND_CORS_ORIGINS` includes your frontend origin.

Recommended deployment order:
1. Provision Postgres and load production credentials into root `.env`
2. Start or restart the FastAPI service
3. Build the frontend with production env values
4. Start or restart the Next.js service
5. Run health checks and one functional dashboard check

## 7) Backfill after schema changes
When you add/rename DB columns, run a full backfill:

```bash
curl -X POST http://127.0.0.1:8000/sync/full
```

Or run `import_issues.py`.
