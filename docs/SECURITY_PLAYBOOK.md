# Security playbook

## Baseline

- Gebruik Composer audit en npm audit in CI.
- Houd `.env` buiten versiebeheer.
- Bewaar Jira- en Teams-secrets alleen in deployment secrets of lokale env-bestanden.

## Lokale checks

```bash
composer audit
npm audit
php artisan test
```
