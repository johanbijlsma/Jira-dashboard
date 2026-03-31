import { useCallback, useEffect, useState } from "react";
import { API } from "./dashboard-constants";

const AI_INSIGHT_MOCKS_ENABLED = String(process.env.NEXT_PUBLIC_AI_INSIGHTS_ENABLE_MOCKS ?? "false").toLowerCase() === "true";

function buildMockInsights() {
  return [
    {
      id: 900001,
      insight_key: "mock-backlog-pressure",
      title: "AI-signaal: backlogdruk loopt op",
      summary: "Er kwamen vorige week duidelijk meer tickets binnen dan er werden afgesloten. De trend wijst op oplopende werkvoorraad.",
      action_label: "Bespreek capaciteit en prioritering voor de komende week.",
      kind: "backlog_pressure",
      target_card_key: "inflowVsClosed",
      score_pct: 91,
      deviation_pct: 28,
      detected_at: "2026-03-20T08:30:00Z",
      expires_at: "2026-03-20T16:30:00Z",
      source_payload: {
        metric: "Binnengekomen vs afgesloten",
        current: { week_start: "2026-03-16T00:00:00Z", inflow: 148, closed: 121, delta: 27 },
        previous: { week_start: "2026-03-09T00:00:00Z", inflow: 133, closed: 127, delta: 6 },
        confidence: {
          absolute_change: 21,
          relative_change_pct: 28,
          magnitude_score: 12.6,
          volume_score: 20,
          threshold_bonus: 12,
          confidence_explanation:
            "Score is gebaseerd op 28% relatieve stijging en 21 absolute toename versus de vorige periode. Extra gewicht omdat zowel impact als afwijking boven de signaaldrempel uitkomen.",
        },
      },
      feedback_status: "pending",
      feedback_reason: null,
      feedback_at: null,
      removed_at: null,
      is_mock: true,
    },
    {
      id: 900002,
      insight_key: "mock-ttfr-overdue",
      title: "AI-signaal: TTFR-verzuim stijgt",
      summary: "Het aantal open tickets met verlopen first response is hoger dan in de vorige volledige week.",
      action_label: "Controleer wachtrijen en herverdeel snelle intake naar het team.",
      kind: "ttfr_overdue_spike",
      target_card_key: "firstResponseAll",
      score_pct: 86,
      deviation_pct: 42,
      detected_at: "2026-03-20T09:10:00Z",
      expires_at: "2026-03-20T17:10:00Z",
      source_payload: {
        metric: "TTFR overdue",
        current: { week_start: "2026-03-16T00:00:00Z", overdue: 17 },
        previous: { week_start: "2026-03-09T00:00:00Z", overdue: 12 },
        confidence: {
          absolute_change: 5,
          relative_change_pct: 42,
          magnitude_score: 18.9,
          volume_score: 7.5,
          threshold_bonus: 12,
          confidence_explanation:
            "Score is gebaseerd op 42% relatieve stijging en 5 absolute toename versus de vorige periode. Extra gewicht omdat zowel impact als afwijking boven de signaaldrempel uitkomen.",
        },
      },
      feedback_status: "pending",
      feedback_reason: null,
      feedback_at: null,
      removed_at: null,
      is_mock: true,
    },
    {
      id: 900003,
      insight_key: "mock-partner-spike",
      title: "AI-signaal: partner springt eruit",
      summary: "Partner 'Gemeente Delft' laat een opvallende stijging in ticketvolume zien ten opzichte van de vorige week.",
      action_label: "Check of er een release, storing of terugkerend patroon speelt bij deze partner.",
      kind: "organization_spike",
      target_card_key: "organizationWeekly",
      score_pct: 84,
      deviation_pct: 55,
      detected_at: "2026-03-20T09:40:00Z",
      expires_at: "2026-03-20T17:40:00Z",
      source_payload: {
        metric: "Partnervolume",
        label: "Gemeente Delft",
        current: { week_start: "2026-03-16T00:00:00Z", tickets: 31 },
        previous: { week_start: "2026-03-09T00:00:00Z", tickets: 20 },
        confidence: {
          absolute_change: 11,
          relative_change_pct: 55,
          magnitude_score: 24.8,
          volume_score: 16.5,
          threshold_bonus: 12,
          confidence_explanation:
            "Score is gebaseerd op 55% relatieve stijging en 11 absolute toename versus de vorige periode. Extra gewicht omdat zowel impact als afwijking boven de signaaldrempel uitkomen.",
        },
      },
      feedback_status: "pending",
      feedback_reason: null,
      feedback_at: null,
      removed_at: null,
      is_mock: true,
    },
  ];
}

function normalizeInsight(entry) {
  return {
    id: entry?.id != null ? Number(entry.id) : null,
    insight_key: String(entry?.insight_key || ""),
    title: String(entry?.title || ""),
    summary: String(entry?.summary || ""),
    action_label: String(entry?.action_label || ""),
    kind: String(entry?.kind || ""),
    target_card_key: String(entry?.target_card_key || ""),
    score_pct: Number.isFinite(Number(entry?.score_pct)) ? Number(entry.score_pct) : 0,
    deviation_pct: entry?.deviation_pct == null ? null : Number(entry.deviation_pct),
    detected_at: entry?.detected_at || null,
    expires_at: entry?.expires_at || null,
    source_payload: entry?.source_payload && typeof entry.source_payload === "object" ? entry.source_payload : {},
    feedback_status: String(entry?.feedback_status || "pending"),
    feedback_reason: entry?.feedback_reason || null,
    feedback_at: entry?.feedback_at || null,
    removed_at: entry?.removed_at || null,
    is_mock: Boolean(entry?.is_mock),
  };
}

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

