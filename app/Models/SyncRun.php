<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SyncRun extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'started_at',
        'finished_at',
        'mode',
        'trigger_type',
        'success',
        'upserts',
        'set_last_sync',
        'error',
    ];

    protected $casts = [
        'started_at' => 'datetime',
        'finished_at' => 'datetime',
        'success' => 'boolean',
        'set_last_sync' => 'datetime',
    ];
}
