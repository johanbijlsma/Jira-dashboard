# Preflight Checklist (Production)

Gebruik deze checklist voordat je `docker compose -f docker-compose.prod.yml up -d --build` draait.

## Root `.env` verplicht
- `POSTGRES_HOST`
- `POSTGRES_PORT`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `JIRA_BASE`
- `JIRA_EMAIL`
- `JIRA_TOKEN`
- `JIRA_PROJECT`
- `BACKEND_CORS_ORIGINS`
- `NEXT_PUBLIC_API_BASE`

## Geen localhost in productie
- `NEXT_PUBLIC_API_BASE` is **niet** `http://localhost:8000`
- `BACKEND_CORS_ORIGINS` bevat je echte frontend origin, bijvoorbeeld `https://dashboard.example.com`
- `BACKEND_CORS_ORIGINS` bevat geen localhost origins in productie

## Secrets en toegang
- `JIRA_TOKEN` is gevuld en geldig
- DB-credentials kloppen met je productie database
- `.env` is niet publiek/versioned gedeeld

## Database schema
- Kolom check uitgevoerd:
```sql
ALTER TABLE issues ADD COLUMN IF NOT EXISTS assignee text;
```

## Build en start
- Eerste deploy:
```bash
docker compose -f docker-compose.prod.yml up -d --build
```
- Na wijziging van `NEXT_PUBLIC_API_BASE`:
```bash
docker compose -f docker-compose.prod.yml build dashboard
docker compose -f docker-compose.prod.yml up -d dashboard
```

## Health check na deploy
- `docker compose -f docker-compose.prod.yml ps`
- `docker compose -f docker-compose.prod.yml logs -f api`
- `docker compose -f docker-compose.prod.yml logs -f dashboard`
- API endpoint bereikbaar op externe URL
- Dashboard kan data laden (geen CORS errors)
