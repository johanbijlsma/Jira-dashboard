COMPOSE_FILE=docker-compose.prod.yml
COMPOSE=docker compose -f $(COMPOSE_FILE)
DEV_COMPOSE_FILE=docker-compose.yml
DEV_COMPOSE=docker compose -f $(DEV_COMPOSE_FILE)

.PHONY: up down logs logs-api logs-dashboard ps rebuild restart sync sync-full \
	dev-up dev-down dev-logs dev-ps dev-rebuild dev-restart dev-api dev-api-no-reload dev-frontend \
	install-hooks test-api test-dashboard test

up:
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f

logs-api:
	$(COMPOSE) logs -f api

logs-dashboard:
	$(COMPOSE) logs -f dashboard

ps:
	$(COMPOSE) ps

rebuild:
	$(COMPOSE) build --no-cache
	$(COMPOSE) up -d

restart:
	$(COMPOSE) restart

sync:
	curl -sS -X POST http://127.0.0.1:8000/sync

sync-full:
	curl -sS -X POST http://127.0.0.1:8000/sync/full

dev-up:
	$(DEV_COMPOSE) up -d --build

dev-down:
	$(DEV_COMPOSE) down

dev-logs:
	$(DEV_COMPOSE) logs -f

dev-ps:
	$(DEV_COMPOSE) ps

dev-rebuild:
	$(DEV_COMPOSE) build --no-cache
	$(DEV_COMPOSE) up -d

dev-restart:
	$(DEV_COMPOSE) restart

dev-api:
	uvicorn api:app --host 0.0.0.0 --port 8000 --reload

dev-api-no-reload:
	uvicorn api:app --host 0.0.0.0 --port 8000

dev-frontend:
	npm --prefix dashboard run dev

install-hooks:
	git config core.hooksPath .githooks

test-api:
	python -m pytest -q

test-dashboard:
	npm --prefix dashboard run test

test: test-api test-dashboard
