// ============================================================
// notes-listeners.js — Event listeners for the Notes detail page
// ============================================================

import {
    createPage,
    deletePage,
    saveText,
    addSections,
    moveSection,
    deleteSection,
    findPage,
    renderNotesDetailHTML,
    openMdModal,
    applyMdToSection,
    closeMdModal,
    renderMdPreview,
    DEFAULT_NOTE_ID,
} from "./notes-detail.js";
import { escapeHTML, isValidURL, sanitizeRichHTML, autoLinkTextNodes } from "./utils.js";

// ─── Cached DOM references ───────────────────────────────────

const notesContainer = document.getElementById('notes-detail-container');

/**
 * Attach a delegated event listener to a parent element.
 * @param {string} eventType
 * @param {string} selector
 * @param {(event: Event, matchedElement: HTMLElement) => void} handler
 * @returns {void}
 */
function delegate(eventType, selector, handler) {
    notesContainer.addEventListener(eventType, (e) => {
        const target = e.target.closest(selector);
        if (target && notesContainer.contains(target)) {
            handler(e, target);
        }
    });
}

/**
 * Helper: get the notes editor element.
 * @returns {HTMLElement|null}
 */
function getEditor() {
    return document.getElementById('notes-detail-area');
}

/**
 * Toggle a toolbar sub-panel's visibility via CSS class.
 * @param {string} panelId - DOM id of the panel element
 * @param {string} toggleSelector - CSS selector for the toggle button
 * @returns {void}
 */
function togglePanel(panelId, toggleSelector) {
    const panel = document.getElementById(panelId);
    if (panel) panel.classList.toggle('panel-open');
    document.querySelector(toggleSelector)?.classList.toggle('btn-no-bg-gray-active');
}

// ─── Auto-Save (debounced) ───────────────────────────────────

/** @type {number|null} Debounce timer ID for auto-save */
let _saveTimer = null;
// Save notes content when the editor loses focus (debounced 500ms)
// Auto-link bare URLs before persisting.
delegate('focusout', '#notes-detail-area', () => {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
        const editor = getEditor();
        if (!editor) return;
        autoLinkTextNodes(editor);
        saveText(editor.getAttribute('value'), true, false);
    }, 500);
});

// ─── RTF Toolbar Toggles ────────────────────────────────────

// Toggle headings / colours / background pickers
delegate('mousedown', '.headings-box', (e) => {
    e.preventDefault();
    togglePanel('headings-box-container', '.headings-box');
});
delegate('mousedown', '.colors-box', (e) => {
    e.preventDefault();
    togglePanel('colors-box-container', '.colors-box');
});
delegate('mousedown', '.background-box', (e) => {
    e.preventDefault();
    togglePanel('background-box-container', '.background-box');
});

// ─── Selection Formatting Helper ─────────────────────────────

/**
 * Insert a styled DOM node at the current text selection.
 * Note: colour/background cases apply inline styles intentionally — these are
 * user-driven formatting actions on contenteditable content.
 * @param {'heading'|'color'|'background'} formatType
 * @param {string} value - tag name (e.g. 'h2') or CSS colour value
 * @returns {void}
 */
function insertFormattedNode(formatType, value) {
    try {
        const selection = window.getSelection();
        const range = selection.getRangeAt(0);
        let newElement = null;

        switch (formatType) {
            case 'heading':
                newElement = document.createElement(value);
                newElement.innerHTML = selection.toString();
                break;
            case 'color':
                newElement = document.createElement('span');
                newElement.innerText = selection.toString();
                newElement.style.color = value;
                break;
            case 'background':
                newElement = document.createElement('span');
                newElement.innerText = selection.toString();
                newElement.style.backgroundColor = value;
                break;
            default:
                return;
        }

        range.deleteContents();
        range.insertNode(newElement);
    } catch (error) {
        console.error('notes-listeners.js — insertFormattedNode failed:', error);
    }
}

// ─── Heading / Colour / Background Insertion ─────────────────

/**
 * Save the editor content and close a toolbar panel.
 * @param {string} panelId - DOM id of the panel element
 * @param {string} toggleSelector - CSS selector for the toggle button
 * @returns {void}
 */
function saveAndClosePanel(panelId, toggleSelector) {
    const editor = getEditor();
    if (editor) saveText(editor.getAttribute('value'), true, false);
    const panel = document.getElementById(panelId);
    if (panel) panel.classList.remove('panel-open');
    document.querySelector(toggleSelector)?.classList.remove('btn-no-bg-gray-active');
}

