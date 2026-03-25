// ===================================================================
// TaskFlow — Dashboard module
// Todo list, voice-to-todo, daily summary side panel.
// ===================================================================

import { parseTodoIntent } from './logic.js';

const { invoke } = window.__TAURI__.core;

let _lastAddedTodo = null;

/**
 * Open the dashboard panel: expand window, show backdrop, load data.
 * @param {function} showState - app.show()
 */
export async function showDashboard(showState) {
  await invoke("expand_for_dashboard").catch(e => console.warn('[TF] expand:', e));

  const backdrop = document.getElementById("dashboard-backdrop");
  if (backdrop) {
    backdrop.style.display = "block";
    backdrop.offsetHeight; // force reflow so transition fires
    backdrop.classList.add("visible");
  }

  showState("dashboard");

  const summaryEl = document.getElementById("dashboard-summary");
  try {
    const summary = await invoke("read_daily_summary");
    if (summaryEl) summaryEl.textContent = summary || "No summary written yet for today.";
  } catch (e) {
    if (summaryEl) summaryEl.textContent = "—";
  }

  await refreshDashboardTodos();
}

export async function refreshDashboardTodos() {
  const list = document.getElementById("dashboard-todo-list");
  if (!list) return;

  try {
    const todos = await invoke("read_daily_todos");
    list.innerHTML = "";
    if (todos.length === 0) {
      list.innerHTML = '<div class="dashboard-empty">No todos logged today yet</div>';
    } else {
      for (const todo of todos) {
        const div = document.createElement("div");
        div.className = "dashboard-todo-item";

        const text = document.createElement("span");
        text.className = "dashboard-todo-text";
        text.textContent = todo;

        const actions = document.createElement("span");
        actions.className = "dashboard-todo-actions";

        const doneBtn = document.createElement("button");
        doneBtn.className = "dashboard-todo-action-btn done";
        doneBtn.textContent = "✓";
        doneBtn.title = "Mark done";
        doneBtn.onclick = () => completeTodo(todo, div);

        const discardBtn = document.createElement("button");
        discardBtn.className = "dashboard-todo-action-btn discard";
        discardBtn.textContent = "✕";
        discardBtn.title = "Discard";
        discardBtn.onclick = () => discardTodo(todo, div);

        actions.appendChild(doneBtn);
        actions.appendChild(discardBtn);
        div.appendChild(text);
        div.appendChild(actions);
        list.appendChild(div);
      }
    }
  } catch (e) {
    list.innerHTML = '<div class="dashboard-empty">Could not load todos</div>';
  }

  await refreshDoneTodos();
}

/**
 * Handle dashboard voice button tap (push-to-talk for adding todos).
 * @param {VoiceCapture} voiceCapture - The dashboard voice capture instance
 */
export async function dashboardVoiceTap(voiceCapture) {
  const btn = document.getElementById("dashboard-voice-btn");
  const hint = document.getElementById("dashboard-voice-hint");
  const status = document.getElementById("dashboard-voice-status");

  if (voiceCapture.isRecording()) {
    if (btn) { btn.disabled = true; btn.textContent = '…'; btn.classList.remove("recording"); }
    if (hint) hint.style.display = "none";
    try {
      const text = await voiceCapture.stop();
      if (text) {
        const taskName = parseTodoIntent(text, true);
        if (taskName) {
          await invoke("append_todo_entry", { taskName });
          if (status) { status.textContent = `✓ Added`; status.style.display = "block"; }
          const addedPanel = document.getElementById("dashboard-todo-added");
          const editInput = document.getElementById("dashboard-todo-edit");
          if (addedPanel) addedPanel.style.display = "flex";
          if (editInput) { editInput.value = taskName; editInput.focus(); editInput.select(); }
          _lastAddedTodo = taskName;
          await refreshDashboardTodos();
        } else {
          if (status) { status.textContent = `Couldn't parse that — try again`; status.style.display = "block"; }
          setTimeout(() => { if (status) status.style.display = "none"; }, 4000);
        }
      }
    } catch (e) {
      console.error("[TaskFlow] Dashboard voice failed:", e);
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
      console.error("[TaskFlow] Dashboard mic start failed:", e);
    }
  }
}

async function refreshDoneTodos() {
  const list = document.getElementById("dashboard-done-list");
  const label = document.getElementById("dashboard-done-label");
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

async function completeTodo(todoText, element) {
  try {
    if (element) element.classList.add("completing");
    await invoke("complete_todo_entry", { todoText });
    // Brief delay for the fade-out animation to be visible
    await new Promise(r => setTimeout(r, 250));
    await refreshDashboardTodos();
  } catch (e) {
    if (element) element.classList.remove("completing");
    console.error("[TaskFlow] Failed to complete todo:", e);
  }
}

async function discardTodo(todoText, element) {
  if (element.dataset.confirming) {
    try {
      await invoke("discard_todo_entry", { todoText });
      await refreshDashboardTodos();
    } catch (e) {
      console.error("[TaskFlow] Failed to discard todo:", e);
    }
    return;
  }

  element.dataset.confirming = "true";
  element.classList.add("confirming-discard");
  const text = element.querySelector(".dashboard-todo-text");
  const originalText = text.textContent;
  text.textContent = "Discard this todo?";

  setTimeout(() => {
    if (element.dataset.confirming) {
      delete element.dataset.confirming;
      element.classList.remove("confirming-discard");
      text.textContent = originalText;
    }
  }, 3000);
}

export async function dismissTodoAdded() {
  const addedPanel = document.getElementById("dashboard-todo-added");
  const status = document.getElementById("dashboard-voice-status");
  const editInput = document.getElementById("dashboard-todo-edit");

  if (editInput && _lastAddedTodo) {
    const newText = editInput.value.trim();
    if (newText && newText !== _lastAddedTodo) {
      try {
        await invoke("update_todo_entry", {
          oldName: _lastAddedTodo,
          newName: newText,
        });
        await refreshDashboardTodos();
      } catch (e) {
        console.error("[TaskFlow] Failed to update todo:", e);
      }
    }
  }

  if (addedPanel) addedPanel.style.display = "none";
  if (status) status.style.display = "none";
  if (editInput) editInput.value = "";

  document.querySelectorAll('.dashboard-pill.active').forEach(p => p.classList.remove('active'));
  _lastAddedTodo = null;
}

/**
 * Get/set the last added todo name (used by showConfirmation's todo routing).
 */
export function getLastAddedTodo() { return _lastAddedTodo; }
export function setLastAddedTodo(name) { _lastAddedTodo = name; }
