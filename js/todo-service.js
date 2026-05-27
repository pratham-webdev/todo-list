// ============================================================
// todo-service.js — IndexedDB CRUD for date-lists, tasks & notes
// ============================================================

import { TASK_ID_OFFSET } from "./utils.js";
import {
    cloneTaskForDate,
    formatDateListName,
    normalizeTaskRecord,
    STATUS_TODO,
} from "./task-helpers.js";

/** IndexedDB database / store names */
const TASKS_DB_NAME = 'TasksDB';
const TASKS_STORE_NAME = 'tasksData';
const NOTES_DB_NAME = 'NotesDB';
const NOTES_STORE_NAME = 'notesData';

/**
 * Cached IDB connections — one per database name.
 * Prevents opening a new connection on every operation, which can exhaust
 * the browser's per-origin connection pool during burst writes.
 * @type {Map<string, IDBDatabase>}
 */
const _dbCache = new Map();

/**
 * Open (or reuse) an IndexedDB database with a single object store.
 * Connections are cached per dbName so subsequent calls skip the open handshake.
 * @param {string} dbName
 * @param {string} storeName
 * @returns {Promise<IDBDatabase>}
 */
function openDB(dbName, storeName) {
    if (_dbCache.has(dbName)) return Promise.resolve(_dbCache.get(dbName));

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(storeName)) {
                db.createObjectStore(storeName, { keyPath: 'id' });
            }
        };
        request.onsuccess = (e) => {
            const db = e.target.result;
            _dbCache.set(dbName, db);
            resolve(db);
        };
        request.onerror = (e) => reject(e.target.error);
    });
}

/**
 * Generic helper — get all records from a store.
 * @param {string} dbName
 * @param {string} storeName
 * @returns {Promise<Array>}
 */
