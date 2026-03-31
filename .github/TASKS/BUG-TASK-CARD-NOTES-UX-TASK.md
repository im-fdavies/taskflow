# DONE: Bug: Task card notes — replace floating button with click-to-expand card

| Field | Value |
|---|---|
| Phase | P5: Polish |
| Priority | Should have |
| Status | Done |
| Est. Effort | Small (1-2h) |
| Dependencies | Task notes inline (done) |

## Description

The 📝 note button on paused task cards renders at the bottom-centre of the card, looking out of place. The desired UX is:

1. **Remove the standalone 📝 button entirely**
2. **Make the whole task card clickable** — clicking anywhere on the card (except the Resume button) expands the card downward to reveal existing notes (read-only, formatted) and a textarea + Save button to add new notes
3. **Clicking the card again (or pressing Escape) collapses it**
4. **Apply to both active task card and paused task cards**

This replaces the `createNotePanel()` button-based approach with a card-level click-to-expand pattern.

## Completion

**Tested by:**
- `cargo build --manifest-path src-tauri/Cargo.toml` — compiled successfully (exit 0)
- Manual code review: verified `createNotePanel()` no longer creates or returns a button element; returns `{ panel }` only
- Manual code review: verified paused task cards have card-level click listener with exclusions for `.dashboard-task-resume`, `.dashboard-task-notes-save`, `.dashboard-task-notes-textarea`
- Manual code review: verified active task card has card-level click listener with exclusions for `.btn-complete`, `.btn`, `.dashboard-task-notes-save`, `.dashboard-task-notes-textarea`
- Manual code review: verified `.dashboard-task-note-btn` CSS styles removed; `.dashboard-task-item` and `.dashboard-active-task-card` have `cursor: pointer`; `.dashboard-task-notes-existing` styled; chevron indicator with `.expanded` rotation added
- Manual code review: verified Escape key on textarea collapses panel and removes `.expanded` class

**Unexpected outcomes:**
- The active task card is a persistent HTML element (not rebuilt per refresh), so the click listener had to be guarded with `data-notes-bound` to avoid stacking duplicate handlers — caught and fixed during implementation

**Follow-up tasks:**
- None

**Confidence:** [8/10] — All five prompt steps implemented precisely. Build passes. The active-card persistent-element pattern is correctly handled. Cannot fully verify runtime behaviour (Tauri invoke calls, actual note display) without running the app, but the code paths are structurally sound.

**Files modified:**
- `src/js/left-panel.js`
- `src/styles/dashboard.css`
