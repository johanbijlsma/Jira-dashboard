export function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

export const AMSTERDAM_TIME_ZONE = "Europe/Amsterdam";

export function fmtDate(value) {
  if (!value) return "";
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(dt);
}

export function fmtDateWithWeekday(value) {
  if (!value) return "";
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  const weekday = new Intl.DateTimeFormat("nl-NL", { weekday: "long" }).format(dt);
  const datePart = new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
    .format(dt)
    .replaceAll("/", "-");
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${datePart}`;
}

export function fmtDateTime(value) {
  if (!value) return "";
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: AMSTERDAM_TIME_ZONE,
  }).format(dt);
}

export function weekStartIsoFromDate(d = new Date()) {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = dt.getUTCDay();
  const diff = (day + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - diff);
  return dt.toISOString().slice(0, 10);
}

export function weekStartIsoFromIsoDate(yyyyMmDd) {
  if (!yyyyMmDd) return "";
  const [y, m, d] = String(yyyyMmDd).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(dt.getTime())) return "";
  const day = dt.getUTCDay();
  const diff = (day + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - diff);
  return dt.toISOString().slice(0, 10);
}

export function zonedDateTimeParts(value, timeZone = AMSTERDAM_TIME_ZONE) {
  if (!value) return null;
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(dt);

  const lookup = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const year = Number(lookup.year);
  const month = Number(lookup.month);
  const day = Number(lookup.day);
  const hour = Number(lookup.hour);
  const minute = Number(lookup.minute);
  const second = Number(lookup.second);

  if ([year, month, day, hour, minute, second].some((part) => Number.isNaN(part))) return null;

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    isoDate: `${lookup.year}-${lookup.month}-${lookup.day}`,
  };
}

export function isCurrentPartialWeek(dateIso, now = new Date()) {
  if (!dateIso) return false;
  const [y, m, d] = String(dateIso).split("-").map(Number);
  const selected = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(selected.getTime())) return false;
  const selectedWeek = weekStartIsoFromDate(selected);
  const currentWeek = weekStartIsoFromDate(now);
  if (selectedWeek !== currentWeek) return false;
  return selected.getUTCDay() !== 0;
}

export function buildWeekStartsFromRange(fromIso, toIso) {
  if (!fromIso || !toIso) return [];
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  const from = new Date(Date.UTC(fy, fm - 1, fd));
  const to = new Date(Date.UTC(ty, tm - 1, td));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return [];

  const day = from.getUTCDay();
  const diff = (day + 6) % 7;
  from.setUTCDate(from.getUTCDate() - diff);

  const weeks = [];
  const cursor = new Date(from);
  while (cursor <= to) {
    weeks.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return weeks;
}

export function trimLeadingPartialWeek(weeks, fromIso) {
  if (!Array.isArray(weeks) || !weeks.length || !fromIso) return weeks;
  return fromIso > weeks[0] ? weeks.slice(1) : weeks;
}

export function addDaysIso(yyyyMmDd, days) {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function weekdayIndexFromIsoDate(yyyyMmDd) {
  if (!yyyyMmDd) return null;
  const [y, m, d] = String(yyyyMmDd).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(dt.getTime())) return null;
  return dt.getUTCDay();
}

export function shiftIsoDateToWeekday(yyyyMmDd, weekdayIndex) {
  const currentWeekday = weekdayIndexFromIsoDate(yyyyMmDd);
  const nextWeekday = Number(weekdayIndex);
  if (currentWeekday == null || Number.isNaN(nextWeekday)) return "";
  return addDaysIso(yyyyMmDd, nextWeekday - currentWeekday);
}

export function isTextEntryTarget(target) {
  const el = target instanceof HTMLElement ? target : null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tagName = String(el.tagName || "").toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") return true;
  return !!el.closest?.("input, textarea, select, [contenteditable='true']");
}

export function hasDataPoints(chartData) {
  if (!chartData || !Array.isArray(chartData.datasets)) return false;
  return chartData.datasets.some(
    (ds) => Array.isArray(ds.data) && ds.data.some((v) => typeof v === "number" && v > 0)
  );
}

export function num(value, digits = 0) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return new Intl.NumberFormat("nl-NL", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(Number(value));
}

export function pct(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `${num(value, 1)}%`;
}

export function sameStringSet(a, b) {
  const left = Array.isArray(a) ? Array.from(new Set(a.map((x) => String(x)))) : [];
  const right = Array.isArray(b) ? Array.from(new Set(b.map((x) => String(x)))) : [];
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

export function initialsFromName(name) {
  const words = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] || ""}${words[words.length - 1][0] || ""}`.toUpperCase();
}
