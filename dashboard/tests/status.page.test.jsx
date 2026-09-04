import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import StatusPage from "../pages/status";

let mockPageVisible = true;
const { mockRouterPush, mockRouterReplace } = vi.hoisted(() => ({
  mockRouterPush: vi.fn(),
  mockRouterReplace: vi.fn(),
}));

vi.mock("../lib/use-page-visibility", () => ({
  usePageVisibility: () => mockPageVisible,
}));

vi.mock("next/router", () => ({
  useRouter: () => ({ push: mockRouterPush, replace: mockRouterReplace }),
}));

describe("Status page", () => {
  beforeEach(() => {
    mockPageVisible = true;
    mockRouterPush.mockReset();
    mockRouterReplace.mockReset();
    window.sessionStorage.clear();
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
      expect(
        screen.getByText("Er loopt al een synchronisatie. Status wordt live bijgewerkt.")
      ).toBeInTheDocument()
    );
    expect(global.fetch).toHaveBeenCalledWith("/api/status", { cache: "no-store" });
  });

  it("returns to the dashboard after the idle timeout", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ running: false, successful_runs: [] }),
    });
    const timeoutSpy = vi.spyOn(window, "setTimeout");

    render(<StatusPage />);
    fireEvent.pointerDown(window);
    const idleTimeout = timeoutSpy.mock.calls.find(([, delay]) => delay === 120000);
    expect(idleTimeout).toBeDefined();
    idleTimeout[0]();

    expect(mockRouterReplace).toHaveBeenCalledWith("/");
  });

  it("starts incremental sync from button and shows feedback", async () => {
    global.fetch.mockImplementation((url) => {
      if (url === "/api/sync")
        return Promise.resolve({ ok: true, json: async () => ({ queued: true }) });
      if (url === "/api/dev/tests/state")
        return Promise.resolve({ ok: true, json: async () => ({ active: false, scenarios: [] }) });
      if (url === "/api/config/jira-token-warning")
        return Promise.resolve({ ok: true, json: async () => ({}) });
      return Promise.resolve({
        ok: true,
        json: async () => ({ running: false, successful_runs: [] }),
      });
    });

    render(<StatusPage />);
    const startButtons = await waitFor(() => screen.getAllByRole("button", { name: "Start sync" }));
    const clickableStartButton =
      startButtons.find((btn) => !btn.hasAttribute("disabled")) || startButtons[0];
    fireEvent.click(clickableStartButton);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/sync", { method: "POST" }));
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
    expect(global.fetch).toHaveBeenCalledWith("/api/status", { cache: "no-store" });
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

  it("polls at the background interval when the page is hidden", async () => {
    mockPageVisible = false;
    const intervalSpy = vi.spyOn(window, "setInterval");
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        running: true,
        successful_runs: [],
      }),
    });

    render(<StatusPage />);
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith("/api/status", { cache: "no-store" })
    );
    await waitFor(() => expect(intervalSpy).toHaveBeenCalled());
    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 60000);
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
    global.fetch.mockImplementation((url) => {
      if (url === "/api/sync/full")
        return Promise.resolve({ ok: true, json: async () => ({ queued: true, mode: "full" }) });
      if (url === "/api/dev/tests/state")
        return Promise.resolve({ ok: true, json: async () => ({ active: false, scenarios: [] }) });
      if (url === "/api/config/jira-token-warning")
        return Promise.resolve({ ok: true, json: async () => ({}) });
      return Promise.resolve({
        ok: true,
        json: async () => ({ running: false, successful_runs: [] }),
      });
    });

    render(<StatusPage />);
    const button = await waitFor(() => screen.getByRole("button", { name: "Start full sync" }));
    fireEvent.click(button);

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith("/api/sync/full", { method: "POST" })
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
        json: async () => ({ active: false, scenarios: [] }),
      });

    render(<StatusPage />);

    await waitFor(() => expect(screen.getByText("Automatisch")).toBeInTheDocument());
    expect(screen.getByText("Handmatig")).toBeInTheDocument();
    expect(screen.getAllByText("Succes").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("Fout"));

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
        json: async () => ({ active: false, scenarios: [] }),
      });

    render(<StatusPage />);

    await waitFor(() => expect(screen.getByText("Type: full")).toBeInTheDocument());
    expect(screen.getByText("Foutmelding: Geen")).toBeInTheDocument();
    expect(screen.getAllByText("Succes").length).toBeGreaterThan(0);
  });

  it("clears all active persistent tests from one button", async () => {
    global.fetch.mockImplementation((url) => {
      if (url === "/api/dev/tests/state")
        return Promise.resolve({ ok: true, json: async () => ({ active: true, scenarios: ["alert"] }) });
      if (url === "/api/dev/tests/clear")
        return Promise.resolve({ ok: true, json: async () => ({ cleared: true }) });
      if (url === "/api/config/jira-token-warning")
        return Promise.resolve({ ok: true, json: async () => ({ is_test: false }) });
      return Promise.resolve({
        ok: true,
        json: async () => ({ running: false, successful_runs: [] }),
      });
    });

    render(<StatusPage />);

    const clearButton = await waitFor(() => screen.getByRole("button", { name: "Alle tests uitzetten" }));
    fireEvent.click(clearButton);

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith("/api/dev/tests/clear", {
        method: "POST",
      })
    );
    await waitFor(() => expect(screen.getByText("Alle actieve tests zijn uitgezet.")).toBeInTheDocument());
  });

  it("always shows the all-tests button but disables it without an active scenario", async () => {
    global.fetch.mockImplementation((url) => {
      if (url === "/api/dev/tests/state")
        return Promise.resolve({ ok: true, json: async () => ({ active: false, scenarios: [] }) });
      if (url === "/api/config/jira-token-warning")
        return Promise.resolve({ ok: true, json: async () => ({ is_test: false }) });
      return Promise.resolve({ ok: true, json: async () => ({ running: false, successful_runs: [] }) });
    });

    render(<StatusPage />);

    expect(await screen.findByRole("button", { name: "Alle tests uitzetten" })).toBeDisabled();
  });

  it("activates the all-tests button only when the central test scenario is active", async () => {
    global.fetch.mockImplementation((url) => {
      if (url === "/api/dev/tests/state") {
        return Promise.resolve({ ok: true, json: async () => ({ active: true, scenarios: ["alert"] }) });
      }
      if (url === "/api/config/jira-token-warning") {
        return Promise.resolve({ ok: true, json: async () => ({ is_test: false }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ running: false, successful_runs: [] }) });
    });

    render(<StatusPage />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Alle tests uitzetten" })).toBeEnabled()
    );
  });

  it("schedules a test alert and returns to the dashboard", async () => {
    global.fetch.mockImplementation((url) => {
      if (url === "/api/dev/alerts/trigger?delay_seconds=3") {
        return Promise.resolve({ ok: true, json: async () => ({ scheduled: true, delay_seconds: 3 }) });
      }
      if (url === "/api/dev/tests/state") {
        return Promise.resolve({ ok: true, json: async () => ({ active: false, scenarios: [] }) });
      }
      if (url === "/api/config/jira-token-warning") {
        return Promise.resolve({ ok: true, json: async () => ({ is_test: false }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ running: false, successful_runs: [] }) });
    });

    render(<StatusPage />);

    const triggerButton = await waitFor(() =>
      screen.getByRole("button", { name: "Test binnenkomende alert" })
    );
    fireEvent.click(triggerButton);

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith("/api/dev/alerts/trigger?delay_seconds=3", {
        method: "POST",
      })
    );
    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith("/"));
    expect(window.sessionStorage.getItem("dashboard-dev-alert-pending")).toBe("1");
  });

  it("starts a token test and returns to the dashboard", async () => {
    global.fetch.mockImplementation((url) => {
      if (url === "/api/dev/jira-token-warning/trigger?scenario=renewal") {
        return Promise.resolve({ ok: true, json: async () => ({ is_test: true }) });
      }
      if (url === "/api/dev/tests/state") {
        return Promise.resolve({ ok: true, json: async () => ({ active: false, scenarios: [] }) });
      }
      if (url === "/api/config/jira-token-warning") {
        return Promise.resolve({ ok: true, json: async () => ({ is_test: false }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ running: false, successful_runs: [] }) });
    });

    render(<StatusPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Test tokenwaarschuwing" }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/dev/jira-token-warning/trigger?scenario=renewal",
        { method: "POST" }
      )
    );
    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith("/"));
    expect(window.sessionStorage.getItem("dashboard-token-test-pending")).toBe("1");
  });

  it("sends the latest Weekly Insights PDF to the test mailbox", async () => {
    global.fetch.mockImplementation((url) => {
      if (url === "/api/dev/weekly-insights/send-test-email") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            sent: true,
            filename: "weekly-insights-2026-03-09-2026-03-15.pdf",
            recipient: "johan+test@planningsagenda.nl",
          }),
        });
      }
      if (url === "/api/dev/tests/state") {
        return Promise.resolve({ ok: true, json: async () => ({ active: false, scenarios: [] }) });
      }
      if (url === "/api/config/jira-token-warning") {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ running: false, successful_runs: [] }),
      });
    });

    render(<StatusPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Stuur testmail" }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith("/api/dev/weekly-insights/send-test-email", {
        method: "POST",
      })
    );
    await waitFor(() =>
      expect(
        screen.getByText("Testmail is verstuurd naar johan+test@planningsagenda.nl.")
      ).toBeInTheDocument()
    );
  });

  it("shows the API error when sending the Weekly Insights test email fails", async () => {
    global.fetch.mockImplementation((url) => {
      if (url === "/api/dev/weekly-insights/send-test-email") {
        return Promise.resolve({
          ok: false,
          status: 503,
          json: async () => ({ detail: "email_not_configured" }),
        });
      }
      if (url === "/api/dev/tests/state")
        return Promise.resolve({ ok: true, json: async () => ({ active: false, scenarios: [] }) });
      if (url === "/api/config/jira-token-warning")
        return Promise.resolve({ ok: true, json: async () => ({}) });
      return Promise.resolve({
        ok: true,
        json: async () => ({ running: false, successful_runs: [] }),
      });
    });

    render(<StatusPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Stuur testmail" }));

    await waitFor(() => expect(screen.getByText("email_not_configured")).toBeInTheDocument());
  });

  it("clears an active token scenario through the central all-tests button", async () => {
    global.fetch.mockImplementation((url) => {
      if (url === "/api/dev/tests/clear") {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      if (url === "/api/dev/tests/state") {
        return Promise.resolve({ ok: true, json: async () => ({ active: true, scenarios: ["renewal"] }) });
      }
      if (url === "/api/config/jira-token-warning") {
        return Promise.resolve({ ok: true, json: async () => ({ test_scenario: "renewal" }) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ running: false, successful_runs: [] }),
      });
    });

    render(<StatusPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Alle tests uitzetten" }));
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith("/api/dev/tests/clear", {
        method: "POST",
      })
    );
    expect(screen.queryByRole("button", { name: "Herstel token teststatus" })).not.toBeInTheDocument();
  });
});
