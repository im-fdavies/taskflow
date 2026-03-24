use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use chrono::Local;
use tauri::Emitter;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize, Default)]
struct Config {
    api: Option<ApiConfig>,
    project: Option<ProjectConfig>,
}

#[derive(serde::Deserialize, Default)]
struct ApiConfig {
    anthropic_key: Option<String>,
}

#[derive(serde::Deserialize, Default)]
struct ProjectConfig {
    active_path: Option<String>,
}

fn load_config() -> Config {
    let path = dirs::home_dir()
        .map(|h| h.join(".taskflow/config.toml"));
    let content = path
        .and_then(|p| std::fs::read_to_string(p).ok())
        .unwrap_or_default();
    toml::from_str(&content).unwrap_or_default()
}

fn load_api_key() -> Option<String> {
    // 1. Environment variable takes priority
    if let Ok(key) = std::env::var("ANTHROPIC_API_KEY") {
        if !key.is_empty() {
            return Some(key);
        }
    }

    // 2. ~/.taskflow/config.toml
    load_config().api?.anthropic_key
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

#[derive(Deserialize, Serialize, Default)]
struct VocabularyFile {
    #[serde(default)]
    terms: Vec<String>,
}

const DEFAULT_VOCABULARY: &[&str] = &[
    "PR amends",
    "pull request",
    "code review",
    "Tori invocation",
    "health check bundle",
    "Symfony",
    "unit tests",
    "authentication",
    "authorisation",
    "Copilot",
    "im-agent-skills",
    "handover",
    "unblocking",
];

fn vocabulary_path() -> std::path::PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".taskflow/vocabulary.yaml")
}

fn load_vocabulary() -> Vec<String> {
    let path = vocabulary_path();
    if let Ok(content) = std::fs::read_to_string(&path) {
        if let Ok(file) = serde_yaml::from_str::<VocabularyFile>(&content) {
            return file.terms;
        }
    }
    // File doesn't exist or is invalid — create with defaults
    let terms: Vec<String> = DEFAULT_VOCABULARY.iter().map(|s| s.to_string()).collect();
    let file = VocabularyFile { terms: terms.clone() };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = save_vocabulary_file(&file);
    terms
}

fn save_vocabulary_file(file: &VocabularyFile) -> Result<(), String> {
    let path = vocabulary_path();
    let header = "# Terms that Whisper should recognise\n# These are fed to whisper.cpp via --prompt to bias transcription\n";
    let yaml = serde_yaml::to_string(file).map_err(|e| e.to_string())?;
    std::fs::write(&path, format!("{}{}", header, yaml)).map_err(|e| e.to_string())
}

fn vocabulary_prompt_string() -> String {
    load_vocabulary().join(", ")
}

// ---------------------------------------------------------------------------
// Corrections (phrase-based)
// ---------------------------------------------------------------------------

#[derive(Deserialize, Serialize, Clone, Debug)]
struct CorrectionEntry {
    #[serde(rename = "match")]
    match_phrase: String,
    replace: String,
}

#[derive(Deserialize, Serialize, Default)]
struct CorrectionsFile {
    #[serde(default)]
    corrections: Vec<CorrectionEntry>,
}

fn corrections_path() -> std::path::PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".taskflow/corrections.yaml")
}

fn load_corrections() -> Vec<CorrectionEntry> {
    let path = corrections_path();
    if let Ok(content) = std::fs::read_to_string(&path) {
        if let Ok(file) = serde_yaml::from_str::<CorrectionsFile>(&content) {
            return file.corrections;
        }
    }
    // Create empty corrections file
    let file = CorrectionsFile { corrections: Vec::new() };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = save_corrections_file(&file);
    Vec::new()
}

fn save_corrections_file(file: &CorrectionsFile) -> Result<(), String> {
    let path = corrections_path();
    let header = "# Auto-corrections applied after transcription\n\
                  # Corrections are phrase-based: match a phrase, replace with another\n";
    let yaml = serde_yaml::to_string(file).map_err(|e| e.to_string())?;
    std::fs::write(&path, format!("{}{}", header, yaml)).map_err(|e| e.to_string())
}

