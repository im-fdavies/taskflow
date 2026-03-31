// ===================================================================
// TaskFlow — Left panel module
// Paused tasks, resume flow, context-switch mic.
// ===================================================================

const { invoke } = window.__TAURI__.core;

/**
 * Create a note 📝 button + expandable panel for a task card.
 * @param {string} taskName - The name of the task to attach notes to
 * @returns {{ button: HTMLElement, panel: HTMLElement }}
 */
function createNotePanel(taskName) {
  const btn = document.createElement("button");
  btn.className = "dashboard-task-note-btn";
  btn.textContent = "📝";
  btn.title = "Add note";

  const panel = document.createElement("div");
  panel.className = "dashboard-task-notes-panel";
  panel.style.display = "none";

  const textarea = document.createElement("textarea");
  textarea.className = "dashboard-task-notes-textarea";
  textarea.placeholder = "Add a note…";
  textarea.rows = 3;

  const saveBtn = document.createElement("button");
  saveBtn.className = "dashboard-task-notes-save";
  saveBtn.textContent = "Save";

  panel.appendChild(textarea);
  panel.appendChild(saveBtn);

  btn.addEventListener("click", async () => {
    const isOpen = panel.style.display === "block";
    if (isOpen) {
      panel.style.display = "none";
      return;
    }
    // Pre-populate with existing notes (📝 lines only)
    try {
      const openTasks = await invoke("read_open_tasks");
      const task = openTasks.find(t => t.name === taskName);
      if (task && task.notes) {
        const noteLines = task.notes
          .split("\n")
          .filter(l => l.includes("📝"))
          .map(l => l.replace(/^-\s*📝\s*/, "").trim())
          .join("\n");
        textarea.value = noteLines;
      } else {
        textarea.value = "";
      }
    } catch {
      textarea.value = "";
    }
    panel.style.display = "block";
    textarea.focus();
  });

  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      panel.style.display = "none";
    }
  });

  saveBtn.addEventListener("click", async () => {
    const text = textarea.value.trim();
    if (text) {
      try {
        await invoke("append_task_note", { taskName, noteText: text });
      } catch (e) {
        console.error("[TaskFlow] Failed to save task note:", e);
      }
    }
    panel.style.display = "none";
    textarea.value = "";
    await refreshLeftPanel();
  });

  return { button: btn, panel };
}

export async function refreshLeftPanel(forceRefresh = false) {
  await Promise.all([refreshActiveTask(), refreshPausedTasks(), refreshJiraTickets(forceRefresh), refreshTasksDone()]);
}

async function refreshActiveTask() {
  const container = document.getElementById("dashboard-active-task");
  const nameEl = document.getElementById("dashboard-active-task-name");
  const switchBtn = document.getElementById("dashboard-switch-btn");
  if (!container) return;

  try {
    const state = await invoke("get_state");
    if (state.current_task) {
      container.style.display = "block";
      if (nameEl) nameEl.textContent = state.current_task;
      if (switchBtn) switchBtn.textContent = "Switch";

      // Add note panel to active task card (remove any previous one first)
      const card = document.querySelector(".dashboard-active-task-card");
      if (card) {
        const oldBtn = card.querySelector(".dashboard-task-note-btn");
        const oldPanel = card.querySelector(".dashboard-task-notes-panel");
        if (oldBtn) oldBtn.remove();
        if (oldPanel) oldPanel.remove();

        const { button, panel } = createNotePanel(state.current_task);
        const actions = card.querySelector(".dashboard-active-task-actions");
        if (actions) {
          actions.appendChild(button);
        }
        card.appendChild(panel);
      }
    } else {
      container.style.display = "none";
      if (switchBtn) switchBtn.textContent = "Start";
    }
  } catch (e) {
    container.style.display = "none";
    if (switchBtn) switchBtn.textContent = "Start";
  }
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

        // Add note panel to paused task card
        const { button: noteBtn, panel: notePanel } = createNotePanel(task.name);
        div.appendChild(noteBtn);
        div.appendChild(notePanel);

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
