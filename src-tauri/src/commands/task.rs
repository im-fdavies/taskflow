use crate::state::{AppState, TaskState};
use chrono::Local;

#[tauri::command(rename_all = "camelCase")]
pub fn get_state(state: tauri::State<'_, AppState>) -> TaskState {
    state.task.lock().expect("task state lock poisoned").clone()
}

#[tauri::command(rename_all = "camelCase")]
pub fn set_mode(mode: String, state: tauri::State<'_, AppState>) -> TaskState {
    let mut task = state.task.lock().expect("task state lock poisoned");
    task.mode = mode;
    task.clone()
}

#[tauri::command(rename_all = "camelCase")]
pub fn start_task(name: String, state: tauri::State<'_, AppState>) -> TaskState {
    let mut task = state.task.lock().expect("task state lock poisoned");
    task.current_task = Some(name);
    task.task_started_at = Some(Local::now().format("%H:%M").to_string());
    task.mode = "active".to_string();
    task.clone()
}

#[tauri::command(rename_all = "camelCase")]
pub fn end_task(state: tauri::State<'_, AppState>) -> TaskState {
    let mut task = state.task.lock().expect("task state lock poisoned");
    task.current_task = None;
    task.task_started_at = None;
    task.mode = "idle".to_string();
    task.clone()
}
