import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  buildWeekStartsFromRange,
  fmtDate,
  fmtDateTime,
  fmtDateWithWeekday,
  hasDataPoints,
  initialsFromName,
  isCurrentPartialWeek,
  isTextEntryTarget,
  isoDate,
  num,
  pct,
  sameStringSet,
  trimLeadingPartialWeek,
  weekStartIsoFromDate,
} from "./dashboard-utils";

describe("dashboard-utils", () => {
  it("formats and parses date helpers", () => {
    expect(isoDate(new Date("2026-02-25T12:00:00Z"))).toBe("2026-02-25");
    expect(fmtDate("2026-02-25")).toMatch(/25-02-2026|25\/02\/2026/);
    expect(fmtDate("")).toBe("");
    expect(fmtDate("bad")).toBe("");
    expect(fmtDateWithWeekday("")).toBe("");
    expect(fmtDateWithWeekday("bad")).toBe("");
    expect(fmtDateWithWeekday("2026-02-25").toLowerCase()).toContain("woensdag");
    expect(fmtDateTime("")).toBe("");
    expect(fmtDateTime("bad")).toBe("");
    expect(fmtDateTime("2026-02-25T10:00:00Z")).toBeTruthy();
  });

  it("builds week ranges and trims partials", () => {
    const weeks = buildWeekStartsFromRange("2026-01-21", "2026-02-02");
    expect(weeks[0]).toBe("2026-01-19");
    expect(trimLeadingPartialWeek(weeks, "2026-01-21")).toEqual(weeks.slice(1));
    expect(trimLeadingPartialWeek(weeks, "2026-01-19")).toEqual(weeks);
    expect(trimLeadingPartialWeek([], "2026-01-19")).toEqual([]);
    expect(trimLeadingPartialWeek(weeks, "")).toEqual(weeks);
    expect(buildWeekStartsFromRange("", "2026-02-02")).toEqual([]);
    expect(buildWeekStartsFromRange("bad", "2026-02-02")).toEqual([]);
    expect(weekStartIsoFromDate(new Date("2026-01-21"))).toBe("2026-01-19");
    expect(isCurrentPartialWeek("2026-03-23", new Date("2026-03-23T09:00:00Z"))).toBe(true);
    expect(isCurrentPartialWeek("2026-03-29", new Date("2026-03-23T09:00:00Z"))).toBe(false);
    expect(isCurrentPartialWeek("2026-03-13", new Date("2026-03-23T09:00:00Z"))).toBe(false);
  });

  it("handles list/numeric helpers", () => {
    expect(addDaysIso("2026-02-25", 2)).toBe("2026-02-27");
    expect(hasDataPoints(null)).toBe(false);
    expect(hasDataPoints({})).toBe(false);
    expect(hasDataPoints({ datasets: [{ data: [0, 1] }] })).toBe(true);
    expect(hasDataPoints({ datasets: [{ data: [0, 0] }] })).toBe(false);
    expect(num(null)).toBe("—");
    expect(num(1234.5, 1)).toMatch(/1.234,5|1,234.5/);
    expect(pct(null)).toBe("—");
    expect(pct(10)).toContain("10");
    expect(sameStringSet(null, null)).toBe(true);
    expect(sameStringSet(["a"], ["a", "b"])).toBe(false);
    expect(sameStringSet(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameStringSet(["a"], ["b"])).toBe(false);
  });

  it("handles initials and text entry target", () => {
    expect(initialsFromName("Johan Bijlsma")).toBe("JB");
    expect(initialsFromName("Johan")).toBe("JO");
    expect(initialsFromName("")).toBe("?");

    expect(isTextEntryTarget(null)).toBe(false);
    const input = document.createElement("input");
    expect(isTextEntryTarget(input)).toBe(true);
    const editable = document.createElement("div");
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect(isTextEntryTarget(editable)).toBe(true);
    const wrapper = document.createElement("div");
    wrapper.setAttribute("contenteditable", "true");
    const child = document.createElement("span");
    wrapper.appendChild(child);
    expect(isTextEntryTarget(child)).toBe(true);
    const div = document.createElement("div");
    expect(isTextEntryTarget(div)).toBe(false);
  });
});
