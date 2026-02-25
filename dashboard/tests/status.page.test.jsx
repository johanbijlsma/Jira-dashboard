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
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
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
    await waitFor(() => expect(screen.getByText("Geen succesvolle syncs gevonden.")).toBeInTheDocument());
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
});
