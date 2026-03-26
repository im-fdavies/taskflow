// ===================================================================
// TaskFlow — Left panel module
// Paused tasks, resume flow, context-switch mic.
// ===================================================================

const { invoke } = window.__TAURI__.core;

export async function refreshLeftPanel(forceRefresh = false) {
  await Promise.all([refreshPausedTasks(), refreshJiraTickets(forceRefresh)]);
}

async function refreshPausedTasks() {
  const list = document.getElementById("dashboard-task-list");
  if (!list) return;

  try {
    const tasks = await invoke("read_paused_tasks");
    list.innerHTML = "";
    if (tasks.length === 0) {
      list.innerHTML = '<div class="dashboard-empty">No paused tasks today</div>';
    } else {
      for (const task of tasks) {
        const div = document.createElement("div");
        div.className = "dashboard-task-item";

        const header = document.createElement("div");
        header.className = "dashboard-task-header";

        const name = document.createElement("span");
        name.className = "dashboard-task-name";
        name.textContent = task.name;

        const badge = document.createElement("span");
        badge.className = "dashboard-task-status task-status-paused";
        badge.textContent = "Paused";

        header.appendChild(name);
        header.appendChild(badge);
        div.appendChild(header);

        if (task.bookmark) {
          const bm = document.createElement("div");
          bm.className = "dashboard-task-bookmark";
          bm.textContent = `🔖 ${task.bookmark}`;
          div.appendChild(bm);
        }

        const resumeBtn = document.createElement("button");
        resumeBtn.className = "dashboard-task-resume";
        resumeBtn.textContent = "Resume";
        resumeBtn.onclick = () => window.app.resumeTask(task.name);
        div.appendChild(resumeBtn);

        list.appendChild(div);
      }
    }
  } catch (e) {
    list.innerHTML = '<div class="dashboard-empty">Could not load tasks</div>';
  }
}

async function refreshJiraTickets(forceRefresh = false) {
  const list = document.getElementById("dashboard-jira-list");
  if (!list) return;

  try {
    if (forceRefresh) {
      list.innerHTML = '<div class="dashboard-empty jira-loading">Syncing with Jira...</div>';
    }

    const command = forceRefresh ? "refresh_jira_cache" : "read_jira_tickets";
    const tickets = await invoke(command);

    list.innerHTML = "";
    if (tickets.length === 0) {
      list.innerHTML = '<div class="dashboard-empty">No sprint tickets</div>';
      return;
    }

    for (const ticket of tickets) {
      const div = document.createElement("div");
      div.className = "jira-ticket-item";

      const header = document.createElement("div");
      header.className = "jira-ticket-header";

      const key = document.createElement("span");
      key.className = "jira-ticket-key";
      key.textContent = ticket.key;

      const statusBadge = document.createElement("span");
      statusBadge.className = `jira-ticket-status jira-status-${ticket.statusCategory.toLowerCase().replace(/\s+/g, "-")}`;
      statusBadge.textContent = ticket.status;

      header.appendChild(key);
      header.appendChild(statusBadge);
      div.appendChild(header);

      const summary = document.createElement("div");
      summary.className = "jira-ticket-summary";
      summary.textContent = ticket.summary;
      div.appendChild(summary);

      const metaRow = document.createElement("div");
      metaRow.className = "jira-ticket-meta";

      const typeEl = document.createElement("span");
      typeEl.className = "jira-ticket-type";
      typeEl.textContent = ticket.issueType;
      metaRow.appendChild(typeEl);

      if (ticket.parentKey) {
        const parent = document.createElement("span");
        parent.className = "jira-ticket-parent";
        parent.textContent = ticket.parentKey;
        metaRow.appendChild(parent);
      }

      div.appendChild(metaRow);

      div.addEventListener("click", async () => {
        await window.__TAURI__.shell.open(ticket.url);
        window.app.close();
      });

      list.appendChild(div);
    }
  } catch (e) {
    list.innerHTML = '<div class="dashboard-empty">Could not load tickets</div>';
  }
}

async function refreshTasksDone() {
  const list = document.getElementById("dashboard-tasks-done-list");
  const label = document.getElementById("dashboard-tasks-done-label");
  if (!list) return;

  try {
    const completed = await invoke("read_completed_todos");
    list.innerHTML = "";
    if (completed.length > 0) {
      if (label) label.style.display = "";
      for (const name of completed) {
        const div = document.createElement("div");
        div.className = "dashboard-done-item";
        div.textContent = name;
        list.appendChild(div);
      }
    } else {
      if (label) label.style.display = "none";
    }
  } catch (e) {
    if (label) label.style.display = "none";
    list.innerHTML = "";
  }
}

export async function resumeTask(taskName, closeFn) {
  try {
    await invoke("start_task", { name: taskName });
    await closeFn();
  } catch (e) {
    console.error("[TaskFlow] Failed to resume task:", e);
  }
}

export async function leftPanelVoiceTap(voiceCapture, app) {
  const btn = document.getElementById("dashboard-left-voice-btn");
  const hint = document.getElementById("dashboard-left-voice-hint");
  const status = document.getElementById("dashboard-left-voice-status");

  if (voiceCapture.isRecording()) {
    if (btn) { btn.disabled = true; btn.textContent = '…'; btn.classList.remove("recording"); }
    if (hint) hint.style.display = "none";
    try {
      const text = await voiceCapture.stop();
      if (text) {
        // Guard: reject blank audio
        const trimmed = (text || '').trim();
        if (!trimmed || trimmed === '[BLANK_AUDIO]' || trimmed.length < 2) {
          if (status) { status.textContent = "No speech detected - try again"; status.style.display = "block"; }
          setTimeout(() => { if (status) status.style.display = "none"; }, 4000);
        } else {
          const savedText = text;

          // Collapse dashboard back to overlay size (mirrors close() logic without hiding)
          const backdrop = document.getElementById("dashboard-backdrop");
          const leftPanel = document.getElementById("s-dashboard-left");
          const rightPanel = document.getElementById("s-dashboard");
          if (rightPanel) rightPanel.style.transform = "translateX(100%)";
          if (leftPanel) leftPanel.style.transform = "translateX(-110%)";
          if (backdrop) backdrop.classList.remove("visible");
          await new Promise(resolve => setTimeout(resolve, 300));
          if (rightPanel) rightPanel.style.transform = "";
          if (leftPanel) { leftPanel.style.transform = ""; leftPanel.classList.remove("active"); }
          if (backdrop) backdrop.style.display = "none";
          await invoke("collapse_from_dashboard").catch(e => console.warn('[TF] collapse:', e));

          // Show listening state, then restore transcription (show() resets it)
          app.show("listening");
          app.transcription = savedText;
          app.showConfirmation();
        }
      }
    } catch (e) {
      console.error("[TaskFlow] Left panel voice failed:", e);
      if (status) { status.textContent = "Voice capture failed"; status.style.display = "block"; }
      setTimeout(() => { if (status) status.style.display = "none"; }, 4000);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🎤'; }
      if (hint) hint.style.display = "";
    }
  } else {
    try {
      await voiceCapture.start();
      if (btn) { btn.classList.add("recording"); btn.textContent = '⬛'; }
      if (hint) hint.style.display = "none";
      if (status) status.style.display = "none";
    } catch (e) {
      console.error("[TaskFlow] Left panel mic start failed:", e);
    }
  }
}
