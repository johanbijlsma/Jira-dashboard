import { useCallback, useEffect, useRef, useState } from "react";
import { API } from "./dashboard-constants";
import { usePageVisibility } from "./use-page-visibility";

function normalizeAlertLogs(data) {
  return Array.isArray(data)
    ? data.map((entry) => ({
        id: entry?.id != null ? String(entry.id) : `${entry?.kind || ""}:${entry?.issue_key || ""}:${entry?.detected_at || ""}`,
        detected_at: entry?.detected_at || null,
        kind: String(entry?.kind || ""),
        issue_key: String(entry?.issue_key || ""),
        status: String(entry?.status || ""),
        meta: String(entry?.meta || ""),
      }))
    : [];
}

export function useAlertLogs({ limit, sidePanelMode, resetKey }) {
  const [alertLogEntries, setAlertLogEntries] = useState([]);
  const [hasNewAlertLogEntry, setHasNewAlertLogEntry] = useState(false);
  const latestMarkerRef = useRef("");
  const bootstrappedRef = useRef(false);
  const isPageVisible = usePageVisibility();
  const wasPageVisibleRef = useRef(isPageVisible);

  const clearHasNewAlertLogEntry = useCallback(() => {
    setHasNewAlertLogEntry(false);
  }, []);

  const refreshAlertLogs = useCallback(async () => {
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    params.set("servicedesk_only", "true");
    const data = await fetch(`${API}/alerts/logs?${params.toString()}`).then((r) => r.json());
    const normalized = normalizeAlertLogs(data);
    const latestMarker = normalized[0] ? `${normalized[0].id}:${normalized[0].detected_at || ""}` : "";
    const prevMarker = latestMarkerRef.current;
    if (!bootstrappedRef.current) {
      bootstrappedRef.current = true;
    } else if (latestMarker && latestMarker !== prevMarker && sidePanelMode !== "alerts") {
      setHasNewAlertLogEntry(true);
    }
    latestMarkerRef.current = latestMarker;
    setAlertLogEntries(normalized);
    return normalized;
  }, [limit, sidePanelMode]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      refreshAlertLogs().catch(() => {});
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshAlertLogs]);

  useEffect(() => {
    let timer = null;
    if (!wasPageVisibleRef.current && isPageVisible) {
      timer = window.setTimeout(() => {
        refreshAlertLogs().catch(() => {});
      }, 0);
    }
    wasPageVisibleRef.current = isPageVisible;
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [isPageVisible, refreshAlertLogs]);

  useEffect(() => {
    const timer = setInterval(() => {
      refreshAlertLogs().catch(() => {});
    }, isPageVisible ? 30000 : 120000);
    return () => clearInterval(timer);
  }, [isPageVisible, refreshAlertLogs]);

  useEffect(() => {
    latestMarkerRef.current = "";
    bootstrappedRef.current = false;
    const timer = window.setTimeout(() => {
      setHasNewAlertLogEntry(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [resetKey]);

  return {
    alertLogEntries,
    hasNewAlertLogEntry,
    refreshAlertLogs,
    clearHasNewAlertLogEntry,
  };
}
