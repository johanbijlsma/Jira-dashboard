<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Issue extends Model
{
    protected $primaryKey = 'issue_key';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = [
        'issue_key',
        'issue_summary',
        'request_type',
        'onderwerp_logging',
        'organizations',
        'created_at',
        'resolved_at',
        'updated_at',
        'priority',
        'assignee',
        'assignee_avatar_url',
        'current_status',
        'first_response_due_at',
        'time_to_resolution_due_at',
    ];

    protected $casts = [
        'organizations' => 'array',
        'created_at' => 'datetime',
        'resolved_at' => 'datetime',
        'updated_at' => 'datetime',
        'first_response_due_at' => 'datetime',
        'time_to_resolution_due_at' => 'datetime',
    ];
}
