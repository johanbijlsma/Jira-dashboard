<?php

namespace App\Services;

use App\Models\AlertLog;
use App\Models\DashboardConfig;
use App\Models\Issue;
use Illuminate\Support\Arr;
use Illuminate\Support\Collection;

class AlertService
{
    protected const DEV_ALERT_ISSUE_KEY_PREFIX = 'DEV-ALERT-TEST';

    protected const NEW_ALERT_STATUS = 'nieuwe melding';

    protected const TTR_CLOSED_STATUSES = [
        'afgerond',
        'gesloten',
        'opgelost',
        'done',
        'closed',
        'resolved',
    ];

    public function live(bool $servicedeskOnly = true): array
    {
        $config = app(DashboardConfigService::class)->get();
        $now = now();
        $slaWarningMinutes = max(1, (int) config('alerts.sla_warning_minutes', 30));
        $slaCriticalMinutes = max(1, (int) config('alerts.sla_critical_minutes', 5));
        $slaOverdueMaxAgeHours = max(1, (int) config('alerts.sla_overdue_max_age_hours', 24));
        $ttrWarningHours = max(1, (int) config('alerts.ttr_warning_hours', 24));
        $ttrCriticalMinutes = max(1, (int) config('alerts.ttr_critical_minutes', 60));

        $issues = Issue::query()
            ->when($servicedeskOnly, function ($query) use ($config) {
                $query->whereIn('onderwerp_logging', $config['onderwerpen']);
            })
            ->whereNull('resolved_at')
            ->get();

        $priority1 = $issues->filter(fn (Issue $issue) => $this->isPriority1Issue($issue, $now))
            ->map(fn (Issue $issue) => $this->issuePayload($issue, ['priority' => $issue->priority]))
            ->take(25)
            ->values()
            ->all();

        $firstResponseOverdue = $issues->filter(fn (Issue $issue) => $this->isNewAlertStatus($issue->current_status)
            && $issue->first_response_due_at
            && $issue->first_response_due_at->lt($now)
            && $issue->first_response_due_at->gte($now->copy()->subHours($slaOverdueMaxAgeHours)))
            ->map(fn (Issue $issue) => $this->issuePayload($issue, ['minutes_overdue' => $now->diffInMinutes($issue->first_response_due_at)]))
            ->take(25)
            ->values()
            ->all();

        $firstResponseCritical = $issues->filter(fn (Issue $issue) => $this->isNewAlertStatus($issue->current_status)
            && $issue->first_response_due_at
            && $issue->first_response_due_at->gte($now)
            && $issue->first_response_due_at->lte($now->copy()->addMinutes($slaCriticalMinutes)))
            ->map(fn (Issue $issue) => $this->issuePayload($issue, ['minutes_left' => $now->diffInMinutes($issue->first_response_due_at, false)]))
            ->take(25)
            ->values()
            ->all();

        $firstResponseWarning = $issues->filter(fn (Issue $issue) => $this->isNewAlertStatus($issue->current_status)
            && $issue->first_response_due_at
            && $issue->first_response_due_at->gt($now->copy()->addMinutes($slaCriticalMinutes))
            && $issue->first_response_due_at->lte($now->copy()->addMinutes($slaWarningMinutes)))
            ->map(fn (Issue $issue) => $this->issuePayload($issue, ['minutes_left' => $now->diffInMinutes($issue->first_response_due_at, false)]))
            ->take(25)
            ->values()
            ->all();

        $timeToResolutionOverdue = $issues->filter(fn (Issue $issue) => $this->isIncidentTtrIssue($issue)
            && $issue->time_to_resolution_due_at
            && $issue->time_to_resolution_due_at->lt($now)
            && $issue->time_to_resolution_due_at->gte($now->copy()->subHours($slaOverdueMaxAgeHours)))
            ->map(fn (Issue $issue) => $this->issuePayload($issue, ['minutes_overdue' => $now->diffInMinutes($issue->time_to_resolution_due_at)]))
            ->take(25)
            ->values()
            ->all();

        $timeToResolutionCritical = $issues->filter(fn (Issue $issue) => $this->isIncidentTtrIssue($issue)
            && $issue->time_to_resolution_due_at
            && $issue->time_to_resolution_due_at->gte($now)
            && $issue->time_to_resolution_due_at->lte($now->copy()->addMinutes($ttrCriticalMinutes)))
            ->map(fn (Issue $issue) => $this->issuePayload($issue, ['minutes_left' => $now->diffInMinutes($issue->time_to_resolution_due_at, false)]))
            ->take(25)
            ->values()
            ->all();

        $timeToResolutionWarning = $issues->filter(fn (Issue $issue) => $this->isIncidentTtrIssue($issue)
            && $issue->time_to_resolution_due_at
            && $issue->time_to_resolution_due_at->gt($now->copy()->addMinutes($ttrCriticalMinutes))
            && $issue->time_to_resolution_due_at->lte($now->copy()->addHours($ttrWarningHours)))
            ->map(fn (Issue $issue) => $this->issuePayload($issue, ['minutes_left' => $now->diffInMinutes($issue->time_to_resolution_due_at, false)]))
            ->take(25)
            ->values()
            ->all();

        return [
            'priority1' => $priority1,
            'first_response_due_warning' => $firstResponseWarning,
            'first_response_due_critical' => $firstResponseCritical,
            'first_response_overdue' => $firstResponseOverdue,
            'time_to_resolution_warning' => $timeToResolutionWarning,
            'time_to_resolution_critical' => $timeToResolutionCritical,
            'time_to_resolution_overdue' => $timeToResolutionOverdue,
        ];
    }

