<?php

namespace Tests\Feature;

use App\Livewire\DashboardPage;
use App\Models\Issue;
use App\Models\AlertLog;
use App\Services\AlertService;
use App\Services\DashboardConfigService;
use App\Services\InsightService;
use App\Services\MetricsService;
use App\Services\SyncService;
use App\Services\VacationService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Livewire\Livewire;
use Mockery\MockInterface;
use Tests\TestCase;

class AlertsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutVite();
    }

    public function test_alerts_api_returns_ttfr_and_ttr_buckets(): void
    {
        $now = CarbonImmutable::create(2026, 6, 8, 10, 0, 0, 'Europe/Amsterdam');
        Carbon::setTestNow($now);

        Issue::query()->create([
            'issue_key' => 'SD-101',
            'issue_summary' => 'Priority one incident',
            'request_type' => 'Incident',
            'onderwerp_logging' => 'Servicedesk',
            'created_at' => $now->subHour(),
            'updated_at' => $now,
            'priority' => 'P1',
            'current_status' => 'Nieuwe melding',
            'first_response_due_at' => $now->subMinutes(10),
        ]);

        Issue::query()->create([
            'issue_key' => 'SD-102',
            'issue_summary' => 'TTFR critical',
            'request_type' => 'Service Request',
            'onderwerp_logging' => 'Servicedesk',
            'created_at' => $now->subHour(),
            'updated_at' => $now,
            'priority' => 'P3',
            'current_status' => 'Nieuwe melding',
            'first_response_due_at' => $now->addMinutes(4),
        ]);

        Issue::query()->create([
            'issue_key' => 'SD-103',
            'issue_summary' => 'TTR critical',
            'request_type' => 'Incident',
            'onderwerp_logging' => 'Servicedesk',
            'created_at' => $now->subHour(),
            'updated_at' => $now,
            'priority' => 'P3',
            'current_status' => 'Open',
            'time_to_resolution_due_at' => $now->addMinutes(45),
        ]);

        Issue::query()->create([
            'issue_key' => 'SD-104',
            'issue_summary' => 'TTR warning',
            'request_type' => 'Incident',
            'onderwerp_logging' => 'Servicedesk',
            'created_at' => $now->subHour(),
            'updated_at' => $now,
            'priority' => 'P3',
            'current_status' => 'Open',
            'time_to_resolution_due_at' => $now->addHours(2),
        ]);

        Issue::query()->create([
            'issue_key' => 'SD-105',
            'issue_summary' => 'Non-incident should not trigger TTR',
            'request_type' => 'Service Request',
            'onderwerp_logging' => 'Servicedesk',
            'created_at' => $now->subHour(),
            'updated_at' => $now,
            'priority' => 'P3',
            'current_status' => 'Open',
            'time_to_resolution_due_at' => $now->addMinutes(30),
        ]);

        $response = $this->getJson('/api/alerts/live?servicedesk_only=0');

        $response->assertOk()
            ->assertJsonCount(1, 'priority1')
            ->assertJsonCount(1, 'first_response_overdue')
            ->assertJsonCount(1, 'first_response_due_critical')
            ->assertJsonCount(1, 'time_to_resolution_critical')
            ->assertJsonCount(1, 'time_to_resolution_warning')
            ->assertJsonPath('priority1.0.issue_key', 'SD-101')
            ->assertJsonPath('first_response_overdue.0.issue_key', 'SD-101')
            ->assertJsonPath('first_response_due_critical.0.issue_key', 'SD-102')
            ->assertJsonPath('time_to_resolution_critical.0.issue_key', 'SD-103')
            ->assertJsonPath('time_to_resolution_warning.0.issue_key', 'SD-104');

        $this->assertNotContains('SD-105', collect($response->json('time_to_resolution_critical'))->pluck('issue_key')->all());
    }

    public function test_dashboard_page_renders_ttr_alert_sections(): void
    {
        $now = CarbonImmutable::create(2026, 6, 8, 10, 0, 0, 'Europe/Amsterdam');
        Carbon::setTestNow($now);

        $alerts = [
            'priority1' => [],
            'first_response_overdue' => [],
            'first_response_due_critical' => [],
            'first_response_due_warning' => [],
            'time_to_resolution_overdue' => [[
                'issue_key' => 'SD-201',
                'issue_summary' => 'TTR overdue on dashboard',
                'status' => 'Open',
                'minutes_left' => -30,
            ]],
            'time_to_resolution_critical' => [],
            'time_to_resolution_warning' => [],
        ];

        $this->mockDashboardDependencies($alerts, null, [[
            'issue_key' => 'SD-201',
            'kind' => 'time_to_resolution_overdue',
            'status' => 'Open',
            'meta' => 'deadline verstreken',
            'detected_at' => $now->toIso8601String(),
        ]]);

        $response = $this->get('/');

        $response->assertOk()
            ->assertSee('Alert logboek')
            ->assertSee('SD-201')
            ->assertSee('Notificaties')
            ->assertDontSee('Live alerts')
            ->assertDontSee('SLA (TTFR)')
            ->assertSee('https://planningsagenda.atlassian.net/browse/SD-201', false);
    }

    public function test_alert_snapshot_is_persisted_in_logbook(): void
    {
        $now = CarbonImmutable::create(2026, 6, 8, 10, 0, 0, 'Europe/Amsterdam');
        Carbon::setTestNow($now);

        Issue::query()->create([
            'issue_key' => 'SD-301',
            'issue_summary' => 'Logged overdue alert',
            'request_type' => 'Incident',
            'onderwerp_logging' => 'Servicedesk',
            'created_at' => $now->subHour(),
            'updated_at' => $now,
            'priority' => 'P2',
            'current_status' => 'Open',
            'time_to_resolution_due_at' => $now->subMinutes(25),
        ]);

        $captured = app(AlertService::class)->captureLiveSnapshot(false);

        $this->assertSame(1, $captured);
        $this->assertDatabaseHas('alert_logs', [
            'issue_key' => 'SD-301',
            'alert_kind' => 'time_to_resolution_overdue',
            'status' => 'Open',
            'servicedesk_only' => 0,
        ]);

        $logs = app(AlertService::class)->logs(20, false);

        $this->assertCount(1, $logs);
        $this->assertSame('SD-301', $logs[0]['issue_key']);
        $this->assertSame('time_to_resolution_overdue', $logs[0]['kind']);
    }

    public function test_dev_alert_trigger_creates_priority_and_ttfr_alert_but_not_ttr_alert(): void
    {
        $response = $this->postJson('/api/dev/alerts/trigger');

        $response->assertOk()
            ->assertJsonPath('ok', true);

        $issueKey = $response->json('issue_key');

        $alerts = $this->getJson('/api/alerts/live?servicedesk_only=1');

        $alerts->assertOk();

        $this->assertContains($issueKey, collect($alerts->json('priority1'))->pluck('issue_key')->all());
        $this->assertContains($issueKey, collect($alerts->json('first_response_due_critical'))->pluck('issue_key')->all());
        $this->assertNotContains($issueKey, collect($alerts->json('time_to_resolution_warning'))->pluck('issue_key')->all());
    }

    public function test_dev_alert_state_and_clear_endpoints_work(): void
    {
        $trigger = $this->postJson('/api/dev/alerts/trigger');
        $issueKey = $trigger->json('issue_key');

        $this->getJson('/api/dev/alerts/test-state')
            ->assertOk()
            ->assertJsonPath('count', 1)
            ->assertJsonPath('keys.0', $issueKey);

        $this->postJson('/api/dev/alerts/clear', ['issue_key' => $issueKey])
            ->assertOk()
            ->assertJsonPath('ok', true);

        $this->getJson('/api/dev/alerts/test-state')
            ->assertOk()
            ->assertJsonPath('count', 0);
    }

    public function test_alert_snapshot_command_invokes_capture_for_servicedesk_scope_by_default(): void
    {
        $this->mock(AlertService::class, function (MockInterface $mock): void {
            $mock->shouldReceive('captureLiveSnapshot')
                ->once()
                ->with(true)
                ->andReturn(3);
        });

        Artisan::call('dashboard:alerts-snapshot');

        $this->assertStringContainsString('3 item(s)', Artisan::output());
    }

    public function test_alert_snapshot_command_supports_all_data_scope(): void
    {
        $this->mock(AlertService::class, function (MockInterface $mock): void {
            $mock->shouldReceive('captureLiveSnapshot')
                ->once()
                ->with(false)
                ->andReturn(5);
        });

        Artisan::call('dashboard:alerts-snapshot', ['--all' => true]);

        $this->assertStringContainsString('5 item(s)', Artisan::output());
    }

    public function test_dashboard_can_trigger_alert_snapshot_from_ui(): void
    {
        $alerts = [
            'priority1' => [],
            'first_response_overdue' => [],
            'first_response_due_critical' => [],
            'first_response_due_warning' => [],
            'time_to_resolution_overdue' => [],
            'time_to_resolution_critical' => [],
            'time_to_resolution_warning' => [],
        ];

        $this->mockDashboardDependencies($alerts, 4);

        Livewire::test(DashboardPage::class)
            ->call('captureAlertSnapshot')
            ->assertSet('alertSnapshotMessage', 'Alert snapshot opgeslagen: 4 item(s) voor servicedesk.');
    }

    public function test_dashboard_filters_alert_log_groups_by_kind(): void
    {
        $alerts = [
            'priority1' => [],
            'first_response_overdue' => [],
            'first_response_due_critical' => [],
            'first_response_due_warning' => [],
            'time_to_resolution_overdue' => [],
            'time_to_resolution_critical' => [],
            'time_to_resolution_warning' => [],
        ];

        $logs = [
            [
                'issue_key' => 'SD-401',
                'kind' => 'priority1',
                'status' => 'Nieuwe melding',
                'meta' => 'P1',
                'detected_at' => CarbonImmutable::create(2026, 6, 8, 10, 0, 0, 'Europe/Amsterdam')->toIso8601String(),
            ],
            [
                'issue_key' => 'SD-402',
                'kind' => 'time_to_resolution_overdue',
                'status' => 'Open',
                'meta' => '46',
                'detected_at' => CarbonImmutable::create(2026, 6, 8, 10, 5, 0, 'Europe/Amsterdam')->toIso8601String(),
            ],
        ];

        $this->mockDashboardDependencies($alerts, null, $logs);

        Livewire::test(DashboardPage::class)
            ->set('alertLogKindFilter', 'time_to_resolution_overdue')
            ->assertSee('SD-402')
            ->assertDontSee('SD-401');
    }

    public function test_weekly_ticket_chart_uses_stacked_bars_and_guides(): void
    {
        $component = new DashboardPage();

        $reflected = new \ReflectionMethod(DashboardPage::class, 'buildWeeklyTicketChartConfig');
        $reflected->setAccessible(true);

        $config = $reflected->invoke(
            $component,
            [
                ['week' => '2026-05-18', 'request_type' => 'Incident', 'tickets' => 2],
                ['week' => '2026-05-18', 'request_type' => 'Service Request', 'tickets' => 1],
                ['week' => '2026-05-25', 'request_type' => 'Incident', 'tickets' => 3],
                ['week' => '2026-05-25', 'request_type' => 'Service Request', 'tickets' => 0],
                ['week' => '2026-06-01', 'request_type' => 'Incident', 'tickets' => 4],
                ['week' => '2026-06-01', 'request_type' => 'Service Request', 'tickets' => 2],
            ],
            ['Incident', 'Service Request']
        );

        $this->assertSame('line', $config['type']);
        $this->assertSame(['18-05-2026', '25-05-2026', '01-06-2026'], $config['data']['labels']);

        $datasets = $config['data']['datasets'];

        $this->assertSame('Incident', $datasets[0]['label']);
        $this->assertSame('line', $datasets[0]['type']);
        $this->assertSame([2, 3, 4], $datasets[0]['data']);
        $this->assertSame('Service Request', $datasets[1]['label']);
        $this->assertSame([1, 0, 2], $datasets[1]['data']);

        $this->assertSame('Totaal', $datasets[2]['label']);
        $this->assertSame('line', $datasets[2]['type']);
        $this->assertSame([3, 3, 6], $datasets[2]['data']);
        $this->assertSame([6, 4], $datasets[2]['borderDash']);

        $this->assertSame('Voortschrijdend gemiddelde (4 weken)', $datasets[3]['label']);
        $this->assertSame('line', $datasets[3]['type']);
        $this->assertSame([3.0, 3.0, 4.0], array_map(fn ($value) => round((float) $value, 1), $datasets[3]['data']));
        $this->assertSame([2, 4], $datasets[3]['borderDash']);
    }

    public function test_weekly_ticket_chart_marks_current_week_with_asterisk(): void
    {
        Carbon::setTestNow(CarbonImmutable::create(2026, 6, 8, 10, 0, 0, 'Europe/Amsterdam'));

        $component = new DashboardPage();
        $reflected = new \ReflectionMethod(DashboardPage::class, 'buildWeeklyTicketChartConfig');
        $reflected->setAccessible(true);

        $config = $reflected->invoke(
            $component,
            [
                ['week' => '2026-05-25', 'request_type' => 'Incident', 'tickets' => 3],
                ['week' => '2026-06-01', 'request_type' => 'Incident', 'tickets' => 4],
                ['week' => '2026-06-08', 'request_type' => 'Incident', 'tickets' => 5],
            ],
            ['Incident']
        );

        $this->assertSame(['25-05-2026', '01-06-2026', '08-06-2026 *'], $config['data']['labels']);
    }

    protected function mockDashboardDependencies(array $alerts, ?int $captureCount = null, array $logs = []): void
    {
        $this->mock(MetricsService::class, function (MockInterface $mock): void {
            $mock->shouldReceive('meta')->andReturn([]);
            $mock->shouldReceive('volumeWeekly')->andReturn([]);
            $mock->shouldReceive('inflowVsClosedWeekly')->andReturn([]);
            $mock->shouldReceive('timeSummary')->andReturn([]);
            $mock->shouldReceive('currentWeekFlow')->andReturn([]);
        });

        $this->mock(DashboardConfigService::class, function (MockInterface $mock): void {
            $mock->shouldReceive('get')->andReturn([
                'team_members' => [],
                'onderwerpen' => [],
                'onderwerpen_baseline' => [],
                'onderwerpen_customized' => false,
                'available_assignees' => [],
                'team_member_assignee_map' => [],
                'team_members_matched' => [],
                'team_members_unmatched' => [],
                'ai_insight_threshold_pct' => 75,
                'updated_at' => null,
                'team_member_avatars' => [],
            ]);
        });

        $this->mock(AlertService::class, function (MockInterface $mock) use ($alerts, $captureCount, $logs): void {
            $mock->shouldReceive('live')->andReturn($alerts);
            $mock->shouldReceive('logs')->andReturn($logs);

            if ($captureCount !== null) {
                $mock->shouldReceive('captureLiveSnapshot')
                    ->once()
                    ->with(true)
                    ->andReturn($captureCount);
            }
        });

        $this->mock(InsightService::class, function (MockInterface $mock): void {
            $mock->shouldReceive('live')->andReturn([]);
        });

        $this->mock(VacationService::class, function (MockInterface $mock): void {
            $mock->shouldReceive('today')->andReturn([]);
            $mock->shouldReceive('upcoming')->andReturn([]);
        });

        $this->mock(SyncService::class, function (MockInterface $mock): void {
            $mock->shouldReceive('status')->andReturn(['running' => false, 'last_sync' => null, 'last_result' => null]);
        });
    }
}
