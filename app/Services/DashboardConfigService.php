<?php

namespace App\Services;

use App\Models\DashboardConfig;
use App\Models\Issue;
use Illuminate\Support\Carbon;
use Illuminate\Validation\ValidationException;

class DashboardConfigService
{
    protected const DEFAULT_SERVICEDESK_TEAM_MEMBERS = ['Johan', 'Ashley', 'Jarno'];

    protected const DEFAULT_NON_SERVICEDESK_ONDERWERPEN = [
        'Koppelingen',
        'Rest-endpoints',
        'SSO-koppeling',
        'UWV-koppeling',
        'Datadump',
        'Migratie',
    ];

    public function get(): array
    {
        $config = DashboardConfig::query()->firstOrCreate(
            ['id' => 1],
            [
                'servicedesk_team_members' => [],
                'servicedesk_onderwerpen' => [],
                'ai_insight_threshold_pct' => 75,
                'servicedesk_onderwerpen_customized' => false,
                'updated_at' => now(),
            ]
        );

        $baseline = $this->baselineScope();
        $teamMembers = $this->normalizeTextList($config->servicedesk_team_members ?? []);
        $storedOnderwerpen = $this->normalizeTextList($config->servicedesk_onderwerpen ?? []);
        $onderwerpenCustomized = (bool) $config->servicedesk_onderwerpen_customized;
        $resolvedTeamAssignments = $this->resolvedTeamAssignments($teamMembers);

        if ($teamMembers === [] || (!$onderwerpenCustomized && $storedOnderwerpen === [])) {
            $teamMembers = $teamMembers !== [] ? $teamMembers : $baseline['team_members'];
            $storedOnderwerpen = $storedOnderwerpen !== [] ? $storedOnderwerpen : $baseline['onderwerpen'];

            $config->fill([
                'servicedesk_team_members' => $teamMembers,
                'servicedesk_onderwerpen' => $storedOnderwerpen,
                'servicedesk_onderwerpen_customized' => false,
                'updated_at' => now(),
            ])->save();

            $resolvedTeamAssignments = $this->resolvedTeamAssignments($teamMembers);
        }

        if (
            $teamMembers !== []
            && $this->sameTextSet($teamMembers, self::DEFAULT_SERVICEDESK_TEAM_MEMBERS)
            && $this->allTeamMembersUnmatched($resolvedTeamAssignments)
            && $baseline['team_members'] !== []
            && !$this->sameTextSet($teamMembers, $baseline['team_members'])
        ) {
            $teamMembers = $baseline['team_members'];
            $resolvedTeamAssignments = $this->resolvedTeamAssignments($teamMembers);

            $config->fill([
                'servicedesk_team_members' => $teamMembers,
                'updated_at' => now(),
            ])->save();
        }

        return [
            'team_members' => $teamMembers,
            'onderwerpen' => $onderwerpenCustomized ? $storedOnderwerpen : $baseline['onderwerpen'],
            'onderwerpen_baseline' => $baseline['onderwerpen'],
            'onderwerpen_customized' => $onderwerpenCustomized,
            'available_assignees' => $this->availableAssignees(),
            'team_member_assignee_map' => $resolvedTeamAssignments,
            'team_members_matched' => $this->matchedTeamMembers($resolvedTeamAssignments),
            'team_members_unmatched' => $this->unmatchedTeamMembers($resolvedTeamAssignments),
            'ai_insight_threshold_pct' => (int) $config->ai_insight_threshold_pct,
            'updated_at' => optional($config->updated_at)->toIso8601String(),
            'team_member_avatars' => $this->teamMemberAvatars($teamMembers),
        ];
    }

    public function update(array $payload): array
    {
        $teamMembers = $this->normalizeTextList($payload['team_members'] ?? []);
        $onderwerpen = $this->normalizeTextList($payload['onderwerpen'] ?? []);

        if ($teamMembers === []) {
            throw ValidationException::withMessages([
                'team_members' => 'Selecteer minimaal 1 servicedesk teamlid.',
            ]);
        }

        if ($onderwerpen === []) {
            throw ValidationException::withMessages([
                'onderwerpen' => 'Selecteer minimaal 1 servicedesk onderwerp.',
            ]);
        }

        $baseline = $this->baselineScope();
        $threshold = (int) ($payload['ai_insight_threshold_pct'] ?? 75);
        $threshold = max(1, min(100, $threshold));
        $onderwerpenCustomized = !$this->sameTextSet($onderwerpen, $baseline['onderwerpen']);

        DashboardConfig::query()->updateOrCreate(
            ['id' => 1],
            [
                'servicedesk_team_members' => $teamMembers,
                'servicedesk_onderwerpen' => $onderwerpenCustomized ? $onderwerpen : $baseline['onderwerpen'],
                'ai_insight_threshold_pct' => $threshold,
                'servicedesk_onderwerpen_customized' => $onderwerpenCustomized,
                'updated_at' => Carbon::now(),
            ]
        );

        return $this->get();
    }

