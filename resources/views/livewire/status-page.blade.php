<div wire:poll.3s class="space-y-6">
    @if ($lastSyncResult)
        <section class="rounded-3xl border {{ ($lastSyncResult['ok'] ?? true) ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100' : 'border-rose-400/20 bg-rose-400/10 text-rose-100' }} p-5 text-sm">
            {{ $lastSyncResult['message'] ?? 'Sync uitgevoerd.' }}
        </section>
    @endif

    @if ($status['running'] ?? false)
        <section class="rounded-3xl border border-cyan-300/30 bg-cyan-400/10 p-5 text-cyan-50 shadow-[0_0_0_1px_rgba(34,211,238,0.15)]">
            <div class="flex flex-wrap items-center justify-between gap-4">
                <div class="flex items-center gap-4">
                    <span class="relative flex h-4 w-4">
                        <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-300 opacity-75"></span>
                        <span class="relative inline-flex h-4 w-4 rounded-full bg-cyan-300"></span>
                    </span>
                    <div>
                        <p class="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-100">Sync actief</p>
                        <p class="mt-1 text-lg font-semibold text-white">
                            {{ ucfirst($status['running_run']['mode'] ?? 'sync') }}
                            · {{ $this->triggerLabel($status['running_run']['trigger_type'] ?? null) }}
                        </p>
                    </div>
                </div>
                <div class="text-sm text-cyan-100/90">
                    Gestart: {{ $this->formatDateTime($status['running_run']['started_at'] ?? null) }}
                </div>
            </div>
            <p class="mt-3 text-sm text-cyan-100/80">Een full sync kan langer duren. De pagina ververst automatisch totdat de run is afgerond.</p>
        </section>
    @endif

    <section class="grid gap-4 md:grid-cols-3">
        <article class="rounded-3xl border border-white/10 bg-white/5 p-5">
            <p class="text-sm text-slate-400">Laatste sync</p>
            <p class="mt-3 text-xl font-semibold text-white">{{ $this->formatDateTime($status['last_sync']) }}</p>
        </article>
        <article class="rounded-3xl border border-white/10 bg-white/5 p-5">
            <p class="text-sm text-slate-400">Sync status</p>
            <p class="mt-3 text-xl font-semibold text-white">{{ $status['running'] ? 'Bezig' : 'Idle' }}</p>
        </article>
        <article class="rounded-3xl border border-white/10 bg-white/5 p-5">
            <p class="text-sm text-slate-400">Queue driver</p>
            <p class="mt-3 text-xl font-semibold text-white">{{ $status['queue_driver'] }}</p>
        </article>
        <article class="rounded-3xl border border-white/10 bg-white/5 p-5">
            <p class="text-sm text-slate-400">Laatste full sync</p>
            <p class="mt-3 text-xl font-semibold text-white">{{ $this->formatDateTime($status['last_full_sync']['started_at'] ?? null) }}</p>
        </article>
    </section>

    <section class="flex flex-wrap gap-3">
        <button wire:click="queueIncremental" wire:loading.attr="disabled" class="rounded-full bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60">Start incremental sync</button>
        <button wire:click="queueFull" wire:loading.attr="disabled" class="rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">Start full sync</button>
        @if ($status['running'])
            <button wire:click="resetRunningSyncs" wire:loading.attr="disabled" class="rounded-full border border-amber-400/30 px-5 py-3 text-sm font-semibold text-amber-100 disabled:cursor-not-allowed disabled:opacity-60">Reset hangende syncs</button>
        @endif
    </section>

    <section class="rounded-3xl border border-white/10 bg-white/5 p-5">
        <h2 class="text-xl font-semibold text-white">Recente runs</h2>
        <div class="mt-4 overflow-x-auto">
            <table class="min-w-full text-left text-sm text-slate-200">
                <thead class="text-slate-400">
                    <tr class="border-b border-white/10">
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
                        <tr class="border-b border-white/5">
                            <td class="px-3 py-3">{{ $this->formatDateTime($run['started_at']) }}</td>
                            <td class="px-3 py-3">{{ $run['finished_at'] ? $this->formatDateTime($run['finished_at']) : 'Bezig' }}</td>
                            <td class="px-3 py-3">{{ $run['mode'] }}</td>
                            <td class="px-3 py-3">{{ $this->triggerLabel($run['trigger_type']) }}</td>
                            <td class="px-3 py-3">
                                @if ($run['finished_at'] === null)
                                    <span class="inline-flex rounded-full bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-100">Bezig</span>
                                @elseif ($run['success'])
                                    <span class="inline-flex rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-100">Succes</span>
                                @else
                                    <span class="inline-flex rounded-full bg-rose-400/10 px-3 py-1 text-xs font-semibold text-rose-100">Fout</span>
                                @endif
                            </td>
                            <td class="px-3 py-3">{{ $run['upserts'] }}</td>
                            <td class="px-3 py-3">{{ $run['set_last_sync'] ? $this->formatDateTime($run['set_last_sync']) : '—' }}</td>
                        </tr>
                    @empty
                        <tr>
                            <td colspan="7" class="px-3 py-4 text-slate-400">Nog geen runs geregistreerd.</td>
                        </tr>
                    @endforelse
                </tbody>
            </table>
        </div>
    </section>

    <section class="rounded-3xl border border-white/10 bg-white/5 p-5">
        <h2 class="text-xl font-semibold text-white">Servicedesk scope</h2>
        <div class="mt-4 grid gap-4 md:grid-cols-2">
            <article class="rounded-2xl bg-slate-900/60 p-4">
                <p class="text-sm font-semibold text-white">Onderwerpen in scope</p>
                <p class="mt-2 text-sm text-slate-300">{{ implode(', ', $config['onderwerpen']) ?: 'Geen onderwerpen ingesteld' }}</p>
            </article>
            <article class="rounded-2xl bg-slate-900/60 p-4">
                <p class="text-sm font-semibold text-white">Teamleden gekoppeld aan assignees</p>
                <div class="mt-2 space-y-2 text-sm text-slate-300">
                    @forelse ($config['team_member_assignee_map'] as $label => $assignees)
                        <p>
                            <span class="font-semibold text-white">{{ $label }}</span>
                            <span class="text-slate-400">-></span>
                            {{ $assignees !== [] ? implode(', ', $assignees) : 'geen match' }}
                        </p>
                    @empty
                        <p>Geen teamleden ingesteld.</p>
                    @endforelse
                </div>
            </article>
            @if (!empty($config['team_members_unmatched']))
                <article class="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 md:col-span-2">
                    <p class="text-sm font-semibold text-amber-100">Teamleden zonder assignee-match</p>
                    <p class="mt-2 text-sm text-amber-50">{{ implode(', ', $config['team_members_unmatched']) }}</p>
                </article>
            @endif
        </div>
    </section>
</div>
