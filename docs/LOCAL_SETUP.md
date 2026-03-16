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