function buildFixedInsightWindow() {
  const now = new Date();
  const lastFullMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const start = new Date(Date.UTC(lastFullMonthEnd.getUTCFullYear(), lastFullMonthEnd.getUTCMonth() - 24, 1));
  return {
    dateFrom: isoDay(start),
    dateTo: isoDay(lastFullMonthEnd),
  };
}

export function useAiInsights({
  servicedeskOnly,
}) {
  const [liveInsights, setLiveInsights] = useState([]);
  const [insightLogEntries, setInsightLogEntries] = useState([]);
  const [thresholdPct, setThresholdPct] = useState(75);
  const [ttlHours, setTtlHours] = useState(8);

  const buildFallbackInsights = useCallback(
    () => (AI_INSIGHT_MOCKS_ENABLED ? buildMockInsights().map(normalizeInsight) : []),
    []
  );

  const buildParams = useCallback(() => {
    const fixedWindow = buildFixedInsightWindow();
    const params = new URLSearchParams({
      date_from: fixedWindow.dateFrom,
      date_to: fixedWindow.dateTo,
      servicedesk_only: servicedeskOnly ? "true" : "false",
    });
    return params;
  }, [servicedeskOnly]);

  const refreshInsightLog = useCallback(async () => {
    let normalized = buildFallbackInsights();
    try {
      const params = new URLSearchParams({
        servicedesk_only: servicedeskOnly ? "true" : "false",
        limit: "200",
      });
      const response = await fetch(`${API}/insights/logs?${params.toString()}`);
      const data = await response.json().catch(() => []);
      const normalizedRaw = Array.isArray(data) ? data.map(normalizeInsight) : [];
      if (response.ok && normalizedRaw.length) {
        normalized = normalizedRaw;
      }
    } catch {
      // Fall back to mock insights when the API is not available yet.
    }
    setInsightLogEntries(normalized);
    return normalized;
  }, [buildFallbackInsights, servicedeskOnly]);

  const refreshLiveInsights = useCallback(async () => {
    let items = buildFallbackInsights();
    let nextThresholdPct = 75;
    let nextTtlHours = 8;
    try {
      const response = await fetch(`${API}/insights/live?${buildParams().toString()}`);
      const data = await response.json().catch(() => ({}));
      const apiItems = Array.isArray(data?.items) ? data.items.map(normalizeInsight) : [];
      if (response.ok && apiItems.length) {
        items = apiItems;
      }
      if (response.ok) {
        nextThresholdPct = Number.isFinite(Number(data?.threshold_pct)) ? Number(data.threshold_pct) : 75;
        nextTtlHours = Number.isFinite(Number(data?.ttl_hours)) ? Number(data.ttl_hours) : 8;
      }
    } catch {
      // Fall back to mock insights when the API is not available yet.
    }
    setLiveInsights(items);
    setThresholdPct(nextThresholdPct);
    setTtlHours(nextTtlHours);
    return items;
  }, [buildFallbackInsights, buildParams]);

  const submitInsightFeedback = useCallback(async ({ insightId, vote, reason }) => {
    const currentInsight = insightLogEntries.find((item) => item.id === insightId) || liveInsights.find((item) => item.id === insightId);
    if (currentInsight?.is_mock) {
      const normalized = normalizeInsight({
        ...currentInsight,
        feedback_status: vote === "down" ? "downvoted" : "upvoted",
        feedback_reason: reason || null,
        feedback_at: "2026-03-20T10:00:00Z",
        removed_at: vote === "down" ? "2026-03-20T10:00:00Z" : null,
      });
      setLiveInsights((prev) =>
        vote === "down" ? prev.filter((item) => item.id !== insightId) : prev.map((item) => (item.id === insightId ? normalized : item))
      );
      setInsightLogEntries((prev) => prev.map((item) => (item.id === insightId ? normalized : item)));
      return normalized;
    }
    const response = await fetch(`${API}/insights/${insightId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vote, reason }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.detail || "Feedback opslaan mislukt.");
    }
    const normalized = normalizeInsight(data);
    setLiveInsights((prev) =>
      vote === "down" ? prev.filter((item) => item.id !== insightId) : prev.map((item) => (item.id === insightId ? normalized : item))
    );
    setInsightLogEntries((prev) => prev.map((item) => (item.id === insightId ? normalized : item)));
    return normalized;
  }, [insightLogEntries, liveInsights]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      refreshLiveInsights().catch(() => {});
      refreshInsightLog().catch(() => {});
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshInsightLog, refreshLiveInsights]);

  return {
    liveInsights,
    insightLogEntries,
    thresholdPct,
    ttlHours,
    refreshLiveInsights,
    refreshInsightLog,
    submitInsightFeedback,
  };
}
