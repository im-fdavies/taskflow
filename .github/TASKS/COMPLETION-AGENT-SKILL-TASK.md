# DONE: Completion agent skill (auto-populate finished task context)

| Field | Value |
|---|---|
| Phase | P3: Coaching |
| Priority | Should have |
| Status | Done |
| Est. Effort | Large (1-2 days) |
| Dependencies | Task completion capture, Daily log v2 |

## Description

A `/completion` skill (Claude Code or Copilot) that gathers task context from the dev environment and pre-populates the completion capture form fields. The user triggers it from the completion capture UI via a "Copy /completion command" button which puts the command on their clipboard.

## What the skill generates

The output fields match the Completed Work section of the daily log:

- **Outcome:** summary of what was done (from git log, recent changes, branch diff)
- **Duration:** calculated from git log timestamps or session data
- **PRs:** links to PRs opened/merged (from `gh pr list --state all`)
- **Follow-ups:** remaining TODOs found in code, open issues, failing tests
- **Handoff:** context someone else would need (branch state, pending reviews, env setup)

## Handshake mechanism

1. User enters mode 4 (completion capture) in TaskFlow
2. User clicks "Copy /completion command" button - puts command on clipboard
3. User pastes into terminal, skill runs
4. Skill gathers context from git/gh/codebase, writes to `.github/completion-context.json`
5. TaskFlow reads the JSON and pre-populates the completion form fields
6. User reviews, edits if needed, submits
7. On submit, TaskFlow calls `append_completion_log` which writes to the `## Completed Work` section of today's daily log

## Output format

`.github/completion-context.json`:
```json
{
  "outcome": "Fixed the form submission handler, bookmark now persists across context switches",
  "duration": "2h 15m",
  "prs": "github.com/org/repo/pull/42",
  "follow_ups": "Need to add unit tests for edge cases in submitExit()",
  "handoff": "Branch is merged, staging deployed. No env changes needed."
}
```

## Implementation notes

- Follow the pattern of the existing agent context bridge (`read_agent_context` in lib.rs reads `.github/handover-notes.md`)
- New Tauri command `read_completion_context` to parse the JSON and return structured data
- The skill itself is a `.copilot/prompts/completion.md` file (or Claude Code skill) - separate from TaskFlow's Rust/JS code
- "Refresh" button in the completion UI that re-reads the file after the skill has run
- The clipboard copy button is part of the completion capture UI (see TASK-COMPLETION-CAPTURE tasks)

## Relationship to daily log

The completion form fields map directly to the `## Completed Work` entry format in the daily log. When the user submits the completion form, `append_completion_log` writes the entry into the correct section of today's log file using pulldown-cmark (see DAILY-LOG-V2-TASK.md).

## Completion

**Tested by:**
- `cargo build` in `src-tauri/` — compiled clean, zero errors
- Reviewed `read_completion_context`: follows `read_agent_context` pattern exactly; reads `<active_path>/.github/completion-context.json`, deserialises into `CompletionContext { outcome, prs, follow_ups, handoff }`, returns `None` if file absent or unparseable
- Reviewed `showCompletionState()`: resets `completion-context-loaded` feedback element, calls `_loadCompletionContext()` after show
- Reviewed `_loadCompletionContext()`: maps `ctx.outcome / ctx.prs / ctx.follow_ups / ctx.handoff` onto the four form fields, adds `prefilled` CSS class, shows `#completion-context-loaded` on success; silent-fails if command errors or returns null
- Reviewed `refreshCompletionContext()`: hides the loaded banner then re-calls `_loadCompletionContext()` — handles repeated refresh correctly
- Reviewed HTML: `#completion-refresh-btn` and `#completion-context-loaded` added after the existing copy button, matching `.btn-context` / `.exit-context-loaded` styling used elsewhere
- Reviewed `.github/PROMPTS/completion.md`: skill gathers git log, `gh pr list`, TODO scan, synthesises 4 fields, writes exact JSON schema, prints confirmation line

**Unexpected outcomes:**
- `follow_ups` is snake_case in both the JSON file and the Rust struct; Tauri passes it to JS as `follow_ups` (not camelCase) — JS reads `ctx.follow_ups` which is consistent

**Follow-up tasks:**
- Instructions for deploying the skill to `~/.copilot/skills/completion/SKILL.md` so `copilot /completion` resolves correctly (currently the prompt is only in `.github/PROMPTS/`)

**Confidence:** [9/10] — All wiring is consistent with existing patterns; untested against a live Tauri window but the read path is identical to `read_agent_context` which is known-working.

**Files modified:**
- `src-tauri/src/lib.rs`
- `index.html`
- `src/app.js`
- `.github/PROMPTS/completion.md`
