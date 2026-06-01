# Todo List & Notes App

A feature-rich, offline-first productivity suite built entirely with vanilla HTML, CSS, and JavaScript. Every piece of data lives in your browser's IndexedDB and localStorage — there is no server, no user account, and no telemetry. The app is designed to feel like a lightweight desktop IDE: a vertical activity bar on the left provides one-click navigation between the four main views (To-Do Lists, Notes, Markdown Reader, and Settings), while the content area adapts to each view's layout.

---

## To-Do Lists

The To-Do List view is the primary workspace. It uses a **date-based** organization model: every task belongs to a specific date list, and the sidebar calendar navigator lets you jump between dates instantly.

### Creating Date Lists

Click the date picker at the top of the sidebar and select a date, then press the **+** button. A new date list appears in the sidebar navigation, sorted chronologically. Each date list is stored as a separate record in IndexedDB, so you can have hundreds of dates without performance issues.

### Managing Tasks

Once you've selected a date list, you'll see its task list in the main content area:

- **Create a task** — type a name into the input field at the top of the list and press **Enter**. The task appears immediately with a checkbox, edit button, detail button, and delete button.
- **Edit a task name** — click the pencil icon next to any task. The name becomes an editable text field. Press **Enter** to save or **Escape** to discard changes. URLs in task names are automatically detected and rendered as clickable links.
- **Mark as done** — click the checkbox to toggle completion. Completed tasks receive a strikethrough style and are visually muted. You can also use the "Mark All Done" button at the top of each date list to complete every task at once.
- **Delete a task** — click the trash icon on the task row, or right-click and choose *Delete* from the context menu.
- **Drag and drop** — every task is draggable. Grab a task and drop it onto a different date list in the sidebar to reschedule it. The move is persisted to IndexedDB immediately.
- **Multi-select** — hold **Ctrl** and click multiple tasks to select them (they get a highlight). Then right-click to open the context menu, which lets you mark all selected tasks as done or delete them in bulk.

### Task Detail Panel

Every task has a detail button (the expand icon). Clicking it opens a slide-over panel from the right side of the screen. Inside the panel you'll find:

