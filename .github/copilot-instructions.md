# TaskFlow – Copilot Instructions

## What This Is
A Tauri 2 desktop app for macOS. Rust backend (`src-tauri/`) + vanilla JS/HTML/CSS frontend (`src/`, `index.html`). No React, no component library, no state management library. The app is a floating overlay that coaches structured context switching via a hotkey-triggered state machine.

## Commands

```bash
npx tauri dev       # Start dev (runs Vite + Rust watch in parallel)
npx tauri build     # Build production .app bundle
npm run dev         # Frontend only (Vite at localhost:1420)
```

No test runner or linter is configured yet.

## Architecture

### Frontend → Backend Communication
Tauri IPC via `window.__TAURI__.core.invoke()`. Rust functions decorated with `#[tauri::command]` are registered in `lib.rs` and callable from JS:
```js
await invoke('get_state');        // Returns TaskState JSON
await invoke('start_task', { task: '...' });
await invoke('end_task');
```

### UI State Machine
`index.html` contains six state divs (`#s-listening`, `#s-exit`, `#s-transition`, `#s-entry`, `#s-coaching`, `#s-gate`). Only one is visible at a time via the `.active` class. `TaskFlowApp` in `src/app.js` drives all transitions via `show(stateId)` and `advance()`.

### Backend State
`lib.rs` holds a `Mutex<TaskState>` (current task name, start time, mode). The Rust side also owns the global hotkey (`Cmd+Shift+Space`) and emits an `overlay-opened` event to the frontend when toggled.

### Template System
YAML files in `templates/` define structured workflows (phases, signals, gates). `_schema.yaml` documents the format. Templates are loaded by the JS frontend and rendered into the coaching/gate states. See `templates/pr-amends.yaml` for a working example.

### Window
460×340px, transparent, no decorations, always-on-top, starts hidden. `macOSPrivateApi: true` is set in `tauri.conf.json` for vibrancy support. Dev server is always `localhost:1420` (Vite).

## Conventions

### CSS
- State containers: `#s-{stateName}` IDs
- Components: kebab-case BEM-style (`.mic-row`, `.phase-dot`, `.ol-state`)
- Sections separated by `/* ---- Section Name ---- */` comments
- Frosted glass via `backdrop-filter: blur(...)` + `-webkit-` prefix (required for macOS WebKit)

### JavaScript
- Single class `TaskFlowApp` owns all frontend state and DOM wiring
- camelCase variables; state names match the HTML ID suffixes (`listening`, `exit`, etc.)
- No build-time imports — scripts loaded directly in `index.html`

### Rust
- All Tauri commands in `lib.rs`; `main.rs` is a one-liner delegation
- Shared state wrapped in `Arc<Mutex<T>>`, managed via `.manage()`
- Commented-out dependencies in `Cargo.toml` are intentional (staged for future phases — don't remove them)

## Development Phases
The codebase is structured around phases P0–P5. Currently P0 (skeleton) is complete; P1 (audio/Whisper) is in progress. Uncommenting `cpal`/`hound` in `Cargo.toml` activates audio capture for P1. `reqwest`/`tokio` are staged for P2 (Claude API). Don't add dependencies outside this roadmap without checking the README.
