// ============================================================
// settings.js — Settings page event handlers
// ============================================================

import { exportCSV, importCSV } from './csv-io.js';
import { exportNotesJSON, importNotesJSON } from './notes-io.js';
import { toggleAutoBackup } from './backup-scheduler.js';
import { TodoService } from './todo-service.js';
import { setMessageState } from './toast.js';
import { sanitizeRichHTML } from './utils.js';

// ─── Font allowlist ──────────────────────────────────────────

const FONT_LIST = [
    'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat',
    'Nunito', 'Poppins', 'Raleway', 'Source Sans 3', 'Work Sans',
    'Rubik', 'Noto Sans', 'DM Sans', 'Outfit', 'Manrope',
    'Figtree', 'Plus Jakarta Sans', 'Albert Sans', 'Lexend', 'Geist',
];

// ─── Sidebar Nav Scroll Spy ─────────────────────────────────

const navItems = document.querySelectorAll('.settings-nav-item');
const contentPane = document.querySelector('.settings-content');
const sections = document.querySelectorAll('.settings-content > section');

navItems.forEach((item) => {
    item.addEventListener('click', () => {
        const targetId = item.getAttribute('data-target');
        const section = targetId ? document.getElementById(targetId) : null;
        if (section) section.scrollIntoView({ behavior: 'smooth' });
    });
});

if (contentPane && sections.length) {
    const observer = new IntersectionObserver((entries) => {
        let topmost = null;
        let topY = Infinity;
        entries.forEach((entry) => {
            if (entry.isIntersecting && entry.boundingClientRect.top < topY) {
                topY = entry.boundingClientRect.top;
                topmost = entry.target;
            }
        });
        if (topmost) {
            navItems.forEach((n) => n.classList.remove('active'));
            // IDs are hardcoded in HTML, no injection risk
            const match = document.querySelector(`.settings-nav-item[data-target="${topmost.id}"]`);
            if (match) match.classList.add('active');
        }
    }, { root: contentPane, threshold: 0, rootMargin: '0px 0px -60% 0px' });

    sections.forEach((s) => observer.observe(s));
}

// ─── Theme Swatches ─────────────────────────────────────────

/** @type {Array<{id: string, label: string}>} */
const THEMES = [
    { id: 'dark',            label: 'Dark' },
    { id: 'light',           label: 'Light' },
    { id: 'dracula',         label: 'Dracula' },
    { id: 'monokai',         label: 'Monokai' },
    { id: 'one-dark',        label: 'One Dark' },
    { id: 'one-dark-flat',   label: 'One Dark Flat' },
    { id: 'one-dark-night',  label: 'One Dark Night' },
];

/**
 * Build a single theme swatch button element.
 * @param {string} id - theme identifier (matches data-theme value)
 * @param {string} label - human-readable name shown in tooltip
 * @returns {HTMLButtonElement}
 */
function createSwatchButton(id, label) {
    const btn = document.createElement('button');
    btn.className = 'theme-swatch';
    btn.setAttribute('data-theme', id);
    btn.innerHTML =
        '<span class="swatch-sidebar"></span>' +
        '<span class="swatch-content">' +
            '<span class="swatch-accent"></span>' +
            '<span class="swatch-text"></span>' +
            '<span class="swatch-text short"></span>' +
        '</span>' +
        `<span class="btn-title">${label}</span>`;
    return btn;
}

const swatchGrid = document.getElementById('theme-swatch-grid');
const swatches = [];

if (swatchGrid) {
    for (const { id, label } of THEMES) {
        const btn = createSwatchButton(id, label);
        btn.addEventListener('click', () => {
            try {
                localStorage.setItem('theme', id);
            } catch (error) {
                console.error('settings.js — theme save failed:', error);
            }
            document.documentElement.setAttribute('data-theme', id);
            updateSwatchActive();
        });
        swatchGrid.appendChild(btn);
        swatches.push(btn);
    }
}

/**
 * Highlight the active swatch based on current theme.
 */
function updateSwatchActive() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    swatches.forEach((s) => {
        s.classList.toggle('active', s.getAttribute('data-theme') === current);
    });
}

updateSwatchActive();

// ─── Typography ──────────────────────────────────────────────

/**
 * Populate a <select> with font options and set the stored value.
 * @param {string} selectId
 * @param {string} storageKey
 */
