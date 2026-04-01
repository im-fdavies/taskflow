use crate::helpers::markdown::{find_section_byte_offset, daily_log_skeleton, ensure_log_sections, extract_section, ensure_trailing_newline, read_and_normalize_log};
use crate::state::AppState;
use chrono::Local;
use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct PausedTask {
    pub name: String,
    pub bookmark: Option<String>,
    pub exit_notes: Option<String>,
    pub time: String,
}

#[derive(Serialize, Clone)]
pub struct OpenTask {
    pub name: String,
    pub notes: String,
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

fn all_log_files() -> Vec<std::path::PathBuf> {
    let logs_dir = crate::helpers::config::logs_dir();
    let mut files: Vec<std::path::PathBuf> = match std::fs::read_dir(&logs_dir) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| {
                p.extension().map_or(false, |ext| ext == "md")
                    && p.file_stem()
                        .and_then(|s| s.to_str())
                        .map_or(false, |s| {
                            s.len() == 10
                                && s.as_bytes().get(4) == Some(&b'-')
                                && s.as_bytes().get(7) == Some(&b'-')
                        })
            })
            .collect(),
        Err(_) => return vec![],
    };
    files.sort_by(|a, b| b.cmp(a)); // newest first
    files
}

fn all_completed_names() -> std::collections::HashSet<String> {
    let mut completed = std::collections::HashSet::new();
    for path in all_log_files() {
        if let Ok(content) = std::fs::read_to_string(&path) {
            let section = extract_section(&content, "Completed Work");
            for line in section.lines() {
                if line.starts_with("### ") {
                    if let Some(pos) = line.find("COMPLETED:") {
                        let name = line[pos + "COMPLETED:".len()..].trim();
                        if !name.is_empty() {
                            completed.insert(name.to_string());
                        }
                    }
                }
            }
        }
    }
    completed
}

// ---------------------------------------------------------------------------
// Block-aware entry removal
// ---------------------------------------------------------------------------

/// Remove an H3 entry block (heading + metadata/notes) from the # Todos section,
/// preserving blank lines between sections.
fn remove_todo_block(content: &str, todo_text: &str) -> String {
    let search = format!(" - {}", todo_text);
    let bracket_pattern = format!("{} [", todo_text);
    let is_target = |line: &str| -> bool {
        line.starts_with("### ")
            && (line.ends_with(&search) || line.contains(&bracket_pattern))
    };

    let mut new_lines: Vec<&str> = Vec::new();
    let mut in_todos = false;
    let mut skipping_entry = false;
    let mut pending_blanks: Vec<&str> = Vec::new();

    for line in content.lines() {
        if line.trim().is_empty() {
            pending_blanks.push(line);
            continue;
        }

        if line.starts_with("# ") && !line.starts_with("## ") && !line.starts_with("### ") {
            new_lines.extend(pending_blanks.drain(..));
            in_todos = line.trim() == "# Todos";
            skipping_entry = false;
            new_lines.push(line);
            continue;
        }

        if in_todos && line.starts_with("### ") {
            if is_target(line) {
                new_lines.extend(pending_blanks.drain(..));
                skipping_entry = true;
                continue;
            } else {
                new_lines.extend(pending_blanks.drain(..));
                skipping_entry = false;
            }
        }

        if skipping_entry {
            pending_blanks.clear();
        } else {
            new_lines.extend(pending_blanks.drain(..));
            new_lines.push(line);
        }
    }

    new_lines.extend(pending_blanks.drain(..));
    new_lines.join("\n")
}

// ---------------------------------------------------------------------------
// Open Tasks helpers
// ---------------------------------------------------------------------------