    public function triggerDevAlert(bool $servicedeskOnly = true): array
    {
        $config = app(DashboardConfigService::class)->get();
        $issueKey = sprintf('%s-%d', self::DEV_ALERT_ISSUE_KEY_PREFIX, time());
        $assignee = $config['team_members'][0] ?? 'Johan';
        $onderwerp = $config['onderwerpen'][0] ?? 'Servicedesk';

        DashboardConfig::query()->updateOrCreate(
            ['id' => 1],
            [
                'servicedesk_team_members' => $this->appendUniqueText(
                    DashboardConfig::query()->find(1)?->servicedesk_team_members ?? [],
                    $assignee
                ),
                'servicedesk_onderwerpen' => $this->appendUniqueText(
                    DashboardConfig::query()->find(1)?->servicedesk_onderwerpen ?? [],
                    $onderwerp
                ),
                'servicedesk_onderwerpen_customized' => true,
                'updated_at' => now(),
            ]
        );

        Issue::query()->updateOrCreate(
            ['issue_key' => $issueKey],
            [
                'issue_summary' => 'Dev alert testmelding',
                'request_type' => 'Dev Alert',
                'onderwerp_logging' => $onderwerp,
                'organizations' => ['Dev'],
                'created_at' => now(),
                'resolved_at' => null,
                'updated_at' => now(),
                'priority' => 'P1',
                'assignee' => $assignee,
                'assignee_avatar_url' => null,
                'current_status' => 'Nieuwe melding',
                'first_response_due_at' => now()->addMinutes(3),
                'time_to_resolution_due_at' => now()->addHours(20),
            ]
        );

        return [
            'ok' => true,
            'issue_key' => $issueKey,
            'servicedesk_only' => $servicedeskOnly,
        ];
    }

    public function clearDevAlert(?string $issueKey = null): array
    {
        if ($issueKey) {
            Issue::query()->where('issue_key', $issueKey)->delete();
            AlertLog::query()->where('issue_key', $issueKey)->delete();
        } else {
            Issue::query()->where('issue_key', 'like', self::DEV_ALERT_ISSUE_KEY_PREFIX.'-%')->delete();
            AlertLog::query()->where('issue_key', 'like', self::DEV_ALERT_ISSUE_KEY_PREFIX.'-%')->delete();
        }

        return [
            'ok' => true,
            'issue_key' => $issueKey ?: self::DEV_ALERT_ISSUE_KEY_PREFIX.'-*',
        ];
    }