function initFontSelect(selectId, storageKey) {
    const select = document.getElementById(selectId);
    if (!select) return;

    // Add "Default" option + all fonts
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Default (Inter)';
    select.appendChild(defaultOpt);

    for (const font of FONT_LIST) {
        const opt = document.createElement('option');
        opt.value = font;
        opt.textContent = font;
        select.appendChild(opt);
    }

    // Restore stored value
    const stored = localStorage.getItem(storageKey);
    if (stored && FONT_LIST.includes(stored)) select.value = stored;

    select.addEventListener('change', () => {
        const val = select.value;
        try {
            if (val) {
                localStorage.setItem(storageKey, val);
                document.documentElement.style.setProperty(
                    storageKey === 'font-global' ? '--font-global' : '--font-content',
                    `"${val}", sans-serif`
                );
                injectGoogleFont(val);
            } else {
                localStorage.removeItem(storageKey);
                document.documentElement.style.removeProperty(
                    storageKey === 'font-global' ? '--font-global' : '--font-content'
                );
            }
        } catch (error) {
            console.error('settings.js — font change failed:', error);
        }
    });
}

/**
 * Inject a Google Fonts <link> if not already present.
 * @param {string} fontName
 */
function injectGoogleFont(fontName) {
    if (!fontName || fontName === 'Inter' || !FONT_LIST.includes(fontName)) { return; }
    const id = 'gf-' + fontName.replace(/\s/g, '-').toLowerCase();
    if (document.getElementById(id)) { return; }
    try {
        const link = document.createElement('link');
        link.id = id;
        link.rel = 'stylesheet';
        link.href = `https://fonts.googleapis.com/css2?family=${fontName.replace(/ /g, '+')}:wght@400;500;600;700&display=swap`;
        document.head.appendChild(link);
    } catch (error) {
        console.error('settings.js — injectGoogleFont failed:', error);
    }
}

/**
 * Wire a range slider + number input to a CSS custom property and localStorage key.
 * @param {string} sliderId
 * @param {string} inputId
 * @param {string} storageKey
 * @param {string} cssVar
 * @param {number} defaultVal
 */
function initSizeSlider(sliderId, inputId, storageKey, cssVar, defaultVal) {
    const slider = document.getElementById(sliderId);
    const numInput = document.getElementById(inputId);
    if (!slider) { return; }

    const minVal = parseInt(slider.min, 10);
    const maxVal = parseInt(slider.max, 10);
    const clamp = (v) => Math.min(Math.max(v, minVal), maxVal);

    const stored = localStorage.getItem(storageKey);
    const val = stored ? clamp(parseInt(stored, 10)) : defaultVal;
    slider.value = val;
    if (numInput) { numInput.value = val; }

    function applySize(v) {
        const clamped = clamp(v);
        slider.value = clamped;
        if (numInput) { numInput.value = clamped; }
        try {
            localStorage.setItem(storageKey, String(clamped));
            document.documentElement.style.setProperty(cssVar, clamped + 'px');
        } catch (error) {
            console.error('settings.js — size slider failed:', error);
        }
    }

    slider.addEventListener('input', () => {
        applySize(parseInt(slider.value, 10));
    });

    if (numInput) {
        numInput.addEventListener('change', () => {
            const parsed = parseInt(numInput.value, 10);
            if (Number.isFinite(parsed)) {
                applySize(parsed);
            } else {
                numInput.value = slider.value;
            }
        });
    }
}

/**
 * Wire reset buttons — each has data-target matching a localStorage key.
 */
function initResetButtons() {
    const CONFIG = {
        'font-size-global': { sliderId: 'font-size-global-slider', inputId: 'font-size-global-input', cssVar: '--font-size-global', defaultVal: 14 },
        'font-size-content': { sliderId: 'font-size-content-slider', inputId: 'font-size-content-input', cssVar: '--font-size-content', defaultVal: 14 },
    };

    document.querySelectorAll('.settings-reset-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const key = btn.getAttribute('data-target');
            const cfg = CONFIG[key];
            if (!cfg) { return; }

            const slider = document.getElementById(cfg.sliderId);
            const numInput = document.getElementById(cfg.inputId);
            if (slider) { slider.value = cfg.defaultVal; }
            if (numInput) { numInput.value = cfg.defaultVal; }

            try {
                localStorage.removeItem(key);
                document.documentElement.style.removeProperty(cfg.cssVar);
            } catch (error) {
                console.error('settings.js — reset failed:', error);
            }
        });
    });
}

initFontSelect('font-global-select', 'font-global');
initFontSelect('font-content-select', 'font-content');
initSizeSlider('font-size-global-slider', 'font-size-global-input', 'font-size-global', '--font-size-global', 14);
initSizeSlider('font-size-content-slider', 'font-size-content-input', 'font-size-content', '--font-size-content', 14);
initResetButtons();

