// font-loader.js — applies persisted font/size preferences before first paint
// Duplicated FONTS list — IIFE cannot import ES modules
(() => {
    const FONTS = [
        'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat',
        'Nunito', 'Poppins', 'Raleway', 'Source Sans 3', 'Work Sans',
        'Rubik', 'Noto Sans', 'DM Sans', 'Outfit', 'Manrope',
        'Figtree', 'Plus Jakarta Sans', 'Albert Sans', 'Lexend', 'Geist',
    ];
    const root = document.documentElement;

    const safe = (key) => {
        try { return localStorage.getItem(key); } catch (_e) { return null; }
    };

    const fg = safe('font-global');
    const fc = safe('font-content');
    const sg = safe('font-size-global');
    const sc = safe('font-size-content');

    // Set font-family custom properties
    if (fg && FONTS.includes(fg)) {
        root.style.setProperty('--font-global', `"${fg}", sans-serif`);
    }
    if (fc && FONTS.includes(fc)) {
        root.style.setProperty('--font-content', `"${fc}", sans-serif`);
    }

    // Validate size is a finite number within range before applying
    const validSize = (v) => {
        const n = Number(v);
        return Number.isFinite(n) && n >= 8 && n <= 32;
    };
    if (sg && validSize(sg)) {
        root.style.setProperty('--font-size-global', `${sg}px`);
    }
    if (sc && validSize(sc)) {
        root.style.setProperty('--font-size-content', `${sc}px`);
    }

    // Inject Google Fonts <link> for non-default selected fonts
    const needed = [fg, fc]
        .filter((f) => f && f !== 'Inter' && FONTS.includes(f))
        .filter((f, i, a) => a.indexOf(f) === i);

    if (needed.length > 0) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = `https://fonts.googleapis.com/css2?${needed.map((f) => `family=${f.replace(/ /g, '+')}:wght@400;500;600;700`).join('&')}&display=swap`;
        document.head.appendChild(link);
    }
})();
