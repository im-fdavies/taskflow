<!-- Part A complete, awaiting Part B -->
# Task completion capture - Part A: Backend + mode detection

**Context:** New voice trigger for task completion ("I just finished X", "I've completed X"). This adds Mode 4 (COMPLETE) to the existing 3-mode detection system. Mode 4 means the user is logging a finished task and returning to idle - there is no "next task" to switch to. This prompt covers the backend (Rust) and mode detection changes only. Reference: `TASKS/TASK-COMPLETION-CAPTURE-TASK.md`

**What Needs Doing:**

1. **Add Mode 4 to rule-based detection** in `src/app.js` `detectMode()` (line 159). Currently "finished", "done with", "completed" are Mode 2 keywords (lines 177-183). The distinction: Mode 2 mentions a *next task* ("finished X, switching to Y"), Mode 4 does not ("I just finished X"). Add a new check **before** the Mode 2 block (around line 176):
   ```javascript
   // Mode 4: completion — user finished a task, no next task
   const mode4Keywords = [
     "i just finished", "i've completed", "i've finished",
     "just completed", "task is done", "wrapped up",
     "all done with", "finished up",
   ];
   if (mode4Keywords.some((k) => lower.includes(k))) {
     return { mode: 4, confidence: "keyword" };
   }
   ```
   These are longer phrases than Mode 2's single-word triggers, so checking them first avoids false positives. Mode 2's "finished" will still catch "finished X, moving on to Y" since mode 4 phrases won't match that pattern.

2. **Add Mode 4 to LLM detection** in `src-tauri/src/lib.rs` `detect_mode_llm()` (line 892). Update the prompt string (lines 901-909):
   - Add before the URGENT line: `COMPLETE: The user has finished a task and is logging what they did. They are NOT switching to a new task - they are wrapping up and returning to idle.\n\`
   - Update the mode mapping line: `Where mode is: 1=FULL, 2=LIGHT, 3=URGENT, 4=COMPLETE`
   - Update the valid range check at line 956 from `(1..=3)` to `(1..=4)`

3. **Add a new Tauri command `append_completion_log`** in `src-tauri/src/lib.rs`, after `append_daily_log`. It should:
   - Use `#[tauri::command(rename_all = "camelCase")]`
   - Accept: `task_name: String`, `outcome: String`, `pr_links: Option<String>`, `follow_ups: Option<String>`, `handoff_notes: Option<String>`, `duration_minutes: Option<i64>`
   - Append to the same daily log file (`~/.taskflow/logs/YYYY-MM-DD.md`) but with a completion-specific format:
     ```
     ## HH:MM - COMPLETED: <task_name>
     - **Outcome:** <outcome or "—">
     - **Duration:** <Xh Ym or "—">
     - **PRs:** <pr_links or "—">
     - **Follow-ups:** <follow_ups or "—">
     - **Handoff:** <handoff_notes or "—">
     ```
   - Reuse the same log directory creation and file header logic as `append_daily_log`
   - Return `Result<(), String>`

4. **Register `append_completion_log`** in the Tauri handler chain (the `invoke_handler` list).

5. **Add Mode 4 labels** in `src/app.js` `showConfirmation()`:
   - Line 455: add to `modeLabels`: `4: "Completion"`
   - Line 456: add to `modeClasses`: `4: "mode-complete"`
   - Line 422: when mode === 4, change the task element text from `Switching to: ${taskName}` to `Completing: ${taskName}`

6. **Add Mode 4 CSS class** in `src/styles.css`. Find the existing mode badge styles (`.mode-full`, `.mode-light`, `.mode-urgent`) and add:
   ```css
   .mode-complete {
     background: rgba(16, 185, 129, 0.15);
     color: #6ee7b7;
   }
   ```

**Files:**
- `src-tauri/src/lib.rs` - update `detect_mode_llm` prompt + range, add `append_completion_log` command, register it
- `src/app.js` - add mode 4 to `detectMode()`, add mode 4 labels in `showConfirmation()`
- `src/styles.css` - add `.mode-complete` badge style

**How to Test:**
- `cargo build` in `src-tauri/` should compile cleanly
- In `detectMode()`: the input "I just finished the API refactor" should return `{ mode: 4, confidence: "keyword" }`
- In `detectMode()`: the input "finished the PR, moving on to testing" should still return `{ mode: 2, confidence: "keyword" }` (mode 4 phrases won't match)

**Unexpected Outcomes:**
- Mode 4 keyword phrases must be checked before Mode 2's single-word "finished"/"completed" to avoid mode 2 catching completion inputs. If ordering causes issues, the phrases can be made more specific.
- The LLM may occasionally classify completions as Mode 2 (LIGHT) since "finished cleanly" is part of Mode 2's description. The updated prompt should make the distinction clear, but watch for this in testing.

**On Completion - do NOT update the task file yet** (Part B still pending). Instead, note in a comment at the top of this prompt file: `<!-- Part A complete, awaiting Part B -->`
