# DB Change Reminder

Whenever you change the database schema (add/rename/drop columns), run a **full backfill** so historical rows are populated.

Options:
- Full sync endpoint: `POST /sync/full`
- Or run `import_issues.py` for a complete reload

Tip: After schema changes, also restart the backend to pick up any new logic.
