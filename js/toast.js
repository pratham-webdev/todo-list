// ============================================================
// toast.js — Shared toast notification utility
// ============================================================

/**
 * Show a success or failure toast message for 4 seconds.
 * @param {'success'|'failure'} type
 * @param {string} message
 */
export function setMessageState(type, message) {
    const messageEl = document.getElementById(`${type}-message`);
    if (!messageEl) return;
    messageEl.textContent = message;
    messageEl.style.display = 'block';
    setTimeout(() => { messageEl.style.display = 'none'; }, 4000);
}
