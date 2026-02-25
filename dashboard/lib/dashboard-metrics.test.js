import { describe, expect, it } from "vitest";
import { isTotalLabel, median, trendInfo, uniqueChartColor, wowSortValue } from "./dashboard-metrics";

describe("dashboard-metrics", () => {
  it("builds stable chart colors", () => {
    expect(uniqueChartColor(0, 5)).toMatch(/^hsl\(/);
    expect(uniqueChartColor(2, 5)).not.toEqual(uniqueChartColor(0, 5));
  });

  it("handles totals and medians", () => {
    expect(isTotalLabel("Totaal")).toBe(true);
    expect(isTotalLabel("incident")).toBe(false);
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("calculates wow and trend values", () => {
    expect(wowSortValue({ last: 10, prev: 5 })).toBe(100);
    expect(wowSortValue({ last: 0, prev: 0 })).toBe(Number.NEGATIVE_INFINITY);

    expect(trendInfo(0, 0).text).toBe("0%");
    expect(trendInfo(10, 0).text).toBe("nieuw");
    expect(trendInfo(20, 10).symbol).toBe("↑");
    expect(trendInfo(9, 10).symbol).toBe("↓");
    expect(trendInfo(10.02, 10).symbol).toBe("→");
  });
});
