<?php

namespace App\Console\Commands;

use App\Services\SyncService;
use Illuminate\Console\Command;

class RunAutoSyncTickCommand extends Command
{
    protected $signature = 'dashboard:auto-sync-tick';

    protected $description = 'Check whether an automatic Jira sync should start.';

    public function handle(SyncService $syncService): int
    {
        $result = $syncService->automaticTick();

        if (($result['started'] ?? false) === true) {
            $this->info($result['message'] ?? 'Automatische sync gestart.');

            return self::SUCCESS;
        }

        $this->line($result['message'] ?? 'Geen automatische sync gestart.');

        return self::SUCCESS;
    }
}
