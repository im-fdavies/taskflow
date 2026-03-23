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
}

#[derive(serde::Deserialize, Default)]
struct ApiConfig {
    anthropic_key: Option<String>,
}

fn load_api_key() -> Option<String> {
    // 1. Environment variable takes priority
    if let Ok(key) = std::env::var("ANTHROPIC_API_KEY") {
        if !key.is_empty() {
            return Some(key);
        }
    }

    // 2. ~/.taskflow/config.toml
    let config_path = dirs::home_dir()?.join(".taskflow/config.toml");
    let content = std::fs::read_to_string(config_path).ok()?;
    let config: Config = toml::from_str(&content).ok()?;
    config.api?.anthropic_key
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
}

// ---------------------------------------------------------------------------
// Tauri commands (called from the frontend JS)
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_state(state: tauri::State<'_, AppState>) -> TaskState {
    state.task.lock().unwrap().clone()
}

#[tauri::command]
fn set_mode(mode: String, state: tauri::State<'_, AppState>) -> TaskState {
    let mut task = state.task.lock().unwrap();
    task.mode = mode;
    task.clone()
}

#[tauri::command]
fn start_task(name: String, state: tauri::State<'_, AppState>) -> TaskState {
    let mut task = state.task.lock().unwrap();
    task.current_task = Some(name);
    task.task_started_at = Some(Local::now().format("%H:%M").to_string());
    task.mode = "active".to_string();
    task.clone()
}

#[tauri::command]
fn end_task(state: tauri::State<'_, AppState>) -> TaskState {
    let mut task = state.task.lock().unwrap();
    task.current_task = None;
    task.task_started_at = None;
    task.mode = "idle".to_string();
    task.clone()
}

#[tauri::command]
fn hide_overlay(app: AppHandle) {
    if let Some(window) = app.get_webview_window("overlay") {
        let _ = window.hide();
    }
}

#[tauri::command]
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

    // Spawn whisper-cli
    let output = Command::new(&whisper_bin)
        .args([
            "-m", model_path.to_str().unwrap(),
            "-f", tmp_path,
            "--no-timestamps",
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

    Ok(text)
}

#[tauri::command]
fn load_templates() -> Result<Vec<serde_json::Value>, String> {
    use std::fs;

    // In dev (npx tauri dev), cwd is the project root
    // where templates/ lives alongside src/, src-tauri/, etc.
    let cwd = std::env::current_dir()
        .map_err(|e| format!("Cannot get cwd: {}", e))?;
    let templates_dir = cwd.join("templates");

    if !templates_dir.exists() {
        return Err(format!(
            "templates/ directory not found at {}",
            templates_dir.display()
        ));
    }

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

#[tauri::command]
fn get_template(name: String) -> Result<serde_json::Value, String> {
    use std::fs;

    let cwd = std::env::current_dir()
        .map_err(|e| format!("Cannot get cwd: {}", e))?;
    let templates_dir = cwd.join("templates");

    // Try matching by id field or by filename
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

#[tauri::command]
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
// Ollama local LLM fallback
// ---------------------------------------------------------------------------

#[tauri::command]
async fn check_ollama() -> bool {
    use std::time::Duration;

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };

    match client.get("http://localhost:11434/api/tags").send().await {
        Ok(r) => r.status().is_success(),
        Err(e) => {
            eprintln!("[TaskFlow] Ollama not available: {e}");
            false
        }
    }
}

#[derive(Serialize)]
struct LlmModeResult {
    mode: u8,
    reason: String,
}

#[tauri::command]
async fn detect_mode_llm(
    transcription: String,
    current_task: Option<String>,
) -> Result<LlmModeResult, String> {
    use std::time::Duration;

    let task_str = current_task.as_deref().unwrap_or("none");

    let prompt = format!(
        "Classify this context switch description into exactly one mode.\n\n\
         URGENT: The user explicitly says something is urgent, broken, or on fire. They need to act immediately.\n\
         LIGHT: The user has finished their previous task cleanly, or the new task is closely related to what they were doing. No stress, just moving on.\n\
         FULL: The user was interrupted, pulled away, or is switching to something unrelated. They need to decompress from the previous context.\n\n\
         Description: \"{transcription}\"\n\
         Current task: \"{task_str}\"\n\n\
         Reply with ONLY a JSON object: {{\"mode\": 1, \"reason\": \"one short phrase\"}}\n\
         Where mode is: 1=FULL, 2=LIGHT, 3=URGENT"
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
        if (1..=3).contains(&mode) {
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
            check_ollama,
            detect_mode_llm,
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
                    use tauri::Emitter;
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
