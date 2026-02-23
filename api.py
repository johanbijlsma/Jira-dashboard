import os
import time
import threading
import re
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
ORGANIZATION_FIELD = os.environ.get("ORGANIZATION_FIELD", "customfield_10002")
FIRST_RESPONSE_SLA_FIELD = os.environ.get("FIRST_RESPONSE_SLA_FIELD", "customfield_10131")
ALERT_P1_PRIORITIES = [
    p.strip().lower()
    for p in os.environ.get(
        "ALERT_P1_PRIORITIES",
        "priority 1,p1,highest,critical,kritiek,hoogst,urgent,urgentie 1,level 1",
    ).split(",")
    if p.strip()
]
CORS_ORIGINS_RAW = os.environ.get(
    "BACKEND_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
)
BACKEND_CORS_ORIGINS = [x.strip() for x in CORS_ORIGINS_RAW.split(",") if x.strip()]

_jira = requests.Session()
if JIRA_EMAIL and JIRA_TOKEN:
    _jira.auth = (JIRA_EMAIL, JIRA_TOKEN)
_jira.headers.update({"Accept": "application/json", "Content-Type": "application/json"})

_sync_lock = threading.Lock()
_sync_running = False
_sync_last_error = None
_sync_last_run = None
_sync_last_result = None
_schema_checked = False
_issue_existence_cache = {}
_issue_existence_cache_ttl_seconds = 60

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


def ensure_schema():
    global _schema_checked
    if _schema_checked:
        return
    with conn() as c, c.cursor() as cur:
        # Fresh Docker/Postgres installs may start with an empty database.
        # Bootstrap required tables first, then heal missing columns.
        cur.execute(
            """
            create table if not exists issues (
              issue_key text primary key,
              request_type text,
              onderwerp_logging text,
              organizations text[],
              created_at timestamptz,
              resolved_at timestamptz,
              updated_at timestamptz,
              priority text,
              assignee text,
              current_status text,
              first_response_due_at timestamptz
            );
            """
        )
        cur.execute(
            """
            create table if not exists sync_state (
              id integer primary key,
              last_sync timestamp
            );
            """
        )
        cur.execute("insert into sync_state(id, last_sync) values (1, null) on conflict (id) do nothing;")
        cur.execute("alter table issues add column if not exists request_type text;")
        cur.execute("alter table issues add column if not exists onderwerp_logging text;")
        cur.execute("alter table issues add column if not exists organizations text[];")
        cur.execute("alter table issues add column if not exists created_at timestamptz;")
        cur.execute("alter table issues add column if not exists resolved_at timestamptz;")
        cur.execute("alter table issues add column if not exists updated_at timestamptz;")
        cur.execute("alter table issues add column if not exists priority text;")
        cur.execute("alter table issues add column if not exists assignee text;")
        cur.execute("alter table issues add column if not exists current_status text;")
        cur.execute("alter table issues add column if not exists first_response_due_at timestamptz;")
        c.commit()
    _schema_checked = True


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
            ORGANIZATION_FIELD,
            FIRST_RESPONSE_SLA_FIELD,
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


def norm_organizations(v):
    # JSM Organizations field usually comes as a list of objects with a name.
    if v is None:
        return []
    items = v if isinstance(v, list) else [v]
    out = []
    for item in items:
        name = None
        if isinstance(item, dict):
            name = item.get("name") or item.get("value") or item.get("title")
        elif item is not None:
            name = str(item)
        name = (name or "").strip()
        if name:
            out.append(name)
    # Keep stable ordering and remove duplicates
    return list(dict.fromkeys(out))


