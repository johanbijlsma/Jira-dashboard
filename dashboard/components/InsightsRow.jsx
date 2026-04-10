// @ts-check

/**
 * @typedef {{
 *   id: string;
 *   title: string;
 *   primary: string;
 *   secondary: string;
 *   hint?: string;
 *   tone?: "default" | "positive" | "warning";
 * }} InsightCard
 */

function toneStyles(tone = "default") {
  if (tone === "warning") {
    return {
      borderColor: "color-mix(in srgb, var(--warning, #d97706) 34%, var(--border))",
      badgeBackground: "color-mix(in srgb, var(--warning, #d97706) 12%, var(--surface))",
      badgeColor: "var(--warning, #b45309)",
    };
  }
  if (tone === "positive") {
    return {
      borderColor: "color-mix(in srgb, var(--ok, #15803d) 30%, var(--border))",
      badgeBackground: "color-mix(in srgb, var(--ok, #15803d) 10%, var(--surface))",
      badgeColor: "var(--ok, #166534)",
    };
  }
  return {
    borderColor: "var(--border)",
    badgeBackground: "var(--surface-muted)",
    badgeColor: "var(--text-muted)",
  };
}

/**
 * @param {{ cards: InsightCard[]; isTvMode?: boolean }} props
 */
export default function InsightsRow({ cards, isTvMode = false }) {
  const rowStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: isTvMode ? "clamp(8px, 0.8dvh, 12px)" : "clamp(8px, 1dvh, 14px)",
    marginBottom: isTvMode ? "clamp(8px, 0.8dvh, 12px)" : "clamp(8px, 1dvh, 14px)",
    width: "100%",
  };

  return (
    <div style={rowStyle} aria-label="Dashboard inzichten">
      {cards.map((card) => {
        const tone = toneStyles(card.tone);
        return (
          <section
            key={card.id}
            style={{
              border: `1px solid ${tone.borderColor}`,
              borderRadius: 10,
              background: "var(--surface)",
              padding: "10px 12px",
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
            aria-labelledby={`insight-${card.id}`}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div id={`insight-${card.id}`} style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {card.title}
              </div>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  borderRadius: 999,
                  padding: "2px 8px",
                  fontSize: 11,
                  fontWeight: 700,
                  background: tone.badgeBackground,
                  color: tone.badgeColor,
                }}
              >
                Insight
              </span>
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.15, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {card.primary}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.35 }}>
              {card.secondary}
            </div>
            {card.hint ? (
              <div style={{ fontSize: 11, color: "var(--text-faint, var(--text-muted))", lineHeight: 1.35 }}>
                {card.hint}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
