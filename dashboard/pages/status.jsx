import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";

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

function num(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return new Intl.NumberFormat("nl-NL").format(Number(value));
}

export default function StatusPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionBusy, setActionBusy] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionPulse, setActionPulse] = useState(0);

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

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    const intervalMs = status?.running ? 3000 : 15000;
    const timer = window.setInterval(fetchStatus, intervalMs);
    return () => window.clearInterval(timer);
  }, [fetchStatus, status?.running]);

  const successfulRuns = useMemo(
    () => (Array.isArray(status?.successful_runs) ? status.successful_runs : []),
    [status]
  );

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
          </section>

          <section style={cardStyle}>
            <h2 style={cardTitleStyle}>Laatste fout</h2>
            <p style={cardValueStyle}>{status?.last_failed_run?.message ? "Aanwezig" : "Geen"}</p>
            <p style={cardMetaStyle}>Run: {fmtDateTime(status?.last_failed_run?.started_at)}</p>
            <p style={cardMetaStyle}>Type: {status?.last_failed_run?.mode || "—"}</p>
            <p style={cardMetaStyle}>{status?.last_failed_run?.message || "Geen fout geregistreerd."}</p>
          </section>

          <section style={cardStyle}>
            <h2 style={cardTitleStyle}>Laatste full sync</h2>
            <p style={cardValueStyle}>{fmtDateTime(status?.last_full_sync?.started_at)}</p>
            <p style={cardMetaStyle}>Einde: {fmtDateTime(status?.last_full_sync?.finished_at)}</p>
            <p style={cardMetaStyle}>Upserts: {num(status?.last_full_sync?.upserts)}</p>
            <p style={cardMetaStyle}>Set last sync: {fmtDateTime(status?.last_full_sync?.set_last_sync)}</p>
          </section>
        </div>

        <section style={tableWrapStyle}>
          <div style={{ padding: "12px 12px 0", color: "var(--text-subtle)", fontWeight: 700 }}>
            Laatste 10 succesvolle syncs
          </div>
          <div style={{ overflowX: "auto", padding: 12 }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Start</th>
                  <th style={thStyle}>Einde</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Upserts</th>
                  <th style={thStyle}>Set last sync</th>
                </tr>
              </thead>
              <tbody>
                {successfulRuns.length ? (
                  successfulRuns.map((row, idx) => (
                    <tr key={`run-${idx}`}>
                      <td style={tdStyle}>{fmtDateTime(row.started_at)}</td>
                      <td style={tdStyle}>{fmtDateTime(row.finished_at)}</td>
                      <td style={tdStyle}>{row.mode || "—"}</td>
                      <td style={tdStyle}>{num(row.upserts)}</td>
                      <td style={tdStyle}>{fmtDateTime(row.set_last_sync)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td style={tdStyle} colSpan={5}>Geen succesvolle syncs gevonden.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
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
          font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
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
