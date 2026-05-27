// ============================================================
// csv-io.js — CSV import / export (pure, no app-init side-effects)
// ============================================================

import { TodoService } from "./todo-service.js";
import { buildTaskCsvRows, stringifyCSV, buildDateListsFromCsvRows } from "./task-helpers.js";
import { sanitizeRichHTML } from "./utils.js";
import { setMessageState } from "./toast.js";

// ─── Export ──────────────────────────────────────────────────

/**
 * Export all date lists + tasks as a CSV file download.
 * Reads fresh data from IndexedDB so it can be called from any page.
 */
export async function exportCSV() {
    try {
        const dateLists = await TodoService.getAllDateLists();
        const csvRows = buildTaskCsvRows(dateLists);
        const blob = new Blob([stringifyCSV(csvRows)], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `todo-backup-${new Date().toLocaleDateString('fr-CA')}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        setMessageState('success', 'CSV exported successfully!');
    } catch (error) {
        console.error('csv-io.js — exportCSV failed:', error);
        setMessageState('failure', 'Error exporting CSV');
    }
}

// ─── Parse ───────────────────────────────────────────────────

/**
 * Parse a CSV string (RFC 4180) into an array of row arrays.
 * @param {string} text
 * @returns {Array<Array<string>>}
 */
function parseCSV(text) {
    const rows = [];
    let current = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else { inQuotes = false; }
            } else {
                field += ch;
            }
        } else {
            if (ch === '"') { inQuotes = true; }
            else if (ch === ',') { current.push(field); field = ''; }
            else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
                current.push(field); field = '';
                rows.push(current); current = [];
                if (ch === '\r') i++;
            } else {
                field += ch;
            }
        }
    }
    // Last field / row
    if (field || current.length) {
        current.push(field);
        rows.push(current);
    }
    return rows;
}

// ─── Import ──────────────────────────────────────────────────

/**
 * Import a CSV file: parse it, write date lists to IndexedDB, and optionally
 * call a refresh callback.
 * @param {() => Promise<void>} [onComplete] - optional callback after successful import
 */
export function importCSV(onComplete) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const rows = parseCSV(text);
            if (rows.length < 2) {
                setMessageState('failure', 'CSV file is empty or has no data rows.');
                return;
            }

            // Sanitize all imported task descriptions through the HTML allowlist
            const dateLists = buildDateListsFromCsvRows(rows).map((dateList) => ({
                ...dateList,
                taskList: dateList.taskList.map((task) => ({
                    ...task,
                    desc: sanitizeRichHTML(task.desc),
                })),
            }));

            // Write each date list to IndexedDB
            for (const dateList of dateLists) {
                await TodoService.saveDateList(dateList);
            }

            if (onComplete) await onComplete();
            setMessageState('success', `Imported ${dateLists.length} date list(s) successfully!`);
        } catch (error) {
            console.error('csv-io.js — importCSV failed:', error);
            setMessageState('failure', 'Error importing CSV file');
        }
    });
    input.click();
}
