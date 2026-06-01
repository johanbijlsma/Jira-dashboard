<?php

return [
    'teams_webhook_url' => env('ALERT_TEAMS_WEBHOOK_URL'),
    'teams_notifications_enabled' => (bool) env('ALERT_TEAMS_NOTIFICATIONS_ENABLED', true),
    'teams_timeout_seconds' => (float) env('ALERT_TEAMS_TIMEOUT_SECONDS', 3),
    'sla_warning_minutes' => (int) env('SLA_WARNING_MINUTES', 30),
    'sla_critical_minutes' => (int) env('SLA_CRITICAL_MINUTES', 5),
    'sla_overdue_max_age_hours' => (int) env('SLA_OVERDUE_MAX_AGE_HOURS', 24),
    'ttr_warning_hours' => (int) env('TTR_WARNING_HOURS', 24),
    'ttr_critical_minutes' => (int) env('TTR_CRITICAL_MINUTES', 60),
];
