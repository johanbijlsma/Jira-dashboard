import { RELEASE_ANCHOR_ISO } from "./dashboard-constants";
import {
  addDaysIso,
  AMSTERDAM_TIME_ZONE,
  fmtDate,
  num,
  weekStartIsoFromIsoDate,
  zonedDateTimeParts,
} from "./dashboard-utils";

export const legendNoopHandler = () => {};

export function setupChartDefaults(ChartJS) {
  const cssVar = (name, fallback) => {
    if (typeof window === "undefined" || typeof document === "undefined") return fallback;
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  };

  function getReleaseMarkers(weeks, opts, xScale) {
    const anchor = zonedDateTimeParts(opts.anchorIso, opts.timeZone);
    if (!anchor) return [];

    const intervalDays = Math.max(1, Number(opts.intervalDays) || 14);
    const dayMs = 24 * 60 * 60 * 1000;
    const startIso = weeks[0];
    const endExclusiveIso = addDaysIso(weeks[weeks.length - 1], 7);
    const secondsSinceMidnight = anchor.hour * 60 * 60 + anchor.minute * 60 + anchor.second;

    let releaseIso = anchor.isoDate;
    if (releaseIso < startIso) {
      const steps = Math.ceil((Date.parse(`${startIso}T00:00:00Z`) - Date.parse(`${releaseIso}T00:00:00Z`)) / dayMs / intervalDays);
      releaseIso = addDaysIso(releaseIso, steps * intervalDays);
    } else {
      const steps = Math.floor((Date.parse(`${releaseIso}T00:00:00Z`) - Date.parse(`${startIso}T00:00:00Z`)) / dayMs / intervalDays);
      releaseIso = addDaysIso(releaseIso, -steps * intervalDays);
      while (releaseIso < startIso) releaseIso = addDaysIso(releaseIso, intervalDays);
    }

    const markers = [];
    while (releaseIso < endExclusiveIso) {
      const weekIso = weekStartIsoFromIsoDate(releaseIso);
      const weekIdx = weeks.indexOf(weekIso);

      if (weekIdx >= 0) {
        const xBase = xScale.getPixelForValue(weekIdx);
        const xNeighbor =
          weekIdx < weeks.length - 1
            ? xScale.getPixelForValue(weekIdx + 1)
            : weekIdx > 0
              ? xBase + (xBase - xScale.getPixelForValue(weekIdx - 1))
              : xBase;
        const daysSinceMonday =
          (Date.parse(`${releaseIso}T00:00:00Z`) - Date.parse(`${weekIso}T00:00:00Z`)) / dayMs;
        const fractionOfWeek = (daysSinceMonday * 24 * 60 * 60 + secondsSinceMidnight) / (7 * 24 * 60 * 60);
        const rawX = xBase + fractionOfWeek * (xNeighbor - xBase);
        markers.push({
          isoDate: releaseIso,
          x: Math.max(xScale.left + 1, Math.min(xScale.right - 1, rawX)),
        });
      }

      releaseIso = addDaysIso(releaseIso, intervalDays);
    }

    return markers;
  }

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
        timeZone: AMSTERDAM_TIME_ZONE,
        lineColor: null,
        lineWidth: 1,
        dash: [6, 4],
        partialWeekIndex: -1,
        partialWeekFill: null,
        partialWeekBorder: null,
        ...pluginOptions,
      };

      const weeks = Array.isArray(opts.weeks) ? opts.weeks.filter(Boolean) : [];
      if (!weeks.length) return;

      const xScale = chart.scales?.x;
      const yScale = chart.scales?.y;
      if (!xScale || !yScale) return;

      const computed = typeof window !== "undefined" ? getComputedStyle(document.documentElement) : null;
      const stroke = opts.lineColor || computed?.getPropertyValue("--accent")?.trim() || "#2563eb";
      const partialWeekFill =
        opts.partialWeekFill || computed?.getPropertyValue("--surface-muted")?.trim() || "#f8fafc";
      const partialWeekBorder =
        opts.partialWeekBorder || computed?.getPropertyValue("--text-muted")?.trim() || "#64748b";

      const ctx = chart.ctx;
      ctx.save();

      const partialWeekIndex = Number.isInteger(opts.partialWeekIndex) ? opts.partialWeekIndex : -1;
      if (partialWeekIndex >= 0 && partialWeekIndex < weeks.length) {
        const xCenter = xScale.getPixelForValue(partialWeekIndex);
        const xPrev = partialWeekIndex > 0 ? xScale.getPixelForValue(partialWeekIndex - 1) : xCenter;
        const xNext = partialWeekIndex < weeks.length - 1 ? xScale.getPixelForValue(partialWeekIndex + 1) : xCenter;
        const halfLeft = partialWeekIndex > 0 ? (xCenter - xPrev) / 2 : (xNext - xCenter) / 2 || 24;
        const halfRight = partialWeekIndex < weeks.length - 1 ? (xNext - xCenter) / 2 : (xCenter - xPrev) / 2 || 24;
        const left = xCenter - Math.max(halfLeft, 18);
        const right = xCenter + Math.max(halfRight, 18);

        ctx.fillStyle = `color-mix(in srgb, ${partialWeekFill} 72%, transparent)`;
        ctx.fillRect(left, yScale.top, right - left, yScale.bottom - yScale.top);

        ctx.strokeStyle = `color-mix(in srgb, ${partialWeekBorder} 42%, transparent)`;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(left, yScale.top);
        ctx.lineTo(left, yScale.bottom);
        ctx.moveTo(right, yScale.top);
        ctx.lineTo(right, yScale.bottom);
        ctx.stroke();
      }

      ctx.strokeStyle = stroke;
      ctx.lineWidth = Number(opts.lineWidth) || 1;
      ctx.setLineDash(Array.isArray(opts.dash) ? opts.dash : [6, 4]);

      const yTop = yScale.top;
      const yBottom = yScale.bottom;
      const markers = getReleaseMarkers(weeks, opts, xScale);
      chart.$releaseCadence = {
        markers,
        activeMarkerIndex: chart.$releaseCadence?.activeMarkerIndex ?? -1,
      };

      markers.forEach((marker) => {
        const isActive = chart.$releaseCadence?.activeMarkerIndex >= 0
          && markers[chart.$releaseCadence.activeMarkerIndex]?.isoDate === marker.isoDate;
        if (isActive) {
          ctx.save();
          ctx.lineWidth = Math.max(2, Number(opts.lineWidth) || 1);
          ctx.setLineDash(Array.isArray(opts.dash) ? opts.dash : [6, 4]);
        }
          ctx.beginPath();
          ctx.moveTo(marker.x, yTop);
          ctx.lineTo(marker.x, yBottom);
          ctx.stroke();
        if (isActive) ctx.restore();
      });

      const activeMarker = markers[chart.$releaseCadence?.activeMarkerIndex] || null;
      if (activeMarker) {
        const label = `Release ${fmtDate(activeMarker.isoDate)}`;
        ctx.save();
        ctx.setLineDash([]);
        ctx.font = "600 12px system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const metrics = ctx.measureText(label);
        const padX = 8;
        const padY = 6;
        const width = Math.ceil(metrics.width) + padX * 2;
        const height = 24;
        const centerX = Math.max(
          xScale.left + width / 2 + 4,
          Math.min(xScale.right - width / 2 - 4, activeMarker.x)
        );
        const centerY = yTop + height / 2 + padY;
        const left = centerX - width / 2;
        const top = centerY - height / 2;

        ctx.fillStyle = "color-mix(in srgb, var(--surface, #ffffff) 94%, #0f172a 6%)";
        ctx.strokeStyle = "color-mix(in srgb, var(--border, #cbd5e1) 88%, transparent)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(left, top, width, height, 8);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = computed?.getPropertyValue("--text-main")?.trim() || "#111827";
        ctx.fillText(label, centerX, centerY);
        ctx.restore();
      }

      ctx.restore();
    },
    afterEvent(chart, args, pluginOptions) {
      if (pluginOptions === false) return;
      const evt = args?.event;
      const markers = chart.$releaseCadence?.markers || [];
      if (!evt || !markers.length) return;

      const opts = {
        hoverTolerance: 8,
        ...pluginOptions,
      };
      const xScale = chart.scales?.x;
      const yScale = chart.scales?.y;
      if (!xScale || !yScale) return;

      const insideY = evt.y >= yScale.top && evt.y <= yScale.bottom;
      const nextIndex = insideY
        ? markers.findIndex((marker) => Math.abs(evt.x - marker.x) <= Number(opts.hoverTolerance || 8))
        : -1;
      const currentIndex = chart.$releaseCadence?.activeMarkerIndex ?? -1;

      if (evt.type === "mouseout") {
        if (currentIndex !== -1) {
          chart.$releaseCadence.activeMarkerIndex = -1;
          args.changed = true;
        }
        return;
      }

      if (nextIndex !== currentIndex) {
        chart.$releaseCadence.activeMarkerIndex = nextIndex;
        args.changed = true;
      }
    },
  };

  const RenderWatchPlugin = {
    id: "renderWatch",
    afterRender(_chart, _args, pluginOptions) {
      if (!pluginOptions || pluginOptions === false) return;
      if (typeof pluginOptions.onReady === "function") {
        pluginOptions.onReady();
      }
    },
  };

  if (!ChartJS.registry.plugins.get("simpleDataLabels")) {
    ChartJS.register(SimpleDataLabelsPlugin);
  }
  if (!ChartJS.registry.plugins.get("releaseCadence")) {
    ChartJS.register(ReleaseCadencePlugin);
  }
  if (!ChartJS.registry.plugins.get("renderWatch")) {
    ChartJS.register(RenderWatchPlugin);
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
  ChartJS.defaults.color = cssVar("--text-subtle", "#cbd5e1");
  ChartJS.defaults.borderColor = cssVar("--border", "#334155");
  ChartJS.defaults.plugins.legend.labels.color = cssVar("--text-subtle", "#cbd5e1");
  ChartJS.defaults.scale.grid.color = `color-mix(in srgb, ${cssVar("--border", "#334155")} 38%, transparent)`;
  ChartJS.defaults.scale.ticks.color = cssVar("--text-subtle", "#cbd5e1");
  ChartJS.defaults.scale.title.color = cssVar("--text-subtle", "#cbd5e1");
}
