<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class StatusEndpointsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutVite();
    }

    public function test_status_page_responds(): void
    {
        $this->get('/status')->assertOk();
    }

    public function test_api_status_endpoint_responds(): void
    {
        $this->getJson('/api/status')->assertOk();
    }
}
