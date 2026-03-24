# DONE: BUG: Tauri command parameter naming (camelCase vs snake_case)

| Field        | Value                    |
|-------------|--------------------------|
| Phase       | P2: Intelligence         |
| Priority    | Must have                |
| Status      | Done                     |
| Est. Effort | Small (1-2h)             |
| Dependencies| None                     |

## Problem

JS sends camelCase parameter names in `invoke()` calls, but Rust expects snake_case. Confirmed broken on `add_correction`.

## Fix

Add `rename_all = "camelCase"` to all `#[tauri::command]` functions in `lib.rs`. Also audit every `invoke()` call in `app.js` for mismatches.

## Impact

This blocks corrections saving (`~/.taskflow/corrections.yaml` stays empty after "Always fix" clicks) and may affect other commands silently.

**Blocks:** vocabulary/corrections system, clarification questions.

## Completion

**Tested by:**
- Grep for `#[tauri::command` in `lib.rs` — all 17 commands have `rename_all = "camelCase"` (lines 233, 238, 245, 254, 263, 270, 332, 337, 353, 361, 403, 440, 482, 579, 683, 796, 830)
- Manual audit of every `invoke()` call in `app.js` and `voice-capture.js` against Rust snake_case equivalents — all camelCase JS params correctly map to their Rust snake_case counterparts after `rename_all`: `wavData`→`wav_data`, `currentTask`→`current_task`, `exitContext`→`exit_context`, `taskName`→`task_name`, `templateName`→`template_name`, `templateContext`→`template_context`, `exitCapture`→`exit_capture`, `maxQuestions`→`max_questions`, `matchPhrase`→`match_phrase`
- `cargo build` in `src-tauri/` — `Finished dev profile [unoptimized + debuginfo] target(s) in 1.01s` (exit 0, no warnings)

**Unexpected outcomes:**
- None

**Follow-up tasks:**
- None

**Confidence:** [10/10] — All 17 commands verified with `rename_all = "camelCase"`, every invoke() param audited against Rust signatures, and `cargo build` passes cleanly.

**Files modified:**
- None (verification only task)
