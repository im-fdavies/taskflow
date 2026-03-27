use crate::helpers::markdown::{find_section_byte_offset, daily_log_skeleton, ensure_log_sections};
use chrono::Local;

#[tauri::command(rename_all = "camelCase")]
pub fn append_daily_log(
    task_name: String,
    task_type: Option<String>,
    exit_capture: String,
    bookmark: Option<String>,
    mode: u8,
    duration_minutes: Option<i64>,
) -> Result<(), String> {
    use std::fs;

    let logs_dir = crate::helpers::config::logs_dir();
    fs::create_dir_all(&logs_dir).map_err(|e| format!("Failed to create logs dir: {}", e))?;

    let now = Local::now();
    let date_str = now.format("%Y-%m-%d").to_string();
    let time_str = now.format("%H:%M").to_string();
    let log_path = logs_dir.join(format!("{}.md", date_str));

    let content = if log_path.exists() {
        fs::read_to_string(&log_path).map_err(|e| format!("Failed to read log file: {}", e))?
    } else {
        daily_log_skeleton(&date_str)
    };

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

    let entry = format!(
        "### {} - {}\n- **Switch:** {}\n- **Task Type:** {}\n- **Duration:** {}\n- **Exit notes:** {}\n- **Bookmark:** {}\n\n",
        time_str, task_name, mode_label, task_type_str, duration_str, exit_str, bookmark_str
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

    fs::write(&log_path, new_content).map_err(|e| format!("Failed to write log file: {}", e))?;

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
) -> Result<(), String> {
    use std::fs;

    let logs_dir = crate::helpers::config::logs_dir();
    fs::create_dir_all(&logs_dir).map_err(|e| format!("Failed to create logs dir: {}", e))?;

    let now = Local::now();
    let date_str = now.format("%Y-%m-%d").to_string();
    let time_str = now.format("%H:%M").to_string();
    let log_path = logs_dir.join(format!("{}.md", date_str));

    let raw_content = if log_path.exists() {
        fs::read_to_string(&log_path).map_err(|e| format!("Failed to read log file: {}", e))?
    } else {
        daily_log_skeleton(&date_str)
    };
    let mut content = ensure_log_sections(&raw_content, &date_str);

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

    let entry = format!(
        "### {} - COMPLETED: {}\n- **Outcome:** {}\n- **Duration:** {}\n- **PRs:** {}\n- **Follow-ups:** {}\n- **Handoff:** {}\n\n",
        time_str, task_name, outcome_str, duration_str, pr_str, follow_str, handoff_str
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

    fs::write(&log_path, content).map_err(|e| format!("Failed to write log file: {}", e))?;

    // Remove from Open Tasks in any log file
    remove_from_open_tasks(&task_name);

    Ok(())
}

fn remove_from_open_tasks(task_name: &str) {
    use std::fs;
    use crate::helpers::markdown::{ensure_log_sections, extract_section};

    let logs_dir = crate::helpers::config::logs_dir();
    let mut files: Vec<std::path::PathBuf> = match std::fs::read_dir(&logs_dir) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().map_or(false, |ext| ext == "md"))
            .collect(),
        Err(_) => return,
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

        // Remove the H3 entry and any content below it until the next H3 or section end
        let mut new_lines: Vec<&str> = Vec::new();
        let mut in_open_tasks = false;
        let mut skipping_entry = false;

        for line in content.lines() {
            if line.starts_with("# ") && !line.starts_with("## ") && !line.starts_with("### ") {
                if line.trim() == "# Open Tasks" {
                    in_open_tasks = true;
                    skipping_entry = false;
                    new_lines.push(line);
                    continue;
                } else {
                    in_open_tasks = false;
                    skipping_entry = false;
                    new_lines.push(line);
                    continue;
                }
            }

            if in_open_tasks && line.starts_with("### ") {
                if line.trim() == target {
                    skipping_entry = true;
                    continue;
                } else {
                    skipping_entry = false;
                }
            }

            if !skipping_entry {
                new_lines.push(line);
            }
        }

        let new_content = new_lines.join("\n");
        let _ = fs::write(&path, new_content);
        return; // Found and removed, done
    }
}
