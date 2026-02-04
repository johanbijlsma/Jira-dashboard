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
import { useEffect, useMemo, useState } from "react";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend);

const API = "http://localhost:8000";
const JIRA_BASE = "https://planningsagenda.atlassian.net";

function isoDate(d) {
  // yyyy-mm-dd
  return d.toISOString().slice(0, 10);
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
  const [requestType, setRequestType] = useState("");
  const [onderwerp, setOnderwerp] = useState("");

  const [meta, setMeta] = useState({ request_types: [], onderwerpen: [] });
  const [volume, setVolume] = useState([]);
  const [p90, setP90] = useState([]);

  const [selectedWeek, setSelectedWeek] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const [drillIssues, setDrillIssues] = useState([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillOffset, setDrillOffset] = useState(0);
  const [drillHasNext, setDrillHasNext] = useState(false);

  const DRILL_LIMIT = 100;

  useEffect(() => {
    fetch(`${API}/meta`).then((r) => r.json()).then(setMeta);
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
      labels: weeks,
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

  return (
    <div style={{ fontFamily: "system-ui", padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <h1>JSM Dashboard (SD)</h1>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <label>
          Van<br />
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label>
          Tot<br />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
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
          Week vanaf <b>{selectedWeek}</b>
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
                  <td style={{ borderBottom: "1px solid #f0f0f0", padding: "8px" }}>{(x.created_at || "").slice(0, 10)}</td>
                  <td style={{ borderBottom: "1px solid #f0f0f0", padding: "8px" }}>{x.resolved_at ? x.resolved_at.slice(0, 10) : ""}</td>
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
