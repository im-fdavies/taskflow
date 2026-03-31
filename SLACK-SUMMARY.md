# Slack Morning Summary

Automated morning Slack message summarising yesterday's TaskFlow activity.

## Setup

1. Create a Slack Incoming Webhook at https://api.slack.com/apps → Incoming Webhooks
2. Add the webhook URL to `~/.taskflow/config.toml`:

```toml
[slack]
webhook_url = "https://hooks.slack.com/services/T.../B.../..."
```

3. Ensure your daily notes path is configured:

```toml
[logs]
path = "~/Library/CloudStorage/Dropbox/DailyNotes"
```

## Usage

```bash
npm run slack-summary
```

## Scheduling

Add to crontab for weekday mornings:

```bash
crontab -e
# Add: 45 9 * * 1-5 cd /path/to/taskflow && /usr/local/bin/node scripts/slack-morning-summary.mjs
```

Or use a Claude scheduled task to run at 09:45 weekdays.

## Day-of-week logic

- **Saturday/Sunday**: Skips silently
- **Monday**: Reads Friday's log
- **Tuesday–Friday**: Reads yesterday's log
- **Missing log**: Posts a heads-up message to Slack
