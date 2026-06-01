<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SyncState extends Model
{
    protected $table = 'sync_state';

    public $timestamps = false;

    protected $fillable = [
        'id',
        'last_sync',
    ];

    protected $casts = [
        'last_sync' => 'datetime',
    ];
}
