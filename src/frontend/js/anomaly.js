/**
 * Anomaly detection tab logic for ForecastIQ.
 * Detects unusual spikes and dips with severity scoring
 * and AI-generated explanations.
 */

const AnomalyTab = {
    /**
     * Initialize the anomaly tab event listeners.
     */
    init() {
        const btnAnomaly = document.getElementById('btn-anomaly');
        if (btnAnomaly) {
            btnAnomaly.addEventListener('click', () => this.runDetection());
        }
    },

    /**
     * Run anomaly detection on the selected dataset.
     */
    async runDetection() {
        const dataset = document.getElementById('dataset-select').value;
        const column = document.getElementById('column-select').value;
        const sensitivity = parseInt(document.getElementById('anomaly-sensitivity').value);

        if (!dataset) {
            App.showToast('Please select a dataset first', 'warning');
            return;
        }

        App.showLoading('Scanning for anomalies...');

        try {
            const response = await API.detectAnomalies({
                dataset,
                value_column: column || undefined,
                sensitivity,
            });

            const data = response.data;
            this.lastData = data;
            ExportModule.lastAnomalyData = data;

            this.renderChart(data);
            this.renderSummary(data);
            this.renderAnomalyList(data.anomalies);
            this.renderExplanation(data.explanation);

            App.showToast(
                `Found ${data.total_anomalies} anomalies`,
                data.total_anomalies > 0 ? 'warning' : 'success'
            );
        } catch (error) {
            App.showToast(error.message, 'error');
        } finally {
            App.hideLoading();
        }
    },

    /**
     * Render the anomaly detection chart.
     * @param {Object} data - Anomaly detection response data
     */
    renderChart(data) {
        const placeholder = document.getElementById('anomaly-placeholder');
        if (placeholder) placeholder.style.display = 'none';

        const dates = data.historical.dates;
        const values = data.historical.values;

        // Mark anomaly points
        const normalValues = [...values];
        const criticalPoints = new Array(values.length).fill(null);
        const warningPoints = new Array(values.length).fill(null);

        data.anomalies.forEach(anomaly => {
            const idx = anomaly.index;
            if (idx < values.length) {
                if (anomaly.severity === 'critical') {
                    criticalPoints[idx] = values[idx];
                } else {
                    warningPoints[idx] = values[idx];
                }
            }
        });

        // Expected range band
        const mean = data.summary.data_mean;
        const std = data.summary.data_std;
        const upperExpected = new Array(values.length).fill(mean + 2 * std);
        const lowerExpected = new Array(values.length).fill(mean - 2 * std);

        const config = {
            type: 'line',
            data: {
                labels: dates,
                datasets: [
                    {
                        label: 'Values',
                        data: normalValues,
                        borderColor: Charts.colors.primary,
                        backgroundColor: Charts.colors.primaryLight,
                        borderWidth: 2,
                        pointRadius: 2,
                        pointHoverRadius: 5,
                        tension: 0.3,
                        fill: true,
                        order: 1,
                    },
                    {
                        label: 'Critical Anomalies',
                        data: criticalPoints,
                        borderColor: Charts.colors.danger,
                        backgroundColor: Charts.colors.danger,
                        borderWidth: 0,
                        pointRadius: 8,
                        pointHoverRadius: 10,
                        pointStyle: 'triangle',
                        showLine: false,
                        order: 0,
                    },
                    {
                        label: 'Warnings',
                        data: warningPoints,
                        borderColor: Charts.colors.warning,
                        backgroundColor: Charts.colors.warning,
                        borderWidth: 0,
                        pointRadius: 7,
                        pointHoverRadius: 9,
                        pointStyle: 'circle',
                        showLine: false,
                        order: 0,
                    },
                    {
                        label: 'Expected Upper',
                        data: upperExpected,
                        borderColor: 'rgba(255,255,255,0.1)',
                        backgroundColor: Charts.colors.primaryLight,
                        borderWidth: 1,
                        borderDash: [4, 4],
                        fill: '+1',
                        pointRadius: 0,
                        order: 10,
                    },
                    {
                        label: 'Expected Lower',
                        data: lowerExpected,
                        borderColor: 'rgba(255,255,255,0.1)',
                        backgroundColor: 'transparent',
                        borderWidth: 1,
                        borderDash: [4, 4],
                        fill: false,
                        pointRadius: 0,
                        order: 10,
                    },
                ],
            },
            options: {
                ...Charts.getDefaultOptions(),
                plugins: {
                    ...Charts.getDefaultOptions().plugins,
                    legend: {
                        ...Charts.getDefaultOptions().plugins.legend,
                        labels: {
                            ...Charts.getDefaultOptions().plugins.legend.labels,
                            filter: function(item) {
                                return !item.text.includes('Expected');
                            },
                        },
                    },
                },
            },
        };

        Charts.createChart('anomaly-chart', config);
    },

    /**
     * Render the anomaly summary statistics.
     * @param {Object} data - Anomaly detection response data
     */
    renderSummary(data) {
        const results = document.getElementById('anomaly-results');
        results.style.display = 'block';

        document.getElementById('stat-total-anomalies').textContent = data.total_anomalies;
        document.getElementById('stat-critical').textContent = data.summary.critical_count;
        document.getElementById('stat-warnings').textContent = data.summary.warning_count;
        document.getElementById('stat-anomaly-rate').textContent = `${data.summary.anomaly_rate}%`;
    },

    /**
     * Render the list of detected anomalies.
     * @param {Array} anomalies - List of anomaly objects
     */
    renderAnomalyList(anomalies) {
        const container = document.getElementById('anomaly-items');
        container.innerHTML = '';

        if (anomalies.length === 0) {
            container.innerHTML = '<p style="color: var(--text-muted); padding: 16px;">No anomalies detected at this sensitivity level.</p>';
            return;
        }

        const arrowUpRight = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>';
        const arrowDownRight = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="7" x2="17" y2="17"/><polyline points="17 7 17 17 7 17"/></svg>';

        anomalies.forEach(anomaly => {
            const item = document.createElement('div');
            item.className = `anomaly-item ${anomaly.severity}`;

            const deviationColor = anomaly.deviation_pct > 0 ? Charts.colors.danger : Charts.colors.success;
            const directionIcon = anomaly.direction === 'spike' ? arrowUpRight : arrowDownRight;
            const directionText = anomaly.direction === 'spike' ? 'Spike' : 'Dip';

            item.innerHTML = `
                <span class="anomaly-item-date">${anomaly.date}</span>
                <span class="anomaly-item-value">${anomaly.value.toLocaleString()}</span>
                <span class="anomaly-item-badge ${anomaly.severity}">${anomaly.severity}</span>
                <span class="anomaly-item-direction">${directionIcon}<span>${directionText}</span></span>
                <span class="anomaly-item-deviation" style="color: ${deviationColor}">${anomaly.deviation_pct > 0 ? '+' : ''}${anomaly.deviation_pct}%</span>
            `;

            item.title = 'Click to analyse with News Agents';
            item.style.cursor = 'pointer';

            item.addEventListener('click', () => {
                if (typeof setNewsAgentContext === 'function') {
                    const dataset = document.getElementById('dataset-select')?.value || '';
                    const col     = document.getElementById('column-select')?.value || '';
                    setNewsAgentContext(
                        anomaly.date,
                        dataset,
                        col ? [col, anomaly.direction === 'spike' ? 'cash surge' : 'cash dip'] : []
                    );
                    // Scroll to the panel
                    document.getElementById('na-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });

            container.appendChild(item);
        });
    },

    /**
     * Render the AI explanation card.
     * @param {string} explanation - AI-generated explanation
     */
    renderExplanation(explanation) {
        const card = document.getElementById('anomaly-explanation');
        const text = document.getElementById('anomaly-explanation-text');
        card.style.display = 'block';
        text.textContent = explanation;
    },
};