def norm_first_response_due_at(v):
    """
    Parse Jira SLA field and return ISO datetime when breach is expected.
    For active SLAs Jira commonly provides ongoingCycle.breachTime.iso8601.
    """
    if not isinstance(v, dict):
        return None
    ongoing = v.get("ongoingCycle") or {}
    breach_time = ongoing.get("breachTime") or {}
    iso = breach_time.get("iso8601")
    if not iso:
        return None
    dt = parse_jira_datetime(iso)
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def is_priority1_priority(value: Optional[str]) -> bool:
    if not value:
        return False
    normalized = re.sub(r"\s+", " ", str(value).strip().lower())
    if normalized in ALERT_P1_PRIORITIES:
        return True
    if re.search(r"(^|[^a-z0-9])p1([^a-z0-9]|$)", normalized):
        return True
    if "priority 1" in normalized or "prioriteit 1" in normalized:
        return True
    if re.search(r"(^|[^a-z0-9])level\\s*1([^a-z0-9]|$)", normalized):
        return True
    return False


def _jira_existing_issue_keys(keys):
    """
    Validate issue existence in Jira for alert candidates.
    Uses a short in-memory cache because frontend polls every ~20s.
    """
    unique_keys = [k for k in dict.fromkeys(keys) if k]
    if not unique_keys:
        return set()
    if not (JIRA_EMAIL and JIRA_TOKEN):
        return set(unique_keys)

    now_ts = time.time()
    existing = set()
    to_query = []

    for key in unique_keys:
        cached = _issue_existence_cache.get(key)
        if cached and now_ts - cached["checked_at"] <= _issue_existence_cache_ttl_seconds:
            if cached["exists"]:
                existing.add(key)
            continue
        to_query.append(key)

    if to_query:
        found = set()
        chunk_size = 100
        for i in range(0, len(to_query), chunk_size):
            chunk = to_query[i : i + chunk_size]
            quoted = ",".join([f'"{k}"' for k in chunk])
            jql = f"key in ({quoted})"
            try:
                data = jira_search(jql, max_results=min(chunk_size, len(chunk)))
                found.update([x.get("key") for x in data.get("issues", []) if x.get("key")])
            except Exception:
                # Keep alerts available if Jira is temporarily unavailable.
                found.update(chunk)
                break

        for key in to_query:
            exists = key in found
            _issue_existence_cache[key] = {"exists": exists, "checked_at": now_ts}
            if exists:
                existing.add(key)

    return existing



