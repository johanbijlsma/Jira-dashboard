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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseNlDateToIso } from "../lib/date";

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
const DASHBOARD_CONFIG_STORAGE_KEY = "jsm_dashboard_layout_v2";
const TYPE_COLORS = {
  rfc: "#2e7d32",
  incident: "#c62828",
  incidenten: "#c62828",
  "service request": "#1565c0",
  vraag: "#e65100",
  vragen: "#e65100",
  totaal: "#374151",
};
const CARD_TITLES = {
  volume: "Aantal tickets per week",
  onderwerp: "Onderwerp logging",
  priority: "Tickets per priority",
  assignee: "Tickets per assignee",
  p90: "Doorlooptijd p50/p75/p90",
  inflowVsClosed: "Binnengekomen vs afgesloten",
  incidentResolution: "Time to Resolution",
  firstResponseAll: "Time to First Response (alle tickets)",
  organizationWeekly: "Tickets per partner per week",
};
const KPI_KEYS = ["totalTickets", "latestTickets", "avgPerWeek", "topType", "topSubject", "topPartner"];
const NON_KPI_CARD_KEYS = ["topOnderwerpen", ...Object.keys(CARD_TITLES)];
const MAX_CARDS_PER_ROW = 5;
const MAX_KPI_TILES = 6;

function createDefaultDashboardLayout() {
  return {
    kpiRow: [...KPI_KEYS],
    hiddenKpis: [],
    cardRows: [
      ["topOnderwerpen", "volume", "priority", "organizationWeekly"],
      ["assignee", "onderwerp", "p90", "inflowVsClosed", "incidentResolution", "firstResponseAll"],
    ],
    hiddenCards: [],
    expandedByRow: [null, null],
  };
}

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

function weekStartIsoFromDate(d = new Date()) {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = dt.getUTCDay();
  const diff = (day + 6) % 7; // days since Monday
  dt.setUTCDate(dt.getUTCDate() - diff);
  return dt.toISOString().slice(0, 10);
}

