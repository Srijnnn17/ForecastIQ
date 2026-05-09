/**
 * Backtesting module for ForecastIQ.
 * Walk-forward validation — shows how the model would have performed.
 */

const BacktestModule = {
    init() {
        const btn = document.getElementById('btn-backtest');
        if (btn) btn.addEventListener('click', () => this.run());
    },

    async run() {
        const dataset = document.getElementById('dataset-select').value;
        const column  = document.getElementById('column-select').value;
        const holdout = parseInt(document.getElementById('backtest-holdout')?.value || '4');

        if (!dataset) { App.showToast('Select a dataset first', 'warning'); return; }

        App.showLoading('Running backtest...');
        try {
            const res = await API.request('/api/backtest', {
                method: 'POST',
                body: JSON.stringify({ dataset, value_column: column || undefined, holdout_size: holdout, confidence: 0.95 }),
            });
            this.render(res.data);
            App.showToast('Backtest complete', 'success');
        } catch (e) {
            App.showToast(e.message, 'error');
        } finally {
            App.hideLoading();
        }
    },

    render(data) {
        const section = document.getElementById('backtest-section');
        section.style.display = 'block';

        const placeholder = document.getElementById('backtest-placeholder');
        if (placeholder) placeholder.style.display = 'none';

        // Metrics
        const m = data.metrics;
        document.getElementById('bt-mape').textContent   = `${m.mape}%`;
        document.getElementById('bt-rmse').textContent   = m.rmse.toLocaleString();
        document.getElementById('bt-hitrate').textContent = `${m.hit_rate}%`;
        document.getElementById('bt-bias').textContent   = m.bias > 0 ? `+${m.bias}` : `${m.bias}`;
        document.getElementById('bt-interpretation').textContent = data.interpretation;

        // Hit-rate colour
        const hrEl = document.getElementById('bt-hitrate');
        hrEl.style.color = m.hit_rate >= 80 ? 'var(--success)' : m.hit_rate >= 60 ? 'var(--warning)' : 'var(--danger)';

        // Chart
        const allDates = [...data.train_dates, ...data.holdout_dates];
        const trainVals = [...data.train_values, ...new Array(data.holdout_dates.length).fill(null)];
        const actualVals = [...new Array(data.train_values.length).fill(null), ...data.actual_values];
        const forecastVals = [...new Array(data.train_values.length).fill(null), ...data.forecast_values];
        const upperVals = [...new Array(data.train_values.length).fill(null), ...data.upper_bound];
        const lowerVals = [...new Array(data.train_values.length).fill(null), ...data.lower_bound];

        Charts.createChart('backtest-chart', {
            type: 'line',
            data: {
                labels: allDates,
                datasets: [
                    { label: 'Historical', data: trainVals, borderColor: Charts.colors.primary, backgroundColor: Charts.colors.primaryLight, fill: true, borderWidth: 2, pointRadius: 2, tension: 0.3 },
                    { label: 'Actual (holdout)', data: actualVals, borderColor: Charts.colors.success, backgroundColor: 'transparent', borderWidth: 2.5, pointRadius: 5, pointStyle: 'circle', tension: 0.3 },
                    { label: 'Model Forecast', data: forecastVals, borderColor: Charts.colors.warning, backgroundColor: 'transparent', borderWidth: 2.5, borderDash: [6, 4], pointRadius: 4, tension: 0.3 },
                    { label: 'Upper', data: upperVals, borderColor: 'transparent', backgroundColor: 'rgba(245,158,11,0.12)', fill: '+1', pointRadius: 0, tension: 0.3 },
                    { label: 'Lower', data: lowerVals, borderColor: 'transparent', backgroundColor: 'transparent', fill: false, pointRadius: 0, tension: 0.3 },
                ]
            },
            options: {
                ...Charts.getDefaultOptions(),
                plugins: {
                    ...Charts.getDefaultOptions().plugins,
                    legend: { ...Charts.getDefaultOptions().plugins.legend, labels: { ...Charts.getDefaultOptions().plugins.legend.labels, filter: i => !['Upper','Lower'].includes(i.text) } }
                }
            }
        });
    }
};
