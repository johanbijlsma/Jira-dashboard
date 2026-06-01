<?php

namespace App\Console\Commands;

use App\Services\SyncService;
use Illuminate\Console\Command;

class RunJiraSyncForegroundCommand extends Command
{
    protected $signature = 'dashboard:sync-now {--full}';

    protected $description = 'Run a Jira sync in the foreground and stream progress to the terminal.';

    public function handle(SyncService $syncService): int
    {
        set_time_limit(0);

        $this->info($this->option('full') ? 'Full foreground sync gestart.' : 'Incremental foreground sync gestart.');

        try {
            $result = $syncService->runForeground(
                (bool) $this->option('full'),
                fn (string $message) => $this->line($message)
            );
        } catch (\Throwable $exception) {
            $this->error($exception->getMessage());

            return self::FAILURE;
        }

        $this->info($result['message'] ?? 'Sync uitgevoerd.');

        return self::SUCCESS;
    }
}
