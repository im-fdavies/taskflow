use tauri::{AppHandle, Manager};
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use chrono::Timelike;
use crate::state::AppState;

const TRAY_ID: &str = "main";

/// Creates and registers the system tray icon with menu. Call once from `.setup()`.
pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;
    let menu = build_menu(app, None, None)?;

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
    let (task_name, elapsed, tooltip) = {
        let state = app.state::<AppState>();
        let task = state.task.lock().expect("task state lock poisoned");
        let name = task.current_task.clone();
        let elapsed = task.task_started_at.as_ref().and_then(|started| {
            let parts: Vec<&str> = started.split(':').collect();
            if parts.len() != 2 { return None; }
            let h: u32 = parts[0].parse().ok()?;
            let m: u32 = parts[1].parse().ok()?;
            let now = chrono::Local::now();
            let now_mins = now.hour() * 60 + now.minute();
            let start_mins = h * 60 + m;
            if now_mins < start_mins { return None; }
            let el = now_mins - start_mins;
            if el >= 60 { Some(format!("{}h {}m", el / 60, el % 60)) }
            else { Some(format!("{}m", el)) }
        });
        let tt = match (&name, &elapsed) {
            (Some(n), Some(t)) => format!("TaskFlow - {} ({})", n, t),
            (Some(n), None) => format!("TaskFlow - {}", n),
            _ => "TaskFlow - No active task".to_string(),
        };
        (name, elapsed, tt)
    };

    if let Ok(menu) = build_menu(app, task_name, elapsed) {
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            let _ = tray.set_menu(Some(menu));
            let _ = tray.set_tooltip(Some(&tooltip));
        }
    }
}

fn build_menu(
    app: &AppHandle,
    current_task: Option<String>,
    elapsed: Option<String>,
) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let label = match (&current_task, &elapsed) {
        (Some(name), Some(time)) => format!("{} ({})", name, time),
        (Some(name), None) => name.clone(),
        _ => "No active task".to_string(),
    };

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
            format!("# {} - Daily Log\n\n## Summary\n\n## Todos\n\n## Completed Work\n\n", date_str),
        );
    }

    // Use vault name + relative file path (more reliable than absolute path,
    // especially with cloud storage paths like Dropbox/iCloud)
    let vault_name = logs_dir.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("DailyNotes");
    let file_name = date_str; // no extension - Obsidian adds .md automatically
    let uri = format!(
        "obsidian://open?vault={}&file={}",
        percent_encode(vault_name),
        percent_encode(&file_name),
    );
    let result = Command::new("open").arg(&uri).status();

    match result {
        Ok(status) if status.success() => {}
        _ => {
            // Fallback: open the file directly with whatever handles .md
            let path_str = log_path.to_string_lossy().to_string();
            let _ = Command::new("open").arg(&path_str).spawn();
        }
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
