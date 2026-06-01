<?php

namespace App\Services;

use App\Models\Vacation;
use Illuminate\Support\Carbon;
use Illuminate\Validation\ValidationException;

class VacationService
{
    public function list(bool $includePast = false): array
    {
        return Vacation::query()
            ->when(!$includePast, fn ($query) => $query->whereDate('end_date', '>=', now()->toDateString()))
            ->orderBy('start_date')
            ->orderBy('end_date')
            ->get()
            ->map(fn (Vacation $vacation) => $this->mapVacation($vacation))
            ->all();
    }

    public function upcoming(int $limit = 3): array
    {
        return Vacation::query()
            ->whereDate('end_date', '>=', now()->toDateString())
            ->orderBy('start_date')
            ->limit($limit)
            ->get()
            ->map(fn (Vacation $vacation) => $this->mapVacation($vacation))
            ->all();
    }

    public function today(): array
    {
        $today = now()->toDateString();

        return Vacation::query()
            ->whereDate('start_date', '<=', $today)
            ->whereDate('end_date', '>=', $today)
            ->orderBy('member_name')
            ->get()
            ->map(fn (Vacation $vacation) => $this->mapVacation($vacation))
            ->all();
    }

    public function create(array $payload): array
    {
        $data = $this->validatePayload($payload);
        $vacation = Vacation::query()->create($data);

        return $this->mapVacation($vacation);
    }

    public function update(int $vacationId, array $payload): array
    {
        $data = $this->validatePayload($payload);
        $vacation = Vacation::query()->findOrFail($vacationId);
        $vacation->fill($data)->save();

        return $this->mapVacation($vacation->fresh());
    }

    public function delete(int $vacationId): array
    {
        $vacation = Vacation::query()->findOrFail($vacationId);
        $vacation->delete();

        return ['deleted' => true, 'id' => $vacationId];
    }

    protected function validatePayload(array $payload): array
    {
        $memberName = trim((string) ($payload['member_name'] ?? ''));
        $startDate = Carbon::parse((string) ($payload['start_date'] ?? ''));
        $endDate = Carbon::parse((string) ($payload['end_date'] ?? ''));

        if ($memberName === '') {
            throw ValidationException::withMessages([
                'member_name' => 'Vul een teamlid in.',
            ]);
        }

        if ($endDate->lt($startDate)) {
            throw ValidationException::withMessages([
                'end_date' => 'Einddatum moet op of na de startdatum liggen.',
            ]);
        }

        return [
            'member_name' => $memberName,
            'start_date' => $startDate->toDateString(),
            'end_date' => $endDate->toDateString(),
        ];
    }

    protected function mapVacation(Vacation $vacation): array
    {
        return [
            'id' => $vacation->id,
            'member_name' => $vacation->member_name,
            'start_date' => optional($vacation->start_date)->toDateString(),
            'end_date' => optional($vacation->end_date)->toDateString(),
            'created_at' => optional($vacation->created_at)->toIso8601String(),
            'updated_at' => optional($vacation->updated_at)->toIso8601String(),
        ];
    }
}
