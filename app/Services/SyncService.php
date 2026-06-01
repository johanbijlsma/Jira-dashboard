<?php

namespace App\Services;

use App\Models\SyncRun;
use App\Models\SyncState;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Log;
use Symfony\Component\Process\Process;
use Throwable;

class SyncService
{
    protected const STALE_RUN_AFTER_SECONDS = 120;

    public function __construct(
        protected JiraSyncService $jiraSyncService,
    ) {
    }

    public function status(): array
    {
        $this->reconcileStaleRuns();

        $state = SyncState::query()->firstOrCreate(['id' => 1], ['last_sync' => null]);
        $runs = SyncRun::query()->latest('started_at')->limit(10)->get();
        $runningRun = SyncRun::query()->whereNull('finished_at')->latest('started_at')->first();
        $lastFailed = $runs->firstWhere('success', false);
        $lastFull = $runs->firstWhere('mode', 'full');
        $lastCompleted = $runs->first(fn (SyncRun $run) => $run->finished_at !== null);

        return [
            'running' => $runningRun !== null,
            'running_run' => $runningRun ? $this->mapRun($runningRun) : null,
            'latest_run' => $runs->first() ? $this->mapRun($runs->first()) : null,
            'last_sync' => optional($state->last_sync)->toIso8601String(),
            'last_result' => $lastCompleted ? $this->mapRun($lastCompleted) : null,
            'recent_runs' => $runs->map(fn (SyncRun $run) => $this->mapRun($run))->all(),
            'successful_runs' => $runs->where('success', true)->values()->map(fn (SyncRun $run) => $this->mapRun($run))->all(),
            'last_failed_run' => $lastFailed ? $this->mapRun($lastFailed) : null,
            'last_full_sync' => $lastFull ? $this->mapRun($lastFull) : null,
            'queue_driver' => config('queue.default'),
            'auto_sync' => [
                'enabled' => (bool) config('jira.auto_sync.enabled', true),
                'incremental_interval_seconds' => (int) config('jira.auto_sync.incremental_interval_seconds', 45),
                'last_automatic_run' => optional(
                    SyncRun::query()
                        ->where('trigger_type', 'automatic')
                        ->latest('started_at')
                        ->first()
                        ?->started_at
                )->toIso8601String(),
            ],
        ];
    }

    public function queue(bool $full = false, string $triggerType = 'manual'): array
    {
        $this->reconcileStaleRuns();

        $existingRunningRun = SyncRun::query()->whereNull('finished_at')->latest('started_at')->first();
        if ($existingRunningRun) {
            $this->appendSyncLog(sprintf(
                '[%s] Nieuwe %s sync geweigerd: run #%d draait nog.',
                now()->toDateTimeString(),
                $full ? 'full' : 'incremental',
                $existingRunningRun->id
            ));
            return [
                'queued' => false,
                'ok' => false,
                'type' => 'blocked',
                'mode' => $existingRunningRun->mode,
                'message' => 'Er draait al een sync. Wacht tot deze klaar is.',
            ];
        }

        $run = $this->createRun($full, $triggerType);

        $this->appendSyncLog(sprintf(
            '[%s] %s sync queued (run #%d)',
            now()->toDateTimeString(),
            $full ? 'Full' : 'Incremental',
            $run->id
        ));
        $this->startBackgroundSync($run->id, $full);

        return [
            'queued' => true,
            'ok' => true,
            'type' => 'queued',
            'mode' => $run->mode,
            'message' => sprintf('%s sync gestart op de achtergrond.', $full ? 'Full' : 'Incremental'),
        ];
    }

    public function automaticTick(): array
    {
        if (!(bool) config('jira.auto_sync.enabled', true)) {
            return [
                'ok' => true,
                'started' => false,
                'message' => 'Automatische sync staat uit.',
            ];
        }

        if (SyncRun::query()->whereNull('finished_at')->exists()) {
            return [
                'ok' => true,
                'started' => false,
                'message' => 'Er draait al een sync; automatische tick slaat deze beurt over.',
            ];
        }

        $incrementalInterval = max(15, (int) config('jira.auto_sync.incremental_interval_seconds', 45));
        $now = now()->utc();

        $lastAutomaticRun = SyncRun::query()
            ->where('trigger_type', 'automatic')
            ->latest('started_at')
            ->first();
        $incrementalDue = !$lastAutomaticRun || !$lastAutomaticRun->started_at || $lastAutomaticRun->started_at->diffInSeconds($now) >= $incrementalInterval;

        if (!$incrementalDue) {
            return [
                'ok' => true,
                'started' => false,
                'message' => 'Geen automatische sync nodig.',
            ];
        }

        $result = $this->queue(false, 'automatic');

        return [
            'ok' => (bool) ($result['ok'] ?? false),
            'started' => (bool) ($result['queued'] ?? false),
            'message' => $result['message'] ?? 'Automatische sync verwerkt.',
        ];
    }

