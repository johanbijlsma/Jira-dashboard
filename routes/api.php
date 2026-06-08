<?php

use App\Http\Controllers\Api\DashboardDataController;
use Illuminate\Support\Facades\Route;

Route::get('/meta', [DashboardDataController::class, 'meta']);
Route::get('/config/servicedesk', [DashboardDataController::class, 'servicedeskConfig']);
Route::put('/config/servicedesk', [DashboardDataController::class, 'updateServicedeskConfig']);
Route::put('/config/saas-releases', [DashboardDataController::class, 'updateSaasReleases']);
Route::get('/insights/live', [DashboardDataController::class, 'insightsLive']);
Route::get('/insights/logs', [DashboardDataController::class, 'insightsLogs']);
Route::post('/insights/{insightId}/feedback', [DashboardDataController::class, 'submitInsightFeedback']);
Route::get('/metrics/volume_weekly', [DashboardDataController::class, 'volumeWeekly']);
Route::get('/metrics/inflow_vs_closed_weekly', [DashboardDataController::class, 'inflowVsClosedWeekly']);
Route::get('/metrics/time_summary', [DashboardDataController::class, 'timeSummary']);
Route::get('/metrics/current_week_flow', [DashboardDataController::class, 'currentWeekFlow']);
Route::get('/metrics/volume_by_priority', [DashboardDataController::class, 'volumeByPriority']);
Route::get('/metrics/volume_by_assignee', [DashboardDataController::class, 'volumeByAssignee']);
Route::get('/metrics/volume_weekly_by_onderwerp', [DashboardDataController::class, 'volumeByOnderwerp']);
Route::get('/issues', [DashboardDataController::class, 'issues']);
Route::get('/alerts/live', [DashboardDataController::class, 'alertsLive']);
Route::get('/alerts/logs', [DashboardDataController::class, 'alertsLogs']);
Route::get('/alerts/weekly-insights', [DashboardDataController::class, 'alertsWeeklyInsights']);
Route::get('/alerts/weekly-insights.pdf', [DashboardDataController::class, 'alertsWeeklyInsightsPdf']);
Route::post('/alerts/logs/clear', [DashboardDataController::class, 'alertsLogsClear']);
Route::post('/dev/alerts/trigger', [DashboardDataController::class, 'devAlertsTrigger']);
Route::post('/dev/alerts/clear', [DashboardDataController::class, 'devAlertsClear']);
Route::get('/dev/alerts/test-state', [DashboardDataController::class, 'devAlertsTestState']);
Route::get('/vacations', [DashboardDataController::class, 'vacations']);
Route::get('/vacations/upcoming', [DashboardDataController::class, 'vacationsUpcoming']);
Route::get('/vacations/today', [DashboardDataController::class, 'vacationsToday']);
Route::post('/vacations', [DashboardDataController::class, 'createVacation']);
Route::put('/vacations/{vacationId}', [DashboardDataController::class, 'updateVacation']);
Route::delete('/vacations/{vacationId}', [DashboardDataController::class, 'deleteVacation']);
Route::get('/sync/status', [DashboardDataController::class, 'syncStatus']);
Route::get('/status', [DashboardDataController::class, 'status']);
Route::post('/sync', [DashboardDataController::class, 'sync']);
Route::post('/sync/full', [DashboardDataController::class, 'syncFull']);
