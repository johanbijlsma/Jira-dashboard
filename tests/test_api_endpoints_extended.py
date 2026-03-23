from datetime import date, datetime

from fastapi.testclient import TestClient
import psycopg2
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


class _CursorStub:
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


class _ConnStub:
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


def _patch_conn(monkeypatch, cursor):
    monkeypatch.setattr(api, "ensure_schema", lambda: None)
    monkeypatch.setattr(api, "conn", lambda: _ConnStub(cursor))


def test_status_alias_uses_same_payload_provider(monkeypatch):
    payload = {"running": False, "successful_runs": [], "last_failed_run": None, "last_full_sync": None}
    monkeypatch.setattr(api, "get_sync_status_payload", lambda: payload)

    response = client.get("/status")
    assert response.status_code == 200
    assert response.json() == payload


def test_status_returns_503_when_database_is_unavailable(monkeypatch):
    def _raise_db_error():
        raise psycopg2.OperationalError("connection refused")

    monkeypatch.setattr(api, "get_sync_status_payload", _raise_db_error)

    response = client.get("/status")

    assert response.status_code == 503
    assert response.json()["error"] == "database_unavailable"
    assert "connection refused" in response.json()["message"]


def test_update_servicedesk_config_rejects_empty_team(monkeypatch):
    monkeypatch.setattr(api, "ensure_schema", lambda: None)
    response = client.put(
        "/config/servicedesk",
        json={"team_members": [], "onderwerpen": ["Onderwerp A"]},
    )
    assert response.status_code == 400
    assert "teamlid" in response.json()["detail"].lower()


def test_update_servicedesk_config_rejects_empty_onderwerpen(monkeypatch):
    monkeypatch.setattr(api, "ensure_schema", lambda: None)
    response = client.put(
        "/config/servicedesk",
        json={"team_members": ["Johan"], "onderwerpen": []},
    )
    assert response.status_code == 400
    assert "onderwerp" in response.json()["detail"].lower()


def test_update_servicedesk_config_success(monkeypatch):
    cursor = _CursorStub()
    _patch_conn(monkeypatch, cursor)
    monkeypatch.setattr(api, "_allowed_servicedesk_onderwerpen", lambda cur: ["Onderwerp A", "Onderwerp B"])
    monkeypatch.setattr(
        api,
        "get_servicedesk_config",
        lambda: {
            "team_members": ["Johan"],
            "onderwerpen": ["Onderwerp A"],
            "onderwerpen_baseline": ["Onderwerp A", "Onderwerp B"],
            "onderwerpen_customized": True,
            "ai_insight_threshold_pct": 82,
            "updated_at": "2026-02-25T10:00:00Z",
            "team_member_avatars": {},
        },
    )

    response = client.put(
        "/config/servicedesk",
        json={"team_members": ["Johan"], "onderwerpen": ["Onderwerp A"], "ai_insight_threshold_pct": 82},
    )
    assert response.status_code == 200
    assert response.json()["team_members"] == ["Johan"]
    assert response.json()["ai_insight_threshold_pct"] == 82


def test_insights_logs_returns_mapped_rows(monkeypatch):
    cursor = _CursorStub(
        fetchall_values=[
            [
                (
                    7,
                    "scope|insight",
                    "AI-signaal",
                    "Samenvatting",
                    "Actie",
                    "backlog_pressure",
                    "inflowVsClosed",
                    88.0,
                    24.0,
                    datetime(2026, 2, 1, 10, 0),
                    datetime(2026, 2, 1, 18, 0),
                    {"current": {"inflow": 10}, "previous": {"inflow": 6}},
                    "pending",
                    None,
                    None,
                    None,
                )
            ]
        ]
    )
    _patch_conn(monkeypatch, cursor)

    response = client.get("/insights/logs?limit=5&servicedesk_only=true")
    assert response.status_code == 200
    data = response.json()
    assert data[0]["id"] == 7
    assert data[0]["target_card_key"] == "inflowVsClosed"
    assert data[0]["source_payload"]["current"]["inflow"] == 10


