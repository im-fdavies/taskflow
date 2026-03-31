// ===================================================================
// TaskFlow — Entry flow + transition state
// Transition boundary display, entry state with templates + clarification.
// ===================================================================

const { invoke } = window.__TAURI__.core;

/**
 * Show the transition state (context boundary).
 * @param {object} session
 * @param {object} callbacks - { showState, showEntryState }
 */
export async function showTransitionState(session, callbacks) {
  const { mode, exitCapture, taskName } = session;

  let previousTaskName = null;

  // Log the context switch
  try {
    const previousState = await invoke("get_state");
    previousTaskName = previousState.current_task;
    const startTime = previousState.task_started_at;
    let durationMinutes = null;
    if (startTime) {
      const [h, m] = startTime.split(':').map(Number);
      const now = new Date();
      durationMinutes = Math.round((now.getHours() * 60 + now.getMinutes()) - (h * 60 + m));
      if (durationMinutes < 0) durationMinutes = null;
    }
    invoke("append_daily_log", {
      taskName: previousState.current_task || "Unknown",
      taskType: session.template?.name || null,
      exitCapture: exitCapture || "",
      bookmark: session.extractedBookmark || null,
      mode: mode,
      durationMinutes: durationMinutes,
      lesson: session.lesson || null,
    });
  } catch (e) {
    console.warn("[TaskFlow] Failed to log context switch:", e);
  }

  const prompt = document.getElementById("transition-prompt");
  const bookmark = document.getElementById("transition-bookmark");
  const bookmarkContent = document.getElementById("bookmark-content");
  const autoMsg = document.getElementById("transition-auto-msg");
  const confirmBtn = document.getElementById("transition-confirm-btn");
  const footerText = document.getElementById("transition-footer-text");

  if (mode === 3) {
    callbacks.showEntryState();
    return;
  }

  if (mode === 2) {
    if (prompt) prompt.textContent = "Context boundary set.";
    if (bookmark) bookmark.style.display = "none";
    if (autoMsg) {
      autoMsg.textContent = `Moving to: ${taskName}`;
      autoMsg.style.display = "block";
      autoMsg.classList.add("transition-auto-advancing");
    }
    if (confirmBtn) confirmBtn.style.display = "none";
    if (footerText) footerText.textContent = "Auto-advancing…";

    callbacks.showState("transition");
    setTimeout(() => callbacks.showEntryState(), 1500);
    return;
  }

  // Mode 1
  if (prompt) prompt.textContent = "Context saved.";
  if (bookmark) bookmark.style.display = "block";
  if (bookmarkContent) bookmarkContent.textContent = previousTaskName || taskName || "—";
  if (autoMsg) autoMsg.style.display = "none";
  if (confirmBtn) {
    confirmBtn.style.display = "inline-flex";
    confirmBtn.textContent = "Confirmed";
    if (session.pauseOnly) {
      confirmBtn.onclick = () => callbacks.closeOverlay();
    }
  }
  if (footerText) footerText.textContent = "Saved to daily log";

  callbacks.showState("transition");
}

/**
 * Show the entry state with template phases and clarification questions.
 * @param {object} session
 * @param {string} transcription - Current transcription text
 * @param {function} showState - app.show()
 * @returns {string} pendingTask name to set on the app
 */
