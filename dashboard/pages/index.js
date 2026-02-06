import { Bar, Line } from "react-chartjs-2";
import {
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

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend);

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
    d.setMonth(d.getMonth() - 6);
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
  const [p90, setP90] = useState([]);

  const [syncStatus, setSyncStatus] = useState(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [syncMessageKind, setSyncMessageKind] = useState("success"); // "success" | "error"

  const [selectedWeek, setSelectedWeek] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const [drillIssues, setDrillIssues] = useState([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillOffset, setDrillOffset] = useState(0);
  const [drillHasNext, setDrillHasNext] = useState(false);

  const DRILL_LIMIT = 100;
  const syncBusy = syncLoading || !!syncStatus?.running;

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
    const params = new URLSearchParams({
      date_from: dateFrom,
      date_to: dateTo,
    });
    if (requestType) params.set("request_type", requestType);
    if (onderwerp) params.set("onderwerp", onderwerp);

    fetch(`${API}/metrics/volume_weekly?` + params.toString())
      .then((r) => r.json())
      .then(setVolume);

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

  const series = useMemo(() => {
    const types = requestType ? [requestType] : meta.request_types;
    return types.map((t) => ({
      label: t,
      data: weeks.map((w) => {
        const row = volume.find((v) => v.request_type === t && v.week.slice(0, 10) === w);
        return row ? row.tickets : 0;
      }),
    }));
  }, [weeks, volume, meta.request_types, requestType]);

  const lineData = useMemo(
    () => ({
      labels: weeks.map((w) => fmtDate(w)),
      datasets: series.map((s) => ({
        label: s.label,
        data: s.data,
        tension: 0.2,
      })),
    }),
    [weeks, series]
  );

  const barData = useMemo(
    () => ({
      labels: p90.map((x) => x.request_type),
      datasets: [
        {
          label: "p90 doorlooptijd (uren)",
          data: p90.map((x) => x.p90_hours),
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

  async function fetchDrilldown(weekStart, typeLabel, offset = 0) {
    setSelectedWeek(weekStart);
    setSelectedType(typeLabel || "");
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
      if (onderwerp) params.set("onderwerp", onderwerp);

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
          <select value={requestType} onChange={(e) => setRequestType(e.target.value)}>
            <option value="">(alle)</option>
            {meta.request_types.map((rt) => (
              <option key={rt} value={rt}>
                {rt}
              </option>
            ))}
          </select>
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
            fetchDrilldown(weekStart, requestType ? requestType : typeLabel);
          },
          plugins: {
            legend: { position: "top" },
            tooltip: { mode: "nearest", intersect: false },
          },
          interaction: { mode: "nearest", intersect: false },
        }}
      />

      <h2 style={{ marginTop: 28 }}>Doorlooptijd p90 per request type</h2>
      <Bar data={barData} />

      <h2 style={{ marginTop: 28 }}>Drilldown</h2>

      {selectedWeek ? (
        <div style={{ marginBottom: 10, color: "#444" }}>
          Week vanaf <b>{fmtDate(selectedWeek)}</b>
          {selectedType ? (
            <>
              {" "}— type: <b>{selectedType}</b>
            </>
          ) : null}
          {onderwerp ? (
            <>
              {" "}— onderwerp: <b>{onderwerp}</b>
            </>
          ) : null}
          <button
            style={{ marginLeft: 12 }}
            onClick={() => {
              setSelectedWeek("");
              setSelectedType("");
              setDrillIssues([]);
              setDrillOffset(0);
              setDrillHasNext(false);
            }}
          >
            Sluiten
          </button>
          <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={() => fetchDrilldown(selectedWeek, selectedType, Math.max(0, drillOffset - DRILL_LIMIT))}
              disabled={drillOffset === 0 || drillLoading}
            >
              Vorige
            </button>
            <button
              onClick={() => fetchDrilldown(selectedWeek, selectedType, drillOffset + DRILL_LIMIT)}
              disabled={!drillHasNext || drillLoading}
            >
              Volgende
            </button>
            <span style={{ color: "#666" }}>
              rijen {drillOffset + 1}–{drillOffset + drillIssues.length}
            </span>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 10, color: "#666" }}>Klik op een punt in “Volume per week” om tickets te zien.</div>
      )}

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
                  <td style={{ borderBottom: "1px solid #f0f0f0", padding: "8px" }}>{x.request_type || ""}</td>
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
      ) : null}

      <p style={{ marginTop: 20, color: "#666" }}>Tip: filter op “Onderwerp” om p90 per type te zien voor één categorie.</p>
    </div>
  );
}