fn apply_corrections(text: &str) -> String {
    let mut entries = load_corrections();
    if entries.is_empty() {
        return text.to_string();
    }

    // Sort by match length descending so longer phrases match first
    entries.sort_by(|a, b| b.match_phrase.len().cmp(&a.match_phrase.len()));

    let mut result = text.to_string();

    for entry in &entries {
        let escaped = regex_lite_escape(&entry.match_phrase);
        // Single-word matches use word boundaries; multi-word use exact phrase match
        let is_single_word = !entry.match_phrase.contains(' ');
        let pattern = if is_single_word {
            format!(r"(?i)\b{}\b", escaped)
        } else {
            // For multi-word: match with flexible whitespace between words
            let parts: Vec<&str> = entry.match_phrase.split_whitespace().collect();
            let escaped_parts: Vec<String> = parts.iter().map(|p| regex_lite_escape(p)).collect();
            format!(r"(?i)\b{}\b", escaped_parts.join(r"\s+"))
        };
        if let Ok(re) = regex_lite::Regex::new(&pattern) {
            result = re.replace_all(&result, entry.replace.as_str()).to_string();
        }
    }

    result
}

fn regex_lite_escape(s: &str) -> String {
    let mut escaped = String::with_capacity(s.len() + 8);
    for c in s.chars() {
        match c {
            '\\' | '.' | '+' | '*' | '?' | '(' | ')' | '|' | '[' | ']' | '{' | '}' | '^' | '$' => {
                escaped.push('\\');
                escaped.push(c);
            }
            _ => escaped.push(c),
        }
    }
    escaped
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskState {
    pub current_task: Option<String>,
    pub task_started_at: Option<String>,
    pub mode: String, // "idle", "listening", "exit", "transition", "entry", "active"
}

impl Default for TaskState {
    fn default() -> Self {
        Self {
            current_task: None,
            task_started_at: None,
            mode: "idle".to_string(),
        }
    }
}

pub struct AppState {
    pub task: Mutex<TaskState>,
    // Cached after the first check; Ollama availability won't change mid-session.
    // If the user starts Ollama after launching the app, they must restart.
    pub ollama_available: Mutex<Option<bool>>,
}

// ---------------------------------------------------------------------------
// Tauri commands (called from the frontend JS)
// ---------------------------------------------------------------------------

#[tauri::command(rename_all = "camelCase")]
fn get_state(state: tauri::State<'_, AppState>) -> TaskState {
    state.task.lock().unwrap().clone()
}

#[tauri::command(rename_all = "camelCase")]
fn set_mode(mode: String, state: tauri::State<'_, AppState>) -> TaskState {
    let mut task = state.task.lock().unwrap();
    task.mode = mode;
    task.clone()
}

#[tauri::command(rename_all = "camelCase")]
fn start_task(name: String, state: tauri::State<'_, AppState>) -> TaskState {
    let mut task = state.task.lock().unwrap();
    task.current_task = Some(name);
    task.task_started_at = Some(Local::now().format("%H:%M").to_string());
    task.mode = "active".to_string();
    task.clone()
}

#[tauri::command(rename_all = "camelCase")]
fn end_task(state: tauri::State<'_, AppState>) -> TaskState {
    let mut task = state.task.lock().unwrap();
    task.current_task = None;
    task.task_started_at = None;
    task.mode = "idle".to_string();
    task.clone()
}

#[tauri::command(rename_all = "camelCase")]
fn append_daily_log(
    task_name: String,
    template_name: Option<String>,
    exit_capture: String,
    bookmark: Option<String>,
    mode: u8,
    duration_minutes: Option<i64>,
) -> Result<(), String> {
    use std::fs;
    use std::io::Write;

    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let logs_dir = home.join(".taskflow/logs");
    fs::create_dir_all(&logs_dir).map_err(|e| format!("Failed to create logs dir: {}", e))?;

    let now = Local::now();
    let date_str = now.format("%Y-%m-%d").to_string();
    let time_str = now.format("%H:%M").to_string();
    let log_path = logs_dir.join(format!("{}.md", date_str));

    let file_exists = log_path.exists();
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("Failed to open log file: {}", e))?;

    if !file_exists {
        writeln!(file, "# {}\n", date_str).map_err(|e| e.to_string())?;
    }

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

    let template_str = template_name.as_deref().unwrap_or("None");
    let bookmark_str = bookmark.as_deref().unwrap_or("\u{2014}");
    let exit_str = if exit_capture.is_empty() { "\u{2014}" } else { &exit_capture };

    writeln!(file, "## {} \u{2014} {}", time_str, task_name).map_err(|e| e.to_string())?;
    writeln!(file, "- **Mode:** {}", mode_label).map_err(|e| e.to_string())?;
    writeln!(file, "- **Template:** {}", template_str).map_err(|e| e.to_string())?;
    writeln!(file, "- **Duration:** {}", duration_str).map_err(|e| e.to_string())?;
    writeln!(file, "- **Exit notes:** {}", exit_str).map_err(|e| e.to_string())?;
    writeln!(file, "- **Bookmark:** {}\n", bookmark_str).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
fn append_completion_log(
    task_name: String,
    outcome: String,
    pr_links: Option<String>,
    follow_ups: Option<String>,
    handoff_notes: Option<String>,
    duration_minutes: Option<i64>,
) -> Result<(), String> {
    use std::fs;
    use std::io::Write;

    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let logs_dir = home.join(".taskflow/logs");
    fs::create_dir_all(&logs_dir).map_err(|e| format!("Failed to create logs dir: {}", e))?;

    let now = Local::now();
    let date_str = now.format("%Y-%m-%d").to_string();
    let time_str = now.format("%H:%M").to_string();
    let log_path = logs_dir.join(format!("{}.md", date_str));

    let file_exists = log_path.exists();
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("Failed to open log file: {}", e))?;

    if !file_exists {
        writeln!(file, "# {}\n", date_str).map_err(|e| e.to_string())?;
    }

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

    writeln!(file, "## {} \u{2014} COMPLETED: {}", time_str, task_name).map_err(|e| e.to_string())?;
    writeln!(file, "- **Outcome:** {}", outcome_str).map_err(|e| e.to_string())?;
    writeln!(file, "- **Duration:** {}", duration_str).map_err(|e| e.to_string())?;
    writeln!(file, "- **PRs:** {}", pr_str).map_err(|e| e.to_string())?;
    writeln!(file, "- **Follow-ups:** {}", follow_str).map_err(|e| e.to_string())?;
    writeln!(file, "- **Handoff:** {}\n", handoff_str).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
fn hide_overlay(app: AppHandle) {
    if let Some(window) = app.get_webview_window("overlay") {
        let _ = window.hide();
    }
}

#[tauri::command(rename_all = "camelCase")]
fn transcribe_audio(wav_data: Vec<u8>) -> Result<String, String> {
    use std::fs;
    use std::process::Command;

    let tmp_path = "/tmp/taskflow_audio.wav";

    // Write WAV bytes to temp file
    fs::write(tmp_path, &wav_data)
        .map_err(|e| format!("Failed to write audio file: {}", e))?;

    // Expand home directory for whisper paths
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let whisper_bin = home.join("Documents/GitHub/whisper.cpp/build/bin/whisper-cli");
    let model_path = home.join("Documents/GitHub/whisper.cpp/models/ggml-base.en.bin");

    // Build vocabulary prompt from ~/.taskflow/vocabulary.yaml
    let prompt = vocabulary_prompt_string();

    // Spawn whisper-cli
    let output = Command::new(&whisper_bin)
    .args([
        "-m", model_path.to_str().unwrap(),
        "-f", tmp_path,
        "--no-timestamps",
        "--beam-size", "8",
        "--best-of", "5",
        "--language", "en",
        "--prompt", &prompt,
    ])
    .output()
    .map_err(|e| format!("Failed to spawn whisper-cli: {}", e))?;

    // Clean up temp file (best effort)
    let _ = fs::remove_file(tmp_path);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("whisper-cli failed: {}", stderr));
    }

    // Parse transcription from stdout
    let raw = String::from_utf8_lossy(&output.stdout);
    let text: String = raw
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    if text.is_empty() {
        return Err("No transcription returned".to_string());
    }

    // Apply corrections before returning
    Ok(apply_corrections(&text))
}

