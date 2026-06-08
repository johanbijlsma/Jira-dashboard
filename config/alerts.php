<?php

return [
    'sla_warning_minutes' => env('SLA_WARNING_MINUTES', 30),
    'sla_critical_minutes' => env('SLA_CRITICAL_MINUTES', 5),
    'sla_overdue_max_age_hours' => env('SLA_OVERDUE_MAX_AGE_HOURS', 24),
    'ttr_warning_hours' => env('TTR_WARNING_HOURS', 24),
    'ttr_critical_minutes' => env('TTR_CRITICAL_MINUTES', 60),
];
