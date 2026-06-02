<!DOCTYPE html>
<html lang="nl">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Dashboard Servicedesk Planningsagenda</title>
    @vite(['resources/css/app.css', 'resources/js/app.js'])
    @livewireStyles
</head>
<body class="min-h-screen bg-slate-100 text-slate-900">
    @php
        $navLinkClass = static function (bool $active): string {
            return $active
                ? 'rounded-full border border-blue-300 bg-blue-50 px-4 py-2 text-blue-700 shadow-sm'
                : 'rounded-full border border-slate-200 bg-white px-4 py-2 text-slate-600 transition hover:border-blue-300 hover:text-blue-700';
        };
    @endphp
    <div class="w-full px-4 py-6 sm:px-6 xl:px-8 2xl:px-10">
        <header class="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
                <p class="text-sm font-medium text-slate-500">Planningsagenda / Jira</p>
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
