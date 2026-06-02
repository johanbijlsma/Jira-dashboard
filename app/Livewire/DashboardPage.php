<?php

namespace App\Livewire;

use App\Models\Issue;
use App\Models\ReleaseCalendarOverride;
use App\Models\ReleaseWorkloadSnapshot;
use App\Services\AlertService;
use App\Services\DashboardConfigService;
use App\Services\InsightService;
use App\Services\MetricsService;
use App\Services\SyncService;
use App\Services\VacationService;
use Carbon\CarbonImmutable;
use Carbon\Exceptions\InvalidFormatException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Livewire\Component;

class DashboardPage extends Component
{
    public string $dateFrom;
    public string $dateTo;
    public bool $servicedeskOnly = true;
    public bool $showFilters = false;

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

    public function toggleFilters(): void
    {
        $this->showFilters = !$this->showFilters;
    }

    public function closeFilters(): void
    {
        $this->showFilters = false;
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
        $config = app(DashboardConfigService::class)->get();
        $syncStatus = app(SyncService::class)->status();
        $volumeWeekly = $metrics->volumeWeekly($filters);
        $inflowVsClosed = $metrics->inflowVsClosedWeekly($filters);
        $timeSummary = $metrics->timeSummary($filters);
        $currentWeekFlow = $metrics->currentWeekFlow($filters);
        $alerts = app(AlertService::class)->live($this->servicedeskOnly);
        $alertLogs = app(AlertService::class)->logs(20, $this->servicedeskOnly);
        $insights = app(InsightService::class)->live($filters);
        $vacationsToday = app(VacationService::class)->today();
        $vacationsUpcoming = app(VacationService::class)->upcoming(3);
        $issues = $this->filteredIssuesForCurrentRange($config);
        $fullWeeks = $this->fullWeeks($volumeWeekly);

        $payload = [
            'meta' => $metrics->meta(),
            'config' => $config,
            'syncStatus' => $syncStatus,
            'volumeWeekly' => $volumeWeekly,
            'inflowVsClosed' => $inflowVsClosed,
            'timeSummary' => $timeSummary,
            'currentWeekFlow' => $currentWeekFlow,
            'alerts' => $alerts,
            'alertLogs' => $alertLogs,
            'insights' => $insights,
            'vacationsToday' => $vacationsToday,
            'vacationsUpcoming' => $vacationsUpcoming,
            'kpiStats' => $this->buildKpiStats($volumeWeekly, $currentWeekFlow, $syncStatus),
            'topCards' => $this->buildTopCards($volumeWeekly, $currentWeekFlow, $timeSummary, $issues, $fullWeeks),
            'summaryCards' => $this->buildSummaryCards($volumeWeekly, $inflowVsClosed, $issues, $insights),
            'weeklyTicketRows' => $this->buildWeeklyTicketRows($inflowVsClosed),
            'onderwerpTrendRows' => $this->buildOnderwerpTrendRows($issues),
            'closedVsIncomingRows' => $this->buildClosedVsIncomingRows($inflowVsClosed),
            'aiCount' => count($insights),
            'notificationCount' => $this->notificationCount($alerts),
        ];

        Log::info('[dashboard] render', [
            'date_from' => $this->dateFrom,
            'date_to' => $this->dateTo,
            'servicedesk_only' => $this->servicedeskOnly,
            'volume_points' => count($volumeWeekly),
            'inflow_points' => count($inflowVsClosed),
            'alert_log_items' => count($alertLogs),
            'insight_items' => count($insights),
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

    protected function buildTopCards(array $volumeWeekly, array $currentWeekFlow, array $timeSummary, Collection $issues, Collection $fullWeeks): array
    {
        $baseKpis = $this->buildKpiStats($volumeWeekly, $currentWeekFlow, ['last_sync' => null, 'last_result' => null]);
        $requestTypeTotals = collect($volumeWeekly)
            ->filter(fn (array $row) => $fullWeeks->contains($row['week'] ?? null))
            ->groupBy(fn (array $row) => $row['request_type'] ?: 'Onbekend')
            ->map(fn (Collection $rows) => $rows->sum('tickets'))
            ->sortDesc();

        $topOnderwerp = $issues
            ->countBy(fn ($issue) => $issue->onderwerp_logging ?: 'Onbekend')
            ->sortDesc();

        $lastWeek = $fullWeeks->last();
        $partnerCounts = $this->organizationCounts(
            $issues->filter(function ($issue) use ($lastWeek) {
                if (!$lastWeek || !$issue->created_at) {
                    return false;
                }

                return CarbonImmutable::parse($issue->created_at)->startOfWeek()->toDateString() === $lastWeek;
            })
        );

        $ttfrOverdue = $issues
            ->filter(function ($issue) {
                if (!$issue->first_response_due_at) {
                    return false;
                }

                $breachTarget = $issue->resolved_at ?? $issue->updated_at ?? CarbonImmutable::now();

                return CarbonImmutable::parse($issue->first_response_due_at)->lt(CarbonImmutable::parse($breachTarget));
            })
            ->count();

        $releaseCard = $this->releaseWorkloadCard();

        return [
            [
                'title' => 'Tickets (volledige weken)',
                'badge' => null,
                'value' => (string) ($baseKpis['total_tickets'] ?? '—'),
                'secondary_value' => $baseKpis['avg_per_week'] !== null
                    ? $this->formatDecimal($baseKpis['avg_per_week'])
                    : '—',
                'secondary_label' => 'Gem./week',
                'meta' => $baseKpis['period_label'],
                'tone' => 'default',
            ],
            [
                'title' => 'Tickets laatste volledige week',
                'badge' => 'Periode: laatste week',
                'value' => (string) ($baseKpis['latest_tickets'] ?? 0),
                'secondary_value' => null,
                'secondary_label' => null,
                'meta' => sprintf(
                    'Week van %s · WoW: %s',
                    $baseKpis['last_completed_week_label'],
                    ($baseKpis['wow_change_pct'] ?? null) !== null
                        ? $this->formatDecimal($baseKpis['wow_change_pct']).'%'
                        : '—'
                ),
                'tone' => 'default',
            ],
            [
                'title' => 'Lopende week',
                'badge' => 'Live',
                'value' => (string) ($currentWeekFlow['current_received'] ?? 0),
                'secondary_value' => (string) ($currentWeekFlow['current_closed'] ?? 0),
                'secondary_label' => 'Gesloten',
                'meta' => sprintf(
                    'Vorige week: %d ontvangen · %d gesloten',
                    (int) ($currentWeekFlow['previous_received'] ?? 0),
                    (int) ($currentWeekFlow['previous_closed'] ?? 0)
                ),
                'tone' => 'live',
            ],
            [
                'title' => 'Workload werkdag na release',
                'badge' => $releaseCard['badge'],
                'value' => $releaseCard['value'],
                'secondary_value' => null,
                'secondary_label' => null,
                'meta' => $releaseCard['meta'],
                'tone' => 'default',
            ],
            [
                'title' => 'TTFR verlopen (volledige weken)',
                'badge' => 'SLA',
                'value' => (string) $ttfrOverdue,
                'secondary_value' => null,
                'secondary_label' => null,
                'meta' => 'Aantal tickets dat buiten first response target viel binnen de gekozen periode.',
                'tone' => 'default',
            ],
            [
                'title' => 'Top request type (volledige weken)',
                'badge' => null,
                'value' => (string) ($requestTypeTotals->keys()->first() ?? 'Nog niet gemapt'),
                'secondary_value' => $requestTypeTotals->isNotEmpty() ? (string) $requestTypeTotals->first() : null,
                'secondary_label' => $requestTypeTotals->isNotEmpty() ? 'tickets' : null,
                'meta' => $requestTypeTotals->isNotEmpty() ? 'Meest voorkomende request type in volledige weken.' : 'Parity-gap: backenddata nog niet beschikbaar.',
                'tone' => $requestTypeTotals->isNotEmpty() ? 'default' : 'placeholder',
            ],
            [
                'title' => 'Top onderwerp (volledige weken)',
                'badge' => null,
                'value' => (string) ($topOnderwerp->keys()->first() ?? 'Nog niet gemapt'),
                'secondary_value' => $topOnderwerp->isNotEmpty() ? (string) $topOnderwerp->first() : null,
                'secondary_label' => $topOnderwerp->isNotEmpty() ? 'tickets' : null,
                'meta' => $topOnderwerp->isNotEmpty() ? 'Onderwerp met het hoogste volume binnen de gekozen periode.' : 'Parity-gap: backenddata nog niet beschikbaar.',
                'tone' => $topOnderwerp->isNotEmpty() ? 'default' : 'placeholder',
            ],
            [
                'title' => 'Partner met meeste tickets volledige week',
                'badge' => null,
                'value' => (string) ($partnerCounts->keys()->first() ?? 'Nog niet gemapt'),
                'secondary_value' => $partnerCounts->isNotEmpty() ? (string) $partnerCounts->first() : null,
                'secondary_label' => $partnerCounts->isNotEmpty() ? 'tickets' : null,
                'meta' => $partnerCounts->isNotEmpty() ? 'Week ervoor: partner met hoogste volume in de laatste volledige week.' : 'Parity-gap: partnerverdeling nog niet beschikbaar.',
                'tone' => $partnerCounts->isNotEmpty() ? 'default' : 'placeholder',
            ],
        ];
    }

    protected function buildSummaryCards(array $volumeWeekly, array $inflowVsClosed, Collection $issues, array $insights): array
    {
        $topOnderwerp = $issues->countBy(fn ($issue) => $issue->onderwerp_logging ?: 'Onbekend')->sortDesc();
        $incomingTotal = collect($inflowVsClosed)->sum('incoming_count');
        $closedTotal = collect($inflowVsClosed)->sum('closed_count');
        $closeRate = $incomingTotal > 0 ? round(($closedTotal / $incomingTotal) * 100, 1) : null;
        $peakWeek = collect($inflowVsClosed)->sortByDesc('incoming_count')->first();
        $averageIncoming = count($inflowVsClosed) > 0 ? collect($inflowVsClosed)->avg('incoming_count') : null;
        $peakChange = ($peakWeek && $averageIncoming && $averageIncoming > 0)
            ? (($peakWeek['incoming_count'] - $averageIncoming) / $averageIncoming) * 100
            : null;
        $leadInsight = $insights[0] ?? null;

        return [
            [
                'title' => 'Trend',
                'badge' => 'Insight',
                'value' => $leadInsight['title'] ?? 'Nog niet gemapt',
                'meta' => $leadInsight['summary'] ?? 'Parity-gap: trendkaart wacht nog op oude Python-berekening.',
                'tone' => $leadInsight ? 'default' : 'placeholder',
            ],
            [
                'title' => 'Volume',
                'badge' => 'Insight',
                'value' => (string) ($topOnderwerp->keys()->first() ?? 'Nog niet gemapt'),
                'meta' => $topOnderwerp->isNotEmpty()
                    ? sprintf('%d tickets', (int) $topOnderwerp->first())
                    : 'Parity-gap: onderwerptrends nog niet beschikbaar.',
                'tone' => $topOnderwerp->isNotEmpty() ? 'default' : 'placeholder',
            ],
            [
                'title' => 'Piek',
                'badge' => 'Insight',
                'value' => $peakWeek ? $this->formatDate($peakWeek['week']) : 'Nog niet gemapt',
                'meta' => $peakWeek
                    ? sprintf(
                        '%d tickets · %s boven gem.',
                        (int) ($peakWeek['incoming_count'] ?? 0),
                        $peakChange !== null ? $this->formatDecimal($peakChange).'%' : '—'
                    )
                    : 'Parity-gap: piekanalyse nog niet beschikbaar.',
                'tone' => $peakWeek ? 'default' : 'placeholder',
            ],
            [
                'title' => 'Sluitratio',
                'badge' => 'Insight',
                'value' => $closeRate !== null ? $this->formatDecimal($closeRate).'%' : 'Nog niet gemapt',
                'meta' => sprintf(
                    'Open delta %s%d · %s',
                    ($incomingTotal - $closedTotal) > 0 ? '+' : '',
                    $incomingTotal - $closedTotal,
                    $closeRate !== null ? 'Gesloten versus binnengekomen in dezelfde periode.' : 'Parity-gap: ratio nog niet beschikbaar.'
                ),
                'tone' => $closeRate !== null ? 'default' : 'placeholder',
            ],
        ];
    }

    protected function buildWeeklyTicketRows(array $inflowVsClosed): array
    {
        $max = max(1, (int) collect($inflowVsClosed)->max('incoming_count'));

        return collect($inflowVsClosed)
            ->map(function (array $row) use ($max) {
                $incoming = (int) ($row['incoming_count'] ?? 0);
                $closed = (int) ($row['closed_count'] ?? 0);

                return [
                    'week' => $row['week'],
                    'incoming_count' => $incoming,
                    'closed_count' => $closed,
                    'incoming_width' => max(8, (int) round(($incoming / $max) * 100)),
                    'closed_width' => max(8, (int) round(($closed / $max) * 100)),
                ];
            })
            ->all();
    }

    protected function buildOnderwerpTrendRows(Collection $issues): array
    {
        $counts = $issues
            ->countBy(fn ($issue) => $issue->onderwerp_logging ?: 'Onbekend')
            ->sortDesc()
            ->take(5);

        $max = max(1, (int) $counts->first());

        return $counts
            ->map(fn ($tickets, $onderwerp) => [
                'onderwerp' => $onderwerp,
                'tickets' => (int) $tickets,
                'width' => max(12, (int) round(($tickets / $max) * 100)),
            ])
            ->values()
            ->all();
    }

    protected function buildClosedVsIncomingRows(array $inflowVsClosed): array
    {
        $max = max(1, (int) max(
            collect($inflowVsClosed)->max('incoming_count') ?? 0,
            collect($inflowVsClosed)->max('closed_count') ?? 0
        ));

        return collect($inflowVsClosed)
            ->map(function (array $row) use ($max) {
                $incoming = (int) ($row['incoming_count'] ?? 0);
                $closed = (int) ($row['closed_count'] ?? 0);

                return [
                    'week' => $row['week'],
                    'incoming_count' => $incoming,
                    'closed_count' => $closed,
                    'incoming_width' => max(10, (int) round(($incoming / $max) * 100)),
                    'closed_width' => max(10, (int) round(($closed / $max) * 100)),
                ];
            })
            ->all();
    }

    protected function fullWeeks(array $volumeWeekly): Collection
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

        return $weeks->filter(fn (string $week) => $week < $currentWeekStart)->values();
    }

    protected function filteredIssuesForCurrentRange(array $config): Collection
    {
        $query = Issue::query()
            ->whereBetween('created_at', [
                CarbonImmutable::parse($this->dateFrom)->startOfDay()->toDateTimeString(),
                CarbonImmutable::parse($this->dateTo)->endOfDay()->toDateTimeString(),
            ]);

        if ($this->servicedeskOnly) {
            $query->whereIn('onderwerp_logging', $config['onderwerpen']);
        }

        return $query->get([
            'issue_key',
            'issue_summary',
            'request_type',
            'onderwerp_logging',
            'organizations',
            'created_at',
            'resolved_at',
            'updated_at',
            'priority',
            'assignee',
            'first_response_due_at',
            'time_to_resolution_due_at',
        ]);
    }

    protected function organizationCounts(Collection $issues): Collection
    {
        return $issues
            ->flatMap(function ($issue) {
                $organizations = $issue->organizations;

                if (!is_array($organizations)) {
                    return [];
                }

                return collect($organizations)
                    ->filter()
                    ->values()
                    ->all();
            })
            ->countBy()
            ->sortDesc();
    }

    protected function releaseWorkloadCard(): array
    {
        if (!Schema::hasTable('release_workload_snapshots')) {
            return [
                'badge' => 'Release aangepast',
                'value' => 'Nog niet gemapt',
                'meta' => 'Parity-gap: releasetabellen zijn lokaal nog niet gemigreerd.',
            ];
        }

        $latestSnapshot = ReleaseWorkloadSnapshot::query()->orderByDesc('release_date')->first();

        if (!$latestSnapshot) {
            return [
                'badge' => 'Release aangepast',
                'value' => 'Nog niet gemapt',
                'meta' => 'Parity-gap: release workload snapshots nog niet gevuld.',
            ];
        }

        $previousSnapshot = ReleaseWorkloadSnapshot::query()
            ->where('release_date', '!=', $latestSnapshot->release_date)
            ->orderByDesc('release_date')
            ->first();

        $deltaPct = null;
        if ($previousSnapshot && (int) $previousSnapshot->ticket_count > 0) {
            $deltaPct = (((int) $latestSnapshot->ticket_count - (int) $previousSnapshot->ticket_count) / (int) $previousSnapshot->ticket_count) * 100;
        }

        $override = Schema::hasTable('release_calendar_overrides')
            ? ReleaseCalendarOverride::query()->find(optional($latestSnapshot->release_date)->toDateString())
            : null;
        $effectiveReleaseDate = $override && !$override->is_cancelled && $override->override_release_date
            ? $override->override_release_date
            : $latestSnapshot->release_date;

        return [
            'badge' => 'Release aangepast',
            'value' => $deltaPct !== null ? $this->formatSignedPercent($deltaPct) : sprintf('%d tickets', (int) $latestSnapshot->ticket_count),
            'meta' => sprintf(
                'Laatste release: %s · %d tickets%s',
                optional($latestSnapshot->release_date)->format('d-m-Y') ?? 'Onbekend',
                (int) $latestSnapshot->ticket_count,
                $effectiveReleaseDate ? sprintf(' · Release verschoven naar %s', $effectiveReleaseDate->format('d-m-Y')) : ''
            ),
        ];
    }

    protected function notificationCount(array $alerts): int
    {
        return collect($alerts)
            ->filter(fn ($value) => is_array($value))
            ->sum(fn ($value) => count($value));
    }

    protected function trendMeta(int $current, int $previous): array
    {
        if ($current > $previous) {
            return ['symbol' => '↑', 'color' => 'text-emerald-600'];
        }

        if ($current < $previous) {
            return ['symbol' => '↓', 'color' => 'text-rose-600'];
        }

        return ['symbol' => '•', 'color' => 'text-slate-500'];
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

    public function formatDecimal(int|float|string|null $value, int $decimals = 1): string
    {
        if ($value === null || $value === '') {
            return '—';
        }

        return number_format((float) $value, $decimals, ',', '');
    }

    public function formatSignedPercent(int|float|null $value, int $decimals = 1): string
    {
        if ($value === null) {
            return '—';
        }

        return sprintf('%s%s%%', $value > 0 ? '+' : '', $this->formatDecimal($value, $decimals));
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