def test_submit_insight_feedback_updates_row(monkeypatch):
    cursor = _CursorStub(
        fetchone_values=[
            (
                7,
                "scope|insight",
                "AI-signaal",
                "Samenvatting",
                "Actie",
                "backlog_pressure",
                "inflowVsClosed",
                88.0,
                24.0,
                datetime(2026, 2, 1, 10, 0),
                datetime(2026, 2, 1, 18, 0),
                {"current": {"inflow": 10}, "previous": {"inflow": 6}},
                "downvoted",
                "niet relevant genoeg",
                datetime(2026, 2, 1, 10, 5),
                datetime(2026, 2, 1, 10, 5),
            )
        ]
    )
    _patch_conn(monkeypatch, cursor)

    response = client.post("/insights/7/feedback", json={"vote": "down", "reason": "niet relevant genoeg"})
    assert response.status_code == 200
    data = response.json()
    assert data["feedback_status"] == "downvoted"
    assert data["feedback_reason"] == "niet relevant genoeg"


def test_vacations_upcoming_returns_mapped_rows(monkeypatch):
    cursor = _CursorStub(
        fetchall_values=[
            [
                (1, "Johan", date(2026, 7, 20), date(2026, 7, 24), datetime(2026, 2, 1, 10, 0), datetime(2026, 2, 1, 10, 0))
            ]
        ]
    )
    _patch_conn(monkeypatch, cursor)

    response = client.get("/vacations/upcoming?limit=3")
    assert response.status_code == 200
    data = response.json()
    assert data[0]["member_name"] == "Johan"
    assert data[0]["start_date"] == "2026-07-20"


def test_create_vacation_validation_error(monkeypatch):
    monkeypatch.setattr(api, "ensure_schema", lambda: None)
    monkeypatch.setattr(
        api,
        "_validate_vacation_payload",
        lambda payload: (_ for _ in ()).throw(ValueError("Onbekend teamlid.")),
    )
    response = client.post(
        "/vacations",
        json={"member_name": "X", "start_date": "2026-07-20", "end_date": "2026-07-21"},
    )
    assert response.status_code == 400
    assert "onbekend teamlid" in response.json()["detail"].lower()


def test_create_vacation_success(monkeypatch):
    cursor = _CursorStub(
        fetchone_values=[
            (2, "Johan", date(2026, 7, 20), date(2026, 7, 21), datetime(2026, 2, 1, 10, 0), datetime(2026, 2, 1, 10, 0))
        ]
    )
    _patch_conn(monkeypatch, cursor)
    monkeypatch.setattr(
        api,
        "_validate_vacation_payload",
        lambda payload: ("Johan", date(2026, 7, 20), date(2026, 7, 21)),
    )

    response = client.post(
        "/vacations",
        json={"member_name": "Johan", "start_date": "2026-07-20", "end_date": "2026-07-21"},
    )
    assert response.status_code == 200
    assert response.json()["id"] == 2


def test_metrics_volume_weekly_maps_rows(monkeypatch):
    cursor = _CursorStub(
        fetchall_values=[[(datetime(2026, 1, 19, 0, 0), "Incident", 5)]]
    )
    _patch_conn(monkeypatch, cursor)

    response = client.get("/metrics/volume_weekly?date_from=2026-01-19&date_to=2026-01-26")
    assert response.status_code == 200
    data = response.json()
    assert data[0]["request_type"] == "Incident"
    assert data[0]["tickets"] == 5


def test_issues_invalid_date_field_falls_back_to_created(monkeypatch):
    cursor = _CursorStub(
        fetchall_values=[[( "SD-10", "Incident", "Koppelingen", datetime(2026, 1, 19, 0, 0), None, "P1", "Johan", "Open")]]
    )
    _patch_conn(monkeypatch, cursor)

    response = client.get(
        "/issues?date_from=2026-01-01&date_to=2026-02-28&date_field=invalid&limit=5&offset=0"
    )

    assert response.status_code == 200
    query, _params = cursor.executed[0]
    query = _query_text(query)
    assert "from issues" in query
    assert "created_at >=" in query


