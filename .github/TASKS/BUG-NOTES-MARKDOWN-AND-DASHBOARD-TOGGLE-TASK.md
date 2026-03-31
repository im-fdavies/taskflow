# DONE: Render task notes as markdown + Cmd+Shift+D toggle hides dashboard

| Field | Value |
|---|---|
| Phase | P3: Coaching |
| Priority | Must have |
| Status | Done |
| Est. Effort | Small (1-2h) |
| Dependencies | Task notes inline (done), Dashboard (done) |

## Description

### Bug 1 — Notes render as plain text
Task notes in the expanded card panel display raw markdown (e.g. `* DONE: https://...`) as plain text instead of rendering bullet points and links. The cause is `noteEl.textContent = bline` in `left-panel.js` which escapes all HTML/markdown.

### Bug 2 — Cmd+Shift+D doesn't hide the dashboard
`toggle_dashboard()` in `window.rs` always shows the window — it never checks if the dashboard is already visible to hide it instead.

## Requirements
1. Parse note lines into basic HTML: `*` or `-` bullets → `<li>`, URLs → clickable `<a>` links, plain text → `<p>`. No full markdown parser needed — just bullets and links.
2. Cmd+Shift+D should toggle: if the dashboard is currently showing, hide the window; if hidden, show it.

## Completion

**Tested by:**
- `cargo build --manifest-path src-tauri/Cargo.toml` — compiled clean (0 errors, 0 warnings)
- `grep noteLineToHtml src/js/left-panel.js` — helper defined at line 8, called at line 129
- `grep dashboard-toggle` across repo — found in `window.rs:28` and `app.js:170`
- `grep dashboard-note-list` across repo — found in `left-panel.js:137,150` and `dashboard.css:667,673`
- `grep "noteEl\.textContent = bline" src/js/left-panel.js` — no matches (old code removed)
- `grep dashboard-opened` across repo — no matches (fully replaced)

**Unexpected outcomes:**
- None

**Follow-up tasks:**
- None

**Confidence:** [9/10] — All four changes are mechanical and verified by grep + cargo build. The only gap is no live UI test confirming rendered notes look correct in-app, but the code paths are straightforward.

**Files modified:**
- `src/js/left-panel.js`
- `src/styles/dashboard.css`
- `src-tauri/src/commands/window.rs`
- `src/js/app.js`
- `.github/TASKS/BUG-NOTES-MARKDOWN-AND-DASHBOARD-TOGGLE-TASK.md`
