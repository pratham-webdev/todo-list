// ============================================================
// notes-io.js — Notes JSON import / export (pure, no app-init side-effects)
// ============================================================

import { TodoService } from "./todo-service.js";
import { sanitizeRichHTML } from "./utils.js";
import { getLocalDateInputValue, STATUS_TODO } from "./task-helpers.js";
import { setMessageState } from "./toast.js";

// ─── Export ──────────────────────────────────────────────────

/**
 * Export all notes pages as a JSON file download.
 * Reads fresh data from IndexedDB so it can be called from any page.
 */
export async function exportNotesJSON() {
    try {
        const notes = await TodoService.getAllNotes();
        const json = JSON.stringify(notes, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `notes-backup-${getLocalDateInputValue()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setMessageState('success', 'Notes exported successfully!');
    } catch (error) {
        console.error('notes-io.js — exportNotesJSON failed:', error);
        setMessageState('failure', 'Error exporting notes');
    }
}

// ─── Import ──────────────────────────────────────────────────

/**
 * Import notes pages from a JSON file, write to IndexedDB, and optionally
 * call a refresh callback.
 * @param {() => Promise<void>} [onComplete] - optional callback after successful import
 */
export function importNotesJSON(onComplete) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const pages = JSON.parse(text);

            if (!Array.isArray(pages) || pages.length === 0) {
                setMessageState('failure', 'Invalid or empty JSON file.');
                return;
            }

            for (const page of pages) {
                if (!page.id || !page.name) continue;
                const note = {
                    id: page.id,
                    name: page.name,
                    status: page.status ?? STATUS_TODO,
                    html: page.html ? sanitizeRichHTML(page.html) : '',
                };
                await TodoService.saveNote(note);
            }

            if (onComplete) await onComplete();
            setMessageState('success', 'Notes imported successfully!');
        } catch (error) {
            console.error('notes-io.js — importNotesJSON failed:', error);
            setMessageState('failure', 'Error importing notes');
        }
    });
    input.click();
}
