// @ts-check

import { num } from "./dashboard-utils";
import { trendInfo } from "./dashboard-metrics";

/**
 * @typedef {{ label: string; incoming: number; resolved: number }} Bucket
 * @typedef {{ topic: string; counts: number[] }} TopicSeries
 * @typedef {{ buckets: Bucket[]; topics: TopicSeries[] }} InsightsInput
 * @typedef {{ id: string; title: string; primary: string; secondary: string; hint?: string; tone?: "default" | "positive" | "warning" }} InsightCard
 */

/**
 * @param {number[]} values
 * @returns {number}
 */
export function sum(values) {
  return (Array.isArray(values) ? values : []).reduce((total, value) => total + (Number(value) || 0), 0);
}

/**
 * @param {number[]} values
 * @returns {number | null}
 */
export function avg(values) {
  const safeValues = (Array.isArray(values) ? values : []).map((value) => Number(value)).filter(Number.isFinite);
  if (!safeValues.length) return null;
  return sum(safeValues) / safeValues.length;
}

/**
 * @param {number[]} values
 * @returns {{ previous: number[]; current: number[] }}
 */
export function splitPreviousCurrentPeriod(values) {
  const safeValues = Array.isArray(values) ? values.map((value) => Number(value) || 0) : [];
  if (safeValues.length <= 1) return { previous: [], current: safeValues };
  const windowSize = safeValues.length >= 4 ? 2 : 1;
  const current = safeValues.slice(-windowSize);
  const previous = safeValues.slice(Math.max(0, safeValues.length - (windowSize * 2)), Math.max(0, safeValues.length - windowSize));
  return { previous, current };
}

/**
 * @param {number[]} values
 * @returns {{ previousTotal: number; currentTotal: number; delta: number; pctChange: number | null; trend: ReturnType<typeof trendInfo> }}
 */
export function calcTrend(values) {
  const { previous, current } = splitPreviousCurrentPeriod(values);
  const previousTotal = sum(previous);
  const currentTotal = sum(current);
  const delta = currentTotal - previousTotal;
  return {
    previousTotal,
    currentTotal,
    delta,
    pctChange: previousTotal > 0 ? ((currentTotal - previousTotal) / previousTotal) * 100 : null,
    trend: trendInfo(currentTotal, previousTotal),
  };
}

/**
 * @param {TopicSeries[]} topics
 * @param {number} [minTotal=10]
 * @returns {{ topic: string; total: number; trend: ReturnType<typeof calcTrend> } | null}
 */
export function getBiggestRiser(topics, minTotal = 10) {
  const candidates = (Array.isArray(topics) ? topics : [])
    .map((topic) => ({
      topic: String(topic?.topic || "").trim(),
      counts: Array.isArray(topic?.counts) ? topic.counts.map((value) => Number(value) || 0) : [],
    }))
    .filter((topic) => topic.topic)
    .map((topic) => ({
      topic: topic.topic,
      total: sum(topic.counts),
      trend: calcTrend(topic.counts),
    }))
    .filter((topic) => topic.total >= minTotal && topic.trend.currentTotal > 0 && topic.trend.previousTotal > 0 && (topic.trend.pctChange || 0) > 0);

  candidates.sort((left, right) => {
    const byPct = (right.trend.pctChange || 0) - (left.trend.pctChange || 0);
    if (byPct !== 0) return byPct;
    return right.total - left.total;
  });

  return candidates[0] || null;
}

/**
 * @param {TopicSeries[]} topics
 * @returns {{ topic: string; total: number } | null}
 */
export function getTopVolume(topics) {
  const candidates = (Array.isArray(topics) ? topics : [])
    .map((topic) => ({
      topic: String(topic?.topic || "").trim(),
      total: sum(Array.isArray(topic?.counts) ? topic.counts : []),
    }))
    .filter((topic) => topic.topic && topic.total > 0)
    .sort((left, right) => right.total - left.total || left.topic.localeCompare(right.topic, "nl-NL"));

  return candidates[0] || null;
}

/**
 * @param {Bucket[]} buckets
 * @returns {{ label: string; incoming: number; avgIncoming: number | null; deltaPct: number | null } | null}
 */
