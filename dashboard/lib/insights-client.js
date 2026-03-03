import { API, DEFAULT_SERVICEDESK_ONLY } from "./dashboard-constants";

export function buildInsightsParams({ dateFrom, dateTo, organization, servicedeskOnly = DEFAULT_SERVICEDESK_ONLY }) {
  const params = new URLSearchParams({
    date_from: dateFrom,
    date_to: dateTo,
  });
  if (organization) params.set("organization", organization);
  if (servicedeskOnly) params.set("servicedesk_only", "true");
  return params;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Inzichten ophalen mislukt (${response.status})`);
  }
  return response.json();
}

export async function fetchInsightsBundle({ dateFrom, dateTo, organization, servicedeskOnly = DEFAULT_SERVICEDESK_ONLY }) {
  const params = buildInsightsParams({ dateFrom, dateTo, organization, servicedeskOnly });
  const query = params.toString();
  const [meta, highlights, trends, drivers] = await Promise.all([
    fetchJson(`${API}/meta`),
    fetchJson(`${API}/insights/highlights?${query}`),
    fetchJson(`${API}/insights/trends?${query}`),
    fetchJson(`${API}/insights/drivers?${query}`),
  ]);
  return { meta, highlights, trends, drivers };
}
