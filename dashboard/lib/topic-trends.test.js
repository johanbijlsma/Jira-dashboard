import { describe, expect, it } from "vitest";
import {
  buildMovingAverage,
  buildTopicTrendSeries,
  buildTopicTrendWindow,
  resolveSelectedTopic,
} from "./topic-trends";

describe("topic-trends", () => {
  it("builds sorted top topic series across the selected period", () => {
    const rows = [
      { onderwerp: "Email", week: "2026-03-02", tickets: 4 },
      { onderwerp: "Email", week: "2026-03-09", tickets: 6 },
      { onderwerp: "Chat", week: "2026-03-02", tickets: 7 },
      { onderwerp: "Chat", week: "2026-03-09", tickets: 2 },
      { onderwerp: "Phone", week: "2026-03-02", tickets: 3 },
      { onderwerp: "Portal", week: "2026-03-09", tickets: 5 },
      { onderwerp: "Monitoring", week: "2026-03-16", tickets: 4 },
      { onderwerp: "Access", week: "2026-03-16", tickets: 1 },
    ];

    const series = buildTopicTrendSeries({
      rows,
      bucketKeys: ["2026-03-02", "2026-03-09", "2026-03-16"],
      limit: 5,
    });

    expect(series.map((entry) => entry.topic)).toEqual(["Email", "Chat", "Portal", "Monitoring", "Phone"]);
    expect(series[0]).toMatchObject({
      total: 10,
      recentTotal: 6,
      previousTotal: 4,
    });
    expect(series[0].buckets.map((bucket) => bucket.count)).toEqual([4, 6, 0]);
  });

  it("uses the last two buckets versus the previous two buckets for trends", () => {
    expect(buildTopicTrendWindow([1, 2, 3, 4])).toEqual({ recentTotal: 7, previousTotal: 3 });
    expect(buildTopicTrendWindow([0, 5])).toEqual({ recentTotal: 5, previousTotal: 0 });
  });

  it("supports moving averages and selection fallback", () => {
    expect(buildMovingAverage([2, 4, 6, 8], 3)).toEqual([2, 3, 4, 6]);
    expect(resolveSelectedTopic([{ topic: "Email" }, { topic: "Chat" }], "Chat")).toBe("Chat");
    expect(resolveSelectedTopic([{ topic: "Email" }, { topic: "Chat" }], "Phone")).toBe("Email");
    expect(resolveSelectedTopic([], "Phone")).toBe("");
  });
});
