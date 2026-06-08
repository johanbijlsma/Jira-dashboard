<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\AlertService;
use App\Services\DashboardConfigService;
use App\Services\InsightService;
use App\Services\MetricsService;
use App\Services\ReleaseCalendarService;
use App\Services\SyncService;
use App\Services\VacationService;
use Illuminate\Http\Request;

class DashboardDataController extends Controller
{
    public function __construct(
        protected MetricsService $metrics,
        protected DashboardConfigService $config,
        protected AlertService $alerts,
        protected InsightService $insights,
        protected VacationService $vacations,
        protected SyncService $sync,
        protected ReleaseCalendarService $releases,
    ) {
    }

    public function meta()
    {
        return response()->json($this->metrics->meta());
    }

    public function servicedeskConfig()
    {
        return response()->json($this->config->get());
    }

    public function updateServicedeskConfig(Request $request)
    {
        return response()->json($this->config->update($request->all()));
    }

    public function updateSaasReleases(Request $request)
    {
        return response()->json($this->releases->update($request->all()));
    }

    public function insightsLive(Request $request)
    {
        return response()->json($this->insights->live($request->all()));
    }

    public function insightsLogs(Request $request)
    {
        return response()->json($this->insights->logs((int) $request->integer('limit', 100), (bool) $request->boolean('servicedesk_only')));
    }

    public function submitInsightFeedback(Request $request, int $insightId)
    {
        return response()->json($this->insights->feedback($insightId, $request->all()));
    }

    public function volumeWeekly(Request $request)
    {
        return response()->json($this->metrics->volumeWeekly($request->all()));
    }

    public function inflowVsClosedWeekly(Request $request)
    {
        return response()->json($this->metrics->inflowVsClosedWeekly($request->all()));
    }

    public function timeSummary(Request $request)
    {
        return response()->json($this->metrics->timeSummary($request->all()));
    }

    public function currentWeekFlow(Request $request)
    {
        return response()->json($this->metrics->currentWeekFlow($request->all()));
    }

    public function volumeByPriority(Request $request)
    {
        return response()->json($this->metrics->volumeByField($request->all(), 'priority'));
    }

    public function volumeByAssignee(Request $request)
    {
        return response()->json($this->metrics->volumeByField($request->all(), 'assignee'));
    }

    public function volumeByOnderwerp(Request $request)
    {
        return response()->json($this->metrics->volumeByField($request->all(), 'onderwerp_logging'));
    }

    public function issues(Request $request)
    {
        return response()->json([]);
    }

    public function alertsLive(Request $request)
    {
        return response()->json($this->alerts->live((bool) $request->boolean('servicedesk_only', true)));
    }

    public function alertsLogs(Request $request)
    {
        return response()->json($this->alerts->logs((int) $request->integer('limit', 200), (bool) $request->boolean('servicedesk_only', true)));
    }

    public function alertsWeeklyInsights(Request $request)
    {
        return response()->json($this->alerts->weeklyInsights((bool) $request->boolean('servicedesk_only', true)));
    }

    public function alertsWeeklyInsightsPdf(Request $request)
    {
        $payload = $this->alerts->weeklyInsights((bool) $request->boolean('servicedesk_only', true));
        $content = json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);

        return response($content, 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'attachment; filename="weekly-insights.pdf"',
        ]);
    }

    public function alertsLogsClear(Request $request)
    {
        return response()->json($this->alerts->clear((bool) $request->boolean('servicedesk_only', true)));
    }

    public function devAlertsTrigger(Request $request)
    {
        return response()->json($this->alerts->triggerDevAlert((bool) $request->boolean('servicedesk_only', true)));
    }

    public function devAlertsClear(Request $request)
    {
        return response()->json($this->alerts->clearDevAlert($request->string('issue_key')->toString() ?: null));
    }

    public function devAlertsTestState()
    {
        return response()->json($this->alerts->devAlertTestState());
    }

    public function vacations(Request $request)
    {
        return response()->json($this->vacations->list((bool) $request->boolean('include_past')));
    }

    public function vacationsUpcoming(Request $request)
    {
        return response()->json($this->vacations->upcoming((int) $request->integer('limit', 3)));
    }

    public function vacationsToday()
    {
        return response()->json($this->vacations->today());
    }

    public function createVacation(Request $request)
    {
        return response()->json($this->vacations->create($request->all()));
    }

    public function updateVacation(Request $request, int $vacationId)
    {
        return response()->json($this->vacations->update($vacationId, $request->all()));
    }

    public function deleteVacation(int $vacationId)
    {
        return response()->json($this->vacations->delete($vacationId));
    }

    public function syncStatus()
    {
        return response()->json($this->sync->status());
    }

    public function status()
    {
        return response()->json($this->sync->status());
    }

    public function sync()
    {
        return response()->json($this->sync->queue(false));
    }

    public function syncFull()
    {
        return response()->json($this->sync->queue(true));
    }
}
