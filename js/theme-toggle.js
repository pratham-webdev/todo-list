// theme-toggle.js — applies persisted theme before first paint (multi-theme)
(() => {
    const STORAGE_KEY = 'theme';
    const VALID_THEMES = ['dark', 'light', 'dracula', 'monokai', 'one-dark', 'one-dark-flat', 'one-dark-night'];
    const root = document.documentElement;

    const getPreferred = () => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored && VALID_THEMES.includes(stored)) { return stored; }
        } catch (_e) { /* private browsing */ }
        return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    };

    const apply = (theme) => {
        root.setAttribute('data-theme', theme);
    };

    // Apply immediately to avoid FOUC
    apply(getPreferred());
})();
