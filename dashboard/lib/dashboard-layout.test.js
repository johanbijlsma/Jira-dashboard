import { describe, expect, it } from "vitest";
import {
  hideCardLayout,
  hideKpiLayout,
  mapAiInsightsToCardSlots,
  moveCardToRowLayout,
  moveKpiToVisibleLayout,
  normalizeDashboardLayout,
  renderCardRowWithHintLayout,
  renderKpiRowWithHintLayout,
  toggleCardLockLayout,
  toggleRowExpandCardLayout,
} from "./dashboard-layout";
import { createDefaultDashboardLayout } from "./dashboard-constants";

describe("dashboard-layout", () => {
  it("ships the customized default layout", () => {
    expect(createDefaultDashboardLayout()).toEqual({
      kpiRow: ["totalTickets", "latestTickets", "currentWeekFlow", "releaseWednesdayWorkload", "ttfrOverdue", "topType", "topSubject", "topPartner"],
      hiddenKpis: [],
      cardRows: [
        ["topOnderwerpen", "volume", "assignee", "priority", "organizationWeekly"],
        ["incidentResolution", "onderwerp", "inflowVsClosed", "releaseWorkload", "vacationServicedesk"],
      ],
      hiddenCards: ["p90", "firstResponseAll"],
      expandedByRow: [null, "onderwerp"],
      lockedCards: ["volume", "organizationWeekly", "onderwerp", "vacationServicedesk"],
    });
  });

  it("returns fallback for invalid input", () => {
    expect(normalizeDashboardLayout(null)).toEqual(createDefaultDashboardLayout());
  });

  it("normalizes legacy/invalid layout input", () => {
    const normalized = normalizeDashboardLayout({
      kpiRow: ["totalTickets", "totalTickets", "invalid"],
      hiddenKpis: ["latestTickets", "latestTickets"],
      cardRows: [["volume", "invalid"], ["priority", "volume"]],
      hiddenCards: ["assignee"],
      expandedByRow: ["volume", "missing"],
      lockedCards: ["volume", "missing"],
    });
    expect(normalized.kpiRow).toContain("totalTickets");
    expect(normalized.hiddenKpis).toContain("latestTickets");
    expect(normalized.cardRows[0]).toContain("volume");
    expect(normalized.cardRows[1]).not.toContain("volume");
    expect(normalized.expandedByRow[0]).toBe("volume");
    expect(normalized.expandedByRow[1]).toBeNull();
    expect(normalized.lockedCards).toEqual(["volume"]);
  });

  it("normalizes legacy shape and split card order", () => {
    const normalized = normalizeDashboardLayout({
      kpiOrder: ["topType", "totalTickets"],
      kpiVisibility: { topType: true, totalTickets: false },
      cardOrder: ["volume", "assignee", "priority"],
      cardVisibility: { assignee: false },
    });
    expect(normalized.kpiRow[0]).toBe("topType");
    expect(normalized.hiddenKpis).toContain("totalTickets");
    expect(normalized.hiddenCards).toContain("assignee");
  });

  it("moves and hides kpis", () => {
    const base = createDefaultDashboardLayout();
    const hiddenBase = { ...base, hiddenKpis: ["topPartner"], kpiRow: base.kpiRow.filter((k) => k !== "topPartner") };
    const moved = moveKpiToVisibleLayout(hiddenBase, "topPartner", "topType", "before");
    expect(moved.kpiRow.indexOf("topPartner")).toBeLessThan(moved.kpiRow.indexOf("topType"));
    const hidden = hideKpiLayout(moved, "topPartner");
    expect(hidden.hiddenKpis).toContain("topPartner");
    const movedAppend = moveKpiToVisibleLayout(hiddenBase, "topPartner");
    expect(movedAppend.kpiRow.at(-1)).toBe("topPartner");
  });

  it("moves cards, expands and hides", () => {
    const base = createDefaultDashboardLayout();
    const moved = moveCardToRowLayout(base, "firstResponseAll", 0, "priority", "after");
    expect(moved.cardRows[0]).toContain("firstResponseAll");
    expect(moved.hiddenCards).not.toContain("firstResponseAll");
    const compact = { ...moved, cardRows: [moved.cardRows[0].slice(0, 4), moved.cardRows[1]], expandedByRow: [null, null] };
    const toggled = toggleRowExpandCardLayout(compact, 0, "volume");
    expect(toggled.expandedByRow[0]).toBe("volume");
    const locked = toggleCardLockLayout(toggled, "assignee");
    expect(locked.lockedCards).toContain("assignee");
    const hidden = hideCardLayout(locked, "assignee");
    expect(hidden.hiddenCards).toContain("assignee");
    expect(hidden.lockedCards).not.toContain("assignee");
    expect(moveCardToRowLayout(base, "volume", -1)).toBe(base);
  });

  it("renders row hints", () => {
    const kpiRow = renderKpiRowWithHintLayout(["a", "b"], true, "a", { targetKey: "b", position: "before" });
    expect(kpiRow).toEqual(["__KPI_DROP_HINT__", "b"]);
    const cardRow = renderCardRowWithHintLayout(["x", "y"], 1, true, "x", { rowIndex: 1, targetKey: "y", position: "after" });
    expect(cardRow).toEqual(["y", "__DROP_HINT__"]);
    expect(renderKpiRowWithHintLayout(["a"], false, null, null)).toEqual(["a"]);
    expect(renderCardRowWithHintLayout(["x"], 0, true, null, { rowIndex: 0, targetKey: null, position: "before" })).toEqual([
      "x",
      "__DROP_HINT__",
    ]);
  });

  it("keeps AI insights on their target card when that slot is eligible", () => {
    const result = mapAiInsightsToCardSlots(
      [{ id: 1, target_card_key: "priority", feedback_status: "pending", removed_at: null }],
      [["topOnderwerpen", "volume", "priority"]],
      ["volume"]
    );
    expect(Array.from(result.entries())).toEqual([["priority", { id: 1, target_card_key: "priority", feedback_status: "pending", removed_at: null }]]);
  });

  it("falls back to the first unlocked visible card when target slot is locked or hidden", () => {
    const result = mapAiInsightsToCardSlots(
      [{ id: 1, target_card_key: "organizationWeekly", feedback_status: "pending", removed_at: null }],
      [["topOnderwerpen", "volume", "assignee", "organizationWeekly"]],
      ["volume", "organizationWeekly"]
    );
    expect(Array.from(result.keys())).toEqual(["topOnderwerpen"]);
  });

  it("assigns multiple AI insights across the next free replaceable card slots", () => {
    const result = mapAiInsightsToCardSlots(
      [
        { id: 1, target_card_key: "organizationWeekly", feedback_status: "pending", removed_at: null },
        { id: 2, target_card_key: "firstResponseAll", feedback_status: "pending", removed_at: null },
      ],
      [["topOnderwerpen", "volume", "assignee", "priority", "organizationWeekly"]],
      ["volume", "organizationWeekly"]
    );
    expect(Array.from(result.keys())).toEqual(["topOnderwerpen", "assignee"]);
  });
});
