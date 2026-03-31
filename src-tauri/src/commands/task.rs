use crate::state::{AppState, TaskState};
use chrono::{Local, Timelike};
use tauri::AppHandle;

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
pub fn start_task(app: AppHandle, name: String, state: tauri::State<'_, AppState>) -> TaskState {
    // Guard against empty/blank task names to prevent ghost entries
    if name.trim().is_empty() {
        return state.task.lock().expect("task state lock poisoned").clone();
    }

    // Write to Open Tasks in today's log
    add_to_open_tasks(&name);

    let result = {
        let mut task = state.task.lock().expect("task state lock poisoned");
        task.current_task = Some(name);
        task.task_started_at = Some(Local::now().format("%H:%M").to_string());
        task.mode = "active".to_string();
        task.clone()
    };
    crate::tray::update_tray_menu(&app);
    result
}

#[tauri::command(rename_all = "camelCase")]
pub fn end_task(app: AppHandle, state: tauri::State<'_, AppState>) -> TaskState {
    let result = {
        let mut task = state.task.lock().expect("task state lock poisoned");
        task.current_task = None;
        task.task_started_at = None;
        task.mode = "idle".to_string();
        task.clone()
    };
    crate::tray::update_tray_menu(&app);
    result
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_task_elapsed(state: tauri::State<'_, AppState>) -> Option<String> {
    let task = state.task.lock().expect("task state lock poisoned");
    let started = task.task_started_at.as_ref()?;
    let parts: Vec<&str> = started.split(':').collect();
    if parts.len() != 2 { return None; }
    let h: u32 = parts[0].parse().ok()?;
    let m: u32 = parts[1].parse().ok()?;
    let now = Local::now();
    let now_mins = now.hour() * 60 + now.minute();
    let start_mins = h * 60 + m;
    if now_mins < start_mins { return None; }
    let elapsed = now_mins - start_mins;
    if elapsed >= 60 {
        Some(format!("{}h {}m", elapsed / 60, elapsed % 60))
    } else {
        Some(format!("{}m", elapsed))
    }
}

fn add_to_open_tasks(task_name: &str) {
    use std::fs;
    use crate::helpers::markdown::{daily_log_skeleton, ensure_log_sections, find_section_byte_offset, extract_section};

    let logs_dir = crate::helpers::config::logs_dir();
    let _ = fs::create_dir_all(&logs_dir);

    let now = Local::now();
    let date_str = now.format("%Y-%m-%d").to_string();
    let log_path = logs_dir.join(format!("{}.md", date_str));

    let raw = if log_path.exists() {
        fs::read_to_string(&log_path).unwrap_or_else(|_| daily_log_skeleton(&date_str))
    } else {
        daily_log_skeleton(&date_str)
    };
    let content = ensure_log_sections(&raw, &date_str);

    // Check if task is already in Open Tasks (don't duplicate on resume)
    let open_section = extract_section(&content, "Open Tasks");
    for line in open_section.lines() {
        if line.starts_with("### ") {
            let existing_name = line[4..].trim();
            if existing_name == task_name {
                return; // Already there, don't duplicate
            }
        }
    }

    // Insert new H3 entry at the end of Open Tasks (before ## Todos)
    let time_str = now.format("%H:%M").to_string();
    let entry = format!("### {}\n- **Started:** {}\n\n", task_name, time_str);
    let new_content = match find_section_byte_offset(&content, "Todos") {
        Some(pos) => {
            // Trim trailing whitespace before ## Todos so entries sit tight under ## Open Tasks
            let before = content[..pos].trim_end();
            format!("{}\n\n{}{}", before, entry, &content[pos..])
        }
        None => format!("{}{}", content, entry),
    };

    let _ = fs::write(&log_path, new_content);
}
