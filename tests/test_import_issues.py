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
  assert mod.norm_time_to_resolution_due_at({"ongoingCycle": {"breachTime": {"iso8601": "2026-01-01T11:30:00+0000"}}}) == datetime(
    2026, 1, 1, 11, 30
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


def test_api_search_skips_empty_ttr_field(monkeypatch):
  mod = load_import_issues(monkeypatch)
  response_ok = Mock(status_code=200, headers={})
  response_ok.json.return_value = {"issues": [], "isLast": True}
  response_ok.raise_for_status = Mock()
  post = Mock(return_value=response_ok)
  monkeypatch.setattr(mod.s, "post", post)
  monkeypatch.setattr(mod, "TIME_TO_RESOLUTION_SLA_FIELD", "")

  mod.api_search()

  payload = post.call_args.kwargs["data"]
  assert '""' not in payload


class CursorStub:
  def __init__(self):
    self.executed = []

  def execute(self, query, params=None):
    self.executed.append((query, params))

  def __enter__(self):
    return self

  def __exit__(self, exc_type, exc, tb):
    return False


class ConnStub:
  def __init__(self, cursor):
    self._cursor = cursor
    self.commits = 0

  def cursor(self):
    return self._cursor

  def commit(self):
    self.commits += 1

  def __enter__(self):
    return self

  def __exit__(self, exc_type, exc, tb):
    return False


def test_main_upserts_issue_pages_and_stops_at_is_last(monkeypatch, capsys):
  mod = load_import_issues(monkeypatch)
  cursor = CursorStub()
  connection = ConnStub(cursor)
  monkeypatch.setattr(mod, "conn", lambda: connection)
  monkeypatch.setattr(mod.time, "sleep", Mock())

  pages = [
    {
      "issues": [
        {
          "key": "SD-101",
          "fields": {
            mod.REQUEST_TYPE_FIELD: {"requestType": {"name": "Incident"}},
            mod.ONDERWERP_FIELD: {"value": "Email"},
            mod.ORGANIZATION_FIELD: [{"name": "Org A"}],
            mod.FIRST_RESPONSE_SLA_FIELD: {"ongoingCycle": {"breachTime": {"iso8601": "2026-01-01T10:30:00+0000"}}},
            mod.TIME_TO_RESOLUTION_SLA_FIELD: {"ongoingCycle": {"breachTime": {"iso8601": "2026-01-01T11:30:00+0000"}}},
            "created": "2026-01-01T09:00:00.000+0000",
            "updated": "2026-01-01T10:00:00.000+0000",
            "resolutiondate": None,
            "status": {"name": "In Progress"},
            "priority": {"name": "High"},
            "assignee": {"displayName": "Alice"},
          },
        }
      ],
      "nextPageToken": "next-1",
      "isLast": False,
    },
    {
      "issues": [
        {
          "key": "SD-102",
          "fields": {
            mod.REQUEST_TYPE_FIELD: "Service",
            mod.ONDERWERP_FIELD: {"name": "Chat"},
            mod.ORGANIZATION_FIELD: ["Org B", "Org B"],
            mod.FIRST_RESPONSE_SLA_FIELD: None,
            mod.TIME_TO_RESOLUTION_SLA_FIELD: None,
            "created": "2026-01-02T09:00:00.000+0000",
            "updated": "2026-01-02T10:00:00.000+0000",
            "resolutiondate": "2026-01-02T12:00:00.000+0000",
            "status": {"name": "Done"},
            "priority": {"name": "Low"},
            "assignee": "Bob",
          },
        }
      ],
      "nextPageToken": None,
      "isLast": True,
    },
  ]
  api_search = Mock(side_effect=pages)
  monkeypatch.setattr(mod, "api_search", api_search)

  mod.main()

  assert api_search.call_args_list == [((None,), {}), (("next-1",), {})]
  assert connection.commits == 3
  insert_params = [params for query, params in cursor.executed if "insert into issues" in query.lower()]
  assert len(insert_params) == 2
  assert insert_params[0][0] == "SD-101"
  assert insert_params[0][1] == "Incident"
  assert insert_params[0][2] == "Email"
  assert insert_params[0][3] == ["Org A"]
  assert insert_params[0][8] == "Alice"
  assert insert_params[1][0] == "SD-102"
  assert insert_params[1][3] == ["Org B"]
  assert "Page 1: upserted 1 issues" in capsys.readouterr().out


def test_main_stops_when_search_returns_no_issues(monkeypatch, capsys):
  mod = load_import_issues(monkeypatch)
  cursor = CursorStub()
  connection = ConnStub(cursor)
  monkeypatch.setattr(mod, "conn", lambda: connection)
  monkeypatch.setattr(mod, "api_search", Mock(return_value={"issues": [], "isLast": True}))
  sleep = Mock()
  monkeypatch.setattr(mod.time, "sleep", sleep)

  mod.main()

  assert connection.commits == 1
  assert not sleep.called
  output = capsys.readouterr().out
  assert "No more issues." in output
  assert "Done." in output
