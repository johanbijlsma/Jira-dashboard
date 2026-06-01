<?php

namespace App\Services;

use App\Models\ReleaseCalendarOverride;
use Illuminate\Support\Carbon;
use Illuminate\Validation\ValidationException;

class ReleaseCalendarService
{
    public function update(array $payload): array
    {
        $slot = strtolower((string) ($payload['slot'] ?? ''));
        if (!in_array($slot, ['last', 'next'], true)) {
            throw ValidationException::withMessages([
                'slot' => "Ongeldige release-slot. Gebruik 'last' of 'next'.",
            ]);
        }

        $releaseDate = isset($payload['release_date']) ? Carbon::parse($payload['release_date'])->toDateString() : null;
        $baseReleaseDate = $releaseDate ?? now()->startOfWeek()->addDays($slot === 'last' ? -1 : 13)->toDateString();

        ReleaseCalendarOverride::query()->updateOrCreate(
            ['base_release_date' => $baseReleaseDate],
            [
                'override_release_date' => $releaseDate,
                'is_cancelled' => (bool) ($payload['cancelled'] ?? false),
                'updated_at' => now(),
            ]
        );

        return app(DashboardConfigService::class)->get();
    }
}
