# DONE: Bug: Pause flow — transition shows exit notes instead of task name + falls through to Entry state

| Field | Value |
|---|---|
| Phase | P5: Polish |
| Priority | Must have |
| Status | Done |
| Est. Effort | Small (1-2h) |
| Dependencies | None |

## Description

Two related bugs in the dashboard Pause flow:

### Bug 1 — Transition screen shows exit capture text instead of task name

The "PUTTING ON HOLD:" section on the transition screen displays the content of the exit notes textarea (`exitCapture`) instead of the task name being paused. The user expects to see the task name here.

**Location:** `src/js/entry-flow.js` line 70 — `bookmarkContent.textContent = exitCapture || "—"` should display the previous task name instead.

### Bug 2 — Pause flow continues to Entry state with blank task

After confirming the transition screen, the flow advances to the Entry state showing "Starting:" with no task name and "No template matched — working without structure." This happens because `dashboardPause()` in `app.js` (line 780) sets `taskName: ""` in the session. The pause flow should **end** after the transition confirmation — it should close the overlay, not advance to the entry state.

**Root cause:** The transition screen's "Confirmed" button calls `app.confirmTransition()` → `this.showEntryState()` unconditionally. When pausing from the dashboard, the flow should instead call `end_task` and close/hide the overlay.

## Completion

**Tested by:**
- `cargo build --manifest-path src-tauri/Cargo.toml` — compiled successfully (exit 0)
- Verified `end_task` command exists in `src-tauri/src/commands/task.rs` and is registered in `lib.rs`
- Verified `hide_overlay` command exists in `src-tauri/src/commands/window.rs` and is registered in `lib.rs`
- Verified `pauseOnly` is only set in `dashboardPause()` — normal voice/hotkey flow is unaffected
- Verified that setting `confirmBtn.onclick` in JS overrides the HTML `onclick` attribute, so the normal flow (where `pauseOnly` is falsy) retains the original HTML handler

**Unexpected outcomes:**
- None

**Follow-up tasks:**
- None

**Confidence:** [8/10] — The code changes are straightforward and targeted. The Rust backend compiles. The JS `onclick` override mechanism is well-understood. Manual testing (dashboard pause → transition screen shows task name, confirm closes overlay) is needed to fully validate, but cannot be done in this headless environment.

**Files modified:**
- `src/js/entry-flow.js`
- `src/js/app.js`
- `.github/TASKS/BUG-PAUSE-FLOW-TRANSITION-TASK.md`
