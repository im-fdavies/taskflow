use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use std::sync::Mutex;

mod state;
mod helpers;
mod commands;
mod tray;

use state::{AppState, TaskState};
use commands::*;

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let ctrl_shift_space = Shortcut::new(
                            Some(Modifiers::SUPER | Modifiers::SHIFT),
                            Code::Space,
                        );
                        let ctrl_shift_d = Shortcut::new(
                            Some(Modifiers::SUPER | Modifiers::SHIFT),
                            Code::KeyD,
                        );
                        if shortcut == &ctrl_shift_space {
                            commands::window::toggle_overlay(app);
                        } else if shortcut == &ctrl_shift_d {
                            commands::window::toggle_dashboard(app);
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
            read_completion_context,
            read_daily_todos,
            read_completed_todos,
            read_daily_summary,
            append_todo_entry,
            check_ollama,
            detect_mode_llm,
            get_vocabulary,
            add_vocabulary_term,
            get_corrections,
            add_correction,
            append_daily_log,
            append_completion_log,
            expand_for_dashboard,
            collapse_from_dashboard,
            update_todo_entry,
            complete_todo_entry,
            discard_todo_entry,
            read_paused_tasks,
            read_jira_tickets,
            refresh_jira_cache,
        ])
        .setup(|app| {
            // Register the global shortcut
            let shortcut = Shortcut::new(
                Some(Modifiers::SUPER | Modifiers::SHIFT),
                Code::Space,
            );
            app.global_shortcut().register(shortcut)?;

            let dashboard_shortcut = Shortcut::new(
                Some(Modifiers::SUPER | Modifiers::SHIFT),
                Code::KeyD,
            );
            app.global_shortcut().register(dashboard_shortcut)?;

            // Start hidden - vibrancy applied dynamically when dashboard opens
            if let Some(window) = app.get_webview_window("overlay") {
                let _ = window.hide();
            }

            tray::setup_tray(app.handle())?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running TaskFlow");
}
