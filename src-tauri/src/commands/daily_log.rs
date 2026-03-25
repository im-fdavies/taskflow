use crate::helpers::markdown::{find_section_byte_offset, daily_log_skeleton};
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

    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let logs_dir = home.join(".taskflow/logs");
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

    // Insert before "## Completed Work"; fall back to append if section not found.
    let new_content = match find_section_byte_offset(&content, "Completed Work") {
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

    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let logs_dir = home.join(".taskflow/logs");
    fs::create_dir_all(&logs_dir).map_err(|e| format!("Failed to create logs dir: {}", e))?;

    let now = Local::now();
    let date_str = now.format("%Y-%m-%d").to_string();
    let time_str = now.format("%H:%M").to_string();
    let log_path = logs_dir.join(format!("{}.md", date_str));

    let mut content = if log_path.exists() {
        fs::read_to_string(&log_path).map_err(|e| format!("Failed to read log file: {}", e))?
    } else {
        daily_log_skeleton(&date_str)
    };

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

    if !content.ends_with('\n') {
        content.push('\n');
    }
    content.push_str(&entry);

    fs::write(&log_path, content).map_err(|e| format!("Failed to write log file: {}", e))?;

    Ok(())
}
