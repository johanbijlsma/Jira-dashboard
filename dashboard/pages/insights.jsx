import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Line } from "react-chartjs-2";
import {
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import { setupChartDefaults } from "../lib/chart-setup";
import { API, DEFAULT_SERVICEDESK_ONLY, INSIGHTS_ENABLED } from "../lib/dashboard-constants";
import { fetchInsightsBundle } from "../lib/insights-client";
import LiveAlertStack from "../components/LiveAlertStack";
import MainNav from "../components/MainNav";
import { fetchLiveAlerts } from "../lib/alerts-service";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);
setupChartDefaults(ChartJS);

function isoDate(value) {
  const dt = value instanceof Date ? value : new Date(value);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function confidenceLabel(value) {
  if (value === "high") return "Hoog";
  if (value === "medium") return "Midden";
  return "Laag";
}

function syncStatusText(status) {
  if (!status) return "";
  const fmt = (value) => {
    if (!value) return "—";
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return "—";
    return new Intl.DateTimeFormat("nl-NL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Europe/Amsterdam",
    }).format(dt);
  };
  const base = status.running ? "Synchroniseren…" : `Bijgewerkt: ${fmt(status.last_sync)}`;
  const upserts = status.last_result?.upserts != null ? ` · ${status.last_result.upserts} bijgewerkt` : "";
  const err = status.last_error ? ` · fout: ${status.last_error}` : "";
  return `${base}${upserts}${err}`;
}

