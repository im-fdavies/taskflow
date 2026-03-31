use chrono::Local;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LessonResult {
    pub lesson: String,
    pub from_task: String,
    pub from_date: String,
}

/// Search recent daily logs (last 30 days) for lessons from similar tasks.
/// Returns the most recent lesson found, or None.
#[tauri::command(rename_all = "camelCase")]
pub fn search_past_lessons(
    task_name: String,
    template_name: Option<String>,
) -> Option<LessonResult> {
    use std::fs;

    let logs_dir = crate::helpers::config::logs_dir();
    let entries = match fs::read_dir(&logs_dir) {
        Ok(e) => e,
        Err(_) => return None,
    };

    let today = Local::now().date_naive();
    let cutoff = today - chrono::Duration::days(30);

    // Collect and filter log files from the last 30 days
    let mut files: Vec<(String, std::path::PathBuf)> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let path = e.path();
            let stem = path.file_stem()?.to_str()?.to_string();
            if path.extension().map_or(true, |ext| ext != "md") {
                return None;
            }
            let date = chrono::NaiveDate::parse_from_str(&stem, "%Y-%m-%d").ok()?;
            if date >= cutoff && date <= today {
                Some((stem, path))
            } else {
                None
            }
        })
        .collect();

    // Sort most-recent first
    files.sort_by(|a, b| b.0.cmp(&a.0));

    let stop_words: &[&str] = &[
        "the", "a", "an", "on", "to", "for", "my", "i", "and", "of", "in",
    ];

    let query_words: Vec<String> = task_name
        .to_lowercase()
        .split_whitespace()
        .filter(|w| !stop_words.contains(w))
        .map(|w| w.to_string())
        .collect();

    for (date_stem, path) in &files {
        let content = match fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        // Parse entries: track current heading task name, task type, and lesson
        let mut current_heading_task: Option<String> = None;
        let mut current_task_type: Option<String> = None;
        let mut current_lesson: Option<String> = None;

        // Process line by line; when we hit a new heading or EOF, check the previous entry
        let lines: Vec<&str> = content.lines().collect();
        for (i, line) in lines.iter().enumerate() {
            let is_heading = line.starts_with("### ");
            let is_last = i == lines.len() - 1;

            if is_heading || is_last {
                // If this is the last line and not a heading, check if it contributes to current entry
                if is_last && !is_heading {
                    if let Some(stripped) = line.strip_prefix("- **Lesson:** ") {
                        let l = stripped.trim();
                        if !l.is_empty() {
                            current_lesson = Some(l.to_string());
                        }
                    } else if let Some(stripped) = line.strip_prefix("- **Task Type:** ") {
                        current_task_type = Some(stripped.trim().to_string());
                    }
                }

                // Check the completed entry for a match
                if let (Some(ref lesson), Some(ref heading_task)) =
                    (&current_lesson, &current_heading_task)
                {
                    if matches_task(
                        heading_task,
                        current_task_type.as_deref(),
                        &task_name,
                        template_name.as_deref(),
                        &query_words,
                        stop_words,
                    ) {
                        return Some(LessonResult {
                            lesson: lesson.clone(),
                            from_task: heading_task.clone(),
                            from_date: date_stem.clone(),
                        });
                    }
                }

                // Start a new entry if this is a heading
                if is_heading {
                    current_heading_task = None;
                    current_task_type = None;
                    current_lesson = None;

                    // Parse "### HH:MM - TaskName" or "### HH:MM - COMPLETED: TaskName"
                    let heading = &line[4..];
                    if heading.len() >= 5 {
                        if let Some(rest) = heading.get(5..).and_then(|r| r.strip_prefix(" - ")) {
                            let task = if let Some(after) = rest.strip_prefix("COMPLETED: ") {
                                after.trim().to_string()
                            } else {
                                rest.trim().to_string()
                            };
                            if !task.is_empty() {
                                current_heading_task = Some(task);
                            }
                        }
                    }
                }
            } else {
                // Non-heading, non-last line: accumulate metadata
                if let Some(stripped) = line.strip_prefix("- **Lesson:** ") {
                    let l = stripped.trim();
                    if !l.is_empty() {
                        current_lesson = Some(l.to_string());
                    }
                } else if let Some(stripped) = line.strip_prefix("- **Task Type:** ") {
                    current_task_type = Some(stripped.trim().to_string());
                }
            }
        }
    }

    None
}

fn matches_task(
    heading_task: &str,
    entry_task_type: Option<&str>,
    _query_task_name: &str,
    query_template_name: Option<&str>,
    query_words: &[String],
    stop_words: &[&str],
) -> bool {
    // Template match (strongest signal)
    if let Some(tmpl) = query_template_name {
        if !tmpl.is_empty() {
            if let Some(entry_type) = entry_task_type {
                if entry_type.eq_ignore_ascii_case(tmpl) {
                    return true;
                }
            }
        }
    }

    // Word overlap on task name
    if query_words.is_empty() {
        return false;
    }

    let entry_words: Vec<String> = heading_task
        .to_lowercase()
        .split_whitespace()
        .filter(|w| !stop_words.contains(w))
        .map(|w| w.to_string())
        .collect();

    if entry_words.is_empty() {
        return false;
    }

    let overlap = query_words
        .iter()
        .filter(|w| entry_words.contains(w))
        .count();

    let max_len = query_words.len().max(entry_words.len());
    let ratio = overlap as f64 / max_len as f64;
    ratio >= 0.5
}
