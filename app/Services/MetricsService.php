<?php

namespace App\Services;

use App\Models\Issue;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;

class MetricsService
{
    public function meta(): array
    {
        return [
            'request_types' => Issue::query()->whereNotNull('request_type')->distinct()->orderBy('request_type')->pluck('request_type')->all(),
            'onderwerpen' => Issue::query()->whereNotNull('onderwerp_logging')->where('onderwerp_logging', '!=', '')->distinct()->orderBy('onderwerp_logging')->pluck('onderwerp_logging')->all(),
            'priorities' => Issue::query()->whereNotNull('priority')->distinct()->orderBy('priority')->pluck('priority')->all(),
            'assignees' => Issue::query()->whereNotNull('assignee')->distinct()->orderBy('assignee')->pluck('assignee')->all(),
            'organizations' => Issue::query()->whereNotNull('organizations')->pluck('organizations')->flatten()->filter()->unique()->sort()->values()->all(),
        ];
    }

    public function volumeWeekly(array $filters): array
    {
        [$from, $to] = $this->normalizedDateRange($filters);

        $query = $this->filteredIssues($filters)
            ->selectRaw('DATE_SUB(DATE(created_at), INTERVAL WEEKDAY(created_at) DAY) as week')
            ->selectRaw('request_type')
            ->selectRaw('COUNT(*) as tickets')
            ->whereBetween('created_at', [$from, $to])
            ->groupBy('week', 'request_type')
            ->orderBy('week');

        return $query->get()->map(fn ($row) => [
            'week' => $row->week,
            'request_type' => $row->request_type,
            'tickets' => (int) $row->tickets,
        ])->all();
    }

    public function inflowVsClosedWeekly(array $filters): array
    {
        [$from, $to] = $this->normalizedDateRange($filters);

        $incoming = $this->filteredIssues($filters)
            ->selectRaw('DATE_SUB(DATE(created_at), INTERVAL WEEKDAY(created_at) DAY) as week')
            ->selectRaw('COUNT(*) as incoming_count')
            ->whereBetween('created_at', [$from, $to])
            ->groupBy('week')
            ->pluck('incoming_count', 'week');

        $closed = $this->filteredIssues($filters)
            ->whereNotNull('resolved_at')
            ->selectRaw('DATE_SUB(DATE(resolved_at), INTERVAL WEEKDAY(resolved_at) DAY) as week')
            ->selectRaw('COUNT(*) as closed_count')
            ->whereBetween('resolved_at', [$from, $to])
            ->groupBy('week')
            ->pluck('closed_count', 'week');

        return collect($incoming->keys())
            ->merge($closed->keys())
            ->unique()
            ->sort()
            ->values()
            ->map(fn ($week) => [
                'week' => $week,
                'incoming_count' => (int) ($incoming[$week] ?? 0),
                'closed_count' => (int) ($closed[$week] ?? 0),
            ])->all();
    }

    public function currentWeekFlow(array $filters): array
    {
        $query = $this->filteredIssues($filters);
        $timezone = 'Europe/Amsterdam';
        $nowLocal = CarbonImmutable::now($timezone);
        $currentWeekStart = $nowLocal->startOfWeek();
        $currentCutoff = $nowLocal;
        $previousWeekStart = $currentWeekStart->subWeek();
        $previousCutoff = $previousWeekStart->addSeconds($currentCutoff->diffInSeconds($currentWeekStart));

        $created = (clone $query)
            ->where('created_at', '>=', $currentWeekStart->utc()->toDateTimeString())
            ->where('created_at', '<', $currentCutoff->utc()->toDateTimeString())
            ->count();
        $previousCreated = (clone $query)
            ->where('created_at', '>=', $previousWeekStart->utc()->toDateTimeString())
            ->where('created_at', '<', $previousCutoff->utc()->toDateTimeString())
            ->count();
        $closed = (clone $query)
            ->whereNotNull('resolved_at')
            ->where('resolved_at', '>=', $currentWeekStart->utc()->toDateTimeString())
            ->where('resolved_at', '<', $currentCutoff->utc()->toDateTimeString())
            ->count();
        $previousClosed = (clone $query)
            ->whereNotNull('resolved_at')
            ->where('resolved_at', '>=', $previousWeekStart->utc()->toDateTimeString())
            ->where('resolved_at', '<', $previousCutoff->utc()->toDateTimeString())
            ->count();

        return [
            'incoming_tickets' => $created,
            'closed_tickets' => $closed,
            'open_delta' => $created - $closed,
            'close_rate_pct' => $created > 0 ? round(($closed / $created) * 100, 1) : null,
            'current_received' => $created,
            'current_closed' => $closed,
            'previous_received' => $previousCreated,
            'previous_closed' => $previousClosed,
            'current_week_start' => $currentWeekStart->toIso8601String(),
            'current_cutoff' => $currentCutoff->toIso8601String(),
            'previous_week_start' => $previousWeekStart->toIso8601String(),
            'previous_cutoff' => $previousCutoff->toIso8601String(),
            'refreshed_at' => now()->toIso8601String(),
        ];
    }

