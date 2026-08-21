import Link from "next/link";
import Head from "next/head";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API } from "../lib/dashboard-constants";
import { usePageVisibility } from "../lib/use-page-visibility";

function fmtDateTime(value) {
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
}

function fmtDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "—";
}

function num(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return new Intl.NumberFormat("nl-NL").format(Number(value));
}

function statusFaviconDataUri(hasError) {
  const glyph = hasError ? "❌" : "✅";
  const bg = hasError ? "#7f1d1d" : "#14532d";
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='12' fill='${bg}'/><text x='32' y='42' text-anchor='middle' font-size='30'>${glyph}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function triggerBadge(triggerType) {
  const normalized = String(triggerType || "").toLowerCase();
  if (normalized === "automatic") return "⚙️ Automatisch";
  return "👤 Handmatig";
}

export default function StatusPage() {
  const isPageVisible = usePageVisibility();
  const wasPageVisibleRef = useRef(isPageVisible);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionBusy, setActionBusy] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionPulse, setActionPulse] = useState(0);
  const [testAlertKeys, setTestAlertKeys] = useState([]);
  const [tokenWarning, setTokenWarning] = useState(null);
  const [selectedRunIndex, setSelectedRunIndex] = useState(0);

  const fetchStatus = useCallback(async () => {
    try {
      setError("");
      const r = await fetch(`${API}/status`);
      if (!r.ok) throw new Error(`Status ophalen mislukt (${r.status})`);
      const data = await r.json();
      setStatus(data || null);
    } catch (err) {
      setError(err?.message || "Status ophalen mislukt");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTestAlertState = useCallback(async () => {
    try {
      const r = await fetch(`${API}/dev/alerts/test-state`);
      if (!r.ok) return;
      const data = await r.json();
      setTestAlertKeys(Array.isArray(data?.keys) ? data.keys : []);
    } catch {
      // Ignore in non-dev environments.
    }
  }, []);

  const fetchTokenWarning = useCallback(async () => {
    try {
      const r = await fetch(`${API}/config/jira-token-warning`);
      if (r.ok) setTokenWarning(await r.json());
    } catch {
      // Tokenstatus is aanvullend op de backendstatus.
    }
  }, []);

  const triggerSync = useCallback(async (full = false) => {
    const mode = full ? "full" : "incremental";
    try {
      setActionBusy(mode);
      setActionMessage("");
      const r = await fetch(`${API}/sync${full ? "/full" : ""}`, { method: "POST" });
      if (!r.ok) throw new Error(`Sync starten mislukt (${r.status})`);
      setActionMessage(full ? "Full sync is gestart." : "Sync is gestart.");
      setActionPulse((v) => v + 1);
      await fetchStatus();
    } catch (err) {
      setActionMessage(err?.message || "Sync starten mislukt.");
    } finally {
      setActionBusy("");
    }
  }, [fetchStatus]);

  const triggerDevAlert = useCallback(async () => {
    try {
      setActionBusy("dev-alert");
      setActionMessage("");
      const r = await fetch(`${API}/dev/alerts/trigger`, { method: "POST" });
      if (!r.ok) throw new Error(`Test alert triggeren mislukt (${r.status})`);
      await fetch(`${API}/alerts/live?servicedesk_only=true`);
      setActionMessage("Test alert is gezet.");
      setActionPulse((v) => v + 1);
      await fetchStatus();
      await fetchTestAlertState();
    } catch (err) {
      setActionMessage(err?.message || "Test alert triggeren mislukt.");
    } finally {
      setActionBusy("");
    }
  }, [fetchStatus, fetchTestAlertState]);

  const clearDevAlert = useCallback(async (issueKey) => {
    try {
      setActionBusy("dev-alert-clear");
      setActionMessage("");
      const suffix = issueKey ? `?issue_key=${encodeURIComponent(issueKey)}` : "";
      const r = await fetch(`${API}/dev/alerts/clear${suffix}`, { method: "POST" });
      if (!r.ok) throw new Error(`Test alert wissen mislukt (${r.status})`);
      setActionMessage("Test alert is verwijderd.");
      setActionPulse((v) => v + 1);
      await fetchStatus();
      await fetchTestAlertState();
    } catch (err) {
      setActionMessage(err?.message || "Test alert wissen mislukt.");
    } finally {
      setActionBusy("");
    }
  }, [fetchStatus, fetchTestAlertState]);

  const triggerTokenWarning = useCallback(async (scenario = "renewal") => {
    try {
      setActionBusy("token-warning");
      const r = await fetch(`${API}/dev/jira-token-warning/trigger?scenario=${encodeURIComponent(scenario)}`, { method: "POST" });
      if (!r.ok) throw new Error(`Test tokenwaarschuwing mislukt (${r.status})`);
      setActionMessage("Testwaarschuwing voor de Jira-token is gezet.");
      await fetchTokenWarning();
    } catch (err) {
      setActionMessage(err?.message || "Test tokenwaarschuwing mislukt.");
    } finally {
      setActionBusy("");
    }
  }, [fetchTokenWarning]);

  const clearTokenTest = useCallback(async () => {
    try {
      setActionBusy("token-warning-clear");
      await fetch(`${API}/dev/jira-token-warning/clear`, { method: "POST" });
      await fetchTokenWarning();
    } finally {
      setActionBusy("");
    }
  }, [fetchTokenWarning]);

  useEffect(() => {
    fetchStatus();
    fetchTestAlertState();
    fetchTokenWarning();
  }, [fetchStatus, fetchTestAlertState, fetchTokenWarning]);

  useEffect(() => {
    if (!wasPageVisibleRef.current && isPageVisible) {
      fetchStatus();
      fetchTestAlertState();
      fetchTokenWarning();
    }
    wasPageVisibleRef.current = isPageVisible;
  }, [fetchStatus, fetchTestAlertState, fetchTokenWarning, isPageVisible]);

  useEffect(() => {
    const intervalMs = isPageVisible ? (status?.running ? 3000 : 15000) : 60000;
    const timer = window.setInterval(() => {
      fetchStatus();
      fetchTestAlertState();
      fetchTokenWarning();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [fetchStatus, fetchTestAlertState, fetchTokenWarning, isPageVisible, status?.running]);

  const recentRuns = useMemo(
    () =>
      Array.isArray(status?.recent_runs)
        ? status.recent_runs
        : (Array.isArray(status?.successful_runs)
          ? status.successful_runs.map((row) => ({ ...row, success: true, error: null }))
          : []),
    [status]
  );
  const selectedRun = recentRuns[selectedRunIndex] || recentRuns[0] || null;
  const latestRunHasError = recentRuns.length ? recentRuns[0]?.success === false : false;
  const faviconHref = useMemo(() => statusFaviconDataUri(Boolean(latestRunHasError)), [latestRunHasError]);

  useEffect(() => {
    if (!recentRuns.length) return;
    if (selectedRunIndex >= recentRuns.length) setSelectedRunIndex(0);
  }, [recentRuns, selectedRunIndex]);

  const pageStyle = {
    minHeight: "100vh",
    padding: "24px 20px 32px",
    boxSizing: "border-box",
  };
  const shellStyle = {
    maxWidth: 1180,
    margin: "0 auto",
    display: "grid",
    gap: 14,
  };
  const headerStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  };
  const titleStyle = {
    margin: 0,
    fontSize: 28,
    lineHeight: 1.15,
    color: "var(--text-main)",
  };
  const subtleStyle = {
    margin: "4px 0 0",
    color: "var(--text-muted)",
    fontSize: 13,
  };
  const cardGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: 12,
  };
  const cardStyle = {
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: 14,
    background: "var(--surface)",
    boxShadow: "0 8px 18px var(--shadow-medium)",
  };
  const cardTitleStyle = {
    margin: 0,
    fontSize: 13,
    fontWeight: 700,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  };
  const cardValueStyle = {
    margin: "8px 0 0",
    fontSize: 18,
    fontWeight: 800,
    color: "var(--text-main)",
  };
  const cardMetaStyle = {
    margin: "6px 0 0",
    color: "var(--text-subtle)",
    fontSize: 13,
  };
  const tableWrapStyle = {
    border: "1px solid var(--border)",
    borderRadius: 12,
    overflow: "hidden",
    background: "var(--surface)",
    boxShadow: "0 8px 18px var(--shadow-medium)",
  };
  const tableStyle = {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  };
  const thStyle = {
    textAlign: "left",
    padding: "10px 12px",
    borderBottom: "1px solid var(--border)",
    color: "var(--text-muted)",
    background: "var(--surface-muted)",
    fontWeight: 700,
    whiteSpace: "nowrap",
  };
  const tdStyle = {
    padding: "10px 12px",
    borderBottom: "1px solid var(--border)",
    color: "var(--text-main)",
    verticalAlign: "top",
  };
  const buttonStyle = {
    border: "1px solid var(--accent)",
    background: "var(--accent)",
    color: "#fff",
    borderRadius: 8,
    padding: "7px 11px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  };
  const backLinkStyle = {
    border: "1px solid var(--border)",
    background: "var(--surface)",
    color: "var(--text-main)",
    borderRadius: 8,
    padding: "7px 11px",
    fontSize: 13,
    fontWeight: 700,
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
  };

  return (
    <main style={pageStyle}>
      <Head>
        <title>Status | Dashboard Servicedesk Twentecs</title>
        <link rel="icon" href={faviconHref} />
      </Head>
      <div style={shellStyle}>
        <div style={headerStyle}>
          <div>
            <h1 style={titleStyle}>Status</h1>
            <p style={subtleStyle}>Synchronisatie en operationele status van de dashboard backend</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Link href="/" style={backLinkStyle}>Terug naar dashboard</Link>
            <button
              type="button"
              onClick={() => triggerSync(false)}
              style={buttonStyle}
              disabled={loading || actionBusy === "incremental" || !!status?.running}
            >
              {actionBusy === "incremental" ? "Starten…" : "Start sync"}
            </button>
            <button
              type="button"
              onClick={() => triggerSync(true)}
              style={buttonStyle}
              disabled={loading || actionBusy === "full" || !!status?.running}
            >
              {actionBusy === "full" ? "Starten…" : "Start full sync"}
            </button>
            <button type="button" onClick={fetchStatus} style={buttonStyle} disabled={loading}>
              {loading ? "Vernersen…" : "Ververs"}
            </button>
          </div>
        </div>

        {actionMessage ? (
          <div
            key={`action-msg-${actionPulse}`}
            className="sync-start-banner"
            style={{
              ...cardStyle,
              borderColor: "color-mix(in srgb, var(--ok) 45%, var(--border))",
              background: "color-mix(in srgb, var(--ok) 12%, var(--surface))",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span className="sync-start-dot" aria-hidden="true" />
            <span>{actionMessage}</span>
          </div>
        ) : null}

        {status?.running ? (
          <div
            className="sync-live-banner"
            style={{
              ...cardStyle,
              borderColor: "color-mix(in srgb, var(--accent) 45%, var(--border))",
              background: "color-mix(in srgb, var(--accent) 10%, var(--surface))",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span className="sync-live-dot" aria-hidden="true" />
            <span>Er loopt al een synchronisatie. Status wordt live bijgewerkt.</span>
          </div>
        ) : null}

        <div style={cardGridStyle}>
          <section style={cardStyle}>
            <p style={cardTitleStyle}>Jira API-token</p>
            <p style={cardValueStyle}>{fmtDate(tokenWarning?.expires_at)}</p>
            <p style={cardMetaStyle}>{tokenWarning?.renewal_pending ? "Vernieuwd in Jira · wacht op Development" : "Tokenconfiguratie bevestigd"}</p>
          </section>
        </div>

        {error ? (
          <div style={{ ...cardStyle, borderColor: "var(--danger)", color: "var(--danger)" }}>
            {error}
          </div>
        ) : null}

        <div style={cardGridStyle}>
          <section style={cardStyle}>
            <h2 style={cardTitleStyle}>Huidige sync</h2>
            <p style={cardValueStyle}>{status?.running ? "Actief" : "Inactief"}</p>
            <p style={cardMetaStyle}>Laatste run gestart: {fmtDateTime(status?.last_run)}</p>
            <p style={cardMetaStyle}>Laatste sync-positie: {fmtDateTime(status?.last_sync)}</p>
            <p style={cardMetaStyle}>Laatste upserts: {num(status?.last_result?.upserts)}</p>
            <p style={cardMetaStyle}>
              Autosync: {status?.auto_sync?.enabled ? "Aan" : "Uit"} · {num(status?.auto_sync?.incremental_interval_seconds)}s
            </p>
          </section>

          <section style={cardStyle}>
            <h2 style={cardTitleStyle}>Laatste full sync</h2>
            <p style={cardValueStyle}>{fmtDateTime(status?.last_full_sync?.started_at)}</p>
            <p style={cardMetaStyle}>Einde: {fmtDateTime(status?.last_full_sync?.finished_at)}</p>
            <p style={cardMetaStyle}>Upserts: {num(status?.last_full_sync?.upserts)}</p>
            <p style={cardMetaStyle}>Trigger: {triggerBadge(status?.last_full_sync?.trigger_type)}</p>
            <p style={cardMetaStyle}>Set last sync: {fmtDateTime(status?.last_full_sync?.set_last_sync)}</p>
          </section>

          <section style={cardStyle}>
            <h2 style={cardTitleStyle}>Geselecteerde sync</h2>
            <p style={cardValueStyle}>
              {selectedRun
                ? (selectedRun.success ? "✅ Succes" : (selectedRun.error ? "❌ Fout" : "⏳ Bezig"))
                : "—"}
            </p>
            <p style={cardMetaStyle}>Start: {fmtDateTime(selectedRun?.started_at)}</p>
            <p style={cardMetaStyle}>Einde: {fmtDateTime(selectedRun?.finished_at)}</p>
            <p style={cardMetaStyle}>Type: {selectedRun?.mode || "—"}</p>
            <p style={cardMetaStyle}>Trigger: {triggerBadge(selectedRun?.trigger_type)}</p>
            <p style={cardMetaStyle}>Upserts: {num(selectedRun?.upserts)}</p>
            <p style={cardMetaStyle}>Set last sync: {fmtDateTime(selectedRun?.set_last_sync)}</p>
            <p style={cardMetaStyle}>Foutmelding: {selectedRun?.error || "Geen"}</p>
          </section>
        </div>

        <section style={tableWrapStyle}>
          <div style={{ padding: "12px 12px 0", color: "var(--text-subtle)", fontWeight: 700 }}>
            Laatste 10 syncs
          </div>
          <div style={{ overflowX: "auto", padding: 12 }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Start</th>
                  <th style={thStyle}>Einde</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Trigger</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Upserts</th>
                  <th style={thStyle}>Set last sync</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.length ? (
                  recentRuns.map((row, idx) => (
                    <tr
                      key={`run-${idx}`}
                      onClick={() => setSelectedRunIndex(idx)}
                      style={{ cursor: "pointer", background: idx === selectedRunIndex ? "var(--surface-muted)" : "transparent" }}
                    >
                      <td style={tdStyle}>{fmtDateTime(row.started_at)}</td>
                      <td style={tdStyle}>{fmtDateTime(row.finished_at)}</td>
                      <td style={tdStyle}>{row.mode || "—"}</td>
                      <td style={tdStyle}>{triggerBadge(row.trigger_type)}</td>
                      <td style={tdStyle}>
                        {row.success ? "✅ Succes" : (row.error ? "❌ Fout" : "⏳ Bezig")}
                      </td>
                      <td style={tdStyle}>{num(row.upserts)}</td>
                      <td style={tdStyle}>{fmtDateTime(row.set_last_sync)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td style={tdStyle} colSpan={7}>Geen syncs gevonden.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      <details style={{ ...cardStyle, borderColor: "color-mix(in srgb, var(--warning) 45%, var(--border))" }}>
        <summary style={{ cursor: "pointer", fontWeight: 700, color: "var(--text-main)" }}>Testpaneel</summary>
        <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}><button type="button" onClick={() => testAlertKeys.length ? clearDevAlert(testAlertKeys[0]) : triggerDevAlert()} style={{ ...buttonStyle, ...(testAlertKeys.length ? { background: "var(--ok)", borderColor: "var(--ok)" } : null) }} disabled={actionBusy === "dev-alert" || actionBusy === "dev-alert-clear"}>{testAlertKeys.length ? "Stop test alert" : "Test alert"}</button><p style={{ ...cardMetaStyle, margin: 0 }}>Simuleer een binnenkomend priority-1-ticket, inclusief een TTFR-SLA-alert van 30 minuten.</p></div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}><button type="button" onClick={() => tokenWarning?.test_scenario === "renewal" ? clearTokenTest() : triggerTokenWarning("renewal")} style={{ ...buttonStyle, ...(tokenWarning?.test_scenario === "renewal" ? { background: "var(--ok)", borderColor: "var(--ok)" } : null) }}>{tokenWarning?.test_scenario === "renewal" ? "Stop test tokenwaarschuwing" : "Test tokenwaarschuwing"}</button><p style={{ ...cardMetaStyle, margin: 0 }}>Simuleer de eerste waarschuwing: de token verloopt binnenkort.</p></div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}><button type="button" onClick={() => tokenWarning?.test_scenario === "expired" ? clearTokenTest() : triggerTokenWarning("expired")} style={{ ...buttonStyle, ...(tokenWarning?.test_scenario === "expired" ? { background: "var(--ok)", borderColor: "var(--ok)" } : null) }}>{tokenWarning?.test_scenario === "expired" ? "Stop test verlopen token" : "Test verlopen token"}</button><p style={{ ...cardMetaStyle, margin: 0 }}>Simuleer dat de token is verlopen en Jira geen nieuwe gegevens meer kan leveren.</p></div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}><button type="button" onClick={() => tokenWarning?.test_scenario === "handoff_expired" ? clearTokenTest() : triggerTokenWarning("handoff_expired")} style={{ ...buttonStyle, ...(tokenWarning?.test_scenario === "handoff_expired" ? { background: "var(--ok)", borderColor: "var(--ok)" } : null) }}>{tokenWarning?.test_scenario === "handoff_expired" ? "Stop test verlopen tijdens overdracht" : "Test verlopen tijdens overdracht"}</button><p style={{ ...cardMetaStyle, margin: 0 }}>Simuleer dat Jira is vernieuwd, maar Development de nieuwe token niet vóór afloop heeft verwerkt.</p></div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}><button type="button" onClick={() => fetch(`${API}/dev/jira-token-warning/reset-pending`, { method: "POST" })} style={buttonStyle}>Herstel token teststatus</button><p style={{ ...cardMetaStyle, margin: 0 }}>Verwijder een achtergebleven teststatus zonder de echte vervaldatum te wijzigen.</p></div>
        </div>
      </details>
      </div>

      <style>{`
        :root {
          color-scheme: light dark;
          --brand-red: #ab1f23;
          --brand-light-blue: #366475;
          --brand-dark-blue: #192c2e;
          --brand-beige: #fff8e9;
          --brand-yellow: #ffdf80;
          --brand-rose: #f4b19f;
          --brand-soft-red: #f26d5d;
          --page-bg: var(--brand-beige);
          --surface: #fffefa;
          --surface-muted: #fff4d8;
          --text-main: var(--brand-dark-blue);
          --text-subtle: #2a4d55;
          --text-muted: #466871;
          --text-faint: #718d90;
          --border: #b8cdcc;
          --border-strong: #d9e5d7;
          --accent: var(--brand-red);
          --danger: #a31e22;
          --warning: #8a5c00;
          --ok: #226044;
          --overlay-bg: rgba(25, 44, 46, 0.58);
          --overlay-soft: rgba(25, 44, 46, 0.36);
          --shadow-medium: rgba(25, 44, 46, 0.14);
          --shadow-strong: rgba(25, 44, 46, 0.28);
          --indicator-border: rgba(25, 44, 46, 0.18);
        }
        @media (prefers-color-scheme: dark) {
          :root {
            --page-bg: #102426;
            --surface: var(--brand-dark-blue);
            --surface-muted: #213c3f;
            --text-main: var(--brand-beige);
            --text-subtle: #d7e5df;
            --text-muted: #adc4c0;
            --text-faint: #76928e;
            --border: #426568;
            --border-strong: #54787a;
            --accent: var(--brand-soft-red);
            --danger: #ff9a8e;
            --warning: var(--brand-yellow);
            --ok: #83d0a5;
            --overlay-bg: rgba(10, 25, 27, 0.76);
            --overlay-soft: rgba(10, 25, 27, 0.58);
            --shadow-medium: rgba(0, 0, 0, 0.3);
            --shadow-strong: rgba(0, 0, 0, 0.55);
            --indicator-border: rgba(215, 229, 223, 0.28);
          }
        }
        html,
        body {
          background: var(--page-bg);
          color: var(--text-main);
          font-family: var(--font-body);
          margin: 0;
          min-height: 100%;
          overflow: auto;
        }
        * {
          box-sizing: border-box;
        }
        .sync-start-banner {
          animation: syncStartPop 520ms ease-out, syncStartGlow 1600ms ease-out;
        }
        .sync-live-banner {
          animation: syncStartPop 360ms ease-out;
        }
        .sync-start-dot {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: var(--ok);
          box-shadow: 0 0 0 0 color-mix(in srgb, var(--ok) 55%, transparent);
          animation: syncDotPulse 1200ms ease-out infinite;
          flex: 0 0 auto;
        }
        .sync-live-dot {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: var(--accent);
          box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 55%, transparent);
          animation: syncLiveDotPulse 1000ms ease-out infinite;
          flex: 0 0 auto;
        }
        @keyframes syncStartPop {
          0% {
            opacity: 0;
            transform: translateY(6px) scale(0.98);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes syncStartGlow {
          0% {
            box-shadow: 0 0 0 0 color-mix(in srgb, var(--ok) 38%, transparent);
          }
          100% {
            box-shadow: 0 8px 18px var(--shadow-medium);
          }
        }
        @keyframes syncDotPulse {
          0% {
            transform: scale(1);
            box-shadow: 0 0 0 0 color-mix(in srgb, var(--ok) 55%, transparent);
          }
          70% {
            transform: scale(1.18);
            box-shadow: 0 0 0 10px color-mix(in srgb, var(--ok) 0%, transparent);
          }
          100% {
            transform: scale(1);
            box-shadow: 0 0 0 0 color-mix(in srgb, var(--ok) 0%, transparent);
          }
        }
        @keyframes syncLiveDotPulse {
          0% {
            transform: scale(1);
            box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 55%, transparent);
          }
          70% {
            transform: scale(1.16);
            box-shadow: 0 0 0 10px color-mix(in srgb, var(--accent) 0%, transparent);
          }
          100% {
            transform: scale(1);
            box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 0%, transparent);
          }
        }
      `}</style>
    </main>
  );
}
