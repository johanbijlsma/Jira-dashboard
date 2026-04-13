import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("use-ai-insights mock mode", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("falls back to mock insights and updates mock feedback locally", async () => {
    vi.stubEnv("NEXT_PUBLIC_AI_INSIGHTS_ENABLE_MOCKS", "true");
    global.fetch = vi.fn(() => Promise.reject(new Error("network down")));

    const { useAiInsights } = await import("./use-ai-insights");
    const { result } = renderHook(() => useAiInsights({ servicedeskOnly: true }));

    await waitFor(() => expect(result.current.liveInsights).toHaveLength(3));
    await waitFor(() => expect(result.current.insightLogEntries).toHaveLength(3));

    await act(async () => {
      await result.current.submitInsightFeedback({
        insightId: 900001,
        vote: "up",
        reason: "",
      });
    });

    expect(result.current.liveInsights.find((item) => item.id === 900001)?.feedback_status).toBe("upvoted");
    expect(result.current.insightLogEntries.find((item) => item.id === 900001)?.feedback_status).toBe("upvoted");

    await act(async () => {
      await result.current.submitInsightFeedback({
        insightId: 900002,
        vote: "down",
        reason: "niet relevant genoeg",
      });
    });

    expect(result.current.liveInsights.some((item) => item.id === 900002)).toBe(false);
    expect(result.current.insightLogEntries.find((item) => item.id === 900002)?.feedback_status).toBe("downvoted");
  });
});
