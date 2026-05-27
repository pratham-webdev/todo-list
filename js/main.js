// ============================================================
// main.js — App entry point, rendering, and task CRUD operations
// ============================================================

import { TodoService } from "./todo-service.js";
import { replaceURLs, escapeHTML, sanitizeRichHTML, normalizeRichHTML, hasRichContent, DATE_ID_START, DATE_ID_END, TASK_ID_OFFSET } from "./utils.js";
import { sortByDate, createRTFToolbar } from "./notes-common.js";
import {
    normalizeTaskName,
    STATUS_TODO,
} from "./task-helpers.js";
import { initAutoBackup } from "./backup-scheduler.js";
import { setMessageState } from "./toast.js";

// ─── Globals (formerly in todo-variables.js) ─────────────────
let taskArray = [];
const bsOffcanvas = new bootstrap.Offcanvas('#task-detail-container');

/**
 * Previous snapshot data keyed by date-list ID, used for differential rendering.
 * @type {Map<string, object>}
 */
const previousDateListMap = new Map();

// ─── Status Code Constants ───────────────────────────────────
// STATUS_TODO is imported from task-helpers.js (shared with todo-service.js)
const STATUS_ONGOING   = 1002;
const STATUS_BLOCKED   = 1003;
const STATUS_COMPLETED = 1004;
const STATUS_ARCHIVED  = 1005;

/** Map status codes to human-readable labels */
const STATUS_LABELS = {
    [STATUS_TODO]:      'To-Do',
    [STATUS_ONGOING]:   'Ongoing',
    [STATUS_BLOCKED]:   'Blocked',
    [STATUS_COMPLETED]: 'Completed',
    [STATUS_ARCHIVED]:  'Archived',
};

// ─── App Initialisation ──────────────────────────────────────

/** Bootstrap the app: load data from IndexedDB and render. */
async function initApp() {
    try {
        await TodoService.normalizeLegacyTaskData();
    } catch (error) {
        console.error('main.js — legacy normalization failed:', error);
    }
    await refreshUI();
    await initAutoBackup();
}

/**
 * Re-read all date lists from IndexedDB and re-render the UI.
 * Called on startup and after every CRUD mutation.
 */
async function refreshUI() {
    const dateLists = await TodoService.getAllDateLists();
    renderDateList(dateLists);
    renderDateNav(dateLists);
}

// Start the app
initApp();

// ─── UI Helpers ──────────────────────────────────────────────

/**
 * Count how many tasks in a list have status "Completed".
 * @param {Array<{statusCode: number}>} tasks
 * @returns {number}
 */
function countCompletedTasks(tasks) {
    return tasks.filter((task) => task.statusCode === STATUS_COMPLETED).length;
}

/**
 * Get a human-readable label for a status code.
 * @param {number} statusCode
 * @returns {string}
 */
function getStatusLabel(statusCode) {
    return STATUS_LABELS[statusCode] ?? '';
}

// ─── Differential Rendering — Date Lists ─────────────────────

/**
 * Fast shallow comparison of two date-list objects.
 * Avoids full JSON.stringify by comparing task count, names, statuses, and descriptions.
 * @param {Object} prev - previous date-list snapshot
 * @param {Object} curr - current date-list snapshot
 * @returns {boolean} true if the date list has changed
 */
function dateListChanged(prev, curr) {
    if (prev.name !== curr.name) return true;
    const pTasks = prev.taskList;
    const cTasks = curr.taskList;
    if (pTasks.length !== cTasks.length) return true;
    for (let i = 0; i < cTasks.length; i++) {
        const p = pTasks[i];
        const c = cTasks[i];
        if (p.id !== c.id || p.name !== c.name || p.statusCode !== c.statusCode || p.desc !== c.desc) return true;
    }
    return false;
}

/** @type {string|null} Cached README markdown (fetched once) */
let readmeCache = null;

/**
 * Fetch the README markdown from docs/README.md (cached after first call).
 * @returns {Promise<string>}
 */
async function getReadmeMarkdown() {
    if (readmeCache !== null) { return readmeCache; }
    try {
        const res = await fetch('docs/README.md');
        if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
        readmeCache = await res.text();
    } catch (err) {
        console.error('main.js — README fetch failed:', err);
        readmeCache = '*Create your first date list to get started!*';
    }
    return readmeCache;
}

/**
 * Render the main date-list view. Uses differential updates:
 * only re-renders date lists that have actually changed.
 * @param {Array} dateLists - array of date-list objects from IndexedDB
 */
