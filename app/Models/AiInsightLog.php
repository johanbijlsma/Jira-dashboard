<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AiInsightLog extends Model
{
    protected $table = 'ai_insights_log';

    protected $fillable = [
        'insight_key',
        'scope_key',
        'title',
        'summary',
        'action_label',
        'kind',
        'target_card_key',
        'score_pct',
        'deviation_pct',
        'detected_at',
        'expires_at',
        'source_payload',
        'feedback_status',
        'feedback_reason',
        'feedback_at',
        'removed_at',
    ];

    protected $casts = [
        'score_pct' => 'float',
        'deviation_pct' => 'float',
        'detected_at' => 'datetime',
        'expires_at' => 'datetime',
        'source_payload' => 'array',
        'feedback_at' => 'datetime',
        'removed_at' => 'datetime',
    ];
}
