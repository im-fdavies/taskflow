# BUG: EXIT first textarea not pre-populating from initial transcription

**Context:** The EXIT state's first textarea ("what were you doing") should pre-populate with exit context extracted from the user's initial voice transcription. The bookmark textarea (second field) works. A previous fix (commit `23222a8`) deferred `textarea.value` assignment past `show()` to work around a WKWebView layout reset. This may have resolved the bug - verify first, fix only if still broken. Reference: `TASKS/BUG-EXIT-TEXTAREA-PREPOPULATE-TASK.md`

**What Needs Doing:**
1. **Trace the data flow end-to-end** in `src/app.js` and confirm each link in the chain:
   - `_parseTranscription()` (line 218) extracts `exitContext` via semantic markers (lines 229-237, assigned at line 324)
   - `showConfirmation()` (line 406) destructures `exitContext` and stores it as `_session.extractedExit` (line 470)
   - `showExitState()` (line 506) retrieves `extractedExit` from `_session` (line 507)
   - `notes` element is grabbed as `document.getElementById("exit-notes")` (line 513)
   - Value is set AFTER `show('exit')` at line 611: `if (extractedExit && notes) notes.value = extractedExit;`
2. **Add a diagnostic console.log** at line 611 (temporarily) to confirm `extractedExit` has a value at runtime: `console.log("[TaskFlow] EXIT textarea set:", { extractedExit, notesExists: !!notes });` - then test with a real voice input that includes exit context (e.g. "I was working on the login page, it's half done")
3. **If the textarea IS populating correctly**: the bug is already fixed. Remove the diagnostic log and proceed to step 7 (mark done).
4. **If `extractedExit` is null/empty at line 611**: the problem is upstream in `_parseTranscription()`. Check whether the transcription text matches any exit marker patterns (lines 229-237). The markers are case-sensitive substring matches - verify the transcription hasn't been lowercased or trimmed in a way that breaks matching.
5. **If `extractedExit` has a value but the textarea is empty after assignment**: the WKWebView reset is still winning. Wrap the assignment in a `setTimeout(() => { notes.value = extractedExit; }, 50);` after line 608 to give the layout an extra tick. This is the same pattern used for `notes.focus()` at line 613.
6. **If `_session.extractedExit` is null but `_parseTranscription()` returned a value**: the storage step in `showConfirmation()` is broken. Check that line 470 reads `extractedExit: exitContext` (not `extractedExit: null` or a typo).
7. Remove any diagnostic logs added in step 2.

**Files:**
- `src/app.js` - trace and potentially fix the exit context prepopulation chain (lines 218-611)
- `index.html` - reference only: exit textarea is `#exit-notes` (line 57)

**How to Test:**
- Launch the app, start a task, then trigger a context switch with voice input containing exit context (e.g. "I was working on the API endpoint, it's about 80% done")
- The EXIT state's first textarea (`#exit-notes`) should display the extracted exit context
- The console should show `[TaskFlow] EXIT pre-pop: { extractedExit: "...", extractedBookmark: ... }` (line 508) confirming extraction worked
- Verify the bookmark textarea still works independently (Mode 1 only)

**Unexpected Outcomes:**
- The WKWebView timing issue may need a longer delay than `setTimeout(…, 50)` - if 50ms doesn't work, try 100ms or use `requestAnimationFrame`
- Marker detection in `_parseTranscription()` depends on specific phrases - unusual phrasing may not trigger extraction, but that's a separate enhancement, not this bug

**On Completion - update `TASKS/BUG-EXIT-TEXTAREA-PREPOPULATE-TASK.md`:**
1. Change `Status` in the metadata table to `Done`
2. Prepend `DONE: ` to the H1 title
3. Append a `## Completion` section containing:
   - **Tested by:** commands run, scenarios verified
   - **Unexpected outcomes:** anything surprising, or "None"
   - **Follow-up tasks:** new task names if any, or "None"
   - **Confidence:** `[X/10]` - one-sentence justification
   - **Files modified:** list of files changed
