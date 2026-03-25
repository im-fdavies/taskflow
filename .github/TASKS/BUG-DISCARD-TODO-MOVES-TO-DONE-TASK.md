# DONE: Bug: Discard (✕) button on todo moves item to Done instead of removing it

| Field | Value |
|---|---|
| Phase | P5: Polish |
| Priority | Should have |
| Status | Done |
| Est. Effort | Small (< 1h) |
| Dependencies | Todo priority (done) |

## Description

Clicking the ✕ (discard) button on a todo in the Outstanding list moves the item to the Done section instead of removing it entirely. Expected behaviour: discard should delete the entry from the log file completely, not move it to Completed Work.

## Likely cause

After the priority refactor, `read_daily_todos` returns `{ time, name, priority }` objects instead of plain strings. The `completeTodo` and `discardTodo` onclick handlers in `refreshDashboardTodos()` (in `src/js/dashboard.js`) may be passing the full object to Rust commands that expect a string, or the wrong handler is wired to the wrong button.

## Where to look

- `src/js/dashboard.js` - `refreshDashboardTodos()` rendering loop, check `doneBtn.onclick` and `discardBtn.onclick` parameter passing
- `src-tauri/src/commands/todos.rs` - `discard_todo_entry` and `complete_todo_entry` - both expect `todo_text: String`

## Completion

**Tested by:**
- `git show be155e7 -- src/js/dashboard.js` — confirmed two-step confirm flow removed; `discardTodo` now calls `discard_todo_entry` immediately on single ✕ click
- `git show 10d8718 -- src/js/dashboard.js` — confirmed `discardTodo(todo, div)` → `discardTodo(todo.name, div)` fix for object vs string param
- `cargo build --manifest-path src-tauri/Cargo.toml` — clean build, 0.95s, no errors or warnings
- Traced `discard_todo_entry` Rust code — removes matching `### ` line from log, does NOT insert a completion entry; confirmed `complete_todo_entry` is never called on the discard path

**Unexpected outcomes:**
- Bug was already fixed across two commits (10d8718 + be155e7) before this task was assigned. The task description correctly identified the priority-refactor object-vs-string issue (10d8718 fixed it), but the actual "moves to Done" symptom was caused by the old two-step confirm UX: first ✕ click changed item text to "Discard this todo?", users then clicked ✓ (thinking it confirmed), which called `completeTodo`. be155e7 removed that flow entirely.

**Follow-up tasks:**
- None

**Confidence:** 9/10 — Both root causes are traceable in git, fix code is clean and correct. Cannot run the Tauri UI at runtime to click the button manually, but the code path is unambiguous.

**Files modified:**
- `.github/TASKS/BUG-DISCARD-TODO-MOVES-TO-DONE-TASK.md`
