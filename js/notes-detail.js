// ============================================================
// notes-detail.js — Notes page: rendering, CRUD, and sections
// ============================================================

import { TodoService } from "./todo-service.js";
import { escapeHTML, sanitizeRichHTML, normalizeRichHTML } from "./utils.js";
import { createRTFToolbar, commonButtonClasses } from "./notes-common.js";
import { STATUS_TODO } from "./task-helpers.js";
import { exportNotesJSON, importNotesJSON as _importNotesJSON } from "./notes-io.js";

// ─── Globals (formerly in notes-variables.js) ────────────────

/** @type {Array<{id: string, name: string, status: number, html: string}>} */
let notesArray = [];

/** Default note ID used when no pages exist yet */
const DEFAULT_NOTE_ID = 'notes-area-0000001';

/** Default HTML for a brand-new note page */
const DEFAULT_NOTE_HTML = '<div id="sections-area-default" class="sections-area"><h2>Welcome to Notes!</h2></div>';

// ─── App Initialisation ──────────────────────────────────────

/**
 * Bootstrap the notes page: load notes from IndexedDB and render.
 * @returns {Promise<void>}
 */
async function initApp() {
    try {
        notesArray = await TodoService.getAllNotes();

        // Seed a default note if none exist yet
        if (!notesArray || notesArray.length === 0) {
            const defaultNote = {
                id: DEFAULT_NOTE_ID,
                name: 'Default',
                status: STATUS_TODO,
                html: DEFAULT_NOTE_HTML,
            };
            await TodoService.saveNote(defaultNote);
            notesArray = [defaultNote];
        }

        // Determine which page to display
        const pageToShow = notesArray.find((n) => n.id === DEFAULT_NOTE_ID) || notesArray[0];

        if (pageToShow) {
            renderNotesDetailHTML(pageToShow);
            createPageTabs(notesArray, pageToShow.id);
        }
    } catch (error) {
        console.error('notes-detail.js — initApp failed:', error);
    }
}

// ─── Toaster / Persistence Helpers ───────────────────────────

/**
 * Flash the "saved" toaster message for 3 seconds.
 * Uses CSS class toggle instead of inline style.
 * @returns {void}
 */
function showSavedToaster() {
    const toaster = document.getElementById('saved-box-message');
    if (toaster) {
        toaster.classList.add('toaster-visible');
        setTimeout(() => { toaster.classList.remove('toaster-visible'); }, 3000);
    }
}

/**
 * Persist a single note object to IndexedDB and show the saved toaster.
 * @param {{id: string, name: string, status: number, html: string}} note
 */
async function saveSingleNoteToDB(note) {
    try {
        await TodoService.saveNote(note);
        showSavedToaster();
    } catch (error) {
        console.error('notes-detail.js — saveSingleNoteToDB failed:', error);
    }
}

// ─── Rendering ───────────────────────────────────────────────

/**
 * Render the full notes detail view for a given page object.
 * @param {{id: string, name: string, html: string}} page
 */
function renderNotesDetailHTML(page) {
    const titleEl = document.getElementById('notes-detail-title');
    if (titleEl) titleEl.textContent = page.name;

    const detailHTML = `
        <div id="notes-detail-title-container">
            ${createRTFToolbar()}
        </div>
        <div class="notes-detail-pages-container">
            <button id="createPage" class="btn btn-lite-sm-2x btn-no-bg-gray">
                <i class="fa-solid fa-file-lines"></i>
                <span class="btn-title">Add Page</span>
            </button>
            <button id="importPage" class="btn btn-lite-sm-2x btn-no-bg-gray">
                <i class="fa-solid fa-upload"></i>
                <span class="btn-title">Import Page</span>
            </button>
            <div id="notes-detail-pages-tab-container"></div>
        </div>
        <div id="notes-detail-body">
            <div id="notes-detail-area-parent">
                <div class="notes-detail-section-toggle-container"></div>
                <section id="notes-detail-area" class="prose" contenteditable="true" value="${page.id}">
                    ${sanitizeRichHTML(page.html)}
                </section>
            </div>
        </div>`;

    const detailContainerEl = document.getElementById('notes-detail-container');
    if (detailContainerEl) detailContainerEl.innerHTML = detailHTML;
    createPageTabs(notesArray, page.id);
    createSections();
}

// ─── Sections ────────────────────────────────────────────────

/**
 * Build and render the section toggle sidebar from .sections-area elements.
 * @returns {void}
 */