function buildWeekStartsFromRange(fromIso, toIso) {
  if (!fromIso || !toIso) return [];
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  const from = new Date(Date.UTC(fy, fm - 1, fd));
  const to = new Date(Date.UTC(ty, tm - 1, td));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return [];

  const day = from.getUTCDay();
  const diff = (day + 6) % 7;
  from.setUTCDate(from.getUTCDate() - diff);

  const weeks = [];
  const cursor = new Date(from);
  while (cursor <= to) {
    weeks.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return weeks;
}

function addDaysIso(yyyyMmDd, days) {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
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

function LiveAlertStack({ alerts }) {
  const p1Items = Array.isArray(alerts?.priority1) ? alerts.priority1 : [];
  const slaItems = Array.isArray(alerts?.first_response_due_soon) ? alerts.first_response_due_soon : [];
  const overdueItems = Array.isArray(alerts?.first_response_overdue) ? alerts.first_response_overdue : [];
  if (!p1Items.length && !slaItems.length && !overdueItems.length) return null;

  const shellStyle = {
    position: "fixed",
    top: 16,
    right: 16,
    zIndex: 1004,
    width: "min(420px, calc(100vw - 32px))",
    display: "grid",
    gap: 10,
  };

  const cardStyle = {
    borderRadius: 12,
    border: "1px solid",
    boxShadow: "0 10px 22px var(--shadow-medium)",
    overflow: "hidden",
    backdropFilter: "blur(2px)",
    animation: "alertIn 220ms ease",
  };

  const titleRowStyle = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderBottom: "1px solid rgba(255,255,255,0.18)",
    fontWeight: 800,
    letterSpacing: 0.2,
  };

  const listStyle = {
    margin: 0,
    padding: "8px 12px 12px",
    listStyle: "none",
    display: "grid",
    gap: 6,
  };

  const itemStyle = {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "baseline",
    fontSize: 13,
    lineHeight: 1.3,
  };

  return (
    <div style={shellStyle} aria-live="assertive" aria-atomic="false">
      {p1Items.length ? (
        <section
          style={{
            ...cardStyle,
            borderColor: "rgba(127, 29, 29, 0.45)",
            background: "linear-gradient(135deg, #7f1d1d, #991b1b)",
            color: "#fee2e2",
          }}
        >
          <div style={titleRowStyle}>
            <span style={{ fontSize: 11, border: "1px solid rgba(254,226,226,0.45)", borderRadius: 999, padding: "2px 8px" }}>
              P1
            </span>
            <span>Priority 1 binnengekomen</span>
            <strong style={{ marginLeft: "auto", fontSize: 12 }}>{p1Items.length}</strong>
          </div>
          <ul style={listStyle}>
            {p1Items.slice(0, 5).map((item) => (
              <li key={`p1-${item.issue_key}`} style={itemStyle}>
                <a
                  href={`${JIRA_BASE}/browse/${item.issue_key}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#fff", fontWeight: 700 }}
                >
                  {item.issue_key}
                </a>
                <span>{item.status || "Open"}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {slaItems.length ? (
        <section
          style={{
            ...cardStyle,
            borderColor: "rgba(120, 53, 15, 0.45)",
            background: "linear-gradient(135deg, #78350f, #b45309)",
            color: "#ffedd5",
          }}
        >
          <div style={titleRowStyle}>
            <span style={{ fontSize: 11, border: "1px solid rgba(255,237,213,0.45)", borderRadius: 999, padding: "2px 8px" }}>
              SLA
            </span>
            <span>First response bijna verlopen</span>
            <strong style={{ marginLeft: "auto", fontSize: 12 }}>{slaItems.length}</strong>
          </div>
          <ul style={listStyle}>
            {slaItems.slice(0, 5).map((item) => (
              <li key={`sla-${item.issue_key}`} style={itemStyle}>
                <a
                  href={`${JIRA_BASE}/browse/${item.issue_key}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#fff", fontWeight: 700 }}
                >
                  {item.issue_key}
                </a>
                <span>{Math.max(0, Number(item.minutes_left) || 0)} min</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {overdueItems.length ? (
        <section
          style={{
            ...cardStyle,
            borderColor: "rgba(120, 16, 16, 0.55)",
            background: "linear-gradient(135deg, #581c87, #7f1d1d)",
            color: "#f5d0fe",
          }}
        >
          <div style={titleRowStyle}>
            <span style={{ fontSize: 11, border: "1px solid rgba(245,208,254,0.45)", borderRadius: 999, padding: "2px 8px" }}>
              SLA X
            </span>
            <span>First response verlopen</span>
            <strong style={{ marginLeft: "auto", fontSize: 12 }}>{overdueItems.length}</strong>
          </div>
          <ul style={listStyle}>
            {overdueItems.slice(0, 5).map((item) => (
              <li key={`sla-overdue-${item.issue_key}`} style={itemStyle}>
                <a
                  href={`${JIRA_BASE}/browse/${item.issue_key}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#fff", fontWeight: 700 }}
                >
                  {item.issue_key}
                </a>
                <span>{Math.max(0, Number(item.minutes_overdue) || 0)} min te laat</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function hasDataPoints(chartData) {
  if (!chartData || !Array.isArray(chartData.datasets)) return false;
  return chartData.datasets.some((ds) =>
    Array.isArray(ds.data) && ds.data.some((v) => typeof v === "number" && v > 0)
  );
}

function num(value, digits = 0) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return new Intl.NumberFormat("nl-NL", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(Number(value));
}

function pct(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `${num(value, 1)}%`;
}

const SimpleDataLabelsPlugin = {
  id: "simpleDataLabels",
  afterDatasetsDraw(chart, _args, pluginOptions) {
    if (pluginOptions === false) return;
    const opts = {
      mode: "bar", // arc | bar | line
      color: null,
      fontSize: 11,
      fontWeight: "600",
      lineOffset: 8,
      barOffset: 8,
      maxLabels: 14,
      minArcPct: 6,
      datasetIndexes: null,
      ...pluginOptions,
    };

    const computed = typeof window !== "undefined" ? getComputedStyle(document.documentElement) : null;
    const textColor = opts.color || computed?.getPropertyValue("--text-main")?.trim() || "#111827";
    const haloColor = computed?.getPropertyValue("--surface")?.trim() || "#ffffff";
    const ctx = chart.ctx;
    const visibleMetas = chart.getSortedVisibleDatasetMetas();
    if (!visibleMetas.length) return;
    const colorCache = new Map();

    function resolveCssColor(input) {
      const key = String(input || "");
      if (!key) return null;
      if (colorCache.has(key)) return colorCache.get(key);
      const probe = document.createElement("canvas").getContext("2d");
      if (!probe) return null;
      probe.fillStyle = "#000000";
      probe.fillStyle = key;
      const normalized = probe.fillStyle;
      const m = String(normalized).match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
      const value = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
      colorCache.set(key, value);
      return value;
    }

    function contrastTextFor(background) {
      const rgb = resolveCssColor(background);
      if (!rgb) return textColor;
      const [r, g, b] = rgb.map((v) => v / 255);
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return luminance > 0.6 ? "#0b1220" : "#f8fafc";
    }

    function drawLabel(label, x, y, fill = textColor) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = haloColor;
      ctx.strokeText(label, x, y);
      ctx.fillStyle = fill;
      ctx.fillText(label, x, y);
      ctx.fillStyle = textColor;
    }

    ctx.save();
    ctx.font = `${opts.fontWeight} ${opts.fontSize}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (opts.mode === "arc") {
      const meta = visibleMetas[0];
      const values = (chart.data.datasets?.[meta.index]?.data || []).map((v) => Number(v) || 0);
      const total = values.reduce((sum, v) => sum + v, 0);
      if (total <= 0) {
        ctx.restore();
        return;
      }

      meta.data.forEach((element, idx) => {
        const value = values[idx] || 0;
        if (value <= 0) return;
        const percentage = (value / total) * 100;
        if (percentage < opts.minArcPct) return;
        const pos = element.tooltipPosition();
        const label = `${num(value)} (${Math.round(percentage)}%)`;
        const rawColors = chart.data.datasets?.[meta.index]?.backgroundColor;
        const bgColor = Array.isArray(rawColors) ? rawColors[idx] : rawColors;
        drawLabel(label, pos.x, pos.y, contrastTextFor(bgColor));
      });
      ctx.restore();
      return;
    }

    visibleMetas.forEach((meta) => {
      if (Array.isArray(opts.datasetIndexes) && !opts.datasetIndexes.includes(meta.index)) return;
      const dataset = chart.data.datasets?.[meta.index];
      if (!dataset || dataset.hidden) return;
      if (String(dataset.label || "").startsWith("Mediaan ")) return;
      const values = (dataset.data || []).map((v) => Number(v));
      const valid = values.filter((v) => Number.isFinite(v));
      const step = valid.length > opts.maxLabels ? Math.ceil(valid.length / opts.maxLabels) : 1;

      meta.data.forEach((element, idx) => {
        const value = values[idx];
        if (!Number.isFinite(value) || value <= 0) return;
        if (idx % step !== 0 && idx !== values.length - 1) return;

        const pos = element.tooltipPosition();
        const y = opts.mode === "line" ? pos.y - opts.lineOffset : pos.y - opts.barOffset;
        drawLabel(num(value, value % 1 === 0 ? 0 : 1), pos.x, y, textColor);
      });
    });

    ctx.restore();
  },
};

if (!ChartJS.registry.plugins.get("simpleDataLabels")) {
  ChartJS.register(SimpleDataLabelsPlugin);
}

function EmptyChartState({ filterLabel, style }) {
  return (
    <div style={style}>
      <span>{`Verborgen omdat filter \`${filterLabel}\` actief is.`}</span>
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
  const [organization, setOrganization] = useState("");
  const [servicedeskOnly, setServicedeskOnly] = useState(DEFAULT_SERVICEDESK_ONLY);

  const [meta, setMeta] = useState({ request_types: [], onderwerpen: [], priorities: [], assignees: [], organizations: [] });
  const [volume, setVolume] = useState([]);
  const [onderwerpVolume, setOnderwerpVolume] = useState([]);
  const [priorityVolume, setPriorityVolume] = useState([]);
  const [assigneeVolume, setAssigneeVolume] = useState([]);
  const [organizationVolume, setOrganizationVolume] = useState([]);
  const [p90, setP90] = useState([]);
  const [inflowVsClosedWeekly, setInflowVsClosedWeekly] = useState([]);
  const [incidentResolutionWeekly, setIncidentResolutionWeekly] = useState([]);
  const [firstResponseWeekly, setFirstResponseWeekly] = useState([]);

  const [syncStatus, setSyncStatus] = useState(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [syncMessageKind, setSyncMessageKind] = useState("success"); // "success" | "error"
  const [liveAlerts, setLiveAlerts] = useState({
    priority1: [],
    first_response_due_soon: [],
    first_response_overdue: [],
  });

  const [selectedWeek, setSelectedWeek] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const [selectedOnderwerp, setSelectedOnderwerp] = useState("");
  const [selectedDrillDateField, setSelectedDrillDateField] = useState("created");
  const [selectedDrillBasisLabel, setSelectedDrillBasisLabel] = useState("Binnengekomen");
  const [drillIssues, setDrillIssues] = useState([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillOffset, setDrillOffset] = useState(0);
  const [drillHasNext, setDrillHasNext] = useState(false);
  const drillPanelRef = useRef(null);
  const drillCloseRef = useRef(null);
  const hotkeysPopupRef = useRef(null);
  const hotkeysButtonRef = useRef(null);
  const [showPriority, setShowPriority] = useState(false);
  const [showAssignee, setShowAssignee] = useState(false);
  const [expandedCard, setExpandedCard] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dashboardLayout, setDashboardLayout] = useState(createDefaultDashboardLayout);
  const [hotkeysOpen, setHotkeysOpen] = useState(false);
  const [topOnderwerpSort, setTopOnderwerpSort] = useState("wow");
  const autoSyncAttemptRef = useRef(0);
  const seenLiveAlertKeysRef = useRef(new Set());
  const dragStateRef = useRef(null);
  const [layoutSavedSnapshot, setLayoutSavedSnapshot] = useState("");
  const [isLayoutEditing, setIsLayoutEditing] = useState(false);
  const [cardDropHint, setCardDropHint] = useState(null);
  const [kpiDropHint, setKpiDropHint] = useState(null);
  const [hiddenDropTarget, setHiddenDropTarget] = useState(null);

  const normalizeDashboardLayout = useCallback((input) => {
    const fallback = createDefaultDashboardLayout();
    if (!input || typeof input !== "object") return fallback;

    const allKpis = new Set(KPI_KEYS);
    const allCards = new Set(NON_KPI_CARD_KEYS);
    const normalizeList = (arr, allowedSet) =>
      Array.from(new Set((Array.isArray(arr) ? arr : []).filter((key) => allowedSet.has(key))));

    let kpiRow = normalizeList(input.kpiRow, allKpis);
    let hiddenKpis = normalizeList(input.hiddenKpis, allKpis).filter((key) => !kpiRow.includes(key));
    KPI_KEYS.forEach((key) => {
      if (!kpiRow.includes(key) && !hiddenKpis.includes(key)) kpiRow.push(key);
    });
    if (kpiRow.length > MAX_KPI_TILES) {
      const overflow = kpiRow.slice(MAX_KPI_TILES);
      kpiRow = kpiRow.slice(0, MAX_KPI_TILES);
      overflow.forEach((key) => {
        if (!hiddenKpis.includes(key)) hiddenKpis.push(key);
      });
    }

    const inputRows = Array.isArray(input.cardRows) ? input.cardRows : [];
    let cardRows = [
      normalizeList(inputRows[0], allCards),
      normalizeList(inputRows[1], allCards),
    ];
    cardRows[1] = cardRows[1].filter((key) => !cardRows[0].includes(key));
    let hiddenCards = normalizeList(input.hiddenCards, allCards).filter(
      (key) => !cardRows[0].includes(key) && !cardRows[1].includes(key)
    );
    NON_KPI_CARD_KEYS.forEach((key) => {
      if (!cardRows[0].includes(key) && !cardRows[1].includes(key) && !hiddenCards.includes(key)) {
        cardRows[1].push(key);
      }
    });

    // Enforce max cards per row; overflow goes to hidden cards.
    [0, 1].forEach((idx) => {
      if (cardRows[idx].length > MAX_CARDS_PER_ROW) {
        const overflow = cardRows[idx].slice(MAX_CARDS_PER_ROW);
        cardRows[idx] = cardRows[idx].slice(0, MAX_CARDS_PER_ROW);
        overflow.forEach((key) => {
          if (!hiddenCards.includes(key)) hiddenCards.push(key);
        });
      }
    });

    // Backward compatibility for previous layout versions
    if (!input.kpiRow && Array.isArray(input.kpiOrder)) {
      const legacyVisible = KPI_KEYS.filter((key) => input?.kpiVisibility?.[key] !== false);
      const legacyHidden = KPI_KEYS.filter((key) => input?.kpiVisibility?.[key] === false);
      kpiRow = [
        ...input.kpiOrder.filter((key) => legacyVisible.includes(key)),
        ...legacyVisible.filter((key) => !input.kpiOrder.includes(key)),
      ];
      hiddenKpis = [
        ...input.kpiOrder.filter((key) => legacyHidden.includes(key)),
        ...legacyHidden.filter((key) => !input.kpiOrder.includes(key)),
      ];
    }
    if (!input.cardRows && Array.isArray(input.cardOrder)) {
      const legacyVisible = NON_KPI_CARD_KEYS.filter((key) => input?.cardVisibility?.[key] !== false);
      const legacyHidden = NON_KPI_CARD_KEYS.filter((key) => input?.cardVisibility?.[key] === false);
      const visibleOrdered = [
        ...input.cardOrder.filter((key) => legacyVisible.includes(key)),
        ...legacyVisible.filter((key) => !input.cardOrder.includes(key)),
      ];
      const split = Math.ceil(visibleOrdered.length / 2);
      cardRows = [visibleOrdered.slice(0, split), visibleOrdered.slice(split)];
      hiddenCards = [
        ...input.cardOrder.filter((key) => legacyHidden.includes(key)),
        ...legacyHidden.filter((key) => !input.cardOrder.includes(key)),
      ];
    }

    const expandedByRowInput = Array.isArray(input.expandedByRow) ? input.expandedByRow : [];
    const expandedByRow = [0, 1].map((idx) => {
      const key = expandedByRowInput[idx];
      return cardRows[idx].includes(key) ? key : null;
    });

    return { kpiRow, hiddenKpis, cardRows, hiddenCards, expandedByRow };
  }, []);

  const layoutDirty = useMemo(
    () => layoutSavedSnapshot !== JSON.stringify(dashboardLayout),
    [layoutSavedSnapshot, dashboardLayout]
  );

  const DRILL_LIMIT = 100;
  const syncBusy = syncLoading || !!syncStatus?.running;
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

  function closeDrilldown() {
    setSelectedWeek("");
    setSelectedType("");
    setSelectedOnderwerp("");
    setSelectedDrillDateField("created");
    setSelectedDrillBasisLabel("Binnengekomen");
    setDrillIssues([]);
    setDrillOffset(0);
    setDrillHasNext(false);
  }

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
    setRequestType("");
    setOnderwerp("");
    setPriority("");
    setAssignee("");
    setOrganization("");
    setServicedeskOnly(DEFAULT_SERVICEDESK_ONLY);
    if (showToast) flashToast("Filters gereset");
  }, [flashToast]);

  const saveDashboardLayout = useCallback(() => {
    if (typeof window === "undefined") return;
    const serialized = JSON.stringify(dashboardLayout);
    window.localStorage.setItem(DASHBOARD_CONFIG_STORAGE_KEY, serialized);
    setLayoutSavedSnapshot(serialized);
    setIsLayoutEditing(false);
    flashToast("Dashboard layout opgeslagen");
  }, [dashboardLayout, flashToast]);

  const startLayoutEditing = useCallback(() => {
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

  const refreshSyncStatus = useCallback(async () => {
    const r = await fetch(`${API}/sync/status`);
    const s = await r.json();
    setSyncStatus(s);
    return s;
  }, []);

  const refreshLiveAlerts = useCallback(async () => {
    const params = new URLSearchParams();
    if (servicedeskOnly) params.set("servicedesk_only", "true");
    const r = await fetch(`${API}/alerts/live?${params.toString()}`);
    const data = await r.json();
    const normalized = {
      priority1: Array.isArray(data?.priority1) ? data.priority1 : [],
      first_response_due_soon: Array.isArray(data?.first_response_due_soon) ? data.first_response_due_soon : [],
      first_response_overdue: Array.isArray(data?.first_response_overdue) ? data.first_response_overdue : [],
    };
    setLiveAlerts(normalized);

    const seen = seenLiveAlertKeysRef.current;
    const newP1 = normalized.priority1.filter((item) => {
      const key = `p1:${item.issue_key}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const newSla = normalized.first_response_due_soon.filter((item) => {
      const key = `sla:${item.issue_key}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const newOverdue = normalized.first_response_overdue.filter((item) => {
      const key = `sla-overdue:${item.issue_key}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (newP1.length) {
      flashToast(`ALERT P1: ${newP1[0].issue_key}${newP1.length > 1 ? ` +${newP1.length - 1}` : ""}`, "error", 9000);
    } else if (newOverdue.length) {
      flashToast(`ALERT SLA VERLOPEN: ${newOverdue[0].issue_key}${newOverdue.length > 1 ? ` +${newOverdue.length - 1}` : ""}`, "error", 9000);
    } else if (newSla.length) {
      flashToast(`ALERT SLA <5m: ${newSla[0].issue_key}${newSla.length > 1 ? ` +${newSla.length - 1}` : ""}`, "error", 9000);
    }
  }, [flashToast, servicedeskOnly]);

  const refreshDashboard = useCallback(async () => {
    const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
    if (requestType) params.set("request_type", requestType);
    if (onderwerp) params.set("onderwerp", onderwerp);
    if (priority) params.set("priority", priority);
    if (assignee) params.set("assignee", assignee);
    if (organization) params.set("organization", organization);
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

    fetch(`${API}/metrics/volume_weekly_by_organization?` + params.toString())
      .then((r) => r.json())
      .then((data) => (Array.isArray(data) ? setOrganizationVolume(data) : setOrganizationVolume([])));

    fetch(`${API}/metrics/inflow_vs_closed_weekly?` + params.toString())
      .then((r) => r.json())
      .then((data) => (Array.isArray(data) ? setInflowVsClosedWeekly(data) : setInflowVsClosedWeekly([])));

    const ttrParams = new URLSearchParams(params);
    ttrParams.delete("request_type");
    fetch(`${API}/metrics/time_to_resolution_weekly_by_type?` + ttrParams.toString())
      .then((r) => r.json())
      .then((data) => (Array.isArray(data) ? setIncidentResolutionWeekly(data) : setIncidentResolutionWeekly([])));

    fetch(`${API}/metrics/time_to_first_response_weekly?` + params.toString())
      .then((r) => r.json())
      .then((data) => (Array.isArray(data) ? setFirstResponseWeekly(data) : setFirstResponseWeekly([])));

    if (!p90Period.hasData) {
      setP90([]);
    } else {
      const p = new URLSearchParams({ date_from: p90Period.dateFrom, date_to: p90Period.dateTo });
      if (onderwerp) p.set("onderwerp", onderwerp);
      if (priority) p.set("priority", priority);
      if (assignee) p.set("assignee", assignee);
      if (organization) p.set("organization", organization);
      if (servicedeskOnly) p.set("servicedesk_only", "true");

      fetch(`${API}/metrics/leadtime_p90_by_type?` + p.toString())
        .then((r) => r.json())
        .then(setP90);
    }

    fetch(`${API}/meta`).then((r) => r.json()).then(setMeta);
  }, [dateFrom, dateTo, requestType, onderwerp, priority, assignee, organization, servicedeskOnly, p90Period]);

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
  }, [refreshSyncStatus, refreshDashboard]);

  useEffect(() => {
    fetch(`${API}/meta`).then((r) => r.json()).then(setMeta);
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.title = "Dashboard Servicedesk Planningsagenda";
    }
  }, []);

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
    fetch(`${API}/sync/status`)
      .then((r) => r.json())
      .then(setSyncStatus)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshLiveAlerts().catch(() => {});
  }, [refreshLiveAlerts]);

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
    const t = setInterval(() => {
      refreshLiveAlerts().catch(() => {});
    }, 20000);
    return () => clearInterval(t);
  }, [refreshLiveAlerts]);

  useEffect(() => {
    const t = setInterval(() => {
      if (syncBusy) return;
      triggerSync({ silent: true }).catch(() => {});
    }, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [syncBusy, triggerSync]);

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
  }, [syncStatus, syncBusy, triggerSync]);

  useEffect(() => {
    function onKeyDown(e) {
      if (hotkeysOpen) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key?.toLowerCase();
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
  }, [syncBusy, hotkeysOpen, applyDateRange, flashToast, resetFilters, triggerSync]);

  useEffect(() => {
    if (!hotkeysOpen) return;
    function onKeyDown(e) {
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
    if (!filtersOpen) return;
    function onKeyDown(e) {
      if (e.key === "Escape") setFiltersOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filtersOpen]);

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
    if (organization) params.set("organization", organization);
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

    fetch(`${API}/metrics/volume_weekly_by_organization?` + params.toString())
      .then((r) => r.json())
      .then((data) => (Array.isArray(data) ? setOrganizationVolume(data) : setOrganizationVolume([])));

    fetch(`${API}/metrics/inflow_vs_closed_weekly?` + params.toString())
      .then((r) => r.json())
      .then((data) => (Array.isArray(data) ? setInflowVsClosedWeekly(data) : setInflowVsClosedWeekly([])));

    const ttrParams = new URLSearchParams(params);
    ttrParams.delete("request_type");
    fetch(`${API}/metrics/time_to_resolution_weekly_by_type?` + ttrParams.toString())
      .then((r) => r.json())
      .then((data) => (Array.isArray(data) ? setIncidentResolutionWeekly(data) : setIncidentResolutionWeekly([])));

    fetch(`${API}/metrics/time_to_first_response_weekly?` + params.toString())
      .then((r) => r.json())
      .then((data) => (Array.isArray(data) ? setFirstResponseWeekly(data) : setFirstResponseWeekly([])));

    if (!p90Period.hasData) {
      setP90([]);
    } else {
      const p = new URLSearchParams({
        date_from: p90Period.dateFrom,
        date_to: p90Period.dateTo,
      });
      if (onderwerp) p.set("onderwerp", onderwerp);
      if (priority) p.set("priority", priority);
      if (assignee) p.set("assignee", assignee);
      if (organization) p.set("organization", organization);
      if (servicedeskOnly) p.set("servicedesk_only", "true");

      fetch(`${API}/metrics/leadtime_p90_by_type?` + p.toString())
        .then((r) => r.json())
        .then(setP90);
    }
  }, [dateFrom, dateTo, requestType, onderwerp, priority, assignee, organization, servicedeskOnly, p90Period]);

  // volume -> weeks x series (use full range so empty weeks show as 0)
  const weeks = useMemo(() => buildWeekStartsFromRange(dateFrom, dateTo), [dateFrom, dateTo]);
  const weeksOnderwerp = useMemo(() => buildWeekStartsFromRange(dateFrom, dateTo), [dateFrom, dateTo]);
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
    const subjects = onderwerp ? [onderwerp] : meta.onderwerpen;
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
  }, [weeksOnderwerp, onderwerpVolume, meta.onderwerpen, onderwerp]);

  const typeColor = useCallback((label) => {
    const key = String(label || "").toLowerCase();
    return TYPE_COLORS[key] || "#6b7280";
  }, []);

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
    return weekStartIsoFromDate(d);
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
    [weeks, series, requestType, typeColor]
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
    const labels = weeks.map((w) => fmtDate(w));
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
  }, [inflowVsClosedWeekly, weeks]);

  const incidentResolutionLineData = useMemo(() => {
    const rows = Array.isArray(incidentResolutionWeekly) ? incidentResolutionWeekly : [];
    const labels = weeks.map((w) => fmtDate(w));
    const allTypes = (Array.isArray(meta.request_types) ? meta.request_types : []).filter(Boolean);
    const typeSetFromRows = Array.from(
      new Set(rows.map((x) => String(x?.request_type || "").trim()).filter(Boolean))
    );
    const types = allTypes.length ? allTypes : typeSetFromRows;
    return {
      labels,
      datasets: types.map((typeLabel) => ({
        label: typeLabel,
        data: weeks.map((w) => {
          const row = rows.find(
            (x) =>
              String(x?.week || "").slice(0, 10) === w &&
              String(x?.request_type || "") === String(typeLabel)
          );
          return row?.avg_hours != null ? Number(row.avg_hours) : null;
        }),
        tension: 0.2,
        borderColor: typeColor(typeLabel),
        backgroundColor: typeColor(typeLabel),
        pointBackgroundColor: typeColor(typeLabel),
        pointBorderColor: typeColor(typeLabel),
      })),
    };
  }, [incidentResolutionWeekly, weeks, meta.request_types, typeColor]);

  const firstResponseLineData = useMemo(() => {
    const rows = Array.isArray(firstResponseWeekly) ? firstResponseWeekly : [];
    const labels = weeks.map((w) => fmtDate(w));
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
  }, [firstResponseWeekly, weeks]);

  const organizationBarData = useMemo(() => {
    const rows = Array.isArray(organizationVolume) ? organizationVolume : [];
    const labels = weeks.map((w) => fmtDate(w));
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
  }, [organizationVolume, weeks]);

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
      periodLabel: fullWeekInfo.periodLabel,
      completeWeeksCount: fullWeekInfo.count,
    };
  }, [series, weeks, onderwerpVolume, organizationVolume, fullWeekInfo]);

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

    function wowSortValue(row) {
      const last = Number(row?.last) || 0;
      const prev = Number(row?.prev) || 0;
      if (prev <= 0 && last > 0) return Number.NEGATIVE_INFINITY; // voorkom dat "nieuw" alles domineert
      if (prev <= 0 && last <= 0) return Number.NEGATIVE_INFINITY;
      return ((last - prev) / prev) * 100;
    }

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

  function trendInfo(last, prev) {
    const l = Number(last) || 0;
    const p = Number(prev) || 0;
    if (p <= 0 && l <= 0) return { symbol: "→", text: "0%", color: "var(--text-muted)" };
    if (p <= 0 && l > 0) return { symbol: "↑", text: "nieuw", color: "var(--ok)" };
    const delta = ((l - p) / p) * 100;
    if (delta > 0.5) return { symbol: "↑", text: `+${num(delta, 1)}%`, color: "var(--ok)" };
    if (delta < -0.5) return { symbol: "↓", text: `${num(delta, 1)}%`, color: "var(--danger)" };
    return { symbol: "→", text: `${num(delta, 1)}%`, color: "var(--text-muted)" };
  }

  function addDays(yyyyMmDd, days) {
    return addDaysIso(yyyyMmDd, days);
  }

  async function fetchDrilldown(
    weekStart,
    typeLabel,
    onderwerpLabel,
    offset = 0,
    options = {}
  ) {
    if (isLayoutEditing) return;
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
      const weekEnd = addDays(weekStart, 7);

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
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid var(--border)",
    borderRadius: 10,
    color: "var(--text-muted)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: 10,
  };
  const rowCardHeight = "clamp(220px, 24vh, 320px)";
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
    padding: 8,
    minWidth: 0,
    height: rowCardHeight,
    display: "flex",
    flexDirection: "column",
  };
  const chartBodyStyle = {
    flex: 1,
    minHeight: 0,
    position: "relative",
  };
  const interactionDisabledStyle = isLayoutEditing ? { pointerEvents: "none", userSelect: "none" } : null;
  const pageStyle = {
    fontFamily: "system-ui",
    padding: 10,
    maxWidth: "100%",
    margin: "0 auto",
    background: "var(--page-bg)",
    color: "var(--text-main)",
    minHeight: "100vh",
    height: "100vh",
    overflow: "hidden",
  };
  const kpiGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 8,
    marginBottom: 8,
    width: "100%",
  };
  const cardRowsWrapStyle = {
    display: "grid",
    gap: 8,
    width: "100%",
  };
  const cardRowStyle = {
    display: "grid",
    gap: 8,
    minHeight: rowCardHeight,
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
    margin: "0 0 8px",
    fontSize: 18,
    lineHeight: 1.2,
  };
  const headerRowStyle = {
    marginBottom: 10,
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
  };
  const titleStyle = { margin: 0, lineHeight: 1.1 };
  const headerActionsStyle = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
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

  function renderCardContent(cardKey, expanded = false) {
    const bodyStyle = expanded ? { height: "100%", minHeight: 0, position: "relative" } : chartBodyStyle;
    const donutStyle = expanded ? { ...donutBodyStyle, minHeight: 0 } : donutBodyStyle;
    const emptyStyle = expanded ? { ...hiddenChartPlaceholderStyle, minHeight: 0 } : hiddenChartPlaceholderStyle;
    if (cardKey === "topOnderwerpen") {
      return (
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
            <span style={fixedMetricBadgeStyle}>Periode: laatste week</span>
          </div>
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
              <div style={emptyStyle}>Verborgen omdat filter `Periode` actief is.</div>
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
                  simpleDataLabels: { mode: "line", maxLabels: expanded ? 24 : 12 },
                },
                interaction: { mode: "nearest", intersect: false },
              }}
            />
          ) : (
            <EmptyChartState filterLabel="Request type" style={emptyStyle} />
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
          <div style={bodyStyle}>
            {hasDataPoints(onderwerpLineData) ? (
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
                    if (!subjectLabel) return;
                    setOnderwerp(subjectLabel || "");
                    fetchDrilldown(weekStart, requestType, subjectLabel);
                  },
                  plugins: {
                    legend: { display: false },
                    tooltip: { mode: "nearest", intersect: false },
                    simpleDataLabels: { mode: "line", maxLabels: expanded ? 24 : 12 },
                  },
                  interaction: { mode: "nearest", intersect: false },
                }}
              />
            ) : (
              <EmptyChartState filterLabel="Onderwerp" style={emptyStyle} />
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
                      simpleDataLabels: { mode: "arc", minArcPct: 8 },
                    },
                  }}
                />
              </div>
            ) : (
              <EmptyChartState filterLabel="Prioriteit" style={emptyStyle} />
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
                      simpleDataLabels: { mode: "arc", minArcPct: 8 },
                    },
                  }}
                />
              </div>
            ) : (
              <EmptyChartState filterLabel="Assignee" style={emptyStyle} />
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
                  tooltip: {
                    mode: "nearest",
                    intersect: false,
                    callbacks: {
                      label: (ctx) => `${ctx.dataset.label}: ${num(ctx.parsed.y)} tickets`,
                    },
                  },
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
                plugins: {
                  legend: { display: true, position: "top" },
                  tooltip: { mode: "nearest", intersect: false },
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
                plugins: {
                  legend: { display: true, position: "top" },
                  tooltip: { mode: "nearest", intersect: false },
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
                plugins: {
                  legend: { display: true, position: "top" },
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
        </div>
      );
    }

    return null;
  }

  const kpiTiles = useMemo(
    () => ({
      totalTickets: {
        label: "Totaal tickets (volledige weken)",
        value: num(kpiStats.totalTickets),
        sub: kpiStats.periodLabel,
      },
      latestTickets: {
        label: "Tickets laatste volledige week",
        value: num(kpiStats.latestTickets),
        sub: `Week van ${kpiStats.lastCompletedWeekLabel} · WoW: ${pct(kpiStats.wowChangePct)}`,
        badge: "Periode: laatste week",
      },
      avgPerWeek: {
        label: "Gemiddeld aantal tickets (volledige weken)",
        value: num(kpiStats.avgPerWeek, 1),
        sub: `${num(kpiStats.completeWeeksCount)} volledige weken`,
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
        value: `${kpiStats.topPartnerLabel} (${num(kpiStats.topPartnerTickets)})`,
        sub: `Week ervoor: ${kpiStats.topPartnerPrevLabel} (${num(kpiStats.topPartnerPrevTickets)})`,
      },
    }),
    [kpiStats]
  );

  const visibleKpiKeys = dashboardLayout.kpiRow;
  const hiddenKpiKeys = dashboardLayout.hiddenKpis;
  const visibleCardRows = dashboardLayout.cardRows;
  const hiddenCardKeys = dashboardLayout.hiddenCards;
  const cardTitleByKey = useCallback(
    (key) => (key === "topOnderwerpen" ? "Top 10 onderwerpen" : CARD_TITLES[key] || key),
    []
  );

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
    setDashboardLayout((prev) => {
      const key = state.key;
      let row = prev.kpiRow.filter((k) => k !== key);
      const hidden = prev.hiddenKpis.filter((k) => k !== key);
      if (targetKey && row.includes(targetKey)) {
        const baseIndex = row.indexOf(targetKey);
        const insertIndex = position === "after" ? baseIndex + 1 : baseIndex;
        row.splice(insertIndex, 0, key);
      } else {
        row.push(key);
      }
      if (row.length > MAX_KPI_TILES) {
        const overflow = row.slice(MAX_KPI_TILES);
        row = row.slice(0, MAX_KPI_TILES);
        overflow.forEach((k) => {
          if (!hidden.includes(k)) hidden.push(k);
        });
      }
      return { ...prev, kpiRow: row, hiddenKpis: hidden };
    });
  }

  function hideKpi() {
    const state = dragStateRef.current;
    clearDrag();
    if (!state || state.kind !== "kpi") return;
    setDashboardLayout((prev) => {
      const key = state.key;
      const row = prev.kpiRow.filter((k) => k !== key);
      const hidden = prev.hiddenKpis.includes(key) ? prev.hiddenKpis : [...prev.hiddenKpis, key];
      return { ...prev, kpiRow: row, hiddenKpis: hidden };
    });
  }

  function hideKpiByKey(key) {
    setDashboardLayout((prev) => ({
      ...prev,
      kpiRow: prev.kpiRow.filter((k) => k !== key),
      hiddenKpis: prev.hiddenKpis.includes(key) ? prev.hiddenKpis : [...prev.hiddenKpis, key],
    }));
  }

  function moveCardToRow(rowIndex, targetKey = null, position = "before") {
    const state = dragStateRef.current;
    clearDrag();
    if (!state || state.kind !== "card" || rowIndex < 0 || rowIndex > 1) return;
    setDashboardLayout((prev) => {
      const key = state.key;
      const nextRows = prev.cardRows.map((row) => row.filter((k) => k !== key));
      const hidden = prev.hiddenCards.filter((k) => k !== key);
      const expandedByRow = [...(prev.expandedByRow || [null, null])].map((v) => (v === key ? null : v));
      if (targetKey && nextRows[rowIndex].includes(targetKey)) {
        const baseIndex = nextRows[rowIndex].indexOf(targetKey);
        const insertIndex = position === "after" ? baseIndex + 1 : baseIndex;
        nextRows[rowIndex].splice(insertIndex, 0, key);
      } else {
        nextRows[rowIndex].push(key);
      }

      // Keep rows readable: max 5 cards per row, overflow to hidden cards.
      [0, 1].forEach((idx) => {
        if (nextRows[idx].length > MAX_CARDS_PER_ROW) {
          const overflow = nextRows[idx].slice(MAX_CARDS_PER_ROW);
          nextRows[idx] = nextRows[idx].slice(0, MAX_CARDS_PER_ROW);
          overflow.forEach((k) => {
            if (!hidden.includes(k)) hidden.push(k);
          });
        }
      });
      [0, 1].forEach((idx) => {
        if (expandedByRow[idx] && !nextRows[idx].includes(expandedByRow[idx])) expandedByRow[idx] = null;
      });

      return { ...prev, cardRows: nextRows, hiddenCards: hidden, expandedByRow };
    });
  }

  function hideCard() {
    const state = dragStateRef.current;
    clearDrag();
    if (!state || state.kind !== "card") return;
    setDashboardLayout((prev) => {
      const key = state.key;
      const nextRows = prev.cardRows.map((row) => row.filter((k) => k !== key));
      const hidden = prev.hiddenCards.includes(key) ? prev.hiddenCards : [...prev.hiddenCards, key];
      const expandedByRow = [...(prev.expandedByRow || [null, null])].map((v) => (v === key ? null : v));
      return { ...prev, cardRows: nextRows, hiddenCards: hidden, expandedByRow };
    });
  }

  function hideCardByKey(key) {
    setDashboardLayout((prev) => ({
      ...prev,
      cardRows: prev.cardRows.map((row) => row.filter((k) => k !== key)),
      hiddenCards: prev.hiddenCards.includes(key) ? prev.hiddenCards : [...prev.hiddenCards, key],
      expandedByRow: [...(prev.expandedByRow || [null, null])].map((v) => (v === key ? null : v)),
    }));
  }

  function toggleRowExpandCard(rowIndex, key) {
    if (!isLayoutEditing || rowIndex < 0 || rowIndex > 1) return;
    setDashboardLayout((prev) => {
      const row = prev.cardRows[rowIndex] || [];
      if (!row.includes(key)) return prev;
      const current = (prev.expandedByRow || [null, null])[rowIndex];
      if (current === key) {
        const next = [...(prev.expandedByRow || [null, null])];
        next[rowIndex] = null;
        return { ...prev, expandedByRow: next };
      }
      if (row.length > 4) return prev;
      const next = [...(prev.expandedByRow || [null, null])];
      next[rowIndex] = key;
      return { ...prev, expandedByRow: next };
    });
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
    if (!isLayoutEditing) return row;
    const draggingKey = dragStateRef.current?.kind === "kpi" ? dragStateRef.current.key : null;
    const cleanRow = row.filter((key) => key !== draggingKey);
    if (!kpiDropHint) return cleanRow;
    const withHint = [...cleanRow];
    if (!kpiDropHint.targetKey || !withHint.includes(kpiDropHint.targetKey)) {
      withHint.push("__KPI_DROP_HINT__");
      return withHint;
    }
    const targetIndex = withHint.indexOf(kpiDropHint.targetKey);
    const insertIndex = kpiDropHint.position === "after" ? targetIndex + 1 : targetIndex;
    withHint.splice(insertIndex, 0, "__KPI_DROP_HINT__");
    return withHint;
  }

  function renderCardRowWithHint(row, rowIndex) {
    if (!isLayoutEditing) return row;
    const draggingKey = dragStateRef.current?.kind === "card" ? dragStateRef.current.key : null;
    const cleanRow = row.filter((key) => key !== draggingKey);
    const hint = cardDropHint && cardDropHint.rowIndex === rowIndex ? cardDropHint : null;
    if (!hint) return cleanRow;
    const withHint = [...cleanRow];
    if (!hint.targetKey || !withHint.includes(hint.targetKey)) {
      withHint.push("__DROP_HINT__");
      return withHint;
    }
    const targetIndex = withHint.indexOf(hint.targetKey);
    const insertIndex = hint.position === "after" ? targetIndex + 1 : targetIndex;
    withHint.splice(insertIndex, 0, "__DROP_HINT__");
    return withHint;
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
  }, [isLayoutEditing]);

  return (
    <div style={pageStyle}>
      <Toast message={syncMessage} kind={syncMessageKind} onClose={() => setSyncMessage("")} />
      <LiveAlertStack alerts={liveAlerts} />
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
          {isLayoutEditing ? (
            <button type="button" onClick={cancelLayoutEditing} style={filterOpenButtonStyle}>
              Annuleren
            </button>
          ) : (
            <button type="button" onClick={startLayoutEditing} style={filterOpenButtonStyle}>
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

        </div>

            </div>
          </div>
        </>
      ) : null}

      {(() => {
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
              <div style={{ ...kpiValueStyle, fontSize: key === "topType" || key === "topSubject" ? 20 : 20 }}>{tile.value}</div>
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
              {renderedRow.map((cardKey) => (
              cardKey === "__DROP_HINT__" ? (
                <div key={`hint-${rowIndex}`} style={dropSkeletonStyle} />
              ) : (
              <div
                key={cardKey}
                style={{
                  ...chartShellStyle,
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
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
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
                        <span style={chartTitleStyle}>{cardTitleByKey(cardKey)}</span>
                      </span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="card-expand-title"
                      style={cardTitleButtonStyle}
                      onClick={() => setExpandedCard(cardKey)}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span style={chartTitleStyle}>{cardTitleByKey(cardKey)}</span>
                      </span>
                      <span style={cardTitleHintStyle}>Vergroot</span>
                    </button>
                  )}
                  {isLayoutEditing ? (
                    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
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
                  ) : null}
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
                  {renderCardContent(cardKey)}
                </div>
              </div>
              )
            ))}
            </div>
          );
        })}
      </div>
      {isLayoutEditing ? (
        <div style={foldNoticeStyle}>{'Layout-modus actief: sleep KPI/cards binnen hun categorie en klik daarna op "Opslaan layout".'}</div>
      ) : null}

      {expandedCard ? (
        <div role="dialog" aria-modal="true" aria-label={cardTitleByKey(expandedCard)} style={modalOverlayStyle} onClick={() => setExpandedCard("")}>
          <div style={modalFrameStyle}>
            <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
              <div style={modalHeaderStyle}>
                <h2 style={{ margin: 0, fontSize: 20 }}>{cardTitleByKey(expandedCard)}</h2>
                <button type="button" onClick={() => setExpandedCard("")} style={modalCloseStyle}>
                  Sluiten
                </button>
              </div>
              <div style={modalBodyStyle}>{renderCardContent(expandedCard, true)}</div>
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
              <button type="button" onClick={resetLayoutAndClose} style={filterOpenButtonStyle}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v6h-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Opnieuw beginnen
              </button>
              <button type="button" onClick={saveDashboardLayout} style={layoutPrimaryButtonStyle} disabled={!layoutDirty}>
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
            <div style={{ color: "var(--text-muted)" }}>Klik op een punt in “Aantal tickets per week” om tickets te zien.</div>
          )}
        </div>
      </div>

      {syncStatus ? (
        <div style={{ marginTop: 20, color: "var(--text-muted)", display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div>
            {syncStatus.running ? (
              <>Bezig met synchroniseren…</>
            ) : (
              <>Voor het laatst bijgewerkt op {syncStatus.last_sync ? fmtDateTime(syncStatus.last_sync) : "—"}</>
            )}
            {syncStatus.last_result?.upserts != null ? ` · ${syncStatus.last_result.upserts} bijgewerkt` : ""}
            {syncStatus.last_error ? ` · fout: ${syncStatus.last_error}` : ""}
          </div>
        </div>
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
