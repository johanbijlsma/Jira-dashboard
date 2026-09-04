import { useCallback, useEffect, useRef, useState } from "react";
import { API } from "./dashboard-constants";
import { usePageVisibility } from "./use-page-visibility";

const DEFAULT_LIVE_ALERTS = {
  priority1: [],
  priority2: [],
  first_response_due_warning: [],
  first_response_due_critical: [],
  first_response_overdue: [],
  time_to_resolution_warning: [],
  time_to_resolution_critical: [],
  time_to_resolution_overdue: [],
};

function normalizeLiveAlerts(data) {
  const warningItems = Array.isArray(data?.first_response_due_warning)
    ? data.first_response_due_warning
    : Array.isArray(data?.first_response_due_soon)
      ? data.first_response_due_soon
      : [];

  return {
    priority1: Array.isArray(data?.priority1) ? data.priority1 : [],
    priority2: Array.isArray(data?.priority2) ? data.priority2 : [],
    first_response_due_warning: warningItems,
    first_response_due_critical: Array.isArray(data?.first_response_due_critical)
      ? data.first_response_due_critical
      : [],
    first_response_overdue: Array.isArray(data?.first_response_overdue)
      ? data.first_response_overdue
      : [],
    time_to_resolution_warning: Array.isArray(data?.time_to_resolution_warning)
      ? data.time_to_resolution_warning
      : [],
    time_to_resolution_critical: Array.isArray(data?.time_to_resolution_critical)
      ? data.time_to_resolution_critical
      : [],
    time_to_resolution_overdue: Array.isArray(data?.time_to_resolution_overdue)
      ? data.time_to_resolution_overdue
      : [],
  };
}

export function useLiveAlerts({ onRefresh } = {}) {
  const [liveAlerts, setLiveAlerts] = useState(DEFAULT_LIVE_ALERTS);
  const [pendingPriorityAlertIntro, setPendingPriorityAlertIntro] = useState(false);
  const isPageVisible = usePageVisibility();
  const wasPageVisibleRef = useRef(isPageVisible);
  const onRefreshRef = useRef(onRefresh);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  const refreshLiveAlerts = useCallback(async () => {
    const params = new URLSearchParams();
    params.set("servicedesk_only", "true");
    const data = await fetch(`${API}/alerts/live?${params.toString()}`, {
      // Live alerts must never be served from a browser or proxy cache.
      cache: "no-store",
    }).then((r) => r.json());
    const normalized = normalizeLiveAlerts(data);
    setLiveAlerts(normalized);
    await onRefreshRef.current?.(normalized);
    return normalized;
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      refreshLiveAlerts().catch(() => {});
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshLiveAlerts]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    if (window.sessionStorage.getItem("dashboard-dev-alert-pending") !== "1") return undefined;
    window.sessionStorage.removeItem("dashboard-dev-alert-pending");
    const introTimer = window.setTimeout(() => setPendingPriorityAlertIntro(true), 0);
    // The status page schedules the test alert after navigation. Fetch once more
    // shortly afterwards so the dashboard can show its incoming-alert animation.
    const refreshTimer = window.setTimeout(() => refreshLiveAlerts().catch(() => {}), 3500);
    // Avoid treating an unrelated alert much later as the scheduled test scenario.
    const expiryTimer = window.setTimeout(() => setPendingPriorityAlertIntro(false), 10000);
    return () => {
      window.clearTimeout(refreshTimer);
      window.clearTimeout(expiryTimer);
      window.clearTimeout(introTimer);
    };
  }, [refreshLiveAlerts]);

  useEffect(() => {
    let timer = null;
    if (!wasPageVisibleRef.current && isPageVisible) {
      timer = window.setTimeout(() => {
        refreshLiveAlerts().catch(() => {});
      }, 0);
    }
    wasPageVisibleRef.current = isPageVisible;
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [isPageVisible, refreshLiveAlerts]);

  useEffect(() => {
    const timer = setInterval(
      () => {
        refreshLiveAlerts().catch(() => {});
      },
      isPageVisible ? 60000 : 300000
    );
    return () => clearInterval(timer);
  }, [isPageVisible, refreshLiveAlerts]);

  return { liveAlerts, refreshLiveAlerts, pendingPriorityAlertIntro };
}
