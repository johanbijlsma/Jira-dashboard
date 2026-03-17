import os
import time
import threading
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

import requests
import psycopg2
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse, Response
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
AUTO_SYNC_ENABLED = str(os.environ.get("AUTO_SYNC_ENABLED", "true")).strip().lower() in {"1", "true", "yes", "on"}
SYNC_INCREMENTAL_INTERVAL_SECONDS = max(15, int(os.environ.get("SYNC_INCREMENTAL_INTERVAL_SECONDS", "45")))
SYNC_FULL_INTERVAL_HOURS = max(1, int(os.environ.get("SYNC_FULL_INTERVAL_HOURS", "24")))
SLA_CRITICAL_MINUTES = max(1, int(os.environ.get("SLA_CRITICAL_MINUTES", "5")))
SLA_WARNING_MINUTES = max(SLA_CRITICAL_MINUTES + 1, int(os.environ.get("SLA_WARNING_MINUTES", "30")))
SLA_OVERDUE_MAX_AGE_HOURS = max(1, int(os.environ.get("SLA_OVERDUE_MAX_AGE_HOURS", "24")))
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
_last_alert_log_cleanup_at = 0.0
_auto_sync_scheduler_started = False
_auto_sync_scheduler_lock = threading.Lock()
DEV_ALERT_ISSUE_KEY = "DEV-ALERT-TEST"
DEFAULT_SERVICEDESK_TEAM_MEMBERS = ["Johan", "Ashley", "Jarno"]
DEFAULT_NON_SERVICEDESK_ONDERWERPEN = {
    "Koppelingen",
    "Rest-endpoints",
    "SSO-koppeling",
    "UWV-koppeling",
    "Datadump",
    "Migratie",
}
DEFAULT_NON_SERVICEDESK_ONDERWERPEN_LOWER = {value.lower() for value in DEFAULT_NON_SERVICEDESK_ONDERWERPEN}

# Prefer POSTGRES_* and fall back to DB_* for backward compatibility.
PG_HOST = os.environ.get("POSTGRES_HOST") or os.environ.get("DB_HOST") or "localhost"
PG_PORT = int(os.environ.get("POSTGRES_PORT") or os.environ.get("DB_PORT") or 5432)
PG_DB = os.environ.get("POSTGRES_DB") or os.environ.get("DB_NAME") or "jsm_analytics"
PG_USER = os.environ.get("POSTGRES_USER") or os.environ.get("DB_USER") or "jsm"
PG_PASSWORD = os.environ.get("POSTGRES_PASSWORD") or os.environ.get("DB_PASSWORD") or "jsm_password"
REPORT_TIMEZONE = ZoneInfo("Europe/Amsterdam")


def conn():
    """Create a new Postgres connection per request."""
    return psycopg2.connect(
        host=PG_HOST,
        port=PG_PORT,
        dbname=PG_DB,
        user=PG_USER,
        password=PG_PASSWORD,
    )


def _previous_full_week_range(now_utc: Optional[datetime] = None):
    now_dt = now_utc or datetime.now(timezone.utc)
    local_today = now_dt.astimezone(REPORT_TIMEZONE).date()
    current_week_start = local_today - timedelta(days=local_today.weekday())  # Monday
    previous_week_start = current_week_start - timedelta(days=7)
    previous_week_end = current_week_start - timedelta(days=1)
    return previous_week_start, previous_week_end


def _safe_ratio_pct(numerator: int, denominator: int) -> Optional[float]:
    if not denominator:
        return None
    return round((float(numerator) / float(denominator)) * 100.0, 1)


def _pdf_escape(text: str) -> str:
    s = str(text or "")
    s = s.encode("latin-1", "replace").decode("latin-1")
    s = s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    return s


