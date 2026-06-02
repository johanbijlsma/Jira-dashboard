<div wire:poll.3s class="space-y-5">
    <section class="flex flex-wrap items-start justify-between gap-4">
        <div>
            <h1 class="text-4xl font-semibold tracking-tight text-slate-900">Status</h1>
            <p class="mt-1 text-sm text-slate-500">Sync-overzicht, recente runs en servicedesk scope in dezelfde dashboardstijl.</p>
        </div>
        <div class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm">
            Laatste sync: {{ $this->formatDateTime($status['last_sync']) }}
        </div>
    </section>

    @if ($lastSyncResult)
        <section class="rounded-2xl border {{ ($lastSyncResult['ok'] ?? true) ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-rose-200 bg-rose-50 text-rose-900' }} px-5 py-4 text-sm shadow-sm">
            {{ $lastSyncResult['message'] ?? 'Sync uitgevoerd.' }}
        </section>
    @endif

    @if ($status['running'] ?? false)
        <section class="rounded-2xl border border-sky-200 bg-sky-50 px-5 py-4 text-sky-900 shadow-sm">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="flex items-center gap-3">
                    <span class="relative flex h-3.5 w-3.5">
                        <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75"></span>
                        <span class="relative inline-flex h-3.5 w-3.5 rounded-full bg-sky-500"></span>
                    </span>
                    <div>
                        <p class="text-xs font-semibold uppercase tracking-[0.25em] text-sky-700">Sync actief</p>
                        <p class="text-sm font-semibold">{{ ucfirst($status['running_run']['mode'] ?? 'sync') }} · {{ $this->triggerLabel($status['running_run']['trigger_type'] ?? null) }}</p>
                    </div>
                </div>
                <div class="text-sm">Gestart: {{ $this->formatDateTime($status['running_run']['started_at'] ?? null) }}</div>
            </div>
            <p class="mt-2 text-sm text-sky-800">Een full sync kan langer duren. De pagina ververst automatisch totdat de run is afgerond.</p>
        </section>
    @endif

    <section class="grid gap-4 md:grid-cols-4">
        <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p class="text-sm text-slate-500">Laatste sync</p>
            <p class="mt-2 text-2xl font-semibold text-slate-900">{{ $this->formatDateTime($status['last_sync']) }}</p>
        </article>
        <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p class="text-sm text-slate-500">Sync status</p>
            <p class="mt-2 text-2xl font-semibold text-slate-900">{{ $status['running'] ? 'Bezig' : 'Idle' }}</p>
        </article>
        <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p class="text-sm text-slate-500">Queue driver</p>
            <p class="mt-2 text-2xl font-semibold text-slate-900">{{ $status['queue_driver'] }}</p>
        </article>
        <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p class="text-sm text-slate-500">Laatste full sync</p>
            <p class="mt-2 text-2xl font-semibold text-slate-900">{{ $this->formatDateTime($status['last_full_sync']['started_at'] ?? null) }}</p>
        </article>
    </section>

    <section class="flex flex-wrap gap-3">
        <button wire:click="queueIncremental" wire:loading.attr="disabled" class="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60">Start incremental sync</button>
        <button wire:click="queueFull" wire:loading.attr="disabled" class="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-60">Start full sync</button>
        @if ($status['running'])
            <button wire:click="resetRunningSyncs" wire:loading.attr="disabled" class="rounded-xl border border-amber-300 bg-amber-50 px-5 py-3 text-sm font-semibold text-amber-800 shadow-sm disabled:cursor-not-allowed disabled:opacity-60">Reset hangende syncs</button>
        @endif
    </section>

    <section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="mb-4 flex items-center justify-between gap-3">
            <h2 class="text-2xl font-semibold text-slate-900">Recente runs</h2>
            <span class="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">Laatste 10 syncs</span>
        </div>
        <div class="overflow-x-auto">
            <table class="min-w-full text-left text-sm text-slate-700">
                <thead class="text-slate-500">
                    <tr class="border-b border-slate-200">
                        <th class="px-3 py-3 font-semibold">Start</th>
                        <th class="px-3 py-3 font-semibold">Einde</th>
                        <th class="px-3 py-3 font-semibold">Type</th>
                        <th class="px-3 py-3 font-semibold">Trigger</th>
                        <th class="px-3 py-3 font-semibold">Status</th>
                        <th class="px-3 py-3 font-semibold">Upserts</th>
                        <th class="px-3 py-3 font-semibold">Set last sync</th>
                    </tr>
                </thead>
                <tbody>
                    @forelse ($status['recent_runs'] as $run)
                        <tr class="border-b border-slate-100">
                            <td class="px-3 py-3">{{ $this->formatDateTime($run['started_at']) }}</td>
                            <td class="px-3 py-3">{{ $run['finished_at'] ? $this->formatDateTime($run['finished_at']) : 'Bezig' }}</td>
                            <td class="px-3 py-3">{{ $run['mode'] }}</td>
                            <td class="px-3 py-3">{{ $this->triggerLabel($run['trigger_type']) }}</td>
                            <td class="px-3 py-3">
                                @if ($run['finished_at'] === null)
                                    <span class="inline-flex rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">Bezig</span>
                                @elseif ($run['success'])
                                    <span class="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Succes</span>
                                @else
                                    <span class="inline-flex rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">Fout</span>
                                @endif
                            </td>
                            <td class="px-3 py-3">{{ $run['upserts'] }}</td>
                            <td class="px-3 py-3">{{ $run['set_last_sync'] ? $this->formatDateTime($run['set_last_sync']) : '—' }}</td>
                        </tr>
                    @empty
                        <tr>
                            <td colspan="7" class="px-3 py-4 text-slate-500">Nog geen runs geregistreerd.</td>
                        </tr>
                    @endforelse
                </tbody>
            </table>
        </div>
    </section>

    <section class="grid gap-4 md:grid-cols-2">
        <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 class="text-xl font-semibold text-slate-900">Servicedesk scope</h2>
            <div class="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-4">
                <p class="text-sm font-semibold text-slate-900">Onderwerpen in scope</p>
                <p class="mt-2 text-sm text-slate-600">{{ implode(', ', $config['onderwerpen']) ?: 'Geen onderwerpen ingesteld' }}</p>
            </div>
        </article>

        <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 class="text-xl font-semibold text-slate-900">Teamleden gekoppeld aan assignees</h2>
            <div class="mt-4 space-y-2 rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-600">
                @forelse ($config['team_member_assignee_map'] as $label => $assignees)
                    <p>
                        <span class="font-semibold text-slate-900">{{ $label }}</span>
                        <span class="text-slate-400">-></span>
                        {{ $assignees !== [] ? implode(', ', $assignees) : 'geen match' }}
                    </p>
                @empty
                    <p>Geen teamleden ingesteld.</p>
                @endforelse
            </div>
            @if (!empty($config['team_members_unmatched']))
                <div class="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <p class="text-sm font-semibold text-amber-900">Teamleden zonder assignee-match</p>
                    <p class="mt-2 text-sm text-amber-800">{{ implode(', ', $config['team_members_unmatched']) }}</p>
                </div>
            @endif
        </article>
    </section>
</div>
