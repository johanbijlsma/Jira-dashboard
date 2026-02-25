from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

import api


client = TestClient(api.app)


class CursorStub:
    def __init__(self, fetchall_values=None, fetchone_values=None):
        self.fetchall_values = list(fetchall_values or [])
        self.fetchone_values = list(fetchone_values or [])
        self.executed = []

    def execute(self, query, params=None):
        self.executed.append((query, params))

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
    assert dt.isoformat() == "2026-02-25T10:00:00"
    assert api.norm_first_response_due_at({"ongoingCycle": {"breachTime": {}}}) is None

    monkeypatch.setattr(api, "ALERT_P1_PRIORITIES", ["kritiek"])
    assert api.is_priority1_priority("Kritiek") is True
    assert api.is_priority1_priority("P1 melding") is True
    assert api.is_priority1_priority("Prioriteit 1") is True
    assert api.is_priority1_priority("level 1") is False
    assert api.is_priority1_priority("normaal") is False


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
        calls.append((json["jql"], json.get("nextPageToken"), timeout))
        return responses.pop(0)

    monkeypatch.setattr(api._jira, "post", fake_post)
    monkeypatch.setattr(api.time, "sleep", lambda _s: None)

    result = api.jira_search("project = SD")
    assert result["issues"][0]["key"] == "SD-1"
    assert len(calls) == 2


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
    issue = {
        "key": "SD-1",
        "fields": {
            api.REQUEST_TYPE_FIELD: {"requestType": {"name": "Vraag"}},
            api.ONDERWERP_FIELD: {"value": "Koppelingen"},
            api.ORGANIZATION_FIELD: [{"name": "Org A"}],
            api.FIRST_RESPONSE_SLA_FIELD: {"ongoingCycle": {"breachTime": {"iso8601": "2026-02-25T10:00:00+0000"}}},
            "created": "2026-02-24T10:00:00+0000",
            "updated": "2026-02-25T10:00:00+0000",
            "resolutiondate": None,
            "status": {"name": "Nieuwe melding"},
            "priority": {"name": "P1"},
            "assignee": {"displayName": "Johan", "avatarUrls": {"48x48": "http://img"}},
        },
    }
    api.upsert_issues([issue])
    assert len(cursor.executed) == 1
    params = cursor.executed[0][1]
    assert params[0] == "SD-1"
    assert params[1] == "Vraag"
    assert params[2] == "Koppelingen"
    assert params[3] == ["Org A"]
    assert params[8] == "Johan"
    assert params[9] == "http://img"


def test_run_sync_once_branches(monkeypatch):
    monkeypatch.setattr(api, "JIRA_EMAIL", "x")
    monkeypatch.setattr(api, "JIRA_TOKEN", "y")
    monkeypatch.setattr(api, "ensure_schema", lambda: None)
    monkeypatch.setattr(api, "create_sync_run", lambda mode: 10)
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
    monkeypatch.setattr(api, "create_sync_run", lambda mode: 22)
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
            [(now, now, "incremental", 4, now), (now, now, "full", 10, now)],
        ],
        fetchone_values=[
            (now, now, "incremental", "err"),
            (now, now, 10, now),
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
    assert payload["successful_runs"][0]["upserts"] == 4
    assert payload["last_failed_run"]["message"] == "err"
    assert payload["last_full_sync"]["upserts"] == 10


def test_meta_alerts_and_issue_endpoints(monkeypatch):
    now = datetime(2026, 2, 25, 10, 0, 0)
    cursor = CursorStub(
        fetchall_values=[
            [("Incident",), ("Vraag",)],
            [("Koppelingen",)],
            [("P1",)],
            [("Johan",)],
            [("Org A",)],
            [("SD-1", now, "P1", "Nieuwe melding"), ("SD-2", now, "Normaal", "Nieuwe melding")],
            [("SD-3", now, 2)],
            [("SD-4", now, 8)],
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
    assert alerts_data["first_response_due_soon"][0]["minutes_left"] == 2
    assert alerts_data["first_response_overdue"][0]["minutes_overdue"] == 8

    issues_response = client.get(
        "/issues?date_from=2026-01-01&date_to=2026-02-28&date_field=resolved&limit=5&offset=0"
    )
    assert issues_response.status_code == 200
    issue = issues_response.json()[0]
    assert issue["issue_key"] == "SD-10"
    assert issue["status"] == "Open"


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

