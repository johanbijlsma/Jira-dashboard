function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  return new Date(
    year,
    Math.floor((h + l - 7 * m + 114) / 31) - 1,
    ((h + l - 7 * m + 114) % 31) + 1
  );
}

function atMidnight(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function seasonalThemeForDate(date = new Date()) {
  const day = atMidnight(date);
  const year = date.getFullYear();
  const easter = easterSunday(year);
  const goodFriday = new Date(easter);
  goodFriday.setDate(easter.getDate() - 2);
  const easterMonday = new Date(easter);
  easterMonday.setDate(easter.getDate() + 1);
  if (day >= atMidnight(goodFriday) && day <= atMidnight(easterMonday)) return "pasen";
  if (date.getMonth() === 11 && date.getDate() >= 20 && date.getDate() <= 27) return "kerst";
  if (date.getMonth() === 11 && date.getDate() >= 1 && date.getDate() <= 6) return "sinterklaas";
  return "";
}
