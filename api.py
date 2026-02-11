import os
import time
import threading
from datetime import datetime, timedelta, timezone
from typing import Optional

import requests
import psycopg2
from fastapi import BackgroundTasks, FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

# --- Jira config ---
JIRA_BASE = os.environ.get("JIRA_BASE", "https://planningsagenda.atlassian.net").rstrip("/")
JIRA_EMAIL = os.environ.get("JIRA_EMAIL")
JIRA_TOKEN = os.environ.get("JIRA_TOKEN")
JIRA_PROJECT = os.environ.get("JIRA_PROJECT", "SD")

REQUEST_TYPE_FIELD = os.environ.get("REQUEST_TYPE_FIELD", "customfield_10010")
ONDERWERP_FIELD = os.environ.get("ONDERWERP_FIELD", "customfield_10143")

_jira = requests.Session()
if JIRA_EMAIL and JIRA_TOKEN:
    _jira.auth = (JIRA_EMAIL, JIRA_TOKEN)
_jira.headers.update({"Accept": "application/json", "Content-Type": "application/json"})

_sync_lock = threading.Lock()
_sync_running = False
_sync_last_error = None
_sync_last_run = None
_sync_last_result = None

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


def get_last_sync():
    with conn() as c, c.cursor() as cur:
        cur.execute("select last_sync from sync_state where id=1")
        row = cur.fetchone()
        return row[0] if row else None



def set_last_sync(ts: datetime):
    with conn() as c, c.cursor() as cur:
        cur.execute("update sync_state set last_sync=%s where id=1", (ts,))
        c.commit()



def jira_search(jql: str, max_results: int = 100, next_page_token: Optional[str] = None):
    payload = {
        "jql": jql,
        "maxResults": max_results,
        "fields": [
            "key",
            "created",
            "updated",
            "resolutiondate",
            "status",
            "priority",
            "assignee",
            REQUEST_TYPE_FIELD,
            ONDERWERP_FIELD,
        ],
    }
    if next_page_token:
        payload["nextPageToken"] = next_page_token

    r = _jira.post(f"{JIRA_BASE}/rest/api/3/search/jql", json=payload, timeout=60)

    # Rate limit handling
    if r.status_code == 429:
        retry = int(r.headers.get("Retry-After", "5"))
        time.sleep(retry)
        return jira_search(jql, max_results=max_results, next_page_token=next_page_token)

    r.raise_for_status()
    return r.json()

def parse_jira_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S%z"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def format_jql_datetime(dt: datetime) -> str:
    # JQL accepts "YYYY-MM-DD HH:MM"
    dt_utc = dt.astimezone(timezone.utc)
    return dt_utc.strftime("%Y-%m-%d %H:%M")



def norm_request_type(v):
    # JSM Request Type komt als object met requestType.name
    if isinstance(v, dict):
        rt = v.get("requestType") or {}
        name = rt.get("name")
        if name:
            return name
    return None



def norm_dropdown(v):
    # Dropdown option komt meestal als dict met value
    if isinstance(v, dict):
        return v.get("value") or v.get("name")
    return None if v is None else str(v)

def norm_assignee(v):
    if isinstance(v, dict):
        return v.get("displayName") or v.get("emailAddress") or v.get("accountId")
    return None if v is None else str(v)



def upsert_issues(issues):
    with conn() as c, c.cursor() as cur:
        for it in issues:
            f = it["fields"]
            issue_key = it["key"]

            request_type = norm_request_type(f.get(REQUEST_TYPE_FIELD))
            onderwerp = norm_dropdown(f.get(ONDERWERP_FIELD))

            created_at = f.get("created")
            updated_at = f.get("updated")
            resolved_at = f.get("resolutiondate")

            status = (f.get("status") or {}).get("name")
            priority = (f.get("priority") or {}).get("name")
            assignee = norm_assignee(f.get("assignee"))

            cur.execute(
                """
                insert into issues(issue_key, request_type, onderwerp_logging, created_at, resolved_at, updated_at, priority, assignee, current_status)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                on conflict (issue_key) do update set
                  request_type=excluded.request_type,
                  onderwerp_logging=excluded.onderwerp_logging,
                  created_at=excluded.created_at,
                  resolved_at=excluded.resolved_at,
                  updated_at=excluded.updated_at,
                  priority=excluded.priority,
                  assignee=excluded.assignee,
                  current_status=excluded.current_status
                """,
                (issue_key, request_type, onderwerp, created_at, resolved_at, updated_at, priority, assignee, status),
            )
        c.commit()



