<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ReleaseCalendar extends Model
{
    protected $primaryKey = 'sprint_id';

    public $incrementing = false;

    public $timestamps = false;

    protected $fillable = [
        'sprint_id',
        'board_id',
        'sprint_name',
        'sprint_start_date',
        'release_date',
        'followup_date',
        'refreshed_at',
    ];

    protected $casts = [
        'sprint_start_date' => 'date',
        'release_date' => 'date',
        'followup_date' => 'date',
        'refreshed_at' => 'datetime',
    ];
}
