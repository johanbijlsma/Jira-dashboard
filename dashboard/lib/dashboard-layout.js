import {
  KPI_KEYS,
  MAX_CARDS_PER_ROW,
  MAX_KPI_TILES,
  NON_KPI_CARD_KEYS,
  createDefaultDashboardLayout,
} from "./dashboard-constants";

function normalizeList(arr, allowedSet) {
  return Array.from(new Set((Array.isArray(arr) ? arr : []).filter((key) => allowedSet.has(key))));
}

export function normalizeDashboardLayout(input) {
  const fallback = createDefaultDashboardLayout();
  if (!input || typeof input !== "object") return fallback;

  const allKpis = new Set(KPI_KEYS);
  const allCards = new Set(NON_KPI_CARD_KEYS);

  let kpiRow = normalizeList(input.kpiRow, allKpis);
  let hiddenKpis = normalizeList(input.hiddenKpis, allKpis).filter((key) => !kpiRow.includes(key));
  KPI_KEYS.forEach((key) => {
    if (!kpiRow.includes(key) && !hiddenKpis.includes(key)) kpiRow.push(key);
  });
  if (kpiRow.length > MAX_KPI_TILES) {
    const overflow = kpiRow.slice(MAX_KPI_TILES);
    kpiRow = kpiRow.slice(0, MAX_KPI_TILES);
    overflow.forEach((key) => {
      if (!hiddenKpis.includes(key)) hiddenKpis.push(key);
    });
  }

  const inputRows = Array.isArray(input.cardRows) ? input.cardRows : [];
  let cardRows = [normalizeList(inputRows[0], allCards), normalizeList(inputRows[1], allCards)];
  cardRows[1] = cardRows[1].filter((key) => !cardRows[0].includes(key));

  let hiddenCards = normalizeList(input.hiddenCards, allCards).filter(
    (key) => !cardRows[0].includes(key) && !cardRows[1].includes(key)
  );

  NON_KPI_CARD_KEYS.forEach((key) => {
    if (!cardRows[0].includes(key) && !cardRows[1].includes(key) && !hiddenCards.includes(key)) {
      cardRows[1].push(key);
    }
  });

  [0, 1].forEach((idx) => {
    if (cardRows[idx].length > MAX_CARDS_PER_ROW) {
      const overflow = cardRows[idx].slice(MAX_CARDS_PER_ROW);
      cardRows[idx] = cardRows[idx].slice(0, MAX_CARDS_PER_ROW);
      overflow.forEach((key) => {
        if (!hiddenCards.includes(key)) hiddenCards.push(key);
      });
    }
  });

  if (!input.kpiRow && Array.isArray(input.kpiOrder)) {
    const legacyVisible = KPI_KEYS.filter((key) => input?.kpiVisibility?.[key] !== false);
    const legacyHidden = KPI_KEYS.filter((key) => input?.kpiVisibility?.[key] === false);
    kpiRow = [
      ...input.kpiOrder.filter((key) => legacyVisible.includes(key)),
      ...legacyVisible.filter((key) => !input.kpiOrder.includes(key)),
    ];
    hiddenKpis = [
      ...input.kpiOrder.filter((key) => legacyHidden.includes(key)),
      ...legacyHidden.filter((key) => !input.kpiOrder.includes(key)),
    ];
  }

  if (!input.cardRows && Array.isArray(input.cardOrder)) {
    const legacyVisible = NON_KPI_CARD_KEYS.filter((key) => input?.cardVisibility?.[key] !== false);
    const legacyHidden = NON_KPI_CARD_KEYS.filter((key) => input?.cardVisibility?.[key] === false);
    const visibleOrdered = [
      ...input.cardOrder.filter((key) => legacyVisible.includes(key)),
      ...legacyVisible.filter((key) => !input.cardOrder.includes(key)),
    ];
    const split = Math.ceil(visibleOrdered.length / 2);
    cardRows = [visibleOrdered.slice(0, split), visibleOrdered.slice(split)];
    hiddenCards = [
      ...input.cardOrder.filter((key) => legacyHidden.includes(key)),
      ...legacyHidden.filter((key) => !input.cardOrder.includes(key)),
    ];
  }

  const expandedByRowInput = Array.isArray(input.expandedByRow) ? input.expandedByRow : [];
  const expandedByRow = [0, 1].map((idx) => {
    const key = expandedByRowInput[idx];
    return cardRows[idx].includes(key) ? key : null;
  });

  const visibleCards = new Set([...cardRows[0], ...cardRows[1]]);
  const lockedCards = normalizeList(input.lockedCards, visibleCards);

  return { kpiRow, hiddenKpis, cardRows, hiddenCards, expandedByRow, lockedCards };
}

