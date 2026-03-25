# DONE: Bug: "add X to my todos" in main voice flow routes to context switch instead of todo add

| Field | Value |
|---|---|
| Phase | P4: Logging |
| Priority | Must have |
| Status | Done |
| Est. Effort | Small (1-2h) |
| Dependencies | Dashboard overlay (done) |

## Description

When the user says "add fix the health check app to my to-do list" in the main voice capture, the app treats the entire phrase as a task name and enters the Full Switch context-switch flow. It should detect the todo intent, add the item to today's daily log Todos section, show brief confirmation, and return to idle.

The `_parseTodoIntent()` method already exists and works correctly in the dashboard voice tap flow. It just isn't checked in the main voice flow.

## Root cause

In `src/app.js`, after the transcription completes (around line 434), the code runs `_parseTranscription()` and `detectMode()` but never checks `_parseTodoIntent()`. The todo intent falls through to the normal context switch path.

## Expected behaviour

1. User says "add fix the health check app to my to-do list"
2. App detects todo intent via `_parseTodoIntent()`
3. App calls `invoke("append_todo_entry", { taskName })` to write to daily log
4. App shows brief confirmation (e.g. toast or confirmed sub-state with "Added to todos" message)
5. App returns to idle/listening state - does NOT enter context switch flow

## Completion

**Tested by:**
- `npx vitest run` — 68/68 tests passed (5 files), including 12 parseTodoIntent tests
- `npx vite build` — 13 modules, 0 errors, built in 299ms
- Code review of `src/js/app.js` lines 356-373 — confirmed early check, invoke call, dashboard routing, edit panel, return guard

**Unexpected outcomes:**
- None

**Follow-up tasks:**
- None

**Confidence:** [9/10] — All 6 verification points confirmed by reading the actual code paths and running the full test suite. Only not a 10 because I can't do a live end-to-end voice test.

**Files modified:**
- `.github/TASKS/BUG-TODO-INTENT-MAIN-VOICE-FLOW-TASK.md`
