use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use chrono::Local;
use tauri::Emitter;

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
