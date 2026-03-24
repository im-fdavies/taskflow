# TaskFlow

Voice-activated context switching system for Mac. Press a hotkey, speak, and the system helps you cleanly exit one task and enter the next — with structured templates, signal-triggered coaching, and daily logging.

**It does not do the work. It coaches the approach.**

## Prerequisites

Before you start, you need:

- **macOS** with Apple Silicon (M1/M2/M3/M4)
- **Rust** — install via [rustup](https://rustup.rs/):
  ```sh
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  ```
- **Node.js** (18+) and **npm** (or pnpm)
- **Xcode Command Line Tools**:
  ```sh
  xcode-select --install
  ```

## Setup

```sh
# Clone or copy the project, then:
cd taskflow

# Install frontend dependencies
npm install

# Install the Tauri CLI
npm install -D @tauri-apps/cli

# Run in development mode
npx tauri dev
```

On first run, Cargo will download and compile all Rust dependencies — this takes a few minutes. Subsequent builds are fast.

## Usage

- **Cmd+Shift+Space** — Toggle the overlay
- **Escape** — Close the overlay
- Speak into it to describe what you're switching to

## Development

The app has two halves:

| Layer | Language | Location | Purpose |
|-------|----------|----------|---------|
| Backend | Rust | `src-tauri/src/` | Hotkey, audio, Whisper, state, API calls |
| Frontend | HTML/CSS/JS | `src/` | Overlay UI, state machine, template rendering |

### Hotkey

Registered in `lib.rs` via `tauri-plugin-global-shortcut`. Default: `Cmd+Shift+Space`. Change in both `lib.rs` and `tauri.conf.json`.

### Window

Configured in `tauri.conf.json` as a transparent, borderless, always-on-top window. The frosted glass effect comes from CSS `backdrop-filter` in `styles.css`. For native macOS vibrancy, add the `window-vibrancy` crate (instructions in `lib.rs`).

### Templates

Stored as YAML files in `templates/`. See `_schema.yaml` for the format. The template selection logic (P2) will match voice input keywords against the `triggers` field.

### Demo mode

Open the browser dev tools console (Cmd+Option+I in the Tauri window) and run:
```js
app.demo()
```
This walks through the full context switch flow: listening → exit → transition → entry with the PR amends template.

## Build milestones

### P0: Skeleton (~8-12h)
- [ ] Tauri project scaffold + dev environment
- [ ] Global hotkey binding
- [ ] Floating overlay window with vibrancy
- [ ] Basic overlay UI (state machine)

### P1: Core Loop (~10-14h)
- [ ] Audio recording from microphone
- [ ] Whisper local transcription
- [ ] End-to-end: hotkey → speak → see transcription

### P2: Intelligence (~15-20h)
- [ ] Rule-based mode detection
- [ ] Ollama setup + Llama 3.1 8B
- [ ] Template storage + selection
- [ ] Claude Haiku API integration
- [ ] Context switch protocol — full flow

### P3: Coaching (~5-8h)
- [ ] Task timer + signal detection
- [ ] Coaching overlay integration
- [ ] Completion gates

### P4: Logging (~6-10h)
- [ ] Daily markdown log
- [ ] Slack webhook morning summary

### P5: Polish (~8-12h)
- [ ] Todo overlay mode — voice shortcut "add [task] to my todo" captures a task directly to a todo list (e.g. linear, markdown file, or system reminders) without triggering a full context switch flow
- [ ] Note overlay mode
- [ ] Additional templates
- [ ] System tray + always-running daemon

## Architecture

```
Hotkey → Voice capture → Whisper (local) → Mode detection (local)
                                              │
                                              ├─ Template selection (local)
                                              └─ Claude Haiku API (cloud)
                                                   ├─ Clarification questions
                                                   ├─ Coaching prompts
                                                   └─ Daily summary
```

Local for speed. Cloud for quality. ~£1-3/month.

## Project plan

Full design spec: https://www.notion.so/326c4a154cdb81e7a50ccc4b13d3b2b2
