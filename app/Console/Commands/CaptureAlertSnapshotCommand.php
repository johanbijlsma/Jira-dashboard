<?php

namespace App\Console\Commands;

use App\Services\AlertService;
use Illuminate\Console\Command;

class CaptureAlertSnapshotCommand extends Command
{
    protected $signature = 'dashboard:alerts-snapshot {--all : Capture alerts for all data instead of servicedesk-only}';

    protected $description = 'Capture the current live alerts into the alert logbook.';

    public function handle(AlertService $alertService): int
    {
        $servicedeskOnly = !$this->option('all');
        $captured = $alertService->captureLiveSnapshot($servicedeskOnly);

        $this->info(sprintf(
            'Alert snapshot opgeslagen: %d item(s) voor scope %s.',
            $captured,
            $servicedeskOnly ? 'servicedesk-only' : 'all-data'
        ));

        return self::SUCCESS;
    }
}
