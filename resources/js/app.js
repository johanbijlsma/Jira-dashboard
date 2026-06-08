import Chart from 'chart.js/auto';

window.Chart = Chart;

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
