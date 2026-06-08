import Chart from 'chart.js/auto';

window.Chart = Chart;

const currentWeekHighlightPlugin = {
  id: 'currentWeekHighlight',
  beforeDatasetsDraw(chart) {
    const isLineChart = chart.config?.type === 'line' || (Array.isArray(chart.data?.datasets) && chart.data.datasets.some((dataset) => dataset?.type === 'line'));
    if (!isLineChart) {
      return;
    }

    const labels = Array.isArray(chart.data?.labels) ? chart.data.labels : [];
    const index = labels.findIndex((label) => String(label || '').trim().endsWith('*'));
    if (index < 0) {
      return;
    }

    const xScale = chart.scales?.x;
    if (!xScale || typeof xScale.getPixelForTick !== 'function') {
      return;
    }

    const currentX = xScale.getPixelForTick(index);
    const prevX = index > 0 ? xScale.getPixelForTick(index - 1) : null;
    const nextX = index < labels.length - 1 ? xScale.getPixelForTick(index + 1) : null;

    let left;
    let right;

    if (prevX !== null && nextX !== null) {
      left = (prevX + currentX) / 2;
      right = (currentX + nextX) / 2;
    } else if (nextX !== null) {
      const width = nextX - currentX;
      left = currentX - width / 2;
      right = currentX + width / 2;
    } else if (prevX !== null) {
      const width = currentX - prevX;
      left = currentX - width / 2;
      right = currentX + width / 2;
    } else {
      left = chart.chartArea.left;
      right = chart.chartArea.right;
    }

    const { top, bottom } = chart.chartArea;
    const ctx = chart.ctx;

    ctx.save();
    ctx.fillStyle = '#fafbfd';
    ctx.fillRect(left, top, right - left, bottom - top);
    ctx.restore();
  },
};

const legendSpacingPlugin = {
  id: 'legendSpacing',
  beforeInit(chart) {
    if (chart.options?.plugins?.legend) {
      chart.options.plugins.legend.labels = {
        ...chart.options.plugins.legend.labels,
        pointStyleWidth: 14,
        padding: 20,
      };
    }
  },
};

if (!Chart.registry.plugins.get('currentWeekHighlight')) {
  Chart.register(currentWeekHighlightPlugin);
}
if (!Chart.registry.plugins.get('legendSpacing')) {
  Chart.register(legendSpacingPlugin);
}

document.addEventListener('alpine:init', () => {
  window.Alpine.data('lineChart', (config) => ({
    chart: null,
    config,
    resizeObserver: null,
    resizeHandler: null,

    init() {
      this.$nextTick(() => {
        this.renderChart();
        this.bindResizeHandling();
      });
    },

    renderChart() {
      const canvas = this.$refs.canvas;
      if (!canvas || !window.Chart) {
        return;
      }

      if (this.chart) {
        this.chart.destroy();
      }

      const normalizedConfig = JSON.parse(JSON.stringify(this.config));
      this.chart = new window.Chart(canvas, normalizedConfig);
    },

    bindResizeHandling() {
      const rerender = () => {
        if (!this.chart) {
          return;
        }

        requestAnimationFrame(() => {
          if (!this.chart) {
            return;
          }

          this.chart.resize();
        });
      };

      this.resizeHandler = rerender;
      window.addEventListener('resize', this.resizeHandler);

      if (window.ResizeObserver) {
        this.resizeObserver = new ResizeObserver(() => {
          rerender();
        });

        this.resizeObserver.observe(this.$el);
      }

      setTimeout(rerender, 50);
      setTimeout(rerender, 250);
    },

    destroy() {
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = null;
      }

      if (this.resizeHandler) {
        window.removeEventListener('resize', this.resizeHandler);
        this.resizeHandler = null;
      }

      if (this.chart) {
        this.chart.destroy();
        this.chart = null;
      }
    },
  }));
});
