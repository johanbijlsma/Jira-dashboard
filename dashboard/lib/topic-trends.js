// @ts-check

import { trendInfo, uniqueChartColor } from "./dashboard-metrics";

/**
 * @typedef {{ label: string; count: number }} TopicBucket
 * @typedef {{ topic: string; buckets: TopicBucket[]; total: number; color: string; trend: ReturnType<typeof trendInfo>; recentTotal: number; previousTotal: number }} TopicTrendSeries
 */

/**
 * @param {number[]} values
 * @param {number} [windowSize=3]
 * @returns {(number | null)[]}
 */
export function buildMovingAverage(values, windowSize = 3) {
  const safeWindow = Math.max(2, Number(windowSize) || 3);
  return values.map((value, index) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const start = Math.max(0, index - safeWindow + 1);
    const slice = values.slice(start, index + 1).map((entry) => Number(entry)).filter(Number.isFinite);
    if (!slice.length) return null;
    return slice.reduce((sum, entry) => sum + entry, 0) / slice.length;
  });
}

/**
 * @param {number[]} values
 * @returns {{ recentTotal: number; previousTotal: number }}
 */
export function buildTopicTrendWindow(values) {
  const numericValues = Array.isArray(values) ? values.map((value) => Number(value) || 0) : [];
  const recentSlice = numericValues.slice(-2);
  const previousSlice = numericValues.slice(Math.max(0, numericValues.length - 4), Math.max(0, numericValues.length - 2));
  return {
    recentTotal: recentSlice.reduce((sum, value) => sum + value, 0),
    previousTotal: previousSlice.reduce((sum, value) => sum + value, 0),
  };
}

/**
 * @param {{
 *   rows: Array<{ onderwerp?: string; week?: string; tickets?: number }>;
 *   bucketKeys: string[];
 *   selectedTopic?: string;
 *   limit?: number;
 * }} input
 * @returns {TopicTrendSeries[]}
 */
export function buildTopicTrendSeries({ rows, bucketKeys, selectedTopic = "", limit = 5 }) {
  const topicBuckets = new Map();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const topic = String(row?.onderwerp || "").trim();
    const week = String(row?.week || "").slice(0, 10);
    if (!topic || !week) return;
    if (selectedTopic && topic !== selectedTopic) return;

    const bucketMap = topicBuckets.get(topic) || new Map();
    bucketMap.set(week, (bucketMap.get(week) || 0) + (Number(row?.tickets) || 0));
    topicBuckets.set(topic, bucketMap);
  });

  const series = Array.from(topicBuckets.entries())
    .map(([topic, countsByBucket]) => {
      const values = bucketKeys.map((bucketKey) => countsByBucket.get(bucketKey) || 0);
      const buckets = bucketKeys.map((bucketKey, index) => ({
        label: bucketKey,
        count: values[index],
      }));
      const total = values.reduce((sum, value) => sum + value, 0);
      const { recentTotal, previousTotal } = buildTopicTrendWindow(values);
      return {
        topic,
        buckets,
        total,
        trend: trendInfo(recentTotal, previousTotal),
        recentTotal,
        previousTotal,
      };
    })
    .filter((entry) => entry.total > 0)
    .sort((left, right) => right.total - left.total || left.topic.localeCompare(right.topic, "nl-NL"));

  const visibleSeries = selectedTopic ? series : series.slice(0, Math.max(1, limit));

  return visibleSeries.map((entry, index) => ({
    ...entry,
    color: uniqueChartColor(index, visibleSeries.length, 62, 42),
  }));
}

/**
 * @param {TopicTrendSeries[]} series
 * @param {string} preferredTopic
 * @returns {string}
 */
export function resolveSelectedTopic(series, preferredTopic = "") {
  const preferred = String(preferredTopic || "");
  if (preferred && series.some((entry) => entry.topic === preferred)) return preferred;
  return series[0]?.topic || "";
}
