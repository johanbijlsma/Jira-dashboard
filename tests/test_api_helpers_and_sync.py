from datetime import date, datetime, timedelta, timezone
import re

import pytest
from fastapi.testclient import TestClient
from psycopg2 import sql as psycopg2_sql

import api


client = TestClient(api.app)


def _query_text(query):
    if isinstance(query, str):
        return query
    if isinstance(query, psycopg2_sql.SQL):
        return query.string
    if isinstance(query, psycopg2_sql.Composed):
        return "".join(_query_text(part) for part in query.seq)
    return str(query)


class CursorStub:
    def __init__(self, fetchall_values=None, fetchone_values=None):
        self.fetchall_values = list(fetchall_values or [])
        self.fetchone_values = list(fetchone_values or [])
        self.executed = []

    def execute(self, query, params=None):
        self.executed.append((query, params))
        if "delete from alert_logs" in _query_text(query).lower():
            self.rowcount = 1
        else:
            self.rowcount = 0

    def fetchall(self):
        if self.fetchall_values:
            return self.fetchall_values.pop(0)
        return []

    def fetchone(self):
        if self.fetchone_values:
            return self.fetchone_values.pop(0)
        return None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class ConnStub:
    def __init__(self, cursor):
        self._cursor = cursor
        self.committed = False

    def cursor(self):
        return self._cursor

    def commit(self):
        self.committed = True

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def patch_conn(monkeypatch, cursor):
    monkeypatch.setattr(api, "ensure_schema", lambda: None)
    monkeypatch.setattr(api, "conn", lambda: ConnStub(cursor))


def test_normalize_text_list_deduplicates_and_trims():
    assert api._normalize_text_list("x") == []
    assert api._normalize_text_list(["  A ", "", "A", None, "B"]) == ["A", "B"]


def test_issue_metrics_filter_sql_builds_default_conditions():
    sql, params = api.issue_metrics_filter_sql(
        request_type="Incident",
        onderwerp="Email",
        priority="High",
        assignee="Alice",
        organization="Org A",
        servicedesk_only=True,
    )

    assert "request_type = %s" in sql
    assert "and and" not in sql
    assert "onderwerp_logging = %s" in sql
    assert "priority = %s" in sql
    assert "assignee = %s" in sql
    assert "organizations @> array[%s]::text[]" in sql
    assert "servicedesk_onderwerpen" in sql
    assert "servicedesk_team_members" not in sql
    assert params == (
        "Incident",
        "Incident",
        "Email",
        "Email",
        "High",
        "High",
        "Alice",
        "Alice",
        "Org A",
        "Org A",
        True,
    )


def test_issue_metrics_filter_sql_supports_alias_and_custom_org_condition():
    sql, params = api.issue_metrics_filter_sql(
        onderwerp="Vraag",
        priority="Low",
        assignee="Bob",
        organization="Org B",
        servicedesk_only=False,
        alias="i",
        include_request_type=False,
        organization_condition="org.org_name = %s",
    )

    assert "i.request_type" not in sql
    assert "i.onderwerp_logging = %s" in sql
    assert "i.priority = %s" in sql
    assert "i.assignee = %s" in sql
    assert "org.org_name = %s" in sql
    assert "i.onderwerp_logging = any" in sql
    assert "i.assignee = any" not in sql
    assert params == (
        "Vraag",
        "Vraag",
        "Low",
        "Low",
        "Bob",
        "Bob",
        "Org B",
        "Org B",
        False,
    )


def test_backend_cors_origin_regex_allows_tailscale_hosts():
    pattern = re.compile(api.BACKEND_CORS_ORIGIN_REGEX)

    assert pattern.match("http://johans-macbook-air.tail920595.ts.net:3000")
    assert pattern.match("http://100.108.229.18:3000")
    assert not pattern.match("http://example.com:3000")


def test_insight_metric_payload_prefixes_filters_with_and(monkeypatch):
    cursor = CursorStub(fetchall_values=[[], [], [], [], []])
    patch_conn(monkeypatch, cursor)

    api._insight_metric_payload(
        date_from="2026-03-02",
        date_to="2026-03-30",
        request_type=None,
        onderwerp=None,
        priority=None,
        assignee=None,
        organization=None,
        servicedesk_only=True,
    )

    executed_sql = [_query_text(query) for query, _ in cursor.executed]

    assert any("and (%s is null or request_type = %s)" in query for query in executed_sql)
    assert any("and (%s is null or onderwerp_logging = %s)" in query for query in executed_sql)
    assert all("\n              (%" not in query for query in executed_sql)


def test_get_ai_insights_persists_candidates_and_commits(monkeypatch):
    cursor = CursorStub()
    connection = ConnStub(cursor)

    monkeypatch.setattr(api, "conn", lambda: connection)
    monkeypatch.setattr(api, "get_servicedesk_config", lambda: {"ai_insight_threshold_pct": 88})
    monkeypatch.setattr(api, "_insight_metric_payload", lambda **kwargs: {"inflow_vs_closed": []})
    monkeypatch.setattr(api, "_create_ai_insight_candidates", lambda metrics: [{"title": "Check volume"}])
    monkeypatch.setattr(api, "_cleanup_ai_insights", lambda cur: None)
    monkeypatch.setattr(
        api,
        "_persist_ai_insights",
        lambda cur, scope_key, candidates, threshold_pct: [
            {"scope_key": scope_key, "threshold_pct": threshold_pct, "count": len(candidates)}
        ],
    )

    payload = api.get_ai_insights(
        date_from="2026-03-02",
        date_to="2026-03-30",
        request_type="Incident",
        onderwerp="Email",
        priority="High",
        assignee="Johan",
        organization="Org A",
        servicedesk_only=True,
    )

    assert payload == {
        "threshold_pct": 88,
        "max_active": api.MAX_ACTIVE_AI_INSIGHTS,
        "ttl_hours": api.AI_INSIGHT_TTL_HOURS,
        "items": [
            {
                "scope_key": "2026-03-02|2026-03-30|Incident|Email|High|Johan|Org A|1",
                "threshold_pct": 88,
                "count": 1,
            }
        ],
    }
    assert connection.committed is True


def _insight_row(*, row_id=1, expires_at=None, feedback_status="pending", removed_at=None):
    detected_at = datetime(2026, 4, 1, 10, 0, tzinfo=timezone.utc)
    if expires_at is None:
        expires_at = detected_at + timedelta(hours=api.AI_INSIGHT_TTL_HOURS)
    return (
        row_id,
        "scope|kind|card|2026-04-01|label",
        "AI-signaal",
        "Samenvatting",
        None,
        "onderwerp_spike",
        "onderwerp",
        82.0,
        34.6,
        detected_at,
        expires_at,
        {"current": {"month_start": "2026-04-01", "tickets": 35}, "previous": {"month_start": "2026-03-01", "tickets": 26}},
        feedback_status,
        None,
        None,
        removed_at,
    )


def test_persist_ai_insights_keeps_expired_items_out_of_live_results(monkeypatch):
    now = datetime(2026, 4, 3, 12, 0, tzinfo=timezone.utc)
    cursor = CursorStub(fetchone_values=[_insight_row(expires_at=now - timedelta(minutes=1))])

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return now if tz else now.replace(tzinfo=None)

    monkeypatch.setattr(api, "datetime", FrozenDateTime)

    items = api._persist_ai_insights(
        cursor,
        scope_key="scope",
        candidates=[
            {
                "kind": "onderwerp_spike",
                "target_card_key": "onderwerp",
                "title": "AI-signaal",
                "summary": "Samenvatting",
                "score_pct": 82,
                "deviation_pct": 34.6,
                "source_payload": {"current": {"month_start": "2026-04-01"}, "label": "Rapportages"},
            }
        ],
        threshold_pct=75,
    )

    assert items == []
    executed_sql = _query_text(cursor.executed[0][0]).lower()
    assert "expires_at = excluded.expires_at" not in executed_sql


