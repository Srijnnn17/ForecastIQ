/**
 * Chart rendering utilities for ForecastIQ.
 * 
 * Provides reusable chart configurations and helpers
 * for rendering time-series data with Chart.js.
 */

const Charts = {
    /** Store chart instances for cleanup */
    instances: {},

    /** Shared color palette — refined blue on warm grey, mirrors CSS tokens */
    colors: {
        primary: '#60a5fa',
        primaryLight: 'rgba(96, 165, 250, 0.14)',
        secondary: '#2563eb',
        secondaryLight: 'rgba(37, 99, 235, 0.14)',
        success: '#34d399',
        successLight: 'rgba(52, 211, 153, 0.14)',
        warning: '#fbbf24',
        warningLight: 'rgba(251, 191, 36, 0.14)',
        danger: '#f87171',
        dangerLight: 'rgba(248, 113, 113, 0.14)',
        info: '#60a5fa',
        infoLight: 'rgba(96, 165, 250, 0.14)',
        cyan: '#22d3ee',
        cyanLight: 'rgba(34, 211, 238, 0.14)',
        grid: 'rgba(255, 255, 255, 0.04)',
        gridLabel: 'rgba(255, 255, 255, 0.45)',
        tooltip: 'rgba(22, 22, 25, 0.96)',
    },

    /**
     * Get default chart options for a dark-themed time series chart.
     * @param {string} title - Chart title
     * @returns {Object} Chart.js options
     */
    getDefaultOptions(title = '') {
        return {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                title: {
                    display: !!title,
                    text: title,
                    color: '#f4f4f5',
                    font: { size: 14, weight: '600', family: 'Space Grotesk' },
                    padding: { bottom: 16 },
                },
                legend: {
                    position: 'top',
                    align: 'end',
                    labels: {
                        color: '#a1a1aa',
                        font: { size: 12, family: 'Space Grotesk' },
                        usePointStyle: true,
                        pointStyle: 'circle',
                        padding: 16,
                    },
                },
                tooltip: {
                    backgroundColor: this.colors.tooltip,
                    titleColor: '#f4f4f5',
                    bodyColor: '#a1a1aa',
                    borderColor: 'rgba(255,255,255,0.08)',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 6,
                    titleFont: { size: 13, weight: '600', family: 'Space Grotesk' },
                    bodyFont: { size: 12, family: 'Space Mono' },
                    displayColors: true,
                    callbacks: {
                        label: function(context) {
                            const label = context.dataset.label || '';
                            const value = context.parsed.y;
                            if (value !== null && value !== undefined) {
                                return `${label}: ${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}`;
                            }
                            return label;
                        },
                    },
                },
            },
            scales: {
                x: {
                    grid: { display: false, drawBorder: false },
                    ticks: {
                        color: this.colors.gridLabel,
                        font: { size: 11, family: 'Space Mono' },
                        maxRotation: 45,
                        maxTicksLimit: 15,
                    },
                },
                y: {
                    grid: { color: this.colors.grid, drawBorder: false },
                    ticks: {
                        color: this.colors.gridLabel,
                        font: { size: 11, family: 'Space Mono' },
                        callback: function(value) {
                            return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
                        },
                    },
                },
            },
            animation: {
                duration: 800,
                easing: 'easeOutQuart',
            },
        };
    },

    /**
     * Create or update a chart instance.
     * @param {string} canvasId - Canvas element ID
     * @param {Object} config - Chart.js configuration
     * @returns {Chart} Chart instance
     */
    createChart(canvasId, config) {
        // Destroy existing chart on same canvas
        if (this.instances[canvasId]) {
            this.instances[canvasId].destroy();
        }

        const canvas = document.getElementById(canvasId);
        if (!canvas) {
            console.error(`Canvas element #${canvasId} not found`);
            return null;
        }

        canvas.style.display = 'block';
        const chart = new Chart(canvas.getContext('2d'), config);
        this.instances[canvasId] = chart;
        return chart;
    },

    /**
     * Create a confidence band (filled area) dataset.
     * @param {string} label - Dataset label
     * @param {Array<number>} upperData - Upper bound values
     * @param {Array<number>} lowerData - Lower bound values
     * @param {string} color - Fill color (with alpha)
     * @param {number} startIndex - Index where the band starts
     * @param {number} totalLength - Total number of data points
     * @returns {Array<Object>} Two datasets forming the band
     */
    createConfidenceBand(label, upperData, lowerData, color, startIndex, totalLength) {
        const upperFull = new Array(startIndex).fill(null).concat(upperData);
        const lowerFull = new Array(startIndex).fill(null).concat(lowerData);

        return [
            {
                label: `${label} (Upper)`,
                data: upperFull,
                borderColor: 'transparent',
                backgroundColor: color,
                fill: '+1',
                pointRadius: 0,
                tension: 0.3,
                order: 10,
            },
            {
                label: `${label} (Lower)`,
                data: lowerFull,
                borderColor: 'transparent',
                backgroundColor: 'transparent',
                fill: false,
                pointRadius: 0,
                tension: 0.3,
                order: 10,
            },
        ];
    },

    /**
     * Format a number for display in charts.
     * @param {number} value - Number to format
     * @param {number} decimals - Decimal places
     * @returns {string} Formatted number
     */
    formatNumber(value, decimals = 1) {
        if (value === null || value === undefined) return '—';
        if (Math.abs(value) >= 1e6) return (value / 1e6).toFixed(decimals) + 'M';
        if (Math.abs(value) >= 1e3) return (value / 1e3).toFixed(decimals) + 'K';
        return value.toFixed(decimals);
    },

    /**
     * Destroy a chart instance.
     * @param {string} canvasId - Canvas element ID
     */
    destroyChart(canvasId) {
        if (this.instances[canvasId]) {
            this.instances[canvasId].destroy();
            delete this.instances[canvasId];
        }
    },
};
