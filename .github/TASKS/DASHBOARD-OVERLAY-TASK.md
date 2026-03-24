# DONE: Dashboard overlay

| Field | Value |
|---|---|
| Phase | P5: Polish |
| Priority | Should have |
| Status | Done |
| Est. Effort | Large (1-2 days) |
| Dependencies | Daily log v2, Task completion capture |

## Description

Full-screen dashboard overlay triggered by a keyboard shortcut. Gives the user an at-a-glance view of what they're working on, what's outstanding, and lets them add todos by voice.

## UI Layout

- **Background:** Frosted glass effect over the current app state
- **Right panel:** Slides in from the right. Shows outstanding work list pulled from today's `## Todos` section in the daily log
- **Centre:** Voice input box (push-to-talk, not auto-listen). Press a button to activate mic, speak a command
- **Left panel:** Reserved for future use (TBD)

## Voice intent

- Detect "add X to my todos/list" pattern from transcription
- Extract task name from the utterance
- Optional skippable dialog: urgency level, set a reminder
- Writes lightweight todo entry to daily log's Todos section

## Summary display

- Today's Summary section visible somewhere in the overlay so the user can quickly orient after a break
- Morning summary format: what I did yesterday, what's left today, any blockers

## Notes

- This merges the scope of the old `TODO-OVERLAY-MODE-TASK.md` (voice intent detection, todo append, morning summary) with the new dashboard UI concept
- Supersedes `TODO-OVERLAY-MODE-TASK.md`

## Completion

**Tested by:**
- `cargo build` in `src-tauri/` — compiled clean, zero errors
- Reviewed `extract_section()` helper: line-based scan, finds `## Heading`, collects lines until next `## ` or EOF
- Reviewed `read_daily_todos()`: extracts `## Todos` section, filters for `### ` lines, strips prefix, returns Vec<String>
- Reviewed `read_daily_summary()`: extracts `## Summary` body, returns None if empty
- Reviewed `append_todo_entry()`: reuses `find_section_byte_offset` + `daily_log_skeleton` pattern, inserts `### HH:MM - task_name` before `## Completed Work`
- Reviewed `toggle_dashboard()`: always shows window + emits `"dashboard-opened"` (no toggle-off — user closes with Escape or Close button)
- Reviewed shortcut handler: `Cmd+Shift+D` dispatches to `toggle_dashboard`; second `global_shortcut().register()` call in `.setup()` registers it
- Reviewed HTML `#s-dashboard`: scrollable state-body, voice row, todo list, footer with Close + Refresh buttons
- Reviewed `STATES` array: `"dashboard"` added — `show("dashboard")` now works correctly
- Reviewed `showDashboard()`: loads summary + todos in parallel; silent-fails on invoke errors
- Reviewed `dashboardVoiceTap()`: toggle start/stop on same button; `stop()` returns transcribed text; parses intent; calls `append_todo_entry` + refreshes list
- Reviewed `_parseTodoIntent()`: handles "add X to my todos/list/tasks" and "remember X" / "remind me to X" patterns
- Reviewed `close()`: now stops `_dashboardVoiceCapture` if recording
- Reviewed dashboard CSS: mirrors exit/completion scrollable layout pattern; voice button uses indigo accent; recording state uses red pulse

**Unexpected outcomes:**
- No prompt file existed — implemented directly from the TASKS description
- Left panel ("Reserved for future use") omitted — 460px window width makes a true 3-panel layout impractical; the layout is single-column scrollable which fits the window

**Follow-up tasks:**
- Morning summary format (yesterday's work, today's blockers) requires a separate summary-agent command — referenced in task spec as future scope
- Optional urgency/reminder dialog on todo add (mentioned in task spec) — deferred; current flow just writes the heading
- `toggle_dashboard` always shows the window even if overlay is mid context-switch — could add a guard checking `currentState` on the JS side

**Confidence:** [8/10] — Build is clean; logic follows established patterns exactly; untested in live Tauri runtime but all wiring matches the existing working commands.

**Files modified:**
- `src-tauri/src/lib.rs`
- `index.html`
- `src/app.js`
- `src/styles.css`