def test_persist_ai_insights_returns_unexpired_items(monkeypatch):
    now = datetime(2026, 4, 3, 12, 0, tzinfo=timezone.utc)
    cursor = CursorStub(fetchone_values=[_insight_row(expires_at=now + timedelta(hours=2), feedback_status="upvoted")])

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return now if tz else now.replace(tzinfo=None)

    monkeypatch.setattr(api, "datetime", FrozenDateTime)

    items = api._persist_ai_insights(
        cursor,
        scope_key="scope",
        candidates=[
            {
                "kind": "onderwerp_spike",
                "target_card_key": "onderwerp",
                "title": "AI-signaal",
                "summary": "Samenvatting",
                "score_pct": 82,
                "deviation_pct": 34.6,
                "source_payload": {"current": {"month_start": "2026-04-01"}, "label": "Rapportages"},
            }
        ],
        threshold_pct=75,
    )

    assert len(items) == 1
    assert items[0]["feedback_status"] == "upvoted"


def test_startup_auto_sync_scheduler_only_starts_once(monkeypatch):
    started = []

    class ThreadStub:
        def __init__(self, *, target, daemon, name):
            self.target = target
            self.daemon = daemon
            self.name = name

        def start(self):
            started.append((self.target, self.daemon, self.name))

    monkeypatch.setattr(api, "AUTO_SYNC_ENABLED", True)
    monkeypatch.setattr(api, "_auto_sync_scheduler_started", False)
    monkeypatch.setattr(api.threading, "Thread", ThreadStub)

    api._startup_auto_sync_scheduler()
    api._startup_auto_sync_scheduler()

    assert started == [(api._run_auto_sync_scheduler, True, "auto-sync-scheduler")]
    assert api._auto_sync_scheduler_started is True
    monkeypatch.setattr(api, "_auto_sync_scheduler_started", False)


def test_insights_live_delegates_to_get_ai_insights(monkeypatch):
    captured = {}

    def fake_get_ai_insights(**kwargs):
        captured.update(kwargs)
        return {"items": []}

    monkeypatch.setattr(api, "get_ai_insights", fake_get_ai_insights)

    payload = api.insights_live(
        date_from="2026-03-02",
        date_to="2026-03-30",
        request_type="Incident",
        onderwerp="Email",
        priority="High",
        assignee="Johan",
        organization="Org A",
        servicedesk_only=True,
    )

    assert payload == {"items": []}
    assert captured == {
        "date_from": "2026-03-02",
        "date_to": "2026-03-30",
        "request_type": "Incident",
        "onderwerp": "Email",
        "priority": "High",
        "assignee": "Johan",
        "organization": "Org A",
        "servicedesk_only": True,
    }


def test_monthly_onderwerp_spike_gets_bonus_for_small_but_clear_growth():
    candidates = api._create_ai_insight_candidates(
        {
            "inflow_vs_closed": [],
            "ttfr_overdue": [],
            "incident_resolution": [],
            "onderwerp_volume": [
                {"month_start": "2026-02-01T00:00:00+01:00", "onderwerp": "Datalek", "tickets": 2},
                {"month_start": "2026-03-01T00:00:00+01:00", "onderwerp": "Datalek", "tickets": 3},
            ],
            "organization_volume": [],
            "priority1_monthly": [],
        }
    )

    onderwerp_candidate = next(item for item in candidates if item["kind"] == "onderwerp_spike")
    assert onderwerp_candidate["score_pct"] == 81.0
    assert onderwerp_candidate["source_payload"]["confidence"]["threshold_bonus"] == 12.0
    assert onderwerp_candidate["source_payload"]["comparison_label"] == "Maand-op-maand"


def test_monthly_partner_spike_stays_below_threshold_when_growth_is_still_modest():
    candidates = api._create_ai_insight_candidates(
        {
            "inflow_vs_closed": [],
            "ttfr_overdue": [],
            "incident_resolution": [],
            "onderwerp_volume": [],
            "organization_volume": [
                {"month_start": "2026-02-01T00:00:00+01:00", "organization": "VitaMee", "tickets": 3},
                {"month_start": "2026-03-01T00:00:00+01:00", "organization": "VitaMee", "tickets": 4},
            ],
            "priority1_monthly": [],
        }
    )

    partner_candidate = next(item for item in candidates if item["kind"] == "organization_spike")
    assert partner_candidate["score_pct"] == 73.5
    assert partner_candidate["source_payload"]["confidence"]["threshold_bonus"] == 12.0


def test_priority1_year_trend_candidate_uses_last_12_months():
    rows = [
        {"month_start": f"2024-{month:02d}-01T00:00:00+01:00", "tickets": 1}
        for month in range(1, 13)
    ] + [
        {"month_start": f"2025-{month:02d}-01T00:00:00+01:00", "tickets": 2}
        for month in range(1, 13)
    ]
    candidates = api._create_ai_insight_candidates(
        {
            "inflow_vs_closed": [],
            "ttfr_overdue": [],
            "incident_resolution": [],
            "onderwerp_volume": [],
            "organization_volume": [],
            "priority1_monthly": rows,
        }
    )

    trend_candidate = next(item for item in candidates if item["kind"] == "priority1_year_trend")
    assert trend_candidate["target_card_key"] == "priority"
    assert trend_candidate["score_pct"] >= 90.0
    assert trend_candidate["source_payload"]["comparison_label"] == "12 maanden trend"


def test_weekly_insights_payload_uses_onderwerp_based_servicedesk_scope(monkeypatch):
    cursor = CursorStub(
        fetchall_values=[
            [("Incident", 2)],
            [("Koppelingen", 2)],
            [("P1", 2)],
            [("Johan", 2)],
            [("Org A", 2)],
            [("priority1", 1)],
        ],
        fetchone_values=[
            (5, 3),
            (1.5, 1.0, 2),
            (4.0, 3.5, 2),
        ],
    )
    patch_conn(monkeypatch, cursor)
    monkeypatch.setattr(
        api,
        "_previous_full_week_range",
        lambda now_utc=None: (date(2026, 2, 16), date(2026, 2, 22)),
    )

    payload = api._weekly_insights_payload(servicedesk_only=True)

    assert payload["scope"] == "alleen servicedesk"
    issue_queries = [_query_text(query) for query, _params in cursor.executed if "from issues" in _query_text(query).lower()]
    assert issue_queries
    assert any("servicedesk_onderwerpen" in query for query in issue_queries)
    assignee_queries = [query for query in issue_queries if "select assignee, count(*) as tickets" in query.lower()]
    assert assignee_queries
    assert any("servicedesk_team_members" in query for query in assignee_queries)


