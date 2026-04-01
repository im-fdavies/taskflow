use crate::helpers::config::logs_dir;
use crate::helpers::markdown::{
    ensure_trailing_newline, find_section_byte_offset,
    read_and_normalize_log,
};
use crate::state::{AppState, TimerEntry, TimerInfo};
use chrono::{Local, Timelike};
use tauri::{AppHandle, Emitter, Manager};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn slugify(input: &str) -> String {
    input.to_lowercase().replace(' ', "-")
}

pub(crate) fn timer_id(fire_time: &str, title: &str) -> String {
    slugify(&format!("{}-{}", fire_time, title))
}

fn parse_hh_mm(time_str: &str) -> Result<(u32, u32), String> {
    let parts: Vec<&str> = time_str.split(':').collect();
    if parts.len() != 2 {
        return Err("Invalid time format, expected HH:MM".to_string());
    }
    let hours: u32 = parts[0]
        .parse()
        .map_err(|_| "Invalid hours".to_string())?;
    let minutes: u32 = parts[1]
        .parse()
        .map_err(|_| "Invalid minutes".to_string())?;
    if hours > 23 || minutes > 59 {
        return Err("Time out of range".to_string());
    }
    Ok((hours, minutes))
}

pub(crate) fn calculate_sleep_duration(fire_time: &str) -> Result<std::time::Duration, String> {
    let (fire_h, fire_m) = parse_hh_mm(fire_time)?;
    let now = Local::now();
    let now_h = now.hour();
    let now_m = now.minute();
    let now_s = now.second();

    let fire_secs = fire_h * 3600 + fire_m * 60;
    let now_secs = now_h * 3600 + now_m * 60 + now_s;

    if fire_secs <= now_secs {
        return Err("Timer time has already passed".to_string());
    }

    Ok(std::time::Duration::from_secs(
        (fire_secs - now_secs) as u64,
    ))
}

fn update_timer_log_status(timer_id: &str, new_status: &str) {
    use std::fs;

    let logs_dir = logs_dir();
    let date_str = Local::now().format("%Y-%m-%d").to_string();
    let log_path = logs_dir.join(format!("{}.md", date_str));

    let content = match fs::read_to_string(&log_path) {
        Ok(c) => c,
        Err(_) => return,
    };

    let mut lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();
    let mut in_timers = false;
    let mut in_target_entry = false;

    for line in lines.iter_mut() {
        if line.trim() == "# Timers" {
            in_timers = true;
            continue;
        }
        if in_timers
            && line.starts_with("# ")
            && !line.starts_with("## ")
            && !line.starts_with("### ")
        {
            break;
        }
        if in_timers && line.starts_with("### ") {
            let heading_content = &line[4..];
            if let Some(bracket_pos) = heading_content.rfind('[') {
                let before_bracket = heading_content[..bracket_pos].trim();
                let generated_id = slugify(before_bracket);
                in_target_entry = generated_id == timer_id;
            } else {
                in_target_entry = false;
            }
        }
        if in_target_entry && line.contains("**Status:** pending") {
            *line = line.replace(
                "**Status:** pending",
                &format!("**Status:** {}", new_status),
            );
            break;
        }
    }

    let new_content = lines.join("\n");
    let final_content = ensure_trailing_newline(&new_content);
    let _ = fs::write(&log_path, final_content);
}

// ---------------------------------------------------------------------------
// Shared spawn logic
// ---------------------------------------------------------------------------

