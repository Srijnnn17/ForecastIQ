/**
 * news_agents.js — Market Intelligence Panel
 *
 * Handles:
 *  - Keyword tag management
 *  - POST /api/news-agents → streaming SSE via fetch + ReadableStream
 *  - Live rendering of Analyst / Skeptic / Synthesizer messages
 *  - Final structured forecast card
 *  - Architecture modal with animated workflow
 */

/* ─────────────────────────────────────────────────────────────────────────── */
/*  State                                                                       */
/* ─────────────────────────────────────────────────────────────────────────── */
const NA = {
  keywords: ['ATM cash demand', 'NatWest', 'UK retail'],
  activeStream: null,          // AbortController
  lastAnomalyDate: null,
  lastDataset: null,
};

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Init (called from app.js after tab switch)                                 */
/* ─────────────────────────────────────────────────────────────────────────── */
function initNewsAgents() {
  _renderKeywords();
  _bindKeywordInput();
  _bindAnalyseButton();
  _bindArchitectureButton();
  _bindArchitectureClose();
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Keyword Tags                                                               */
/* ─────────────────────────────────────────────────────────────────────────── */
function _renderKeywords() {
  const container = document.getElementById('na-keyword-tags');
  if (!container) return;
  container.innerHTML = '';

  NA.keywords.forEach((kw, i) => {
    const tag = document.createElement('span');
    tag.className = 'na-tag';
    tag.innerHTML = `${kw} <button class="na-tag-remove" data-index="${i}" aria-label="Remove keyword">×</button>`;
    container.appendChild(tag);
  });

  // Remove handlers
  container.querySelectorAll('.na-tag-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      NA.keywords.splice(+btn.dataset.index, 1);
      _renderKeywords();
    });
  });
}

