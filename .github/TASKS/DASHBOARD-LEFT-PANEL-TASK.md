# DONE: Dashboard left panel - context tasks, Jira tickets, resume flow

| Field | Value |
|---|---|
| Phase | P6: Integrations |
| Priority | Should have |
| Status | Done |
| Est. Effort | Large (1-2 days) |
| Dependencies | Dashboard overlay (done), Jira MCP (separate task for Jira section) |

## Design Decisions (workshopped 2026-03-25)

1. **Both data sources on left panel** - paused/in-progress tasks from daily log AND Jira sprint tickets
2. **Differentiation from right panel** - right panel = today's quick todos. Left panel = longer-running work items (context-switched tasks, Jira tickets)
3. **Left panel mic** - context-switcher mic (same as Cmd+Shift+Space flow), mirrors the todo mic on the right panel
4. **Same width** as right panel (360px)
5. **Jira ticket interaction** - tap opens ticket in Chrome (not pre-populate switcher). Show: ticket number, name, status, points/size
6. **Context task interaction** - "Resume" button to switch back to a paused task. Status badges: paused (amber), in progress (green), blocked (red)
7. **Done section at bottom** - completed tasks, same pattern as right panel's Done section
8. **Both panels should look identical** - same glass material, same typography, same section label style, just different use cases

## Layout

```
|                        |                         |
|  LEFT PANEL (360px)    |   CENTRE (open space)   |  RIGHT PANEL (360px)    |
|                        |                         |                         |
|  [Context-switch mic]  |                         |  [Todo mic]             |
|                        |                         |                         |
|  SPRINT TICKETS        |                         |  TODAY'S SUMMARY        |
|  PROJ-123 Fix auth  ↗  |                         |  ...                    |
|  PROJ-456 Add cache ↗  |                         |                         |
|                        |                         |  OUTSTANDING            |
|  PAUSED TASKS          |                         |  11:32 - peppers  ✓ ✕   |
|  API refactor [Paused] |                         |  14:00 - fix CI  ✓ ✕    |
|    → Resume            |                         |                         |
|                        |                         |  DONE                   |
|  DONE                  |                         |  fix auth (strikethrough)|
|  PR amends (struck)    |                         |                         |
|                        |                         |                         |
|  [Close]               |                         |  [Close] [Refresh]      |
```

## Data sources

### Context tasks (daily log)
- **Paused tasks** - already have `read_paused_tasks` Rust command (returns name, bookmark, exit_notes, time)
- **Completed tasks** - already have `read_completed_todos` Rust command
- Resume action: calls existing `start_task` Rust command to set as active task, then closes dashboard

### Jira sprint tickets
- Needs MCP integration (Rovo MCP or direct Jira API)
- Split into separate task: `JIRA-SPRINT-TICKETS-TASK.md`
- Left panel should render a placeholder/empty section until Jira integration lands

## Implementation split

1. **DASHBOARD-LEFT-PANEL-TASK.md** (this task) - left panel shell, paused tasks section, resume flow, done section, context-switch mic. No Jira dependency.
2. **JIRA-SPRINT-TICKETS-TASK.md** (new task) - Jira API/MCP integration, ticket rendering, open-in-Chrome action. Depends on this task for the panel shell.

## Completion

**Tested by:**
- `cargo build --manifest-path src-tauri/Cargo.toml` — compiled with 0 errors
- `npx vite build` — 14 modules transformed, 0 errors, built in 243ms
- `npx vitest run` — 68/68 tests passed (5 files)
- Code review: left panel HTML structure with context-switch mic, Jira placeholder, paused tasks list, and Done section verified in index.html
- Code review: left-panel.js imports, render functions, resume flow, voice tap toggle pattern verified
- Code review: app.js imports, VoiceCapture instance, method delegation, showDashboard left panel activation, close() left panel slide-out all verified

**Unexpected outcomes:**
- The left panel is not added to the `STATES` array — it's managed manually alongside the dashboard state since both panels need to be active simultaneously. This is the correct approach given the show() method toggles one state at a time.

**Follow-up tasks:**
- Jira sprint tickets integration — see TASKS/JIRA-SPRINT-TICKETS-TASK.md

**Confidence:** [8/10] — All builds pass and the code follows the exact same patterns as the right panel (dashboard.js). The left panel voice → confirmation flow closes the dashboard first then calls showConfirmation, which has a brief visual transition. Can't verify the simultaneous panel animation or resume flow without a live Tauri runtime.

**Files modified:**
- `index.html`
- `src/styles/dashboard.css`
- `src/js/left-panel.js` (new)
- `src/js/app.js`
- `.github/TASKS/DASHBOARD-LEFT-PANEL-TASK.md`