    public function devAlertTestState(): array
    {
        $keys = Issue::query()
            ->where('issue_key', 'like', self::DEV_ALERT_ISSUE_KEY_PREFIX.'-%')
            ->whereNull('resolved_at')
            ->get()
            ->filter(fn (Issue $issue) => $this->isNewAlertStatus($issue->current_status))
            ->sortByDesc('created_at')
            ->pluck('issue_key')
            ->values()
            ->all();

        return [
            'keys' => $keys,
            'count' => count($keys),
        ];
    }

    public function captureLiveSnapshot(bool $servicedeskOnly = true): int
    {
        $alerts = $this->live($servicedeskOnly);
        $detectedAt = now();
        $loggedOn = $detectedAt->toDateString();
        $rows = [];

        foreach ($alerts as $kind => $items) {
            if (!is_array($items)) {
                continue;
            }

            foreach ($items as $item) {
                if (!is_array($item) || !isset($item['issue_key'])) {
                    continue;
                }

                $status = $this->nullableString($item['status'] ?? null);
                $meta = $this->alertMeta($kind, $item);

                $rows[] = [
                    'issue_key' => (string) $item['issue_key'],
                    'alert_kind' => $kind,
                    'status' => $status,
                    'meta' => $meta,
                    'status_key' => $status ?? '',
                    'meta_key' => $meta ?? '',
                    'servicedesk_only' => $servicedeskOnly,
                    'detected_at' => $detectedAt,
                    'logged_on' => $loggedOn,
                ];
            }
        }

        if ($rows === []) {
            return 0;
        }

        AlertLog::query()->insertOrIgnore($rows);

        return count($rows);
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

    protected function alertMeta(string $kind, array $item): ?string
    {
        if (array_key_exists('minutes_left', $item)) {
            return sprintf('%d', (int) $item['minutes_left']);
        }

        if (array_key_exists('minutes_overdue', $item)) {
            return sprintf('%d', (int) $item['minutes_overdue']);
        }

        if ($kind === 'priority1') {
            return $this->nullableString($item['priority'] ?? null);
        }

        return $this->nullableString(Arr::get($item, 'due_at'));
    }

    protected function nullableString(mixed $value): ?string
    {
        $string = trim((string) $value);

        return $string === '' ? null : $string;
    }

    protected function isPriority1Issue(Issue $issue, $now): bool
    {
        return $this->isPriority1Priority($issue->priority)
            && $this->isNewAlertStatus($issue->current_status)
            && $issue->created_at
            && $issue->created_at->gte($now->copy()->subDay());
    }

    protected function isPriority1Priority(?string $value): bool
    {
        $normalized = mb_strtolower(trim((string) $value));

        if ($normalized === '') {
            return false;
        }

        return str_contains($normalized, 'priority 1')
            || str_contains($normalized, 'prioriteit 1')
            || preg_match('/(^|[^a-z0-9])p1([^a-z0-9]|$)/', $normalized) === 1
            || preg_match('/(^|[^a-z0-9])level\s*1([^a-z0-9]|$)/', $normalized) === 1;
    }

    protected function isNewAlertStatus(?string $value): bool
    {
        return mb_strtolower(trim((string) $value)) === self::NEW_ALERT_STATUS;
    }

    protected function isIncidentTtrIssue(Issue $issue): bool
    {
        return mb_strtolower(trim((string) $issue->request_type)) === 'incident'
            && !in_array(mb_strtolower(trim((string) $issue->current_status)), self::TTR_CLOSED_STATUSES, true);
    }

    protected function appendUniqueText(array $values, string $value): array
    {
        return collect($values)
            ->push($value)
            ->map(fn ($item) => trim((string) $item))
            ->filter()
            ->unique()
            ->values()
            ->all();
    }
}
