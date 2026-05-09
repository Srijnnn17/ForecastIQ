/**
 * Export module for ForecastIQ.
 * CSV download and data quality rendering.
 */

const ExportModule = {
    lastForecastData: null,
    lastAnomalyData: null,

    /**
     * Download forecast results as a CSV file.
     * @param {Object} data - Forecast response from the API
     */
    downloadForecastCSV(data) {
        if (!data) { App.showToast('Generate a forecast first', 'warning'); return; }

        const rows = [['Date', 'Forecast', 'Lower_Bound', 'Upper_Bound', 'Type']];
        // Historical fitted
        data.historical.dates.forEach((d, i) => {
            rows.push([d, data.historical.fitted[i]?.toFixed(2) ?? '', '', '', 'historical_fitted']);
        });
        // Forecast
        data.forecast.dates.forEach((d, i) => {
            rows.push([
                d,
                data.forecast.values[i]?.toFixed(2),
                data.forecast.lower_bound[i]?.toFixed(2),
                data.forecast.upper_bound[i]?.toFixed(2),
                'forecast',
            ]);
        });
        this._triggerDownload(rows, 'forecastiq_forecast.csv');
        App.showToast('Forecast CSV downloaded', 'success');
    },

    /**
     * Download anomaly detection results as CSV.
     * @param {Object} data - Anomaly response from the API
     */
    downloadAnomalyCSV(data) {
        if (!data) { App.showToast('Run anomaly detection first', 'warning'); return; }

        const rows = [['Date', 'Value', 'Severity', 'Direction', 'Deviation_Pct']];
        data.anomalies.forEach(a => {
            rows.push([a.date, a.value, a.severity, a.direction, a.deviation_pct]);
        });
        this._triggerDownload(rows, 'forecastiq_anomalies.csv');
        App.showToast('Anomalies CSV downloaded', 'success');
    },

    _triggerDownload(rows, filename) {
        const csv = rows.map(r => r.join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url  = URL.createObjectURL(blob);
        const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },
};

/**
 * Data Quality display module.
 */
const DataQuality = {
    async load(dataset, column) {
        if (!dataset) return;
        try {
            const res = await API.request('/api/data-quality', {
                method: 'POST',
                body: JSON.stringify({ dataset, value_column: column || undefined }),
            });
            this.render(res.data);
        } catch (e) {
            console.warn('Data quality check failed:', e.message);
        }
    },

    render(data) {
        const card = document.getElementById('data-health-card');
        if (!card) return;
        card.style.display = 'flex';

        const gradeColors = { success: 'var(--success)', info: 'var(--info)', warning: 'var(--warning)', danger: 'var(--danger)' };
        const color = gradeColors[data.grade_color] || 'var(--text-secondary)';

        document.getElementById('health-grade').textContent = data.grade;
        document.getElementById('health-grade').style.color = color;
        document.getElementById('health-score').textContent = `${data.health_score}/100`;
        document.getElementById('health-points').textContent = `${data.data_points} records`;
        document.getElementById('health-completeness').textContent = `${data.completeness}%`;
        document.getElementById('health-seasonality').textContent = `${data.seasonality_strength}%`;
        document.getElementById('health-model').textContent = data.recommended_model;

        // Warnings
        const warnEl = document.getElementById('health-warnings');
        warnEl.innerHTML = '';
        const alertSvg = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
        (data.warnings || []).forEach(w => {
            const p = document.createElement('p');
            p.className = 'health-warning';
            p.innerHTML = alertSvg;
            const span = document.createElement('span');
            span.textContent = `Warning: ${w}`;
            p.appendChild(span);
            warnEl.appendChild(p);
        });

        // AI Agent: apply recommended parameters if present
        if (data.recommended_horizon && data.recommended_confidence) {
            this.applyAgentParams(data);
        }
    },

    /**
     * AI Agent: programmatically set forecast dropdowns and notify the user.
     *
     * Uses _setSelectNearest() so that if the agent recommends a value that
     * has no exact <option> (e.g. horizon=14 when the dropdown only has 12),
     * it snaps to the closest available option instead of leaving it blank.
     *
     * @param {Object} data - Data quality API response containing agent recommendations
     */
    applyAgentParams(data) {
        const horizonSelect    = document.getElementById('forecast-horizon');
        const confidenceSelect = document.getElementById('forecast-confidence');
        const scenarioHorizon  = document.getElementById('scenario-horizon');

        // Snap to nearest valid option — never leaves the dropdown blank
        const actualHorizon    = horizonSelect    ? this._setSelectNearest(horizonSelect,    data.recommended_horizon)    : data.recommended_horizon;
        const actualConfidence = confidenceSelect ? this._setSelectNearest(confidenceSelect, data.recommended_confidence) : data.recommended_confidence;

        if (horizonSelect)    this._markAgentSet(horizonSelect,    'horizon');
        if (confidenceSelect) this._markAgentSet(confidenceSelect, 'confidence');

        // Sync the Scenarios tab horizon too
        if (scenarioHorizon) this._setSelectNearest(scenarioHorizon, data.recommended_horizon);

        // Build the toast with the values that were *actually* applied
        const horizonLabel    = `${actualHorizon} periods`;
        const confidenceLabel = `${Math.round(actualConfidence * 100)}% confidence`;
        App.showToast(`🤖 AI Agent configured: ${horizonLabel} · ${confidenceLabel}`, 'info');

        // Log rationale to console for transparency / judge demo
        console.group('🤖 AI Agent — Parameter Rationale');
        console.log('Horizon recommended :', data.recommended_horizon, '→ applied:', actualHorizon);
        console.log('Confidence recommended:', data.recommended_confidence, '→ applied:', actualConfidence);
        console.log('Horizon rationale  :', data.horizon_rationale);
        console.log('Confidence rationale:', data.confidence_rationale);
        console.log('Volatility (CV)    :', data.coefficient_of_variation + '%');
        console.groupEnd();
    },

    /**
     * Set a <select> to the option whose numeric value is closest to `target`.
     * Falls back gracefully: if the select has no options, does nothing.
     *
     * @param {HTMLSelectElement} selectEl - The dropdown to update
     * @param {number} target             - The ideal numeric value to set
     * @returns {number} The numeric value of the option that was actually selected
     */
    _setSelectNearest(selectEl, target) {
        const options = Array.from(selectEl.options);
        if (options.length === 0) return target;

        // Parse each option's numeric value and find the closest one
        let best = options[0];
        let bestDist = Math.abs(parseFloat(options[0].value) - target);

        options.forEach(opt => {
            const dist = Math.abs(parseFloat(opt.value) - target);
            if (dist < bestDist) {
                bestDist = dist;
                best = opt;
            }
        });

        selectEl.value = best.value;
        return parseFloat(best.value);
    },

    /**
     * Attach / refresh an "AI" badge next to a select element.
     * Removes any existing badge first so we don't stack them on re-load.
     * @param {HTMLSelectElement} selectEl - The target dropdown
     * @param {string} id - Unique ID suffix for the badge element
     */
    _markAgentSet(selectEl, id) {
        const existingBadge = document.getElementById(`agent-badge-${id}`);
        if (existingBadge) existingBadge.remove();

        const badge = document.createElement('span');
        badge.id = `agent-badge-${id}`;
        badge.className = 'agent-badge';
        badge.innerHTML = '🤖 auto';
        badge.title = 'Set automatically by the AI Agent based on your dataset';

        // Insert after the select element
        selectEl.parentNode.insertBefore(badge, selectEl.nextSibling);
    },
};

/**
 * Alert threshold module — frontend-only warning banner.
 */
const ThresholdAlert = {
    check(forecastData, threshold) {
        const banner = document.getElementById('threshold-banner');
        if (!banner || !forecastData || !threshold) {
            if (banner) banner.style.display = 'none';
            return;
        }
        const thresholdVal = parseFloat(threshold);
        if (isNaN(thresholdVal)) { banner.style.display = 'none'; return; }

        const lower = forecastData.forecast?.lower_bound || [];
        const dates = forecastData.forecast?.dates || [];
        const breaches = lower
            .map((v, i) => ({ val: v, date: dates[i] }))
            .filter(x => x.val < thresholdVal);

        if (breaches.length > 0) {
            banner.style.display = 'flex';
            const alertSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
            const msg = `Early Warning: forecast lower bound drops below ${thresholdVal.toLocaleString()} in ${breaches.length} period(s) — earliest: ${breaches[0].date}`;
            const span = document.getElementById('threshold-text');
            span.innerHTML = alertSvg;
            const text = document.createElement('span');
            text.textContent = msg;
            span.appendChild(text);
        } else {
            banner.style.display = 'none';
        }
    },
};
