use crate::helpers::markdown::{find_section_byte_offset, extract_section, ensure_trailing_newline, read_and_normalize_log};
use crate::state::AppState;
use chrono::Local;

#[tauri::command(rename_all = "camelCase")]
pub fn append_daily_log(
    task_name: String,
    task_type: Option<String>,
    exit_capture: String,
    bookmark: Option<String>,
    mode: u8,
    duration_minutes: Option<i64>,
    lesson: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    use std::fs;
    let _lock = state.file_lock.lock().unwrap();

    let logs_dir = crate::helpers::config::logs_dir();
    fs::create_dir_all(&logs_dir).map_err(|e| format!("Failed to create logs dir: {}", e))?;

    let now = Local::now();
    let date_str = now.format("%Y-%m-%d").to_string();
    let time_str = now.format("%H:%M").to_string();
    let log_path = logs_dir.join(format!("{}.md", date_str));

    let content = read_and_normalize_log(&log_path, &date_str)?;

    let mode_label = match mode {
        1 => "Full",
        2 => "Light",
        3 => "Urgent",
        _ => "Unknown",
    };

    let duration_str = match duration_minutes {
        Some(d) if d > 0 => {
            let h = d / 60;
            let m = d % 60;
            if h > 0 { format!("{}h {}m", h, m) } else { format!("{}m", m) }
        }
        _ => "\u{2014}".to_string(),
    };

    let task_type_str = task_type.as_deref().unwrap_or("None");
    let bookmark_str = bookmark.as_deref().unwrap_or("\u{2014}");
    let exit_str = if exit_capture.is_empty() { "\u{2014}" } else { &exit_capture };

    let lesson_line = match lesson.as_deref() {
        Some(l) if !l.is_empty() => format!("- **Lesson:** {}\n", l),
        _ => String::new(),
    };

    let entry = format!(
        "### {} - {}\n- **Switch:** {}\n- **Task Type:** {}\n- **Duration:** {}\n- **Exit notes:** {}\n- **Bookmark:** {}\n{}\n",
        time_str, task_name, mode_label, task_type_str, duration_str, exit_str, bookmark_str, lesson_line
    );

    // Insert before "## Open Tasks" so entries live in the Summary section,
    // not inside Open Tasks or Todos (which would contaminate those sections).
    // Fall back to before "## Todos", then "## Completed Work", then append.
    let insert_pos = find_section_byte_offset(&content, "Open Tasks")
        .or_else(|| find_section_byte_offset(&content, "Todos"))
        .or_else(|| find_section_byte_offset(&content, "Completed Work"));
    let new_content = match insert_pos {
        Some(pos) => format!("{}{}{}", &content[..pos], entry, &content[pos..]),
        None => format!("{}{}", content, entry),
    };

    fs::write(&log_path, ensure_trailing_newline(&new_content)).map_err(|e| format!("Failed to write log file: {}", e))?;

    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn append_completion_log(
    task_name: String,
    outcome: String,
    pr_links: Option<String>,
    follow_ups: Option<String>,
    handoff_notes: Option<String>,
    duration_minutes: Option<i64>,
    lesson: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    use std::fs;
    let _lock = state.file_lock.lock().unwrap();

    let logs_dir = crate::helpers::config::logs_dir();
    fs::create_dir_all(&logs_dir).map_err(|e| format!("Failed to create logs dir: {}", e))?;

    let now = Local::now();
    let date_str = now.format("%Y-%m-%d").to_string();
    let time_str = now.format("%H:%M").to_string();
    let log_path = logs_dir.join(format!("{}.md", date_str));

    let mut content = read_and_normalize_log(&log_path, &date_str)?;

    let duration_str = match duration_minutes {
        Some(d) if d > 0 => {
            let h = d / 60;
            let m = d % 60;
            if h > 0 { format!("{}h {}m", h, m) } else { format!("{}m", m) }
        }
        _ => "\u{2014}".to_string(),
    };

    let outcome_str = if outcome.is_empty() { "\u{2014}" } else { &outcome };
    let pr_str = pr_links.as_deref().unwrap_or("\u{2014}");
    let follow_str = follow_ups.as_deref().unwrap_or("\u{2014}");
    let handoff_str = handoff_notes.as_deref().unwrap_or("\u{2014}");

    // Remove from Open Tasks first to capture notes before writing completion entry
    let captured_notes = remove_from_open_tasks(&task_name);

    let notes_section = if captured_notes.is_empty() {
        String::new()
    } else {
        let indented: Vec<String> = captured_notes
            .lines()
            .map(|l| format!("  {}", l))
            .collect();
        format!("- **Notes:**\n{}\n", indented.join("\n"))
    };

    let lesson_line = match lesson.as_deref() {
        Some(l) if !l.is_empty() => format!("- **Lesson:** {}\n", l),
        _ => String::new(),
    };

    let entry = format!(
        "### {} - COMPLETED: {}\n- **Outcome:** {}\n- **Duration:** {}\n- **PRs:** {}\n- **Follow-ups:** {}\n- **Handoff:** {}\n{}{}\n",
        time_str, task_name, outcome_str, duration_str, pr_str, follow_str, handoff_str, notes_section, lesson_line
    );

    match find_section_byte_offset(&content, "Completed Work") {
        Some(pos) => {
            let after_heading = content[pos..].find('\n').map(|i| pos + i + 1).unwrap_or(content.len());
            content.insert_str(after_heading, &entry);
        }
        None => {
            if !content.ends_with('\n') {
                content.push('\n');
            }
            content.push_str(&entry);
        }
    }

    fs::write(&log_path, ensure_trailing_newline(&content)).map_err(|e| format!("Failed to write log file: {}", e))?;

    Ok(())
}

fn remove_from_open_tasks(task_name: &str) -> String {
    use std::fs;
    use crate::helpers::markdown::{ensure_log_sections, extract_section, ensure_trailing_newline};

    let logs_dir = crate::helpers::config::logs_dir();
    let mut files: Vec<std::path::PathBuf> = match std::fs::read_dir(&logs_dir) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().map_or(false, |ext| ext == "md"))
            .collect(),
        Err(_) => return String::new(),
    };
    files.sort_by(|a, b| b.cmp(a));

    let target = format!("### {}", task_name);

    for path in files {
        let raw = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let date_str = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
        let content = ensure_log_sections(&raw, &date_str);

        // Check if this task is in Open Tasks for this file
        let open_section = extract_section(&content, "Open Tasks");
        if !open_section.lines().any(|l| l.trim() == target) {
            continue;
        }

        // Remove the H3 entry and any content below it until the next H3 or section end.
        // Blank lines are buffered so section spacing is preserved after removal.
        let mut new_lines: Vec<&str> = Vec::new();
        let mut captured_lines: Vec<&str> = Vec::new();
        let mut in_open_tasks = false;
        let mut skipping_entry = false;
        let mut pending_blanks: Vec<&str> = Vec::new();

        for line in content.lines() {
            if line.trim().is_empty() {
                pending_blanks.push(line);
                continue;
            }

            if line.starts_with("# ") && !line.starts_with("## ") && !line.starts_with("### ") {
                new_lines.extend(pending_blanks.drain(..));
                in_open_tasks = line.trim() == "# Open Tasks";
                skipping_entry = false;
                new_lines.push(line);
                continue;
            }

            if in_open_tasks && line.starts_with("### ") {
                if line.trim() == target {
                    new_lines.extend(pending_blanks.drain(..));
                    skipping_entry = true;
                    continue;
                } else {
                    new_lines.extend(pending_blanks.drain(..));
                    skipping_entry = false;
                }
            }

            if skipping_entry {
                captured_lines.extend(pending_blanks.drain(..));
                captured_lines.push(line);
            } else {
                new_lines.extend(pending_blanks.drain(..));
                new_lines.push(line);
            }
        }

        new_lines.extend(pending_blanks.drain(..));

        let new_content = ensure_trailing_newline(&new_lines.join("\n"));
        let _ = fs::write(&path, new_content);
        return captured_lines.join("\n").trim().to_string();
    }
    String::new()
}

