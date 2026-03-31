# Render task notes as markdown + Cmd+Shift+D toggle hides dashboard

**Context:** Task notes in expanded dashboard cards render raw markdown as plain text (bullets show as `*`, links aren't clickable). Also, Cmd+Shift+D only opens the dashboard — pressing it again doesn't close it. See `.github/TASKS/BUG-NOTES-MARKDOWN-AND-DASHBOARD-TOGGLE-TASK.md`.

**What Needs Doing:**

## Step 1 — Add a lightweight markdown-to-HTML helper

In `src/js/left-panel.js`, add a function at the top of the file (after the imports/destructuring) that converts a single note line into HTML:

```javascript
function noteLineToHtml(line) {
  // Convert URLs to clickable links (open externally)
  let html = line.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener">$1</a>'
  );
  // Detect bullet lines (starting with * or -)
  const trimmed = line.trim();
  if (/^\*\s+/.test(trimmed) || /^-\s+/.test(trimmed)) {
    const content = trimmed.replace(/^[\*\-]\s+/, '');
    // Re-run URL replacement on the stripped content
    const contentHtml = content.replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener">$1</a>'
    );
    return `<li>${contentHtml}</li>`;
  }
  return `<div>${html}</div>`;
}
```

## Step 2 — Use innerHTML with the helper in `toggleNotePanel()`

In `src/js/left-panel.js`, inside `toggleNotePanel()` (around line 100-110), replace the block that creates individual note divs. Currently:

```javascript
for (const bline of block) {
  const noteEl = document.createElement("div");
  noteEl.textContent = bline;
  blockDiv.appendChild(noteEl);
}
```

Replace with:

```javascript
let hasListItems = false;
const listBuffer = [];
for (const bline of block) {
  const html = noteLineToHtml(bline);
  if (html.startsWith('<li>')) {
    hasListItems = true;
    listBuffer.push(html);
  } else {
    // Flush any buffered list items first
    if (listBuffer.length > 0) {
      const ul = document.createElement('ul');
      ul.className = 'dashboard-note-list';
      ul.innerHTML = listBuffer.join('');
      blockDiv.appendChild(ul);
      listBuffer.length = 0;
    }
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    blockDiv.appendChild(wrapper.firstChild || wrapper);
  }
}
// Flush remaining list items
if (listBuffer.length > 0) {
  const ul = document.createElement('ul');
  ul.className = 'dashboard-note-list';
  ul.innerHTML = listBuffer.join('');
  blockDiv.appendChild(ul);
}
```

## Step 3 — Add CSS for rendered notes

In `src/styles/dashboard.css`, after the existing `.dashboard-task-notes-existing > div` rule (around line 668), add:

```css
.dashboard-note-list {
  margin: 2px 0;
  padding-left: 18px;
  list-style: disc;
}

.dashboard-note-list li {
  margin: 1px 0;
  line-height: 1.5;
}

.dashboard-note-block a {
  color: rgba(99, 102, 241, 0.9);
  text-decoration: none;
  word-break: break-all;
}

.dashboard-note-block a:hover {
  text-decoration: underline;
}

.dashboard-note-block {
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 0.5px solid rgba(255, 255, 255, 0.06);
}

.dashboard-note-block:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}
```

## Step 4 — Make Cmd+Shift+D toggle the dashboard

In `src-tauri/src/commands/window.rs`, replace the `toggle_dashboard` function (lines 24-30):

```rust
pub(crate) fn toggle_dashboard(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("overlay") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
            let _ = window.emit("dashboard-opened", ());
        }
    }
}
```

**Important caveat:** The overlay window is shared between the hotkey flow and the dashboard. When the user hits Cmd+Shift+D while the overlay is showing the *listening* state (not dashboard), it should NOT hide — it should switch to the dashboard instead. To handle this, emit a `"dashboard-toggle"` event and let JS decide:

Instead of the above, do this in Rust:

```rust
pub(crate) fn toggle_dashboard(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("overlay") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("dashboard-toggle", ());
    }
}
```

Then in `src/js/app.js`, replace the `dashboard-opened` listener (lines 169-172) with:

```javascript
await listen("dashboard-toggle", () => {
  if (this.currentState === "dashboard") {
    this.close();
  } else {
    this.showDashboard();
  }
});
```

This way: if you're already on the dashboard, Cmd+Shift+D closes it. If you're on any other state (or hidden), it opens the dashboard.

**Files:**
- `src/js/left-panel.js` — add `noteLineToHtml()` helper, replace `textContent` with `innerHTML` rendering in `toggleNotePanel()`
- `src/styles/dashboard.css` — add styles for `.dashboard-note-list`, `.dashboard-note-block a`, `.dashboard-note-block` dividers
- `src-tauri/src/commands/window.rs` — change `toggle_dashboard()` to emit `"dashboard-toggle"` event
- `src/js/app.js` — change `listen("dashboard-opened")` to `listen("dashboard-toggle")` with toggle logic

**How to Test:**
- `cargo build --manifest-path src-tauri/Cargo.toml` must compile clean
- Grep for `noteLineToHtml` in `left-panel.js` to confirm the helper exists
- Grep for `dashboard-toggle` in both `window.rs` and `app.js` to confirm wiring
- Grep for `dashboard-note-list` in both `left-panel.js` and `dashboard.css`
- Verify no remaining `noteEl.textContent = bline` in `left-panel.js`

**Unexpected Outcomes:**
- The `dashboard-opened` event name change means any other listener for `dashboard-opened` will break — search for all occurrences and update them. The explore found it's only used in `app.js` lines 170-172, but double-check.
- Links in notes will open in the default browser since `target="_blank"` in a Tauri WebView opens externally. If they open inside the overlay instead, they'll need an event listener to intercept and shell out. This is a minor follow-up if it happens.
- `window.is_visible()` in Rust was considered but rejected because the overlay window serves dual purpose. The JS-side toggle based on `currentState` is more reliable.

**On Completion — update `.github/TASKS/BUG-NOTES-MARKDOWN-AND-DASHBOARD-TOGGLE-TASK.md`:**
1. Change `Status` in the metadata table to `Done`
2. Prepend `DONE: ` to the H1 title
3. Append a `## Completion` section containing:
   - **Tested by:** <commands run, scenarios verified>
   - **Unexpected outcomes:** <anything surprising, or "None">
   - **Follow-up tasks:** <new task names if any, or "None">
   - **Confidence:** `[X/10]` — <one-sentence justification>
   - **Files modified:** <list of files changed>
