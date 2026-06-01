<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class DashboardConfig extends Model
{
    protected $table = 'dashboard_config';

    public $timestamps = false;

    protected $fillable = [
        'id',
        'servicedesk_team_members',
        'servicedesk_onderwerpen',
        'ai_insight_threshold_pct',
        'alert_logs_cleared_at_servicedesk',
        'alert_logs_cleared_at_all',
        'servicedesk_onderwerpen_customized',
        'updated_at',
    ];

    protected $casts = [
        'servicedesk_team_members' => 'array',
        'servicedesk_onderwerpen' => 'array',
        'alert_logs_cleared_at_servicedesk' => 'datetime',
        'alert_logs_cleared_at_all' => 'datetime',
        'servicedesk_onderwerpen_customized' => 'boolean',
        'updated_at' => 'datetime',
    ];
}