/// Internal version — usable from lib.rs setup without Tauri command machinery.
pub fn read_open_tasks_internal() -> Vec<OpenTask> {
    let completed = all_completed_names();
    let mut tasks: Vec<OpenTask> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for path in all_log_files() {
        let raw = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let date_str = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
        let content = ensure_log_sections(&raw, &date_str);
        let section = extract_section(&content, "Open Tasks");

        let mut current_name: Option<String> = None;
        let mut current_notes: Vec<String> = Vec::new();

        for line in section.lines() {
            if line.starts_with("### ") {
                // Save previous entry
                if let Some(name) = current_name.take() {
                    if !completed.contains(&name) && !seen.contains(&name)
                        && !name.is_empty() && name != "Unknown task" && !name.trim().is_empty()
                    {
                        seen.insert(name.clone());
                        tasks.push(OpenTask {
                            name,
                            notes: current_notes.join("\n").trim().to_string(),
                        });
                    }
                    current_notes.clear();
                }
                current_name = Some(line[4..].trim().to_string());
            } else if current_name.is_some() && !line.trim().is_empty() {
                current_notes.push(line.to_string());
            }
        }
        // Last entry in section
        if let Some(name) = current_name {
            if !completed.contains(&name) && !seen.contains(&name)
                && !name.is_empty() && name != "Unknown task" && !name.trim().is_empty()
            {
                seen.insert(name.clone());
                tasks.push(OpenTask {
                    name,
                    notes: current_notes.join("\n").trim().to_string(),
                });
            }
        }
    }

    tasks
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_open_tasks() -> Vec<OpenTask> {
    read_open_tasks_internal()
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command(rename_all = "camelCase")]
pub fn read_paused_tasks() -> Vec<PausedTask> {
    let completed = all_completed_names();
    let all_files = all_log_files();

    // Pass 1: collect all names that were started/resumed (entry WITHOUT Switch metadata)
    let mut started_names: std::collections::HashSet<String> = std::collections::HashSet::new();
    for path in &all_files {
        let content = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let summary = extract_section(&content, "Summary");
        let mut current_name: Option<String> = None;
        let mut has_switch = false;
        for line in summary.lines() {
            if line.starts_with("### ") {
                if let Some(name) = current_name.take() {
                    if !has_switch {
                        started_names.insert(name);
                    }
                }
                has_switch = false;
                let rest = &line[4..];
                if let Some(dash_pos) = rest.find(" - ") {
                    let name = rest[dash_pos + 3..].trim().to_string();
                    if !name.starts_with("COMPLETED:") {
                        current_name = Some(name);
                    }
                }
            } else if line.trim_start().starts_with("- **Switch:**") {
                has_switch = true;
            }
        }
        if let Some(name) = current_name {
            if !has_switch {
                started_names.insert(name);
            }
        }
    }

    // Pass 2: collect switch entries not in started_names or completed
    let mut paused: Vec<PausedTask> = Vec::new();
    let mut seen_paused: std::collections::HashSet<String> = std::collections::HashSet::new();
    for path in &all_files {
        let content = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let summary = extract_section(&content, "Summary");
        let mut current_name: Option<(String, String)> = None;
        let mut has_switch = false;
        let mut current_bookmark: Option<String> = None;
        let mut current_exit: Option<String> = None;

        for line in summary.lines() {
            if line.starts_with("### ") {
                if let Some((time, name)) = current_name.take() {
                    if has_switch
                        && !completed.contains(&name)
                        && !started_names.contains(&name)
                        && !seen_paused.contains(&name)
                    {
                        seen_paused.insert(name.clone());
                        paused.push(PausedTask {
                            name,
                            bookmark: current_bookmark.take(),
                            exit_notes: current_exit.take(),
                            time,
                        });
                    }
                }
                has_switch = false;
                current_bookmark = None;
                current_exit = None;

                let rest = &line[4..];
                if let Some(dash_pos) = rest.find(" - ") {
                    let time = rest[..dash_pos].trim().to_string();
                    let name = rest[dash_pos + 3..].trim().to_string();
                    if !name.starts_with("COMPLETED:") {
                        current_name = Some((time, name));
                    }
                }
            } else if current_name.is_some() {
                let trimmed = line.trim_start();
                if trimmed.starts_with("- **Switch:**") {
                    has_switch = true;
                } else if trimmed.starts_with("- **Bookmark:**") {
                    let val = trimmed.trim_start_matches("- **Bookmark:**").trim();
                    if val != "\u{2014}" && !val.is_empty() {
                        current_bookmark = Some(val.to_string());
                    }
                } else if trimmed.starts_with("- **Exit notes:**") {
                    let val = trimmed.trim_start_matches("- **Exit notes:**").trim();
                    if val != "\u{2014}" && !val.is_empty() {
                        current_exit = Some(val.to_string());
                    }
                }
            }
        }
        // Handle last entry in file
        if let Some((time, name)) = current_name {
            if has_switch
                && !completed.contains(&name)
                && !started_names.contains(&name)
                && !seen_paused.contains(&name)
            {
                seen_paused.insert(name.clone());
                paused.push(PausedTask {
                    name,
                    bookmark: current_bookmark,
                    exit_notes: current_exit,
                    time,
                });
            }
        }
    }

    paused
}

#[derive(Serialize, Clone)]
pub struct TodoItem {
    pub time: String,
    pub name: String,
    pub priority: Option<String>,
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_daily_todos() -> Vec<TodoItem> {
    let completed = all_completed_names();
    let mut todos: Vec<TodoItem> = Vec::new();
    let mut seen_names: std::collections::HashSet<String> = std::collections::HashSet::new();

    for path in all_log_files() {
        let raw_content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let date_str = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        let content = ensure_log_sections(&raw_content, &date_str);
        let section = extract_section(&content, "Todos");

        let file_todos: Vec<TodoItem> = section
            .lines()
            .filter_map(|l| {
                if !l.starts_with("### ") {
                    return None;
                }
                let rest = l.trim_start_matches("### ");
                let (time, remainder) = rest.split_once(" - ")?;
                let (name, priority) = if let Some(bracket_start) = remainder.rfind(" [") {
                    if remainder.ends_with(']') {
                        let prio = &remainder[bracket_start + 2..remainder.len() - 1];
                        (&remainder[..bracket_start], Some(prio.to_string()))
                    } else {
                        (remainder, None)
                    }
                } else {
                    (remainder, None)
                };

                if completed.contains(name) || seen_names.contains(name) {
                    return None;
                }

                Some(TodoItem {
                    time: time.to_string(),
                    name: name.to_string(),
                    priority,
                })
            })
            .collect();

        for todo in &file_todos {
            seen_names.insert(todo.name.clone());
        }
        todos.extend(file_todos);
    }

    todos
}

/// Internal version — usable from lib.rs setup without Tauri command machinery.
pub fn read_active_task_internal() -> Option<PausedTask> {
    let open_tasks = read_open_tasks_internal();
    let paused_names: std::collections::HashSet<String> = read_paused_tasks()
        .into_iter()
        .map(|p| p.name)
        .collect();
    // The first non-paused open task (from newest file) is the active one
    open_tasks.into_iter()
        .find(|t| !paused_names.contains(&t.name))
        .map(|t| PausedTask {
            name: t.name,
            bookmark: None,
            exit_notes: None,
            time: String::new(),
        })
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_active_task() -> Option<PausedTask> {
    read_active_task_internal()
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_daily_summary() -> Option<String> {
    let date_str = Local::now().format("%Y-%m-%d").to_string();
    let log_path = crate::helpers::config::logs_dir().join(format!("{}.md", date_str));

    if !log_path.exists() {
        return None;
    }

    let content = std::fs::read_to_string(&log_path).ok()?;
    let section = extract_section(&content, "Summary");
    if section.is_empty() { None } else { Some(section) }
}

#[tauri::command(rename_all = "camelCase")]
pub fn append_todo_entry(task_name: String, priority: Option<String>, state: tauri::State<'_, AppState>) -> Result<(), String> {
    use std::fs;
    let _lock = state.file_lock.lock().unwrap();

    let logs_dir = crate::helpers::config::logs_dir();
    fs::create_dir_all(&logs_dir).map_err(|e| format!("Failed to create logs dir: {}", e))?;

    let now = Local::now();
    let date_str = now.format("%Y-%m-%d").to_string();
    let time_str = now.format("%H:%M").to_string();
    let log_path = logs_dir.join(format!("{}.md", date_str));

    // Ensure v2 sections exist (handles legacy log files)
    let content = read_and_normalize_log(&log_path, &date_str)?;

    let entry = match priority.as_deref() {
        Some(p) if !p.is_empty() => format!("### {} - {} [{}]\n\n", time_str, task_name, p),
        _ => format!("### {} - {}\n\n", time_str, task_name),
    };

    // Insert before ## Timers (which is the next section after ## Todos)
    let new_content = match find_section_byte_offset(&content, "Timers") {
        Some(pos) => {
            let before = content[..pos].trim_end();
            format!("{}\n\n{}{}", before, entry, &content[pos..])
        }
        None => format!("{}{}", content, entry),
    };

    fs::write(&log_path, ensure_trailing_newline(&new_content)).map_err(|e| format!("Failed to write log: {}", e))?;

    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn update_todo_entry(old_name: String, new_name: String, priority: Option<String>, state: tauri::State<'_, AppState>) -> Result<(), String> {
    use std::fs;
    let _lock = state.file_lock.lock().unwrap();

    let old_suffix = format!(" - {}", old_name);
    let new_name_str = match priority.as_deref() {
        Some(p) if !p.is_empty() => format!("{} [{}]", new_name, p),
        _ => new_name.clone(),
    };
    let new_suffix = format!(" - {}", new_name_str);

    for path in all_log_files() {
        let date_str = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
        let content = match read_and_normalize_log(&path, &date_str) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let found = content.lines().any(|line| {
            line.starts_with("### ")
                && (line.ends_with(&old_suffix) || line.contains(&format!("{} [", old_name)))
        });

        if found {
            let new_content = content
                .lines()
                .map(|line| {
                    if line.starts_with("### ")
                        && (line.ends_with(&old_suffix)
                            || line.contains(&format!("{} [", old_name)))
                    {
                        if let Some(dash_pos) = line[4..].find(" - ") {
                            format!("{}{}", &line[..4 + dash_pos], new_suffix)
                        } else {
                            line.replace(&old_suffix, &new_suffix)
                        }
                    } else {
                        line.to_string()
                    }
                })
                .collect::<Vec<_>>()
                .join("\n");
            let new_content = ensure_trailing_newline(&new_content);
            fs::write(&path, new_content).map_err(|e| format!("Failed to write log: {}", e))?;
            return Ok(());
        }
    }

    Err(format!("Todo '{}' not found in any log file", old_name))
}

/// Move a todo from ## Todos to ## Completed Work
#[tauri::command(rename_all = "camelCase")]
pub fn complete_todo_entry(todo_text: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    use std::fs;
    let _lock = state.file_lock.lock().unwrap();

    let now = Local::now();
    let time_str = now.format("%H:%M").to_string();
    let search = format!(" - {}", todo_text);

    for path in all_log_files() {
        let date_str = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
        let content = match read_and_normalize_log(&path, &date_str) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let found = content.lines().any(|line| {
            line.starts_with("### ")
                && (line.ends_with(&search) || line.contains(&format!("{} [", todo_text)))
        });

        if found {
            // Remove entry block from source file
            let new_content = ensure_trailing_newline(&remove_todo_block(&content, &todo_text));
            fs::write(&path, &new_content)
                .map_err(|e| format!("Failed to write log: {}", e))?;

            // Add COMPLETED entry to today's log
            let today_date = now.format("%Y-%m-%d").to_string();
            let logs_dir = crate::helpers::config::logs_dir();
            let today_path = logs_dir.join(format!("{}.md", today_date));

            let today_raw = if today_path.exists() {
                fs::read_to_string(&today_path).unwrap_or_default()
            } else {
                fs::create_dir_all(&logs_dir).ok();
                daily_log_skeleton(&today_date)
            };
            let mut today_content = ensure_log_sections(&today_raw, &today_date);

            let entry = format!("\n### {} - COMPLETED: {}\n", time_str, todo_text);
            match find_section_byte_offset(&today_content, "Completed Work") {
                Some(pos) => {
                    let after_heading = today_content[pos..]
                        .find('\n')
                        .map(|i| pos + i + 1)
                        .unwrap_or(today_content.len());
                    today_content.insert_str(after_heading, &entry);
                }
                None => today_content.push_str(&entry),
            }
            fs::write(&today_path, ensure_trailing_newline(&today_content))
                .map_err(|e| format!("Failed to write today's log: {}", e))?;

            return Ok(());
        }
    }

    Err(format!("Todo '{}' not found in any log file", todo_text))
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_completed_todos() -> Vec<String> {
    let date_str = Local::now().format("%Y-%m-%d").to_string();
    let log_path = crate::helpers::config::logs_dir().join(format!("{}.md", date_str));

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
pub fn discard_todo_entry(todo_text: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    use std::fs;
    let _lock = state.file_lock.lock().unwrap();

    let search = format!(" - {}", todo_text);

    for path in all_log_files() {
        let date_str = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
        let content = match read_and_normalize_log(&path, &date_str) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let found = content.lines().any(|line| {
            line.starts_with("### ")
                && (line.ends_with(&search) || line.contains(&format!("{} [", todo_text)))
        });

        if found {
            let new_content = ensure_trailing_newline(&remove_todo_block(&content, &todo_text));
            fs::write(&path, new_content)
                .map_err(|e| format!("Failed to write log: {}", e))?;
            return Ok(());
        }
    }

    Err(format!("Todo '{}' not found in any log file", todo_text))
}