// ---------------------------------------------------------------------------
// Vocabulary & Corrections — Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command(rename_all = "camelCase")]
fn get_vocabulary() -> Vec<String> {
    load_vocabulary()
}

#[tauri::command(rename_all = "camelCase")]
fn add_vocabulary_term(term: String) -> Result<Vec<String>, String> {
    let mut terms = load_vocabulary();
    let trimmed = term.trim().to_string();
    if trimmed.is_empty() {
        return Err("Term cannot be empty".to_string());
    }
    // Avoid duplicates (case-insensitive)
    if !terms.iter().any(|t| t.eq_ignore_ascii_case(&trimmed)) {
        terms.push(trimmed);
        let file = VocabularyFile { terms: terms.clone() };
        save_vocabulary_file(&file)?;
    }
    Ok(terms)
}

#[tauri::command(rename_all = "camelCase")]
fn get_corrections() -> Vec<serde_json::Value> {
    load_corrections()
        .into_iter()
        .map(|e| serde_json::json!({ "match": e.match_phrase, "replace": e.replace }))
        .collect()
}

#[tauri::command(rename_all = "camelCase")]
fn add_correction(match_phrase: String, replacement: String) -> Result<Vec<serde_json::Value>, String> {
    let match_phrase = match_phrase.trim().to_string();
    let replacement = replacement.trim().to_string();
    if match_phrase.is_empty() || replacement.is_empty() {
        return Err("Both match_phrase and replacement must be non-empty".to_string());
    }
    let mut entries = load_corrections();
    // Remove existing entry for same match phrase (case-insensitive) to avoid duplicates
    entries.retain(|e| !e.match_phrase.eq_ignore_ascii_case(&match_phrase));
    entries.push(CorrectionEntry { match_phrase, replace: replacement });
    let file = CorrectionsFile { corrections: entries.clone() };
    save_corrections_file(&file)?;
    Ok(entries
        .into_iter()
        .map(|e| serde_json::json!({ "match": e.match_phrase, "replace": e.replace }))
        .collect())
}

