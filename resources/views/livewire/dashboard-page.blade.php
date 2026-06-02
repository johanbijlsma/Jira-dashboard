<div wire:poll.5s class="space-y-5">
    @if ($syncStatus['running'] ?? false)
        <section class="rounded-2xl border border-sky-200 bg-sky-50 px-5 py-4 text-sky-900 shadow-sm">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="flex items-center gap-3">
                    <span class="relative flex h-3.5 w-3.5">
                        <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75"></span>
                        <span class="relative inline-flex h-3.5 w-3.5 rounded-full bg-sky-500"></span>
                    </span>
                    <div>
                        <p class="text-xs font-semibold uppercase tracking-[0.25em] text-sky-700">Sync actief</p>
                        <p class="text-sm font-semibold">{{ $this->modeLabel($syncStatus['running_run']['mode'] ?? null) }} · {{ $this->triggerLabel($syncStatus['running_run']['trigger_type'] ?? null) }}</p>
                    </div>
                </div>
                <p class="text-sm">Gestart: {{ $this->formatDateTime($syncStatus['running_run']['started_at'] ?? null) }}</p>
            </div>
            <p class="mt-2 text-sm text-sky-800">Tijdens een full sync kunnen cijfers tijdelijk nog veranderen. De pagina ververst automatisch.</p>
        </section>
    @endif

    <section class="flex flex-wrap items-start justify-between gap-4">
        <div>
            <h1 class="text-4xl font-semibold tracking-tight text-slate-900">Dashboard Servicedesk Planningsagenda</h1>
        </div>

        <div class="flex flex-wrap items-center gap-2">
            <span class="inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm">
                {{ $this->formatDate($dateFrom) }} t/m {{ $this->formatDate($dateTo) }}
            </span>
            <button type="button" class="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm">
                AI
                <span class="inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-xs">{{ $aiCount }}</span>
            </button>
            <button type="button" class="relative inline-flex items-center rounded-xl bg-blue-600 px-3 py-2 text-white shadow-sm" aria-label="Notificaties">
                <span class="text-sm font-semibold">●</span>
                @if ($notificationCount > 0)
                    <span class="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-xs font-semibold text-white">{{ $notificationCount }}</span>
                @endif
            </button>
            <button type="button" class="inline-flex items-center rounded-xl border border-blue-300 bg-white px-4 py-2 text-sm font-semibold text-blue-700 shadow-sm">Layout aanpassen</button>
            <button wire:click="toggleFilters" type="button" class="inline-flex items-center rounded-xl border border-blue-300 bg-white px-4 py-2 text-sm font-semibold text-blue-700 shadow-sm">
                {{ $showFilters ? 'Filters sluiten' : 'Filters openen' }}
            </button>
        </div>
    </section>

    @if ($showFilters)
        <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div class="mb-4 flex items-center justify-between gap-3">
                <div>
                    <p class="text-sm font-semibold text-slate-900">Filters</p>
                    <p class="text-sm text-slate-500">Gebruik dezelfde servicedesk-scope als in het oude dashboard.</p>
                </div>
                <button wire:click="closeFilters" type="button" class="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600">Sluiten</button>
            </div>
            <div class="grid gap-4 md:grid-cols-[1fr,1fr,auto,1fr]">
                <label class="space-y-2">
                    <span class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Van</span>
                    <input wire:model.live="dateFrom" type="date" class="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 shadow-sm">
                </label>
                <label class="space-y-2">
                    <span class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Tot</span>
                    <input wire:model.live="dateTo" type="date" class="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 shadow-sm">
                </label>
                <label class="flex items-end gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <input wire:model.live="servicedeskOnly" type="checkbox" class="rounded border-slate-300 text-blue-600">
                    <span class="text-sm text-slate-700">Alleen servicedesk data</span>
                </label>
                <div class="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                    <p class="font-semibold text-slate-900">Teamleden</p>
                    <p>{{ implode(', ', $config['team_members']) ?: 'Niet ingesteld' }}</p>
                </div>
            </div>
        </section>
    @endif

    <section class="grid gap-4 xl:grid-cols-8">
        @foreach ($topCards as $card)
            <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-1">
                <div class="flex items-start justify-between gap-3">
                    <div>
                        <p class="text-sm text-slate-500">{{ $card['title'] }}</p>
                    </div>
                    @if ($card['badge'])
                        <span class="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">{{ $card['badge'] }}</span>
                    @endif
                </div>
                <div class="mt-2">
                    <p class="text-4xl font-semibold tracking-tight text-slate-900">{{ $card['value'] }}</p>
                    @if ($card['secondary_value'])
                        <p class="mt-1 text-sm font-medium text-slate-600">{{ $card['secondary_label'] }} {{ $card['secondary_value'] }}</p>
                    @endif
                </div>
                <p class="mt-2 text-sm {{ $card['tone'] === 'placeholder' ? 'text-amber-700' : 'text-slate-500' }}">{{ $card['meta'] }}</p>
            </article>
        @endforeach
    </section>

    <section class="grid gap-4 xl:grid-cols-4">
        @foreach ($summaryCards as $card)
            <article class="rounded-2xl border border-orange-200 bg-white p-4 shadow-sm">
                <div class="flex items-start justify-between gap-3">
                    <p class="text-sm text-slate-500">{{ $card['title'] }}</p>
                    <span class="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-600">{{ $card['badge'] }}</span>
                </div>
                <p class="mt-2 text-3xl font-semibold text-slate-900">{{ $card['value'] }}</p>
                <p class="mt-2 text-sm {{ $card['tone'] === 'placeholder' ? 'text-amber-700' : 'text-slate-500' }}">{{ $card['meta'] }}</p>
            </article>
        @endforeach
    </section>

    <section class="grid gap-4 xl:grid-cols-[1.35fr,1.55fr,1.1fr]">
        <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div class="flex items-center justify-between gap-3">
                <div>
                    <h2 class="text-2xl font-semibold text-slate-900">Aantal tickets per week</h2>
                    <span class="mt-1 inline-flex rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">Lopende week</span>
                </div>
            </div>
            <div class="mt-4 space-y-3">
                @forelse ($weeklyTicketRows as $row)
                    <div class="rounded-xl border border-slate-100 bg-slate-50 p-3">
                        <div class="mb-2 flex items-center justify-between gap-3">
                            <p class="text-sm font-semibold text-slate-700">{{ $this->formatWeekLabel($row['week']) }}</p>
                            <p class="text-xs text-slate-500">{{ $row['incoming_count'] }} tickets</p>
                        </div>
                        <div class="space-y-2">
                            <div>
                                <div class="mb-1 flex justify-between text-xs text-slate-500">
                                    <span>Binnengekomen</span>
                                    <span>{{ $row['incoming_count'] }}</span>
                                </div>
                                <div class="h-2 rounded-full bg-slate-200">
                                    <div class="h-2 rounded-full bg-blue-500" style="width: {{ $row['incoming_width'] }}%"></div>
                                </div>
                            </div>
                            <div>
                                <div class="mb-1 flex justify-between text-xs text-slate-500">
                                    <span>Afgesloten</span>
                                    <span>{{ $row['closed_count'] }}</span>
                                </div>
                                <div class="h-2 rounded-full bg-slate-200">
                                    <div class="h-2 rounded-full bg-emerald-500" style="width: {{ $row['closed_width'] }}%"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                @empty
                    <p class="text-sm text-slate-500">Nog geen weekdata beschikbaar.</p>
                @endforelse
            </div>
        </article>

        <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div class="flex items-center justify-between gap-3">
                <div>
                    <h2 class="text-2xl font-semibold text-slate-900">Onderwerp trends</h2>
                    <span class="mt-1 inline-flex rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">Lopende week</span>
                </div>
            </div>
            <div class="mt-3 grid gap-4 lg:grid-cols-[0.95fr,1.15fr]">
                <div class="space-y-3">
                    <p class="text-sm text-slate-500">Top-5 onderwerpen binnen de huidige periode.</p>
                    @forelse ($onderwerpTrendRows as $row)
                        <div class="flex items-center gap-3">
                            <div class="min-w-0 flex-1">
                                <div class="mb-1 flex items-center justify-between gap-3 text-sm">
                                    <span class="truncate font-medium text-slate-700">{{ $row['onderwerp'] }}</span>
                                    <span class="text-slate-500">{{ $row['tickets'] }}</span>
                                </div>
                                <div class="h-2 rounded-full bg-slate-200">
                                    <div class="h-2 rounded-full bg-orange-500" style="width: {{ $row['width'] }}%"></div>
                                </div>
                            </div>
                        </div>
                    @empty
                        <p class="text-sm text-amber-700">Parity-gap: onderwerptrends zijn nog niet beschikbaar.</p>
                    @endforelse
                </div>

                <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p class="text-sm text-slate-500">Geselecteerd onderwerp</p>
                    @if (!empty($onderwerpTrendRows))
                        <p class="mt-2 text-3xl font-semibold text-slate-900">{{ $onderwerpTrendRows[0]['onderwerp'] }}</p>
                        <p class="mt-1 text-sm text-slate-500">{{ $onderwerpTrendRows[0]['tickets'] }} tickets in de gekozen periode</p>
                    @else
                        <p class="mt-2 text-sm text-amber-700">Parity-gap: nog geen onderwerpdetails beschikbaar.</p>
                    @endif
                </div>
            </div>
        </article>

        <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div class="flex items-center justify-between gap-3">
                <div>
                    <h2 class="text-2xl font-semibold text-slate-900">Binnengekomen vs afgesloten</h2>
                    <span class="mt-1 inline-flex rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">Lopende week</span>
                </div>
            </div>
            <div class="mt-4 space-y-3">
                @forelse ($closedVsIncomingRows as $row)
                    <div class="rounded-xl border border-slate-100 bg-slate-50 p-3">
                        <div class="mb-2 flex items-center justify-between gap-3">
                            <p class="text-sm font-semibold text-slate-700">{{ $this->formatWeekLabel($row['week']) }}</p>
                            <p class="text-xs text-slate-500">{{ $row['incoming_count'] }} / {{ $row['closed_count'] }}</p>
                        </div>
                        <div class="grid gap-2">
                            <div class="flex items-center gap-2">
                                <span class="w-24 text-xs text-slate-500">Binnengekomen</span>
                                <div class="h-2 flex-1 rounded-full bg-slate-200">
                                    <div class="h-2 rounded-full bg-blue-500" style="width: {{ $row['incoming_width'] }}%"></div>
                                </div>
                            </div>
                            <div class="flex items-center gap-2">
                                <span class="w-24 text-xs text-slate-500">Afgesloten</span>
                                <div class="h-2 flex-1 rounded-full bg-slate-200">
                                    <div class="h-2 rounded-full bg-emerald-500" style="width: {{ $row['closed_width'] }}%"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                @empty
                    <p class="text-sm text-slate-500">Nog geen vergelijkingsdata beschikbaar.</p>
                @endforelse
            </div>
        </article>
    </section>

    <section class="grid gap-4 xl:grid-cols-[1.2fr,1fr,1fr]">
        <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 class="text-xl font-semibold text-slate-900">Live alerts</h2>
            <div class="mt-4 space-y-3">
                @foreach (['priority1' => 'P1', 'first_response_due_critical' => 'SLA kritiek', 'time_to_resolution_warning' => 'TTR waarschuwing'] as $key => $label)
                    <div class="rounded-xl border border-slate-100 bg-slate-50 p-3">
                        <div class="mb-2 flex items-center justify-between gap-3">
                            <p class="text-sm font-semibold text-slate-700">{{ $label }}</p>
                            <span class="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">{{ count($alerts[$key] ?? []) }}</span>
                        </div>
                        <div class="space-y-2">
                            @forelse (($alerts[$key] ?? []) as $alert)
                                <div class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                                    <p class="font-semibold text-slate-900">{{ $alert['issue_key'] }}</p>
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

        <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 class="text-xl font-semibold text-slate-900">AI insights</h2>
            <div class="mt-4 space-y-3">
                @forelse ($insights as $insight)
                    <div class="rounded-xl border border-slate-100 bg-slate-50 p-4">
                        <p class="text-sm font-semibold text-slate-900">{{ $insight['title'] }}</p>
                        <p class="mt-1 text-sm text-slate-600">{{ $insight['summary'] }}</p>
                        <p class="mt-3 text-xs uppercase tracking-[0.25em] text-blue-700">Score {{ $this->formatDecimal($insight['score_pct']) }}%</p>
                    </div>
                @empty
                    <p class="text-sm text-slate-500">Nog geen actieve insights.</p>
                @endforelse
            </div>
        </article>

        <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 class="text-xl font-semibold text-slate-900">Teamplanning</h2>
            <div class="mt-4 space-y-4">
                <div>
                    <p class="text-sm font-semibold text-slate-700">Vandaag afwezig</p>
                    <div class="mt-2 space-y-2">
                        @forelse ($vacationsToday as $vacation)
                            <div class="rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm text-slate-600">
                                <p class="font-semibold text-slate-900">{{ $vacation['member_name'] }}</p>
                                <p>{{ $this->formatDate($vacation['start_date']) }} t/m {{ $this->formatDate($vacation['end_date']) }}</p>
                            </div>
                        @empty
                            <p class="text-sm text-slate-500">Vandaag is niemand afwezig.</p>
                        @endforelse
                    </div>
                </div>
                <div>
                    <p class="text-sm font-semibold text-slate-700">Komende vakanties</p>
                    <div class="mt-2 space-y-2">
                        @forelse ($vacationsUpcoming as $vacation)
                            <div class="rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm text-slate-600">
                                <p class="font-semibold text-slate-900">{{ $vacation['member_name'] }}</p>
                                <p>{{ $this->formatDate($vacation['start_date']) }} t/m {{ $this->formatDate($vacation['end_date']) }}</p>
                            </div>
                        @empty
                            <p class="text-sm text-slate-500">Geen aankomende vakanties.</p>
                        @endforelse
                    </div>
                </div>
            </div>
        </article>
    </section>

    <section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="mb-4 flex items-center justify-between gap-3">
            <h2 class="text-xl font-semibold text-slate-900">Alert logboek</h2>
            <span class="text-xs uppercase tracking-[0.25em] text-slate-500">{{ count($alertLogs) }} items</span>
        </div>
        <div class="space-y-3">
            @forelse ($alertLogs as $log)
                <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    <div>
                        <p class="font-semibold text-slate-900">{{ $log['issue_key'] }}</p>
                        <p>{{ $log['kind'] }} · {{ $log['status'] ?: 'status onbekend' }}</p>
                    </div>
                    <p class="text-slate-500">{{ $this->formatDateTime($log['detected_at']) }}</p>
                </div>
            @empty
                <p class="text-sm text-slate-500">Nog geen alert events.</p>
            @endforelse
        </div>
    </section>

    <section class="flex justify-end">
        <div class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm">
            Bijgewerkt: {{ $kpiStats['sync_last_updated_label'] }}@if($kpiStats['sync_last_upserts_label']) · {{ $kpiStats['sync_last_upserts_label'] }}@endif
        </div>
    </section>
</div>
