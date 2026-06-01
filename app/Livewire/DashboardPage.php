<?php

namespace App\Livewire;

use App\Services\AlertService;
use App\Services\DashboardConfigService;
use App\Services\InsightService;
use App\Services\MetricsService;
use App\Services\VacationService;
use App\Models\Issue;
use Carbon\CarbonImmutable;
use Carbon\Exceptions\InvalidFormatException;
use Illuminate\Support\Facades\Log;
use Livewire\Component;
use App\Services\SyncService;

class DashboardPage extends Component
{
    public string $dateFrom;
    public string $dateTo;
    public bool $servicedeskOnly = true;

    public function mount(): void
    {
        $defaultEnd = CarbonImmutable::now();
        $defaultStart = $defaultEnd->subMonth();

        $hasCurrentWindowData = Issue::query()
            ->whereBetween('created_at', [$defaultStart->startOfDay(), $defaultEnd->endOfDay()])
            ->exists();

        if ($hasCurrentWindowData) {
            $this->dateFrom = $defaultStart->toDateString();
            $this->dateTo = $defaultEnd->toDateString();

            return;
        }

        $latestCreatedAt = Issue::query()->max('created_at');
        if ($latestCreatedAt) {
            $latest = CarbonImmutable::parse($latestCreatedAt);
            $this->dateFrom = $latest->subMonth()->toDateString();
            $this->dateTo = $latest->toDateString();

            Log::info('[dashboard] fallback default range applied', [
                'date_from' => $this->dateFrom,
                'date_to' => $this->dateTo,
                'reason' => 'no_data_in_current_month_window',
            ]);

            return;
        }

        $this->dateFrom = $defaultStart->toDateString();
        $this->dateTo = $defaultEnd->toDateString();
    }

    public function render()
    {
        $startedAt = microtime(true);

        $filters = [
            'date_from' => $this->dateFrom,
            'date_to' => $this->dateTo,
            'servicedesk_only' => $this->servicedeskOnly,
        ];

        $metrics = app(MetricsService::class);

        $payload = [
            'meta' => app(MetricsService::class)->meta(),
            'config' => app(DashboardConfigService::class)->get(),
            'syncStatus' => app(SyncService::class)->status(),
            'volumeWeekly' => $metrics->volumeWeekly($filters),
            'inflowVsClosed' => $metrics->inflowVsClosedWeekly($filters),
            'timeSummary' => $metrics->timeSummary($filters),
            'currentWeekFlow' => $metrics->currentWeekFlow($filters),
            'alerts' => app(AlertService::class)->live($this->servicedeskOnly),
            'alertLogs' => app(AlertService::class)->logs(20, $this->servicedeskOnly),
            'insights' => app(InsightService::class)->live($filters),
            'vacationsToday' => app(VacationService::class)->today(),
            'vacationsUpcoming' => app(VacationService::class)->upcoming(3),
        ];
        $payload['kpiStats'] = $this->buildKpiStats($payload['volumeWeekly'], $payload['currentWeekFlow'], $payload['syncStatus']);

        Log::info('[dashboard] render', [
            'date_from' => $this->dateFrom,
            'date_to' => $this->dateTo,
            'servicedesk_only' => $this->servicedeskOnly,
            'volume_points' => count($payload['volumeWeekly']),
            'inflow_points' => count($payload['inflowVsClosed']),
            'alert_log_items' => count($payload['alertLogs']),
            'insight_items' => count($payload['insights']),
            'duration_ms' => (int) round((microtime(true) - $startedAt) * 1000),
        ]);

        return view('livewire.dashboard-page', $payload);
    }

