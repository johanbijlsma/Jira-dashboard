# Exonet Handover - Jira Dashboard

## Doel
- Host het dashboard op een subdomein, bijvoorbeeld `dashboard.<domein>`.
- Host de API op een apart subdomein, bijvoorbeeld `api.<domein>`.
- Draai de bestaande Docker-gebaseerde stack zonder functionele herbouw.

## Huidige stack
- Frontend: Next.js (`dashboard/`)
- Backend: FastAPI (`api.py`, `Dockerfile.api`)
- Database: PostgreSQL
- Orkestratie: Docker Compose (`docker-compose.prod.yml`)

## Vereisten hosting
- Linux host met Docker + Docker Compose (of gelijkwaardige container hosting).
- TLS certificaten voor beide subdomeinen.
- Reverse proxy routing:
  - `dashboard.<domein>` -> frontend container (`:3000`)
  - `api.<domein>` -> API container (`:8000`)
- Uitgaande toegang naar Atlassian/Jira API endpoints.

## Vereiste environment variables
- Database:
  - `POSTGRES_HOST`
  - `POSTGRES_PORT`
  - `POSTGRES_DB`
  - `POSTGRES_USER`
  - `POSTGRES_PASSWORD`
- Jira:
  - `JIRA_BASE`
  - `JIRA_EMAIL`
  - `JIRA_TOKEN`
  - `JIRA_PROJECT`
- Frontend/API koppeling:
  - `NEXT_PUBLIC_API_BASE=https://api.<domein>`
  - `BACKEND_CORS_ORIGINS=https://dashboard.<domein>`

## Security
- Geen secrets in code of git; alleen via environment variables.
- Minimaal TLS op beide subdomeinen.
- Aanbevolen: IP allowlist of VPN voor interne toegang.
- Optioneel: authenticatie voor dashboardtoegang (Basic Auth of SSO).

## Backups
- Dagelijkse PostgreSQL backup met retentie 14-30 dagen.
- Aanwezige scripts:
  - `ops/backup/backup.sh`
  - `ops/backup/restore.sh`
- Makefile targets:
  - `make backup-db`
  - `make restore-db DUMP=backups/<file>.dump`

## Operationele checks na livegang
- API health/status endpoint bereikbaar.
- Dashboard laadt zonder CORS-fouten.
- Handmatige sync werkt via `/status`.
- Backups draaien volgens schema en restore is getest.
