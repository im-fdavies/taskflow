#!/usr/bin/env node

/**
 * Slack Morning Summary — Cloud Version (GitHub Actions)
 *
 * Reads yesterday's TaskFlow daily log from Dropbox via API, generates a
 * summary via Claude, and posts it to Slack.
 *
 * Required env vars:
 *   SLACK_WEBHOOK_URL     — Slack incoming webhook
 *   DROPBOX_ACCESS_TOKEN  — Dropbox API token with files.content.read scope
 *   DROPBOX_LOGS_PATH     — Dropbox folder path (default: /DailyNotes)
 *   ANTHROPIC_API_KEY     — Claude API key (optional — falls back to template)
 */

// ── Day-of-week logic ────────────────────────────────────────────────────────

const now = new Date();
const dayOfWeek = now.getDay(); // 0=Sun … 6=Sat

if (dayOfWeek === 0 || dayOfWeek === 6) {
  console.log("Weekend — skipping.");
  process.exit(0);
}

const daysBack = dayOfWeek === 1 ? 3 : 1; // Monday → Friday, else yesterday
const target = new Date(now);
target.setDate(target.getDate() - daysBack);

const dateStr = target.toISOString().slice(0, 10); // YYYY-MM-DD
const dayLabel = dayOfWeek === 1 ? "Friday" : "yesterday";

// ── Validate env ─────────────────────────────────────────────────────────────

const webhookUrl = process.env.SLACK_WEBHOOK_URL;
const dropboxToken = process.env.DROPBOX_ACCESS_TOKEN;
const anthropicKey = process.env.ANTHROPIC_API_KEY;
const dropboxPath = process.env.DROPBOX_LOGS_PATH || "/DailyNotes";

if (!webhookUrl) {
  console.error("Missing SLACK_WEBHOOK_URL env var");
  process.exit(1);
}
if (!dropboxToken) {
  console.error("Missing DROPBOX_ACCESS_TOKEN env var");
  process.exit(1);
}

// ── Read log from Dropbox ────────────────────────────────────────────────────

const filePath = `${dropboxPath}/${dateStr}.md`;
console.log(`Fetching ${filePath} from Dropbox…`);

let logContent;
try {
  logContent = await fetchFromDropbox(filePath);
} catch (err) {
  if (err.status === 409) {
    // 409 = path/not_found in Dropbox API
    const msg = `No activity logged on ${dayLabel} — heads up 👀`;
    console.log(msg);
    await postToSlack(msg);
    process.exit(0);
  }
  console.error(`Dropbox fetch failed: ${err.message}`);
  process.exit(1);
}

console.log(`Got ${logContent.length} chars from Dropbox.`);

// ── Generate summary ─────────────────────────────────────────────────────────

let summary;

if (anthropicKey) {
  try {
    summary = await callClaude(logContent, anthropicKey);
  } catch (err) {
    console.warn(
      `Claude API failed (${err.message}), falling back to template.`
    );
    summary = fallbackSummary(logContent);
  }
} else {
  console.warn("No ANTHROPIC_API_KEY — using template summary.");
  summary = fallbackSummary(logContent);
}

// ── Post to Slack ────────────────────────────────────────────────────────────

await postToSlack(summary);
console.log("Slack message posted ✓");

// ── Functions ────────────────────────────────────────────────────────────────

/**
 * Download a file from Dropbox using the content API.
 * https://www.dropbox.com/developers/documentation/http/documentation#files-download
 */
async function fetchFromDropbox(path) {
  const res = await fetch(
    "https://content.dropboxapi.com/2/files/download",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dropboxToken}`,
        "Dropbox-API-Arg": JSON.stringify({ path }),
      },
    }
  );

  if (!res.ok) {
    const err = new Error(`Dropbox HTTP ${res.status}`);
    err.status = res.status;
    try {
      err.message += `: ${await res.text()}`;
    } catch {}
    throw err;
  }

  return res.text();
}

/**
 * Call the Claude API to generate a narrative summary.
 */
async function callClaude(log, apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        system:
          "You summarise daily work logs into concise second-person Slack messages. " +
          "This log is from YESTERDAY, not today. " +
          "Use plain text, no markdown headers. Keep it under 200 words. " +
          "Be direct and useful — mention task names, what got done, what's still open, " +
          "and any todos. Start with something like 'Here's a summary of yesterday:' or 'Yesterday's recap:'.",
        messages: [{ role: "user", content: log }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    return data.content?.[0]?.text ?? fallbackSummary(log);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fallback: extract task names from ### HH:MM - TaskName headings.
 */
function fallbackSummary(log) {
  const headings = [...log.matchAll(/^###?\s+\d{2}:\d{2}\s*-\s*(.+)$/gm)];
  if (headings.length === 0) {
    return `Morning! Here's a raw dump of ${dayLabel}'s log — Claude was unavailable:\n\n${log.slice(0, 500)}`;
  }
  const tasks = headings.map((m) => m[1].trim());
  return `Morning! ${dayLabel === "Friday" ? "On Friday" : "Yesterday"} you worked on: ${tasks.join(", ")}.`;
}

/**
 * Post a text message to the configured Slack webhook.
 */
async function postToSlack(text) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Slack post failed: HTTP ${res.status} — ${body}`);
    process.exit(1);
  }
}
