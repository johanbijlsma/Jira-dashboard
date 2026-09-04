import { addDaysIso, fmtDate, isoDate, weekStartIsoFromDate } from "./dashboard-utils";

export const REPORTING_WEEK_COUNT = 4;

/**
 * Returns the dashboard's automatic reporting period. Keeping this period at
 * four week buckets makes the chart layout predictable, whether the current
 * partial week is shown or not.
 */
export function getStandardReportingRange({ includeCurrentWeek = true, now = new Date() } = {}) {
  const currentWeekStart = weekStartIsoFromDate(now);
  const completedWeeks = includeCurrentWeek ? REPORTING_WEEK_COUNT - 1 : REPORTING_WEEK_COUNT;
  const fromIso = addDaysIso(currentWeekStart, -completedWeeks * 7);
  const toIso = includeCurrentWeek ? isoDate(now) : addDaysIso(currentWeekStart, -1);

  return {
    fromIso,
    toIso,
    fromLabel: fmtDate(fromIso),
    toLabel: fmtDate(toIso),
  };
}
