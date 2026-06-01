<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ReleaseWorkloadSnapshot extends Model
{
    protected $primaryKey = 'release_date';

    public $incrementing = false;

    protected $keyType = 'string';

    public $timestamps = false;

    protected $fillable = [
        'release_date',
        'followup_date',
        'issue_keys',
        'ticket_count',
        'refreshed_at',
    ];

    protected $casts = [
        'release_date' => 'date',
        'followup_date' => 'date',
        'issue_keys' => 'array',
        'refreshed_at' => 'datetime',
    ];
}
