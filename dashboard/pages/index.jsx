import { Bar, Doughnut, Line } from "react-chartjs-2";
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseNlDateToIso } from "../lib/date";
import { buildUpcomingWarningText, businessDaysUntil } from "../lib/vacation-banner";
import Link from "next/link";
import Head from "next/head";
import {
  API,
  AI_INSIGHT_DOWNVOTE_REASONS,
  CARD_TITLES,
  DASHBOARD_CONFIG_STORAGE_KEY,
  DEFAULT_SERVICEDESK_ONLY,
  JIRA_BASE,
  TV_MODE_STORAGE_KEY,
  TYPE_COLORS,
  VACATION_TEAM_MEMBERS,
  createDefaultDashboardLayout,
} from "../lib/dashboard-constants";
import {
  AMSTERDAM_TIME_ZONE,
  addDaysIso,
  buildWeekStartsFromRange,
  fmtDate,
  fmtDateTime,
  fmtDateWithWeekday,
  hasDataPoints,
  isTextEntryTarget,
  isCurrentPartialWeek,
  isoDate,
  num,
  pct,
  sameStringSet,
  trimLeadingPartialWeek,
  weekStartIsoFromDate,
  zonedDateTimeParts,
} from "../lib/dashboard-utils";
import { legendNoopHandler, setupChartDefaults } from "../lib/chart-setup";
import { useAlertLogs } from "../lib/use-alert-logs";
import { useAiInsights } from "../lib/use-ai-insights";
import { useDashboardData } from "../lib/use-dashboard-data";
import { useLiveAlerts } from "../lib/use-live-alerts";
import { useServicedeskConfig } from "../lib/use-servicedesk-config";
import { useSyncStatus } from "../lib/use-sync-status";
import { useVacationsData } from "../lib/use-vacations-data";
import {
  hideCardLayout,
  hideKpiLayout,
  moveCardToRowLayout,
  moveKpiToVisibleLayout,
  normalizeDashboardLayout as normalizeDashboardLayoutState,
  renderCardRowWithHintLayout,
  renderKpiRowWithHintLayout,
  toggleCardLockLayout,
  toggleRowExpandCardLayout,
} from "../lib/dashboard-layout";
import { isTotalLabel, median, trendInfo, uniqueChartColor, wowSortValue } from "../lib/dashboard-metrics";
import EmptyChartState from "../components/EmptyChartState";
import LiveAlertStack from "../components/LiveAlertStack";
import Toast from "../components/Toast";
import VacationAvatar from "../components/VacationAvatar";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Tooltip,
  Legend
);
setupChartDefaults(ChartJS);

const AUTO_SYNC_INTERVAL_MS = Math.max(
  15000,
  (Number(process.env.NEXT_PUBLIC_AUTO_SYNC_INTERVAL_SECONDS) || 120) * 1000
);
const STALE_SYNC_THRESHOLD_MS = Math.max(3 * AUTO_SYNC_INTERVAL_MS, 5 * 60 * 1000);
const AUTO_SYNC_RETRY_THROTTLE_MS = Math.max(AUTO_SYNC_INTERVAL_MS, 60 * 1000);
const AUTO_RESET_IDLE_MS = Math.max(
  0,
  (Number(process.env.NEXT_PUBLIC_AUTO_RESET_IDLE_SECONDS) || 120) * 1000
);
const CHART_RENDER_TIMEOUT_MS = Math.max(
  600,
  (Number(process.env.NEXT_PUBLIC_CHART_RENDER_TIMEOUT_MS) || 900)
);
const CHART_RENDER_OVERLAY_MAX_MS = Math.max(
  CHART_RENDER_TIMEOUT_MS + 1000,
  (Number(process.env.NEXT_PUBLIC_CHART_RENDER_OVERLAY_MAX_MS) || 7000)
);

function alertFaviconDataUri(color, ring = false) {
  const ringSvg = ring
    ? `<circle cx='32' cy='32' r='26' fill='none' stroke='${color}' stroke-width='6' opacity='0.95'/>`
    : `<circle cx='32' cy='32' r='26' fill='${color}' opacity='0.95'/>`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='12' fill='#0f172a'/>${ringSvg}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function alertKindLabel(kind) {
  if (kind === "P1") return "P1";
  if (kind === "TTR_WARNING") return "TTR <24u";
  if (kind === "TTR_CRITICAL") return "TTR <60m";
  if (kind === "TTR_OVERDUE") return "TTR verlopen";
  if (kind === "SLA_OVERDUE") return "SLA verlopen";
  if (kind === "LOGBOOK_EVENT") return "Logboek";
  return "SLA bijna";
}

const ALERT_KIND_FILTER_ORDER = [
  "P1",
  "SLA_WARNING",
  "SLA_CRITICAL",
  "SLA_OVERDUE",
  "TTR_WARNING",
  "TTR_CRITICAL",
  "TTR_OVERDUE",
  "LOGBOOK_EVENT",
];

function alertKindPillStyle(kind) {
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 8px",
    borderRadius: 999,
    fontWeight: 700,
    fontSize: 12,
    border: "1px solid",
    borderColor:
      kind === "P1"
        ? "rgba(127, 29, 29, 0.42)"
        : kind === "TTR_WARNING"
          ? "rgba(96, 165, 250, 0.42)"
        : kind === "TTR_CRITICAL"
          ? "rgba(37, 99, 235, 0.42)"
        : kind === "TTR_OVERDUE"
          ? "rgba(30, 58, 138, 0.42)"
        : kind === "LOGBOOK_EVENT"
          ? "rgba(71, 85, 105, 0.42)"
        : kind === "SLA_OVERDUE"
          ? "rgba(126, 34, 206, 0.42)"
          : "rgba(180, 83, 9, 0.42)",
    background:
      kind === "P1"
        ? "color-mix(in srgb, #ef4444 18%, var(--surface))"
        : kind === "TTR_WARNING"
          ? "color-mix(in srgb, #60a5fa 16%, var(--surface))"
        : kind === "TTR_CRITICAL"
          ? "color-mix(in srgb, #2563eb 16%, var(--surface))"
        : kind === "TTR_OVERDUE"
          ? "color-mix(in srgb, #1e3a8a 18%, var(--surface))"
        : kind === "LOGBOOK_EVENT"
          ? "color-mix(in srgb, #64748b 14%, var(--surface))"
        : kind === "SLA_OVERDUE"
          ? "color-mix(in srgb, #a855f7 16%, var(--surface))"
          : "color-mix(in srgb, #f59e0b 16%, var(--surface))",
    color:
      kind === "P1"
        ? "#b91c1c"
        : kind === "TTR_WARNING"
          ? "#1d4ed8"
        : kind === "TTR_CRITICAL"
          ? "#1e40af"
        : kind === "TTR_OVERDUE"
          ? "#1e3a8a"
        : kind === "LOGBOOK_EVENT"
          ? "#334155"
        : kind === "SLA_OVERDUE"
          ? "#7e22ce"
          : "#b45309",
  };
}

function formatAlertLogbookClearMessage(detectedAt, reason) {
  const dt = detectedAt ? new Date(detectedAt) : null;
  if (!dt || Number.isNaN(dt.getTime())) return "Het Alerts logboek is geleegd.";
  const datePart = new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Amsterdam",
  })
    .format(dt)
    .replaceAll("/", "-");
  const timePart = new Intl.DateTimeFormat("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/Amsterdam",
  }).format(dt);
  if (reason === "AUTO_CLEANUP") {
    return `Het Alerts logboek is geleegd op ${datePart} om ${timePart} (geautomatiseerd).`;
  }
  return `Het Alerts logboek is geleegd op ${datePart} om ${timePart}.`;
}

function formatDurationHoursForTooltip(value) {
  const hours = Number(value);
  if (!Number.isFinite(hours)) return "—";
  if (Math.abs(hours) >= 72) {
    const days = hours / 24;
    return `${hours.toFixed(1)} uur (${days.toFixed(1)} dagen)`;
  }
  return `${hours.toFixed(1)} uur`;
}

