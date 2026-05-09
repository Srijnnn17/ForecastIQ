/**
 * Main application controller for ForecastIQ.
 * 
 * Initializes tabs, dataset selection, file upload,
 * and provides shared utility functions (toasts, loading).
 */

const App = {
    /** Currently selected dataset name */
    currentDataset: null,

    /**
     * Initialize the application.
     */
    init() {
        this.initTabs();
        this.initUpload();
        this.loadDatasets();

        // Initialize all tab modules
        ForecastTab.init();
        AnomalyTab.init();
        ScenarioTab.init();
        BacktestModule.init();
        ModelRace.init();
        if (typeof initNewsAgents === 'function') initNewsAgents();

        // Export buttons
        document.getElementById('btn-export-anomalies')?.addEventListener('click', () => {
            ExportModule.downloadAnomalyCSV(AnomalyTab.lastData);
        });
        document.getElementById('btn-export-forecast')?.addEventListener('click', () => {
            ExportModule.downloadForecastCSV(ExportModule.lastForecastData);
        });

        // Threshold banner dismiss
        document.getElementById('threshold-dismiss')?.addEventListener('click', () => {
            document.getElementById('threshold-banner').style.display = 'none';
        });

        // Dataset change handler
        document.getElementById('dataset-select').addEventListener('change', (e) => {
            this.onDatasetChange(e.target.value);
        });

        // Backtest / Model Race architecture modal
        const btArchModal = document.getElementById('backtest-arch-modal');
        const openBtArch = (e) => {
            if (btArchModal) {
                btArchModal.style.display = 'flex';
                requestAnimationFrame(() => btArchModal.classList.add('modal-visible'));
            }
        };
        document.getElementById('btn-backtest-arch')?.addEventListener('click', openBtArch);
        document.getElementById('btn-model-arch')?.addEventListener('click', openBtArch);
        document.getElementById('btn-btarch-close')?.addEventListener('click', () => {
            btArchModal?.classList.remove('modal-visible');
            setTimeout(() => { if (btArchModal) btArchModal.style.display = 'none'; }, 300);
        });
        btArchModal?.addEventListener('click', (e) => {
            if (e.target === btArchModal) {
                btArchModal.classList.remove('modal-visible');
                setTimeout(() => { btArchModal.style.display = 'none'; }, 300);
            }
        });
    },

    /**
     * Initialize tab navigation.
     */
    initTabs() {
        const tabs = document.querySelectorAll('.nav-tab');
        const panels = document.querySelectorAll('.tab-panel');

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const targetTab = tab.dataset.tab;

                tabs.forEach(t => t.classList.remove('active'));
                panels.forEach(p => p.classList.remove('active'));

                tab.classList.add('active');
                const panel = document.getElementById(`panel-${targetTab}`);
                if (panel) panel.classList.add('active');
            });
        });
    },

    /**
     * Initialize file upload functionality.
     */
    initUpload() {
        const btnUpload = document.getElementById('btn-upload');
        const modal = document.getElementById('upload-modal');
        const btnClose = document.getElementById('btn-close-modal');
        const uploadZone = document.getElementById('upload-zone');
        const fileInput = document.getElementById('file-input');

        // Open modal
        btnUpload.addEventListener('click', () => {
            modal.style.display = 'flex';
        });

        // Close modal
        btnClose.addEventListener('click', () => {
            modal.style.display = 'none';
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.style.display = 'none';
        });

        // Click to browse
        uploadZone.addEventListener('click', () => fileInput.click());

        // File selected
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleFileUpload(e.target.files[0]);
            }
        });

        // Drag & drop
        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('drag-over');
        });

        uploadZone.addEventListener('dragleave', () => {
            uploadZone.classList.remove('drag-over');
        });

        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('drag-over');
            if (e.dataTransfer.files.length > 0) {
                this.handleFileUpload(e.dataTransfer.files[0]);
            }
        });
    },

    /**
     * Handle file upload.
     * @param {File} file - The CSV file to upload
     */
    async handleFileUpload(file) {
        if (!file.name.endsWith('.csv')) {
            this.showToast('Please upload a CSV file', 'error');
            return;
        }

        const statusEl = document.getElementById('upload-status');
        const messageEl = document.getElementById('upload-message');
        statusEl.style.display = 'block';
        messageEl.textContent = `Uploading ${file.name}...`;

        try {
            const response = await API.uploadDataset(file);
            messageEl.textContent = `${file.name} uploaded (${response.data.rows} rows)`;
            this.showToast(`Dataset "${file.name}" uploaded successfully`, 'success');

            // Refresh dataset list
            await this.loadDatasets();

            // Select the new dataset
            const select = document.getElementById('dataset-select');
            select.value = response.data.filename;
            this.onDatasetChange(response.data.filename);

            // Close modal after delay
            setTimeout(() => {
                document.getElementById('upload-modal').style.display = 'none';
                statusEl.style.display = 'none';
            }, 1500);
        } catch (error) {
            messageEl.textContent = `Upload failed: ${error.message}`;
            this.showToast(error.message, 'error');
        }
    },

    /**
     * Load available datasets from the backend.
     */
    async loadDatasets() {
        const select = document.getElementById('dataset-select');

        try {
            const response = await API.getDatasets();
            const datasets = response.data;

            select.innerHTML = '<option value="">— Select a dataset —</option>';

            if (datasets.length === 0) {
                select.innerHTML += '<option value="" disabled>No datasets available</option>';
                return;
            }

            // Group by source
            const samples = datasets.filter(d => d.source === 'sample');
            const uploaded = datasets.filter(d => d.source === 'uploaded');

            if (samples.length > 0) {
                const group = document.createElement('optgroup');
                group.label = 'Sample Datasets';
                samples.forEach(ds => {
                    const option = document.createElement('option');
                    option.value = ds.name;
                    option.textContent = `${ds.name} (${ds.size_kb} KB)`;
                    group.appendChild(option);
                });
                select.appendChild(group);
            }

            if (uploaded.length > 0) {
                const group = document.createElement('optgroup');
                group.label = 'Uploaded';
                uploaded.forEach(ds => {
                    const option = document.createElement('option');
                    option.value = ds.name;
                    option.textContent = `${ds.name} (${ds.size_kb} KB)`;
                    group.appendChild(option);
                });
                select.appendChild(group);
            }

            // Auto-select first dataset if none selected
            if (!this.currentDataset && datasets.length > 0) {
                select.value = datasets[0].name;
                this.onDatasetChange(datasets[0].name);
            }
        } catch (error) {
            select.innerHTML = '<option value="">Failed to load datasets</option>';
            console.error('Failed to load datasets:', error);
        }
    },

    /**
     * Handle dataset selection change.
     * @param {string} datasetName - Selected dataset filename
     */
    async onDatasetChange(datasetName) {
        if (!datasetName) return;
        this.currentDataset = datasetName;

        try {
            const response = await API.getDatasetSummary(datasetName);
            const summary = response.data;

            // Update column selector
            const columnSelect = document.getElementById('column-select');
            columnSelect.innerHTML = '';
            if (summary.numeric_columns && summary.numeric_columns.length > 0) {
                summary.numeric_columns.forEach((col, idx) => {
                    const option = document.createElement('option');
                    option.value = col;
                    option.textContent = col;
                    if (idx === 0) option.selected = true;
                    columnSelect.appendChild(option);
                });
            }

            document.getElementById('data-points-badge').textContent = `${summary.rows} records`;
            if (summary.date_range) {
                document.getElementById('date-range-badge').textContent =
                    `${summary.date_range.start} to ${summary.date_range.end}`;
            }

            // Load data quality asynchronously (non-blocking)
            const col = columnSelect.value;
            DataQuality.load(datasetName, col);

            // Show backtest section now that data is loaded
            const btSection = document.getElementById('backtest-section');
            if (btSection) btSection.style.display = 'block';

            // Propagate dataset to news agent panel
            if (typeof setNewsAgentContext === 'function') {
                const col = columnSelect.value || '';
                setNewsAgentContext(null, datasetName, col ? [col] : []);
            }

        } catch (error) {
            console.error('Failed to load dataset summary:', error);
        }
    },

    /**
     * Show a toast notification.
     * @param {string} message - Toast message
     * @param {string} type - Toast type ('success', 'error', 'warning', 'info')
     */
    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `<span class="toast-message">${message}</span>`;

        container.appendChild(toast);

        // Auto-remove after 4 seconds
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    },

    /**
     * Show the loading overlay.
     * @param {string} text - Loading message
     */
    showLoading(text = 'Analyzing data...') {
        const overlay = document.getElementById('loading-overlay');
        const loadingText = document.getElementById('loading-text');
        loadingText.textContent = text;
        overlay.style.display = 'flex';
    },

    /**
     * Hide the loading overlay.
     */
    hideLoading() {
        document.getElementById('loading-overlay').style.display = 'none';
    },
};

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
