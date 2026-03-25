use crate::helpers::markdown::{find_section_byte_offset, daily_log_skeleton, ensure_log_sections, extract_section};
use chrono::Local;
use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct PausedTask {
    pub name: String,
    pub bookmark: Option<String>,
    pub exit_notes: Option<String>,
    pub time: String,
}

/// Read tasks that were context-switched away from today (have exit metadata).
/// Used by the "start task" flow to detect if the user is resuming a paused task.
#[tauri::command(rename_all = "camelCase")]
pub fn read_paused_tasks() -> Vec<PausedTask> {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return vec![],
    };
    let date_str = Local::now().format("%Y-%m-%d").to_string();
    let log_path = home.join(".taskflow/logs").join(format!("{}.md", date_str));

    if !log_path.exists() {
        return vec![];
    }

    let content = match std::fs::read_to_string(&log_path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let mut tasks: Vec<PausedTask> = Vec::new();
    let mut current_entry: Option<(String, String)> = None;
    let mut current_bookmark: Option<String> = None;
    let mut current_exit_notes: Option<String> = None;
    let mut has_switch_metadata = false;

    for line in content.lines() {
        if line.starts_with("### ") {
            // Save previous entry if it had switch metadata
            if let Some((time, name)) = current_entry.take() {
                if has_switch_metadata {
                    tasks.push(PausedTask {
                        name,
                        bookmark: current_bookmark.take(),
                        exit_notes: current_exit_notes.take(),
                        time,
                    });
                }
            }
            current_bookmark = None;
            current_exit_notes = None;
            has_switch_metadata = false;

            let rest = &line[4..];
            if let Some(dash_pos) = rest.find(" - ") {
                let time = rest[..dash_pos].trim().to_string();
                let name = rest[dash_pos + 3..].trim().to_string();
                // Skip COMPLETED entries
                if !name.starts_with("COMPLETED:") {
                    current_entry = Some((time, name));
                }
            }
        } else if current_entry.is_some() {
            if line.starts_with("- **Switch:**") {
                has_switch_metadata = true;
            } else if line.starts_with("- **Bookmark:**") {
                let val = line.trim_start_matches("- **Bookmark:**").trim();
                if val != "\u{2014}" && !val.is_empty() {
                    current_bookmark = Some(val.to_string());
                }
            } else if line.starts_with("- **Exit notes:**") {
                let val = line.trim_start_matches("- **Exit notes:**").trim();
                if val != "\u{2014}" && !val.is_empty() {
                    current_exit_notes = Some(val.to_string());
                }
            }
        }
    }

    // Don't forget the last entry
    if let Some((time, name)) = current_entry {
        if has_switch_metadata {
            tasks.push(PausedTask {
                name,
                bookmark: current_bookmark,
                exit_notes: current_exit_notes,
                time,
            });
        }
    }

    tasks
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_daily_todos() -> Vec<String> {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return vec![],
    };
    let date_str = Local::now().format("%Y-%m-%d").to_string();
    let log_path = home.join(".taskflow/logs").join(format!("{}.md", date_str));

    if !log_path.exists() {
        return vec![];
    }

    let raw_content = match std::fs::read_to_string(&log_path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    // Ensure v2 sections exist so extract_section finds ## Todos
    let content = ensure_log_sections(&raw_content, &date_str);

    extract_section(&content, "Todos")
        .lines()
        .filter(|l| l.starts_with("### "))
        .map(|l| l.trim_start_matches("### ").to_string())
        .collect()
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_daily_summary() -> Option<String> {
    let home = dirs::home_dir()?;
    let date_str = Local::now().format("%Y-%m-%d").to_string();
    let log_path = home.join(".taskflow/logs").join(format!("{}.md", date_str));

    if !log_path.exists() {
        return None;
    }

    let content = std::fs::read_to_string(&log_path).ok()?;
    let section = extract_section(&content, "Summary");
    if section.is_empty() { None } else { Some(section) }
}

#[tauri::command(rename_all = "camelCase")]
pub fn append_todo_entry(task_name: String) -> Result<(), String> {
    use std::fs;

    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let logs_dir = home.join(".taskflow/logs");
    fs::create_dir_all(&logs_dir).map_err(|e| format!("Failed to create logs dir: {}", e))?;

    let now = Local::now();
    let date_str = now.format("%Y-%m-%d").to_string();
    let time_str = now.format("%H:%M").to_string();
    let log_path = logs_dir.join(format!("{}.md", date_str));

    let raw_content = if log_path.exists() {
        fs::read_to_string(&log_path).map_err(|e| format!("Failed to read log: {}", e))?
    } else {
        daily_log_skeleton(&date_str)
    };

    // Ensure v2 sections exist (handles legacy log files)
    let content = ensure_log_sections(&raw_content, &date_str);

    let entry = format!("### {} - {}\n\n", time_str, task_name);

    // Insert before ## Completed Work (which is right after ## Todos section)
    let new_content = match find_section_byte_offset(&content, "Completed Work") {
        Some(pos) => format!("{}{}{}", &content[..pos], entry, &content[pos..]),
        None => format!("{}{}", content, entry),
    };

    fs::write(&log_path, new_content).map_err(|e| format!("Failed to write log: {}", e))?;

    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn update_todo_entry(old_name: String, new_name: String) -> Result<(), String> {
    use std::fs;

    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let date_str = Local::now().format("%Y-%m-%d").to_string();
    let log_path = home.join(".taskflow/logs").join(format!("{}.md", date_str));

    if !log_path.exists() {
        return Err("Log file not found".to_string());
    }

    let content = fs::read_to_string(&log_path)
        .map_err(|e| format!("Failed to read log: {}", e))?;

    // Find the line containing the old todo name and replace it
    let old_suffix = format!(" - {}", old_name);
    let new_suffix = format!(" - {}", new_name);
    let new_content = content.lines()
        .map(|line| {
            if line.starts_with("### ") && line.ends_with(&old_suffix) {
                line.replace(&old_suffix, &new_suffix)
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n");

    fs::write(&log_path, new_content).map_err(|e| format!("Failed to write log: {}", e))?;

    Ok(())
}

/// Move a todo from ## Todos to ## Completed Work
#[tauri::command(rename_all = "camelCase")]
pub fn complete_todo_entry(todo_text: String) -> Result<(), String> {
    use std::fs;

    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let now = Local::now();
    let date_str = now.format("%Y-%m-%d").to_string();
    let time_str = now.format("%H:%M").to_string();
    let log_path = home.join(".taskflow/logs").join(format!("{}.md", date_str));

    if !log_path.exists() {
        return Err("Log file not found".to_string());
    }

    let raw_content = fs::read_to_string(&log_path)
        .map_err(|e| format!("Failed to read log: {}", e))?;
    let content = ensure_log_sections(&raw_content, &date_str);

    // Find and remove the matching ### line from Todos
    let search = format!(" - {}", todo_text);
    let mut removed_line: Option<String> = None;
    let lines: Vec<String> = content.lines()
        .filter(|line| {
            if removed_line.is_none() && line.starts_with("### ") && line.ends_with(&search) {
                removed_line = Some(line.to_string());
                false
            } else {
                true
            }
        })
        .map(|l| l.to_string())
        .collect();

    if removed_line.is_none() {
        return Err("Todo not found".to_string());
    }

    let mut new_content = lines.join("\n");

    // Add completion entry
    let completion = format!("\n### {} - COMPLETED: {}\n", time_str, todo_text);
    match find_section_byte_offset(&new_content, "Completed Work") {
        Some(pos) => {
            // Find end of the "## Completed Work" heading line
            let after_heading = new_content[pos..].find('\n').map(|i| pos + i + 1).unwrap_or(new_content.len());
            new_content.insert_str(after_heading, &completion);
        }
        None => new_content.push_str(&completion),
    }

    fs::write(&log_path, new_content).map_err(|e| format!("Failed to write log: {}", e))?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_completed_todos() -> Vec<String> {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return vec![],
    };
    let date_str = Local::now().format("%Y-%m-%d").to_string();
    let log_path = home.join(".taskflow/logs").join(format!("{}.md", date_str));

    if !log_path.exists() {
        return vec![];
    }

    let raw_content = match std::fs::read_to_string(&log_path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let content = ensure_log_sections(&raw_content, &date_str);

    extract_section(&content, "Completed Work")
        .lines()
        .filter_map(|l| {
            if l.starts_with("### ") {
                if let Some(pos) = l.find("COMPLETED:") {
                    let name = l[pos + "COMPLETED:".len()..].trim();
                    if !name.is_empty() {
                        return Some(name.to_string());
                    }
                }
            }
            None
        })
        .collect()
}

/// Remove a todo entirely from the log
#[tauri::command(rename_all = "camelCase")]
pub fn discard_todo_entry(todo_text: String) -> Result<(), String> {
    use std::fs;

    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let date_str = Local::now().format("%Y-%m-%d").to_string();
    let log_path = home.join(".taskflow/logs").join(format!("{}.md", date_str));

    if !log_path.exists() {
        return Err("Log file not found".to_string());
    }

    let raw_content = fs::read_to_string(&log_path)
        .map_err(|e| format!("Failed to read log: {}", e))?;
    let content = ensure_log_sections(&raw_content, &date_str);

    let search = format!(" - {}", todo_text);
    let new_content = content.lines()
        .filter(|line| !(line.starts_with("### ") && line.ends_with(&search)))
        .collect::<Vec<_>>()
        .join("\n");

    fs::write(&log_path, new_content).map_err(|e| format!("Failed to write log: {}", e))?;
    Ok(())
}
