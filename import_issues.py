import os
import time
import json
import psycopg2
import requests

JIRA_BASE = os.environ.get("JIRA_BASE", "https://planningsagenda.atlassian.net").rstrip("/")
JIRA_EMAIL = os.environ["JIRA_EMAIL"]
JIRA_TOKEN = os.environ["JIRA_TOKEN"]

PROJECT_KEY = os.environ.get("JIRA_PROJECT", "SD")
JQL = os.environ.get("JQL", f'project = {PROJECT_KEY} AND "cf[10010]" is not EMPTY ORDER BY created ASC')

REQUEST_TYPE_FIELD = os.environ.get("REQUEST_TYPE_FIELD", "customfield_10010")
ONDERWERP_FIELD = os.environ.get("ONDERWERP_FIELD", "customfield_10143")
ORGANIZATION_FIELD = os.environ.get("ORGANIZATION_FIELD", "customfield_10002")

DB_HOST = os.environ.get("DB_HOST", "localhost")
DB_PORT = int(os.environ.get("DB_PORT", "5432"))
DB_NAME = os.environ.get("DB_NAME", "jsm_analytics")
DB_USER = os.environ.get("DB_USER", "jsm")
DB_PASSWORD = os.environ.get("DB_PASSWORD", "jsm_password")

MAX_RESULTS = int(os.environ.get("MAX_RESULTS", "100"))

def conn():
    return psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD
    )

s = requests.Session()
s.auth = (JIRA_EMAIL, JIRA_TOKEN)
s.headers.update({"Accept": "application/json", "Content-Type": "application/json"})

def api_search(next_page_token=None):
    payload = {
        "jql": JQL,
        "maxResults": MAX_RESULTS,
        "fields": [
            "key",
            "created",
            "updated",
            "resolutiondate",
            "status",
            "priority",
            "assignee",
            REQUEST_TYPE_FIELD,
            ONDERWERP_FIELD,
            ORGANIZATION_FIELD,
        ],
    }
    if next_page_token:
        payload["nextPageToken"] = next_page_token

    r = s.post(f"{JIRA_BASE}/rest/api/3/search/jql", data=json.dumps(payload), timeout=60)
    if r.status_code == 429:
        retry = int(r.headers.get("Retry-After", "5"))
        time.sleep(retry)
        return api_search(next_page_token)
    r.raise_for_status()
    return r.json()

def norm_request_type(v):
    # JSM Request Type komt als object met requestType.name
    if isinstance(v, dict):
        rt = v.get("requestType") or {}
        name = rt.get("name")
        if name:
            return name
    return None if v is None else str(v)

def norm_dropdown(v):
    # Dropdown option komt meestal als dict met value
    if isinstance(v, dict):
        return v.get("value") or v.get("name")
    return None if v is None else str(v)

def norm_assignee(v):
    if isinstance(v, dict):
        return v.get("displayName") or v.get("emailAddress") or v.get("accountId")
    return None if v is None else str(v)

def norm_organizations(v):
    if v is None:
        return []
    items = v if isinstance(v, list) else [v]
    out = []
    for item in items:
        name = None
        if isinstance(item, dict):
            name = item.get("name") or item.get("value") or item.get("title")
        elif item is not None:
            name = str(item)
        name = (name or "").strip()
        if name:
            out.append(name)
    return list(dict.fromkeys(out))

def main():
    inserted = 0
    page = 0
    next_token = None

    with conn() as c, c.cursor() as cur:
        cur.execute(
            """
            create table if not exists issues (
              issue_key text primary key,
              request_type text,
              onderwerp_logging text,
              organizations text[],
              created_at timestamptz,
              resolved_at timestamptz,
              updated_at timestamptz,
              priority text,
              assignee text,
              current_status text
            );
            """
        )
        cur.execute("alter table issues add column if not exists request_type text;")
        cur.execute("alter table issues add column if not exists onderwerp_logging text;")
        cur.execute("alter table issues add column if not exists organizations text[];")
        cur.execute("alter table issues add column if not exists created_at timestamptz;")
        cur.execute("alter table issues add column if not exists resolved_at timestamptz;")
        cur.execute("alter table issues add column if not exists updated_at timestamptz;")
        cur.execute("alter table issues add column if not exists priority text;")
        cur.execute("alter table issues add column if not exists assignee text;")
        cur.execute("alter table issues add column if not exists current_status text;")
        c.commit()
        while True:
            page += 1
            data = api_search(next_token)

            issues = data.get("issues", [])
            if not issues:
                print("No more issues.")
                break

            for it in issues:
                f = it["fields"]
                issue_key = it["key"]

                request_type = norm_request_type(f.get(REQUEST_TYPE_FIELD))
                onderwerp = norm_dropdown(f.get(ONDERWERP_FIELD))

                created_at = f.get("created")
                updated_at = f.get("updated")
                resolved_at = f.get("resolutiondate")

                status = (f.get("status") or {}).get("name")
                priority = (f.get("priority") or {}).get("name")
                assignee = norm_assignee(f.get("assignee"))
                organizations = norm_organizations(f.get(ORGANIZATION_FIELD))

                cur.execute(
                    """
                    insert into issues(issue_key, request_type, onderwerp_logging, organizations, created_at, resolved_at, updated_at, priority, assignee, current_status)
                    values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    on conflict (issue_key) do update set
                      request_type=excluded.request_type,
                      onderwerp_logging=excluded.onderwerp_logging,
                      organizations=excluded.organizations,
                      created_at=excluded.created_at,
                      resolved_at=excluded.resolved_at,
                      updated_at=excluded.updated_at,
                      priority=excluded.priority,
                      assignee=excluded.assignee,
                      current_status=excluded.current_status
                    """,
                    (
                        issue_key,
                        request_type,
                        onderwerp,
                        organizations if organizations else None,
                        created_at,
                        resolved_at,
                        updated_at,
                        priority,
                        assignee,
                        status,
                    ),
                )
                inserted += 1

            c.commit()

            next_token = data.get("nextPageToken")
            is_last = data.get("isLast")
            print(f"Page {page}: upserted {len(issues)} issues (total upserts this run: {inserted}). isLast={is_last}")

            if is_last or not next_token:
                break

            time.sleep(0.1)

    print("Done.")

if __name__ == "__main__":
    main()