export default function InsightsPage() {
  const router = useRouter();
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return isoDate(d);
  });
  const [dateTo, setDateTo] = useState(() => isoDate(new Date()));
  const [organization, setOrganization] = useState("");
  const [servicedeskOnly, setServicedeskOnly] = useState(DEFAULT_SERVICEDESK_ONLY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [configMessage, setConfigMessage] = useState("");
  const [configSaving, setConfigSaving] = useState(false);
  const [metricConfigDraft, setMetricConfigDraft] = useState({});
  const [expandedWhy, setExpandedWhy] = useState({});
  const [liveAlerts, setLiveAlerts] = useState({
    priority1: [],
    first_response_due_soon: [],
    first_response_overdue: [],
  });
  const [syncStatus, setSyncStatus] = useState(null);
  const [bundle, setBundle] = useState({
    meta: { organizations: [] },
    highlights: { cards: [] },
    trends: { series: [] },
    drivers: { drivers: [] },
  });

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        setLoading(true);
        setError("");
        const next = await fetchInsightsBundle({ dateFrom, dateTo, organization, servicedeskOnly });
        if (!cancelled) setBundle(next);
      } catch (err) {
        if (!cancelled) setError(err?.message || "Inzichten ophalen mislukt.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (INSIGHTS_ENABLED) run();
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo, organization, servicedeskOnly]);

  useEffect(() => {
    if (!INSIGHTS_ENABLED) return undefined;
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await fetchLiveAlerts({ servicedeskOnly });
        if (!cancelled) setLiveAlerts(next);
      } catch {
        if (!cancelled) {
          setLiveAlerts({ priority1: [], first_response_due_soon: [], first_response_overdue: [] });
        }
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [servicedeskOnly]);

  useEffect(() => {
    if (!INSIGHTS_ENABLED) return undefined;
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch(`${API}/sync/status`);
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) setSyncStatus(data || null);
      } catch {
        // keep page usable when status endpoint is unavailable
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const organizations = useMemo(
    () => (Array.isArray(bundle?.meta?.organizations) ? bundle.meta.organizations : []),
    [bundle]
  );
  const cards = useMemo(
    () => (Array.isArray(bundle?.highlights?.cards) ? bundle.highlights.cards : []),
    [bundle]
  );
  const series = useMemo(
    () => (Array.isArray(bundle?.trends?.series) ? bundle.trends.series : []),
    [bundle]
  );
  const drivers = useMemo(
    () => (Array.isArray(bundle?.drivers?.drivers) ? bundle.drivers.drivers : []),
    [bundle]
  );
  const metricConfig = useMemo(
    () => bundle?.trends?.metric_config || bundle?.highlights?.metric_config || {},
    [bundle]
  );
  const metricConfigRows = useMemo(
    () =>
      Object.entries(metricConfigDraft).map(([metric, cfg]) => ({
        metric,
        minAbsDelta: Number(cfg?.min_abs_delta ?? 0),
        minRelDelta: Number(cfg?.min_rel_delta ?? 0),
        trendDeltaMin: Number(cfg?.trend_delta_min ?? 0),
        trendRelDeltaMin: Number(cfg?.trend_rel_delta_min ?? 0),
        minSampleSize: Number(cfg?.min_sample_size ?? 0),
      })),
    [metricConfigDraft]
  );
  const metricConfigJson = useMemo(() => JSON.stringify(metricConfigDraft || {}, null, 2), [metricConfigDraft]);
  const syncInlineText = useMemo(() => syncStatusText(syncStatus), [syncStatus]);
  const priorityCards = useMemo(() => {
    return [...cards].sort(
      (a, b) =>
        Number(b?.decision_score || 0) - Number(a?.decision_score || 0) ||
        Math.abs(Number(b?.impact_value || 0)) - Math.abs(Number(a?.impact_value || 0))
    );
  }, [cards]);

  const pageStyle = { minHeight: "100vh", padding: "22px 18px 28px", boxSizing: "border-box" };
  const shellStyle = { maxWidth: 1240, margin: "0 auto", display: "grid", gap: 14 };
  const rowStyle = { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" };
  const cardStyle = {
    border: "1px solid var(--border)",
    borderRadius: 12,
    background: "var(--surface)",
    padding: 14,
    boxShadow: "0 8px 18px var(--shadow-medium)",
  };
  const filterLabelStyle = { display: "grid", gap: 6, fontSize: 13, color: "var(--text-muted)", fontWeight: 700 };
  const inputStyle = {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--surface-muted)",
    color: "var(--text-main)",
    padding: "7px 9px",
    fontSize: 14,
  };

  useEffect(() => {
    setMetricConfigDraft(metricConfig || {});
  }, [metricConfig]);

  if (!INSIGHTS_ENABLED) {
    return (
      <main style={pageStyle}>
        <div style={shellStyle}>
          <MainNav current="insights" syncStatusText={syncInlineText} />
          <section style={cardStyle}>
            <h1 style={{ margin: 0 }}>Insights</h1>
            <p style={{ margin: "8px 0 0", color: "var(--text-muted)" }}>Insights is uitgeschakeld via feature flag.</p>
          </section>
        </div>
      </main>
    );
  }

  const copyMetricConfig = async () => {
    try {
      if (!metricConfigRows.length) {
        setCopyMessage("Geen config om te kopiëren.");
        return;
      }
      await navigator.clipboard.writeText(metricConfigJson);
      setCopyMessage("Metric config gekopieerd.");
      window.setTimeout(() => setCopyMessage(""), 2000);
    } catch {
      setCopyMessage("Kopiëren mislukt.");
      window.setTimeout(() => setCopyMessage(""), 2000);
    }
  };

  const updateDraftField = (metric, field, rawValue) => {
    const nextValue = Number(rawValue);
    setMetricConfigDraft((prev) => ({
      ...prev,
      [metric]: {
        ...(prev?.[metric] || {}),
        [field]: Number.isFinite(nextValue) ? nextValue : 0,
      },
    }));
  };

  const resetDraftConfig = () => {
    setMetricConfigDraft(metricConfig || {});
    setConfigMessage("Wijzigingen teruggezet.");
    window.setTimeout(() => setConfigMessage(""), 2000);
  };

  const saveDraftConfig = async () => {
    try {
      setConfigSaving(true);
      setConfigMessage("");
      const response = await fetch(`${API}/config/insights`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metric_config: metricConfigDraft }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.detail || `Opslaan mislukt (${response.status})`);
      }
      const saved = await response.json();
      const savedConfig = saved?.metric_config || {};
      setMetricConfigDraft(savedConfig);
      setBundle((prev) => ({
        ...prev,
        trends: { ...(prev?.trends || {}), metric_config: savedConfig },
        highlights: { ...(prev?.highlights || {}), metric_config: savedConfig },
      }));
      setConfigMessage("Thresholds opgeslagen.");
      window.setTimeout(() => setConfigMessage(""), 2000);
    } catch (err) {
      setConfigMessage(err?.message || "Opslaan mislukt.");
      window.setTimeout(() => setConfigMessage(""), 2500);
    } finally {
      setConfigSaving(false);
    }
  };

  const restoreDefaultConfig = async () => {
    try {
      setConfigSaving(true);
      setConfigMessage("");
      const response = await fetch(`${API}/config/insights/reset`, { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.detail || `Herstellen mislukt (${response.status})`);
      }
      const saved = await response.json();
      const savedConfig = saved?.metric_config || {};
      setMetricConfigDraft(savedConfig);
      setBundle((prev) => ({
        ...prev,
        trends: { ...(prev?.trends || {}), metric_config: savedConfig },
        highlights: { ...(prev?.highlights || {}), metric_config: savedConfig },
      }));
      setConfigMessage("Standaardinstellingen hersteld.");
      window.setTimeout(() => setConfigMessage(""), 2000);
    } catch (err) {
      setConfigMessage(err?.message || "Herstellen mislukt.");
      window.setTimeout(() => setConfigMessage(""), 2500);
    } finally {
      setConfigSaving(false);
    }
  };

  const urgencyLabel = (value) => {
    if (value === "now") return "Nu doen";
    if (value === "this_week") return "Deze week";
    return "Monitoren";
  };

  return (
    <main style={pageStyle}>
      <LiveAlertStack
        alerts={liveAlerts}
        onAlertClick={() => {
          router.push("/?panel=alerts");
        }}
      />
      <div style={shellStyle}>
        <MainNav current="insights" syncStatusText={syncInlineText} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <p
              style={{
                margin: 0,
                color: "var(--accent)",
                fontSize: 12,
                fontWeight: 900,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              AI Insights
            </p>
            <h1 style={{ margin: "4px 0 0", fontSize: 30, lineHeight: 1.1 }}>Insights</h1>
            <p style={{ margin: "6px 0 0", color: "var(--text-muted)" }}>
              Geautomatiseerde signalen voor afwijkingen, SLA-risico en belangrijkste drivers.
            </p>
          </div>
        </div>

        <section style={cardStyle}>
          <div style={rowStyle}>
            <label style={filterLabelStyle}>
              Vanaf
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={inputStyle} />
            </label>
            <label style={filterLabelStyle}>
              Tot
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={inputStyle} />
            </label>
            <label style={filterLabelStyle}>
              Organization
              <select value={organization} onChange={(e) => setOrganization(e.target.value)} style={inputStyle}>
                <option value="">Alle organizations</option>
                {organizations.map((org) => (
                  <option value={org} key={org}>
                    {org}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ ...filterLabelStyle, gridAutoFlow: "column", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={servicedeskOnly}
                onChange={(e) => setServicedeskOnly(e.target.checked)}
              />
              Alleen servicedesk
            </label>
          </div>
        </section>

        {loading ? <section style={cardStyle}>Bezig met laden…</section> : null}
        {error ? <section style={{ ...cardStyle, borderColor: "var(--danger)" }}>{error}</section> : null}

        {!loading && !error ? (
          <>
            <section style={cardStyle}>
              <h2 style={{ margin: 0 }}>Actie-overzicht</h2>
              <p style={{ margin: "8px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
                Prioriteiten voor operationele sturing, zonder statistische details.
              </p>
              {priorityCards.length ? (
                <div style={{ marginTop: 12, display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
                  {priorityCards.slice(0, 3).map((card) => (
                    <article key={`priority-${card.id}`} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>
                        {urgencyLabel(card.urgency)} · Betrouwbaarheid {confidenceLabel(card.confidence)} · Beslisscore{" "}
                        {card.decision_score ?? "—"}
                      </div>
                      <h3 style={{ margin: "6px 0 6px" }}>{card.title}</h3>
                      <p style={{ margin: 0, color: "var(--text-subtle)" }}>{card.business_summary || card.summary}</p>
                      <div
                        style={{
                          marginTop: 8,
                          border: "1px solid var(--border)",
                          background: "var(--surface-muted)",
                          borderRadius: 8,
                          padding: "8px 10px",
                          fontSize: 13,
                        }}
                      >
                        <strong>Aanbevolen actie:</strong> {card.recommended_action || "Controleer dit signaal met het team."}
                      </div>
                      <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
                        Eigenaar: {card.owner_hint || "Servicedesk lead"} · Deadline: {card.due_hint || "Deze week"}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p style={{ margin: "10px 0 0", color: "var(--text-muted)" }}>Geen directe acties gevonden voor deze periode.</p>
              )}
            </section>

            <section style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <h2 style={{ margin: 0 }}>Tuning Pane</h2>
                <div style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={resetDraftConfig}
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      padding: "6px 10px",
                      fontSize: 12,
                      fontWeight: 700,
                      background: "var(--surface)",
                      color: "var(--text-main)",
                      cursor: "pointer",
                    }}
                    disabled={configSaving}
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={saveDraftConfig}
                    style={{
                      border: "1px solid var(--accent)",
                      borderRadius: 8,
                      padding: "6px 10px",
                      fontSize: 12,
                      fontWeight: 700,
                      background: "var(--accent)",
                      color: "#fff",
                      cursor: "pointer",
                    }}
                    disabled={configSaving}
                  >
                    {configSaving ? "Opslaan..." : "Opslaan"}
                  </button>
                  <button
                    type="button"
                    onClick={restoreDefaultConfig}
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      padding: "6px 10px",
                      fontSize: 12,
                      fontWeight: 700,
                      background: "var(--surface)",
                      color: "var(--text-main)",
                      cursor: "pointer",
                    }}
                    disabled={configSaving}
                  >
                    Herstel defaults
                  </button>
                  <button
                    type="button"
                    onClick={copyMetricConfig}
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      padding: "6px 10px",
                      fontSize: 12,
                      fontWeight: 700,
                      background: "var(--surface-muted)",
                      color: "var(--text-main)",
                      cursor: "pointer",
                    }}
                  >
                    Kopieer JSON
                  </button>
                </div>
              </div>
              <p style={{ margin: "8px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
                Actieve drempels uit backend (`metric_config`) voor planning en calibratie.
              </p>
              {copyMessage || configMessage ? (
                <p style={{ margin: "8px 0 0", color: "var(--text-muted)", fontSize: 12 }}>{copyMessage || configMessage}</p>
              ) : null}
              {metricConfigRows.length ? (
                <div style={{ overflowX: "auto", marginTop: 10 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: "6px 0" }}>Metric</th>
                        <th style={{ textAlign: "right", borderBottom: "1px solid var(--border)", padding: "6px 0" }}>Min abs delta</th>
                        <th style={{ textAlign: "right", borderBottom: "1px solid var(--border)", padding: "6px 0" }}>Min rel delta</th>
                        <th style={{ textAlign: "right", borderBottom: "1px solid var(--border)", padding: "6px 0" }}>Trend min delta</th>
                        <th style={{ textAlign: "right", borderBottom: "1px solid var(--border)", padding: "6px 0" }}>Trend min rel</th>
                        <th style={{ textAlign: "right", borderBottom: "1px solid var(--border)", padding: "6px 0" }}>Min sample</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metricConfigRows.map((row) => (
                        <tr key={row.metric}>
                          <td style={{ borderBottom: "1px solid var(--border)", padding: "6px 0", fontWeight: 700 }}>{row.metric}</td>
                          <td style={{ textAlign: "right", borderBottom: "1px solid var(--border)", padding: "6px 0" }}>
                            <input
                              type="number"
                              step="0.01"
                              value={row.minAbsDelta}
                              onChange={(e) => updateDraftField(row.metric, "min_abs_delta", e.target.value)}
                              style={{ width: 92, ...inputStyle }}
                            />
                          </td>
                          <td style={{ textAlign: "right", borderBottom: "1px solid var(--border)", padding: "6px 0" }}>
                            <input
                              type="number"
                              step="0.01"
                              value={row.minRelDelta}
                              onChange={(e) => updateDraftField(row.metric, "min_rel_delta", e.target.value)}
                              style={{ width: 92, ...inputStyle }}
                            />
                          </td>
                          <td style={{ textAlign: "right", borderBottom: "1px solid var(--border)", padding: "6px 0" }}>
                            <input
                              type="number"
                              step="0.01"
                              value={row.trendDeltaMin}
                              onChange={(e) => updateDraftField(row.metric, "trend_delta_min", e.target.value)}
                              style={{ width: 92, ...inputStyle }}
                            />
                          </td>
                          <td style={{ textAlign: "right", borderBottom: "1px solid var(--border)", padding: "6px 0" }}>
                            <input
                              type="number"
                              step="0.01"
                              value={row.trendRelDeltaMin}
                              onChange={(e) => updateDraftField(row.metric, "trend_rel_delta_min", e.target.value)}
                              style={{ width: 92, ...inputStyle }}
                            />
                          </td>
                          <td style={{ textAlign: "right", borderBottom: "1px solid var(--border)", padding: "6px 0" }}>
                            <input
                              type="number"
                              step="1"
                              value={row.minSampleSize}
                              onChange={(e) => updateDraftField(row.metric, "min_sample_size", e.target.value)}
                              style={{ width: 92, ...inputStyle }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ margin: "10px 0 0", color: "var(--text-muted)" }}>Geen metric_config beschikbaar.</p>
              )}
            </section>

            <section style={cardStyle}>
              <h2 style={{ margin: 0 }}>Top Highlights</h2>
              {cards.length ? (
                <div style={{ marginTop: 12, display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
                  {cards.map((card) => (
                    <article key={card.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {urgencyLabel(card.urgency)} · Betrouwbaarheid {confidenceLabel(card.confidence)} · Beslisscore{" "}
                        {card.decision_score ?? "—"}
                      </div>
                      <h3 style={{ margin: "6px 0 4px" }}>{card.title}</h3>
                      <p style={{ margin: "8px 0 0", color: "var(--text-subtle)" }}>{card.business_summary || card.summary}</p>
                      <div
                        style={{
                          marginTop: 8,
                          border: "1px solid var(--border)",
                          background: "var(--surface-muted)",
                          borderRadius: 8,
                          padding: "8px 10px",
                          fontSize: 13,
                        }}
                      >
                        <strong>Actie:</strong> {card.recommended_action || "Controleer dit signaal met het team."}
                      </div>
                      <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
                        Eigenaar: {card.owner_hint || "Servicedesk lead"} · Deadline: {card.due_hint || "Deze week"}
                      </div>
                      <button
                        type="button"
                        onClick={() => setExpandedWhy((prev) => ({ ...prev, [card.id]: !prev[card.id] }))}
                        style={{
                          marginTop: 8,
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          padding: "6px 10px",
                          fontSize: 12,
                          fontWeight: 700,
                          background: "var(--surface)",
                          color: "var(--text-main)",
                          cursor: "pointer",
                        }}
                      >
                        Waarom zie ik dit?
                      </button>
                      {expandedWhy[card.id] ? (
                        <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
                          <div>{card.why}</div>
                          <div style={{ marginTop: 4 }}>
                            Impact: {card.impact_value} {card.impact_unit}
                          </div>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <p style={{ margin: "10px 0 0", color: "var(--text-muted)" }}>Geen highlights gevonden voor deze periode.</p>
              )}
            </section>

            <section style={cardStyle}>
              <h2 style={{ margin: 0 }}>Trend Signalen</h2>
              {series.length ? (
                <div style={{ marginTop: 12, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
                  {series.map((item) => {
                    const points = Array.isArray(item.points) ? item.points : [];
                    const labels = points.map((p) => p.week);
                    const actual = points.map((p) => p.actual);
                    const expected = points.map((p) => p.expected);
                    const minSampleSize = Number(item.min_sample_size || 0);
                    const insufficientWeeks = points.filter(
                      (p) => Number(p.sample_size || 0) > 0 && Number(p.sample_size || 0) < minSampleSize
                    ).length;
                    return (
                      <article key={item.metric} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
                        <h3 style={{ margin: 0 }}>{item.label}</h3>
                        {insufficientWeeks > 0 ? (
                          <div
                            style={{
                              marginTop: 6,
                              fontSize: 12,
                              color: "var(--text-muted)",
                              background: "var(--surface-muted)",
                              border: "1px solid var(--border)",
                              borderRadius: 8,
                              padding: "4px 6px",
                              display: "inline-block",
                            }}
                          >
                            Onvoldoende volume in {insufficientWeeks} week/weken (min {minSampleSize}).
                          </div>
                        ) : null}
                        <div style={{ marginTop: 8 }}>
                          <Line
                            data={{
                              labels,
                              datasets: [
                                {
                                  label: "Actual",
                                  data: actual,
                                  borderColor: "#2563eb",
                                  backgroundColor: "rgba(37,99,235,0.18)",
                                  borderWidth: 2,
                                  pointRadius: 3,
                                },
                                {
                                  label: "Expected",
                                  data: expected,
                                  borderColor: "#64748b",
                                  borderDash: [6, 4],
                                  borderWidth: 2,
                                  pointRadius: 0,
                                },
                              ],
                            }}
                            options={{
                              responsive: true,
                              maintainAspectRatio: false,
                              plugins: { legend: { position: "bottom" } },
                              scales: { y: { beginAtZero: false } },
                            }}
                            height={180}
                          />
                        </div>
                        <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
                          {points.filter((p) => p.is_anomaly).length} anomalie(n) in geselecteerde periode
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p style={{ margin: "10px 0 0", color: "var(--text-muted)" }}>Geen trends beschikbaar.</p>
              )}
            </section>

            <section style={cardStyle}>
              <h2 style={{ margin: 0 }}>Drivers</h2>
              {drivers.length ? (
                <div style={{ marginTop: 12, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
                  {drivers.map((group) => (
                    <article key={group.dimension} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
                      <h3 style={{ margin: 0 }}>{group.label}</h3>
                      {Array.isArray(group.items) && group.items.length ? (
                        <div style={{ overflowX: "auto", marginTop: 8 }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                            <thead>
                              <tr>
                                <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: "6px 0" }}>
                                  Categorie
                                </th>
                                <th style={{ textAlign: "right", borderBottom: "1px solid var(--border)", padding: "6px 0" }}>
                                  Delta
                                </th>
                                <th style={{ textAlign: "right", borderBottom: "1px solid var(--border)", padding: "6px 0" }}>
                                  Bijdrage
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.items.slice(0, 6).map((item) => (
                                <tr key={item.category}>
                                  <td style={{ borderBottom: "1px solid var(--border)", padding: "6px 0" }}>{item.category}</td>
                                  <td style={{ textAlign: "right", borderBottom: "1px solid var(--border)", padding: "6px 0" }}>
                                    {item.delta}
                                  </td>
                                  <td style={{ textAlign: "right", borderBottom: "1px solid var(--border)", padding: "6px 0" }}>
                                    {item.contribution_pct}%
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p style={{ margin: "8px 0 0", color: "var(--text-muted)" }}>Geen drivers in deze scope.</p>
                      )}
                    </article>
                  ))}
                </div>
              ) : (
                <p style={{ margin: "10px 0 0", color: "var(--text-muted)" }}>Geen driver-data beschikbaar.</p>
              )}
            </section>
          </>
        ) : null}
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
          font-family: "IBM Plex Sans", "Segoe UI", "Inter", "Roboto", "Helvetica Neue", Arial, sans-serif;
        }
        input,
        select,
        textarea,
        button {
          color: var(--text-main);
          font-family: inherit;
        }
        a {
          color: var(--accent);
        }
      `}</style>
    </main>
  );
}
