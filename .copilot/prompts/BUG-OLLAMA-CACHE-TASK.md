# BUG: Ollama availability check not cached - Verification

**Context:** When Ollama was not running, the app retried the availability check on every context switch causing repeated timeout warnings. Commit `6ffe445` added `ollama_available: Mutex<Option<bool>>` to `AppState` and made `check_ollama()` return the cached value on subsequent calls. This prompt verifies the fix is complete. Reference: `TASKS/BUG-OLLAMA-CACHE-TASK.md`

**What to Verify:**
1. Confirm `AppState` struct contains `ollama_available: Mutex<Option<bool>>` field
2. Confirm `check_ollama()` (lib.rs:796-822) checks the cached value first (lines 800-805) and returns early if `Some(available)` exists
3. Confirm the HTTP request result is stored back into the cache (line 820: `*state.ollama_available.lock().unwrap() = Some(available)`)
4. Confirm `AppState` initialization sets `ollama_available: Mutex::new(None)` so the first call always does a real check
5. Test: search for any other code paths that check Ollama availability outside of `check_ollama()` to confirm there are no uncached bypass paths

**If Verification Fails:**
- Document what is broken or incomplete in the completion section
- Do NOT attempt to fix - report findings only

**On Completion - update `TASKS/BUG-OLLAMA-CACHE-TASK.md`:**
1. Change `Status` in the metadata table to `Done`
2. Prepend `DONE: ` to the H1 title
3. Append a `## Completion` section containing:
   - **Tested by:** commands run, scenarios verified
   - **Unexpected outcomes:** anything surprising, or "None"
   - **Follow-up tasks:** new task names if any, or "None"
   - **Confidence:** `[X/10]` - one-sentence justification
   - **Files modified:** list of files changed
