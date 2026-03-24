# Task completion capture ('I just finished...')

| Field        | Value                    |
|-------------|--------------------------|
| Phase       | P3: Coaching             |
| Priority    | Must have                |
| Status      | Not started              |
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
