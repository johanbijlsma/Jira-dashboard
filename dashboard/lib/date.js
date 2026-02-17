export function parseNlDateToIso(value) {
  // accepts dd/mm/yyyy (also allow dd-mm-yyyy)
  if (!value) return "";
  const v = String(value).trim();
  const m = v.match(/^\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s*$/);
  if (!m) return "";
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (!yyyy || mm < 1 || mm > 12 || dd < 1 || dd > 31) return "";
  // Validate by round-tripping through UTC
  const dt = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (dt.getUTCFullYear() !== yyyy || dt.getUTCMonth() !== mm - 1 || dt.getUTCDate() !== dd) return "";
  return dt.toISOString().slice(0, 10);
}