async function renderDateList(dateLists) {
    taskArray = sortByDate(dateLists).reverse();

    const container = document.getElementById('date-list-container');

    // Empty state — show README welcome card
    if (taskArray.length === 0) {
        previousDateListMap.clear();
        try {
            const md = await getReadmeMarkdown();
            const readmeHtml = marked.parse(md);
            container.innerHTML = `<div class="readme-welcome"><div class="prose">${sanitizeRichHTML(readmeHtml)}</div></div>`;
        } catch (err) {
            console.error('main.js — README render failed:', err);
            container.innerHTML = '<p class="p-4 text-secondary">Create a date list to get started.</p>';
        }
        return;
    }

    // Remove the welcome card if present
    const welcomeEl = container.querySelector('.readme-welcome');
    if (welcomeEl) welcomeEl.remove();

    const incomingIds = new Set(taskArray.map((dl) => dl.id));

    // Remove date lists that no longer exist
    for (const [existingId] of previousDateListMap) {
        if (!incomingIds.has(existingId)) {
            const existingEl = document.getElementById(`date-item-${existingId}`);
            if (existingEl) existingEl.remove();
            previousDateListMap.delete(existingId);
        }
    }

    // Add or update each date list
    for (const dateItem of taskArray) {
        const previousData = previousDateListMap.get(dateItem.id);
        const hasChanged = !previousData || dateListChanged(previousData, dateItem);

        if (hasChanged) {
            const existingEl = document.getElementById(`date-item-${dateItem.id}`);
            const newMarkup = buildDateListHTML(dateItem);

            if (existingEl) {
                // Preserve input field focus state before replacing
                const inputEl = existingEl.querySelector('.create-task-input');
                const hadFocus = document.activeElement === inputEl;

                existingEl.outerHTML = newMarkup;

                // Restore focus after DOM replacement (value is intentionally not restored
                // so that a successful task-add clears the field as expected)
                if (hadFocus) {
                    const restoredInput = document.getElementById(`todo-input-${dateItem.id}`);
                    if (restoredInput) restoredInput.focus();
                }
            } else {
                // New date list — insert in sorted position
                const insertIndex = taskArray.indexOf(dateItem);
                const children = container.children;

                if (insertIndex >= children.length) {
                    container.insertAdjacentHTML('beforeend', newMarkup);
                } else {
                    children[insertIndex].insertAdjacentHTML('beforebegin', newMarkup);
                }
            }

            previousDateListMap.set(dateItem.id, structuredClone(dateItem));
        }
    }
}

/**
 * Build the full HTML string for a single date list card.
 * @param {{id: string, name: string, taskList: Array}} dateItem
 * @returns {string}
 */
function buildDateListHTML(dateItem) {
    const completedCount = countCompletedTasks(dateItem.taskList);
    const totalCount = dateItem.taskList.length;
    const allDone = completedCount === totalCount && totalCount > 0;
    const checkIconClass = allDone ? 'solid fa-check text-primary' : 'solid fa-check';

    const tasksMarkup = dateItem.taskList.map((task) => buildTaskHTML(task)).join('');

    return `
        <div id="date-item-${dateItem.id}" class="mb-4 p-3 date-item${allDone ? ' date-item-done' : ''}">
            <div class="flex justify-between items-start">
                <div class="flex items-start">
                    <div class="grid">
                        <h4 class="mb-1">${escapeHTML(dateItem.name)}</h4>
                        <div class="flex items-center mb-2">
                            <p class="tasks-summary mb-0">${completedCount} tasks completed out of ${totalCount}</p>
                            <button type="button" class="btn btn-sm btn-no-bg-gray ml-1 mark-all-done-btn" value="${dateItem.id}">
                                <i class="fa-${checkIconClass}"></i>
                                <span class="btn-title">Mark All As Complete</span>
                            </button>
                        </div>
                    </div>
                    <button type="button" class="btn btn-sm btn-no-bg-gray ml-2 todo-date-delete" value="${dateItem.id}">
                        <i class="fa-solid fa-trash"></i>
                        <span class="btn-title">Delete Date List</span>
                    </button>
                </div>
                <div class="flex">
                    <div class="todo-input-form">
                        <input type="text" class="form-control create-task-input" id="todo-input-${dateItem.id}" placeholder="Add Task"
                            enterkeyhint="send" size="75">
                    </div>
                </div>
            </div>
            <ul class="list-group">
                ${tasksMarkup}
            </ul>
            <ul class="list-group drag-group mt-2">
                <li class="list-group-item drag-group-item" value="${dateItem.id}">
                    Drop task here
                </li>
            </ul>
        </div>`;
}