pub(crate) fn spawn_timer(
    app: AppHandle,
    id: String,
    fire_time: String,
    title: String,
    body: String,
    timer_type: String,
    task_name: Option<String>,
    sleep_duration: std::time::Duration,
) {
    let app_clone = app.clone();
    let id_for_task = id.clone();
    let title_for_task = title.clone();
    let body_for_task = body.clone();
    let timer_type_for_task = timer_type.clone();
    let task_name_for_task = task_name.clone();

    let handle = tauri::async_runtime::spawn(async move {
        tokio::time::sleep(sleep_duration).await;

        // Open overlay
        crate::commands::window::open_overlay(&app_clone);

        // Emit notification-fired event
        if let Some(window) = app_clone.get_webview_window("overlay") {
            let payload = serde_json::json!({
                "id": id_for_task,
                "timerType": timer_type_for_task,
                "title": title_for_task,
                "body": body_for_task,
                "taskName": task_name_for_task,
            });
            let _ = window.emit("notification-fired", payload);
        }

        // Update log entry status from pending to fired
        {
            let state = app_clone.state::<AppState>();
            let _lock = state.file_lock.lock().unwrap();
            update_timer_log_status(&id_for_task, "fired");
        }

        // Remove from in-memory timers
        let state = app_clone.state::<AppState>();
        state.timers.lock().unwrap().remove(&id_for_task);
    });

    // Store the entry in the HashMap
    let entry = TimerEntry {
        id: id.clone(),
        fire_time,
        title,
        body,
        timer_type,
        task_name,
        handle: Some(handle),
    };
    let state = app.state::<AppState>();
    state.timers.lock().unwrap().insert(id, entry);
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command(rename_all = "camelCase")]
pub fn register_timer(
    app: AppHandle,
    fire_time: String,
    title: String,
    body: String,
    timer_type: String,
    task_name: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    use std::fs;
    let _lock = state.file_lock.lock().unwrap();

    let id = timer_id(&fire_time, &title);

    // Validate fire_time and calculate sleep duration
    let sleep_duration = calculate_sleep_duration(&fire_time)?;

    // Write timer entry to today's log
    let logs_dir = logs_dir();
    fs::create_dir_all(&logs_dir).map_err(|e| format!("Failed to create logs dir: {}", e))?;

    let now = Local::now();
    let date_str = now.format("%Y-%m-%d").to_string();
    let time_str = now.format("%H:%M").to_string();
    let log_path = logs_dir.join(format!("{}.md", date_str));

    let content = read_and_normalize_log(&log_path, &date_str)?;

    let task_str = task_name.as_deref().unwrap_or("\u{2014}");
    let entry = format!(
        "### {} - {} [{}]\n- **Status:** pending\n- **Created:** {}\n- **Task:** {}\n\n",
        fire_time, title, timer_type, time_str, task_str
    );

    // Insert after the # Timers heading
    let new_content = match find_section_byte_offset(&content, "Timers") {
        Some(pos) => {
            let after_heading = content[pos..]
                .find('\n')
                .map(|i| pos + i + 1)
                .unwrap_or(content.len());
            format!(
                "{}{}{}",
                &content[..after_heading],
                entry,
                &content[after_heading..]
            )
        }
        None => format!("{}\n# Timers\n\n{}", content, entry),
    };

    fs::write(&log_path, ensure_trailing_newline(&new_content)).map_err(|e| format!("Failed to write log: {}", e))?;

    // Spawn the timer (also inserts into state.timers)
    spawn_timer(
        app,
        id.clone(),
        fire_time,
        title,
        body,
        timer_type,
        task_name,
        sleep_duration,
    );

    Ok(id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn cancel_timer(
    timer_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut timers = state.timers.lock().unwrap();
    match timers.remove(&timer_id) {
        Some(entry) => {
            if let Some(handle) = entry.handle {
                handle.abort();
            }
            drop(timers); // Release lock before file I/O
            let _lock = state.file_lock.lock().unwrap();
            update_timer_log_status(&timer_id, "cancelled");
            Ok(())
        }
        None => Err(format!("Timer '{}' not found", timer_id)),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_pending_timers(state: tauri::State<'_, AppState>) -> Vec<TimerInfo> {
    let timers = state.timers.lock().unwrap();
    timers
        .values()
        .map(|entry| TimerInfo {
            id: entry.id.clone(),
            fire_time: entry.fire_time.clone(),
            title: entry.title.clone(),
            body: entry.body.clone(),
            timer_type: entry.timer_type.clone(),
            task_name: entry.task_name.clone(),
        })
        .collect()
}
