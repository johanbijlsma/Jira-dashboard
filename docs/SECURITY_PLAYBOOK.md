# Security Playbook

## 1) Secret detected: immediate response

1. Revoke and rotate the credential immediately in the source system.
2. Treat leaked credentials as compromised, even if exposure looks limited.
3. Identify where the secret was used and check access logs for abuse.
4. Open an incident ticket and document timeline, impact, and remediation.
5. Add or tune detection rules to prevent recurrence.

## 2) Remove secret from current HEAD

If the secret exists only in the latest unpushed commits:

1. Remove the secret from tracked files.
2. Replace with environment variables and update examples only.
3. Commit the cleanup.

If already pushed, continue with history rewrite below.

## 3) Rewrite history (git filter-repo)

Use this only when secrets were committed and pushed. Rewriting history changes commit SHAs.

1. Ensure all collaborators are informed before rewrite.
2. Install `git-filter-repo` (see official project docs).
3. Rewrite affected files or text patterns.
4. Force push rewritten branches and tags.
5. Require collaborators to re-clone or hard-reset to the new history.

Example pattern replacement file (`replacements.txt`):

```
regex:(?i)old_secret_value==>REDACTED
```

Example command:

```bash
git filter-repo --replace-text replacements.txt
```

Then force push:

```bash
git push --force --all
git push --force --tags
```

## 4) False positives (gitleaks)

1. Confirm the finding is not a real credential.
2. Prefer narrowing scope via file/path allowlist over broad regex ignores.
3. Add exceptions to `.gitleaks.toml` with clear reason.
4. Keep allowlists minimal and review periodically.

## 5) Verification checklist

1. Run local scan: `pre-commit run --all-files`
2. Run local history scan before major releases:
   `gitleaks git --config .gitleaks.toml --redact`
3. Ensure CI security workflow is green before merge.