// ---------------------------------------------------------------------------
// Templates — path resolution
// ---------------------------------------------------------------------------

// Resolves the templates/ directory.
// In dev mode CARGO_MANIFEST_DIR is src-tauri/ (compile-time), so
// one level up lands at the project root where templates/ lives.
// Falls back to cwd-relative paths in case of unusual layouts.
fn resolve_templates_dir() -> Option<std::path::PathBuf> {
    let manifest_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../templates");
    if manifest_path.exists() {
        return Some(manifest_path);
    }
    if let Ok(cwd) = std::env::current_dir() {
        let p = cwd.join("templates");
        if p.exists() { return Some(p); }
        let p = cwd.join("../templates");
        if p.exists() { return Some(p); }
    }
    None
}

#[tauri::command(rename_all = "camelCase")]
fn load_templates() -> Result<Vec<serde_json::Value>, String> {
    use std::fs;

    let templates_dir = resolve_templates_dir()
        .ok_or_else(|| "templates/ directory not found".to_string())?;

    let mut templates = Vec::new();
    let entries = fs::read_dir(&templates_dir)
        .map_err(|e| format!("Cannot read templates dir: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Dir entry error: {}", e))?;
        let path = entry.path();

        // Only process .yaml files, skip _schema.yaml and any hidden files
        let filename = path
            .file_name()
            .and_then(|f| f.to_str())
            .unwrap_or("");

        if !filename.ends_with(".yaml") || filename.starts_with('_') {
            continue;
        }

        let content = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read {}: {}", filename, e))?;

        let value: serde_json::Value = serde_yaml::from_str(&content)
            .map_err(|e| format!("Failed to parse {}: {}", filename, e))?;

        templates.push(value);
    }

    Ok(templates)
}

