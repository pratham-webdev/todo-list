// ============================================================
// notes-common.js — Shared constants, sorting, and RTF toolbar
// ============================================================

/** Keyboard shortcut definitions shown in the RTF toolbar help panel */
const shortcutKeys = [
    { name: 'Cut',                              keys: 'Ctrl + X' },
    { name: 'Copy',                             keys: 'Ctrl + C' },
    { name: 'Paste',                            keys: 'Ctrl + V' },
    { name: 'Bold',                             keys: 'Ctrl + B' },
    { name: 'Italics',                          keys: 'Ctrl + I' },
    { name: 'Unordered List and Sub Bullets',   keys: 'Ctrl + Shift + 9' },
    { name: 'Ordered List and Sub Bullets',     keys: 'Tab' },
    { name: 'Convert selection text to links',  keys: 'Ctrl + K' },
    { name: 'Convert selection to code block',  keys: 'Ctrl + Shift + `' },
];

/** Heading tag options for the RTF heading picker */
const headingsArray = [
    { name: 'Heading 1', value: 'h1' },
    { name: 'Heading 2', value: 'h2' },
    { name: 'Heading 3', value: 'h3' },
    { name: 'Heading 4', value: 'h4' },
    { name: 'Heading 5', value: 'h5' },
    { name: 'Heading 6', value: 'h6' },
    { name: 'Paragraph',  value: 'p' },
];

/** Colour options for font and background pickers */
const colorsArray = [
    { name: 'Black',  value: 'black' },
    { name: 'White',  value: 'white' },
    { name: 'Red',    value: 'red' },
    { name: 'Blue',   value: 'blue' },
    { name: 'Green',  value: 'green' },
    { name: 'Yellow', value: 'yellow' },
];

/** Reusable CSS class string for small toolbar buttons */
export const commonButtonClasses = 'btn btn-lite-sm btn-no-bg-gray';

/**
 * Sort an array of objects by their `.id` property (date string) in ascending order.
 * Returns a new sorted array — does not mutate the original.
 * Uses native Array.sort (O(n log n)) instead of the previous O(n²) bubble sort.
 * @param {Array<{id: string}>} items - Array with date-string IDs (e.g. "2026-04-06")
 * @returns {Array<{id: string}>} Sorted copy of the array
 */
export function sortByDate(items) {
    return [...items].sort((a, b) => Date.parse(a.id) - Date.parse(b.id));
}

/**
 * Build HTML for the keyboard-shortcut help panel.
 * @returns {string} HTML string of shortcut rows
 */
export function createShortcuts() {
    return shortcutKeys
        .map((shortcut) => `<div class="mb-1">${shortcut.name}: <b>${shortcut.keys}</b></div>`)
        .join('');
}

/**
 * Build HTML for a list of toolbar buttons (headings, colours, etc.).
 * @param {Array<{name: string, value: string}>} items - Button definitions
 * @param {boolean} [showSwatch=false] - If true, render a colour swatch instead of text label
 * @returns {string} HTML string of buttons
 */
export function createButtons(items, showSwatch = false) {
    const renderSwatch = (value) =>
        `<div class="color-swatch" value="${value}" style="background-color:${value}"></div>`;

    return items
        .map((item) =>
            `<button class="btn btn-lite-sm btn-no-bg flex" value="${item.value}">
                ${showSwatch ? renderSwatch(item.value) : item.name}<span class="btn-title">${item.name}</span></button>`)
        .join('');
}

/**
 * Build the full Rich-Text-Formatting toolbar HTML used in task-detail and notes views.
 * Cached after first call to avoid redundant string construction.
 * @returns {string} HTML string for the toolbar
 */
/** @type {string|null} */
let _cachedToolbarHTML = null;
export function createRTFToolbar() {
    if (_cachedToolbarHTML) return _cachedToolbarHTML;
    _cachedToolbarHTML = `
        <div id="notes-formatter-row">
                <div id="rtf-buttons">
                    <button class="${commonButtonClasses} headings-box">
                    <i class="fa-solid fa-heading"></i>
                    <span class="btn-title">Heading</span>
                    </button>
                    <div id="headings-box-container" class="task-box-ui-layout">
                        ${createButtons(headingsArray)}
                    </div>

                    <button class="${commonButtonClasses} ol-box">
                    <i class="fa-solid fa-list-ol"></i>
                    <span class="btn-title">Ordered List - Ctrl + Shift + 9</span>
                    </button>

                    <button class="${commonButtonClasses} ul-box">
                    <i class="fa-solid fa-list-ul"></i>
                    <span class="btn-title">Unordered List - Tab</span>
                    </button>

                    <button class="${commonButtonClasses} colors-box">
                    <i class="fa-solid fa-font"></i>
                    <span class="btn-title">Font Color</span>
                    </button>
                    <div id="colors-box-container" class="task-box-ui-layout">
                        ${createButtons(colorsArray, true)}
                    </div>

                    <button class="${commonButtonClasses} background-box">
                    <i class="fa-solid fa-highlighter"></i>
                    <span class="btn-title">BG Color</span>
                    </button>
                    <div id="background-box-container" class="task-box-ui-layout">
                        ${createButtons(colorsArray, true)}
                    </div>

                    <button class="${commonButtonClasses} shortcuts-box">
                    <i class="fa-solid fa-keyboard"></i>
                    </button>
                    <div id="shortcuts-box-container" class="task-box-ui-layout">
                    <div class="font-bold mb-2">Shortcuts</div>
                        ${createShortcuts()}
                    </div>

                </div>
                <div id="saved-box-message" class="toaster-message">Your notes have been saved</div>
            </div>
    `;
    return _cachedToolbarHTML;
}