def test_ensure_schema_filters_non_servicedesk_onderwerpen_case_insensitive(monkeypatch):
    cursor = CursorStub()
    monkeypatch.setattr(api, "conn", lambda: ConnStub(cursor))
    monkeypatch.setattr(api, "_schema_checked", False)

    api.ensure_schema()

    onderwerp_seed_updates = [
        params
        for query, params in cursor.executed
        if "lower(onderwerp_logging) <> all" in query
    ]
    assert onderwerp_seed_updates
    assert set(onderwerp_seed_updates[0][1]) == api.DEFAULT_NON_SERVICEDESK_ONDERWERPEN_LOWER

    config_cleanup_updates = [
        params
        for query, params in cursor.executed
        if "unnest(servicedesk_onderwerpen) with ordinality" in query
    ]
    assert config_cleanup_updates
    assert set(config_cleanup_updates[0][0]) == api.DEFAULT_NON_SERVICEDESK_ONDERWERPEN_LOWER
    assert set(config_cleanup_updates[0][1]) == api.DEFAULT_NON_SERVICEDESK_ONDERWERPEN_LOWER
    assert cursor.executed
    monkeypatch.setattr(api, "_schema_checked", False)


def test_allowed_servicedesk_onderwerpen_trims_whitespace(monkeypatch):
    cursor = CursorStub(fetchall_values=[[("Performance",), ("Vraag",)]])

    onderwerpen = api._allowed_servicedesk_onderwerpen(cursor)

    assert onderwerpen == ["Performance", "Vraag"]
    query, params = cursor.executed[0]
    assert "btrim(onderwerp_logging)" in query
    assert params == (list(api.DEFAULT_NON_SERVICEDESK_ONDERWERPEN_LOWER),)


def test_get_servicedesk_scope_returns_normalized_values(monkeypatch):
    cursor = CursorStub(fetchone_values=[([" Johan ", "", "Ashley"], [" Koppelingen ", None, "Koppelingen"])])
    monkeypatch.setattr(api, "_seed_servicedesk_config_defaults", lambda cur: None)

    team_members, onderwerpen = api._get_servicedesk_scope(cursor)

    assert team_members == ["Johan", "Ashley"]
    assert onderwerpen == ["Koppelingen"]


def test_get_servicedesk_scope_falls_back_to_empty_lists(monkeypatch):
    cursor = CursorStub(fetchone_values=[(1,)])
    monkeypatch.setattr(api, "_seed_servicedesk_config_defaults", lambda cur: None)

    team_members, onderwerpen = api._get_servicedesk_scope(cursor)

    assert team_members == []
    assert onderwerpen == []


def test_parse_iso_date_or_raise_success_and_error():
    assert api._parse_iso_date_or_raise("2026-02-25", "start_date").isoformat() == "2026-02-25"
    with pytest.raises(ValueError, match="Ongeldige datum"):
        api._parse_iso_date_or_raise("25-02-2026", "start_date")


def test_validate_vacation_payload_branches(monkeypatch):
    monkeypatch.setattr(api, "get_servicedesk_config", lambda: {"team_members": ["Johan"]})

    with pytest.raises(ValueError, match="Onbekend teamlid"):
        api._validate_vacation_payload(
            api.VacationPayload(member_name="X", start_date="2099-07-10", end_date="2099-07-11")
        )

    yesterday = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
    with pytest.raises(ValueError, match="vandaag of later"):
        api._validate_vacation_payload(
            api.VacationPayload(member_name="Johan", start_date=yesterday, end_date=yesterday)
        )

    tomorrow = (datetime.now(timezone.utc).date() + timedelta(days=1)).isoformat()
    day_after = (datetime.now(timezone.utc).date() + timedelta(days=2)).isoformat()
    assert api._validate_vacation_payload(
        api.VacationPayload(member_name="Johan", start_date=tomorrow, end_date=day_after)
    ) == ("Johan", date.fromisoformat(tomorrow), date.fromisoformat(day_after))


def test_weekly_range_ratio_pdf_escape_and_pdf_builder():
    week_start, week_end = api._previous_full_week_range(datetime(2026, 3, 18, 12, 0, tzinfo=timezone.utc))

    assert week_start.isoformat() == "2026-03-09"
    assert week_end.isoformat() == "2026-03-15"
    assert api._safe_ratio_pct(3, 4) == 75.0
    assert api._safe_ratio_pct(1, 0) is None
    assert api._pdf_escape(r"Test \(demo)") == r"Test \\\(demo\)"

    pdf = api._build_text_pdf(["Regel 1", "Regel 2"])

    assert pdf.startswith(b"%PDF-1.4")
    assert b"Regel 1" in pdf
    assert b"Regel 2" in pdf
    assert b"%%EOF" in pdf


def test_weekly_insights_pdf_lines_formats_breakdowns_and_empty_states():
    lines = api._weekly_insights_pdf_lines(
        {
            "generated_at": "2026-03-20T10:00:00Z",
            "week": {"label": "2026-03-09 t/m 2026-03-15"},
            "scope": "alleen servicedesk",
            "summary": {
                "incoming_tickets": 12,
                "closed_tickets": 9,
                "close_rate_pct": 75.0,
                "open_delta": 3,
            },
            "service_levels": {
                "first_response_avg_hours": 1.5,
                "first_response_p50_hours": None,
                "first_response_n": 6,
                "resolution_avg_hours": 8.25,
                "resolution_p50_hours": 7.0,
                "resolution_n": 4,
            },
            "alerts": {
                "total_events": 5,
                "by_kind": [{"kind": "ttr_overdue", "events": 2}],
            },
            "breakdowns": {
                "request_types": [{"name": "Incident", "tickets": 4}],
                "onderwerpen": [],
                "priorities": [{"name": "High", "tickets": 3}],
                "assignees": [{"name": "Alice", "tickets": 2}],
                "organizations": [{"name": "Org A", "tickets": 1}],
            },
        }
    )

    assert "Weekly insights rapport" in lines
    assert "Periode: 2026-03-09 t/m 2026-03-15" in lines
    assert "Scope: alleen servicedesk" in lines
    assert "Gegenereerd op: 20-03-2026 11:00" in lines
    assert "- Sluitratio: 75.0%" in lines
    assert "- First response gemiddeld: 1.5 uur" in lines
    assert "- First response mediaan: n.v.t." in lines
    assert "  - TTR verlopen: 2" in lines
    assert "Top onderwerpen" in lines
    assert "- Geen data" in lines
    assert "- Incident: 4" in lines
    assert "- Alice: 2" in lines


def test_to_utc_z_with_none_naive_and_aware():
    assert api._to_utc_z(None) is None
    assert api._to_utc_z(datetime(2026, 2, 25, 10, 0, 0)) == "2026-02-25T10:00:00Z"
    aware = datetime(2026, 2, 25, 11, 0, 0, tzinfo=timezone(timedelta(hours=1)))
    assert api._to_utc_z(aware) == "2026-02-25T10:00:00Z"


def test_jira_datetime_parsing_and_formatting():
    assert api.parse_jira_datetime(None) is None
    assert api.parse_jira_datetime("invalid") is None
    parsed = api.parse_jira_datetime("2026-02-25T10:00:00.123+0000")
    assert parsed is not None
    parsed2 = api.parse_jira_datetime("2026-02-25T10:00:00+0000")
    assert parsed2 is not None
    dt = datetime(2026, 2, 25, 11, 30, tzinfo=timezone(timedelta(hours=1)))
    assert api.format_jql_datetime(dt) == "2026-02-25 10:30"


def test_jira_search_includes_next_page_token(monkeypatch):
    seen = {}

    class _Resp:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {"issues": [], "isLast": True}

    def fake_post(url, json, timeout):
        seen["url"] = url
        seen["json"] = json
        seen["timeout"] = timeout
        return _Resp()

    monkeypatch.setattr(api._jira, "post", fake_post)

    api.jira_search("project = SD", max_results=25, next_page_token="token-123")

    assert seen["json"]["nextPageToken"] == "token-123"
    assert seen["json"]["maxResults"] == 25


