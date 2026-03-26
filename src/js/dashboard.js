// ===================================================================
// TaskFlow — Dashboard module
// Todo list, daily summary side panel.
// ===================================================================

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
        text.textContent = todo.name;
        if (todo.priority) {
          const badge = document.createElement("span");
          badge.className = `dashboard-priority-badge priority-${todo.priority.toLowerCase()}`;
          badge.textContent = todo.priority;
          text.appendChild(badge);
        }

        const actions = document.createElement("span");
        actions.className = "dashboard-todo-actions";

        const doneBtn = document.createElement("button");
        doneBtn.className = "dashboard-todo-action-btn done";
        doneBtn.textContent = "✓";
        doneBtn.title = "Mark done";
        doneBtn.onclick = () => completeTodo(todo.name, div);

        const discardBtn = document.createElement("button");
        discardBtn.className = "dashboard-todo-action-btn discard";
        discardBtn.textContent = "✕";
        discardBtn.title = "Discard";
        discardBtn.onclick = () => discardTodo(todo.name, div);

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
  try {
    if (element) element.classList.add("completing");
    await invoke("discard_todo_entry", { todoText });
    await new Promise(r => setTimeout(r, 250));
    await refreshDashboardTodos();
  } catch (e) {
    if (element) element.classList.remove("completing");
    console.error("[TaskFlow] Failed to discard todo:", e);
  }
}

export async function dismissTodoAdded() {
  const addedPanel = document.getElementById("dashboard-todo-added");
  const status = document.getElementById("dashboard-voice-status");
  const editInput = document.getElementById("dashboard-todo-edit");

  if (editInput && _lastAddedTodo) {
    const newText = editInput.value.trim();
    const activePriority = document.querySelector('#dashboard-todo-priority .dashboard-pill.active');
    const priority = activePriority ? activePriority.dataset.value : null;

    if (newText && (newText !== _lastAddedTodo || priority)) {
      try {
        await invoke("update_todo_entry", {
          oldName: _lastAddedTodo,
          newName: newText,
          priority,
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
