# Slack webhook morning summary

| Field        | Value                          |
|-------------|--------------------------------|
| Phase       | P4: Logging                    |
| Priority    | Should have                    |
| Status      | Not started                    |
| Est. Effort | Medium (3-5h)                  |
| Dependencies| Daily markdown log + Claude API |

## Description

Cron job or launchd at 09:45. Read yesterday's log, send to Haiku for narrative summary, post via Slack incoming webhook to a DM channel.
