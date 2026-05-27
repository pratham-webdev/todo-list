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

// ─── Preview Token Store ────────────────────────────────────
// Stores pending overwrite payloads keyed by a one-time UUID token.
// Each entry has a 60 s TTL and is deleted after use or expiry.

/** @type {Map<string, { payload: Array, timer: number }>} */
const _previewTokens = new Map();

const PREVIEW_TOKEN_TTL_MS = 60_000;

/**
 * Generate a random UUID token (crypto.randomUUID where available, fallback
 * to a simple v4-like construction for older browsers).
 * @returns {string}
 */
function generateToken() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    // Fallback — not cryptographically secure but sufficient for a localhost token
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}

/**
 * Store a preview payload and return its one-time token.
 * @param {Array} payload - the dateListOverwrites array to store
 * @returns {string} previewToken
 */
function storePreview(payload) {
    const token = generateToken();
    const timer = setTimeout(() => _previewTokens.delete(token), PREVIEW_TOKEN_TTL_MS);
    _previewTokens.set(token, { payload, timer });
    return token;
}

/**
 * Consume a preview token and return the stored payload.
 * @param {string} token
 * @returns {Array}
 * @throws {Error} if the token is invalid or expired
 */
function consumePreview(token) {
    const entry = _previewTokens.get(token);
    if (!entry) throw new Error('Invalid or expired previewToken — please call preview_overwrite_date_lists again');
    clearTimeout(entry.timer);
    _previewTokens.delete(token);
    return entry.payload;
}

/**
 * Sanitize name/desc fields and reshape a taskUpdates array for TodoService.
 * @param {Array<{taskId: string, name?: string, desc?: string, statusCode?: number}>} taskUpdates
 * @returns {Array<{taskId: string, updates: Object}>} formatted for TodoService.batchUpdateTasks
 */
