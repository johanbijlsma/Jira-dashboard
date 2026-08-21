<div wire:poll.5s x-data="{ notificationsOpen: false }" @keydown.escape.window="notificationsOpen = false" class="space-y-5">
    <?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if BLOCK]><![endif]--><?php endif; ?><?php if($syncStatus['running'] ?? false): ?>
        <section class="rounded-2xl border border-sky-200 bg-sky-50 px-5 py-4 text-sky-900 shadow-sm">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="flex items-center gap-3">
                    <span class="relative flex h-3.5 w-3.5">
                        <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75"></span>
                        <span class="relative inline-flex h-3.5 w-3.5 rounded-full bg-sky-500"></span>
                    </span>
                    <div>
                        <p class="text-xs font-semibold uppercase tracking-[0.25em] text-sky-700">Sync actief</p>
                        <p class="text-sm font-semibold"><?php echo e($this->modeLabel($syncStatus['running_run']['mode'] ?? null)); ?> · <?php echo e($this->triggerLabel($syncStatus['running_run']['trigger_type'] ?? null)); ?></p>
                    </div>
                </div>
                <p class="text-sm">Gestart: <?php echo e($this->formatDateTime($syncStatus['running_run']['started_at'] ?? null)); ?></p>
            </div>
            <p class="mt-2 text-sm text-sky-800">Tijdens een full sync kunnen cijfers tijdelijk nog veranderen. De pagina ververst automatisch.</p>
        </section>
    <?php endif; ?><?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if ENDBLOCK]><![endif]--><?php endif; ?>

    <section class="flex flex-wrap items-start justify-between gap-4">
        <div>
            <h1 class="text-4xl font-semibold tracking-tight text-slate-900">Dashboard Servicedesk Planningsagenda</h1>
        </div>

        <div class="flex flex-wrap items-center gap-2">
            <span class="inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm">
                <?php echo e($this->formatDate($dateFrom)); ?> t/m <?php echo e($this->formatDate($dateTo)); ?>

            </span>
            <button type="button" class="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm">
                AI
                <span class="inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-xs"><?php echo e($aiCount); ?></span>
            </button>
            <button
                type="button"
                @click="notificationsOpen = true"
                class="relative inline-flex items-center rounded-xl bg-blue-600 px-3 py-2 text-white shadow-sm"
                aria-label="Notificaties"
            >
                <span class="text-sm font-semibold">●</span>
                <?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if BLOCK]><![endif]--><?php endif; ?><?php if($notificationCount > 0): ?>
                    <span class="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-xs font-semibold text-white"><?php echo e($notificationCount); ?></span>
                <?php endif; ?><?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if ENDBLOCK]><![endif]--><?php endif; ?>
            </button>
            <button type="button" class="inline-flex items-center rounded-xl border border-blue-300 bg-white px-4 py-2 text-sm font-semibold text-blue-700 shadow-sm">Layout aanpassen</button>
            <button wire:click="toggleFilters" type="button" class="inline-flex items-center rounded-xl border border-blue-300 bg-white px-4 py-2 text-sm font-semibold text-blue-700 shadow-sm">
                <?php echo e($showFilters ? 'Filters sluiten' : 'Filters openen'); ?>

            </button>
        </div>
    </section>

    <?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if BLOCK]><![endif]--><?php endif; ?><?php if($showFilters): ?>
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
                    <p><?php echo e(implode(', ', $config['team_members']) ?: 'Niet ingesteld'); ?></p>
                </div>
            </div>
        </section>
    <?php endif; ?><?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if ENDBLOCK]><![endif]--><?php endif; ?>

    <section class="grid gap-4 xl:grid-cols-8">
        <?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if BLOCK]><![endif]--><?php endif; ?><?php $__currentLoopData = $topCards; $__env->addLoop($__currentLoopData); foreach($__currentLoopData as $card): $__env->incrementLoopIndices(); $loop = $__env->getLastLoop(); ?>
            <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-1">
                <div class="flex items-start justify-between gap-3">
                    <div>
                        <p class="text-sm text-slate-500"><?php echo e($card['title']); ?></p>
                    </div>
                    <?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if BLOCK]><![endif]--><?php endif; ?><?php if($card['badge']): ?>
                        <span class="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700"><?php echo e($card['badge']); ?></span>
                    <?php endif; ?><?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if ENDBLOCK]><![endif]--><?php endif; ?>
                </div>
                <div class="mt-2">
                    <p class="text-4xl font-semibold tracking-tight text-slate-900"><?php echo e($card['value']); ?></p>
                    <?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if BLOCK]><![endif]--><?php endif; ?><?php if($card['secondary_value']): ?>
                        <p class="mt-1 text-sm font-medium text-slate-600"><?php echo e($card['secondary_label']); ?> <?php echo e($card['secondary_value']); ?></p>
                    <?php endif; ?><?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if ENDBLOCK]><![endif]--><?php endif; ?>
                </div>
                <p class="mt-2 text-sm <?php echo e($card['tone'] === 'placeholder' ? 'text-amber-700' : 'text-slate-500'); ?>"><?php echo e($card['meta']); ?></p>
            </article>
        <?php endforeach; $__env->popLoop(); $loop = $__env->getLastLoop(); ?><?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if ENDBLOCK]><![endif]--><?php endif; ?>
    </section>

    <section class="grid gap-4 xl:grid-cols-4">
        <?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if BLOCK]><![endif]--><?php endif; ?><?php $__currentLoopData = $summaryCards; $__env->addLoop($__currentLoopData); foreach($__currentLoopData as $card): $__env->incrementLoopIndices(); $loop = $__env->getLastLoop(); ?>
            <article class="rounded-2xl border border-orange-200 bg-white p-4 shadow-sm">
                <div class="flex items-start justify-between gap-3">
                    <p class="text-sm text-slate-500"><?php echo e($card['title']); ?></p>
                    <span class="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-600"><?php echo e($card['badge']); ?></span>
                </div>
                <p class="mt-2 text-3xl font-semibold text-slate-900"><?php echo e($card['value']); ?></p>
                <p class="mt-2 text-sm <?php echo e($card['tone'] === 'placeholder' ? 'text-amber-700' : 'text-slate-500'); ?>"><?php echo e($card['meta']); ?></p>
            </article>
        <?php endforeach; $__env->popLoop(); $loop = $__env->getLastLoop(); ?><?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if ENDBLOCK]><![endif]--><?php endif; ?>
    </section>

    <section class="grid gap-4 xl:grid-cols-[1.35fr,1.55fr,1.1fr]">
        <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div class="flex items-center justify-between gap-3">
                <div>
                    <h2 class="text-2xl font-semibold text-slate-900">Aantal tickets per week</h2>
                    <span class="mt-1 inline-flex rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">Lopende week *</span>
                </div>
            </div>
            <p class="mt-2 text-sm text-slate-500">Tickets per soort met gestippelde lijnen voor totaal en voortschrijdend gemiddelde.</p>
            <?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if BLOCK]><![endif]--><?php endif; ?><?php if(!empty($weeklyTicketChartConfig)): ?>
                <div
                    wire:key="weekly-ticket-chart-<?php echo e($dateFrom); ?>-<?php echo e($dateTo); ?>-<?php echo e($servicedeskOnly ? 1 : 0); ?>"
                    wire:ignore
                    x-data='lineChart(<?php echo json_encode($weeklyTicketChartConfig, 15, 512) ?>)'
                    class="relative mt-4 h-[420px] w-full"
                >
                    <canvas x-ref="canvas" class="h-full w-full"></canvas>
                </div>
            <?php else: ?>
                <p class="mt-4 text-sm text-slate-500">Nog geen weekdata beschikbaar.</p>
            <?php endif; ?><?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if ENDBLOCK]><![endif]--><?php endif; ?>
        </article>

        <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div class="flex items-center justify-between gap-3">
                <div>
                    <h2 class="text-2xl font-semibold text-slate-900">Onderwerp trends</h2>
                    <span class="mt-1 inline-flex rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">Lopende week *</span>
                </div>
            </div>
            <div class="mt-3 grid gap-4 lg:grid-cols-[0.95fr,1.15fr]">
                <div class="space-y-3">
                    <p class="text-sm text-slate-500">Top-5 onderwerpen binnen de huidige periode.</p>
                    <?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if BLOCK]><![endif]--><?php endif; ?><?php $__empty_1 = true; $__currentLoopData = $onderwerpTrendRows; $__env->addLoop($__currentLoopData); foreach($__currentLoopData as $row): $__env->incrementLoopIndices(); $loop = $__env->getLastLoop(); $__empty_1 = false; ?>
                        <div class="flex items-center gap-3">
                            <div class="min-w-0 flex-1">
                                <div class="mb-1 flex items-center justify-between gap-3 text-sm">
                                    <span class="truncate font-medium text-slate-700"><?php echo e($row['onderwerp']); ?></span>
                                    <span class="text-slate-500"><?php echo e($row['tickets']); ?></span>
                                </div>
                                <div class="h-2 rounded-full bg-slate-200">
                                    <div class="h-2 rounded-full bg-orange-500" style="width: <?php echo e($row['width']); ?>%"></div>
                                </div>
                            </div>
                        </div>
                    <?php endforeach; $__env->popLoop(); $loop = $__env->getLastLoop(); if ($__empty_1): ?>
                        <p class="text-sm text-amber-700">Parity-gap: onderwerptrends zijn nog niet beschikbaar.</p>
                    <?php endif; ?><?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if ENDBLOCK]><![endif]--><?php endif; ?>
                </div>

                <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p class="text-sm text-slate-500">Geselecteerd onderwerp</p>
                    <?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if BLOCK]><![endif]--><?php endif; ?><?php if(!empty($onderwerpTrendRows)): ?>
                        <p class="mt-2 text-3xl font-semibold text-slate-900"><?php echo e($onderwerpTrendRows[0]['onderwerp']); ?></p>
                        <p class="mt-1 text-sm text-slate-500"><?php echo e($onderwerpTrendRows[0]['tickets']); ?> tickets in de gekozen periode</p>
                    <?php else: ?>
                        <p class="mt-2 text-sm text-amber-700">Parity-gap: nog geen onderwerpdetails beschikbaar.</p>
                    <?php endif; ?><?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if ENDBLOCK]><![endif]--><?php endif; ?>
                </div>
            </div>
        </article>

        <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div class="flex items-center justify-between gap-3">
                <div>
                    <h2 class="text-2xl font-semibold text-slate-900">Binnengekomen vs afgesloten</h2>
                    <span class="mt-1 inline-flex rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">Lopende week *</span>
                </div>
            </div>
            <div class="mt-4 space-y-3">
                <?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if BLOCK]><![endif]--><?php endif; ?><?php $__empty_1 = true; $__currentLoopData = $closedVsIncomingRows; $__env->addLoop($__currentLoopData); foreach($__currentLoopData as $row): $__env->incrementLoopIndices(); $loop = $__env->getLastLoop(); $__empty_1 = false; ?>
                    <div class="rounded-xl border border-slate-100 bg-slate-50 p-3">
                        <div class="mb-2 flex items-center justify-between gap-3">
                            <p class="text-sm font-semibold text-slate-700"><?php echo e($this->formatWeekLabel($row['week'])); ?></p>
                            <p class="text-xs text-slate-500"><?php echo e($row['incoming_count']); ?> / <?php echo e($row['closed_count']); ?></p>
                        </div>
                        <div class="grid gap-2">
                            <div class="flex items-center gap-2">
                                <span class="w-24 text-xs text-slate-500">Binnengekomen</span>
                                <div class="h-2 flex-1 rounded-full bg-slate-200">
                                    <div class="h-2 rounded-full bg-blue-500" style="width: <?php echo e($row['incoming_width']); ?>%"></div>
                                </div>
                            </div>
                            <div class="flex items-center gap-2">
                                <span class="w-24 text-xs text-slate-500">Afgesloten</span>
                                <div class="h-2 flex-1 rounded-full bg-slate-200">
                                    <div class="h-2 rounded-full bg-emerald-500" style="width: <?php echo e($row['closed_width']); ?>%"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                <?php endforeach; $__env->popLoop(); $loop = $__env->getLastLoop(); if ($__empty_1): ?>
                    <p class="text-sm text-slate-500">Nog geen vergelijkingsdata beschikbaar.</p>
                <?php endif; ?><?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if ENDBLOCK]><![endif]--><?php endif; ?>
            </div>
        </article>
    </section>

    <section class="grid gap-4 xl:grid-cols-[1fr,1fr]">
        <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 class="text-xl font-semibold text-slate-900">AI insights</h2>
            <div class="mt-4 space-y-3">
                <?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if BLOCK]><![endif]--><?php endif; ?><?php $__empty_1 = true; $__currentLoopData = $insights; $__env->addLoop($__currentLoopData); foreach($__currentLoopData as $insight): $__env->incrementLoopIndices(); $loop = $__env->getLastLoop(); $__empty_1 = false; ?>
                    <div class="rounded-xl border border-slate-100 bg-slate-50 p-4">
                        <p class="text-sm font-semibold text-slate-900"><?php echo e($insight['title']); ?></p>
                        <p class="mt-1 text-sm text-slate-600"><?php echo e($insight['summary']); ?></p>
                        <p class="mt-3 text-xs uppercase tracking-[0.25em] text-blue-700">Score <?php echo e($this->formatDecimal($insight['score_pct'])); ?>%</p>
                    </div>
                <?php endforeach; $__env->popLoop(); $loop = $__env->getLastLoop(); if ($__empty_1): ?>
                    <p class="text-sm text-slate-500">Nog geen actieve insights.</p>
                <?php endif; ?><?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if ENDBLOCK]><![endif]--><?php endif; ?>
            </div>
        </article>

        <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 class="text-xl font-semibold text-slate-900">Teamplanning</h2>
            <div class="mt-4 space-y-4">
                <div>
                    <p class="text-sm font-semibold text-slate-700">Vandaag afwezig</p>
                    <div class="mt-2 space-y-2">
                        <?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if BLOCK]><![endif]--><?php endif; ?><?php $__empty_1 = true; $__currentLoopData = $vacationsToday; $__env->addLoop($__currentLoopData); foreach($__currentLoopData as $vacation): $__env->incrementLoopIndices(); $loop = $__env->getLastLoop(); $__empty_1 = false; ?>
                            <div class="rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm text-slate-600">
                                <p class="font-semibold text-slate-900"><?php echo e($vacation['member_name']); ?></p>
                                <p><?php echo e($this->formatDate($vacation['start_date'])); ?> t/m <?php echo e($this->formatDate($vacation['end_date'])); ?></p>
                            </div>
                        <?php endforeach; $__env->popLoop(); $loop = $__env->getLastLoop(); if ($__empty_1): ?>
                            <p class="text-sm text-slate-500">Vandaag is niemand afwezig.</p>
                        <?php endif; ?><?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if ENDBLOCK]><![endif]--><?php endif; ?>
                    </div>
                </div>
                <div>
                    <p class="text-sm font-semibold text-slate-700">Komende vakanties</p>
                    <div class="mt-2 space-y-2">
                        <?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if BLOCK]><![endif]--><?php endif; ?><?php $__empty_1 = true; $__currentLoopData = $vacationsUpcoming; $__env->addLoop($__currentLoopData); foreach($__currentLoopData as $vacation): $__env->incrementLoopIndices(); $loop = $__env->getLastLoop(); $__empty_1 = false; ?>
                            <div class="rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm text-slate-600">
                                <p class="font-semibold text-slate-900"><?php echo e($vacation['member_name']); ?></p>
                                <p><?php echo e($this->formatDate($vacation['start_date'])); ?> t/m <?php echo e($this->formatDate($vacation['end_date'])); ?></p>
                            </div>
                        <?php endforeach; $__env->popLoop(); $loop = $__env->getLastLoop(); if ($__empty_1): ?>
                            <p class="text-sm text-slate-500">Geen aankomende vakanties.</p>
                        <?php endif; ?><?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if ENDBLOCK]><![endif]--><?php endif; ?>
                    </div>
                </div>
            </div>
        </article>
    </section>

    <section class="flex justify-end">
        <div class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm">
            Bijgewerkt: <?php echo e($kpiStats['sync_last_updated_label']); ?><?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if BLOCK]><![endif]--><?php endif; ?><?php if($kpiStats['sync_last_upserts_label']): ?> · <?php echo e($kpiStats['sync_last_upserts_label']); ?><?php endif; ?><?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if ENDBLOCK]><![endif]--><?php endif; ?>
        </div>
    </section>

    <div
        x-cloak
        x-show="notificationsOpen"
        x-transition.opacity
        class="fixed inset-0 z-40 bg-slate-950/30"
        @click="notificationsOpen = false"
    ></div>

    <aside
        x-cloak
        x-show="notificationsOpen"
        x-transition:enter="transform transition ease-out duration-300"
        x-transition:enter-start="translate-x-full"
        x-transition:enter-end="translate-x-0"
        x-transition:leave="transform transition ease-in duration-200"
        x-transition:leave-start="translate-x-0"
        x-transition:leave-end="translate-x-full"
        class="fixed inset-y-0 right-0 z-50 flex h-full w-[min(96vw,1400px)] max-w-none flex-col border-l border-slate-200 bg-slate-50 shadow-2xl"
        aria-label="Notificaties paneel"
    >
        <div class="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-5">
            <div>
                <p class="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Notificaties</p>
                <h2 class="mt-2 text-2xl font-semibold text-slate-900">Alert logboek</h2>
                <?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if BLOCK]><![endif]--><?php endif; ?><?php if($alertSnapshotMessage): ?>
                    <p class="mt-2 text-sm text-emerald-700"><?php echo e($alertSnapshotMessage); ?></p>
                <?php endif; ?><?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if ENDBLOCK]><![endif]--><?php endif; ?>
            </div>
            <button type="button" @click="notificationsOpen = false" class="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-sm">
                Sluiten
            </button>
        </div>

        <div class="border-b border-slate-200 bg-white px-6 py-4">
            <p class="text-sm text-slate-500">Alerts logboek - <?php echo e($alertLogGroupCount); ?> groepen / <?php echo e($alertLogTotalCount); ?> gebeurtenissen</p>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-4">
            <div class="flex flex-wrap items-center gap-3">
                <span class="text-sm text-slate-500">Meest recente alerts bovenaan</span>
                <label class="flex items-center gap-2 text-sm text-slate-500">
                    <span>Soort</span>
                    <select wire:model.live="alertLogKindFilter" class="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 shadow-sm">
                        <?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if BLOCK]><![endif]--><?php endif; ?><?php $__currentLoopData = $alertLogKindOptions; $__env->addLoop($__currentLoopData); foreach($__currentLoopData as $option): $__env->incrementLoopIndices(); $loop = $__env->getLastLoop(); ?>
                            <option value="<?php echo e($option['value']); ?>"><?php echo e($option['label']); ?></option>
                        <?php endforeach; $__env->popLoop(); $loop = $__env->getLastLoop(); ?><?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if ENDBLOCK]><![endif]--><?php endif; ?>
                    </select>
                </label>
            </div>
            <div class="flex flex-wrap items-center gap-3">
                <button
                    wire:click="captureAlertSnapshot"
                    wire:loading.attr="disabled"
                    wire:target="captureAlertSnapshot"
                    type="button"
                    class="inline-flex items-center rounded-xl border border-blue-300 bg-white px-4 py-2 text-sm font-semibold text-blue-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                >
                    <span wire:loading.remove wire:target="captureAlertSnapshot">Snapshot nu</span>
                    <span wire:loading wire:target="captureAlertSnapshot">Opslaan...</span>
                </button>
                <button
                    wire:click="clearAlertLogs"
                    wire:loading.attr="disabled"
                    wire:target="clearAlertLogs"
                    type="button"
                    class="inline-flex items-center rounded-xl border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                >
                    Logboek legen
                </button>
            </div>
        </div>

        <div class="flex-1 overflow-y-auto px-6 py-5">
            <div class="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                <table class="min-w-full text-left text-sm text-slate-700">
                    <thead class="bg-slate-50 text-slate-900">
                        <tr class="border-b border-slate-200">
                            <th class="px-4 py-3 font-semibold">Tijd</th>
                            <th class="px-4 py-3 font-semibold">Soort</th>
                            <th class="px-4 py-3 font-semibold">Issue</th>
                            <th class="px-4 py-3 font-semibold">Laatste info</th>
                            <th class="px-4 py-3 font-semibold text-right">Aantal</th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if BLOCK]><![endif]--><?php endif; ?><?php $__empty_1 = true; $__currentLoopData = $alertLogGroups; $__env->addLoop($__currentLoopData); foreach($__currentLoopData as $log): $__env->incrementLoopIndices(); $loop = $__env->getLastLoop(); $__empty_1 = false; ?>
                            <tr class="border-b border-slate-100 align-top">
                                <td class="px-4 py-3 text-slate-700"><?php echo e($this->formatDateTime($log['detected_at'])); ?></td>
                                <td class="px-4 py-3">
                                    <span class="inline-flex rounded-full border px-3 py-1 text-xs font-semibold <?php echo e($this->alertKindBadgeClasses($log['kind'])); ?>">
                                        <?php echo e($log['kind_label']); ?>

                                    </span>
                                </td>
                                <td class="px-4 py-3">
                                    <?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if BLOCK]><![endif]--><?php endif; ?><?php if($log['issue_key']): ?>
                                        <a
                                            href="<?php echo e($this->jiraIssueUrl($log['issue_key'])); ?>"
                                            target="_blank"
                                            rel="noreferrer"
                                            class="font-semibold text-blue-600 underline decoration-blue-200 underline-offset-4"
                                        >
                                            <?php echo e($log['issue_key']); ?>

                                        </a>
                                    <?php else: ?>
                                        <span class="text-slate-400">-</span>
                                    <?php endif; ?><?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if ENDBLOCK]><![endif]--><?php endif; ?>
                                </td>
                                <td class="px-4 py-3 text-slate-700"><?php echo e($log['meta'] ?: '—'); ?></td>
                                <td class="px-4 py-3 text-right">
                                    <span class="inline-flex rounded-xl border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700">
                                        <?php echo e($log['count']); ?>x
                                    </span>
                                </td>
                            </tr>
                        <?php endforeach; $__env->popLoop(); $loop = $__env->getLastLoop(); if ($__empty_1): ?>
                            <tr>
                                <td colspan="5" class="px-4 py-6 text-sm text-slate-500">Nog geen alert events.</td>
                            </tr>
                        <?php endif; ?><?php if(\Livewire\Mechanisms\ExtendBlade\ExtendBlade::isRenderingLivewireComponent()): ?><!--[if ENDBLOCK]><![endif]--><?php endif; ?>
                    </tbody>
                </table>
            </div>
        </div>
    </aside>
</div>
<?php /**PATH /Users/johanbijlsma/Repos/Jira-dashboard/resources/views/livewire/dashboard-page.blade.php ENDPATH**/ ?>