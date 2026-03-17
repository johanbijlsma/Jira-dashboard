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
  return fetch(url).then((r) => r.json());
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
      { endpoint: "volume_weekly", setter: setVolume, transform: false },
      { endpoint: "volume_weekly_by_onderwerp", setter: setOnderwerpVolume, transform: true },
      { endpoint: "volume_by_priority", setter: setPriorityVolume, transform: true },
      { endpoint: "volume_by_assignee", setter: setAssigneeVolume, transform: true },
      { endpoint: "volume_weekly_by_organization", setter: setOrganizationVolume, transform: true },
      { endpoint: "inflow_vs_closed_weekly", setter: setInflowVsClosedWeekly, transform: true },
      { endpoint: "time_to_first_response_weekly", setter: setFirstResponseWeekly, transform: true },
      { endpoint: "ttfr_overdue_weekly", setter: setTtfrOverdueWeekly, transform: true },
    ];

    metricRequests.forEach(({ endpoint, setter, transform }) => {
      fetchJson(`${API}/metrics/${endpoint}?` + params.toString()).then(transform ? setArrayState(setter) : setter);
    });

    const ttrParams = new URLSearchParams(params);
    ttrParams.delete("request_type");
    fetchJson(`${API}/metrics/time_to_resolution_weekly_by_type?` + ttrParams.toString()).then(
      setArrayState(setIncidentResolutionWeekly)
    );

    if (!p90Period.hasData) {
      setP90([]);
    } else {
      const p = buildP90Params();

      fetchJson(`${API}/metrics/leadtime_p90_by_type?` + p.toString()).then(setP90);
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
    fetchJson(`${API}/meta`).then(setMeta);
  }, [refreshMetrics]);

  useEffect(() => {
    fetchJson(`${API}/meta`).then(setMeta);
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
    refreshDashboard,
  };
}
