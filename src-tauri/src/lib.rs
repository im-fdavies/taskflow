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
            task: Mutex::new(TaskState::default()),
            ollama_available: Mutex::new(None),
            shortcut_pressed_at: Mutex::new(None),
            timers: Mutex::new(std::collections::HashMap::new()),
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
            append_note,
            append_task_note,
            expand_for_dashboard,
            collapse_from_dashboard,
            update_todo_entry,
            complete_todo_entry,
            discard_todo_entry,
            read_paused_tasks,
            read_active_task,
            read_open_tasks,
            read_jira_tickets,
            refresh_jira_cache,
            get_task_elapsed,
            register_timer,
            cancel_timer,
            read_pending_timers,
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

            // Restore active task from daily logs (Open Tasks section)
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

            // Restore pending timers from today's log
            {
                let logs_dir = crate::helpers::config::logs_dir();
                let date_str = chrono::Local::now().format("%Y-%m-%d").to_string();
                let log_path = logs_dir.join(format!("{}.md", date_str));

                if log_path.exists() {
                    if let Ok(content) = std::fs::read_to_string(&log_path) {
                        let timers_section =
                            crate::helpers::markdown::extract_section(&content, "Timers");
                        let app_handle = app.handle().clone();

                        struct PendingRestore {
                            fire_time: String,
                            title: String,
                            timer_type: String,
                            task_name: Option<String>,
                        }

                        let mut to_restore: Vec<PendingRestore> = Vec::new();
                        let mut current_fire_time: Option<String> = None;
                        let mut current_title: Option<String> = None;
                        let mut current_type: Option<String> = None;
                        let mut current_task: Option<String> = None;
                        let mut is_pending = false;

                        for line in timers_section.lines() {
                            if line.starts_with("### ") {
                                // Process previous entry if it was pending
                                if is_pending {
                                    if let (Some(ft), Some(t), Some(tt)) = (
                                        current_fire_time.take(),
                                        current_title.take(),
                                        current_type.take(),
                                    ) {
                                        to_restore.push(PendingRestore {
                                            fire_time: ft,
                                            title: t,
                                            timer_type: tt,
                                            task_name: current_task.take(),
                                        });
                                    }
                                }

                                // Parse new entry: ### HH:MM - Title [type]
                                current_fire_time = None;
                                current_title = None;
                                current_type = None;
                                current_task = None;
                                is_pending = false;

                                let heading = &line[4..];
                                if heading.len() >= 5 {
                                    let fire_time = heading[..5].to_string();
                                    if let Some(rest) =
                                        heading.get(5..).and_then(|r| r.strip_prefix(" - "))
                                    {
                                        if let Some(bracket_pos) = rest.rfind('[') {
                                            let title =
                                                rest[..bracket_pos].trim().to_string();
                                            let timer_type = rest[bracket_pos + 1..]
                                                .trim_end_matches(']')
                                                .to_string();
                                            current_fire_time = Some(fire_time);
                                            current_title = Some(title);
                                            current_type = Some(timer_type);
                                        }
                                    }
                                }
                            } else if line.contains("**Status:** pending") {
                                is_pending = true;
                            } else if line.contains("**Task:**") {
                                let task =
                                    line.split("**Task:**").nth(1).unwrap_or("").trim();
                                if task != "\u{2014}" && !task.is_empty() {
                                    current_task = Some(task.to_string());
                                }
                            }
                        }

                        // Process the last entry
                        if is_pending {
                            if let (Some(ft), Some(t), Some(tt)) = (
                                current_fire_time.take(),
                                current_title.take(),
                                current_type.take(),
                            ) {
                                to_restore.push(PendingRestore {
                                    fire_time: ft,
                                    title: t,
                                    timer_type: tt,
                                    task_name: current_task.take(),
                                });
                            }
                        }

                        // Spawn timers for entries still in the future
                        for entry in to_restore {
                            if let Ok(duration) =
                                crate::commands::timers::calculate_sleep_duration(
                                    &entry.fire_time,
                                )
                            {
                                let id = crate::commands::timers::timer_id(
                                    &entry.fire_time,
                                    &entry.title,
                                );
                                crate::commands::timers::spawn_timer(
                                    app_handle.clone(),
                                    id,
                                    entry.fire_time,
                                    entry.title,
                                    String::new(),
                                    entry.timer_type,
                                    entry.task_name,
                                    duration,
                                );
                            }
                        }
                    }
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running TaskFlow");
}
