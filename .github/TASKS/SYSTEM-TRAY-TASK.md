# DONE: System tray + menu + launch at login

| Field | Value |
|---|---|
| Phase | P5: Polish |
| Priority | Should have |
| Status | Done |
| Est. Effort | Medium (2-4h) |
| Dependencies | Core loop working |

## Description

Add a macOS system tray icon with a right-click menu and register as a login item so TaskFlow starts automatically.

## Requirements

1. **Tray icon** - TBD (design with user). Click shows menu.
2. **Menu items:**
   - Current task name + elapsed time (display only, greyed out). Shows "No active task" when idle.
   - "Dashboard" - opens dashboard (same as Cmd+Shift+D)
   - "Open Today's Log" - opens today's daily log markdown file in Obsidian
   - "Quit TaskFlow" - exits the app
3. **Launch at login** - Register as macOS login item so it starts on boot.
4. **Tooltip** - Show current task name on hover.

## Notes

- Tauri v2 has built-in tray support (`tauri::tray::TrayIconBuilder`)
- Today's log path follows the existing pattern in `daily_log.rs` - `~/.taskflow/logs/YYYY-MM-DD.md`
- Opening in Obsidian: use `open -a Obsidian <path>` or Obsidian's URI scheme `obsidian://open?path=<path>`
- Launch at login: Tauri v2 has `tauri-plugin-autostart` for this
- Task timer data comes from ACTIVE-TASK-TIMER-TASK (can stub with "No active task" until that lands)

## Completion

**Tested by:**
- `cargo build --manifest-path src-tauri/Cargo.toml` — Finished in 37.95s, no errors or warnings
- YAML config verified: `autostart` plugin config added to `tauri.conf.json`
- Tray icon PNGs generated from `taskflow-tray-icon.svg` at 22×22 and 44×44 using PIL
- Code review: lock-before-update pattern in `start_task`/`end_task` confirmed safe (mutex released in inner block before `update_tray_menu` acquires it)

**Unexpected outcomes:**
- `tauri::image::Image::from_bytes()` does not exist in Tauri 2.10.3 without the `image-png` feature flag. Added `image-png` to tauri features in Cargo.toml to enable it.
- `menu_on_left_click()` is deprecated in this version; replaced with `show_menu_on_left_click()`.
- Skipped adding `trayIcon` config block to `tauri.conf.json` (prompt suggested it alongside code setup). In Tauri v2, `trayIcon` in config auto-creates a second tray icon independently of `TrayIconBuilder`. Since the tray is built fully in code, the config entry would create a duplicate. All settings (icon, template flag, tooltip) are set via `TrayIconBuilder` instead.
- SVG→PNG conversion via `cairosvg` failed (cairo library not installed). Used PIL to render the geometric shapes from the SVG directly. The SVG source is preserved at `src-tauri/icons/tray-icon.svg`.

**Follow-up tasks:**
- None

**Confidence:** [8/10] — Build is clean and the code path is correct; runtime behaviour (tray appearing, menu events firing, autostart registering) can only be verified by running the app on macOS.

**Files modified:**
- `src-tauri/src/tray.rs` (new)
- `src-tauri/src/lib.rs`
- `src-tauri/src/commands/task.rs`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- `src-tauri/icons/tray-icon.png` (new, 22×22)
- `src-tauri/icons/tray-icon@2x.png` (new, 44×44)
- `src-tauri/icons/tray-icon.svg` (new, source reference)
- `.github/TASKS/SYSTEM-TRAY-TASK.md`

