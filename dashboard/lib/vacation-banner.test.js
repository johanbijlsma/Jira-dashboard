import { describe, expect, it } from "vitest";
import { businessDaysUntil, buildUpcomingWarningText, isWeekdayIso, weekdayNameNl } from "./vacation-banner";

describe("vacation-banner utils", () => {
  it("detects weekdays correctly", () => {
    expect(isWeekdayIso("2026-02-27")).toBe(true); // Friday
    expect(isWeekdayIso("2026-03-01")).toBe(false); // Sunday
  });

  it("counts business days only", () => {
    expect(businessDaysUntil("2026-02-26", "2026-02-27")).toBe(1); // Thu -> Fri
    expect(businessDaysUntil("2026-02-27", "2026-03-02")).toBe(1); // Fri -> Mon (weekend excluded)
    expect(businessDaysUntil("2026-02-27", "2026-03-03")).toBe(2); // Fri -> Tue
  });

  it("returns zero business days for invalid or non-forward ranges", () => {
    expect(businessDaysUntil("", "2026-03-03")).toBe(0);
    expect(businessDaysUntil("2026-03-03", "")).toBe(0);
    expect(businessDaysUntil("2026-03-03", "2026-03-03")).toBe(0);
    expect(businessDaysUntil("2026-03-04", "2026-03-03")).toBe(0);
  });

  it("builds single-day warning text", () => {
    expect(buildUpcomingWarningText("Johan", "2026-03-02", "2026-03-02")).toMatch(/^Johan is .* vrij$/);
    expect(buildUpcomingWarningText("Johan", "2026-03-02", "2026-03-02")).not.toContain("vanaf");
  });

  it("builds multi-day warning text", () => {
    const text = buildUpcomingWarningText("Johan", "2026-03-02", "2026-03-05");
    expect(text).toMatch(/^Johan is vanaf .* vrij$/);
  });

  it("handles missing values in text builder", () => {
    expect(buildUpcomingWarningText("Johan", "", "")).toBe("Johan is vanaf  vrij");
    expect(buildUpcomingWarningText("", "2026-03-02", "2026-03-05")).toMatch(/^ is vanaf .* vrij$/);
  });

  it("weekday helper handles invalid values", () => {
    expect(weekdayNameNl("")).toBe("");
    expect(weekdayNameNl("invalid")).toBe("");
    expect(weekdayNameNl(new Date("2026-03-02"))).toBeTruthy();
  });

  it("isWeekdayIso handles empty input", () => {
    expect(isWeekdayIso("")).toBe(false);
  });
});
