# DONE: Jira sprint tickets in dashboard left panel

| Field | Value |
|---|---|
| Phase | P6: Integrations |
| Priority | Could have |
| Status | Done |
| Est. Effort | Medium (2-4h) |
| Dependencies | Dashboard left panel (open) |

## Description

Add a "Sprint Tickets" section to the dashboard left panel showing Jira tickets assigned to the current user in the active sprint. Each ticket shows: issue key, summary, status, and story points/size. Tapping a ticket opens it in Chrome.

## Requirements

1. **Data source** - Jira API via Rovo MCP or direct `reqwest` calls
2. **Filter** - assignee = current user, sprint = active sprint
3. **Display** - issue key (e.g. PROJ-123), summary, status badge, points
4. **Interaction** - tap/click opens the ticket URL in the default browser
5. **Caching** - cache the sprint data to avoid slow API calls on every dashboard open. Refresh on explicit "Refresh" button click or after X minutes.
6. **Empty state** - "No sprint tickets" or "Jira not configured" when unavailable

## Notes

- Needs Jira API credentials or MCP server configuration
- Consider a `~/.taskflow/config.toml` setting for Jira base URL, project key, and auth
- The left panel shell and section label styling will already exist from the left panel task

## Completion

**Tested by:**
- `cargo build --manifest-path src-tauri/Cargo.toml` — clean build, 1.47s, no errors
- Code review of `refreshJiraTickets()` — `ticket.issueType` rendered via `.jira-ticket-type` span in `.jira-ticket-meta` wrapper; `ticket.parentKey` shown alongside when present
- Code review of click handler — `await shell.open(ticket.url)` fires first, then `window.app.close()` is called (fire-and-forget, acceptable per spec)
- CSS review — `.jira-ticket-meta` flex row with 4px top margin; `.jira-ticket-type` at 10px/0.4 opacity/500 weight; `margin-top` removed from `.jira-ticket-parent` to avoid double-spacing

**Unexpected outcomes:**
- None

**Follow-up tasks:**
- None

**Confidence:** 9/10 — All three changes are straightforward DOM/CSS; the only untested path is the live Tauri shell.open + window.app.close flow, but both APIs are already in use elsewhere in the codebase.

**Files modified:**
- `src/js/left-panel.js`
- `src/styles/dashboard.css`
