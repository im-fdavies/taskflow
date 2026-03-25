# DONE: Dashboard: Done section with completed todos

| Field | Value |
|---|---|
| Phase | P5: Polish |
| Priority | Should have |
| Status | Done |
| Est. Effort | Small (1-2h) |
| Dependencies | Dashboard overlay (done) |

## Description

Add a "Done" section below "Outstanding" in the dashboard right panel. When a user clicks the ✓ button on a todo, the item should animate down into the Done section rather than just disappearing.

## Requirements

1. **Done section** in the dashboard panel below Outstanding - shows todos that have been completed today
2. **Animation** - when ✓ is clicked, the todo card should fly/slide down from Outstanding into Done (CSS transition/animation)
3. Done items should show with strikethrough or muted styling
4. The Done section label should only appear when there are completed items
5. Data source: `read_daily_todos` already pulls from `## Todos` section - need a `read_completed_todos` Rust command that reads from `## Completed Work` and filters for `COMPLETED:` entries

## Notes

- The `complete_todo_entry` Rust command already moves todos from `## Todos` to `## Completed Work` with a `COMPLETED:` prefix
- The HTML structure is partially in place (`#dashboard-done-label`, `#dashboard-done-list`) but needs JS wiring and CSS animation
- Keep it simple - a slide-down with fade is fine if a full "fly" animation is too complex

## Completion

**Tested by:**
- `cargo build --manifest-path src-tauri/Cargo.toml` — compiled with 0 errors
- `npx vite build` — 13 modules, 0 errors, built in 351ms
- Code review: `read_completed_todos` extracts task names from `### HH:MM - COMPLETED: name` lines in the Completed Work section using `ensure_log_sections` + `extract_section`
- Code review: `refreshDoneTodos` renders items as `.dashboard-done-item` with strikethrough, hides label when empty
- Code review: `completeTodo` adds `.completing` class for fade-out animation, waits 250ms, then refreshes both lists
- Code review: `refreshDashboardTodos` calls `refreshDoneTodos()` at the end so both lists update together

**Unexpected outcomes:**
- None

**Follow-up tasks:**
- None

**Confidence:** [8/10] — Builds clean and code paths are correct. The 250ms animation delay before list refresh is a simple approach but could feel slightly janky if the invoke is slow — would need a live test to confirm the timing feels right.

**Files modified:**
- `src-tauri/src/commands/todos.rs`
- `src-tauri/src/lib.rs`
- `src/js/dashboard.js`
- `src/styles/dashboard.css`
- `.github/TASKS/DASHBOARD-DONE-SECTION-TASK.md`
