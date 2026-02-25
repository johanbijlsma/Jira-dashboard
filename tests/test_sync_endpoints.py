from fastapi.testclient import TestClient

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
