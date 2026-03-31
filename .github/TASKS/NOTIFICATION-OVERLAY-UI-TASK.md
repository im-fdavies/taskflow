# DONE: Notification system B — overlay UI + template signal wiring + todo reminders

| Field | Value |
|---|---|
| Phase | P3: Coaching |
| Priority | Must have |
| Status | Done |
| Est. Effort | Medium (2-4h) |
| Dependencies | Notification timer infra (Part A) |

## Description

Wire the timer infrastructure (Part A) to the in-app overlay and connect the two trigger sources: template signals and todo reminders.

### What this task delivers

1. **Notification overlay state** — add a new `#s-notification` div in `index.html` (same pattern as other state divs). Contains: a label ("NOTIFICATION"), a title, a body text area, and a "Dismiss" button. Auto-dismiss after 10 seconds if not interacted with.

2. **JS event listener** — in `app.js`, listen for the `"notification-fired"` Tauri event. On fire: show the overlay window (invoke `show()` on the webview), switch to the notification state, populate title + body from the event payload. Dismiss button hides the overlay.

3. **Template signal registration** — when `start_task` is called with a matched template, inspect the template's `signals` array (from the YAML). For any signal with a time-based condition (e.g. `after: 45m` or `after: 1h`), calculate `now + duration`, call `invoke("register_timer", { fireTime, title: signal.name, body: signal.guidance, timerType: "signal" })`.

4. **Todo reminder hookup** — the todo priority/reminder UI already exists (from TODO-PRIORITY-REMINDERS-TASK). When the user sets a reminder time on a todo, call `invoke("register_timer", { fireTime: reminderTime, title: todoText, body: "Reminder", timerType: "todo" })`.

5. **CSS** — style `#s-notification` matching the frosted-glass overlay aesthetic. The notification card should be compact — smaller than the full exit/entry states.

## Technical notes

- Tauri 2 event listening in JS: `window.__TAURI__.event.listen("notification-fired", handler)`
- Template signals are defined in `templates/*.yaml` — check `_schema.yaml` for the `signals` structure
- The overlay window show/hide is managed by `toggle_overlay()` in Rust and `hide_overlay` command
- Auto-dismiss: `setTimeout(() => hide, 10000)` cleared on user interaction

## Completion

**Tested by:**
- `cargo build --manifest-path src-tauri/Cargo.toml` — compiled successfully (no Rust changes, exit 0)
- Node.js validation script checking all 17 acceptance criteria — all passed (HTML structure, STATES array, event listener, showNotification, dismissNotification, auto-dismiss timeout, register_timer in startTask, todo reminder hookup, eod mapping, custom skip, CSS classes, blue accent border, styles.css import)

**Unexpected outcomes:**
- The `_dismissTodoAdded()` function clears all `.active` pill classes and resets the todo input — had to capture the active pill reference and todo text *before* calling `_dismissTodoAdded()` to avoid losing the reminder selection. The prompt anticipated this ("may need to happen in app.js's wrapper method").
- Payload field for task name could arrive as either `taskName` (JS convention) or `task_name` (Rust serde convention) — handled both with `payload.taskName || payload.task_name`.

**Follow-up tasks:**
- Custom reminder time picker (the `"custom"` pill value is explicitly skipped)
- Non-time-based signal conditions (e.g. `architectural_comments >= 4`) — these are skipped with a guard clause
- Cancel signal timers when a task is completed or paused before the timer fires

**Confidence:** [8/10] — All structural changes are verified and the Rust build passes. The timer registration calls match the Part A API shape. Cannot fully end-to-end test without launching the app and waiting for timer fires, so there's a small risk of payload shape mismatch at runtime.

**Files modified:**
- `index.html`
- `src/js/app.js`
- `src/styles.css`
- `src/styles/notification.css`
- `.github/TASKS/NOTIFICATION-OVERLAY-UI-TASK.md`
