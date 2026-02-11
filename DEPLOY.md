# Deploy (Server)

Before deploying, run through `PRE_FLIGHT_CHECKLIST.md`.

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

Create `dashboard/.env.production` based on `dashboard/.env.example`:
- `NEXT_PUBLIC_API_BASE=https://api.example.com`

If you deploy with Docker Compose, set this in root `.env` as well:
- `NEXT_PUBLIC_API_BASE=https://api.example.com`
- Note: for Next.js this value is embedded at build time. Rebuild frontend when it changes.

## 2) Database check
If not present yet:

```sql
ALTER TABLE issues ADD COLUMN IF NOT EXISTS assignee text;
```

## 3) Backend run (FastAPI)

```bash
uvicorn api:app --host 0.0.0.0 --port 8000
```

For production process management, run via systemd/supervisor/pm2 or use container orchestration.

## 4) Frontend build and run (Next.js)

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

## 5) Reverse proxy
Recommended:
- Route `https://dashboard.example.com` -> Next.js (`localhost:3000`)
- Route `https://api.example.com` -> FastAPI (`localhost:8000`)

Ensure `BACKEND_CORS_ORIGINS` includes your frontend origin.

## 6) Backfill after schema changes
When you add/rename DB columns, run a full backfill:

```bash
curl -X POST http://127.0.0.1:8000/sync/full
```

Or run `import_issues.py`.

## 7) Docker Compose (production)

Build and run all services:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

If only `NEXT_PUBLIC_API_BASE` changed, rebuild at least the dashboard image:

```bash
docker compose -f docker-compose.prod.yml build dashboard
docker compose -f docker-compose.prod.yml up -d dashboard
```

Check status/logs:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f dashboard
```

Stop:

```bash
docker compose -f docker-compose.prod.yml down
```
