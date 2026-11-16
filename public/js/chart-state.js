// Shared by the existing non-AI chart modules; never changes chart data.
export function registerChartState() {
  if (!window.Chart || /ai-analysis\.html$/.test(location.pathname)) return;
  Chart.register({
    id: 'datasetAvailability',
    beforeUpdate(chart) {
      if (!Array.isArray(chart.data.labels)) chart.data.labels = [];
      for (const dataset of chart.data.datasets || []) {
        if (!Array.isArray(dataset.data)) dataset.data = [];
        dataset.data = dataset.data.map(value => typeof value === 'number' && Number.isFinite(value) ? value : null);
      }
      if (chart.config.type !== 'line') return;
      for (const dataset of chart.data.datasets || []) {
        const values = Array.isArray(dataset.data) ? dataset.data : [];
        const count = values.filter(value => typeof value === 'number' && Number.isFinite(value)).length;
        if (count === 1) dataset.pointRadius = 4;
      }
    },
    afterDraw(chart) {
      const datasets = chart.data.datasets || [];
      const valid = datasets.flatMap(dataset => Array.isArray(dataset.data) ? dataset.data : [])
        .filter(value => typeof value === 'number' && Number.isFinite(value));
      const maxPoints = Math.max(0, ...datasets.map(dataset => (Array.isArray(dataset.data) ? dataset.data : []).filter(value => typeof value === 'number' && Number.isFinite(value)).length));
      const text = !valid.length ? 'Chưa đủ dữ liệu — không thay bằng 0' : chart.config.type === 'line' && maxPoints === 1 ? 'Chỉ có một mốc — chưa thể xác định xu hướng' : '';
      chart.canvas.setAttribute('aria-description', text || 'Biểu đồ từ dữ liệu API');
      if (!text) return;
      const {ctx, chartArea} = chart;
      if (!chartArea) return;
      ctx.save();ctx.fillStyle = '#64748b';ctx.font = '12px system-ui';ctx.textAlign = 'center';
      ctx.fillText(text, (chartArea.left + chartArea.right) / 2, valid.length ? chartArea.bottom - 10 : (chartArea.top + chartArea.bottom) / 2, Math.max(40, chartArea.right - chartArea.left));
      ctx.restore();
    },
  });
}