def test_normalizers_and_priority_helpers(monkeypatch):
    assert api.norm_request_type({"requestType": {"name": "Incident"}}) == "Incident"
    assert api.norm_request_type({}) is None
    assert api.norm_dropdown({"value": "X"}) == "X"
    assert api.norm_dropdown({"name": "Y"}) == "Y"
    assert api.norm_dropdown(5) == "5"
    assert api.norm_assignee({"displayName": "Johan"}) == "Johan"
    assert api.norm_assignee({"emailAddress": "a@b"}) == "a@b"
    assert api.norm_assignee({"accountId": "abc"}) == "abc"
    assert api.norm_assignee(None) is None
    assert api.norm_assignee_avatar_url({"avatarUrls": {"32x32": "u"}}) == "u"
    assert api.norm_assignee_avatar_url({"avatarUrls": "invalid"}) is None
    assert api.norm_assignee_avatar_url({}) is None
    assert api.norm_organizations(None) == []
    assert api.norm_organizations([{"name": "A"}, {"value": "B"}, {"title": "C"}, "A"]) == ["A", "B", "C"]

    dt = api.norm_first_response_due_at(
        {"ongoingCycle": {"breachTime": {"iso8601": "2026-02-25T12:00:00+0200"}}}
    )
    assert dt.isoformat() == "2026-02-25T10:00:00+00:00"
    dt2 = api.norm_time_to_resolution_due_at(
        {"ongoingCycle": {"breachTime": {"iso8601": "2026-02-26T11:15:00+0100"}}}
    )
    assert dt2.isoformat() == "2026-02-26T10:15:00+00:00"
    assert api.norm_time_to_resolution_due_at({"ongoingCycle": {"breachTime": {"iso8601": "invalid"}}}) is None
    assert api.norm_first_response_due_at(
        {
            "completedCycles": [
                {"breachTime": {"iso8601": "2026-02-25T09:00:00+0000"}},
                {"breachTime": {"iso8601": "2026-02-25T10:30:00+0000"}},
            ]
        }
    ) is None
    assert api.norm_first_response_due_at({"ongoingCycle": {"breachTime": {}}}) is None

    monkeypatch.setattr(api, "ALERT_P1_PRIORITIES", ["kritiek"])
    assert api.is_priority1_priority("Kritiek") is True
    assert api.is_priority1_priority("P1 melding") is True
    assert api.is_priority1_priority("Prioriteit 1") is True
    assert api.is_priority1_priority("level 1") is False
    assert api.is_priority1_priority("normaal") is False

    monkeypatch.setattr(api, "ALERT_P1_ACTIVE_STATUSES", ["nieuwe melding"])
    assert api.is_priority1_alert_status("Nieuwe melding") is True
    assert api.is_priority1_alert_status("Open") is False
    assert api.is_priority1_alert_status("In behandeling") is False
    assert api.is_priority1_alert_status("Development") is False


def test_jira_search_with_retry(monkeypatch):
    class Resp:
        def __init__(self, status, payload=None, headers=None):
            self.status_code = status
            self._payload = payload or {}
            self.headers = headers or {}

        def raise_for_status(self):
            if self.status_code >= 400 and self.status_code != 429:
                raise RuntimeError("http")

        def json(self):
            return self._payload

    calls = []
    responses = [
        Resp(429, headers={"Retry-After": "0"}),
        Resp(200, payload={"issues": [{"key": "SD-1"}], "isLast": True}),
    ]

    def fake_post(_url, json, timeout):
        calls.append(json)
        return responses.pop(0)

    monkeypatch.setattr(api._jira, "post", fake_post)
    monkeypatch.setattr(api.time, "sleep", lambda _s: None)

    result = api.jira_search("project = SD")
    assert result["issues"][0]["key"] == "SD-1"
    assert len(calls) == 2
    assert "summary" in calls[0]["fields"]


def test_fetch_release_calendar_rows_uses_sprint_start(monkeypatch):
    monkeypatch.setattr(api, "RELEASE_MANUAL_DATES_RAW", "")
    monkeypatch.setattr(api, "_resolve_release_sprint_board_id", lambda: 12)
    monkeypatch.setattr(
        api,
        "jira_agile_get",
        lambda path, params=None: {
            "values": [
                {"id": 186, "name": "Sprint 186", "startDate": "2026-03-11T08:30:00.000+0100"},
                {"id": 187, "name": "Sprint 187", "startDate": "2026-03-25T08:30:00.000+0100"},
            ],
            "isLast": True,
        },
    )

    rows = api._fetch_release_calendar_rows()

    assert rows == [
        {
            "sprint_id": 186,
            "board_id": 12,
            "sprint_name": "Sprint 186",
            "sprint_start_date": date(2026, 3, 11),
            "release_date": date(2026, 3, 10),
            "followup_date": date(2026, 3, 11),
        },
        {
            "sprint_id": 187,
            "board_id": 12,
            "sprint_name": "Sprint 187",
            "sprint_start_date": date(2026, 3, 25),
            "release_date": date(2026, 3, 24),
            "followup_date": date(2026, 3, 25),
        },
    ]


def test_manual_release_calendar_rows_take_precedence(monkeypatch):
    monkeypatch.setattr(api, "RELEASE_MANUAL_DATES_RAW", "2026-01-13,2026-01-30,2026-02-24")

    rows = api._fetch_release_calendar_rows()

    assert rows == [
        {
            "sprint_id": -1,
            "board_id": 0,
            "sprint_name": "Release 2026-01-13",
            "sprint_start_date": date(2026, 1, 14),
            "release_date": date(2026, 1, 13),
            "followup_date": date(2026, 1, 14),
        },
        {
            "sprint_id": -2,
            "board_id": 0,
            "sprint_name": "Release 2026-01-30",
            "sprint_start_date": date(2026, 1, 31),
            "release_date": date(2026, 1, 30),
            "followup_date": date(2026, 1, 31),
        },
        {
            "sprint_id": -3,
            "board_id": 0,
            "sprint_name": "Release 2026-02-24",
            "sprint_start_date": date(2026, 2, 25),
            "release_date": date(2026, 2, 24),
            "followup_date": date(2026, 2, 25),
        },
    ]


def test_jira_existing_issue_keys_paths(monkeypatch):
    api._issue_existence_cache.clear()
    assert api._jira_existing_issue_keys([]) == set()

    monkeypatch.setattr(api, "JIRA_EMAIL", None)
    monkeypatch.setattr(api, "JIRA_TOKEN", None)
    assert api._jira_existing_issue_keys(["SD-1", "SD-2"]) == {"SD-1", "SD-2"}

    monkeypatch.setattr(api, "JIRA_EMAIL", "x")
    monkeypatch.setattr(api, "JIRA_TOKEN", "y")

    calls = []

    def fake_search(_jql, max_results=100, next_page_token=None):
        calls.append((max_results, next_page_token))
        return {"issues": [{"key": "SD-1"}]}

    monkeypatch.setattr(api, "jira_search", fake_search)
    keys = api._jira_existing_issue_keys(["SD-1", "SD-2"])
    assert keys == {"SD-1"}
    assert len(calls) == 1

    cached = api._jira_existing_issue_keys(["SD-1", "SD-2"])
    assert cached == {"SD-1"}
    assert len(calls) == 1


