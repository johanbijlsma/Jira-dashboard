import { Bar, Doughnut, Line, Pie } from "react-chartjs-2";
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
import { useEffect, useMemo, useRef, useState } from "react";

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

const API = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";
const JIRA_BASE = "https://planningsagenda.atlassian.net";
const DEFAULT_SERVICEDESK_ONLY = true;
const DEFAULT_ONDERWERP_VIEW_MODE = "top5_overig";

function isoDate(d) {
  // yyyy-mm-dd
  return d.toISOString().slice(0, 10);
}

function fmtDate(value) {
  if (!value) return "";
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(dt);
}


function fmtDateTime(value) {
  if (!value) return "";
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(dt);
}

function parseNlDateToIso(value) {
  // accepts dd/mm/yyyy (also allow dd-mm-yyyy)
  if (!value) return "";
  const v = String(value).trim();
  const m = v.match(/^\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s*$/);
  if (!m) return "";
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (!yyyy || mm < 1 || mm > 12 || dd < 1 || dd > 31) return "";
  // Validate by round-tripping through UTC
  const dt = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (dt.getUTCFullYear() !== yyyy || dt.getUTCMonth() !== mm - 1 || dt.getUTCDate() !== dd) return "";
  return dt.toISOString().slice(0, 10);
}

function Toast({ message, kind, onClose }) {
  if (!message) return null;

  const bg = kind === "error" ? "#b00020" : "#1b5e20";

  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 9999,
        background: bg,
        color: "#fff",
        padding: "10px 12px",
        borderRadius: 8,
        boxShadow: "0 6px 18px rgba(0,0,0,0.18)",
        maxWidth: 420,
        display: "flex",
        gap: 10,
        alignItems: "center",
      }}
      role="status"
      aria-live="polite"
    >
      <div style={{ flex: 1 }}>{message}</div>
      <button
        onClick={onClose}
        style={{
          background: "transparent",
          border: "none",
          color: "#fff",
          cursor: "pointer",
          fontSize: 16,
          lineHeight: 1,
        }}
        aria-label="Sluiten"
        title="Sluiten"
      >
        ×
      </button>
    </div>
  );
}

function hasDataPoints(chartData) {
  if (!chartData || !Array.isArray(chartData.datasets)) return false;
  return chartData.datasets.some((ds) =>
    Array.isArray(ds.data) && ds.data.some((v) => typeof v === "number" && v > 0)
  );
}

function EmptyChartState({ onReset }) {
  return (
    <div
      style={{
        border: "1px dashed var(--border)",
        borderRadius: 8,
        padding: "14px 12px",
        color: "var(--text-muted)",
        display: "flex",
        gap: 10,
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
      }}
    >
      <span>Geen issues gevonden voor deze filtercombinatie.</span>
      <button type="button" onClick={onReset}>
        Reset filters
      </button>
    </div>
  );
}

