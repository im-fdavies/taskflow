# DONE: Bug batch: Pause state duplication + notes display issues

| Field | Value |
|---|---|
| Phase | P5: Polish |
| Priority | Must have |
| Status | Done |
| Est. Effort | Medium (2-4h) |
| Dependencies | Pause flow transition fix (done), Task card notes UX (done) |

## Description

Four related bugs surfaced after the task notes and pause flow features:

### Bug 1 — Task appears as both "Currently Working On" and "Paused"

`read_active_task_internal()` in `todos.rs` (line 320) returns the first task from `read_open_tasks_internal()` without checking whether that task has been paused (i.e. has a Switch entry in Summary with no subsequent non-Switch resume). Meanwhile `read_paused_tasks()` independently finds the same task in Summary. Result: duplicate display.

**Fix:** `read_active_task_internal()` should exclude tasks that appear in the paused set. Cross-reference with `read_paused_tasks()` or check the in-memory `TaskState.current_task` — if there's no `current_task` in state, nothing should show as active.

### Bug 2 — Multi-line notes truncated in card expansion

`toggleNotePanel()` in `left-panel.js` (line 89-92) filters note lines with `.filter(l => l.includes("📝"))`. Notes that span multiple lines (e.g. a 📝 line followed by `* DONE: ...` continuation lines) lose everything after the first line.

**Fix:** Parse notes block-by-block. A note block starts at a `📝` line and continues until the next `📝` line or end of string. Display each block as a unit.

### Bug 3 — Active task card shows no existing notes

When expanding the active task card, the existing-notes section is empty even though the task has notes in Open Tasks. The `toggleNotePanel` fetches from `read_open_tasks` which should have the notes — needs debugging to see if the issue is the filter stripping `📝` lines (related to bug 2) or the active task not matching by name.

### Bug 4 — "Unknown task" ghost entry in Open Tasks

When pausing via dashboard, `showTransitionState()` in `entry-flow.js` calls `append_daily_log()` which correctly logs the switch. But then the pause flow was previously falling through to Entry state which called `start_task` with an empty name, creating a `### Unknown task` entry. The pause flow fix (commit 532ce5e) should prevent this going forward, but any existing ghost entries in logs cause `read_open_tasks` to return them.

**Fix:** `read_open_tasks_internal()` should skip entries where the name is "Unknown task" or empty. Also add a guard in `start_task` to reject empty/blank task names.

## Completion

**Tested by:**
- `cargo build --manifest-path src-tauri/Cargo.toml` — compiled cleanly, zero errors/warnings
- Verified `read_active_task_internal()` now calls `read_paused_tasks()`, collects paused names into a HashSet, and uses `.find()` to skip paused tasks
- Verified `read_open_tasks_internal()` guards both flush points (line 92 and line 108 equivalents) against empty, whitespace-only, and "Unknown task" names
- Verified `start_task()` returns current state unchanged when `name.trim().is_empty()`
- Verified `toggleNotePanel()` uses block-based parsing: groups lines into blocks starting at `📝` lines, includes continuation lines, skips metadata lines
- Verified active task card click handler strips chevron character ("▾") from `nameEl.textContent` before passing to `toggleNotePanel`
- Verified `toggleNotePanel` name matching uses `.trim()` on both sides

**Unexpected outcomes:**
- The active task card's click handler was passing `nameEl.textContent` which included the chevron "▾" appended as a child span, causing name mismatch against `read_open_tasks` results. Fixed by stripping the chevron and trimming. This was a real issue beyond just the `📝` filter bug.

**Follow-up tasks:**
- None

**Confidence:** [8/10] — All four fixes are structurally correct and the Rust build passes. The chevron-stripping fix for the active card name matching is sound but hasn't been tested with a running app against real log data with paused tasks and multi-line notes.

**Files modified:**
- `src-tauri/src/commands/todos.rs`
- `src-tauri/src/commands/task.rs`
- `src/js/left-panel.js`
