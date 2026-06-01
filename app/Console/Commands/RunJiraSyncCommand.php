<?php

namespace App\Console\Commands;

use App\Services\SyncService;
use Illuminate\Console\Command;

class RunJiraSyncCommand extends Command
{
    protected $signature = 'dashboard:sync-run {--full} {--run-id=}';

    protected $description = 'Run a Jira dashboard sync job.';

    public function handle(SyncService $syncService): int
    {
        set_time_limit(0);

        $runId = (int) $this->option('run-id');
        if ($runId <= 0) {
            $this->error('Geen geldige run-id meegegeven.');

            return self::FAILURE;
        }

        $this->line(sprintf('Sync run #%d gestart.', $runId));

        $result = $syncService->execute($runId, (bool) $this->option('full'));
        $this->info($result['message'] ?? 'Sync uitgevoerd.');

        return self::SUCCESS;
    }
}
