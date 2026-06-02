<?php

namespace App\Services;

use App\Models\Issue;
use App\Models\SyncState;
use Carbon\CarbonImmutable;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class JiraSyncService
{
    protected $progressLogger = null;

    public function run(bool $full = false): array
    {
        set_time_limit(0);
        $syncStartedAt = CarbonImmutable::now('UTC');

        $this->logProgress(sprintf('%s sync gestart.', $full ? 'Full' : 'Incremental'));

        $email = (string) config('jira.email');
        $token = (string) config('jira.token');
        $project = (string) config('jira.project');

        if ($email === '' || $token === '') {
            throw new RuntimeException('JIRA_EMAIL en JIRA_TOKEN moeten gezet zijn in .env.');
        }

        $lastSync = $full ? null : SyncState::query()->firstOrCreate(['id' => 1], ['last_sync' => null])->last_sync;
        $jql = $this->buildJql($project, $lastSync, $full);
        $fields = $this->fields();
        $this->logProgress(sprintf('Jira project=%s, mode=%s.', $project, $full ? 'full' : 'incremental'));
        $this->logProgress(sprintf('JQL: %s', $jql));
        $this->logProgress(sprintf('Velden: %s', implode(', ', $fields)));
        if ($lastSync) {
            $this->logProgress(sprintf('Vorige last_sync: %s', $lastSync));
        }

        $nextPageToken = null;
        $upserts = 0;
        $maxUpdatedAt = null;
        $page = 0;

        do {
            $page++;
            $this->logProgress(sprintf(
                'Jira request pagina %d%s',
                $page,
                $nextPageToken ? sprintf(' (nextPageToken=%s)', $nextPageToken) : ''
            ));
            $payload = $this->search($jql, $fields, $nextPageToken);
            $issues = Arr::get($payload, 'issues', []);
            $rows = [];
            $this->logProgress(sprintf('Pagina ontvangen: %d issues.', count($issues)));

            foreach ($issues as $issue) {
                $row = $this->mapIssue($issue);
                $rows[] = $row;

                if ($row['updated_at'] !== null) {
                    $updatedAt = CarbonImmutable::parse($row['updated_at']);
                    if ($maxUpdatedAt === null || $updatedAt->gt($maxUpdatedAt)) {
                        $maxUpdatedAt = $updatedAt;
                    }
                }
            }

            if ($rows !== []) {
                Issue::query()->upsert(
                    $rows,
                    ['issue_key'],
                    [
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
                    ]
                );
                $upserts += count($rows);
                $this->logProgress(sprintf('Upsert batch voltooid. Totaal bijgewerkt: %d issues.', $upserts));
            }

            $nextPageToken = Arr::get($payload, 'nextPageToken');
            $isLast = (bool) Arr::get($payload, 'isLast', false);
            $this->logProgress(sprintf(
                'Pagina %d verwerkt. isLast=%s%s',
                $page,
                $isLast ? 'true' : 'false',
                $nextPageToken ? sprintf(', nextPageToken=%s', $nextPageToken) : ''
            ));
        } while (!$isLast && $nextPageToken);

        // Advance the sync checkpoint to at least the start of this run.
        // With the 5-minute overlap in buildJql(), this prevents the same
        // overlap window from being processed forever when Jira returns no
        // newer updated timestamps than the prior checkpoint.
        $effectiveSyncTime = $maxUpdatedAt && $maxUpdatedAt->gt($syncStartedAt)
            ? $maxUpdatedAt
            : $syncStartedAt;

        SyncState::query()->updateOrCreate(
            ['id' => 1],
            ['last_sync' => $effectiveSyncTime->toDateTimeString()]
        );

        $this->logProgress(sprintf(
            '%s sync afgerond. %d issues bijgewerkt. last_sync=%s',
            $full ? 'Full' : 'Incremental',
            $upserts,
            $effectiveSyncTime->toIso8601String()
        ));

        return [
            'upserts' => $upserts,
            'set_last_sync' => $effectiveSyncTime->toIso8601String(),
            'mode' => $full ? 'full' : 'incremental',
        ];
    }

    public function setProgressLogger(?callable $logger): void
    {
        $this->progressLogger = $logger;
    }

    protected function buildJql(string $project, $lastSync, bool $full): string
    {
        $requestTypeField = (string) config('jira.fields.request_type', 'customfield_10010');

        if ($full || $lastSync === null) {
            return sprintf('project = %s AND "cf[10010]" is not EMPTY ORDER BY updated ASC', $project);
        }

        $windowStart = CarbonImmutable::parse($lastSync)->subMinutes(5)->utc();

        return sprintf(
            'project = %s AND updated >= "%s" AND "cf[10010]" is not EMPTY ORDER BY updated ASC',
            $project,
            $windowStart->format('Y-m-d H:i')
        );
    }

    protected function fields(): array
    {
        $fields = [
            'summary',
            'created',
            'updated',
            'resolutiondate',
            'status',
            'priority',
            'assignee',
            config('jira.fields.request_type', 'customfield_10010'),
            config('jira.fields.onderwerp', 'customfield_10143'),
            config('jira.fields.organization', 'customfield_10002'),
            config('jira.fields.first_response_sla', 'customfield_10131'),
        ];

        $ttrField = trim((string) config('jira.fields.time_to_resolution_sla', 'customfield_10130'));
        if ($ttrField !== '') {
            $fields[] = $ttrField;
        }

        return $fields;
    }

    protected function search(string $jql, array $fields, ?string $nextPageToken = null): array
    {
        $payload = [
            'jql' => $jql,
            'maxResults' => 100,
            'fields' => $fields,
        ];

        if ($nextPageToken) {
            $payload['nextPageToken'] = $nextPageToken;
        }

        $startedAt = microtime(true);
        $response = Http::withBasicAuth((string) config('jira.email'), (string) config('jira.token'))
            ->acceptJson()
            ->asJson()
            ->timeout(60)
            ->post(rtrim((string) config('jira.base'), '/').'/rest/api/3/search/jql', $payload);

        $elapsedMs = (int) round((microtime(true) - $startedAt) * 1000);
        $this->logProgress(sprintf('Jira response status=%d in %dms.', $response->status(), $elapsedMs));

        if ($response->status() === 429) {
            $retryAfter = (int) $response->header('Retry-After', 5);
            $this->logProgress(sprintf('Rate limited door Jira. Retry over %d seconden.', $retryAfter));
            sleep($retryAfter);

            return $this->search($jql, $fields, $nextPageToken);
        }

        $response->throw();

        return $response->json();
    }

    protected function mapIssue(array $issue): array
    {
        $fields = Arr::get($issue, 'fields', []);
        $requestTypeField = (string) config('jira.fields.request_type', 'customfield_10010');
        $onderwerpField = (string) config('jira.fields.onderwerp', 'customfield_10143');
        $organizationField = (string) config('jira.fields.organization', 'customfield_10002');
        $firstResponseField = (string) config('jira.fields.first_response_sla', 'customfield_10131');
        $timeToResolutionField = trim((string) config('jira.fields.time_to_resolution_sla', 'customfield_10130'));
        $assignee = $fields['assignee'] ?? null;

        return [
            'issue_key' => (string) $issue['key'],
            'issue_summary' => $this->stringOrNull($fields['summary'] ?? null),
            'request_type' => $this->normalizeRequestType($fields[$requestTypeField] ?? null),
            'onderwerp_logging' => $this->normalizeDropdown($fields[$onderwerpField] ?? null),
            'organizations' => $this->normalizeOrganizationsJson($fields[$organizationField] ?? null),
            'created_at' => $this->normalizeDateTime($fields['created'] ?? null),
            'resolved_at' => $this->normalizeDateTime($fields['resolutiondate'] ?? null),
            'updated_at' => $this->normalizeDateTime($fields['updated'] ?? null),
            'priority' => $this->stringOrNull(Arr::get($fields, 'priority.name')),
            'assignee' => $this->normalizeAssignee($assignee),
            'assignee_avatar_url' => $this->normalizeAssigneeAvatarUrl($assignee),
            'current_status' => $this->stringOrNull(Arr::get($fields, 'status.name')),
            'first_response_due_at' => $this->normalizeSlaDueAt($fields[$firstResponseField] ?? null),
            'time_to_resolution_due_at' => $timeToResolutionField !== ''
                ? $this->normalizeSlaDueAt($fields[$timeToResolutionField] ?? null)
                : null,
        ];
    }

    protected function normalizeRequestType(mixed $value): ?string
    {
        if (is_array($value)) {
            return $this->stringOrNull(Arr::get($value, 'requestType.name'));
        }

        return $this->stringOrNull($value);
    }

    protected function normalizeDropdown(mixed $value): ?string
    {
        if (is_array($value)) {
            return $this->stringOrNull($value['value'] ?? $value['name'] ?? null);
        }

        return $this->stringOrNull($value);
    }

    protected function normalizeAssignee(mixed $value): ?string
    {
        if (is_array($value)) {
            return $this->stringOrNull($value['displayName'] ?? $value['emailAddress'] ?? $value['accountId'] ?? null);
        }

        return $this->stringOrNull($value);
    }

    protected function normalizeAssigneeAvatarUrl(mixed $value): ?string
    {
        if (!is_array($value)) {
            return null;
        }

        $avatars = $value['avatarUrls'] ?? null;
        if (!is_array($avatars)) {
            return null;
        }

        return $this->stringOrNull($avatars['48x48'] ?? $avatars['32x32'] ?? $avatars['24x24'] ?? $avatars['16x16'] ?? null);
    }

    protected function normalizeOrganizations(mixed $value): array
    {
        if ($value === null) {
            return [];
        }

        $items = is_array($value) ? $value : [$value];
        $organizations = [];

        foreach ($items as $item) {
            if (is_array($item)) {
                $name = $item['name'] ?? $item['value'] ?? $item['title'] ?? null;
            } else {
                $name = $item;
            }

            $name = $this->stringOrNull($name);
            if ($name !== null) {
                $organizations[] = $name;
            }
        }

        return array_values(array_unique($organizations));
    }

    protected function normalizeOrganizationsJson(mixed $value): ?string
    {
        $organizations = $this->normalizeOrganizations($value);

        return $organizations === [] ? null : json_encode($organizations, JSON_UNESCAPED_UNICODE);
    }

    protected function normalizeSlaDueAt(mixed $value): ?string
    {
        if (!is_array($value)) {
            return null;
        }

        $iso = Arr::get($value, 'ongoingCycle.breachTime.iso8601');
        if (!$iso) {
            return null;
        }

        return CarbonImmutable::parse($iso)->utc()->toDateTimeString();
    }

    protected function normalizeDateTime(mixed $value): ?string
    {
        if (!$value) {
            return null;
        }

        return CarbonImmutable::parse((string) $value)->utc()->toDateTimeString();
    }

    protected function stringOrNull(mixed $value): ?string
    {
        $string = trim((string) ($value ?? ''));

        return $string === '' ? null : $string;
    }

    protected function logProgress(string $message): void
    {
        if (is_callable($this->progressLogger)) {
            ($this->progressLogger)($message);
        }
    }
}
