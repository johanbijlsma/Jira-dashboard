<!DOCTYPE html>
<html lang="nl">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Jira Dashboard</title>
    @vite(['resources/css/app.css', 'resources/js/app.js'])
    @livewireStyles
</head>
<body class="min-h-screen bg-slate-950 text-slate-100">
    @php
        $navLinkClass = static function (bool $active): string {
            return $active
                ? 'rounded-full border border-cyan-300 bg-cyan-400/10 px-4 py-2 text-white shadow-[0_0_0_1px_rgba(34,211,238,0.2)]'
                : 'rounded-full border border-white/15 px-4 py-2 text-slate-200 transition hover:border-cyan-300 hover:text-white';
        };
    @endphp
    <div class="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header class="mb-8 flex flex-col gap-3 border-b border-white/10 pb-6 md:flex-row md:items-end md:justify-between">
            <div>
                <p class="text-sm uppercase tracking-[0.3em] text-cyan-300">Servicedesk Analytics</p>
                <h1 class="mt-2 text-4xl font-semibold tracking-tight text-white">Jira Dashboard</h1>
            </div>
            <nav class="flex gap-3 text-sm">
                <a class="{{ $navLinkClass(request()->routeIs('dashboard')) }}" href="{{ route('dashboard') }}" aria-current="{{ request()->routeIs('dashboard') ? 'page' : 'false' }}">Dashboard</a>
                <a class="{{ $navLinkClass(request()->routeIs('status')) }}" href="{{ route('status') }}" aria-current="{{ request()->routeIs('status') ? 'page' : 'false' }}">Status</a>
            </nav>
        </header>
        {{ $slot ?? '' }}
        @yield('content')
    </div>
    @livewireScripts
</body>
</html>
