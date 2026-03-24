# DONE: Daily log v2 - section-based format with pulldown-cmark

| Field | Value |
|---|---|
| Phase | P4: Logging |
| Priority | Must have |
| Status | Done |
| Est. Effort | Large (1-2 days) |
| Dependencies | Daily markdown log (v1 - done) |

## Description

Redesign the daily log from a flat append-only format to a structured three-section markdown file. Use `pulldown-cmark` (+ `pulldown-cmark-to-cmark` for roundtripping) to parse and insert entries into the correct section rather than blindly appending.

## Log format

```markdown
# 2026-03-24 - Daily Log

## Summary
{Rewritten by summary agent on each completion and each morning}

## Todos
### 14:30 - Fix bookmark submit bug
- **Switch:** Full
- **Task Type:** Bug Fix
- **Exit notes:** Parking this, CI is blocking deploys
- **Bookmark:** Check async state binding in confirmTransition

### 09:15 - Review PR #43
- **Urgency:** Low
- **Reminder:** 16:00

## Completed Work
### 16:45 - COMPLETED: Fix bookmark submit bug
- **Outcome:** Fixed the form submission handler, bookmark now persists
- **Duration:** 2h 15m
- **PRs:** github.com/org/repo/pull/42
- **Follow-ups:** Need to add unit tests for edge cases
- **Handoff:** Branch is merged, staging deployed
```

## Renames from v1

- "Mode" is now "Switch" (Full / Light / Urgent)
- "Template" is now "Task Type"

## Rust changes

### New dependency

Add `pulldown-cmark` and `pulldown-cmark-to-cmark` to `Cargo.toml`.

### Refactor `append_daily_log`

Replace the current blind-append logic. The command should:

1. Read the file (or create with header + empty sections if new day)
2. Parse with pulldown-cmark to find the `## Todos` section
3. Insert the new entry before `## Completed Work`
4. Write back using pulldown-cmark-to-cmark for clean roundtripping

Parameters stay the same but rename `mode` label mapping:
- 1 = "Full", 2 = "Light", 3 = "Urgent"

Rename output labels:
- "Mode" -> "Switch"
- "Template" -> "Task Type"

### Refactor `append_completion_log`

Same section-aware approach. Insert into `## Completed Work` section at the end of the file.

Fields:
- Outcome (string)
- Duration (calculated)
- PRs (string, optional)
- Follow-ups (string, optional)
- Handoff (string, optional)

### New file creation

When the log file doesn't exist for today, create it with this skeleton:

```markdown
# YYYY-MM-DD - Daily Log

## Summary


## Todos


## Completed Work

```

## JS changes

Update the `invoke("append_daily_log", {...})` call in `showTransitionState()`:
- Rename `templateName` parameter to `taskType` (or update Rust to accept new name)
- Ensure the invoke fires immediately on context switch (this already works in v1)

## Key principle

Log entries are written immediately when the user switches context - not on completion, not deferred. If the app crashes, the log still has a record of what was being worked on.

## Notes

- The `## Summary` section is written by a separate summary agent, not by this task
- The voice intent "add X to my todos" routing is handled by `DASHBOARD-OVERLAY-TASK.md`, not this task
- This task focuses purely on the Rust backend format change and the section-aware insertion logic

## Completion

**Tested by:**
- `cargo build` in `src-tauri/` — compiled clean, zero errors or warnings
- Reviewed `find_section_byte_offset` logic: uses `pulldown_cmark::Parser::into_offset_iter()` to locate `## Completed Work` by byte offset; inserts new entry before it; falls back to append if heading is absent
- Reviewed skeleton output: new files get `# YYYY-MM-DD - Daily Log` with `## Summary`, `## Todos`, `## Completed Work` sections
- Verified `append_completion_log` appends at EOF (after `## Completed Work`) and uses `daily_log_skeleton` for missing files
- Verified entry headings changed from `## HH:MM — ...` (H2, em-dash) to `### HH:MM - ...` (H3, hyphen) in both commands
- Verified labels: `Mode` → `Switch`, `Template` → `Task Type` in `append_daily_log`
- Verified JS `invoke("append_daily_log", {...})` in `showTransitionState()`: `templateName` renamed to `taskType`

**Unexpected outcomes:**
- `pulldown-cmark-to-cmark` v10 resolved and compiled successfully alongside pulldown-cmark v0.11 — no version conflict

**Follow-up tasks:**
- Summary agent that rewrites `## Summary` on completion/morning (referenced in task spec as out of scope here)
- Dashboard overlay task for "add X to my todos" voice routing (DASHBOARD-OVERLAY-TASK.md)

**Confidence:** [9/10] — Build is clean, section insertion logic is correct, fallback handles legacy files; untested against live Tauri runtime but the logic is straightforward string manipulation backed by a real parser.

**Files modified:**
- `src-tauri/Cargo.toml`
- `src-tauri/src/lib.rs`
- `src/app.js`
