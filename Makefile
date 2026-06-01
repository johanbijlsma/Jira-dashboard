.PHONY: dev serve schedule queue vite install build test migrate fresh sync-now sync-full-now

install:
	composer install
	npm install

dev:
	./bin/dev.sh

serve:
	php artisan serve

queue:
	php artisan queue:work --tries=1

schedule:
	php artisan schedule:work

vite:
	npm run dev

build:
	npm run build

test:
	php artisan test

migrate:
	php artisan migrate

fresh:
	php artisan migrate:fresh

sync-now:
	php artisan dashboard:sync-now

sync-full-now:
	php artisan dashboard:sync-now --full
