import { useCallback, useEffect, useRef, useState } from "react";
import { API } from "./dashboard-constants";
import { usePageVisibility } from "./use-page-visibility";

const VISIBLE_REFRESH_MS = 15 * 60 * 1000;
const HIDDEN_REFRESH_MS = 60 * 60 * 1000;

function normalizeWeeklyInsights(data) {
  if (!data || typeof data !== "object") return null;
  return {
    generated_at: data.generated_at || null,
    week: data.week || {},
    scope: data.scope || "",
    summary: data.summary || {},
    service_levels: data.service_levels || {},
    alerts: data.alerts || {},
    breakdowns: data.breakdowns || {},
  };
}

export function useWeeklyInsights({ servicedeskOnly = true } = {}) {
  const [weeklyInsights, setWeeklyInsights] = useState(null);
  const [weeklyInsightsLoading, setWeeklyInsightsLoading] = useState(true);
  const [weeklyInsightsError, setWeeklyInsightsError] = useState("");
  const isPageVisible = usePageVisibility();
  const wasPageVisibleRef = useRef(isPageVisible);

  const refreshWeeklyInsights = useCallback(async () => {
    setWeeklyInsightsLoading(true);
    setWeeklyInsightsError("");
    try {
      const params = new URLSearchParams();
      params.set("servicedesk_only", String(servicedeskOnly));
      const response = await fetch(`${API}/alerts/weekly-insights?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Weekly insights ophalen mislukt (${response.status})`);
      }
      const data = await response.json();
      setWeeklyInsights(normalizeWeeklyInsights(data));
    } catch (err) {
      setWeeklyInsightsError(err?.message || "Weekly insights ophalen mislukt.");
    } finally {
      setWeeklyInsightsLoading(false);
    }
  }, [servicedeskOnly]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      refreshWeeklyInsights().catch(() => {});
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshWeeklyInsights]);

  useEffect(() => {
    let timer = null;
    if (!wasPageVisibleRef.current && isPageVisible) {
      timer = window.setTimeout(() => {
        refreshWeeklyInsights().catch(() => {});
      }, 0);
    }
    wasPageVisibleRef.current = isPageVisible;
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [isPageVisible, refreshWeeklyInsights]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      refreshWeeklyInsights().catch(() => {});
    }, isPageVisible ? VISIBLE_REFRESH_MS : HIDDEN_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [isPageVisible, refreshWeeklyInsights]);

  return {
    weeklyInsights,
    weeklyInsightsLoading,
    weeklyInsightsError,
    refreshWeeklyInsights,
  };
}