def test_upsert_issues_executes_insert(monkeypatch):
    cursor = CursorStub()
    patch_conn(monkeypatch, cursor)
    monkeypatch.setattr(api, "TIME_TO_RESOLUTION_SLA_FIELD", "customfield_ttr")
    issue = {
        "key": "SD-1",
        "fields": {
            "summary": "Voorbeeldtitel",
            api.REQUEST_TYPE_FIELD: {"requestType": {"name": "Vraag"}},
            api.ONDERWERP_FIELD: {"value": "Koppelingen"},
            api.ORGANIZATION_FIELD: [{"name": "Org A"}],
            api.FIRST_RESPONSE_SLA_FIELD: {"ongoingCycle": {"breachTime": {"iso8601": "2026-02-25T10:00:00+0000"}}},
            api.TIME_TO_RESOLUTION_SLA_FIELD: {"ongoingCycle": {"breachTime": {"iso8601": "2026-02-26T10:00:00+0000"}}},
            "created": "2026-02-24T10:00:00+0000",
            "updated": "2026-02-25T10:00:00+0000",
            "resolutiondate": None,
            "status": {"name": "Nieuwe melding"},
            "priority": {"name": "P1"},
            "assignee": {"displayName": "Johan", "avatarUrls": {"48x48": "http://img"}},
        },
    }
    api.upsert_issues([issue])
    insert_queries = [(query, params) for query, params in cursor.executed if "insert into issues" in query.lower()]
    assert len(insert_queries) == 1
    params = insert_queries[0][1]
    assert params[0] == "SD-1"
    assert params[1] == "Voorbeeldtitel"
    assert params[2] == "Vraag"
    assert params[3] == "Koppelingen"
    assert params[4] == ["Org A"]
    assert params[9] == "Johan"
    assert params[10] == "http://img"
    assert params[13].isoformat() == "2026-02-26T10:00:00+00:00"


def test_run_sync_once_branches(monkeypatch):
    monkeypatch.setattr(api, "JIRA_EMAIL", "x")
    monkeypatch.setattr(api, "JIRA_TOKEN", "y")
    monkeypatch.setattr(api, "ensure_schema", lambda: None)
    monkeypatch.setattr(api, "create_sync_run", lambda mode, trigger_type="manual": 10)
    monkeypatch.setattr(api, "get_last_sync", lambda: None)

    upsert_calls = []
    monkeypatch.setattr(api, "upsert_issues", lambda batch: upsert_calls.append(len(batch)))
    set_last_sync_calls = []
    monkeypatch.setattr(api, "set_last_sync", lambda ts: set_last_sync_calls.append(ts))
    monkeypatch.setattr(api, "_refresh_release_calendar", lambda cur: None)
    monkeypatch.setattr(api, "_refresh_release_workload_snapshots", lambda cur: None)
    patch_conn(monkeypatch, CursorStub())
    complete_calls = []
    monkeypatch.setattr(api, "complete_sync_run_success", lambda rid, upserts, ts: complete_calls.append((rid, upserts, ts)))
    monkeypatch.setattr(api, "complete_sync_run_error", lambda rid, err: complete_calls.append(("err", rid, err)))
    monkeypatch.setattr(
        api,
        "jira_search",
        lambda _jql, max_results=100, next_page_token=None: {
            "issues": [{"fields": {"updated": "2026-02-25T10:00:00+0000"}}],
            "isLast": True,
        },
    )

    api._sync_running = False
    api._sync_last_error = None
    api._sync_last_result = None
    result = api.run_sync_once()
    assert result == {"started": True, "upserts": 1}
    assert upsert_calls == [1]
    assert len(set_last_sync_calls) == 1
    assert complete_calls and complete_calls[0][0] == 10

    api._sync_running = True
    assert api.run_sync_once() == {"started": False, "reason": "already running"}
    api._sync_running = False


def test_run_sync_once_error_path(monkeypatch):
    monkeypatch.setattr(api, "JIRA_EMAIL", "x")
    monkeypatch.setattr(api, "JIRA_TOKEN", "y")
    monkeypatch.setattr(api, "ensure_schema", lambda: None)
    monkeypatch.setattr(api, "create_sync_run", lambda mode, trigger_type="manual": 22)
    monkeypatch.setattr(api, "get_last_sync", lambda: None)
    monkeypatch.setattr(api, "_refresh_release_workload_snapshots", lambda cur: None)
    monkeypatch.setattr(api, "jira_search", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("boom")))
    error_calls = []
    monkeypatch.setattr(api, "complete_sync_run_error", lambda rid, err: error_calls.append((rid, err)))

    api._sync_running = False
    with pytest.raises(RuntimeError, match="boom"):
        api.run_sync_once()
    assert error_calls == [(22, "boom")]
    assert api._sync_last_error == "boom"
    assert api._sync_running is False


def test_get_sync_status_payload_maps_all_sections(monkeypatch):
    now = datetime(2026, 2, 25, 10, 0, 0, tzinfo=timezone.utc)
    cursor = CursorStub(
        fetchall_values=[
            [(now, now, "incremental", "manual", True, 4, now, None), (now, now, "full", "automatic", True, 10, now, None)],
            [(now, now, "incremental", "manual", 4, now), (now, now, "full", "automatic", 10, now)],
        ],
        fetchone_values=[
            (now, now, "incremental", "manual", "err"),
            (now, now, "automatic", 10, now),
        ],
    )
    patch_conn(monkeypatch, cursor)
    monkeypatch.setattr(api, "get_last_sync", lambda: now.replace(tzinfo=None))
    api._sync_running = True
    api._sync_last_run = "2026-02-25T10:00:00Z"
    api._sync_last_error = None
    api._sync_last_result = {"upserts": 4}

    payload = api.get_sync_status_payload()
    assert payload["running"] is True
    assert payload["last_sync"] == "2026-02-25T10:00:00Z"
    assert payload["recent_runs"][0]["success"] is True
    assert payload["successful_runs"][0]["upserts"] == 4
    assert payload["successful_runs"][0]["trigger_type"] == "manual"
    assert payload["last_failed_run"]["message"] == "err"
    assert payload["last_failed_run"]["trigger_type"] == "manual"
    assert payload["last_full_sync"]["upserts"] == 10
    assert payload["last_full_sync"]["trigger_type"] == "automatic"


