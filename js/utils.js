// ============================================================
// utils.js — Shared utility helpers
// ============================================================

import { decodeHTMLEntities } from './task-helpers.js';

// ─── JSDoc Type Definitions ──────────────────────────────────

/**
 * @typedef {Object} Task
 * @property {string}  id         - e.g. "Task-2026-04-21-1713700000000"
 * @property {string}  name       - display name (plain text, may contain linkified URLs)
 * @property {number}  statusCode - 1001=Todo, 1002=Ongoing, 1003=Blocked, 1004=Completed, 1005=Archived
 * @property {string}  desc       - rich HTML content for the detail/notes area
 * @property {string}  [dateName] - human-readable date label (transient, set by findTask)
 */

/**
 * @typedef {Object} DateList
 * @property {string}  id         - "YYYY-MM-DD"
 * @property {string}  name       - human-readable date string
 * @property {Task[]}  taskList
 * @property {number}  statusCode
 */

/**
 * @typedef {Object} NotePage
 * @property {string}  id     - e.g. "notes-area-0000001"
 * @property {string}  name   - page title
 * @property {number}  status - 1001 default
 * @property {string}  html   - rich HTML content
 */

// ─── Constants ───────────────────────────────────────────────

/** Regex matching http/https URLs in plain text */
export const URL_PATTERN = /(\b(https?):\/\/[-A-Z0-9+&@#/%?=~_|!:,.;]*[-A-Z0-9+&@#/%=~_|])/gi;

// ─── Task ID Layout Constants ────────────────────────────────
// Task IDs follow the pattern: "Task-YYYY-MM-DD-<timestamp>"
//                                ^5   ^15   ^16→
/** Start index of the date portion within a task ID */
export const DATE_ID_START = 5;
/** End index (exclusive) of the date portion within a task ID */
export const DATE_ID_END = 15;
/** Start index of the unique task suffix within a task ID */
export const TASK_ID_OFFSET = 16;

// ─── Plain-Text Helpers ──────────────────────────────────────

/**
 * Escape HTML special characters to prevent XSS.
 * @param {string} str - untrusted string
 * @returns {string} escaped string safe for innerHTML
 */
export function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Decode HTML entities back to plain text.
 * Useful for cleaning up older stored values that were escaped before save.
 * @param {string} str
 * @returns {string}
 */
export function decodeHTML(str) {
    return decodeHTMLEntities(str ?? '');
}

/**
 * Validate that a string is a safe HTTP(S) URL.
 * Rejects javascript:, data:, and other dangerous protocols.
 * @param {string} str - URL string to validate
 * @returns {boolean}
 */
export function isValidURL(str) {
    try {
        const url = new URL(str);
        return ['http:', 'https:'].includes(url.protocol);
    } catch { return false; }
}

/**
 * Replace plain-text URLs with clickable anchor tags.
 * Only safe on plain-text strings — NEVER call on HTML innerHTML.
 * @param {string} text - raw text that may contain URLs
 * @returns {string} text with URLs wrapped in <a> tags
 */
export function replaceURLs(text) {
    if (!text) return text;
    return text.replace(URL_PATTERN, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

// ─── DOM-Safe Auto-Linking ───────────────────────────────────

/**
 * Walk all Text nodes under `root` and wrap bare URLs in `<a>` tags.
 * Skips text nodes that are already inside an `<a>` element.
 * Safe for contenteditable — mutates the DOM in-place without corrupting
 * existing tags or attributes.
 *
 * @param {HTMLElement} root - the container element to scan
 * @returns {number} count of URLs that were linked
 */
export function autoLinkTextNodes(root) {
    if (!root) return 0;

    let linked = 0;

    try {
        // Collect text nodes first to avoid live-NodeList mutation issues
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        /** @type {Text[]} */
        const textNodes = [];
        while (walker.nextNode()) textNodes.push(/** @type {Text} */ (walker.currentNode));

        for (const node of textNodes) {
            // Skip text already inside an <a> tag
            if (node.parentElement?.closest('a')) continue;

            // Reset regex state (global flag)
            URL_PATTERN.lastIndex = 0;
            const text = node.textContent ?? '';
            if (!URL_PATTERN.test(text)) continue;

            // Build a document fragment with linked URLs
            URL_PATTERN.lastIndex = 0;
            const frag = document.createDocumentFragment();
            let lastIndex = 0;
            let match;

            while ((match = URL_PATTERN.exec(text)) !== null) {
                // Text before the match
                if (match.index > lastIndex) {
                    frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
                }

                // Create the anchor element
                const anchor = document.createElement('a');
                anchor.href = match[1];
                anchor.target = '_blank';
                anchor.rel = 'noopener noreferrer';
                anchor.textContent = match[1];
                frag.appendChild(anchor);

                lastIndex = URL_PATTERN.lastIndex;
                linked++;
            }

            // Remaining text after last match
            if (lastIndex < text.length) {
                frag.appendChild(document.createTextNode(text.slice(lastIndex)));
            }

            // Replace the original text node with the fragment
            node.parentNode?.replaceChild(frag, node);
        }
    } catch (error) {
        console.error('utils.js — autoLinkTextNodes failed:', error);
    }

    return linked;
}

// ─── Rich-HTML Sanitization ──────────────────────────────────

/** Allowed tags in rich-text content (lowercase). */
const ALLOWED_TAGS = new Set([
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'div', 'span', 'a',
    'ul', 'ol', 'li',
    'code', 'pre', 'br', 'hr',
    'b', 'strong', 'i', 'em', 'u', 's', 'sub', 'sup',
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'img', 'blockquote',
]);

/** Per-tag attribute allowlists; `'*'` key = global attrs allowed on every tag. */
const ALLOWED_ATTRS = /** @type {Record<string, Set<string>>} */ ({
    '*':   new Set(['id', 'class', 'style']),
    'a':   new Set(['href', 'target', 'rel']),
    'img': new Set(['src', 'alt', 'width', 'height']),
});

/** CSS properties allowed inside inline `style` attributes. */
const SAFE_STYLE_PROPS = new Set([
    'color', 'background-color', 'background',
    'display', 'text-align', 'font-weight', 'font-style', 'text-decoration',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
]);

/**
 * Sanitize an inline `style` attribute value, keeping only safe properties.
 * @param {string} raw - e.g. "color:red; position:absolute; onerror:alert(1)"
 * @returns {string} sanitized style string
 */
function sanitizeStyle(raw) {
    try {
        const el = document.createElement('span');
        el.style.cssText = raw;
        /** @type {string[]} */
        const safe = [];
        for (let i = 0; i < el.style.length; i++) {
            const prop = el.style[i];
            if (SAFE_STYLE_PROPS.has(prop)) {
                safe.push(`${prop}:${el.style.getPropertyValue(prop)}`);
            }
        }
        return safe.join(';');
    } catch {
        return '';
    }
}

/**
 * Check whether an `href` or `src` value uses a safe protocol.
 * @param {string} value
 * @returns {boolean}
 */
function isSafeURL(value) {
    try {
        const url = new URL(value, globalThis.location?.href);
        return ['http:', 'https:', 'mailto:'].includes(url.protocol);
    } catch {
        return false;
    }
}

/**
 * Recursively walk a DOM node, keeping only allowed tags/attrs/styles.
 * Unsafe nodes are replaced by their children (text is preserved).
 * @param {Node} node
 * @param {DocumentFragment} out - target fragment to append safe nodes to
 */
function walkNode(node, out) {
    if (node.nodeType === Node.TEXT_NODE) {
        out.appendChild(document.createTextNode(node.textContent ?? ''));
        return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = /** @type {Element} */ (node);
    const tag = el.tagName.toLowerCase();

    if (!ALLOWED_TAGS.has(tag)) {
        // Unwrap: keep children, discard the tag itself
        for (const child of [...el.childNodes]) {
            walkNode(child, out);
        }
        return;
    }

    const safeEl = document.createElement(tag);

    // Copy allowed attributes
    const globalAttrs = ALLOWED_ATTRS['*'];
    const tagAttrs = ALLOWED_ATTRS[tag];

    for (const attr of el.attributes) {
        const name = attr.name.toLowerCase();

        // Block all event handlers
        if (name.startsWith('on')) continue;

        const isGlobal = globalAttrs?.has(name);
        const isTagSpecific = tagAttrs?.has(name);
        if (!isGlobal && !isTagSpecific) continue;

        if (name === 'style') {
            const cleaned = sanitizeStyle(attr.value);
            if (cleaned) safeEl.setAttribute('style', cleaned);
        } else if (name === 'href' || name === 'src') {
            if (isSafeURL(attr.value)) {
                safeEl.setAttribute(name, attr.value);
                if (name === 'href') {
                    safeEl.setAttribute('target', '_blank');
                    safeEl.setAttribute('rel', 'noopener noreferrer');
                }
            }
        } else {
            safeEl.setAttribute(name, attr.value);
        }
    }

    // Recurse into children
    for (const child of [...el.childNodes]) {
        walkNode(child, safeEl);
    }

    out.appendChild(safeEl);
}

/**
 * Sanitize a rich-HTML string through a DOM-based allowlist walker.
 * Safe for contenteditable innerHTML, imported files, and MCP payloads.
 *
 * @param {string} html - untrusted HTML string
 * @returns {string} sanitized HTML string
 */
export function sanitizeRichHTML(html) {
    if (!html) return html ?? '';

    try {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const fragment = document.createDocumentFragment();

        for (const child of [...doc.body.childNodes]) {
            walkNode(child, fragment);
        }

        const wrapper = document.createElement('div');
        wrapper.appendChild(fragment);
        return wrapper.innerHTML;
    } catch (error) {
        console.error('utils.js — sanitizeRichHTML failed:', error);
        return escapeHTML(html);
    }
}

// ─── Rich-HTML Structural Normalization ──────────────────────

/** Tags whose mere presence counts as meaningful content. */
const MEDIA_TAGS = new Set(['img', 'hr', 'video', 'audio', 'canvas', 'svg']);

/** Void / self-closing elements that should never be removed. */
const VOID_TAGS = new Set(['br', 'hr', 'img']);

/** Elements kept even when empty (structural role). */
const KEEP_EMPTY = new Set(['li', 'td', 'th']);

/** Block-level tags (subset used for wrapper-flattening heuristic). */
const BLOCK_TAGS = new Set([
    'address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'dd',
    'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'li',
    'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul',
]);

/** Inline tags eligible for adjacent-run merging. */
const MERGEABLE_INLINE = new Set([
    'b', 'strong', 'i', 'em', 'u', 's', 'span', 'code',
]);

/**
 * Check whether a DOM element has meaningful visible content
 * (text, void children like `<img>`, or nested non-empty elements).
 * @param {Element} el
 * @returns {boolean}
 */
function hasVisibleContent(el) {
    if (el.textContent?.trim().length) return true;
    for (const tag of VOID_TAGS) {
        if (el.querySelector(tag)) return true;
    }
    for (const tag of MEDIA_TAGS) {
        if (el.querySelector(tag)) return true;
    }
    return false;
}

/**
 * Check whether an element is a structural marker that should never be removed.
 * @param {Element} el
 * @returns {boolean}
 */
function isStructural(el) {
    return el.classList?.contains('sections-area');
}

/**
 * Return a fingerprint string of an element's `class` + `style` attributes.
 * @param {Element} el
 * @returns {string}
 */
function attrFingerprint(el) {
    return `${el.getAttribute('class') ?? ''}|${el.getAttribute('style') ?? ''}`;
}

/**
 * Normalize rich-HTML structure by cleaning up contenteditable browser crud.
 * Designed to be composed with `sanitizeRichHTML`:
 *   `normalizeRichHTML(sanitizeRichHTML(raw))`
 *
 * Cleanup passes (in order):
 * 1. Remove empty leaf elements (no text, no media/void children).
 * 2. Strip trailing `<br>` inside block elements when other content exists.
 * 3. Flatten redundant `<div>` wrappers (no id/class) with a single block child.
 * 4. Merge adjacent same-tag inline elements with identical style+class.
 *
 * @param {string} html - HTML string (ideally already sanitized)
 * @returns {string} structurally normalized HTML string
 */
export function normalizeRichHTML(html) {
    if (!html) return html ?? '';

    try {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const body = doc.body;

        // ── Pass 1: Remove empty leaf elements (bottom-up) ──
        const allElements = [...body.querySelectorAll('*')].reverse();
        for (const el of allElements) {
            const tag = el.tagName.toLowerCase();
            if (VOID_TAGS.has(tag)) continue;
            if (KEEP_EMPTY.has(tag)) continue;
            if (isStructural(el)) continue;
            if (!hasVisibleContent(el) && el.children.length === 0) {
                el.remove();
            }
        }

        // ── Pass 2: Strip trailing <br> in block elements ──
        for (const tag of BLOCK_TAGS) {
            for (const block of body.querySelectorAll(tag)) {
                const last = block.lastChild;
                if (!last || last.nodeName?.toLowerCase() !== 'br') continue;
                // Only strip if there's at least one other sibling with content
                const hasSiblingContent = [...block.childNodes].some(
                    (n) => n !== last && (n.textContent?.trim().length || (n.nodeType === Node.ELEMENT_NODE && VOID_TAGS.has(n.tagName?.toLowerCase())))
                );
                if (hasSiblingContent) last.remove();
            }
        }

        // ── Pass 3: Flatten redundant <div> wrappers ──
        for (const div of [...body.querySelectorAll('div')]) {
            if (div.id || (div.className && div.className.trim())) continue;
            if (isStructural(div)) continue;

            const children = [...div.childNodes].filter(
                (n) => !(n.nodeType === Node.TEXT_NODE && !n.textContent?.trim())
            );
            if (children.length === 1 && children[0].nodeType === Node.ELEMENT_NODE) {
                const child = children[0];
                if (BLOCK_TAGS.has(child.tagName.toLowerCase())) {
                    div.replaceWith(child);
                }
            }
        }

        // ── Pass 4: Merge adjacent same-tag inline elements ──
        for (const tag of MERGEABLE_INLINE) {
            for (const el of body.querySelectorAll(tag)) {
                if (!el.parentNode) continue;
                let next = el.nextSibling;
                while (
                    next &&
                    next.nodeType === Node.ELEMENT_NODE &&
                    next.tagName?.toLowerCase() === tag &&
                    attrFingerprint(el) === attrFingerprint(/** @type {Element} */ (next))
                ) {
                    // Move all children of `next` into `el`
                    while (next.firstChild) {
                        el.appendChild(next.firstChild);
                    }
                    const toRemove = next;
                    next = next.nextSibling;
                    toRemove.remove();
                }
            }
        }

        return body.innerHTML;
    } catch (error) {
        console.error('utils.js — normalizeRichHTML failed:', error);
        return html;
    }
}

// ─── Rich-Content Detection ─────────────────────────────────

/**
 * Check whether an HTML string contains meaningful visible content.
 * Handles empty editors that produce residual `<br>`, `<div><br></div>`, etc.
 *
 * @param {string | null | undefined} html
 * @returns {boolean} true if the HTML has visible text or media elements
 */
export function hasRichContent(html) {
    if (!html) return false;

    try {
        const doc = new DOMParser().parseFromString(html, 'text/html');

        // Check for text content
        if (doc.body.textContent?.trim().length) return true;

        // Check for media/visual elements
        for (const tag of MEDIA_TAGS) {
            if (doc.body.querySelector(tag)) return true;
        }

        return false;
    } catch {
        // Fallback: simple string length check
        return html.trim().length > 1;
    }
}
