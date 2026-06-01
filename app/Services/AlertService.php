<?php

namespace App\Services;

use App\Models\AlertLog;
use App\Models\DashboardConfig;
use App\Models\Issue;

class AlertService
{
    public function live(bool $servicedeskOnly = true): array
    {
        $config = app(DashboardConfigService::class)->get();
        $issues = Issue::query()
            ->when($servicedeskOnly, function ($query) use ($config) {
                $query->whereIn('onderwerp_logging', $config['onderwerpen']);
            })
            ->whereNull('resolved_at')
            ->limit(25)
            ->get();

        $priority1 = $issues->filter(fn (Issue $issue) => strcasecmp((string) $issue->priority, 'P1') === 0)
            ->map(fn (Issue $issue) => $this->issuePayload($issue, ['priority' => $issue->priority]))
            ->values()
            ->all();

        $firstResponseCritical = $issues->filter(fn (Issue $issue) => $issue->first_response_due_at && $issue->first_response_due_at->isBefore(now()->addMinutes(5)))
            ->map(fn (Issue $issue) => $this->issuePayload($issue, ['minutes_left' => max(0, now()->diffInMinutes($issue->first_response_due_at, false))]))
            ->values()
            ->all();

        $timeToResolutionWarning = $issues->filter(fn (Issue $issue) => $issue->time_to_resolution_due_at && $issue->time_to_resolution_due_at->isBefore(now()->addDay()))
            ->map(fn (Issue $issue) => $this->issuePayload($issue, ['minutes_left' => max(0, now()->diffInMinutes($issue->time_to_resolution_due_at, false))]))
            ->values()
            ->all();

        return [
            'priority1' => $priority1,
            'first_response_due_warning' => $firstResponseCritical,
            'first_response_due_critical' => $firstResponseCritical,
            'first_response_overdue' => [],
            'time_to_resolution_warning' => $timeToResolutionWarning,
            'time_to_resolution_critical' => [],
            'time_to_resolution_overdue' => [],
        ];
    }

    public function logs(int $limit = 200, bool $servicedeskOnly = true): array
    {
        return AlertLog::query()
            ->where('servicedesk_only', $servicedeskOnly)
            ->latest('detected_at')
            ->limit($limit)
            ->get()
            ->map(fn (AlertLog $log) => [
                'id' => $log->id,
                'issue_key' => $log->issue_key,
                'kind' => $log->alert_kind,
                'status' => $log->status,
                'meta' => $log->meta,
                'servicedesk_only' => (bool) $log->servicedesk_only,
                'detected_at' => optional($log->detected_at)->toIso8601String(),
            ])->all();
    }

    public function clear(bool $servicedeskOnly = true): array
    {
        $config = DashboardConfig::query()->firstOrFail();
        $column = $servicedeskOnly ? 'alert_logs_cleared_at_servicedesk' : 'alert_logs_cleared_at_all';
        $config->{$column} = now();
        $config->updated_at = now();
        $config->save();

        return ['ok' => true, 'servicedesk_only' => $servicedeskOnly];
    }

    public function weeklyInsights(bool $servicedeskOnly = true): array
    {
        $live = $this->live($servicedeskOnly);
        $logs = $this->logs(500, $servicedeskOnly);

        return [
            'summary' => [
                'incoming_tickets' => Issue::query()->whereBetween('created_at', [now()->subWeek(), now()])->count(),
                'closed_tickets' => Issue::query()->whereBetween('resolved_at', [now()->subWeek(), now()])->count(),
                'open_delta' => Issue::query()->whereNull('resolved_at')->count(),
                'close_rate_pct' => null,
            ],
            'alerts' => [
                'total_events' => count($logs),
                'by_kind' => collect($logs)->countBy('kind')->map(fn ($events, $kind) => ['kind' => $kind, 'events' => $events])->values()->all(),
                'live' => $live,
            ],
            'generated_at' => now()->toIso8601String(),
        ];
    }

    protected function issuePayload(Issue $issue, array $extra = []): array
    {
        return array_merge([
            'issue_key' => $issue->issue_key,
            'issue_summary' => $issue->issue_summary,
            'status' => $issue->current_status,
            'priority' => $issue->priority,
            'due_at' => optional($issue->first_response_due_at ?? $issue->time_to_resolution_due_at)->toIso8601String(),
            'created_at' => optional($issue->created_at)->toIso8601String(),
        ], $extra);
    }
}