def test_meta_alerts_and_issue_endpoints(monkeypatch):
    now = datetime(2026, 2, 25, 10, 0, 0)
    cursor = CursorStub(
        fetchall_values=[
            [("Incident",), ("Vraag",)],
            [("Koppelingen",)],
            [("P1",)],
            [("Johan",)],
            [("Org A",)],
            [
                ("SD-1", now, "P1", "Nieuwe melding", "P1 titel"),
                ("SD-2", now, "Normaal", "Nieuwe melding", "Geen alert"),
                ("SD-20", now, "P1", "In behandeling", "Niet nieuw"),
            ],
            [("SD-3", now, 2, "Waarschuwing titel", "Nieuwe melding")],
            [],
                [("SD-4", now, 8, "Overdue titel", "Nieuwe melding")],
                [("SD-5", now, 45, "TTR waarschuwing titel", "In behandeling")],
                [("SD-6", now, 30, "TTR kritiek titel", "In behandeling")],
                [("SD-7", now, 90, "TTR overdue titel", "In behandeling")],
                [("SD-10", "Incident", "Koppelingen", now, now, "P1", "Johan", "Open")],
            ]
        )
    patch_conn(monkeypatch, cursor)
    monkeypatch.setattr(api, "_jira_existing_issue_keys", lambda keys: set(keys) - {"SD-2"})

    meta_response = client.get("/meta")
    assert meta_response.status_code == 200
    assert "Incident" in meta_response.json()["request_types"]

    alerts_response = client.get("/alerts/live")
    assert alerts_response.status_code == 200
    alerts_data = alerts_response.json()
    assert [x["issue_key"] for x in alerts_data["priority1"]] == ["SD-1"]
    assert alerts_data["priority1"][0]["issue_summary"] == "P1 titel"
    assert alerts_data["first_response_due_warning"][0]["minutes_left"] == 2
    assert alerts_data["first_response_due_warning"][0]["issue_summary"] == "Waarschuwing titel"
    assert alerts_data["first_response_due_warning"][0]["status"] == "Nieuwe melding"
    assert alerts_data["first_response_overdue"][0]["minutes_overdue"] == 8
    assert alerts_data["first_response_overdue"][0]["status"] == "Nieuwe melding"
    assert alerts_data["time_to_resolution_warning"][0]["issue_key"] == "SD-5"
    assert alerts_data["time_to_resolution_critical"][0]["issue_key"] == "SD-6"
    assert alerts_data["time_to_resolution_overdue"][0]["minutes_overdue"] == 90

    issues_response = client.get(
        "/issues?date_from=2026-01-01&date_to=2026-02-28&date_field=resolved&limit=5&offset=0"
    )
    assert issues_response.status_code == 200
    issue = issues_response.json()[0]
    assert issue["issue_key"] == "SD-10"
    assert issue["status"] == "Open"


def test_issues_endpoint_uses_shared_filter_params(monkeypatch):
    now = datetime(2026, 2, 25, 10, 0, 0)
    cursor = CursorStub(
        fetchall_values=[
            [("SD-10", "Incident", "Koppelingen", now, now, "P1", "Johan", "Open")],
        ]
    )
    patch_conn(monkeypatch, cursor)

    response = client.get(
        "/issues?date_from=2026-01-01&date_to=2026-02-28"
        "&request_type=Incident&onderwerp=Koppelingen&priority=P1&assignee=Johan"
        "&organization=Org%20A&servicedesk_only=true&date_field=resolved&limit=5&offset=2"
    )

    assert response.status_code == 200
    query, params = cursor.executed[0]
    query = _query_text(query)
    assert "resolved_at is not null" in query
    assert "request_type = %s" in query
    assert "organizations @> array[%s]::text[]" in query
    assert "limit %s offset %s" in query
    assert params == (
        "2026-01-01",
        "2026-02-28",
        None,
        None,
        "Incident",
        "Incident",
        "Koppelingen",
        "Koppelingen",
        "P1",
        "P1",
        "Johan",
        "Johan",
        "Org A",
        "Org A",
        True,
        5,
        2,
    )


def test_issues_endpoint_filters_issue_keys(monkeypatch):
    now = datetime(2026, 2, 25, 10, 0, 0)
    cursor = CursorStub(fetchall_values=[[("SD-10", "Incident", "Koppelingen", now, now, "P1", "Johan", "Open")]])
    patch_conn(monkeypatch, cursor)

    response = client.get(
        "/issues?date_from=2026-01-01&date_to=2026-02-28&issue_keys=SD-10,SD-11&limit=5&offset=0"
    )

    assert response.status_code == 200
    query, params = cursor.executed[0]
    query = _query_text(query)
    assert "issue_key = any(%s::text[])" in query
    assert params[2] == ["SD-10", "SD-11"]
    assert params[3] == ["SD-10", "SD-11"]


def test_alerts_overdue_query_only_uses_open_issues(monkeypatch):
    now = datetime(2026, 2, 25, 10, 0, 0)
    cursor = CursorStub(
        fetchall_values=[
            [("SD-1", now, "P1", "Nieuwe melding", "P1 titel")],
            [("SD-2", now, 2, "Waarschuwing titel", "Nieuwe melding")],
            [],
            [("SD-3", now, 8, "Overdue titel", "Nieuwe melding")],
            [],
            [],
            [("SD-5", now, 9, "TTR overdue titel", "In behandeling")],
        ]
    )
    patch_conn(monkeypatch, cursor)
    monkeypatch.setattr(api, "_jira_existing_issue_keys", lambda keys: set(keys))

    response = client.get("/alerts/live")
    assert response.status_code == 200

    overdue_queries = [q for q, _params in cursor.executed if "minutes_overdue" in q]
    assert overdue_queries
    overdue_sql = overdue_queries[0].lower()
    assert "resolved_at is null" in overdue_sql
    assert "lower(coalesce(current_status, '')) = 'nieuwe melding'" in overdue_sql
    assert "assignee is null" in overdue_sql

    ttr_overdue_queries = [q for q, _params in cursor.executed if "time_to_resolution_due_at" in q and "minutes_overdue" in q]
    assert ttr_overdue_queries
    ttr_overdue_sql = ttr_overdue_queries[0].lower()
    assert "lower(coalesce(request_type, '')) = 'incident'" in ttr_overdue_sql
    assert "not (lower(coalesce(current_status, '')) = any(%s::text[]))" in ttr_overdue_sql
    assert "time_to_resolution_due_at >= now() - make_interval(hours => %s)" in ttr_overdue_sql


def test_alerts_live_forces_servicedesk_scope(monkeypatch):
    now = datetime(2026, 2, 25, 10, 0, 0)
    cursor = CursorStub(
        fetchall_values=[
            [("SD-1", now, "P1", "Nieuwe melding", "P1 titel")],
            [("SD-2", now, 2, "Waarschuwing titel", "Nieuwe melding")],
            [],
            [("SD-3", now, 8, "Overdue titel", "Nieuwe melding")],
            [],
            [],
            [],
        ]
    )
    patch_conn(monkeypatch, cursor)
    monkeypatch.setattr(api, "_jira_existing_issue_keys", lambda keys: set(keys))

    response = client.get("/alerts/live?servicedesk_only=false")

    assert response.status_code == 200
    select_params = [params for query, params in cursor.executed if "from issues" in _query_text(query).lower()]
    assert select_params
    assert all(params and all(value is True for value in params if isinstance(value, bool)) for params in select_params)


def test_alerts_warning_and_critical_queries_only_use_nieuwe_melding(monkeypatch):
    now = datetime(2026, 2, 25, 10, 0, 0)
    cursor = CursorStub(
        fetchall_values=[
            [("SD-1", now, "P1", "Nieuwe melding", "P1 titel")],
            [("SD-2", now, 20, "Waarschuwing titel", "Nieuwe melding")],
            [("SD-3", now, 4, "Kritiek titel", "Nieuwe melding")],
            [("SD-4", now, 8, "Overdue titel", "Nieuwe melding")],
            [("SD-5", now, 120, "TTR titel", "In behandeling")],
            [("SD-6", now, 45, "TTR kritiek", "In behandeling")],
            [],
        ]
    )
    patch_conn(monkeypatch, cursor)
    monkeypatch.setattr(api, "_jira_existing_issue_keys", lambda keys: set(keys))

    response = client.get("/alerts/live")
    assert response.status_code == 200

    warning_queries = [_query_text(q).lower() for q, _params in cursor.executed if "minutes_left" in _query_text(q).lower()]
    assert len(warning_queries) >= 4
    assert "lower(coalesce(current_status, '')) = 'nieuwe melding'" in warning_queries[0]
    assert "lower(coalesce(current_status, '')) = 'nieuwe melding'" in warning_queries[1]
    assert "lower(coalesce(request_type, '')) = 'incident'" in warning_queries[2]
    assert "not (lower(coalesce(current_status, '')) = any(%s::text[]))" in warning_queries[2]
    assert "lower(coalesce(request_type, '')) = 'incident'" in warning_queries[3]