def upsert_issues(issues):
    ensure_schema()
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
            organizations = norm_organizations(f.get(ORGANIZATION_FIELD))
            first_response_due_at = norm_first_response_due_at(f.get(FIRST_RESPONSE_SLA_FIELD))

            cur.execute(
                """
                insert into issues(issue_key, request_type, onderwerp_logging, organizations, created_at, resolved_at, updated_at, priority, assignee, current_status, first_response_due_at)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                on conflict (issue_key) do update set
                  request_type=excluded.request_type,
                  onderwerp_logging=excluded.onderwerp_logging,
                  organizations=excluded.organizations,
                  created_at=excluded.created_at,
                  resolved_at=excluded.resolved_at,
                  updated_at=excluded.updated_at,
                  priority=excluded.priority,
                  assignee=excluded.assignee,
                  current_status=excluded.current_status,
                  first_response_due_at=excluded.first_response_due_at
                """,
                (
                    issue_key,
                    request_type,
                    onderwerp,
                    organizations if organizations else None,
                    created_at,
                    resolved_at,
                    updated_at,
                    priority,
                    assignee,
                    status,
                    first_response_due_at,
                ),
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

# Allow CORS for configured frontend origins (comma-separated env var)
app.add_middleware(
    CORSMiddleware,
    allow_origins=BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/meta")
def meta():
    ensure_schema()
    with conn() as c, c.cursor() as cur:
        cur.execute("select distinct request_type from issues where request_type is not null order by 1;")
        request_types = [r[0] for r in cur.fetchall()]
        cur.execute("select distinct onderwerp_logging from issues where onderwerp_logging is not null order by 1;")
        onderwerpen = [r[0] for r in cur.fetchall()]
        cur.execute("select distinct priority from issues where priority is not null order by 1;")
        priorities = [r[0] for r in cur.fetchall()]
        cur.execute("select distinct assignee from issues where assignee is not null order by 1;")
        assignees = [r[0] for r in cur.fetchall()]
        cur.execute(
            """
            select distinct org_name
            from (
              select unnest(organizations) as org_name
              from issues
              where organizations is not null
            ) t
            where org_name is not null and org_name <> ''
            order by 1;
            """
        )
        organizations = [r[0] for r in cur.fetchall()]
    return {
        "request_types": request_types,
        "onderwerpen": onderwerpen,
        "priorities": priorities,
        "assignees": assignees,
        "organizations": organizations,
    }


@app.get("/metrics/volume_weekly")
def volume_weekly(
    date_from: str = Query(..., description="ISO date/time, e.g. 2025-01-01"),
    date_to: str = Query(..., description="ISO date/time, e.g. 2026-01-01"),
    request_type: Optional[str] = None,
    onderwerp: Optional[str] = None,
    priority: Optional[str] = None,
    assignee: Optional[str] = None,
    organization: Optional[str] = None,
    servicedesk_only: bool = False,
):
    ensure_schema()
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
      and (%s is null or (organizations is not null and organizations @> array[%s]::text[]))
      and (
        not %s
        or onderwerp_logging is null
        or onderwerp_logging not in ('Koppelingen', 'datadump', 'Rest-endpoints', 'migratie', 'SSO-koppeling', 'UWV-koppeling')
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
                organization,
                organization,
                servicedesk_only,
            ),
        )
        rows = cur.fetchall()

    # Return as list for easy charting
    return [{"week": r[0].isoformat(), "request_type": r[1], "tickets": r[2]} for r in rows]


@app.get("/metrics/inflow_vs_closed_weekly")
def inflow_vs_closed_weekly(
    date_from: str = Query(..., description="ISO date/time, e.g. 2025-01-01"),
    date_to: str = Query(..., description="ISO date/time, e.g. 2026-01-01"),
    request_type: Optional[str] = None,
    onderwerp: Optional[str] = None,
    priority: Optional[str] = None,
    assignee: Optional[str] = None,
    organization: Optional[str] = None,
    servicedesk_only: bool = False,
):
    ensure_schema()
    q = """
    with incoming as (
      select
        date_trunc('week', created_at) as week,
        count(*) as incoming_count
      from issues
      where created_at >= %s::timestamptz and created_at < (%s::timestamptz + interval '1 day')
        and (%s is null or request_type = %s)
        and (%s is null or onderwerp_logging = %s)
        and (%s is null or priority = %s)
        and (%s is null or assignee = %s)
        and (%s is null or (organizations is not null and organizations @> array[%s]::text[]))
        and (
          not %s
          or onderwerp_logging is null
          or onderwerp_logging not in ('Koppelingen', 'datadump', 'Rest-endpoints', 'migratie', 'SSO-koppeling', 'UWV-koppeling')
        )
      group by 1
    ),
    closed as (
      select
        date_trunc('week', resolved_at) as week,
        count(*) as closed_count
      from issues
      where resolved_at is not null
        and resolved_at >= %s::timestamptz and resolved_at < (%s::timestamptz + interval '1 day')
        and (%s is null or request_type = %s)
        and (%s is null or onderwerp_logging = %s)
        and (%s is null or priority = %s)
        and (%s is null or assignee = %s)
        and (%s is null or (organizations is not null and organizations @> array[%s]::text[]))
        and (
          not %s
          or onderwerp_logging is null
          or onderwerp_logging not in ('Koppelingen', 'datadump', 'Rest-endpoints', 'migratie', 'SSO-koppeling', 'UWV-koppeling')
        )
      group by 1
    )
    select
      coalesce(i.week, c.week) as week,
      coalesce(i.incoming_count, 0) as incoming_count,
      coalesce(c.closed_count, 0) as closed_count
    from incoming i
    full outer join closed c on c.week = i.week
    order by 1;
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
                organization,
                organization,
                servicedesk_only,
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
                organization,
                organization,
                servicedesk_only,
            ),
        )
        rows = cur.fetchall()

    return [
        {"week": r[0].isoformat(), "incoming_count": int(r[1] or 0), "closed_count": int(r[2] or 0)}
        for r in rows
    ]


@app.get("/metrics/leadtime_p90_by_type")
def leadtime_p90_by_type(
    date_from: str = Query(...),
    date_to: str = Query(...),
    onderwerp: Optional[str] = None,
    priority: Optional[str] = None,
    assignee: Optional[str] = None,
    organization: Optional[str] = None,
    servicedesk_only: bool = False,
):
    ensure_schema()
    q = """
    select
      request_type,
      percentile_cont(0.50) within group (
        order by extract(epoch from (resolved_at - created_at))/3600.0
      ) as p50_hours,
      percentile_cont(0.75) within group (
        order by extract(epoch from (resolved_at - created_at))/3600.0
      ) as p75_hours,
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
      and (%s is null or (organizations is not null and organizations @> array[%s]::text[]))
      and (
        not %s
        or onderwerp_logging is null
        or onderwerp_logging not in ('Koppelingen', 'datadump', 'Rest-endpoints', 'migratie', 'SSO-koppeling', 'UWV-koppeling')
      )
    group by 1
    order by p90_hours desc nulls last, 1;
    """
    with conn() as c, c.cursor() as cur:
        cur.execute(
            q,
            (
                date_from,
                date_to,
                onderwerp,
                onderwerp,
                priority,
                priority,
                assignee,
                assignee,
                organization,
                organization,
                servicedesk_only,
            ),
        )
        rows = cur.fetchall()
    return [
        {
            "request_type": r[0],
            "p50_hours": float(r[1]) if r[1] is not None else None,
            "p75_hours": float(r[2]) if r[2] is not None else None,
            "p90_hours": float(r[3]) if r[3] is not None else None,
            "n": r[4],
        }
        for r in rows
    ]


@app.get("/metrics/time_summary")
def time_summary(
    date_from: str = Query(...),
    date_to: str = Query(...),
    request_type: Optional[str] = None,
    onderwerp: Optional[str] = None,
    priority: Optional[str] = None,
    assignee: Optional[str] = None,
    organization: Optional[str] = None,
    servicedesk_only: bool = False,
):
    ensure_schema()
    q = """
    select
      avg(case
        when resolved_at is not null and resolved_at >= created_at
        then extract(epoch from (resolved_at - created_at))/3600.0
      end) as time_to_resolution_hours,
      percentile_cont(0.50) within group (
        order by extract(epoch from (resolved_at - created_at))/3600.0
      ) filter (
        where resolved_at is not null and resolved_at >= created_at
      ) as time_to_resolution_p50_hours,
      avg(case
        when updated_at is not null and updated_at >= created_at
        then extract(epoch from (updated_at - created_at))/3600.0
      end) as time_to_first_response_hours,
      percentile_cont(0.50) within group (
        order by extract(epoch from (updated_at - created_at))/3600.0
      ) filter (
        where updated_at is not null and updated_at >= created_at
      ) as time_to_first_response_p50_hours,
      count(*) filter (
        where resolved_at is not null and resolved_at >= created_at
      ) as resolution_n,
      count(*) filter (
        where updated_at is not null and updated_at >= created_at
      ) as first_response_n
    from issues
    where created_at >= %s::timestamptz and created_at < (%s::timestamptz + interval '1 day')
      and (%s is null or request_type = %s)
      and (%s is null or onderwerp_logging = %s)
      and (%s is null or priority = %s)
      and (%s is null or assignee = %s)
      and (%s is null or (organizations is not null and organizations @> array[%s]::text[]))
      and (
        not %s
        or onderwerp_logging is null
        or onderwerp_logging not in ('Koppelingen', 'datadump', 'Rest-endpoints', 'migratie', 'SSO-koppeling', 'UWV-koppeling')
      );
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
                organization,
                organization,
                servicedesk_only,
            ),
        )
        row = cur.fetchone() or (None, None, None, None, 0, 0)

    return {
        "time_to_resolution_hours": float(row[0]) if row[0] is not None else None,
        "time_to_resolution_p50_hours": float(row[1]) if row[1] is not None else None,
        "time_to_first_response_hours": float(row[2]) if row[2] is not None else None,
        "time_to_first_response_p50_hours": float(row[3]) if row[3] is not None else None,
        "resolution_n": int(row[4] or 0),
        "first_response_n": int(row[5] or 0),
    }


