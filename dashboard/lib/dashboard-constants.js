export const API = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";
export const JIRA_BASE = "https://planningsagenda.atlassian.net";
export const RELEASE_ANCHOR_ISO = process.env.NEXT_PUBLIC_RELEASE_ANCHOR_ISO || "2026-01-21T00:00:00Z";
export const DEFAULT_SERVICEDESK_ONLY = true;
export const DASHBOARD_CONFIG_STORAGE_KEY = "jsm_dashboard_layout_v2";
export const TV_MODE_STORAGE_KEY = "jsm_dashboard_tv_mode";
export const VACATION_TEAM_MEMBERS = ["Johan", "Ashley", "Jarno"];
export const AI_INSIGHT_DOWNVOTE_REASONS = [
  "niet relevant genoeg",
  "threshold te laag",
  "onduidelijke formulering",
  "actie niet beïnvloedbaar",
];

export const TYPE_COLORS = {
  rfc: "#2e7d32",
  incident: "#c62828",
  incidenten: "#c62828",
  "service request": "#1565c0",
  vraag: "#e65100",
  vragen: "#e65100",
  totaal: "#374151",
};

export const CARD_TITLES = {
  volume: "Aantal tickets per week",
  onderwerp: "Onderwerp logging",
  priority: "Tickets per priority",
  assignee: "Tickets per assignee",
  p90: "Doorlooptijd p50/p75/p90",
  inflowVsClosed: "Binnengekomen vs afgesloten",
  incidentResolution: "Time to Resolution",
  firstResponseAll: "Time to First Response (alle tickets)",
  organizationWeekly: "Tickets per partner per week",
  vacationServicedesk: "Vakantie Servicedesk",
};

export const KPI_KEYS = ["totalTickets", "latestTickets", "avgPerWeek", "ttfrOverdue", "topType", "topSubject", "topPartner"];
export const NON_KPI_CARD_KEYS = ["topOnderwerpen", ...Object.keys(CARD_TITLES)];
export const MAX_CARDS_PER_ROW = 5;
export const MAX_KPI_TILES = 7;

export function createDefaultDashboardLayout() {
  return {
    kpiRow: [...KPI_KEYS],
    hiddenKpis: [],
    cardRows: [
      ["topOnderwerpen", "volume", "priority", "organizationWeekly", "vacationServicedesk"],
      ["assignee", "onderwerp", "p90", "inflowVsClosed", "incidentResolution", "firstResponseAll"],
    ],
    hiddenCards: [],
    expandedByRow: [null, null],
    lockedCards: [],
  };
}