def run_sync_once(full: bool = False):
    """
    Incremental sync op basis van 'updated' sinds last_sync.
    We gebruiken 5 minuten overlap om edge-cases te voorkomen.
    """
    global _sync_running, _sync_last_error, _sync_last_run, _sync_last_result

    if not (JIRA_EMAIL and JIRA_TOKEN):
        raise RuntimeError("JIRA_EMAIL/JIRA_TOKEN ontbreken in .env")

    with _sync_lock:
        if _sync_running:
            return {"started": False, "reason": "already running"}
        _sync_running = True
        _sync_last_error = None
        _sync_last_run = datetime.utcnow().isoformat() + "Z"
        _sync_last_result = None

    try:
        last = None if full else get_last_sync()
        now_utc = datetime.utcnow()

        if last is None:
            jql = f'project = {JIRA_PROJECT} AND "cf[10010]" is not EMPTY ORDER BY updated ASC'
        else:
            # overlap om misses te voorkomen
            window_start = last - timedelta(minutes=5)
            jql = (
                f'project = {JIRA_PROJECT} '
                f'AND updated >= "{format_jql_datetime(window_start)}" '
                f'AND "cf[10010]" is not EMPTY '
                f'ORDER BY updated ASC'
            )

        next_token = None
        total = 0
        max_updated = None

        while True:
            data = jira_search(jql, max_results=100, next_page_token=next_token)
            batch = data.get("issues", [])
            if batch:
                upsert_issues(batch)
                total += len(batch)
                for issue in batch:
                    updated_raw = issue.get("fields", {}).get("updated")
                    updated_dt = parse_jira_datetime(updated_raw)
                    if updated_dt and (max_updated is None or updated_dt > max_updated):
                        max_updated = updated_dt

            next_token = data.get("nextPageToken")
            if data.get("isLast") or not next_token:
                break

        # Zet last_sync op max(updated) om clock/indexing skew te voorkomen
        if max_updated is not None:
            set_last_sync(max_updated.astimezone(timezone.utc).replace(tzinfo=None))
            set_ts = max_updated.astimezone(timezone.utc).isoformat() + "Z"
        elif last is None:
            set_last_sync(now_utc)
            set_ts = now_utc.isoformat() + "Z"
        else:
            # Geen resultaten: houd last_sync gelijk om geen updates te missen
            set_ts = last.isoformat() + "Z"

        _sync_last_result = {"upserts": total, "set_last_sync": set_ts}
        return {"started": True, "upserts": total}

    except Exception as e:
        _sync_last_error = str(e)
        raise
    finally:
        with _sync_lock:
            _sync_running = False


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
        cur.execute("select distinct priority from issues where priority is not null order by 1;")
        priorities = [r[0] for r in cur.fetchall()]
        cur.execute("select distinct assignee from issues where assignee is not null order by 1;")
        assignees = [r[0] for r in cur.fetchall()]
    return {
        "request_types": request_types,
        "onderwerpen": onderwerpen,
        "priorities": priorities,
        "assignees": assignees,
    }


@app.get("/metrics/volume_weekly")
def volume_weekly(
    date_from: str = Query(..., description="ISO date/time, e.g. 2025-01-01"),
    date_to: str = Query(..., description="ISO date/time, e.g. 2026-01-01"),
    request_type: Optional[str] = None,
    onderwerp: Optional[str] = None,
    priority: Optional[str] = None,
    assignee: Optional[str] = None,
    servicedesk_only: bool = False,
):
    q = """
    select
      date_trunc('week', created_at) as week,
      request_type,
      count(*) as tickets
    from issues
    where created_at >= %s::timestamptz and created_at < (%s::timestamptz + interval '1 day')
      and (%s is null or request_type = %s)
      and (%s is null or onderwerp_logging = %s)
      and (%s is null or priority = %s)
      and (%s is null or assignee = %s)
      and (
        not %s
        or onderwerp_logging is null
        or onderwerp_logging not in ('Koppelingen', 'datadump', 'Rest-endpoints', 'migratie', 'SSO-koppeling')
      )
    group by 1,2
    order by 1,2;
    """
    with conn() as c, c.cursor() as cur:
        cur.execute(
            q,
            (
                date_from,
                date_to,
                request_type,
                request_type,
                onderwerp,
                onderwerp,
                priority,
                priority,
                assignee,
                assignee,
                servicedesk_only,
            ),
        )
        rows = cur.fetchall()

    # Return as list for easy charting
    return [{"week": r[0].isoformat(), "request_type": r[1], "tickets": r[2]} for r in rows]


