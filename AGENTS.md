# AGENTS.md

Guidance for AI coding agents (Claude Code, Copilot, and similar) working in this repository.

## What this is

TaskFlow is a Tauri 2 desktop overlay for macOS (Apple Silicon). A global hotkey pops a floating,
frameless, always-on-top window; you type what you're switching to and the app coaches a clean
context switch (exit the old task, enter the new one) using YAML templates, then logs the day to
markdown. Rust backend (`src-tauri/`) + vanilla JS/HTML/CSS frontend (`src/`, `index.html`). No
framework, no component library, no state-management library. Input is typed - there is no audio /
speech-to-text; the old voice/whisper path has been removed.

## Commands

```bash
npx tauri dev        # run the app: Vite (localhost:1420) + Rust watch in parallel
npx tauri build      # production .app bundle
npm run dev          # frontend only (Vite, no Rust)
npm run rust:check   # cargo build --manifest-path src-tauri/Cargo.toml (fast Rust check)

npm test             # vitest run (8 files, 114 tests)
npm run test:watch   # vitest watch
npx vitest run src/__tests__/todoDigest.test.js   # single test file
cargo test --manifest-path src-tauri/Cargo.toml   # Rust unit tests (e.g. todos.rs tag parsing)

npm run slack-summary   # manual morning Slack summary (reads ~/.taskflow/config.toml)
```

Dev server is always `localhost:1420` (strict port). Requires local Ollama (`llama3.1:8b`) for the
LLM mode-detection fallback: `npm run ollama:pull`, `npm run ollama:serve`.

## Runtime state lives outside the repo

- `~/.taskflow/config.toml` - user config. Tables (all optional): `[api].anthropic_key`,
  `[project].active_path`, `[logs].path`, `[slack].webhook_url`. A missing/empty file is valid and
  degrades to all-None. Parse errors are silently swallowed (`.ok()`/`unwrap_or_default()`).
- `~/.taskflow/logs/YYYY-MM-DD.md` - the daily markdown log; the app's real database (see below).
- `~/.taskflow/jira-cache.json` - cached Jira tickets.
- API key resolution: env `ANTHROPIC_API_KEY` (non-empty) wins over `[api].anthropic_key`.

## Architecture

### The context-switch flow

```
Cmd+Shift+Space -> Rust open_overlay -> emits "overlay-opened"
  -> JS focuses #listening-input; user types + Enter
  -> showConfirmation() runs an intent ladder BEFORE mode detection:
       note / task-note / todo / completion intents each short-circuit (write + return)
  -> else detectMode() (rule-based; Ollama fallback only when confidence=="default")
       + matchTemplate() + parseTranscription()
  -> exit -> transition -> entry   (or completion for mode 4)
```

Four modes, stored in both `this.mode` and `this._session.mode` (keep them in sync):
1 = **Full** (firm gate, default when ambiguous), 2 = **Light** (auto-advances ~1.5s),
3 = **Urgent** (bookmark only, auto-advances after 1.5s), 4 = **Completion** (mode 4 is "virtual" -
never in the STATES array; routes to the completion flow, forces taskName = current active task).

### Backend (`src-tauri/src/`)

- `main.rs` is a one-liner into `lib.rs::run()`. `lib.rs` is the wiring hub only: plugin init,
  `.manage(AppState)`, the `generate_handler![...]` command list, two global-hotkey registrations,
  tray setup, and startup restore of the active task + pending timers from today's log.
- **Commands are modularized** under `src-tauri/src/commands/*.rs` (task, daily_log, todos,
  templates, llm, agent_context, window, jira, timers, lessons), glob-re-exported via
  `commands/mod.rs`. **Adding a command means editing two places: the submodule AND the
  `generate_handler!` list in `lib.rs`.**
- `AppState` (in `state.rs`) has 4 `Mutex` fields: `task`, `ollama_available: Option<bool>` (cached
  after first Ollama probe - restart to re-detect), `timers: HashMap`, and `file_lock: Mutex<()>`
  (serializes all read-modify-write on the daily log). All plain `Mutex` (no `Arc`; Tauri owns the
  `AppHandle`). Rebuild the tray menu only after releasing the task lock (deadlock risk).
- Two global hotkeys (both registered in `lib.rs`): **Cmd+Shift+Space** -> `open_overlay`,
  **Cmd+Shift+D** -> `toggle_dashboard`. (Local vars are misnamed `ctrl_*`; the modifier is Cmd/SUPER.)
- `helpers/config.rs` (config + key resolution) and `helpers/markdown.rs` (daily-log persistence).

### Daily markdown log = the database (`helpers/markdown.rs`)

One file per day. Fixed H1 sections in order: `# {date} - Daily Log`, `# Summary`, `# Open Tasks`,
`# Todos`, `# Timers`, `# Completed Work`. Entries are H3 blocks: `### HH:MM - Name [type]`. An
em-dash (`\u{2014}`) is the sentinel for an empty metadata field. Parsing is line-oriented, not a
real AST. Gotchas that bite:

- **"Read" commands can write.** `read_and_normalize_log` self-heals missing sections and rewrites
  the file - a read is not side-effect-free. `file_lock` guards mutations; read-only parsers don't lock.