#[tauri::command(rename_all = "camelCase")]
fn get_template(name: String) -> Result<serde_json::Value, String> {
    use std::fs;

    let templates_dir = resolve_templates_dir()
        .ok_or_else(|| "templates/ directory not found".to_string())?;
    let entries = fs::read_dir(&templates_dir)
        .map_err(|e| format!("Cannot read templates dir: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("{}", e))?;
        let path = entry.path();
        let filename = path.file_name().and_then(|f| f.to_str()).unwrap_or("");

        if !filename.ends_with(".yaml") || filename.starts_with('_') {
            continue;
        }

        let content = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read {}: {}", filename, e))?;

        let value: serde_json::Value = serde_yaml::from_str(&content)
            .map_err(|e| format!("Failed to parse {}: {}", filename, e))?;

        // Match by id field or name field
        let id_match = value.get("id")
            .and_then(|v| v.as_str())
            .map(|s| s == name.as_str())
            .unwrap_or(false);
        let name_match = value.get("name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_lowercase() == name.to_lowercase())
            .unwrap_or(false);

        if id_match || name_match {
            return Ok(value);
        }
    }

    Err(format!("Template '{}' not found", name))
}

#[tauri::command(rename_all = "camelCase")]
async fn generate_clarification_questions(
    transcription: String,
    template_name: String,
    template_context: String,
    exit_capture: String,
    max_questions: Option<u8>,
) -> Result<Vec<String>, String> {
    use std::time::Duration;

    // Load API key — skip silently if not configured
    let api_key = match load_api_key() {
        Some(k) => k,
        None => {
            eprintln!("[TaskFlow] ANTHROPIC_API_KEY not set and no config found — skipping clarification questions");
            return Ok(vec![]);
        }
    };

    let max_q = max_questions.unwrap_or(3);

    let system_prompt = "You are a context-switching assistant. The user is about to start a new task. \
Based on their voice description of what they're switching to and the workflow template that was selected, \
generate 1-3 short clarification questions that would help them approach the task better.\n\n\
Rules:\n\
- Only ask questions that genuinely help. If the user's description is clear enough, return fewer questions or none.\n\
- Never ask obvious questions. If the answer is already in what they said, don't ask.\n\
- Questions should be specific to the task, not generic productivity advice.\n\
- Keep each question to one sentence.\n\
- Frame questions as things to think about, not interrogation. Tone: helpful colleague, not manager.\n\
- Return ONLY a JSON array of strings. No preamble, no markdown, no explanation.\n\n\
Example good questions for \"PR amends\":\n\
- \"How many comments are there — is this a quick fix or a bigger rethink?\"\n\
- \"Did the reviewer flag any architectural concerns, or is it mostly style?\"\n\n\
Example bad questions (never ask these):\n\
- \"Are you ready to start?\" (useless)\n\
- \"What is the PR about?\" (they just told you)\n\
- \"Have you read the comments?\" (the template already tells them to)";

    let user_message = format!(
        "Task description: {transcription}\nExit context: {exit_capture}\nSelected template: {template_name}\nTemplate phases: {template_context}\n\nGenerate up to {max_q} clarification questions. Return ONLY a JSON array of strings."
    );

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let body = serde_json::json!({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 300,
        "system": system_prompt,
        "messages": [
            { "role": "user", "content": user_message }
        ]
    });

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("API request failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("API error {status}: {text}"));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse API response: {e}"))?;

    // Extract text from Claude's response
    let text = json
        .get("content")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("text"))
        .and_then(|t| t.as_str())
        .ok_or_else(|| "Unexpected API response shape".to_string())?;

    // Parse the JSON array of questions
    let questions: Vec<String> = serde_json::from_str(text.trim())
        .map_err(|e| format!("Failed to parse questions JSON: {e}. Raw: {text}"))?;

    Ok(questions)
}

// ---------------------------------------------------------------------------
// Exit interview — single follow-up question
// ---------------------------------------------------------------------------

