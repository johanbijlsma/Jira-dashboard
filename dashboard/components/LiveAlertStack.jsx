import { JIRA_BASE } from "../lib/dashboard-constants";

export default function LiveAlertStack({ alerts }) {
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