    public function execute(int $runId, bool $full = false, ?callable $logger = null): array
    {
        $run = SyncRun::query()->findOrFail($runId);
        $this->jiraSyncService->setProgressLogger(function (string $message) use ($run, $logger): void {
            $formatted = sprintf('[%s] run #%d %s', now()->toDateTimeString(), $run->id, $message);
            $this->appendSyncLog($formatted);
            if ($logger) {
                $logger($formatted);
            }
        });

        try {
            $result = $this->jiraSyncService->run($full);
        } catch (Throwable $exception) {
            $this->appendSyncLog(sprintf(
                '[%s] run #%d fout: %s',
                now()->toDateTimeString(),
                $run->id,
                $exception->getMessage()
            ));
            $run->fill([
                'finished_at' => now(),
                'success' => false,
                'error' => $exception->getMessage(),
            ])->save();

            throw $exception;
        }

        $run->fill([
            'finished_at' => now(),
            'success' => true,
            'upserts' => (int) ($result['upserts'] ?? 0),
            'set_last_sync' => $result['set_last_sync'] ?? null,
            'error' => null,
        ])->save();
        $this->appendSyncLog(sprintf(
            '[%s] run #%d succesvol afgerond (%d upserts)',
            now()->toDateTimeString(),
            $run->id,
            (int) ($result['upserts'] ?? 0)
        ));

        return [
            'queued' => false,
            'ok' => true,
            'type' => 'completed',
            'mode' => $run->mode,
            'upserts' => (int) ($result['upserts'] ?? 0),
            'set_last_sync' => $result['set_last_sync'] ?? null,
            'message' => sprintf(
                '%s sync voltooid: %d issue(s) bijgewerkt.',
                $full ? 'Full' : 'Incremental',
                (int) ($result['upserts'] ?? 0)
            ),
        ];
    }

    public function runForeground(bool $full = false, ?callable $logger = null): array
    {
        $this->reconcileStaleRuns();

        $existingRunningRun = SyncRun::query()->whereNull('finished_at')->latest('started_at')->first();
        if ($existingRunningRun) {
            throw new \RuntimeException(sprintf(
                'Er draait al een sync (run #%d). Reset eerst de hangende sync of wacht tot deze klaar is.',
                $existingRunningRun->id
            ));
        }

        $run = $this->createRun($full, 'cli');
        $queuedMessage = sprintf('[%s] %s foreground sync gestart (run #%d)', now()->toDateTimeString(), $full ? 'Full' : 'Incremental', $run->id);
        $this->appendSyncLog($queuedMessage);
        if ($logger) {
            $logger($queuedMessage);
        }

        return $this->execute($run->id, $full, $logger);
    }

    public function resetRunningRuns(): array
    {
        $runningRuns = SyncRun::query()->whereNull('finished_at')->get();

        if ($runningRuns->isEmpty()) {
            $this->appendSyncLog(sprintf('[%s] Reset gevraagd, maar er waren geen lopende runs.', now()->toDateTimeString()));

            return [
                'ok' => true,
                'type' => 'reset',
                'reset_count' => 0,
                'message' => 'Er waren geen lopende sync-runs om te resetten.',
            ];
        }

        foreach ($runningRuns as $run) {
            $run->fill([
                'finished_at' => now(),
                'success' => false,
                'error' => 'Sync run handmatig gereset vanuit de statuspagina.',
            ])->save();
        }

        $this->appendSyncLog(sprintf(
            '[%s] %d lopende sync-run(s) handmatig gereset.',
            now()->toDateTimeString(),
            $runningRuns->count()
        ));

        return [
            'ok' => true,
            'type' => 'reset',
            'reset_count' => $runningRuns->count(),
            'message' => sprintf('%d lopende sync-run(s) zijn gereset.', $runningRuns->count()),
        ];
    }

    protected function mapRun(SyncRun $run): array
    {
        return [
            'id' => $run->id,
            'started_at' => optional($run->started_at)->toIso8601String(),
            'finished_at' => optional($run->finished_at)->toIso8601String(),
            'mode' => $run->mode,
            'trigger_type' => $run->trigger_type,
            'success' => (bool) $run->success,
            'upserts' => (int) $run->upserts,
            'set_last_sync' => optional($run->set_last_sync)->toIso8601String(),
            'error' => $run->error,
        ];
    }

    protected function startBackgroundSync(int $runId, bool $full): void
    {
        $logDir = storage_path('logs');
        if (!File::exists($logDir)) {
            File::makeDirectory($logDir, 0755, true);
        }

        $logFile = storage_path('logs/sync-run.log');
        if (!File::exists($logFile)) {
            File::put($logFile, '');
        }

        $command = [
            escapeshellarg(PHP_BINARY),
            escapeshellarg(base_path('artisan')),
            'dashboard:sync-run',
            '--run-id='.escapeshellarg((string) $runId),
        ];

        if ($full) {
            $command[] = '--full';
        }

        $commandLine = implode(' ', $command).' >> '.escapeshellarg($logFile).' 2>&1';

        $process = Process::fromShellCommandline($commandLine, base_path());
        $process->setTimeout(null);
        $process->start();
    }

    protected function appendSyncLog(string $message): void
    {
        $logFile = storage_path('logs/sync-run.log');
        File::append($logFile, $message.PHP_EOL);
        Log::info('[sync] '.$message);
    }

    protected function createRun(bool $full, string $triggerType): SyncRun
    {
        return SyncRun::query()->create([
            'started_at' => now(),
            'mode' => $full ? 'full' : 'incremental',
            'trigger_type' => $triggerType,
            'success' => false,
            'upserts' => 0,
        ]);
    }

    protected function reconcileStaleRuns(): void
    {
        $runningRun = SyncRun::query()->whereNull('finished_at')->oldest('started_at')->first();
        if (!$runningRun || !$runningRun->started_at) {
            return;
        }

        $ageInSeconds = now()->diffInSeconds($runningRun->started_at, false);
        if ($ageInSeconds < self::STALE_RUN_AFTER_SECONDS) {
            return;
        }

        $runningRun->fill([
            'finished_at' => now(),
            'success' => false,
            'error' => 'Sync proces automatisch vrijgegeven: run overschreed de lokale timeout zonder afronding.',
        ])->save();

        $this->appendSyncLog(sprintf(
            '[%s] Run #%d gemarkeerd als stale en vrijgegeven na %d seconden.',
            now()->toDateTimeString(),
            $runningRun->id,
            $ageInSeconds
        ));
    }
}
