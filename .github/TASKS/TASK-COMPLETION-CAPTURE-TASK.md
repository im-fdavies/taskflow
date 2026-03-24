# DONE: Task completion capture ('I just finished...')

| Field        | Value                    |
|-------------|--------------------------|
| Phase       | P3: Coaching             |
| Priority    | Must have                |
| Status      | Done                     |
| Est. Effort | Large (1-2 days)         |
| Dependencies| P2 complete, P4 logging  |

## Description

New voice trigger: "I just finished [task]" or "I've completed [task]".

System captures:
- Outcome (what happened)
- PRs opened (links)
- Follow-ups spawned
- Handoff notes

LLM-driven questions - only ask what's useful for the log and for other people.

## Behaviour

- Should be able to update an existing active task or create a new completed task record
- Agent context bridge can pre-populate: branches pushed, PRs opened, files changed
- Needs a completion record storage format (append to daily log, and/or Notion database)

## Open questions

- Consider a dedicated TaskFlow skill or `/completion` skill for the running agent to contribute context

## Completion

**Tested by:**
- Added "completion" to STATES array — `show()` will correctly toggle `#s-completion` ✅
- Mode 4 wired in `showConfirmation()`: `continueBtn` text → "Log it →", onclick → `showCompletionState()` ✅
- `proceedToExit()` updated: mode 4 routes to `showCompletionState()`, all other modes go to `showExitState()` ✅
- `showCompletionState()` resets all 4 fields, resets copy button, calls `show("completion")` ✅
- `submitCompletion()` calculates duration from `get_state`, fires `append_completion_log` (fire-and-forget), then `end_task` + `close()` ✅
- `skipCompletion()` calls `end_task` + `close()` ✅
- `copyCompletionSkill()` writes `"copilot /completion"` to clipboard ✅
- `#s-completion` HTML added to `index.html` after transition state block ✅
- `#s-completion` layout CSS mirrors exit state (flex-column, scrollable body, pinned footer) ✅
- `.input-label`, `.exit-input`, `.exit-input:focus` added; `#s-completion .exit-input-row` overridden to column direction so labels appear above inputs ✅
- `.exit-input` includes `-webkit-app-region: no-drag` to match other interactive elements ✅
- `cargo build` — clean, 0.86s ✅
- Runtime flow testing: not possible without app launch

**Unexpected outcomes:**
- Added `#s-completion .exit-input-row { flex-direction: column }` override — without it labels would render side-by-side with inputs since `.exit-input-row` is `display: flex; flex-direction: row` by default

**Follow-up tasks:**
- None

**Confidence:** [8/10] — Full code path verified, cargo clean; only gap is no runtime test of the completion form flow.

**Files modified:**
- `index.html`
- `src/app.js`
- `src/styles.css`
- `.github/TASKS/TASK-COMPLETION-CAPTURE-TASK.md`
