# Completion agent skill (auto-populate finished task context)

| Field        | Value                              |
|-------------|-------------------------------------|
| Phase       | P3: Coaching                        |
| Priority    | Should have                         |
| Status      | Not started                         |
| Est. Effort | Large (1-2 days)                    |
| Dependencies| Agent context bridge, Task completion capture |

## Description

A skill (either extending `/handover` or a new `/completion` skill) that the running Copilot/Claude agent can invoke to export task context to TaskFlow.

## Output

- What was done
- PRs opened/merged
- Files changed
- Remaining items
- Things to remember

## Design decisions needed

Could write to a known file path (`.agent/completion-context.json`) that TaskFlow reads, or communicate via MCP.

Design session needed to decide the handshake mechanism.
