import { useCallback, useEffect, useState } from "react";
import { API } from "./dashboard-constants";

const DEFAULT_META = {
  request_types: [],
  onderwerpen: [],
  priorities: [],
  assignees: [],
  organizations: [],
};

function fetchJson(url) {
  return fetch(url).then(async (r) => {
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      const detail = data && typeof data === "object" ? data.detail : null;
      throw new Error(detail || `Request failed for ${url}`);
    }
    return data;
  });
}

function setArrayState(setter) {
  return (data) => setter(Array.isArray(data) ? data : []);
}

export function useDashboardData({
  dateFrom,
  dateTo,
  requestType,
  onderwerp,
  priority,
  assignee,
  organization,
  servicedeskOnly,
  p90Period,
}) {
  const [meta, setMeta] = useState(DEFAULT_META);
  const [volume, setVolume] = useState([]);
  const [onderwerpVolume, setOnderwerpVolume] = useState([]);
  const [priorityVolume, setPriorityVolume] = useState([]);
  const [assigneeVolume, setAssigneeVolume] = useState([]);
  const [organizationVolume, setOrganizationVolume] = useState([]);
  const [p90, setP90] = useState([]);
  const [inflowVsClosedWeekly, setInflowVsClosedWeekly] = useState([]);
  const [incidentResolutionWeekly, setIncidentResolutionWeekly] = useState([]);
  const [firstResponseWeekly, setFirstResponseWeekly] = useState([]);
  const [ttfrOverdueWeekly, setTtfrOverdueWeekly] = useState([]);
  const [releaseFollowupWorkload, setReleaseFollowupWorkload] = useState([]);

  const buildMetricParams = useCallback(() => {
    const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
    if (requestType) params.set("request_type", requestType);
    if (onderwerp) params.set("onderwerp", onderwerp);
    if (priority) params.set("priority", priority);
    if (assignee) params.set("assignee", assignee);
    if (organization) params.set("organization", organization);
    if (servicedeskOnly) params.set("servicedesk_only", "true");
    return params;
  }, [dateFrom, dateTo, requestType, onderwerp, priority, assignee, organization, servicedeskOnly]);

  const buildP90Params = useCallback(() => {
    const params = new URLSearchParams({ date_from: p90Period.dateFrom, date_to: p90Period.dateTo });
    if (onderwerp) params.set("onderwerp", onderwerp);
    if (priority) params.set("priority", priority);
    if (assignee) params.set("assignee", assignee);
    if (organization) params.set("organization", organization);
    if (servicedeskOnly) params.set("servicedesk_only", "true");
    return params;
  }, [p90Period.dateFrom, p90Period.dateTo, onderwerp, priority, assignee, organization, servicedeskOnly]);

  const refreshMetrics = useCallback(() => {
    const params = buildMetricParams();
    const metricRequests = [
      { endpoint: "volume_weekly", setter: setVolume, transform: false, fallback: [] },
      { endpoint: "volume_weekly_by_onderwerp", setter: setOnderwerpVolume, transform: true, fallback: [] },
      { endpoint: "volume_by_priority", setter: setPriorityVolume, transform: true, fallback: [] },
      { endpoint: "volume_by_assignee", setter: setAssigneeVolume, transform: true, fallback: [] },
      { endpoint: "volume_weekly_by_organization", setter: setOrganizationVolume, transform: true, fallback: [] },
      { endpoint: "inflow_vs_closed_weekly", setter: setInflowVsClosedWeekly, transform: true, fallback: [] },
      { endpoint: "time_to_first_response_weekly", setter: setFirstResponseWeekly, transform: true, fallback: [] },
      { endpoint: "ttfr_overdue_weekly", setter: setTtfrOverdueWeekly, transform: true, fallback: [] },
    ];

    metricRequests.forEach(({ endpoint, setter, transform, fallback }) => {
      fetchJson(`${API}/metrics/${endpoint}?` + params.toString())
        .then(transform ? setArrayState(setter) : setter)
        .catch(() => {
          if (transform) setArrayState(setter)(fallback);
          else setter(fallback);
        });
    });

    const ttrParams = new URLSearchParams(params);
    ttrParams.delete("request_type");
    fetchJson(`${API}/metrics/time_to_resolution_weekly_by_type?` + ttrParams.toString()).then(
      setArrayState(setIncidentResolutionWeekly)
    ).catch(() => setIncidentResolutionWeekly([]));

    const releaseParams = new URLSearchParams(params);
    releaseParams.set("anchor_iso", process.env.NEXT_PUBLIC_RELEASE_ANCHOR_ISO || "2026-01-27T16:00:00Z");
    releaseParams.set("interval_days", "14");
    fetchJson(`${API}/metrics/release_followup_workload?` + releaseParams.toString())
      .then(setArrayState(setReleaseFollowupWorkload))
      .catch(() => setReleaseFollowupWorkload([]));

    if (!p90Period.hasData) {
      setP90([]);
    } else {
      const p = buildP90Params();

      fetchJson(`${API}/metrics/leadtime_p90_by_type?` + p.toString()).then(setP90).catch(() => setP90([]));
    }
  }, [
    buildMetricParams,
    buildP90Params,
    p90Period.hasData,
    setIncidentResolutionWeekly,
    setP90,
  ]);

  const refreshDashboard = useCallback(async () => {
    refreshMetrics();
    fetchJson(`${API}/meta`).then(setMeta).catch(() => setMeta(DEFAULT_META));
  }, [refreshMetrics]);

  useEffect(() => {
    fetchJson(`${API}/meta`).then(setMeta).catch(() => setMeta(DEFAULT_META));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      refreshMetrics();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshMetrics]);

  return {
    meta,
    volume,
    onderwerpVolume,
    priorityVolume,
    assigneeVolume,
    organizationVolume,
    p90,
    inflowVsClosedWeekly,
    incidentResolutionWeekly,
    firstResponseWeekly,
    ttfrOverdueWeekly,
    releaseFollowupWorkload,
    refreshDashboard,
  };
}
