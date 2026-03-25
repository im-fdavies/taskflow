// ===================================================================
// TaskFlow - Start flow (first task of the day)
// Checks paused tasks + todos for matches, skips exit/transition.
// ===================================================================

import { fuzzyMatchTask } from './logic.js';

const { invoke } = window.__TAURI__.core;

/**
 * Check if the spoken task matches any paused task or open todo from today.
 * @param {string} taskName - What the user said they're starting
 * @returns {Promise<{ type: string, match: object }|null>}
 *   type: "paused" (switched away from earlier) or "todo" (on todo list)
 *   match: { name, bookmark?, exit_notes?, time? }
 */
export async function findExistingTask(taskName) {
  const [pausedTasks, todos] = await Promise.all([
    invoke("read_paused_tasks").catch(() => []),
    invoke("read_daily_todos").catch(() => []),
  ]);

  // Check paused tasks first (richer context - have bookmarks)
  const pausedResult = fuzzyMatchTask(taskName, pausedTasks);
  if (pausedResult) {
    return { type: "paused", ...pausedResult };
  }

  // Check todos
  const todoObjects = todos.map(t => ({ name: t.name }));
  const todoResult = fuzzyMatchTask(taskName, todoObjects);
  if (todoResult) {
    return { type: "todo", ...todoResult };
  }

  return null;
}

/**
 * Render the start context panel in the confirmed sub-state.
 * Shows bookmark/exit notes when resuming a paused task, or a todo match hint.
 * @param {object|null} found - Result from findExistingTask
 */
export function renderStartContext(found) {
  const container = document.getElementById("start-context");
  if (!container) return;

  if (!found) {
    container.style.display = "none";
    return;
  }

  container.style.display = "block";
  const label = document.getElementById("start-context-label");
  const body = document.getElementById("start-context-body");

  if (found.type === "paused") {
    if (label) label.textContent = "Picking up from earlier";
    let html = "";
    if (found.match.bookmark) {
      html += `<div class="start-context-item"><span class="start-context-icon">🔖</span> ${escapeHtml(found.match.bookmark)}</div>`;
    }
    if (found.match.exit_notes) {
      html += `<div class="start-context-item"><span class="start-context-icon">📝</span> ${escapeHtml(found.match.exit_notes)}</div>`;
    }
    if (!html) {
      html = `<div class="start-context-item">Paused at ${found.match.time || "earlier"}</div>`;
    }
    if (body) body.innerHTML = html;
  } else if (found.type === "todo") {
    if (label) label.textContent = "From your todo list";
    if (body) body.innerHTML = `<div class="start-context-item"><span class="start-context-icon">✓</span> ${escapeHtml(found.match.name)}</div>`;
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
