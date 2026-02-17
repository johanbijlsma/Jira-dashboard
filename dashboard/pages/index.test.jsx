import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Home from "./index";

vi.mock("react-chartjs-2", () => ({
  Bar: () => <div data-testid="chart-bar" />,
  Doughnut: () => <div data-testid="chart-doughnut" />,
  Line: () => <div data-testid="chart-line" />,
}));

vi.mock("chart.js", () => ({
  ArcElement: {},
  BarElement: {},
  CategoryScale: {},
  Chart: { register: vi.fn() },
  Legend: {},
  LineElement: {},
  LinearScale: {},
  PointElement: {},
  Tooltip: {},
}));

function mockJson(data) {
  return Promise.resolve({
    json: async () => data,
  });
}

beforeEach(() => {
  global.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.includes("/meta")) {
      return mockJson({ request_types: [], onderwerpen: [], priorities: [], assignees: [] });
    }
    if (u.includes("/sync/status")) {
      return mockJson({
        running: false,
        last_run: null,
        last_error: null,
        last_result: null,
        last_sync: null,
      });
    }
    if (u.includes("/metrics/volume_weekly")) return mockJson([]);
    if (u.includes("/metrics/volume_weekly_by_onderwerp")) return mockJson([]);
    if (u.includes("/metrics/volume_by_priority")) return mockJson([]);
    if (u.includes("/metrics/volume_by_assignee")) return mockJson([]);
    if (u.includes("/metrics/leadtime_p90_by_type")) return mockJson([]);
    return mockJson([]);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Home hotkeys popup", () => {
  it("opens and closes via ? button", async () => {
    render(<Home />);

    const toggle = screen.getByRole("button", { name: "Toon hotkeys" });
    fireEvent.click(toggle);
    expect(await screen.findByRole("dialog", { name: "Hotkeys overzicht" })).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.queryByRole("dialog", { name: "Hotkeys overzicht" })).not.toBeInTheDocument();
  });
});
