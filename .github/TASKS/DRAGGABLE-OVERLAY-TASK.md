# DONE: Draggable overlay window

| Field        | Value                    |
|-------------|--------------------------|
| Phase       | P5: Polish               |
| Priority    | Should have              |
| Status      | Done                     |
| Est. Effort | Small (1-2h)             |
| Dependencies| P0 complete              |

## Description

Make the overlay card draggable so it can be repositioned when it covers text the user needs to read.

## Implementation

Tauri supports this via `data-tauri-drag-region` attribute on an element, or via the `window.startDragging()` API.

## Completion

**Tested by:**
- Confirmed Tauri version is v2 via `Cargo.toml` — `data-tauri-drag-region` is correct attribute ✅
- Added `data-tauri-drag-region` to `<div id="overlay">` in `index.html` line 10 ✅
- Added `-webkit-app-region: no-drag` rule for `button, textarea, input, select, .exit-mic-btn, .word-token, [contenteditable]` in `styles.css` after `#overlay` block ✅
- Verified `#overlay` structure: `#overlay > .state > (buttons, textareas, etc.)` — padding area and `.ol-state` label rows are draggable; interactive children are excluded ✅
- Runtime drag/click testing: not possible without launching the Tauri app

**Unexpected outcomes:**
- None

**Follow-up tasks:**
- None

**Confidence:** [8/10] — Implementation matches Tauri v2 docs exactly; no-drag selector covers all interactive element types; only gap is no runtime drag test.

**Files modified:**
- `index.html`
- `src/styles.css`