function createSections() {
    const sectionElements = document.getElementsByClassName('sections-area');
    const sectionToggles = [];

    for (let i = 0; i < sectionElements.length; i++) {
        const sectionId = sectionElements[i].id;
        const h2El = sectionElements[i].querySelector('h2');
        const sectionTitle = h2El ? h2El.textContent : '';
        const isHidden = sectionElements[i].classList.contains('hidden');

        sectionToggles.push(`
            <div class="btn btn-lite-sm btn-no-bg section-toggle-btn"
                 tabindex="0" value="${sectionId}" index="${i}">
                ${escapeHTML(sectionTitle)}
                <div class="section-toggle-icons">
                    <button class="${commonButtonClasses} edit-section-md">
                        <i class="fa-brands fa-markdown"></i>
                    </button>
                    <button class="${commonButtonClasses} hide-section ${isHidden ? 'section-hidden' : ''}">
                        <i class="fa-solid ${isHidden ? 'fa-eye-slash' : 'fa-eye'}"></i>
                    </button>
                </div>
            </div>`);
    }

    const addButtonsHTML = `
        <div class="notes-area-section-toggle-heading-container flex items-center justify-between">
            <h6>Sections</h6>
            <div class="notes-area-section-toggle-heading-icons">
                <button class="${commonButtonClasses} add-sections-box" value="up">
                    <i class="fa-solid fa-square-caret-up"></i>
                    <span class="btn-title">Add Section Top</span>
                </button>
                <button class="${commonButtonClasses} add-sections-box" value="down">
                    <i class="fa-solid fa-square-caret-down"></i>
                    <span class="btn-title">Add Section Bottom</span>
                </button>
            </div>
        </div>`;

    const container = document.querySelector('.notes-detail-section-toggle-container');
    if (container) {
        container.innerHTML = addButtonsHTML + sectionToggles.join('');
    }
}

/**
 * Add a new section to the notes area (top or bottom).
 * @param {'up'|'down'} position
 */
function addSections(position) {
    const editor = document.getElementById('notes-detail-area');
    if (!editor) return;
    const pageId = editor.getAttribute('value');
    const sectionId = `sections-area-${Date.now()}`;
    const sectionHTML = `<div id="${sectionId}" class="sections-area"><h2>New Section</h2></div>`;

    if (position === 'up') {
        editor.insertAdjacentHTML('afterbegin', sectionHTML);
    } else {
        editor.insertAdjacentHTML('beforeend', sectionHTML);
    }

    saveText(pageId, true, false);
}

/**
 * Move a section up or down within the notes editor.
 * @param {string} sectionId - DOM id of the .sections-area div
 * @param {'up'|'down'} direction
 */
function moveSection(sectionId, direction) {
    const sectionEl = document.getElementById(sectionId);
    if (!sectionEl) return;

    const editor = document.getElementById('notes-detail-area');
    if (!editor) return;

    const sections = [...editor.querySelectorAll('.sections-area')];
    const index = sections.indexOf(sectionEl);
    if (index === -1) return;

    if (direction === 'up' && index > 0) {
        sectionEl.parentNode.insertBefore(sectionEl, sections[index - 1]);
    } else if (direction === 'down' && index < sections.length - 1) {
        sectionEl.parentNode.insertBefore(sections[index + 1], sectionEl);
    } else {
        return; // already at boundary
    }

    const pageId = editor.getAttribute('value');
    saveText(pageId, true, false);
    createSections();
}

/**
 * Delete a section after user confirmation.
 * @param {string} sectionId - DOM id of the .sections-area div
 */
function deleteSection(sectionId) {
    const sectionEl = document.getElementById(sectionId);
    if (!sectionEl) return;

    const confirmed = confirm('Are you sure you want to delete this section?');
    if (!confirmed) return;

    const editor = document.getElementById('notes-detail-area');
    sectionEl.remove();

    if (editor) {
        const pageId = editor.getAttribute('value');
        saveText(pageId, true, false);
        createSections();
    }
}

// ─── Page CRUD ───────────────────────────────────────────────

/**
 * Create a new notes page.
 * @param {string} [importedHTML] - pre-filled HTML content (for imports)
 * @param {string} [importedName] - pre-filled name (for imports)
 */
