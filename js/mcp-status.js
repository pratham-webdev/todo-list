// ============================================================
// mcp-status.js — Lightweight MCP connection status indicator
//
// Opens a WebSocket to the MCP server solely to probe connectivity.
// Updates #mcp-status-indicator on any page that includes it.
// Unlike mcp-bridge.js this module has ZERO imports and registers
// no command handlers — it ignores all incoming messages.
// ============================================================

const DEFAULT_WS_URL = 'ws://127.0.0.1:8765';
const RECONNECT_MIN_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_FACTOR = 2;

/** All valid states for the status dot */
const STATUS_STATES = Object.freeze(['connected', 'connecting', 'disconnected']);

/**
 * Read the WebSocket URL from localStorage with validation.
 * @returns {string}
 */
function getWsUrl() {
    const stored = localStorage.getItem('mcp-ws-url');
    if (!stored) return DEFAULT_WS_URL;
    try { new URL(stored); return stored; }
    catch { return DEFAULT_WS_URL; }
}

/**
 * Update every #mcp-status-indicator on the page.
 * @param {'connected' | 'connecting' | 'disconnected'} state
 * @param {string} [tooltip]
 */
function setStatus(state, tooltip) {
    const text = tooltip ?? `MCP: ${state}`;
    const el = document.getElementById('mcp-status-indicator');
    if (!el) return;

    for (const s of STATUS_STATES) el.classList.remove(s);
    el.classList.add(state);

    // .btn-title is the tooltip span used across the app
    const tip = el.querySelector('.btn-title') ?? el.querySelector('.mcp-status-label');
    if (tip) tip.textContent = text;
}

// ─── WebSocket Probe ─────────────────────────────────────────

const WS_URL = getWsUrl();

/** @type {WebSocket | null} */
let ws = null;
let reconnectDelay = RECONNECT_MIN_MS;

/**
 * Open a status-only WebSocket connection. No message handling —
 * we only care about open/close events to drive the indicator.
 */
function connect() {
    setStatus('connecting', `MCP: connecting to ${WS_URL}`);

    try {
        ws = new WebSocket(WS_URL);
    } catch (err) {
        console.error('mcp-status.connect — constructor failed:', err);
        scheduleReconnect();
        return;
    }

    ws.addEventListener('open', () => {
        reconnectDelay = RECONNECT_MIN_MS;
        setStatus('connected', `MCP: connected to ${WS_URL}`);
    });

    // Ignore incoming messages — this is a status probe only
    ws.addEventListener('message', () => {});

    ws.addEventListener('close', (event) => {
        ws = null;
        setStatus('disconnected', `MCP: disconnected (code ${event.code})`);
        scheduleReconnect();
    });

    ws.addEventListener('error', () => {
        // close handler runs next and schedules the reconnect
    });
}

/** Schedule the next reconnection attempt with exponential backoff. */
function scheduleReconnect() {
    const delay = reconnectDelay;
    reconnectDelay = Math.min(reconnectDelay * RECONNECT_FACTOR, RECONNECT_MAX_MS);
    setTimeout(connect, delay);
}

// ─── Bootstrap ───────────────────────────────────────────────

connect();
