<?php

namespace App\Livewire;

use App\Services\SyncService;
use Livewire\Component;

class StatusPage extends Component
{
    public ?array $lastSyncResult = null;

    public function mount(): void
    {
        $status = app(SyncService::class)->status();

        if (($status['running'] ?? false) && !$this->lastSyncResult) {
            $this->lastSyncResult = [
                'ok' => true,
                'message' => 'Er draait momenteel een sync op de achtergrond.',
            ];
        }
    }

    public function queueIncremental(): void
    {
        $this->lastSyncResult = app(SyncService::class)->queue(false);
    }

    public function queueFull(): void
    {
        $this->lastSyncResult = app(SyncService::class)->queue(true);
    }

    public function resetRunningSyncs(): void
    {
        $this->lastSyncResult = app(SyncService::class)->resetRunningRuns();
    }

    public function render()
    {
        $status = app(SyncService::class)->status();
        $latestRun = $status['latest_run'] ?? null;

        if (($status['running'] ?? false)) {
            $this->lastSyncResult = [
                'type' => 'running',
                'ok' => true,
                'message' => 'Er draait momenteel een sync op de achtergrond.',
            ];
        } elseif (($latestRun['success'] ?? false) === true && in_array($this->lastSyncResult['type'] ?? null, ['reset', 'queued', 'running'], true)) {
            $this->lastSyncResult = null;
        } elseif (($latestRun['success'] ?? null) === false) {
            $this->lastSyncResult = [
                'type' => 'failed',
                'ok' => false,
                'message' => 'Laatste sync-fout: '.($latestRun['error'] ?? 'Onbekende fout'),
            ];
        } elseif (($latestRun['success'] ?? null) === true && ($this->lastSyncResult['type'] ?? null) === 'failed') {
            $this->lastSyncResult = null;
        }

        return view('livewire.status-page', [
            'status' => $status,
            'lastSyncResult' => $this->lastSyncResult,
            'config' => app(\App\Services\DashboardConfigService::class)->get(),
        ]);
    }

    public function formatDateTime(?string $value): string
    {
        if (!$value) {
            return 'Nog niet uitgevoerd';
        }

        return \Carbon\CarbonImmutable::parse($value)->format('d-m-Y H:i');
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
}
