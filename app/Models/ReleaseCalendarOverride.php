<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ReleaseCalendarOverride extends Model
{
    protected $primaryKey = 'base_release_date';

    public $incrementing = false;

    protected $keyType = 'string';

    public $timestamps = false;

    protected $fillable = [
        'base_release_date',
        'override_release_date',
        'is_cancelled',
        'updated_at',
    ];

    protected $casts = [
        'base_release_date' => 'date',
        'override_release_date' => 'date',
        'is_cancelled' => 'boolean',
        'updated_at' => 'datetime',
    ];
}