    protected function baselineScope(): array
    {
        $excludedOnderwerpen = collect(self::DEFAULT_NON_SERVICEDESK_ONDERWERPEN)
            ->map(fn (string $value) => mb_strtolower($value))
            ->all();

        $availableAssignees = $this->availableAssignees();
        $preferredTeam = collect(self::DEFAULT_SERVICEDESK_TEAM_MEMBERS);

        $teamMembers = collect($availableAssignees)
            ->filter(fn (string $assignee) => $preferredTeam->contains(fn (string $name) => $this->assigneeMatchesLabel($assignee, $name)))
            ->sort()
            ->values()
            ->all();

        if ($teamMembers === []) {
            $teamMembers = Issue::query()
                ->whereNotNull('assignee')
                ->where('assignee', '!=', '')
                ->selectRaw('assignee, COUNT(*) as issue_count')
                ->groupBy('assignee')
                ->orderByDesc('issue_count')
                ->orderBy('assignee')
                ->limit(5)
                ->pluck('assignee')
                ->all();
        }

        $onderwerpen = Issue::query()
            ->whereNotNull('onderwerp_logging')
            ->where('onderwerp_logging', '!=', '')
            ->get(['onderwerp_logging'])
            ->pluck('onderwerp_logging')
            ->filter(function (string $onderwerp) use ($excludedOnderwerpen) {
                return !in_array(mb_strtolower(trim($onderwerp)), $excludedOnderwerpen, true);
            })
            ->unique()
            ->sort()
            ->values()
            ->all();

        return [
            'team_members' => $this->normalizeTextList($teamMembers),
            'onderwerpen' => $this->normalizeTextList($onderwerpen),
        ];
    }

    protected function teamMemberAvatars(array $teamMembers): array
    {
        $avatars = [];
        $resolvedAssignments = $this->resolvedTeamAssignments($teamMembers);

        foreach ($resolvedAssignments as $label => $assignees) {
            foreach ($assignees as $assignee) {
                $issue = Issue::query()
                    ->where('assignee', $assignee)
                    ->whereNotNull('assignee_avatar_url')
                    ->where('assignee_avatar_url', '!=', '')
                    ->orderByDesc('updated_at')
                    ->orderByDesc('created_at')
                    ->first(['assignee_avatar_url']);

                if ($issue?->assignee_avatar_url) {
                    $avatars[$label] = $issue->assignee_avatar_url;
                    break;
                }
            }
        }

        return $avatars;
    }

    protected function normalizeTextList(array $values): array
    {
        return collect($values)
            ->map(fn ($value) => trim((string) $value))
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    protected function sameTextSet(array $left, array $right): bool
    {
        return collect($this->normalizeTextList($left))->map(fn ($value) => mb_strtolower($value))->sort()->values()->all()
            === collect($this->normalizeTextList($right))->map(fn ($value) => mb_strtolower($value))->sort()->values()->all();
    }

    protected function availableAssignees(): array
    {
        return Issue::query()
            ->whereNotNull('assignee')
            ->where('assignee', '!=', '')
            ->distinct()
            ->orderBy('assignee')
            ->pluck('assignee')
            ->all();
    }

    protected function matchedTeamMembers(array $resolvedAssignments): array
    {
        return collect($resolvedAssignments)
            ->filter(fn (array $assignees) => $assignees !== [])
            ->keys()
            ->values()
            ->all();
    }

    protected function unmatchedTeamMembers(array $resolvedAssignments): array
    {
        return collect($resolvedAssignments)
            ->filter(fn (array $assignees) => $assignees === [])
            ->keys()
            ->values()
            ->all();
    }

    protected function resolvedTeamAssignments(array $teamMembers): array
    {
        $availableAssignees = $this->availableAssignees();

        return collect($teamMembers)
            ->mapWithKeys(function (string $label) use ($availableAssignees): array {
                $matches = collect($availableAssignees)
                    ->filter(fn (string $assignee) => $this->assigneeMatchesLabel($assignee, $label))
                    ->values()
                    ->all();

                return [$label => $matches];
            })
            ->all();
    }

    protected function assigneeMatchesLabel(string $assignee, string $label): bool
    {
        $normalizedAssignee = mb_strtolower(trim($assignee));
        $normalizedLabel = mb_strtolower(trim($label));

        if ($normalizedAssignee === '' || $normalizedLabel === '') {
            return false;
        }

        if ($normalizedAssignee === $normalizedLabel) {
            return true;
        }

        $tokens = preg_split('/[\s\-_]+/u', $normalizedAssignee) ?: [];

        return in_array($normalizedLabel, $tokens, true);
    }

    protected function allTeamMembersUnmatched(array $resolvedAssignments): bool
    {
        return $resolvedAssignments !== []
            && collect($resolvedAssignments)->every(fn (array $assignees) => $assignees === []);
    }
}