export default function Home() {
  const today = useMemo(() => new Date(), []);
  const defaultFrom = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d;
  }, []);
  const getStandardDateRange = useCallback(() => {
    const end = new Date();
    const start = new Date(end);
    start.setMonth(start.getMonth() - 1);
    const fromIso = isoDate(start);
    const toIso = isoDate(end);
    return {
      fromIso,
      toIso,
      fromLabel: fmtDate(fromIso),
      toLabel: fmtDate(toIso),
    };
  }, []);

  const [dateFrom, setDateFrom] = useState(isoDate(defaultFrom));
  const [dateTo, setDateTo] = useState(isoDate(today));
  const dateFromNativeRef = useRef(null);
  const dateToNativeRef = useRef(null);

  const [dateFromUi, setDateFromUi] = useState(fmtDate(defaultFrom));
  const [dateToUi, setDateToUi] = useState(fmtDate(today));
  useEffect(() => {
    setDateFromUi(fmtDate(dateFrom));
  }, [dateFrom]);

  useEffect(() => {
    setDateToUi(fmtDate(dateTo));
  }, [dateTo]);
  const [requestType, setRequestType] = useState("");
  const [onderwerp, setOnderwerp] = useState("");
  const [priority, setPriority] = useState("");
  const [assignee, setAssignee] = useState("");
  const [organization, setOrganization] = useState("");
  const [servicedeskOnly, setServicedeskOnly] = useState(DEFAULT_SERVICEDESK_ONLY);
  const [teamConfigSaving, setTeamConfigSaving] = useState(false);
  const [onderwerpConfigSaving, setOnderwerpConfigSaving] = useState(false);

  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [syncMessageKind, setSyncMessageKind] = useState("success"); // "success" | "error"
  const [vacationEditMode, setVacationEditMode] = useState(false);
  const [vacationSaving, setVacationSaving] = useState(false);
  const [vacationHoverId, setVacationHoverId] = useState(null);
  const [vacationBannerIndex, setVacationBannerIndex] = useState(0);
  const [vacationForm, setVacationForm] = useState({
    id: null,
    memberName: VACATION_TEAM_MEMBERS[0],
    startDate: "",
    endDate: "",
  });
  const [vacationInitialForm, setVacationInitialForm] = useState({
    id: null,
    memberName: VACATION_TEAM_MEMBERS[0],
    startDate: "",
    endDate: "",
  });
  const [vacationStartUi, setVacationStartUi] = useState("");
  const [vacationEndUi, setVacationEndUi] = useState("");
  const vacationStartNativeRef = useRef(null);
  const vacationEndNativeRef = useRef(null);

  const [selectedWeek, setSelectedWeek] = useState("");
  const [sidePanelMode, setSidePanelMode] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const [selectedOnderwerp, setSelectedOnderwerp] = useState("");
  const [selectedDrillDateField, setSelectedDrillDateField] = useState("created");
  const [selectedDrillBasisLabel, setSelectedDrillBasisLabel] = useState("Binnengekomen");
  const [drillIssues, setDrillIssues] = useState([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillOffset, setDrillOffset] = useState(0);
  const [drillHasNext, setDrillHasNext] = useState(false);
  const [clearAlertLogsBusy, setClearAlertLogsBusy] = useState(false);
  const [alertKindFilter, setAlertKindFilter] = useState("ALL");
  const [expandedAlertGroups, setExpandedAlertGroups] = useState({});
  const [expandedInsightIds, setExpandedInsightIds] = useState({});
  const [selectedInsightId, setSelectedInsightId] = useState("");
  const [insightFeedbackBusyId, setInsightFeedbackBusyId] = useState(null);
  const [pendingInsightDownvoteId, setPendingInsightDownvoteId] = useState(null);
  const [pendingInsightReason, setPendingInsightReason] = useState(AI_INSIGHT_DOWNVOTE_REASONS[0]);
  const [ttrAlertsCollapsed, setTtrAlertsCollapsed] = useState(false);
  const drillPanelRef = useRef(null);
  const drillCloseRef = useRef(null);
  const hotkeysPopupRef = useRef(null);
  const hotkeysButtonRef = useRef(null);
  const [showPriority, setShowPriority] = useState(false);
  const [showAssignee, setShowAssignee] = useState(false);
  const [expandedCard, setExpandedCard] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showStartupSkeleton, setShowStartupSkeleton] = useState(true);
  const [dashboardLayout, setDashboardLayout] = useState(createDefaultDashboardLayout);
  const [aiInsightThresholdDraft, setAiInsightThresholdDraft] = useState(75);
  const [hotkeysOpen, setHotkeysOpen] = useState(false);
  const [topOnderwerpSort, setTopOnderwerpSort] = useState("wow");
  const [isTvMode, setIsTvMode] = useState(false);
  const autoSyncAttemptRef = useRef(0);
  const autoResetTimerRef = useRef(null);
  const seenLiveAlertKeysRef = useRef(new Set());
  const dragStateRef = useRef(null);
  const [layoutSavedSnapshot, setLayoutSavedSnapshot] = useState("");
  const [isLayoutEditing, setIsLayoutEditing] = useState(false);
  const [cardDropHint, setCardDropHint] = useState(null);
  const [kpiDropHint, setKpiDropHint] = useState(null);
  const [hiddenDropTarget, setHiddenDropTarget] = useState(null);

  const normalizeDashboardLayout = useCallback((input) => normalizeDashboardLayoutState(input), []);

  const layoutDirty = useMemo(
    () => layoutSavedSnapshot !== JSON.stringify(dashboardLayout),
    [layoutSavedSnapshot, dashboardLayout]
  );

  const DRILL_LIMIT = 100;
  const ALERT_LOG_LIMIT = 300;
  const sidePanelOpen = sidePanelMode === "alerts" || sidePanelMode === "insights" || !!selectedWeek;
  const filtersAreDefault = useMemo(() => {
    const { fromIso, toIso } = getStandardDateRange();
    return (
      dateFrom === fromIso &&
      dateTo === toIso &&
      !requestType &&
      !onderwerp &&
      !priority &&
      !assignee &&
      !organization &&
      servicedeskOnly === DEFAULT_SERVICEDESK_ONLY
    );
  }, [dateFrom, dateTo, requestType, onderwerp, priority, assignee, organization, servicedeskOnly, getStandardDateRange]);
  const { syncStatus, refreshSyncStatus } = useSyncStatus();
  const syncBusy = syncLoading || !!syncStatus?.running;
  const backendAutoSyncEnabled = !!syncStatus?.auto_sync?.enabled;
  const syncStatusInlineText = useMemo(() => {
    if (!syncStatus) return "";
    const base = syncStatus.running
      ? "Synchroniseren…"
      : `Bijgewerkt: ${syncStatus.last_sync ? fmtDateTime(syncStatus.last_sync) : "—"}`;
    const upserts =
      syncStatus.last_result?.upserts != null ? ` · ${syncStatus.last_result.upserts} bijgewerkt` : "";
    const err = syncStatus.last_error ? ` · fout: ${syncStatus.last_error}` : "";
    return `${base}${upserts}${err}`;
  }, [syncStatus]);
  const {
    servicedeskConfig,
    servicedeskOnderwerpenBaseline,
    teamMembersDraft,
    onderwerpenDraft,
    setTeamMembersDraft,
    setOnderwerpenDraft,
    refreshServicedeskConfig,
    applyServicedeskConfig,
  } = useServicedeskConfig();
  useEffect(() => {
    setAiInsightThresholdDraft(Number(servicedeskConfig?.ai_insight_threshold_pct || 75));
  }, [servicedeskConfig?.ai_insight_threshold_pct]);
  const servicedeskTeamMembers = useMemo(() => {
    const values = Array.isArray(servicedeskConfig?.team_members) ? servicedeskConfig.team_members : [];
    return values.length ? values : VACATION_TEAM_MEMBERS;
  }, [servicedeskConfig]);
  const activeFilterItems = useMemo(() => {
    const items = [];
    if (requestType) items.push(`Type: ${requestType}`);
    if (onderwerp) items.push(`Onderwerp: ${onderwerp}`);
    if (priority) items.push(`Prioriteit: ${priority}`);
    if (assignee) items.push(`Assignee: ${assignee}`);
    if (organization) items.push(`Partner: ${organization}`);
    if (servicedeskOnly !== DEFAULT_SERVICEDESK_ONLY) {
      items.push(servicedeskOnly ? "Scope: alleen servicedesk" : "Scope: alle tickets");
    }
    return items;
  }, [
    requestType,
    onderwerp,
    priority,
    assignee,
    organization,
    servicedeskOnly,
  ]);
  const p90Period = useMemo(() => {
    const weekStarts = buildWeekStartsFromRange(dateFrom, dateTo);
    const currentWeek = weekStartIsoFromDate();
    const completed = weekStarts.filter((w) => w < currentWeek);
    if (!completed.length) {
      return {
        hasData: false,
        dateFrom: null,
        dateTo: null,
        label: "Geen volledige weken in de huidige datumselectie",
      };
    }
    const from = completed[0];
    const to = addDaysIso(completed[completed.length - 1], 6);
    return {
      hasData: true,
      dateFrom: from,
      dateTo: to,
      label: `${fmtDate(from)} t/m ${fmtDate(to)} (${completed.length} volledige weken)`,
    };
  }, [dateFrom, dateTo]);

  const {
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
  } = useDashboardData({
    dateFrom,
    dateTo,
    requestType,
    onderwerp,
    priority,
    assignee,
    organization,
    servicedeskOnly,
    p90Period,
  });
  const {
    upcomingVacations,
    upcomingVacationTotal,
    allVacations,
    todayVacations,
    refreshVacations,
  } = useVacationsData();
  const {
    alertLogEntries,
    hasNewAlertLogEntry,
    refreshAlertLogs,
    clearHasNewAlertLogEntry,
  } = useAlertLogs({
    limit: ALERT_LOG_LIMIT,
    sidePanelMode,
    resetKey: servicedeskOnly,
  });
  const {
    liveInsights,
    insightLogEntries,
    thresholdPct: activeAiThresholdPct,
    ttlHours: aiInsightTtlHours,
    refreshLiveInsights,
    refreshInsightLog,
    submitInsightFeedback,
  } = useAiInsights({
    dateFrom,
    dateTo,
    requestType,
    onderwerp,
    priority,
    assignee,
    organization,
    servicedeskOnly,
  });
  const alertLogGroups = useMemo(() => {
    const grouped = new Map();
    for (const entry of alertLogEntries) {
      const key = `${entry.kind || ""}:${entry.issue_key || ""}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          issue_key: entry.issue_key,
          kind: entry.kind,
          status: entry.status,
          latest_detected_at: entry.detected_at,
          latest_meta: entry.meta,
          count: 0,
          entries: [],
        });
      }
      const group = grouped.get(key);
      group.count += 1;
      group.entries.push(entry);
    }
    return Array.from(grouped.values());
  }, [alertLogEntries]);
  const availableAlertKindFilters = useMemo(() => {
    const kinds = new Set(alertLogEntries.map((entry) => entry.kind).filter(Boolean));
    return ALERT_KIND_FILTER_ORDER.filter((kind) => kinds.has(kind));
  }, [alertLogEntries]);
  const filteredAlertLogGroups = useMemo(() => {
    if (alertKindFilter === "ALL") return alertLogGroups;
    return alertLogGroups.filter((group) => group.kind === alertKindFilter);
  }, [alertKindFilter, alertLogGroups]);
  const hasClearableAlertEntries = useMemo(
    () => alertLogEntries.some((entry) => entry.kind !== "LOGBOOK_EVENT"),
    [alertLogEntries]
  );

  useEffect(() => {
    if (alertKindFilter === "ALL") return;
    if (availableAlertKindFilters.includes(alertKindFilter)) return;
    setAlertKindFilter("ALL");
  }, [alertKindFilter, availableAlertKindFilters]);

  const closeDrilldown = useCallback(() => {
    setSidePanelMode("");
    setSelectedWeek("");
    setSelectedType("");
    setSelectedOnderwerp("");
    setSelectedDrillDateField("created");
    setSelectedDrillBasisLabel("Binnengekomen");
    setDrillIssues([]);
    setDrillOffset(0);
    setDrillHasNext(false);
  }, []);

  const closeSidePanel = useCallback(() => {
    if (sidePanelMode === "alerts" || sidePanelMode === "insights") {
      setSidePanelMode("");
      return;
    }
    closeDrilldown();
  }, [closeDrilldown, sidePanelMode]);

  const openAlertLogPanel = useCallback(() => {
    clearHasNewAlertLogEntry();
    setSidePanelMode("alerts");
  }, [clearHasNewAlertLogEntry]);

  const setInsightUrl = useCallback((insightId) => {
    if (typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      if (insightId) url.searchParams.set("insight", String(insightId));
      else url.searchParams.delete("insight");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // no-op
    }
  }, []);

  const openInsightLogPanel = useCallback((insightId = "") => {
    setSelectedInsightId(insightId ? String(insightId) : "");
    if (insightId) {
      setExpandedInsightIds((prev) => ({ ...prev, [insightId]: true }));
    }
    setSidePanelMode("insights");
    setInsightUrl(insightId);
  }, [setInsightUrl]);

  const flashToast = useCallback((message, kind = "success", ms = 3000) => {
    setSyncMessage(message);
    setSyncMessageKind(kind);
    if (ms > 0) setTimeout(() => setSyncMessage(""), ms);
  }, []);

  const applyDateRange = useCallback(({ months = 0, years = 0, days = 0 }) => {
    const end = new Date();
    const start = new Date(end);
    if (years) start.setFullYear(start.getFullYear() - years);
    if (months) start.setMonth(start.getMonth() - months);
    if (days) start.setDate(start.getDate() - days);
    const fromIso = isoDate(start);
    const toIso = isoDate(end);
    setDateFrom(fromIso);
    setDateTo(toIso);
    setDateFromUi(fmtDate(fromIso));
    setDateToUi(fmtDate(toIso));
  }, []);

  const resetFilters = useCallback((showToast = true) => {
    const { fromIso, toIso, fromLabel, toLabel } = getStandardDateRange();
    setDateFrom(fromIso);
    setDateTo(toIso);
    setDateFromUi(fromLabel);
    setDateToUi(toLabel);
    setRequestType("");
    setOnderwerp("");
    setPriority("");
    setAssignee("");
    setOrganization("");
    setServicedeskOnly(DEFAULT_SERVICEDESK_ONLY);
    if (showToast) flashToast("Filters en datumrange gereset (laatste maand)");
  }, [flashToast, getStandardDateRange]);

  const toggleTvMode = useCallback(() => {
    setIsTvMode((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(TV_MODE_STORAGE_KEY, next ? "1" : "0");
          const url = new URL(window.location.href);
          if (next) url.searchParams.set("tv", "1");
          else url.searchParams.delete("tv");
          window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
        } catch {
          // no-op
        }
      }
      return next;
    });
  }, []);

  const toggleTeamMemberDraft = useCallback((name) => {
    setTeamMembersDraft((prev) =>
      prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]
    );
  }, [setTeamMembersDraft]);

  const toggleOnderwerpDraft = useCallback((name) => {
    setOnderwerpenDraft((prev) =>
      prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]
    );
  }, [setOnderwerpenDraft]);

  const normalizedOnderwerpenSelection = useCallback((values) => {
    const available = Array.isArray(meta?.onderwerpen) ? meta.onderwerpen : [];
    if (!available.length) return Array.isArray(values) ? values : [];
    const availableMap = new Map(
      available.map((item) => {
        const text = String(item);
        return [text.toLowerCase(), text];
      })
    );
    return Array.from(
      new Set(
        (Array.isArray(values) ? values : [])
          .map((item) => availableMap.get(String(item).toLowerCase()) || null)
          .filter(Boolean)
      )
    );
  }, [meta]);

  const cancelTeamConfig = useCallback(() => {
    setTeamMembersDraft(Array.isArray(servicedeskConfig?.team_members) ? servicedeskConfig.team_members : []);
  }, [servicedeskConfig, setTeamMembersDraft]);

  const cancelOnderwerpConfig = useCallback(() => {
    setOnderwerpenDraft(normalizedOnderwerpenSelection(servicedeskConfig?.onderwerpen));
  }, [normalizedOnderwerpenSelection, servicedeskConfig, setOnderwerpenDraft]);

  const cancelAiInsightConfig = useCallback(() => {
    setAiInsightThresholdDraft(Number(servicedeskConfig?.ai_insight_threshold_pct || 75));
  }, [servicedeskConfig?.ai_insight_threshold_pct]);

  const zichtbareOnderwerpenDraft = useMemo(
    () => normalizedOnderwerpenSelection(onderwerpenDraft),
    [normalizedOnderwerpenSelection, onderwerpenDraft]
  );
  const onderwerpFilterOpties = useMemo(() => {
    const servicedeskOnderwerpen = normalizedOnderwerpenSelection(servicedeskConfig?.onderwerpen);
    return servicedeskOnderwerpen.length ? servicedeskOnderwerpen : normalizedOnderwerpenSelection(meta?.onderwerpen);
  }, [meta, normalizedOnderwerpenSelection, servicedeskConfig]);

  const teamConfigDirty = useMemo(() => {
    const base = Array.isArray(servicedeskConfig?.team_members) ? servicedeskConfig.team_members : [];
    return !sameStringSet(teamMembersDraft, base);
  }, [teamMembersDraft, servicedeskConfig]);

  const onderwerpConfigDirty = useMemo(() => {
    const base = normalizedOnderwerpenSelection(servicedeskConfig?.onderwerpen);
    return !sameStringSet(zichtbareOnderwerpenDraft, base);
  }, [normalizedOnderwerpenSelection, zichtbareOnderwerpenDraft, servicedeskConfig]);

  const onderwerpResetAvailable = useMemo(() => {
    return Boolean(servicedeskConfig?.onderwerpen_customized);
  }, [servicedeskConfig]);

  const aiInsightConfigDirty = useMemo(
    () => Number(aiInsightThresholdDraft) !== Number(servicedeskConfig?.ai_insight_threshold_pct || 75),
    [aiInsightThresholdDraft, servicedeskConfig?.ai_insight_threshold_pct]
  );

  useEffect(() => {
    if (!onderwerp) return;
    if (!onderwerpFilterOpties.includes(onderwerp)) {
      setOnderwerp("");
    }
  }, [onderwerp, onderwerpFilterOpties]);

  const saveTeamConfig = useCallback(async () => {
    if (!teamMembersDraft.length) {
      flashToast("Selecteer minimaal 1 servicedesk teamlid.", "error");
      return;
    }
    setTeamConfigSaving(true);
    try {
      const res = await fetch(`${API}/config/servicedesk`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team_members: teamMembersDraft,
          onderwerpen: onderwerpenDraft,
          ai_insight_threshold_pct: aiInsightThresholdDraft,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.detail || "Opslaan van teamleden mislukt.");
      }
      const updated = await res.json();
      applyServicedeskConfig(updated, normalizedOnderwerpenSelection);
      flashToast("Servicedesk teamleden opgeslagen.");
    } catch (err) {
      flashToast(err?.message || "Opslaan van teamleden mislukt.", "error");
    } finally {
      setTeamConfigSaving(false);
    }
  }, [aiInsightThresholdDraft, applyServicedeskConfig, flashToast, normalizedOnderwerpenSelection, teamMembersDraft, onderwerpenDraft]);

  const saveOnderwerpConfig = useCallback(async () => {
    const normalizedOnderwerpen = normalizedOnderwerpenSelection(onderwerpenDraft);
    if (!normalizedOnderwerpen.length) {
      flashToast("Selecteer minimaal 1 servicedesk onderwerp.", "error");
      return;
    }
    setOnderwerpConfigSaving(true);
    try {
      const res = await fetch(`${API}/config/servicedesk`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team_members: teamMembersDraft,
          onderwerpen: normalizedOnderwerpen,
          ai_insight_threshold_pct: aiInsightThresholdDraft,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.detail || "Opslaan van onderwerpen mislukt.");
      }
      const updated = await res.json();
      applyServicedeskConfig(updated, normalizedOnderwerpenSelection);
      flashToast("Servicedesk onderwerpen opgeslagen.");
    } catch (err) {
      flashToast(err?.message || "Opslaan van onderwerpen mislukt.", "error");
    } finally {
      setOnderwerpConfigSaving(false);
    }
  }, [aiInsightThresholdDraft, applyServicedeskConfig, flashToast, normalizedOnderwerpenSelection, onderwerpenDraft, teamMembersDraft]);

  const resetOnderwerpConfig = useCallback(async () => {
    const baseline = normalizedOnderwerpenSelection(servicedeskOnderwerpenBaseline);
    if (!baseline.length) return;
    setOnderwerpConfigSaving(true);
    try {
      const res = await fetch(`${API}/config/servicedesk`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team_members: teamMembersDraft,
          onderwerpen: baseline,
          ai_insight_threshold_pct: aiInsightThresholdDraft,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.detail || "Herstellen van onderwerpen mislukt.");
      }
      const updated = await res.json();
      applyServicedeskConfig(updated, normalizedOnderwerpenSelection);
      flashToast("Servicedesk onderwerpen hersteld.");
    } catch (err) {
      flashToast(err?.message || "Herstellen van onderwerpen mislukt.", "error");
    } finally {
      setOnderwerpConfigSaving(false);
    }
  }, [aiInsightThresholdDraft, applyServicedeskConfig, flashToast, normalizedOnderwerpenSelection, servicedeskOnderwerpenBaseline, teamMembersDraft]);

  const saveAiInsightConfig = useCallback(async () => {
    setOnderwerpConfigSaving(true);
    try {
      const res = await fetch(`${API}/config/servicedesk`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team_members: teamMembersDraft,
          onderwerpen: zichtbareOnderwerpenDraft,
          ai_insight_threshold_pct: aiInsightThresholdDraft,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.detail || "Opslaan van AI-threshold mislukt.");
      }
      const updated = await res.json();
      applyServicedeskConfig(updated, normalizedOnderwerpenSelection);
      await refreshLiveInsights();
      await refreshInsightLog();
      flashToast("AI-threshold opgeslagen.");
    } catch (err) {
      flashToast(err?.message || "Opslaan van AI-threshold mislukt.", "error");
    } finally {
      setOnderwerpConfigSaving(false);
    }
  }, [
    aiInsightThresholdDraft,
    applyServicedeskConfig,
    flashToast,
    normalizedOnderwerpenSelection,
    refreshInsightLog,
    refreshLiveInsights,
    teamMembersDraft,
    zichtbareOnderwerpenDraft,
  ]);

  const saveDashboardLayout = useCallback(() => {
    if (typeof window === "undefined") return;
    const serialized = JSON.stringify(dashboardLayout);
    window.localStorage.setItem(DASHBOARD_CONFIG_STORAGE_KEY, serialized);
    setLayoutSavedSnapshot(serialized);
    setIsLayoutEditing(false);
    flashToast("Dashboard layout opgeslagen");
  }, [dashboardLayout, flashToast]);

  const startLayoutEditing = useCallback(() => {
    setVacationEditMode(false);
    setIsLayoutEditing(true);
  }, []);

  const cancelLayoutEditing = useCallback(() => {
    try {
      const parsed = layoutSavedSnapshot ? JSON.parse(layoutSavedSnapshot) : createDefaultDashboardLayout();
      setDashboardLayout(normalizeDashboardLayout(parsed));
    } catch {
      setDashboardLayout(normalizeDashboardLayout(createDefaultDashboardLayout()));
    }
    setIsLayoutEditing(false);
    setCardDropHint(null);
    setKpiDropHint(null);
    dragStateRef.current = null;
  }, [layoutSavedSnapshot, normalizeDashboardLayout]);

  const resetLayoutAndClose = useCallback(() => {
    const next = normalizeDashboardLayout(createDefaultDashboardLayout());
    const serialized = JSON.stringify(next);
    setDashboardLayout(next);
    setLayoutSavedSnapshot(serialized);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DASHBOARD_CONFIG_STORAGE_KEY, serialized);
    }
    setIsLayoutEditing(false);
    setCardDropHint(null);
    setKpiDropHint(null);
    dragStateRef.current = null;
    flashToast("Layout hersteld naar beginwaarden");
  }, [flashToast, normalizeDashboardLayout]);

  const { liveAlerts, refreshLiveAlerts } = useLiveAlerts({
    onRefresh: async () => {
      await refreshAlertLogs();
    },
  });

  useEffect(() => {
    const seen = seenLiveAlertKeysRef.current;
    const newP1 = liveAlerts.priority1.filter((item) => {
      const key = `p1:${item.issue_key}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const newSlaWarning = liveAlerts.first_response_due_warning.filter((item) => {
      const key = `sla-warning:${item.issue_key}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const newSlaCritical = liveAlerts.first_response_due_critical.filter((item) => {
      const key = `sla-critical:${item.issue_key}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const newOverdue = liveAlerts.first_response_overdue.filter((item) => {
      const key = `sla-overdue:${item.issue_key}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const newTtrWarning = liveAlerts.time_to_resolution_warning.filter((item) => {
      const key = `ttr-warning:${item.issue_key}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const newTtrCritical = liveAlerts.time_to_resolution_critical.filter((item) => {
      const key = `ttr-critical:${item.issue_key}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const newTtrOverdue = liveAlerts.time_to_resolution_overdue.filter((item) => {
      const key = `ttr-overdue:${item.issue_key}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const hasNewTtrAlert = newTtrWarning.length || newTtrCritical.length || newTtrOverdue.length;

    if (hasNewTtrAlert) {
      setTtrAlertsCollapsed(false);
    }

    if (newP1.length) {
      flashToast(`ALERT P1: ${newP1[0].issue_key}${newP1.length > 1 ? ` +${newP1.length - 1}` : ""}`, "error", 9000);
    } else if (newTtrCritical.length) {
      flashToast(
        `ALERT INCIDENT TTR <60m: ${newTtrCritical[0].issue_key}${newTtrCritical.length > 1 ? ` +${newTtrCritical.length - 1}` : ""}`,
        "error",
        9000
      );
    } else if (newSlaCritical.length) {
      flashToast(
        `ALERT SLA <5m: ${newSlaCritical[0].issue_key}${newSlaCritical.length > 1 ? ` +${newSlaCritical.length - 1}` : ""}`,
        "error",
        9000
      );
    } else if (newTtrOverdue.length) {
      flashToast(
        `ALERT INCIDENT TTR VERLOPEN: ${newTtrOverdue[0].issue_key}${newTtrOverdue.length > 1 ? ` +${newTtrOverdue.length - 1}` : ""}`,
        "error",
        9000
      );
    } else if (newOverdue.length) {
      flashToast(`ALERT SLA VERLOPEN: ${newOverdue[0].issue_key}${newOverdue.length > 1 ? ` +${newOverdue.length - 1}` : ""}`, "error", 9000);
    } else if (newTtrWarning.length) {
      flashToast(
        `ALERT INCIDENT TTR <24u: ${newTtrWarning[0].issue_key}${newTtrWarning.length > 1 ? ` +${newTtrWarning.length - 1}` : ""}`,
        "error",
        9000
      );
    } else if (newSlaWarning.length) {
      flashToast(
        `ALERT SLA <30m: ${newSlaWarning[0].issue_key}${newSlaWarning.length > 1 ? ` +${newSlaWarning.length - 1}` : ""}`,
        "error",
        9000
      );
    }
  }, [flashToast, liveAlerts]);

  const toggleAlertGroup = useCallback((groupKey) => {
    setExpandedAlertGroups((prev) => ({
      ...prev,
      [groupKey]: !prev[groupKey],
    }));
  }, []);

  const clearAlertLogs = useCallback(async () => {
    setClearAlertLogsBusy(true);
    try {
      const params = new URLSearchParams();
      params.set("servicedesk_only", "true");
      const response = await fetch(`${API}/alerts/logs/clear?${params.toString()}`, {
        method: "POST",
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.detail || "Alertlog legen mislukt.");
      }
      setExpandedAlertGroups({});
      await refreshAlertLogs();
      flashToast("Alertlog geleegd");
    } catch (err) {
      flashToast(err?.message || "Alertlog legen mislukt.", "error");
    } finally {
      setClearAlertLogsBusy(false);
    }
  }, [flashToast, refreshAlertLogs]);

  const startVacationCreate = useCallback(() => {
    const todayIso = isoDate(new Date());
    const nextForm = {
      id: null,
      memberName: servicedeskTeamMembers[0] || "",
      startDate: todayIso,
      endDate: todayIso,
    };
    setVacationForm(nextForm);
    setVacationInitialForm(nextForm);
    setVacationStartUi(fmtDate(todayIso));
    setVacationEndUi(fmtDate(todayIso));
    setVacationEditMode(true);
  }, [servicedeskTeamMembers]);

  const startVacationEdit = useCallback((vacation) => {
    if (!vacation) return;
    const startDate = vacation.start_date || "";
    const endDate = vacation.end_date || "";
    const nextForm = {
      id: vacation.id,
      memberName: vacation.member_name || VACATION_TEAM_MEMBERS[0],
      startDate,
      endDate,
    };
    setVacationForm(nextForm);
    setVacationInitialForm(nextForm);
    setVacationStartUi(fmtDate(startDate));
    setVacationEndUi(fmtDate(endDate));
    setVacationEditMode(true);
  }, []);

  const cancelVacationEdit = useCallback(() => {
    setVacationEditMode(false);
    setVacationSaving(false);
    const resetForm = {
      id: null,
      memberName: servicedeskTeamMembers[0] || "",
      startDate: "",
      endDate: "",
    };
    setVacationForm(resetForm);
    setVacationInitialForm(resetForm);
    setVacationStartUi("");
    setVacationEndUi("");
  }, [servicedeskTeamMembers]);

  const applyVacationStartDate = useCallback((nextStartDate) => {
    const iso = String(nextStartDate || "").trim();
    if (!iso) return;
    const prevStart = String(vacationForm.startDate || "").trim();
    const prevEnd = String(vacationForm.endDate || "").trim();
    const shouldSyncEnd = !prevEnd || prevEnd === prevStart || prevEnd < iso;
    setVacationForm((prev) => ({
      ...prev,
      startDate: iso,
      endDate: shouldSyncEnd ? iso : prev.endDate,
    }));
    setVacationStartUi(fmtDate(iso));
    if (shouldSyncEnd) setVacationEndUi(fmtDate(iso));
  }, [vacationForm.startDate, vacationForm.endDate]);

  const vacationFormDirty = useMemo(() => {
    const current = {
      id: vacationForm?.id ?? null,
      memberName: String(vacationForm?.memberName || "").trim(),
      startDate: String(vacationForm?.startDate || "").trim(),
      endDate: String(vacationForm?.endDate || "").trim(),
    };
    const initial = {
      id: vacationInitialForm?.id ?? null,
      memberName: String(vacationInitialForm?.memberName || "").trim(),
      startDate: String(vacationInitialForm?.startDate || "").trim(),
      endDate: String(vacationInitialForm?.endDate || "").trim(),
    };
    return (
      current.id !== initial.id ||
      current.memberName !== initial.memberName ||
      current.startDate !== initial.startDate ||
      current.endDate !== initial.endDate
    );
  }, [vacationForm, vacationInitialForm]);

  const saveVacation = useCallback(async () => {
    const memberName = String(vacationForm.memberName || "").trim();
    const startDate = String(vacationForm.startDate || "").trim();
    const endDate = String(vacationForm.endDate || "").trim();
    const todayIso = isoDate(new Date());
    if (!memberName || !startDate || !endDate) {
      flashToast("Vul teamlid, startdatum en einddatum in.", "error");
      return;
    }
    if (startDate < todayIso) {
      flashToast("Startdatum moet vandaag of later zijn.", "error");
      return;
    }
    if (endDate < startDate) {
      flashToast("Einddatum mag niet voor de startdatum liggen.", "error");
      return;
    }

    setVacationSaving(true);
    try {
      const payload = {
        member_name: memberName,
        start_date: startDate,
        end_date: endDate,
      };
      const isEdit = !!vacationForm.id;
      const response = await fetch(
        isEdit ? `${API}/vacations/${vacationForm.id}` : `${API}/vacations`,
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.detail || "Vakantie opslaan mislukt.");
      }
      await refreshVacations();
      flashToast("Vakantie opgeslagen");
      cancelVacationEdit();
    } catch (err) {
      flashToast(err?.message || "Vakantie opslaan mislukt.", "error");
    } finally {
      setVacationSaving(false);
    }
  }, [vacationForm, flashToast, refreshVacations, cancelVacationEdit]);

  const removeVacation = useCallback(async (vacationId) => {
    if (!vacationId) return;
    setVacationSaving(true);
    try {
      const response = await fetch(`${API}/vacations/${vacationId}`, { method: "DELETE" });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.detail || "Vakantie verwijderen mislukt.");
      }
      await refreshVacations();
      flashToast("Vakantie verwijderd");
      if (vacationForm.id === vacationId) {
        cancelVacationEdit();
      }
    } catch (err) {
      flashToast(err?.message || "Vakantie verwijderen mislukt.", "error");
    } finally {
      setVacationSaving(false);
    }
  }, [flashToast, refreshVacations, vacationForm.id, cancelVacationEdit]);

  const triggerSync = useCallback(async ({ silent = false } = {}) => {
    setSyncLoading(true);
    if (!silent) setSyncMessage("");

    try {
      await fetch(`${API}/sync`, { method: "POST" });

      let last = null;
      // Poll status for up to ~60s
      for (let i = 0; i < 20; i++) {
        last = await refreshSyncStatus();
        if (!last?.running) break;
        await new Promise((res) => setTimeout(res, 3000));
      }

      await refreshDashboard();
      await refreshLiveInsights();
      await refreshInsightLog();

      if (!silent) {
        const upserts = last?.last_result?.upserts;
        setSyncMessage(`Sync klaar${upserts != null ? `: ${upserts} tickets geüpdatet` : ""}`);
        setSyncMessageKind("success");
        setTimeout(() => setSyncMessage(""), 5000);
      }
    } catch (e) {
      if (!silent) {
        setSyncMessage("Sync mislukt (zie status/error)");
        setSyncMessageKind("error");
        setTimeout(() => setSyncMessage(""), 8000);
      }
      throw e;
    } finally {
      setSyncLoading(false);
    }
  }, [refreshInsightLog, refreshLiveInsights, refreshSyncStatus, refreshDashboard]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.title = "Dashboard Servicedesk Planningsagenda";
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowStartupSkeleton(false), 1800);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let next = false;
    try {
      const params = new URLSearchParams(window.location.search);
      const queryTv = params.get("tv");
      if (queryTv != null) {
        next = ["1", "true", "yes", "on"].includes(queryTv.toLowerCase());
      } else {
        next = window.localStorage.getItem(TV_MODE_STORAGE_KEY) === "1";
      }
    } catch {
      next = false;
    }
    setIsTvMode(next);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.tvMode = isTvMode ? "1" : "0";
    return () => {
      delete document.documentElement.dataset.tvMode;
    };
  }, [isTvMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(DASHBOARD_CONFIG_STORAGE_KEY);
      if (!raw) {
        const normalizedDefault = normalizeDashboardLayout(createDefaultDashboardLayout());
        setDashboardLayout(normalizedDefault);
        setLayoutSavedSnapshot(JSON.stringify(normalizedDefault));
        return;
      }
      const normalizedStored = normalizeDashboardLayout(JSON.parse(raw));
      setDashboardLayout(normalizedStored);
      setLayoutSavedSnapshot(JSON.stringify(normalizedStored));
    } catch {
      const normalizedDefault = normalizeDashboardLayout(createDefaultDashboardLayout());
      setDashboardLayout(normalizedDefault);
      setLayoutSavedSnapshot(JSON.stringify(normalizedDefault));
    }
  }, [normalizeDashboardLayout]);

  useEffect(() => {
    if (sidePanelMode === "alerts") {
      clearHasNewAlertLogEntry();
    }
  }, [sidePanelMode, clearHasNewAlertLogEntry]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const params = new URLSearchParams(window.location.search);
      const insightId = params.get("insight");
      if (insightId) {
        setSelectedInsightId(insightId);
        setSidePanelMode("insights");
      }
    } catch {
      // no-op
    }
  }, []);

  useEffect(() => {
    if (sidePanelMode === "insights") return;
    if (!selectedInsightId) return;
    setSelectedInsightId("");
    setInsightUrl("");
  }, [selectedInsightId, setInsightUrl, sidePanelMode]);

  const faviconSignal = useMemo(() => {
    const hasP1 = Array.isArray(liveAlerts?.priority1) && liveAlerts.priority1.length > 0;
    const hasSlaWarning = Array.isArray(liveAlerts?.first_response_due_warning) && liveAlerts.first_response_due_warning.length > 0;
    const hasSlaCritical = Array.isArray(liveAlerts?.first_response_due_critical) && liveAlerts.first_response_due_critical.length > 0;
    const hasOverdue = Array.isArray(liveAlerts?.first_response_overdue) && liveAlerts.first_response_overdue.length > 0;
    const hasTtrWarning = Array.isArray(liveAlerts?.time_to_resolution_warning) && liveAlerts.time_to_resolution_warning.length > 0;
    const hasTtrCritical = Array.isArray(liveAlerts?.time_to_resolution_critical) && liveAlerts.time_to_resolution_critical.length > 0;
    const hasTtrOverdue = Array.isArray(liveAlerts?.time_to_resolution_overdue) && liveAlerts.time_to_resolution_overdue.length > 0;
    const hasSla = hasSlaWarning || hasSlaCritical || hasOverdue;
    const hasTtr = hasTtrWarning || hasTtrCritical || hasTtrOverdue;
    const showTtrSignal = hasTtr && !ttrAlertsCollapsed;
    if (!hasP1 && !hasSla && !showTtrSignal) {
      return {
        href: "/favicon.ico",
        pulseHref: "/favicon.ico",
        shouldPulse: false,
      };
    }
    const color =
      hasP1 || hasSlaCritical || hasOverdue
        ? "#dc2626"
        : showTtrSignal && hasTtrOverdue
          ? "#1e3a8a"
          : showTtrSignal && hasTtrCritical
            ? "#2563eb"
          : showTtrSignal && hasTtrWarning
              ? "#60a5fa"
              : "#f59e0b";
    return {
      href: alertFaviconDataUri(color, false),
      pulseHref: alertFaviconDataUri(color, true),
      shouldPulse: true,
    };
  }, [liveAlerts, ttrAlertsCollapsed]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    let faviconLink = document.querySelector("link[rel='icon']");
    if (!faviconLink) {
      faviconLink = document.createElement("link");
      faviconLink.setAttribute("rel", "icon");
      document.head.appendChild(faviconLink);
    }
    faviconLink.setAttribute("href", faviconSignal.href);
    if (!faviconSignal.shouldPulse) return undefined;

    let pulsed = false;
    const t = window.setInterval(() => {
      pulsed = !pulsed;
      faviconLink.setAttribute("href", pulsed ? faviconSignal.pulseHref : faviconSignal.href);
    }, 1400);

    return () => {
      window.clearInterval(t);
      faviconLink.setAttribute("href", faviconSignal.href);
    };
  }, [faviconSignal.href, faviconSignal.pulseHref, faviconSignal.shouldPulse]);

  useEffect(() => {
    if (backendAutoSyncEnabled) return undefined;
    const t = setInterval(() => {
      if (syncBusy) return;
      triggerSync({ silent: true }).catch(() => {});
    }, AUTO_SYNC_INTERVAL_MS);
    return () => clearInterval(t);
  }, [backendAutoSyncEnabled, syncBusy, triggerSync]);

  useEffect(() => {
    if (backendAutoSyncEnabled) return;
    if (!syncStatus || syncBusy) return;
    const lastSyncRaw = syncStatus.last_sync;
    const lastSync = lastSyncRaw ? new Date(lastSyncRaw) : null;
    const now = Date.now();
    const isStale =
      !lastSync || Number.isNaN(lastSync.getTime()) || now - lastSync.getTime() > STALE_SYNC_THRESHOLD_MS;
    if (!isStale) return;

    // Throttle automatic retries when sync fails or takes long.
    if (now - autoSyncAttemptRef.current < AUTO_SYNC_RETRY_THROTTLE_MS) return;
    autoSyncAttemptRef.current = now;
    triggerSync({ silent: true }).catch(() => {});
  }, [backendAutoSyncEnabled, syncStatus, syncBusy, triggerSync]);

  useEffect(() => {
    if (typeof window === "undefined" || AUTO_RESET_IDLE_MS <= 0) return undefined;

    const clearTimer = () => {
      if (autoResetTimerRef.current) {
        window.clearTimeout(autoResetTimerRef.current);
        autoResetTimerRef.current = null;
      }
    };

    const scheduleTimer = () => {
      clearTimer();
      autoResetTimerRef.current = window.setTimeout(() => {
        if (filtersAreDefault) {
          scheduleTimer();
          return;
        }
        if (vacationEditMode || isLayoutEditing || hotkeysOpen || sidePanelOpen || filtersOpen) {
          scheduleTimer();
          return;
        }
        if (isTextEntryTarget(document.activeElement)) {
          scheduleTimer();
          return;
        }
        resetFilters(false);
        flashToast("Auto-reset: terug naar standaardweergave", "success");
        scheduleTimer();
      }, AUTO_RESET_IDLE_MS);
    };

    const onActivity = () => scheduleTimer();
    scheduleTimer();
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    window.addEventListener("wheel", onActivity, { passive: true });
    window.addEventListener("touchstart", onActivity, { passive: true });

    return () => {
      clearTimer();
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("wheel", onActivity);
      window.removeEventListener("touchstart", onActivity);
    };
  }, [filtersAreDefault, vacationEditMode, isLayoutEditing, hotkeysOpen, sidePanelOpen, filtersOpen, resetFilters, flashToast]);

  useEffect(() => {
    if (!vacationEditMode) return;
    function onBeforeUnload(e) {
      e.preventDefault();
      e.returnValue = "";
      return "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [vacationEditMode]);

  useEffect(() => {
    function onKeyDown(e) {
      if (hotkeysOpen) return;
      const key = e.key?.toLowerCase();
      if (vacationEditMode && key === "r" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        flashToast("Vakantiekaart staat in edit-modus. Gebruik Opslaan of Annuleren.", "error");
        return;
      }
      if (isTextEntryTarget(e.target)) return;
      if (vacationEditMode) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!["m", "j", "r", "s", "f"].includes(key)) return;
      e.preventDefault();
      const active = document.activeElement;
      if (active && typeof active.blur === "function") active.blur();
      if (key === "m") {
        applyDateRange({ months: 1 });
        flashToast("Datumselectie: laatste maand");
      } else if (key === "j") {
        applyDateRange({ years: 1 });
        flashToast("Datumselectie: laatste jaar");
      } else if (key === "r") {
        resetFilters(true);
      } else if (key === "s") {
        if (!syncBusy) {
          triggerSync();
          flashToast("Sync gestart");
        } else {
          flashToast("Sync is al bezig", "error");
        }
      } else if (key === "f") {
        setFiltersOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [syncBusy, hotkeysOpen, vacationEditMode, applyDateRange, flashToast, resetFilters, triggerSync]);

  useEffect(() => {
    if (!hotkeysOpen) return;
    function onKeyDown(e) {
      if (isTextEntryTarget(e.target)) return;
      if (e.key === "Escape") setHotkeysOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hotkeysOpen]);

  useEffect(() => {
    if (!hotkeysOpen) return;
    function onPointerDown(e) {
      const target = e.target;
      if (hotkeysPopupRef.current?.contains(target)) return;
      if (hotkeysButtonRef.current?.contains(target)) return;
      setHotkeysOpen(false);
    }
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [hotkeysOpen]);

  useEffect(() => {
    if (!sidePanelOpen) return;
    function onKeyDown(e) {
      if (isTextEntryTarget(e.target)) return;
      if (e.key === "Escape") closeSidePanel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sidePanelOpen, closeSidePanel]);

  useEffect(() => {
    if (!expandedCard) return;
    function onKeyDown(e) {
      if (isTextEntryTarget(e.target)) return;
      if (e.key === "Escape") setExpandedCard("");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expandedCard]);

  useEffect(() => {
    if (!filtersOpen) return;
    function onKeyDown(e) {
      if (isTextEntryTarget(e.target)) return;
      if (e.key === "Escape") setFiltersOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filtersOpen]);

  useEffect(() => {
    if (!sidePanelOpen) return;
    const t = setTimeout(() => {
      drillCloseRef.current?.focus?.();
    }, 0);
    return () => clearTimeout(t);
  }, [sidePanelOpen]);

  useEffect(() => {
    if (!sidePanelOpen) return;
    function onKeyDown(e) {
      if (e.key !== "Tab") return;
      const panel = drillPanelRef.current;
      if (!panel) return;
      if (!panel.contains(document.activeElement)) return;
      const focusables = panel.querySelectorAll(
        'a[href], button:not([disabled]), select:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sidePanelOpen]);

  // Hide a partial first week (when dateFrom is not Monday) to avoid misleading empty first points.
  const weeks = useMemo(() => {
    const fullWeeks = buildWeekStartsFromRange(dateFrom, dateTo);
    return trimLeadingPartialWeek(fullWeeks, dateFrom);
  }, [dateFrom, dateTo]);
  const weeksOnderwerp = weeks;
  const trailingPartialWeekIndex = useMemo(() => {
    if (!weeks.length || !dateTo) return -1;
    return isCurrentPartialWeek(dateTo) ? weeks.length - 1 : -1;
  }, [weeks, dateTo]);
  const weeklyLabels = useCallback(
    (sourceWeeks) =>
      sourceWeeks.map((w, idx) => {
        const label = fmtDate(w);
        return idx === trailingPartialWeekIndex ? `${label} *` : label;
      }),
    [trailingPartialWeekIndex]
  );
  const weeklyScopeHint = useMemo(() => {
    if (trailingPartialWeekIndex < 0 || !weeks[trailingPartialWeekIndex]) return "";
    return `* Laatste week is nog onvolledig (${fmtDate(weeks[trailingPartialWeekIndex])}) en kan lager uitvallen.`;
  }, [trailingPartialWeekIndex, weeks]);
  const weeklyPartialCardKeys = useMemo(
    () => new Set(["volume", "onderwerp", "inflowVsClosed", "incidentResolution", "firstResponseAll", "organizationWeekly"]),
    []
  );
  const [slowChartCards, setSlowChartCards] = useState({});
  const slowChartTimersRef = useRef(new Map());
  const clearSlowChartTimer = useCallback((cardKey) => {
    const timers = slowChartTimersRef.current.get(cardKey);
    if (timers?.showTimer) {
      window.clearTimeout(timers.showTimer);
    }
    if (timers?.hideTimer) {
      window.clearTimeout(timers.hideTimer);
    }
    if (timers) {
      slowChartTimersRef.current.delete(cardKey);
    }
  }, []);
  const armSlowChart = useCallback((cardKey) => {
    clearSlowChartTimer(cardKey);
    setSlowChartCards((prev) => (prev?.[cardKey] ? { ...prev, [cardKey]: false } : prev));
    const showTimer = window.setTimeout(() => {
      setSlowChartCards((prev) => ({ ...prev, [cardKey]: true }));
    }, CHART_RENDER_TIMEOUT_MS);
    const hideTimer = window.setTimeout(() => {
      setSlowChartCards((prev) => (prev?.[cardKey] ? { ...prev, [cardKey]: false } : prev));
      slowChartTimersRef.current.delete(cardKey);
    }, CHART_RENDER_OVERLAY_MAX_MS);
    slowChartTimersRef.current.set(cardKey, { showTimer, hideTimer });
  }, [clearSlowChartTimer]);
  const markChartRendered = useCallback((cardKey) => {
    clearSlowChartTimer(cardKey);
    setSlowChartCards((prev) => (prev?.[cardKey] ? { ...prev, [cardKey]: false } : prev));
  }, [clearSlowChartTimer]);
  const releaseCadencePlugin = useMemo(
    () => ({ weeks, partialWeekIndex: trailingPartialWeekIndex }),
    [weeks, trailingPartialWeekIndex]
  );
  const releaseCadenceOnderwerpPlugin = useMemo(
    () => ({ weeks: weeksOnderwerp, partialWeekIndex: trailingPartialWeekIndex }),
    [weeksOnderwerp, trailingPartialWeekIndex]
  );
  const fullWeekInfo = useMemo(() => {
    const currentWeek = weekStartIsoFromDate();
    const indices = weeks
      .map((w, idx) => (w < currentWeek ? idx : -1))
      .filter((idx) => idx >= 0);
    const lastIndex = indices.length ? indices[indices.length - 1] : -1;
    const prevIndex = indices.length > 1 ? indices[indices.length - 2] : -1;
    const periodFrom = indices.length ? fmtDate(weeks[indices[0]]) : "—";
    const periodTo = indices.length ? fmtDate(weeks[lastIndex]) : "—";
    return {
      indices,
      lastIndex,
      prevIndex,
      periodLabel: `${periodFrom} t/m ${periodTo}`,
      count: indices.length,
    };
  }, [weeks]);

  const series = useMemo(() => {
    const types = requestType ? [requestType] : meta.request_types;
    const base = types.map((t) => ({
      label: t,
      data: weeks.map((w) => {
        const row = volume.find((v) => v.request_type === t && v.week.slice(0, 10) === w);
        return row ? row.tickets : 0;
      }),
    }));
    if (requestType) return base;
    const total = {
      label: "Totaal",
      data: weeks.map((w) =>
        types.reduce((sum, t) => {
          const row = volume.find((v) => v.request_type === t && v.week.slice(0, 10) === w);
          return sum + (row ? row.tickets : 0);
        }, 0)
      ),
    };
    return [...base, total];
  }, [weeks, volume, meta.request_types, requestType]);

  const onderwerpSeries = useMemo(() => {
    const data = Array.isArray(onderwerpVolume) ? onderwerpVolume : [];
    const subjects = onderwerp ? [onderwerp] : onderwerpFilterOpties;
    const base = subjects.map((o) => ({
      label: o,
      data: weeksOnderwerp.map((w) => {
        const row = data.find((v) => v.onderwerp === o && v.week.slice(0, 10) === w);
        return row ? row.tickets : 0;
      }),
    }));
    if (onderwerp) return base;

    return base
      .map((s) => ({ ...s, total: s.data.reduce((sum, n) => sum + n, 0) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .map(({ total, ...rest }) => rest);
  }, [weeksOnderwerp, onderwerpVolume, onderwerp, onderwerpFilterOpties]);

  const typeColor = useCallback((label) => {
    const key = String(label || "").toLowerCase();
    return TYPE_COLORS[key] || "#6b7280";
  }, []);

  const lineData = useMemo(
    () => {
      const labels = weeklyLabels(weeks);
      const datasets = series.map((s) => ({
        label: s.label,
        data: s.data,
        tension: 0.2,
        borderColor: typeColor(s.label),
        backgroundColor: typeColor(s.label),
        pointBackgroundColor: typeColor(s.label),
        pointBorderColor: typeColor(s.label),
        borderDash: isTotalLabel(s.label) ? [6, 4] : undefined,
      }));

      const currentWeek = weekStartIsoFromDate();
      const totalSeries = series.find((s) => isTotalLabel(s.label));
      if (totalSeries && !requestType) {
        const valuesForMedian = totalSeries.data
          .map((v, i) => (weeks[i] === currentWeek ? null : v))
          .filter((v) => v != null);
        const med = median(valuesForMedian);
        if (med != null) {
          datasets.push({
            label: "Mediaan totaal aantal tickets",
            data: weeks.map((w) => (w === currentWeek ? null : med)),
            tension: 0,
            borderColor: "#c62828",
            backgroundColor: "#c62828",
            borderDash: [4, 4],
            pointRadius: 0,
            pointHitRadius: 0,
          });
        }
      }

      if (requestType && series[0]) {
        const typeSeries = series[0];
        const valuesForMedian = typeSeries.data
          .map((v, i) => (weeks[i] === currentWeek ? null : v))
          .filter((v) => v != null);
        const med = median(valuesForMedian);
        if (med != null) {
          datasets.push({
            label: `Mediaan ${typeSeries.label}`,
            data: weeks.map((w) => (w === currentWeek ? null : med)),
            tension: 0,
            borderColor: "#c62828",
            backgroundColor: "#c62828",
            borderDash: [4, 4],
            pointRadius: 0,
            pointHitRadius: 0,
          });
        }
      }

      return { labels, datasets };
    },
    [weeks, weeklyLabels, series, requestType, typeColor]
  );

  const onderwerpLineData = useMemo(
    () => {
      const datasets = onderwerpSeries.map((s, i) => ({
        label: s.label,
        data: s.data,
        tension: 0.2,
        borderColor: uniqueChartColor(i, onderwerpSeries.length),
        backgroundColor: uniqueChartColor(i, onderwerpSeries.length),
        pointBackgroundColor: uniqueChartColor(i, onderwerpSeries.length),
        pointBorderColor: uniqueChartColor(i, onderwerpSeries.length),
      }));

      // When a specific onderwerp filter is active, add a median guide line for that onderwerp.
      if (onderwerp && onderwerpSeries[0]) {
        const currentWeek = weekStartIsoFromDate();
        const valuesForMedian = onderwerpSeries[0].data
          .map((v, i) => (weeksOnderwerp[i] === currentWeek ? null : v))
          .filter((v) => v != null);
        const med = median(valuesForMedian);
        if (med != null) {
          datasets.push({
            label: `Mediaan ${onderwerpSeries[0].label}`,
            data: weeksOnderwerp.map((w) => (w === currentWeek ? null : med)),
            tension: 0,
            borderColor: "#c62828",
            backgroundColor: "#c62828",
            borderDash: [4, 4],
            pointRadius: 0,
            pointHitRadius: 0,
          });
        }
      }

      return { labels: weeklyLabels(weeksOnderwerp), datasets };
    },
    [weeksOnderwerp, weeklyLabels, onderwerpSeries, onderwerp]
  );

  const priorityColors = useMemo(
    () => priorityVolume.map((_, i) => uniqueChartColor(i, priorityVolume.length)),
    [priorityVolume]
  );

  const priorityBarData = useMemo(
    () => ({
      labels: priorityVolume.map((x) => x.priority),
      datasets: [
        {
          label: "Totaal tickets per priority",
          data: priorityVolume.map((x) => x.tickets),
          backgroundColor: priorityColors,
          borderColor: priorityColors,
        },
      ],
    }),
    [priorityVolume, priorityColors]
  );

  const assigneeTopVolume = useMemo(() => {
    const data = Array.isArray(assigneeVolume) ? assigneeVolume : [];
    const allowed = Array.isArray(servicedeskConfig?.team_members) ? servicedeskConfig.team_members : [];
    const filtered = servicedeskOnly && allowed.length ? data.filter((row) => allowed.includes(row?.assignee)) : data;
    return filtered.slice(0, 5);
  }, [assigneeVolume, servicedeskConfig, servicedeskOnly]);

  const assigneeColors = useMemo(
    () => assigneeTopVolume.map((_, i) => uniqueChartColor(i, assigneeTopVolume.length)),
    [assigneeTopVolume]
  );

  const assigneeBarData = useMemo(
    () => ({
      labels: assigneeTopVolume.map((x) => x.assignee),
      datasets: [
        {
          label: "Totaal tickets per assignee",
          data: assigneeTopVolume.map((x) => x.tickets),
          backgroundColor: assigneeColors,
          borderColor: assigneeColors,
        },
      ],
    }),
    [assigneeTopVolume, assigneeColors]
  );

  const barData = useMemo(
    () => ({
      labels: p90.map((x) => `${x.request_type} (n=${x.n || 0})`),
      datasets: [
        {
          label: "p50 (uren)",
          data: p90.map((x) => x.p50_hours),
          backgroundColor: "rgba(59, 130, 246, 0.55)",
          borderColor: "rgba(59, 130, 246, 0.95)",
        },
        {
          label: "p75 (uren)",
          data: p90.map((x) => x.p75_hours),
          backgroundColor: "rgba(245, 158, 11, 0.6)",
          borderColor: "rgba(245, 158, 11, 0.95)",
        },
        {
          label: "p90 (uren)",
          data: p90.map((x) => x.p90_hours),
          backgroundColor: "rgba(220, 38, 38, 0.65)",
          borderColor: "rgba(220, 38, 38, 0.98)",
        },
      ],
    }),
    [p90]
  );

  const inflowVsClosedLineData = useMemo(() => {
    const rows = Array.isArray(inflowVsClosedWeekly) ? inflowVsClosedWeekly : [];
    const labels = weeklyLabels(weeks);
    const incomingData = weeks.map((w) => {
      const row = rows.find((x) => String(x?.week || "").slice(0, 10) === w);
      return row?.incoming_count != null ? Number(row.incoming_count) : 0;
    });
    const closedData = weeks.map((w) => {
      const row = rows.find((x) => String(x?.week || "").slice(0, 10) === w);
      return row?.closed_count != null ? Number(row.closed_count) : 0;
    });
    return {
      labels,
      datasets: [
        {
          label: "Binnengekomen",
          data: incomingData,
          tension: 0.2,
          borderColor: "#1565c0",
          backgroundColor: "#1565c0",
          pointBackgroundColor: "#1565c0",
          pointBorderColor: "#1565c0",
        },
        {
          label: "Afgesloten",
          data: closedData,
          tension: 0.2,
          borderColor: "#2e7d32",
          backgroundColor: "#2e7d32",
          pointBackgroundColor: "#2e7d32",
          pointBorderColor: "#2e7d32",
        },
      ],
    };
  }, [inflowVsClosedWeekly, weeks, weeklyLabels]);

  const incidentResolutionLineData = useMemo(() => {
    const rows = Array.isArray(incidentResolutionWeekly) ? incidentResolutionWeekly : [];
    const labels = weeklyLabels(weeks);
    const allTypes = (Array.isArray(meta.request_types) ? meta.request_types : []).filter(Boolean);
    const typeSetFromRows = Array.from(
      new Set(rows.map((x) => String(x?.request_type || "").trim()).filter(Boolean))
    );
    const sourceTypes = allTypes.length ? allTypes : typeSetFromRows;
    const types = sourceTypes.filter((typeLabel) => String(typeLabel || "").trim().toLowerCase() === "incident");
    const datasets = types.flatMap((typeLabel) => {
      const actualData = weeks.map((w) => {
        const row = rows.find(
          (x) =>
            String(x?.week || "").slice(0, 10) === w &&
            String(x?.request_type || "") === String(typeLabel)
        );
        return row?.avg_hours != null ? Number(row.avg_hours) : null;
      });
      const slaData = weeks.map((w) => {
        const row = rows.find(
          (x) =>
            String(x?.week || "").slice(0, 10) === w &&
            String(x?.request_type || "") === String(typeLabel)
        );
        return row?.sla_avg_hours != null ? Number(row.sla_avg_hours) : null;
      });
      const series = [
        {
          label: `${typeLabel} werkelijk`,
          data: actualData,
          tension: 0.2,
          borderColor: typeColor(typeLabel),
          backgroundColor: typeColor(typeLabel),
          pointBackgroundColor: typeColor(typeLabel),
          pointBorderColor: typeColor(typeLabel),
        },
        {
          label: `${typeLabel} SLA-doel`,
          data: slaData,
          tension: 0.2,
          borderColor: "#2563eb",
          backgroundColor: "#2563eb",
          pointBackgroundColor: "#ffffff",
          pointBorderColor: "#2563eb",
          borderDash: [6, 4],
          pointRadius: 3,
          pointHoverRadius: 4,
        },
      ];
      return series.filter((dataset) => dataset.data.some((value) => value != null));
    });
    return {
      labels,
      datasets,
    };
  }, [incidentResolutionWeekly, weeks, weeklyLabels, meta.request_types, typeColor]);

  const firstResponseLineData = useMemo(() => {
    const rows = Array.isArray(firstResponseWeekly) ? firstResponseWeekly : [];
    const labels = weeklyLabels(weeks);
    const avgData = weeks.map((w) => {
      const row = rows.find((x) => String(x?.week || "").slice(0, 10) === w);
      return row?.avg_hours != null ? Number(row.avg_hours) : null;
    });
    const medianData = weeks.map((w) => {
      const row = rows.find((x) => String(x?.week || "").slice(0, 10) === w);
      if (row?.median_hours != null) return Number(row.median_hours);
      return row?.p50_hours != null ? Number(row.p50_hours) : null;
    });
    return {
      labels,
      datasets: [
        {
          label: "Gemiddelde TTFR (uren)",
          data: avgData,
          tension: 0.2,
          borderColor: "#1565c0",
          backgroundColor: "#1565c0",
          pointBackgroundColor: "#1565c0",
          pointBorderColor: "#1565c0",
        },
        {
          label: "Mediaan TTFR (uren)",
          data: medianData,
          tension: 0.2,
          borderColor: "#00897b",
          backgroundColor: "#00897b",
          pointBackgroundColor: "#00897b",
          pointBorderColor: "#00897b",
          borderDash: [6, 4],
        },
      ],
    };
  }, [firstResponseWeekly, weeks, weeklyLabels]);

  const organizationBarData = useMemo(() => {
    const rows = Array.isArray(organizationVolume) ? organizationVolume : [];
    const labels = weeklyLabels(weeks);
    const totalsByOrganization = new Map();
    rows.forEach((row) => {
      const org = String(row?.organization || "");
      if (!org) return;
      const cur = totalsByOrganization.get(org) || 0;
      totalsByOrganization.set(org, cur + (Number(row?.tickets) || 0));
    });
    const topOrganizations = Array.from(totalsByOrganization.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([org]) => org);
    return {
      labels,
      datasets: topOrganizations.map((org, index) => ({
        label: org,
        data: weeks.map((w) => {
          const row = rows.find(
            (x) => String(x?.week || "").slice(0, 10) === w && String(x?.organization || "") === org
          );
          return row ? Number(row.tickets) : 0;
        }),
        backgroundColor: uniqueChartColor(index, topOrganizations.length, 68, 45),
        borderColor: uniqueChartColor(index, topOrganizations.length, 68, 35),
      })),
    };
  }, [organizationVolume, weeks, weeklyLabels]);

  useEffect(() => {
    const cards = [
      ["volume", hasDataPoints(lineData)],
      ["onderwerp", hasDataPoints(onderwerpLineData)],
      ["inflowVsClosed", hasDataPoints(inflowVsClosedLineData)],
      ["incidentResolution", hasDataPoints(incidentResolutionLineData)],
      ["firstResponseAll", hasDataPoints(firstResponseLineData)],
      ["organizationWeekly", hasDataPoints(organizationBarData)],
    ];

    cards.forEach(([cardKey, active]) => {
      if (active) armSlowChart(cardKey);
      else markChartRendered(cardKey);
    });
  }, [
    armSlowChart,
    lineData,
    onderwerpLineData,
    inflowVsClosedLineData,
    incidentResolutionLineData,
    firstResponseLineData,
    organizationBarData,
    markChartRendered,
  ]);

  useEffect(() => () => {
    slowChartTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    slowChartTimersRef.current.clear();
  }, []);

  const kpiStats = useMemo(() => {
    const indices = fullWeekInfo.indices;

    const totalSeries = series.find((s) => isTotalLabel(s.label)) || series[0];
    const totalTickets = indices.reduce((sum, idx) => sum + (Number(totalSeries?.data?.[idx]) || 0), 0);

    const lastCompletedIdx = indices.length ? indices[indices.length - 1] : -1;
    const prevCompletedIdx = indices.length > 1 ? indices[indices.length - 2] : -1;
    const latestTickets = lastCompletedIdx >= 0 ? Number(totalSeries?.data?.[lastCompletedIdx] || 0) : 0;
    const previousTickets = prevCompletedIdx >= 0 ? Number(totalSeries?.data?.[prevCompletedIdx] || 0) : null;
    const wowChangePct =
      previousTickets && previousTickets > 0
        ? ((latestTickets - previousTickets) / previousTickets) * 100
        : null;
    const avgPerWeek = indices.length ? totalTickets / indices.length : null;

    const typeCandidates = series.filter((s) => !isTotalLabel(s.label) && !String(s.label).startsWith("Mediaan "));
    const typeTotals = typeCandidates.map((s) => ({
      label: s.label,
      total: indices.reduce((sum, idx) => sum + (Number(s.data?.[idx]) || 0), 0),
    }));
    typeTotals.sort((a, b) => b.total - a.total);
    const topType = typeTotals[0];

    const completeWeekSet = new Set(indices.map((idx) => weeks[idx]));
    const onderwerpMap = new Map();
    (Array.isArray(onderwerpVolume) ? onderwerpVolume : []).forEach((row) => {
      const weekIso = String(row?.week || "").slice(0, 10);
      const onderwerpLabel = String(row?.onderwerp || "");
      if (!weekIso || !onderwerpLabel) return;
      if (!completeWeekSet.has(weekIso)) return;
      const current = onderwerpMap.get(onderwerpLabel) || 0;
      onderwerpMap.set(onderwerpLabel, current + (Number(row?.tickets) || 0));
    });
    const onderwerpTotals = Array.from(onderwerpMap.entries())
      .map(([label, total]) => ({ label, total }))
      .sort((a, b) => b.total - a.total);
    const topSubject = onderwerpTotals[0];

    const orgRows = Array.isArray(organizationVolume) ? organizationVolume : [];
    const partnerMapLast = new Map();
    const partnerMapPrev = new Map();
    const weekLastIso = lastCompletedIdx >= 0 ? weeks[lastCompletedIdx] : null;
    const weekPrevIso = prevCompletedIdx >= 0 ? weeks[prevCompletedIdx] : null;
    orgRows.forEach((row) => {
      const weekIso = String(row?.week || "").slice(0, 10);
      const partner = String(row?.organization || "").trim();
      const tickets = Number(row?.tickets) || 0;
      if (!partner || tickets <= 0) return;
      if (weekLastIso && weekIso === weekLastIso) {
        partnerMapLast.set(partner, (partnerMapLast.get(partner) || 0) + tickets);
      }
      if (weekPrevIso && weekIso === weekPrevIso) {
        partnerMapPrev.set(partner, (partnerMapPrev.get(partner) || 0) + tickets);
      }
    });
    const summarizeTopPartners = (partnerMap) => {
      const entries = Array.from(partnerMap.entries()).sort((a, b) => b[1] - a[1]);
      if (!entries.length) return { label: "—", tickets: 0 };
      const topTickets = Number(entries[0][1]) || 0;
      const tiedPartners = entries
        .filter(([, tickets]) => Number(tickets) === topTickets)
        .map(([partner]) => partner);
      return {
        label: tiedPartners.join(" / "),
        tickets: topTickets,
      };
    };
    const topPartnerLast = summarizeTopPartners(partnerMapLast);
    const topPartnerPrev = summarizeTopPartners(partnerMapPrev);

    const ttfrRows = Array.isArray(ttfrOverdueWeekly) ? ttfrOverdueWeekly : [];
    const ttfrOverdueByWeek = new Map();
    ttfrRows.forEach((row) => {
      const weekIso = String(row?.week || "").slice(0, 10);
      if (!weekIso || !completeWeekSet.has(weekIso)) return;
      ttfrOverdueByWeek.set(weekIso, (ttfrOverdueByWeek.get(weekIso) || 0) + (Number(row?.tickets) || 0));
    });
    const ttfrOverdueTotal = Array.from(ttfrOverdueByWeek.values()).reduce((sum, n) => sum + (Number(n) || 0), 0);
    const ttfrOverdueLatest = weekLastIso ? Number(ttfrOverdueByWeek.get(weekLastIso) || 0) : 0;
    const ttfrOverduePrevious = weekPrevIso ? Number(ttfrOverdueByWeek.get(weekPrevIso) || 0) : null;
    const ttfrOverdueWowPct =
      ttfrOverduePrevious && ttfrOverduePrevious > 0
        ? ((ttfrOverdueLatest - ttfrOverduePrevious) / ttfrOverduePrevious) * 100
        : null;
    const releaseRows = (Array.isArray(releaseFollowupWorkload) ? releaseFollowupWorkload : [])
      .filter((row) => row?.followup_date)
      .sort((a, b) => String(a.followup_date).localeCompare(String(b.followup_date)));
    const amsterdamNow = zonedDateTimeParts(new Date(), AMSTERDAM_TIME_ZONE);
    const latestReleaseIndex = releaseRows.length - 1;
    const holdLatestRelease =
      latestReleaseIndex >= 0
      && releaseRows[latestReleaseIndex]?.followup_date === amsterdamNow?.isoDate
      && Number(amsterdamNow?.hour) < 12
      && releaseRows.length > 1;
    const effectiveLatestIndex = holdLatestRelease ? latestReleaseIndex - 1 : latestReleaseIndex;
    const latestReleaseRow = effectiveLatestIndex >= 0 ? releaseRows[effectiveLatestIndex] : null;
    const previousReleaseRow = effectiveLatestIndex > 0 ? releaseRows[effectiveLatestIndex - 1] : null;
    const releaseTrend = trendInfo(latestReleaseRow?.tickets, previousReleaseRow?.tickets);

    return {
      totalTickets,
      latestTickets,
      wowChangePct,
      avgPerWeek,
      lastCompletedWeekLabel:
        lastCompletedIdx >= 0 && weeks[lastCompletedIdx] ? fmtDate(weeks[lastCompletedIdx]) : "—",
      topTypeLabel: topType?.label || "—",
      topTypeTickets: topType?.total || 0,
      topSubjectLabel: topSubject?.label || "—",
      topSubjectTotal: topSubject?.total || 0,
      topPartnerLabel: topPartnerLast.label,
      topPartnerTickets: topPartnerLast.tickets,
      topPartnerPrevLabel: topPartnerPrev.label,
      topPartnerPrevTickets: topPartnerPrev.tickets,
      ttfrOverdueTotal,
      ttfrOverdueLatest,
      ttfrOverdueWowPct,
      releaseWednesdayLatestTickets: Number(latestReleaseRow?.tickets) || 0,
      releaseWednesdayPreviousTickets: previousReleaseRow ? Number(previousReleaseRow?.tickets) || 0 : null,
      releaseWednesdayLatestDateLabel: latestReleaseRow?.followup_date ? fmtDateWithWeekday(latestReleaseRow.followup_date) : "—",
      releaseWednesdayLatestReleaseLabel: latestReleaseRow?.release_date ? fmtDate(latestReleaseRow.release_date) : "—",
      releaseWednesdayPreviousDateLabel: previousReleaseRow?.followup_date ? fmtDateWithWeekday(previousReleaseRow.followup_date) : "—",
      releaseWednesdayPreviousReleaseLabel: previousReleaseRow?.release_date ? fmtDate(previousReleaseRow.release_date) : "—",
      releaseWednesdayTrendText: previousReleaseRow ? releaseTrend.text : "—",
      releaseWednesdayTrendSymbol: previousReleaseRow ? releaseTrend.symbol : "",
      releaseWednesdayTrendColor: previousReleaseRow ? releaseTrend.color : "var(--text-main)",
      periodLabel: fullWeekInfo.periodLabel,
      completeWeeksCount: fullWeekInfo.count,
    };
  }, [series, weeks, onderwerpVolume, organizationVolume, fullWeekInfo, ttfrOverdueWeekly, releaseFollowupWorkload]);

  const topOnderwerpRows = useMemo(() => {
    if (!fullWeekInfo.count) return [];
    const completeWeekSet = new Set(fullWeekInfo.indices.map((idx) => weeks[idx]));
    const map = new Map();

    (Array.isArray(onderwerpVolume) ? onderwerpVolume : []).forEach((row) => {
      const weekIso = String(row?.week || "").slice(0, 10);
      const label = String(row?.onderwerp || "");
      if (!weekIso || !label || !completeWeekSet.has(weekIso)) return;

      const cur = map.get(label) || { label, total: 0, last: 0, prev: 0 };
      const tickets = Number(row?.tickets) || 0;
      cur.total += tickets;
      if (weekIso === weeks[fullWeekInfo.lastIndex]) cur.last += tickets;
      if (fullWeekInfo.prevIndex >= 0 && weekIso === weeks[fullWeekInfo.prevIndex]) cur.prev += tickets;
      map.set(label, cur);
    });

    return Array.from(map.values())
      .filter((row) => (Number(row?.last) || 0) > 0)
      .sort((a, b) => {
        if (topOnderwerpSort === "tickets") {
          const byLast = (Number(b.last) || 0) - (Number(a.last) || 0);
          if (byLast !== 0) return byLast;
          const wowDiff = wowSortValue(b) - wowSortValue(a);
          if (wowDiff !== 0) return wowDiff;
          return (Number(b.total) || 0) - (Number(a.total) || 0);
        }
        const wowDiff = wowSortValue(b) - wowSortValue(a);
        if (wowDiff !== 0) return wowDiff;
        const byLast = (Number(b.last) || 0) - (Number(a.last) || 0);
        if (byLast !== 0) return byLast;
        return (Number(b.total) || 0) - (Number(a.total) || 0);
      })
      .slice(0, 10);
  }, [fullWeekInfo, weeks, onderwerpVolume, topOnderwerpSort]);

  const vacationBannerItems = useMemo(() => {
    const items = [];
    const avatarMap =
      servicedeskConfig?.team_member_avatars && typeof servicedeskConfig.team_member_avatars === "object"
        ? servicedeskConfig.team_member_avatars
        : {};
    const todayIso = isoDate(new Date());
    const active = Array.isArray(todayVacations) ? todayVacations : [];
    const activeNames = Array.from(new Set(active.map((item) => item?.member_name).filter(Boolean)));
    activeNames.forEach((memberName) => {
      const memberRows = active.filter((item) => item?.member_name === memberName);
      const endDates = memberRows.map((item) => item?.end_date).filter(Boolean).sort();
      const latestEndDate = endDates.length ? endDates[endDates.length - 1] : null;
      const text =
        latestEndDate && latestEndDate > todayIso
          ? `Vandaag is ${memberName} vrij tot en met ${fmtDateWithWeekday(latestEndDate)}`
          : `Vandaag is ${memberName} vrij`;
      items.push({
        kind: "active",
        key: `active:${memberName}`,
        memberName,
        avatarUrl: avatarMap[memberName] || "",
        text,
        emoji: "🏖️",
      });
    });

    const vacations = Array.isArray(allVacations) ? allVacations : [];
    const warningByMember = new Map();
    vacations.forEach((item) => {
      const memberName = String(item?.member_name || "").trim();
      const startDate = String(item?.start_date || "").trim();
      const endDate = String(item?.end_date || "").trim();
      if (!memberName || !startDate) return;
      if (startDate <= todayIso) return;
      const workdays = businessDaysUntil(todayIso, startDate);
      if (workdays < 1 || workdays > 2) return;
      const current = warningByMember.get(memberName);
      if (!current || startDate < current.startDate) {
        warningByMember.set(memberName, { memberName, startDate, endDate, workdays });
      }
    });
    Array.from(warningByMember.values())
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .forEach(({ memberName, startDate, endDate }) => {
        if (activeNames.includes(memberName)) return;
        items.push({
          kind: "warning",
          key: `warning:${memberName}:${startDate}`,
          memberName,
          avatarUrl: avatarMap[memberName] || "",
          text: buildUpcomingWarningText(memberName, startDate, endDate),
          emoji: "🚨",
        });
      });

    return items;
  }, [todayVacations, allVacations, servicedeskConfig]);

  const vacationBanner = useMemo(() => {
    if (!vacationBannerItems.length) return null;
    const idx = vacationBannerIndex % vacationBannerItems.length;
    return vacationBannerItems[idx];
  }, [vacationBannerItems, vacationBannerIndex]);

  const formatVacationRangeLabel = useCallback((startDate, endDate) => {
    if (!startDate || !endDate) return "";
    if (startDate === endDate) return fmtDateWithWeekday(startDate);
    return `${fmtDateWithWeekday(startDate)} t/m ${fmtDateWithWeekday(endDate)}`;
  }, []);

  const isVacationActiveToday = useCallback((item) => {
    if (!item?.start_date || !item?.end_date) return false;
    const todayIso = isoDate(new Date());
    return item.start_date <= todayIso && item.end_date >= todayIso;
  }, []);

  useEffect(() => {
    setVacationBannerIndex(0);
  }, [vacationBannerItems.length]);

  useEffect(() => {
    if (vacationBannerItems.length <= 1) return;
    const t = setInterval(() => {
      setVacationBannerIndex((prev) => (prev + 1) % vacationBannerItems.length);
    }, 5000);
    return () => clearInterval(t);
  }, [vacationBannerItems.length]);

  useEffect(() => {
    if (!vacationBanner) return;
    const t = setTimeout(() => {
      setVacationBannerIndex((prev) => prev % Math.max(1, vacationBannerItems.length));
    }, 0);
    return () => clearTimeout(t);
  }, [vacationBanner, vacationBannerItems.length]);

  const vacationBannerStyle = useMemo(() => {
    if (vacationBanner?.kind === "warning") {
      return {
        gridColumn: 2,
        marginBottom: 0,
        border: "1px solid color-mix(in srgb, #f59e0b 50%, var(--border))",
        borderRadius: 10,
        background: "color-mix(in srgb, #f59e0b 12%, var(--surface))",
        color: "var(--text-main)",
        padding: "8px 14px",
        fontSize: 14,
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        justifySelf: "center",
        marginLeft: "auto",
        marginRight: "auto",
      };
    }
    return {
      gridColumn: 2,
      marginBottom: 0,
      border: "1px solid color-mix(in srgb, var(--ok) 45%, var(--border))",
      borderRadius: 10,
      background: "color-mix(in srgb, var(--ok) 14%, var(--surface))",
      color: "var(--text-main)",
      padding: "8px 14px",
      fontSize: 14,
      fontWeight: 700,
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      justifySelf: "center",
      marginLeft: "auto",
      marginRight: "auto",
    };
  }, [vacationBanner]);

  useEffect(() => {
    if (!servicedeskTeamMembers.length) return;
    setVacationForm((prev) => {
      if (!prev.memberName || !servicedeskTeamMembers.includes(prev.memberName)) {
        return { ...prev, memberName: servicedeskTeamMembers[0] };
      }
      return prev;
    });
  }, [servicedeskTeamMembers]);

  async function fetchDrilldown(
    weekStart,
    typeLabel,
    onderwerpLabel,
    offset = 0,
    options = {}
  ) {
    if (isLayoutEditing) return;
    setSidePanelMode("drilldown");
    const dateField = options?.dateField === "resolved" ? "resolved" : "created";
    const basisLabel = options?.basisLabel || (dateField === "resolved" ? "Afgesloten" : "Binnengekomen");
    setSelectedWeek(weekStart);
    setSelectedType(typeLabel || "");
    setSelectedOnderwerp(onderwerpLabel || onderwerp || "");
    setSelectedDrillDateField(dateField);
    setSelectedDrillBasisLabel(basisLabel);
    setDrillOffset(offset);
    setDrillLoading(true);

    try {
      const weekEnd = addDaysIso(weekStart, 7);

      const params = new URLSearchParams({
        date_from: weekStart,
        date_to: weekEnd,
        date_field: dateField,
        limit: String(DRILL_LIMIT),
        offset: String(offset),
      });

      if (typeLabel) params.set("request_type", typeLabel);
      if (onderwerpLabel) params.set("onderwerp", onderwerpLabel);
      else if (onderwerp) params.set("onderwerp", onderwerp);
      if (priority) params.set("priority", priority);
      if (assignee) params.set("assignee", assignee);
      if (organization) params.set("organization", organization);
      if (servicedeskOnly) params.set("servicedesk_only", "true");

      const res = await fetch(`${API}/issues?` + params.toString());
      const data = await res.json();
      setDrillIssues(data);
      setDrillHasNext(Array.isArray(data) && data.length === DRILL_LIMIT);
    } finally {
      setDrillLoading(false);
    }
  }

  const filterPanelStyle = {
    marginBottom: 12,
    padding: 12,
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--surface-muted)",
  };
  const filterGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: 10,
    alignItems: "end",
  };
  const configSectionStyle = {
    marginTop: 14,
    borderTop: "1px solid var(--border)",
    paddingTop: 12,
    display: "grid",
    gap: 8,
  };
  const configDetailsStyle = {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--surface)",
    padding: "8px 10px",
  };
  const configSummaryStyle = {
    cursor: "pointer",
    fontWeight: 700,
    color: "var(--text-main)",
    outline: "none",
  };
  const configListStyle = {
    marginTop: 8,
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 8,
    maxHeight: 200,
    overflow: "auto",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: 6,
    alignContent: "start",
  };
  const fieldStyle = { display: "flex", flexDirection: "column", gap: 6, minWidth: 0 };
  const labelStyle = { fontSize: 12, fontWeight: 600, color: "var(--text-subtle)" };
  const inputBaseStyle = {
    height: 36,
    padding: "0 10px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--surface)",
    color: "var(--text-main)",
    width: "100%",
  };
  const compactInputStyle = {
    ...inputBaseStyle,
    width: 120,
    maxWidth: "100%",
  };
  const buttonBaseStyle = {
    height: 36,
    padding: "0 12px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--surface)",
    color: "var(--text-main)",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
  const hiddenChartPlaceholderStyle = {
    height: "100%",
    minHeight: 0,
    maxHeight: "100%",
    width: "100%",
    boxSizing: "border-box",
    border: "none",
    borderRadius: 10,
    color: "var(--text-muted)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: 10,
    overflow: "hidden",
  };
  const rowCardHeight = isTvMode ? "clamp(170px, 20dvh, 340px)" : "clamp(150px, 18dvh, 320px)";
  const donutBodyStyle = {
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
  const chartShellStyle = {
    border: "1px solid var(--border-strong)",
    borderRadius: 10,
    background: "var(--surface)",
    padding: 10,
    minWidth: 0,
    height: "100%",
    minHeight: 0,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  };
  const chartBodyStyle = {
    flex: 1,
    minHeight: 0,
    position: "relative",
  };
  const renderSlowChartOverlay = useCallback(
    (cardKey) => {
      if (!slowChartCards?.[cardKey]) return null;
      const overlayStyle = {
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        background: "color-mix(in srgb, var(--surface) 76%, transparent)",
        zIndex: 2,
      };
      const badgeStyle = {
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        borderRadius: 999,
        border: "1px solid color-mix(in srgb, var(--accent) 28%, var(--border))",
        background: "color-mix(in srgb, var(--surface) 92%, transparent)",
        boxShadow: "0 8px 24px color-mix(in srgb, #0f172a 12%, transparent)",
        color: "var(--text-main)",
        fontSize: 12,
        fontWeight: 700,
      };
      const spinnerStyle = {
        width: 16,
        height: 16,
        borderRadius: 999,
        border: "2px solid color-mix(in srgb, var(--accent) 20%, transparent)",
        borderTopColor: "var(--accent)",
        animation: "spin 800ms linear infinite",
        flexShrink: 0,
      };
      return (
        <div style={overlayStyle}>
          <div style={badgeStyle}>
            <span style={spinnerStyle} aria-hidden="true" />
            <span>Grafiek wordt geladen…</span>
          </div>
        </div>
      );
    },
    [slowChartCards]
  );
  const slowChartAnimation = useCallback((cardKey) => (slowChartCards?.[cardKey] ? false : undefined), [slowChartCards]);
  const interactionDisabledStyle = isLayoutEditing ? { pointerEvents: "none", userSelect: "none" } : null;
  const pagePaddingX = isTvMode ? "clamp(8px, 1dvh, 12px)" : "clamp(8px, 1.2dvh, 14px)";
  const pagePaddingTop = pagePaddingX;
  const pagePaddingBottom = "clamp(20px, 3dvh, 40px)";
  const pageStyle = {
    fontFamily: "system-ui",
    paddingTop: pagePaddingTop,
    paddingRight: pagePaddingX,
    paddingBottom: pagePaddingBottom,
    paddingLeft: pagePaddingX,
    maxWidth: "100%",
    margin: "0 auto",
    background: "var(--page-bg)",
    color: "var(--text-main)",
    minHeight: "100dvh",
    height: "100dvh",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  };
  const kpiGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: isTvMode ? "clamp(8px, 0.8dvh, 12px)" : "clamp(8px, 1dvh, 14px)",
    marginBottom: isTvMode ? "clamp(8px, 0.8dvh, 12px)" : "clamp(8px, 1dvh, 14px)",
    width: "100%",
  };
  const cardRowsWrapStyle = {
    display: "grid",
    gap: isTvMode ? "clamp(8px, 0.8dvh, 12px)" : "clamp(8px, 1dvh, 14px)",
    width: "100%",
    flex: "1 1 0",
    minHeight: 0,
    overflow: "hidden",
    maxHeight: "calc(100% - clamp(20px, 3dvh, 44px))",
    gridTemplateRows: "repeat(2, minmax(0, 1fr))",
    marginBottom: isTvMode ? "clamp(16px, 2.2dvh, 28px)" : "clamp(16px, 2.2dvh, 28px)",
  };
  const cardRowStyle = {
    display: "grid",
    gap: isTvMode ? "clamp(8px, 0.8dvh, 12px)" : "clamp(8px, 1dvh, 14px)",
    minHeight: 0,
    height: "100%",
    overflow: "hidden",
  };
  const foldNoticeStyle = {
    marginTop: 6,
    fontSize: 12,
    color: "var(--text-muted)",
  };
  const kpiCardStyle = {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--surface)",
    padding: "8px 10px",
    minWidth: 0,
  };
  const kpiLabelStyle = {
    fontSize: 12,
    color: "var(--text-muted)",
    marginBottom: 4,
  };
  const kpiValueStyle = {
    fontSize: 20,
    fontWeight: 700,
    lineHeight: 1.1,
    color: "var(--text-main)",
  };
  const skeletonCardStyle = {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--surface)",
    padding: "10px 12px",
    minHeight: 92,
  };
  const skeletonBarStyle = {
    height: 12,
    borderRadius: 8,
    background: "linear-gradient(100deg, var(--surface-muted) 25%, var(--surface) 40%, var(--surface-muted) 65%)",
    backgroundSize: "220% 100%",
    animation: "dashSkeletonWave 1.35s ease-in-out infinite",
  };
  const kpiSubStyle = {
    fontSize: 12,
    color: "var(--text-muted)",
    marginTop: 4,
  };
  const fixedMetricBadgeStyle = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "2px 8px",
    borderRadius: 999,
    border: "1px solid color-mix(in srgb, var(--accent) 34%, var(--border))",
    color: "var(--accent)",
    fontSize: 11,
    fontWeight: 700,
    lineHeight: 1.2,
    whiteSpace: "nowrap",
  };
  const topListCardStyle = {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--surface)",
    padding: 8,
    minWidth: 0,
    height: rowCardHeight,
    display: "flex",
    flexDirection: "column",
  };
  const topListHeaderStyle = {
    margin: "0 0 6px",
    fontSize: 14,
    lineHeight: 1.2,
  };
  const topListHintStyle = {
    margin: "0 0 6px",
    color: "var(--text-muted)",
    fontSize: 11,
  };
  const topListTableStyle = {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 11,
  };
  const topListTableWrapStyle = {
    flex: 1,
    minHeight: 0,
    overflow: "auto",
  };
  const topListThStyle = {
    textAlign: "left",
    padding: "4px 6px",
    borderBottom: "1px solid var(--border)",
    color: "var(--text-muted)",
    fontWeight: 600,
  };
  const topListTdStyle = {
    padding: "3px 6px",
    borderBottom: "1px solid var(--border)",
    verticalAlign: "middle",
  };
  const chartTitleStyle = {
    margin: 0,
    fontSize: 18,
    lineHeight: 1.2,
  };
  const headerRowStyle = {
    marginBottom: 10,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
    gap: 12,
    alignItems: "center",
  };
  const titleStyle = { margin: 0, lineHeight: 1.1, justifySelf: "start", gridColumn: 1 };
  const headerActionsStyle = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    gridColumn: 3,
    justifySelf: "end",
    justifyContent: "flex-end",
  };
  const headerPrimaryButtonsStyle = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    marginLeft: "auto",
    flexShrink: 0,
  };
  const activeFiltersBadgeStyle = {
    height: 36,
    padding: "0 2px",
    color: "var(--text-muted)",
    display: "inline-flex",
    alignItems: "center",
    fontSize: 13,
    fontWeight: 700,
    whiteSpace: "nowrap",
  };
  const syncDockStyle = {
    position: "fixed",
    left: 12,
    bottom: 8,
    zIndex: 1000,
    color: "var(--text-muted)",
    fontSize: 12,
    lineHeight: 1.2,
    padding: "4px 8px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "color-mix(in srgb, var(--surface) 94%, transparent)",
    boxShadow: "0 4px 10px var(--shadow-medium)",
    maxWidth: "min(680px, calc(100vw - 24px))",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
  const filterOpenButtonStyle = {
    ...buttonBaseStyle,
    borderColor: "var(--accent)",
    color: "var(--accent)",
    fontWeight: 700,
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  };
  const layoutPrimaryButtonStyle = {
    ...buttonBaseStyle,
    borderColor: "var(--accent)",
    background: "var(--accent)",
    color: "#fff",
    fontWeight: 700,
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  };
  const iconButtonStyle = {
    ...buttonBaseStyle,
    height: 28,
    width: 28,
    padding: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderColor: "var(--danger)",
    color: "var(--danger)",
    background: "color-mix(in srgb, var(--danger) 10%, var(--surface))",
  };
  const dragHandleStyle = {
    width: 18,
    height: 18,
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--surface-muted)",
    color: "var(--text-muted)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    lineHeight: 1,
    flexShrink: 0,
  };
  const filterOverlayStyle = {
    position: "fixed",
    inset: 0,
    background: "var(--overlay-bg)",
    zIndex: 1100,
    opacity: filtersOpen ? 1 : 0,
    transition: "opacity 160ms ease",
  };
  const filterModalStyle = {
    position: "fixed",
    top: 18,
    left: "50%",
    transform: "translateX(-50%)",
    width: "min(1120px, 96vw)",
    maxHeight: "86vh",
    overflow: "auto",
    zIndex: 1101,
    border: "1px solid var(--border)",
    borderRadius: 12,
    background: "var(--surface)",
    boxShadow: "0 20px 56px var(--shadow-strong)",
  };
  const filterModalHeaderStyle = {
    position: "sticky",
    top: 0,
    zIndex: 1,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 12px",
    borderBottom: "1px solid var(--border)",
    background: "var(--surface-muted)",
  };
  const activeFilterChipStyle = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 8px",
    borderRadius: 999,
    background: "color-mix(in srgb, var(--accent) 14%, transparent)",
    color: "var(--text-main)",
    border: "1px solid color-mix(in srgb, var(--accent) 34%, var(--border))",
    fontSize: 12,
    lineHeight: 1.2,
    maxWidth: "100%",
  };
  const resetActiveFiltersButtonStyle = {
    height: 30,
    padding: "0 10px",
    border: "1px solid var(--danger)",
    borderRadius: 8,
    background: "color-mix(in srgb, var(--danger) 12%, var(--surface))",
    color: "var(--danger)",
    cursor: "pointer",
    fontWeight: 600,
  };
  const cardTitleButtonStyle = {
    margin: "0 0 8px",
    padding: 0,
    border: "none",
    background: "transparent",
    textAlign: "left",
    fontSize: 18,
    lineHeight: 1.2,
    fontWeight: 700,
    color: "var(--text-main)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  };
  const cardTitleHintStyle = {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
    opacity: 0.75,
    display: "inline-flex",
    alignItems: "center",
  };
  const vacationActionButtonStyle = {
    ...buttonBaseStyle,
    height: 28,
    width: 28,
    padding: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderColor: "var(--accent)",
    color: "var(--accent)",
    background: "color-mix(in srgb, var(--accent) 10%, var(--surface))",
    fontWeight: 800,
  };
  const vacationListStyle = {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "grid",
    gap: 8,
    fontSize: 13,
    overflow: "auto",
  };
  const vacationItemStyle = {
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "8px 10px",
    background: "var(--surface-muted)",
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    alignItems: "center",
    minHeight: 52,
  };
  const vacationRowActionsStyle = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    opacity: 0,
    pointerEvents: "none",
    transition: "opacity 140ms ease",
  };
  const vacationFormGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: 8,
    marginBottom: 8,
  };
  const modalOverlayStyle = {
    position: "fixed",
    inset: 0,
    background: "var(--overlay-bg)",
    zIndex: 1001,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    animation: "overlayIn 180ms ease",
  };
  const modalFrameStyle = {
    width: "100%",
    display: "flex",
    justifyContent: "center",
    transform: sidePanelOpen ? "translateX(clamp(-360px, -18vw, -96px))" : "translateX(0)",
    transition: "transform 220ms ease",
    pointerEvents: "none",
  };
  const modalCardStyle = {
    width: "min(1280px, 96vw)",
    height: "min(88vh, 880px)",
    background: "var(--surface)",
    borderRadius: 14,
    border: "1px solid var(--border)",
    boxShadow: "0 24px 70px var(--shadow-strong)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    animation: "modalIn 220ms cubic-bezier(0.2, 0.7, 0.2, 1)",
    pointerEvents: "auto",
  };
  const modalHeaderStyle = {
    display: "flex",
    gap: 12,
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 14px",
    borderBottom: "1px solid var(--border-strong)",
    background: "var(--surface-muted)",
  };
  const modalBodyStyle = {
    flex: 1,
    minHeight: 0,
    paddingTop: 14,
    paddingRight: 14,
    paddingBottom: 14,
    paddingLeft: 14,
    overflow: "auto",
  };
  const modalCloseStyle = {
    height: 34,
    padding: "0 10px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--surface)",
    color: "var(--text-main)",
    cursor: "pointer",
  };
  const hotkeysFabStyle = {
    position: "fixed",
    right: 16,
    bottom: 16,
    zIndex: 1003,
    height: 40,
    width: 40,
    padding: 0,
    borderRadius: 999,
    border: "1px solid var(--border)",
    background: "var(--surface)",
    color: "var(--text-main)",
    cursor: "pointer",
    boxShadow: "0 8px 24px var(--shadow-medium)",
    fontWeight: 600,
    fontSize: 22,
    lineHeight: 1,
  };
  const hotkeysPanelStyle = {
    position: "fixed",
    right: 16,
    bottom: 64,
    zIndex: 1003,
    width: "min(560px, 96vw)",
    maxHeight: "min(78vh, 620px)",
    background: "var(--surface)",
    borderRadius: 14,
    border: "1px solid var(--border)",
    boxShadow: "0 24px 70px var(--shadow-strong)",
    overflow: "hidden",
  };
  const hiddenOverlayStyle = {
    position: "fixed",
    left: 12,
    right: 12,
    bottom: 12,
    zIndex: 1002,
    border: "1px solid var(--border)",
    borderRadius: 12,
    background: "color-mix(in srgb, var(--surface) 96%, transparent)",
    boxShadow: "0 20px 50px var(--shadow-strong)",
    padding: 10,
    display: "grid",
    gap: 8,
  };
  const hiddenOverlayDropStyle = {
    borderColor: "var(--danger)",
    background: "color-mix(in srgb, var(--danger) 8%, var(--surface))",
  };
  const hiddenOverlayTitleStyle = {
    margin: 0,
    fontSize: 13,
    color: "var(--text-subtle)",
  };
  const hiddenPoolStyle = {
    minHeight: 64,
    border: "1px dashed var(--border)",
    borderRadius: 10,
    padding: 8,
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  };
  const hiddenPoolDropStyle = {
    borderColor: "var(--danger)",
    background: "color-mix(in srgb, var(--danger) 8%, var(--surface))",
  };
  const hiddenDropCueStyle = {
    width: "100%",
    minHeight: 48,
    borderRadius: 8,
    border: "1px dashed color-mix(in srgb, var(--danger) 45%, var(--border))",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    color: "var(--danger)",
    fontWeight: 700,
    fontSize: 12,
  };
  const hiddenChipStyle = {
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "10px 12px",
    background: "var(--surface)",
    fontSize: 13,
    cursor: "grab",
    minHeight: 42,
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  };
  const dropSkeletonStyle = {
    border: "1px dashed color-mix(in srgb, var(--accent) 65%, var(--border))",
    borderRadius: 10,
    minHeight: rowCardHeight,
    background:
      "linear-gradient(110deg, color-mix(in srgb, var(--accent) 16%, var(--surface)) 8%, color-mix(in srgb, var(--accent) 28%, var(--surface)) 18%, color-mix(in srgb, var(--accent) 16%, var(--surface)) 33%)",
    backgroundSize: "220% 100%",
    animation: "dropPulse 900ms ease-in-out infinite",
  };
  const hotkeysTableStyle = {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 14,
  };
  const hotkeysThStyle = {
    textAlign: "left",
    padding: "8px 10px",
    borderBottom: "1px solid var(--border)",
    color: "var(--text-muted)",
    fontWeight: 600,
  };
  const hotkeysTdStyle = {
    padding: "10px",
    borderBottom: "1px solid var(--border)",
    verticalAlign: "top",
  };
  const hotkeysKeyStyle = {
    display: "inline-flex",
    minWidth: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    padding: "0 6px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--surface-muted)",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 0.3,
  };

  useEffect(() => {
    if (!expandedCard) return;
    const isVisible = dashboardLayout.cardRows.some((row) => row.includes(expandedCard));
    if (!isVisible) setExpandedCard("");
  }, [expandedCard, dashboardLayout.cardRows]);

  useEffect(() => {
    setDashboardLayout((prev) => {
      const current = prev.expandedByRow || [null, null];
      const next = [0, 1].map((idx) => {
        const key = current[idx];
        const row = prev.cardRows[idx] || [];
        if (!key || !row.includes(key)) return null;
        return key;
      });
      if (next[0] === current[0] && next[1] === current[1]) return prev;
      return { ...prev, expandedByRow: next };
    });
  }, [dashboardLayout.cardRows]);

  const toggleInsightLogItem = useCallback((insightId) => {
    setExpandedInsightIds((prev) => ({ ...prev, [insightId]: !prev[insightId] }));
  }, []);

  const handleInsightFeedback = useCallback(async (insightId, vote, reason = null) => {
    if (!insightId) return;
    setInsightFeedbackBusyId(insightId);
    try {
      await submitInsightFeedback({ insightId, vote, reason });
      await refreshInsightLog();
      if (vote === "down") {
        setPendingInsightDownvoteId(null);
        setPendingInsightReason(AI_INSIGHT_DOWNVOTE_REASONS[0]);
        flashToast("AI-card verwijderd en feedback opgeslagen.");
      } else {
        flashToast("Feedback op AI-card opgeslagen.");
      }
    } catch (err) {
      flashToast(err?.message || "Feedback opslaan mislukt.", "error");
    } finally {
      setInsightFeedbackBusyId(null);
    }
  }, [flashToast, refreshInsightLog, submitInsightFeedback]);

  function renderAiInsightCard(originalCardKey, expanded = false) {
    const insight = aiInsightByCardKey.get(originalCardKey);
    if (!insight) return renderCardContent(originalCardKey, expanded);

    const pendingDownvote = pendingInsightDownvoteId === insight.id;
    const confidenceExplanation =
      insight.source_payload?.confidence?.confidence_explanation ||
      `Confidence score ${Math.round(insight.score_pct)}%. Dit is een interne relevantiescore op basis van afwijking ten opzichte van de vorige periode en bepaalt of een AI-card getoond wordt.`;
    return (
      <div
        style={{
          display: "grid",
          gap: 12,
          height: "100%",
          alignContent: "start",
          gridTemplateRows: "auto auto auto auto minmax(0, 1fr) auto auto",
          minHeight: 0,
          position: "relative",
        }}
      >
        <div
          style={{
            display: "grid",
            gap: 8,
            padding: expanded ? "18px 18px 14px" : "12px 12px 10px",
            borderRadius: 16,
            background:
              "linear-gradient(145deg, color-mix(in srgb, #0f766e 18%, var(--surface)) 0%, color-mix(in srgb, #14b8a6 8%, var(--surface)) 100%)",
            border: "1px solid color-mix(in srgb, #0f766e 30%, var(--border))",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                width: "fit-content",
                padding: "5px 10px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.72)",
                color: "#0f766e",
                border: "1px solid color-mix(in srgb, #0f766e 26%, white)",
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: 0.2,
              }}
              title={confidenceExplanation}
            >
              AI Insight
              <span style={{ color: "rgba(15, 23, 42, 0.68)" }}>{Math.round(insight.score_pct)}%</span>
              <span
                aria-label="Confidence score uitleg"
                title={confidenceExplanation}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 16,
                  height: 16,
                  borderRadius: 999,
                  border: "1px solid color-mix(in srgb, #0f766e 25%, currentColor)",
                  fontSize: 10,
                  fontWeight: 800,
                  lineHeight: 1,
                  cursor: "help",
                }}
              >
                i
              </span>
            </span>
            <button type="button" onClick={() => openInsightLogPanel(String(insight.id))} style={filterOpenButtonStyle}>
              Log
            </button>
          </div>
          <strong style={{ fontSize: expanded ? 24 : 18, lineHeight: 1.15, maxWidth: 560 }}>{insight.title}</strong>
          <div style={{ color: "rgba(15, 23, 42, 0.78)", lineHeight: 1.45, fontSize: expanded ? 15 : 13 }}>{insight.summary}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={fixedMetricBadgeStyle}>Vervangt: {cardTitleByKey(originalCardKey)}</span>
          {insight.deviation_pct != null ? <span style={fixedMetricBadgeStyle}>Afwijking: {insight.deviation_pct > 0 ? "+" : ""}{insight.deviation_pct}%</span> : null}
          <span style={fixedMetricBadgeStyle}>TTL: {aiInsightTtlHours} uur</span>
        </div>
        {insight.action_label ? (
          <div
            style={{
              padding: expanded ? "14px 16px" : "10px 12px",
              borderRadius: 14,
              background: "color-mix(in srgb, #f59e0b 10%, var(--surface))",
              border: "1px solid color-mix(in srgb, #f59e0b 28%, var(--border))",
              display: "grid",
              gap: 4,
            }}
          >
            <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>Aanbevolen actie</div>
            <div style={{ fontWeight: 700 }}>{insight.action_label}</div>
          </div>
        ) : null}
        <div
            style={{
              display: "grid",
              gap: 8,
              padding: expanded ? "14px 16px" : "10px 12px",
              borderRadius: 14,
            background: "var(--surface-muted)",
            border: "1px dashed color-mix(in srgb, #0f766e 28%, var(--border))",
          }}
        >
          <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>Waarom deze kaart nu zichtbaar is</div>
          <div style={{ color: "var(--text-muted)", lineHeight: 1.5 }}>
            Deze AI-card heeft tijdelijk de standaardkaart vervangen zodat het signaal direct in de hoofdview opvalt.
          </div>
        </div>
        <div style={{ minHeight: 0 }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => handleInsightFeedback(insight.id, "up")}
              disabled={insightFeedbackBusyId === insight.id}
              style={{ ...iconButtonStyle, minWidth: 42, fontWeight: 700 }}
              title="Relevant"
              aria-label="Relevant"
            >
              👍
            </button>
            <button
              type="button"
              onClick={() => {
                setPendingInsightDownvoteId(insight.id);
                setPendingInsightReason(AI_INSIGHT_DOWNVOTE_REASONS[0]);
              }}
              disabled={insightFeedbackBusyId === insight.id}
              style={{ ...iconButtonStyle, minWidth: 42, fontWeight: 700 }}
              title="Niet relevant"
              aria-label="Niet relevant"
            >
              👎
            </button>
          </div>
          <button type="button" onClick={() => openInsightLogPanel(String(insight.id))} style={{ ...filterOpenButtonStyle, padding: "6px 10px" }}>
            Brondata
          </button>
        </div>
        {pendingDownvote ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 18,
              borderRadius: 18,
              background: "color-mix(in srgb, #0f172a 26%, transparent)",
              zIndex: 3,
            }}
          >
            <div
              style={{
                width: "min(100%, 420px)",
                display: "grid",
                gap: 10,
                padding: expanded ? "18px" : "16px",
                borderRadius: 16,
                border: "1px solid color-mix(in srgb, var(--danger) 28%, var(--border))",
                background: "var(--surface)",
                boxShadow: "0 18px 40px color-mix(in srgb, #0f172a 18%, transparent)",
              }}
            >
              <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>Waarom wil je deze AI-card wegstemmen?</div>
              <select value={pendingInsightReason} onChange={(e) => setPendingInsightReason(e.target.value)} style={inputBaseStyle}>
                {AI_INSIGHT_DOWNVOTE_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {reason}
                  </option>
                ))}
              </select>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                <button type="button" onClick={() => handleInsightFeedback(insight.id, "down", pendingInsightReason)} style={layoutPrimaryButtonStyle}>
                  Bevestig downvote
                </button>
                <button type="button" onClick={() => setPendingInsightDownvoteId(null)} style={filterOpenButtonStyle}>
                  Annuleren
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderCardContent(cardKey, expanded = false) {
    const bodyStyle = expanded ? { height: "100%", minHeight: 0, position: "relative" } : chartBodyStyle;
    const donutStyle = expanded ? { ...donutBodyStyle, minHeight: 0 } : donutBodyStyle;
    const emptyStyle = expanded ? { ...hiddenChartPlaceholderStyle, minHeight: 0 } : hiddenChartPlaceholderStyle;
    if (cardKey === "topOnderwerpen") {
      return (
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
          <p style={topListHintStyle}>Tickets en trend per laatste volledige week ({fullWeekInfo.periodLabel})</p>
          <div style={topListTableWrapStyle}>
            {topOnderwerpRows.length ? (
              <table style={topListTableStyle}>
                <thead>
                  <tr>
                    <th style={topListThStyle}>Onderwerp</th>
                    <th
                      style={{
                        ...topListThStyle,
                        textAlign: "right",
                        cursor: "pointer",
                        color: topOnderwerpSort === "tickets" ? "var(--accent)" : "var(--text-muted)",
                      }}
                      onClick={() => setTopOnderwerpSort("tickets")}
                      title="Sorteer op tickets (laatste volledige week)"
                    >
                      Tickets {topOnderwerpSort === "tickets" ? "↓" : ""}
                    </th>
                    <th
                      style={{
                        ...topListThStyle,
                        textAlign: "right",
                        cursor: "pointer",
                        color: topOnderwerpSort === "wow" ? "var(--accent)" : "var(--text-muted)",
                      }}
                      onClick={() => setTopOnderwerpSort("wow")}
                      title="Sorteer op WoW"
                    >
                      Δ WoW {topOnderwerpSort === "wow" ? "↓" : ""}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {topOnderwerpRows.map((row) => {
                    const trend = trendInfo(row.last, row.prev);
                    return (
                      <tr key={row.label}>
                        <td style={topListTdStyle}>{row.label}</td>
                        <td style={{ ...topListTdStyle, textAlign: "right" }}>{num(row.last)}</td>
                        <td style={{ ...topListTdStyle, textAlign: "right", color: trend.color }}>
                          {trend.symbol} {trend.text}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <EmptyChartState filterLabel="Periode" style={emptyStyle} />
            )}
          </div>
        </div>
      );
    }

    if (cardKey === "volume") {
      return (
        <div style={bodyStyle}>
          {hasDataPoints(lineData) ? (
            <Line
              data={lineData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                animation: slowChartAnimation("volume"),
                onClick: (_evt, elements) => {
                  const el = elements?.[0];
                  if (!el) return;
                  const weekStart = weeks[el.index];
                  const typeLabel = lineData.datasets[el.datasetIndex]?.label;
                  if (typeLabel === "Mediaan totaal aantal tickets") return;
                  if (typeLabel && typeLabel.startsWith("Mediaan ")) return;
                  const effectiveType = requestType ? requestType : isTotalLabel(typeLabel) ? "" : typeLabel;
                  fetchDrilldown(weekStart, effectiveType, "");
                },
                plugins: {
                  legend: { display: false },
                  tooltip: { mode: "nearest", intersect: false },
                  releaseCadence: releaseCadencePlugin,
                  renderWatch: { onReady: () => markChartRendered("volume") },
                  simpleDataLabels: { mode: "line", maxLabels: expanded ? 24 : 12 },
                },
                interaction: { mode: "nearest", intersect: false },
              }}
            />
          ) : (
            <EmptyChartState filterLabel="Request type" style={emptyStyle} />
          )}
          {renderSlowChartOverlay("volume")}
        </div>
      );
    }

    if (cardKey === "onderwerp") {
      const onderwerpContentStyle = expanded
        ? { display: "flex", flexDirection: "column", flex: 1, minHeight: 0, height: "100%" }
        : { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 };
      return (
        <div style={onderwerpContentStyle}>
          <div style={bodyStyle}>
            {hasDataPoints(onderwerpLineData) ? (
              <Line
                data={onderwerpLineData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  animation: slowChartAnimation("onderwerp"),
                  onClick: (_evt, elements) => {
                    const el = elements?.[0];
                    if (!el) return;
                    const weekStart = weeksOnderwerp[el.index];
                    const subjectLabel = onderwerpLineData.datasets[el.datasetIndex]?.label;
                    if (!subjectLabel || subjectLabel.startsWith("Mediaan ")) return;
                    if (!subjectLabel) return;
                    setOnderwerp(subjectLabel || "");
                    fetchDrilldown(weekStart, requestType, subjectLabel);
                  },
                  plugins: {
                    legend: { display: false },
                    tooltip: { mode: "nearest", intersect: false },
                    releaseCadence: releaseCadenceOnderwerpPlugin,
                    renderWatch: { onReady: () => markChartRendered("onderwerp") },
                    simpleDataLabels: { mode: "line", maxLabels: expanded ? 24 : 12 },
                  },
                  interaction: { mode: "nearest", intersect: false },
                }}
              />
            ) : (
              <EmptyChartState filterLabel="Onderwerp" style={emptyStyle} />
            )}
            {renderSlowChartOverlay("onderwerp")}
          </div>
        </div>
      );
    }

    if (cardKey === "priority") {
      return (
        <div style={bodyStyle}>
          {!priority ? (
            hasDataPoints(priorityBarData) ? (
              <div style={donutStyle}>
                <Doughnut
                  data={priorityBarData}
                  options={{
                    cutout: "60%",
                    maintainAspectRatio: false,
                    plugins: {
                      legend: {
                        display: true,
                        position: "right",
                        onClick: legendNoopHandler,
                        labels: {
                          color: (ctx) => priorityColors?.[ctx.index] || "#6b7280",
                        },
                      },
                      simpleDataLabels: { mode: "arc", minArcPct: 8 },
                    },
                  }}
                />
              </div>
            ) : (
              <EmptyChartState filterLabel="Prioriteit" style={emptyStyle} />
            )
          ) : (
            <EmptyChartState filterLabel="Prioriteit" style={emptyStyle} />
          )}
        </div>
      );
    }

    if (cardKey === "assignee") {
      return (
        <div style={bodyStyle}>
          {!assignee ? (
            hasDataPoints(assigneeBarData) ? (
              <div style={donutStyle}>
                <Doughnut
                  data={assigneeBarData}
                  options={{
                    cutout: "60%",
                    maintainAspectRatio: false,
                    plugins: {
                      legend: {
                        display: true,
                        position: "right",
                        onClick: legendNoopHandler,
                        labels: {
                          color: (ctx) => assigneeColors?.[ctx.index] || "#6b7280",
                        },
                      },
                      simpleDataLabels: { mode: "arc", minArcPct: 8 },
                    },
                  }}
                />
              </div>
            ) : (
              <EmptyChartState filterLabel="Assignee" style={emptyStyle} />
            )
          ) : (
            <EmptyChartState filterLabel="Assignee" style={emptyStyle} />
          )}
        </div>
      );
    }

    if (cardKey === "p90") {
      return (
        <>
          <div style={bodyStyle}>
            {hasDataPoints(barData) ? (
              <Bar
                data={barData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { display: true, position: "top" },
                    simpleDataLabels: { mode: "bar", maxLabels: expanded ? 20 : 10, datasetIndexes: [2] },
                  },
                  scales: {
                    x: {
                      ticks: {
                        color: "var(--text-muted)",
                        maxRotation: 30,
                        minRotation: 0,
                      },
                    },
                    y: {
                      title: {
                        display: true,
                        text: "Uren",
                        color: "var(--text-muted)",
                      },
                      ticks: {
                        color: "var(--text-muted)",
                      },
                    },
                  },
                }}
              />
            ) : (
              <EmptyChartState filterLabel="Periode" style={emptyStyle} />
            )}
          </div>
          <p style={{ margin: "8px 0 0", color: "var(--text-muted)", fontSize: 12 }}>
            Periode: {p90Period.label}
            {" · "}
            Tip: filter op “Onderwerp” om p90 per type te zien voor één categorie.
          </p>
        </>
      );
    }

    if (cardKey === "inflowVsClosed") {
      return (
        <div style={bodyStyle}>
            {hasDataPoints(inflowVsClosedLineData) ? (
              <Line
                data={inflowVsClosedLineData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  animation: slowChartAnimation("inflowVsClosed"),
                  onClick: (_evt, elements) => {
                  const el = elements?.[0];
                  if (!el) return;
                  const weekStart = weeks[el.index];
                  const datasetLabel = inflowVsClosedLineData.datasets?.[el.datasetIndex]?.label || "";
                  const isClosed = String(datasetLabel).toLowerCase().includes("afgesloten");
                  fetchDrilldown(
                    weekStart,
                    requestType,
                    onderwerp || "",
                    0,
                    {
                      dateField: isClosed ? "resolved" : "created",
                      basisLabel: isClosed ? "Afgesloten" : "Binnengekomen",
                    }
                  );
                },
                  plugins: {
                    legend: { display: true, position: "top" },
                    renderWatch: { onReady: () => markChartRendered("inflowVsClosed") },
                    tooltip: {
                      mode: "nearest",
                      intersect: false,
                      callbacks: {
                        label: (ctx) => `${ctx.dataset.label}: ${num(ctx.parsed.y)} tickets`,
                      },
                    },
                    releaseCadence: releaseCadencePlugin,
                    simpleDataLabels: false,
                  },
                  interaction: { mode: "nearest", intersect: false },
                  scales: {
                    x: {
                      ticks: { color: "var(--text-muted)" },
                    },
                    y: {
                      title: { display: true, text: "Aantal tickets", color: "var(--text-muted)" },
                      ticks: {
                        color: "var(--text-muted)",
                        callback: (value) => num(value),
                      },
                    },
                  },
                }}
              />
            ) : (
              <EmptyChartState filterLabel="Binnengekomen/Afgesloten" style={emptyStyle} />
            )}
          {renderSlowChartOverlay("inflowVsClosed")}
        </div>
      );
    }

    if (cardKey === "incidentResolution") {
      return (
        <div style={bodyStyle}>
            {hasDataPoints(incidentResolutionLineData) ? (
              <Line
                data={incidentResolutionLineData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  animation: slowChartAnimation("incidentResolution"),
                  plugins: {
                    legend: { display: true, position: "top" },
                    renderWatch: { onReady: () => markChartRendered("incidentResolution") },
                    tooltip: {
                      mode: "nearest",
                      intersect: false,
                      callbacks: {
                        label: (ctx) => `${ctx.dataset.label}: ${formatDurationHoursForTooltip(ctx.parsed.y)}`,
                      },
                    },
                    releaseCadence: releaseCadencePlugin,
                    simpleDataLabels: false,
                  },
                  interaction: { mode: "nearest", intersect: false },
                  scales: {
                    x: {
                      ticks: { color: "var(--text-muted)" },
                    },
                    y: {
                      title: { display: true, text: "Uren", color: "var(--text-muted)" },
                      ticks: { color: "var(--text-muted)" },
                    },
                  },
                }}
              />
            ) : (
              <EmptyChartState filterLabel="Time to Resolution" style={emptyStyle} />
            )}
          {renderSlowChartOverlay("incidentResolution")}
        </div>
      );
    }

    if (cardKey === "firstResponseAll") {
      return (
        <div style={bodyStyle}>
            {hasDataPoints(firstResponseLineData) ? (
              <Line
                data={firstResponseLineData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  animation: slowChartAnimation("firstResponseAll"),
                  plugins: {
                    legend: { display: true, position: "top" },
                    renderWatch: { onReady: () => markChartRendered("firstResponseAll") },
                    tooltip: { mode: "nearest", intersect: false },
                    releaseCadence: releaseCadencePlugin,
                    simpleDataLabels: false,
                  },
                  interaction: { mode: "nearest", intersect: false },
                  scales: {
                    x: {
                      ticks: { color: "var(--text-muted)" },
                    },
                    y: {
                      title: { display: true, text: "Uren", color: "var(--text-muted)" },
                      ticks: { color: "var(--text-muted)" },
                    },
                  },
                }}
              />
            ) : (
              <EmptyChartState filterLabel="Time to First Response" style={emptyStyle} />
            )}
          {renderSlowChartOverlay("firstResponseAll")}
        </div>
      );
    }

    if (cardKey === "organizationWeekly") {
      return (
        <div style={bodyStyle}>
            {hasDataPoints(organizationBarData) ? (
              <Bar
                data={organizationBarData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  animation: slowChartAnimation("organizationWeekly"),
                  plugins: {
                    legend: { display: true, position: "top" },
                    renderWatch: { onReady: () => markChartRendered("organizationWeekly") },
                    tooltip: { mode: "nearest", intersect: false },
                    simpleDataLabels: false,
                  },
                  interaction: { mode: "nearest", intersect: false },
                  scales: {
                    x: {
                      ticks: { color: "var(--text-muted)" },
                    },
                    y: {
                      title: { display: true, text: "Aantal tickets", color: "var(--text-muted)" },
                      ticks: { color: "var(--text-muted)" },
                    },
                  },
                }}
              />
            ) : (
              <EmptyChartState filterLabel="Partners" style={emptyStyle} />
            )}
          {renderSlowChartOverlay("organizationWeekly")}
        </div>
      );
    }

    if (cardKey === "vacationServicedesk") {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0, height: "100%" }}>
          {vacationEditMode ? (
            <>
              <div style={vacationFormGridStyle}>
                <label style={fieldStyle}>
                  <span style={labelStyle}>Teamlid</span>
                  <select
                    value={vacationForm.memberName}
                    onChange={(e) => setVacationForm((prev) => ({ ...prev, memberName: e.target.value }))}
                    style={inputBaseStyle}
                  >
                    {servicedeskTeamMembers.map((member) => (
                      <option key={`vac-member-${member}`} value={member}>
                        {member}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={fieldStyle}>
                  <span style={labelStyle}>Startdatum</span>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="dd/mm/jjjj"
                      value={vacationStartUi}
                      onChange={(e) => setVacationStartUi(e.target.value)}
                      onBlur={() => {
                        const iso = parseNlDateToIso(vacationStartUi);
                        if (iso) {
                          applyVacationStartDate(iso);
                        } else {
                          flashToast("Ongeldige startdatum. Gebruik dd/mm/jjjj.", "error");
                          setVacationStartUi(fmtDate(vacationForm.startDate));
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                      style={inputBaseStyle}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const el = vacationStartNativeRef.current;
                        if (!el) return;
                        if (typeof el.showPicker === "function") el.showPicker();
                        else {
                          el.focus();
                          el.click();
                        }
                      }}
                      title="Open kalender"
                      aria-label="Open kalender"
                      style={buttonBaseStyle}
                    >
                      📅
                    </button>
                    <input
                      ref={vacationStartNativeRef}
                      type="date"
                      value={vacationForm.startDate}
                      min={isoDate(new Date())}
                      onChange={(e) => {
                        const iso = e.target.value;
                        applyVacationStartDate(iso);
                      }}
                      style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 0, height: 0 }}
                      tabIndex={-1}
                      aria-hidden="true"
                    />
                  </div>
                </label>
                <label style={fieldStyle}>
                  <span style={labelStyle}>Einddatum</span>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="dd/mm/jjjj"
                      value={vacationEndUi}
                      onChange={(e) => setVacationEndUi(e.target.value)}
                      onBlur={() => {
                        const iso = parseNlDateToIso(vacationEndUi);
                        if (iso) {
                          setVacationForm((prev) => ({ ...prev, endDate: iso }));
                          setVacationEndUi(fmtDate(iso));
                        } else {
                          flashToast("Ongeldige einddatum. Gebruik dd/mm/jjjj.", "error");
                          setVacationEndUi(fmtDate(vacationForm.endDate));
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                      style={inputBaseStyle}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const el = vacationEndNativeRef.current;
                        if (!el) return;
                        if (typeof el.showPicker === "function") el.showPicker();
                        else {
                          el.focus();
                          el.click();
                        }
                      }}
                      title="Open kalender"
                      aria-label="Open kalender"
                      style={buttonBaseStyle}
                    >
                      📅
                    </button>
                    <input
                      ref={vacationEndNativeRef}
                      type="date"
                      value={vacationForm.endDate}
                      min={vacationForm.startDate || isoDate(new Date())}
                      onChange={(e) => {
                        const iso = e.target.value;
                        setVacationForm((prev) => ({ ...prev, endDate: iso }));
                        setVacationEndUi(fmtDate(iso));
                      }}
                      style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 0, height: 0 }}
                      tabIndex={-1}
                      aria-hidden="true"
                    />
                  </div>
                </label>
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <button
                  type="button"
                  onClick={saveVacation}
                  disabled={vacationSaving || !vacationFormDirty}
                  style={layoutPrimaryButtonStyle}
                >
                  Opslaan
                </button>
                <button
                  type="button"
                  onClick={cancelVacationEdit}
                  disabled={vacationSaving}
                  style={buttonBaseStyle}
                >
                  Annuleren
                </button>
              </div>
            </>
          ) : upcomingVacations.length ? (
            <>
              <ul style={vacationListStyle}>
                {upcomingVacations.slice(0, 3).map((item) => (
                  (() => {
                    const isActiveToday = isVacationActiveToday(item);
                    const todayIso = isoDate(new Date());
                    const startDate = String(item?.start_date || "");
                    const workdaysUntilStart = startDate ? businessDaysUntil(todayIso, startDate) : 0;
                    const isSoonWarning = !isActiveToday && workdaysUntilStart >= 1 && workdaysUntilStart <= 2;
                    const activeTodayStyle = isActiveToday
                      ? {
                          minHeight: 78, // ~1.5x base item height
                          borderColor: "color-mix(in srgb, var(--ok) 55%, var(--border))",
                          background: "color-mix(in srgb, var(--ok) 18%, var(--surface))",
                        }
                      : null;
                    const soonWarningStyle = isSoonWarning
                      ? {
                          borderColor: "color-mix(in srgb, #f59e0b 55%, var(--border))",
                          background: "color-mix(in srgb, #f59e0b 14%, var(--surface))",
                        }
                      : null;
                    return (
                  <li
                    key={`vac-upcoming-${item.id}`}
                    className="vacation-row"
                    style={{ ...vacationItemStyle, ...(soonWarningStyle || {}), ...(activeTodayStyle || {}) }}
                    onMouseEnter={() => setVacationHoverId(item.id)}
                    onMouseLeave={() => setVacationHoverId((prev) => (prev === item.id ? null : prev))}
                    onFocus={() => setVacationHoverId(item.id)}
                    onBlur={() => setVacationHoverId((prev) => (prev === item.id ? null : prev))}
                  >
                    <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
                      <VacationAvatar
                        name={item.member_name}
                        avatarUrl={servicedeskConfig?.team_member_avatars?.[item.member_name] || ""}
                      />
                      <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                      <strong>{item.member_name}</strong>
                      <span style={{ color: "var(--text-muted)" }}>
                        {formatVacationRangeLabel(item.start_date, item.end_date)}
                      </span>
                      </div>
                    </div>
                    <div
                      className="vacation-row-actions"
                      style={{
                        ...vacationRowActionsStyle,
                        opacity: vacationHoverId === item.id ? 1 : 0,
                        pointerEvents: vacationHoverId === item.id ? "auto" : "none",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => startVacationEdit(item)}
                        style={{ ...vacationActionButtonStyle, borderColor: "var(--accent)", color: "var(--accent)" }}
                        title="Aanpassen"
                        aria-label="Aanpassen"
                        disabled={vacationSaving}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M4 20h4l10-10-4-4L4 16v4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                          <path d="m12 6 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeVacation(item.id)}
                        style={{ ...vacationActionButtonStyle, borderColor: "var(--danger)", color: "var(--danger)" }}
                        title="Verwijderen"
                        aria-label="Verwijderen"
                        disabled={vacationSaving}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M4 7h16M10 3h4M7 7l1 13h8l1-13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </div>
                  </li>
                    );
                  })()
                ))}
              </ul>
              {upcomingVacationTotal > 3 ? (
                <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                  Er staan meer vakanties gepland. Hier worden er maximaal 3 getoond.
                </div>
              ) : null}
            </>
          ) : (
            <div style={emptyStyle}>Er zijn geen vakanties gepland.</div>
          )}
        </div>
      );
    }

    return null;
  }

  const kpiTiles = useMemo(
    () => ({
      totalTickets: {
        label: "Tickets (volledige weken)",
        value: (
          <span style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, width: "100%" }}>
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", lineHeight: 1.2 }}>Totaal</span>
              <span>{num(kpiStats.totalTickets)}</span>
            </span>
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", lineHeight: 1.2 }}>Gem./week</span>
              <span>{num(kpiStats.avgPerWeek, 1)}</span>
            </span>
          </span>
        ),
        sub: kpiStats.periodLabel,
      },
      latestTickets: {
        label: "Tickets laatste volledige week",
        value: num(kpiStats.latestTickets),
        sub: `Week van ${kpiStats.lastCompletedWeekLabel} · WoW: ${pct(kpiStats.wowChangePct)}`,
        badge: "Periode: laatste week",
      },
      releaseWednesdayWorkload: {
        label: "Workload woensdag na release",
        value: kpiStats.releaseWednesdayTrendText === "—" ? "—" : `${kpiStats.releaseWednesdayTrendSymbol} ${kpiStats.releaseWednesdayTrendText}`.trim(),
        sub: `Release (${kpiStats.releaseWednesdayLatestReleaseLabel}): ${num(kpiStats.releaseWednesdayLatestTickets)} tickets`,
        subSecondary:
          kpiStats.releaseWednesdayPreviousTickets == null
            ? "Nog geen vorige release-woensdag in de gekozen periode"
            : `Vorige release (${kpiStats.releaseWednesdayPreviousReleaseLabel}): ${num(kpiStats.releaseWednesdayPreviousTickets)} tickets`,
        badge: "Release",
        valueStyle: { color: kpiStats.releaseWednesdayTrendColor },
      },
      ttfrOverdue: {
        label: "TTFR verlopen (volledige weken)",
        value: num(kpiStats.ttfrOverdueTotal),
        sub: `Laatste week: ${num(kpiStats.ttfrOverdueLatest)} · WoW: ${pct(kpiStats.ttfrOverdueWowPct)}`,
        badge: "SLA",
      },
      topType: {
        label: "Top request type (volledige weken)",
        value: kpiStats.topTypeLabel,
        sub: `${num(kpiStats.topTypeTickets)} tickets`,
      },
      topSubject: {
        label: "Top onderwerp (volledige weken)",
        value: kpiStats.topSubjectLabel,
        sub: `${num(kpiStats.topSubjectTotal)} tickets`,
      },
      topPartner: {
        label: "Partner met meeste tickets volledige week",
        value: (
          <span>
            <span>{kpiStats.topPartnerLabel}</span>{" "}
            <span style={{ fontSize: "0.7em", fontWeight: 600, color: "var(--text-muted)" }}>met</span>{" "}
            <span>{num(kpiStats.topPartnerTickets)}</span>{" "}
            <span style={{ fontSize: "0.7em", fontWeight: 600, color: "var(--text-muted)" }}>tickets</span>
          </span>
        ),
        sub: (
          <span>
            Week ervoor: <strong>{kpiStats.topPartnerPrevLabel}</strong> met <strong>{num(kpiStats.topPartnerPrevTickets)}</strong> tickets
          </span>
        ),
      },
    }),
    [kpiStats]
  );

  const visibleKpiKeys = dashboardLayout.kpiRow;
  const hiddenKpiKeys = dashboardLayout.hiddenKpis;
  const visibleCardRows = dashboardLayout.cardRows;
  const hiddenCardKeys = dashboardLayout.hiddenCards;
  const lockedCardKeys = useMemo(() => dashboardLayout.lockedCards || [], [dashboardLayout.lockedCards]);
  const cardTitleByKey = useCallback(
    (key) => (key === "topOnderwerpen" ? "Top 10 onderwerpen" : CARD_TITLES[key] || key),
    []
  );
  const aiInsightByCardKey = useMemo(() => {
    const visibleCards = new Set(visibleCardRows.flat());
    const map = new Map();
    liveInsights.forEach((item) => {
      const targetCardKey = item?.target_card_key;
      if (!targetCardKey) return;
      if (!visibleCards.has(targetCardKey)) return;
      if (lockedCardKeys.includes(targetCardKey)) return;
      if (item?.removed_at || item?.feedback_status === "downvoted") return;
      if (!map.has(targetCardKey)) map.set(targetCardKey, item);
    });
    return map;
  }, [liveInsights, lockedCardKeys, visibleCardRows]);

  function startDrag(kind, key, source) {
    if (!isLayoutEditing) return;
    dragStateRef.current = { kind, key, source };
    if (kind !== "card") setCardDropHint(null);
    if (kind !== "kpi") setKpiDropHint(null);
  }

  function clearDrag() {
    dragStateRef.current = null;
    setCardDropHint(null);
    setKpiDropHint(null);
    setHiddenDropTarget(null);
  }

  function moveKpiToVisible(targetKey = null, position = "before") {
    const state = dragStateRef.current;
    clearDrag();
    if (!state || state.kind !== "kpi") return;
    setDashboardLayout((prev) => moveKpiToVisibleLayout(prev, state.key, targetKey, position));
  }

  function hideKpi() {
    const state = dragStateRef.current;
    clearDrag();
    if (!state || state.kind !== "kpi") return;
    setDashboardLayout((prev) => hideKpiLayout(prev, state.key));
  }

  function hideKpiByKey(key) {
    setDashboardLayout((prev) => hideKpiLayout(prev, key));
  }

  function moveCardToRow(rowIndex, targetKey = null, position = "before") {
    const state = dragStateRef.current;
    clearDrag();
    if (!state || state.kind !== "card" || rowIndex < 0 || rowIndex > 1) return;
    setDashboardLayout((prev) => moveCardToRowLayout(prev, state.key, rowIndex, targetKey, position));
  }

  function hideCard() {
    const state = dragStateRef.current;
    clearDrag();
    if (!state || state.kind !== "card") return;
    setDashboardLayout((prev) => hideCardLayout(prev, state.key));
  }

  function hideCardByKey(key) {
    setDashboardLayout((prev) => hideCardLayout(prev, key));
  }

  function toggleCardLock(key) {
    setDashboardLayout((prev) => toggleCardLockLayout(prev, key));
  }

  function toggleRowExpandCard(rowIndex, key) {
    if (!isLayoutEditing || rowIndex < 0 || rowIndex > 1) return;
    setDashboardLayout((prev) => toggleRowExpandCardLayout(prev, rowIndex, key));
  }

  function hideDraggedToOverlay() {
    const kind = dragStateRef.current?.kind;
    if (kind === "kpi") {
      hideKpi();
    } else if (kind === "card") {
      hideCard();
    }
    setHiddenDropTarget(null);
  }

  function setCardHintFromEvent(rowIndex, targetKey, e) {
    if (!isLayoutEditing) return;
    if (dragStateRef.current?.kind !== "card") return;
    if (hiddenDropTarget) setHiddenDropTarget(null);
    const rect = e.currentTarget.getBoundingClientRect();
    const position = e.clientX < rect.left + rect.width / 2 ? "before" : "after";
    setCardDropHint({ rowIndex, targetKey, position });
  }

  function setKpiHintFromEvent(targetKey, e) {
    if (!isLayoutEditing) return;
    if (dragStateRef.current?.kind !== "kpi") return;
    if (hiddenDropTarget) setHiddenDropTarget(null);
    const rect = e.currentTarget.getBoundingClientRect();
    const position = e.clientX < rect.left + rect.width / 2 ? "before" : "after";
    setKpiDropHint({ targetKey, position });
  }

  function renderKpiRowWithHint(row) {
    const draggingKey = dragStateRef.current?.kind === "kpi" ? dragStateRef.current.key : null;
    return renderKpiRowWithHintLayout(row, isLayoutEditing, draggingKey, kpiDropHint);
  }

  function renderCardRowWithHint(row, rowIndex) {
    const draggingKey = dragStateRef.current?.kind === "card" ? dragStateRef.current.key : null;
    return renderCardRowWithHintLayout(row, rowIndex, isLayoutEditing, draggingKey, cardDropHint);
  }

  useEffect(() => {
    if (!isLayoutEditing) {
      setCardDropHint(null);
      setKpiDropHint(null);
      setHiddenDropTarget(null);
      dragStateRef.current = null;
    } else {
      closeDrilldown();
      setExpandedCard("");
    }
  }, [isLayoutEditing, closeDrilldown]);

  return (
    <div style={pageStyle}>
      <Head>
        <title>Dashboard Servicedesk Planningsagenda</title>
        <link rel="icon" href={faviconSignal.href} />
      </Head>
      <Toast message={syncMessage} kind={syncMessageKind} onClose={() => setSyncMessage("")} />
      <LiveAlertStack
        alerts={liveAlerts}
        ttrCollapsed={ttrAlertsCollapsed}
        onToggleTtrCollapsed={() => setTtrAlertsCollapsed((value) => !value)}
      />
      <button
        ref={hotkeysButtonRef}
        type="button"
        onClick={() => setHotkeysOpen((v) => !v)}
        style={hotkeysFabStyle}
        aria-label="Toon hotkeys"
        aria-expanded={hotkeysOpen}
        aria-haspopup="dialog"
      >
        ?
      </button>
      <div style={headerRowStyle}>
        <h1 style={titleStyle}>Dashboard Servicedesk Planningsagenda</h1>
        {vacationBanner ? (
          <div style={vacationBannerStyle}>
            <VacationAvatar
              name={vacationBanner.memberName}
              avatarUrl={vacationBanner.avatarUrl}
              style={{ width: 30, height: 30, fontSize: 11 }}
            />
            <span>{vacationBanner.text}</span>
            <span aria-hidden>{vacationBanner.emoji}</span>
            {vacationBannerItems.length > 1 ? (
              <span style={{ display: "inline-flex", gap: 4, marginLeft: 4, alignItems: "center" }}>
                {vacationBannerItems.map((item, idx) => (
                  <span
                    key={`banner-dot-${item.key}`}
                    aria-hidden
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 999,
                      background: idx === (vacationBannerIndex % vacationBannerItems.length)
                        ? "var(--text-main)"
                        : "color-mix(in srgb, var(--text-muted) 48%, transparent)",
                    }}
                  />
                ))}
              </span>
            ) : null}
          </div>
        ) : null}
        <div style={headerActionsStyle}>
          {activeFilterItems.length ? (
            <>
              <span style={activeFiltersBadgeStyle}>{`Filters actief (${activeFilterItems.length})`}</span>
              <button
                type="button"
                onClick={() => resetFilters(true)}
                style={{ ...resetActiveFiltersButtonStyle, height: 32 }}
                title="Reset actieve filters"
              >
                Reset
              </button>
            </>
          ) : null}
          <div style={headerPrimaryButtonsStyle}>
            <button
              type="button"
              onClick={() => openInsightLogPanel("")}
              style={{ ...layoutPrimaryButtonStyle, minWidth: 42, padding: "0 10px", justifyContent: "center", position: "relative" }}
              title="AI inzichtenlog openen"
              aria-label="AI inzichtenlog openen"
            >
              AI
              {liveInsights.length ? (
                <span
                  aria-hidden="true"
                  style={{
                    marginLeft: 6,
                    minWidth: 18,
                    height: 18,
                    borderRadius: 999,
                    background: "#dc2626",
                    color: "#ffffff",
                    border: "1px solid #dc2626",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {liveInsights.length}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={openAlertLogPanel}
              style={{ ...layoutPrimaryButtonStyle, width: 36, padding: 0, justifyContent: "center", position: "relative" }}
              title="Alerts logboek openen"
              aria-label="Alerts logboek openen"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 3a5 5 0 0 0-5 5v3.5L5 14v1h14v-1l-2-2.5V8a5 5 0 0 0-5-5zM10 18a2 2 0 0 0 4 0"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {hasNewAlertLogEntry ? (
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    top: 6,
                    right: 6,
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: "#dc2626",
                    boxShadow: "0 0 0 1px var(--surface)",
                  }}
                />
              ) : null}
            </button>
            {isLayoutEditing ? (
              <button type="button" onClick={cancelLayoutEditing} style={filterOpenButtonStyle}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M18 6L6 18M6 6l12 12"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Annuleren
              </button>
            ) : (
              <button type="button" onClick={startLayoutEditing} style={filterOpenButtonStyle}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M3 17.25V21h3.75L19.81 7.94l-3.75-3.75L3 17.25zM14.06 5.94l3.75 3.75"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Layout aanpassen
              </button>
            )}
            <button type="button" onClick={() => setFiltersOpen(true)} style={filterOpenButtonStyle}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M4 6h16l-6 7v5l-4 2v-7L4 6z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Filters openen
            </button>
          </div>
        </div>
      </div>

      {filtersOpen ? (
        <>
          <div style={filterOverlayStyle} onClick={() => setFiltersOpen(false)} />
          <div style={filterModalStyle} role="dialog" aria-modal="true" aria-label="Filters">
            <div style={filterModalHeaderStyle}>
              <strong>Filters</strong>
              <button type="button" onClick={() => setFiltersOpen(false)} style={buttonBaseStyle}>
                Sluiten
              </button>
            </div>
            <div style={filterPanelStyle}>
        <div style={filterGridStyle}>
          <label style={fieldStyle}>
            <span style={labelStyle}>Van</span>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="text"
              inputMode="numeric"
              placeholder="dd/mm/jjjj"
              value={dateFromUi}
              onChange={(e) => setDateFromUi(e.target.value)}
              onBlur={() => {
                const iso = parseNlDateToIso(dateFromUi);
                if (iso) {
                  setDateFrom(iso);
                } else {
                  setSyncMessage("Ongeldige datum (Van). Gebruik dd/mm/jjjj.");
                  setSyncMessageKind("error");
                  setTimeout(() => setSyncMessage(""), 6000);
                  setDateFromUi(fmtDate(dateFrom));
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                }
              }}
              style={inputBaseStyle}
            />

            <button
              type="button"
              onClick={() => {
                const el = dateFromNativeRef.current;
                if (!el) return;
                // Prefer the native picker when supported
                if (typeof el.showPicker === "function") el.showPicker();
                else {
                  el.focus();
                  el.click();
                }
              }}
              title="Open kalender"
              aria-label="Open kalender"
              style={buttonBaseStyle}
            >
              📅
            </button>

            <input
              ref={dateFromNativeRef}
              type="date"
              value={dateFrom}
              onChange={(e) => {
                const iso = e.target.value;
                setDateFrom(iso);
                setDateFromUi(fmtDate(iso));
              }}
              style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 0, height: 0 }}
              tabIndex={-1}
              aria-hidden="true"
            />
            </div>
          </label>

          <label style={fieldStyle}>
            <span style={labelStyle}>Tot</span>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="text"
              inputMode="numeric"
              placeholder="dd/mm/jjjj"
              value={dateToUi}
              onChange={(e) => setDateToUi(e.target.value)}
              onBlur={() => {
                const iso = parseNlDateToIso(dateToUi);
                if (iso) {
                  setDateTo(iso);
                } else {
                  setSyncMessage("Ongeldige datum (Tot). Gebruik dd/mm/jjjj.");
                  setSyncMessageKind("error");
                  setTimeout(() => setSyncMessage(""), 6000);
                  setDateToUi(fmtDate(dateTo));
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                }
              }}
              style={inputBaseStyle}
            />

            <button
              type="button"
              onClick={() => {
                const el = dateToNativeRef.current;
                if (!el) return;
                if (typeof el.showPicker === "function") el.showPicker();
                else {
                  el.focus();
                  el.click();
                }
              }}
              title="Open kalender"
              aria-label="Open kalender"
              style={buttonBaseStyle}
            >
              📅
            </button>

            <input
              ref={dateToNativeRef}
              type="date"
              value={dateTo}
              onChange={(e) => {
                const iso = e.target.value;
                setDateTo(iso);
                setDateToUi(fmtDate(iso));
              }}
              style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 0, height: 0 }}
              tabIndex={-1}
              aria-hidden="true"
            />
            </div>
          </label>

          <label style={fieldStyle}>
            <span style={labelStyle}>Request type</span>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span
              aria-hidden
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: typeColor(requestType),
                display: "inline-block",
                border: "1px solid var(--indicator-border)",
              }}
            />
            <select
              value={requestType}
              onChange={(e) => {
                setRequestType(e.target.value);
                e.target.blur();
              }}
              style={inputBaseStyle}
            >
              <option value="">(alle)</option>
              {meta.request_types.map((rt) => (
                <option key={rt} value={rt}>
                  {rt}
                </option>
              ))}
            </select>
            </div>
          </label>

          <label style={fieldStyle}>
            <span style={labelStyle}>Onderwerp</span>
          <select
            value={onderwerp}
            onChange={(e) => {
              setOnderwerp(e.target.value);
              e.target.blur();
            }}
            style={inputBaseStyle}
          >
            <option value="">(alle)</option>
            {onderwerpFilterOpties.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
              ))}
            </select>
          </label>

          <label style={fieldStyle}>
            <span style={labelStyle}>Prioriteit</span>
          <select
            value={priority}
            onChange={(e) => {
              setPriority(e.target.value);
              e.target.blur();
            }}
            style={inputBaseStyle}
          >
            <option value="">(alle)</option>
            {meta.priorities.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
              ))}
            </select>
          </label>

          <label style={fieldStyle}>
            <span style={labelStyle}>Assignee</span>
          <select
            value={assignee}
            onChange={(e) => {
              setAssignee(e.target.value);
              e.target.blur();
            }}
            style={inputBaseStyle}
          >
            <option value="">(alle)</option>
            {meta.assignees.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
              ))}
            </select>
          </label>

          <label style={fieldStyle}>
            <span style={labelStyle}>Partner</span>
          <select
            value={organization}
            onChange={(e) => {
              setOrganization(e.target.value);
              e.target.blur();
            }}
            style={inputBaseStyle}
          >
            <option value="">(alle)</option>
            {meta.organizations.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
              ))}
            </select>
          </label>

          <label style={fieldStyle} title="Sluit uit: Koppelingen, datadump, Rest-endpoints, migratie, SSO-koppeling">
            <span style={labelStyle}>Scope</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "4px" }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 28 }}>
                <input
                  type="checkbox"
                  checked={servicedeskOnly}
                  onChange={(e) => setServicedeskOnly(e.target.checked)}
                />
                <span>Alleen servicedesk</span>
              </label>
              <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>
                Voor tickettellingen wordt servicedesk bepaald door de geselecteerde onderwerpen.
              </span>
            </div>
          </label>
        </div>

        <div style={configSectionStyle}>
          <strong>Dashboard configuratie</strong>

          <details style={configDetailsStyle}>
            <summary style={configSummaryStyle}>Servicedesk teamleden</summary>
            <div style={{ marginTop: 8, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>
              Gebruikt voor `Tickets per assignee`, `Vakantie Servicedesk` en operationele alerts.
            </div>
            <div style={configListStyle}>
              {meta.assignees.map((name) => (
                <label key={`cfg-team-${name}`} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 24 }}>
                  <input
                    type="checkbox"
                    checked={teamMembersDraft.includes(name)}
                    onChange={() => toggleTeamMemberDraft(name)}
                  />
                  <span>{name}</span>
                </label>
              ))}
            </div>
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={saveTeamConfig}
                disabled={teamConfigSaving || !teamConfigDirty}
                style={layoutPrimaryButtonStyle}
              >
                Opslaan
              </button>
              <button
                type="button"
                onClick={cancelTeamConfig}
                disabled={teamConfigSaving || !teamConfigDirty}
                style={buttonBaseStyle}
              >
                Annuleren
              </button>
            </div>
          </details>

          <details style={configDetailsStyle}>
            <summary style={configSummaryStyle}>Servicedesk onderwerpen</summary>
            <div style={{ marginTop: 8, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>
              Bepaalt welke tickets meetellen als servicedesk in grafieken, drilldowns en AI-insights.
            </div>
            <div style={configListStyle}>
              {meta.onderwerpen.map((name) => (
                <label key={`cfg-onderwerp-${name}`} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 24 }}>
                  <input
                    type="checkbox"
                    checked={zichtbareOnderwerpenDraft.includes(name)}
                    onChange={() => toggleOnderwerpDraft(name)}
                  />
                  <span>{name}</span>
                </label>
              ))}
            </div>
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={saveOnderwerpConfig}
                disabled={onderwerpConfigSaving || !onderwerpConfigDirty}
                style={layoutPrimaryButtonStyle}
              >
                Opslaan
              </button>
              <button
                type="button"
                onClick={cancelOnderwerpConfig}
                disabled={onderwerpConfigSaving || !onderwerpConfigDirty}
                style={buttonBaseStyle}
              >
                Annuleren
              </button>
              {onderwerpResetAvailable ? (
                <button
                  type="button"
                  onClick={resetOnderwerpConfig}
                  disabled={onderwerpConfigSaving}
                  style={filterOpenButtonStyle}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v6h-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Opnieuw beginnen
                </button>
              ) : null}
            </div>
          </details>

          <details style={configDetailsStyle}>
            <summary style={configSummaryStyle}>AI inzichten</summary>
            <div style={{ display: "grid", gap: 10 }}>
              <label style={fieldStyle}>
                <span style={labelStyle}>Threshold (%)</span>
                <input
                  type="number"
                  min="50"
                  max="95"
                  step="1"
                  value={aiInsightThresholdDraft}
                  onChange={(e) => setAiInsightThresholdDraft(Number(e.target.value || 75))}
                  style={compactInputStyle}
                />
              </label>
              <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                Live actief: {activeAiThresholdPct}% · max {liveInsights.length}/3 AI-cards · TTL {aiInsightTtlHours} uur
              </div>
            </div>
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={saveAiInsightConfig}
                disabled={onderwerpConfigSaving || !aiInsightConfigDirty}
                style={layoutPrimaryButtonStyle}
              >
                Opslaan
              </button>
              <button
                type="button"
                onClick={cancelAiInsightConfig}
                disabled={onderwerpConfigSaving || !aiInsightConfigDirty}
                style={buttonBaseStyle}
              >
                Annuleren
              </button>
            </div>
          </details>
        </div>

            </div>
          </div>
        </>
      ) : null}

      {showStartupSkeleton ? (
        <div style={kpiGridStyle}>
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={`kpi-skeleton-${idx}`} style={skeletonCardStyle}>
              <div style={{ ...skeletonBarStyle, width: "62%", marginBottom: 12 }} />
              <div style={{ ...skeletonBarStyle, width: "40%", height: 24, marginBottom: 10 }} />
              <div style={{ ...skeletonBarStyle, width: "78%", height: 10 }} />
            </div>
          ))}
        </div>
      ) : (() => {
        const renderedKpis = renderKpiRowWithHint(visibleKpiKeys);
        const hintActive = renderedKpis.includes("__KPI_DROP_HINT__");
        return (
          <div
            style={{
              ...kpiGridStyle,
              gridTemplateColumns: `repeat(${Math.max(2, renderedKpis.length || 2)}, minmax(0, 1fr))`,
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              const hint = kpiDropHint;
              moveKpiToVisible(hint?.targetKey || null, hint?.position || "after");
            }}
          >
        {renderedKpis.length ? renderedKpis.map((key) => {
          if (key === "__KPI_DROP_HINT__") {
            return <div key="kpi-drop-hint" style={dropSkeletonStyle} />;
          }
          const tile = kpiTiles[key];
          if (!tile) return null;
          return (
            <div
              key={key}
              style={{
                ...kpiCardStyle,
                cursor: isLayoutEditing ? "grab" : "default",
                transform: hintActive ? "scale(0.86)" : "scale(1)",
                transformOrigin: "center center",
                transition: "transform 170ms ease, opacity 170ms ease",
                opacity: hintActive ? 0.94 : 1,
              }}
              draggable={isLayoutEditing}
              onDragStart={() => startDrag("kpi", key, { zone: "kpiRow" })}
              onDragEnd={clearDrag}
              onDragOver={(e) => {
                e.preventDefault();
                setKpiHintFromEvent(key, e);
              }}
              onDrop={() => {
                const hint = kpiDropHint;
                moveKpiToVisible(hint?.targetKey || key, hint?.position || "before");
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 2 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {isLayoutEditing ? (
                    <span style={dragHandleStyle} aria-hidden>
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                        <circle cx="2" cy="2" r="1" />
                        <circle cx="2" cy="5" r="1" />
                        <circle cx="2" cy="8" r="1" />
                        <circle cx="8" cy="2" r="1" />
                        <circle cx="8" cy="5" r="1" />
                        <circle cx="8" cy="8" r="1" />
                      </svg>
                    </span>
                  ) : null}
                  <div style={{ ...kpiLabelStyle, marginBottom: 0 }}>{tile.label}</div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {tile.badge ? <span style={fixedMetricBadgeStyle}>{tile.badge}</span> : null}
                  {isLayoutEditing ? (
                    <button
                      type="button"
                      onClick={() => hideKpiByKey(key)}
                      style={iconButtonStyle}
                      title="Verberg kaart"
                      aria-label="Verberg kaart"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M4 7h16M10 3h4M7 7l1 13h8l1-13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  ) : null}
                </div>
              </div>
              <div style={{ ...kpiValueStyle, ...(tile.valueStyle || null), fontSize: key === "topType" || key === "topSubject" ? 20 : 20 }}>{tile.value}</div>
              <div style={kpiSubStyle}>{tile.sub}</div>
              {tile.subSecondary ? <div style={{ ...kpiSubStyle, marginTop: 2, fontSize: 11 }}>{tile.subSecondary}</div> : null}
            </div>
          );
        }) : (
          <div style={{ ...hiddenChartPlaceholderStyle, gridColumn: "1 / -1" }}>
            KPI-rij is leeg. Sleep KPI-kaarten terug vanuit Verborgen kaarten.
          </div>
        )}
      </div>
        );
      })()}

      {showStartupSkeleton ? (
        <div style={cardRowsWrapStyle}>
          {Array.from({ length: 2 }).map((_, rowIdx) => (
            <div key={`row-skeleton-${rowIdx}`} style={{ ...cardRowStyle, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
              {Array.from({ length: 3 }).map((__, colIdx) => (
                <div key={`card-skeleton-${rowIdx}-${colIdx}`} style={{ ...chartShellStyle, padding: 12 }}>
                  <div style={{ ...skeletonBarStyle, width: "45%", marginBottom: 10 }} />
                  <div style={{ ...skeletonBarStyle, width: "100%", height: 140 }} />
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
      <div style={cardRowsWrapStyle}>
        {visibleCardRows.map((row, rowIndex) => {
          const renderedRow = renderCardRowWithHint(row, rowIndex);
          const hintActive = renderedRow.includes("__DROP_HINT__");
          const expandedKey = (dashboardLayout.expandedByRow || [null, null])[rowIndex];
          const hasExpanded = !!expandedKey && row.includes(expandedKey);
          const rowColumns = Math.max(2, (renderedRow.length || 2) + (hasExpanded ? 1 : 0));
          return (
            <div
              key={`row-${rowIndex}`}
              style={{ ...cardRowStyle, gridTemplateColumns: `repeat(${rowColumns}, minmax(0, 1fr))` }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                const hint = cardDropHint && cardDropHint.rowIndex === rowIndex ? cardDropHint : null;
                moveCardToRow(rowIndex, hint?.targetKey || null, hint?.position || "after");
              }}
            >
              {!renderedRow.length ? (
                <div style={{ ...hiddenChartPlaceholderStyle, gridColumn: "1 / -1" }}>
                  Rij {rowIndex + 1} is leeg. Sleep een kaart hierheen of haal er een terug uit Verborgen kaarten.
                </div>
              ) : null}
              {renderedRow.map((cardKey) => {
                if (cardKey === "__DROP_HINT__") {
                  return <div key={`hint-${rowIndex}`} style={dropSkeletonStyle} />;
                }
                const aiInsight = aiInsightByCardKey.get(cardKey);
                const isLocked = lockedCardKeys.includes(cardKey);
                const displayTitle = aiInsight ? aiInsight.title : cardTitleByKey(cardKey);
                const showPartialWeekBadge = !aiInsight && Boolean(weeklyScopeHint) && weeklyPartialCardKeys.has(cardKey);
                const showLastWeekBadge = !aiInsight && cardKey === "topOnderwerpen";
                return (
                  <div
                    key={cardKey}
                    className="dashboard-card-shell"
                    style={{
                      ...chartShellStyle,
                      ...(aiInsight
                        ? {
                            borderColor: "color-mix(in srgb, #0f766e 48%, var(--border))",
                            background:
                              "linear-gradient(180deg, color-mix(in srgb, #0f766e 8%, var(--surface)) 0%, var(--surface) 42%)",
                            boxShadow: "0 12px 30px color-mix(in srgb, #0f766e 12%, transparent)",
                          }
                        : null),
                      cursor: isLayoutEditing ? "grab" : "default",
                      gridColumn: hasExpanded && cardKey === expandedKey ? "span 2" : undefined,
                      transform: hintActive ? "scale(0.86)" : "scale(1)",
                      transformOrigin: "center center",
                      transition: "transform 170ms ease, opacity 170ms ease",
                      opacity: hintActive ? 0.94 : 1,
                    }}
                    draggable={isLayoutEditing}
                    onDragStart={() => startDrag("card", cardKey, { zone: "cardRow", rowIndex })}
                    onDragEnd={clearDrag}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setCardHintFromEvent(rowIndex, cardKey, e);
                    }}
                    onDrop={() => {
                      const hint = cardDropHint && cardDropHint.rowIndex === rowIndex ? cardDropHint : null;
                      moveCardToRow(rowIndex, hint?.targetKey || cardKey, hint?.position || "before");
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                      {isLayoutEditing ? (
                        <div style={{ ...cardTitleButtonStyle, cursor: "default", marginBottom: 0 }}>
                          <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
                            <span style={dragHandleStyle} aria-hidden>
                              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                                <circle cx="2" cy="2" r="1" />
                                <circle cx="2" cy="5" r="1" />
                                <circle cx="2" cy="8" r="1" />
                                <circle cx="8" cy="2" r="1" />
                                <circle cx="8" cy="5" r="1" />
                                <circle cx="8" cy="8" r="1" />
                              </svg>
                            </span>
                            <span style={chartTitleStyle}>{aiInsight ? aiInsight.title : cardTitleByKey(cardKey)}</span>
                            {aiInsight ? <span style={fixedMetricBadgeStyle}>AI</span> : null}
                            {showLastWeekBadge ? <span style={fixedMetricBadgeStyle}>Periode: laatste week</span> : null}
                            {showPartialWeekBadge ? (
                              <span style={fixedMetricBadgeStyle} title={weeklyScopeHint}>Lopende week*</span>
                            ) : null}
                          </span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="card-expand-title"
                          style={cardTitleButtonStyle}
                          onClick={() => setExpandedCard(cardKey)}
                          title="Vergroot kaart"
                          aria-label={`${displayTitle} vergroten`}
                        >
                          <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
                            <span style={chartTitleStyle}>{displayTitle}</span>
                            {aiInsight ? <span style={fixedMetricBadgeStyle}>AI</span> : null}
                            {showLastWeekBadge ? <span style={fixedMetricBadgeStyle}>Periode: laatste week</span> : null}
                            {showPartialWeekBadge ? (
                              <span style={fixedMetricBadgeStyle} title={weeklyScopeHint}>Lopende week*</span>
                            ) : null}
                          </span>
                          <span style={cardTitleHintStyle} aria-hidden="true">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                              <path
                                d="M4 10V4h6M20 14v6h-6M14 4h6v6M10 20H4v-6"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                        </button>
                      )}
                      {isLayoutEditing ? (
                        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                          <button
                            type="button"
                            onClick={() => toggleCardLock(cardKey)}
                            style={{
                              ...iconButtonStyle,
                              borderColor: isLocked ? "var(--accent)" : "var(--border)",
                              color: isLocked ? "var(--accent)" : "inherit",
                            }}
                            title={isLocked ? "Slot ontgrendelen" : "Slot vergrendelen"}
                            aria-label={isLocked ? "Slot ontgrendelen" : "Slot vergrendelen"}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              {isLocked ? (
                                <>
                                  <path d="M8 10V7a4 4 0 1 1 8 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                                  <rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
                                </>
                              ) : (
                                <>
                                  <path d="M16 10V7a4 4 0 1 0-8 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                                  <path d="M15 10h4v10H5V10h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                </>
                              )}
                            </svg>
                          </button>
                          {row.length <= 4 ? (
                            <button
                              type="button"
                              onClick={() => toggleRowExpandCard(rowIndex, cardKey)}
                              style={{ ...iconButtonStyle, borderColor: "var(--accent)", color: "var(--accent)" }}
                              title={expandedKey === cardKey ? "Normale breedte" : "Verdubbel breedte"}
                              aria-label={expandedKey === cardKey ? "Normale breedte" : "Verdubbel breedte"}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path d="M4 6h7v12H4V6Zm9 0h7v12h-7V6Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                              </svg>
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => hideCardByKey(cardKey)}
                            style={iconButtonStyle}
                            title="Verberg kaart"
                            aria-label="Verberg kaart"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path d="M4 7h16M10 3h4M7 7l1 13h8l1-13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                        </span>
                      ) : (
                        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                          {cardKey === "vacationServicedesk" ? (
                            <button
                              type="button"
                              onClick={startVacationCreate}
                              style={vacationActionButtonStyle}
                              title="Vakantie toevoegen"
                              aria-label="Vakantie toevoegen"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                              </svg>
                            </button>
                          ) : null}
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        flex: 1,
                        minHeight: 0,
                        ...(interactionDisabledStyle || {}),
                      }}
                    >
                      {aiInsight ? renderAiInsightCard(cardKey) : renderCardContent(cardKey)}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      )}
      {isLayoutEditing ? (
        <div style={foldNoticeStyle}>{'Layout-modus actief: sleep KPI/cards binnen hun categorie en klik daarna op "Opslaan layout".'}</div>
      ) : null}

      {expandedCard ? (
        <div role="dialog" aria-modal="true" aria-label={cardTitleByKey(expandedCard)} style={modalOverlayStyle} onClick={() => setExpandedCard("")}>
          <div style={modalFrameStyle}>
            <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
              <div style={modalHeaderStyle}>
                <h2 style={{ margin: 0, fontSize: 20 }}>
                  {aiInsightByCardKey.get(expandedCard)?.title || cardTitleByKey(expandedCard)}
                  {aiInsightByCardKey.get(expandedCard) ? " · AI-card" : ""}
                </h2>
                <button type="button" onClick={() => setExpandedCard("")} style={modalCloseStyle}>
                  Sluiten
                </button>
              </div>
              <div style={modalBodyStyle}>
                {aiInsightByCardKey.get(expandedCard) ? renderAiInsightCard(expandedCard, true) : renderCardContent(expandedCard, true)}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {hotkeysOpen ? (
        <div ref={hotkeysPopupRef} role="dialog" aria-label="Hotkeys overzicht" style={hotkeysPanelStyle}>
          <div style={modalHeaderStyle}>
            <h2 style={{ margin: 0, fontSize: 20 }}>Hotkeys</h2>
            <button type="button" onClick={() => setHotkeysOpen(false)} style={modalCloseStyle}>
              Sluiten
            </button>
          </div>
          <div style={{ ...modalBodyStyle, paddingTop: 10 }}>
            <p style={{ margin: "0 0 12px", color: "var(--text-muted)" }}>
              Overzicht van sneltoetsen in dit dashboard.
            </p>
            <table style={hotkeysTableStyle}>
              <thead>
                <tr>
                  <th style={hotkeysThStyle}>Toets</th>
                  <th style={hotkeysThStyle}>Actie</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={hotkeysTdStyle}><span style={hotkeysKeyStyle}>M</span></td>
                  <td style={hotkeysTdStyle}>Zet de datumselectie op de laatste maand.</td>
                </tr>
                <tr>
                  <td style={hotkeysTdStyle}><span style={hotkeysKeyStyle}>J</span></td>
                  <td style={hotkeysTdStyle}>Zet de datumselectie op het laatste jaar.</td>
                </tr>
                <tr>
                  <td style={hotkeysTdStyle}><span style={hotkeysKeyStyle}>R</span></td>
                  <td style={hotkeysTdStyle}>Reset alle filters naar de standaardwaarden.</td>
                </tr>
                <tr>
                  <td style={hotkeysTdStyle}><span style={hotkeysKeyStyle}>F</span></td>
                  <td style={hotkeysTdStyle}>Open het filterscherm.</td>
                </tr>
                <tr>
                  <td style={hotkeysTdStyle}><span style={hotkeysKeyStyle}>S</span></td>
                  <td style={hotkeysTdStyle}>Start een synchronisatie (of toont dat sync al loopt).</td>
                </tr>
                <tr>
                  <td style={hotkeysTdStyle}><span style={hotkeysKeyStyle}>Esc</span></td>
                  <td style={hotkeysTdStyle}>Sluit open panelen zoals deze popup en andere dialogen.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {isLayoutEditing ? (
        <div
          style={{ ...hiddenOverlayStyle, ...(hiddenDropTarget === "overlay" ? hiddenOverlayDropStyle : null) }}
          onDragOver={(e) => {
            e.preventDefault();
            if (dragStateRef.current?.kind === "kpi" || dragStateRef.current?.kind === "card") {
              setHiddenDropTarget("overlay");
            }
          }}
          onDragLeave={() => setHiddenDropTarget((prev) => (prev === "overlay" ? null : prev))}
          onDrop={hideDraggedToOverlay}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <h3 style={hiddenOverlayTitleStyle}>Verborgen kaarten</h3>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" onClick={toggleTvMode} style={filterOpenButtonStyle}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M3 5h18v12H3zM8 19h8"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {isTvMode ? "TV-modus uit" : "TV-modus aan"}
              </button>
              <button type="button" onClick={resetLayoutAndClose} style={filterOpenButtonStyle}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v6h-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Opnieuw beginnen
              </button>
              <button type="button" onClick={saveDashboardLayout} style={layoutPrimaryButtonStyle} disabled={!layoutDirty}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M5 3h11l3 3v15H5zM8 3v6h8V3M8 21v-7h8v7"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Opslaan layout
              </button>
            </div>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Sleep een kaart hierheen om te verbergen, of sleep vanuit hier terug naar een rij.
          </div>
          <div>
            <div style={{ ...labelStyle, marginBottom: 4 }}>KPI kaarten</div>
            <div
              style={{ ...hiddenPoolStyle, ...(hiddenDropTarget === "kpi" ? hiddenPoolDropStyle : null) }}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragStateRef.current?.kind === "kpi") setHiddenDropTarget("kpi");
              }}
              onDragLeave={() => setHiddenDropTarget((prev) => (prev === "kpi" ? null : prev))}
              onDrop={() => {
                hideKpi();
                setHiddenDropTarget(null);
              }}
            >
              {hiddenDropTarget === "kpi" ? (
                <div style={hiddenDropCueStyle}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M4 7h16M10 3h4M7 7l1 13h8l1-13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Loslaten om KPI-kaart te verbergen
                </div>
              ) : null}
              {hiddenKpiKeys.length ? hiddenKpiKeys.map((key) => (
                <span
                  key={`hidden-kpi-${key}`}
                  style={hiddenChipStyle}
                  draggable
                  onDragStart={() => startDrag("kpi", key, { zone: "hiddenKpi" })}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => moveKpiToVisible(key)}
                >
                  <span style={dragHandleStyle} aria-hidden>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                      <circle cx="2" cy="2" r="1" />
                      <circle cx="2" cy="5" r="1" />
                      <circle cx="2" cy="8" r="1" />
                      <circle cx="8" cy="2" r="1" />
                      <circle cx="8" cy="5" r="1" />
                      <circle cx="8" cy="8" r="1" />
                    </svg>
                  </span>
                  {kpiTiles[key]?.label || key}
                </span>
              )) : <span style={{ color: "var(--text-faint)", fontSize: 12 }}>Geen verborgen KPI-kaarten</span>}
            </div>
          </div>
          <div>
            <div style={{ ...labelStyle, marginBottom: 4 }}>Overige kaarten</div>
            <div
              style={{ ...hiddenPoolStyle, ...(hiddenDropTarget === "card" ? hiddenPoolDropStyle : null) }}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragStateRef.current?.kind === "card") setHiddenDropTarget("card");
              }}
              onDragLeave={() => setHiddenDropTarget((prev) => (prev === "card" ? null : prev))}
              onDrop={() => {
                hideCard();
                setHiddenDropTarget(null);
              }}
            >
              {hiddenDropTarget === "card" ? (
                <div style={hiddenDropCueStyle}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M4 7h16M10 3h4M7 7l1 13h8l1-13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Loslaten om kaart te verbergen
                </div>
              ) : null}
              {hiddenCardKeys.length ? hiddenCardKeys.map((key) => (
                <span
                  key={`hidden-card-${key}`}
                  style={hiddenChipStyle}
                  draggable
                  onDragStart={() => startDrag("card", key, { zone: "hiddenCard" })}
                >
                  <span style={dragHandleStyle} aria-hidden>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                      <circle cx="2" cy="2" r="1" />
                      <circle cx="2" cy="5" r="1" />
                      <circle cx="2" cy="8" r="1" />
                      <circle cx="8" cy="2" r="1" />
                      <circle cx="8" cy="5" r="1" />
                      <circle cx="8" cy="8" r="1" />
                    </svg>
                  </span>
                  {cardTitleByKey(key)}
                </span>
              )) : <span style={{ color: "var(--text-faint)", fontSize: 12 }}>Geen verborgen overige kaarten</span>}
            </div>
          </div>
        </div>
      ) : null}

      <div
        aria-hidden={!sidePanelOpen}
        onClick={closeSidePanel}
        style={{
          position: "fixed",
          inset: 0,
          background: "var(--overlay-soft)",
          opacity: sidePanelOpen ? 1 : 0,
          pointerEvents: sidePanelOpen ? "auto" : "none",
          transition: "opacity 200ms ease",
          zIndex: 1200,
        }}
      />

      <div
        aria-hidden={!sidePanelOpen}
        role="dialog"
        aria-modal="true"
        aria-label={sidePanelMode === "alerts" ? "Alerts logboek" : sidePanelMode === "insights" ? "AI inzichtenlog" : "Drilldown"}
        onClick={(e) => e.stopPropagation()}
        ref={drillPanelRef}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          height: "100vh",
          width: "min(60vw, 1200px)",
          background: "var(--surface)",
          boxShadow: "0 10px 30px var(--shadow-medium)",
          transform: sidePanelOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 200ms ease",
          zIndex: 1201,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-strong)", display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            {sidePanelMode === "alerts" ? (
              <>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Alerts</div>
                <div style={{ fontSize: 16 }}>
                  Alerts logboek — <b>{filteredAlertLogGroups.length}</b> groepen / <b>{alertLogEntries.length}</b> gebeurtenissen
                </div>
              </>
            ) : sidePanelMode === "insights" ? (
              <>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>AI inzichten</div>
                <div style={{ fontSize: 16 }}>
                  Inzichtenlog — <b>{insightLogEntries.length}</b> items
                  {selectedInsightId ? (
                    <>
                      {" "}— focus op <b>#{selectedInsightId}</b>
                    </>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Drilldown</div>
                <div style={{ fontSize: 16 }}>
                  Week vanaf <b>{fmtDate(selectedWeek)}</b>
                  {" "}— basis: <b>{selectedDrillBasisLabel}</b>
                  {selectedType ? (
                    <>
                      {" "}— type: <b style={{ color: typeColor(selectedType) }}>{selectedType}</b>
                    </>
                  ) : null}
                  {selectedOnderwerp ? (
                    <>
                      {" "}— onderwerp: <b>{selectedOnderwerp}</b>
                    </>
                  ) : null}
                </div>
              </>
            )}
          </div>
          <button
            onClick={closeSidePanel}
            aria-label="Sluiten"
            title="Sluiten"
            ref={drillCloseRef}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "6px 10px",
              cursor: "pointer",
              height: 34,
            }}
          >
            Sluiten
          </button>
        </div>

        {sidePanelMode === "alerts" ? (
          <div style={{ padding: "10px 20px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ color: "var(--text-muted)" }}>
                Meest recente alerts bovenaan
              </span>
              <label style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: 8 }}>
                <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Soort</span>
                <select
                  value={alertKindFilter}
                  onChange={(e) => setAlertKindFilter(e.target.value)}
                  style={{ ...inputBaseStyle, minWidth: 180, width: "auto" }}
                >
                  <option value="ALL">Alles</option>
                  {availableAlertKindFilters.map((kind) => (
                    <option key={kind} value={kind}>
                      {alertKindLabel(kind)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                onClick={() => {
                  if (typeof window !== "undefined") {
                    const ok = window.confirm("Weet je zeker dat je dit alertlogboek wilt legen?");
                    if (!ok) return;
                  }
                  clearAlertLogs();
                }}
                disabled={clearAlertLogsBusy || !hasClearableAlertEntries}
                style={{
                  marginLeft: "auto",
                  background: clearAlertLogsBusy ? "var(--surface-muted)" : "#fff5f5",
                  color: "#991b1b",
                  border: "1px solid color-mix(in srgb, #b91c1c 40%, var(--border))",
                  borderRadius: 8,
                  padding: "6px 10px",
                  cursor: clearAlertLogsBusy || !hasClearableAlertEntries ? "not-allowed" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M4 7h16M9 7V5h6v2m-8 0l1 12h8l1-12M10 11v5m4-5v5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {clearAlertLogsBusy ? "Legen..." : "Logboek legen"}
              </button>
            </div>
          </div>
        ) : sidePanelMode === "insights" ? (
          <div style={{ padding: "10px 20px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ color: "var(--text-muted)" }}>
                Threshold <b>{activeAiThresholdPct}%</b> · maximaal <b>3</b> actieve AI-cards
              </span>
              <button onClick={() => refreshInsightLog()} style={{ marginLeft: "auto" }}>
                Vernieuwen
              </button>
            </div>
          </div>
        ) : (
          <div style={{ padding: "10px 20px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button
                onClick={() =>
                  fetchDrilldown(
                    selectedWeek,
                    selectedType,
                    selectedOnderwerp,
                    Math.max(0, drillOffset - DRILL_LIMIT),
                    { dateField: selectedDrillDateField, basisLabel: selectedDrillBasisLabel }
                  )
                }
                disabled={!selectedWeek || drillOffset === 0 || drillLoading}
              >
                Vorige
              </button>
              <button
                onClick={() =>
                  fetchDrilldown(
                    selectedWeek,
                    selectedType,
                    selectedOnderwerp,
                    drillOffset + DRILL_LIMIT,
                    { dateField: selectedDrillDateField, basisLabel: selectedDrillBasisLabel }
                  )
                }
                disabled={!selectedWeek || !drillHasNext || drillLoading}
              >
                Volgende
              </button>
              <span style={{ color: "var(--text-muted)" }}>
                rijen {drillOffset + 1}–{drillOffset + drillIssues.length}
              </span>
              <span style={{ color: "var(--text-faint)" }}>•</span>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={showPriority}
                  onChange={(e) => setShowPriority(e.target.checked)}
                />
                Priority
              </label>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={showAssignee}
                  onChange={(e) => setShowAssignee(e.target.checked)}
                />
                Assignee
              </label>
            </div>
          </div>
        )}

        <div style={{ padding: "12px 20px", overflow: "auto", flex: 1 }}>
          {sidePanelMode === "alerts" ? (
            alertLogEntries.length ? (
              filteredAlertLogGroups.length ? (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: "8px" }}>Tijd</th>
                        <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: "8px" }}>Soort</th>
                        <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: "8px" }}>Issue</th>
                        <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: "8px" }}>Laatste info</th>
                        <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: "8px" }}>Aantal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAlertLogGroups.map((group) => {
                        const expanded = !!expandedAlertGroups[group.key];
                        return (
                          <Fragment key={group.key}>
                            <tr>
                              <td style={{ borderBottom: "1px solid var(--border)", padding: "8px" }}>
                                {fmtDateTime(group.latest_detected_at)}
                              </td>
                              <td style={{ borderBottom: "1px solid var(--border)", padding: "8px" }}>
                                <span style={alertKindPillStyle(group.kind)}>{alertKindLabel(group.kind)}</span>
                              </td>
                              <td style={{ borderBottom: "1px solid var(--border)", padding: "8px" }}>
                                {group.kind === "LOGBOOK_EVENT" ? (
                                  "—"
                                ) : (
                                  <a href={`${JIRA_BASE}/browse/${group.issue_key}`} target="_blank" rel="noreferrer">
                                    {group.issue_key}
                                  </a>
                                )}
                              </td>
                              <td style={{ borderBottom: "1px solid var(--border)", padding: "8px" }}>
                                {group.kind === "LOGBOOK_EVENT"
                                  ? formatAlertLogbookClearMessage(group.latest_detected_at, group.status)
                                  : (group.latest_meta || "—")}
                              </td>
                              <td style={{ borderBottom: "1px solid var(--border)", padding: "8px" }}>
                                {group.count > 1 ? (
                                  <button
                                    onClick={() => toggleAlertGroup(group.key)}
                                    aria-label={expanded ? "Inklappen" : "Uitklappen"}
                                    title={expanded ? "Inklappen" : "Uitklappen"}
                                    style={{
                                      border: "1px solid var(--border)",
                                      borderRadius: 6,
                                      background: "var(--surface)",
                                      padding: "4px 8px",
                                      cursor: "pointer",
                                    }}
                                  >
                                    {expanded ? "▲" : "▼"} ({group.count}x)
                                  </button>
                                ) : (
                                  ""
                                )}
                              </td>
                            </tr>
                            {expanded ? (
                              <tr>
                                <td colSpan={5} style={{ padding: "0 8px 10px 8px", background: "var(--surface-muted)" }}>
                                  <div style={{ padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, marginTop: 6 }}>
                                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
                                      Detailhistorie ({group.count} gebeurtenissen)
                                    </div>
                                    <div style={{ overflowX: "auto" }}>
                                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                        <thead>
                                          <tr>
                                            <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: "6px" }}>Tijd</th>
                                            <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: "6px" }}>Info</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {group.entries.map((entry) => (
                                            <tr key={entry.id}>
                                              <td style={{ borderBottom: "1px solid var(--border)", padding: "6px" }}>
                                                {fmtDateTime(entry.detected_at)}
                                              </td>
                                              <td style={{ borderBottom: "1px solid var(--border)", padding: "6px" }}>{entry.meta || "—"}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ color: "var(--text-muted)" }}>Geen alerts gevonden voor deze soort.</div>
              )
            ) : (
              <div style={{ color: "var(--text-muted)" }}>Nog geen alerts in dit logboek.</div>
            )
          ) : sidePanelMode === "insights" ? (
            insightLogEntries.length ? (
              <div style={{ display: "grid", gap: 12 }}>
                {insightLogEntries.map((item) => {
                  const expanded = !!expandedInsightIds[item.id];
                  const highlighted = selectedInsightId && String(item.id) === String(selectedInsightId);
                  const sourceCurrent = item.source_payload?.current || {};
                  const sourcePrevious = item.source_payload?.previous || {};
                  const sourceLabel = item.source_payload?.label || null;
                  return (
                    <div
                      key={item.id}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        padding: 14,
                        background: highlighted ? "color-mix(in srgb, var(--accent) 8%, var(--surface))" : "var(--surface)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                        <div style={{ display: "grid", gap: 6 }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <strong>{item.title}</strong>
                            <span style={fixedMetricBadgeStyle}>{Math.round(item.score_pct)}%</span>
                            {item.feedback_status !== "pending" ? <span style={fixedMetricBadgeStyle}>{item.feedback_status}</span> : null}
                          </div>
                          <div style={{ color: "var(--text-muted)" }}>{item.summary}</div>
                          <div style={{ fontSize: 12, color: "var(--text-faint)" }}>
                            {fmtDateTime(item.detected_at)} · kaart: {cardTitleByKey(item.target_card_key)}
                            {item.feedback_reason ? ` · reden: ${item.feedback_reason}` : ""}
                          </div>
                        </div>
                        <button type="button" onClick={() => toggleInsightLogItem(item.id)} style={filterOpenButtonStyle}>
                          {expanded ? "Verberg brondata" : "Toon brondata"}
                        </button>
                      </div>
                      {expanded ? (
                        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                          <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                            {sourceLabel ? `${sourceLabel} · ` : ""}afwijking: {item.deviation_pct == null ? "—" : `${pct(item.deviation_pct)} vs vorige periode`}
                          </div>
                          <div style={{ overflowX: "auto" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse" }}>
                              <thead>
                                <tr>
                                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: "8px" }}>Meting</th>
                                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: "8px" }}>Huidig</th>
                                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: "8px" }}>Vorig</th>
                                </tr>
                              </thead>
                              <tbody>
                                {Object.keys({ ...sourceCurrent, ...sourcePrevious })
                                  .filter((key) => key !== "week_start")
                                  .map((key) => (
                                    <tr key={`${item.id}-${key}`}>
                                      <td style={{ borderBottom: "1px solid var(--border)", padding: "8px" }}>{key}</td>
                                      <td style={{ borderBottom: "1px solid var(--border)", padding: "8px" }}>{String(sourceCurrent?.[key] ?? "—")}</td>
                                      <td style={{ borderBottom: "1px solid var(--border)", padding: "8px" }}>{String(sourcePrevious?.[key] ?? "—")}</td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ color: "var(--text-muted)" }}>Nog geen AI-inzichten in het logboek.</div>
            )
          ) : drillLoading ? (
            <div>Bezig met laden…</div>
          ) : selectedWeek ? (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: "8px" }}>Key</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: "8px" }}>Type</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: "8px" }}>Onderwerp</th>
                    {showPriority ? (
                      <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: "8px" }}>
                        Priority
                      </th>
                    ) : null}
                    {showAssignee ? (
                      <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: "8px" }}>
                        Assignee
                      </th>
                    ) : null}
                    <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: "8px" }}>Status</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: "8px" }}>Created</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: "8px" }}>Resolved</th>
                  </tr>
                </thead>
                <tbody>
                  {drillIssues.map((x) => (
                    <tr key={x.issue_key}>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: "8px" }}>
                        <a href={`${JIRA_BASE}/browse/${x.issue_key}`} target="_blank" rel="noreferrer">
                          {x.issue_key}
                        </a>
                      </td>
                      <td
                        style={{
                          borderBottom: "1px solid var(--border)",
                          padding: "8px",
                          color: typeColor(x.request_type),
                        }}
                      >
                        {x.request_type || ""}
                      </td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: "8px" }}>{x.onderwerp || ""}</td>
                      {showPriority ? (
                        <td style={{ borderBottom: "1px solid var(--border)", padding: "8px" }}>
                          {x.priority || ""}
                        </td>
                      ) : null}
                      {showAssignee ? (
                        <td style={{ borderBottom: "1px solid var(--border)", padding: "8px" }}>
                          {x.assignee || ""}
                        </td>
                      ) : null}
                      <td style={{ borderBottom: "1px solid var(--border)", padding: "8px" }}>{x.status || ""}</td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: "8px" }}>{fmtDate(x.created_at)}</td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: "8px" }}>{fmtDate(x.resolved_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ marginTop: 8, color: "var(--text-muted)" }}>
                {drillIssues.length} tickets (limit {DRILL_LIMIT}, offset {drillOffset})
              </div>
            </div>
          ) : (
            <div style={{ color: "var(--text-muted)" }}>Klik op een punt in “Aantal tickets per week” om tickets te zien.</div>
          )}
        </div>
      </div>

      {syncStatus ? (
        <Link href="/status" title="Open statuspagina" style={{ textDecoration: "none" }}>
          <div title={syncStatusInlineText} style={{ ...syncDockStyle, cursor: "pointer" }}>
            {syncStatusInlineText}
          </div>
        </Link>
      ) : null}

      <style jsx global>{`
        :root {
          color-scheme: light dark;
          --page-bg: #f1f5f9;
          --surface: #ffffff;
          --surface-muted: #f8fafc;
          --text-main: #0f172a;
          --text-subtle: #334155;
          --text-muted: #64748b;
          --text-faint: #94a3b8;
          --border: #cbd5e1;
          --border-strong: #e2e8f0;
          --accent: #2563eb;
          --danger: #dc2626;
          --ok: #15803d;
          --overlay-bg: rgba(15, 23, 42, 0.55);
          --overlay-soft: rgba(0, 0, 0, 0.35);
          --shadow-medium: rgba(0, 0, 0, 0.25);
          --shadow-strong: rgba(2, 6, 23, 0.35);
          --indicator-border: rgba(0, 0, 0, 0.15);
        }
        @media (prefers-color-scheme: dark) {
          :root {
            --page-bg: #020617;
            --surface: #0f172a;
            --surface-muted: #111c31;
            --text-main: #e5e7eb;
            --text-subtle: #cbd5e1;
            --text-muted: #94a3b8;
            --text-faint: #64748b;
            --border: #334155;
            --border-strong: #475569;
            --accent: #60a5fa;
            --danger: #f87171;
            --ok: #4ade80;
            --overlay-bg: rgba(2, 6, 23, 0.72);
            --overlay-soft: rgba(2, 6, 23, 0.55);
            --shadow-medium: rgba(0, 0, 0, 0.45);
            --shadow-strong: rgba(0, 0, 0, 0.62);
            --indicator-border: rgba(148, 163, 184, 0.35);
          }
        }
        html,
        body {
          background: var(--page-bg);
          color: var(--text-main);
          margin: 0;
          height: 100%;
          overflow: hidden;
        }
        input,
        select,
        textarea,
        button {
          color: var(--text-main);
        }
        button:disabled {
          opacity: 0.5;
          cursor: not-allowed !important;
          filter: grayscale(0.2);
          box-shadow: none !important;
        }
        a {
          color: var(--accent);
        }
        .card-expand-title {
          transition: transform 160ms ease, color 160ms ease, opacity 160ms ease;
        }
        .card-expand-title:hover {
          transform: translateY(-1px);
          color: var(--accent);
        }
        .card-expand-title:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 3px;
          border-radius: 6px;
        }
        .dashboard-card-shell canvas {
          max-height: 80% !important;
          height: 80% !important;
        }
        .vacation-row:hover .vacation-row-actions,
        .vacation-row:focus-within .vacation-row-actions {
          opacity: 1;
          pointer-events: auto;
        }
        @keyframes overlayIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes modalIn {
          from {
            opacity: 0;
            transform: translateY(12px) scale(0.985);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes alertIn {
          from {
            opacity: 0;
            transform: translateY(-8px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes dashSkeletonWave {
          0% {
            background-position: 220% 0;
          }
          100% {
            background-position: -20% 0;
          }
        }
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes dropPulse {
          0% {
            background-position: 180% 0;
            opacity: 0.66;
          }
          50% {
            opacity: 1;
          }
          100% {
            background-position: -30% 0;
            opacity: 0.66;
          }
        }
      `}</style>
    </div>
  );
}
