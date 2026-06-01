<?php

namespace App\Services;

use App\Models\AiInsightLog;
use Illuminate\Validation\ValidationException;

class InsightService
{
    public function live(array $filters): array
    {
        $threshold = app(DashboardConfigService::class)->get()['ai_insight_threshold_pct'];

        return AiInsightLog::query()
            ->whereNull('removed_at')
            ->where('score_pct', '>=', $threshold)
            ->latest('detected_at')
            ->limit(3)
            ->get()
            ->map(fn (AiInsightLog $insight) => $this->mapInsight($insight))
            ->all();
    }

    public function logs(int $limit = 100, bool $servicedeskOnly = true): array
    {
        $scopeSuffix = $servicedeskOnly ? '|1' : '|0';

        return AiInsightLog::query()
            ->where('scope_key', 'like', '%'.$scopeSuffix)
            ->latest('detected_at')
            ->limit($limit)
            ->get()
            ->map(fn (AiInsightLog $insight) => $this->mapInsight($insight))
            ->all();
    }

    public function feedback(int $insightId, array $payload): array
    {
        $vote = strtolower((string) ($payload['vote'] ?? ''));
        if (!in_array($vote, ['up', 'down'], true)) {
            throw ValidationException::withMessages([
                'vote' => "Vote moet 'up' of 'down' zijn.",
            ]);
        }

        $insight = AiInsightLog::query()->findOrFail($insightId);
        $insight->feedback_status = $vote === 'up' ? 'upvoted' : 'downvoted';
        $insight->feedback_reason = $payload['reason'] ?? null;
        $insight->feedback_at = now();
        if ($vote === 'down') {
            $insight->removed_at = now();
        }
        $insight->save();

        return $this->mapInsight($insight->fresh());
    }

    protected function mapInsight(AiInsightLog $insight): array
    {
        return [
            'id' => $insight->id,
            'insight_key' => $insight->insight_key,
            'title' => $insight->title,
            'summary' => $insight->summary,
            'action_label' => $insight->action_label,
            'kind' => $insight->kind,
            'target_card_key' => $insight->target_card_key,
            'score_pct' => (float) $insight->score_pct,
            'deviation_pct' => $insight->deviation_pct !== null ? (float) $insight->deviation_pct : null,
            'detected_at' => optional($insight->detected_at)->toIso8601String(),
            'expires_at' => optional($insight->expires_at)->toIso8601String(),
            'source_payload' => $insight->source_payload ?? [],
            'feedback_status' => $insight->feedback_status,
            'feedback_reason' => $insight->feedback_reason,
            'feedback_at' => optional($insight->feedback_at)->toIso8601String(),
            'removed_at' => optional($insight->removed_at)->toIso8601String(),
        ];
    }
}
