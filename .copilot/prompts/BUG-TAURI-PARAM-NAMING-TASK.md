# BUG: Tauri command parameter naming (camelCase vs snake_case) - Verification

**Context:** This bug reported that JS `invoke()` calls used camelCase parameter names while Rust expected snake_case, confirmed broken on `add_correction`. Commit `3fc5d00` added `rename_all = "camelCase"` to all 17 `#[tauri::command]` functions. This prompt verifies the fix is complete. Reference: `TASKS/BUG-TAURI-PARAM-NAMING-TASK.md`

**What to Verify:**
1. Confirm every `#[tauri::command]` in `src-tauri/src/lib.rs` has `rename_all = "camelCase"` - there should be 17 commands total (get_state, set_mode, start_task, end_task, hide_overlay, transcribe_audio, load_templates, get_template, generate_clarification_questions, generate_exit_question, read_agent_context, check_ollama, detect_mode_llm, get_vocabulary, add_vocabulary_term, get_corrections, add_correction)
2. Confirm every `invoke()` call in `src/app.js` and `src/voice-capture.js` passes camelCase parameter names that match the Rust snake_case equivalents after rename - specifically check: `matchPhrase` -> `match_phrase`, `wavData` -> `wav_data`, `currentTask` -> `current_task`, `exitContext` -> `exit_context`, `taskName` -> `task_name`, `templateName` -> `template_name`, `templateContext` -> `template_context`
3. Test: run `cargo build` in `src-tauri/` to confirm it compiles cleanly with the rename_all attributes

**If Verification Fails:**
- Document which commands are missing `rename_all = "camelCase"` or which invoke() calls have mismatched parameter names
- Do NOT attempt to fix - report findings only

**On Completion - update `TASKS/BUG-TAURI-PARAM-NAMING-TASK.md`:**
1. Change `Status` in the metadata table to `Done`
2. Prepend `DONE: ` to the H1 title
3. Append a `## Completion` section containing:
   - **Tested by:** commands run, scenarios verified
   - **Unexpected outcomes:** anything surprising, or "None"
   - **Follow-up tasks:** new task names if any, or "None"
   - **Confidence:** `[X/10]` - one-sentence justification
   - **Files modified:** list of files changed
