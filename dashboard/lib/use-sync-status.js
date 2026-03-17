import { useCallback, useEffect, useState } from "react";
import { API } from "./dashboard-constants";

function fetchSyncStatus() {
  return fetch(`${API}/sync/status`).then((r) => r.json());
}

export function useSyncStatus() {
  const [syncStatus, setSyncStatus] = useState(null);

  const refreshSyncStatus = useCallback(async () => {
    const status = await fetchSyncStatus();
    setSyncStatus(status);
    return status;
  }, []);

  useEffect(() => {
    fetchSyncStatus().then(setSyncStatus).catch(() => {});
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      fetchSyncStatus().then(setSyncStatus).catch(() => {});
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  return { syncStatus, refreshSyncStatus };
}
