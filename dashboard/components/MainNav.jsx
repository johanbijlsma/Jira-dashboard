import Link from "next/link";

export default function MainNav({ current = "dashboard", syncStatusText = "" }) {
  const shellStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  };
  const tabsStyle = {
    display: "inline-flex",
    border: "1px solid var(--border)",
    borderRadius: 999,
    padding: 4,
    background: "var(--surface)",
    boxShadow: "0 8px 18px var(--shadow-medium)",
  };
  const tabStyle = (active) => ({
    borderRadius: 999,
    padding: "7px 14px",
    fontSize: 13,
    fontWeight: 800,
    textDecoration: "none",
    color: active ? "#fff" : "var(--text-muted)",
    background: active ? "var(--accent)" : "transparent",
    transition: "all 160ms ease",
  });
  const statusStyle = {
    color: "var(--text-muted)",
    fontSize: 12,
    lineHeight: 1.2,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid var(--border)",
    background: "color-mix(in srgb, var(--surface) 94%, transparent)",
    boxShadow: "0 4px 10px var(--shadow-medium)",
    textDecoration: "none",
    maxWidth: "min(700px, calc(100vw - 24px))",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  return (
    <div style={shellStyle}>
      <nav aria-label="Hoofdnavigatie" style={tabsStyle}>
        <Link href="/" style={tabStyle(current === "dashboard")}>
          Dashboard
        </Link>
        <Link href="/insights" style={tabStyle(current === "insights")}>
          Insights
        </Link>
      </nav>
      {syncStatusText ? (
        <Link href="/status" title="Open statuspagina" style={statusStyle}>
          {syncStatusText}
        </Link>
      ) : null}
    </div>
  );
}
