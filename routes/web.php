<?php

use App\Http\Controllers\DashboardController;
use App\Http\Controllers\StatusController;
use Illuminate\Support\Facades\Route;

Route::get('/', DashboardController::class)->name('dashboard');
Route::get('/status', StatusController::class)->name('status');
