/**
 * API client module for ForecastIQ.
 * 
 * Provides a centralized interface for all backend API calls
 * with error handling and response parsing.
 */

const API = {
    BASE_URL: window.location.origin,

    /**
     * Make an HTTP request to the backend API.
     * @param {string} endpoint - API endpoint path (e.g. '/api/forecast')
     * @param {Object} options - Fetch options
     * @returns {Promise<Object>} Parsed JSON response
     */
    async request(endpoint, options = {}) {
        const url = `${this.BASE_URL}${endpoint}`;
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
            },
        };

        const mergedOptions = { ...defaultOptions, ...options };

        try {
            const response = await fetch(url, mergedOptions);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || `Request failed with status ${response.status}`);
            }

            return data;
        } catch (error) {
            if (error.message === 'Failed to fetch') {
                throw new Error('Cannot connect to the server. Please ensure the backend is running.');
            }
            throw error;
        }
    },

    /**
     * Fetch the list of available datasets.
     * @returns {Promise<Object>} Response with dataset list
     */
    async getDatasets() {
        return this.request('/api/datasets');
    },

    /**
     * Fetch summary information for a specific dataset.
     * @param {string} filename - Dataset filename
     * @returns {Promise<Object>} Dataset summary
     */
    async getDatasetSummary(filename) {
        return this.request(`/api/datasets/${encodeURIComponent(filename)}/summary`);
    },

    /**
     * Fetch a preview of dataset rows.
     * @param {string} filename - Dataset filename
     * @returns {Promise<Object>} Dataset preview data
     */
    async getDatasetPreview(filename) {
        return this.request(`/api/datasets/${encodeURIComponent(filename)}/preview`);
    },

    /**
     * Generate a forecast for the selected dataset.
     * @param {Object} params - Forecast parameters
     * @param {string} params.dataset - Dataset filename
     * @param {string} [params.value_column] - Column to forecast
     * @param {number} [params.horizon] - Forecast horizon (periods)
     * @param {number} [params.confidence] - Confidence level
     * @returns {Promise<Object>} Forecast results
     */
    async generateForecast(params) {
        return this.request('/api/forecast', {
            method: 'POST',
            body: JSON.stringify({ ...params, language: LangPicker.get() }),
        });
    },

    /**
     * Detect anomalies in the selected dataset.
     * @param {Object} params - Anomaly detection parameters
     * @param {string} params.dataset - Dataset filename
     * @param {string} [params.value_column] - Column to analyze
     * @param {number} [params.sensitivity] - Detection sensitivity (1-5)
     * @returns {Promise<Object>} Anomaly detection results
     */
    async detectAnomalies(params) {
        return this.request('/api/anomalies', {
            method: 'POST',
            body: JSON.stringify({ ...params, language: LangPicker.get() }),
        });
    },

    /**
     * Compare forecast scenarios.
     * @param {Object} params - Scenario parameters
     * @returns {Promise<Object>} Scenario comparison results
     */
    async compareScenarios(params) {
        return this.request('/api/scenarios', {
            method: 'POST',
            body: JSON.stringify({ ...params, language: LangPicker.get() }),
        });
    },

    /**
     * Upload a CSV dataset file.
     * @param {File} file - CSV file to upload
     * @returns {Promise<Object>} Upload result with dataset summary
     */
    async uploadDataset(file) {
        const formData = new FormData();
        formData.append('file', file);

        return this.request('/api/datasets/upload', {
            method: 'POST',
            headers: {},  // Let browser set multipart boundary
            body: formData,
        });
    },
};
