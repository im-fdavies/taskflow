use tauri::{AppHandle, Manager};
use tauri::Emitter;

pub(crate) fn open_overlay(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("overlay") {
        // If already visible, don't re-emit (avoids restarting recording mid-flow)
        if window.is_visible().unwrap_or(false) {
            return;
        }

        // Ensure vibrancy is cleared (may linger from dashboard)
        #[cfg(target_os = "macos")]
        {
            use window_vibrancy::clear_vibrancy;
            let _ = clear_vibrancy(&window);
        }
        let _ = window.show();
        let _ = window.set_focus();
        // Tell the frontend we've opened
        let _ = window.emit("overlay-opened", ());
    }
}

pub(crate) fn toggle_dashboard(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("overlay") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("dashboard-toggle", ());
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn hide_overlay(app: AppHandle) {
    if let Some(window) = app.get_webview_window("overlay") {
        let _ = window.hide();
    }
}

#[tauri::command]
pub fn expand_for_dashboard(app: AppHandle) {
    use tauri::LogicalSize;
    use tauri::LogicalPosition;
    if let Some(window) = app.get_webview_window("overlay") {
        if let Ok(Some(monitor)) = window.primary_monitor() {
            let scale = monitor.scale_factor();
            let screen_h = monitor.size().height as f64 / scale;
            let screen_w = monitor.size().width as f64 / scale;
            let _ = window.set_size(LogicalSize::new(screen_w, screen_h));
            let _ = window.set_position(LogicalPosition::new(0.0_f64, 0.0_f64));
            let _ = window.set_shadow(false);

            // Apply native macOS vibrancy for true frosted glass
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                let _ = apply_vibrancy(&window, NSVisualEffectMaterial::Sidebar, None, None);
            }
        }
    }
}

#[tauri::command]
pub fn collapse_from_dashboard(app: AppHandle) {
    use tauri::LogicalSize;
    use tauri::LogicalPosition;
    if let Some(window) = app.get_webview_window("overlay") {
        if let Ok(Some(monitor)) = window.primary_monitor() {
            let scale = monitor.scale_factor();
            let screen_h = monitor.size().height as f64 / scale;
            let screen_w = monitor.size().width as f64 / scale;
            let x = (screen_w - 460.0) / 2.0;
            let y = (screen_h - 480.0) / 2.0;
            let _ = window.set_size(LogicalSize::new(460.0_f64, 480.0_f64));
            let _ = window.set_position(LogicalPosition::new(x, y));

            // Remove vibrancy so normal dialog is clean on transparent background
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::clear_vibrancy;
                let _ = clear_vibrancy(&window);
            }
        }
    }
}
