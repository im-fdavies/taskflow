# DONE: BUG: submitExit() doesn't read edited bookmark value before logging

| Field        | Value                    |
|-------------|--------------------------|
| Phase       | P4: Logging              |
| Priority    | Should have              |
| Status      | Done                     |
| Est. Effort | Small (1-2h)             |
| Dependencies| Daily markdown log       |

## Problem

`submitExit()` calls `showTransitionState()` which logs `_session.extractedBookmark` (the pre-populated value from voice parsing). But if the user edits the bookmark textarea manually, the edit is not captured - only `skipExitWithExtracted()` reads the DOM value back into the session.

## Fix

In `submitExit()` (app.js), read `#exit-bookmark` textarea value into `this._session.extractedBookmark` before calling `showTransitionState()`, matching what `skipExitWithExtracted()` already does.

## Completion

**Tested by:**
- Traced code path: confirmed `submitExit()` line 829 set `exitCapture` but did not read `#exit-bookmark` before calling `showTransitionState()` ✅
- Verified `skipExitWithExtracted()` lines 719–721 as the canonical pattern — 2-line read matching applied identically ✅
- Checked `showTransitionState()` uses `_session.extractedBookmark` in the log call — confirmed ✅
- `cargo build` not required (no Rust changes) ✅

**Unexpected outcomes:**
- None

**Follow-up tasks:**
- None

**Confidence:** [9/10] — Two-line fix with an exact existing pattern to match; only gap is no runtime test of the log output.

**Files modified:**
- `src/app.js`
- `.github/TASKS/BUG-BOOKMARK-NOT-READ-ON-SUBMIT-TASK.md`