- Two parsers coexist for the same data (pulldown-cmark byte offsets for insertion; naive line
  matching for extraction) and neither is fenced-code-block aware - a `#`-line inside ``` fences is
  mistaken for a section boundary.
- The Rust log format is coupled to JS parsers. `left-panel.js` note rendering splits on the exact
  markdown the Rust side writes (`- 📝`, `- **`); changing the format on one side breaks the other.

### LLM strategy (`commands/llm.rs`)

Two-tier, both silent-fail (return `None`/`[]`/fallback rather than erroring the UI):
- **Claude Haiku** (`claude-haiku-4-5-20251001`, HTTPS) for text: `generate_clarification_questions`
  (5s timeout) and `generate_exit_question` (3s). Missing API key returns empty, not an error.
- **Ollama** (`llama3.1:8b`, `localhost:11434`) for cheap mode classification: `check_ollama` (2s,
  result cached in `AppState`), `detect_mode_llm` (3s, defaults to mode 1 on any failure).

### Frontend (`src/js/`)

- `app.js` = the singleton `TaskFlowApp` class: the UI state machine + all Tauri IPC + per-invocation
  session lifecycle. Booted at the bottom as `window.app` - **inline `onclick="app.foo()"` in
  index.html depends on that global**; don't stop exposing it.
- State machine: `show(state)` toggles `.active` on `#s-{state}` divs. States: `listening`, `exit`,
  `transition`, `entry`, `completion`, `coaching`, `gate`, `notification`, `dashboard` (+ a fixed
  `#s-dashboard-left` panel). Only one is active. `this._session` holds all per-capture data and is
  reset inside `show('listening')`.
- **Per-flow modules** (`start-flow`, `exit-flow`, `entry-flow`, `completion-flow`, `dashboard`,
  `left-panel`) export plain standalone functions. `app.js` imports each (underscore-aliased, e.g.
  `_showExitState`) and wraps it in a thin instance method that injects `this._session` + callback
  closures like `(s) => this.show(s)`. Not prototype patching / mixins. To trace a flow you must open
  its module - the class body alone is not enough. Panel modules also call `window.app.*` directly.
- `logic.js` is **pure** (no DOM, no IPC): `detectMode`, `parseTranscription` + `MARKERS`,
  `matchTemplate`, and the intent detectors. This split exists so `src/__tests__/` can unit-test it.
  `app.js` re-exposes each as a thin forwarding method.
- IPC: `const { invoke } = window.__TAURI__.core` (Tauri 2 - never `window.__TAURI__.invoke`). JS
  args are camelCase and map to Rust snake_case. Rust->JS events (`overlay-opened`,
  `dashboard-toggle`, `notification-fired`) arrive via `listen()`.

### Templates (`templates/*.yaml`)

Data-driven workflows loaded via `load_templates` (skips `_schema.yaml` / underscore files).
`_schema.yaml` is the authoritative spec (max 3 phases, one sentence of guidance each, every signal
needs a `condition` not just a timer, gates only before irreversible actions). `pr-amends.yaml` is
the reference. `matchTemplate` is substring, case-insensitive, on the `triggers` array.

### Integrations

- **Jira** (`commands/jira.rs`): `refresh_jira_cache` shells out to the `claude` CLI with
  `--permission-mode bypassPermissions` + the Atlassian MCP tool, feeds a JQL prompt on stdin
  (hardcoded cloudId), writes `jira-cache.json`; falls back to the existing cache on failure. No
  subprocess timeout.
- **Slack morning summary** (`scripts/*.mjs`, plain Node ESM, no deps, `fetch`, Node 18+): local
  variant reads `config.toml` + local logs; cloud variant reads env + Dropbox and runs on the GitHub
  Actions cron `.github/workflows/slack-summary.yml` (`45 9 * * 1-5`, UTC - not BST-adjusted). Both
  share `todo-digest.mjs` (pure, dependency-injected; also unit-tested).

## Conventions

- **CSS**: `src/styles.css` is only an `@import` aggregator with a load-bearing order - `base.css`
  first (defines `.state`, keyframes, form controls), per-state partials next, `dashboard.css` LAST
  so its overrides win. index.html loads exactly one stylesheet. Naming is BEM-ish/utility-hybrid
  (`dashboard-*`, `exit-*`, `ol-*`, `mode-badge.mode-*`); state modifiers are appended classes
  (`.active`, `.visible`). Colors are hard-coded `rgba()` literals (no design tokens). Interactive
  elements opt out of the Tauri drag region with `-webkit-app-region: no-drag`. "Frosted glass" is
  mostly faked with near-opaque backgrounds + borders; real `backdrop-filter: blur()` survives only
  on a couple of footers and the note textarea.
- **JS**: one class owns the state machine + session; feature behaviour lives in the per-flow
  modules. Visibility is split between `.active` classes and inline `style="display:none"` flipped by
  JS - check both HTML and app.js.
- **Rust**: `#[tauri::command(rename_all = "camelCase")]`. Some read commands have an `_internal`
  twin callable from `lib.rs` setup without Tauri `State`.

## Gotchas worth knowing

- In-memory timers + their spawned tokio sleeps do not survive a restart; only the log entry
  persists (`**Status:** pending`). Startup re-spawns pending timers by re-parsing today's log.
- `detect_mode_llm` can return mode 4 (COMPLETE) but `daily_log.rs`'s `mode_label` only maps 1-3.
- Frontend duration is computed by diffing `HH:MM` strings against `new Date()`; cross-midnight or
  clock changes yield `null`, not a correct value.
