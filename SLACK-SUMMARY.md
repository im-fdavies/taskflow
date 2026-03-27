# Slack Morning Summary — Setup Guide

## Step 1: Create the scheduled task

In Claude Code, run:

```
/scheduled-tasks create --name "TaskFlow Morning Summary" --schedule "45 9 * * 1-5"
```

## Step 2: Paste this as the task prompt

```
You are posting a morning Slack summary for Flynn's TaskFlow daily log.

STEP 1 - Determine which log to read:
- If today is Monday, read Friday's log
- If today is Tuesday-Friday, read yesterday's log
- Log path: /Users/flynn.davies/Library/CloudStorage/Dropbox/DailyNotes/YYYY-MM-DD.md

STEP 2 - Read the log file. If it doesn't exist or is empty:
- Post to Slack: "No activity logged yesterday - heads up 👀"
- Stop here.

STEP 3 - Parse the log and generate a second-person narrative summary:
- Start with: "Yesterday you [main activities]"
- List completed tasks with context from exit notes
- Mention any outstanding todos or open tasks
- Keep it conversational, 3-6 sentences max
- Use second person ("you did", "you worked on")

STEP 4 - Read webhook URL from ~/.taskflow/config.toml ([slack] webhook_url section), then post:

curl -X POST -H 'Content-Type: application/json' \
  -d '{"text": "YOUR_SUMMARY_HERE"}' \
  WEBHOOK_URL

If the webhook URL is not configured, print an error and stop.
```

## Step 3: Test manually

Run the task once manually to verify:
1. It reads the correct log file
2. The summary reads well in second person
3. The Slack message arrives in your DMs

## Step 4: Mark task done

Update `.github/TASKS/SLACK-MORNING-SUMMARY-TASK.md`:
- Change Status to `Done`, prepend `DONE: ` to H1
- Add Completion section

## Already configured ✓

- Webhook URL: `~/.taskflow/config.toml` → `[slack] webhook_url`
- Logs path: `/Users/flynn.davies/Library/CloudStorage/Dropbox/DailyNotes/`
- Cron: `45 9 * * 1-5` = 09:45 Monday–Friday