// Insert heading into notes area
delegate('mousedown', '#headings-box-container button', (e, el) => {
    e.preventDefault();
    const headingTag = el.getAttribute('value');
    const editor = getEditor();
    const isFocused = document.activeElement === editor;

    if (isFocused) {
        insertFormattedNode('heading', headingTag);
    } else if (editor) {
        editor.insertAdjacentHTML('beforeend', `<${headingTag}>Heading ${headingTag.slice(1, 2)}</${headingTag}>`);
    }

    saveAndClosePanel('headings-box-container', '.headings-box');
});

// Apply font colour to selected text
delegate('mousedown', '#colors-box-container button', (e, el) => {
    e.preventDefault();
    const editor = getEditor();
    if (document.activeElement === editor) {
        insertFormattedNode('color', el.getAttribute('value'));
    }
    saveAndClosePanel('colors-box-container', '.colors-box');
});

// Apply background colour to selected text
delegate('mousedown', '#background-box-container button', (e, el) => {
    e.preventDefault();
    const editor = getEditor();
    if (document.activeElement === editor) {
        insertFormattedNode('background', el.getAttribute('value'));
    }
    saveAndClosePanel('background-box-container', '.background-box');
});

// ─── Sections ────────────────────────────────────────────────

// Add a section above or below the notes area
delegate('click', '.add-sections-box', (e, el) => {
    addSections(el.getAttribute('value'));
});

// Toggle section visibility (eye / eye-slash)
delegate('click', '.hide-section', (e, el) => {
    e.stopPropagation();
    const toggleDiv = el.closest('[value]');
    const sectionId = toggleDiv?.getAttribute('value');
    const sectionEl = document.getElementById(sectionId);
    if (!sectionEl) return;

    const isHidden = sectionEl.classList.contains('hidden');
    sectionEl.classList.toggle('hidden');

    // Update the icon
    const icon = el.querySelector('i');
    if (icon) {
        icon.className = isHidden ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
    }
    el.classList.toggle('section-hidden', !isHidden);

    // Persist the change
    const editor = getEditor();
    if (editor) saveText(editor.getAttribute('value'), true, false);
});

