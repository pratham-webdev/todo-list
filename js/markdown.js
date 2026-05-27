// ============================================================
// markdown.js — Markdown Reader: live preview with marked.js
//   Features: live parse, drag-and-drop file import, IndexedDB
//   persistence via TodoService.
// ============================================================

import { sanitizeRichHTML } from './utils.js';
import { TodoService } from './todo-service.js';

// ─── Constants ───────────────────────────────────────────────

/** Debounce delay (ms) for input → render + save */
const DEBOUNCE_MS = 200;

/** File extensions accepted for drag-and-drop / file picker */
const ACCEPTED_EXTENSIONS = ['.md', '.markdown', '.txt'];

// ─── DOM References ──────────────────────────────────────────

/** @type {HTMLTextAreaElement} */
const mdInput = document.getElementById('md-input');
/** @type {HTMLDivElement} */
const mdOutput = document.getElementById('md-output');
/** @type {HTMLButtonElement} */
const openFileBtn = document.getElementById('md-open-file');
/** @type {HTMLButtonElement} */
const clearBtn = document.getElementById('md-clear');
/** @type {HTMLDivElement} */
const editorContainer = document.querySelector('.md-editor');

// ─── Marked Configuration ────────────────────────────────────

marked.setOptions({
    breaks: true,
    gfm: true,
});

// ─── Render Logic ────────────────────────────────────────────

/** @type {number|null} Debounce timer ID */
let debounceTimer = null;

/**
 * Parse the textarea markdown and render sanitized HTML into the preview pane.
 * @returns {void}
 */
function renderPreview() {
    const raw = mdInput.value;
    if (!raw.trim()) {
        mdOutput.innerHTML = '<p class="text-secondary md-placeholder">Preview will appear here...</p>';
        return;
    }
    try {
        const html = marked.parse(raw);
        mdOutput.innerHTML = sanitizeRichHTML(html);
    } catch (err) {
        console.error('markdown.js — render failed:', err);
        mdOutput.textContent = 'Error rendering markdown.';
    }
}

/**
 * Debounced input handler — waits DEBOUNCE_MS after last keystroke
 * before rendering the preview and persisting the draft.
 * @returns {void}
 */
function onInput() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        renderPreview();
        saveDraft();
    }, DEBOUNCE_MS);
}

// ─── IndexedDB Draft Persistence ─────────────────────────────

/**
 * Save the current textarea content to IndexedDB as a draft.
 * Failures are logged but do not interrupt the user.
 * @returns {Promise<void>}
 */
async function saveDraft() {
    try {
        await TodoService.saveMarkdownDraft(mdInput.value);
    } catch (err) {
        console.error('markdown.js — saveDraft failed:', err);
    }
}

/**
 * Load a previously saved draft from IndexedDB and populate the textarea.
 * @returns {Promise<void>}
 */
async function loadDraft() {
    try {
        const draft = await TodoService.getMarkdownDraft();
        if (draft?.content) {
            mdInput.value = draft.content;
            renderPreview();
            return;
        }
    } catch (err) {
        console.error('markdown.js — loadDraft failed:', err);
    }
    // No saved draft — load the welcome README as default content
    try {
        const res = await fetch('docs/README.md');
        if (res.ok) {
            mdInput.value = await res.text();
            renderPreview();
        }
    } catch (err) {
        console.error('markdown.js — welcome README fetch failed:', err);
    }
}

// ─── File Import ─────────────────────────────────────────────

/**
 * Read a File object as text and populate the editor.
 * @param {File} file
 * @returns {Promise<void>}
 */
async function loadFileContent(file) {
    try {
        mdInput.value = await file.text();
        renderPreview();
        await saveDraft();
    } catch (err) {
        console.error('markdown.js — loadFileContent failed:', err);
    }
}

/**
 * Check whether a filename has an accepted markdown extension.
 * @param {string} name - file name
 * @returns {boolean}
 */
function isAcceptedFile(name) {
    const lower = name.toLowerCase();
    return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Open a .md file using the File System Access API (with fallback).
 * @returns {Promise<void>}
 */
async function openFile() {
    try {
        if (window.showOpenFilePicker) {
            const [handle] = await window.showOpenFilePicker({
                types: [{ description: 'Markdown', accept: { 'text/markdown': ACCEPTED_EXTENSIONS } }],
                multiple: false,
            });
            const file = await handle.getFile();
            await loadFileContent(file);
        } else {
            // Fallback for browsers without showOpenFilePicker
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = ACCEPTED_EXTENSIONS.join(',');
            input.addEventListener('change', async () => {
                const file = input.files?.[0];
                if (file) await loadFileContent(file);
            });
            input.click();
        }
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('markdown.js — file open failed:', err);
        }
    }
}

// ─── Drag & Drop ─────────────────────────────────────────────

/** @type {number} Tracks nested dragenter/dragleave pairs */
let dragCounter = 0;

/**
 * Handle dragenter — show visual feedback.
 * @param {DragEvent} e
 */
function onDragEnter(e) {
    e.preventDefault();
    dragCounter++;
    editorContainer.classList.add('md-editor-dragover');
}

/**
 * Handle dragover — required to allow drop.
 * @param {DragEvent} e
 */
function onDragOver(e) {
    e.preventDefault();
    // Indicate a copy operation in the drag cursor
    e.dataTransfer.dropEffect = 'copy';
}

/**
 * Handle dragleave — remove visual feedback when cursor exits.
 * @param {DragEvent} e
 */
function onDragLeave(e) {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
        dragCounter = 0;
        editorContainer.classList.remove('md-editor-dragover');
    }
}

/**
 * Handle drop — read the first accepted file and populate the editor.
 * @param {DragEvent} e
 */
async function onDrop(e) {
    e.preventDefault();
    dragCounter = 0;
    editorContainer.classList.remove('md-editor-dragover');

    try {
        const files = e.dataTransfer?.files;
        if (!files?.length) return;

        // Find the first file with an accepted extension
        const file = [...files].find((f) => isAcceptedFile(f.name));
        if (file) {
            await loadFileContent(file);
        } else {
            console.warn('markdown.js — dropped file type not supported');
        }
    } catch (err) {
        console.error('markdown.js — drop handler failed:', err);
    }
}

// ─── Clear ───────────────────────────────────────────────────

/**
 * Clear the editor textarea, reset preview, and delete persisted draft.
 * @returns {Promise<void>}
 */
async function clearEditor() {
    mdInput.value = '';
    renderPreview();
    try {
        await TodoService.deleteMarkdownDraft();
    } catch (err) {
        console.error('markdown.js — clearEditor draft delete failed:', err);
    }
}

// ─── Event Bindings ──────────────────────────────────────────

mdInput.addEventListener('input', onInput);
openFileBtn.addEventListener('click', openFile);
clearBtn.addEventListener('click', clearEditor);

// Drag-and-drop events on the editor container
editorContainer.addEventListener('dragenter', onDragEnter);
editorContainer.addEventListener('dragover', onDragOver);
editorContainer.addEventListener('dragleave', onDragLeave);
editorContainer.addEventListener('drop', onDrop);

// ─── Initialisation ──────────────────────────────────────────

// Load persisted draft (if any) on page load
loadDraft();
