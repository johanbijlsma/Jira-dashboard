import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import InsightsPage from "../pages/insights";

const pushMock = vi.fn();

vi.mock("react-chartjs-2", () => ({
  Line: () => <div data-testid="line-chart" />,
}));
vi.mock("next/router", () => ({
  useRouter: () => ({ push: pushMock }),
}));

function okJson(data) {
  return { ok: true, json: async () => data };
}

describe("Insights page", () => {
  beforeEach(() => {
    pushMock.mockReset();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
    global.fetch = vi.fn((url, init) => {
      const u = String(url);
      if (u.includes("/sync/status")) {
        return Promise.resolve(okJson({ running: false, last_sync: "2026-03-02T10:00:00Z" }));
      }
      if (u.includes("/alerts/live")) {
        return Promise.resolve(
          okJson({
            priority1: [{ issue_key: "SD-123", status: "Nieuw" }],
            first_response_due_soon: [],
            first_response_overdue: [],
          })
        );
      }
      if (u.includes("/meta")) {
        return Promise.resolve(okJson({ organizations: ["Org A", "Org B"] }));
      }
      if (u.includes("/insights/highlights")) {
        return Promise.resolve(
          okJson({
            metric_config: {
              backlog_gap: { min_abs_delta: 3, min_rel_delta: 0.6, trend_delta_min: 2, min_sample_size: 12 },
            },
            cards: [
              {
                id: "h1",
                type: "anomaly",
                title: "Backlog groeit",
                impact_value: 5,
                impact_unit: "tickets/week",
                confidence: "high",
                summary: "Samenvatting",
                why: "Waarom",
                business_summary: "Achterstand loopt op.",
                recommended_action: "Plan een triageblok.",
                owner_hint: "Servicedesk lead",
                due_hint: "Vandaag",
                urgency: "now",
                decision_score: 92,
              },
            ],
          })
        );
      }
      if (u.includes("/insights/trends")) {
        return Promise.resolve(
          okJson({
            metric_config: {
              backlog_gap: { min_abs_delta: 3, min_rel_delta: 0.6, trend_delta_min: 2, min_sample_size: 12 },
              time_to_resolution: { min_abs_delta: 1, min_rel_delta: 0.25, trend_delta_min: 1, min_sample_size: 8 },
            },
            series: [
              {
                metric: "backlog_gap",
                label: "Backlog gap",
                min_sample_size: 12,
                points: [
                  { week: "2026-02-15", actual: 2, expected: 1, is_anomaly: false, confidence: "low", sample_size: 8 },
                  { week: "2026-02-22", actual: 6, expected: 1, is_anomaly: true, confidence: "high", sample_size: 14 },
                ],
              },
            ],
          })
        );
      }
      if (u.includes("/insights/drivers")) {
        return Promise.resolve(
          okJson({
            drivers: [
              {
                dimension: "priority",
                label: "Priority",
                items: [{ category: "P1", delta: 3, contribution_pct: 80 }],
              },
            ],
          })
        );
      }
      if (u.includes("/config/insights") && String(init?.method || "GET").toUpperCase() === "PUT") {
        return Promise.resolve(
          okJson({
            metric_config: {
              backlog_gap: { min_abs_delta: 4, min_rel_delta: 0.6, trend_delta_min: 2, trend_rel_delta_min: 0.25, min_sample_size: 12 },
              time_to_resolution: { min_abs_delta: 1, min_rel_delta: 0.25, trend_delta_min: 0.5, trend_rel_delta_min: 0.25, min_sample_size: 8 },
              time_to_first_response: { min_abs_delta: 0.5, min_rel_delta: 0.3, trend_delta_min: 0.25, trend_rel_delta_min: 0.25, min_sample_size: 10 },
            },
            updated_at: "2026-03-02T11:00:00Z",
          })
        );
      }
      if (u.includes("/config/insights/reset") && String(init?.method || "GET").toUpperCase() === "POST") {
        return Promise.resolve(
          okJson({
            metric_config: {
              backlog_gap: { min_abs_delta: 3, min_rel_delta: 0.6, trend_delta_min: 2, trend_rel_delta_min: 0.25, min_sample_size: 12 },
              time_to_resolution: { min_abs_delta: 1, min_rel_delta: 0.25, trend_delta_min: 0.5, trend_rel_delta_min: 0.25, min_sample_size: 8 },
              time_to_first_response: { min_abs_delta: 0.5, min_rel_delta: 0.3, trend_delta_min: 0.25, trend_rel_delta_min: 0.25, min_sample_size: 10 },
            },
            updated_at: "2026-03-02T12:00:00Z",
          })
        );
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders highlights, trends and drivers", async () => {
    render(<InsightsPage />);
    await waitFor(() => expect(screen.getByText("Top Highlights")).toBeInTheDocument());
    expect(screen.getByText("Actie-overzicht")).toBeInTheDocument();
    expect(screen.getByText("Tuning Pane")).toBeInTheDocument();
    expect(screen.getByText("backlog_gap")).toBeInTheDocument();
    expect(screen.getAllByText("Backlog groeit").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Beslisscore 92/).length).toBeGreaterThan(0);
    expect(screen.getByText("Trend Signalen")).toBeInTheDocument();
    expect(screen.getByText("Drivers")).toBeInTheDocument();
    expect(screen.getByText("Onvoldoende volume in 1 week/weken (min 12).")).toBeInTheDocument();
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
  });

  it("reveals why-details only after click", async () => {
    render(<InsightsPage />);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Waarom zie ik dit?" }).length).toBeGreaterThan(0));
    expect(screen.queryByText("Impact: 5 tickets/week")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Waarom zie ik dit?" })[0]);
    expect(screen.getByText("Impact: 5 tickets/week")).toBeInTheDocument();
  });

  it("applies organization filter to insight requests", async () => {
    render(<InsightsPage />);
    await waitFor(() => expect(screen.getByText("Top Highlights")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Organization"), { target: { value: "Org A" } });

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/insights/highlights?date_from=")
      )
    );
    const calls = global.fetch.mock.calls.map(([url]) => String(url));
    expect(calls.some((url) => url.includes("/insights/highlights?") && url.includes("organization=Org+A"))).toBe(true);
  });

  it("routes to dashboard when alert card is clicked", async () => {
    render(<InsightsPage />);
    const alertTitle = await waitFor(() => screen.getByText("Priority 1 binnengekomen"));
    fireEvent.click(alertTitle);
    expect(pushMock).toHaveBeenCalledWith("/?panel=alerts");
  });

  it("copies metric config json from tuning pane", async () => {
    render(<InsightsPage />);
    const button = await waitFor(() => screen.getByRole("button", { name: "Kopieer JSON" }));
    fireEvent.click(button);
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    expect(screen.getByText("Metric config gekopieerd.")).toBeInTheDocument();
  });

  it("saves updated thresholds from tuning pane", async () => {
    render(<InsightsPage />);
    const saveButton = await waitFor(() => screen.getByRole("button", { name: "Opslaan" }));
    fireEvent.click(saveButton);
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "http://127.0.0.1:8000/config/insights",
        expect.objectContaining({ method: "PUT" })
      )
    );
    expect(screen.getByText("Thresholds opgeslagen.")).toBeInTheDocument();
  });

  it("restores default thresholds from tuning pane", async () => {
    render(<InsightsPage />);
    const resetDefaultsButton = await waitFor(() => screen.getByRole("button", { name: "Herstel defaults" }));
    fireEvent.click(resetDefaultsButton);
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "http://127.0.0.1:8000/config/insights/reset",
        expect.objectContaining({ method: "POST" })
      )
    );
    expect(screen.getByText("Standaardinstellingen hersteld.")).toBeInTheDocument();
  });

  it("shows error state when insights endpoint fails", async () => {
    global.fetch = vi.fn((url) => {
      const u = String(url);
      if (u.includes("/meta")) return Promise.resolve(okJson({ organizations: [] }));
      return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
    });
    render(<InsightsPage />);
    await waitFor(() => expect(screen.getByText("Inzichten ophalen mislukt (500)")).toBeInTheDocument());
  });

  it("shows empty states when backend returns no data", async () => {
    global.fetch = vi.fn((url) => {
      const u = String(url);
      if (u.includes("/meta")) return Promise.resolve(okJson({ organizations: [] }));
      if (u.includes("/insights/highlights")) return Promise.resolve(okJson({ cards: [] }));
      if (u.includes("/insights/trends")) return Promise.resolve(okJson({ series: [] }));
      if (u.includes("/insights/drivers")) return Promise.resolve(okJson({ drivers: [] }));
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });

    render(<InsightsPage />);
    await waitFor(() => expect(screen.getByText("Geen highlights gevonden voor deze periode.")).toBeInTheDocument());
    expect(screen.getByText("Geen trends beschikbaar.")).toBeInTheDocument();
    expect(screen.getByText("Geen driver-data beschikbaar.")).toBeInTheDocument();
  });
});
