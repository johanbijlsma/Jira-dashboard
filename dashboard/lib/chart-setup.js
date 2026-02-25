import { RELEASE_ANCHOR_ISO } from "./dashboard-constants";
import { num } from "./dashboard-utils";

export const legendNoopHandler = () => {};

export function setupChartDefaults(ChartJS) {
  const SimpleDataLabelsPlugin = {
    id: "simpleDataLabels",
    afterDatasetsDraw(chart, _args, pluginOptions) {
      if (pluginOptions === false) return;
      if (typeof document !== "undefined" && document.documentElement.dataset.tvMode === "1") return;
      if (chart.height < 260) return;
      const opts = {
        mode: "bar",
        color: null,
        fontSize: 10,
        fontWeight: "600",
        lineOffset: 6,
        barOffset: 6,
        maxLabels: 14,
        minArcPct: 6,
        datasetIndexes: null,
        ...pluginOptions,
      };

      const computed = typeof window !== "undefined" ? getComputedStyle(document.documentElement) : null;
      const textColor = opts.color || computed?.getPropertyValue("--text-main")?.trim() || "#111827";
      const haloColor = computed?.getPropertyValue("--surface")?.trim() || "#ffffff";
      const ctx = chart.ctx;
      const visibleMetas = chart.getSortedVisibleDatasetMetas();
      if (!visibleMetas.length) return;
      const colorCache = new Map();

      function resolveCssColor(input) {
        const key = String(input || "");
        if (!key) return null;
        if (colorCache.has(key)) return colorCache.get(key);
        const probe = document.createElement("canvas").getContext("2d");
        if (!probe) return null;
        probe.fillStyle = "#000000";
        probe.fillStyle = key;
        const normalized = probe.fillStyle;
        const m = String(normalized).match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
        const value = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
        colorCache.set(key, value);
        return value;
      }

      function contrastTextFor(background) {
        const rgb = resolveCssColor(background);
        if (!rgb) return textColor;
        const [r, g, b] = rgb.map((v) => v / 255);
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        return luminance > 0.6 ? "#0b1220" : "#f8fafc";
      }

      function drawLabel(label, x, y, fill = textColor) {
        const metrics = ctx.measureText(label);
        const labelWidth = Math.ceil(metrics.width);
        const labelHeight = Math.ceil(opts.fontSize * 1.25);
        const pad = 4;
        const clampedX = Math.max(pad + labelWidth / 2, Math.min(chart.width - pad - labelWidth / 2, x));
        const clampedY = Math.max(pad + labelHeight / 2, Math.min(chart.height - pad - labelHeight / 2, y));
        ctx.lineWidth = 3;
        ctx.strokeStyle = haloColor;
        ctx.strokeText(label, clampedX, clampedY);
        ctx.fillStyle = fill;
        ctx.fillText(label, clampedX, clampedY);
        ctx.fillStyle = textColor;
      }

      ctx.save();
      ctx.font = `${opts.fontWeight} ${opts.fontSize}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      if (opts.mode === "arc") {
        const meta = visibleMetas[0];
        const values = (chart.data.datasets?.[meta.index]?.data || []).map((v) => Number(v) || 0);
        const total = values.reduce((sum, v) => sum + v, 0);
        if (total <= 0) {
          ctx.restore();
          return;
        }

        meta.data.forEach((element, idx) => {
          const value = values[idx] || 0;
          if (value <= 0) return;
          const percentage = (value / total) * 100;
          if (percentage < opts.minArcPct) return;
          const pos = element.tooltipPosition();
          const label = `${num(value)} (${Math.round(percentage)}%)`;
          const rawColors = chart.data.datasets?.[meta.index]?.backgroundColor;
          const bgColor = Array.isArray(rawColors) ? rawColors[idx] : rawColors;
          drawLabel(label, pos.x, pos.y, contrastTextFor(bgColor));
        });
        ctx.restore();
        return;
      }

      visibleMetas.forEach((meta) => {
        if (Array.isArray(opts.datasetIndexes) && !opts.datasetIndexes.includes(meta.index)) return;
        const dataset = chart.data.datasets?.[meta.index];
        if (!dataset || dataset.hidden) return;
        if (String(dataset.label || "").startsWith("Mediaan ")) return;
        const values = (dataset.data || []).map((v) => Number(v));
        const valid = values.filter((v) => Number.isFinite(v));
        const step = valid.length > opts.maxLabels ? Math.ceil(valid.length / opts.maxLabels) : 1;

        meta.data.forEach((element, idx) => {
          const value = values[idx];
          if (!Number.isFinite(value) || value <= 0) return;
          if (idx % step !== 0 && idx !== values.length - 1) return;

          const pos = element.tooltipPosition();
          const y = opts.mode === "line" ? pos.y - opts.lineOffset : pos.y - opts.barOffset;
          drawLabel(num(value, value % 1 === 0 ? 0 : 1), pos.x, y, textColor);
        });
      });

      ctx.restore();
    },
  };

  const ReleaseCadencePlugin = {
    id: "releaseCadence",
    beforeDatasetsDraw(chart, _args, pluginOptions) {
      if (pluginOptions === false) return;
      const opts = {
        weeks: [],
        anchorIso: RELEASE_ANCHOR_ISO,
        intervalDays: 14,
        lineColor: null,
        lineWidth: 1,
        dash: [6, 4],
        ...pluginOptions,
      };

      const weeks = Array.isArray(opts.weeks) ? opts.weeks.filter(Boolean) : [];
      if (!weeks.length) return;

      const anchor = new Date(opts.anchorIso);
      if (Number.isNaN(anchor.getTime())) return;

      const start = new Date(`${weeks[0]}T00:00:00Z`);
      const lastWeek = new Date(`${weeks[weeks.length - 1]}T00:00:00Z`);
      const end = new Date(lastWeek.getTime() + 7 * 24 * 60 * 60 * 1000);
      const intervalMs = Math.max(1, Number(opts.intervalDays) || 14) * 24 * 60 * 60 * 1000;

      let releaseTs = anchor.getTime();
      if (releaseTs < start.getTime()) {
        const steps = Math.ceil((start.getTime() - releaseTs) / intervalMs);
        releaseTs += steps * intervalMs;
      } else {
        const steps = Math.floor((releaseTs - start.getTime()) / intervalMs);
        releaseTs -= steps * intervalMs;
        while (releaseTs < start.getTime()) releaseTs += intervalMs;
      }

      const xScale = chart.scales?.x;
      const yScale = chart.scales?.y;
      if (!xScale || !yScale) return;

      const computed = typeof window !== "undefined" ? getComputedStyle(document.documentElement) : null;
      const stroke = opts.lineColor || computed?.getPropertyValue("--accent")?.trim() || "#2563eb";

      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Number(opts.lineWidth) || 1;
      ctx.setLineDash(Array.isArray(opts.dash) ? opts.dash : [6, 4]);

      const yTop = yScale.top;
      const yBottom = yScale.bottom;

      while (releaseTs <= end.getTime()) {
        const releaseDate = new Date(releaseTs);
        const monday = new Date(releaseDate);
        const day = monday.getUTCDay();
        const diff = (day + 6) % 7;
        monday.setUTCDate(monday.getUTCDate() - diff);
        const weekIso = monday.toISOString().slice(0, 10);
        const weekIdx = weeks.indexOf(weekIso);

        if (weekIdx >= 0) {
          const xBase = xScale.getPixelForValue(weekIdx);
          const xNeighbor =
            weekIdx < weeks.length - 1
              ? xScale.getPixelForValue(weekIdx + 1)
              : weekIdx > 0
                ? xBase + (xBase - xScale.getPixelForValue(weekIdx - 1))
                : xBase;
          const daysSinceMonday = (releaseDate.getUTCDay() + 6) % 7;
          const x = xBase + (daysSinceMonday / 7) * (xNeighbor - xBase);

          ctx.beginPath();
          ctx.moveTo(x, yTop);
          ctx.lineTo(x, yBottom);
          ctx.stroke();
        }

        releaseTs += intervalMs;
      }

      ctx.restore();
    },
  };

  if (!ChartJS.registry.plugins.get("simpleDataLabels")) {
    ChartJS.register(SimpleDataLabelsPlugin);
  }
  if (!ChartJS.registry.plugins.get("releaseCadence")) {
    ChartJS.register(ReleaseCadencePlugin);
  }

  ChartJS.defaults.plugins.legend.onClick = legendNoopHandler;
  if (ChartJS.overrides?.doughnut?.plugins?.legend) {
    ChartJS.overrides.doughnut.plugins.legend.onClick = legendNoopHandler;
  }
  if (ChartJS.overrides?.pie?.plugins?.legend) {
    ChartJS.overrides.pie.plugins.legend.onClick = legendNoopHandler;
  }
  if (ChartJS.overrides?.polarArea?.plugins?.legend) {
    ChartJS.overrides.polarArea.plugins.legend.onClick = legendNoopHandler;
  }
  ChartJS.defaults.plugins.legend.onHover = (evt) => {
    if (evt?.native?.target?.style) evt.native.target.style.cursor = "default";
  };
  ChartJS.defaults.plugins.legend.onLeave = (evt) => {
    if (evt?.native?.target?.style) evt.native.target.style.cursor = "default";
  };
}