/**
 * Build the HTML for a single task list item.
 * @param {{id: string, name: string, statusCode: number, desc: string}} task
 * @returns {string}
 */
function buildTaskHTML(task) {
    const isTodo = task.statusCode === STATUS_TODO;
    const completedClass = isTodo ? '' : 'completed-task';
    const checkIcon = isTodo ? 'fa-circle' : 'fa-circle-check';
    const checkLabel = isTodo ? 'Mark As Complete' : 'Move to To-Do';
    const displayName = replaceURLs(escapeHTML(normalizeTaskName(task.name ?? '')));
    // Detect whether the task has rich-text notes for the detail-icon highlight
    const hasNotes = hasRichContent(task.desc);

    return `
        <li class="list-group-item flex items-center justify-between ${completedClass}"
            draggable="true" value="${task.id}" statuscode="${task.statusCode}">
            <div class="task-name-container w-full">
                <button type="button" class="btn btn-sm btn-no-bg todo-task-check" value="${task.id}" statusCode="${task.statusCode}">
                    <i class="fa-solid ${checkIcon}"></i>
                    <span class="btn-title">${checkLabel}</span>
                </button>
                <button type="button" class="btn btn-lite-sm btn-no-bg-gray mr-2 todo-task-detail ${hasNotes ? 'text-primary' : ''}" value="${task.id}">
                    <i class="fa-solid fa-up-right-from-square"></i>
                    <span class="btn-title">View</span>
                </button>
                <span class="task-name w-3/4">${displayName}</span>
            </div>
            <div class="flex">
                <button type="button" class="btn btn-lite-sm btn-no-bg-gray ml-2 todo-task-edit" value="${task.id}">
                    <i class="fa-solid fa-pencil"></i>
                    <span class="btn-title">Edit</span>
                </button>
                <button type="button" class="btn btn-lite-sm btn-no-bg-gray ml-2 todo-task-delete" value="${task.id}">
                    <i class="fa-solid fa-trash"></i>
                    <span class="btn-title">Delete</span>
                </button>
            </div>
        </li>`;
}

// ─── Differential Rendering — Date Nav ───────────────────────

/**
 * Render the left-hand date navigation panel.
 * Uses single-pass year→month→day grouping instead of O(n³) nested maps.
 * Skips re-render when the nav-relevant data (IDs + task counts) hasn't changed.
 * @param {Array} dateLists
 */
let _prevNavFingerprint = '';
const dateNavContent = document.getElementById('date-nav-content');

function renderDateNav(dateLists) {
    // Quick fingerprint: id + completed/total for each date list
    const fingerprint = dateLists.map(d => `${d.id}:${countCompletedTasks(d.taskList)}/${d.taskList.length}`).join('|');
    if (fingerprint === _prevNavFingerprint) return;
    _prevNavFingerprint = fingerprint;

    if (!dateNavContent) return;

    // Empty state
    if (dateLists.length === 0) {
        dateNavContent.innerHTML = `<div class="p-3 sidebar-empty-state">
            <p class="font-semibold mb-1 sidebar-empty-state-title">Get Started</p>
            <p>Pick a date and click <strong>+</strong> to create your first date list.</p>
        </div>`;
        return;
    }

    const sorted = sortByDate(dateLists).reverse();
    const todayStr = new Date().toLocaleDateString('fr-CA'); // "YYYY-MM-DD"

    // Single-pass: group by year → month
    const yearGroups = new Map();

    for (const dateItem of sorted) {
        const dateObj = new Date(dateItem.id);
        const year = dateObj.getFullYear();
        const month = dateObj.getMonth();
        const monthName = dateObj.toLocaleString('default', { month: 'long' });

        if (!yearGroups.has(year)) {
            yearGroups.set(year, new Map());
        }
        const monthGroups = yearGroups.get(year);

        if (!monthGroups.has(month)) {
            monthGroups.set(month, { name: monthName, days: [] });
        }
        monthGroups.get(month).days.push(dateItem);
    }

    // Build nav HTML from grouped data
    const navParts = [];
    for (const [year, monthGroups] of yearGroups) {
        const monthParts = [];
        for (const [, { name: monthName, days }] of monthGroups) {
            const dayParts = days.map((dateItem) => {
                const isToday = dateItem.id === todayStr;
                return buildNavDayItem(dateItem, isToday);
            });

            const firstDayId = days[0].id;
            monthParts.push(`<div class="ml-1 mt-1">
                <a class="nav-sidebar-heading" href="#date-item-${firstDayId}">${monthName}</a>
                ${dayParts.join('')}
            </div>`);
        }

        const firstMonthDays = [...monthGroups.values()][0].days;
        navParts.push(`<div class="mb-2">
            <a class="nav-sidebar-year" href="#date-item-${firstMonthDays[0].id}">${year}</a>
            ${monthParts.join('')}
        </div>`);
    }

    dateNavContent.innerHTML = navParts.join('');
}

