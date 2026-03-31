// ===================================================================
// TaskFlow — Left panel module
// Paused tasks, resume flow, context-switch mic.
// ===================================================================

const { invoke } = window.__TAURI__.core;

/**
 * Create an expandable notes panel for a task card.
 * Contains a read-only existing-notes section + textarea + Save button.
 * The panel starts hidden; toggling is handled by the card's click listener.
 * @param {string} taskName - The name of the task to attach notes to
 * @returns {{ panel: HTMLElement }}
 */
function createNotePanel(taskName) {
  const panel = document.createElement("div");
  panel.className = "dashboard-task-notes-panel";
  panel.style.display = "none";

  const existingDiv = document.createElement("div");
  existingDiv.className = "dashboard-task-notes-existing";

  const textarea = document.createElement("textarea");
  textarea.className = "dashboard-task-notes-textarea";
  textarea.placeholder = "Add a note…";
  textarea.rows = 3;

  const saveBtn = document.createElement("button");
  saveBtn.className = "dashboard-task-notes-save";
  saveBtn.textContent = "Save";

  panel.appendChild(existingDiv);
  panel.appendChild(textarea);
  panel.appendChild(saveBtn);

  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      panel.style.display = "none";
      const card = panel.closest(".dashboard-task-item, .dashboard-active-task-card");
      if (card) card.classList.remove("expanded");
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
    const card = panel.closest(".dashboard-task-item, .dashboard-active-task-card");
    if (card) card.classList.remove("expanded");
    await refreshLeftPanel();
  });

  return { panel };
}

export async function refreshLeftPanel(forceRefresh = false) {
  await Promise.all([refreshActiveTask(), refreshPausedTasks(), refreshJiraTickets(forceRefresh), refreshTasksDone()]);
}

/**
 * Toggle the notes panel on a task card and populate existing notes.
 * @param {HTMLElement} card - The card element (.dashboard-task-item or .dashboard-active-task-card)
 * @param {HTMLElement} panel - The notes panel element
 * @param {string} taskName - The task name to fetch notes for
 */
async function toggleNotePanel(card, panel, taskName) {
  const isOpen = panel.style.display !== "none";
  if (isOpen) {
    panel.style.display = "none";
    card.classList.remove("expanded");
    return;
  }

  // Populate existing notes
  const existingDiv = panel.querySelector(".dashboard-task-notes-existing");
  if (existingDiv) {
    try {
      const openTasks = await invoke("read_open_tasks");
      const task = openTasks.find(t => t.name.trim() === taskName.trim());
      existingDiv.innerHTML = "";
      if (task && task.notes) {
        const lines = task.notes.split("\n");
        const blocks = [];
        let currentBlock = null;
        for (const line of lines) {
          if (line.includes("📝")) {
            if (currentBlock) blocks.push(currentBlock);
            currentBlock = [line.replace(/^-\s*📝\s*/, "").trim()];
          } else if (currentBlock && line.trim() && !line.trim().startsWith("- **")) {
            currentBlock.push(line.trim());
          }
        }
        if (currentBlock) blocks.push(currentBlock);

        if (blocks.length > 0) {
          for (const block of blocks) {
            const blockDiv = document.createElement("div");
            blockDiv.className = "dashboard-note-block";
            for (const bline of block) {
              const noteEl = document.createElement("div");
              noteEl.textContent = bline;
              blockDiv.appendChild(noteEl);
            }
            existingDiv.appendChild(blockDiv);
          }
          existingDiv.style.display = "";
        } else {
          existingDiv.style.display = "none";
        }
      } else {
        existingDiv.style.display = "none";
      }
    } catch {
      existingDiv.style.display = "none";
    }
  }

  panel.style.display = "block";
  card.classList.add("expanded");
  const textarea = panel.querySelector(".dashboard-task-notes-textarea");
  if (textarea) {
    textarea.value = "";
    textarea.focus();
  }
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
        const oldPanel = card.querySelector(".dashboard-task-notes-panel");
        if (oldPanel) oldPanel.remove();
        card.classList.remove("expanded");

        const { panel } = createNotePanel(state.current_task);
        card.appendChild(panel);

        // Add chevron indicator to card if not already present
        let chevron = card.querySelector(".dashboard-task-chevron");
        if (!chevron) {
          chevron = document.createElement("span");
          chevron.className = "dashboard-task-chevron";
          chevron.textContent = "▾";
          const nameElInCard = card.querySelector(".dashboard-active-task-name");
          if (nameElInCard) nameElInCard.appendChild(chevron);
        }

        // Bind click-to-expand once only (card is persistent HTML)
        if (!card.getAttribute("data-notes-bound")) {
          card.setAttribute("data-notes-bound", "true");
          card.addEventListener("click", (e) => {
            if (e.target.closest(".btn-complete, .btn, .dashboard-task-notes-save, .dashboard-task-notes-textarea")) return;
            const currentPanel = card.querySelector(".dashboard-task-notes-panel");
            if (currentPanel) {
              const tn = nameEl ? nameEl.textContent.replace("▾", "").trim() : "";
              toggleNotePanel(card, currentPanel, tn);
            }
          });
        }
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
        const { panel: notePanel } = createNotePanel(task.name);
        div.appendChild(notePanel);

        // Add chevron indicator
        const chevron = document.createElement("span");
        chevron.className = "dashboard-task-chevron";
        chevron.textContent = "▾";
        name.appendChild(chevron);

        // Card-level click-to-expand
        div.addEventListener("click", (e) => {
          if (e.target.closest(".dashboard-task-resume, .dashboard-task-notes-save, .dashboard-task-notes-textarea")) return;
          toggleNotePanel(div, notePanel, task.name);
        });

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
