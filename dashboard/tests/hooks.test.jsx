import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useAlertLogs } from "../lib/use-alert-logs";
import { useDashboardData } from "../lib/use-dashboard-data";
import { useLiveAlerts } from "../lib/use-live-alerts";
import { useServicedeskConfig } from "../lib/use-servicedesk-config";
import { useSyncStatus } from "../lib/use-sync-status";
import { useVacationsData } from "../lib/use-vacations-data";

function jsonResponse(data) {
  return Promise.resolve({
    ok: true,
    json: async () => data,
  });
}

function createFetchMock(routes) {
  return vi.fn((url) => {
    const entry = Object.entries(routes).find(([matcher]) => String(url).includes(matcher));
    if (!entry) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    const [, value] = entry;
    const nextValue = Array.isArray(value) ? value.shift() : value;
    return jsonResponse(typeof nextValue === "function" ? nextValue(url) : nextValue);
  });
}

describe("dashboard hooks", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("loads dashboard data, normalizes arrays, and refreshes meta", async () => {
    global.fetch = createFetchMock({
      "/metrics/volume_weekly?": [{ week: "2026-01-05", request_type: "Incident", tickets: 5 }],
      "/metrics/volume_weekly_by_onderwerp?": [{ onderwerp: "Email", tickets: 3 }],
      "/metrics/volume_by_priority?": { unexpected: true },
      "/metrics/volume_by_assignee?": [{ assignee: "A", tickets: 2 }],
      "/metrics/volume_weekly_by_organization?": [{ organization: "Org", tickets: 1 }],
      "/metrics/inflow_vs_closed_weekly?": [{ week: "2026-01-05", inflow: 5, closed: 4 }],
      "/metrics/time_to_resolution_weekly_by_type?": [{ request_type: "Incident", week: "2026-01-05", avg_hours: 7 }],
      "/metrics/time_to_first_response_weekly?": [{ week: "2026-01-05", avg_hours: 1 }],
      "/metrics/ttfr_overdue_weekly?": [{ week: "2026-01-05", overdue: 2 }],
      "/metrics/leadtime_p90_by_type?": [{ request_type: "Incident", p90_hours: 12 }],
      "/meta": [
        { request_types: ["Incident"], onderwerpen: ["Email"], priorities: ["High"], assignees: ["A"], organizations: ["Org"] },
        { request_types: ["Incident", "Service"], onderwerpen: ["Email"], priorities: ["High"], assignees: ["A"], organizations: ["Org"] },
      ],
    });

    const { result } = renderHook(() =>
      useDashboardData({
        dateFrom: "2026-01-01",
        dateTo: "2026-01-31",
        requestType: "Incident",
        onderwerp: "Email",
        priority: "High",
        assignee: "A",
        organization: "Org",
        servicedeskOnly: true,
        p90Period: { hasData: true, dateFrom: "2026-01-01", dateTo: "2026-01-31" },
      })
    );

    await waitFor(() => expect(result.current.meta.request_types).toEqual(["Incident"]));
    expect(result.current.priorityVolume).toEqual([]);
    expect(result.current.p90).toEqual({ request_type: "Incident", p90_hours: 12 });

    const metricCall = global.fetch.mock.calls.find(([url]) => String(url).includes("/metrics/volume_weekly?"))[0];
    expect(metricCall).toContain("request_type=Incident");
    expect(metricCall).toContain("servicedesk_only=true");

    const ttrCall = global.fetch.mock.calls.find(([url]) =>
      String(url).includes("/metrics/time_to_resolution_weekly_by_type?")
    )[0];
    expect(ttrCall).not.toContain("request_type=");

    await act(async () => {
      await result.current.refreshDashboard();
    });

    await waitFor(() => expect(result.current.meta.request_types).toEqual(["Incident", "Service"]));
  });

  it("skips p90 fetch when no full-week period is available", async () => {
    global.fetch = createFetchMock({
      "/metrics/volume_weekly?": [],
      "/metrics/volume_weekly_by_onderwerp?": [],
      "/metrics/volume_by_priority?": [],
      "/metrics/volume_by_assignee?": [],
      "/metrics/volume_weekly_by_organization?": [],
      "/metrics/inflow_vs_closed_weekly?": [],
      "/metrics/time_to_resolution_weekly_by_type?": [],
      "/metrics/time_to_first_response_weekly?": [],
      "/metrics/ttfr_overdue_weekly?": [],
      "/meta": [{ request_types: [], onderwerpen: [], priorities: [], assignees: [], organizations: [] }],
    });

    const { result } = renderHook(() =>
      useDashboardData({
        dateFrom: "2026-01-01",
        dateTo: "2026-01-31",
        requestType: "",
        onderwerp: "",
        priority: "",
        assignee: "",
        organization: "",
        servicedeskOnly: false,
        p90Period: { hasData: false, dateFrom: null, dateTo: null },
      })
    );

    await waitFor(() => expect(result.current.p90).toEqual([]));
    expect(global.fetch.mock.calls.some(([url]) => String(url).includes("leadtime_p90_by_type"))).toBe(false);
  });

  it("loads sync status, registers polling, and refreshes it manually", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    global.fetch = vi
      .fn()
      .mockImplementationOnce(() => jsonResponse({ running: false, auto_sync: { enabled: false } }))
      .mockImplementationOnce(() => jsonResponse({ running: true, auto_sync: { enabled: true } }));

    const { result } = renderHook(() => useSyncStatus());

    await waitFor(() => expect(result.current.syncStatus?.running).toBe(false));
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 15000);

    await act(async () => {
      const status = await result.current.refreshSyncStatus();
      expect(status.running).toBe(true);
    });

    expect(result.current.syncStatus?.auto_sync?.enabled).toBe(true);
  });

  it("loads live alerts, normalizes warnings, registers polling, and refreshes manually", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const onRefresh = vi.fn();
    global.fetch = createFetchMock({
      "/alerts/live?": [
        {
          priority1: [{ issue_key: "SD-1" }],
          first_response_due_soon: [{ issue_key: "SD-2" }],
          time_to_resolution_warning: [{ issue_key: "SD-20" }],
        },
        {
          priority1: [],
          first_response_due_warning: [{ issue_key: "SD-3" }],
          first_response_overdue: [{ issue_key: "SD-4" }],
          time_to_resolution_critical: [{ issue_key: "SD-21" }],
          time_to_resolution_overdue: [{ issue_key: "SD-22" }],
        },
      ],
    });

    const { result } = renderHook(() => useLiveAlerts({ onRefresh }));

    await waitFor(() => expect(result.current.liveAlerts.priority1).toHaveLength(1));
    expect(result.current.liveAlerts.first_response_due_warning[0].issue_key).toBe("SD-2");
    expect(result.current.liveAlerts.time_to_resolution_warning[0].issue_key).toBe("SD-20");
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 20000);
    expect(onRefresh).toHaveBeenCalledWith(expect.objectContaining({ priority1: [{ issue_key: "SD-1" }] }));

    await act(async () => {
      const refreshed = await result.current.refreshLiveAlerts();
      expect(refreshed.first_response_overdue[0].issue_key).toBe("SD-4");
      expect(refreshed.time_to_resolution_overdue[0].issue_key).toBe("SD-22");
    });

    expect(result.current.liveAlerts.first_response_overdue[0].issue_key).toBe("SD-4");
    expect(result.current.liveAlerts.time_to_resolution_critical[0].issue_key).toBe("SD-21");
  });

  it("loads alert logs, tracks unseen entries, registers polling, and resets the badge", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    global.fetch = createFetchMock({
      "/alerts/logs?": [
        [{ id: 1, issue_key: "SD-1", kind: "P1", detected_at: "2026-01-01T10:00:00Z", status: "OPEN", meta: "" }],
        [{ id: 2, issue_key: "SD-2", kind: "P1", detected_at: "2026-01-01T11:00:00Z", status: "OPEN", meta: "" }],
      ],
    });

    const { result, rerender } = renderHook((props) => useAlertLogs(props), {
      initialProps: { limit: 5, sidePanelMode: "", resetKey: "a" },
    });

    await waitFor(() => expect(result.current.alertLogEntries).toHaveLength(1));
    expect(result.current.hasNewAlertLogEntry).toBe(false);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30000);

    await act(async () => {
      await result.current.refreshAlertLogs();
    });

    expect(result.current.hasNewAlertLogEntry).toBe(true);

    act(() => {
      result.current.clearHasNewAlertLogEntry();
    });
    expect(result.current.hasNewAlertLogEntry).toBe(false);

    rerender({ limit: 5, sidePanelMode: "alerts", resetKey: "b" });
    await waitFor(() => expect(result.current.hasNewAlertLogEntry).toBe(false));
  });

  it("loads vacation aggregates, registers polling, and supports manual refresh", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    global.fetch = createFetchMock({
      "/vacations/upcoming?limit=3": [
        [{ id: 2, member_name: "Bob" }],
        [{ id: 3, member_name: "Carol" }],
      ],
      "/vacations/today": [
        [{ id: 4, member_name: "Dana" }],
        [{ id: 5, member_name: "Erin" }],
      ],
      "/vacations": [
        [{ id: 1 }, { id: 2 }],
        [{ id: 1 }, { id: 2 }, { id: 3 }],
      ],
    });

    const { result } = renderHook(() => useVacationsData());

    await waitFor(() => expect(result.current.upcomingVacationTotal).toBe(2));
    expect(result.current.upcomingVacations[0].member_name).toBe("Bob");
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60000);

    await act(async () => {
      await result.current.refreshVacations();
    });

    expect(result.current.upcomingVacationTotal).toBe(3);
    expect(result.current.todayVacations).toEqual([{ id: 5, member_name: "Erin" }]);
  });

  it("loads servicedesk config and applies normalized drafts", async () => {
    global.fetch = createFetchMock({
      "/config/servicedesk": [
        {
          team_members: ["Alice"],
          onderwerpen: ["email"],
          onderwerpen_baseline: ["Email"],
          onderwerpen_customized: true,
          updated_at: "2026-01-01T10:00:00Z",
          team_member_avatars: { Alice: "avatar.png" },
        },
        {
          team_members: ["Bob"],
          onderwerpen: ["chat"],
          onderwerpen_baseline: ["Chat"],
          onderwerpen_customized: false,
          updated_at: null,
          team_member_avatars: {},
        },
      ],
    });

    const { result } = renderHook(() => useServicedeskConfig());

    await waitFor(() => expect(result.current.servicedeskConfig.team_members).toEqual(["Alice"]));
    expect(result.current.teamMembersDraft).toEqual(["Alice"]);
    expect(result.current.onderwerpenDraft).toEqual(["email"]);

    act(() => {
      result.current.applyServicedeskConfig(
        {
          team_members: ["Bob"],
          onderwerpen: ["chat"],
          onderwerpen_baseline: ["Chat"],
          onderwerpen_customized: false,
          updated_at: null,
          team_member_avatars: {},
        },
        (values) => values.map((value) => String(value).toUpperCase())
      );
    });

    expect(result.current.teamMembersDraft).toEqual(["Bob"]);
    expect(result.current.onderwerpenDraft).toEqual(["CHAT"]);

    await act(async () => {
      await result.current.refreshServicedeskConfig((values) => values.map((value) => `${value}!`));
    });

    expect(result.current.onderwerpenDraft).toEqual(["chat!"]);

    act(() => {
      result.current.applyServicedeskConfig({}, undefined);
    });

    expect(result.current.servicedeskConfig.team_members).toEqual([]);
    expect(result.current.servicedeskConfig.team_member_avatars).toEqual({});
    expect(result.current.teamMembersDraft).toEqual([]);
    expect(result.current.onderwerpenDraft).toEqual([]);
  });
});