/**
 * Build HTML for a single day entry in the nav sidebar.
 * @param {{id: string, name: string, taskList: Array}} dateItem
 * @param {boolean} isToday
 * @returns {string}
 */
function buildNavDayItem(dateItem, isToday) {
    const completed = countCompletedTasks(dateItem.taskList);
    const total = dateItem.taskList.length;
    const incomplete = completed !== total;

    return `
        <div class="flex items-center border-l ml-1 nav-day-border">
            <a class="nav-sidebar-day ${isToday ? 'btn-no-bg-gray-active' : ''}"
               href="#date-item-${dateItem.id}">
                ${dateItem.name}
                <span class="nav-sidebar-count">
                    (${completed}/${total})${incomplete ? '<span class="nav-sidebar-dot">⬤</span>' : ''}
                </span>
            </a>
        </div>`;
}

// ─── Task Detail View ────────────────────────────────────────

/**
 * Build the offcanvas detail view HTML for a task.
 * Renders the rich-text (contenteditable) editor with RTF toolbar.
 * @param {{id: string, name: string, desc: string, dateName: string}} task
 * @returns {string}
 */
function renderTaskDetailHTML(task) {
    return `
        <div id="task-detail-title-container" class="offcanvas-header border-b justify-between">
            <div class="flex flex-col task-detail-title w-full">
                <h5 class="offcanvas-title">${replaceURLs(escapeHTML(normalizeTaskName(task.name ?? '')))}</h5>
                <p class="tasks-summary mb-0">${escapeHTML(task.dateName || '')}</p>
            </div>
            <div class="flex">
                <button type="button" class="btn btn-lite-sm btn-no-bg-gray ml-2 todo-task-edit" value="${task.id}">
                    <i class="fa-solid fa-pencil"></i>
                    <span class="btn-title">Edit</span>
                </button>
                <button type="button" class="btn btn-lite-sm btn-no-bg-gray ml-2 todo-task-delete" value="${task.id}">
                    <i class="fa-solid fa-trash"></i>
                    <span class="btn-title">Delete</span>
                </button>
                <button type="button" class="btn btn-lite-sm btn-no-bg-gray ml-2" data-bs-dismiss="offcanvas" aria-label="Close">
                    <i class="fa-solid fa-xmark"></i>
                    <span class="btn-title">Close</span>
                </button>
            </div>
        </div>
        <div id="task-detail-body" class="offcanvas-body">
            ${createRTFToolbar()}
            <div id="task-notes-area-parent">
                <section id="task-notes-area" class="prose" contenteditable="true" value="${task.id}">
                    ${task.desc}
                </section>
            </div>
        </div>`;
}

// ─── CRUD Operations ─────────────────────────────────────────

/**
 * Delete a date list.
 * @param {string} dateId
 */
async function deleteDateList(dateId) {
    try {
        await TodoService.deleteDateList(dateId);
        setMessageState('success', 'Date list deleted successfully!');
        await refreshUI();
    } catch (error) {
        console.error("deleteDateList — failed:", error);
        setMessageState('failure', 'Error deleting date list');
    }
}

/**
 * Create a new task under a date list.
 * @param {string} taskName
 * @param {string} dateId
 * @param {HTMLElement|null} inputElement - the input to re-focus after creation
 * @param {string} desc
 * @param {number} [statusCode=1001]
 */
