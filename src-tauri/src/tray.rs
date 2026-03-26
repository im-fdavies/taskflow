use tauri::{AppHandle, Manager};
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use crate::state::AppState;

const TRAY_ID: &str = "main";

/// Creates and registers the system tray icon with menu. Call once from `.setup()`.
pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;
    let menu = build_menu(app, None)?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(true)
        .tooltip("TaskFlow - No active task")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "dashboard" => crate::commands::window::toggle_dashboard(app),
            "open_log" => open_today_log(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

/// Rebuilds the tray menu and tooltip to reflect the current task state.
/// Must be called *after* the task state lock is released to avoid a deadlock.
pub fn update_tray_menu(app: &AppHandle) {
    let (task_name, tooltip) = {
        let state = app.state::<AppState>();
        let task = state.task.lock().expect("task state lock poisoned");
        let name = task.current_task.clone();
        let tt = match &name {
            Some(n) => format!("TaskFlow - {}", n),
            None => "TaskFlow - No active task".to_string(),
        };
        (name, tt)
    };

    if let Ok(menu) = build_menu(app, task_name) {
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            let _ = tray.set_menu(Some(menu));
            let _ = tray.set_tooltip(Some(&tooltip));
        }
    }
}

fn build_menu(
    app: &AppHandle,
    current_task: Option<String>,
) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let label = current_task.unwrap_or_else(|| "No active task".to_string());

    let task_item = MenuItemBuilder::with_id("current_task", &label)
        .enabled(false)
        .build(app)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let dashboard = MenuItemBuilder::with_id("dashboard", "Dashboard").build(app)?;
    let open_log = MenuItemBuilder::with_id("open_log", "Open Today's Log").build(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit TaskFlow").build(app)?;

    MenuBuilder::new(app)
        .item(&task_item)
        .item(&sep1)
        .item(&dashboard)
        .item(&open_log)
        .item(&sep2)
        .item(&quit)
        .build()
}

fn open_today_log(_app: &AppHandle) {
    use chrono::Local;
    use std::process::Command;

    let date_str = Local::now().format("%Y-%m-%d").to_string();
    let logs_dir = crate::helpers::config::logs_dir();
    let log_path = logs_dir.join(format!("{}.md", date_str));

    let _ = std::fs::create_dir_all(&logs_dir);
    if !log_path.exists() {
        let _ = std::fs::write(
            &log_path,
            format!("# {}\n\n## Context\n\n## Completed Work\n\n", date_str),
        );
    }

    let path_str = log_path.to_string_lossy().to_string();

    // Try opening directly with Obsidian app first (more reliable than URI scheme)
    let result = Command::new("open")
        .args(["-a", "Obsidian", &path_str])
        .spawn();

    if result.is_err() {
        // Fallback: try obsidian:// URI scheme
        let encoded = percent_encode(&path_str);
        let uri = format!("obsidian://open?path={}", encoded);
        let _ = Command::new("open").arg(&uri).spawn();
    }
}

fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'/' | b':' => {
                out.push(b as char)
            }
            b' ' => out.push_str("%20"),
            other => out.push_str(&format!("%{:02X}", other)),
        }
    }
    out
}