def test_alerts_live_persists_log_events_and_cleans_up(monkeypatch):
    now = datetime(2026, 2, 25, 10, 0, 0)
    cursor = CursorStub(
        fetchall_values=[
            [("SD-1", now, "P1", "Nieuwe melding", "P1 titel")],
            [("SD-2", now, 2, "Waarschuwing titel", "Nieuwe melding")],
            [],
            [("SD-3", now, 8, "Overdue titel", "Nieuwe melding")],
            [("SD-5", now, 240, "TTR waarschuwing titel", "In behandeling")],
            [("SD-6", now, 45, "TTR kritiek titel", "In behandeling")],
            [("SD-7", now, 10, "TTR overdue titel", "In behandeling")],
        ]
    )
    patch_conn(monkeypatch, cursor)
    monkeypatch.setattr(api, "_jira_existing_issue_keys", lambda keys: set(keys))
    monkeypatch.setattr(api, "_last_alert_log_cleanup_at", 0.0)
    monkeypatch.setattr(api.time, "time", lambda: 999999.0)

    response = client.get("/alerts/live")
    assert response.status_code == 200

    delete_queries = [q for q, _params in cursor.executed if "delete from alert_logs" in _query_text(q).lower()]
    assert delete_queries
    insert_queries = [q for q, _params in cursor.executed if "insert into alert_logs" in _query_text(q).lower()]
    assert insert_queries


def test_alerts_logs_endpoint_maps_rows(monkeypatch):
    now = datetime(2026, 2, 25, 10, 0, 0)
    cursor = CursorStub(
        fetchall_values=[
            [(1, "SD-1", "P1", "Nieuwe melding", "Priority 1", True, now)]
        ],
        fetchone_values=[(None,)],
    )
    patch_conn(monkeypatch, cursor)
    monkeypatch.setattr(api, "_last_alert_log_cleanup_at", 999999.0)
    monkeypatch.setattr(api.time, "time", lambda: 1000000.0)

    response = client.get("/alerts/logs?limit=5&servicedesk_only=true")
    assert response.status_code == 200
    data = response.json()
    assert data[0]["id"] == 1
    assert data[0]["issue_key"] == "SD-1"
    assert data[0]["kind"] == "P1"
    assert data[0]["servicedesk_only"] is True


def test_alerts_logs_endpoint_applies_clear_timestamp(monkeypatch):
    now = datetime(2026, 2, 25, 10, 0, 0)
    cleared_at = datetime(2026, 2, 25, 9, 30, 0, tzinfo=timezone.utc)
    cursor = CursorStub(
        fetchall_values=[[(1, "SD-1", "P1", "Nieuwe melding", "Priority 1", True, now)]],
        fetchone_values=[(cleared_at,)],
    )
    patch_conn(monkeypatch, cursor)
    monkeypatch.setattr(api, "_last_alert_log_cleanup_at", 999999.0)
    monkeypatch.setattr(api.time, "time", lambda: 1000000.0)

    response = client.get("/alerts/logs?limit=5&servicedesk_only=true")

    assert response.status_code == 200
    select_query, select_params = next(
        (_query_text(q), params) for q, params in cursor.executed if "from alert_logs" in _query_text(q).lower()
    )
    assert "detected_at >= %s::timestamptz" in select_query
    assert select_params[1] == cleared_at
    assert select_params[2] == cleared_at


def test_alerts_weekly_insights_endpoint_returns_payload(monkeypatch):
    payload = {
        "generated_at": "2026-03-20T10:00:00Z",
        "week": {"start_date": "2026-03-09", "end_date": "2026-03-15", "label": "2026-03-09 t/m 2026-03-15"},
        "scope": "alleen servicedesk",
        "summary": {"incoming_tickets": 12},
        "service_levels": {},
        "alerts": {},
        "breakdowns": {},
    }
    monkeypatch.setattr(api, "_weekly_insights_payload", lambda servicedesk_only=True: payload)

    response = client.get("/alerts/weekly-insights?servicedesk_only=true")

    assert response.status_code == 200
    assert response.json() == payload


def test_alerts_weekly_insights_pdf_endpoint_returns_pdf_download(monkeypatch):
    payload = {
        "generated_at": "2026-03-20T10:00:00Z",
        "week": {"start_date": "2026-03-09", "end_date": "2026-03-15", "label": "2026-03-09 t/m 2026-03-15"},
        "scope": "alleen servicedesk",
        "summary": {},
        "service_levels": {},
        "alerts": {},
        "breakdowns": {},
    }
    monkeypatch.setattr(api, "_weekly_insights_payload", lambda servicedesk_only=True: payload)

    response = client.get("/alerts/weekly-insights.pdf?servicedesk_only=true")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert 'attachment; filename="weekly-insights-2026-03-09-2026-03-15.pdf"' == response.headers["content-disposition"]
    assert response.content.startswith(b"%PDF-1.4")
    assert b"Weekly insights rapport" in response.content
    assert b"Helvetica-Bold" in response.content


def test_alerts_logs_clear_endpoint_deletes_scope(monkeypatch):
    cursor = CursorStub()
    patch_conn(monkeypatch, cursor)

    response = client.post("/alerts/logs/clear?servicedesk_only=true")
    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert response.json()["servicedesk_only"] is True
    assert any("update dashboard_config" in _query_text(q).lower() for q, _ in cursor.executed)
    assert any("insert into alert_logs" in _query_text(q).lower() for q, _ in cursor.executed)


def test_alert_log_cleanup_adds_logbook_event_when_rows_removed(monkeypatch):
    cursor = CursorStub()
    monkeypatch.setattr(api, "_last_alert_log_cleanup_at", 0.0)
    monkeypatch.setattr(api.time, "time", lambda: 999999.0)

    api._maybe_cleanup_alert_logs(cursor)

    inserts = [params for q, params in cursor.executed if "insert into alert_logs" in q.lower()]
    assert len(inserts) == 2
    assert inserts[0][1] == "LOGBOOK_EVENT"
    assert inserts[0][2] == "AUTO_CLEANUP"


def test_persist_alert_log_events_returns_empty_for_no_events():
    cursor = CursorStub()

    assert api._persist_alert_log_events(cursor, []) == []
    assert cursor.executed == []


