.PHONY: sync sync-full dev-api dev-api-no-reload dev-frontend dev-check \
	prod-api prod-frontend prod-build prod-check db-check \
	install-hooks test-api test-dashboard test

sync:
	curl -sS -X POST http://127.0.0.1:8000/sync

sync-full:
	curl -sS -X POST http://127.0.0.1:8000/sync/full

dev-api:
	uvicorn api:app --host 0.0.0.0 --port 8000 --reload

dev-api-no-reload:
	uvicorn api:app --host 0.0.0.0 --port 8000

dev-frontend:
	npm --prefix dashboard run dev

dev-check:
	curl -sS http://127.0.0.1:8000/status

prod-api:
	uvicorn api:app --host 0.0.0.0 --port 8000

prod-frontend:
	npm --prefix dashboard run start

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

test: test-api test-dashboard
