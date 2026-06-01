<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('issues', function (Blueprint $table) {
            $table->string('issue_key')->primary();
            $table->text('issue_summary')->nullable();
            $table->string('request_type')->nullable()->index();
            $table->string('onderwerp_logging')->nullable()->index();
            $table->json('organizations')->nullable();
            $table->timestamp('created_at')->nullable()->index();
            $table->timestamp('resolved_at')->nullable()->index();
            $table->timestamp('updated_at')->nullable()->index();
            $table->string('priority')->nullable()->index();
            $table->string('assignee')->nullable()->index();
            $table->text('assignee_avatar_url')->nullable();
            $table->string('current_status')->nullable()->index();
            $table->timestamp('first_response_due_at')->nullable()->index();
            $table->timestamp('time_to_resolution_due_at')->nullable()->index();
        });

        Schema::create('sync_state', function (Blueprint $table) {
            $table->unsignedTinyInteger('id')->primary();
            $table->timestamp('last_sync')->nullable();
        });

        Schema::create('sync_runs', function (Blueprint $table) {
            $table->id();
            $table->timestamp('started_at')->useCurrent()->index();
            $table->timestamp('finished_at')->nullable();
            $table->string('mode')->default('incremental')->index();
            $table->string('trigger_type')->default('manual');
            $table->boolean('success')->default(false)->index();
            $table->unsignedInteger('upserts')->default(0);
            $table->timestamp('set_last_sync')->nullable();
            $table->text('error')->nullable();
        });

        Schema::create('dashboard_config', function (Blueprint $table) {
            $table->unsignedTinyInteger('id')->primary();
            $table->json('servicedesk_team_members');
            $table->json('servicedesk_onderwerpen');
            $table->unsignedTinyInteger('ai_insight_threshold_pct')->default(75);
            $table->timestamp('alert_logs_cleared_at_servicedesk')->nullable();
            $table->timestamp('alert_logs_cleared_at_all')->nullable();
            $table->boolean('servicedesk_onderwerpen_customized')->default(false);
            $table->timestamp('updated_at')->useCurrent();
        });

        Schema::create('ai_insights_log', function (Blueprint $table) {
            $table->id();
            $table->string('insight_key')->unique();
            $table->string('scope_key')->index();
            $table->string('title');
            $table->text('summary');
            $table->string('action_label')->nullable();
            $table->string('kind');
            $table->string('target_card_key')->default('volume');
            $table->decimal('score_pct', 5, 1)->default(0);
            $table->decimal('deviation_pct', 8, 1)->nullable();
            $table->timestamp('detected_at')->useCurrent()->index();
            $table->timestamp('expires_at')->nullable()->index();
            $table->json('source_payload');
            $table->string('feedback_status')->default('pending');
            $table->string('feedback_reason')->nullable();
            $table->timestamp('feedback_at')->nullable();
            $table->timestamp('removed_at')->nullable();
        });

        Schema::create('vacations', function (Blueprint $table) {
            $table->id();
            $table->string('member_name')->index();
            $table->date('start_date')->index();
            $table->date('end_date')->index();
            $table->timestamps();
        });

        Schema::create('alert_logs', function (Blueprint $table) {
            $table->id();
            $table->string('issue_key')->index();
            $table->string('alert_kind')->index();
            $table->string('status')->nullable();
            $table->string('meta')->nullable();
            $table->string('status_key')->default('');
            $table->string('meta_key')->default('');
            $table->boolean('servicedesk_only')->default(true)->index();
            $table->timestamp('detected_at')->useCurrent()->index();
            $table->date('logged_on')->index();
            $table->unique(['issue_key', 'alert_kind', 'status_key', 'meta_key', 'servicedesk_only', 'logged_on'], 'alert_logs_daily_dedupe_idx');
        });

        Schema::create('release_workload_snapshots', function (Blueprint $table) {
            $table->date('release_date')->primary();
            $table->date('followup_date')->unique();
            $table->json('issue_keys');
            $table->unsignedInteger('ticket_count')->default(0);
            $table->timestamp('refreshed_at')->useCurrent();
        });

        Schema::create('release_calendar', function (Blueprint $table) {
            $table->unsignedBigInteger('sprint_id')->primary();
            $table->unsignedBigInteger('board_id');
            $table->string('sprint_name');
            $table->date('sprint_start_date');
            $table->date('release_date');
            $table->date('followup_date')->unique();
            $table->timestamp('refreshed_at')->useCurrent();
        });

        Schema::create('release_calendar_overrides', function (Blueprint $table) {
            $table->date('base_release_date')->primary();
            $table->date('override_release_date')->nullable();
            $table->boolean('is_cancelled')->default(false);
            $table->timestamp('updated_at')->useCurrent();
        });

        DB::table('sync_state')->insert(['id' => 1, 'last_sync' => null]);
        DB::table('dashboard_config')->insert([
            'id' => 1,
            'servicedesk_team_members' => json_encode([]),
            'servicedesk_onderwerpen' => json_encode([]),
            'ai_insight_threshold_pct' => 75,
            'servicedesk_onderwerpen_customized' => false,
            'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        Schema::dropIfExists('release_calendar_overrides');
        Schema::dropIfExists('release_calendar');
        Schema::dropIfExists('release_workload_snapshots');
        Schema::dropIfExists('alert_logs');
        Schema::dropIfExists('vacations');
        Schema::dropIfExists('ai_insights_log');
        Schema::dropIfExists('dashboard_config');
        Schema::dropIfExists('sync_runs');
        Schema::dropIfExists('sync_state');
        Schema::dropIfExists('issues');
    }
};