async function getAll(dbName, storeName) {
    const db = await openDB(dbName, storeName);
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Generic helper — get a single record by key.
 * @param {string} dbName
 * @param {string} storeName
 * @param {string} key
 * @returns {Promise<Object|undefined>}
 */
async function getByKey(dbName, storeName, key) {
    const db = await openDB(dbName, storeName);
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Generic helper — put (insert or overwrite) a record.
 * @param {string} dbName
 * @param {string} storeName
 * @param {Object} record
 * @returns {Promise<void>}
 */
async function putRecord(dbName, storeName, record) {
    const db = await openDB(dbName, storeName);
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Generic helper — delete a record by key.
 * @param {string} dbName
 * @param {string} storeName
 * @param {string} key
 * @returns {Promise<void>}
 */
async function deleteByKey(dbName, storeName, key) {
    const db = await openDB(dbName, storeName);
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Generic helper — clear all records from an object store.
 * @param {string} dbName
 * @param {string} storeName
 * @returns {Promise<void>}
 */
async function clearStore(dbName, storeName) {
    const db = await openDB(dbName, storeName);
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Run a transaction against the tasks object store and resolve with the
 * callback result after the transaction commits successfully.
 * @param {(store: IDBObjectStore) => Promise<any>} mutator
 * @returns {Promise<any>}
 */
async function withTasksStore(mutator) {
    const db = await openDB(TASKS_DB_NAME, TASKS_STORE_NAME);
    return await new Promise((resolve, reject) => {
        const tx = db.transaction(TASKS_STORE_NAME, 'readwrite');
        const store = tx.objectStore(TASKS_STORE_NAME);
        let result;

        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error('Tasks transaction aborted'));

        Promise.resolve()
            .then(async () => {
                result = await mutator(store);
            })
            .catch((error) => {
                try { tx.abort(); } catch { /* noop */ }
                reject(error);
            });
    });
}

/**
 * Read a record from the provided object store.
 * @param {IDBObjectStore} store
 * @param {string} key
 * @returns {Promise<any>}
 */
function getFromStore(store, key) {
    return new Promise((resolve, reject) => {
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Persist a record to the provided object store.
 * @param {IDBObjectStore} store
 * @param {object} record
 * @returns {Promise<void>}
 */
function putToStore(store, record) {
    return new Promise((resolve, reject) => {
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

export const TodoService = {

    // ─── Notes Operations ────────────────────────────────────

    /**
     * Get all notes from IndexedDB.
     * @returns {Promise<Array>}
     */
    async getAllNotes() {
        try {
            return await getAll(NOTES_DB_NAME, NOTES_STORE_NAME);
        } catch (error) {
            console.error("TodoService.getAllNotes — failed:", error);
            return [];
        }
    },

    /**
     * Create or update a note/page.
     * @param {{id: string, name: string, status: number, html: string}} note
     */
    async saveNote(note) {
        try {
            await putRecord(NOTES_DB_NAME, NOTES_STORE_NAME, note);
        } catch (error) {
            console.error("TodoService.saveNote — failed:", error);
            throw error;
        }
    },

    /**
     * Delete a note/page.
     * @param {string} noteId
     */
    async deleteNote(noteId) {
        try {
            await deleteByKey(NOTES_DB_NAME, NOTES_STORE_NAME, noteId);
        } catch (error) {
            console.error("TodoService.deleteNote — failed:", error);
            throw error;
        }
    },

    // ─── Todo Operations ─────────────────────────────────────

    /**
     * Get all date lists from IndexedDB.
     * @returns {Promise<Array>}
     */
    async getAllDateLists() {
        try {
            return await getAll(TASKS_DB_NAME, TASKS_STORE_NAME);
        } catch (error) {
            console.error("TodoService.getAllDateLists — failed:", error);
            return [];
        }
    },

    /**
     * Get a single date list by ID.
     * @param {string} dateListId
     * @returns {Promise<Object|null>}
     */
    async getDateList(dateListId) {
        try {
            const result = await getByKey(TASKS_DB_NAME, TASKS_STORE_NAME, dateListId);
            return result || null;
        } catch (error) {
            console.error("TodoService.getDateList — failed:", error);
            throw error;
        }
    },

    /**
     * Create or overwrite a date list.
     * @param {{id: string, name: string, taskList: Array, statusCode: number}} dateList
     */
    async saveDateList(dateList) {
        try {
            await putRecord(TASKS_DB_NAME, TASKS_STORE_NAME, {
                ...dateList,
                taskList: (dateList.taskList ?? []).map((task) => normalizeTaskRecord(task)),
            });
        } catch (error) {
            console.error("TodoService.saveDateList — failed:", error);
            throw error;
        }
    },

    /**
     * Delete a date list.
     * @param {string} dateListId
     */
    async deleteDateList(dateListId) {
        try {
            await deleteByKey(TASKS_DB_NAME, TASKS_STORE_NAME, dateListId);
        } catch (error) {
            console.error("TodoService.deleteDateList — failed:", error);
            throw error;
        }
    },

    /**
     * Add a single task to a date list.
     * Uses a single readwrite transaction to avoid RMW race conditions.
     * @param {string} dateId
     * @param {{id: string, name: string, statusCode: number, desc: string}} task
     */
    async addTask(dateId, task) {
        try {
            await withTasksStore(async (store) => {
                const dateList = await getFromStore(store, dateId);
                if (!dateList) throw new Error(`Date list '${dateId}' not found`);

                dateList.taskList.push(normalizeTaskRecord(task));
                await putToStore(store, dateList);
            });
        } catch (error) {
            console.error("TodoService.addTask — failed:", error);
            throw error;
        }
    },

    /**
     * Update fields on a single task inside a date list.
     * Uses a single readwrite transaction to avoid RMW race conditions.
     * @param {string} dateId
     * @param {string} taskId - the suffix portion of the full task ID
     * @param {Object} updates - key/value pairs to merge into the task
     */
    async updateTask(dateId, taskId, updates) {
        try {
            await withTasksStore(async (store) => {
                const dateList = await getFromStore(store, dateId);
                if (!dateList) throw new Error(`Date list '${dateId}' not found`);

                // Exact match via slice — avoids false positives from endsWith
                const taskIndex = dateList.taskList.findIndex(
                    (t) => t.id.slice(TASK_ID_OFFSET) === taskId
                );
                if (taskIndex !== -1) {
                    dateList.taskList[taskIndex] = normalizeTaskRecord({
                        ...dateList.taskList[taskIndex],
                        ...updates,
                    });
                    await putToStore(store, dateList);
                }
            });
        } catch (error) {
            console.error("TodoService.updateTask — failed:", error);
            throw error;
        }
    },

    /**
     * Delete a single task from a date list.
     * Uses a single readwrite transaction to avoid RMW race conditions.
     * @param {string} dateId
     * @param {string} taskId - the suffix portion of the full task ID
     */
    async deleteTask(dateId, taskId) {
        try {
            await withTasksStore(async (store) => {
                const dateList = await getFromStore(store, dateId);
                if (!dateList) throw new Error(`Date list '${dateId}' not found`);

                // Exact match via slice — consistent with the rest of the codebase
                dateList.taskList = dateList.taskList.filter(
                    (t) => t.id.slice(TASK_ID_OFFSET) !== taskId
                );
                await putToStore(store, dateList);
            });
        } catch (error) {
            console.error("TodoService.deleteTask — failed:", error);
            throw error;
        }
    },

    /**
     * Batch-update multiple tasks within a single date list in ONE write.
     *
     * @param {string} dateId
     * @param {Array<{taskId: string, updates: Object}>} taskUpdates
     *        Each entry: { taskId (suffix), updates: { statusCode, name, … } }
     */
    async batchUpdateTasks(dateId, taskUpdates) {
        if (!taskUpdates?.length) return;

        try {
            await withTasksStore(async (store) => {
                const dateList = await getFromStore(store, dateId);
                if (!dateList) return;

                for (const { taskId, updates } of taskUpdates) {
                    // Exact match via slice — avoids false positives from endsWith
                    const index = dateList.taskList.findIndex(
                        (t) => t.id.slice(TASK_ID_OFFSET) === taskId
                    );
                    if (index !== -1) {
                        dateList.taskList[index] = normalizeTaskRecord({
                            ...dateList.taskList[index],
                            ...updates,
                        });
                    }
                }

                await putToStore(store, dateList);
            });
        } catch (error) {
            console.error("TodoService.batchUpdateTasks — failed:", error);
            throw error;
        }
    },

    /**
     * Ensure a date list exists and add a task inside one transaction so MCP
     * writes cannot race date-list creation.
     * @param {string} dateId
     * @param {{id: string, name: string, statusCode: number, desc: string}} task
     * @param {string} [dateName]
     * @returns {Promise<{dateListCreated: boolean, task: object}>}
     */
    async ensureDateListAndAddTask(dateId, task, dateName = formatDateListName(dateId)) {
        try {
            return await withTasksStore(async (store) => {
                const existing = await getFromStore(store, dateId);
                const dateList = existing ?? {
                    id: dateId,
                    name: dateName,
                    taskList: [],
                    statusCode: STATUS_TODO,
                };

                dateList.taskList.push(normalizeTaskRecord(task));
                await putToStore(store, dateList);

                return {
                    dateListCreated: !existing,
                    task: normalizeTaskRecord(task),
                };
            });
        } catch (error) {
            console.error("TodoService.ensureDateListAndAddTask — failed:", error);
            throw error;
        }
    },

    /**
     * Move tasks across date lists in one transaction so content and metadata
     * are preserved together with the source/target write.
     * @param {string} sourceDateId
     * @param {string} targetDateId
     * @param {Array<string>} taskIds
     * @returns {Promise<{moved: number, sourceDateId: string, targetDateId: string}>}
     */
    async moveTasks(sourceDateId, targetDateId, taskIds) {
        try {
            return await withTasksStore(async (store) => {
                const source = await getFromStore(store, sourceDateId);
                const target = await getFromStore(store, targetDateId);

                if (!source) throw new Error(`Source date list '${sourceDateId}' does not exist`);
                if (!target) throw new Error(`Target date list '${targetDateId}' does not exist`);

                const idSet = new Set(taskIds);
                const movingTasks = source.taskList.filter((task) => idSet.has(task.id.slice(TASK_ID_OFFSET)));
                if (!movingTasks.length) {
                    return { moved: 0, sourceDateId, targetDateId };
                }

                const baseId = Date.now();
                const movedTasks = movingTasks.map((task, index) =>
                    cloneTaskForDate(task, targetDateId, baseId + index)
                );

                target.taskList.push(...movedTasks);
                source.taskList = source.taskList.filter((task) => !idSet.has(task.id.slice(TASK_ID_OFFSET)));

                await putToStore(store, source);
                await putToStore(store, target);

                return {
                    moved: movedTasks.length,
                    sourceDateId,
                    targetDateId,
                };
            });
        } catch (error) {
            console.error("TodoService.moveTasks — failed:", error);
            throw error;
        }
    },

    /**
     * Batch-rename multiple date lists in a single readwrite transaction.
     *
     * @param {Array<{dateId: string, name: string}>} updates
     *        Each entry: { dateId, name (new human-readable name) }
     */
    async batchUpdateDateListNames(updates) {
        if (!updates?.length) return;

        try {
            await withTasksStore(async (store) => {
                for (const { dateId, name } of updates) {
                    const dateList = await getFromStore(store, dateId);
                    if (!dateList) continue;

                    dateList.name = String(name);
                    await putToStore(store, dateList);
                }
            });
        } catch (error) {
            console.error("TodoService.batchUpdateDateListNames — failed:", error);
            throw error;
        }
    },

    /**
     * Normalize legacy task data in-place. This repairs escaped task names
     * without needing a DB schema migration.
     * Runs all reads + writes inside a single IDB transaction for performance.
     * @returns {Promise<number>} number of updated date lists
     */
    async normalizeLegacyTaskData() {
        try {
            return await withTasksStore(async (store) => {
                // Read all date lists within the same transaction
                const dateLists = await new Promise((resolve, reject) => {
                    const req = store.getAll();
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });

                let updatedLists = 0;

                for (const dateList of dateLists) {
                    let changed = false;
                    const normalizedTasks = (dateList.taskList ?? []).map((task) => {
                        const normalizedTask = normalizeTaskRecord(task);
                        if (
                            normalizedTask.name !== task.name ||
                            normalizedTask.desc !== task.desc
                        ) {
                            changed = true;
                        }
                        return normalizedTask;
                    });

                    if (changed) {
                        await putToStore(store, {
                            ...dateList,
                            taskList: normalizedTasks,
                        });
                        updatedLists += 1;
                    }
                }

                return updatedLists;
            });
        } catch (error) {
            console.error("TodoService.normalizeLegacyTaskData — failed:", error);
            throw error;
        }
    },

    /**
     * Batch-delete multiple tasks within a single date list in ONE write.
     *
     * @param {string} dateId
     * @param {Array<string>} taskIds - array of task ID suffixes to remove
     */
    async batchDeleteTasks(dateId, taskIds) {
        if (!taskIds?.length) return;

        try {
            await withTasksStore(async (store) => {
                const dateList = await getFromStore(store, dateId);
                if (!dateList) return;

                const idsToRemove = new Set(taskIds);
                dateList.taskList = dateList.taskList.filter((t) => {
                    const suffix = t.id.slice(TASK_ID_OFFSET);
                    return !idsToRemove.has(suffix);
                });

                await putToStore(store, dateList);
            });
        } catch (error) {
            console.error("TodoService.batchDeleteTasks — failed:", error);
            throw error;
        }
    },

    // ─── Markdown Reader Draft ───────────────────────────────

    /** Well-known key for the single markdown reader draft record */
    MARKDOWN_DRAFT_ID: 'markdown-reader-draft',

    /**
     * Load the persisted markdown reader draft from IndexedDB.
     * @returns {Promise<{id: string, content: string, updatedAt: number}|null>}
     */
    async getMarkdownDraft() {
        try {
            // Use TodoService.MARKDOWN_DRAFT_ID (not this) to avoid binding fragility
            const record = await getByKey(NOTES_DB_NAME, NOTES_STORE_NAME, TodoService.MARKDOWN_DRAFT_ID);
            return record ?? null;
        } catch (error) {
            console.error("TodoService.getMarkdownDraft — failed:", error);
            return null;
        }
    },

    /**
     * Persist the markdown reader draft to IndexedDB.
     * @param {string} content - raw markdown text
     * @returns {Promise<void>}
     */
    async saveMarkdownDraft(content) {
        try {
            await putRecord(NOTES_DB_NAME, NOTES_STORE_NAME, {
                id: TodoService.MARKDOWN_DRAFT_ID,
                content,
                updatedAt: Date.now(),
            });
        } catch (error) {
            console.error("TodoService.saveMarkdownDraft — failed:", error);
            throw error;
        }
    },

    /**
     * Delete the markdown reader draft from IndexedDB.
     * @returns {Promise<void>}
     */
    async deleteMarkdownDraft() {
        try {
            await deleteByKey(NOTES_DB_NAME, NOTES_STORE_NAME, TodoService.MARKDOWN_DRAFT_ID);
        } catch (error) {
            console.error("TodoService.deleteMarkdownDraft — failed:", error);
            throw error;
        }
    },

    // ─── Bulk Clear / Reset ──────────────────────────────────

    /**
     * Delete all date lists and tasks from IndexedDB.
     * @returns {Promise<void>}
     */
    async clearAllDateLists() {
        try {
            await clearStore(TASKS_DB_NAME, TASKS_STORE_NAME);
        } catch (error) {
            console.error("TodoService.clearAllDateLists — failed:", error);
            throw error;
        }
    },

    /**
     * Delete all notes pages from IndexedDB.
     * @returns {Promise<void>}
     */
    async clearAllNotes() {
        try {
            await clearStore(NOTES_DB_NAME, NOTES_STORE_NAME);
        } catch (error) {
            console.error("TodoService.clearAllNotes — failed:", error);
            throw error;
        }
    },

    /**
     * Factory reset: close all cached DB connections, delete all IndexedDB
     * databases (Tasks, Notes, Backup), clear localStorage, and reload.
     * @returns {Promise<void>}
     */
    async factoryReset() {
        // Close cached connections so deleteDatabase can proceed
        for (const [, db] of _dbCache) {
            try { db.close(); } catch { /* noop */ }
        }
        _dbCache.clear();

        const dbNames = [TASKS_DB_NAME, NOTES_DB_NAME, 'BackupDB'];
        for (const name of dbNames) {
            try {
                await new Promise((resolve, reject) => {
                    const req = indexedDB.deleteDatabase(name);
                    req.onsuccess = () => resolve();
                    req.onerror = () => reject(req.error);
                    req.onblocked = () => resolve();
                });
            } catch (error) {
                console.error(`TodoService.factoryReset — deleteDatabase(${name}) failed:`, error);
            }
        }

        localStorage.clear();
        window.location.reload();
    },
};
