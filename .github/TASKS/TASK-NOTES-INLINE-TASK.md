# DONE: Task notes — inline editor on open/paused task cards + voice route

| Field | Value |
|---|---|
| Phase | P5: Polish |
| Priority | Should have |
| Status | Done |
| Est. Effort | Medium (2-4h) |
| Dependencies | Open Tasks section (done), Note overlay mode (done), Dashboard active task (done) |

## Description

Users need to attach notes to any open or paused task — not just the currently active one. Today `append_note` only targets the active task. This feature adds three entry points for the same action:

### 1. Dashboard UI — inline editor on task cards

Add a **📝 button** to every task card in the dashboard (active task card, paused task cards, and open task items). Clicking the button expands the card downward to reveal a **textarea** (not a full markdown editor — keep it simple, plain text with line breaks). A **Save** button persists the note; pressing Escape or clicking outside collapses without saving. The textarea should pre-populate with any existing notes for that task (read from the daily log's `## Open Tasks` section under the task's `###` heading).

### 2. Persistence — notes live in the daily markdown log

Notes are stored as `- 📝 HH:MM — Note text` lines under the task's `### Task Name` heading in `## Open Tasks`. The existing `append_note` command already does this for the active task. Extend or add a new command (`append_task_note`) that accepts a `taskName` parameter so notes can target any open/paused task — not just the current one.

When a task moves from Open Tasks → Completed Work (via `append_completion_log` / `remove_from_open_tasks`), **all notes under that task's heading should be preserved in the completion entry** so they aren't lost. Today `remove_from_open_tasks` strips the heading — it should carry the note lines into the `### COMPLETED:` block.

When a task carries forward across days (cross-day persistence), notes should carry forward with the task entry.

### 3. Voice — "add note to [task name]: [note text]"

Add a new voice pattern in the voice flow routing (alongside existing `isNoteIntent` and `parseTodoIntent` checks). Pattern: `"add note to [task name] [note text]"` or `"note on [task name] [note text]"`. This should fuzzy-match against all open/paused task names (not just the active task). If no task name matches, fall back to adding the note to the active task (existing behaviour).

## Acceptance criteria

- [ ] Active task card in dashboard has a 📝 button that expands an inline textarea
- [ ] Each paused task card in dashboard has the same 📝 button + textarea
- [ ] Saving a note persists it to the daily log under the correct task heading
- [ ] Existing notes for a task are shown when the editor opens
- [ ] Notes are preserved when a task moves to Completed Work
- [ ] Voice: "add note to [task name]: [text]" appends a note to the named task
- [ ] Voice: "note [text]" still works as before (active task or summary)

## Technical notes

- `src-tauri/src/commands/daily_log.rs` — `append_note` currently has no `taskName` param; needs a new or extended command
- `src-tauri/src/commands/todos.rs` — `read_open_tasks` returns `OpenTask { name, notes }` — the `notes` field already captures content under each task heading, so the read path may already work
- `src/js/dashboard.js` — `refreshPausedTasks()` and the active task card need the 📝 button + expand/collapse logic
- `src/js/app.js` or `src/js/logic.js` — voice routing needs a new pattern before the existing `isNoteIntent` check
- `src-tauri/src/commands/daily_log.rs` — `remove_from_open_tasks` needs to return or carry forward the note lines into the completion block

## Completion

**Tested by:**
- `cargo build --manifest-path src-tauri/Cargo.toml` — compiled cleanly, no warnings
- `npx vitest run` — all 108 tests passed (7 test files)
- Code review of `remove_from_open_tasks` callers — confirmed only one call site (`append_completion_log`)
- Verified `markdown.rs` has no cross-day migration logic — `read_open_tasks_internal` scans all log files preserving full `###` content including 📝 lines

**Unexpected outcomes:**
- No cross-day carry-forward logic exists; tasks are read from their original log files by `read_open_tasks_internal()` which already preserves all content under each `###` heading. No fix needed for Step 7.
- The `notes_section` in completion entries will include metadata lines (e.g. `- **Started:** HH:MM`) alongside 📝 lines, since `remove_from_open_tasks` captures everything under the heading. This provides useful context in the completion log.

**Follow-up tasks:**
- None

**Confidence:** [8/10] — All code compiles cleanly and tests pass. The Rust command, note preservation, UI panels, voice routing, and CSS are all implemented per spec. Cannot verify full end-to-end manually (dashboard UI interaction, voice flow) without running the Tauri app live, but the code paths follow established patterns from `append_note` and existing dashboard logic.

**Files modified:**
- `src-tauri/src/commands/daily_log.rs`
- `src-tauri/src/lib.rs`
- `src/js/left-panel.js`
- `src/js/logic.js`
- `src/js/app.js`
- `src/styles/dashboard.css`
- `.github/TASKS/TASK-NOTES-INLINE-TASK.md`
