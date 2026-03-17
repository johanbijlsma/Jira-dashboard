import importlib
import sys
from datetime import datetime
from unittest.mock import Mock


def load_import_issues(monkeypatch):
  monkeypatch.setenv("JIRA_EMAIL", "user@example.com")
  monkeypatch.setenv("JIRA_TOKEN", "token")
  sys.modules.pop("import_issues", None)
  import import_issues

  return importlib.reload(import_issues)


def test_normalizers_and_datetime_helpers(monkeypatch):
  mod = load_import_issues(monkeypatch)

  assert mod.norm_request_type({"requestType": {"name": "Incident"}}) == "Incident"
  assert mod.norm_request_type("Service") == "Service"
  assert mod.norm_request_type(None) is None

  assert mod.norm_dropdown({"value": "Email"}) == "Email"
  assert mod.norm_dropdown({"name": "Chat"}) == "Chat"
  assert mod.norm_dropdown("Portal") == "Portal"
  assert mod.norm_dropdown(None) is None

  assert mod.norm_assignee({"displayName": "Alice"}) == "Alice"
  assert mod.norm_assignee({"emailAddress": "alice@example.com"}) == "alice@example.com"
  assert mod.norm_assignee({"accountId": "abc123"}) == "abc123"
  assert mod.norm_assignee("Bob") == "Bob"
  assert mod.norm_assignee(None) is None

  assert mod.norm_organizations(None) == []
  assert mod.norm_organizations([{"name": "Org A"}, {"value": "Org B"}, {"title": "Org A"}, " Org C "]) == [
    "Org A",
    "Org B",
    "Org C",
  ]

  assert mod.parse_jira_datetime("2026-01-01T10:30:00.123+0000") == datetime.strptime(
    "2026-01-01T10:30:00.123+0000", "%Y-%m-%dT%H:%M:%S.%f%z"
  )
  assert mod.parse_jira_datetime("2026-01-01T10:30:00+0000") == datetime.strptime(
    "2026-01-01T10:30:00+0000", "%Y-%m-%dT%H:%M:%S%z"
  )
  assert mod.parse_jira_datetime("invalid") is None

  assert mod.norm_first_response_due_at(None) is None
  assert mod.norm_first_response_due_at({"ongoingCycle": {"breachTime": {"iso8601": "2026-01-01T10:30:00+0000"}}}) == datetime(
    2026, 1, 1, 10, 30
  )


def test_api_search_retries_on_rate_limit(monkeypatch):
  mod = load_import_issues(monkeypatch)

  response_429 = Mock(status_code=429, headers={"Retry-After": "7"})
  response_ok = Mock(status_code=200, headers={})
  response_ok.json.return_value = {"issues": [], "isLast": True}
  response_ok.raise_for_status = Mock()

  post = Mock(side_effect=[response_429, response_ok])
  sleep = Mock()
  monkeypatch.setattr(mod.s, "post", post)
  monkeypatch.setattr(mod.time, "sleep", sleep)

  data = mod.api_search("next-token")

  assert data == {"issues": [], "isLast": True}
  assert sleep.call_args[0][0] == 7
  assert post.call_count == 2
