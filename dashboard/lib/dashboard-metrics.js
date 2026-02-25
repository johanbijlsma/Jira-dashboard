import { num } from "./dashboard-utils";

export function uniqueChartColor(index, total, saturation = 70, lightness = 45) {
  const safeTotal = Math.max(1, total);
  const hue = (index * (360 / safeTotal) + 15) % 360;
  return `hsl(${hue.toFixed(2)} ${saturation}% ${lightness}%)`;
}

export function isTotalLabel(label) {
  return String(label || "").toLowerCase() === "totaal";
}

export function median(values) {
  const v = values.filter((x) => x != null).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function wowSortValue(row) {
  const last = Number(row?.last) || 0;
  const prev = Number(row?.prev) || 0;
  if (prev <= 0 && last > 0) return Number.NEGATIVE_INFINITY;
  if (prev <= 0 && last <= 0) return Number.NEGATIVE_INFINITY;
  return ((last - prev) / prev) * 100;
}

export function trendInfo(last, prev) {
  const l = Number(last) || 0;
  const p = Number(prev) || 0;
  if (p <= 0 && l <= 0) return { symbol: "→", text: "0%", color: "var(--text-muted)" };
  if (p <= 0 && l > 0) return { symbol: "↑", text: "nieuw", color: "var(--ok)" };
  const delta = ((l - p) / p) * 100;
  if (delta > 0.5) return { symbol: "↑", text: `+${num(delta, 1)}%`, color: "var(--ok)" };
  if (delta < -0.5) return { symbol: "↓", text: `${num(delta, 1)}%`, color: "var(--danger)" };
  return { symbol: "→", text: `${num(delta, 1)}%`, color: "var(--text-muted)" };
}