export default function Home() {
  const today = useMemo(() => new Date(), []);
  const defaultFrom = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d;
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
  const [servicedeskOnly, setServicedeskOnly] = useState(DEFAULT_SERVICEDESK_ONLY);

  const [meta, setMeta] = useState({ request_types: [], onderwerpen: [], priorities: [], assignees: [] });
  const [volume, setVolume] = useState([]);
  const [onderwerpVolume, setOnderwerpVolume] = useState([]);
  const [priorityVolume, setPriorityVolume] = useState([]);
  const [assigneeVolume, setAssigneeVolume] = useState([]);
  const [p90, setP90] = useState([]);

  const [syncStatus, setSyncStatus] = useState(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [syncMessageKind, setSyncMessageKind] = useState("success"); // "success" | "error"

  const [selectedWeek, setSelectedWeek] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const [selectedOnderwerp, setSelectedOnderwerp] = useState("");
  const [onderwerpChartMode, setOnderwerpChartMode] = useState("line");
  const [onderwerpViewMode, setOnderwerpViewMode] = useState(DEFAULT_ONDERWERP_VIEW_MODE);
  const [drillIssues, setDrillIssues] = useState([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillOffset, setDrillOffset] = useState(0);
  const [drillHasNext, setDrillHasNext] = useState(false);
  const drillPanelRef = useRef(null);
  const drillCloseRef = useRef(null);
  const [showPriority, setShowPriority] = useState(false);
  const [showAssignee, setShowAssignee] = useState(false);
  const [expandedCard, setExpandedCard] = useState("");
  const autoSyncAttemptRef = useRef(0);

  const DRILL_LIMIT = 100;
  const syncBusy = syncLoading || !!syncStatus?.running;
  const activeFilterItems = useMemo(() => {
    const items = [];
    if (requestType) items.push(`Type: ${requestType}`);
    if (onderwerp) items.push(`Onderwerp: ${onderwerp}`);
    if (priority) items.push(`Prioriteit: ${priority}`);
    if (assignee) items.push(`Assignee: ${assignee}`);
    if (servicedeskOnly !== DEFAULT_SERVICEDESK_ONLY) {
      items.push(servicedeskOnly ? "Scope: alleen servicedesk" : "Scope: alle tickets");
    }
    return items;
  }, [
    requestType,
    onderwerp,
    priority,
    assignee,
    servicedeskOnly,
  ]);

  function closeDrilldown() {
    setSelectedWeek("");
    setSelectedType("");
    setSelectedOnderwerp("");
    setDrillIssues([]);
    setDrillOffset(0);
    setDrillHasNext(false);
  }

  function flashToast(message, kind = "success", ms = 3000) {
    setSyncMessage(message);
    setSyncMessageKind(kind);
    if (ms > 0) setTimeout(() => setSyncMessage(""), ms);
  }

  function applyDateRange({ months = 0, years = 0, days = 0 }) {
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
  }

  function resetFilters(showToast = true) {
    setRequestType("");
    setOnderwerp("");
    setPriority("");
    setAssignee("");
    setServicedeskOnly(DEFAULT_SERVICEDESK_ONLY);
    setOnderwerpViewMode(DEFAULT_ONDERWERP_VIEW_MODE);
    if (showToast) flashToast("Filters gereset");
  }

  useEffect(() => {
    fetch(`${API}/meta`).then((r) => r.json()).then(setMeta);
  }, []);

  useEffect(() => {
    fetch(`${API}/sync/status`)
      .then((r) => r.json())
      .then(setSyncStatus)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      fetch(`${API}/sync/status`)
        .then((r) => r.json())
        .then(setSyncStatus)
        .catch(() => {});
    }, 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!syncStatus || syncBusy) return;
    const lastSyncRaw = syncStatus.last_sync;
    const lastSync = lastSyncRaw ? new Date(lastSyncRaw) : null;
    const now = Date.now();
    const isStale =
      !lastSync || Number.isNaN(lastSync.getTime()) || now - lastSync.getTime() > 60 * 60 * 1000;
    if (!isStale) return;

    // Throttle automatic retries when sync fails or takes long.
    if (now - autoSyncAttemptRef.current < 10 * 60 * 1000) return;
    autoSyncAttemptRef.current = now;
    triggerSync().catch(() => {});
  }, [syncStatus, syncBusy]);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key?.toLowerCase();
      if (!["m", "j", "r", "s"].includes(key)) return;
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
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [syncBusy]);

  useEffect(() => {
    if (!selectedWeek) return;
    function onKeyDown(e) {
      if (e.key === "Escape") closeDrilldown();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedWeek]);

  useEffect(() => {
    if (!expandedCard) return;
    function onKeyDown(e) {
      if (e.key === "Escape") setExpandedCard("");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expandedCard]);

  useEffect(() => {
    if (!selectedWeek) return;
    const t = setTimeout(() => {
      drillCloseRef.current?.focus?.();
    }, 0);
    return () => clearTimeout(t);
  }, [selectedWeek]);

  useEffect(() => {
    if (!selectedWeek) return;
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
  }, [selectedWeek]);

  useEffect(() => {
    const params = new URLSearchParams({
      date_from: dateFrom,
      date_to: dateTo,
    });
    if (requestType) params.set("request_type", requestType);
    if (onderwerp) params.set("onderwerp", onderwerp);
    if (priority) params.set("priority", priority);
    if (assignee) params.set("assignee", assignee);
    if (servicedeskOnly) params.set("servicedesk_only", "true");

    fetch(`${API}/metrics/volume_weekly?` + params.toString())
      .then((r) => r.json())
      .then(setVolume);

    fetch(`${API}/metrics/volume_weekly_by_onderwerp?` + params.toString())
      .then((r) => r.json())
      .then((data) => (Array.isArray(data) ? setOnderwerpVolume(data) : setOnderwerpVolume([])));

    fetch(`${API}/metrics/volume_by_priority?` + params.toString())
      .then((r) => r.json())
      .then((data) => (Array.isArray(data) ? setPriorityVolume(data) : setPriorityVolume([])));

    fetch(`${API}/metrics/volume_by_assignee?` + params.toString())
      .then((r) => r.json())
      .then((data) => (Array.isArray(data) ? setAssigneeVolume(data) : setAssigneeVolume([])));

    const p = new URLSearchParams({
      date_from: dateFrom,
      date_to: dateTo,
    });
    if (onderwerp) p.set("onderwerp", onderwerp);
    if (priority) p.set("priority", priority);
    if (assignee) p.set("assignee", assignee);
    if (servicedeskOnly) p.set("servicedesk_only", "true");

    fetch(`${API}/metrics/leadtime_p90_by_type?` + p.toString())
      .then((r) => r.json())
      .then(setP90);
  }, [dateFrom, dateTo, requestType, onderwerp, priority, assignee, servicedeskOnly]);

  function buildWeekStarts(fromIso, toIso) {
    if (!fromIso || !toIso) return [];
    const [fy, fm, fd] = fromIso.split("-").map(Number);
    const [ty, tm, td] = toIso.split("-").map(Number);
    const from = new Date(Date.UTC(fy, fm - 1, fd));
    const to = new Date(Date.UTC(ty, tm - 1, td));
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return [];

    // Align to Monday (Postgres date_trunc('week') start)
    const day = from.getUTCDay(); // 0=Sun..6=Sat
    const diff = (day + 6) % 7; // days since Monday
    from.setUTCDate(from.getUTCDate() - diff);

    const weeks = [];
    const cursor = new Date(from);
    while (cursor <= to) {
      weeks.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
    return weeks;
  }

  // volume -> weeks x series (use full range so empty weeks show as 0)
  const weeks = useMemo(() => buildWeekStarts(dateFrom, dateTo), [dateFrom, dateTo]);
  const weeksOnderwerp = useMemo(() => buildWeekStarts(dateFrom, dateTo), [dateFrom, dateTo]);

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
    const subjects = onderwerp ? [onderwerp] : meta.onderwerpen;
    const base = subjects.map((o) => ({
      label: o,
      data: weeksOnderwerp.map((w) => {
        const row = data.find((v) => v.onderwerp === o && v.week.slice(0, 10) === w);
        return row ? row.tickets : 0;
      }),
    }));
    if (onderwerp || onderwerpViewMode !== "top5_overig") return base;

    const withTotals = base
      .map((s) => ({ ...s, total: s.data.reduce((sum, n) => sum + n, 0) }))
      .sort((a, b) => b.total - a.total);
    const top = withTotals.slice(0, 5).map(({ total, ...rest }) => rest);
    const rest = withTotals.slice(5);
    if (!rest.length) return top;

    return [
      ...top,
      {
        label: "Overig",
        data: weeksOnderwerp.map((_, i) => rest.reduce((sum, s) => sum + (s.data[i] || 0), 0)),
      },
    ];
  }, [weeksOnderwerp, onderwerpVolume, meta.onderwerpen, onderwerp, onderwerpViewMode]);

  const TYPE_COLORS = {
    rfc: "#2e7d32",
    incident: "#c62828",
    incidenten: "#c62828",
    "service request": "#1565c0",
    vraag: "#e65100",
    vragen: "#e65100",
    totaal: "#374151",
  };

  function typeColor(label) {
    const key = String(label || "").toLowerCase();
    return TYPE_COLORS[key] || "#6b7280";
  }

  function uniqueChartColor(index, total, saturation = 70, lightness = 45) {
    const safeTotal = Math.max(1, total);
    const hue = (index * (360 / safeTotal) + 15) % 360;
    return `hsl(${hue.toFixed(2)} ${saturation}% ${lightness}%)`;
  }

  function isTotalLabel(label) {
    return String(label || "").toLowerCase() === "totaal";
  }

  function median(values) {
    const v = values.filter((x) => x != null).slice().sort((a, b) => a - b);
    if (!v.length) return null;
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  }

  function weekStartIso(d = new Date()) {
    const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = dt.getUTCDay();
    const diff = (day + 6) % 7; // days since Monday
    dt.setUTCDate(dt.getUTCDate() - diff);
    return dt.toISOString().slice(0, 10);
  }

  const lineData = useMemo(
    () => {
      const labels = weeks.map((w) => fmtDate(w));
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

      const currentWeek = weekStartIso();
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
    [weeks, series]
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
        const currentWeek = weekStartIso();
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

      return {
        labels: weeksOnderwerp.map((w) => fmtDate(w)),
        datasets,
      };
    },
    [weeksOnderwerp, onderwerpSeries, onderwerp]
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
          label: "Totaal issues per priority",
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
    return data.slice(0, 3);
  }, [assigneeVolume]);

  const assigneeColors = useMemo(
    () => assigneeTopVolume.map((_, i) => uniqueChartColor(i, assigneeTopVolume.length)),
    [assigneeTopVolume]
  );

  const assigneeBarData = useMemo(
    () => ({
      labels: assigneeTopVolume.map((x) => x.assignee),
      datasets: [
        {
          label: "Totaal issues per assignee",
          data: assigneeTopVolume.map((x) => x.tickets),
          backgroundColor: assigneeColors,
          borderColor: assigneeColors,
        },
      ],
    }),
    [assigneeTopVolume, assigneeColors]
  );

  const onderwerpPieData = useMemo(() => {
    const data = Array.isArray(onderwerpVolume) ? onderwerpVolume : [];
    const subjects = onderwerp ? [onderwerp] : meta.onderwerpen;
    const totals = subjects.map((o) => ({
      onderwerp: o,
      total: data.reduce((sum, v) => (v.onderwerp === o ? sum + v.tickets : sum), 0),
    }));
    totals.sort((a, b) => b.total - a.total);
    const displayTotals =
      onderwerp || onderwerpViewMode !== "top5_overig" || totals.length <= 5
        ? totals
        : [
            ...totals.slice(0, 5),
            {
              onderwerp: "Overig",
              total: totals.slice(5).reduce((sum, t) => sum + t.total, 0),
            },
          ];
    return {
      labels: displayTotals.map((t) => t.onderwerp),
      datasets: [
        {
          label: "Totaal per onderwerp",
          data: displayTotals.map((t) => t.total),
          backgroundColor: displayTotals.map((_, i) => uniqueChartColor(i, displayTotals.length)),
          borderColor: displayTotals.map((_, i) => uniqueChartColor(i, displayTotals.length)),
        },
      ],
    };
  }, [onderwerpVolume, meta.onderwerpen, onderwerp, onderwerpViewMode]);

  const barData = useMemo(
    () => ({
      labels: p90.map((x) => x.request_type),
      datasets: [
        {
          label: "p90 doorlooptijd (uren)",
          data: p90.map((x) => x.p90_hours),
          backgroundColor: p90.map((x) => typeColor(x.request_type)),
          borderColor: p90.map((x) => typeColor(x.request_type)),
        },
      ],
    }),
    [p90]
  );

  function addDays(yyyyMmDd, days) {
    // Use UTC to avoid timezone/DST off-by-one issues
    const [y, m, d] = yyyyMmDd.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().slice(0, 10);
  }

  async function fetchDrilldown(weekStart, typeLabel, onderwerpLabel, offset = 0) {
    setSelectedWeek(weekStart);
    setSelectedType(typeLabel || "");
    setSelectedOnderwerp(onderwerpLabel || onderwerp || "");
    setDrillOffset(offset);
    setDrillLoading(true);

    try {
      const weekEnd = addDays(weekStart, 7);

      const params = new URLSearchParams({
        date_from: weekStart,
        date_to: weekEnd,
        limit: String(DRILL_LIMIT),
        offset: String(offset),
      });

      if (typeLabel) params.set("request_type", typeLabel);
      if (onderwerpLabel) params.set("onderwerp", onderwerpLabel);
      else if (onderwerp) params.set("onderwerp", onderwerp);
      if (priority) params.set("priority", priority);
      if (assignee) params.set("assignee", assignee);
      if (servicedeskOnly) params.set("servicedesk_only", "true");

      const res = await fetch(`${API}/issues?` + params.toString());
      const data = await res.json();
      setDrillIssues(data);
      setDrillHasNext(Array.isArray(data) && data.length === DRILL_LIMIT);
    } finally {
      setDrillLoading(false);
    }
  }

  async function refreshSyncStatus() {
    const r = await fetch(`${API}/sync/status`);
    const s = await r.json();
    setSyncStatus(s);
    return s;
  }

  async function refreshDashboard() {
    const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
    if (requestType) params.set("request_type", requestType);
    if (onderwerp) params.set("onderwerp", onderwerp);
    if (priority) params.set("priority", priority);
    if (assignee) params.set("assignee", assignee);
    if (servicedeskOnly) params.set("servicedesk_only", "true");

    fetch(`${API}/metrics/volume_weekly?` + params.toString())
      .then((r) => r.json())
      .then(setVolume);

    fetch(`${API}/metrics/volume_weekly_by_onderwerp?` + params.toString())
      .then((r) => r.json())
      .then((data) => (Array.isArray(data) ? setOnderwerpVolume(data) : setOnderwerpVolume([])));

    fetch(`${API}/metrics/volume_by_priority?` + params.toString())
      .then((r) => r.json())
      .then((data) => (Array.isArray(data) ? setPriorityVolume(data) : setPriorityVolume([])));

    fetch(`${API}/metrics/volume_by_assignee?` + params.toString())
      .then((r) => r.json())
      .then((data) => (Array.isArray(data) ? setAssigneeVolume(data) : setAssigneeVolume([])));

    const p = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
    if (onderwerp) p.set("onderwerp", onderwerp);
    if (priority) p.set("priority", priority);
    if (assignee) p.set("assignee", assignee);
    if (servicedeskOnly) p.set("servicedesk_only", "true");

    fetch(`${API}/metrics/leadtime_p90_by_type?` + p.toString())
      .then((r) => r.json())
      .then(setP90);

    fetch(`${API}/meta`).then((r) => r.json()).then(setMeta);
  }

  async function triggerSync() {
    setSyncLoading(true);
    setSyncMessage("");

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

      const upserts = last?.last_result?.upserts;
      setSyncMessage(`Sync klaar${upserts != null ? `: ${upserts} tickets geüpdatet` : ""}`);
      setSyncMessageKind("success");
      setTimeout(() => setSyncMessage(""), 5000);
    } catch (e) {
      setSyncMessage("Sync mislukt (zie status/error)");
      setSyncMessageKind("error");
      setTimeout(() => setSyncMessage(""), 8000);
      throw e;
    } finally {
      setSyncLoading(false);
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
    border: "1px dashed var(--border)",
    borderRadius: 10,
    color: "var(--text-muted)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: 16,
  };
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
    padding: 12,
    minWidth: 0,
    height: 360,
    display: "flex",
    flexDirection: "column",
  };
  const chartBodyStyle = {
    flex: 1,
    minHeight: 0,
    position: "relative",
  };
  const pageStyle = {
    fontFamily: "system-ui",
    padding: 16,
    maxWidth: "100%",
    margin: "0 auto",
    background: "var(--page-bg)",
    color: "var(--text-main)",
  };
  const topChartsGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
    gap: 12,
    alignItems: "start",
    width: "100%",
    marginBottom: 12,
  };
  const lowerChartsGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: 12,
    alignItems: "start",
    width: "100%",
  };
  const chartTitleStyle = {
    margin: "0 0 8px",
    fontSize: 18,
    lineHeight: 1.2,
  };
  const sectionHeaderStyle = {
    display: "flex",
    gap: 8,
    alignItems: "center",
    marginBottom: 8,
    flexWrap: "wrap",
  };
  const activeFilterBarStyle = {
    marginTop: 10,
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--surface)",
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
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
    color: "var(--accent)",
    opacity: 0.9,
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
    transform: selectedWeek ? "translateX(clamp(-360px, -18vw, -96px))" : "translateX(0)",
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
    padding: 14,
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

  const cardTitles = {
    volume: "Volume per week",
    onderwerp: "Onderwerp logging",
    priority: "Issues per priority",
    assignee: "Issues per assignee",
    p90: "Doorlooptijd p90",
  };

  function renderCardContent(cardKey, expanded = false) {
    const bodyStyle = expanded ? { height: "100%", minHeight: 0, position: "relative" } : chartBodyStyle;
    const donutStyle = expanded ? { ...donutBodyStyle, minHeight: 0 } : donutBodyStyle;
    const emptyStyle = expanded ? { ...hiddenChartPlaceholderStyle, minHeight: 0 } : hiddenChartPlaceholderStyle;
    const nameSuffix = expanded ? "-modal" : "-main";

    if (cardKey === "volume") {
      return (
        <div style={bodyStyle}>
          {hasDataPoints(lineData) ? (
            <Line
              data={lineData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
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
                },
                interaction: { mode: "nearest", intersect: false },
              }}
            />
          ) : (
            <EmptyChartState onReset={() => resetFilters(true)} />
          )}
        </div>
      );
    }

    if (cardKey === "onderwerp") {
      const onderwerpContentStyle = expanded
        ? { display: "flex", flexDirection: "column", flex: 1, minHeight: 0, height: "100%" }
        : { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 };
      return (
        <div style={onderwerpContentStyle}>
          <div style={sectionHeaderStyle}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Weergave</span>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="radio"
                name={`onderwerpChartMode${nameSuffix}`}
                value="line"
                checked={onderwerpChartMode === "line"}
                onChange={() => setOnderwerpChartMode("line")}
              />
              Line
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="radio"
                name={`onderwerpChartMode${nameSuffix}`}
                value="pie"
                checked={onderwerpChartMode === "pie"}
                onChange={() => setOnderwerpChartMode("pie")}
              />
              Pie
            </label>
            <span style={{ width: 1, height: 16, background: "var(--border)", margin: "0 4px" }} />
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="radio"
                name={`onderwerpViewMode${nameSuffix}`}
                value="all"
                checked={onderwerpViewMode === "all"}
                onChange={() => setOnderwerpViewMode("all")}
              />
              Alle onderwerpen
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="radio"
                name={`onderwerpViewMode${nameSuffix}`}
                value="top5_overig"
                checked={onderwerpViewMode === "top5_overig"}
                onChange={() => setOnderwerpViewMode("top5_overig")}
              />
              Top 5 + Overig
            </label>
          </div>
          <div style={bodyStyle}>
            {onderwerpChartMode === "line" ? (
              hasDataPoints(onderwerpLineData) ? (
                <Line
                  data={onderwerpLineData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    onClick: (_evt, elements) => {
                      const el = elements?.[0];
                      if (!el) return;
                      const weekStart = weeksOnderwerp[el.index];
                      const subjectLabel = onderwerpLineData.datasets[el.datasetIndex]?.label;
                      if (!subjectLabel || subjectLabel.startsWith("Mediaan ")) return;
                      if (!subjectLabel || subjectLabel === "Overig") return;
                      setOnderwerp(subjectLabel || "");
                      fetchDrilldown(weekStart, requestType, subjectLabel);
                    },
                    plugins: {
                      legend: { display: false },
                      tooltip: { mode: "nearest", intersect: false },
                    },
                    interaction: { mode: "nearest", intersect: false },
                  }}
                />
              ) : (
                <EmptyChartState onReset={() => resetFilters(true)} />
              )
            ) : hasDataPoints(onderwerpPieData) ? (
              <Pie
                data={onderwerpPieData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  onClick: (_evt, elements) => {
                    const el = elements?.[0];
                    if (!el) return;
                    const subjectLabel = onderwerpPieData.labels?.[el.index];
                    if (!subjectLabel || subjectLabel === "Overig") return;
                    setOnderwerp(subjectLabel);
                    const weekStart = weeksOnderwerp[weeksOnderwerp.length - 1];
                    if (!weekStart) return;
                    fetchDrilldown(weekStart, requestType, subjectLabel);
                  },
                  plugins: {
                    legend: {
                      position: "right",
                    },
                  },
                }}
              />
            ) : (
              <EmptyChartState onReset={() => resetFilters(true)} />
            )}
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
                        labels: {
                          color: (ctx) => priorityColors?.[ctx.index] || "#6b7280",
                        },
                      },
                    },
                  }}
                />
              </div>
            ) : (
              <EmptyChartState onReset={() => resetFilters(true)} />
            )
          ) : (
            <div style={emptyStyle}>Verborgen omdat filter `Prioriteit` actief is.</div>
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
                        labels: {
                          color: (ctx) => assigneeColors?.[ctx.index] || "#6b7280",
                        },
                      },
                    },
                  }}
                />
              </div>
            ) : (
              <EmptyChartState onReset={() => resetFilters(true)} />
            )
          ) : (
            <div style={emptyStyle}>Verborgen omdat filter `Assignee` actief is.</div>
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
                    legend: { display: false },
                  },
                  scales: {
                    x: {
                      ticks: {
                        color: (ctx) => typeColor(ctx.tick?.label),
                      },
                    },
                  },
                }}
              />
            ) : (
              <EmptyChartState onReset={() => resetFilters(true)} />
            )}
          </div>
          <p style={{ margin: "8px 0 0", color: "var(--text-muted)", fontSize: 12 }}>
            Tip: filter op “Onderwerp” om p90 per type te zien voor één categorie.
          </p>
        </>
      );
    }

    return null;
  }

  return (
    <div style={pageStyle}>
      <Toast message={syncMessage} kind={syncMessageKind} onClose={() => setSyncMessage("")} />
      <h1 style={{ margin: "0 0 12px", lineHeight: 1.1 }}>JSM Dashboard (SD)</h1>

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
            {meta.onderwerpen.map((o) => (
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

          <label style={fieldStyle} title="Sluit uit: Koppelingen, datadump, Rest-endpoints, migratie, SSO-koppeling">
            <span style={labelStyle}>Scope</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center", height: 36, padding: "0 4px" }}>
              <input
                type="checkbox"
                checked={servicedeskOnly}
                onChange={(e) => setServicedeskOnly(e.target.checked)}
              />
              <span>Alleen servicedesk</span>
            </div>
          </label>
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={triggerSync} disabled={syncBusy} style={buttonBaseStyle}>
            {syncBusy ? (
              <>
                <span style={{ marginRight: 6 }} aria-hidden>
                  ⏳
                </span>
                Sync bezig…
              </>
            ) : (
              "Sync now"
            )}
          </button>

          {syncStatus ? (
            <div style={{ color: "var(--text-muted)", display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div>
              {syncStatus.running ? (
                <>Bezig met synchroniseren…</>
              ) : (
                <>
                  Voor het laatst bijgewerkt op {syncStatus.last_sync ? fmtDateTime(syncStatus.last_sync) : "—"}
                </>
              )}
              {syncStatus.last_result?.upserts != null ? ` · ${syncStatus.last_result.upserts} bijgewerkt` : ""}
              {syncStatus.last_error ? ` · fout: ${syncStatus.last_error}` : ""}
            </div>
            </div>
          ) : null}
        </div>

        {activeFilterItems.length ? (
          <div style={activeFilterBarStyle}>
            <strong style={{ fontSize: 12, color: "var(--text-subtle)" }}>
              {`Actieve filters (${activeFilterItems.length})`}
            </strong>
            <button
              type="button"
              onClick={() => resetFilters(true)}
              style={resetActiveFiltersButtonStyle}
              title="Reset actieve filters"
            >
              Reset filters
            </button>
            {activeFilterItems.map((item) => (
              <span key={item} style={activeFilterChipStyle} title={item}>
                {item}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div style={topChartsGridStyle}>
        <div style={chartShellStyle}>
          <button
            type="button"
            className="card-expand-title"
            style={cardTitleButtonStyle}
            onClick={() => setExpandedCard("volume")}
          >
            <span style={chartTitleStyle}>{cardTitles.volume}</span>
            <span style={cardTitleHintStyle}>Vergroot</span>
          </button>
          {renderCardContent("volume")}
        </div>

        <div style={chartShellStyle}>
          <button
            type="button"
            className="card-expand-title"
            style={cardTitleButtonStyle}
            onClick={() => setExpandedCard("onderwerp")}
          >
            <span style={chartTitleStyle}>{cardTitles.onderwerp}</span>
            <span style={cardTitleHintStyle}>Vergroot</span>
          </button>
          {renderCardContent("onderwerp")}
        </div>

      </div>

      <div style={lowerChartsGridStyle}>
        <div style={chartShellStyle}>
          <button
            type="button"
            className="card-expand-title"
            style={cardTitleButtonStyle}
            onClick={() => setExpandedCard("priority")}
          >
            <span style={chartTitleStyle}>{cardTitles.priority}</span>
            <span style={cardTitleHintStyle}>Vergroot</span>
          </button>
          {renderCardContent("priority")}
        </div>

        <div style={chartShellStyle}>
          <button
            type="button"
            className="card-expand-title"
            style={cardTitleButtonStyle}
            onClick={() => setExpandedCard("assignee")}
          >
            <span style={chartTitleStyle}>{cardTitles.assignee}</span>
            <span style={cardTitleHintStyle}>Vergroot</span>
          </button>
          {renderCardContent("assignee")}
        </div>

        <div style={chartShellStyle}>
          <button
            type="button"
            className="card-expand-title"
            style={cardTitleButtonStyle}
            onClick={() => setExpandedCard("p90")}
          >
            <span style={chartTitleStyle}>{cardTitles.p90}</span>
            <span style={cardTitleHintStyle}>Vergroot</span>
          </button>
          {renderCardContent("p90")}
        </div>
      </div>

      {expandedCard ? (
        <div role="dialog" aria-modal="true" aria-label={cardTitles[expandedCard]} style={modalOverlayStyle} onClick={() => setExpandedCard("")}>
          <div style={modalFrameStyle}>
            <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
              <div style={modalHeaderStyle}>
                <h2 style={{ margin: 0, fontSize: 20 }}>{cardTitles[expandedCard]}</h2>
                <button type="button" onClick={() => setExpandedCard("")} style={modalCloseStyle}>
                  Sluiten
                </button>
              </div>
              <div style={modalBodyStyle}>{renderCardContent(expandedCard, true)}</div>
            </div>
          </div>
        </div>
      ) : null}

      <div
        aria-hidden={!selectedWeek}
        onClick={closeDrilldown}
        style={{
          position: "fixed",
          inset: 0,
          background: "var(--overlay-soft)",
          opacity: selectedWeek ? 1 : 0,
          pointerEvents: selectedWeek ? "auto" : "none",
          transition: "opacity 200ms ease",
          zIndex: 1200,
        }}
      />

      <div
        aria-hidden={!selectedWeek}
        role="dialog"
        aria-modal="true"
        aria-label="Drilldown"
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
          transform: selectedWeek ? "translateX(0)" : "translateX(100%)",
          transition: "transform 200ms ease",
          zIndex: 1201,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-strong)", display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Drilldown</div>
            <div style={{ fontSize: 16 }}>
              Week vanaf <b>{fmtDate(selectedWeek)}</b>
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
          </div>
          <button
            onClick={closeDrilldown}
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

        <div style={{ padding: "10px 20px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={() =>
                fetchDrilldown(selectedWeek, selectedType, selectedOnderwerp, Math.max(0, drillOffset - DRILL_LIMIT))
              }
              disabled={!selectedWeek || drillOffset === 0 || drillLoading}
            >
              Vorige
            </button>
            <button
              onClick={() => fetchDrilldown(selectedWeek, selectedType, selectedOnderwerp, drillOffset + DRILL_LIMIT)}
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

        <div style={{ padding: "12px 20px", overflow: "auto", flex: 1 }}>
          {drillLoading ? (
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
            <div style={{ color: "var(--text-muted)" }}>Klik op een punt in “Volume per week” om tickets te zien.</div>
          )}
        </div>
      </div>

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
        }
        input,
        select,
        textarea,
        button {
          color: var(--text-main);
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
      `}</style>
    </div>
  );
}
