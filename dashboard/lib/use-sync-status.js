import { useCallback, useEffect, useRef, useState } from "react";
import { API } from "./dashboard-constants";
import { usePageVisibility } from "./use-page-visibility";

function fetchSyncStatus() {
  return fetch(`${API}/sync/status`).then((r) => r.json());
}

export function useSyncStatus() {
  const [syncStatus, setSyncStatus] = useState(null);
  const isPageVisible = usePageVisibility();
  const wasPageVisibleRef = useRef(isPageVisible);

  const refreshSyncStatus = useCallback(async () => {
    const status = await fetchSyncStatus();
    setSyncStatus(status);
    return status;
  }, []);

  useEffect(() => {
    fetchSyncStatus().then(setSyncStatus).catch(() => {});
  }, []);

  useEffect(() => {
    if (!wasPageVisibleRef.current && isPageVisible) {
      fetchSyncStatus().then(setSyncStatus).catch(() => {});
    }
    wasPageVisibleRef.current = isPageVisible;
  }, [isPageVisible]);

  useEffect(() => {
    const timer = setInterval(() => {
      fetchSyncStatus().then(setSyncStatus).catch(() => {});
    }, isPageVisible ? 15000 : 60000);
    return () => clearInterval(timer);
  }, [isPageVisible]);

  return { syncStatus, refreshSyncStatus };
}
