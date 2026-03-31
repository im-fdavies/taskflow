# DONE: Notification system A — Rust timer infrastructure + markdown persistence

| Field | Value |
|---|---|
| Phase | P3: Coaching |
| Priority | Must have |
| Status | Done |
| Est. Effort | Medium (2-4h) |
| Dependencies | Active task timer (done), Todo priority and reminders (done) |

## Description

Build the Rust-side timer engine that powers all in-app notifications. No UI in this task — that's Part B.

### What this task delivers

1. **Timer state in `AppState`** — add a `timers: Mutex<HashMap<String, TimerEntry>>` to `AppState` where `TimerEntry` holds the timer ID, fire time, title, body, type (todo/signal), and a `tokio::task::JoinHandle` for cancellation.

2. **`# Timers` section in daily logs** — update `daily_log_skeleton()` and `ensure_log_sections()` in `markdown.rs` to include a `# Timers` section (between `# Todos` and `# Completed Work`). Timer entries format:
   ```markdown
   ### 14:00 - Reminder: Review the auth bundle [todo]
   - **Status:** pending
   - **Created:** 11:23
   ```

3. **Tauri commands:**
   - `register_timer(fireTime: String, title: String, body: String, timerType: String)` — writes entry to log, spawns a `tokio::spawn` task that sleeps until fire time then emits `"notification-fired"` event via `AppHandle.emit()` and updates the log entry status to `fired`.
   - `cancel_timer(timerId: String)` — aborts the `JoinHandle`, updates log entry status to `cancelled`.
   - `read_pending_timers()` — reads today's `# Timers` section, returns entries with `Status: pending`.

4. **Startup restore** — in `lib.rs` `.setup()`, after the active task restore, call a new function that reads pending timers from all log files, filters to those with fire time in the future, and re-registers them as `tokio` tasks.

5. **Event payload** — the `"notification-fired"` event carries a JSON payload: `{ id, type, title, body, taskName }`. Part B will listen for this.

## Technical notes

- `tokio` is already available (used by `reqwest`)
- Timer IDs should be deterministic from content: e.g. `format!("{}-{}", fire_time, title)` slugified
- `AppHandle` needs to be cloneable into the spawned task — Tauri's `AppHandle` is `Clone + Send`
- Fire time is `HH:MM` format (today only). Cross-day timers are out of scope — they simply won't re-register if the time has passed.
- The `tokio::time::sleep` duration is calculated as `fire_time - now` in seconds

## Completion

**Tested by:**
- `cargo build --manifest-path src-tauri/Cargo.toml` — compiled cleanly with zero errors, zero warnings
- Verified `# Timers` section appears in `daily_log_skeleton()` between `# Todos` and `# Completed Work`
- Verified `ensure_log_sections()` inserts `# Timers` if missing, positioned before `# Completed Work`
- Verified all three commands (`register_timer`, `cancel_timer`, `read_pending_timers`) are registered in `generate_handler![]`
- Verified startup restore block parses `### HH:MM - Title [type]` entries with `Status: pending` and calls `spawn_timer` for future times

**Unexpected outcomes:**
- `chrono::Timelike` trait import was needed for `.hour()`, `.minute()`, `.second()` — not automatically available from `chrono::Local`
- `extract_section` import was initially included in timers.rs but not directly used (log status updates use line-by-line parsing instead) — removed to avoid warning

**Follow-up tasks:**
- Notification system B — frontend UI to consume `notification-fired` events and display notification overlay

**Confidence:** [8/10] — All code compiles cleanly and follows the existing codebase patterns exactly. The timer spawn/fire/cancel logic is straightforward tokio usage. The one area I can't fully verify without a running app is the end-to-end flow of `register_timer` → sleep → `open_overlay` → `emit("notification-fired")`, which requires manual testing at runtime.

**Files modified:**
- `src-tauri/src/state.rs`
- `src-tauri/src/helpers/markdown.rs`
- `src-tauri/src/commands/timers.rs`
- `src-tauri/src/commands/mod.rs`
- `src-tauri/src/lib.rs`
- `.github/TASKS/NOTIFICATION-TIMER-INFRA-TASK.md`