#[tauri::command(rename_all = "camelCase")]
pub fn append_note(note_text: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    use std::fs;
    let _lock = state.file_lock.lock().unwrap();

    let logs_dir = crate::helpers::config::logs_dir();
    fs::create_dir_all(&logs_dir).map_err(|e| format!("Failed to create logs dir: {}", e))?;

    let now = Local::now();
    let date_str = now.format("%Y-%m-%d").to_string();
    let time_str = now.format("%H:%M").to_string();
    let log_path = logs_dir.join(format!("{}.md", date_str));

    let content = read_and_normalize_log(&log_path, &date_str)?;

    let entry = format!("- \u{1F4DD} {} \u{2014} {}\n", time_str, note_text);

    let active_task = crate::commands::todos::read_active_task_internal();
    let new_content = if let Some(task) = active_task {
        // Insert note under the active task's H3 entry in Open Tasks
        let open_section = extract_section(&content, "Open Tasks");
        let target = format!("### {}", task.name);

        if open_section.lines().any(|l| l.trim() == target) {
            insert_note_under_task(&content, &task.name, &entry)
        } else {
            // Active task not in Open Tasks — fall back to Summary
            insert_note_in_summary(&content, &entry)
        }
    } else {
        // No active task — insert into Summary
        insert_note_in_summary(&content, &entry)
    };

    fs::write(&log_path, ensure_trailing_newline(&new_content)).map_err(|e| format!("Failed to write log: {}", e))?;
    Ok(())
}