// Click on a section toggle label to scroll to that section
delegate('click', '.notes-detail-section-toggle-container > [value]', (e, el) => {
    if (e.target.closest('.hide-section') || e.target.closest('.add-sections-box') || e.target.closest('.edit-section-md')) return;
    const sectionId = el.getAttribute('value');
    const sectionEl = document.getElementById(sectionId);
    if (sectionEl) sectionEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ─── Page Management ─────────────────────────────────────────

// Create a new page
delegate('click', '#createPage', () => {
    createPage();
});

// Import a page from a local file
delegate('click', '#importPage', async () => {
    try {
        const [fileHandle] = await window.showOpenFilePicker();
        const file = await fileHandle.getFile();
        const fileName = fileHandle.name.slice(0, fileHandle.name.lastIndexOf('.'));
        const contents = await file.text();
        createPage(sanitizeRichHTML(contents), fileName);
    } catch (error) {
        console.error('notes-listeners.js — file import failed:', error);
    }
});

// Navigate to a page tab
delegate('click', '.page-tab', (e, el) => {
    const pageObj = findPage(el.id);
    renderNotesDetailHTML(pageObj);
});

// ─── Page Context Menu (cursor-positioned) ──────────────────

const pageContextMenu = document.getElementById('page-context-menu');
const sectionContextMenu = document.getElementById('section-context-menu');
let _ctxPageId = null;
let _ctxPageName = '';

/** Hide all context menus on the notes page. */
function closeAllContextMenus() {
    pageContextMenu.classList.remove('open');
    sectionContextMenu.classList.remove('open');
}

// Right-click context menu for page tabs
delegate('contextmenu', '.page-tab', (e, el) => {
    e.preventDefault();
    closeAllContextMenus();
    _ctxPageId = el.id;
    _ctxPageName = el.textContent.trim();

    // Hide delete option for the default page
    const deleteBtn = document.getElementById('ctx-page-delete');
    if (deleteBtn) {
        deleteBtn.closest('.list-group-item').classList.toggle(
            'hidden', _ctxPageId === DEFAULT_NOTE_ID
        );
    }

    pageContextMenu.style.setProperty('--x', e.pageX + 'px');
    pageContextMenu.style.setProperty('--y', e.pageY + 'px');
    pageContextMenu.classList.add('open');
});

// Page context menu — Rename
document.getElementById('ctx-page-rename')?.addEventListener('click', () => {
    if (!_ctxPageId) return;
    const newName = prompt('Rename the page', _ctxPageName);
    if (newName !== null) {
        saveText(_ctxPageId, false, newName);
    }
    closeAllContextMenus();
});

// Page context menu — Export
document.getElementById('ctx-page-export')?.addEventListener('click', async () => {
    if (!_ctxPageId) return;
    const pageObj = findPage(_ctxPageId);
    try {
        const handle = await getNewFileHandle(_ctxPageName);
        await writeFile(handle, pageObj.html);
    } catch (error) {
        console.error('notes-listeners.js — export failed:', error);
    }
    closeAllContextMenus();
});

// Page context menu — Delete
document.getElementById('ctx-page-delete')?.addEventListener('click', () => {
    if (!_ctxPageId) return;
    deletePage(_ctxPageId);
    closeAllContextMenus();
});

// ─── File Export Helpers ─────────────────────────────────────

/**
 * Show a "Save As" dialog and return the file handle.
 * @param {string} suggestedName
 * @returns {Promise<FileSystemFileHandle>}
 */
async function getNewFileHandle(suggestedName) {
    const options = {
        suggestedName,
        startIn: 'downloads',
        types: [{
            description: 'HTML Files',
            accept: { 'text/plain': ['.html'] },
        }],
    };
    return await window.showSaveFilePicker(options);
}

/**
 * Write string contents to a file handle.
 * @param {FileSystemFileHandle} fileHandle
 * @param {string} contents
 */
async function writeFile(fileHandle, contents) {
    const writable = await fileHandle.createWritable();
    await writable.write(contents);
    await writable.close();
}

// ─── Notes Keyboard Shortcuts ────────────────────────────────

delegate('keydown', '#notes-detail-area', (e) => {
    try {
        const selection = window.getSelection();
        const range = selection.getRangeAt(0);

        // Tab → insert unordered list
        if (e.key === 'Tab') {
            e.preventDefault();
            const ulElement = document.createElement('ul');
            ulElement.innerHTML = '<li></li>';
            range.insertNode(ulElement);
            range.selectNodeContents(ulElement);
            selection.removeAllRanges();
            selection.addRange(range);
        }

        // Ctrl+9 → insert ordered list
        if (e.ctrlKey && e.key === '9') {
            const olElement = document.createElement('ol');
            olElement.innerHTML = '<li></li>';
            range.insertNode(olElement);
            range.selectNodeContents(olElement);
            selection.removeAllRanges();
            selection.addRange(range);
        }

        // Ctrl+K → convert selection to hyperlink
        if (e.ctrlKey && e.key === 'k') {
            e.preventDefault();
            const linkUrl = prompt('Please enter URL here', 'https://google.com');
            if (linkUrl && isValidURL(linkUrl)) {
                const linkWrapper = document.createElement('span');
                linkWrapper.innerHTML = `<a href="${escapeHTML(linkUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(selection.toString())}</a>`;
                range.deleteContents();
                range.insertNode(linkWrapper);
            } else if (linkUrl) {
                alert('Invalid URL. Only http and https URLs are allowed.');
            }
        }

        // Ctrl+` → convert selection to code block
        if (e.ctrlKey && e.key === '`') {
            e.preventDefault();
            const codeElement = document.createElement('code');
            codeElement.innerHTML = selection.toString();
            range.deleteContents();
            range.insertNode(codeElement);
        }
    } catch (error) {
        console.error('notes-listeners.js — keydown handler failed:', error);
    }
});

// ─── Paste Sanitization ──────────────────────────────────────

delegate('paste', '#notes-detail-area', (e) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    const html = clipboardData.getData('text/html');
    if (!html) return; // plain-text paste — let browser handle natively

    e.preventDefault();
    try {
        const sanitized = sanitizeRichHTML(html);
        const selection = window.getSelection();
        if (!selection?.rangeCount) return;
        const range = selection.getRangeAt(0);
        range.deleteContents();

        const temp = document.createElement('template');
        temp.innerHTML = sanitized;
        const fragment = temp.content;
        range.insertNode(fragment);

        // Auto-link any bare URLs in the pasted content
        autoLinkTextNodes(getEditor());

        // Collapse cursor to end of inserted content
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    } catch (error) {
        console.error('notes-listeners.js — paste handler failed:', error);
    }
});

// ─── Markdown Section Modal ──────────────────────────────────

// Open the markdown editor for a section
delegate('click', '.edit-section-md', (e, el) => {
    e.stopPropagation();
    const toggleDiv = el.closest('[value]');
    const sectionId = toggleDiv?.getAttribute('value');
    if (sectionId) openMdModal(sectionId);
});

// Modal: Update button — apply markdown → HTML to section
document.getElementById('md-section-update-btn')?.addEventListener('click', () => {
    applyMdToSection();
});

// Modal: Cancel button — close without changes
document.getElementById('md-section-cancel-btn')?.addEventListener('click', () => {
    closeMdModal();
});

// Modal: Live preview on textarea input (debounced)
/** @type {number|null} */
let _mdPreviewTimer = null;
document.getElementById('md-section-input')?.addEventListener('input', () => {
    clearTimeout(_mdPreviewTimer);
    _mdPreviewTimer = setTimeout(() => {
        renderMdPreview();
    }, 200);
});

// ─── Section Context Menu (cursor-positioned) ───────────────

let _ctxSectionId = null;
let _ctxSectionIndex = -1;

// Right-click context menu for section toggle buttons
delegate('contextmenu', '.section-toggle-btn', (e, el) => {
    e.preventDefault();
    closeAllContextMenus();
    _ctxSectionId = el.getAttribute('value');
    _ctxSectionIndex = Number(el.getAttribute('index'));

    const sectionEl = document.getElementById(_ctxSectionId);
    const isHidden = sectionEl?.classList.contains('hidden');
    const totalSections = document.querySelectorAll('.sections-area').length;

    // Update hide button icon/label based on current state
    const hideBtn = document.getElementById('ctx-section-hide');
    if (hideBtn) {
        const icon = hideBtn.querySelector('i');
        const label = hideBtn.querySelector('span');
        if (icon) icon.className = isHidden ? 'fa-solid fa-eye-slash mr-2' : 'fa-solid fa-eye mr-2';
        if (label) label.textContent = isHidden ? 'Show' : 'Hide';
    }

    // Disable move buttons at boundaries
    const upBtn = document.getElementById('ctx-section-up');
    const downBtn = document.getElementById('ctx-section-down');
    if (upBtn) upBtn.disabled = _ctxSectionIndex === 0;
    if (downBtn) downBtn.disabled = _ctxSectionIndex >= totalSections - 1;

    sectionContextMenu.style.setProperty('--x', e.pageX + 'px');
    sectionContextMenu.style.setProperty('--y', e.pageY + 'px');
    sectionContextMenu.classList.add('open');
});

// Section context menu — Hide / Show
document.getElementById('ctx-section-hide')?.addEventListener('click', () => {
    if (!_ctxSectionId) return;
    const sectionEl = document.getElementById(_ctxSectionId);
    if (!sectionEl) { closeAllContextMenus(); return; }

    sectionEl.classList.toggle('hidden');

    // Update the inline eye icon on the toggle button
    const toggleBtn = document.querySelector(`.section-toggle-btn[value="${_ctxSectionId}"]`);
    const inlineBtn = toggleBtn?.querySelector('.hide-section');
    if (inlineBtn) {
        const isNowHidden = sectionEl.classList.contains('hidden');
        const icon = inlineBtn.querySelector('i');
        if (icon) icon.className = isNowHidden ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
        inlineBtn.classList.toggle('section-hidden', isNowHidden);
    }

    const editor = document.getElementById('notes-detail-area');
    if (editor) saveText(editor.getAttribute('value'), true, false);
    closeAllContextMenus();
});

// Section context menu — Markdown
document.getElementById('ctx-section-md')?.addEventListener('click', () => {
    if (!_ctxSectionId) return;
    openMdModal(_ctxSectionId);
    closeAllContextMenus();
});

// Section context menu — Move Up
document.getElementById('ctx-section-up')?.addEventListener('click', () => {
    if (!_ctxSectionId) return;
    moveSection(_ctxSectionId, 'up');
    closeAllContextMenus();
});

// Section context menu — Move Down
document.getElementById('ctx-section-down')?.addEventListener('click', () => {
    if (!_ctxSectionId) return;
    moveSection(_ctxSectionId, 'down');
    closeAllContextMenus();
});

// Section context menu — Delete
document.getElementById('ctx-section-delete')?.addEventListener('click', () => {
    if (!_ctxSectionId) return;
    deleteSection(_ctxSectionId);
    closeAllContextMenus();
});

// ─── Shared Dismiss Handler ─────────────────────────────────

document.addEventListener('click', (e) => {
    if (!e.target.closest('.context-menu')) {
        closeAllContextMenus();
    }
});
