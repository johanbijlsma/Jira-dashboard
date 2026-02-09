import { Bar, Line, Pie } from "react-chartjs-2";
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

const API = "http://127.0.0.1:8000";
const JIRA_BASE = "https://planningsagenda.atlassian.net";

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

  const [meta, setMeta] = useState({ request_types: [], onderwerpen: [] });
  const [volume, setVolume] = useState([]);
  const [onderwerpVolume, setOnderwerpVolume] = useState([]);
  const [p90, setP90] = useState([]);

  const [syncStatus, setSyncStatus] = useState(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [syncMessageKind, setSyncMessageKind] = useState("success"); // "success" | "error"

  const [selectedWeek, setSelectedWeek] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const [selectedOnderwerp, setSelectedOnderwerp] = useState("");
  const [onderwerpChartMode, setOnderwerpChartMode] = useState("line");
  const [drillIssues, setDrillIssues] = useState([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillOffset, setDrillOffset] = useState(0);
  const [drillHasNext, setDrillHasNext] = useState(false);
  const drillPanelRef = useRef(null);
  const drillCloseRef = useRef(null);

  const DRILL_LIMIT = 100;
  const syncBusy = syncLoading || !!syncStatus?.running;

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
    function isTypingTarget(el) {
      if (!el) return false;
      const tag = el.tagName?.toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
    }
    function onKeyDown(e) {
      if (isTypingTarget(e.target)) return;
      const key = e.key?.toLowerCase();
      if (key === "m") {
        applyDateRange({ months: 1 });
        flashToast("Datumselectie: laatste maand");
      } else if (key === "j") {
        applyDateRange({ years: 1 });
        flashToast("Datumselectie: laatste jaar");
      } else if (key === "r") {
        setRequestType("");
        setOnderwerp("");
        flashToast("Filters gereset");
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

    fetch(`${API}/metrics/volume_weekly?` + params.toString())
      .then((r) => r.json())
      .then(setVolume);

    fetch(`${API}/metrics/volume_weekly_by_onderwerp?` + params.toString())
      .then((r) => r.json())
      .then((data) => (Array.isArray(data) ? setOnderwerpVolume(data) : setOnderwerpVolume([])));

    const p = new URLSearchParams({
      date_from: dateFrom,
      date_to: dateTo,
    });
    if (onderwerp) p.set("onderwerp", onderwerp);

    fetch(`${API}/metrics/leadtime_p90_by_type?` + p.toString())
      .then((r) => r.json())
      .then(setP90);
  }, [dateFrom, dateTo, requestType, onderwerp]);

  // volume -> weeks x series
  const weeks = useMemo(() => {
    const s = new Set(volume.map((v) => v.week.slice(0, 10)));
    return Array.from(s).sort();
  }, [volume]);

  const weeksOnderwerp = useMemo(() => {
    const data = Array.isArray(onderwerpVolume) ? onderwerpVolume : [];
    const s = new Set(data.map((v) => v.week.slice(0, 10)));
    return Array.from(s).sort();
  }, [onderwerpVolume]);

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
    return subjects.map((o) => ({
      label: o,
      data: weeksOnderwerp.map((w) => {
        const row = data.find((v) => v.onderwerp === o && v.week.slice(0, 10) === w);
        return row ? row.tickets : 0;
      }),
    }));
  }, [weeksOnderwerp, onderwerpVolume, meta.onderwerpen, onderwerp]);

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

  const SUBJECT_COLORS = [
    "#1f77b4",
    "#ff7f0e",
    "#2ca02c",
    "#d62728",
    "#9467bd",
    "#8c564b",
    "#e377c2",
    "#7f7f7f",
    "#bcbd22",
    "#17becf",
  ];

  function subjectColor(index) {
    return SUBJECT_COLORS[index % SUBJECT_COLORS.length];
  }

  function isTotalLabel(label) {
    return String(label || "").toLowerCase() === "totaal";
  }

  const lineData = useMemo(
    () => ({
      labels: weeks.map((w) => fmtDate(w)),
      datasets: series.map((s) => ({
        label: s.label,
        data: s.data,
        tension: 0.2,
        borderColor: typeColor(s.label),
        backgroundColor: typeColor(s.label),
        pointBackgroundColor: typeColor(s.label),
        pointBorderColor: typeColor(s.label),
      })),
    }),
    [weeks, series]
  );

  const onderwerpLineData = useMemo(
    () => ({
      labels: weeksOnderwerp.map((w) => fmtDate(w)),
      datasets: onderwerpSeries.map((s, i) => ({
        label: s.label,
        data: s.data,
        tension: 0.2,
        borderColor: subjectColor(i),
        backgroundColor: subjectColor(i),
        pointBackgroundColor: subjectColor(i),
        pointBorderColor: subjectColor(i),
      })),
    }),
    [weeksOnderwerp, onderwerpSeries]
  );

  const onderwerpPieData = useMemo(() => {
    const data = Array.isArray(onderwerpVolume) ? onderwerpVolume : [];
    const subjects = onderwerp ? [onderwerp] : meta.onderwerpen;
    const totals = subjects.map((o) => ({
      onderwerp: o,
      total: data.reduce((sum, v) => (v.onderwerp === o ? sum + v.tickets : sum), 0),
    }));
    totals.sort((a, b) => b.total - a.total);
    return {
      labels: totals.map((t) => t.onderwerp),
      datasets: [
        {
          label: "Totaal per onderwerp",
          data: totals.map((t) => t.total),
          backgroundColor: totals.map((_, i) => subjectColor(i)),
          borderColor: totals.map((_, i) => subjectColor(i)),
        },
      ],
    };
  }, [onderwerpVolume, meta.onderwerpen, onderwerp]);

  const onderwerpPieTopLegend = useMemo(() => {
    const labels = onderwerpPieData.labels || [];
    return new Set(labels.slice(0, 5));
  }, [onderwerpPieData]);

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

    fetch(`${API}/metrics/volume_weekly?` + params.toString())
      .then((r) => r.json())
      .then(setVolume);

    fetch(`${API}/metrics/volume_weekly_by_onderwerp?` + params.toString())
      .then((r) => r.json())
      .then((data) => (Array.isArray(data) ? setOnderwerpVolume(data) : setOnderwerpVolume([])));

    const p = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
    if (onderwerp) p.set("onderwerp", onderwerp);

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

  return (
    <div style={{ fontFamily: "system-ui", padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <Toast message={syncMessage} kind={syncMessageKind} onClose={() => setSyncMessage("")} />
      <h1>JSM Dashboard (SD)</h1>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <label>
          Van<br />
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
              style={{ width: 120 }}
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
              style={{
                padding: "4px 8px",
                border: "1px solid #ccc",
                borderRadius: 6,
                background: "#fff",
                cursor: "pointer",
              }}
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
        <label>
          Tot<br />
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
              style={{ width: 120 }}
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
              style={{
                padding: "4px 8px",
                border: "1px solid #ccc",
                borderRadius: 6,
                background: "#fff",
                cursor: "pointer",
              }}
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

        <label>
          Request type<br />
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span
              aria-hidden
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: typeColor(requestType),
                display: "inline-block",
                border: "1px solid rgba(0,0,0,0.15)",
              }}
            />
            <select value={requestType} onChange={(e) => setRequestType(e.target.value)}>
              <option value="">(alle)</option>
              {meta.request_types.map((rt) => (
                <option key={rt} value={rt}>
                  {rt}
                </option>
              ))}
            </select>
          </div>
        </label>

        <label>
          Onderwerp<br />
          <select value={onderwerp} onChange={(e) => setOnderwerp(e.target.value)}>
            <option value="">(alle)</option>
            {meta.onderwerpen.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>

        <button
          onClick={() => {
            setRequestType("");
            setOnderwerp("");
          }}
        >
          Reset filters
        </button>

        <button onClick={triggerSync} disabled={syncBusy}>
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
          <div style={{ alignSelf: "flex-end", color: "#666", display: "flex", gap: 10, flexWrap: "wrap" }}>
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

      <h2>Volume per week</h2>
      <Line
        data={lineData}
        options={{
          responsive: true,
          onClick: (_evt, elements) => {
            const el = elements?.[0];
            if (!el) return;
            const weekStart = weeks[el.index];
            const typeLabel = lineData.datasets[el.datasetIndex]?.label;
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

      <h2 style={{ marginTop: 28 }}>Onderwerp logging</h2>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: "#666" }}>Weergave</span>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="radio"
            name="onderwerpChartMode"
            value="line"
            checked={onderwerpChartMode === "line"}
            onChange={() => setOnderwerpChartMode("line")}
          />
          Line
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="radio"
            name="onderwerpChartMode"
            value="pie"
            checked={onderwerpChartMode === "pie"}
            onChange={() => setOnderwerpChartMode("pie")}
          />
          Pie
        </label>
      </div>

      {onderwerpChartMode === "line" ? (
        <Line
          data={onderwerpLineData}
          options={{
            responsive: true,
            onClick: (_evt, elements) => {
              const el = elements?.[0];
              if (!el) return;
              const weekStart = weeksOnderwerp[el.index];
              const subjectLabel = onderwerpLineData.datasets[el.datasetIndex]?.label;
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
        <div>
          <div style={{ marginBottom: 6, fontSize: 12, color: "#666" }}>Legenda toont top 5</div>
          <Pie
            data={onderwerpPieData}
            options={{
              responsive: true,
              onClick: (_evt, elements) => {
                const el = elements?.[0];
                if (!el) return;
                const subjectLabel = onderwerpPieData.labels?.[el.index];
                if (!subjectLabel) return;
                setOnderwerp(subjectLabel);
                const weekStart = weeksOnderwerp[weeksOnderwerp.length - 1];
                if (!weekStart) return;
                fetchDrilldown(weekStart, requestType, subjectLabel);
              },
              plugins: {
                legend: {
                  position: "right",
                  labels: {
                    filter: (item) => onderwerpPieTopLegend.has(item.text),
                  },
                },
              },
            }}
          />
        </div>
      )}

      <h2 style={{ marginTop: 28 }}>Doorlooptijd p90 per request type</h2>
      <Bar
        data={barData}
        options={{
          plugins: {
            legend: { position: "top" },
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

      <p style={{ marginTop: 20, color: "#666" }}>Tip: filter op “Onderwerp” om p90 per type te zien voor één categorie.</p>

      <div
        aria-hidden={!selectedWeek}
        onClick={closeDrilldown}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.35)",
          opacity: selectedWeek ? 1 : 0,
          pointerEvents: selectedWeek ? "auto" : "none",
          transition: "opacity 200ms ease",
          zIndex: 998,
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
          width: "min(720px, 92vw)",
          background: "#fff",
          boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
          transform: selectedWeek ? "translateX(0)" : "translateX(100%)",
          transition: "transform 200ms ease",
          zIndex: 999,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #e6e6e6", display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Drilldown</div>
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
              border: "1px solid #ddd",
              borderRadius: 8,
              padding: "6px 10px",
              cursor: "pointer",
              height: 34,
            }}
          >
            Sluiten
          </button>
        </div>

        <div style={{ padding: "10px 20px", borderBottom: "1px solid #f0f0f0" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
            <span style={{ color: "#666" }}>
              rijen {drillOffset + 1}–{drillOffset + drillIssues.length}
            </span>
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
                    <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "8px" }}>Key</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "8px" }}>Type</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "8px" }}>Onderwerp</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "8px" }}>Status</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "8px" }}>Created</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: "8px" }}>Resolved</th>
                  </tr>
                </thead>
                <tbody>
                  {drillIssues.map((x) => (
                    <tr key={x.issue_key}>
                      <td style={{ borderBottom: "1px solid #f0f0f0", padding: "8px" }}>
                        <a href={`${JIRA_BASE}/browse/${x.issue_key}`} target="_blank" rel="noreferrer">
                          {x.issue_key}
                        </a>
                      </td>
                      <td
                        style={{
                          borderBottom: "1px solid #f0f0f0",
                          padding: "8px",
                          color: typeColor(x.request_type),
                        }}
                      >
                        {x.request_type || ""}
                      </td>
                      <td style={{ borderBottom: "1px solid #f0f0f0", padding: "8px" }}>{x.onderwerp || ""}</td>
                      <td style={{ borderBottom: "1px solid #f0f0f0", padding: "8px" }}>{x.status || ""}</td>
                      <td style={{ borderBottom: "1px solid #f0f0f0", padding: "8px" }}>{fmtDate(x.created_at)}</td>
                      <td style={{ borderBottom: "1px solid #f0f0f0", padding: "8px" }}>{fmtDate(x.resolved_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ marginTop: 8, color: "#666" }}>
                {drillIssues.length} tickets (limit {DRILL_LIMIT}, offset {drillOffset})
              </div>
            </div>
          ) : (
            <div style={{ color: "#666" }}>Klik op een punt in “Volume per week” om tickets te zien.</div>
          )}
        </div>
      </div>
    </div>
  );
}
