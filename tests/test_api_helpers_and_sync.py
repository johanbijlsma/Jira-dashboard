from datetime import date, datetime, timedelta, timezone

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
    assert "servicedesk_team_members" in sql
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
    assert "i.assignee = any" in sql
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
    select_params = [params for query, params in cursor.executed if "from issues" in query.lower()]
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

    warning_queries = [q.lower() for q, _params in cursor.executed if "minutes_left" in q.lower()]
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

    delete_queries = [q for q, _params in cursor.executed if "delete from alert_logs" in q.lower()]
    assert delete_queries
    insert_queries = [q for q, _params in cursor.executed if "insert into alert_logs" in q.lower()]
    assert insert_queries


def test_alerts_logs_endpoint_maps_rows(monkeypatch):
    now = datetime(2026, 2, 25, 10, 0, 0)
    cursor = CursorStub(
        fetchall_values=[
            [(1, "SD-1", "P1", "Nieuwe melding", "Priority 1", True, now)]
        ]
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


def test_alerts_logs_clear_endpoint_deletes_scope(monkeypatch):
    cursor = CursorStub()
    patch_conn(monkeypatch, cursor)

    response = client.post("/alerts/logs/clear?servicedesk_only=true")
    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert response.json()["servicedesk_only"] is True
    assert any("delete from alert_logs" in q.lower() for q, _ in cursor.executed)
    assert any("insert into alert_logs" in q.lower() for q, _ in cursor.executed)


def test_alert_log_cleanup_adds_logbook_event_when_rows_removed(monkeypatch):
    cursor = CursorStub()
    monkeypatch.setattr(api, "_last_alert_log_cleanup_at", 0.0)
    monkeypatch.setattr(api.time, "time", lambda: 999999.0)

    api._maybe_cleanup_alert_logs(cursor)

    inserts = [params for q, params in cursor.executed if "insert into alert_logs" in q.lower()]
    assert len(inserts) == 2
    assert inserts[0][1] == "LOGBOOK_EVENT"
    assert inserts[0][2] == "AUTO_CLEANUP"


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