@app.get("/metrics/leadtime_p90_by_type")
def leadtime_p90_by_type(
    date_from: str = Query(...),
    date_to: str = Query(...),
    onderwerp: Optional[str] = None,
    priority: Optional[str] = None,
    assignee: Optional[str] = None,
    servicedesk_only: bool = False,
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
      and created_at >= %s::timestamptz and created_at < (%s::timestamptz + interval '1 day')
      and (%s is null or onderwerp_logging = %s)
      and (%s is null or priority = %s)
      and (%s is null or assignee = %s)
      and (
        not %s
        or onderwerp_logging is null
        or onderwerp_logging not in ('Koppelingen', 'datadump', 'Rest-endpoints', 'migratie', 'SSO-koppeling')
      )
    group by 1
    order by 1;
    """
    with conn() as c, c.cursor() as cur:
        cur.execute(
            q,
            (date_from, date_to, onderwerp, onderwerp, priority, priority, assignee, assignee, servicedesk_only),
        )
        rows = cur.fetchall()
    return [{"request_type": r[0], "p90_hours": float(r[1]) if r[1] is not None else None, "n": r[2]} for r in rows]


@app.get("/metrics/volume_by_priority")
def volume_by_priority(
    date_from: str = Query(...),
    date_to: str = Query(...),
    request_type: Optional[str] = None,
    onderwerp: Optional[str] = None,
    priority: Optional[str] = None,
    assignee: Optional[str] = None,
    servicedesk_only: bool = False,
):
    q = """
    select
      priority,
      count(*) as tickets
    from issues
    where created_at >= %s::timestamptz and created_at < (%s::timestamptz + interval '1 day')
      and priority is not null
      and (%s is null or request_type = %s)
      and (%s is null or onderwerp_logging = %s)
      and (%s is null or priority = %s)
      and (%s is null or assignee = %s)
      and (
        not %s
        or onderwerp_logging is null
        or onderwerp_logging not in ('Koppelingen', 'Datadump', 'Rest-endpoints', 'Migratie', 'SSO-koppeling')
      )
    group by 1
    order by 2 desc, 1;
    """
    with conn() as c, c.cursor() as cur:
        cur.execute(
            q,
            (
                date_from,
                date_to,
                request_type,
                request_type,
                onderwerp,
                onderwerp,
                priority,
                priority,
                assignee,
                assignee,
                servicedesk_only,
            ),
        )
        rows = cur.fetchall()
    return [{"priority": r[0], "tickets": r[1]} for r in rows]


@app.get("/metrics/volume_by_assignee")
def volume_by_assignee(
    date_from: str = Query(...),
    date_to: str = Query(...),
    request_type: Optional[str] = None,
    onderwerp: Optional[str] = None,
    priority: Optional[str] = None,
    assignee: Optional[str] = None,
    servicedesk_only: bool = False,
):
    q = """
    select
      assignee,
      count(*) as tickets
    from issues
    where created_at >= %s::timestamptz and created_at < (%s::timestamptz + interval '1 day')
      and assignee is not null
      and (%s is null or request_type = %s)
      and (%s is null or onderwerp_logging = %s)
      and (%s is null or priority = %s)
      and (%s is null or assignee = %s)
      and (
        not %s
        or onderwerp_logging is null
        or onderwerp_logging not in ('Koppelingen', 'datadump', 'Rest-endpoints', 'migratie', 'SSO-koppeling')
      )
    group by 1
    order by 2 desc, 1;
    """
    with conn() as c, c.cursor() as cur:
        cur.execute(
            q,
            (
                date_from,
                date_to,
                request_type,
                request_type,
                onderwerp,
                onderwerp,
                priority,
                priority,
                assignee,
                assignee,
                servicedesk_only,
            ),
        )
        rows = cur.fetchall()
    return [{"assignee": r[0], "tickets": r[1]} for r in rows]


@app.get("/metrics/volume_weekly_by_onderwerp")
def volume_weekly_by_onderwerp(
    date_from: str = Query(..., description="ISO date/time, e.g. 2025-01-01"),
    date_to: str = Query(..., description="ISO date/time, e.g. 2026-01-01"),
    request_type: Optional[str] = None,
    onderwerp: Optional[str] = None,
    priority: Optional[str] = None,
    assignee: Optional[str] = None,
    servicedesk_only: bool = False,
):
    q = """
    select
      date_trunc('week', created_at) as week,
      onderwerp_logging as onderwerp,
      count(*) as tickets
    from issues
    where created_at >= %s::timestamptz and created_at < (%s::timestamptz + interval '1 day')
      and (%s is null or request_type = %s)
      and (%s is null or onderwerp_logging = %s)
      and (%s is null or priority = %s)
      and (%s is null or assignee = %s)
      and (
        not %s
        or onderwerp_logging is null
        or onderwerp_logging not in ('Koppelingen', 'datadump', 'Rest-endpoints', 'migratie', 'SSO-koppeling')
      )
    group by 1,2
    order by 1,2;
    """
    with conn() as c, c.cursor() as cur:
        cur.execute(
            q,
            (
                date_from,
                date_to,
                request_type,
                request_type,
                onderwerp,
                onderwerp,
                priority,
                priority,
                assignee,
                assignee,
                servicedesk_only,
            ),
        )
        rows = cur.fetchall()
    return [{"week": r[0].isoformat(), "onderwerp": r[1], "tickets": r[2]} for r in rows]


@app.get("/issues")
def issues(
    date_from: str,
    date_to: str,
    request_type: Optional[str] = None,
    onderwerp: Optional[str] = None,
    priority: Optional[str] = None,
    assignee: Optional[str] = None,
    servicedesk_only: bool = False,
    limit: int = 100,
    offset: int = 0,
):
    q = """
    select issue_key, request_type, onderwerp_logging, created_at, resolved_at, priority, assignee, current_status
    from issues
    where created_at >= %s::timestamptz and created_at < (%s::timestamptz + interval '1 day')
      and (%s is null or request_type = %s)
      and (%s is null or onderwerp_logging = %s)
      and (%s is null or priority = %s)
      and (%s is null or assignee = %s)
      and (
        not %s
        or onderwerp_logging is null
        or onderwerp_logging not in ('Koppelingen', 'datadump', 'Rest-endpoints', 'migratie', 'SSO-koppeling')
      )
    order by created_at desc
    limit %s offset %s;
    """
    with conn() as c, c.cursor() as cur:
        cur.execute(
            q,
            (
                date_from,
                date_to,
                request_type,
                request_type,
                onderwerp,
                onderwerp,
                priority,
                priority,
                assignee,
                assignee,
                servicedesk_only,
                limit,
                offset,
            ),
        )
        rows = cur.fetchall()

    return [
        {
            "issue_key": r[0],
            "request_type": r[1],
            "onderwerp": r[2],
            "created_at": r[3].isoformat(),
            "resolved_at": r[4].isoformat() if r[4] else None,
            "priority": r[5],
            "assignee": r[6],
            "status": r[7],
        }
        for r in rows
    ]


@app.get("/sync/status")
def sync_status():
    last = get_last_sync()
    return {
        "running": _sync_running,
        "last_run": _sync_last_run,
        "last_error": _sync_last_error,
        "last_result": _sync_last_result,
        "last_sync": (last.isoformat() if last else None),
    }


@app.post("/sync")
def sync(background_tasks: BackgroundTasks):
    # in background zodat je UI niet blokkeert
    background_tasks.add_task(run_sync_once)
    return {"queued": True}


@app.post("/sync/full")
def sync_full(background_tasks: BackgroundTasks):
    # full sync: negeer last_sync en haal alles opnieuw op
    background_tasks.add_task(run_sync_once, True)
    return {"queued": True, "mode": "full"}
