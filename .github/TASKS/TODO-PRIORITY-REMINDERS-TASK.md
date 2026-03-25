# DONE: Wire up todo priority and reminders

| Field | Value |
|---|---|
| Phase | P6: Integrations |
| Priority | Could have |
| Status | Done |
| Est. Effort | Medium (2-4h) |
| Dependencies | Dashboard overlay (done) |

## Description

The dashboard todo-add flow has pill buttons for Priority (Low/Med/High/Urgent) and Remind (30m/1h/2h/EOD/Custom). Currently these are UI-only - the selected values aren't saved anywhere.

## Requirements

1. **Save priority** to the daily log todo entry (e.g. `### 14:30 - Fix CI pipeline [High]`)
2. **Save reminder** - needs a mechanism to trigger a notification/alert at the specified time
3. **Custom time picker** - the "Custom" pill should open a time input so the user can set an arbitrary reminder time
4. **Display priority** in the Outstanding list (maybe a coloured dot or badge)

## Notes

- Priority storage is simple - append to the markdown entry
- Reminders need a background timer or system notification - consider Tauri's notification API or a scheduled check
- The `dismissTodoAdded()` JS method has a TODO comment for saving these values
- Custom time picker could be a simple `<input type="time">` that appears when Custom pill is selected

## Completion

**Tested by:**
- `cargo build --manifest-path src-tauri/Cargo.toml` — compiled with 0 errors
- `npx vite build` — 13 modules, 0 errors, built in 236ms
- `npx vitest run` — 68/68 tests passed (5 files)
- Code review: `TodoItem` struct serializes `time`, `name`, `priority` correctly; `read_daily_todos` parser extracts `[Priority]` tag via `rfind(" [")`; `append_todo_entry` writes `[Priority]` when provided; `update_todo_entry` rebuilds the line with new name + priority; `complete_todo_entry` and `discard_todo_entry` updated to match lines with or without priority suffix; `refreshDashboardTodos` renders coloured priority badges; `dismissTodoAdded` reads active priority pill; `findExistingTask` maps `t.name` from new struct

**Unexpected outcomes:**
- `complete_todo_entry` and `discard_todo_entry` both used `ends_with(&search)` to match todo lines, which breaks when `[Priority]` is appended. Added an additional `contains` check for `"{name} ["` pattern alongside the existing `ends_with` check. Not mentioned in the prompt but necessary for correctness.

**Follow-up tasks:**
- Reminders (timer + notification) deferred — needs design for persistence across app restarts and Tauri notification permissions

**Confidence:** [8/10] — All three builds pass and the logic is straightforward, but the `contains("{name} [")` matching in complete/discard could theoretically false-match if a todo name contains a substring that looks like another todo's name followed by " [". Very unlikely in practice.

**Files modified:**
- `src-tauri/src/commands/todos.rs`
- `src/js/dashboard.js`
- `src/js/start-flow.js`
- `src/styles/dashboard.css`
- `.github/TASKS/TODO-PRIORITY-REMINDERS-TASK.md`
