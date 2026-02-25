import { describe, expect, it } from "vitest";
import {
  CARD_TITLES,
  KPI_KEYS,
  MAX_CARDS_PER_ROW,
  MAX_KPI_TILES,
  NON_KPI_CARD_KEYS,
  TYPE_COLORS,
  VACATION_TEAM_MEMBERS,
  createDefaultDashboardLayout,
} from "./dashboard-constants";

describe("dashboard-constants", () => {
  it("exposes expected base constants", () => {
    expect(TYPE_COLORS.incident).toBeTruthy();
    expect(CARD_TITLES.volume).toContain("tickets");
    expect(VACATION_TEAM_MEMBERS.length).toBeGreaterThan(0);
    expect(MAX_CARDS_PER_ROW).toBe(5);
    expect(MAX_KPI_TILES).toBe(6);
  });

  it("creates a normalized default layout", () => {
    const layout = createDefaultDashboardLayout();
    expect(layout.kpiRow).toEqual(KPI_KEYS);
    expect(layout.hiddenKpis).toEqual([]);
    expect(layout.hiddenCards).toEqual([]);
    expect(layout.cardRows.length).toBe(2);
    expect(NON_KPI_CARD_KEYS).toContain("topOnderwerpen");
  });
});
