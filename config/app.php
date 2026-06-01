<?php

return [
    'name' => env('APP_NAME', 'Jira Dashboard'),
    'env' => env('APP_ENV', 'production'),
    'debug' => (bool) env('APP_DEBUG', false),
    'url' => env('APP_URL', 'http://localhost'),
    'timezone' => 'Europe/Amsterdam',
    'locale' => 'nl',
    'fallback_locale' => 'en',
    'faker_locale' => 'nl_NL',
    'key' => env('APP_KEY'),
    'cipher' => 'AES-256-CBC',
];
