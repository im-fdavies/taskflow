# DONE: Press-hold-release recording trigger

| Field        | Value                    |
|-------------|--------------------------|
| Phase       | P5: Polish               |
| Priority    | Should have              |
| Status      | Done                     |
| Est. Effort | Medium (3-5h)            |
| Dependencies| P1 complete              |

## Description

Replace click-Done recording flow with press-hold-release on the hotkey. Cmd+Shift+Space hold = record, release = stop and transcribe.

## Implementation

Needs Tauri global shortcut key-up event handling.

## Completion

**Tested by:**
- `cargo build --manifest-path src-tauri/Cargo.toml` — Finished in 13.36s, no errors
- Code review: `shortcut_pressed_at` acquired and released (`.take()`) before emitting to frontend — no deadlock risk
- Code review: `open_overlay` returns early if window already visible — pressing shortcut mid-flow is a no-op
- Code review: `shortcut-released` listener guards on `this._holdMode` — tap releases are silently ignored
- Code review: `close()` and `startAgain()` both clear `_holdMode` and `_holdTimer`

**Unexpected outcomes:**
- `tauri::Emitter` trait needed explicit import in `lib.rs` — the shortcut handler closure doesn't inherit the `window.rs` import. Added `use tauri::Emitter;` at the top of `lib.rs`.

**Follow-up tasks:**
- None

**Confidence:** [8/10] — Code paths are correct; hold vs tap timing and the 300ms JS hint-update timer can only be fully verified by running the app with a physical keyboard.

**Files modified:**
- `src-tauri/src/state.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/commands/window.rs`
- `src/js/app.js`
- `.github/TASKS/PRESS-HOLD-RELEASE-TASK.md`