def _build_text_pdf(lines: List[str]) -> bytes:
    page_width = 595
    page_height = 842
    margin_top = 48
    margin_left = 42
    line_height = 14
    max_lines = max(1, int((page_height - margin_top * 2) // line_height))
    clean_lines = [str(line or "") for line in lines]
    pages = [
        clean_lines[i: i + max_lines]
        for i in range(0, len(clean_lines), max_lines)
    ] or [["Geen data beschikbaar."]]

    objects: List[str] = []

    def add_obj(body: str) -> int:
        objects.append(body)
        return len(objects)

    catalog_id = add_obj("<< /Type /Catalog /Pages 0 0 R >>")
    pages_id = add_obj("<< /Type /Pages /Kids [] /Count 0 >>")
    font_id = add_obj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

    page_ids = []
    for page_lines in pages:
        stream_lines = ["BT", "/F1 11 Tf", "14 TL"]
        y = page_height - margin_top
        for line in page_lines:
            stream_lines.append(f"1 0 0 1 {margin_left} {y:.2f} Tm ({_pdf_escape(line)}) Tj")
            y -= line_height
        stream_lines.append("ET")
        stream_text = "\n".join(stream_lines)
        stream_id = add_obj(f"<< /Length {len(stream_text.encode('latin-1', 'replace'))} >>\nstream\n{stream_text}\nendstream")
        page_id = add_obj(
            f"<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {page_width} {page_height}] "
            f"/Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {stream_id} 0 R >>"
        )
        page_ids.append(page_id)

    kids = " ".join(f"{pid} 0 R" for pid in page_ids)
    objects[pages_id - 1] = f"<< /Type /Pages /Kids [{kids}] /Count {len(page_ids)} >>"
    objects[catalog_id - 1] = f"<< /Type /Catalog /Pages {pages_id} 0 R >>"

    pdf = bytearray()
    pdf.extend(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for idx, obj in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf.extend(f"{idx} 0 obj\n{obj}\nendobj\n".encode("latin-1", "replace"))

    xref_start = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("latin-1"))
    pdf.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode("latin-1"))
    pdf.extend(
        (
            f"trailer\n<< /Size {len(objects) + 1} /Root {catalog_id} 0 R >>\n"
            f"startxref\n{xref_start}\n%%EOF\n"
        ).encode("latin-1")
    )
    return bytes(pdf)


def _weekly_insights_payload(servicedesk_only: bool = True) -> Dict[str, Any]:
    ensure_schema()
    week_start, week_end = _previous_full_week_range()
    date_from = week_start.isoformat()
    date_to = week_end.isoformat()

    with conn() as c, c.cursor() as cur:
        cur.execute(
            """
            with incoming as (
              select count(*) as count
              from issues
              where created_at >= %s::timestamptz and created_at < (%s::timestamptz + interval '1 day')
                and (
                  not %s
                  or (
                    assignee is not null
                    and assignee = any(coalesce((select servicedesk_team_members from dashboard_config where id=1), array[]::text[]))
                    and onderwerp_logging is not null
                    and onderwerp_logging = any(coalesce((select servicedesk_onderwerpen from dashboard_config where id=1), array[]::text[]))
                  )
                )
            ),
            closed as (
              select count(*) as count
              from issues
              where resolved_at is not null
                and resolved_at >= %s::timestamptz and resolved_at < (%s::timestamptz + interval '1 day')
                and (
                  not %s
                  or (
                    assignee is not null
                    and assignee = any(coalesce((select servicedesk_team_members from dashboard_config where id=1), array[]::text[]))
                    and onderwerp_logging is not null
                    and onderwerp_logging = any(coalesce((select servicedesk_onderwerpen from dashboard_config where id=1), array[]::text[]))
                  )
                )
            )
            select
              coalesce((select count from incoming), 0) as incoming_count,
              coalesce((select count from closed), 0) as closed_count;
            """,
            (date_from, date_to, servicedesk_only, date_from, date_to, servicedesk_only),
        )
        totals_row = cur.fetchone() or (0, 0)
        incoming_count = int(totals_row[0] or 0)
        closed_count = int(totals_row[1] or 0)

        cur.execute(
            """
            select request_type, count(*) as tickets
            from issues
            where created_at >= %s::timestamptz and created_at < (%s::timestamptz + interval '1 day')
              and request_type is not null and request_type <> ''
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
            order by 2 desc, 1
            limit 5;
            """,
            (date_from, date_to, servicedesk_only),
        )
        request_type_rows = cur.fetchall()

        cur.execute(
            """
            select onderwerp_logging as onderwerp, count(*) as tickets
            from issues
            where created_at >= %s::timestamptz and created_at < (%s::timestamptz + interval '1 day')
              and onderwerp_logging is not null and onderwerp_logging <> ''
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
            order by 2 desc, 1
            limit 5;
            """,
            (date_from, date_to, servicedesk_only),
        )
        onderwerp_rows = cur.fetchall()

        cur.execute(
            """
            select priority, count(*) as tickets
            from issues
            where created_at >= %s::timestamptz and created_at < (%s::timestamptz + interval '1 day')
              and priority is not null and priority <> ''
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
            order by 2 desc, 1
            limit 5;
            """,
            (date_from, date_to, servicedesk_only),
        )
        priority_rows = cur.fetchall()

        cur.execute(
            """
            select assignee, count(*) as tickets
            from issues
            where created_at >= %s::timestamptz and created_at < (%s::timestamptz + interval '1 day')
              and assignee is not null and assignee <> ''
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
            order by 2 desc, 1
            limit 5;
            """,
            (date_from, date_to, servicedesk_only),
        )
        assignee_rows = cur.fetchall()

        cur.execute(
            """
            select org.org_name as organization, count(*) as tickets
            from issues i
            cross join lateral unnest(i.organizations) as org(org_name)
            where i.created_at >= %s::timestamptz and i.created_at < (%s::timestamptz + interval '1 day')
              and org.org_name is not null and org.org_name <> ''
              and (
                not %s
                or (
                  i.assignee is not null
                  and i.assignee = any(coalesce((select servicedesk_team_members from dashboard_config where id=1), array[]::text[]))
                  and i.onderwerp_logging is not null
                  and i.onderwerp_logging = any(coalesce((select servicedesk_onderwerpen from dashboard_config where id=1), array[]::text[]))
                )
              )
            group by 1
            order by 2 desc, 1
            limit 5;
            """,
            (date_from, date_to, servicedesk_only),
        )
        organization_rows = cur.fetchall()

        cur.execute(
            """
            select
              avg(extract(epoch from (updated_at - created_at))/3600.0) as avg_hours,
              percentile_cont(0.50) within group (order by extract(epoch from (updated_at - created_at))/3600.0) as p50_hours,
              count(*) as n
            from issues
            where created_at >= %s::timestamptz and created_at < (%s::timestamptz + interval '1 day')
              and updated_at is not null
              and updated_at >= created_at
              and (
                not %s
                or (
                  assignee is not null
                  and assignee = any(coalesce((select servicedesk_team_members from dashboard_config where id=1), array[]::text[]))
                  and onderwerp_logging is not null
                  and onderwerp_logging = any(coalesce((select servicedesk_onderwerpen from dashboard_config where id=1), array[]::text[]))
                )
              );
            """,
            (date_from, date_to, servicedesk_only),
        )
        first_response_row = cur.fetchone() or (None, None, 0)

        cur.execute(
            """
            select
              avg(extract(epoch from (resolved_at - created_at))/3600.0) as avg_hours,
              percentile_cont(0.50) within group (order by extract(epoch from (resolved_at - created_at))/3600.0) as p50_hours,
              count(*) as n
            from issues
            where created_at >= %s::timestamptz and created_at < (%s::timestamptz + interval '1 day')
              and resolved_at is not null
              and resolved_at >= created_at
              and (
                not %s
                or (
                  assignee is not null
                  and assignee = any(coalesce((select servicedesk_team_members from dashboard_config where id=1), array[]::text[]))
                  and onderwerp_logging is not null
                  and onderwerp_logging = any(coalesce((select servicedesk_onderwerpen from dashboard_config where id=1), array[]::text[]))
                )
              );
            """,
            (date_from, date_to, servicedesk_only),
        )
        resolution_row = cur.fetchone() or (None, None, 0)

        cur.execute(
            """
            select alert_kind, count(*) as events
            from alert_logs
            where detected_at >= %s::timestamptz and detected_at < (%s::timestamptz + interval '1 day')
              and servicedesk_only = %s
            group by 1
            order by 2 desc, 1;
            """,
            (date_from, date_to, servicedesk_only),
        )
        alert_kind_rows = cur.fetchall()

    response_scope = "alle tickets"
    if servicedesk_only:
        response_scope = "alleen servicedesk"

    alert_by_kind = [{"kind": r[0], "events": int(r[1] or 0)} for r in alert_kind_rows]
    alert_total = sum(item["events"] for item in alert_by_kind)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "week": {
            "start_date": date_from,
            "end_date": date_to,
            "label": f"{date_from} t/m {date_to}",
        },
        "scope": response_scope,
        "summary": {
            "incoming_tickets": incoming_count,
            "closed_tickets": closed_count,
            "close_rate_pct": _safe_ratio_pct(closed_count, incoming_count),
            "open_delta": incoming_count - closed_count,
        },
        "service_levels": {
            "first_response_avg_hours": float(first_response_row[0]) if first_response_row[0] is not None else None,
            "first_response_p50_hours": float(first_response_row[1]) if first_response_row[1] is not None else None,
            "first_response_n": int(first_response_row[2] or 0),
            "resolution_avg_hours": float(resolution_row[0]) if resolution_row[0] is not None else None,
            "resolution_p50_hours": float(resolution_row[1]) if resolution_row[1] is not None else None,
            "resolution_n": int(resolution_row[2] or 0),
        },
        "alerts": {
            "total_events": alert_total,
            "by_kind": alert_by_kind,
        },
        "breakdowns": {
            "request_types": [{"name": r[0], "tickets": int(r[1] or 0)} for r in request_type_rows],
            "onderwerpen": [{"name": r[0], "tickets": int(r[1] or 0)} for r in onderwerp_rows],
            "priorities": [{"name": r[0], "tickets": int(r[1] or 0)} for r in priority_rows],
            "assignees": [{"name": r[0], "tickets": int(r[1] or 0)} for r in assignee_rows],
            "organizations": [{"name": r[0], "tickets": int(r[1] or 0)} for r in organization_rows],
        },
    }
    return payload


