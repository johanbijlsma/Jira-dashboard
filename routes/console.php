<?php

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('dashboard:sync {--full}', function () {
    $this->call('queue:work', ['--stop-when-empty' => true]);
})->purpose('Run the dashboard sync worker.');

Schedule::command('dashboard:auto-sync-tick')->everySecond()->withoutOverlapping();
