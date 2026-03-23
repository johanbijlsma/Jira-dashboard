# Dashboard

## Local development

Use the same native stack locally as in production:
- Postgres running on your machine
- FastAPI via `make dev-api`
- Next.js via `make dev-frontend`

Create `.env` from [`.env.example`](/Users/johanbijlsma/Repos/Jira-dashboard/.env.example), install backend and frontend dependencies, make sure Postgres is reachable on the configured host/port, then verify with `make db-check` and `make dev-check`. See [LOCAL_SETUP.md](/Users/johanbijlsma/Repos/Jira-dashboard/docs/LOCAL_SETUP.md) for the full flow.

## Security baseline

This repository includes baseline security checks for secrets, SAST, and dependency vulnerabilities.

### Local setup

1. Install pre-commit:
   ```bash
   python -m pip install pre-commit
   ```
2. Install hooks:
   ```bash
   pre-commit install
   ```
3. Run all local hooks:
   ```bash
   pre-commit run --all-files
   ```
4. Install Python dev tools:
   ```bash
   python3 -m pip install -r requirements.txt -r requirements-dev.txt
   ```

### Local security scans

- Secrets in current tree:
  ```bash
  gitleaks dir . --config .gitleaks.toml --redact
  ```
- Secrets in git history:
  ```bash
  gitleaks git --config .gitleaks.toml --redact
  ```
- Semgrep against the same default app-code scope as CI:
  ```bash
  make semgrep-local
  ```
  This target installs the pinned Semgrep CLI automatically before scanning.

### CI security workflow

GitHub Actions workflow `.github/workflows/security.yml` runs:

- Gitleaks on pull requests and weekly schedule
- Semgrep (`auto` + `p/owasp-top-ten`)
- Dependency scans (`npm audit` and `pip-audit`)

Semgrep is scoped to application code only: `api.py`, `import_issues.py`, `dashboard/components`, `dashboard/lib`, and `dashboard/pages`. Workflow files, CI helpers, generated assets, and test fixtures stay outside the default scan scope unless we intentionally expand it.

On pull requests, the Semgrep gate only blocks on findings that land on lines changed by the PR. When it fails, the job logs each blocking finding with file, line, rule id, severity, and message so the fix is directly diagnosable from CI output.

See `docs/SECURITY_PLAYBOOK.md` for remediation procedures.