def _weekly_insights_pdf_lines(payload: Dict[str, Any]) -> List[str]:
    summary = payload.get("summary") or {}
    service_levels = payload.get("service_levels") or {}
    alerts = payload.get("alerts") or {}
    breakdowns = payload.get("breakdowns") or {}

    def _format_hours(v):
        if v is None:
            return "n.v.t."
        return f"{float(v):.1f} uur"

    lines = [
        "Weekly insights rapport",
        "",
        f"Periode: {payload.get('week', {}).get('label', '-')}",
        f"Scope: {payload.get('scope', '-')}",
        f"Gegenereerd op: {payload.get('generated_at', '-')}",
        "",
        "Samenvatting",
        f"- Binnengekomen tickets: {int(summary.get('incoming_tickets') or 0)}",
        f"- Afgesloten tickets: {int(summary.get('closed_tickets') or 0)}",
        f"- Sluitratio: {summary.get('close_rate_pct') if summary.get('close_rate_pct') is not None else 'n.v.t.'}%",
        f"- Open delta (in - uit): {int(summary.get('open_delta') or 0)}",
        "",
        "Service levels",
        f"- First response gemiddeld: {_format_hours(service_levels.get('first_response_avg_hours'))}",
        f"- First response mediaan: {_format_hours(service_levels.get('first_response_p50_hours'))}",
        f"- First response steekproef: {int(service_levels.get('first_response_n') or 0)}",
        f"- Resolution gemiddeld: {_format_hours(service_levels.get('resolution_avg_hours'))}",
        f"- Resolution mediaan: {_format_hours(service_levels.get('resolution_p50_hours'))}",
        f"- Resolution steekproef: {int(service_levels.get('resolution_n') or 0)}",
        "",
        "Alerts",
        f"- Totaal events: {int(alerts.get('total_events') or 0)}",
    ]
    for row in (alerts.get("by_kind") or []):
        lines.append(f"  - {row.get('kind')}: {int(row.get('events') or 0)}")

    def add_breakdown(title: str, rows: List[Dict[str, Any]]):
        lines.append("")
        lines.append(title)
        if not rows:
            lines.append("- Geen data")
            return
        for row in rows:
            lines.append(f"- {row.get('name')}: {int(row.get('tickets') or 0)}")

    add_breakdown("Top request types", breakdowns.get("request_types") or [])
    add_breakdown("Top onderwerpen", breakdowns.get("onderwerpen") or [])
    add_breakdown("Top priorities", breakdowns.get("priorities") or [])
    add_breakdown("Top assignees", breakdowns.get("assignees") or [])
    add_breakdown("Top organizations", breakdowns.get("organizations") or [])
    return lines


def ensure_schema():  # pragma: no cover
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
              issue_summary text,
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
              trigger_type text not null default 'manual',
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
              servicedesk_onderwerpen_customized boolean not null default false,
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
        cur.execute("alter table issues add column if not exists issue_summary text;")
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
        cur.execute("alter table sync_runs add column if not exists trigger_type text not null default 'manual';")
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
        cur.execute("alter table dashboard_config add column if not exists servicedesk_onderwerpen_customized boolean not null default false;")
        cur.execute("alter table dashboard_config add column if not exists updated_at timestamptz not null default now();")
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
        _seed_servicedesk_config_defaults(cur)
        c.commit()
    _schema_checked = True


