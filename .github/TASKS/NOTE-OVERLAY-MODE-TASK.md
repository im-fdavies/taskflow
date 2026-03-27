# DONE: Note overlay mode

| Field        | Value                    |
|-------------|--------------------------|
| Phase       | P5: Polish               |
| Priority    | Nice to have             |
| Status      | Done                     |
| Est. Effort | Small (1-2h)             |
| Dependencies| Core loop working        |

## Description

Detect "note" in voice input. Capture thought, append to log, don't trigger context switch. For capturing insights mid-task.

## Completion

- **Tested by:** `cargo build --manifest-path src-tauri/Cargo.toml` (clean), `npx vitest run` (108 tests pass including 28 new note intent tests)
- **Unexpected outcomes:** None
- **Follow-up tasks:** None
- **Confidence:** [9/10] — Straightforward regex + file insertion following established patterns; manual voice-to-log path untested in live Tauri window.
- **Files modified:**
  - `src/js/logic.js` — added `isNoteIntent()` and `extractNoteText()` exports
  - `src/js/app.js` — added note intent check in `showConfirmation()`, auto-dismiss after 1.5s
  - `src-tauri/src/commands/daily_log.rs` — added `append_note` Tauri command with `insert_note_under_task()` and `insert_note_in_summary()` helpers
  - `src-tauri/src/lib.rs` — registered `append_note` in `tauri::generate_handler![]`
  - `src/__tests__/noteIntent.test.js` — 28 unit tests for positive/negative intent detection and text extraction
