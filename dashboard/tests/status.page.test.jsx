import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import StatusPage from "../pages/status";

describe("Status page", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("loads and shows running banner when sync is active", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        running: true,
        last_run: "2026-02-25T10:00:00Z",
        last_sync: "2026-02-25T09:55:00Z",
        last_result: { upserts: 12 },
        successful_runs: [],
      }),
    });

    render(<StatusPage />);

    await waitFor(() =>
      expect(screen.getByText("Er loopt al een synchronisatie. Status wordt live bijgewerkt.")).toBeInTheDocument()
    );
    expect(global.fetch).toHaveBeenCalledWith("http://127.0.0.1:8000/status");
  });

  it("starts incremental sync from button and shows feedback", async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          running: false,
          successful_runs: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ queued: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          running: true,
          successful_runs: [],
        }),
      });

    render(<StatusPage />);
    const startButtons = await waitFor(() => screen.getAllByRole("button", { name: "Start sync" }));
    const clickableStartButton = startButtons.find((btn) => !btn.hasAttribute("disabled")) || startButtons[0];
    fireEvent.click(clickableStartButton);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("http://127.0.0.1:8000/sync", { method: "POST" }));
    await waitFor(() => expect(screen.getByText("Sync is gestart.")).toBeInTheDocument());
  });

  it("polls faster while running", async () => {
    const intervalSpy = vi.spyOn(window, "setInterval");
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        running: true,
        successful_runs: [],
      }),
    });

    render(<StatusPage />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith("http://127.0.0.1:8000/status");
    await waitFor(() => expect(intervalSpy).toHaveBeenCalled());
    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 3000);
  });

  it("polls slower when not running and renders empty success table state", async () => {
    const intervalSpy = vi.spyOn(window, "setInterval");
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        running: false,
        successful_runs: [],
      }),
    });

    render(<StatusPage />);
    await waitFor(() => expect(screen.getByText("Geen syncs gevonden.")).toBeInTheDocument());
    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 15000);
  });

  it("shows API error when status fetch fails", async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    });

    render(<StatusPage />);
    await waitFor(() =>
      expect(screen.getByText("Status ophalen mislukt (503)")).toBeInTheDocument()
    );
  });

  it("starts full sync from button and shows full-sync feedback", async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          running: false,
          successful_runs: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ queued: true, mode: "full" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          running: true,
          successful_runs: [],
        }),
      });

    render(<StatusPage />);
    const button = await waitFor(() => screen.getByRole("button", { name: "Start full sync" }));
    fireEvent.click(button);

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith("http://127.0.0.1:8000/sync/full", { method: "POST" })
    );
    await waitFor(() => expect(screen.getByText("Full sync is gestart.")).toBeInTheDocument());
  });

  it("renders recent runs, badges, and updates selected run details on row click", async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          running: false,
          recent_runs: [
            {
              started_at: "2026-03-20T08:00:00Z",
              finished_at: "2026-03-20T08:05:00Z",
              mode: "incremental",
              trigger_type: "automatic",
              success: true,
              upserts: 14,
              set_last_sync: "2026-03-20T08:05:00Z",
              error: null,
            },
            {
              started_at: "2026-03-20T07:00:00Z",
              finished_at: "2026-03-20T07:02:00Z",
              mode: null,
              trigger_type: "manual",
              success: false,
              upserts: null,
              set_last_sync: null,
              error: "Queue timeout",
            },
          ],
          last_full_sync: {
            trigger_type: "automatic",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ keys: [] }),
      });

    render(<StatusPage />);

    await waitFor(() => expect(screen.getByText("⚙️ Automatisch")).toBeInTheDocument());
    expect(screen.getByText("👤 Handmatig")).toBeInTheDocument();
    expect(screen.getAllByText("✅ Succes").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("❌ Fout"));

    await waitFor(() => expect(screen.getByText("Foutmelding: Queue timeout")).toBeInTheDocument());
    expect(screen.getByText("Type: —")).toBeInTheDocument();
    expect(screen.getAllByText("Upserts: —").length).toBeGreaterThan(0);
  });

  it("falls back to successful runs when recent runs are missing", async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          running: false,
          successful_runs: [
            {
              started_at: "2026-03-20T06:00:00Z",
              finished_at: "2026-03-20T06:10:00Z",
              mode: "full",
              trigger_type: "automatic",
              upserts: 42,
              set_last_sync: "2026-03-20T06:10:00Z",
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ keys: [] }),
      });

    render(<StatusPage />);

    await waitFor(() => expect(screen.getByText("Type: full")).toBeInTheDocument());
    expect(screen.getByText("Foutmelding: Geen")).toBeInTheDocument();
    expect(screen.getAllByText("✅ Succes").length).toBeGreaterThan(0);
  });

  it("clears the first available dev alert and refreshes the state", async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          running: false,
          successful_runs: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ keys: ["SD-11079"] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ cleared: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          running: false,
          successful_runs: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ keys: [] }),
      });

    render(<StatusPage />);

    const clearButton = await waitFor(() => screen.getByRole("button", { name: "Verwijder test" }));
    fireEvent.click(clearButton);

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "http://127.0.0.1:8000/dev/alerts/clear?issue_key=SD-11079",
        { method: "POST" }
      )
    );
    await waitFor(() => expect(screen.getByText("Test alert is verwijderd.")).toBeInTheDocument());
  });
});
