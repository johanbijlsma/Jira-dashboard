COMPOSE_FILE=docker-compose.prod.yml
COMPOSE=docker compose -f $(COMPOSE_FILE)

.PHONY: up down logs logs-api logs-dashboard ps rebuild restart sync sync-full

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
