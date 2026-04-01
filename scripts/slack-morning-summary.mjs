#!/usr/bin/env node

/**
 * Slack Morning Summary
 *
 * Reads yesterday's TaskFlow daily log, generates a concise summary via
 * the Claude API, and posts it to Slack via an incoming webhook.
 *
 * Config is read from ~/.taskflow/config.toml:
 *   [slack]   webhook_url = "https://hooks.slack.com/services/..."
 *   [logs]    path = "~/Library/CloudStorage/Dropbox/DailyNotes"
 *   [api]     anthropic_key = "sk-ant-..."
 *
 * Usage:
 *   node scripts/slack-morning-summary.mjs
 *   npm run slack-summary
 */

import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Expand a leading ~/ to the real home directory. */
function expandHome(p) {
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

/**
 * Extract a value from a TOML file using simple regex.
 * Finds the [section] header, then looks for `key = "value"` within it.
 */
function tomlValue(content, section, key) {
  const sectionRe = new RegExp(
    `\\[${section}\\]([\\s\\S]*?)(?=\\n\\[|$)`
  );
  const match = content.match(sectionRe);
  if (!match) return undefined;

  const block = match[1];
  const keyRe = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, "m");
  const kv = block.match(keyRe);
  return kv ? kv[1] : undefined;
}

// ── Read config ──────────────────────────────────────────────────────────────

const configPath = resolve(homedir(), ".taskflow/config.toml");
let configContent;
try {
  configContent = readFileSync(configPath, "utf-8");
} catch {
  console.error(`Config not found at ${configPath}`);
  process.exit(1);
}

const webhookUrl = tomlValue(configContent, "slack", "webhook_url");
if (!webhookUrl) {
  console.error(
    "Missing webhook_url in [slack] section of ~/.taskflow/config.toml"
  );
  process.exit(1);
}

const logsPath = expandHome(
  tomlValue(configContent, "logs", "path") ?? "~/.taskflow/logs"
);
const anthropicKey = tomlValue(configContent, "api", "anthropic_key");

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
const logFile = join(logsPath, `${dateStr}.md`);
const dayLabel = dayOfWeek === 1 ? "Friday" : "yesterday";

// ── Read log ─────────────────────────────────────────────────────────────────

let logContent;
try {
  logContent = readFileSync(logFile, "utf-8");
} catch {
  // No log file — post heads-up to Slack and exit.
  const msg = `No activity logged on ${dayLabel} — heads up 👀`;
  console.log(msg);
  await postToSlack(msg);
  process.exit(0);
}

// ── Generate summary ─────────────────────────────────────────────────────────

let summary;

if (anthropicKey) {
  try {
    summary = await callClaude(logContent, anthropicKey);
  } catch (err) {
    console.warn(`Claude API failed (${err.message}), falling back to template.`);
    summary = fallbackSummary(logContent);
  }
} else {
  console.warn("No anthropic_key configured — using template summary.");
  summary = fallbackSummary(logContent);
}

// ── Post to Slack ────────────────────────────────────────────────────────────

await postToSlack(summary);
console.log("Slack message posted ✓");

// ── Functions ────────────────────────────────────────────────────────────────

/**
 * Call the Claude API to generate a narrative summary.
 * Times out after 10 seconds.
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
