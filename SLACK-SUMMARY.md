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

### Option A: GitHub Actions (recommended — runs even when your Mac is off)

The workflow lives at `.github/workflows/slack-summary.yml` and runs Mon-Fri at 09:45 UTC.

**Setup steps:**

1. **Add repo secrets** at https://github.com/im-fdavies/taskflow/settings/secrets/actions:
   - `ANTHROPIC_API_KEY` — your `sk-ant-...` key
   - `SLACK_WEBHOOK_URL` — your `hooks.slack.com` URL
   - `DROPBOX_ACCESS_TOKEN` — see step 2

2. **Get a Dropbox API token:**
   - Go to https://www.dropbox.com/developers/apps
   - Click "Create app" → choose **Scoped access** → **Full Dropbox**
   - Under the **Permissions** tab, enable `files.content.read` → click Submit
   - Under the **Settings** tab, scroll to "Generated access token" → click **Generate**
   - Copy the token and add it as `DROPBOX_ACCESS_TOKEN` in repo secrets

3. **Set the Dropbox folder path** (optional — defaults to `/DailyNotes`):
   - Go to https://github.com/im-fdavies/taskflow/settings/variables/actions
   - Add variable `DROPBOX_LOGS_PATH` with the Dropbox path to your daily notes folder

4. **Test it:**
   - Go to Actions tab → "Slack Morning Summary" → click "Run workflow"
   - Check the run logs + your Slack channel

**Note:** The cron is UTC. Adjust `45 9` in the workflow file if you want a different BST time (e.g. `45 8` for 09:45 BST during summer).

### Option B: Local crontab (backup — only runs when Mac is awake)

```bash
crontab -e
# Add: 45 9 * * 1-5 /path/to/node scripts/slack-morning-summary.mjs >> /tmp/taskflow-slack.log 2>&1
```

## Day-of-week logic

- **Saturday/Sunday**: Skips silently
- **Monday**: Reads Friday's log
- **Tuesday–Friday**: Reads yesterday's log
- **Missing log**: Posts a heads-up message to Slack