#[tauri::command(rename_all = "camelCase")]
async fn generate_exit_question(
    transcription: String,
    exit_context: String,
    task_name: String,
    template_name: String,
) -> Result<Option<String>, String> {
    use std::time::Duration;

    let api_key = match load_api_key() {
        Some(k) => k,
        None => return Ok(None),
    };

    let system_prompt = "You are a context-switch assistant. The user is closing out a task and handing off to their future self.\n\n\
You know what they said, what they extracted as their current task state, and what they are switching to.\n\n\
Generate exactly ONE short follow-up question that would help them leave a better exit note.\n\n\
The question MUST meet all three criteria:\n\
1. The answer is NOT already present in what they said or their exit context\n\
2. The answer would meaningfully change what they do when they come back (e.g. \"committed\" vs \"mid-change\" changes re-entry entirely)\n\
3. It is specific to this task — not generic productivity advice\n\n\
If no such question exists, return null.\n\n\
Return ONLY a JSON string (the question) or JSON null. No preamble, no markdown, no explanation.\n\n\
Examples of GOOD questions:\n\
- \"Is that committed and pushed, or still in your working tree?\"\n\
- \"Is the failing test a new one you wrote, or an existing one that broke?\"\n\
- \"Did you leave a TODO comment where you stopped, or is the stopping point implicit?\"\n\n\
Examples of BAD questions (never ask these):\n\
- \"What were you working on?\" (they already said)\n\
- \"How are you feeling?\" (not actionable)\n\
- \"Have you saved your work?\" (generic, not task-specific)";

    let user_message = format!(
        "Full transcription: {transcription}\n\
         Extracted exit context: {exit_context}\n\
         Task name: {task_name}\n\
         Template: {template_name}\n\n\
         Return a single JSON string question, or null."
    );

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let body = serde_json::json!({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 120,
        "system": system_prompt,
        "messages": [
            { "role": "user", "content": user_message }
        ]
    });

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("API request failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("API error {status}: {text}"));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse API response: {e}"))?;

    let text = json
        .get("content")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("text"))
        .and_then(|t| t.as_str())
        .ok_or_else(|| "Unexpected API response shape".to_string())?;

    let trimmed = text.trim();

    // LLM returned null — no useful question
    if trimmed == "null" {
        return Ok(None);
    }

    // Parse the question string
    let question: String = serde_json::from_str(trimmed)
        .map_err(|e| format!("Failed to parse question JSON: {e}. Raw: {trimmed}"))?;

    if question.trim().is_empty() {
        return Ok(None);
    }

    Ok(Some(question))
}

// ---------------------------------------------------------------------------
// Agent context bridge — reads handover notes from active project
// ---------------------------------------------------------------------------

#[tauri::command(rename_all = "camelCase")]
fn read_agent_context() -> Option<String> {
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
    // Strategy: find "What was done this session" and "What's next" blocks,
    // which are the standard headings used by the /handover skill.
    // Fall back to the full content trimmed to 1500 chars if headings not found.
    let extracted = extract_handover_summary(&content);

    if extracted.is_empty() {
        return None;
    }

    Some(extracted)
}