/// Insert a note line under a task's H3 heading in Open Tasks,
/// after its metadata lines but before the next ### or section boundary.
fn insert_note_under_task(content: &str, task_name: &str, entry: &str) -> String {
    let target = format!("### {}", task_name);
    let mut lines: Vec<&str> = content.lines().collect();
    let mut in_open_tasks = false;
    let mut insert_idx: Option<usize> = None;

    for (i, line) in lines.iter().enumerate() {
        // Track whether we're inside the Open Tasks section
        if line.starts_with("# ") && !line.starts_with("## ") && !line.starts_with("### ") {
            in_open_tasks = line.trim() == "# Open Tasks";
        }

        if in_open_tasks && line.trim() == target {
            // Found the task heading — scan forward past metadata lines
            let mut j = i + 1;
            while j < lines.len() {
                let next = lines[j];
                // Stop at next H3, next H1 section, or blank line after metadata
                if next.starts_with("### ") {
                    break;
                }
                if next.starts_with("# ") && !next.starts_with("## ") && !next.starts_with("### ") {
                    break;
                }
                if next.trim().is_empty() {
                    // Insert before the blank line (keep spacing)
                    break;
                }
                j += 1;
            }
            insert_idx = Some(j);
            break;
        }
    }

    match insert_idx {
        Some(idx) => {
            // Insert the entry line(s) at the found position
            let entry_trimmed = entry.trim_end_matches('\n');
            lines.insert(idx, entry_trimmed);
            ensure_trailing_newline(&lines.join("\n"))
        }
        None => {
            // Shouldn't happen, but fall back to summary
            insert_note_in_summary(content, entry)
        }
    }
}

/// Insert a note line at the end of the Summary section (before # Open Tasks).
fn insert_note_in_summary(content: &str, entry: &str) -> String {
    match find_section_byte_offset(content, "Open Tasks") {
        Some(pos) => {
            let before = content[..pos].trim_end();
            format!("{}\n{}\n{}", before, entry, &content[pos..])
        }
        None => format!("{}\n{}", content, entry),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn append_task_note(task_name: String, note_text: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    use std::fs;
    let _lock = state.file_lock.lock().unwrap();

    let logs_dir = crate::helpers::config::logs_dir();
    fs::create_dir_all(&logs_dir).map_err(|e| format!("Failed to create logs dir: {}", e))?;

    let now = Local::now();
    let time_str = now.format("%H:%M").to_string();
    let entry = format!("- \u{1F4DD} {} \u{2014} {}\n", time_str, note_text);

    // Scan all log files (most-recent-first) to find the task in Open Tasks
    let mut files: Vec<std::path::PathBuf> = match std::fs::read_dir(&logs_dir) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().map_or(false, |ext| ext == "md"))
            .collect(),
        Err(_) => return Err("Could not read logs directory".to_string()),
    };
    files.sort_by(|a, b| b.cmp(a));

    for path in &files {
        let date_str = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
        let content = match read_and_normalize_log(path, &date_str) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let open_section = extract_section(&content, "Open Tasks");
        let target = format!("### {}", task_name);

        if open_section.lines().any(|l| l.trim() == target) {
            let new_content = insert_note_under_task(&content, &task_name, &entry);
            fs::write(path, ensure_trailing_newline(&new_content)).map_err(|e| format!("Failed to write log: {}", e))?;
            return Ok(());
        }
    }

    // Task not found in Open Tasks — create its heading in today's log and add the note
    let date_str = now.format("%Y-%m-%d").to_string();
    let log_path = logs_dir.join(format!("{}.md", date_str));

    let content = read_and_normalize_log(&log_path, &date_str)?;
    let task_heading = format!("### {}\n{}", task_name, entry);
    let new_content = match find_section_byte_offset(&content, "Open Tasks") {
        Some(pos) => {
            let after_heading = content[pos..].find('\n').map(|i| pos + i + 1).unwrap_or(content.len());
            format!("{}{}\n{}", &content[..after_heading], task_heading, &content[after_heading..])
        }
        None => format!("{}\n{}", content, task_heading),
    };

    fs::write(&log_path, ensure_trailing_newline(&new_content)).map_err(|e| format!("Failed to write log: {}", e))?;
    Ok(())
}
