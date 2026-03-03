from datetime import date, datetime

from fastapi.testclient import TestClient

import api


client = TestClient(api.app)


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
    monkeypatch.setattr(
        api,
        "get_servicedesk_config",
        lambda: {
            "team_members": ["Johan"],
            "onderwerpen": ["Onderwerp A"],
            "updated_at": "2026-02-25T10:00:00Z",
            "team_member_avatars": {},
        },
    )

    response = client.put(
        "/config/servicedesk",
        json={"team_members": ["Johan"], "onderwerpen": ["Onderwerp A"]},
    )
    assert response.status_code == 200
    assert response.json()["team_members"] == ["Johan"]


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


def test_metrics_ttr_weekly_by_type_maps_rows(monkeypatch):
    cursor = _CursorStub(
        fetchall_values=[[(datetime(2026, 1, 19, 0, 0), "Vraag", 12.5, 10.0, 4)]]
    )
    _patch_conn(monkeypatch, cursor)

    response = client.get("/metrics/time_to_resolution_weekly_by_type?date_from=2026-01-19&date_to=2026-01-26")
    assert response.status_code == 200
    data = response.json()
    assert data[0]["request_type"] == "Vraag"
    assert data[0]["avg_hours"] == 12.5
    assert data[0]["median_hours"] == 10.0
    assert data[0]["n"] == 4


def test_servicedesk_config_endpoint(monkeypatch):
    monkeypatch.setattr(
        api,
        "get_servicedesk_config",
        lambda: {
            "team_members": ["Johan"],
            "onderwerpen": ["Koppelingen"],
            "updated_at": "2026-02-25T10:00:00Z",
            "team_member_avatars": {"Johan": "http://avatar"},
        },
    )
    response = client.get("/config/servicedesk")
    assert response.status_code == 200
    assert response.json()["team_member_avatars"]["Johan"] == "http://avatar"


def test_insights_config_endpoint(monkeypatch):
    monkeypatch.setattr(api, "INSIGHTS_ENABLED", True)
    monkeypatch.setattr(
        api,
        "get_insights_config",
        lambda: {
            "metric_config": {
                "backlog_gap": {
                    "min_abs_delta": 3.0,
                    "min_rel_delta": 0.6,
                    "trend_delta_min": 2.0,
                    "trend_rel_delta_min": 0.25,
                    "min_sample_size": 12.0,
                }
            },
            "updated_at": "2026-03-02T10:00:00Z",
        },
    )
    response = client.get("/config/insights")
    assert response.status_code == 200
    assert response.json()["metric_config"]["backlog_gap"]["min_abs_delta"] == 3.0


def test_update_insights_config_rejects_negative_values(monkeypatch):
    monkeypatch.setattr(api, "INSIGHTS_ENABLED", True)
    response = client.put(
        "/config/insights",
        json={
            "metric_config": {
                "backlog_gap": {
                    "min_abs_delta": -1,
                    "min_rel_delta": 0.6,
                    "trend_delta_min": 2.0,
                    "trend_rel_delta_min": 0.25,
                    "min_sample_size": 12.0,
                }
            }
        },
    )
    assert response.status_code == 400
    assert "mag niet negatief" in response.json()["detail"].lower()