function _bindKeywordInput() {
  const input = document.getElementById('na-keyword-input');
  const addBtn = document.getElementById('na-keyword-add');
  if (!input || !addBtn) return;

  const addKw = () => {
    const val = input.value.trim();
    if (val && !NA.keywords.includes(val) && NA.keywords.length < 8) {
      NA.keywords.push(val);
      _renderKeywords();
      input.value = '';
    }
  };

  addBtn.addEventListener('click', addKw);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addKw(); } });
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Auto-populate keywords from the currently selected anomaly                */
/* ─────────────────────────────────────────────────────────────────────────── */
function setNewsAgentContext(date, dataset, extraKeywords = []) {
  NA.lastAnomalyDate = date;
  NA.lastDataset = dataset;

  // Update date badge
  const badge = document.getElementById('na-date-context');
  if (badge) badge.textContent = date || '—';

  // Merge extra keywords without duplicates
  extraKeywords.forEach(kw => {
    if (kw && !NA.keywords.includes(kw)) NA.keywords.push(kw);
  });
  _renderKeywords();
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Main streaming analysis                                                    */
/* ─────────────────────────────────────────────────────────────────────────── */
function _bindAnalyseButton() {
  const btn = document.getElementById('btn-news-analyse');
  if (!btn) return;
  btn.addEventListener('click', _runAnalysis);
}

async function _runAnalysis() {
  if (NA.activeStream) {
    NA.activeStream.abort();
    NA.activeStream = null;
  }

  // Reset UI
  _resetAgentPanels();
  _showSection('na-debate-section', true);
  _showSection('na-forecast-section', false);
  _setButtonState('running');

  const dataset = NA.lastDataset
    || document.getElementById('dataset-select')?.value
    || 'unknown';
  const anomalyDate = NA.lastAnomalyDate || 'unknown';

  const controller = new AbortController();
  NA.activeStream = controller;

  try {
    const resp = await fetch('/api/news-agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataset,
        anomaly_date: anomalyDate,
        keywords: NA.keywords,
        language: 'English',
      }),
      signal: controller.signal,
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop(); // keep incomplete chunk

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        try {
          const payload = JSON.parse(line.slice(5).trim());
          _handleEvent(payload);
        } catch (_) { /* skip malformed */ }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      _appendStatusMessage(`❌ Stream error: ${err.message}`);
    }
  } finally {
    NA.activeStream = null;
    _setButtonState('idle');
  }
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  SSE Event Dispatcher                                                       */
/* ─────────────────────────────────────────────────────────────────────────── */
function _handleEvent(payload) {
  const { event, data } = payload;

  switch (event) {
    case 'status':
      _appendStatusMessage(data);
      break;

    case 'headlines':
      try { _renderHeadlines(JSON.parse(data)); } catch (_) {}
      break;

    case 'agent_start': {
      const info = typeof data === 'string' ? JSON.parse(data) : data;
      _setAgentState(info.agent, 'thinking');
      break;
    }

    case 'analyst':
    case 'skeptic':
    case 'synthesizer': {
      const info = typeof data === 'string' ? JSON.parse(data) : data;
      _renderAgentMessage(event, info.label, info.content);
      _setAgentState(event, 'done');
      break;
    }

    case 'forecast': {
      const fc = typeof data === 'string' ? JSON.parse(data) : data;
      _renderForecast(fc);
      _showSection('na-forecast-section', true);
      break;
    }

    case 'error':
      _appendStatusMessage(`⚠️ ${data}`);
      break;

    case 'done':
      _appendStatusMessage('✅ Analysis complete.');
      break;
  }
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  UI Renderers                                                               */
/* ─────────────────────────────────────────────────────────────────────────── */
function _appendStatusMessage(msg) {
  const el = document.getElementById('na-status-log');
  if (!el) return;
  const line = document.createElement('p');
  line.className = 'na-status-line';
  line.textContent = msg;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function _renderHeadlines(articles) {
  const container = document.getElementById('na-headlines-list');
  if (!container) return;
  const box = document.getElementById('na-headlines-box');
  if (box) box.style.display = 'block';

  container.innerHTML = '';
  articles.slice(0, 6).forEach(a => {
    const item = document.createElement('a');
    item.className = 'na-headline-item';
    item.href = a.url || '#';
    item.target = '_blank';
    item.rel = 'noopener noreferrer';
    item.innerHTML = `
      <span class="na-headline-source">${_esc(a.source)}</span>
      <span class="na-headline-title">${_esc(a.title)}</span>
    `;
    container.appendChild(item);
  });
}

function _setAgentState(agentId, state) {
  const panel = document.getElementById(`na-agent-${agentId}`);
  if (!panel) return;
  panel.dataset.state = state;

  const indicator = panel.querySelector('.na-agent-indicator');
  if (!indicator) return;

  if (state === 'thinking') {
    indicator.innerHTML = '<span class="na-pulse"></span> Thinking…';
  } else if (state === 'done') {
    indicator.innerHTML = '<span class="na-done-dot"></span> Done';
  } else {
    indicator.innerHTML = '<span class="na-idle-dot"></span> Waiting';
  }
}

function _renderAgentMessage(agentId, label, content) {
  const panel = document.getElementById(`na-agent-${agentId}`);
  if (!panel) return;

  const body = panel.querySelector('.na-agent-body');
  if (!body) return;

  // Animate text in
  body.innerHTML = '';
  body.style.opacity = '0';

  // Strip JSON fence from synthesizer output for cleaner display
  const cleaned = content
    .replace(/```json[\s\S]*?```/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .trim();

  const paragraphs = cleaned.split(/\n{2,}/).filter(Boolean);
  paragraphs.forEach(para => {
    const p = document.createElement('p');
    p.textContent = para.trim();
    body.appendChild(p);
  });

  requestAnimationFrame(() => {
    body.style.transition = 'opacity 0.5s ease';
    body.style.opacity = '1';
  });
}

function _renderForecast(fc) {
  const directionMap = {
    bullish: { label: '↑ Bullish', cls: 'bullish' },
    bearish: { label: '↓ Bearish', cls: 'bearish' },
    neutral: { label: '→ Neutral', cls: 'neutral' },
  };
  const riskMap = {
    low:    { label: 'LOW',    cls: 'risk-low'    },
    medium: { label: 'MEDIUM', cls: 'risk-medium' },
    high:   { label: 'HIGH',   cls: 'risk-high'   },
  };

  const dir = directionMap[fc.trend_direction] || directionMap.neutral;
  const risk = riskMap[fc.risk_level] || riskMap.medium;

  _setEl('na-fc-direction', dir.label, 'na-fc-direction-val');
  _setAttr('na-fc-direction', 'class', `na-fc-direction-val ${dir.cls}`);
  _setEl('na-fc-confidence', `${fc.confidence ?? '—'}%`);
  _setEl('na-fc-action', fc.action || '—');
  _setEl('na-fc-replenishment', fc.replenishment_adjustment || '—');
  _setEl('na-fc-risk', risk.label);
  _setAttr('na-fc-risk', 'class', `na-fc-badge ${risk.cls}`);

  // Key drivers
  const driversEl = document.getElementById('na-fc-drivers');
  if (driversEl && Array.isArray(fc.key_drivers)) {
    driversEl.innerHTML = fc.key_drivers
      .map(d => `<span class="na-driver-tag">${_esc(d)}</span>`)
      .join('');
  }

  // Watch-outs
  const watchEl = document.getElementById('na-fc-watchout');
  if (watchEl && Array.isArray(fc.watch_out_for)) {
    watchEl.innerHTML = fc.watch_out_for
      .map(w => `<li>${_esc(w)}</li>`)
      .join('');
  }

  // Animate in
  const card = document.getElementById('na-forecast-section');
  if (card) {
    card.style.opacity = '0';
    card.style.transform = 'translateY(20px)';
    requestAnimationFrame(() => {
      card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
      card.style.opacity = '1';
      card.style.transform = 'translateY(0)';
    });
  }
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Architecture Modal                                                         */
/* ─────────────────────────────────────────────────────────────────────────── */
function _bindArchitectureButton() {
  const btn = document.getElementById('btn-architecture');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const modal = document.getElementById('architecture-modal');
    if (modal) {
      modal.style.display = 'flex';
      requestAnimationFrame(() => modal.classList.add('modal-visible'));
      // Always start on workflow tab when opening
      _switchArchTab('workflow');
      _startArchitectureAnimation();
    }
  });

  // Wire up the tab buttons inside the modal (delegated)
  document.getElementById('architecture-modal')?.addEventListener('click', e => {
    const tabBtn = e.target.closest('[data-arch-tab]');
    if (tabBtn) {
      const tabId = tabBtn.dataset.archTab;
      _switchArchTab(tabId);
      if (tabId === 'workflow') {
        _startArchitectureAnimation();
      } else {
        _stopArchitectureAnimation();
      }
    }
  });
}

function _switchArchTab(tabId) {
  document.querySelectorAll('.arch-tab').forEach(btn => {
    btn.classList.toggle('arch-tab-active', btn.dataset.archTab === tabId);
  });
  document.querySelectorAll('.arch-tab-panel').forEach(panel => {
    panel.classList.toggle('arch-tab-panel-active', panel.id === `arch-panel-${tabId}`);
  });
}

function _bindArchitectureClose() {
  const closeBtn = document.getElementById('btn-arch-close');
  const overlay = document.getElementById('architecture-modal');
  [closeBtn, overlay].forEach(el => {
    if (!el) return;
    el.addEventListener('click', e => {
      if (e.target === overlay || e.target === closeBtn || e.target.closest('#btn-arch-close')) {
        overlay.classList.remove('modal-visible');
        setTimeout(() => { overlay.style.display = 'none'; }, 300);
        _stopArchitectureAnimation();
      }
    });
  });
}

let _archAnimTimer = null;

function _startArchitectureAnimation() {
  _stopArchitectureAnimation();
  const steps = document.querySelectorAll('.arch-step');
  const arrows = document.querySelectorAll('.arch-arrow');
  if (!steps.length) return;

  // Reset
  steps.forEach(s => s.classList.remove('arch-active', 'arch-done'));
  arrows.forEach(a => a.classList.remove('arch-arrow-active'));

  let idx = 0;
  const totalSteps = steps.length;
  const interval = 800; // ms per step

  function advance() {
    if (idx > 0) {
      steps[idx - 1].classList.remove('arch-active');
      steps[idx - 1].classList.add('arch-done');
      if (arrows[idx - 1]) arrows[idx - 1].classList.add('arch-arrow-active');
    }
    if (idx < totalSteps) {
      steps[idx].classList.add('arch-active');
      idx++;
      _archAnimTimer = setTimeout(advance, interval);
    } else {
      // Pause then restart loop
      _archAnimTimer = setTimeout(() => {
        steps.forEach(s => s.classList.remove('arch-active', 'arch-done'));
        arrows.forEach(a => a.classList.remove('arch-arrow-active'));
        idx = 0;
        _archAnimTimer = setTimeout(advance, 400);
      }, 1800);
    }
  }
  advance();
}

function _stopArchitectureAnimation() {
  if (_archAnimTimer) { clearTimeout(_archAnimTimer); _archAnimTimer = null; }
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Helpers                                                                    */
/* ─────────────────────────────────────────────────────────────────────────── */
function _esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _showSection(id, visible) {
  const el = document.getElementById(id);
  if (el) el.style.display = visible ? 'block' : 'none';
}

function _setEl(id, text, className) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  if (className) el.className = className;
}

function _setAttr(id, attr, value) {
  const el = document.getElementById(id);
  if (el) el[attr === 'class' ? 'className' : attr] = value;
}

function _resetAgentPanels() {
  ['analyst', 'skeptic', 'synthesizer'].forEach(a => {
    const panel = document.getElementById(`na-agent-${a}`);
    if (!panel) return;
    panel.dataset.state = 'idle';
    const body = panel.querySelector('.na-agent-body');
    if (body) body.innerHTML = '';
    const ind = panel.querySelector('.na-agent-indicator');
    if (ind) ind.innerHTML = '<span class="na-idle-dot"></span> Waiting';
  });

  const log = document.getElementById('na-status-log');
  if (log) log.innerHTML = '';

  const headlinesBox = document.getElementById('na-headlines-box');
  if (headlinesBox) headlinesBox.style.display = 'none';
}

function _setButtonState(state) {
  const btn = document.getElementById('btn-news-analyse');
  if (!btn) return;
  if (state === 'running') {
    btn.disabled = true;
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin-icon">
        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
      </svg>
      Analysing…`;
  } else {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>
      </svg>
      Analyse with News Agents`;
  }
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Expose globals                                                             */
/* ─────────────────────────────────────────────────────────────────────────── */
window.initNewsAgents = initNewsAgents;
window.setNewsAgentContext = setNewsAgentContext;
