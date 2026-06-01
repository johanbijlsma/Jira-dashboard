<?php

return [
    'base' => rtrim((string) env('JIRA_BASE', 'https://planningsagenda.atlassian.net'), '/'),
    'email' => env('JIRA_EMAIL'),
    'token' => env('JIRA_TOKEN'),
    'project' => env('JIRA_PROJECT', 'SD'),
    'auto_sync' => [
        'enabled' => (bool) env('AUTO_SYNC_ENABLED', true),
        'incremental_interval_seconds' => max(15, (int) env('SYNC_INCREMENTAL_INTERVAL_SECONDS', 45)),
    ],
    'fields' => [
        'request_type' => env('REQUEST_TYPE_FIELD', 'customfield_10010'),
        'onderwerp' => env('ONDERWERP_FIELD', 'customfield_10143'),
        'organization' => env('ORGANIZATION_FIELD', 'customfield_10002'),
        'first_response_sla' => env('FIRST_RESPONSE_SLA_FIELD', 'customfield_10131'),
        'time_to_resolution_sla' => env('TIME_TO_RESOLUTION_SLA_FIELD', 'customfield_10130'),
    ],
];
