import { JIRA_BASE } from "../lib/dashboard-constants";

export default function LiveAlertStack({ alerts }) {
  const p1Items = Array.isArray(alerts?.priority1) ? alerts.priority1 : [];
  const slaWarningItems = Array.isArray(alerts?.first_response_due_warning)
    ? alerts.first_response_due_warning
    : (Array.isArray(alerts?.first_response_due_soon) ? alerts.first_response_due_soon : []);
  const slaCriticalItems = Array.isArray(alerts?.first_response_due_critical) ? alerts.first_response_due_critical : [];
  const overdueItems = Array.isArray(alerts?.first_response_overdue) ? alerts.first_response_overdue : [];
  const ttrWarningItems = Array.isArray(alerts?.time_to_resolution_warning) ? alerts.time_to_resolution_warning : [];
  const ttrCriticalItems = Array.isArray(alerts?.time_to_resolution_critical) ? alerts.time_to_resolution_critical : [];
  const ttrOverdueItems = Array.isArray(alerts?.time_to_resolution_overdue) ? alerts.time_to_resolution_overdue : [];
  if (!p1Items.length && !slaWarningItems.length && !slaCriticalItems.length && !overdueItems.length && !ttrWarningItems.length && !ttrCriticalItems.length && !ttrOverdueItems.length) return null;

  const shellStyle = {
    position: "fixed",
    top: 52,
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

      {slaWarningItems.length ? (
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
            <span>First response waarschuwing (&lt;30m)</span>
            <strong style={{ marginLeft: "auto", fontSize: 12 }}>{slaWarningItems.length}</strong>
          </div>
          <ul style={listStyle}>
            {slaWarningItems.slice(0, 5).map((item) => (
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

      {slaCriticalItems.length ? (
        <section
          style={{
            ...cardStyle,
            borderColor: "rgba(120, 16, 16, 0.55)",
            background: "linear-gradient(135deg, #7f1d1d, #b91c1c)",
            color: "#fee2e2",
          }}
        >
          <div style={titleRowStyle}>
            <span style={{ fontSize: 11, border: "1px solid rgba(254,226,226,0.45)", borderRadius: 999, padding: "2px 8px" }}>
              SLA !
            </span>
            <span>First response escalatie (&lt;5m)</span>
            <strong style={{ marginLeft: "auto", fontSize: 12 }}>{slaCriticalItems.length}</strong>
          </div>
          <ul style={listStyle}>
            {slaCriticalItems.slice(0, 5).map((item) => (
              <li key={`sla-critical-${item.issue_key}`} style={itemStyle}>
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

      {ttrWarningItems.length ? (
        <section
          style={{
            ...cardStyle,
            borderColor: "rgba(30, 64, 175, 0.45)",
            background: "linear-gradient(135deg, #1d4ed8, #1e40af)",
            color: "#dbeafe",
          }}
        >
          <div style={titleRowStyle}>
            <span style={{ fontSize: 11, border: "1px solid rgba(219,234,254,0.45)", borderRadius: 999, padding: "2px 8px" }}>
              TTR
            </span>
            <span>Incident TTR waarschuwing (&lt;24u)</span>
            <strong style={{ marginLeft: "auto", fontSize: 12 }}>{ttrWarningItems.length}</strong>
          </div>
          <ul style={listStyle}>
            {ttrWarningItems.slice(0, 5).map((item) => (
              <li key={`ttr-warning-${item.issue_key}`} style={itemStyle}>
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

      {ttrCriticalItems.length ? (
        <section
          style={{
            ...cardStyle,
            borderColor: "rgba(8, 47, 73, 0.55)",
            background: "linear-gradient(135deg, #0f766e, #0f172a)",
            color: "#ccfbf1",
          }}
        >
          <div style={titleRowStyle}>
            <span style={{ fontSize: 11, border: "1px solid rgba(204,251,241,0.45)", borderRadius: 999, padding: "2px 8px" }}>
              TTR !
            </span>
            <span>Incident TTR escalatie (&lt;60m)</span>
            <strong style={{ marginLeft: "auto", fontSize: 12 }}>{ttrCriticalItems.length}</strong>
          </div>
          <ul style={listStyle}>
            {ttrCriticalItems.slice(0, 5).map((item) => (
              <li key={`ttr-critical-${item.issue_key}`} style={itemStyle}>
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

      {ttrOverdueItems.length ? (
        <section
          style={{
            ...cardStyle,
            borderColor: "rgba(30, 41, 59, 0.55)",
            background: "linear-gradient(135deg, #0f172a, #1e3a8a)",
            color: "#dbeafe",
          }}
        >
          <div style={titleRowStyle}>
            <span style={{ fontSize: 11, border: "1px solid rgba(219,234,254,0.45)", borderRadius: 999, padding: "2px 8px" }}>
              TTR X
            </span>
            <span>Incident TTR verlopen</span>
            <strong style={{ marginLeft: "auto", fontSize: 12 }}>{ttrOverdueItems.length}</strong>
          </div>
          <ul style={listStyle}>
            {ttrOverdueItems.slice(0, 5).map((item) => (
              <li key={`ttr-overdue-${item.issue_key}`} style={itemStyle}>
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
