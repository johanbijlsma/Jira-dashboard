<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AlertLog extends Model
{
    protected $table = 'alert_logs';

    public $timestamps = false;

    protected $fillable = [
        'issue_key',
        'alert_kind',
        'status',
        'meta',
        'status_key',
        'meta_key',
        'servicedesk_only',
        'detected_at',
        'logged_on',
    ];

    protected $casts = [
        'servicedesk_only' => 'boolean',
        'detected_at' => 'datetime',
        'logged_on' => 'date',
    ];
}