def _seed_servicedesk_config_defaults(cur):
    cur.execute("insert into dashboard_config(id) values (1) on conflict (id) do nothing;")
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
                  and lower(onderwerp_logging) <> all(%s::text[])
                order by 1
              ) t
            ),
            servicedesk_onderwerpen_customized = false,
            updated_at = now()
        where id = 1
          and coalesce(array_length(servicedesk_team_members, 1), 0) = 0
          and coalesce(array_length(servicedesk_onderwerpen, 1), 0) = 0;
        """,
        (
            [name.lower() for name in DEFAULT_SERVICEDESK_TEAM_MEMBERS],
            list(DEFAULT_NON_SERVICEDESK_ONDERWERPEN_LOWER),
        ),
    )
    cur.execute(
        """
        update dashboard_config
        set servicedesk_onderwerpen = (
              select coalesce(array_agg(item.onderwerp order by item.ord), array[]::text[])
              from (
                select onderwerp, ord
                from unnest(servicedesk_onderwerpen) with ordinality as item(onderwerp, ord)
                where lower(onderwerp) <> all(%s::text[])
              ) item
            ),
            updated_at = now()
        where id = 1
          and exists (
            select 1
            from unnest(servicedesk_onderwerpen) as onderwerp
            where lower(onderwerp) = any(%s::text[])
          );
        """,
        (
            list(DEFAULT_NON_SERVICEDESK_ONDERWERPEN_LOWER),
            list(DEFAULT_NON_SERVICEDESK_ONDERWERPEN_LOWER),
        ),
    )


class VacationPayload(BaseModel):
    member_name: str
    start_date: str
    end_date: str


class ServicedeskConfigPayload(BaseModel):
    team_members: list[str]
    onderwerpen: list[str]


def _normalize_text_list(values):
    if not isinstance(values, list):
        return []
    out = []
    for v in values:
        text = str(v or "").strip()
        if text:
            out.append(text)
    return list(dict.fromkeys(out))


def _allowed_servicedesk_onderwerpen(cur):
    cur.execute(
        """
        select distinct btrim(onderwerp_logging) as onderwerp_logging
        from issues
        where onderwerp_logging is not null
          and btrim(onderwerp_logging) <> ''
          and lower(btrim(onderwerp_logging)) <> all(%s::text[])
        order by 1;
        """,
        (list(DEFAULT_NON_SERVICEDESK_ONDERWERPEN_LOWER),),
    )
    return [r[0] for r in cur.fetchall() if r and r[0]]


def _same_text_set(a, b):
    left = set(_normalize_text_list(a))
    right = set(_normalize_text_list(b))
    return left == right


def get_servicedesk_config():
    ensure_schema()
    with conn() as c, c.cursor() as cur:
        _seed_servicedesk_config_defaults(cur)
        cur.execute(
            """
            select servicedesk_team_members, servicedesk_onderwerpen, servicedesk_onderwerpen_customized, updated_at
            from dashboard_config
            where id = 1;
            """
        )
        row = cur.fetchone()
        allowed_onderwerpen = _allowed_servicedesk_onderwerpen(cur)
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
        return {
            "team_members": [],
            "onderwerpen": [],
            "onderwerpen_baseline": allowed_onderwerpen,
            "onderwerpen_customized": False,
            "updated_at": None,
            "team_member_avatars": {},
        }
    team_members = list(row[0] or [])
    stored_onderwerpen = list(row[1] or [])
    onderwerpen_customized = bool(row[2])
    avatar_map = {str(name): str(url) for name, url in avatar_rows if name and url}
    return {
        "team_members": team_members,
        "onderwerpen": stored_onderwerpen if onderwerpen_customized else allowed_onderwerpen,
        "onderwerpen_baseline": allowed_onderwerpen,
        "onderwerpen_customized": onderwerpen_customized,
        "updated_at": row[3].isoformat() if row[3] else None,
        "team_member_avatars": {name: avatar_map.get(name) for name in team_members if avatar_map.get(name)},
    }


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


def issue_metrics_filter_sql(
    *,
    request_type: Optional[str] = None,
    onderwerp: Optional[str] = None,
    priority: Optional[str] = None,
    assignee: Optional[str] = None,
    organization: Optional[str] = None,
    servicedesk_only: bool = False,
    alias: str = "",
    include_request_type: bool = True,
    organization_condition: Optional[str] = None,
):
    prefix = f"{alias}." if alias else ""
    if organization_condition is None:
        organization_condition = (
            f"({prefix}organizations is not null and {prefix}organizations @> array[%s]::text[])"
        )

    clauses = []
    params = []

    if include_request_type:
        clauses.append(f"(%s is null or {prefix}request_type = %s)")
        params.extend([request_type, request_type])

    clauses.append(f"(%s is null or {prefix}onderwerp_logging = %s)")
    params.extend([onderwerp, onderwerp])

    clauses.append(f"(%s is null or {prefix}priority = %s)")
    params.extend([priority, priority])

    clauses.append(f"(%s is null or {prefix}assignee = %s)")
    params.extend([assignee, assignee])

    clauses.append(f"(%s is null or {organization_condition})")
    params.extend([organization, organization])

    clauses.append(servicedesk_filter_clause(alias).strip())
    params.append(servicedesk_only)

    return "\n      and ".join(clauses), tuple(params)


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



def create_sync_run(mode: str, trigger_type: str = "manual") -> int:
    safe_trigger_type = str(trigger_type or "manual").strip().lower()
    if safe_trigger_type not in {"manual", "automatic"}:
        safe_trigger_type = "manual"
    with conn() as c, c.cursor() as cur:
        cur.execute(
            """
            insert into sync_runs(started_at, mode, trigger_type, success, upserts)
            values (now(), %s, %s, false, 0)
            returning id;
            """,
            (mode, safe_trigger_type),
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
            select started_at, finished_at, mode, trigger_type, success, upserts, set_last_sync, error
            from sync_runs
            order by started_at desc
            limit 10;
            """
        )
        recent_rows = cur.fetchall()
        recent_runs = [
            {
                "started_at": _to_utc_z(r[0]),
                "finished_at": _to_utc_z(r[1]),
                "mode": r[2],
                "trigger_type": r[3] or "manual",
                "success": bool(r[4]),
                "upserts": int(r[5] or 0),
                "set_last_sync": _to_utc_z(r[6]),
                "error": r[7],
            }
            for r in recent_rows
        ]

        cur.execute(
            """
            select started_at, finished_at, mode, trigger_type, upserts, set_last_sync
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
                "trigger_type": r[3] or "manual",
                "upserts": int(r[4] or 0),
                "set_last_sync": _to_utc_z(r[5]),
            }
            for r in successful_rows
        ]

        cur.execute(
            """
            select started_at, finished_at, mode, trigger_type, error
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
                "trigger_type": failed_row[3] or "manual",
                "message": failed_row[4],
            }

        cur.execute(
            """
            select started_at, finished_at, trigger_type, upserts, set_last_sync
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
                "trigger_type": full_row[2] or "manual",
                "upserts": int(full_row[3] or 0),
                "set_last_sync": _to_utc_z(full_row[4]),
            }

    return {
        "running": _sync_running,
        "last_run": _sync_last_run,
        "last_error": _sync_last_error,
        "last_result": _sync_last_result,
        "last_sync": _to_utc_z(last),
        "recent_runs": recent_runs,
        "successful_runs": successful_runs,
        "last_failed_run": last_failed_run,
        "last_full_sync": last_full_sync,
        "auto_sync": {
            "enabled": AUTO_SYNC_ENABLED,
            "incremental_interval_seconds": SYNC_INCREMENTAL_INTERVAL_SECONDS,
            "full_interval_hours": SYNC_FULL_INTERVAL_HOURS,
        },
    }


def jira_search(jql: str, max_results: int = 100, next_page_token: Optional[str] = None):
    payload = {
        "jql": jql,
        "maxResults": max_results,
        "fields": [
            "key",
            "summary",
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
    Completed/paused cycles should not drive live TTFR alerts.
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
    return dt.astimezone(timezone.utc)


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
    deleted_count = int(getattr(cur, "rowcount", 0) or 0)
    if deleted_count > 0:
        _insert_alert_logbook_event(cur, servicedesk_only=True, reason="AUTO_CLEANUP", removed_count=deleted_count)
        _insert_alert_logbook_event(cur, servicedesk_only=False, reason="AUTO_CLEANUP", removed_count=deleted_count)
    _last_alert_log_cleanup_at = now_ts


def _insert_alert_logbook_event(cur, servicedesk_only: bool, reason: str, removed_count: Optional[int] = None):
    # Use a unique synthetic key so each clear/cleanup action stays visible in the logbook.
    event_key = f"LOGBOOK-EVENT-{reason}-{int(time.time() * 1000)}"
    extra = f" ({int(removed_count)} verwijderd)" if removed_count is not None else ""
    cur.execute(
        """
        insert into alert_logs(issue_key, alert_kind, status, meta, status_key, meta_key, servicedesk_only, detected_at, logged_on)
        values (%s, %s, %s, %s, %s, %s, %s, now(), current_date);
        """,
        (
            event_key,
            "LOGBOOK_EVENT",
            reason,
            f"Het Alerts logboek is geleegd.{extra}",
            reason,
            reason,
            bool(servicedesk_only),
        ),
    )


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


def _teams_alert_kind_label(kind: Any) -> str:
    normalized = str(kind or "ALERT").strip().upper()
    if normalized in {"SLA_CRITICAL", "SLA_OVERDUE", "SLA_WARNING"}:
        return "SLA VERLOOPT"
    return normalized or "ALERT"


def _teams_alert_card(event: Dict[str, Any]) -> Dict[str, Any]:
    issue_key = str(event.get("issue_key") or "?")
    issue_summary = str(event.get("issue_summary") or "").strip() or "Geen titel beschikbaar"
    issue_url = str(event.get("issue_url") or f"{JIRA_BASE}/browse/{issue_key}")
    status_text = str(event.get("status") or "").strip() or "-"
    meta_text = str(event.get("meta") or "").strip() or "-"
    alert_label = _teams_alert_kind_label(event.get("alert_kind"))
    return {
        "$schema": "https://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.4",
        "msteams": {"width": "Full"},
        "body": [
            {
                "type": "TextBlock",
                "text": "DASHBOARD ALERTS",
                "weight": "Bolder",
                "size": "Large",
                "color": "Attention",
                "wrap": True,
            },
            {
                "type": "TextBlock",
                "text": "🚨 everyone",
                "spacing": "Small",
                "wrap": True,
            },
            {
                "type": "Container",
                "spacing": "Medium",
                "style": "attention",
                "bleed": True,
                "items": [
                    {
                        "type": "TextBlock",
                        "text": alert_label,
                        "weight": "Bolder",
                        "size": "Medium",
                        "wrap": True,
                    },
                    {
                        "type": "TextBlock",
                        "text": issue_key,
                        "weight": "Bolder",
                        "size": "ExtraLarge",
                        "wrap": True,
                        "spacing": "Small",
                    },
                    {
                        "type": "TextBlock",
                        "text": issue_summary,
                        "wrap": True,
                        "spacing": "Small",
                    },
                ],
            },
            {
                "type": "FactSet",
                "spacing": "Medium",
                "facts": [
                    {"title": "Status", "value": status_text},
                    {"title": "Urgentie", "value": meta_text},
                ],
            },
        ],
        "actions": [
            {
                "type": "Action.OpenUrl",
                "title": "Open in Jira",
                "url": issue_url,
            }
        ],
    }


def _send_teams_alert_notification(events):
    result = {"attempted": False, "ok": False, "status_code": None, "error": None}
    if not ALERT_TEAMS_WEBHOOK_URL or not events:
        return result
    try:
        result["attempted"] = True
        payload = {
            "type": "message",
            "attachments": [
                {
                    "contentType": "application/vnd.microsoft.card.adaptive",
                    "contentUrl": None,
                    "content": _teams_alert_card(events[0]),
                }
            ],
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
            issue_summary = str(f.get("summary") or "").strip() or None
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
                insert into issues(issue_key, issue_summary, request_type, onderwerp_logging, organizations, created_at, resolved_at, updated_at, priority, assignee, assignee_avatar_url, current_status, first_response_due_at)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                on conflict (issue_key) do update set
                  issue_summary=excluded.issue_summary,
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
                    issue_summary,
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
        _seed_servicedesk_config_defaults(cur)
        c.commit()



def run_sync_once(full: bool = False, trigger_type: str = "manual"):
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
        run_id = create_sync_run("full" if full else "incremental", trigger_type=trigger_type)
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


def _run_auto_sync_scheduler():
    if not AUTO_SYNC_ENABLED:
        return
    incremental_interval = timedelta(seconds=SYNC_INCREMENTAL_INTERVAL_SECONDS)
    full_interval = timedelta(hours=SYNC_FULL_INTERVAL_HOURS)

    last_incremental_started = datetime.now(timezone.utc) - incremental_interval
    last_full_started = datetime.now(timezone.utc) - full_interval

    while True:
        try:
            now = datetime.now(timezone.utc)
            full_due = now - last_full_started >= full_interval
            incremental_due = now - last_incremental_started >= incremental_interval
            if full_due or incremental_due:
                result = run_sync_once(full=full_due, trigger_type="automatic")
                if result.get("started"):
                    started_at = datetime.now(timezone.utc)
                    last_incremental_started = started_at
                    if full_due:
                        last_full_started = started_at
        except Exception:
            # Background scheduler must keep running even when a sync fails.
            pass
        time.sleep(5)


@app.on_event("startup")
def _startup_auto_sync_scheduler():
    global _auto_sync_scheduler_started
    if not AUTO_SYNC_ENABLED:
        return
    with _auto_sync_scheduler_lock:
        if _auto_sync_scheduler_started:
            return
        thread = threading.Thread(target=_run_auto_sync_scheduler, daemon=True, name="auto-sync-scheduler")
        thread.start()
        _auto_sync_scheduler_started = True


@app.get("/meta")
def meta():
    ensure_schema()
    with conn() as c, c.cursor() as cur:
        cur.execute("select distinct request_type from issues where request_type is not null order by 1;")
        request_types = [r[0] for r in cur.fetchall()]
        cur.execute(
            """
            select distinct btrim(onderwerp_logging)
            from issues
            where onderwerp_logging is not null
              and btrim(onderwerp_logging) <> ''
            order by 1;
            """
        )
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
        allowed_onderwerpen = _allowed_servicedesk_onderwerpen(cur)
        onderwerpen_customized = not _same_text_set(onderwerpen, allowed_onderwerpen)
        onderwerpen_to_save = onderwerpen if onderwerpen_customized else allowed_onderwerpen
        cur.execute(
            """
            update dashboard_config
            set servicedesk_team_members = %s,
                servicedesk_onderwerpen = %s,
                servicedesk_onderwerpen_customized = %s,
                updated_at = now()
            where id = 1;
            """,
            (team_members, onderwerpen_to_save, onderwerpen_customized),
        )
        c.commit()
    return get_servicedesk_config()


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
    filter_sql, filter_params = issue_metrics_filter_sql(
        request_type=request_type,
        onderwerp=onderwerp,
        priority=priority,
        assignee=assignee,
        organization=organization,
        servicedesk_only=servicedesk_only,
    )
    # nosemgrep: fixed SQL clauses are composed here; user values remain bound via execute params.
    q = """
    select
      date_trunc('week', created_at) as week,
      request_type,
      count(*) as tickets
    from issues
    where created_at >= %s::timestamptz and created_at < (%s::timestamptz + interval '1 day')
      and """ + filter_sql + """
    group by 1,2
    order by 1,2;
    """
    with conn() as c, c.cursor() as cur:
        cur.execute(q, (date_from, date_to, *filter_params))
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
    incoming_filter_sql, incoming_filter_params = issue_metrics_filter_sql(
        request_type=request_type,
        onderwerp=onderwerp,
        priority=priority,
        assignee=assignee,
        organization=organization,
        servicedesk_only=servicedesk_only,
    )
    closed_filter_sql, closed_filter_params = issue_metrics_filter_sql(
        request_type=request_type,
        onderwerp=onderwerp,
        priority=priority,
        assignee=assignee,
        organization=organization,
        servicedesk_only=servicedesk_only,
    )
    # nosemgrep: fixed SQL clauses are composed here; user values remain bound via execute params.
    q = """
    with incoming as (
      select
        date_trunc('week', created_at) as week,
        count(*) as incoming_count
      from issues
      where created_at >= %s::timestamptz and created_at < (%s::timestamptz + interval '1 day')
        and """ + incoming_filter_sql + """
      group by 1
    ),
    closed as (
      select
        date_trunc('week', resolved_at) as week,
        count(*) as closed_count
      from issues
      where resolved_at is not null
        and resolved_at >= %s::timestamptz and resolved_at < (%s::timestamptz + interval '1 day')
        and """ + closed_filter_sql + """
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
                *incoming_filter_params,
                date_from,
                date_to,
                *closed_filter_params,
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
    filter_sql, filter_params = issue_metrics_filter_sql(
        onderwerp=onderwerp,
        priority=priority,
        assignee=assignee,
        organization=organization,
        servicedesk_only=servicedesk_only,
        include_request_type=False,
    )
    # nosemgrep: fixed SQL clauses are composed here; user values remain bound via execute params.
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
      and """ + filter_sql + """
    group by 1
    order by p90_hours desc nulls last, 1;
    """
    with conn() as c, c.cursor() as cur:
        cur.execute(q, (date_from, date_to, *filter_params))
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
    filter_sql, filter_params = issue_metrics_filter_sql(
        request_type=request_type,
        onderwerp=onderwerp,
        priority=priority,
        assignee=assignee,
        organization=organization,
        servicedesk_only=servicedesk_only,
    )
    # nosemgrep: fixed SQL clauses are composed here; user values remain bound via execute params.
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
      and """ + filter_sql + """;
    """
    with conn() as c, c.cursor() as cur:
        cur.execute(q, (date_from, date_to, *filter_params))
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
    filter_sql, filter_params = issue_metrics_filter_sql(
        onderwerp=onderwerp,
        priority=priority,
        assignee=assignee,
        organization=organization,
        servicedesk_only=servicedesk_only,
        include_request_type=False,
    )
    # nosemgrep: fixed SQL clauses are composed here; user values remain bound via execute params.
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
      and """ + filter_sql + """
    group by 1,2
    order by 1,2;
    """
    with conn() as c, c.cursor() as cur:
        cur.execute(q, (date_from, date_to, *filter_params))
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
    filter_sql, filter_params = issue_metrics_filter_sql(
        onderwerp=onderwerp,
        priority=priority,
        assignee=assignee,
        organization=organization,
        servicedesk_only=servicedesk_only,
        include_request_type=False,
    )
    # nosemgrep: fixed SQL clauses are composed here; user values remain bound via execute params.
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
      and """ + filter_sql + """
    group by 1
    order by 1;
    """
    with conn() as c, c.cursor() as cur:
        cur.execute(q, (date_from, date_to, *filter_params))
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


@app.get("/metrics/ttfr_overdue_weekly")
def ttfr_overdue_weekly(
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
    filter_sql, filter_params = issue_metrics_filter_sql(
        request_type=request_type,
        onderwerp=onderwerp,
        priority=priority,
        assignee=assignee,
        organization=organization,
        servicedesk_only=servicedesk_only,
    )
    # nosemgrep: fixed SQL clauses are composed here; user values remain bound via execute params.
    q = """
    select
      date_trunc('week', first_response_due_at) as week,
      count(*) as tickets
    from issues
    where resolved_at is null
      and lower(coalesce(current_status, '')) = 'nieuwe melding'
      and first_response_due_at is not null
      and first_response_due_at < now()
      and first_response_due_at >= %s::timestamptz
      and first_response_due_at < (%s::timestamptz + interval '1 day')
      and """ + filter_sql + """
    group by 1
    order by 1;
    """
    with conn() as c, c.cursor() as cur:
        cur.execute(q, (date_from, date_to, *filter_params))
        rows = cur.fetchall()

    return [
        {
            "week": r[0].isoformat(),
            "tickets": int(r[1] or 0),
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
    filter_sql, filter_params = issue_metrics_filter_sql(
        request_type=request_type,
        onderwerp=onderwerp,
        priority=priority,
        assignee=assignee,
        organization=organization,
        servicedesk_only=servicedesk_only,
    )
    # nosemgrep: fixed SQL clauses are composed here; user values remain bound via execute params.
    q = """
    select
      priority,
      count(*) as tickets
    from issues
    where created_at >= %s::timestamptz and created_at < (%s::timestamptz + interval '1 day')
      and priority is not null
      and """ + filter_sql + """
    group by 1
    order by 2 desc, 1;
    """
    with conn() as c, c.cursor() as cur:
        cur.execute(q, (date_from, date_to, *filter_params))
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
    filter_sql, filter_params = issue_metrics_filter_sql(
        request_type=request_type,
        onderwerp=onderwerp,
        priority=priority,
        assignee=assignee,
        organization=organization,
        servicedesk_only=servicedesk_only,
    )
    # nosemgrep: fixed SQL clauses are composed here; user values remain bound via execute params.
    q = """
    select
      assignee,
      count(*) as tickets
    from issues
    where created_at >= %s::timestamptz and created_at < (%s::timestamptz + interval '1 day')
      and assignee is not null
      and """ + filter_sql + """
    group by 1
    order by 2 desc, 1;
    """
    with conn() as c, c.cursor() as cur:
        cur.execute(q, (date_from, date_to, *filter_params))
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
    filter_sql, filter_params = issue_metrics_filter_sql(
        request_type=request_type,
        onderwerp=onderwerp,
        priority=priority,
        assignee=assignee,
        organization=organization,
        servicedesk_only=servicedesk_only,
    )
    # nosemgrep: fixed SQL clauses are composed here; user values remain bound via execute params.
    q = """
    select
      date_trunc('week', created_at) as week,
      onderwerp_logging as onderwerp,
      count(*) as tickets
    from issues
    where created_at >= %s::timestamptz and created_at < (%s::timestamptz + interval '1 day')
      and """ + filter_sql + """
    group by 1,2
    order by 1,2;
    """
    with conn() as c, c.cursor() as cur:
        cur.execute(q, (date_from, date_to, *filter_params))
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
    filter_sql, filter_params = issue_metrics_filter_sql(
        request_type=request_type,
        onderwerp=onderwerp,
        priority=priority,
        assignee=assignee,
        organization=organization,
        servicedesk_only=servicedesk_only,
        alias="i",
        organization_condition="org.org_name = %s",
    )
    # nosemgrep: fixed SQL clauses are composed here; user values remain bound via execute params.
    q = """
    select
      date_trunc('week', i.created_at) as week,
      org.org_name as organization,
      count(*) as tickets
    from issues i
    cross join lateral unnest(i.organizations) as org(org_name)
    where i.created_at >= %s::timestamptz and i.created_at < (%s::timestamptz + interval '1 day')
      and """ + filter_sql + """
    group by 1,2
    order by 1,2;
    """
    with conn() as c, c.cursor() as cur:
        cur.execute(q, (date_from, date_to, *filter_params))
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
    filter_sql, filter_params = issue_metrics_filter_sql(
        request_type=request_type,
        onderwerp=onderwerp,
        priority=priority,
        assignee=assignee,
        organization=organization,
        servicedesk_only=servicedesk_only,
    )
    # nosemgrep: date column is selected from a validated allowlist and filter values stay parameterized.
    q = f"""
    select issue_key, request_type, onderwerp_logging, created_at, resolved_at, priority, assignee, current_status
    from issues
    where {date_column} >= %s::timestamptz and {date_column} < (%s::timestamptz + interval '1 day')
      {date_null_guard}
      and {filter_sql}
    order by {date_column} desc
    limit %s offset %s;
    """
    with conn() as c, c.cursor() as cur:
        cur.execute(q, (date_from, date_to, *filter_params, limit, offset))
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
    - first_response_due_warning: status 'Nieuwe melding' and SLA breach within 30 minutes
    - first_response_due_critical: status 'Nieuwe melding' and SLA breach within 5 minutes
    - first_response_overdue: not accepted yet ('Nieuwe melding') and SLA already breached
    """
    ensure_schema()
    servicedesk_only = True
    with conn() as c, c.cursor() as cur:
        cur.execute(
            """
            select issue_key, created_at, priority, current_status
                 , issue_summary
            from issues
            where created_at >= now() - interval '24 hours'
      and (
        not %s
        or (
          onderwerp_logging is not null
          and onderwerp_logging = any(coalesce((select servicedesk_onderwerpen from dashboard_config where id=1), array[]::text[]))
          and (
            assignee is null
            or assignee = any(coalesce((select servicedesk_team_members from dashboard_config where id=1), array[]::text[]))
          )
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
              greatest(0, ceil(extract(epoch from (first_response_due_at - now())) / 60.0))::int as minutes_left,
              issue_summary,
              current_status
            from issues
            where resolved_at is null
              and lower(coalesce(current_status, '')) = 'nieuwe melding'
              and first_response_due_at is not null
              and first_response_due_at > now() + make_interval(mins => %s)
              and first_response_due_at <= now() + make_interval(mins => %s)
      and (
        not %s
        or (
          onderwerp_logging is not null
          and onderwerp_logging = any(coalesce((select servicedesk_onderwerpen from dashboard_config where id=1), array[]::text[]))
          and (
            assignee is null
            or assignee = any(coalesce((select servicedesk_team_members from dashboard_config where id=1), array[]::text[]))
          )
        )
      )
            order by first_response_due_at asc
            limit 25;
            """,
            (SLA_CRITICAL_MINUTES, SLA_WARNING_MINUTES, servicedesk_only),
        )
        warning_rows = cur.fetchall()

        cur.execute(
            """
            select
              issue_key,
              first_response_due_at,
              greatest(0, ceil(extract(epoch from (first_response_due_at - now())) / 60.0))::int as minutes_left,
              issue_summary,
              current_status
            from issues
            where resolved_at is null
              and lower(coalesce(current_status, '')) = 'nieuwe melding'
              and first_response_due_at is not null
              and first_response_due_at >= now()
              and first_response_due_at <= now() + make_interval(mins => %s)
      and (
        not %s
        or (
          onderwerp_logging is not null
          and onderwerp_logging = any(coalesce((select servicedesk_onderwerpen from dashboard_config where id=1), array[]::text[]))
          and (
            assignee is null
            or assignee = any(coalesce((select servicedesk_team_members from dashboard_config where id=1), array[]::text[]))
          )
        )
      )
            order by first_response_due_at asc
            limit 25;
            """,
            (SLA_CRITICAL_MINUTES, servicedesk_only),
        )
        critical_rows = cur.fetchall()

        cur.execute(
            """
            select
              issue_key,
              first_response_due_at,
              ceil(extract(epoch from (now() - first_response_due_at)) / 60.0)::int as minutes_overdue,
              issue_summary,
              current_status
            from issues
            where resolved_at is null
              and lower(coalesce(current_status, '')) = 'nieuwe melding'
              and first_response_due_at is not null
              and first_response_due_at < now()
              and first_response_due_at >= now() - make_interval(hours => %s)
      and (
        not %s
        or (
          onderwerp_logging is not null
          and onderwerp_logging = any(coalesce((select servicedesk_onderwerpen from dashboard_config where id=1), array[]::text[]))
          and (
            assignee is null
            or assignee = any(coalesce((select servicedesk_team_members from dashboard_config where id=1), array[]::text[]))
          )
        )
      )
            order by first_response_due_at asc
            limit 25;
            """,
            (SLA_OVERDUE_MAX_AGE_HOURS, servicedesk_only),
        )
        overdue_rows = cur.fetchall()

    all_keys = [r[0] for r in p1_rows] + [r[0] for r in warning_rows] + [r[0] for r in critical_rows] + [r[0] for r in overdue_rows]
    existing_keys = _jira_existing_issue_keys(all_keys)

    priority_items = [
        {
            "issue_key": r[0],
            "created_at": r[1].isoformat() if r[1] else None,
            "priority": r[2],
            "status": r[3],
            "issue_summary": r[4],
        }
        for r in p1_rows
        if r[0] in existing_keys
    ]
    due_warning_items = [
        {
            "issue_key": r[0],
            "due_at": r[1].isoformat() if r[1] else None,
            "minutes_left": int(r[2] or 0),
            "issue_summary": r[3],
            "status": r[4],
        }
        for r in warning_rows
        if r[0] in existing_keys
    ]
    due_critical_items = [
        {
            "issue_key": r[0],
            "due_at": r[1].isoformat() if r[1] else None,
            "minutes_left": int(r[2] or 0),
            "issue_summary": r[3],
            "status": r[4],
        }
        for r in critical_rows
        if r[0] in existing_keys
    ]
    overdue_items = [
        {
            "issue_key": r[0],
            "due_at": r[1].isoformat() if r[1] else None,
            "minutes_overdue": int(r[2] or 0),
            "issue_summary": r[3],
            "status": r[4],
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
            "issue_summary": item.get("issue_summary"),
            "issue_url": f"{JIRA_BASE}/browse/{item['issue_key']}",
            "servicedesk_only": servicedesk_only,
        }
        for item in priority_items
    )
    log_events.extend(
        {
            "issue_key": item["issue_key"],
            "alert_kind": "SLA_WARNING",
            "status": item.get("status"),
            "meta": f"{int(item.get('minutes_left') or 0)} min",
            "issue_summary": item.get("issue_summary"),
            "issue_url": f"{JIRA_BASE}/browse/{item['issue_key']}",
            "servicedesk_only": servicedesk_only,
        }
        for item in due_warning_items
    )
    log_events.extend(
        {
            "issue_key": item["issue_key"],
            "alert_kind": "SLA_CRITICAL",
            "status": item.get("status"),
            "meta": f"{int(item.get('minutes_left') or 0)} min",
            "issue_summary": item.get("issue_summary"),
            "issue_url": f"{JIRA_BASE}/browse/{item['issue_key']}",
            "servicedesk_only": servicedesk_only,
        }
        for item in due_critical_items
    )
    log_events.extend(
        {
            "issue_key": item["issue_key"],
            "alert_kind": "SLA_OVERDUE",
            "status": item.get("status"),
            "meta": f"{int(item.get('minutes_overdue') or 0)} min te laat",
            "issue_summary": item.get("issue_summary"),
            "issue_url": f"{JIRA_BASE}/browse/{item['issue_key']}",
            "servicedesk_only": servicedesk_only,
        }
        for item in overdue_items
    )

    with conn() as c, c.cursor() as cur:
        _maybe_cleanup_alert_logs(cur)
        inserted_events = _persist_alert_log_events(cur, log_events)
        c.commit()
    teams_events = [e for e in inserted_events if e.get("alert_kind") in {"P1", "SLA_CRITICAL"}]
    _send_teams_alert_notification(teams_events)

    return {
        "priority1": priority_items,
        "first_response_due_soon": due_warning_items,
        "first_response_due_warning": due_warning_items,
        "first_response_due_critical": due_critical_items,
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


@app.post("/alerts/logs/clear")
def alerts_logs_clear(servicedesk_only: bool = True):
    ensure_schema()
    with conn() as c, c.cursor() as cur:
        cur.execute(
            """
            delete from alert_logs
            where servicedesk_only = %s;
            """,
            (servicedesk_only,),
        )
        _insert_alert_logbook_event(cur, servicedesk_only=servicedesk_only, reason="MANUAL_CLEAR")
        c.commit()
    return {"ok": True, "servicedesk_only": bool(servicedesk_only)}


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
              issue_summary,
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
            values (%s, %s, %s, %s, %s, now(), null, now(), %s, %s, null, %s, now() + interval '3 minutes')
            on conflict (issue_key) do update set
              issue_summary=excluded.issue_summary,
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
                "Dev alert testmelding",
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
                "issue_summary": "Dev alert testmelding",
                "issue_url": f"{JIRA_BASE}/browse/{DEV_ALERT_ISSUE_KEY}-NOTIFY",
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
    try:
        return get_sync_status_payload()
    except psycopg2.Error as exc:
        return JSONResponse(
            status_code=503,
            content={
                "ok": False,
                "error": "database_unavailable",
                "message": str(exc),
                "database": {
                    "host": PG_HOST,
                    "port": PG_PORT,
                    "name": PG_DB,
                },
            },
        )


@app.get("/status")
def status():
    try:
        return get_sync_status_payload()
    except psycopg2.Error as exc:
        return JSONResponse(
            status_code=503,
            content={
                "ok": False,
                "error": "database_unavailable",
                "message": str(exc),
                "database": {
                    "host": PG_HOST,
                    "port": PG_PORT,
                    "name": PG_DB,
                },
            },
        )


@app.post("/sync")
def sync(background_tasks: BackgroundTasks):
    # in background zodat je UI niet blokkeert
    background_tasks.add_task(run_sync_once, False, "manual")
    return {"queued": True}


@app.post("/sync/full")
def sync_full(background_tasks: BackgroundTasks):
    # full sync: negeer last_sync en haal alles opnieuw op
    background_tasks.add_task(run_sync_once, True, "manual")
    return {"queued": True, "mode": "full"}
