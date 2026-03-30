.PHONY: sync sync-full dev-api dev-api-no-reload dev-frontend dev-frontend-network dev-check \
	serve-local \
	prod-api prod-frontend prod-frontend-network prod-build prod-check db-check \
	install-hooks test-api test-dashboard test semgrep-local

sync:
	curl -sS -X POST http://127.0.0.1:8000/sync

sync-full:
	curl -sS -X POST http://127.0.0.1:8000/sync/full

dev-api:
	uvicorn api:app --host 0.0.0.0 --port 8000 --reload

dev-api-no-reload:
	uvicorn api:app --host 0.0.0.0 --port 8000

dev-frontend:
	test -x dashboard/node_modules/.bin/next || npm --prefix dashboard ci
	npm --prefix dashboard run dev -- -H 127.0.0.1 -p 3000

dev-frontend-network:
	test -x dashboard/node_modules/.bin/next || npm --prefix dashboard ci
	npm --prefix dashboard run dev -- -H 0.0.0.0 -p 3000

dev-check:
	curl -sS http://127.0.0.1:8000/status

serve-local: prod-build
	./scripts/serve-local.sh

prod-api:
	uvicorn api:app --host 0.0.0.0 --port 8000

prod-frontend: prod-build
	npm --prefix dashboard run start -- -H 127.0.0.1 -p 3000

prod-frontend-network: prod-build
	npm --prefix dashboard run start -- -H 0.0.0.0 -p 3000

prod-build:
	npm --prefix dashboard ci
	npm --prefix dashboard run build

prod-check:
	curl -sS http://127.0.0.1:8000/status

db-check:
	python3 -c "import os, psycopg2; conn=psycopg2.connect(host=os.getenv('POSTGRES_HOST','localhost'), port=int(os.getenv('POSTGRES_PORT','5432')), dbname=os.getenv('POSTGRES_DB','jsm_analytics'), user=os.getenv('POSTGRES_USER','jsm'), password=os.getenv('POSTGRES_PASSWORD','changeme')); cur=conn.cursor(); cur.execute('select 1'); print(cur.fetchone()[0]); cur.close(); conn.close()"

install-hooks:
	git config core.hooksPath .githooks

test-api:
	python3 -m pip install -r requirements.txt -r requirements-dev.txt
	python3 -m pytest -q

test-dashboard:
	npm --prefix dashboard install
	npm --prefix dashboard run test

semgrep-local:
	python3 -m pip install -r requirements-dev.txt semgrep==1.136.0
	SEMGREP_TMP_DIR="/tmp/jira-dashboard-semgrep"; \
	mkdir -p "$$SEMGREP_TMP_DIR"; \
	BASE_SHA="$$(git merge-base HEAD origin/main 2>/dev/null || true)"; \
	TARGETS="api.py import_issues.py dashboard/components dashboard/lib dashboard/pages"; \
	XDG_CONFIG_HOME="$$SEMGREP_TMP_DIR" \
	XDG_CACHE_HOME="$$SEMGREP_TMP_DIR" \
	SEMGREP_LOG_FILE="$$SEMGREP_TMP_DIR/semgrep.log" \
	SEMGREP_SETTINGS_FILE="$$SEMGREP_TMP_DIR/settings.yml" \
	SEMGREP_VERSION_CACHE_PATH="$$SEMGREP_TMP_DIR/version-cache" \
	semgrep scan \
		--config auto \
		--config p/owasp-top-ten \
		--exclude dashboard/coverage \
		--exclude dashboard/.next \
		--exclude dashboard/node_modules \
		--exclude dashboard/test-results \
		--exclude dashboard/tests \
		--exclude dashboard/e2e \
		$${BASE_SHA:+--baseline-commit "$$BASE_SHA"} \
		--json \
		--output semgrep-results.json \
		$$TARGETS || true
	test -f semgrep-results.json || printf '{"results":[]}\n' > semgrep-results.json
	BASE_SHA="$$BASE_SHA" python3 scripts/filter_semgrep_results.py

test: test-api test-dashboard
