/**
 * Scenario comparison tab logic for ForecastIQ.
 * Tests what-if scenarios with adjustable growth rates,
 * outlier removal, and pattern changes.
 */

const ScenarioTab = {
    /**
     * Initialize the scenario tab event listeners.
     */
    init() {
        const btnScenario = document.getElementById('btn-scenario');
        if (btnScenario) {
            btnScenario.addEventListener('click', () => this.runComparison());
        }

        // Growth slider value display
        const growthSlider = document.getElementById('scenario-growth');
        const growthValueEl = document.getElementById('growth-value');
        if (growthSlider && growthValueEl) {
            growthSlider.addEventListener('input', (e) => {
                const val = parseInt(e.target.value);
                growthValueEl.textContent = `${val >= 0 ? '+' : ''}${val}%`;
            });
        }
    },

    /**
     * Run the scenario comparison analysis.
     */
    async runComparison() {
        const dataset = document.getElementById('dataset-select').value;
        const column = document.getElementById('column-select').value;
        const horizon = parseInt(document.getElementById('scenario-horizon').value);
        const growth = parseInt(document.getElementById('scenario-growth').value);
        const pattern = document.getElementById('scenario-pattern').value;
        const removeOutliers = document.getElementById('scenario-outliers').checked;

        if (!dataset) {
            App.showToast('Please select a dataset first', 'warning');
            return;
        }

        App.showLoading('Comparing scenarios...');

        try {
            const response = await API.compareScenarios({
                dataset,
                value_column: column || undefined,
                horizon,
                growth_adjustment: growth,
                pattern,
                remove_outliers: removeOutliers,
            });

            const data = response.data;
            this.renderChart(data);
            this.renderComparison(data);
            this.renderExplanation(data.explanation);

            App.showToast('Scenario comparison completed', 'success');
        } catch (error) {
            App.showToast(error.message, 'error');
        } finally {
            App.hideLoading();
        }
    },

    /**
     * Render the scenario comparison chart.
     * @param {Object} data - Scenario comparison response data
     */
    renderChart(data) {
        const placeholder = document.getElementById('scenario-placeholder');
        if (placeholder) placeholder.style.display = 'none';

        const historicalDates = data.historical_dates;
        const forecastDates = data.forecast_dates;
        const allDates = [...historicalDates, ...forecastDates];

        const baseline = data.baseline;
        const scenario = data.scenarios[1] || data.scenarios[0]; // Custom scenario

        // Historical data
        const historicalValues = baseline.original_data.concat(
            new Array(forecastDates.length).fill(null)
        );

        // Baseline forecast
        const baselineForecast = new Array(historicalDates.length).fill(null).concat(baseline.forecast);
        baselineForecast[historicalDates.length - 1] = baseline.original_data[baseline.original_data.length - 1];

        // Scenario forecast
        const scenarioForecast = new Array(historicalDates.length).fill(null).concat(scenario.forecast);
        scenarioForecast[historicalDates.length - 1] = baseline.original_data[baseline.original_data.length - 1];

        // Baseline bounds
        const baselineUpper = new Array(historicalDates.length).fill(null).concat(baseline.upper_bound);
        const baselineLower = new Array(historicalDates.length).fill(null).concat(baseline.lower_bound);

        // Scenario bounds
        const scenarioUpper = new Array(historicalDates.length).fill(null).concat(scenario.upper_bound);
        const scenarioLower = new Array(historicalDates.length).fill(null).concat(scenario.lower_bound);

        const config = {
            type: 'line',
            data: {
                labels: allDates,
                datasets: [
                    {
                        label: 'Historical',
                        data: historicalValues,
                        borderColor: Charts.colors.primary,
                        backgroundColor: Charts.colors.primaryLight,
                        borderWidth: 2,
                        pointRadius: 2,
                        tension: 0.3,
                        fill: true,
                        order: 2,
                    },
                    {
                        label: 'Baseline Forecast',
                        data: baselineForecast,
                        borderColor: Charts.colors.info,
                        backgroundColor: 'transparent',
                        borderWidth: 2.5,
                        borderDash: [6, 4],
                        pointRadius: 4,
                        pointBackgroundColor: Charts.colors.info,
                        tension: 0.3,
                        order: 1,
                    },
                    {
                        label: scenario.name || 'Custom Scenario',
                        data: scenarioForecast,
                        borderColor: Charts.colors.secondary,
                        backgroundColor: 'transparent',
                        borderWidth: 2.5,
                        borderDash: [6, 4],
                        pointRadius: 4,
                        pointBackgroundColor: Charts.colors.secondary,
                        tension: 0.3,
                        order: 0,
                    },
                    // Baseline confidence band
                    {
                        label: 'Baseline Upper',
                        data: baselineUpper,
                        borderColor: 'transparent',
                        backgroundColor: Charts.colors.infoLight,
                        fill: '+1',
                        pointRadius: 0,
                        tension: 0.3,
                        order: 10,
                    },
                    {
                        label: 'Baseline Lower',
                        data: baselineLower,
                        borderColor: 'transparent',
                        backgroundColor: 'transparent',
                        fill: false,
                        pointRadius: 0,
                        tension: 0.3,
                        order: 10,
                    },
                    // Scenario confidence band
                    {
                        label: 'Scenario Upper',
                        data: scenarioUpper,
                        borderColor: 'transparent',
                        backgroundColor: Charts.colors.secondaryLight,
                        fill: '+1',
                        pointRadius: 0,
                        tension: 0.3,
                        order: 10,
                    },
                    {
                        label: 'Scenario Lower',
                        data: scenarioLower,
                        borderColor: 'transparent',
                        backgroundColor: 'transparent',
                        fill: false,
                        pointRadius: 0,
                        tension: 0.3,
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
                                return !item.text.includes('Upper') && !item.text.includes('Lower');
                            },
                        },
                    },
                    annotation: {
                        annotations: {
                            forecastLine: {
                                type: 'line',
                                xMin: historicalDates.length - 1,
                                xMax: historicalDates.length - 1,
                                borderColor: 'rgba(255,255,255,0.15)',
                                borderWidth: 1,
                                borderDash: [4, 4],
                            },
                        },
                    },
                },
            },
        };

        Charts.createChart('scenario-chart', config);
    },

    /**
     * Render the comparison cards.
     * @param {Object} data - Scenario comparison response data
     */
    renderComparison(data) {
        const container = document.getElementById('scenario-comparison');
        const cardsContainer = document.getElementById('comparison-cards');
        container.style.display = 'block';
        cardsContainer.innerHTML = '';

        const comparison = data.comparison;

        // Baseline card
        const baselineCard = this._createComparisonCard(
            'Baseline (Actual Data)',
            comparison.baseline_total,
            comparison.baseline_avg,
            0,
            'neutral'
        );
        cardsContainer.appendChild(baselineCard);

        // Scenario cards — skip any named "Baseline" (already rendered above)
        comparison.scenarios.forEach(scenario => {
            if ((scenario.name || '').toLowerCase() === 'baseline') return;
            const type = scenario.difference_pct > 0 ? 'positive' :
                         scenario.difference_pct < 0 ? 'negative' : 'neutral';
            const card = this._createComparisonCard(
                scenario.name,
                scenario.total_forecast,
                scenario.avg_forecast,
                scenario.difference_pct,
                type
            );
            cardsContainer.appendChild(card);
        });
    },

    /**
     * Create a comparison card element.
     * @private
     */
    _createComparisonCard(name, total, avg, diffPct, type) {
        const card = document.createElement('div');
        card.className = 'comparison-card';

        const badgeText = diffPct === 0 ? 'Baseline' :
                          `${diffPct > 0 ? '+' : ''}${diffPct.toFixed(1)}%`;

        card.innerHTML = `
            <div class="comparison-card-header">
                <span class="comparison-card-title">${name}</span>
                <span class="comparison-card-badge ${type}">${badgeText}</span>
            </div>
            <div class="comparison-card-stats">
                <div class="comparison-card-stat">
                    <span class="label">Total Forecast</span>
                    <span class="value">${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                </div>
                <div class="comparison-card-stat">
                    <span class="label">Avg per Period</span>
                    <span class="value">${avg.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                </div>
            </div>
        `;

        return card;
    },

    /**
     * Render the AI explanation card.
     * @param {string} explanation - AI-generated explanation
     */
    renderExplanation(explanation) {
        const card = document.getElementById('scenario-explanation');
        const text = document.getElementById('scenario-explanation-text');
        card.style.display = 'block';
        text.textContent = explanation;
    },
};
