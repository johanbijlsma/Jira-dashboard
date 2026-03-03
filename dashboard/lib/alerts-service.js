import { API } from "./dashboard-constants";

export function normalizeLiveAlerts(data) {
  return {
    priority1: Array.isArray(data?.priority1) ? data.priority1 : [],
    first_response_due_soon: Array.isArray(data?.first_response_due_soon) ? data.first_response_due_soon : [],
    first_response_overdue: Array.isArray(data?.first_response_overdue) ? data.first_response_overdue : [],
  };
}

export function normalizeAlertLogs(data) {
  if (!Array.isArray(data)) return [];
  return data.map((entry) => ({
    id: entry?.id != null ? String(entry.id) : `${entry?.kind || ""}:${entry?.issue_key || ""}:${entry?.detected_at || ""}`,
    detected_at: entry?.detected_at || null,
    kind: String(entry?.kind || ""),
    issue_key: String(entry?.issue_key || ""),
    status: String(entry?.status || ""),
    meta: String(entry?.meta || ""),
  }));
}

export async function fetchLiveAlerts({ servicedeskOnly = false } = {}) {
  const params = new URLSearchParams();
  if (servicedeskOnly) params.set("servicedesk_only", "true");
  const response = await fetch(`${API}/alerts/live?${params.toString()}`);
  if (!response.ok) throw new Error(`Live alerts ophalen mislukt (${response.status})`);
  return normalizeLiveAlerts(await response.json());
}

export async function fetchAlertLogs({ servicedeskOnly = false, limit = 300 } = {}) {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (servicedeskOnly) params.set("servicedesk_only", "true");
  const response = await fetch(`${API}/alerts/logs?${params.toString()}`);
  if (!response.ok) throw new Error(`Alert logs ophalen mislukt (${response.status})`);
  return normalizeAlertLogs(await response.json());
}
