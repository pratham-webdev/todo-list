// ============================================================
// mcp-bridge.js — Browser-side WebSocket client for the MCP server
//
// Opens ws://127.0.0.1:8765 to the local MCP server so Claude Desktop
// can read and mutate tasks in IndexedDB via this tab. All DB ops go
// through TodoService so behaviour matches the UI. After every write
// refreshUI() is called so the open tab re-renders.
//
// Protocol (JSON over WS):
//   Server → Browser: { id, method, params }
//   Browser → Server: { id, result }  OR  { id, error }
// ============================================================

import { TodoService } from './todo-service.js';
import { refreshUI } from './main.js';
import { sanitizeRichHTML, TASK_ID_OFFSET } from './utils.js';
import { formatDateListName, normalizeTaskName } from './task-helpers.js';

// ─── Configuration ───────────────────────────────────────────

const DEFAULT_WS_URL = 'ws://127.0.0.1:8765';

/**
 * Read the WebSocket URL from localStorage with validation.
 * Falls back to the default if the stored value is missing or malformed.
 * @returns {string}
 */
function getWsUrl() {
    const stored = localStorage.getItem('mcp-ws-url');
    if (!stored) return DEFAULT_WS_URL;
    try { new URL(stored); return stored; }
    catch { return DEFAULT_WS_URL; }
}

const WS_URL = getWsUrl();
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_FACTOR = 2;

const STATUS_TODO      = 1001;
const STATUS_COMPLETED = 1004;

// ─── Sanitization ────────────────────────────────────────────

/** Normalize an incoming plain-text task name for storage. */
const sanitizeName = (s) => normalizeTaskName(String(s ?? ''));

/**
 * Sanitize an incoming rich-HTML description through the allowlist walker.
 * @param {string} s
 * @returns {string}
 */
const sanitizeDesc = (s) => sanitizeRichHTML(String(s ?? ''));

// ─── Handlers ────────────────────────────────────────────────
// Each handler receives the params object and returns a JSON-serializable
// result. Writes must call refreshUI() before returning.

const HANDLERS = Object.freeze({
    get_all_date_lists: async () => {
        return await TodoService.getAllDateLists();
    },

    get_date_list: async ({ dateId }) => {
        return await TodoService.getDateList(dateId);
    },

    get_tasks_by_status: async ({ statusCode }) => {
        const dateLists = await TodoService.getAllDateLists();
        return dateLists.flatMap((dl) =>
            dl.taskList
                .filter((t) => t.statusCode === statusCode)
                .map((t) => ({ ...t, dateId: dl.id, dateName: dl.name }))
        );
    },

    create_date_list: async ({ dateId, dateName }) => {
        const existing = await TodoService.getDateList(dateId);
        if (existing) return `Date list '${dateId}' already exists`;
        await TodoService.saveDateList({
            id: dateId,
            name: String(dateName),
            taskList: [],
            statusCode: STATUS_TODO,
        });
        await refreshUI();
        return `Created date list '${dateId}'`;
    },

    ensure_date_list_and_add_task: async ({ dateId, dateName, name, desc, statusCode }) => {
        const newTask = {
            id: `Task-${dateId}-${Date.now()}`,
            name: sanitizeName(name),
            statusCode: statusCode ?? STATUS_TODO,
            desc: desc ? sanitizeDesc(desc) : '',
        };
        const result = await TodoService.ensureDateListAndAddTask(
            dateId,
            newTask,
            String(dateName || formatDateListName(dateId))
        );
        await refreshUI();
        return { added: result.task, dateListCreated: result.dateListCreated };
    },

    update_task: async ({ dateId, taskId, updates }) => {
        const sanitized = { ...updates };
        if (typeof sanitized.name === 'string') sanitized.name = sanitizeName(sanitized.name);
        if (typeof sanitized.desc === 'string') sanitized.desc = sanitizeDesc(sanitized.desc);

        await TodoService.updateTask(dateId, taskId, sanitized);
        await refreshUI();
        return { updated: { dateId, taskId, updates: sanitized } };
    },

    mark_all_done: async ({ dateId }) => {
        const dl = await TodoService.getDateList(dateId);
        if (!dl) throw new Error(`Date list '${dateId}' does not exist`);

        const taskUpdates = dl.taskList
            .filter((t) => t.statusCode !== STATUS_COMPLETED)
            .map((t) => ({
                taskId: t.id.slice(TASK_ID_OFFSET),
                updates: { statusCode: STATUS_COMPLETED },
            }));

        if (taskUpdates.length === 0) return `No incomplete tasks in '${dateId}'`;

        await TodoService.batchUpdateTasks(dateId, taskUpdates);
        await refreshUI();
        return `Marked ${taskUpdates.length} task(s) as completed`;
    },

    delete_task: async ({ dateId, taskId }) => {
        await TodoService.deleteTask(dateId, taskId);
        await refreshUI();
        return { deleted: { dateId, taskId } };
    },

    /**
     * Move tasks across date lists. Mirrors drag.js: generates new IDs on
     * the target (so task ids stay consistent with their parent date) and
     * deletes from the source in one batch write.
     */
    move_tasks: async ({ sourceDateId, targetDateId, taskIds }) => {
        const result = await TodoService.moveTasks(sourceDateId, targetDateId, taskIds);
        await refreshUI();
        return result.moved === 0 ? 'No matching tasks found in source' : result;
    },
});

