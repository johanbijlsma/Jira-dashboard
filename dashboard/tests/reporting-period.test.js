import { describe, expect, it } from "vitest";
import { getStandardReportingRange } from "../lib/reporting-period";

describe("getStandardReportingRange", () => {
  const friday = new Date("2026-09-04T12:00:00Z");

  it("shows three completed weeks plus the current week by default", () => {
    expect(getStandardReportingRange({ now: friday })).toMatchObject({
      fromIso: "2026-08-10",
      toIso: "2026-09-04",
    });
  });

  it("shows four complete weeks when the current week is hidden", () => {
    expect(getStandardReportingRange({ includeCurrentWeek: false, now: friday })).toMatchObject({
      fromIso: "2026-08-03",
      toIso: "2026-08-30",
    });
  });
});
