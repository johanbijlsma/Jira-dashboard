import { useCallback, useEffect, useState } from "react";
import { API } from "./dashboard-constants";

function normalizeServicedeskConfig(data) {
  return {
    team_members: Array.isArray(data?.team_members) ? data.team_members : [],
    onderwerpen: Array.isArray(data?.onderwerpen) ? data.onderwerpen : [],
    onderwerpen_baseline: Array.isArray(data?.onderwerpen_baseline) ? data.onderwerpen_baseline : [],
    onderwerpen_customized: Boolean(data?.onderwerpen_customized),
    ai_insight_threshold_pct: Number.isFinite(Number(data?.ai_insight_threshold_pct))
      ? Number(data.ai_insight_threshold_pct)
      : 75,
    updated_at: data?.updated_at || null,
    team_member_avatars:
      data?.team_member_avatars && typeof data.team_member_avatars === "object" ? data.team_member_avatars : {},
  };
}

export function useServicedeskConfig() {
  const [servicedeskConfig, setServicedeskConfig] = useState({
    team_members: [],
    onderwerpen: [],
    onderwerpen_customized: false,
    ai_insight_threshold_pct: 75,
    updated_at: null,
    team_member_avatars: {},
  });
  const [servicedeskOnderwerpenBaseline, setServicedeskOnderwerpenBaseline] = useState([]);
  const [teamMembersDraft, setTeamMembersDraft] = useState([]);
  const [onderwerpenDraft, setOnderwerpenDraft] = useState([]);

  const applyServicedeskConfig = useCallback((data, normalizeOnderwerpenSelection) => {
    const normalized = normalizeServicedeskConfig(data);
    setServicedeskConfig(normalized);
    setServicedeskOnderwerpenBaseline(normalized.onderwerpen_baseline);
    setTeamMembersDraft(normalized.team_members);
    setOnderwerpenDraft(
      typeof normalizeOnderwerpenSelection === "function"
        ? normalizeOnderwerpenSelection(normalized.onderwerpen)
        : normalized.onderwerpen
    );
    return normalized;
  }, []);

  const refreshServicedeskConfig = useCallback(async (normalizeOnderwerpenSelection) => {
    const data = await fetch(`${API}/config/servicedesk`).then((r) => r.json());
    return applyServicedeskConfig(data, normalizeOnderwerpenSelection);
  }, [applyServicedeskConfig]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      refreshServicedeskConfig().catch(() => {});
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshServicedeskConfig]);

  return {
    servicedeskConfig,
    servicedeskOnderwerpenBaseline,
    teamMembersDraft,
    onderwerpenDraft,
    setTeamMembersDraft,
    setOnderwerpenDraft,
    refreshServicedeskConfig,
    applyServicedeskConfig,
  };
}
