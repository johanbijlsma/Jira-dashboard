import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useAlertLogs } from "../lib/use-alert-logs";
import { useAiInsights } from "../lib/use-ai-insights";
import { useDashboardData } from "../lib/use-dashboard-data";
import { useLiveAlerts } from "../lib/use-live-alerts";
import { usePageVisibility } from "../lib/use-page-visibility";
import { useServicedeskConfig } from "../lib/use-servicedesk-config";
import { useSyncStatus } from "../lib/use-sync-status";
import { useVacationsData } from "../lib/use-vacations-data";
import { useWeeklyInsights } from "../lib/use-weekly-insights";

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

  it("uses slower polling for hidden pages and refreshes when page becomes visible again", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });

    global.fetch = createFetchMock({
      "/sync/status": [
        { running: false, auto_sync: { enabled: false } },
        { running: false, auto_sync: { enabled: true } },
      ],
      "/alerts/logs?": [
        [{ id: 1, issue_key: "SD-1", kind: "P1", detected_at: "2026-01-01T10:00:00Z", status: "OPEN", meta: "" }],
        [{ id: 2, issue_key: "SD-2", kind: "P1", detected_at: "2026-01-01T11:00:00Z", status: "OPEN", meta: "" }],
      ],
      "/vacations/upcoming?limit=3": [[{ id: 2, member_name: "Bob" }], [{ id: 3, member_name: "Carol" }]],
      "/vacations/today": [[{ id: 4, member_name: "Dana" }], [{ id: 5, member_name: "Erin" }]],
      "/vacations": [[{ id: 1 }, { id: 2 }], [{ id: 1 }, { id: 2 }, { id: 3 }]],
    });

    const syncHook = renderHook(() => useSyncStatus());
    const logHook = renderHook(() => useAlertLogs({ limit: 5, sidePanelMode: "", resetKey: "x" }));
    const vacationHook = renderHook(() => useVacationsData());

    await waitFor(() => expect(syncHook.result.current.syncStatus?.running).toBe(false));
    await waitFor(() => expect(logHook.result.current.alertLogEntries).toHaveLength(1));
    await waitFor(() => expect(vacationHook.result.current.upcomingVacationTotal).toBe(2));

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60000);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 120000);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 300000);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(syncHook.result.current.syncStatus?.auto_sync?.enabled).toBe(true));
    await waitFor(() => expect(logHook.result.current.alertLogEntries[0].issue_key).toBe("SD-2"));
    await waitFor(() => expect(vacationHook.result.current.upcomingVacationTotal).toBe(3));
  });

  it("loads weekly insights and refreshes them when the page becomes visible again", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });

    global.fetch = createFetchMock({
      "/alerts/weekly-insights?": [
        {
          generated_at: "2026-03-17T08:00:00Z",
          week: { label: "2026-03-09 t/m 2026-03-15" },
          scope: "alleen servicedesk",
          summary: { incoming_tickets: 9 },
          service_levels: {},
          alerts: {},
          breakdowns: {},
        },
        {
          generated_at: "2026-03-17T09:00:00Z",
          week: { label: "2026-03-09 t/m 2026-03-15" },
          scope: "alleen servicedesk",
          summary: { incoming_tickets: 11 },
          service_levels: {},
          alerts: {},
          breakdowns: {},
        },
      ],
    });

    const { result } = renderHook(() => useWeeklyInsights({ servicedeskOnly: true }));

    await waitFor(() => expect(result.current.weeklyInsights?.summary?.incoming_tickets).toBe(9));
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 3600000);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(result.current.weeklyInsights?.summary?.incoming_tickets).toBe(11));
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 900000);
  });

  it("loads dashboard data, normalizes arrays, and refreshes meta", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
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
      "/metrics/release_followup_workload?": [[{ release_date: "2026-01-13", followup_date: "2026-01-14", tickets: 4, issue_keys: ["SD-1"] }]],
      "/metrics/current_week_flow?": { current_received: 8, previous_received: 5, current_closed: 3, previous_closed: 2 },
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
    const releaseCall = global.fetch.mock.calls.find(([url]) => String(url).includes("/metrics/release_followup_workload?"))[0];
    expect(releaseCall).toContain("anchor_iso=");
    expect(releaseCall).toContain("date_from=2026-01-01");
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30000);
    await waitFor(() =>
      expect(result.current.releaseFollowupWorkload).toEqual([
        { release_date: "2026-01-13", followup_date: "2026-01-14", tickets: 4, issue_keys: ["SD-1"] },
      ])
    );
    expect(result.current.currentWeekFlow).toEqual({ current_received: 8, previous_received: 5, current_closed: 3, previous_closed: 2 });

    const ttrCall = global.fetch.mock.calls.find(([url]) =>
      String(url).includes("/metrics/time_to_resolution_weekly_by_type?")
    )[0];
    expect(ttrCall).not.toContain("request_type=");

    await act(async () => {
      await result.current.refreshDashboard();
    });

    await waitFor(() => expect(result.current.meta.request_types).toEqual(["Incident", "Service"]));
  });

  it("polls current week flow faster when visible and slower when hidden", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });

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
      "/metrics/release_followup_workload?": [],
      "/metrics/current_week_flow?": [
        { current_received: 2, previous_received: 1, current_closed: 1, previous_closed: 0 },
        { current_received: 3, previous_received: 2, current_closed: 1, previous_closed: 1 },
      ],
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

    await waitFor(() => expect(result.current.currentWeekFlow).toEqual({
      current_received: 2,
      previous_received: 1,
      current_closed: 1,
      previous_closed: 0,
    }));
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 120000);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => {
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30000);
    });
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
      "/metrics/release_followup_workload?": [],
      "/metrics/current_week_flow?": { current_received: 0, previous_received: 0, current_closed: 0, previous_closed: 0 },
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

  it("falls back to empty dashboard data when metric requests fail", async () => {
    global.fetch = vi.fn((url) => {
      if (String(url).includes("/meta")) {
        return jsonResponse({ request_types: ["Incident"], onderwerpen: ["Email"], priorities: [], assignees: [], organizations: [] });
      }
      return Promise.reject(new TypeError("Failed to fetch"));
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
        servicedeskOnly: true,
        p90Period: { hasData: true, dateFrom: "2026-01-01", dateTo: "2026-01-31" },
      })
    );

    await waitFor(() => expect(result.current.meta.request_types).toEqual(["Incident"]));
    await waitFor(() => expect(result.current.volume).toEqual([]));
    expect(result.current.onderwerpVolume).toEqual([]);
    expect(result.current.priorityVolume).toEqual([]);
    expect(result.current.assigneeVolume).toEqual([]);
    expect(result.current.organizationVolume).toEqual([]);
    expect(result.current.inflowVsClosedWeekly).toEqual([]);
    expect(result.current.incidentResolutionWeekly).toEqual([]);
    expect(result.current.firstResponseWeekly).toEqual([]);
    expect(result.current.ttfrOverdueWeekly).toEqual([]);
    expect(result.current.releaseFollowupWorkload).toEqual([]);
    expect(result.current.currentWeekFlow).toBeNull();
    expect(result.current.p90).toEqual([]);
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

  it("normalizes empty live alert payloads to empty arrays", async () => {
    global.fetch = createFetchMock({
      "/alerts/live?": [{ priority1: null, first_response_due_warning: null, time_to_resolution_overdue: null }],
    });

    const { result } = renderHook(() => useLiveAlerts());

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(result.current.liveAlerts.priority1).toEqual([]);
    expect(result.current.liveAlerts.first_response_due_warning).toEqual([]);
    expect(result.current.liveAlerts.time_to_resolution_overdue).toEqual([]);
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

  it("does not raise a new alert badge while the alerts panel is already open", async () => {
    global.fetch = createFetchMock({
      "/alerts/logs?": [
        [{ id: 1, issue_key: "SD-1", kind: "P1", detected_at: "2026-01-01T10:00:00Z", status: "OPEN", meta: "" }],
        [{ id: 2, issue_key: "SD-2", kind: "P1", detected_at: "2026-01-01T11:00:00Z", status: "OPEN", meta: "" }],
      ],
    });

    const { result } = renderHook(() => useAlertLogs({ limit: 5, sidePanelMode: "alerts", resetKey: "x" }));

    await waitFor(() => expect(result.current.alertLogEntries).toHaveLength(1));

    await act(async () => {
      await result.current.refreshAlertLogs();
    });

    expect(result.current.alertLogEntries[0].issue_key).toBe("SD-2");
    expect(result.current.hasNewAlertLogEntry).toBe(false);
  });

  it("tracks page visibility changes", async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });

    const { result } = renderHook(() => usePageVisibility());

    expect(result.current).toBe(false);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(result.current).toBe(true));
  });

  it("loads AI insights, logs, and applies feedback updates", async () => {
    global.fetch = createFetchMock({
      "/insights/live?": [
        {
          threshold_pct: 75,
          ttl_hours: 8,
          items: [
            {
              id: 11,
              title: "AI-signaal",
              target_card_key: "inflowVsClosed",
              score_pct: 88,
              source_payload: { current: { tickets: 12 } },
              feedback_status: "pending",
            },
          ],
        },
      ],
      "/insights/logs?": [
        [
          {
            id: 11,
            title: "AI-signaal",
            target_card_key: "inflowVsClosed",
            score_pct: 88,
            source_payload: { current: { tickets: 12 } },
            feedback_status: "pending",
          },
        ],
      ],
      "/insights/11/feedback": [
        {
          id: 11,
          title: "AI-signaal",
          target_card_key: "inflowVsClosed",
          score_pct: 88,
          source_payload: { current: { tickets: 12 } },
          feedback_status: "downvoted",
          feedback_reason: "niet relevant genoeg",
          removed_at: "2026-01-01T10:00:00Z",
        },
      ],
    });

    const { result } = renderHook(() =>
      useAiInsights({
        dateFrom: "2026-01-01",
        dateTo: "2026-01-31",
        requestType: "",
        onderwerp: "",
        priority: "",
        assignee: "",
        organization: "",
        servicedeskOnly: true,
      })
    );

    await waitFor(() => expect(result.current.liveInsights).toHaveLength(1));
    await waitFor(() => expect(result.current.insightLogEntries).toHaveLength(1));
    expect(result.current.thresholdPct).toBe(75);

    await act(async () => {
      await result.current.submitInsightFeedback({
        insightId: 11,
        vote: "down",
        reason: "niet relevant genoeg",
      });
    });

    expect(result.current.liveInsights).toHaveLength(0);
    expect(result.current.insightLogEntries[0].feedback_status).toBe("downvoted");
  });

  it("uses a fixed AI insight window and ignores active dashboard filters", async () => {
    global.fetch = createFetchMock({
      "/insights/live?": [
        {
          threshold_pct: "invalid",
          ttl_hours: undefined,
          items: [],
        },
      ],
      "/insights/logs?": [{}],
    });

    const { result } = renderHook(() =>
      useAiInsights({
        dateFrom: "2026-01-01",
        dateTo: "2026-01-31",
        requestType: "Incident",
        onderwerp: "Email",
        priority: "High",
        assignee: "Alice",
        organization: "Org A",
        servicedeskOnly: false,
      })
    );

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));

    const liveCall = global.fetch.mock.calls.find(([url]) => String(url).includes("/insights/live?"))[0];
    const logCall = global.fetch.mock.calls.find(([url]) => String(url).includes("/insights/logs?"))[0];

    expect(liveCall).toContain("date_from=");
    expect(liveCall).toContain("date_to=");
    expect(liveCall).not.toContain("request_type=");
    expect(liveCall).not.toContain("onderwerp=");
    expect(liveCall).not.toContain("priority=");
    expect(liveCall).not.toContain("assignee=");
    expect(liveCall).not.toContain("organization=");
    expect(liveCall).toContain("servicedesk_only=false");
    expect(logCall).toContain("limit=200");
    expect(result.current.liveInsights).toEqual([]);
    expect(result.current.insightLogEntries).toEqual([]);
    expect(result.current.thresholdPct).toBe(75);
    expect(result.current.ttlHours).toBe(8);
  });

  it("surfaces API feedback errors for non-mock AI insights", async () => {
    global.fetch = vi.fn((url) => {
      if (String(url).includes("/insights/live?")) {
        return jsonResponse({
          threshold_pct: 80,
          ttl_hours: 12,
          items: [
            {
              id: 21,
              title: "AI-signaal",
              target_card_key: "organizationWeekly",
              score_pct: 90,
              source_payload: {},
              feedback_status: "pending",
              is_mock: false,
            },
          ],
        });
      }
      if (String(url).includes("/insights/logs?")) {
        return jsonResponse([
          {
            id: 21,
            title: "AI-signaal",
            target_card_key: "organizationWeekly",
            score_pct: 90,
            source_payload: {},
            feedback_status: "pending",
            is_mock: false,
          },
        ]);
      }
      if (String(url).includes("/insights/21/feedback")) {
        return Promise.resolve({
          ok: false,
          json: async () => ({ detail: "Feedback opslaan mislukt door API." }),
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const { result } = renderHook(() =>
      useAiInsights({
        dateFrom: "2026-01-01",
        dateTo: "2026-01-31",
        requestType: "",
        onderwerp: "",
        priority: "",
        assignee: "",
        organization: "",
        servicedeskOnly: true,
      })
    );

    await waitFor(() => expect(result.current.liveInsights).toHaveLength(1));

    await expect(
      result.current.submitInsightFeedback({
        insightId: 21,
        vote: "up",
        reason: "",
      })
    ).rejects.toThrow("Feedback opslaan mislukt door API.");

    expect(result.current.liveInsights[0].feedback_status).toBe("pending");
    expect(result.current.insightLogEntries[0].feedback_status).toBe("pending");
  });

  it("falls back cleanly when AI insight endpoints throw", async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error("network down")));

    const { result } = renderHook(() =>
      useAiInsights({
        dateFrom: "2026-01-01",
        dateTo: "2026-01-31",
        requestType: "",
        onderwerp: "",
        priority: "",
        assignee: "",
        organization: "",
        servicedeskOnly: true,
      })
    );

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(result.current.liveInsights).toEqual([]);
    expect(result.current.insightLogEntries).toEqual([]);
    expect(result.current.thresholdPct).toBe(75);
    expect(result.current.ttlHours).toBe(8);
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

  it("normalizes vacation endpoints when they return non-array payloads", async () => {
    global.fetch = createFetchMock({
      "/vacations/upcoming?limit=3": [{ unexpected: true }],
      "/vacations/today": [{ unexpected: true }],
      "/vacations": [{ unexpected: true }],
    });

    const { result } = renderHook(() => useVacationsData());

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
    expect(result.current.upcomingVacationTotal).toBe(0);
    expect(result.current.allVacations).toEqual([]);
    expect(result.current.upcomingVacations).toEqual([]);
    expect(result.current.todayVacations).toEqual([]);
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
          saas_releases: {
            last: { base_release_date: "2026-01-13", release_date: "2026-01-13", followup_date: "2026-01-14", cancelled: false },
            next: { base_release_date: "2026-01-27", release_date: "2026-01-30", followup_date: "2026-01-31", cancelled: true },
          },
        },
        {
          team_members: ["Bob"],
          onderwerpen: ["chat"],
          onderwerpen_baseline: ["Chat"],
          onderwerpen_customized: false,
          updated_at: null,
          team_member_avatars: {},
          saas_releases: {},
        },
      ],
    });

    const { result } = renderHook(() => useServicedeskConfig());

    await waitFor(() => expect(result.current.servicedeskConfig.team_members).toEqual(["Alice"]));
    expect(result.current.teamMembersDraft).toEqual(["Alice"]);
    expect(result.current.onderwerpenDraft).toEqual(["email"]);
    expect(result.current.servicedeskConfig.saas_releases.next.cancelled).toBe(true);

    act(() => {
      result.current.applyServicedeskConfig(
        {
          team_members: ["Bob"],
          onderwerpen: ["chat"],
          onderwerpen_baseline: ["Chat"],
          onderwerpen_customized: false,
          updated_at: null,
          team_member_avatars: {},
          saas_releases: {},
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
    expect(result.current.servicedeskConfig.saas_releases.last.release_date).toBeNull();
    expect(result.current.teamMembersDraft).toEqual([]);
    expect(result.current.onderwerpenDraft).toEqual([]);
  });
});
