<?php

namespace App\Http\Controllers;

class StatusController extends Controller
{
    public function __invoke()
    {
        return view('status');
    }
}