// ─── Status Indicator ────────────────────────────────────────

/** All valid states for the activity-bar status dot */
const STATUS_STATES = Object.freeze(['connected', 'connecting', 'disconnected']);

/**
 * Toggle the status indicator's class + tooltip text. Safe to call before
 * the DOM is ready (no-ops silently if the element isn't in the tree yet).
 * Writes tooltip text into the nested .btn-title span so the repo's
 * built-in tooltip component handles the hover display.
 * @param {'connected' | 'connecting' | 'disconnected'} state
 * @param {string} [tooltip] - optional override for the tooltip text
 */
function setStatus(state, tooltip) {
    const el = document.getElementById('mcp-status-indicator');
    if (!el) return;

    for (const s of STATUS_STATES) el.classList.remove(s);
    el.classList.add(state);

    const tip = el.querySelector('.btn-title');
    if (tip) tip.textContent = tooltip ?? `MCP: ${state}`;
}

// ─── WebSocket Client ────────────────────────────────────────

/** @type {WebSocket | null} */
let ws = null;
let reconnectDelay = RECONNECT_MIN_MS;

/**
 * Connect (or re-connect) to the MCP server. Retries with exponential backoff
 * on failure. Intentionally silent if the MCP server isn't running — the app
 * should work normally without it.
 */
function connect() {
    setStatus('connecting', `MCP: connecting to ${WS_URL}`);

    try {
        ws = new WebSocket(WS_URL);
    } catch (err) {
        console.error('mcp-bridge.connect — constructor failed:', err);
        scheduleReconnect();
        return;
    }

    ws.addEventListener('open', () => {
        reconnectDelay = RECONNECT_MIN_MS;
        setStatus('connected', `MCP: connected to ${WS_URL}`);
    });

    ws.addEventListener('message', (event) => handleMessage(event.data));

    ws.addEventListener('close', (event) => {
        ws = null;
        setStatus('disconnected', `MCP: disconnected (code ${event.code})`);
        scheduleReconnect();
    });

    ws.addEventListener('error', () => {
        // The `close` handler runs next and schedules the reconnect, so this
        // is intentionally low-noise — just swallow.
    });
}

/** Schedule the next reconnection attempt with exponential backoff. */
function scheduleReconnect() {
    const delay = reconnectDelay;
    reconnectDelay = Math.min(reconnectDelay * RECONNECT_FACTOR, RECONNECT_MAX_MS);
    setTimeout(connect, delay);
}

/**
 * Process an incoming server message. Looks up the handler in HANDLERS,
 * invokes it, and sends back a result or error envelope.
 * @param {string} raw - JSON payload
 */
async function handleMessage(raw) {
    let msg;
    try {
        msg = JSON.parse(raw);
    } catch (err) {
        console.error('mcp-bridge.handleMessage — invalid JSON:', err);
        return;
    }

    const { id, method, params } = msg ?? {};
    if (typeof id !== 'string' || typeof method !== 'string') {
        console.error('mcp-bridge.handleMessage — malformed envelope:', msg);
        return;
    }

    const handler = HANDLERS[method];
    if (!handler) {
        send({ id, error: `Unknown method: ${method}` });
        return;
    }

    try {
        const result = await handler(params ?? {});
        send({ id, result: result ?? null });
    } catch (err) {
        console.error(`mcp-bridge.${method} —`, err);
        send({ id, error: err instanceof Error ? err.message : String(err) });
    }
}

/**
 * Send a JSON envelope to the MCP server, if still connected.
 * @param {object} payload
 */
function send(payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.error('mcp-bridge.send — socket not open, dropping:', payload);
        return;
    }
    try {
        ws.send(JSON.stringify(payload));
    } catch (err) {
        console.error('mcp-bridge.send — failed:', err);
    }
}

// ─── Bootstrap ───────────────────────────────────────────────

connect();
