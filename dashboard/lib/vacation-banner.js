function addDaysIso(yyyyMmDd, days) {
  const [y, m, d] = String(yyyyMmDd || "").split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + Number(days || 0));
  return dt.toISOString().slice(0, 10);
}

export function isWeekdayIso(yyyyMmDd) {
  if (!yyyyMmDd) return false;
  const [y, m, d] = String(yyyyMmDd).split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const day = dt.getUTCDay();
  return day >= 1 && day <= 5;
}

export function businessDaysUntil(fromIso, toIso) {
  if (!fromIso || !toIso || toIso <= fromIso) return 0;
  let cursor = addDaysIso(fromIso, 1);
  let total = 0;
  while (cursor <= toIso) {
    if (isWeekdayIso(cursor)) total += 1;
    cursor = addDaysIso(cursor, 1);
  }
  return total;
}

export function weekdayNameNl(value) {
  if (!value) return "";
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return new Intl.DateTimeFormat("nl-NL", { weekday: "long" }).format(dt);
}

export function buildUpcomingWarningText(memberName, startDate, endDate) {
  const name = String(memberName || "").trim();
  const start = String(startDate || "").trim();
  const end = String(endDate || "").trim();
  const dayName = weekdayNameNl(start);
  if (start && end && start === end) return `${name} is ${dayName} vrij`;
  return `${name} is vanaf ${dayName} vrij`;
}
