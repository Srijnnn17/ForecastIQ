/**
 * Forecast tab logic for ForecastIQ.
 * Generates short-term forecasts with confidence intervals
 * and trend decomposition.
 */

const ForecastTab = {
    /**
     * Initialize the forecast tab event listeners.
     */
    init() {
        const btnForecast = document.getElementById('btn-forecast');
        if (btnForecast) {
            btnForecast.addEventListener('click', () => this.runForecast());
        }
    },

    /**
     * Run the forecast analysis using the selected dataset and parameters.
     */
    async runForecast() {
        const dataset = document.getElementById('dataset-select').value;
        const column = document.getElementById('column-select').value;
        const horizon = parseInt(document.getElementById('forecast-horizon').value);
        const confidence = parseFloat(document.getElementById('forecast-confidence').value);

        if (!dataset) {
            App.showToast('Please select a dataset first', 'warning');
            return;
        }

        App.showLoading('Generating forecast...');

        try {
            const response = await API.generateForecast({
                dataset,
                value_column: column || undefined,
                horizon,
                confidence,
            });

            const data = response.data;
            this.lastData = data;
            ExportModule.lastForecastData = data;

            this.renderChart(data);
            this.renderInsights(data);
            this.renderExplanation(data.explanation);

            // Check alert threshold
            const threshold = document.getElementById('forecast-threshold')?.value;
            ThresholdAlert.check(data, threshold);

            App.showToast('Forecast generated successfully', 'success');
        } catch (error) {
            App.showToast(error.message, 'error');
        } finally {
            App.hideLoading();
        }
    },

    /**
     * Render the forecast chart with historical data and predictions.
     * @param {Object} data - Forecast response data
     */
    renderChart(data) {
        const placeholder = document.getElementById('forecast-placeholder');
        if (placeholder) placeholder.style.display = 'none';

        const historicalDates = data.historical.dates;
        const forecastDates = data.forecast.dates;
        const allDates = [...historicalDates, ...forecastDates];

        const historicalValues = data.historical.values;
        const forecastValues = new Array(historicalDates.length).fill(null).concat(data.forecast.values);

        // Connect historical to forecast with last historical point
        const forecastLine = [...forecastValues];
        forecastLine[historicalDates.length - 1] = historicalValues[historicalValues.length - 1];

        const upperBound = new Array(historicalDates.length).fill(null).concat(data.forecast.upper_bound);
        const lowerBound = new Array(historicalDates.length).fill(null).concat(data.forecast.lower_bound);

        // Connect bounds at the junction
        upperBound[historicalDates.length - 1] = historicalValues[historicalValues.length - 1];
        lowerBound[historicalDates.length - 1] = historicalValues[historicalValues.length - 1];

        const config = {
            type: 'line',
            data: {
                labels: allDates,
                datasets: [
                    {
                        label: 'Historical',
                        data: historicalValues.concat(new Array(forecastDates.length).fill(null)),
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
                        label: 'Forecast',
                        data: forecastLine,
                        borderColor: Charts.colors.success,
                        backgroundColor: 'transparent',
                        borderWidth: 2.5,
                        borderDash: [6, 4],
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        pointBackgroundColor: Charts.colors.success,
                        tension: 0.3,
                        fill: false,
                        order: 0,
                    },
                    {
                        label: 'Upper Bound',
                        data: upperBound,
                        borderColor: 'transparent',
                        backgroundColor: Charts.colors.successLight,
                        fill: '+1',
                        pointRadius: 0,
                        tension: 0.3,
                        order: 5,
                    },
                    {
                        label: 'Lower Bound',
                        data: lowerBound,
                        borderColor: 'transparent',
                        backgroundColor: 'transparent',
                        fill: false,
                        pointRadius: 0,
                        tension: 0.3,
                        order: 5,
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
                                return !item.text.includes('Bound');
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
                                label: {
                                    display: true,
                                    content: 'Forecast start',
                                    position: 'start',
                                    color: '#a1a1aa',
                                    font: { size: 10, family: 'Space Grotesk' },
                                    backgroundColor: 'transparent',
                                },
                            },
                        },
                    },
                },
            },
        };

        Charts.createChart('forecast-chart', config);
    },

    /**
     * Render the insight cards below the chart.
     * @param {Object} data - Forecast response data
     */
    renderInsights(data) {
        const insightsRow = document.getElementById('forecast-insights');
        insightsRow.style.display = 'grid';

        // Trend direction
        const forecast = data.forecast.values;
        const firstVal = forecast[0];
        const lastVal = forecast[forecast.length - 1];
        const growthPct = ((lastVal - firstVal) / firstVal * 100);
        const trendEl = document.getElementById('insight-trend');
        const arrowUp = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>';
        const arrowDown = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>';
        const dash = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>';
        if (growthPct > 1) {
            trendEl.innerHTML = `${arrowUp}<span>Growth +${growthPct.toFixed(1)}%</span>`;
            trendEl.style.color = Charts.colors.success;
        } else if (growthPct < -1) {
            trendEl.innerHTML = `${arrowDown}<span>Decline ${growthPct.toFixed(1)}%</span>`;
            trendEl.style.color = Charts.colors.danger;
        } else {
            trendEl.innerHTML = `${dash}<span>Stable</span>`;
            trendEl.style.color = Charts.colors.info;
        }

        // Expected range
        const minLower = Math.min(...data.forecast.lower_bound);
        const maxUpper = Math.max(...data.forecast.upper_bound);
        document.getElementById('insight-range').textContent =
            `${Charts.formatNumber(minLower)} – ${Charts.formatNumber(maxUpper)}`;

        // Model accuracy
        const mape = data.model_summary.mape;
        const accuracyEl = document.getElementById('insight-accuracy');
        accuracyEl.textContent = `MAPE: ${mape}%`;
        if (mape < 5) {
            accuracyEl.style.color = Charts.colors.success;
        } else if (mape < 15) {
            accuracyEl.style.color = Charts.colors.warning;
        } else {
            accuracyEl.style.color = Charts.colors.danger;
        }

        // Baseline comparison
        const baseline = data.baseline_comparison;
        const baselineEl = document.getElementById('insight-baseline');
        if (baseline.model_beats_baseline) {
            baselineEl.textContent = 'Outperforms baseline';
            baselineEl.style.color = Charts.colors.success;
        } else {
            baselineEl.textContent = `Best: ${baseline.best_method}`;
            baselineEl.style.color = Charts.colors.warning;
        }
    },

    /**
     * Render the AI explanation card.
     * @param {string} explanation - AI-generated explanation text
     */
    renderExplanation(explanation) {
        const card = document.getElementById('forecast-explanation');
        const text = document.getElementById('forecast-explanation-text');
        card.style.display = 'block';
        text.textContent = explanation;
    },
};