export function getPeakBucket(buckets) {
  const safeBuckets = (Array.isArray(buckets) ? buckets : [])
    .map((bucket) => ({
      label: String(bucket?.label || "").trim(),
      incoming: Number(bucket?.incoming) || 0,
      resolved: Number(bucket?.resolved) || 0,
    }))
    .filter((bucket) => bucket.label);

  if (!safeBuckets.length) return null;
  const avgIncoming = avg(safeBuckets.map((bucket) => bucket.incoming));
  const top = safeBuckets.sort((left, right) => right.incoming - left.incoming)[0];
  const deltaPct = avgIncoming && avgIncoming > 0 ? ((top.incoming - avgIncoming) / avgIncoming) * 100 : null;
  return {
    label: top.label,
    incoming: top.incoming,
    avgIncoming,
    deltaPct,
  };
}

/**
 * @param {Bucket[]} buckets
 * @returns {{ delta: number; incomingTotal: number; resolvedTotal: number; closeRatePct: number | null; status: string; tone: "default" | "positive" | "warning" }}
 */
export function getFlowRisk(buckets) {
  const incomingTotal = sum((Array.isArray(buckets) ? buckets : []).map((bucket) => Number(bucket?.incoming) || 0));
  const resolvedTotal = sum((Array.isArray(buckets) ? buckets : []).map((bucket) => Number(bucket?.resolved) || 0));
  const delta = incomingTotal - resolvedTotal;
  const closeRatePct = incomingTotal > 0 ? (resolvedTotal / incomingTotal) * 100 : null;

  if (delta > 0) {
    return { delta, incomingTotal, resolvedTotal, closeRatePct, status: "Open werk stijgt", tone: "warning" };
  }
  if (delta < 0) {
    return { delta, incomingTotal, resolvedTotal, closeRatePct, status: "Open werk daalt", tone: "positive" };
  }
  return { delta, incomingTotal, resolvedTotal, closeRatePct, status: "Open werk stabiel", tone: "default" };
}

/**
 * @param {InsightsInput} input
 * @returns {InsightCard[]}
 */
export function computeInsights(input) {
  const buckets = Array.isArray(input?.buckets) ? input.buckets : [];
  const topics = Array.isArray(input?.topics) ? input.topics : [];
  const biggestRiser = getBiggestRiser(topics);
  const topVolume = getTopVolume(topics);
  const peakBucket = getPeakBucket(buckets);
  const flowRisk = getFlowRisk(buckets);

  return [
    biggestRiser
      ? {
          id: "trend",
          title: "Trend",
          primary: biggestRiser.topic,
          secondary: `${biggestRiser.trend.trend.text} vs vorige 2 periodes`,
          hint: "Vergelijking van de laatste 2 periodes met de 2 periodes daarvoor, alleen bij voldoende volume.",
          tone: biggestRiser.trend.delta > 0 ? "warning" : "default",
        }
      : {
          id: "trend",
          title: "Trend",
          primary: "Geen duidelijke stijger",
          secondary: "Nog onvoldoende volume voor een betrouwbare trend",
          hint: "Trend gebruikt de laatste 2 periodes versus de 2 periodes daarvoor.",
          tone: "default",
        },
    topVolume
      ? {
          id: "volume",
          title: "Volume",
          primary: topVolume.topic,
          secondary: `${num(topVolume.total)} tickets`,
          tone: "default",
        }
      : {
          id: "volume",
          title: "Volume",
          primary: "Geen onderwerpvolume",
          secondary: "Geen tickets in de gekozen periode",
          tone: "default",
        },
    peakBucket
      ? {
          id: "peak",
          title: "Piek",
          primary: peakBucket.label,
          secondary:
            peakBucket.deltaPct == null
              ? `${num(peakBucket.incoming)} tickets`
              : `${num(peakBucket.incoming)} tickets · ${peakBucket.deltaPct >= 0 ? "+" : ""}${num(peakBucket.deltaPct, 0)}% boven gem.`,
          tone: peakBucket.deltaPct != null && peakBucket.deltaPct > 0 ? "warning" : "default",
        }
      : {
          id: "peak",
          title: "Piek",
          primary: "Geen piek beschikbaar",
          secondary: "Te weinig periodedata in deze selectie",
          tone: "default",
        },
    {
      id: "risk",
      title: "Sluitratio",
      primary: flowRisk.closeRatePct == null ? "n.v.t." : `${num(flowRisk.closeRatePct, 1)}%`,
      secondary:
        flowRisk.delta === 0
          ? `Open delta ${num(flowRisk.delta)} · ${flowRisk.status}`
          : `Open delta ${flowRisk.delta > 0 ? "+" : ""}${num(flowRisk.delta)} · ${flowRisk.status}`,
      hint: "Sluitratio vergelijkt afgesloten tickets met binnengekomen tickets in dezelfde periode.",
      tone: flowRisk.tone,
    },
  ];
}