- **Task name** — displayed as the panel title; click the edit icon to rename it inline.
- **Rich-text notes area** — a full contenteditable editor where you can write extended notes for the task. The editor supports:
  - **Bold** (`Ctrl + B`), **Italic** (`Ctrl + I`), **Underline**, and **Strikethrough** via toolbar buttons.
  - **Headings** (H1–H6) via a dropdown in the toolbar.
  - **Ordered lists** (`Ctrl + 9`) and **Unordered lists** (`Tab`).
  - **Hyperlinks** (`Ctrl + K`) — prompts for a URL and wraps the selected text.
  - **Code blocks** (`` Ctrl + ` ``) — inserts a `<pre><code>` block.
  - **Horizontal rules** via the toolbar.
- **Color picker** — change the text color of selected content.
- **Safe pasting** — when you paste HTML from external sources (e.g., a webpage or Word document), the content is run through a DOM-based allowlist sanitizer that strips scripts, iframes, event handlers, and unsafe attributes while preserving safe formatting like bold, italic, links, images, and tables.
- **Auto-save** — every change to the notes area is automatically persisted to IndexedDB. There is no save button; your work is always preserved.
- **Delete from detail** — you can also delete the task directly from the detail panel.

### Context Menu

Right-clicking any task (or group of selected tasks) opens a context menu with two options: *Mark as Done/Undone* and *Delete*. The menu is positioned at the cursor location and dismisses when you click elsewhere.

---

## Notes

The Notes view is a multi-page notebook designed for longer-form writing and organization. It occupies the full content area with its own sidebar for page navigation.

### Pages

- **Create a page** — click the **+** button at the top of the notes sidebar. A new page is created with a default title and one empty section.
- **Rename a page** — right-click the page in the sidebar and choose *Rename*, or double-click the page title.
- **Delete a page** — right-click and choose *Delete*. A confirmation ensures you don't lose content accidentally.
- **Export a page** — right-click and choose *Export* to download the page as a `.json` file containing all of its sections.

### Sections

Each page is divided into **sections** — titled blocks of content. This lets you organize a page like a document with chapters:

- **Add a section** — click the **+** button at the bottom of the page. A new section appears with an editable title and empty content area.
- **Edit the title** — click on a section's title text to rename it inline.
- **Rich-text editing** — each section has the same rich-text editing capabilities as the task detail panel: bold, italic, underline, strikethrough, headings, lists, links, code blocks, horizontal rules, and a color picker. The formatting toolbar appears within each section.
- **Markdown editing** — right-click a section and choose *Markdown* to open a full-screen split-pane markdown editor. The left pane is a raw markdown textarea, and the right pane shows the live-rendered HTML preview. Click *Update* to convert the markdown back into the section's rich-text content, or *Cancel* to discard.
- **Reorder sections** — right-click a section and choose *Move Up* or *Move Down* to change its position within the page.
- **Hide a section** — right-click and choose *Hide* to collapse a section. Hidden sections are still saved; they just don't take up visual space.
- **Delete a section** — right-click and choose *Delete* to permanently remove it.

### Auto-Save

Like the task detail panel, every keystroke in a notes section is auto-saved to IndexedDB. There is no explicit save action — your content is always persisted.

---

## Markdown Reader

The Markdown Reader is a standalone split-pane editor on its own page. It's useful for quickly previewing `.md` files or drafting markdown content.

### Layout

The page is divided into two equal panes:
- **Left pane** — a plain-text `<textarea>` where you type or paste raw markdown.
- **Right pane** — a rendered HTML preview that updates in real time as you type (with a 200ms debounce for performance).

### Features

- **Live rendering** — powered by `marked.js` with GitHub Flavored Markdown (GFM) enabled. Supports headings, bold, italic, code blocks, tables, lists, blockquotes, horizontal rules, images, and links.
- **File import** — click the *Open .md File* button in the toolbar to open a native file picker filtered to `.md`, `.markdown`, and `.txt` files. You can also drag and drop a file directly onto the editor area.
- **Draft persistence** — your current markdown draft is automatically saved to IndexedDB using the same `TodoService` storage layer as the rest of the app. When you return to the page, your last draft is restored.
- **Clear** — click the eraser button in the toolbar to wipe both panes and start fresh.
- **HTML sanitization** — the rendered preview is passed through `sanitizeRichHTML()` before being injected into the DOM, ensuring that any embedded scripts or unsafe HTML in the markdown source are stripped.

---

## MCP Integration

The app includes a **Model Context Protocol (MCP)** integration that lets you manage your tasks from Claude Desktop using natural language. This feature consists of two parts: a standalone MCP server (Node.js process) and a browser-side WebSocket bridge.

### How It Works

1. **MCP Server** — a Node.js process (`mcp-server/`) that Claude Desktop connects to via stdio transport. It exposes 18 tools: `get_all_date_lists`, `get_date_list`, `get_tasks_by_status`, `create_date_list`, `add_task`, `update_task`, `mark_task_done`, `mark_all_done`, `delete_task`, `move_tasks`, `batch_update_tasks`, `batch_update_tasks_across_dates`, `batch_update_date_lists`, `preview_overwrite_date_lists`, `confirm_overwrite_date_lists`, `batch_create_date_lists`, `batch_add_tasks`, and `batch_create_date_lists_with_tasks`.
2. **WebSocket Bridge** — the browser tab opens a WebSocket connection (default `ws://127.0.0.1:8765`) to the MCP server. Only one browser tab holds the active WebSocket connection at a time (single-client constraint enforced by the server). When Claude sends a command (e.g., "add a task called 'Buy groceries' to today's list"), the server forwards the operation to the browser via WebSocket.
3. **IndexedDB Sync** — the browser-side bridge (`mcp-bridge.js`) executes the operation through `TodoService` — the same data layer the UI uses — ensuring consistency. After every write, `refreshUI()` is called so you see the change in real time.
4. **Status Relay** — `mcp-bridge.js` writes the connection state to `localStorage`. A lightweight `mcp-status-relay.js` (loaded on all pages) reads this state and injects a status indicator dot into the activity bar — no WebSocket needed on non-index pages. The connection auto-reconnects when the tab regains visibility.

### Configuration

1. Navigate to **Settings → MCP Connection**.
2. Enter the WebSocket URL (default: `ws://127.0.0.1:8765`).
3. Click **Save**. The URL is validated and stored in `localStorage`.
4. The status indicator shows the current connection state: *Connected* (green), *Connecting* (yellow), or *Disconnected* (red). A status dot is also visible in the activity bar on all pages.
5. **Debug Logging** — toggle via the *Debug Logging* button in the MCP Connection card. When enabled, timestamped `console.debug` messages appear in DevTools for connect/close/message events. Off by default.

### Batch & Overwrite Tools

The MCP server includes batch tools for efficient bulk operations:

- **`batch_update_tasks`** — update multiple tasks within a single date list in one call (max 100 entries).
- **`batch_update_tasks_across_dates`** — update tasks spanning multiple date lists in one call (max 200 entries).
- **`batch_update_date_lists`** — rename multiple date lists at once (max 50 entries).
- **`preview_overwrite_date_lists`** / **`confirm_overwrite_date_lists`** — a two-step flow for replacing entire task arrays. The preview step returns a diff and a one-time token (60 s TTL). Claude must show the diff to you and get your explicit approval before calling confirm. This prevents accidental data loss.
- **`batch_create_date_lists`** — create multiple empty date lists at once (max 50). Skips existing.
- **`batch_add_tasks`** — add multiple new tasks to a single date list (max 100). Auto-creates the date list if needed.
- **`batch_create_date_lists_with_tasks`** — create date lists and populate them with tasks in one call (max 20 lists, 200 tasks). Skips existing lists.

### MCP Server Setup

The server lives in the `mcp-server/` subfolder and requires:
- A Firebase service account key (`serviceAccountKey.json`) for Firestore-backed persistent storage.
- The `FIREBASE_UID` environment variable set to your user ID.
- Configuration in Claude Desktop's `claude_desktop_config.json` to register the MCP server.

For detailed setup instructions, security model, and troubleshooting, see `mcp-server/README.md`.

---

## Themes

The app ships with **seven color themes**, all defined as CSS custom property overrides on the `[data-theme]` attribute. Every color in the UI — backgrounds, text, borders, accents, buttons, shadows — is driven by design tokens, so switching themes changes the entire look instantly.

### Available Themes

| Theme | Accent Color | Description |
|---|---|---|
| **Dark** | `#61afef` (blue) | The default theme. Based on One Dark Pro Night Flat — a popular VS Code theme with a very dark background and soft blue accents. |
| **Light** | `#0d6efd` (blue) | A clean light theme inspired by Bootstrap 5's default palette. White cards, light gray backgrounds, and high-contrast text. |
| **Dracula** | `#bd93f9` (purple) | The classic Dracula palette with rich purples, pinks, and cyans on a dark charcoal background. |
| **Monokai** | `#66d9ef` (cyan) | Inspired by the legendary Monokai color scheme. Warm greens, vibrant pinks, and soft yellows on an olive-tinted dark background. |
| **One Dark** | `#61afef` (blue) | Atom's One Dark theme with a two-tone layout: darker sidebar (`#21252b`) contrasting with a lighter editor area (`#282c34`). |
| **One Dark Flat** | `#61afef` (blue) | A flattened variant of One Dark where the sidebar and editor share the same `#282c34` background for a uniform look. |
| **One Dark Night** | `#61afef` (blue) | The darkest variant. Uses `#16191d` as the base background — ideal for low-light environments. |

### How Themes Work

- Themes are selected via **color swatches** in **Settings → Appearance**. Each swatch is a small circle showing the theme's accent color; hovering reveals the theme name.
- Your selection is saved to `localStorage` under the `theme` key.
- On every page load, `theme-toggle.js` runs before any other script and sets `data-theme` on the `<html>` element, preventing a flash of unstyled content (FOUC).
- The CSS uses `:root` for the default Dark theme and `[data-theme="..."]` selectors for all others, each overriding approximately 30 CSS custom properties.

---

## Typography

The Typography settings let you personalize fonts and text sizes across the entire application.

### Font Selection

- **Global Font** — controls the font family for the entire UI: the activity bar, sidebar navigation, settings page, and all chrome elements. Defaults to *Inter*.
- **Content Font** — controls the font family for the main content area: task lists, task detail notes, notes sections, and the markdown reader preview. Defaults to inheriting the global font.
- **Font list** — choose from 20 curated Google Fonts: Inter, Roboto, Open Sans, Lato, Montserrat, Nunito, Poppins, Raleway, Source Sans 3, Work Sans, Rubik, Noto Sans, DM Sans, Outfit, Manrope, Figtree, Plus Jakarta Sans, Albert Sans, Lexend, and Geist.
- **Dynamic loading** — when you select a font, the app injects a `<link>` tag for the Google Fonts CSS on demand. The font is loaded at weights 400, 500, 600, and 700 with `display=swap` for optimal performance.

### Text Size

- **Global Text Size** — adjusts the base `font-size` on the `<body>` element via the `--font-size-global` CSS custom property. Range: 12–20px. Affects everything.
- **Content Text Size** — adjusts the `font-size` on the `#app-shell` content area via `--font-size-content`. Range: 12–20px. Overrides the global size for the main content only.
- **Controls** — each size has a range slider, a numeric input field (for precise values), and a reset button that restores the default (14px).
- **Persistence** — font choices and sizes are stored in `localStorage` and applied on page load by `font-loader.js`, which runs as a non-module IIFE before the DOM renders.

---

## Data Management

All application data is stored client-side. There is no cloud sync — your data stays on your machine.

### Storage Architecture

- **IndexedDB** — the primary data store. All date lists, tasks, notes pages, notes sections, and markdown drafts are stored in IndexedDB via the `TodoService` abstraction layer. IndexedDB supports structured data, large payloads, and transactional reads/writes.
- **localStorage** — used for lightweight preferences: theme, fonts, font sizes, MCP WebSocket URL, and auto-backup settings.

### Import & Export

- **Todo CSV Export** — exports every date list and all its tasks as a single CSV file. Columns include the date, task name, status, and description (HTML-encoded). The file is generated in-browser and downloaded via a Blob URL.
- **Todo CSV Import** — reads a CSV file (matching the export format) and merges the data into IndexedDB. Existing date lists are updated; new ones are created. HTML descriptions are sanitized on import.
- **Notes JSON Export** — exports all notes pages (with their sections and content) as a single JSON file.
- **Notes JSON Import** — reads a JSON file and restores the notes data. Existing pages are overwritten if IDs match.

### Auto Backup

The auto-backup feature uses the **File System Access API** (available in Chromium browsers) to write daily backups without any user interaction after initial setup:

1. Toggle auto-backup in **Settings → Data**.
2. The first time, the browser prompts you to choose a backup folder. The directory handle is persisted in IndexedDB so you won't be asked again.
3. Every day (checked on page load and periodically), the app compares today's date against the last backup date stored in `localStorage`. If a backup hasn't been written today, it exports a CSV and writes it to your chosen folder with a timestamped filename.
4. The directory handle requires a one-time permission re-grant per browser session for security.

### Storage Usage

The **Settings → About** section displays your current storage consumption (used / quota) via the `navigator.storage.estimate()` API. This gives you a rough sense of how much IndexedDB space your data occupies.

---

## Keyboard Shortcuts

### Task Management

| Context | Shortcut | Action |
|---|---|---|
| Task input field | `Enter` | Create a new task with the typed name |
| Inline task edit | `Enter` | Save the renamed task |
| Inline task edit | `Escape` | Cancel the edit and restore the original name |
| Task list | `Ctrl + Click` | Multi-select tasks for bulk actions |
| Task list | Right-click | Open the context menu (Mark Done/Undone, Delete) |

### Rich-Text Editor (Task Detail & Notes)

| Shortcut | Action |
|---|---|
| `Ctrl + B` | Bold the selected text |
| `Ctrl + I` | Italicize the selected text |
| `Ctrl + K` | Insert a hyperlink around the selected text |
| `` Ctrl + ` `` | Insert a code block |
| `Ctrl + 9` | Insert an ordered list |
| `Tab` | Insert an unordered list |

---

## Settings

The Settings page is accessible from the gear icon in the activity bar. It uses a sidebar navigation layout with scroll-spy: as you scroll through the content, the active section is highlighted in the sidebar.

### Sections

- **Appearance** — choose from 7 color themes via circular swatches. The active theme is highlighted with a border ring.
- **Typography** — select global and content fonts from a dropdown of 20 Google Fonts. Adjust text sizes with range sliders, numeric inputs, or reset buttons.
- **MCP Connection** — enter the WebSocket URL for the MCP server bridge. Click Save to validate and persist the URL. A status indicator shows the connection state.
- **Data** — export/import todos as CSV and notes as JSON. Toggle the daily auto-backup feature.
- **About** — displays the app version and current storage usage. Below that, this documentation is rendered from the `docs/README.md` file.
- **Danger Zone** — three destructive actions, each requiring intent (no accidental clicks):
  - *Purge Todos* — deletes all date lists and tasks from IndexedDB.
  - *Purge Notes* — deletes all notes pages and sections from IndexedDB.
  - *Factory Reset* — wipes everything (todos, notes, markdown drafts, and all localStorage preferences) and reloads the page.

---