@app.get("/metrics/time_to_resolution_weekly_by_type")
def time_to_resolution_weekly_by_type(
    date_from: str = Query(...),
    date_to: str = Query(...),
    onderwerp: Optional[str] = None,
    priority: Optional[str] = None,
    assignee: Optional[str] = None,
    organization: Optional[str] = None,
    servicedesk_only: bool = False,
):
    ensure_schema()
    q = """
    select
      date_trunc('week', created_at) as week,
      request_type,
      avg(extract(epoch from (resolved_at - created_at))/3600.0) as avg_hours,
      percentile_cont(0.50) within group (
        order by extract(epoch from (resolved_at - created_at))/3600.0
      ) as p50_hours,
      count(*) as n
    from issues
    where resolved_at is not null
      and resolved_at >= created_at
      and created_at >= %s::timestamptz and created_at < (%s::timestamptz + interval '1 day')
      and request_type is not null
      and (%s is null or onderwerp_logging = %s)
      and (%s is null or priority = %s)
      and (%s is null or assignee = %s)
      and (%s is null or (organizations is not null and organizations @> array[%s]::text[]))
      and (
        not %s
        or onderwerp_logging is null
        or onderwerp_logging not in ('Koppelingen', 'datadump', 'Rest-endpoints', 'migratie', 'SSO-koppeling', 'UWV-koppeling')
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
                onderwerp,
                onderwerp,
                priority,
                priority,
                assignee,
                assignee,
                organization,
                organization,
                servicedesk_only,
            ),
        )
        rows = cur.fetchall()

    return [
        {
            "week": r[0].isoformat(),
            "request_type": r[1],
            "avg_hours": float(r[2]) if r[2] is not None else None,
            "p50_hours": float(r[3]) if r[3] is not None else None,
            "median_hours": float(r[3]) if r[3] is not None else None,
            "n": int(r[4] or 0),
        }
        for r in rows
    ]


@app.get("/metrics/time_to_first_response_weekly")
def time_to_first_response_weekly(
    date_from: str = Query(...),
    date_to: str = Query(...),
    onderwerp: Optional[str] = None,
    priority: Optional[str] = None,
    assignee: Optional[str] = None,
    organization: Optional[str] = None,
    servicedesk_only: bool = False,
):
    ensure_schema()
    q = """
    select
      date_trunc('week', created_at) as week,
      avg(extract(epoch from (updated_at - created_at))/3600.0) as avg_hours,
      percentile_cont(0.50) within group (
        order by extract(epoch from (updated_at - created_at))/3600.0
      ) as p50_hours,
      count(*) as n
    from issues
    where updated_at is not null
      and updated_at >= created_at
      and created_at >= %s::timestamptz and created_at < (%s::timestamptz + interval '1 day')
      and (%s is null or onderwerp_logging = %s)
      and (%s is null or priority = %s)
      and (%s is null or assignee = %s)
      and (%s is null or (organizations is not null and organizations @> array[%s]::text[]))
      and (
        not %s
        or onderwerp_logging is null
        or onderwerp_logging not in ('Koppelingen', 'datadump', 'Rest-endpoints', 'migratie', 'SSO-koppeling', 'UWV-koppeling')
      )
    group by 1
    order by 1;
    """
    with conn() as c, c.cursor() as cur:
        cur.execute(
            q,
            (
                date_from,
                date_to,
                onderwerp,
                onderwerp,
                priority,
                priority,
                assignee,
                assignee,
                organization,
                organization,
                servicedesk_only,
            ),
        )
        rows = cur.fetchall()

    return [
        {
            "week": r[0].isoformat(),
            "avg_hours": float(r[1]) if r[1] is not None else None,
            "p50_hours": float(r[2]) if r[2] is not None else None,
            "median_hours": float(r[2]) if r[2] is not None else None,
            "n": int(r[3] or 0),
        }
        for r in rows
    ]


@app.get("/metrics/volume_by_priority")
def volume_by_priority(
    date_from: str = Query(...),
    date_to: str = Query(...),
    request_type: Optional[str] = None,
    onderwerp: Optional[str] = None,
    priority: Optional[str] = None,
    assignee: Optional[str] = None,
    organization: Optional[str] = None,
    servicedesk_only: bool = False,
):
    ensure_schema()
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
      and (%s is null or (organizations is not null and organizations @> array[%s]::text[]))
      and (
        not %s
        or onderwerp_logging is null
        or onderwerp_logging not in ('Koppelingen', 'Datadump', 'Rest-endpoints', 'Migratie', 'SSO-koppeling', 'UWV-koppeling')
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
                organization,
                organization,
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
    organization: Optional[str] = None,
    servicedesk_only: bool = False,
):
    ensure_schema()
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
      and (%s is null or (organizations is not null and organizations @> array[%s]::text[]))
      and (
        not %s
        or onderwerp_logging is null
        or onderwerp_logging not in ('Koppelingen', 'datadump', 'Rest-endpoints', 'migratie', 'SSO-koppeling', 'UWV-koppeling')
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
                organization,
                organization,
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
    organization: Optional[str] = None,
    servicedesk_only: bool = False,
):
    ensure_schema()
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
      and (%s is null or (organizations is not null and organizations @> array[%s]::text[]))
      and (
        not %s
        or onderwerp_logging is null
        or onderwerp_logging not in ('Koppelingen', 'datadump', 'Rest-endpoints', 'migratie', 'SSO-koppeling', 'UWV-koppeling')
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
                organization,
                organization,
                servicedesk_only,
            ),
        )
        rows = cur.fetchall()
    return [{"week": r[0].isoformat(), "onderwerp": r[1], "tickets": r[2]} for r in rows]


@app.get("/metrics/volume_weekly_by_organization")
def volume_weekly_by_organization(
    date_from: str = Query(..., description="ISO date/time, e.g. 2025-01-01"),
    date_to: str = Query(..., description="ISO date/time, e.g. 2026-01-01"),
    request_type: Optional[str] = None,
    onderwerp: Optional[str] = None,
    priority: Optional[str] = None,
    assignee: Optional[str] = None,
    organization: Optional[str] = None,
    servicedesk_only: bool = False,
):
    ensure_schema()
    q = """
    select
      date_trunc('week', i.created_at) as week,
      org.org_name as organization,
      count(*) as tickets
    from issues i
    cross join lateral unnest(i.organizations) as org(org_name)
    where i.created_at >= %s::timestamptz and i.created_at < (%s::timestamptz + interval '1 day')
      and (%s is null or i.request_type = %s)
      and (%s is null or i.onderwerp_logging = %s)
      and (%s is null or i.priority = %s)
      and (%s is null or i.assignee = %s)
      and (%s is null or org.org_name = %s)
      and (
        not %s
        or i.onderwerp_logging is null
        or i.onderwerp_logging not in ('Koppelingen', 'datadump', 'Rest-endpoints', 'migratie', 'SSO-koppeling', 'UWV-koppeling')
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
                organization,
                organization,
                servicedesk_only,
            ),
        )
        rows = cur.fetchall()
    return [{"week": r[0].isoformat(), "organization": r[1], "tickets": r[2]} for r in rows]