def test_update_insights_config_success(monkeypatch):
    monkeypatch.setattr(api, "INSIGHTS_ENABLED", True)
    cursor = _CursorStub(fetchone_values=[({"backlog_gap": {"min_abs_delta": 4.0}}, datetime(2026, 3, 2, 10, 0))])
    _patch_conn(monkeypatch, cursor)
    monkeypatch.setattr(
        api,
        "_sanitize_metric_config",
        lambda cfg: {
            "backlog_gap": {
                "min_abs_delta": 4.0,
                "min_rel_delta": 0.6,
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
        },
    )
    monkeypatch.setattr(
        api,
        "get_insights_config",
        lambda: {
            "metric_config": {
                "backlog_gap": {
                    "min_abs_delta": 4.0,
                    "min_rel_delta": 0.6,
                    "trend_delta_min": 2.0,
                    "trend_rel_delta_min": 0.25,
                    "min_sample_size": 12.0,
                }
            },
            "updated_at": "2026-03-02T10:00:00Z",
        },
    )
    response = client.put(
        "/config/insights",
        json={
            "metric_config": {
                "backlog_gap": {
                    "min_abs_delta": 4.0,
                    "min_rel_delta": 0.6,
                    "trend_delta_min": 2.0,
                    "trend_rel_delta_min": 0.25,
                    "min_sample_size": 12.0,
                }
            }
        },
    )
    assert response.status_code == 200
    assert response.json()["metric_config"]["backlog_gap"]["min_abs_delta"] == 4.0


def test_reset_insights_config_to_defaults(monkeypatch):
    monkeypatch.setattr(api, "INSIGHTS_ENABLED", True)
    cursor = _CursorStub()
    _patch_conn(monkeypatch, cursor)
    monkeypatch.setattr(
        api,
        "get_insights_config",
        lambda: {
            "metric_config": {
                "backlog_gap": {
                    "min_abs_delta": 3.0,
                    "min_rel_delta": 0.6,
                    "trend_delta_min": 2.0,
                    "trend_rel_delta_min": 0.25,
                    "min_sample_size": 12.0,
                }
            },
            "updated_at": "2026-03-02T12:00:00Z",
        },
    )
    response = client.post("/config/insights/reset")
    assert response.status_code == 200
    assert response.json()["metric_config"]["backlog_gap"]["trend_delta_min"] == 2.0


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


def test_insights_trends_contract_and_anomaly(monkeypatch):
    monkeypatch.setattr(api, "INSIGHTS_ENABLED", True)

    def inflow_stub(**kwargs):
        if kwargs["date_from"] == "2026-02-01":
            return [
                {"week": "2026-01-18T00:00:00", "incoming_count": 10, "closed_count": 9},
                {"week": "2026-01-25T00:00:00", "incoming_count": 11, "closed_count": 10},
                {"week": "2026-02-01T00:00:00", "incoming_count": 9, "closed_count": 9},
                {"week": "2026-02-08T00:00:00", "incoming_count": 10, "closed_count": 10},
            ]
        return [
            {"week": "2026-02-15T00:00:00", "incoming_count": 14, "closed_count": 10},
            {"week": "2026-02-22T00:00:00", "incoming_count": 25, "closed_count": 8},
        ]

    def ttr_stub(**kwargs):
        if kwargs["date_from"] == "2026-02-01":
            return [
                {"week": "2026-01-18T00:00:00", "request_type": "Incident", "avg_hours": 5.0, "n": 4},
                {"week": "2026-01-25T00:00:00", "request_type": "Incident", "avg_hours": 4.8, "n": 4},
                {"week": "2026-02-01T00:00:00", "request_type": "Incident", "avg_hours": 5.2, "n": 4},
                {"week": "2026-02-08T00:00:00", "request_type": "Incident", "avg_hours": 5.1, "n": 4},
            ]
        return [
            {"week": "2026-02-15T00:00:00", "request_type": "Incident", "avg_hours": 7.0, "n": 4},
            {"week": "2026-02-22T00:00:00", "request_type": "Incident", "avg_hours": 9.0, "n": 4},
        ]

    def tfr_stub(**kwargs):
        if kwargs["date_from"] == "2026-02-01":
            return [
                {"week": "2026-01-18T00:00:00", "avg_hours": 1.0, "n": 6},
                {"week": "2026-01-25T00:00:00", "avg_hours": 1.1, "n": 6},
                {"week": "2026-02-01T00:00:00", "avg_hours": 1.2, "n": 6},
                {"week": "2026-02-08T00:00:00", "avg_hours": 1.0, "n": 6},
            ]
        return [
            {"week": "2026-02-15T00:00:00", "avg_hours": 1.4, "n": 6},
            {"week": "2026-02-22T00:00:00", "avg_hours": 1.5, "n": 6},
        ]

    monkeypatch.setattr(api, "inflow_vs_closed_weekly", inflow_stub)
    monkeypatch.setattr(api, "time_to_resolution_weekly_by_type", ttr_stub)
    monkeypatch.setattr(api, "time_to_first_response_weekly", tfr_stub)

    response = client.get("/insights/trends?date_from=2026-02-15&date_to=2026-02-28")
    assert response.status_code == 200
    data = response.json()
    assert "series" in data and len(data["series"]) == 3
    assert "metric_config" in data
    backlog = next(x for x in data["series"] if x["metric"] == "backlog_gap")
    assert "threshold_used" in backlog
    assert "baseline_mean" in backlog
    assert "explainability" in backlog["points"][-1]
    assert backlog["points"][-1]["is_anomaly"] is True


def test_insights_highlights_returns_cards(monkeypatch):
    monkeypatch.setattr(api, "INSIGHTS_ENABLED", True)
    monkeypatch.setattr(
        api,
        "_build_trends_payload",
        lambda **kwargs: {
            "window": {"from": "2026-02-15", "to": "2026-02-28"},
            "baseline_window": {"from": "2026-01-18", "to": "2026-01-31"},
            "generated_at": "2026-03-02T10:00:00Z",
            "series": [
                {
                    "metric": "backlog_gap",
                    "label": "Backlog gap",
                    "unit": "tickets/week",
                        "points": [
                            {
                                "week": "2026-02-15",
                                "actual": 2.0,
                                "expected": 1.0,
                                "is_anomaly": False,
                                "confidence": "medium",
                                "sample_size": 18,
                                "score": 0.9,
                            },
                            {
                                "week": "2026-02-22",
                                "actual": 6.0,
                                "expected": 1.0,
                                "is_anomaly": True,
                                "confidence": "high",
                                "sample_size": 22,
                                "score": 1.8,
                            },
                        ],
                    }
                ],
            },
    )
    response = client.get("/insights/highlights?date_from=2026-02-15&date_to=2026-02-28")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data["cards"], list)
    assert "metric_config" in data
    assert "explainability" in data["cards"][0]
    assert "decision_score" in data["cards"][0]
    assert isinstance(data["cards"][0]["decision_score"], int)
    assert any(card["type"] == "anomaly" for card in data["cards"])


def test_insights_drivers_uses_dimensions(monkeypatch):
    monkeypatch.setattr(api, "INSIGHTS_ENABLED", True)
    calls = []

    def drivers_stub(**kwargs):
        calls.append(kwargs["dimension"])
        return [
            {
                "dimension": kwargs["dimension"],
                "category": "A",
                "current_count": 10,
                "baseline_count": 4,
                "delta": 6,
                "contribution_score": 5.1,
                "contribution_pct": 100.0,
            }
        ]

    monkeypatch.setattr(api, "_fetch_driver_rows_for_dimension", drivers_stub)
    response = client.get("/insights/drivers?date_from=2026-02-15&date_to=2026-02-28&servicedesk_only=true")
    assert response.status_code == 200
    data = response.json()
    assert len(data["drivers"]) == 4
    assert set(calls) == {"onderwerp", "organization", "priority", "assignee"}
