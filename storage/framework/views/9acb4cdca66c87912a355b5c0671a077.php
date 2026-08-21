<!DOCTYPE html>
<html lang="nl">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Dashboard Servicedesk Planningsagenda</title>
    <link rel="icon" href="<?php echo e(asset('favicon.ico')); ?>" type="image/x-icon">
    <style>[x-cloak]{display:none!important;}</style>
    <?php echo app('Illuminate\Foundation\Vite')(['resources/css/app.css', 'resources/js/app.js']); ?>
    <?php echo \Livewire\Mechanisms\FrontendAssets\FrontendAssets::styles(); ?>

</head>
<body class="min-h-screen bg-slate-100 text-slate-900">
    <?php
        $navLinkClass = static function (bool $active): string {
            return $active
                ? 'rounded-full border border-blue-300 bg-blue-50 px-4 py-2 text-blue-700 shadow-sm'
                : 'rounded-full border border-slate-200 bg-white px-4 py-2 text-slate-600 transition hover:border-blue-300 hover:text-blue-700';
        };
    ?>
    <div class="w-full px-4 py-6 sm:px-6 xl:px-8 2xl:px-10">
        <header class="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
                <p class="text-sm font-medium text-slate-500">Planningsagenda / Jira</p>
            </div>
            <nav class="flex gap-3 text-sm">
                <a class="<?php echo e($navLinkClass(request()->routeIs('dashboard'))); ?>" href="<?php echo e(route('dashboard')); ?>" aria-current="<?php echo e(request()->routeIs('dashboard') ? 'page' : 'false'); ?>">Dashboard</a>
                <a class="<?php echo e($navLinkClass(request()->routeIs('status'))); ?>" href="<?php echo e(route('status')); ?>" aria-current="<?php echo e(request()->routeIs('status') ? 'page' : 'false'); ?>">Status</a>
            </nav>
        </header>
        <?php echo e($slot ?? ''); ?>

        <?php echo $__env->yieldContent('content'); ?>
    </div>
    <?php echo \Livewire\Mechanisms\FrontendAssets\FrontendAssets::scripts(); ?>

</body>
</html>
<?php /**PATH /Users/johanbijlsma/Repos/Jira-dashboard/resources/views/layouts/app.blade.php ENDPATH**/ ?>