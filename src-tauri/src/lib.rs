use tauri::Manager;
use tauri::Emitter;
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
                    let ctrl_shift_space = Shortcut::new(
                        Some(Modifiers::SUPER | Modifiers::SHIFT),
                        Code::Space,
                    );
                    let ctrl_shift_d = Shortcut::new(
                        Some(Modifiers::SUPER | Modifiers::SHIFT),
                        Code::KeyD,
                    );

                    if shortcut == &ctrl_shift_space {
                        let state = app.state::<AppState>();
                        match event.state() {
                            ShortcutState::Pressed => {
                                *state.shortcut_pressed_at.lock().unwrap() = Some(std::time::Instant::now());
                                commands::window::open_overlay(app);
                            }
                            ShortcutState::Released => {
                                let pressed_at = state.shortcut_pressed_at.lock().unwrap().take();
                                if let Some(pressed_at) = pressed_at {
                                    let held_ms = pressed_at.elapsed().as_millis();
                                    if held_ms >= 300 {
                                        if let Some(window) = app.get_webview_window("overlay") {
                                            let _ = window.emit("shortcut-released", ());
                                        }
                                    }
                                    // Short tap (<300ms) — Enter/Done flow handles stop
                                }
                            }
                        }
                    } else if shortcut == &ctrl_shift_d {
                        if event.state() == ShortcutState::Pressed {
                            commands::window::toggle_dashboard(app);
                        }
                    }
                })
                .build(),
        )
        .manage(AppState {
            task: Mutex::new(TaskState::load()),
            ollama_available: Mutex::new(None),
            shortcut_pressed_at: Mutex::new(None),
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
            read_active_task,
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

            // Restore active task from daily logs (covers cross-day case where state.json has nothing)
            {
                let state = app.state::<AppState>();
                let mut task = state.task.lock().expect("task state lock poisoned");
                if task.current_task.is_none() {
                    if let Some(active) = crate::commands::todos::read_active_task_internal() {
                        task.current_task = Some(active.name);
                        task.mode = "active".to_string();
                        task.task_started_at = Some(active.time);
                    }
                }
            }
            // Update tray after potential state restore
            crate::tray::update_tray_menu(app.handle());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running TaskFlow");
}
