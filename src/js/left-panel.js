// ===================================================================
// TaskFlow — Left panel module
// Paused tasks, resume flow, context-switch mic.
// ===================================================================

const { invoke } = window.__TAURI__.core;

export async function refreshLeftPanel() {
  await Promise.all([refreshPausedTasks(), refreshTasksDone()]);
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
        app.transcription = text;
        await app.close();
        app.showConfirmation();
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
