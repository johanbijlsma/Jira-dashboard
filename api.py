import os
import time
import threading
import re
import math
import json
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import requests
import psycopg2
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from pydantic import BaseModel

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
ALERT_P1_ACTIVE_STATUSES = [
    s.strip().lower()
    for s in os.environ.get(
        "ALERT_P1_ACTIVE_STATUSES",
        "nieuwe melding",
    ).split(",")
    if s.strip()
]
ALERT_TEAMS_WEBHOOK_URL = (os.environ.get("ALERT_TEAMS_WEBHOOK_URL") or "").strip()
ALERT_TEAMS_TIMEOUT_SECONDS = float(os.environ.get("ALERT_TEAMS_TIMEOUT_SECONDS", "3"))
CORS_ORIGINS_RAW = os.environ.get(
    "BACKEND_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
)
BACKEND_CORS_ORIGINS = [x.strip() for x in CORS_ORIGINS_RAW.split(",") if x.strip()]


def _env_flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "y", "on"}


APP_ENV = (os.environ.get("APP_ENV") or os.environ.get("ENV") or "").strip().lower()
INSIGHTS_ENABLED = _env_flag("INSIGHTS_ENABLED", APP_ENV not in {"prod", "production"})
INSIGHTS_METRIC_CONFIG: Dict[str, Dict[str, float]] = {
    "backlog_gap": {
        "min_abs_delta": 3.0,
        "min_rel_delta": 0.60,
        "trend_delta_min": 2.0,
        "trend_rel_delta_min": 0.25,
        "min_sample_size": 12.0,
    },
    "time_to_resolution": {
        "min_abs_delta": 1.0,
        "min_rel_delta": 0.25,
        "trend_delta_min": 0.5,
        "trend_rel_delta_min": 0.25,
        "min_sample_size": 8.0,
    },
    "time_to_first_response": {
        "min_abs_delta": 0.5,
        "min_rel_delta": 0.30,
        "trend_delta_min": 0.25,
        "trend_rel_delta_min": 0.25,
        "min_sample_size": 10.0,
    },
    "default": {
        "min_abs_delta": 1.0,
        "min_rel_delta": 0.30,
        "trend_delta_min": 1.0,
        "trend_rel_delta_min": 0.25,
        "min_sample_size": 8.0,
    },
}
INSIGHTS_METRIC_DEFAULT_CONFIG: Dict[str, Dict[str, float]] = json.loads(json.dumps(INSIGHTS_METRIC_CONFIG))

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
_last_alert_log_cleanup_at = 0.0
_insights_config_lock = threading.Lock()
_insights_config_loaded = False
DEV_ALERT_ISSUE_KEY = "DEV-ALERT-TEST"
DEFAULT_SERVICEDESK_TEAM_MEMBERS = ["Johan", "Ashley", "Jarno"]
DEFAULT_NON_SERVICEDESK_ONDERWERPEN = {
    "Koppelingen",
    "datadump",
    "Rest-endpoints",
    "migratie",
    "SSO-koppeling",
    "UWV-koppeling",
    "Datadump",
    "Migratie",
}

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
              assignee_avatar_url text,
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
        cur.execute(
            """
            create table if not exists sync_runs (
              id bigserial primary key,
              started_at timestamptz not null default now(),
              finished_at timestamptz,
              mode text not null default 'incremental',
              success boolean not null default false,
              upserts integer not null default 0,
              set_last_sync timestamptz,
              error text
            );
            """
        )
        cur.execute(
            """
            create table if not exists dashboard_config (
              id integer primary key,
              servicedesk_team_members text[] not null default '{}',
              servicedesk_onderwerpen text[] not null default '{}',
              updated_at timestamptz not null default now()
            );
            """
        )
        cur.execute(
            """
            create table if not exists insights_config (
              id integer primary key,
              metric_config jsonb not null default '{}'::jsonb,
              updated_at timestamptz not null default now()
            );
            """
        )
        cur.execute(
            """
            create table if not exists vacations (
              id bigserial primary key,
              member_name text not null,
              start_date date not null,
              end_date date not null,
              created_at timestamptz not null default now(),
              updated_at timestamptz not null default now(),
              constraint vacations_date_range_chk check (end_date >= start_date)
            );
            """
        )
        cur.execute(
            """
            create table if not exists alert_logs (
              id bigserial primary key,
              issue_key text not null,
              alert_kind text not null,
              status text,
              meta text,
              status_key text not null default '',
              meta_key text not null default '',
              servicedesk_only boolean not null default true,
              detected_at timestamptz not null default now(),
              logged_on date not null default current_date
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
        cur.execute("alter table issues add column if not exists assignee_avatar_url text;")
        cur.execute("alter table issues add column if not exists current_status text;")
        cur.execute("alter table issues add column if not exists first_response_due_at timestamptz;")
        cur.execute("alter table sync_runs add column if not exists started_at timestamptz not null default now();")
        cur.execute("alter table sync_runs add column if not exists finished_at timestamptz;")
        cur.execute("alter table sync_runs add column if not exists mode text not null default 'incremental';")
        cur.execute("alter table sync_runs add column if not exists success boolean not null default false;")
        cur.execute("alter table sync_runs add column if not exists upserts integer not null default 0;")
        cur.execute("alter table sync_runs add column if not exists set_last_sync timestamptz;")
        cur.execute("alter table sync_runs add column if not exists error text;")
        cur.execute("create index if not exists sync_runs_started_at_idx on sync_runs(started_at desc);")
        cur.execute("create index if not exists sync_runs_success_started_idx on sync_runs(success, started_at desc);")
        cur.execute("create index if not exists sync_runs_mode_success_started_idx on sync_runs(mode, success, started_at desc);")
        cur.execute("alter table vacations add column if not exists member_name text;")
        cur.execute("alter table vacations add column if not exists start_date date;")
        cur.execute("alter table vacations add column if not exists end_date date;")
        cur.execute("alter table vacations add column if not exists created_at timestamptz not null default now();")
        cur.execute("alter table vacations add column if not exists updated_at timestamptz not null default now();")
        cur.execute("create index if not exists vacations_start_date_idx on vacations(start_date);")
        cur.execute("create index if not exists vacations_end_date_idx on vacations(end_date);")
        cur.execute("alter table dashboard_config add column if not exists servicedesk_team_members text[] not null default '{}';")
        cur.execute("alter table dashboard_config add column if not exists servicedesk_onderwerpen text[] not null default '{}';")
        cur.execute("alter table dashboard_config add column if not exists updated_at timestamptz not null default now();")
        cur.execute("alter table insights_config add column if not exists metric_config jsonb not null default '{}'::jsonb;")
        cur.execute("alter table insights_config add column if not exists updated_at timestamptz not null default now();")
        cur.execute("alter table alert_logs add column if not exists issue_key text;")
        cur.execute("alter table alert_logs add column if not exists alert_kind text;")
        cur.execute("alter table alert_logs add column if not exists status text;")
        cur.execute("alter table alert_logs add column if not exists meta text;")
        cur.execute("alter table alert_logs add column if not exists status_key text not null default '';")
        cur.execute("alter table alert_logs add column if not exists meta_key text not null default '';")
        cur.execute("alter table alert_logs add column if not exists servicedesk_only boolean not null default true;")
        cur.execute("alter table alert_logs add column if not exists detected_at timestamptz not null default now();")
        cur.execute("alter table alert_logs add column if not exists logged_on date not null default current_date;")
        cur.execute("update alert_logs set status_key = coalesce(status, ''), meta_key = coalesce(meta, '') where status_key = '' and meta_key = '';")
        cur.execute("create index if not exists alert_logs_detected_at_idx on alert_logs(detected_at desc);")
        cur.execute("drop index if exists alert_logs_daily_dedupe_idx;")
        cur.execute(
            """
            create unique index alert_logs_daily_dedupe_idx
            on alert_logs(
              issue_key,
              alert_kind,
              status_key,
              meta_key,
              servicedesk_only,
              logged_on
            );
            """
        )
        cur.execute("insert into dashboard_config(id) values (1) on conflict (id) do nothing;")
        cur.execute(
            """
            insert into insights_config(id, metric_config)
            values (1, %s::jsonb)
            on conflict (id) do nothing;
            """,
            (json.dumps(_default_insights_metric_config()),),
        )
        cur.execute(
            """
            update dashboard_config
            set servicedesk_team_members = coalesce(
                  (
                    select array_agg(x)
                    from (
                      select distinct assignee as x
                      from issues
                      where assignee is not null
                        and assignee <> ''
                        and lower(assignee) = any(%s::text[])
                      order by 1
                    ) t
                  ),
                  (
                    select array_agg(x)
                    from (
                      select assignee as x
                      from issues
                      where assignee is not null
                        and assignee <> ''
                      group by assignee
                      order by count(*) desc, assignee asc
                      limit 5
                    ) t2
                  ),
                  array[]::text[]
                ),
                servicedesk_onderwerpen = (
                  select coalesce(array_agg(x), array[]::text[])
                  from (
                    select distinct onderwerp_logging as x
                    from issues
                    where onderwerp_logging is not null
                      and onderwerp_logging <> ''
                      and onderwerp_logging <> all(%s::text[])
                    order by 1
                  ) t
                ),
                updated_at = now()
            where id = 1
              and coalesce(array_length(servicedesk_team_members, 1), 0) = 0
              and coalesce(array_length(servicedesk_onderwerpen, 1), 0) = 0;
            """,
            (
                [name.lower() for name in DEFAULT_SERVICEDESK_TEAM_MEMBERS],
                list(DEFAULT_NON_SERVICEDESK_ONDERWERPEN),
            ),
        )
        c.commit()
    _schema_checked = True


class VacationPayload(BaseModel):
    member_name: str
    start_date: str
    end_date: str


class ServicedeskConfigPayload(BaseModel):
    team_members: list[str]
    onderwerpen: list[str]


class InsightsConfigPayload(BaseModel):
    metric_config: Dict[str, Dict[str, float]]


def _normalize_text_list(values):
    if not isinstance(values, list):
        return []
    out = []
    for v in values:
        text = str(v or "").strip()
        if text:
            out.append(text)
    return list(dict.fromkeys(out))


def get_servicedesk_config():
    ensure_schema()
    with conn() as c, c.cursor() as cur:
        cur.execute(
            """
            select servicedesk_team_members, servicedesk_onderwerpen, updated_at
            from dashboard_config
            where id = 1;
            """
        )
        row = cur.fetchone()
        cur.execute(
            """
            select assignee, assignee_avatar_url
            from (
              select
                assignee,
                assignee_avatar_url,
                row_number() over (
                  partition by assignee
                  order by updated_at desc nulls last, created_at desc nulls last
                ) as rn
              from issues
              where assignee is not null
                and assignee <> ''
                and assignee_avatar_url is not null
                and assignee_avatar_url <> ''
            ) t
            where rn = 1;
            """
        )
        avatar_rows = cur.fetchall()
    if not row:
        return {"team_members": [], "onderwerpen": [], "updated_at": None, "team_member_avatars": {}}
    team_members = list(row[0] or [])
    avatar_map = {str(name): str(url) for name, url in avatar_rows if name and url}
    return {
        "team_members": team_members,
        "onderwerpen": list(row[1] or []),
        "updated_at": row[2].isoformat() if row[2] else None,
        "team_member_avatars": {name: avatar_map.get(name) for name in team_members if avatar_map.get(name)},
    }


def _sanitize_metric_config(raw_config: Dict[str, Any]) -> Dict[str, Dict[str, float]]:
    allowed_metrics = ("backlog_gap", "time_to_resolution", "time_to_first_response")
    allowed_fields = (
        "min_abs_delta",
        "min_rel_delta",
        "trend_delta_min",
        "trend_rel_delta_min",
        "min_sample_size",
    )
    sanitized: Dict[str, Dict[str, float]] = {}
    for metric in allowed_metrics:
        incoming = raw_config.get(metric) if isinstance(raw_config, dict) else None
        defaults = INSIGHTS_METRIC_DEFAULT_CONFIG.get(metric) or INSIGHTS_METRIC_DEFAULT_CONFIG["default"]
        metric_cfg: Dict[str, float] = {}
        for field in allowed_fields:
            candidate = defaults[field]
            if isinstance(incoming, dict) and field in incoming:
                candidate = incoming[field]
            try:
                value = float(candidate)
            except Exception as exc:
                raise ValueError(f"Ongeldige waarde voor {metric}.{field}.") from exc
            if value < 0:
                raise ValueError(f"Waarde voor {metric}.{field} mag niet negatief zijn.")
            if field.endswith("rel_delta_min") and value > 5:
                raise ValueError(f"Waarde voor {metric}.{field} is onrealistisch hoog.")
            metric_cfg[field] = value
        sanitized[metric] = metric_cfg
    sanitized["default"] = dict(INSIGHTS_METRIC_DEFAULT_CONFIG["default"])
    return sanitized


def _default_insights_metric_config() -> Dict[str, Dict[str, float]]:
    return json.loads(json.dumps(INSIGHTS_METRIC_DEFAULT_CONFIG))


def _load_insights_config_if_needed():
    global _insights_config_loaded, INSIGHTS_METRIC_CONFIG
    if _insights_config_loaded:
        return
    with _insights_config_lock:
        if _insights_config_loaded:
            return
        ensure_schema()
        with conn() as c, c.cursor() as cur:
            cur.execute("select metric_config from insights_config where id = 1;")
            row = cur.fetchone()
        if row and isinstance(row[0], dict):
            try:
                INSIGHTS_METRIC_CONFIG = _sanitize_metric_config(row[0])
            except Exception:
                pass
        _insights_config_loaded = True


def get_insights_config():
    _load_insights_config_if_needed()
    ensure_schema()
    with conn() as c, c.cursor() as cur:
        cur.execute("select metric_config, updated_at from insights_config where id = 1;")
        row = cur.fetchone()
    if not row:
        return {"metric_config": _default_insights_metric_config(), "updated_at": None}
    stored = row[0] if isinstance(row[0], dict) else {}
    try:
        metric_config = _sanitize_metric_config(stored)
    except Exception:
        metric_config = _default_insights_metric_config()
    return {"metric_config": metric_config, "updated_at": row[1].isoformat() if row[1] else None}


def servicedesk_filter_clause(alias: str = ""):
    prefix = f"{alias}." if alias else ""
    return f"""
      and (
        not %s
        or (
          {prefix}assignee is not null
          and {prefix}assignee = any(coalesce((select servicedesk_team_members from dashboard_config where id=1), array[]::text[]))
          and {prefix}onderwerp_logging is not null
          and {prefix}onderwerp_logging = any(coalesce((select servicedesk_onderwerpen from dashboard_config where id=1), array[]::text[]))
        )
      )
    """


def _parse_iso_date_or_raise(value: str, field_name: str):
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except Exception as exc:
        raise ValueError(f"Ongeldige datum voor {field_name}. Gebruik YYYY-MM-DD.") from exc


def _validate_vacation_payload(payload: VacationPayload):
    member_name = (payload.member_name or "").strip()
    team_members = get_servicedesk_config().get("team_members") or []
    if member_name not in team_members:
        allowed = ", ".join(team_members) if team_members else "(geen teamleden geconfigureerd)"
        raise ValueError(f"Onbekend teamlid. Kies uit: {allowed}.")
    start_date = _parse_iso_date_or_raise(payload.start_date, "start_date")
    end_date = _parse_iso_date_or_raise(payload.end_date, "end_date")
    if start_date < datetime.now(timezone.utc).date():
        raise ValueError("Startdatum moet vandaag of later zijn.")
    if end_date < start_date:
        raise ValueError("Einddatum mag niet voor de startdatum liggen.")
    return member_name, start_date, end_date


def _vacation_row_to_dict(row):
    return {
        "id": int(row[0]),
        "member_name": row[1],
        "start_date": row[2].isoformat(),
        "end_date": row[3].isoformat(),
        "created_at": row[4].isoformat() if row[4] else None,
        "updated_at": row[5].isoformat() if row[5] else None,
    }


def _to_utc_z(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


def get_last_sync():
    with conn() as c, c.cursor() as cur:
        cur.execute("select last_sync from sync_state where id=1")
        row = cur.fetchone()
        return row[0] if row else None



def set_last_sync(ts: datetime):
    with conn() as c, c.cursor() as cur:
        cur.execute("update sync_state set last_sync=%s where id=1", (ts,))
        c.commit()



def create_sync_run(mode: str) -> int:
    with conn() as c, c.cursor() as cur:
        cur.execute(
            """
            insert into sync_runs(started_at, mode, success, upserts)
            values (now(), %s, false, 0)
            returning id;
            """,
            (mode,),
        )
        row = cur.fetchone()
        c.commit()
        return int(row[0])


def complete_sync_run_success(run_id: int, upserts: int, set_last_sync_at: Optional[datetime]):
    with conn() as c, c.cursor() as cur:
        cur.execute(
            """
            update sync_runs
            set finished_at = now(),
                success = true,
                upserts = %s,
                set_last_sync = %s,
                error = null
            where id = %s;
            """,
            (int(upserts or 0), set_last_sync_at, run_id),
        )
        c.commit()


def complete_sync_run_error(run_id: int, error_text: str):
    with conn() as c, c.cursor() as cur:
        cur.execute(
            """
            update sync_runs
            set finished_at = now(),
                success = false,
                error = %s
            where id = %s;
            """,
            (error_text, run_id),
        )
        c.commit()


def get_sync_status_payload():
    ensure_schema()
    last = get_last_sync()

    with conn() as c, c.cursor() as cur:
        cur.execute(
            """
            select started_at, finished_at, mode, upserts, set_last_sync
            from sync_runs
            where success = true
            order by started_at desc
            limit 10;
            """
        )
        successful_rows = cur.fetchall()
        successful_runs = [
            {
                "started_at": _to_utc_z(r[0]),
                "finished_at": _to_utc_z(r[1]),
                "mode": r[2],
                "upserts": int(r[3] or 0),
                "set_last_sync": _to_utc_z(r[4]),
            }
            for r in successful_rows
        ]

        cur.execute(
            """
            select started_at, finished_at, mode, error
            from sync_runs
            where success = false
              and error is not null
            order by started_at desc
            limit 1;
            """
        )
        failed_row = cur.fetchone()
        last_failed_run = None
        if failed_row:
            last_failed_run = {
                "started_at": _to_utc_z(failed_row[0]),
                "finished_at": _to_utc_z(failed_row[1]),
                "mode": failed_row[2],
                "message": failed_row[3],
            }

        cur.execute(
            """
            select started_at, finished_at, upserts, set_last_sync
            from sync_runs
            where success = true
              and mode = 'full'
            order by started_at desc
            limit 1;
            """
        )
        full_row = cur.fetchone()
        last_full_sync = None
        if full_row:
            last_full_sync = {
                "started_at": _to_utc_z(full_row[0]),
                "finished_at": _to_utc_z(full_row[1]),
                "upserts": int(full_row[2] or 0),
                "set_last_sync": _to_utc_z(full_row[3]),
            }

    return {
        "running": _sync_running,
        "last_run": _sync_last_run,
        "last_error": _sync_last_error,
        "last_result": _sync_last_result,
        "last_sync": _to_utc_z(last),
        "successful_runs": successful_runs,
        "last_failed_run": last_failed_run,
        "last_full_sync": last_full_sync,
    }


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


def norm_assignee_avatar_url(v):
    if not isinstance(v, dict):
        return None
    avatar_urls = v.get("avatarUrls") or {}
    if not isinstance(avatar_urls, dict):
        return None
    return (
        avatar_urls.get("48x48")
        or avatar_urls.get("32x32")
        or avatar_urls.get("24x24")
        or avatar_urls.get("16x16")
    )


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


def is_priority1_alert_status(value: Optional[str]) -> bool:
    """Only alert for fresh/new P1 intake states."""
    status = str(value or "").strip().lower()
    if not status:
        return False
    return status in ALERT_P1_ACTIVE_STATUSES


def _maybe_cleanup_alert_logs(cur):
    global _last_alert_log_cleanup_at
    now_ts = time.time()
    if now_ts - _last_alert_log_cleanup_at < 3600:
        return
    cur.execute("delete from alert_logs where detected_at < now() - interval '30 days';")
    _last_alert_log_cleanup_at = now_ts


def _persist_alert_log_events(cur, events):
    inserted_events = []
    if not events:
        return inserted_events
    for event in events:
        cur.execute(
            """
            insert into alert_logs(issue_key, alert_kind, status, meta, status_key, meta_key, servicedesk_only, detected_at, logged_on)
            values (%s, %s, %s, %s, %s, %s, %s, now(), current_date)
            on conflict (issue_key, alert_kind, status_key, meta_key, servicedesk_only, logged_on)
            do nothing
            returning id;
            """,
            (
                event["issue_key"],
                event["alert_kind"],
                event.get("status"),
                event.get("meta"),
                str(event.get("status") or ""),
                str(event.get("meta") or ""),
                bool(event.get("servicedesk_only", True)),
            ),
        )
        inserted = cur.fetchone()
        if inserted:
            inserted_events.append(event)
    return inserted_events


def _send_teams_alert_notification(events):
    result = {"attempted": False, "ok": False, "status_code": None, "error": None}
    if not ALERT_TEAMS_WEBHOOK_URL or not events:
        return result
    try:
        result["attempted"] = True
        top = events[:8]
        lines = []
        for e in top:
            kind = e.get("alert_kind") or "ALERT"
            issue_key = e.get("issue_key") or "?"
            status = e.get("status")
            meta = e.get("meta")
            parts = [f"**{kind}**", issue_key]
            if status:
                parts.append(f"status: {status}")
            if meta:
                parts.append(str(meta))
            lines.append(" - ".join(parts))
        if len(events) > len(top):
            lines.append(f"... +{len(events) - len(top)} extra")
        payload = {
            "text": "Nieuwe dashboard alerts:\n" + "\n".join(lines),
        }
        response = requests.post(ALERT_TEAMS_WEBHOOK_URL, json=payload, timeout=ALERT_TEAMS_TIMEOUT_SECONDS)
        status_code = getattr(response, "status_code", None)
        result["status_code"] = status_code
        result["ok"] = bool(status_code and 200 <= int(status_code) < 300)
        if not result["ok"]:
            body = getattr(response, "text", "")
            result["error"] = f"HTTP {status_code}: {str(body)[:240]}"
    except Exception as exc:
        # Alerts endpoint should stay responsive even when webhook delivery fails.
        result["attempted"] = True
        result["error"] = str(exc)
    return result


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
        if str(key).startswith("DEV-"):
            existing.add(key)
            continue
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
            assignee_avatar_url = norm_assignee_avatar_url(f.get("assignee"))
            organizations = norm_organizations(f.get(ORGANIZATION_FIELD))
            first_response_due_at = norm_first_response_due_at(f.get(FIRST_RESPONSE_SLA_FIELD))

            cur.execute(
                """
                insert into issues(issue_key, request_type, onderwerp_logging, organizations, created_at, resolved_at, updated_at, priority, assignee, assignee_avatar_url, current_status, first_response_due_at)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                on conflict (issue_key) do update set
                  request_type=excluded.request_type,
                  onderwerp_logging=excluded.onderwerp_logging,
                  organizations=excluded.organizations,
                  created_at=excluded.created_at,
                  resolved_at=excluded.resolved_at,
                  updated_at=excluded.updated_at,
                  priority=excluded.priority,
                  assignee=excluded.assignee,
                  assignee_avatar_url=excluded.assignee_avatar_url,
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
                    assignee_avatar_url,
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
    ensure_schema()

    with _sync_lock:
        if _sync_running:
            return {"started": False, "reason": "already running"}
        _sync_running = True
        _sync_last_error = None
        _sync_last_run = datetime.utcnow().isoformat() + "Z"
        _sync_last_result = None

    try:
        run_id = create_sync_run("full" if full else "incremental")
        last = None if full else get_last_sync()
        now_utc = datetime.now(timezone.utc)

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
            set_ts_dt = max_updated.astimezone(timezone.utc)
            set_last_sync(set_ts_dt.replace(tzinfo=None))
            set_ts = set_ts_dt.isoformat().replace("+00:00", "Z")
        elif last is None:
            set_ts_dt = now_utc
            set_last_sync(set_ts_dt.replace(tzinfo=None))
            set_ts = set_ts_dt.isoformat().replace("+00:00", "Z")
        else:
            # Geen resultaten: houd last_sync gelijk om geen updates te missen
            set_ts_dt = last if last.tzinfo else last.replace(tzinfo=timezone.utc)
            set_ts = set_ts_dt.isoformat().replace("+00:00", "Z")

        _sync_last_result = {"upserts": total, "set_last_sync": set_ts}
        try:
            complete_sync_run_success(run_id, total, set_ts_dt)
        except Exception:
            pass
        return {"started": True, "upserts": total}

    except Exception as e:
        _sync_last_error = str(e)
        try:
            if "run_id" in locals():
                complete_sync_run_error(run_id, str(e))
        except Exception:
            pass
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


@app.get("/config/servicedesk")
def servicedesk_config():
    return get_servicedesk_config()


@app.put("/config/servicedesk")
def update_servicedesk_config(payload: ServicedeskConfigPayload):
    ensure_schema()
    team_members = _normalize_text_list(payload.team_members)
    onderwerpen = _normalize_text_list(payload.onderwerpen)
    if not team_members:
        raise HTTPException(status_code=400, detail="Selecteer minimaal 1 servicedesk teamlid.")
    if not onderwerpen:
        raise HTTPException(status_code=400, detail="Selecteer minimaal 1 servicedesk onderwerp.")
    with conn() as c, c.cursor() as cur:
        cur.execute(
            """
            update dashboard_config
            set servicedesk_team_members = %s,
                servicedesk_onderwerpen = %s,
                updated_at = now()
            where id = 1;
            """,
            (team_members, onderwerpen),
        )
        c.commit()
    return get_servicedesk_config()


@app.get("/config/insights")
def insights_config():
    _ensure_insights_enabled()
    return get_insights_config()


@app.put("/config/insights")
def update_insights_config(payload: InsightsConfigPayload):
    _ensure_insights_enabled()
    global INSIGHTS_METRIC_CONFIG, _insights_config_loaded
    try:
        sanitized = _sanitize_metric_config(payload.metric_config)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    ensure_schema()
    with conn() as c, c.cursor() as cur:
        cur.execute(
            """
            insert into insights_config(id, metric_config, updated_at)
            values (1, %s::jsonb, now())
            on conflict (id)
            do update set metric_config = excluded.metric_config, updated_at = now();
            """,
            (json.dumps(sanitized),),
        )
        c.commit()
    with _insights_config_lock:
        INSIGHTS_METRIC_CONFIG = sanitized
        _insights_config_loaded = True
    return get_insights_config()


@app.post("/config/insights/reset")
def reset_insights_config_to_defaults():
    _ensure_insights_enabled()
    global INSIGHTS_METRIC_CONFIG, _insights_config_loaded
    defaults = _default_insights_metric_config()
    ensure_schema()
    with conn() as c, c.cursor() as cur:
        cur.execute(
            """
            insert into insights_config(id, metric_config, updated_at)
            values (1, %s::jsonb, now())
            on conflict (id)
            do update set metric_config = excluded.metric_config, updated_at = now();
            """,
            (json.dumps(defaults),),
        )
        c.commit()
    with _insights_config_lock:
        INSIGHTS_METRIC_CONFIG = defaults
        _insights_config_loaded = True
    return get_insights_config()


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
        or (
          assignee is not null
          and assignee = any(coalesce((select servicedesk_team_members from dashboard_config where id=1), array[]::text[]))
          and onderwerp_logging is not null
          and onderwerp_logging = any(coalesce((select servicedesk_onderwerpen from dashboard_config where id=1), array[]::text[]))
        )
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
        or (
          assignee is not null
          and assignee = any(coalesce((select servicedesk_team_members from dashboard_config where id=1), array[]::text[]))
          and onderwerp_logging is not null
          and onderwerp_logging = any(coalesce((select servicedesk_onderwerpen from dashboard_config where id=1), array[]::text[]))
        )
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
        or (
          assignee is not null
          and assignee = any(coalesce((select servicedesk_team_members from dashboard_config where id=1), array[]::text[]))
          and onderwerp_logging is not null
          and onderwerp_logging = any(coalesce((select servicedesk_onderwerpen from dashboard_config where id=1), array[]::text[]))
        )
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
        or (
          assignee is not null
          and assignee = any(coalesce((select servicedesk_team_members from dashboard_config where id=1), array[]::text[]))
          and onderwerp_logging is not null
          and onderwerp_logging = any(coalesce((select servicedesk_onderwerpen from dashboard_config where id=1), array[]::text[]))
        )
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
        or (
          assignee is not null
          and assignee = any(coalesce((select servicedesk_team_members from dashboard_config where id=1), array[]::text[]))
          and onderwerp_logging is not null
          and onderwerp_logging = any(coalesce((select servicedesk_onderwerpen from dashboard_config where id=1), array[]::text[]))
        )
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
        or (
          assignee is not null
          and assignee = any(coalesce((select servicedesk_team_members from dashboard_config where id=1), array[]::text[]))
          and onderwerp_logging is not null
          and onderwerp_logging = any(coalesce((select servicedesk_onderwerpen from dashboard_config where id=1), array[]::text[]))
        )
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
        or (
          assignee is not null
          and assignee = any(coalesce((select servicedesk_team_members from dashboard_config where id=1), array[]::text[]))
          and onderwerp_logging is not null
          and onderwerp_logging = any(coalesce((select servicedesk_onderwerpen from dashboard_config where id=1), array[]::text[]))
        )
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


def _ensure_insights_enabled():
    if not INSIGHTS_ENABLED:
        raise HTTPException(status_code=404, detail="Insights is uitgeschakeld.")


def _parse_insight_window(date_from: str, date_to: str):
    start = _parse_iso_date_or_raise(date_from, "date_from")
    end = _parse_iso_date_or_raise(date_to, "date_to")
    if end < start:
        raise HTTPException(status_code=400, detail="date_to mag niet voor date_from liggen.")
    days = (end - start).days + 1
    baseline_end = start - timedelta(days=1)
    baseline_start = baseline_end - timedelta(days=days - 1)
    return {
        "observed_start": start,
        "observed_end": end,
        "baseline_start": baseline_start,
        "baseline_end": baseline_end,
    }


def _mean(values: List[float]) -> Optional[float]:
    cleaned = [float(v) for v in values if v is not None]
    if not cleaned:
        return None
    return sum(cleaned) / len(cleaned)


def _stddev(values: List[float]) -> float:
    cleaned = [float(v) for v in values if v is not None]
    n = len(cleaned)
    if n < 2:
        return 0.0
    avg = sum(cleaned) / n
    var = sum((x - avg) ** 2 for x in cleaned) / (n - 1)
    return math.sqrt(max(var, 0.0))


def _quantile(sorted_values: List[float], q: float) -> Optional[float]:
    if not sorted_values:
        return None
    if len(sorted_values) == 1:
        return float(sorted_values[0])
    pos = (len(sorted_values) - 1) * q
    lower = int(math.floor(pos))
    upper = int(math.ceil(pos))
    if lower == upper:
        return float(sorted_values[lower])
    weight = pos - lower
    return float(sorted_values[lower] * (1 - weight) + sorted_values[upper] * weight)


def _metric_thresholds(metric: str) -> Dict[str, float]:
    _load_insights_config_if_needed()
    raw = INSIGHTS_METRIC_CONFIG.get(metric) or INSIGHTS_METRIC_CONFIG["default"]
    return {
        "min_abs_delta": float(raw["min_abs_delta"]),
        "min_rel_delta": float(raw["min_rel_delta"]),
        "trend_delta_min": float(raw["trend_delta_min"]),
        "trend_rel_delta_min": float(raw.get("trend_rel_delta_min", 0.25)),
        "min_sample_size": float(raw["min_sample_size"]),
    }


def _detect_anomaly(
    value: Optional[float],
    baseline_values: List[float],
    min_abs_delta: float,
    min_rel_delta: float,
    sample_size: Optional[float] = None,
    min_sample_size: float = 0.0,
) -> Dict[str, Any]:
    if value is None:
        return {
            "is_anomaly": False,
            "score": 0.0,
            "z_score": 0.0,
            "delta_abs": 0.0,
            "delta_rel": 0.0,
            "passes_sample_gate": False,
            "passes_effect_gate": False,
            "trigger_rule": "missing_value",
        }
    if sample_size is not None and float(sample_size) < float(min_sample_size or 0.0):
        return {
            "is_anomaly": False,
            "score": 0.0,
            "z_score": 0.0,
            "delta_abs": 0.0,
            "delta_rel": 0.0,
            "passes_sample_gate": False,
            "passes_effect_gate": False,
            "trigger_rule": "sample_below_min",
        }
    cleaned = sorted(float(v) for v in baseline_values if v is not None)
    if len(cleaned) < 4:
        return {
            "is_anomaly": False,
            "score": 0.0,
            "z_score": 0.0,
            "delta_abs": 0.0,
            "delta_rel": 0.0,
            "passes_sample_gate": True,
            "passes_effect_gate": False,
            "trigger_rule": "insufficient_baseline_points",
        }

    avg = _mean(cleaned) or 0.0
    std = _stddev(cleaned)
    z = 0.0 if std <= 1e-9 else abs((float(value) - avg) / std)
    delta_abs = abs(float(value) - avg)
    delta_rel = delta_abs / max(abs(avg), 1.0)

    q1 = _quantile(cleaned, 0.25)
    q3 = _quantile(cleaned, 0.75)
    iqr = (q3 - q1) if q1 is not None and q3 is not None else 0.0
    lower = (q1 - 1.5 * iqr) if q1 is not None else None
    upper = (q3 + 1.5 * iqr) if q3 is not None else None
    iqr_anomaly = False
    iqr_score = 0.0
    if lower is not None and upper is not None and iqr > 1e-9:
        iqr_anomaly = float(value) < lower or float(value) > upper
        if float(value) > upper:
            iqr_score = (float(value) - upper) / iqr
        elif float(value) < lower:
            iqr_score = (lower - float(value)) / iqr

    passes_effect = delta_abs >= min_abs_delta or delta_rel >= min_rel_delta
    is_anomaly = (z >= 2.4 or iqr_anomaly) and passes_effect
    score = max(z / 2.4, iqr_score, delta_rel / max(min_rel_delta, 1e-9))
    return {
        "is_anomaly": is_anomaly,
        "score": float(score),
        "z_score": float(z),
        "delta_abs": float(delta_abs),
        "delta_rel": float(delta_rel),
        "passes_sample_gate": True,
        "passes_effect_gate": bool(passes_effect),
        "trigger_rule": "zscore_or_iqr_with_effect" if is_anomaly else "within_bounds_or_effect_too_small",
    }


def _confidence_label(score: float) -> str:
    if score >= 1.5:
        return "high"
    if score >= 0.7:
        return "medium"
    return "low"


def _decision_score(urgency: str, confidence: str, impact_score: float) -> Dict[str, Any]:
    urgency_points = {"now": 45, "this_week": 30, "monitor": 15}.get(str(urgency), 15)
    confidence_points = {"high": 30, "medium": 20, "low": 10}.get(str(confidence), 10)
    impact_points = min(25, max(0, int(round(float(impact_score) * 10))))
    total = min(100, urgency_points + confidence_points + impact_points)
    return {
        "score": int(total),
        "breakdown": {
            "urgency_points": urgency_points,
            "confidence_points": confidence_points,
            "impact_points": impact_points,
        },
    }


def _week_key(value: Optional[str]) -> str:
    if not value:
        return ""
    return str(value)[:10]


def _weighted_weekly_average(rows: List[Dict[str, Any]], value_key: str = "avg_hours") -> List[Dict[str, Any]]:
    buckets: Dict[str, Dict[str, float]] = {}
    for row in rows or []:
        week = _week_key(row.get("week"))
        if not week:
            continue
        value = row.get(value_key)
        n = int(row.get("n") or 0)
        if value is None or n <= 0:
            continue
        current = buckets.setdefault(week, {"sum": 0.0, "weight": 0.0})
        current["sum"] += float(value) * n
        current["weight"] += n

    result = []
    for week in sorted(buckets.keys()):
        bucket = buckets[week]
        if bucket["weight"] <= 0:
            continue
        result.append({"week": week, "value": bucket["sum"] / bucket["weight"], "sample_size": bucket["weight"]})
    return result


def _simple_weekly_values(rows: List[Dict[str, Any]], value_key: str = "avg_hours") -> List[Dict[str, Any]]:
    items = []
    for row in rows or []:
        week = _week_key(row.get("week"))
        value = row.get(value_key)
        if not week or value is None:
            continue
        items.append({"week": week, "value": float(value), "sample_size": int(row.get("n") or 0)})
    items.sort(key=lambda x: x["week"])
    return items


def _backlog_gap_weekly(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    items = []
    for row in rows or []:
        week = _week_key(row.get("week"))
        incoming = int(row.get("incoming_count") or 0)
        closed = int(row.get("closed_count") or 0)
        if not week:
            continue
        items.append({"week": week, "value": float(incoming - closed), "sample_size": incoming + closed})
    items.sort(key=lambda x: x["week"])
    return items


def _build_trend_series(
    metric: str,
    label: str,
    unit: str,
    observed_values: List[Dict[str, Any]],
    baseline_values: List[Dict[str, Any]],
):
    baseline = [float(x["value"]) for x in baseline_values if x.get("value") is not None]
    expected = _mean(baseline)
    thresholds = _metric_thresholds(metric)
    baseline_mean = float(expected) if expected is not None else None
    points = []
    for row in observed_values:
        actual = float(row["value"])
        sample_size = float(row.get("sample_size") or 0)
        anomaly = _detect_anomaly(
            actual,
            baseline,
            min_abs_delta=thresholds["min_abs_delta"],
            min_rel_delta=thresholds["min_rel_delta"],
            sample_size=sample_size,
            min_sample_size=thresholds["min_sample_size"],
        )
        points.append(
            {
                "week": row["week"],
                "actual": actual,
                "expected": expected,
                "is_anomaly": anomaly["is_anomaly"],
                "confidence": _confidence_label(anomaly["score"]),
                "score": round(float(anomaly["score"]), 3),
                "sample_size": sample_size,
                "explainability": {
                    "trigger_rule": anomaly["trigger_rule"],
                    "baseline_mean": baseline_mean,
                    "observed_value": actual,
                    "sample_size": sample_size,
                    "passes_sample_gate": anomaly["passes_sample_gate"],
                    "passes_effect_gate": anomaly["passes_effect_gate"],
                    "z_score": round(float(anomaly["z_score"]), 3),
                    "delta_abs": round(float(anomaly["delta_abs"]), 3),
                    "delta_rel": round(float(anomaly["delta_rel"]), 3),
                    "threshold_used": {
                        "min_abs_delta": thresholds["min_abs_delta"],
                        "min_rel_delta": thresholds["min_rel_delta"],
                        "min_sample_size": thresholds["min_sample_size"],
                    },
                },
            }
        )
    return {
        "metric": metric,
        "label": label,
        "unit": unit,
        "min_sample_size": thresholds["min_sample_size"],
        "baseline_mean": baseline_mean,
        "threshold_used": thresholds,
        "points": points,
    }


def _build_highlight_card(
    *,
    card_id: str,
    card_type: str,
    title: str,
    summary: str,
    impact_value: float,
    impact_unit: str,
    why: str,
    window: Dict[str, str],
    baseline_window: Dict[str, str],
    metrics_used: List[str],
    confidence_score: Optional[float] = None,
    explainability: Optional[Dict[str, Any]] = None,
    business_summary: Optional[str] = None,
    recommended_action: Optional[str] = None,
    owner_hint: Optional[str] = None,
    due_hint: Optional[str] = None,
    urgency: Optional[str] = None,
):
    impact_score = float(confidence_score) if confidence_score is not None else abs(float(impact_value))
    confidence = _confidence_label(impact_score)
    urgency_value = urgency or "monitor"
    decision = _decision_score(urgency_value, confidence, impact_score)
    return {
        "id": card_id,
        "type": card_type,
        "title": title,
        "summary": summary,
        "impact_value": round(float(impact_value), 2),
        "impact_unit": impact_unit,
        "confidence": confidence,
        "why": why,
        "window": window,
        "baseline_window": baseline_window,
        "metrics_used": metrics_used,
        "explainability": explainability or {},
        "business_summary": business_summary or summary,
        "recommended_action": recommended_action or "Controleer dit signaal met het team.",
        "owner_hint": owner_hint or "Servicedesk lead",
        "due_hint": due_hint or "Deze week",
        "urgency": urgency_value,
        "decision_score": decision["score"],
        "decision_breakdown": decision["breakdown"],
        "last_updated": _to_utc_z(datetime.utcnow().replace(tzinfo=timezone.utc)),
    }


def _compute_highlights_from_series(
    trend_series: List[Dict[str, Any]], window: Dict[str, str], baseline_window: Dict[str, str]
) -> List[Dict[str, Any]]:
    cards = []
    for series in trend_series:
        points = series.get("points") or []
        if len(points) < 2:
            continue
        observed = [p.get("actual") for p in points if p.get("actual") is not None]
        observed_samples = [float(p.get("sample_size") or 0) for p in points]
        baseline = [p.get("expected") for p in points if p.get("expected") is not None]
        observed_mean = _mean(observed)
        baseline_mean = _mean(baseline)
        if observed_mean is None or baseline_mean is None:
            continue
        delta = float(observed_mean - baseline_mean)
        rel_delta = float(delta / max(abs(float(baseline_mean)), 1e-6))
        metric = series.get("metric")
        thresholds = _metric_thresholds(metric)
        observed_sample_avg = _mean(observed_samples) or 0.0
        if observed_sample_avg < thresholds["min_sample_size"]:
            continue
        if metric == "backlog_gap" and (
            delta >= thresholds["trend_delta_min"] or rel_delta >= thresholds["trend_rel_delta_min"]
        ):
            cards.append(
                _build_highlight_card(
                    card_id="backlog-gap-growth",
                    card_type="trend_shift",
                    title="Backlog groeit sneller dan sluiting",
                    summary=f"Gemiddelde backlog-gap ligt {delta:.1f} ({rel_delta * 100:.0f}%) boven baseline.",
                    impact_value=delta,
                    impact_unit="tickets/week",
                    why="Inflow minus gesloten tickets ligt structureel hoger dan in de referentieperiode.",
                    window=window,
                    baseline_window=baseline_window,
                    metrics_used=["inflow_vs_closed_weekly"],
                    confidence_score=max(abs(delta) / max(abs(baseline_mean), 1.0), abs(delta) / thresholds["trend_delta_min"]),
                    explainability={
                        "trigger_rule": "trend_delta_over_threshold",
                        "observed_mean": round(float(observed_mean), 3),
                        "baseline_mean": round(float(baseline_mean), 3),
                        "delta": round(float(delta), 3),
                        "relative_delta_pct": round(float(rel_delta * 100), 2),
                        "sample_size_avg": round(float(observed_sample_avg), 3),
                        "threshold_used": thresholds,
                    },
                    business_summary="De achterstand groeit; er komen structureel meer tickets binnen dan er worden gesloten.",
                    recommended_action="Plan vandaag een korte triage op instroompieken en herverdeel capaciteit op de topdriver.",
                    owner_hint="Servicedesk lead",
                    due_hint="Vandaag",
                    urgency="now",
                )
            )
        if metric == "time_to_resolution" and (
            rel_delta >= thresholds["trend_rel_delta_min"] and delta >= thresholds["trend_delta_min"]
        ):
            cards.append(
                _build_highlight_card(
                    card_id="ttr-growth",
                    card_type="sla_risk",
                    title="Time to Resolution stijgt",
                    summary=f"TTR ligt gemiddeld {rel_delta * 100:.0f}% ({delta:.1f} uur) boven baseline.",
                    impact_value=delta,
                    impact_unit="hours",
                    why="Gemiddelde oplostijd per week neemt toe ten opzichte van de referentieperiode.",
                    window=window,
                    baseline_window=baseline_window,
                    metrics_used=["time_to_resolution_weekly_by_type"],
                    confidence_score=max(abs(delta) / max(abs(baseline_mean), 1.0), abs(delta) / thresholds["trend_delta_min"]),
                    explainability={
                        "trigger_rule": "trend_delta_over_threshold",
                        "observed_mean": round(float(observed_mean), 3),
                        "baseline_mean": round(float(baseline_mean), 3),
                        "delta": round(float(delta), 3),
                        "relative_delta_pct": round(float(rel_delta * 100), 2),
                        "sample_size_avg": round(float(observed_sample_avg), 3),
                        "threshold_used": thresholds,
                    },
                    business_summary="Tickets blijven langer open dan normaal, waardoor doorlooptijden oplopen.",
                    recommended_action="Analyseer de traagste categorie en zet een tijdelijke fast-lane voor P1/P2.",
                    owner_hint="Procesowner + Servicedesk lead",
                    due_hint="Binnen 2 werkdagen",
                    urgency="this_week",
                )
            )
        if metric == "time_to_first_response" and (
            rel_delta >= thresholds["trend_rel_delta_min"] and delta >= thresholds["trend_delta_min"]
        ):
            cards.append(
                _build_highlight_card(
                    card_id="tfr-growth",
                    card_type="sla_risk",
                    title="Time to First Response stijgt",
                    summary=f"Eerste reactietijd ligt gemiddeld {rel_delta * 100:.0f}% ({delta:.1f} uur) boven baseline.",
                    impact_value=delta,
                    impact_unit="hours",
                    why="Reactietijd op nieuwe tickets verslechtert ten opzichte van de referentieperiode.",
                    window=window,
                    baseline_window=baseline_window,
                    metrics_used=["time_to_first_response_weekly"],
                    confidence_score=max(abs(delta) / max(abs(baseline_mean), 1.0), abs(delta) / thresholds["trend_delta_min"]),
                    explainability={
                        "trigger_rule": "trend_delta_over_threshold",
                        "observed_mean": round(float(observed_mean), 3),
                        "baseline_mean": round(float(baseline_mean), 3),
                        "delta": round(float(delta), 3),
                        "relative_delta_pct": round(float(rel_delta * 100), 2),
                        "sample_size_avg": round(float(observed_sample_avg), 3),
                        "threshold_used": thresholds,
                    },
                    business_summary="Nieuwe tickets krijgen later een eerste reactie, wat SLA-risico verhoogt.",
                    recommended_action="Plan extra eerste-respons blokken in piekuren en check bezetting per shift.",
                    owner_hint="Teamcoördinator",
                    due_hint="Vandaag",
                    urgency="now",
                )
            )
        latest = points[-1]
        if (
            latest.get("is_anomaly")
            and latest.get("confidence") != "low"
            and float(latest.get("sample_size") or 0) >= thresholds["min_sample_size"]
        ):
            cards.append(
                _build_highlight_card(
                    card_id=f"{metric}-latest-anomaly",
                    card_type="anomaly",
                    title=f"Afwijking in {series.get('label')}",
                    summary=f"Laatste week wijkt af van verwacht patroon ({latest.get('actual'):.2f} vs {latest.get('expected'):.2f}).",
                    impact_value=float(abs((latest.get("actual") or 0) - (latest.get("expected") or 0))),
                    impact_unit=series.get("unit") or "value",
                    why="Laatste datapunt valt buiten de normale bandbreedte van de baseline.",
                    window=window,
                    baseline_window=baseline_window,
                    metrics_used=[series.get("metric")],
                    confidence_score=float(latest.get("score") or 0.0),
                    explainability={
                        "trigger_rule": "point_anomaly_with_gates",
                        "observed_week": latest.get("week"),
                        "observed_value": latest.get("actual"),
                        "baseline_mean": latest.get("expected"),
                        "sample_size": latest.get("sample_size"),
                        "anomaly_score": latest.get("score"),
                        "point_explainability": latest.get("explainability") or {},
                        "threshold_used": thresholds,
                    },
                    business_summary="Er is een duidelijke afwijking ten opzichte van het normale patroon.",
                    recommended_action="Controleer of dit een incidentgolf of procesafwijking is en documenteer oorzaak.",
                    owner_hint="Servicedesk lead",
                    due_hint="Deze week",
                    urgency="monitor" if latest.get("confidence") == "medium" else "this_week",
                )
            )
    cards.sort(
        key=lambda x: (
            int(x.get("decision_score") or 0),
            abs(float(x.get("impact_value") or 0)),
        ),
        reverse=True,
    )
    return cards[:6]


def _fetch_driver_rows_for_dimension(
    *,
    dimension: str,
    column_expr: str,
    join_sql: str = "",
    date_from: str,
    date_to: str,
    baseline_from: str,
    baseline_to: str,
    organization: Optional[str],
    servicedesk_only: bool,
) -> List[Dict[str, Any]]:
    ensure_schema()
    q = f"""
    with current_rows as (
      select
        {column_expr} as category,
        count(*) as cnt
      from issues i
      {join_sql}
      where i.created_at >= %s::timestamptz and i.created_at < (%s::timestamptz + interval '1 day')
        and (%s is null or (i.organizations is not null and i.organizations @> array[%s]::text[]))
        {servicedesk_filter_clause('i')}
      group by 1
    ),
    baseline_rows as (
      select
        {column_expr} as category,
        count(*) as cnt
      from issues i
      {join_sql}
      where i.created_at >= %s::timestamptz and i.created_at < (%s::timestamptz + interval '1 day')
        and (%s is null or (i.organizations is not null and i.organizations @> array[%s]::text[]))
        {servicedesk_filter_clause('i')}
      group by 1
    )
    select
      coalesce(c.category, b.category) as category,
      coalesce(c.cnt, 0) as current_count,
      coalesce(b.cnt, 0) as baseline_count
    from current_rows c
    full outer join baseline_rows b on b.category = c.category
    where coalesce(c.category, b.category) is not null
      and coalesce(c.category, b.category) <> ''
    order by 1;
    """
    params = (
        date_from,
        date_to,
        organization,
        organization,
        servicedesk_only,
        baseline_from,
        baseline_to,
        organization,
        organization,
        servicedesk_only,
    )
    with conn() as c, c.cursor() as cur:
        cur.execute(q, params)
        rows = cur.fetchall()

    scored = []
    for category, current_count, baseline_count in rows:
        current_val = int(current_count or 0)
        baseline_val = int(baseline_count or 0)
        delta = current_val - baseline_val
        score = max(delta, 0) * math.log1p(max(current_val, 0))
        scored.append(
            {
                "dimension": dimension,
                "category": str(category),
                "current_count": current_val,
                "baseline_count": baseline_val,
                "delta": delta,
                "contribution_score": float(score),
            }
        )

    positive_total = sum(x["contribution_score"] for x in scored if x["contribution_score"] > 0)
    for item in scored:
        if positive_total > 0 and item["contribution_score"] > 0:
            item["contribution_pct"] = round((item["contribution_score"] / positive_total) * 100, 2)
        else:
            item["contribution_pct"] = 0.0
    scored.sort(key=lambda x: (x["contribution_score"], x["delta"], x["current_count"]), reverse=True)
    return scored[:8]


def _insights_metric_config_payload() -> Dict[str, Dict[str, float]]:
    return {
        metric: _metric_thresholds(metric)
        for metric in ("backlog_gap", "time_to_resolution", "time_to_first_response")
    }


def _build_trends_payload(
    date_from: str, date_to: str, organization: Optional[str], servicedesk_only: bool
) -> Dict[str, Any]:
    windows = _parse_insight_window(date_from, date_to)
    observed_window = {
        "from": windows["observed_start"].isoformat(),
        "to": windows["observed_end"].isoformat(),
    }
    baseline_window = {
        "from": windows["baseline_start"].isoformat(),
        "to": windows["baseline_end"].isoformat(),
    }
    observed_from = observed_window["from"]
    observed_to = observed_window["to"]
    baseline_from = baseline_window["from"]
    baseline_to = baseline_window["to"]

    observed_inflow = inflow_vs_closed_weekly(
        date_from=observed_from,
        date_to=observed_to,
        organization=organization,
        servicedesk_only=servicedesk_only,
    )
    baseline_inflow = inflow_vs_closed_weekly(
        date_from=baseline_from,
        date_to=baseline_to,
        organization=organization,
        servicedesk_only=servicedesk_only,
    )
    observed_ttr = time_to_resolution_weekly_by_type(
        date_from=observed_from,
        date_to=observed_to,
        organization=organization,
        servicedesk_only=servicedesk_only,
    )
    baseline_ttr = time_to_resolution_weekly_by_type(
        date_from=baseline_from,
        date_to=baseline_to,
        organization=organization,
        servicedesk_only=servicedesk_only,
    )
    observed_tfr = time_to_first_response_weekly(
        date_from=observed_from,
        date_to=observed_to,
        organization=organization,
        servicedesk_only=servicedesk_only,
    )
    baseline_tfr = time_to_first_response_weekly(
        date_from=baseline_from,
        date_to=baseline_to,
        organization=organization,
        servicedesk_only=servicedesk_only,
    )

    series = [
        _build_trend_series(
            metric="backlog_gap",
            label="Backlog gap",
            unit="tickets/week",
            observed_values=_backlog_gap_weekly(observed_inflow),
            baseline_values=_backlog_gap_weekly(baseline_inflow),
        ),
        _build_trend_series(
            metric="time_to_resolution",
            label="Time to Resolution",
            unit="hours",
            observed_values=_weighted_weekly_average(observed_ttr, "avg_hours"),
            baseline_values=_weighted_weekly_average(baseline_ttr, "avg_hours"),
        ),
        _build_trend_series(
            metric="time_to_first_response",
            label="Time to First Response",
            unit="hours",
            observed_values=_simple_weekly_values(observed_tfr, "avg_hours"),
            baseline_values=_simple_weekly_values(baseline_tfr, "avg_hours"),
        ),
    ]
    return {
        "window": observed_window,
        "baseline_window": baseline_window,
        "series": series,
        "metric_config": _insights_metric_config_payload(),
        "generated_at": _to_utc_z(datetime.utcnow().replace(tzinfo=timezone.utc)),
    }


@app.get("/insights/trends")
def insights_trends(
    date_from: str = Query(...),
    date_to: str = Query(...),
    organization: Optional[str] = None,
    servicedesk_only: bool = False,
):
    _ensure_insights_enabled()
    return _build_trends_payload(
        date_from=date_from,
        date_to=date_to,
        organization=organization,
        servicedesk_only=servicedesk_only,
    )


@app.get("/insights/highlights")
def insights_highlights(
    date_from: str = Query(...),
    date_to: str = Query(...),
    organization: Optional[str] = None,
    servicedesk_only: bool = False,
):
    _ensure_insights_enabled()
    trends = _build_trends_payload(
        date_from=date_from,
        date_to=date_to,
        organization=organization,
        servicedesk_only=servicedesk_only,
    )
    cards = _compute_highlights_from_series(
        trends.get("series") or [],
        trends.get("window") or {"from": date_from, "to": date_to},
        trends.get("baseline_window") or {"from": date_from, "to": date_to},
    )
    return {
        "window": trends["window"],
        "baseline_window": trends["baseline_window"],
        "cards": cards,
        "metric_config": trends.get("metric_config") or _insights_metric_config_payload(),
        "generated_at": trends["generated_at"],
    }


@app.get("/insights/drivers")
def insights_drivers(
    date_from: str = Query(...),
    date_to: str = Query(...),
    organization: Optional[str] = None,
    servicedesk_only: bool = False,
):
    _ensure_insights_enabled()
    windows = _parse_insight_window(date_from, date_to)
    observed_window = {
        "from": windows["observed_start"].isoformat(),
        "to": windows["observed_end"].isoformat(),
    }
    baseline_window = {
        "from": windows["baseline_start"].isoformat(),
        "to": windows["baseline_end"].isoformat(),
    }
    drivers = [
        {
            "dimension": "onderwerp",
            "label": "Onderwerp",
            "items": _fetch_driver_rows_for_dimension(
                dimension="onderwerp",
                column_expr="i.onderwerp_logging",
                date_from=observed_window["from"],
                date_to=observed_window["to"],
                baseline_from=baseline_window["from"],
                baseline_to=baseline_window["to"],
                organization=organization,
                servicedesk_only=servicedesk_only,
            ),
        },
        {
            "dimension": "organization",
            "label": "Organization",
            "items": _fetch_driver_rows_for_dimension(
                dimension="organization",
                column_expr="org.org_name",
                join_sql="cross join lateral unnest(i.organizations) as org(org_name)",
                date_from=observed_window["from"],
                date_to=observed_window["to"],
                baseline_from=baseline_window["from"],
                baseline_to=baseline_window["to"],
                organization=organization,
                servicedesk_only=servicedesk_only,
            ),
        },
        {
            "dimension": "priority",
            "label": "Priority",
            "items": _fetch_driver_rows_for_dimension(
                dimension="priority",
                column_expr="i.priority",
                date_from=observed_window["from"],
                date_to=observed_window["to"],
                baseline_from=baseline_window["from"],
                baseline_to=baseline_window["to"],
                organization=organization,
                servicedesk_only=servicedesk_only,
            ),
        },
        {
            "dimension": "assignee",
            "label": "Assignee",
            "items": _fetch_driver_rows_for_dimension(
                dimension="assignee",
                column_expr="i.assignee",
                date_from=observed_window["from"],
                date_to=observed_window["to"],
                baseline_from=baseline_window["from"],
                baseline_to=baseline_window["to"],
                organization=organization,
                servicedesk_only=servicedesk_only,
            ),
        },
    ]
    return {
        "window": observed_window,
        "baseline_window": baseline_window,
        "drivers": drivers,
        "generated_at": _to_utc_z(datetime.utcnow().replace(tzinfo=timezone.utc)),
    }


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
        or (
          assignee is not null
          and assignee = any(coalesce((select servicedesk_team_members from dashboard_config where id=1), array[]::text[]))
          and onderwerp_logging is not null
          and onderwerp_logging = any(coalesce((select servicedesk_onderwerpen from dashboard_config where id=1), array[]::text[]))
        )
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
        or (
          assignee is not null
          and assignee = any(coalesce((select servicedesk_team_members from dashboard_config where id=1), array[]::text[]))
          and onderwerp_logging is not null
          and onderwerp_logging = any(coalesce((select servicedesk_onderwerpen from dashboard_config where id=1), array[]::text[]))
        )
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
        or (
          assignee is not null
          and assignee = any(coalesce((select servicedesk_team_members from dashboard_config where id=1), array[]::text[]))
          and onderwerp_logging is not null
          and onderwerp_logging = any(coalesce((select servicedesk_onderwerpen from dashboard_config where id=1), array[]::text[]))
        )
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
        or (
          i.assignee is not null
          and i.assignee = any(coalesce((select servicedesk_team_members from dashboard_config where id=1), array[]::text[]))
          and i.onderwerp_logging is not null
          and i.onderwerp_logging = any(coalesce((select servicedesk_onderwerpen from dashboard_config where id=1), array[]::text[]))
        )
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
    date_field: str = "created",
    limit: int = 100,
    offset: int = 0,
):
    ensure_schema()
    date_field_norm = (date_field or "created").strip().lower()
    if date_field_norm not in ("created", "resolved"):
        date_field_norm = "created"

    date_column = "resolved_at" if date_field_norm == "resolved" else "created_at"
    date_null_guard = "and resolved_at is not null" if date_field_norm == "resolved" else ""
    q = f"""
    select issue_key, request_type, onderwerp_logging, created_at, resolved_at, priority, assignee, current_status
    from issues
    where {date_column} >= %s::timestamptz and {date_column} < (%s::timestamptz + interval '1 day')
      {date_null_guard}
      and (%s is null or request_type = %s)
      and (%s is null or onderwerp_logging = %s)
      and (%s is null or priority = %s)
      and (%s is null or assignee = %s)
      and (%s is null or (organizations is not null and organizations @> array[%s]::text[]))
      and (
        not %s
        or (
          assignee is not null
          and assignee = any(coalesce((select servicedesk_team_members from dashboard_config where id=1), array[]::text[]))
          and onderwerp_logging is not null
          and onderwerp_logging = any(coalesce((select servicedesk_onderwerpen from dashboard_config where id=1), array[]::text[]))
        )
      )
    order by {date_column} desc
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
        or (
          assignee is not null
          and assignee = any(coalesce((select servicedesk_team_members from dashboard_config where id=1), array[]::text[]))
          and onderwerp_logging is not null
          and onderwerp_logging = any(coalesce((select servicedesk_onderwerpen from dashboard_config where id=1), array[]::text[]))
        )
      )
            order by created_at desc
            limit 500;
            """,
            (servicedesk_only,),
        )
        p1_rows = [r for r in cur.fetchall() if is_priority1_priority(r[2]) and is_priority1_alert_status(r[3])][:25]

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
        or (
          assignee is not null
          and assignee = any(coalesce((select servicedesk_team_members from dashboard_config where id=1), array[]::text[]))
          and onderwerp_logging is not null
          and onderwerp_logging = any(coalesce((select servicedesk_onderwerpen from dashboard_config where id=1), array[]::text[]))
        )
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
            where resolved_at is null
              and lower(coalesce(current_status, '')) = 'nieuwe melding'
              and first_response_due_at is not null
              and first_response_due_at < now()
              and (
        not %s
        or (
          assignee is not null
          and assignee = any(coalesce((select servicedesk_team_members from dashboard_config where id=1), array[]::text[]))
          and onderwerp_logging is not null
          and onderwerp_logging = any(coalesce((select servicedesk_onderwerpen from dashboard_config where id=1), array[]::text[]))
        )
      )
            order by first_response_due_at asc
            limit 25;
            """,
            (servicedesk_only,),
        )
        overdue_rows = cur.fetchall()

    all_keys = [r[0] for r in p1_rows] + [r[0] for r in sla_rows] + [r[0] for r in overdue_rows]
    existing_keys = _jira_existing_issue_keys(all_keys)

    priority_items = [
        {
            "issue_key": r[0],
            "created_at": r[1].isoformat() if r[1] else None,
            "priority": r[2],
            "status": r[3],
        }
        for r in p1_rows
        if r[0] in existing_keys
    ]
    due_soon_items = [
        {
            "issue_key": r[0],
            "due_at": r[1].isoformat() if r[1] else None,
            "minutes_left": int(r[2] or 0),
        }
        for r in sla_rows
        if r[0] in existing_keys
    ]
    overdue_items = [
        {
            "issue_key": r[0],
            "due_at": r[1].isoformat() if r[1] else None,
            "minutes_overdue": int(r[2] or 0),
        }
        for r in overdue_rows
        if r[0] in existing_keys
    ]

    log_events = []
    log_events.extend(
        {
            "issue_key": item["issue_key"],
            "alert_kind": "P1",
            "status": item.get("status"),
            "meta": item.get("priority"),
            "servicedesk_only": servicedesk_only,
        }
        for item in priority_items
    )
    log_events.extend(
        {
            "issue_key": item["issue_key"],
            "alert_kind": "SLA_SOON",
            "status": None,
            "meta": f"{int(item.get('minutes_left') or 0)} min",
            "servicedesk_only": servicedesk_only,
        }
        for item in due_soon_items
    )
    log_events.extend(
        {
            "issue_key": item["issue_key"],
            "alert_kind": "SLA_OVERDUE",
            "status": None,
            "meta": f"{int(item.get('minutes_overdue') or 0)} min te laat",
            "servicedesk_only": servicedesk_only,
        }
        for item in overdue_items
    )

    with conn() as c, c.cursor() as cur:
        _maybe_cleanup_alert_logs(cur)
        inserted_events = _persist_alert_log_events(cur, log_events)
        c.commit()
    _send_teams_alert_notification(inserted_events)

    return {
        "priority1": priority_items,
        "first_response_due_soon": due_soon_items,
        "first_response_overdue": overdue_items,
    }


@app.get("/alerts/logs")
def alerts_logs(limit: int = 200, servicedesk_only: bool = True):
    ensure_schema()
    safe_limit = max(1, min(int(limit or 200), 1000))
    with conn() as c, c.cursor() as cur:
        _maybe_cleanup_alert_logs(cur)
        cur.execute(
            """
            select id, issue_key, alert_kind, status, meta, servicedesk_only, detected_at
            from alert_logs
            where servicedesk_only = %s
            order by detected_at desc, id desc
            limit %s;
            """,
            (servicedesk_only, safe_limit),
        )
        rows = cur.fetchall()
        c.commit()
    return [
        {
            "id": int(r[0]),
            "issue_key": r[1],
            "kind": r[2],
            "status": r[3],
            "meta": r[4],
            "servicedesk_only": bool(r[5]),
            "detected_at": r[6].isoformat() if r[6] else None,
        }
        for r in rows
    ]


@app.post("/dev/alerts/trigger")
def dev_alert_trigger(servicedesk_only: bool = True):
    ensure_schema()
    issue_key = f"{DEV_ALERT_ISSUE_KEY}-{int(time.time())}"
    with conn() as c, c.cursor() as cur:
        cur.execute(
            """
            select
              coalesce((select servicedesk_team_members[1] from dashboard_config where id=1), 'Johan'),
              coalesce((select servicedesk_onderwerpen[1] from dashboard_config where id=1), 'Koppelingen');
            """
        )
        row = cur.fetchone() or ("Johan", "Koppelingen")
        assignee = row[0] or "Johan"
        onderwerp = row[1] or "Koppelingen"
        cur.execute(
            """
            update dashboard_config
            set
              servicedesk_team_members = case
                when %s = any(servicedesk_team_members) then servicedesk_team_members
                else array_append(servicedesk_team_members, %s)
              end,
              servicedesk_onderwerpen = case
                when %s = any(servicedesk_onderwerpen) then servicedesk_onderwerpen
                else array_append(servicedesk_onderwerpen, %s)
              end,
              updated_at = now()
            where id = 1;
            """,
            (assignee, assignee, onderwerp, onderwerp),
        )
        cur.execute(
            """
            insert into issues(
              issue_key,
              request_type,
              onderwerp_logging,
              organizations,
              created_at,
              resolved_at,
              updated_at,
              priority,
              assignee,
              assignee_avatar_url,
              current_status,
              first_response_due_at
            )
            values (%s, %s, %s, %s, now(), null, now(), %s, %s, null, %s, now() + interval '3 minutes')
            on conflict (issue_key) do update set
              request_type=excluded.request_type,
              onderwerp_logging=excluded.onderwerp_logging,
              organizations=excluded.organizations,
              created_at=excluded.created_at,
              resolved_at=excluded.resolved_at,
              updated_at=excluded.updated_at,
              priority=excluded.priority,
              assignee=excluded.assignee,
              assignee_avatar_url=excluded.assignee_avatar_url,
              current_status=excluded.current_status,
              first_response_due_at=excluded.first_response_due_at;
            """,
            (
                issue_key,
                "Dev Alert",
                onderwerp,
                ["Dev"],
                "P1",
                assignee,
                "Nieuwe melding",
            ),
        )
        c.commit()
    return {"ok": True, "issue_key": issue_key, "servicedesk_only": bool(servicedesk_only)}


@app.post("/dev/alerts/clear")
def dev_alert_clear(issue_key: Optional[str] = None):
    ensure_schema()
    with conn() as c, c.cursor() as cur:
        if issue_key:
            cur.execute("delete from issues where issue_key = %s;", (issue_key,))
            cur.execute("delete from alert_logs where issue_key = %s;", (issue_key,))
        else:
            cur.execute("delete from issues where issue_key like %s;", (f"{DEV_ALERT_ISSUE_KEY}-%",))
            cur.execute("delete from alert_logs where issue_key like %s;", (f"{DEV_ALERT_ISSUE_KEY}-%",))
        c.commit()
    return {"ok": True, "issue_key": issue_key or f"{DEV_ALERT_ISSUE_KEY}-*"}


@app.get("/dev/alerts/test-state")
def dev_alert_test_state():
    ensure_schema()
    with conn() as c, c.cursor() as cur:
        cur.execute(
            """
            select issue_key
            from issues
            where issue_key like %s
              and resolved_at is null
              and lower(coalesce(current_status, '')) = 'nieuwe melding'
            order by created_at desc nulls last;
            """,
            (f"{DEV_ALERT_ISSUE_KEY}-%",),
        )
        keys = [r[0] for r in cur.fetchall()]
    return {"keys": keys, "count": len(keys)}


@app.post("/dev/alerts/notify-test")
def dev_alert_notify_test():
    result = _send_teams_alert_notification(
        [
            {
                "issue_key": f"{DEV_ALERT_ISSUE_KEY}-NOTIFY",
                "alert_kind": "P1",
                "status": "Nieuwe melding",
                "meta": "Priority 1",
                "servicedesk_only": True,
            }
        ]
    )
    return result


@app.get("/vacations")
def vacations(include_past: bool = False):
    ensure_schema()
    where_clause = "" if include_past else "where end_date >= current_date"
    with conn() as c, c.cursor() as cur:
        cur.execute(
            f"""
            select id, member_name, start_date, end_date, created_at, updated_at
            from vacations
            {where_clause}
            order by start_date asc, end_date asc, id asc;
            """
        )
        rows = cur.fetchall()
    return [_vacation_row_to_dict(row) for row in rows]


@app.get("/vacations/upcoming")
def vacations_upcoming(limit: int = Query(default=3, ge=1, le=20)):
    ensure_schema()
    with conn() as c, c.cursor() as cur:
        cur.execute(
            """
            select id, member_name, start_date, end_date, created_at, updated_at
            from vacations
            where end_date >= current_date
            order by start_date asc, end_date asc, id asc
            limit %s;
            """,
            (limit,),
        )
        rows = cur.fetchall()
    return [_vacation_row_to_dict(row) for row in rows]


@app.get("/vacations/today")
def vacations_today():
    ensure_schema()
    with conn() as c, c.cursor() as cur:
        cur.execute(
            """
            select id, member_name, start_date, end_date, created_at, updated_at
            from vacations
            where start_date <= current_date
              and end_date >= current_date
            order by member_name asc, start_date asc, id asc;
            """
        )
        rows = cur.fetchall()
    return [_vacation_row_to_dict(row) for row in rows]


@app.post("/vacations")
def create_vacation(payload: VacationPayload):
    ensure_schema()
    try:
        member_name, start_date, end_date = _validate_vacation_payload(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    with conn() as c, c.cursor() as cur:
        cur.execute(
            """
            insert into vacations(member_name, start_date, end_date)
            values (%s, %s, %s)
            returning id, member_name, start_date, end_date, created_at, updated_at;
            """,
            (member_name, start_date, end_date),
        )
        row = cur.fetchone()
        c.commit()
    return _vacation_row_to_dict(row)


@app.put("/vacations/{vacation_id}")
def update_vacation(vacation_id: int, payload: VacationPayload):
    ensure_schema()
    try:
        member_name, start_date, end_date = _validate_vacation_payload(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    with conn() as c, c.cursor() as cur:
        cur.execute(
            """
            update vacations
            set member_name = %s,
                start_date = %s,
                end_date = %s,
                updated_at = now()
            where id = %s
            returning id, member_name, start_date, end_date, created_at, updated_at;
            """,
            (member_name, start_date, end_date, vacation_id),
        )
        row = cur.fetchone()
        c.commit()
    if row is None:
        raise HTTPException(status_code=404, detail="Vakantie niet gevonden.")
    return _vacation_row_to_dict(row)


@app.delete("/vacations/{vacation_id}")
def delete_vacation(vacation_id: int):
    ensure_schema()
    with conn() as c, c.cursor() as cur:
        cur.execute("delete from vacations where id = %s returning id;", (vacation_id,))
        row = cur.fetchone()
        c.commit()
    if row is None:
        raise HTTPException(status_code=404, detail="Vakantie niet gevonden.")
    return {"deleted": True, "id": int(row[0])}


@app.get("/sync/status")
def sync_status():
    return get_sync_status_payload()


@app.get("/status")
def status():
    return get_sync_status_payload()


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
