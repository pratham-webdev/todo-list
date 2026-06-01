// ============================================================
// mcp-status-relay.js — MCP connection status relay for all pages
//
// Loaded on every page (index, settings, notes, markdown).
// Injects the #mcp-status-indicator dot into .activity-bar-top
// and keeps it in sync via localStorage (written by mcp-bridge.js
// on the todo-list tab). Opens ZERO WebSocket connections.
//
// On index.html this script runs before mcp-bridge.js, which
// also updates the injected element directly for instant feedback.
// ============================================================

/** @type {ReadonlyArray<string>} Valid states for the status dot */
const VALID_STATES = Object.freeze(['connected', 'connecting', 'disconnected']);

// ─── Inject Status Indicator ─────────────────────────────────

/**
 * Build and append the MCP status indicator into `.activity-bar-top`.
 * No-ops if the container doesn't exist (e.g. pages without an activity bar).
 * @returns {HTMLElement | null} the injected indicator element, or null
 */
function injectIndicator() {
    const container = document.querySelector('.activity-bar-top');
    if (!container) return null;

    const indicator = document.createElement('div');
    indicator.id = 'mcp-status-indicator';
    indicator.className = 'activity-icon mcp-status-indicator disconnected';
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('aria-live', 'polite');
    indicator.setAttribute('aria-label', 'MCP connection status');

    const dot = document.createElement('span');
    dot.className = 'mcp-status-dot';
    dot.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'btn-title';
    label.textContent = 'MCP: disconnected';

    indicator.append(dot, label);
    container.append(indicator);
    return indicator;
}

// ─── State Application ───────────────────────────────────────

/**
 * Apply a state + tooltip to an indicator element. Validates the
 * state value against the known allowlist (security: untrusted localStorage).
 * @param {HTMLElement} el - the indicator element
 * @param {string} state - one of 'connected', 'connecting', 'disconnected'
 * @param {string} text - tooltip / label text
 */
function applyState(el, state, text) {
    // Guard against garbage values in localStorage
    const safe = VALID_STATES.includes(state) ? state : 'disconnected';
    for (const s of VALID_STATES) el.classList.remove(s);
    el.classList.add(safe);

    const tip = el.querySelector('.btn-title') ?? el.querySelector('.mcp-status-label');
    if (tip) tip.textContent = text;
}

/**
 * Read MCP state from localStorage and apply it to the indicator.
 * try/catch guards against SecurityError in restricted contexts.
 * @param {HTMLElement} el - the indicator element
 */
function syncFromStorage(el) {
    try {
        const state = localStorage.getItem('mcp-state') ?? 'disconnected';
        const text = localStorage.getItem('mcp-state-text') ?? 'MCP: disconnected';
        applyState(el, state, text);
    } catch {
        // SecurityError or quota — leave as disconnected
    }

    // Also update the settings-page status indicator if present
    const settingsIndicator = document.getElementById('mcp-settings-status');
    if (settingsIndicator) {
        try {
            const state = localStorage.getItem('mcp-state') ?? 'disconnected';
            const text = localStorage.getItem('mcp-state-text') ?? 'MCP: disconnected';
            applyState(settingsIndicator, state, text);
        } catch { /* non-critical */ }
    }
}

// ─── Bootstrap ───────────────────────────────────────────────

const indicator = injectIndicator();

if (indicator) {
    // Apply initial state from localStorage
    syncFromStorage(indicator);

    // Listen for cross-tab updates (fired when mcp-bridge.js writes to localStorage)
    window.addEventListener('storage', (e) => {
        if (e.key === 'mcp-state' || e.key === 'mcp-state-text') {
            syncFromStorage(indicator);
        }
    });
}
