// ===================================================================
// TaskFlow — Completion flow
// Mode 4: task completion capture (outcome, PRs, follow-ups, handoff).
// ===================================================================

const { invoke } = window.__TAURI__.core;

/**
 * Show the completion state and pre-populate from context if available.
 * @param {string} taskName
 * @param {function} showState - app.show() to activate the completion state
 */
export function showCompletionState(taskName, showState) {
  const promptEl = document.getElementById("completion-prompt");
  if (promptEl) promptEl.textContent = `Wrapping up: ${taskName}`;

  const outcome = document.getElementById("completion-outcome");
  const prs = document.getElementById("completion-prs");
  const followups = document.getElementById("completion-followups");
  const handoff = document.getElementById("completion-handoff");
  if (outcome) outcome.value = "";
  if (prs) prs.value = "";
  if (followups) followups.value = "";
  if (handoff) handoff.value = "";

  const copiedEl = document.getElementById("completion-skill-copied");
  const copyBtn = document.getElementById("completion-copy-skill-btn");
  if (copiedEl) copiedEl.style.display = "none";
  if (copyBtn) copyBtn.style.display = "inline-flex";

  const ctxLoaded = document.getElementById("completion-context-loaded");
  if (ctxLoaded) ctxLoaded.style.display = "none";

  showState("completion");
  setTimeout(() => { if (outcome) outcome.focus(); }, 200);

  loadCompletionContext();
}

export async function loadCompletionContext() {
  try {
    const ctx = await invoke("read_completion_context");
    if (!ctx) return;

    const outcome = document.getElementById("completion-outcome");
    const prs = document.getElementById("completion-prs");
    const followups = document.getElementById("completion-followups");
    const handoff = document.getElementById("completion-handoff");

    if (ctx.outcome && outcome) { outcome.value = ctx.outcome; outcome.classList.add("prefilled"); }
    if (ctx.prs && prs) { prs.value = ctx.prs; prs.classList.add("prefilled"); }
    if (ctx.follow_ups && followups) { followups.value = ctx.follow_ups; followups.classList.add("prefilled"); }
    if (ctx.handoff && handoff) { handoff.value = ctx.handoff; handoff.classList.add("prefilled"); }

    const ctxLoaded = document.getElementById("completion-context-loaded");
    if (ctxLoaded) ctxLoaded.style.display = "block";
  } catch (e) {
    // Silent fail — user can still fill in manually
  }
}

export async function refreshCompletionContext() {
  const ctxLoaded = document.getElementById("completion-context-loaded");
  if (ctxLoaded) ctxLoaded.style.display = "none";
  await loadCompletionContext();
}

/**
 * Submit the completion log and end the task.
 * @param {string} taskName
 * @param {function} closeFn - app.close()
 */
export async function submitCompletion(taskName, closeFn) {
  const outcome = document.getElementById("completion-outcome");
  const prs = document.getElementById("completion-prs");
  const followups = document.getElementById("completion-followups");
  const handoff = document.getElementById("completion-handoff");

  try {
    const state = await invoke("get_state");
    let durationMinutes = null;
    if (state.task_started_at) {
      const [h, m] = state.task_started_at.split(':').map(Number);
      const now = new Date();
      durationMinutes = Math.round((now.getHours() * 60 + now.getMinutes()) - (h * 60 + m));
      if (durationMinutes < 0) durationMinutes = null;
    }

    await invoke("append_completion_log", {
      taskName: taskName || "Unknown",
      outcome: outcome ? outcome.value.trim() : "",
      prLinks: prs ? prs.value.trim() || null : null,
      followUps: followups ? followups.value.trim() || null : null,
      handoffNotes: handoff ? handoff.value.trim() || null : null,
      durationMinutes: durationMinutes,
      lesson: (() => { const el = document.getElementById("completion-lesson"); const v = el ? el.value.trim() : ""; return v || null; })(),
    });
  } catch (e) {
    console.error("[TaskFlow] Completion log failed:", e);
  }

  await invoke("end_task");
  closeFn();
}

export async function skipCompletion(closeFn) {
  await invoke("end_task");
  closeFn();
}

export async function copyCompletionSkill() {
  try {
    await navigator.clipboard.writeText("copilot /completion");
    const copiedEl = document.getElementById("completion-skill-copied");
    const copyBtn = document.getElementById("completion-copy-skill-btn");
    if (copiedEl) copiedEl.style.display = "block";
    if (copyBtn) copyBtn.style.display = "none";
  } catch (e) {
    console.error("[TaskFlow] Clipboard write failed:", e);
  }
}