export function moveKpiToVisibleLayout(prev, key, targetKey = null, position = "before") {
  let row = prev.kpiRow.filter((k) => k !== key);
  const hidden = prev.hiddenKpis.filter((k) => k !== key);

  if (targetKey && row.includes(targetKey)) {
    const baseIndex = row.indexOf(targetKey);
    const insertIndex = position === "after" ? baseIndex + 1 : baseIndex;
    row.splice(insertIndex, 0, key);
  } else {
    row.push(key);
  }

  if (row.length > MAX_KPI_TILES) {
    const overflow = row.slice(MAX_KPI_TILES);
    row = row.slice(0, MAX_KPI_TILES);
    overflow.forEach((k) => {
      if (!hidden.includes(k)) hidden.push(k);
    });
  }

  return { ...prev, kpiRow: row, hiddenKpis: hidden };
}

export function hideKpiLayout(prev, key) {
  const row = prev.kpiRow.filter((k) => k !== key);
  const hidden = prev.hiddenKpis.includes(key) ? prev.hiddenKpis : [...prev.hiddenKpis, key];
  return { ...prev, kpiRow: row, hiddenKpis: hidden };
}

export function moveCardToRowLayout(prev, key, rowIndex, targetKey = null, position = "before") {
  if (rowIndex < 0 || rowIndex > 1) return prev;

  const nextRows = prev.cardRows.map((row) => row.filter((k) => k !== key));
  const hidden = prev.hiddenCards.filter((k) => k !== key);
  const expandedByRow = [...(prev.expandedByRow || [null, null])].map((v) => (v === key ? null : v));

  if (targetKey && nextRows[rowIndex].includes(targetKey)) {
    const baseIndex = nextRows[rowIndex].indexOf(targetKey);
    const insertIndex = position === "after" ? baseIndex + 1 : baseIndex;
    nextRows[rowIndex].splice(insertIndex, 0, key);
  } else {
    nextRows[rowIndex].push(key);
  }

  [0, 1].forEach((idx) => {
    if (nextRows[idx].length > MAX_CARDS_PER_ROW) {
      const overflow = nextRows[idx].slice(MAX_CARDS_PER_ROW);
      nextRows[idx] = nextRows[idx].slice(0, MAX_CARDS_PER_ROW);
      overflow.forEach((k) => {
        if (!hidden.includes(k)) hidden.push(k);
      });
    }
  });

  [0, 1].forEach((idx) => {
    if (expandedByRow[idx] && !nextRows[idx].includes(expandedByRow[idx])) expandedByRow[idx] = null;
  });

  return { ...prev, cardRows: nextRows, hiddenCards: hidden, expandedByRow };
}

export function hideCardLayout(prev, key) {
  const nextRows = prev.cardRows.map((row) => row.filter((k) => k !== key));
  const hidden = prev.hiddenCards.includes(key) ? prev.hiddenCards : [...prev.hiddenCards, key];
  const expandedByRow = [...(prev.expandedByRow || [null, null])].map((v) => (v === key ? null : v));
  const lockedCards = (prev.lockedCards || []).filter((k) => k !== key);
  return { ...prev, cardRows: nextRows, hiddenCards: hidden, expandedByRow, lockedCards };
}