async function createPage(importedHTML, importedName) {
    const pageCount = document.querySelectorAll('.page-tab').length;
    const pageName = importedName || prompt('Enter page name', `Page ${pageCount + 1}`);
    if (pageName === null) return;

    const newPageId = `notes-area-${Date.now()}`;
    const newPage = {
        id: newPageId,
        name: pageName,
        status: STATUS_TODO,
        html: importedHTML || `<div id="sections-area-default" class="sections-area"><h2>${escapeHTML(pageName)}</h2></div>`,
    };

    notesArray.push(newPage);
    await saveSingleNoteToDB(newPage);
    renderNotesDetailHTML(newPage);
    createPageTabs(notesArray, newPageId);
}

/**
 * Build and render page tabs in the sidebar navigation.
 * @param {Array<{id: string, name: string}>} pages - full notesArray
 * @param {string|null} activePageId - ID of the currently active page
 * @returns {void}
 */
function createPageTabs(pages, activePageId) {
    const tabsHTML = pages.map((page) => {
        const isActive = activePageId === page.id ? 'btn-no-bg-gray-active' : '';
        return `<button id="${page.id}" class="${commonButtonClasses} page-tab ${isActive}">${escapeHTML(page.name)}</button>`;
    });

    const tabContainer = document.getElementById('notes-detail-pages-tab-container');
    if (tabContainer) tabContainer.innerHTML = tabsHTML.join('');
}

/**
 * Delete a notes page after user confirmation.
 * @param {string} pageId
 */
async function deletePage(pageId) {
    const confirmed = confirm('Are you sure you want to delete this page?');
    if (!confirmed) return;

    const activeTabId = document.querySelector('#notes-detail-pages-tab-container .btn-no-bg-gray-active')?.id;
    const fallbackId = activeTabId === pageId ? DEFAULT_NOTE_ID : activeTabId;

    notesArray = notesArray.filter((page) => page.id !== pageId);

    try {
        await TodoService.deleteNote(pageId);
    } catch (error) {
        console.error('notes-detail.js — deletePage failed:', error);
    }

    createPageTabs(notesArray, fallbackId);
    const fallbackPage = findPage(fallbackId);
    if (fallbackPage) renderNotesDetailHTML(fallbackPage);
}

/**
 * Find a notes page object by ID.
 * @param {string} pageId
 * @returns {Object|undefined}
 */
function findPage(pageId) {
    return notesArray.find((page) => page.id === pageId);
}

// ─── Save Logic ──────────────────────────────────────────────

/**
 * Save the current notes editor content and/or rename a page.
 * @param {string} pageId
 * @param {boolean} shouldSaveHTML - true to persist the editor innerHTML
 * @param {string|false} newName - new page name, or false to keep current
 */
async function saveText(pageId, shouldSaveHTML, newName) {
    const editor = document.getElementById('notes-detail-area');
    const editorHTML = normalizeRichHTML(sanitizeRichHTML(editor?.innerHTML ?? ''));

    // Write normalized HTML back so the visible DOM matches what's saved
    if (shouldSaveHTML && editor) editor.innerHTML = editorHTML;

    notesArray = notesArray.map((page) => {
        if (page.id !== pageId) return page;
        return {
            id: page.id,
            name: newName === false ? page.name : newName,
            status: page.status,
            html: shouldSaveHTML === true ? editorHTML : page.html,
        };
    });

    const updatedNote = notesArray.find((n) => n.id === pageId);
    if (updatedNote) await saveSingleNoteToDB(updatedNote);

    createSections();

    // Refresh tabs if the page was renamed
    if (newName !== false) {
        const activeTab = document.querySelector('#notes-detail-pages-tab-container .btn-no-bg-gray-active');
        createPageTabs(notesArray, activeTab?.id);
    }
}

// ─── JSON Import / Export ────────────────────────────────────
// exportNotesJSON is imported from notes-io.js and re-exported as-is.
// importNotesJSON wraps notes-io.js to refresh the in-memory state and UI.

/**
 * Import notes pages from a JSON file, then refresh the notes UI.
 */
function importNotesJSON() {
    _importNotesJSON(async () => {
        notesArray = await TodoService.getAllNotes();
        const pageToShow = notesArray.find((n) => n.id === DEFAULT_NOTE_ID) || notesArray[0];
        if (pageToShow) {
            renderNotesDetailHTML(pageToShow);
            createPageTabs(notesArray, pageToShow.id);
        }
    });
}

// ─── Markdown Section Modal ──────────────────────────────────

