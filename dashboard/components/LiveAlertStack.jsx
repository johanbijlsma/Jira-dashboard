import { JIRA_BASE } from "../lib/dashboard-constants";

function AlertSection({
  badge,
  title,
  count,
  items,
  itemKeyPrefix,
  valueLabel,
  palette,
}) {
  const cardStyle = {
    borderRadius: 12,
    border: "1px solid",
    borderColor: palette.borderColor,
    background: palette.background,
    color: palette.color,
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
    <section style={cardStyle}>
      <div style={titleRowStyle}>
        <span style={{ fontSize: 11, border: "1px solid rgba(255,255,255,0.35)", borderRadius: 999, padding: "2px 8px" }}>
          {badge}
        </span>
        <span>{title}</span>
        <strong style={{ marginLeft: "auto", fontSize: 12 }}>{count}</strong>
      </div>
      <ul style={listStyle}>
        {items.slice(0, 5).map((item) => (
          <li key={`${itemKeyPrefix}-${item.issue_key}`} style={itemStyle}>
            <a
              href={`${JIRA_BASE}/browse/${item.issue_key}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: "#fff", fontWeight: 700 }}
            >
              {item.issue_key}
            </a>
            <span>{valueLabel(item)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function LiveAlertStack({ alerts, ttrCollapsed = false, onToggleTtrCollapsed }) {
  const p1Items = Array.isArray(alerts?.priority1) ? alerts.priority1 : [];
  const slaWarningItems = Array.isArray(alerts?.first_response_due_warning)
    ? alerts.first_response_due_warning
    : (Array.isArray(alerts?.first_response_due_soon) ? alerts.first_response_due_soon : []);
  const slaCriticalItems = Array.isArray(alerts?.first_response_due_critical) ? alerts.first_response_due_critical : [];
  const overdueItems = Array.isArray(alerts?.first_response_overdue) ? alerts.first_response_overdue : [];
  const ttrWarningItems = Array.isArray(alerts?.time_to_resolution_warning) ? alerts.time_to_resolution_warning : [];
  const ttrCriticalItems = Array.isArray(alerts?.time_to_resolution_critical) ? alerts.time_to_resolution_critical : [];
  const ttrOverdueItems = Array.isArray(alerts?.time_to_resolution_overdue) ? alerts.time_to_resolution_overdue : [];

  const hasAcuteAlerts = p1Items.length || slaWarningItems.length || slaCriticalItems.length || overdueItems.length;
  const ttrTotal = ttrWarningItems.length + ttrCriticalItems.length + ttrOverdueItems.length;
  if (!hasAcuteAlerts && !ttrTotal) return null;

  const shellStyle = {
    position: "fixed",
    right: 16,
    zIndex: 1004,
    width: "min(420px, calc(100vw - 32px))",
    display: "grid",
    gap: 10,
  };

  const acuteShellStyle = {
    ...shellStyle,
    top: 52,
  };

  const ttrShellStyle = {
    ...shellStyle,
    bottom: 84,
  };

  const ttrContainerStyle = {
    borderRadius: 12,
    border: "1px solid rgba(30, 64, 175, 0.28)",
    background: "linear-gradient(180deg, rgba(239,246,255,0.96), rgba(219,234,254,0.94))",
    boxShadow: "0 10px 22px var(--shadow-medium)",
    overflow: "hidden",
    backdropFilter: "blur(2px)",
    animation: "alertIn 220ms ease",
  };

  const ttrHeaderButtonStyle = {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    background: "transparent",
    border: 0,
    cursor: "pointer",
    color: "#1e3a8a",
    fontWeight: 800,
    letterSpacing: 0.2,
    textAlign: "left",
  };

  const ttrBadgeStyle = {
    fontSize: 11,
    border: "1px solid rgba(30,64,175,0.22)",
    borderRadius: 999,
    padding: "2px 8px",
    background: "rgba(255,255,255,0.72)",
  };

  return (
    <>
      {hasAcuteAlerts ? (
        <div style={acuteShellStyle} aria-live="assertive" aria-atomic="false">
          {p1Items.length ? (
            <AlertSection
              badge="P1"
              title="Priority 1 binnengekomen"
              count={p1Items.length}
              items={p1Items}
              itemKeyPrefix="p1"
              valueLabel={(item) => item.status || "Open"}
              palette={{
                borderColor: "rgba(127, 29, 29, 0.45)",
                background: "linear-gradient(135deg, #7f1d1d, #991b1b)",
                color: "#fee2e2",
              }}
            />
          ) : null}

          {slaWarningItems.length ? (
            <AlertSection
              badge="SLA"
              title="First response waarschuwing (<30m)"
              count={slaWarningItems.length}
              items={slaWarningItems}
              itemKeyPrefix="sla-warning"
              valueLabel={(item) => `${Math.max(0, Number(item.minutes_left) || 0)} min`}
              palette={{
                borderColor: "rgba(120, 53, 15, 0.45)",
                background: "linear-gradient(135deg, #78350f, #b45309)",
                color: "#ffedd5",
              }}
            />
          ) : null}

          {slaCriticalItems.length ? (
            <AlertSection
              badge="SLA !"
              title="First response escalatie (<5m)"
              count={slaCriticalItems.length}
              items={slaCriticalItems}
              itemKeyPrefix="sla-critical"
              valueLabel={(item) => `${Math.max(0, Number(item.minutes_left) || 0)} min`}
              palette={{
                borderColor: "rgba(120, 16, 16, 0.55)",
                background: "linear-gradient(135deg, #7f1d1d, #b91c1c)",
                color: "#fee2e2",
              }}
            />
          ) : null}

          {overdueItems.length ? (
            <AlertSection
              badge="SLA X"
              title="First response verlopen"
              count={overdueItems.length}
              items={overdueItems}
              itemKeyPrefix="sla-overdue"
              valueLabel={(item) => `${Math.max(0, Number(item.minutes_overdue) || 0)} min te laat`}
              palette={{
                borderColor: "rgba(120, 16, 16, 0.55)",
                background: "linear-gradient(135deg, #581c87, #7f1d1d)",
                color: "#f5d0fe",
              }}
            />
          ) : null}
        </div>
      ) : null}

      {ttrTotal ? (
        <div style={ttrShellStyle} aria-live="polite" aria-atomic="false">
          <section style={ttrContainerStyle}>
            <button type="button" onClick={onToggleTtrCollapsed} style={ttrHeaderButtonStyle} aria-expanded={!ttrCollapsed}>
              <span style={ttrBadgeStyle}>TTR</span>
              <span>Incident TTR alerts</span>
              <strong style={{ marginLeft: "auto", fontSize: 12 }}>{ttrTotal}</strong>
              <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>{ttrCollapsed ? "▸" : "▾"}</span>
            </button>
            {!ttrCollapsed ? (
              <div style={{ display: "grid", gap: 10, padding: "0 0 10px" }}>
                {ttrWarningItems.length ? (
                  <div style={{ paddingInline: 10 }}>
                    <AlertSection
                      badge="TTR"
                      title="Incident TTR waarschuwing (<24u)"
                      count={ttrWarningItems.length}
                      items={ttrWarningItems}
                      itemKeyPrefix="ttr-warning"
                      valueLabel={(item) => `${Math.max(0, Number(item.minutes_left) || 0)} min`}
                      palette={{
                        borderColor: "rgba(30, 64, 175, 0.45)",
                        background: "linear-gradient(135deg, #1d4ed8, #1e40af)",
                        color: "#dbeafe",
                      }}
                    />
                  </div>
                ) : null}

                {ttrCriticalItems.length ? (
                  <div style={{ paddingInline: 10 }}>
                    <AlertSection
                      badge="TTR !"
                      title="Incident TTR escalatie (<60m)"
                      count={ttrCriticalItems.length}
                      items={ttrCriticalItems}
                      itemKeyPrefix="ttr-critical"
                      valueLabel={(item) => `${Math.max(0, Number(item.minutes_left) || 0)} min`}
                      palette={{
                        borderColor: "rgba(8, 47, 73, 0.55)",
                        background: "linear-gradient(135deg, #0f766e, #0f172a)",
                        color: "#ccfbf1",
                      }}
                    />
                  </div>
                ) : null}

                {ttrOverdueItems.length ? (
                  <div style={{ paddingInline: 10 }}>
                    <AlertSection
                      badge="TTR X"
                      title="Incident TTR verlopen"
                      count={ttrOverdueItems.length}
                      items={ttrOverdueItems}
                      itemKeyPrefix="ttr-overdue"
                      valueLabel={(item) => `${Math.max(0, Number(item.minutes_overdue) || 0)} min te laat`}
                      palette={{
                        borderColor: "rgba(30, 41, 59, 0.55)",
                        background: "linear-gradient(135deg, #0f172a, #1e3a8a)",
                        color: "#dbeafe",
                      }}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
