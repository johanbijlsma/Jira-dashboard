import { describe, expect, it } from "vitest";
import {
  avg,
  calcTrend,
  computeInsights,
  getBiggestRiser,
  getFlowRisk,
  getPeakBucket,
  getTopVolume,
  splitPreviousCurrentPeriod,
  sum,
} from "./dashboard-insights";

describe("dashboard-insights", () => {
  it("supports the basic math helpers", () => {
    expect(sum([1, 2, 3])).toBe(6);
    expect(avg([2, 4, 6])).toBe(4);
    expect(splitPreviousCurrentPeriod([1, 2, 3, 4])).toEqual({ previous: [1, 2], current: [3, 4] });
    expect(splitPreviousCurrentPeriod([1, 2, 3])).toEqual({ previous: [2], current: [3] });
  });

  it("calculates trends over the last two buckets", () => {
    expect(calcTrend([3, 4, 8, 10])).toMatchObject({
      previousTotal: 7,
      currentTotal: 18,
      delta: 11,
    });
    expect(calcTrend([5, 5]).trend.symbol).toBe("→");
  });

  it("finds the riser, top volume, peak, and flow risk", () => {
    const topics = [
      { topic: "Incidenten", counts: [5, 6, 10, 12] },
      { topic: "Aanvragen", counts: [15, 16, 17, 18] },
      { topic: "Client", counts: [1, 1, 3, 4] },
    ];
    const buckets = [
      { label: "Week 1", incoming: 12, resolved: 10 },
      { label: "Week 2", incoming: 10, resolved: 12 },
      { label: "Week 3", incoming: 19, resolved: 11 },
    ];

    expect(getBiggestRiser(topics)).toMatchObject({ topic: "Incidenten" });
    expect(getTopVolume(topics)).toMatchObject({ topic: "Aanvragen", total: 66 });
    expect(getPeakBucket(buckets)).toMatchObject({ label: "Week 3", incoming: 19 });
    expect(getFlowRisk(buckets)).toMatchObject({ delta: 8, status: "Open werk stijgt", tone: "warning" });
  });

  it("builds insight cards with sensible fallbacks", () => {
    const cards = computeInsights({
      buckets: [
        { label: "Week 1", incoming: 12, resolved: 10 },
        { label: "Week 2", incoming: 10, resolved: 12 },
      ],
      topics: [
        { topic: "Incidenten", counts: [5, 6, 10, 12] },
        { topic: "Aanvragen", counts: [15, 16, 17, 18] },
      ],
    });

    expect(cards).toHaveLength(4);
    expect(cards[0]).toMatchObject({ id: "trend", primary: "Incidenten" });
    expect(cards[0].hint).toContain("laatste 2 periodes");
    expect(cards[1]).toMatchObject({ id: "volume", primary: "Aanvragen" });
    expect(cards[2].title).toBe("Piek");
    expect(cards[3]).toMatchObject({ id: "risk", title: "Sluitratio", primary: "100,0%" });
    expect(cards[3].secondary).toContain("Open delta 0");

    const fallbackCards = computeInsights({ buckets: [], topics: [] });
    expect(fallbackCards[0].primary).toContain("Geen");
    expect(fallbackCards[1].primary).toContain("Geen");
  });
});