def test_metrics_volume_weekly_uses_shared_filter_params(monkeypatch):
    cursor = _CursorStub(fetchall_values=[[]])
    _patch_conn(monkeypatch, cursor)

    response = client.get(
        "/metrics/volume_weekly?date_from=2026-01-19&date_to=2026-01-26"
        "&request_type=Incident&onderwerp=Email&priority=High&assignee=Alice"
        "&organization=Org%20A&servicedesk_only=true"
    )

    assert response.status_code == 200
    query, params = cursor.executed[0]
    query = _query_text(query)
    assert "request_type = %s" in query
    assert "organizations @> array[%s]::text[]" in query
    assert "servicedesk_onderwerpen" in query
    assert "servicedesk_team_members" not in query
    assert params == (
        "2026-01-19",
        "2026-01-26",
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


def test_metrics_ttr_weekly_by_type_maps_rows(monkeypatch):
    cursor = _CursorStub(
        fetchall_values=[[(datetime(2026, 1, 19, 0, 0), "Vraag", 12.5, 10.0, 24.0, 24.0, 4)]]
    )
    _patch_conn(monkeypatch, cursor)

    response = client.get("/metrics/time_to_resolution_weekly_by_type?date_from=2026-01-19&date_to=2026-01-26")
    assert response.status_code == 200
    data = response.json()
    assert data[0]["request_type"] == "Vraag"
    assert data[0]["avg_hours"] == 12.5
    assert data[0]["median_hours"] == 10.0
    assert data[0]["sla_avg_hours"] == 24.0
    assert data[0]["sla_median_hours"] == 24.0
    assert data[0]["n"] == 4


def test_metrics_ttr_weekly_by_type_uses_shared_filter_params_without_request_type(monkeypatch):
    cursor = _CursorStub(fetchall_values=[[]])
    _patch_conn(monkeypatch, cursor)

    response = client.get(
        "/metrics/time_to_resolution_weekly_by_type?date_from=2026-01-19&date_to=2026-01-26"
        "&onderwerp=Email&priority=High&assignee=Alice&organization=Org%20A&servicedesk_only=true"
    )

    assert response.status_code == 200
    query, params = cursor.executed[0]
    query = _query_text(query)
    assert "request_type = %s" not in query
    assert "request_type is not null" in query
    assert "organizations @> array[%s]::text[]" in query
    assert params == (
        "2026-01-19",
        "2026-01-26",
        "Email",
        "Email",
        "High",
        "High",
        "Alice",
        "Alice",
        "Org A",
        "Org A",
        True,
        "2026-01-19",
        "2026-01-26",
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


def test_servicedesk_config_endpoint(monkeypatch):
    monkeypatch.setattr(
        api,
        "get_servicedesk_config",
        lambda: {
            "team_members": ["Johan"],
            "onderwerpen": ["Koppelingen"],
            "onderwerpen_baseline": ["Performance"],
            "onderwerpen_customized": True,
            "updated_at": "2026-02-25T10:00:00Z",
            "team_member_avatars": {"Johan": "http://avatar"},
        },
    )
    response = client.get("/config/servicedesk")
    assert response.status_code == 200
    assert response.json()["team_member_avatars"]["Johan"] == "http://avatar"
    assert response.json()["onderwerpen_baseline"] == ["Performance"]
    assert response.json()["onderwerpen_customized"] is True


def test_get_servicedesk_config_uses_baseline_when_not_customized(monkeypatch):
    cursor = _CursorStub(
        fetchone_values=[
            (["Johan"], ["UWV-koppeling"], False, datetime(2026, 2, 25, 10, 0, 0)),
        ],
        fetchall_values=[
            [("Johan", "http://avatar")],
        ],
    )
    monkeypatch.setattr(api, "ensure_schema", lambda: None)
    monkeypatch.setattr(api, "conn", lambda: _ConnStub(cursor))
    monkeypatch.setattr(api, "_allowed_servicedesk_onderwerpen", lambda cur: ["Performance", "Vraag"])

    data = api.get_servicedesk_config()

    assert data["onderwerpen"] == ["Performance", "Vraag"]
    assert data["onderwerpen_baseline"] == ["Performance", "Vraag"]
    assert data["onderwerpen_customized"] is False


def test_get_servicedesk_config_uses_saved_selection_when_customized(monkeypatch):
    cursor = _CursorStub(
        fetchone_values=[
            (["Johan"], ["Performance"], True, datetime(2026, 2, 25, 10, 0, 0)),
        ],
        fetchall_values=[
            [("Johan", "http://avatar")],
        ],
    )
    monkeypatch.setattr(api, "ensure_schema", lambda: None)
    monkeypatch.setattr(api, "conn", lambda: _ConnStub(cursor))
    monkeypatch.setattr(api, "_allowed_servicedesk_onderwerpen", lambda cur: ["Performance", "Vraag"])

    data = api.get_servicedesk_config()

    assert data["onderwerpen"] == ["Performance"]
    assert data["onderwerpen_baseline"] == ["Performance", "Vraag"]
    assert data["onderwerpen_customized"] is True


def test_seed_servicedesk_config_defaults_updates_dashboard_config(monkeypatch):
    cursor = _CursorStub()

    api._seed_servicedesk_config_defaults(cursor)

    executed_queries = [query.lower() for query, _ in cursor.executed]
    assert any("insert into dashboard_config" in query for query in executed_queries)
    assert sum("update dashboard_config" in query for query in executed_queries) == 2


def test_metrics_inflow_vs_closed_maps_rows(monkeypatch):
    cursor = _CursorStub(
        fetchall_values=[[(datetime(2026, 1, 19, 0, 0), 8, 5)]]
    )
    _patch_conn(monkeypatch, cursor)
    response = client.get("/metrics/inflow_vs_closed_weekly?date_from=2026-01-19&date_to=2026-01-26")
    assert response.status_code == 200
    assert response.json()[0] == {
        "week": "2026-01-19T00:00:00",
        "incoming_count": 8,
        "closed_count": 5,
    }


def test_meta_trims_onderwerpen(monkeypatch):
    cursor = _CursorStub(
        fetchall_values=[
            [("Incident",)],
            [("Performance",), ("Vraag",)],
            [("P1",)],
            [("Johan",)],
            [("Org A",)],
        ]
    )
    _patch_conn(monkeypatch, cursor)

    response = client.get("/meta")

    assert response.status_code == 200
    assert response.json()["onderwerpen"] == ["Performance", "Vraag"]
    assert "btrim(onderwerp_logging)" in cursor.executed[1][0]


def test_metrics_leadtime_p90_maps_rows(monkeypatch):
    cursor = _CursorStub(
        fetchall_values=[[("Incident", 4.0, 8.0, 16.0, 6)]]
    )
    _patch_conn(monkeypatch, cursor)
    response = client.get("/metrics/leadtime_p90_by_type?date_from=2026-01-19&date_to=2026-01-26")
    assert response.status_code == 200
    assert response.json()[0]["p90_hours"] == 16.0


def test_metrics_time_summary_maps_row(monkeypatch):
    cursor = _CursorStub(
        fetchone_values=[(12.5, 10.0, 3.0, 2.0, 9, 7)]
    )
    _patch_conn(monkeypatch, cursor)
    response = client.get("/metrics/time_summary?date_from=2026-01-19&date_to=2026-01-26")
    assert response.status_code == 200
    data = response.json()
    assert data["time_to_resolution_hours"] == 12.5
    assert data["first_response_n"] == 7


def test_metrics_time_to_first_response_weekly_maps_rows(monkeypatch):
    cursor = _CursorStub(
        fetchall_values=[[(datetime(2026, 1, 19, 0, 0), 2.5, 2.0, 5)]]
    )
    _patch_conn(monkeypatch, cursor)
    response = client.get("/metrics/time_to_first_response_weekly?date_from=2026-01-19&date_to=2026-01-26")
    assert response.status_code == 200
    assert response.json()[0]["avg_hours"] == 2.5


def test_metrics_ttfr_overdue_weekly_maps_rows(monkeypatch):
    cursor = _CursorStub(
        fetchall_values=[[(datetime(2026, 1, 19, 0, 0), 3)]]
    )
    _patch_conn(monkeypatch, cursor)
    response = client.get("/metrics/ttfr_overdue_weekly?date_from=2026-01-19&date_to=2026-01-26")
    assert response.status_code == 200
    assert response.json() == [{"week": "2026-01-19T00:00:00", "tickets": 3}]


def test_metrics_volume_by_priority_maps_rows(monkeypatch):
    cursor = _CursorStub(fetchall_values=[[("P1", 3)]])
    _patch_conn(monkeypatch, cursor)
    response = client.get("/metrics/volume_by_priority?date_from=2026-01-19&date_to=2026-01-26")
    assert response.status_code == 200
    assert response.json() == [{"priority": "P1", "tickets": 3}]


def test_metrics_volume_by_assignee_maps_rows(monkeypatch):
    cursor = _CursorStub(fetchall_values=[[("Johan", 6)]])
    _patch_conn(monkeypatch, cursor)
    response = client.get("/metrics/volume_by_assignee?date_from=2026-01-19&date_to=2026-01-26")
    assert response.status_code == 200
    assert response.json() == [{"assignee": "Johan", "tickets": 6}]


def test_metrics_volume_weekly_by_onderwerp_maps_rows(monkeypatch):
    cursor = _CursorStub(
        fetchall_values=[[(datetime(2026, 1, 19, 0, 0), "Koppelingen", 4)]]
    )
    _patch_conn(monkeypatch, cursor)
    response = client.get("/metrics/volume_weekly_by_onderwerp?date_from=2026-01-19&date_to=2026-01-26")
    assert response.status_code == 200
    assert response.json()[0]["onderwerp"] == "Koppelingen"


def test_metrics_volume_weekly_by_organization_uses_alias_filter_params(monkeypatch):
    cursor = _CursorStub(fetchall_values=[[]])
    _patch_conn(monkeypatch, cursor)

    response = client.get(
        "/metrics/volume_weekly_by_organization?date_from=2026-01-19&date_to=2026-01-26"
        "&request_type=Incident&onderwerp=Email&priority=High&assignee=Alice"
        "&organization=Org%20A&servicedesk_only=true"
    )

    assert response.status_code == 200
    query, params = cursor.executed[0]
    query = _query_text(query)
    assert "i.request_type = %s" in query
    assert "i.onderwerp_logging = %s" in query
    assert "i.assignee = %s" in query
    assert "org.org_name = %s" in query
    assert params == (
        "2026-01-19",
        "2026-01-26",
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


def test_vacations_and_today_map_rows(monkeypatch):
    cursor = _CursorStub(
        fetchall_values=[
            [
                (3, "Jarno", date(2026, 7, 2), date(2026, 7, 3), datetime(2026, 2, 1, 10, 0), datetime(2026, 2, 1, 10, 0))
            ],
            [
                (4, "Ashley", date(2026, 2, 25), date(2026, 2, 25), datetime(2026, 2, 1, 10, 0), datetime(2026, 2, 1, 10, 0))
            ],
        ]
    )
    _patch_conn(monkeypatch, cursor)
    vac_response = client.get("/vacations?include_past=true")
    assert vac_response.status_code == 200
    assert vac_response.json()[0]["member_name"] == "Jarno"
    today_response = client.get("/vacations/today")
    assert today_response.status_code == 200
    assert today_response.json()[0]["member_name"] == "Ashley"


def test_update_and_delete_vacation_success(monkeypatch):
    cursor = _CursorStub(
        fetchone_values=[
            (7, "Johan", date(2026, 7, 20), date(2026, 7, 21), datetime(2026, 2, 1, 10, 0), datetime(2026, 2, 1, 10, 0)),
            (7,),
        ]
    )
    _patch_conn(monkeypatch, cursor)
    monkeypatch.setattr(
        api,
        "_validate_vacation_payload",
        lambda payload: ("Johan", date(2026, 7, 20), date(2026, 7, 21)),
    )
    update_response = client.put(
        "/vacations/7",
        json={"member_name": "Johan", "start_date": "2026-07-20", "end_date": "2026-07-21"},
    )
    assert update_response.status_code == 200
    assert update_response.json()["id"] == 7

    delete_response = client.delete("/vacations/7")
    assert delete_response.status_code == 200
    assert delete_response.json() == {"deleted": True, "id": 7}
