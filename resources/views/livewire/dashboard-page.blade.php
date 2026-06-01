<div wire:poll.5s class="space-y-8">
    @if ($syncStatus['running'] ?? false)
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
                            {{ $this->modeLabel($syncStatus['running_run']['mode'] ?? null) }}
                            · {{ $this->triggerLabel($syncStatus['running_run']['trigger_type'] ?? null) }}
                        </p>
                    </div>
                </div>
                <div class="text-sm text-cyan-100/90">
                    Gestart: {{ $this->formatDateTime($syncStatus['running_run']['started_at'] ?? null) }}
                </div>
            </div>
            <p class="mt-3 text-sm text-cyan-100/80">De sync draait op de achtergrond. Tijdens een full sync kunnen cijfers tijdelijk nog veranderen.</p>
        </section>
    @endif

    <section class="grid gap-4 rounded-3xl border border-white/10 bg-white/5 p-5 md:grid-cols-4">
        <label class="space-y-2">
            <span class="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Van</span>
            <input wire:model.live="dateFrom" type="date" class="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white">
        </label>
        <label class="space-y-2">
            <span class="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Tot</span>
            <input wire:model.live="dateTo" type="date" class="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white">
        </label>
        <label class="flex items-end gap-3 rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3">
            <input wire:model.live="servicedeskOnly" type="checkbox" class="rounded border-white/20 bg-slate-800 text-cyan-400">
            <span class="text-sm text-slate-200">Alleen servicedesk data</span>
        </label>
        <div class="rounded-2xl bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
            <p class="font-semibold">Teamleden</p>
            <p>{{ implode(', ', $config['team_members']) }}</p>
        </div>
    </section>

    <section class="rounded-3xl border border-white/10 bg-slate-900/50 px-5 py-4 text-sm text-slate-300">
        Periode: <span class="font-semibold text-white">{{ $this->formatDate($dateFrom) }}</span> t/m <span class="font-semibold text-white">{{ $this->formatDate($dateTo) }}</span>
    </section>

    <section class="grid gap-4 md:grid-cols-4">
        <article class="rounded-3xl border border-white/10 bg-gradient-to-br from-cyan-500/20 to-slate-900 p-5">
            <p class="text-sm text-cyan-100">Tickets (volledige weken)</p>
            <div class="mt-3 grid grid-cols-2 gap-4">
                <div>
                    <p class="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-50/70">Totaal</p>
                    <p class="mt-2 text-4xl font-semibold text-white">{{ $kpiStats['total_tickets'] }}</p>
                </div>
                <div>
                    <p class="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-50/70">Gem./week</p>
                    <p class="mt-2 text-4xl font-semibold text-white">{{ $kpiStats['avg_per_week'] ?? '—' }}</p>
                </div>
            </div>
            <p class="mt-3 text-sm text-cyan-50/80">{{ $kpiStats['period_label'] }}</p>
        </article>
        <article class="rounded-3xl border border-white/10 bg-gradient-to-br from-emerald-500/20 to-slate-900 p-5">
            <div class="flex items-center justify-between gap-3">
                <p class="text-sm text-emerald-100">Tickets laatste volledige week</p>
                <span class="rounded-full bg-emerald-100/10 px-3 py-1 text-xs font-semibold text-emerald-50">Periode: laatste week</span>
            </div>
            <p class="mt-3 text-4xl font-semibold text-white">{{ $kpiStats['latest_tickets'] }}</p>
            <p class="mt-3 text-sm text-emerald-50/80">Week van {{ $kpiStats['last_completed_week_label'] }} · WoW: {{ $kpiStats['wow_change_pct'] !== null ? number_format($kpiStats['wow_change_pct'], 1, ',', '') . '%' : '—' }}</p>
        </article>
        <article class="rounded-3xl border border-white/10 bg-gradient-to-br from-amber-500/20 to-slate-900 p-5">
            <div class="flex items-center justify-between gap-3">
                <p class="text-sm text-amber-100">Lopende week</p>
                <span class="rounded-full bg-amber-100/10 px-3 py-1 text-xs font-semibold text-amber-50">Live</span>
            </div>
            <div class="mt-3 grid grid-cols-2 gap-4">
                <div>
                    <p class="text-xs font-semibold uppercase tracking-[0.2em] text-amber-50/70">Ontvangen</p>
                    <p class="mt-2 text-4xl font-semibold text-white">
                        {{ $kpiStats['current_week_received'] }}
                        <span class="align-middle text-xl {{ $kpiStats['current_week_received_trend']['color'] }}">{{ $kpiStats['current_week_received_trend']['symbol'] }}</span>
                    </p>
                </div>
                <div>
                    <p class="text-xs font-semibold uppercase tracking-[0.2em] text-amber-50/70">Gesloten</p>
                    <p class="mt-2 text-4xl font-semibold text-white">
                        {{ $kpiStats['current_week_closed'] }}
                        <span class="align-middle text-xl {{ $kpiStats['current_week_closed_trend']['color'] }}">{{ $kpiStats['current_week_closed_trend']['symbol'] }}</span>
                    </p>
                </div>
            </div>
            <p class="mt-3 text-sm text-amber-50/80">Vorige week: {{ $kpiStats['previous_week_received'] }} ontvangen · {{ $kpiStats['previous_week_closed'] }} gesloten</p>
            <p class="mt-1 text-sm text-amber-50/60">
                @if ($kpiStats['current_week_live_updated_minutes'] !== null)
                    Laatst bijgewerkt {{ $kpiStats['current_week_live_updated_minutes'] }} min geleden ({{ $kpiStats['current_week_cutoff_label'] }})
                @else
                    Laatst bijgewerkt ({{ $kpiStats['current_week_cutoff_label'] }})
                @endif
            </p>
        </article>
        <article class="rounded-3xl border border-white/10 bg-gradient-to-br from-fuchsia-500/20 to-slate-900 p-5">
            <p class="text-sm text-fuchsia-100">Gem. oplostijd</p>
            <p class="mt-3 text-4xl font-semibold text-white">{{ $timeSummary['time_to_resolution_hours'] ? number_format($timeSummary['time_to_resolution_hours'], 1) . 'u' : 'n.v.t.' }}</p>
        </article>
    </section>

    <section class="grid gap-6 lg:grid-cols-[1.5fr,1fr]">
        <article class="rounded-3xl border border-white/10 bg-white/5 p-5">
            <div class="mb-4 flex items-center justify-between">
                <h2 class="text-xl font-semibold text-white">Volume per week</h2>
                <span class="text-xs uppercase tracking-[0.25em] text-slate-500">{{ count($volumeWeekly) }} datapunten</span>
            </div>
            <p class="mb-4 text-sm text-slate-400">Elk datapunt is een week x requesttype-combinatie met het aantal tickets.</p>
            <div class="space-y-3">
                @forelse ($volumeWeekly as $row)
                    <div class="flex items-center justify-between rounded-2xl bg-slate-900/60 px-4 py-3">
                        <div>
                            <p class="text-sm font-medium text-slate-200">{{ $row['request_type'] ?: 'Onbekend' }}</p>
                            <p class="text-xs text-slate-500">{{ $this->formatWeekLabel($row['week']) }}</p>
                        </div>
                        <p class="text-lg font-semibold text-white">{{ $row['tickets'] }}</p>
                    </div>
                @empty
                    <p class="text-sm text-slate-400">Nog geen weekvolume beschikbaar.</p>
                @endforelse
            </div>
        </article>

        <article class="rounded-3xl border border-white/10 bg-white/5 p-5">
            <h2 class="text-xl font-semibold text-white">Live alerts</h2>
            <div class="mt-4 space-y-3">
                @foreach (['priority1' => 'P1', 'first_response_due_critical' => 'SLA kritiek', 'time_to_resolution_warning' => 'TTR waarschuwing'] as $key => $label)
                    <div class="rounded-2xl bg-slate-900/60 p-4">
                        <div class="mb-2 flex items-center justify-between">
                            <p class="text-sm font-semibold text-slate-200">{{ $label }}</p>
                            <span class="rounded-full bg-cyan-400/10 px-3 py-1 text-xs text-cyan-100">{{ count($alerts[$key] ?? []) }}</span>
                        </div>
                        <div class="space-y-2">
                            @forelse ($alerts[$key] ?? [] as $alert)
                                <div class="rounded-2xl border border-white/5 px-3 py-2 text-sm text-slate-300">
                                    <p class="font-medium text-white">{{ $alert['issue_key'] }}</p>
                                    <p>{{ $alert['issue_summary'] }}</p>
                                </div>
                            @empty
                                <p class="text-sm text-slate-500">Geen actieve meldingen.</p>
                            @endforelse
                        </div>
                    </div>
                @endforeach
            </div>
        </article>
    </section>

    <section class="grid gap-6 lg:grid-cols-3">
        <article class="rounded-3xl border border-white/10 bg-white/5 p-5">
            <h2 class="text-xl font-semibold text-white">AI insights</h2>
            <div class="mt-4 space-y-3">
                @forelse ($insights as $insight)
                    <div class="rounded-2xl bg-slate-900/60 p-4">
                        <p class="text-sm font-semibold text-white">{{ $insight['title'] }}</p>
                        <p class="mt-1 text-sm text-slate-300">{{ $insight['summary'] }}</p>
                        <p class="mt-3 text-xs uppercase tracking-[0.25em] text-cyan-200">Score {{ $insight['score_pct'] }}%</p>
                    </div>
                @empty
                    <p class="text-sm text-slate-400">Nog geen actieve insights.</p>
                @endforelse
            </div>
        </article>

        <article class="rounded-3xl border border-white/10 bg-white/5 p-5">
            <h2 class="text-xl font-semibold text-white">Vandaag afwezig</h2>
            <div class="mt-4 space-y-3">
                @forelse ($vacationsToday as $vacation)
                    <div class="rounded-2xl bg-slate-900/60 p-4 text-sm text-slate-200">
                        <p class="font-semibold text-white">{{ $vacation['member_name'] }}</p>
                        <p>{{ $this->formatDate($vacation['start_date']) }} t/m {{ $this->formatDate($vacation['end_date']) }}</p>
                    </div>
                @empty
                    <p class="text-sm text-slate-400">Vandaag is niemand afwezig.</p>
                @endforelse
            </div>
        </article>

        <article class="rounded-3xl border border-white/10 bg-white/5 p-5">
            <h2 class="text-xl font-semibold text-white">Komende vakanties</h2>
            <div class="mt-4 space-y-3">
                @forelse ($vacationsUpcoming as $vacation)
                    <div class="rounded-2xl bg-slate-900/60 p-4 text-sm text-slate-200">
                        <p class="font-semibold text-white">{{ $vacation['member_name'] }}</p>
                        <p>{{ $this->formatDate($vacation['start_date']) }} t/m {{ $this->formatDate($vacation['end_date']) }}</p>
                    </div>
                @empty
                    <p class="text-sm text-slate-400">Geen aankomende vakanties.</p>
                @endforelse
            </div>
        </article>
    </section>

    <section class="rounded-3xl border border-white/10 bg-white/5 p-5">
        <div class="mb-4 flex items-center justify-between">
            <h2 class="text-xl font-semibold text-white">Alert logboek</h2>
            <span class="text-xs uppercase tracking-[0.25em] text-slate-500">{{ count($alertLogs) }} items</span>
        </div>
        <div class="space-y-3">
            @forelse ($alertLogs as $log)
                <div class="flex items-center justify-between rounded-2xl bg-slate-900/60 px-4 py-3 text-sm text-slate-300">
                    <div>
                        <p class="font-semibold text-white">{{ $log['issue_key'] }}</p>
                        <p>{{ $log['kind'] }} · {{ $log['status'] ?: 'status onbekend' }}</p>
                    </div>
                    <p class="text-slate-500">{{ $this->formatDateTime($log['detected_at']) }}</p>
                </div>
            @empty
                <p class="text-sm text-slate-400">Nog geen alert events.</p>
            @endforelse
        </div>
    </section>

    <section class="flex justify-end">
        <div class="rounded-full border border-white/10 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm">
            Bijgewerkt: {{ $kpiStats['sync_last_updated_label'] }}@if($kpiStats['sync_last_upserts_label']) · {{ $kpiStats['sync_last_upserts_label'] }}@endif
        </div>
    </section>
</div>