export function showEntryState(session, transcription, showState) {
  const { mode, template, taskName } = session;

  const entryLabel = document.getElementById("entry-label");
  const entryTaskName = document.getElementById("entry-task-name");
  const modeNote = document.getElementById("entry-mode-note");
  const templateBadge = document.getElementById("template-badge");
  const phasesContainer = document.getElementById("template-phases");

  if (phasesContainer) phasesContainer.innerHTML = "";
  if (modeNote) { modeNote.style.display = "none"; modeNote.textContent = ""; }

  let pendingTask;

  if (mode === 3) {
    if (entryLabel) entryLabel.textContent = "Entry · Urgent";
    if (entryTaskName) entryTaskName.textContent = taskName || transcription;
    if (templateBadge) {
      templateBadge.textContent = "Urgent";
      templateBadge.className = "badge badge-mode3";
    }

    if (phasesContainer) {
      const div = document.createElement("div");
      div.className = "urgent-entry";
      div.textContent = `Captured. Focus on ${taskName}. System will check back later.`;
      phasesContainer.appendChild(div);
    }

    pendingTask = taskName || transcription;
    showState("entry");
    return pendingTask;
  }

  if (template) {
    if (entryLabel) {
      entryLabel.textContent = mode === 2
        ? `Entry · ${template.name} (light)`
        : `Entry · ${template.name}`;
    }
    if (entryTaskName) entryTaskName.textContent = template.name;
    if (templateBadge) {
      templateBadge.textContent = template.name;
      templateBadge.className = "badge";
    }

    if (mode === 2 && modeNote) {
      modeNote.textContent = "Quick entry — template for reference.";
      modeNote.style.display = "block";
    }

    renderPhases(template, phasesContainer);
    pendingTask = template.name;
  } else {
    if (entryLabel) entryLabel.textContent = "Entry";
    if (entryTaskName) entryTaskName.textContent = taskName || transcription;
    if (templateBadge) {
      templateBadge.textContent = "No template";
      templateBadge.className = "badge";
    }

    if (mode === 2 && modeNote) {
      modeNote.textContent = "Quick entry — no template matched.";
      modeNote.style.display = "block";
    }

    if (phasesContainer) {
      const div = document.createElement("div");
      div.className = "phase";
      div.innerHTML = `
        <div class="phase-dot teal">→</div>
        <div>
          <div class="phase-text">Starting: ${taskName}</div>
          <div class="phase-sub">No template matched — working without structure.</div>
        </div>
      `;
      phasesContainer.appendChild(div);
    }

    pendingTask = taskName || transcription;
  }

  showState("entry");
  fetchClarificationQuestions(session);
  return pendingTask;
}

export async function fetchClarificationQuestions(session) {
  const { mode, template, transcription, exitCapture } = session;
  const container = document.getElementById('clarification-questions');
  if (!container) return;

  container.style.display = 'none';
  container.innerHTML = '';

  if (mode === 3) return;

  container.style.display = 'block';
  const thinking = document.createElement('div');
  thinking.className = 'clarification-thinking';
  thinking.textContent = 'Thinking…';
  container.appendChild(thinking);

  const templateName = template ? (template.name || '') : '';
  const templateContext = template ? JSON.stringify(template) : '';
  const maxQuestions = mode === 2 ? 1 : 3;

  try {
    const questions = await Promise.race([
      invoke('generate_clarification_questions', {
        transcription: transcription || '',
        templateName,
        templateContext,
        exitCapture: exitCapture || '',
        maxQuestions,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 5000)
      ),
    ]);

    container.innerHTML = '';

    if (!questions || questions.length === 0) {
      container.style.display = 'none';
      return;
    }

    const list = document.createElement('div');
    list.className = 'clarification-list';
    questions.forEach((q) => {
      const item = document.createElement('div');
      item.className = 'clarification-item';
      item.textContent = q;
      list.appendChild(item);
    });
    container.appendChild(list);
  } catch (err) {
    console.error('[TaskFlow] Clarification questions failed:', err.message);
    container.style.display = 'none';
    container.innerHTML = '';
  }
}

export function renderPhases(template, container) {
  const colours = ["amber", "teal", "purple"];
  const phases = Array.isArray(template.phases) ? template.phases : [];

  phases.forEach((phase, i) => {
    const div = document.createElement("div");
    div.className = "phase";
    const colour = phase.colour || colours[i] || "teal";
    div.innerHTML = `
      <div class="phase-dot ${colour}">${i + 1}</div>
      <div>
        <div class="phase-text">${phase.name}</div>
        <div class="phase-sub">${phase.guidance}</div>
      </div>
    `;
    container.appendChild(div);
  });
}
