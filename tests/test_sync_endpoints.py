from datetime import datetime

from fastapi.testclient import TestClient

import api


client = TestClient(api.app)


def test_sync_status_exposes_runtime_state(monkeypatch):
    monkeypatch.setattr(api, "get_last_sync", lambda: datetime(2026, 2, 17, 10, 30, 0))
    monkeypatch.setattr(api, "_sync_running", True)
    monkeypatch.setattr(api, "_sync_last_run", "2026-02-17T10:31:00Z")
    monkeypatch.setattr(api, "_sync_last_error", None)
    monkeypatch.setattr(api, "_sync_last_result", {"upserts": 12})

    response = client.get("/sync/status")
    assert response.status_code == 200
    data = response.json()
    assert data["running"] is True
    assert data["last_run"] == "2026-02-17T10:31:00Z"
    assert data["last_result"] == {"upserts": 12}
    assert data["last_sync"] == "2026-02-17T10:30:00"


def test_sync_endpoint_queues_background_task(monkeypatch):
    calls = []

    def fake_run_sync_once(full: bool = False):
        calls.append(full)
        return {"started": True}

    monkeypatch.setattr(api, "run_sync_once", fake_run_sync_once)

    response = client.post("/sync")
    assert response.status_code == 200
    assert response.json() == {"queued": True}
    assert calls == [False]


def test_sync_full_endpoint_queues_full_sync(monkeypatch):
    calls = []

    def fake_run_sync_once(full: bool = False):
        calls.append(full)
        return {"started": True}

    monkeypatch.setattr(api, "run_sync_once", fake_run_sync_once)

    response = client.post("/sync/full")
    assert response.status_code == 200
    assert response.json() == {"queued": True, "mode": "full"}
    assert calls == [True]