/** @type {HTMLDialogElement|null} */
const mdModal = document.getElementById('md-section-modal');
/** @type {HTMLTextAreaElement|null} */
const mdInput = document.getElementById('md-section-input');
/** @type {HTMLDivElement|null} */
const mdOutput = document.getElementById('md-section-output');
/** @type {HTMLHeadingElement|null} */
const mdTitle = document.getElementById('md-section-modal-title');

/**
 * Open the markdown section editor modal for a given section.
 * Converts the section's HTML to markdown via TurndownService,
 * populates the textarea and renders an initial preview.
 *
 * @param {string} sectionId - DOM id of the target .sections-area element
 * @returns {void}
 */
function openMdModal(sectionId) {
    if (!mdModal || !mdInput || !mdOutput) return;

    const sectionEl = document.getElementById(sectionId);
    if (!sectionEl) {
        console.error('notes-detail.js — openMdModal: section not found:', sectionId);
        return;
    }

    // Store target section id on the dialog for later retrieval
    mdModal.dataset.sectionId = sectionId;

    // Extract inner HTML excluding the <h2> heading
    const h2 = sectionEl.querySelector('h2');
    const headingText = h2?.textContent ?? '';
    mdTitle.textContent = `Edit Section: ${headingText}`;

    // Clone the section and remove <h2> to get body content only
    const clone = sectionEl.cloneNode(true);
    clone.querySelector('h2')?.remove();
    const bodyHTML = clone.innerHTML.trim();

    // Convert HTML → Markdown via Turndown
    try {
        const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
        mdInput.value = bodyHTML ? turndownService.turndown(bodyHTML) : '';
    } catch (error) {
        console.error('notes-detail.js — openMdModal turndown failed:', error);
        mdInput.value = bodyHTML;
    }

    // Render initial preview
    renderMdPreview();

    mdModal.showModal();
}

/**
 * Render the markdown preview from the textarea content.
 * Uses marked.parse() + sanitizeRichHTML() for safe output.
 * @returns {void}
 */
function renderMdPreview() {
    if (!mdInput || !mdOutput) return;

    const raw = mdInput.value;
    if (!raw.trim()) {
        mdOutput.innerHTML = '<p class="text-secondary md-placeholder">Preview will appear here…</p>';
        return;
    }

    try {
        const html = marked.parse(raw);
        mdOutput.innerHTML = sanitizeRichHTML(html);
    } catch (error) {
        console.error('notes-detail.js — renderMdPreview failed:', error);
        mdOutput.textContent = 'Error rendering markdown.';
    }
}

/**
 * Apply the markdown editor content back to the target section.
 * Parses markdown → HTML, injects into the section (preserving <h2>),
 * closes the modal, and saves the page.
 * @returns {Promise<void>}
 */
async function applyMdToSection() {
    if (!mdModal || !mdInput) return;

    const sectionId = mdModal.dataset.sectionId;
    if (!sectionId) return;

    const sectionEl = document.getElementById(sectionId);
    if (!sectionEl) {
        console.error('notes-detail.js — applyMdToSection: section not found:', sectionId);
        return;
    }

    try {
        // Parse markdown → sanitized HTML
        const html = sanitizeRichHTML(marked.parse(mdInput.value));

        // Preserve the <h2> heading, replace everything after it
        const h2 = sectionEl.querySelector('h2');
        sectionEl.innerHTML = '';
        if (h2) sectionEl.appendChild(h2);

        // Insert the parsed HTML after the heading
        sectionEl.insertAdjacentHTML('beforeend', html);

        // Close modal and persist
        mdModal.close();

        const editor = document.getElementById('notes-detail-area');
        if (editor) {
            await saveText(editor.getAttribute('value'), true, false);
        }

        createSections();
    } catch (error) {
        console.error('notes-detail.js — applyMdToSection failed:', error);
    }
}

/**
 * Close the markdown section modal without applying changes.
 * @returns {void}
 */
function closeMdModal() {
    mdModal?.close();
}

// ─── Exports ─────────────────────────────────────────────────

export {
    createPage,
    deletePage,
    saveText,
    addSections,
    moveSection,
    deleteSection,
    findPage,
    renderNotesDetailHTML,
    exportNotesJSON,
    importNotesJSON,
    openMdModal,
    applyMdToSection,
    closeMdModal,
    renderMdPreview,
    DEFAULT_NOTE_ID,
};

// Boot the notes page
initApp();
