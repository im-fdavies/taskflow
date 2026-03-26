use serde::{Deserialize, Serialize};
use std::sync::Mutex;

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

impl TaskState {
    fn state_file() -> Option<std::path::PathBuf> {
        dirs::home_dir().map(|h| h.join(".taskflow/state.json"))
    }

    pub fn save(&self) {
        if let Some(path) = Self::state_file() {
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Ok(json) = serde_json::to_string(self) {
                let _ = std::fs::write(&path, json);
            }
        }
    }

    pub fn load() -> Self {
        Self::state_file()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }
}

pub struct AppState {
    pub task: Mutex<TaskState>,
    // Cached after the first check; Ollama availability won't change mid-session.
    // If the user starts Ollama after launching the app, they must restart.
    pub ollama_available: Mutex<Option<bool>>,
    // Tracks when Cmd+Shift+Space was pressed to measure hold duration.
    pub shortcut_pressed_at: Mutex<Option<std::time::Instant>>,
}
