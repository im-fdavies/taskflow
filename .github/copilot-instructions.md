# TaskFlow – Copilot Instructions

## What This Is
A Tauri 2 desktop app for macOS. Rust backend (`src-tauri/`) + vanilla JS/HTML/CSS frontend (`src/`, `index.html`). No React, no component library, no state management library. The app is a floating overlay that coaches structured context switching via a hotkey-triggered state machine.

## Commands

```bash
npx tauri dev       # Start dev (Vite at localhost:1420 + Rust watch in parallel)
npx tauri build     # Build production .app bundle
npm run dev         # Frontend only (Vite at localhost:1420, no Rust)
cargo build --manifest-path src-tauri/Cargo.toml   # Rust only (fast warning check)
```

No test runner or linter is configured.

## Architecture

### The Full Flow
```
Hotkey (Cmd+Shift+Space)
  → Rust emits "overlay-opened" event
  → JS shows #s-listening, starts recording
  → User speaks → VoiceCapture encodes 16kHz mono WAV in-browser
  → WAV bytes sent to Rust via invoke('transcribe_audio')
  → Rust shells out to whisper-cli with ggml-base.en model (~300ms on M3 Pro)
  → JS receives text → _parseTranscription() extracts taskName + exitContext
  → detectMode() → rule-based first, Ollama fallback if confidence=="default"
  → showExitState() → fires _fetchExitQuestion() + _checkAgentContext() in parallel
  → User fills EXIT → showTransitionState() → showEntryState()
```

### UI State Machine
`index.html` has six state divs (`#s-listening`, `#s-exit`, `#s-transition`, `#s-entry`, `#s-coaching`, `#s-gate`). Only one is `.active` at a time. `TaskFlowApp.show(stateName)` controls this. All session data lives in `this._session` on the class instance and is reset when returning to `listening`.

### Context Switch Modes
Mode is detected per-invocation and stored in `this._session.mode`:
- **Mode 1 (Full)** — firm gate, full EXIT + ENTRY protocol. Default when confidence is ambiguous.
- **Mode 2 (Light)** — soft nudge, user can skip steps. Triggered by "finished", "done with", "same PR", overlap with current task name.
- **Mode 3 (Urgent)** — bookmark only, auto-advances after 1.5s with progress bar. Triggered by "urgent".

Rule-based detection runs first. If `confidence === "default"`, Ollama (`llama3.1:8b`) is called as fallback via `invoke('detect_mode_llm')`. If Ollama is unavailable, Mode 1 is used.

### `_parseTranscription(text)` — How Task Names Are Extracted
Uses a MARKERS array of regex patterns to split the utterance into typed segments (`entry`, `exit`, `bookmark`, `mode_signal`, `pre`). Priority order for task name: `entry` segment → `mode_signal` remainder → unclassified → pre-marker text → full text. Exit context pre-populates the EXIT state textarea. More specific MARKERS must come before general ones in the array.

### Frontend → Backend IPC
All calls use `window.__TAURI__.core.invoke()` (destructured as `invoke` at the top of `app.js`). Never use `window.__TAURI__.invoke` — that's the Tauri 1 API.

```js
invoke('get_state')                          // → TaskState JSON
invoke('start_task', { name })               // → TaskState JSON
invoke('transcribe_audio', { wavData })      // → string (transcription)
invoke('detect_mode_llm', { text, currentTask })  // → { mode, reason }
invoke('generate_clarification_questions', { taskName, template, transcription })  // → string[]
invoke('generate_exit_question', { taskName, transcription, mode })  // → string | null
invoke('read_agent_context')                 // → string | null
invoke('load_templates')                     // → object[]
```

### Backend
All Tauri commands are in `lib.rs`; `main.rs` is a one-liner. Shared mutable state is `AppState { task: Mutex<TaskState> }` registered via `.manage()`. The global hotkey is registered in `.setup()` and calls `toggle_overlay()`, which shows/hides the window and emits `"overlay-opened"` to the frontend.

Config is loaded from `~/.taskflow/config.toml` via `load_config()` → `Config { api, project }`. API key also reads from `ANTHROPIC_API_KEY` env var (takes priority).

Claude API model ID: `claude-haiku-4-5-20251001`. All Haiku calls have a 3s timeout and silent-fail (`Option<T>` or fallback).

### Template System
YAML files in `templates/` define workflows. `_schema.yaml` is the authoritative format spec. Key rules: 3 phases max, one sentence of guidance each, every signal must have a `condition` (never just a timer), gates only before irreversible actions. `pr-amends.yaml` is the reference implementation.

Templates are loaded at startup via `invoke('load_templates')` and matched client-side against `triggers` phrases using `matchTemplate()`.

### Agent Context Bridge
`invoke('read_agent_context')` reads `.github/handover-notes.md` from the `active_path` set in `~/.taskflow/config.toml`. Skips if the file is older than 8 hours. Extracts "what's next" and "what was done" sections (600 char cap each). Update `[project] active_path` in config when switching projects.

## Conventions

### CSS
- State containers: `#s-{stateName}` IDs
- Components: kebab-case BEM-style (`.mic-row`, `.phase-dot`, `.ol-state`)
- Sections separated by `/* ---- Section Name ---- */` comments
- Frosted glass via `backdrop-filter: blur(...)` + `-webkit-` prefix (required for macOS WebKit)
- `#s-exit.active` uses flex-column layout; `.state-body` scrolls; `.footer` is pinned with its own background to prevent bleed-through on scroll

### JavaScript
- Single class `TaskFlowApp` owns all frontend state and DOM wiring
- `this._session` object holds all per-invocation data; reset in `show('listening')`
- State names match the HTML ID suffixes: `listening`, `exit`, `transition`, `entry`, `coaching`, `gate`
- No build-time module bundling for `app.js` — loaded directly in `index.html` as a module. `voice-capture.js` is the only import.

### Rust
- All Tauri commands in `lib.rs`; `main.rs` is a one-liner delegation
- Shared state wrapped in `Mutex<T>`, managed via `.manage()` (no `Arc` needed — Tauri owns the `AppHandle`)
- Commented-out dependencies in `Cargo.toml` are intentional (staged for future phases — do not remove them)
- New async commands need to be added to `tauri::generate_handler![]` in `run()`

### Window
460×480px, transparent, no decorations, always-on-top, starts hidden. `macOSPrivateApi: true` + `withGlobalTauri: true` in `tauri.conf.json`. Dev server is always `localhost:1420`.

## Development Phases
P0 (skeleton) and P1 (audio/Whisper) are complete. P2 (intelligence: mode detection, templates, Claude API, Ollama) is complete. P3 (coaching: intelligent exit interview, agent context bridge) is in progress.

Commented-out deps in `Cargo.toml`: `cpal`/`hound` for P1 audio (not needed — WAV encoding is done in JS). `reqwest`/`tokio` are active for P2. Do not add dependencies outside this roadmap without checking the README.

## Demo Mode
Open browser devtools in the Tauri window (`Cmd+Option+I`) and run:
```js
app.demo()
```
Walks the full flow: listening → exit → transition → entry with the PR amends template.