export function toggleRowExpandCardLayout(prev, rowIndex, key) {
  if (rowIndex < 0 || rowIndex > 1) return prev;
  const row = prev.cardRows[rowIndex] || [];
  if (!row.includes(key)) return prev;

  const current = (prev.expandedByRow || [null, null])[rowIndex];
  if (current === key) {
    const next = [...(prev.expandedByRow || [null, null])];
    next[rowIndex] = null;
    return { ...prev, expandedByRow: next };
  }
  if (row.length > 4) return prev;

  const next = [...(prev.expandedByRow || [null, null])];
  next[rowIndex] = key;
  return { ...prev, expandedByRow: next };
}

export function toggleCardLockLayout(prev, key) {
  const visibleCards = new Set([...(prev.cardRows?.[0] || []), ...(prev.cardRows?.[1] || [])]);
  if (!visibleCards.has(key)) return prev;
  const lockedCards = new Set(prev.lockedCards || []);
  if (lockedCards.has(key)) lockedCards.delete(key);
  else lockedCards.add(key);
  return { ...prev, lockedCards: Array.from(lockedCards) };
}

export function mapAiInsightsToCardSlots(liveInsights, visibleCardRows, lockedCardKeys) {
  const orderedVisibleCards = (Array.isArray(visibleCardRows) ? visibleCardRows : []).flat().filter(Boolean);
  const locked = new Set(Array.isArray(lockedCardKeys) ? lockedCardKeys : []);
  const eligibleSlots = orderedVisibleCards.filter((key) => !locked.has(key));
  const availableSlots = new Set(eligibleSlots);
  const map = new Map();

  (Array.isArray(liveInsights) ? liveInsights : []).forEach((item) => {
    if (!item || item.removed_at || item.feedback_status === "downvoted") return;

    const preferredSlot = item.target_card_key;
    let assignedSlot = null;

    if (preferredSlot && availableSlots.has(preferredSlot)) {
      assignedSlot = preferredSlot;
    } else {
      assignedSlot = eligibleSlots.find((key) => availableSlots.has(key)) || null;
    }

    if (!assignedSlot) return;
    map.set(assignedSlot, item);
    availableSlots.delete(assignedSlot);
  });

  return map;
}

export function renderKpiRowWithHintLayout(row, isLayoutEditing, draggingKey, kpiDropHint) {
  if (!isLayoutEditing) return row;
  const cleanRow = row.filter((key) => key !== draggingKey);
  if (!kpiDropHint) return cleanRow;

  const withHint = [...cleanRow];
  if (!kpiDropHint.targetKey || !withHint.includes(kpiDropHint.targetKey)) {
    withHint.push("__KPI_DROP_HINT__");
    return withHint;
  }
  const targetIndex = withHint.indexOf(kpiDropHint.targetKey);
  const insertIndex = kpiDropHint.position === "after" ? targetIndex + 1 : targetIndex;
  withHint.splice(insertIndex, 0, "__KPI_DROP_HINT__");
  return withHint;
}

export function renderCardRowWithHintLayout(row, rowIndex, isLayoutEditing, draggingKey, cardDropHint) {
  if (!isLayoutEditing) return row;
  const cleanRow = row.filter((key) => key !== draggingKey);
  const hint = cardDropHint && cardDropHint.rowIndex === rowIndex ? cardDropHint : null;
  if (!hint) return cleanRow;

  const withHint = [...cleanRow];
  if (!hint.targetKey || !withHint.includes(hint.targetKey)) {
    withHint.push("__DROP_HINT__");
    return withHint;
  }
  const targetIndex = withHint.indexOf(hint.targetKey);
  const insertIndex = hint.position === "after" ? targetIndex + 1 : targetIndex;
  withHint.splice(insertIndex, 0, "__DROP_HINT__");
  return withHint;
}
