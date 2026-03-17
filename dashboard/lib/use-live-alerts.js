import { useCallback, useEffect, useState } from "react";
import { API } from "./dashboard-constants";

const DEFAULT_LIVE_ALERTS = {
  priority1: [],
  first_response_due_warning: [],
  first_response_due_critical: [],
  first_response_overdue: [],
};

function normalizeLiveAlerts(data) {
  const warningItems = Array.isArray(data?.first_response_due_warning)
    ? data.first_response_due_warning
    : (Array.isArray(data?.first_response_due_soon) ? data.first_response_due_soon : []);

  return {
    priority1: Array.isArray(data?.priority1) ? data.priority1 : [],
    first_response_due_warning: warningItems,
    first_response_due_critical: Array.isArray(data?.first_response_due_critical) ? data.first_response_due_critical : [],
    first_response_overdue: Array.isArray(data?.first_response_overdue) ? data.first_response_overdue : [],
  };
}

export function useLiveAlerts({ onRefresh } = {}) {
  const [liveAlerts, setLiveAlerts] = useState(DEFAULT_LIVE_ALERTS);

  const refreshLiveAlerts = useCallback(async () => {
    const params = new URLSearchParams();
    params.set("servicedesk_only", "true");
    const data = await fetch(`${API}/alerts/live?${params.toString()}`).then((r) => r.json());
    const normalized = normalizeLiveAlerts(data);
    setLiveAlerts(normalized);
    await onRefresh?.(normalized);
    return normalized;
  }, [onRefresh]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      refreshLiveAlerts().catch(() => {});
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshLiveAlerts]);

  useEffect(() => {
    const timer = setInterval(() => {
      refreshLiveAlerts().catch(() => {});
    }, 20000);
    return () => clearInterval(timer);
  }, [refreshLiveAlerts]);

  return { liveAlerts, refreshLiveAlerts };
}
