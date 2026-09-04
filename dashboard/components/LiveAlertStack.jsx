import { JIRA_BASE } from "../lib/dashboard-constants";
import { useEffect, useRef, useState } from "react";

function UrgentAlertIntro({ p1Items, p2Items, forceIntro = false }) {
  const seenRef = useRef(new Set());
  const bootstrappedRef = useRef(false);
  const forcedIntroShownRef = useRef(false);
  const [active, setActive] = useState(null);
  const [stage, setStage] = useState("");

  useEffect(() => {
    const candidates = [
      ...p1Items.map((item) => ({ ...item, kind: "P1" })),
      ...p2Items.map((item) => ({ ...item, kind: "P2" })),
    ];
    if (
      active &&
      !candidates.some((item) => item.kind === active.kind && item.issue_key === active.issue_key)
    ) {
      setActive(null);
      setStage("");
    }
  }, [active, p1Items, p2Items]);

  useEffect(() => {
    const candidates = [
      ...p1Items.map((item) => ({ ...item, kind: "P1" })),
      ...p2Items.map((item) => ({ ...item, kind: "P2" })),
    ];
    if (!bootstrappedRef.current) {
      bootstrappedRef.current = true;
      if (!forceIntro || !candidates.length) {
        candidates.forEach((item) => seenRef.current.add(`${item.kind}:${item.issue_key}`));
        return undefined;
      }
    }
    const forcedCandidate = forceIntro && !forcedIntroShownRef.current ? candidates[0] : null;
    const next = forcedCandidate || candidates.find((item) => !seenRef.current.has(`${item.kind}:${item.issue_key}`));
    if (!next) return undefined;
    if (forcedCandidate) forcedIntroShownRef.current = true;
    seenRef.current.add(`${next.kind}:${next.issue_key}`);
    setActive(next);
    setStage("overlay");
    const timer = window.setTimeout(() => setStage("card"), 1200);
    return () => window.clearTimeout(timer);
  }, [forceIntro, p1Items, p2Items]);

  if (!active || !stage) return null;
  const isP1 = active.kind === "P1";
  const color = isP1 ? "#b91c1c" : "#c2410c";
  return (
    <>
      {stage === "overlay" ? (
        <div
          aria-hidden="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1200,
            pointerEvents: "none",
            background: isP1 ? "rgba(185,28,28,.30)" : "rgba(194,65,12,.25)",
            animation: "urgentFlash 900ms ease-out",
          }}
        />
      ) : null}
      {stage === "card" ? (
        <section
          role="alert"
          aria-live="assertive"
          style={{
            position: "fixed",
            zIndex: 1201,
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "min(620px, calc(100vw - 48px))",
            padding: 28,
            borderRadius: 18,
            border: `3px solid ${color}`,
            background: "var(--surface)",
            color: "var(--text-main)",
            boxShadow: `0 24px 70px color-mix(in srgb, ${color} 48%, transparent)`,
            animation: "alertIn 300ms ease",
          }}
        >
          <div style={{ color, fontWeight: 900, fontSize: 15, letterSpacing: 1 }}>
            {active.kind} LIVE ALERT
          </div>
          <div style={{ marginTop: 7, fontSize: 28, fontWeight: 850 }}>{active.issue_key}</div>
          <div style={{ marginTop: 6, fontSize: 16 }}>
            {active.issue_summary || "Nieuwe melding"}
          </div>
          <div style={{ marginTop: 12, color: "var(--text-muted)", fontSize: 13 }}>
            Blijft zichtbaar totdat de melding in behandeling is.
          </div>
        </section>
      ) : null}
    </>
  );
}

function AlertSection({ badge, title, count, items, itemKeyPrefix, valueLabel, palette }) {
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
        <span
          style={{
            fontSize: 11,
            border: "1px solid rgba(255,255,255,0.35)",
            borderRadius: 999,
            padding: "2px 8px",
          }}
        >
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

export default function LiveAlertStack({
  alerts,
  forcePriorityAlertIntro = false,
  ttrCollapsed = false,
  onToggleTtrCollapsed,
  layoutEditing = false,
  layoutPanelHeight = 0,
}) {
  const p1Items = Array.isArray(alerts?.priority1) ? alerts.priority1 : [];
  const p2Items = Array.isArray(alerts?.priority2) ? alerts.priority2 : [];
  const slaWarningItems = Array.isArray(alerts?.first_response_due_warning)
    ? alerts.first_response_due_warning
    : Array.isArray(alerts?.first_response_due_soon)
      ? alerts.first_response_due_soon
      : [];
  const slaCriticalItems = Array.isArray(alerts?.first_response_due_critical)
    ? alerts.first_response_due_critical
    : [];
  const overdueItems = Array.isArray(alerts?.first_response_overdue)
    ? alerts.first_response_overdue
    : [];
  const ttrWarningItems = Array.isArray(alerts?.time_to_resolution_warning)
    ? alerts.time_to_resolution_warning
    : [];
  const ttrCriticalItems = Array.isArray(alerts?.time_to_resolution_critical)
    ? alerts.time_to_resolution_critical
    : [];

  const hasAcuteAlerts =
    p1Items.length ||
    p2Items.length ||
    slaWarningItems.length ||
    slaCriticalItems.length ||
    overdueItems.length;
  const ttrTotal = ttrWarningItems.length + ttrCriticalItems.length;
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
    bottom: layoutEditing ? Math.max(84, layoutPanelHeight + 24) : 84,
    transition: "bottom 320ms cubic-bezier(0.22, 1, 0.36, 1)",
  };

  // Keep the layout controls reachable while preserving the alert count.
  const ttrIsCollapsed = layoutEditing || ttrCollapsed;

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
      <UrgentAlertIntro
        p1Items={p1Items}
        p2Items={p2Items}
        forceIntro={forcePriorityAlertIntro}
      />
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

          {p2Items.length ? (
            <AlertSection
              badge="P2"
              title="Priority 2 binnengekomen"
              count={p2Items.length}
              items={p2Items}
              itemKeyPrefix="p2"
              valueLabel={(item) => item.status || "Open"}
              palette={{
                borderColor: "rgba(146, 64, 14, 0.5)",
                background: "linear-gradient(135deg, #9a3412, #c2410c)",
                color: "#ffedd5",
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
            <button
              type="button"
              onClick={layoutEditing ? undefined : onToggleTtrCollapsed}
              style={{ ...ttrHeaderButtonStyle, cursor: layoutEditing ? "default" : "pointer" }}
              aria-expanded={!ttrIsCollapsed}
            >
              <span style={ttrBadgeStyle}>TTR</span>
              <span>Incident TTR alerts</span>
              <strong style={{ marginLeft: "auto", fontSize: 12 }}>{ttrTotal}</strong>
              <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>
                {ttrIsCollapsed ? "▸" : "▾"}
              </span>
            </button>
            {!ttrIsCollapsed ? (
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
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
