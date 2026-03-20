from datetime import datetime

from fastapi.testclient import TestClient
import psycopg2

import api


client = TestClient(api.app)


def test_sync_status_exposes_runtime_state(monkeypatch):
    monkeypatch.setattr(
        api,
        "get_sync_status_payload",
        lambda: {
            "running": True,
            "last_run": "2026-02-17T10:31:00Z",
            "last_error": None,
            "last_result": {"upserts": 12},
            "last_sync": "2026-02-17T10:30:00Z",
            "successful_runs": [],
            "last_failed_run": None,
            "last_full_sync": None,
        },
    )

    response = client.get("/sync/status")
    assert response.status_code == 200
    data = response.json()
    assert data["running"] is True
    assert data["last_run"] == "2026-02-17T10:31:00Z"
    assert data["last_result"] == {"upserts": 12}
    assert data["last_sync"] == "2026-02-17T10:30:00Z"


def test_sync_status_returns_503_when_database_is_unavailable(monkeypatch):
    def _raise_db_error():
        raise psycopg2.OperationalError("connection refused")

    monkeypatch.setattr(api, "get_sync_status_payload", _raise_db_error)

    response = client.get("/sync/status")

    assert response.status_code == 503
    assert response.json()["error"] == "database_unavailable"
    assert "connection refused" in response.json()["message"]


def test_get_sync_status_payload_returns_cached_payload_when_fresh(monkeypatch):
    cached_payload = {"running": False, "recent_runs": [], "successful_runs": []}
    monkeypatch.setattr(api, "_sync_running", False)
    monkeypatch.setattr(api, "_sync_status_cache_payload", cached_payload)
    monkeypatch.setattr(api, "_sync_status_cache_checked_at", 100.0)
    monkeypatch.setattr(api.time, "time", lambda: 103.0)
    monkeypatch.setattr(api, "ensure_schema", lambda: (_ for _ in ()).throw(AssertionError("should not query db")))

    payload = api.get_sync_status_payload()

    assert payload is cached_payload


def test_get_sync_status_payload_builds_and_caches_payload(monkeypatch):
    class _Cursor:
        def __init__(self):
            self.fetchall_values = [
                [(datetime(2026, 2, 17, 10, 31), None, "incremental", "manual", True, 12, datetime(2026, 2, 17, 10, 30), None)],
                [(datetime(2026, 2, 17, 10, 31), None, "incremental", "manual", 12, datetime(2026, 2, 17, 10, 30))],
            ]
            self.fetchone_values = [None, None]

        def execute(self, query, params=None):
            self.last_query = query

        def fetchall(self):
            return self.fetchall_values.pop(0)

        def fetchone(self):
            return self.fetchone_values.pop(0)

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    class _Conn:
        def __init__(self):
            self.cursor_obj = _Cursor()

        def cursor(self):
            return self.cursor_obj

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(api, "_sync_running", False)
    monkeypatch.setattr(api, "_sync_last_run", "2026-02-17T10:31:00Z")
    monkeypatch.setattr(api, "_sync_last_error", None)
    monkeypatch.setattr(api, "_sync_last_result", {"upserts": 12})
    monkeypatch.setattr(api, "_sync_status_cache_payload", None)
    monkeypatch.setattr(api, "_sync_status_cache_checked_at", 0.0)
    monkeypatch.setattr(api.time, "time", lambda: 200.0)
    monkeypatch.setattr(api, "ensure_schema", lambda: None)
    monkeypatch.setattr(api, "get_last_sync", lambda: datetime(2026, 2, 17, 10, 30))
    monkeypatch.setattr(api, "conn", lambda: _Conn())

    payload = api.get_sync_status_payload()

    assert payload["running"] is False
    assert payload["recent_runs"][0]["upserts"] == 12
    assert payload["successful_runs"][0]["trigger_type"] == "manual"
    assert api._sync_status_cache_payload == payload
    assert api._sync_status_cache_checked_at == 200.0


def test_sync_endpoint_queues_background_task(monkeypatch):
    calls = []

    def fake_run_sync_once(full: bool = False, trigger_type: str = "manual"):
        calls.append((full, trigger_type))
        return {"started": True}

    monkeypatch.setattr(api, "run_sync_once", fake_run_sync_once)

    response = client.post("/sync")
    assert response.status_code == 200
    assert response.json() == {"queued": True}
    assert calls == [(False, "manual")]


def test_sync_full_endpoint_queues_full_sync(monkeypatch):
    calls = []

    def fake_run_sync_once(full: bool = False, trigger_type: str = "manual"):
        calls.append((full, trigger_type))
        return {"started": True}

    monkeypatch.setattr(api, "run_sync_once", fake_run_sync_once)

    response = client.post("/sync/full")
    assert response.status_code == 200
    assert response.json() == {"queued": True, "mode": "full"}
    assert calls == [(True, "manual")]
