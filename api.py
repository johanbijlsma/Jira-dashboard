import os
from datetime import datetime
from typing import Optional

import psycopg2
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

# Prefer POSTGRES_* (from docker/.env). Fall back to DB_* for backward compatibility.
PG_HOST = os.environ.get("POSTGRES_HOST") or os.environ.get("DB_HOST") or "localhost"
PG_PORT = int(os.environ.get("POSTGRES_PORT") or os.environ.get("DB_PORT") or 5432)
PG_DB = os.environ.get("POSTGRES_DB") or os.environ.get("DB_NAME") or "jsm_analytics"
PG_USER = os.environ.get("POSTGRES_USER") or os.environ.get("DB_USER") or "jsm"
PG_PASSWORD = os.environ.get("POSTGRES_PASSWORD") or os.environ.get("DB_PASSWORD") or "jsm_password"


def conn():
    """Create a new Postgres connection per request."""
    return psycopg2.connect(
        host=PG_HOST,
        port=PG_PORT,
        dbname=PG_DB,
        user=PG_USER,
        password=PG_PASSWORD,
    )

app = FastAPI(title="JSM Analytics API")

# Frontend draait op 3000; allow CORS voor lokale dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/meta")
def meta():
    with conn() as c, c.cursor() as cur:
        cur.execute("select distinct request_type from issues where request_type is not null order by 1;")
        request_types = [r[0] for r in cur.fetchall()]
        cur.execute("select distinct onderwerp_logging from issues where onderwerp_logging is not null order by 1;")
        onderwerpen = [r[0] for r in cur.fetchall()]
    return {"request_types": request_types, "onderwerpen": onderwerpen}

@app.get("/metrics/volume_weekly")
def volume_weekly(
    date_from: str = Query(..., description="ISO date/time, e.g. 2025-01-01"),
    date_to: str = Query(..., description="ISO date/time, e.g. 2026-01-01"),
    request_type: Optional[str] = None,
    onderwerp: Optional[str] = None,
):
    q = """
    select
      date_trunc('week', created_at) as week,
      request_type,
      count(*) as tickets
    from issues
    where created_at >= %s::timestamptz and created_at < %s::timestamptz
      and (%s is null or request_type = %s)
      and (%s is null or onderwerp_logging = %s)
    group by 1,2
    order by 1,2;
    """
    with conn() as c, c.cursor() as cur:
        cur.execute(q, (date_from, date_to, request_type, request_type, onderwerp, onderwerp))
        rows = cur.fetchall()

    # Return as list for easy charting
    return [{"week": r[0].isoformat(), "request_type": r[1], "tickets": r[2]} for r in rows]

@app.get("/metrics/leadtime_p90_by_type")
def leadtime_p90_by_type(
    date_from: str = Query(...),
    date_to: str = Query(...),
    onderwerp: Optional[str] = None,
):
    q = """
    select
      request_type,
      percentile_cont(0.90) within group (
        order by extract(epoch from (resolved_at - created_at))/3600.0
      ) as p90_hours,
      count(*) as n
    from issues
    where resolved_at is not null
      and created_at >= %s::timestamptz and created_at < %s::timestamptz
      and (%s is null or onderwerp_logging = %s)
    group by 1
    order by 1;
    """
    with conn() as c, c.cursor() as cur:
        cur.execute(q, (date_from, date_to, onderwerp, onderwerp))
        rows = cur.fetchall()
    return [{"request_type": r[0], "p90_hours": float(r[1]) if r[1] is not None else None, "n": r[2]} for r in rows]

@app.get("/issues")
def issues(
    date_from: str,
    date_to: str,
    request_type: Optional[str] = None,
    onderwerp: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
):
    q = """
    select issue_key, request_type, onderwerp_logging, created_at, resolved_at, priority, current_status
    from issues
    where created_at >= %s::timestamptz and created_at < %s::timestamptz
      and (%s is null or request_type = %s)
      and (%s is null or onderwerp_logging = %s)
    order by created_at desc
    limit %s offset %s;
    """
    with conn() as c, c.cursor() as cur:
        cur.execute(q, (date_from, date_to, request_type, request_type, onderwerp, onderwerp, limit, offset))
        rows = cur.fetchall()

    return [
        {
            "issue_key": r[0],
            "request_type": r[1],
            "onderwerp": r[2],
            "created_at": r[3].isoformat(),
            "resolved_at": r[4].isoformat() if r[4] else None,
            "priority": r[5],
            "status": r[6],
        }
        for r in rows
    ]
