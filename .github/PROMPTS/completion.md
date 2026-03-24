# /completion skill

Gather context about the task just completed and write it to `.github/completion-context.json` so TaskFlow can pre-populate the completion capture form.

## What to do

Run these steps in order. Work silently — no need for commentary between steps.

### 1. Establish context

- Get current branch: `git branch --show-current`
- Get recent commits on this branch (since branching from main): `git log main..HEAD --oneline --no-merges` (fall back to last 20 commits if main diff is empty)
- Get a summary diff of what changed: `git diff main...HEAD --stat` (or `git diff HEAD~10..HEAD --stat` as fallback)

### 2. Find associated PRs

Run: `gh pr list --state all --head $(git branch --show-current) --json number,title,url,state --limit 5`

If no results, try: `gh pr list --state all --limit 5 --json number,title,url,state`

### 3. Find open follow-ups

Scan recent changes for leftover work signals:
- `git diff main...HEAD -- '*.ts' '*.js' '*.php' '*.rs' | grep -E "^\+" | grep -iE "TODO|FIXME|HACK|XXX" | head -20`
- Also check if any tests are failing or skipped by looking at recent test output if available.

### 4. Synthesise the fields

Based on the information gathered, write values for each field. Be concise — one to two sentences each, no markdown formatting inside the values.

- **outcome**: What was accomplished? What is the current state of the work? (e.g. "Fixed the form submission handler, bookmark now persists across context switches")
- **prs**: Comma-separated PR URLs, or empty string if none. Use the full URL from `gh pr` output.
- **follow_ups**: Any TODOs found in the diff, open issues, or logical next steps implied by the work. Empty string if none.
- **handoff**: What would someone (or future-you) need to know to continue? Branch state, env changes, deployment status. Empty string if obvious from the outcome.

### 5. Write the output file

Write the result to `.github/completion-context.json` in the current working directory. Use this exact schema:

```json
{
  "outcome": "...",
  "prs": "...",
  "follow_ups": "...",
  "handoff": "..."
}
```

Do not include any other fields. Do not nest objects. Keep all values as flat strings.

If a field has no meaningful value, use an empty string (`""`), not `null`.

### 6. Confirm

Print one line: `✓ Written to .github/completion-context.json — switch back to TaskFlow and click "Load /completion output"`

## Notes

- Run this from the project root directory (where `.github/` lives)
- This file is read by TaskFlow's `read_completion_context` Tauri command, which expects it at `<active_path>/.github/completion-context.json`
- The `active_path` is set in `~/.taskflow/config.toml` under `[project] active_path`
- If you're working in a different project, update `active_path` in the config first