    protected function buildKpiStats(array $volumeWeekly, array $currentWeekFlow, array $syncStatus): array
    {
        $amsterdamNow = CarbonImmutable::now('Europe/Amsterdam');
        $currentWeekStart = $amsterdamNow->startOfWeek()->toDateString();
        $selectedFrom = CarbonImmutable::parse($this->dateFrom);

        $weeks = collect($volumeWeekly)
            ->pluck('week')
            ->filter()
            ->unique()
            ->sort()
            ->values();

        if ($selectedFrom->dayOfWeekIso !== 1) {
            $weeks = $weeks
                ->reject(fn (string $week) => CarbonImmutable::parse($week)->lt($selectedFrom))
                ->values();
        }

        $fullWeeks = $weeks->filter(fn (string $week) => $week < $currentWeekStart)->values();
        $weekTotals = collect($volumeWeekly)
            ->groupBy('week')
            ->map(fn ($rows) => collect($rows)->sum(fn ($row) => (int) ($row['tickets'] ?? 0)));

        $lastWeek = $fullWeeks->last();
        $previousWeek = $fullWeeks->count() > 1 ? $fullWeeks->get($fullWeeks->count() - 2) : null;
        $totalTickets = $fullWeeks->sum(fn (string $week) => (int) ($weekTotals[$week] ?? 0));
        $latestTickets = $lastWeek ? (int) ($weekTotals[$lastWeek] ?? 0) : 0;
        $previousTickets = $previousWeek ? (int) ($weekTotals[$previousWeek] ?? 0) : null;
        $avgPerWeek = $fullWeeks->count() > 0 ? round($totalTickets / $fullWeeks->count(), 1) : null;
        $wowChangePct = ($previousTickets !== null && $previousTickets > 0)
            ? (($latestTickets - $previousTickets) / $previousTickets) * 100
            : null;

        $cutoff = $currentWeekFlow['current_cutoff'] ?? null;
        $cutoffLabel = $cutoff ? CarbonImmutable::parse($cutoff)->timezone('Europe/Amsterdam')->format('H:i') : '—';
        $refreshedAt = $currentWeekFlow['refreshed_at'] ?? null;
        $liveUpdatedMinutes = $refreshedAt
            ? max(0, (int) CarbonImmutable::parse($refreshedAt)->diffInMinutes(CarbonImmutable::now()))
            : null;

        $lastSync = $syncStatus['last_sync'] ?? null;
        $lastResult = $syncStatus['last_result'] ?? null;

        return [
            'total_tickets' => $totalTickets,
            'avg_per_week' => $avgPerWeek,
            'period_label' => $fullWeeks->isNotEmpty()
                ? sprintf('%s t/m %s', $this->formatDate($fullWeeks->first()), $this->formatDate($fullWeeks->last()))
                : '—',
            'latest_tickets' => $latestTickets,
            'last_completed_week_label' => $lastWeek ? $this->formatDate($lastWeek) : '—',
            'wow_change_pct' => $wowChangePct,
            'current_week_received' => (int) ($currentWeekFlow['current_received'] ?? 0),
            'current_week_closed' => (int) ($currentWeekFlow['current_closed'] ?? 0),
            'previous_week_received' => (int) ($currentWeekFlow['previous_received'] ?? 0),
            'previous_week_closed' => (int) ($currentWeekFlow['previous_closed'] ?? 0),
            'current_week_received_trend' => $this->trendMeta(
                (int) ($currentWeekFlow['current_received'] ?? 0),
                (int) ($currentWeekFlow['previous_received'] ?? 0)
            ),
            'current_week_closed_trend' => $this->trendMeta(
                (int) ($currentWeekFlow['current_closed'] ?? 0),
                (int) ($currentWeekFlow['previous_closed'] ?? 0)
            ),
            'current_week_cutoff_label' => $cutoffLabel,
            'current_week_live_updated_minutes' => $liveUpdatedMinutes,
            'sync_last_updated_label' => $lastSync ? CarbonImmutable::parse($lastSync)->timezone('Europe/Amsterdam')->format('d-m-Y, H:i') : '—',
            'sync_last_upserts_label' => $lastResult && array_key_exists('upserts', $lastResult)
                ? sprintf('%d bijgewerkt', (int) ($lastResult['upserts'] ?? 0))
                : null,
        ];
    }

    protected function trendMeta(int $current, int $previous): array
    {
        if ($current > $previous) {
            return ['symbol' => '↑', 'color' => 'text-emerald-300'];
        }

        if ($current < $previous) {
            return ['symbol' => '↓', 'color' => 'text-rose-300'];
        }

        return ['symbol' => '•', 'color' => 'text-slate-300'];
    }

    public function formatDateTime(?string $value): string
    {
        if (!$value) {
            return 'Onbekend';
        }

        return CarbonImmutable::parse($value)->format('d-m-Y H:i');
    }

    public function formatDate(?string $value): string
    {
        if (!$value) {
            return 'Onbekend';
        }

        return CarbonImmutable::parse($value)->format('d-m-Y');
    }

    public function formatWeekLabel(?string $value): string
    {
        if (!$value) {
            return 'Onbekende week';
        }

        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) === 1) {
            return sprintf('Week van %s', $this->formatDate($value));
        }

        if (preg_match('/^(?<year>\d{4})-(?<week>\d{1,2})-(?<day>\d)$/', $value, $matches) !== 1) {
            return $value;
        }

        try {
            $weekStart = CarbonImmutable::now()->setISODate(
                (int) $matches['year'],
                (int) $matches['week'],
                (int) $matches['day']
            );

            return sprintf('Week %d (%s)', (int) $matches['week'], $weekStart->format('d-m-Y'));
        } catch (InvalidFormatException) {
            return $value;
        }
    }

    public function triggerLabel(?string $value): string
    {
        return match ($value) {
            'automatic' => 'Automatisch',
            'manual' => 'Handmatig',
            'cli' => 'CLI',
            default => ucfirst((string) ($value ?: 'Onbekend')),
        };
    }

    public function modeLabel(?string $value): string
    {
        return match ($value) {
            'full' => 'Full sync',
            'incremental' => 'Incremental sync',
            default => ucfirst((string) ($value ?: 'Sync')),
        };
    }
}
