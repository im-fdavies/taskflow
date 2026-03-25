use crate::helpers::config::load_config;

// ---------------------------------------------------------------------------
// Agent context bridge — reads handover notes from active project
// ---------------------------------------------------------------------------

#[tauri::command(rename_all = "camelCase")]
pub fn read_agent_context() -> Option<String> {
    use std::time::{Duration, SystemTime};

    // Resolve active project path: config > env var
    let config = load_config();
    let project_path = config
        .project
        .and_then(|p| p.active_path)
        .or_else(|| std::env::var("TASKFLOW_PROJECT").ok())?;

    let notes_path = std::path::Path::new(&project_path)
        .join(".github/handover-notes.md");

    if !notes_path.exists() {
        return None;
    }

    // Only use notes modified within the last 8 hours
    let meta = std::fs::metadata(&notes_path).ok()?;
    let modified = meta.modified().ok()?;
    let age = SystemTime::now().duration_since(modified).unwrap_or(Duration::MAX);
    if age > Duration::from_secs(8 * 3600) {
        eprintln!("[TaskFlow] Handover notes exist but are older than 8h — skipping");
        return None;
    }

    let content = std::fs::read_to_string(&notes_path).ok()?;

    // Extract the most useful sections from the handover notes.
    let extracted = extract_handover_summary(&content);

    if extracted.is_empty() {
        return None;
    }

    Some(extracted)
}

fn extract_handover_summary(content: &str) -> String {
    let mut sections: Vec<(usize, &str)> = Vec::new();
    for (i, line) in content.lines().enumerate() {
        if line.starts_with("## ") {
            sections.push((i, line));
        }
    }

    let lines: Vec<&str> = content.lines().collect();
    let total = lines.len();
    let mut result = String::new();

    // Section names to extract, in priority order.
    let priority_order = ["what's next", "whats next", "what was done", "current state"];

    let mut collected: Vec<(usize, String)> = Vec::new();
    for (idx, (line_num, heading)) in sections.iter().enumerate() {
        let h_lower = heading.to_lowercase();
        let priority = priority_order.iter().position(|w| h_lower.contains(w));
        if let Some(p) = priority {
            let next_section_line = sections
                .get(idx + 1)
                .map(|(ln, _)| *ln)
                .unwrap_or(total);
            let section_lines: Vec<&str> = lines[*line_num..next_section_line]
                .iter()
                .copied()
                .collect();
            let text = section_lines.join("\n").trim().to_string();
            // Cap each section at 600 chars
            let capped = if text.len() > 600 {
                format!("{}…", &text[..600])
            } else {
                text
            };
            collected.push((p, capped));
        }
    }

    // Sort by priority (lower index = higher priority)
    collected.sort_by_key(|(p, _)| *p);

    for (_, text) in collected {
        if !result.is_empty() {
            result.push_str("\n\n");
        }
        result.push_str(&text);
    }

    // If no known headings found, return the whole file trimmed to 800 chars
    if result.is_empty() {
        let trimmed = content.trim();
        if trimmed.len() > 800 {
            return format!("{}…", &trimmed[..800]);
        }
        return trimmed.to_string();
    }

    result
}

// ---------------------------------------------------------------------------
// Completion context (written by /completion skill, read back into form)
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, serde::Deserialize, Default)]
pub struct CompletionContext {
    pub outcome: Option<String>,
    pub prs: Option<String>,
    pub follow_ups: Option<String>,
    pub handoff: Option<String>,
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_completion_context() -> Option<CompletionContext> {
    let config = load_config();
    let project_path = config
        .project
        .and_then(|p| p.active_path)
        .or_else(|| std::env::var("TASKFLOW_PROJECT").ok())?;

    let context_path = std::path::Path::new(&project_path)
        .join(".github/completion-context.json");

    if !context_path.exists() {
        return None;
    }

    let content = std::fs::read_to_string(&context_path).ok()?;
    serde_json::from_str(&content).ok()
}