@app.get("/issues")
def issues(
    date_from: str,
    date_to: str,
    request_type: Optional[str] = None,
    onderwerp: Optional[str] = None,
    priority: Optional[str] = None,
    assignee: Optional[str] = None,
    organization: Optional[str] = None,
    servicedesk_only: bool = False,
    limit: int = 100,
    offset: int = 0,
):
    ensure_schema()
    q = """
    select issue_key, request_type, onderwerp_logging, created_at, resolved_at, priority, assignee, current_status
    from issues
    where created_at >= %s::timestamptz and created_at < (%s::timestamptz + interval '1 day')
      and (%s is null or request_type = %s)
      and (%s is null or onderwerp_logging = %s)
      and (%s is null or priority = %s)
      and (%s is null or assignee = %s)
      and (%s is null or (organizations is not null and organizations @> array[%s]::text[]))
      and (
        not %s
        or onderwerp_logging is null
        or onderwerp_logging not in ('Koppelingen', 'datadump', 'Rest-endpoints', 'migratie', 'SSO-koppeling', 'UWV-koppeling')
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
                organization,
                organization,
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


@app.get("/alerts/live")
def alerts_live(servicedesk_only: bool = True):
    """
    Live alert feed for dashboard badges/cards.
    - priority1: open P1 tickets
    - first_response_due_soon: status 'Nieuwe melding' and SLA breach within 5 minutes
    - first_response_overdue: status 'Nieuwe melding' and SLA already breached
    """
    ensure_schema()
    with conn() as c, c.cursor() as cur:
        cur.execute(
            """
            select issue_key, created_at, priority, current_status
            from issues
            where created_at >= now() - interval '24 hours'
              and (
                not %s
                or onderwerp_logging is null
                or onderwerp_logging not in ('Koppelingen', 'datadump', 'Rest-endpoints', 'migratie', 'SSO-koppeling', 'UWV-koppeling')
              )
            order by created_at desc
            limit 500;
            """,
            (servicedesk_only,),
        )
        p1_rows = [r for r in cur.fetchall() if is_priority1_priority(r[2])][:25]

        cur.execute(
            """
            select
              issue_key,
              first_response_due_at,
              greatest(0, ceil(extract(epoch from (first_response_due_at - now())) / 60.0))::int as minutes_left
            from issues
            where resolved_at is null
              and lower(coalesce(current_status, '')) = 'nieuwe melding'
              and first_response_due_at is not null
              and first_response_due_at >= now()
              and first_response_due_at <= now() + interval '5 minutes'
              and (
                not %s
                or onderwerp_logging is null
                or onderwerp_logging not in ('Koppelingen', 'datadump', 'Rest-endpoints', 'migratie', 'SSO-koppeling', 'UWV-koppeling')
              )
            order by first_response_due_at asc
            limit 25;
            """,
            (servicedesk_only,),
        )
        sla_rows = cur.fetchall()

        cur.execute(
            """
            select
              issue_key,
              first_response_due_at,
              ceil(extract(epoch from (now() - first_response_due_at)) / 60.0)::int as minutes_overdue
            from issues
            where lower(coalesce(current_status, '')) = 'nieuwe melding'
              and first_response_due_at is not null
              and first_response_due_at < now()
              and (
                not %s
                or onderwerp_logging is null
                or onderwerp_logging not in ('Koppelingen', 'datadump', 'Rest-endpoints', 'migratie', 'SSO-koppeling', 'UWV-koppeling')
              )
            order by first_response_due_at asc
            limit 25;
            """,
            (servicedesk_only,),
        )
        overdue_rows = cur.fetchall()

    all_keys = [r[0] for r in p1_rows] + [r[0] for r in sla_rows] + [r[0] for r in overdue_rows]
    existing_keys = _jira_existing_issue_keys(all_keys)

    return {
        "priority1": [
            {
                "issue_key": r[0],
                "created_at": r[1].isoformat() if r[1] else None,
                "priority": r[2],
                "status": r[3],
            }
            for r in p1_rows
            if r[0] in existing_keys
        ],
        "first_response_due_soon": [
            {
                "issue_key": r[0],
                "due_at": r[1].isoformat() if r[1] else None,
                "minutes_left": int(r[2] or 0),
            }
            for r in sla_rows
            if r[0] in existing_keys
        ],
        "first_response_overdue": [
            {
                "issue_key": r[0],
                "due_at": r[1].isoformat() if r[1] else None,
                "minutes_overdue": int(r[2] or 0),
            }
            for r in overdue_rows
            if r[0] in existing_keys
        ],
    }


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