function sanitizeTaskUpdates(taskUpdates) {
    return taskUpdates.map(({ taskId, name, statusCode, desc }) => {
        const updates = {};
        if (name !== undefined) updates.name = sanitizeName(name);
        if (statusCode !== undefined) updates.statusCode = statusCode;
        if (desc !== undefined) updates.desc = sanitizeDesc(desc);
        return { taskId, updates };
    });
}

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

    batch_update_tasks: async ({ dateId, taskUpdates }) => {
        const sanitized = sanitizeTaskUpdates(taskUpdates);
        await TodoService.batchUpdateTasks(dateId, sanitized);
        await refreshUI();
        return { updated: sanitized.length, dateId };
    },

    batch_update_tasks_across_dates: async ({ taskUpdates }) => {
        // Group entries by dateId so each date list gets one batchUpdate call
        /** @type {Map<string, Array>} */
        const grouped = new Map();
        for (const entry of taskUpdates) {
            const { dateId, ...rest } = entry;
            if (!grouped.has(dateId)) grouped.set(dateId, []);
            grouped.get(dateId).push(rest);
        }

        const results = [];
        for (const [dateId, entries] of grouped) {
            const sanitized = sanitizeTaskUpdates(entries);
            await TodoService.batchUpdateTasks(dateId, sanitized);
            results.push({ dateId, updated: sanitized.length });
        }

        await refreshUI();
        return { results, totalUpdated: taskUpdates.length };
    },

    batch_update_date_lists: async ({ dateListUpdates }) => {
        const sanitized = dateListUpdates.map((entry) => ({
            dateId: entry.dateId,
            name: sanitizeName(entry.name),
        }));
        await TodoService.batchUpdateDateListNames(sanitized);
        await refreshUI();
        return { renamed: sanitized.length };
    },

    preview_overwrite_date_lists: async ({ dateListOverwrites }) => {
        // Read-only: compute diff for each date list and store the payload
        const diffs = [];
        for (const { dateId, taskList } of dateListOverwrites) {
            const existing = await TodoService.getDateList(dateId);
            const currentNames = (existing?.taskList ?? []).map((t) => t.name);
            const proposedNames = taskList.map((t) => sanitizeName(t.name));

            // Simple set-based diff on task names
            const currentSet = new Set(currentNames);
            const proposedSet = new Set(proposedNames);
            const added = proposedNames.filter((n) => !currentSet.has(n));
            const removed = currentNames.filter((n) => !proposedSet.has(n));

            diffs.push({
                dateId,
                exists: !!existing,
                currentTaskCount: currentNames.length,
                proposedTaskCount: proposedNames.length,
                added,
                removed,
            });
        }

        const previewToken = storePreview(dateListOverwrites);
        return { diffs, previewToken, expiresInMs: PREVIEW_TOKEN_TTL_MS };
    },

    batch_create_date_lists: async ({ dateLists }) => {
        const results = [];
        for (const { dateId, name } of dateLists) {
            const existing = await TodoService.getDateList(dateId);
            if (existing) {
                results.push({ dateId, skipped: true, reason: 'already exists' });
                continue;
            }
            await TodoService.saveDateList({
                id: dateId,
                name: name ? sanitizeName(name) : formatDateListName(dateId),
                taskList: [],
                statusCode: STATUS_TODO,
            });
            results.push({ dateId, created: true });
        }
        await refreshUI();
        return { results, created: results.filter((r) => r.created).length };
    },

    batch_add_tasks: async ({ dateId, tasks }) => {
        const baseId = Date.now();
        const builtTasks = tasks.map((t, i) => ({
            id: `Task-${dateId}-${baseId + i}`,
            name: sanitizeName(t.name),
            statusCode: t.statusCode ?? STATUS_TODO,
            desc: t.desc ? sanitizeDesc(t.desc) : '',
        }));

        const result = await TodoService.batchAddTasks(dateId, builtTasks);
        await refreshUI();
        return { addedCount: builtTasks.length, dateId, dateListCreated: result.dateListCreated };
    },

    batch_create_date_lists_with_tasks: async ({ dateLists }) => {
        const results = [];
        let idCounter = Date.now();

        for (const { dateId, name, taskList } of dateLists) {
            const existing = await TodoService.getDateList(dateId);
            if (existing) {
                results.push({ dateId, skipped: true, reason: 'already exists' });
                continue;
            }

            const baseId = idCounter;
            idCounter += taskList.length;
            const builtTasks = taskList.map((t, i) => ({
                id: `Task-${dateId}-${baseId + i}`,
                name: sanitizeName(t.name),
                statusCode: t.statusCode ?? STATUS_TODO,
                desc: t.desc ? sanitizeDesc(t.desc) : '',
            }));

            await TodoService.saveDateList({
                id: dateId,
                name: name ? sanitizeName(name) : formatDateListName(dateId),
                taskList: builtTasks,
                statusCode: STATUS_TODO,
            });
            results.push({ dateId, created: true, taskCount: builtTasks.length });
        }

        await refreshUI();
        return { results, created: results.filter((r) => r.created).length };
    },

    confirm_overwrite_date_lists: async ({ previewToken }) => {
        const dateListOverwrites = consumePreview(previewToken);
        const results = [];

        // Single timestamp base for all generated IDs — incremented across date lists
        let idCounter = Date.now();

        for (const { dateId, taskList } of dateListOverwrites) {
            const existing = await TodoService.getDateList(dateId);

            // Build full task objects with generated IDs
            const baseId = idCounter;
            idCounter += taskList.length;
            const newTaskList = taskList.map((t, i) => ({
                id: `Task-${dateId}-${baseId + i}`,
                name: sanitizeName(t.name),
                statusCode: t.statusCode ?? STATUS_TODO,
                desc: t.desc ? sanitizeDesc(t.desc) : '',
            }));

            await TodoService.saveDateList({
                id: dateId,
                name: existing?.name ?? formatDateListName(dateId),
                taskList: newTaskList,
                statusCode: existing?.statusCode ?? STATUS_TODO,
            });

            results.push({ dateId, replaced: newTaskList.length, created: !existing });
        }

        await refreshUI();
        return { results };
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
