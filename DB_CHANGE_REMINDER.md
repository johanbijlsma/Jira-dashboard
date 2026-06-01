# Database change reminder

Bij iedere schemawijziging:

1. Voeg een nieuwe Laravel migration toe onder `database/migrations`.
2. Werk eventueel Eloquent casts en services bij.
3. Valideer de wijziging met `php artisan test`.