// ─── MCP Connection ──────────────────────────────────────────

const DEFAULT_WS_URL = 'ws://127.0.0.1:8765';
const mcpInput = document.getElementById('mcp-ws-url-input');

if (mcpInput) {
    mcpInput.value = localStorage.getItem('mcp-ws-url') || DEFAULT_WS_URL;
}

document.getElementById('mcp-ws-save-btn')?.addEventListener('click', () => {
    const url = mcpInput?.value?.trim();
    if (!url) { return; }

    try {
        new URL(url);
    } catch {
        updateMcpStatus('invalid');
        return;
    }

    try {
        localStorage.setItem('mcp-ws-url', url);
        updateMcpStatus('saved');
    } catch (error) {
        console.error('settings.js — MCP URL save failed (quota?):', error);
        updateMcpStatus('invalid');
    }
});

/**
 * Temporarily override the MCP status indicator for save/validation feedback.
 * The live connection state is managed by mcp-status.js (loaded on this page).
 * @param {'saved' | 'invalid'} action
 */
function updateMcpStatus(action) {
    const indicator = document.getElementById('mcp-status-indicator');
    const label = indicator?.querySelector('.mcp-status-label');
    if (!indicator || !label) return;

    indicator.classList.remove('connected', 'connecting', 'disconnected');
    if (action === 'saved') {
        indicator.classList.add('connected');
        label.textContent = 'URL saved — refresh todo page to reconnect';
    } else if (action === 'invalid') {
        indicator.classList.add('disconnected');
        label.textContent = 'Invalid URL';
    }
}

// ─── Data ────────────────────────────────────────────────────

document.getElementById('export-csv-btn')?.addEventListener('click', () => exportCSV());
document.getElementById('import-csv-btn')?.addEventListener('click', () => importCSV());
document.getElementById('auto-backup-btn')?.addEventListener('click', () => toggleAutoBackup());
document.getElementById('export-notes-btn')?.addEventListener('click', () => exportNotesJSON());
document.getElementById('import-notes-btn')?.addEventListener('click', () => importNotesJSON());

// ─── Danger Zone ─────────────────────────────────────────────

document.getElementById('purge-todos-btn')?.addEventListener('click', async () => {
    if (!confirm('This will permanently delete ALL todo lists and tasks. Continue?')) return;
    try {
        await TodoService.clearAllDateLists();
        setMessageState('success', 'All todo data purged.');
    } catch (error) {
        console.error('settings.js — purgeAllTodos failed:', error);
        setMessageState('failure', 'Failed to purge todo data.');
    }
});

document.getElementById('purge-notes-btn')?.addEventListener('click', async () => {
    if (!confirm('This will permanently delete ALL notes pages. Continue?')) return;
    try {
        await TodoService.clearAllNotes();
        setMessageState('success', 'All notes data purged.');
    } catch (error) {
        console.error('settings.js — purgeAllNotes failed:', error);
        setMessageState('failure', 'Failed to purge notes data.');
    }
});

document.getElementById('factory-reset-btn')?.addEventListener('click', async () => {
    if (!confirm('This will delete ALL data (todos, notes, settings) and reload. Continue?')) return;
    try {
        await TodoService.factoryReset();
    } catch (error) {
        console.error('settings.js — factoryReset failed:', error);
        setMessageState('failure', 'Factory reset failed.');
    }
});

// ─── About — Storage Usage ───────────────────────────────────

(async () => {
    const el = document.getElementById('storage-usage');
    if (!el) return;
    try {
        if (navigator.storage && navigator.storage.estimate) {
            const { usage = 0, quota = 0 } = await navigator.storage.estimate();
            const fmt = (b) => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
            el.textContent = `${fmt(usage)} / ${fmt(quota)}`;
        } else {
            el.textContent = 'N/A';
        }
    } catch {
        el.textContent = 'N/A';
    }
})();

// ─── About — Documentation (fetched README) ─────────────────

(async () => {
    const container = document.getElementById('readme-content');
    if (!container) { return; }
    try {
        const res = await fetch('docs/README.md');
        if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
        const md = await res.text();
        const html = marked.parse(md);
        container.innerHTML = sanitizeRichHTML(html);
    } catch (error) {
        console.error('settings.js — failed to load README:', error);
        container.innerHTML = '<p class="text-secondary">Documentation unavailable.</p>';
    }
})();