def test_alerts_live_sends_teams_notification_for_new_events(monkeypatch):
    now = datetime(2026, 2, 25, 10, 0, 0)
    cursor = CursorStub(
        fetchall_values=[
            [("SD-1", now, "P1", "Nieuwe melding", "P1 titel")],
            [("SD-2", now, 2, "Waarschuwing titel", "Nieuwe melding")],
            [],
            [("SD-3", now, 8, "Overdue titel", "Nieuwe melding")],
            [("SD-5", now, 240, "TTR waarschuwing titel", "In behandeling")],
            [("SD-6", now, 45, "TTR kritiek titel", "In behandeling")],
            [("SD-7", now, 10, "TTR overdue titel", "In behandeling")],
        ],
        fetchone_values=[(1,), (2,), (3,), (4,), (5,), (6,)],
    )
    patch_conn(monkeypatch, cursor)
    monkeypatch.setattr(api, "_jira_existing_issue_keys", lambda keys: set(keys))
    monkeypatch.setattr(api, "_last_alert_log_cleanup_at", 999999.0)
    monkeypatch.setattr(api.time, "time", lambda: 1000000.0)
    monkeypatch.setattr(api, "ALERT_TEAMS_WEBHOOK_URL", "https://example.invalid/webhook")
    monkeypatch.setattr(api, "_is_teams_alert_business_window", lambda now_utc=None: True)

    sent = []

    def fake_post(url, json, timeout):
        sent.append((url, json, timeout))

    monkeypatch.setattr(api.requests, "post", fake_post)

    response = client.get("/alerts/live")
    assert response.status_code == 200
    assert len(sent) == 3
    assert sent[0][0] == "https://example.invalid/webhook"
    payload = sent[0][1]
    assert payload["type"] == "message"
    attachment = payload["attachments"][0]
    assert attachment["contentType"] == "application/vnd.microsoft.card.adaptive"
    content = attachment["content"]
    assert content["body"][0]["text"] == "DASHBOARD ALERTS"
    assert content["body"][1]["text"] == "🚨 everyone"
    assert content["body"][2]["items"][0]["text"] == "P1"
    assert content["body"][2]["items"][1]["text"] == "SD-1"
    assert content["body"][2]["items"][2]["text"] == "P1 titel"
    assert content["actions"][0]["url"] == "https://planningsagenda.atlassian.net/browse/SD-1"
    assert sent[1][1]["attachments"][0]["content"]["body"][2]["items"][0]["text"] == "TTR INCIDENT <24U"
    assert sent[2][1]["attachments"][0]["content"]["body"][2]["items"][0]["text"] == "TTR INCIDENT <60M"


def test_send_teams_alert_notification_handles_missing_title(monkeypatch):
    monkeypatch.setattr(api, "ALERT_TEAMS_WEBHOOK_URL", "https://example.invalid/webhook")
    monkeypatch.setattr(api, "_is_teams_alert_business_window", lambda now_utc=None: True)
    sent = []

    def fake_post(url, json, timeout):
        class _Resp:
            status_code = 200
            text = "ok"

        sent.append((url, json, timeout))
        return _Resp()

    monkeypatch.setattr(api.requests, "post", fake_post)

    result = api._send_teams_alert_notification(
        [
            {
                "issue_key": "SD-123",
                "alert_kind": "SLA_CRITICAL",
                "status": "Nieuwe melding",
                "meta": "5 min",
                "issue_summary": None,
                "issue_url": "https://planningsagenda.atlassian.net/browse/SD-123",
                "servicedesk_only": True,
            }
        ]
    )

    assert result["ok"] is True
    payload = sent[0][1]
    content = payload["attachments"][0]["content"]
    assert content["body"][2]["items"][0]["text"] == "SLA VERLOOPT"
    assert content["body"][2]["items"][1]["text"] == "SD-123"
    assert content["body"][2]["items"][2]["text"] == "Geen titel beschikbaar"
    assert content["body"][3]["facts"][0]["value"] == "Nieuwe melding"
    assert content["actions"][0]["url"] == "https://planningsagenda.atlassian.net/browse/SD-123"
    assert result["sent_count"] == 1


def test_is_teams_alert_business_window_uses_dutch_working_hours():
    assert api._is_teams_alert_business_window(datetime(2026, 3, 18, 7, 29, tzinfo=timezone.utc)) is False
    assert api._is_teams_alert_business_window(datetime(2026, 3, 18, 7, 30, tzinfo=timezone.utc)) is True
    assert api._is_teams_alert_business_window(datetime(2026, 3, 18, 15, 59, tzinfo=timezone.utc)) is True
    assert api._is_teams_alert_business_window(datetime(2026, 3, 18, 16, 0, tzinfo=timezone.utc)) is False
    assert api._is_teams_alert_business_window(datetime(2026, 3, 21, 10, 0, tzinfo=timezone.utc)) is False


def test_send_teams_alert_notification_skips_outside_business_hours(monkeypatch):
    monkeypatch.setattr(api, "ALERT_TEAMS_WEBHOOK_URL", "https://example.invalid/webhook")
    monkeypatch.setattr(api, "_is_teams_alert_business_window", lambda now_utc=None: False)
    sent = []

    def fake_post(url, json, timeout):
        sent.append((url, json, timeout))
        raise AssertionError("Teams webhook should not be called outside business hours")

    monkeypatch.setattr(api.requests, "post", fake_post)

    result = api._send_teams_alert_notification(
        [
            {
                "issue_key": "SD-123",
                "alert_kind": "SLA_CRITICAL",
                "status": "Nieuwe melding",
                "meta": "5 min",
                "issue_summary": "Test",
                "issue_url": "https://planningsagenda.atlassian.net/browse/SD-123",
                "servicedesk_only": True,
            }
        ]
    )

    assert sent == []
    assert result["attempted"] is False
    assert result["skipped"] is True
    assert result["skipped_reason"] == "outside_business_hours"


def test_dev_alert_trigger_and_clear(monkeypatch):
    cursor = CursorStub(fetchone_values=[("Johan", "Koppelingen"), (1,), (0,)])
    patch_conn(monkeypatch, cursor)
    monkeypatch.setattr(api.time, "time", lambda: 1234567890.0)

    trigger_response = client.post("/dev/alerts/trigger")
    assert trigger_response.status_code == 200
    issue_key = trigger_response.json()["issue_key"]
    assert issue_key.startswith("DEV-ALERT-TEST-")
    assert any("insert into issues" in q.lower() for q, _ in cursor.executed)
    assert any("update dashboard_config" in q.lower() for q, _ in cursor.executed)

    state_response = client.get("/dev/alerts/test-state")
    assert state_response.status_code == 200
    assert "count" in state_response.json()

    clear_response = client.post(f"/dev/alerts/clear?issue_key={issue_key}")
    assert clear_response.status_code == 200
    assert clear_response.json()["issue_key"] == issue_key
    assert any("delete from issues" in q.lower() for q, _ in cursor.executed)
    assert any("delete from alert_logs" in q.lower() for q, _ in cursor.executed)


def test_dev_alert_notify_test(monkeypatch):
    monkeypatch.setattr(api, "ALERT_TEAMS_WEBHOOK_URL", "https://example.invalid/webhook")
    monkeypatch.setattr(api, "_is_teams_alert_business_window", lambda now_utc=None: False)
    sent = []

    def fake_post(url, json, timeout):
        class _Resp:
            status_code = 200
            text = "ok"

        sent.append((url, json, timeout))
        return _Resp()

    monkeypatch.setattr(api.requests, "post", fake_post)
    response = client.post("/dev/alerts/notify-test")
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert len(sent) == 1


def test_vacation_update_and_delete_not_found(monkeypatch):
    cursor = CursorStub(fetchone_values=[None, None])
    patch_conn(monkeypatch, cursor)
    monkeypatch.setattr(
        api,
        "_validate_vacation_payload",
        lambda payload: ("Johan", date(2026, 7, 20), date(2026, 7, 21)),
    )

    update_response = client.put(
        "/vacations/999",
        json={"member_name": "Johan", "start_date": "2026-07-20", "end_date": "2026-07-21"},
    )
    assert update_response.status_code == 404

    delete_response = client.delete("/vacations/999")
    assert delete_response.status_code == 404
