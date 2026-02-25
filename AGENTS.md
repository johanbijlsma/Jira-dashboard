# Repository Workflow Rules

## Branching
- Never make code changes directly on `main` or `master`.
- Before making changes, ensure the current branch is a feature branch.
- If current branch is `main` or `master`, create and switch to a new branch first.
- Branch name format: `feature/<short-description>`.
- If no name is provided by the user, propose one and use it before editing.

## Commits
- Keep changes on the active feature branch.
- Only commit/push when the user asks.

## PR Quality Gates
- When preparing a PR, backend tests must pass.
- When preparing a PR, frontend tests must pass.
- Backend code coverage must be at least 80%.
- Frontend code coverage must be at least 80%.
- If tests fail or coverage is below threshold, update code/tests until all gates pass before marking PR ready.

## Scope Clarification
- If it is unclear whether a requested rule/change applies only to the current branch or to the whole repository, ask the user first before applying it.
