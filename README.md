# Dashboard

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

### Local security scans

- Secrets in current tree:
  ```bash
  gitleaks dir . --config .gitleaks.toml --redact
  ```
- Secrets in git history:
  ```bash
  gitleaks git --config .gitleaks.toml --redact
  ```

### CI security workflow

GitHub Actions workflow `.github/workflows/security.yml` runs:

- Gitleaks on pull requests and weekly schedule
- Semgrep (`auto` + `p/owasp-top-ten`)
- Dependency scans (`npm audit` and `pip-audit`)

Semgrep is configured to fail on high/critical severity findings when severity metadata is available; otherwise it fails on any findings. Tune rules over time by adjusting configs and ignoring only reviewed false positives.

See `docs/SECURITY_PLAYBOOK.md` for remediation procedures.
