# DONE: Lessons learned — capture approach insights at exit, surface them on similar task start

| Field | Value |
|---|---|
| Phase | P3: Coaching |
| Priority | Must have |
| Status | Done |
| Est. Effort | Medium (2-4h) |
| Dependencies | Notification overlay system (done), Daily markdown log (done), Templates (done) |

## Description

When a user finishes or pauses a task, the exit interview should ask: **"How would you approach a similar task next time?"** The answer is saved to the daily markdown log under the task entry as a `- **Lesson:**` field.

When the user later starts a task that is **similar** (same template match, or overlapping task-name keywords), the app searches past log files for lessons from matching tasks and surfaces the most recent one as a coaching notification via the existing in-app overlay.

## Example flow

1. User is reviewing PRs. At exit, they're asked the approach question.
2. They write: "When working on multiple related PRs, start at the service and work outward — understanding usage before reviewing the plugin code."
3. That gets saved as `- **Lesson:** When working on multiple related PRs...` in today's log entry.
4. Two days later, user starts a new "reviewing PRs" task.
5. The app finds the past lesson (matching template or task name overlap) and shows a coaching notification: **"Last time you noted:"** followed by the lesson text.

## Requirements

### 1. Exit interview addition
- Add a textarea to the exit state (`#s-exit`) asking "How would you approach this differently next time?" (or similar wording)
- Also add it to the completion state (`#s-completion`) for Mode 4 completions
- The field is **optional** — user can leave it blank
- Pass the value through to the Rust log commands

### 2. Persistence to daily log
- Extend the context switch log entry format to include `- **Lesson:** <text>` when provided
- Extend the completion log entry format similarly
- Empty lessons should not produce a blank `- **Lesson:**` line

### 3. Retrieval on task start
- New Rust command: `search_past_lessons` — scans recent log files (last 30 days) for entries matching the current task
- Matching logic: if a template is matched, search for entries with the same `**Template:**` value. If no template, do word-overlap on the task name (strip common words like "the", "a", "on", etc.)
- Returns the most recent lesson found (just one — not a list)
- 500ms timeout to avoid blocking task start

### 4. Coaching notification
- On `startTask()`, after template matching, call `search_past_lessons` in parallel (like `_checkAgentContext()`)
- If a lesson is found, show it as a coaching notification using the existing notification overlay
- Title: "From last time" / Body: the lesson text / Task: the original task name the lesson came from
- Auto-dismiss after 15s (longer than standard 10s since it's reading material)

## Log format extension

Existing entry:
```markdown
## 14:30 - Reviewing PRs
- **Mode:** Full
- **Template:** pr-review
- **Duration:** 45m
- **Exit notes:** Finished reviewing the auth bundle PRs
```

With lesson:
```markdown
## 14:30 - Reviewing PRs
- **Mode:** Full
- **Template:** pr-review
- **Duration:** 45m
- **Exit notes:** Finished reviewing the auth bundle PRs
- **Lesson:** When working on multiple related PRs, start at the service and work outward.
```

## Technical notes

- The notification overlay (`#s-notification`) and event system (`notification-fired`) are already in place from the timer work
- For the Rust search command, use `std::fs::read_dir` on the logs directory, filter to `YYYY-MM-DD.md` files within the last 30 days, parse each for `**Lesson:**` lines and their parent `## HH:MM - TaskName` headings
- Template match is strongest signal; task name word overlap is fallback
- Keep the search lightweight — read files line by line, stop after finding the most recent match

## Completion

**Tested by:**
- `cargo build --manifest-path src-tauri/Cargo.toml` — compiled clean, zero warnings
- `grep -rn search_past_lessons src-tauri/src/ src/js/` — found in lessons.rs (command), lib.rs (handler registration), app.js (invoke call)
- `grep -n "lesson:" src-tauri/src/commands/daily_log.rs` — `lesson: Option<String>` present in both `append_daily_log` (line 12) and `append_completion_log` (line 84)
- `grep -n "exit-lesson\|completion-lesson" index.html` — both textareas present in `#s-exit` (line 88-90) and `#s-completion` (line 143)
- Verified `generate_handler![]` includes `search_past_lessons`

**Unexpected outcomes:**
- None

**Follow-up tasks:**
- None

**Confidence:** [8/10] — All six steps implemented exactly as specified, Rust compiles clean, full JS→Rust wiring verified via grep. The one area of uncertainty is runtime behaviour of the 3-second-delayed notification re-opening the overlay via `expand_for_dashboard` after `close()` — this follows the prompt's design but hasn't been tested in a live Tauri window.

**Files modified:**
- `index.html`
- `src/js/exit-flow.js`
- `src/js/completion-flow.js`
- `src/js/app.js`
- `src/js/entry-flow.js`
- `src-tauri/src/commands/daily_log.rs`
- `src-tauri/src/commands/lessons.rs` (NEW)
- `src-tauri/src/commands/mod.rs`
- `src-tauri/src/lib.rs`
- `.github/TASKS/LESSONS-LEARNED-TASK.md`
