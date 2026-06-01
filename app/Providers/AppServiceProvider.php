<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Livewire\Livewire;
use App\Livewire\DashboardPage;
use App\Livewire\StatusPage;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        Livewire::component('dashboard-page', DashboardPage::class);
        Livewire::component('status-page', StatusPage::class);
    }
}
