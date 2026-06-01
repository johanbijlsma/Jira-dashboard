# Deploy

## Productievereisten

- PHP 8.2+
- Composer
- MySQL 8
- Node.js 20+ voor buildstap
- Een queue worker voor sync- en achtergrondtaken
- Een scheduler die elke minuut `php artisan schedule:run` uitvoert

## Stappen

1. Installeer backend dependencies:
   `composer install --no-dev --optimize-autoloader`
2. Installeer frontend dependencies en bouw assets:
   `npm install && npm run build`
3. Zet productievariabelen in `.env`.
4. Genereer een app key indien nodig:
   `php artisan key:generate`
5. Draai migraties:
   `php artisan migrate --force`
6. Start queue worker:
   `php artisan queue:work`
7. Plan scheduler:
   `* * * * * php /path/to/artisan schedule:run >> /dev/null 2>&1`

## Opmerkingen

- Jira-sync is nu onderdeel van de Laravel-applicatie en hoort via queue jobs te lopen.
- Er zijn geen aparte backend- of frontend-containers meer in dit repo.