async function createTask(taskName, dateId, inputElement, desc, statusCode) {
    if (taskName === '') {
        setMessageState('failure', 'Task name cannot be empty.');
        return;
    }

    const newTask = {
        id: `Task-${dateId}-${Date.now()}`,
        name: normalizeTaskName(taskName),
        statusCode: statusCode || STATUS_TODO,
        desc: desc || '',
    };

    try {
        await TodoService.addTask(dateId, newTask);
        setMessageState('success', 'Task created successfully!');
        await refreshUI();
        // Clear and re-focus the input field so the user can keep adding tasks
        if (inputElement) {
            inputElement.value = '';
            inputElement.focus();
        }
    } catch (error) {
        console.error("createTask — failed:", error);
        setMessageState('failure', 'Error creating task');
    }
}

/**
 * Move one task between date lists while preserving notes and metadata.
 * The underlying service regenerates the task ID so it matches the target date.
 * @param {string} sourceDateId
 * @param {string} targetDateId
 * @param {string} taskId
 * @returns {Promise<boolean>}
 */
async function moveTaskBetweenDates(sourceDateId, targetDateId, taskId) {
    try {
        const result = await TodoService.moveTasks(sourceDateId, targetDateId, [taskId]);
        if (!result.moved) {
            setMessageState('failure', 'No matching task found to move.');
            return false;
        }
        setMessageState('success', 'Task moved successfully!');
        await refreshUI();
        return true;
    } catch (error) {
        console.error("moveTaskBetweenDates — failed:", error);
        setMessageState('failure', 'Error moving task');
        return false;
    }
}

/**
 * Delete a single task from a date list.
 * @param {string} dateId
 * @param {string} taskId - suffix portion of the full task ID
 * @returns {Promise<boolean>} true if deleted successfully
 */
async function deleteTasks(dateId, taskId) {
    try {
        await TodoService.deleteTask(dateId, taskId);
        setMessageState('success', 'Task deleted successfully!');
        await refreshUI();
        return true;
    } catch (error) {
        console.error("deleteTasks — failed:", error);
        setMessageState('failure', 'Error deleting task');
        return false;
    }
}

/**
 * Update a single task's name, status, or description.
 * @param {string} dateId
 * @param {string} taskId - suffix portion of the full task ID
 * @param {string} taskName - new name (or '' to skip)
 * @param {number|string} taskStatusCode - new status (or '' to skip)
 * @param {boolean|string} taskDetails - true to save notes area HTML
 */
async function updateTasks(dateId, taskId, taskName, taskStatusCode, taskDetails) {
    const updates = {};
    if (taskName !== '') updates.name = normalizeTaskName(taskName);
    if (taskStatusCode !== '') updates.statusCode = taskStatusCode;
    if (taskDetails === true) {
        // Save sanitized rich-text HTML from the contenteditable area
        const notesArea = document.getElementById('task-notes-area');
        updates.desc = normalizeRichHTML(sanitizeRichHTML(notesArea?.innerHTML ?? ''));
    }

    try {
        await TodoService.updateTask(dateId, taskId, updates);
        setMessageState('success', 'Task updated successfully!');
        await refreshUI();
        const taskObj = findTask(dateId, taskId);
        // Refresh the detail view with updated data
        const detailContainer = document.getElementById('task-detail-container');
        detailContainer.innerHTML = renderTaskDetailHTML(taskObj);
    } catch (error) {
        console.error("updateTasks — failed:", error);
        setMessageState('failure', 'Error updating task');
    }
}

/**
 * Find a task object within taskArray by dateId and taskId suffix.
 * @param {string} dateId
 * @param {string} taskId
 * @returns {{id: string, name: string, statusCode: number, desc: string, dateName: string}}
 */
function findTask(dateId, taskId) {
    let foundTask = null;
    let dateName = '';

    for (const dateItem of taskArray) {
        if (dateItem.id === dateId) {
            dateName = dateItem.name;
            for (const task of dateItem.taskList) {
                if (task.id.slice(TASK_ID_OFFSET) === taskId) {
                    foundTask = task;
                    break;
                }
            }
            break;
        }
    }

    if (foundTask) {
        foundTask.dateName = dateName;
    }
    return foundTask;
}

// ─── Date List Creation ──────────────────────────────────────

/**
 * Create a new empty date list.
 * @param {string} dateId - "YYYY-MM-DD"
 * @param {string} dateName - human-readable date name
 */
async function createDateList(dateId, dateName) {
    try {
        const existing = await TodoService.getDateList(dateId);
        if (existing) {
            setMessageState('success', 'Date list already exists.');
            return;
        }

        const newDateList = {
            id: dateId,
            name: dateName,
            taskList: [],
            statusCode: STATUS_TODO,
        };

        await TodoService.saveDateList(newDateList);
        setMessageState('success', 'Date list successfully created!');
        await refreshUI();
    } catch (error) {
        console.error("createDateList — failed:", error);
        setMessageState('failure', 'Error creating date list');
    }
}

