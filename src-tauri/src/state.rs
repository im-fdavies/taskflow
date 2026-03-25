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

pub struct AppState {
    pub task: Mutex<TaskState>,
    // Cached after the first check; Ollama availability won't change mid-session.
    // If the user starts Ollama after launching the app, they must restart.
    pub ollama_available: Mutex<Option<bool>>,
    // Tracks when Cmd+Shift+Space was pressed to measure hold duration.
    pub shortcut_pressed_at: Mutex<Option<std::time::Instant>>,
}