    public function timeSummary(array $filters): array
    {
        [$from, $to] = $this->normalizedDateRange($filters);

        $row = $this->filteredIssues($filters)
            ->whereBetween('created_at', [$from, $to])
            ->selectRaw('AVG(TIMESTAMPDIFF(HOUR, created_at, resolved_at)) as time_to_resolution_hours')
            ->selectRaw('AVG(TIMESTAMPDIFF(HOUR, created_at, updated_at)) as time_to_first_response_hours')
            ->selectRaw('COUNT(CASE WHEN resolved_at IS NOT NULL THEN 1 END) as resolution_n')
            ->selectRaw('COUNT(CASE WHEN updated_at IS NOT NULL THEN 1 END) as first_response_n')
            ->first();

        return [
            'time_to_resolution_hours' => $row?->time_to_resolution_hours !== null ? (float) $row->time_to_resolution_hours : null,
            'time_to_first_response_hours' => $row?->time_to_first_response_hours !== null ? (float) $row->time_to_first_response_hours : null,
            'resolution_n' => (int) ($row?->resolution_n ?? 0),
            'first_response_n' => (int) ($row?->first_response_n ?? 0),
        ];
    }

    public function volumeByField(array $filters, string $field): array
    {
        [$from, $to] = $this->normalizedDateRange($filters);

        return $this->filteredIssues($filters)
            ->whereBetween('created_at', [$from, $to])
            ->whereNotNull($field)
            ->select($field)
            ->selectRaw('COUNT(*) as tickets')
            ->groupBy($field)
            ->orderByDesc('tickets')
            ->get()
            ->map(fn ($row) => [
                $field => $row->{$field},
                'tickets' => (int) $row->tickets,
            ])->all();
    }

    protected function filteredIssues(array $filters): Builder
    {
        return Issue::query()
            ->when($filters['request_type'] ?? null, fn (Builder $query, string $value) => $query->where('request_type', $value))
            ->when($filters['onderwerp'] ?? null, fn (Builder $query, string $value) => $query->where('onderwerp_logging', $value))
            ->when($filters['priority'] ?? null, fn (Builder $query, string $value) => $query->where('priority', $value))
            ->when($filters['assignee'] ?? null, fn (Builder $query, string $value) => $query->where('assignee', $value))
            ->when($filters['organization'] ?? null, function (Builder $query, string $value) {
                $query->whereJsonContains('organizations', $value);
            })
            ->when($filters['servicedesk_only'] ?? false, function (Builder $query) {
                $config = app(DashboardConfigService::class)->get();
                $query->whereIn('onderwerp_logging', $config['onderwerpen']);
            });
    }

    protected function normalizedDateRange(array $filters): array
    {
        $from = CarbonImmutable::parse((string) ($filters['date_from'] ?? 'now'))->startOfDay()->toDateTimeString();
        $to = CarbonImmutable::parse((string) ($filters['date_to'] ?? 'now'))->endOfDay()->toDateTimeString();

        return [$from, $to];
    }
}