fn extract_handover_summary(content: &str) -> String {
    // Find key sections by heading. We look for lines starting with "## "
    // and extract the content of "What was done" and "What's next" sections.
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
    // "What's next" is most valuable for exit context (what's remaining).
    // "What was done" gives the done/in-progress picture.
    // Each section is capped at 600 chars to keep exit notes readable.
    let priority_order = ["what's next", "whats next", "what was done", "current state"];

    // Collect matching sections in priority order
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
// Ollama local LLM fallback
// ---------------------------------------------------------------------------

#[tauri::command(rename_all = "camelCase")]
async fn check_ollama(state: tauri::State<'_, AppState>) -> Result<bool, String> {
    use std::time::Duration;

    {
        let cached = state.ollama_available.lock().unwrap();
        if let Some(available) = *cached {
            return Ok(available);
        }
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;

    let available = match client.get("http://localhost:11434/api/tags").send().await {
        Ok(r) => r.status().is_success(),
        Err(e) => {
            eprintln!("[TaskFlow] Ollama not available: {e}");
            false
        }
    };

    *state.ollama_available.lock().unwrap() = Some(available);
    Ok(available)
}

#[derive(Serialize)]
struct LlmModeResult {
    mode: u8,
    reason: String,
}

#[tauri::command(rename_all = "camelCase")]
async fn detect_mode_llm(
    transcription: String,
    current_task: Option<String>,
) -> Result<LlmModeResult, String> {
    use std::time::Duration;

    let task_str = current_task.as_deref().unwrap_or("none");

    let prompt = format!(
        "Classify this context switch description into exactly one mode.\n\n\
         COMPLETE: The user has finished a task and is logging what they did. They are NOT switching to a new task - they are wrapping up and returning to idle.\n\
         URGENT: The user explicitly says something is urgent, broken, or on fire. They need to act immediately.\n\
         LIGHT: The user has finished their previous task cleanly, or the new task is closely related to what they were doing. No stress, just moving on.\n\
         FULL: The user was interrupted, pulled away, or is switching to something unrelated. They need to decompress from the previous context.\n\n\
         Description: \"{transcription}\"\n\
         Current task: \"{task_str}\"\n\n\
         Reply with ONLY a JSON object: {{\"mode\": 1, \"reason\": \"one short phrase\"}}\n\
         Where mode is: 1=FULL, 2=LIGHT, 3=URGENT, 4=COMPLETE"
    );

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let body = serde_json::json!({
        "model": "llama3.1:8b",
        "prompt": prompt,
        "stream": false
    });

    let response = client
        .post("http://localhost:11434/api/generate")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Ollama returned status {}", response.status()));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama response: {e}"))?;

    let raw = json
        .get("response")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    // Extract JSON from the response (LLM may wrap it in markdown fences)
    let parsed: Option<(u8, String)> = (|| {
        let start = raw.find('{')?;
        let end = raw[start..].find('}')? + start + 1;
        let snippet = &raw[start..end];
        let obj: serde_json::Value = serde_json::from_str(snippet).ok()?;
        let mode = obj.get("mode")?.as_u64()? as u8;
        let reason = obj
            .get("reason")
            .and_then(|v| v.as_str())
            .unwrap_or("llm")
            .to_string();
        if (1..=4).contains(&mode) {
            Some((mode, reason))
        } else {
            None
        }
    })();

    match parsed {
        Some((mode, reason)) => {
            eprintln!("[TaskFlow] Ollama classified → mode {mode}, reason: {reason}");
            Ok(LlmModeResult { mode, reason })
        }
        None => {
            eprintln!("[TaskFlow] Ollama response unparseable, defaulting to mode 1. Raw: {raw}");
            Ok(LlmModeResult {
                mode: 1,
                reason: "parse-fallback".to_string(),
            })
        }
    }
}

// ---------------------------------------------------------------------------
// Overlay toggle
// ---------------------------------------------------------------------------

fn toggle_overlay(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("overlay") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
            // Tell the frontend we've opened
            let _ = window.emit("overlay-opened", ());
        }
    }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let ctrl_shift_space = Shortcut::new(
                            Some(Modifiers::SUPER | Modifiers::SHIFT),
                            Code::Space,
                        );
                        if shortcut == &ctrl_shift_space {
                            toggle_overlay(app);
                        }
                    }
                })
                .build(),
        )
        .manage(AppState {
            task: Mutex::new(TaskState::default()),
            ollama_available: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            set_mode,
            start_task,
            end_task,
            hide_overlay,
            transcribe_audio,
            load_templates,
            get_template,
            generate_clarification_questions,
            generate_exit_question,
            read_agent_context,
            check_ollama,
            detect_mode_llm,
            get_vocabulary,
            add_vocabulary_term,
            get_corrections,
            add_correction,
            append_daily_log,
            append_completion_log,
        ])
        .setup(|app| {
            // Register the global shortcut
            let shortcut = Shortcut::new(
                Some(Modifiers::SUPER | Modifiers::SHIFT),
                Code::Space,
            );
            app.global_shortcut().register(shortcut)?;

            // macOS: apply vibrancy to the overlay window
            #[cfg(target_os = "macos")]
            {
                if let Some(window) = app.get_webview_window("overlay") {
                    // The window is transparent — the frosted glass effect
                    // comes from the CSS backdrop-filter in the frontend.
                    // For native vibrancy, uncomment when you add
                    // window-vibrancy or tauri-plugin-vibrancy:
                    //
                    // use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                    // apply_vibrancy(&window, NSVisualEffectMaterial::UnderWindowBackground, None, None)
                    //     .expect("Failed to apply vibrancy");

                    let _ = window.hide(); // Start hidden
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running TaskFlow");
}
