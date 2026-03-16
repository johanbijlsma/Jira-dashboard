# Preflight Checklist (Production)

Gebruik deze checklist voordat je een productie-deploy draait.

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

## Uniforme stack
- Development en productie gebruiken beide native Postgres, FastAPI en Next.js
- Backend draait als native service of proces
- Frontend draait als native service of proces
- Er is geen Docker-stap nodig in de standaard workflow

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
- Eerste native deploy:
```bash
python3 -m pip install -r requirements.txt
cd dashboard && npm ci && npm run build
```
- Backend startcommando beschikbaar:
```bash
uvicorn api:app --host 0.0.0.0 --port 8000
```
- Frontend startcommando beschikbaar:
```bash
cd dashboard && npm run start
```
- Na wijziging van `NEXT_PUBLIC_API_BASE` is de frontend opnieuw gebouwd

## Service management
- Er is een native procesmanager gekozen, bijvoorbeeld `systemd`, `supervisor` of `pm2`
- Backend service kan herstart worden zonder handmatige shell-sessie
- Frontend service kan herstart worden zonder handmatige shell-sessie

## Health check na deploy
- API status endpoint geeft response:
```bash
curl -sS http://127.0.0.1:8000/status
```
- API endpoint bereikbaar op externe URL
- Dashboard kan data laden (geen CORS errors)