// ─── Multi-Select & Bulk Operations ─────────────────────────

/**
 * Gather all Ctrl+click-selected task items.
 * @returns {Array<{dateId: string, taskId: string, statusCode: string}>}
 */
function getSelectedList() {
    const selected = [];
    document.querySelectorAll('.list-group-item-selected').forEach((el) => {
        const value = el.getAttribute('value');
        selected.push({
            dateId: value.slice(DATE_ID_START, DATE_ID_END),
            taskId: value.slice(TASK_ID_OFFSET),
            statusCode: el.getAttribute('statuscode'),
        });
    });
    return selected;
}

/**
 * Batch-delete all selected tasks, grouped by date list for efficiency.
 */
async function deleteSelectedList() {
    document.getElementById('context-menu').style.display = 'none';

    const selected = getSelectedList();
    if (!selected.length) return;

    // Group by dateId for batch operations
    const grouped = new Map();
    for (const { dateId, taskId } of selected) {
        if (!grouped.has(dateId)) grouped.set(dateId, []);
        grouped.get(dateId).push(taskId);
    }

    try {
        for (const [dateId, taskIds] of grouped) {
            await TodoService.batchDeleteTasks(dateId, taskIds);
        }
        setMessageState('success', `Deleted ${selected.length} task(s) successfully!`);
        await refreshUI();
    } catch (error) {
        console.error("deleteSelectedList — failed:", error);
        setMessageState('failure', 'Error deleting selected tasks');
    }

    document.querySelectorAll('.list-group-item-selected').forEach(el => el.classList.remove('list-group-item-selected'));
}

/**
 * Batch-toggle done/undone for all selected tasks, grouped by date list.
 */
async function doneSelectedList() {
    document.getElementById('context-menu').style.display = 'none';

    const selected = getSelectedList();
    if (!selected.length) return;

    // Group by dateId for batch operations
    const grouped = new Map();
    for (const { dateId, taskId, statusCode } of selected) {
        if (!grouped.has(dateId)) grouped.set(dateId, []);
        const newStatus = Number(statusCode) === STATUS_TODO ? STATUS_COMPLETED : STATUS_TODO;
        grouped.get(dateId).push({ taskId, updates: { statusCode: newStatus } });
    }

    try {
        for (const [dateId, taskUpdates] of grouped) {
            await TodoService.batchUpdateTasks(dateId, taskUpdates);
        }
        setMessageState('success', `Updated ${selected.length} task(s) successfully!`);
        await refreshUI();
    } catch (error) {
        console.error("doneSelectedList — failed:", error);
        setMessageState('failure', 'Error updating selected tasks');
    }

    document.querySelectorAll('.list-group-item-selected').forEach(el => el.classList.remove('list-group-item-selected'));
}

/**
 * Mark all incomplete tasks in a date list as completed.
 * @param {string} dateId
 */
async function markAllAsDone(dateId) {
    const dateList = taskArray.find((dl) => dl.id === dateId);
    if (!dateList) return;

    // Collect tasks that are not yet completed
    const taskUpdates = dateList.taskList
        .filter((task) => task.statusCode !== STATUS_COMPLETED)
        .map((task) => ({ taskId: task.id.slice(TASK_ID_OFFSET), updates: { statusCode: STATUS_COMPLETED } }));

    if (!taskUpdates.length) return;

    try {
        await TodoService.batchUpdateTasks(dateId, taskUpdates);
        setMessageState('success', `Marked ${taskUpdates.length} task(s) as completed!`);
        await refreshUI();
    } catch (error) {
        console.error("markAllAsDone — failed:", error);
        setMessageState('failure', 'Error marking tasks as completed');
    }
}

// ─── Exports ─────────────────────────────────────────────────

export {
    taskArray,
    bsOffcanvas,
    STATUS_TODO,
    STATUS_COMPLETED,
    createTask,
    deleteTasks,
    updateTasks,
    deleteDateList,
    findTask,
    setMessageState,
    renderTaskDetailHTML,
    getSelectedList,
    deleteSelectedList,
    doneSelectedList,
    markAllAsDone,
    createDateList,
    moveTaskBetweenDates,
    refreshUI,
};
