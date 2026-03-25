# TaskFlow Codebase Architecture Audit

## Executive Summary

TaskFlow is a Tauri 2 desktop overlay (Rust + vanilla JS/HTML/CSS) that coaches structured context switching via a hotkey-triggered state machine. The codebase is **early-stage but well-structured** with clear separation between Rust backend and frontend. The main architectural concern is **monolithic files**: `lib.rs` (1,516 lines, 45 functions), `app.js` (1,975 lines, 77 methods), and `styles.css` (1,152 lines). All three need modularization. Security and dependency hygiene are good.

**Overall Score: 7/10** — Strong foundation, needs modular decomposition before further growth.

---

## Part 1: Current State Assessment

### File Inventory

| File | Lines | Complexity | Primary Responsibility |
|------|-------|-----------|----------------------|
| `src/app.js` | 1,975 | 🔴 5/5 | **Everything** — state machine, voice, dashboard, parsing, LLM, DOM, corrections |
| `src-tauri/src/lib.rs` | 1,516 | 🔴 5/5 | **Everything** — 28 Tauri commands, config, logs, AI, window mgmt, templates |
| `src/styles.css` | 1,152 | 🟠 4/5 | All UI styling across 8 states + dashboard |
| `index.html` | 235 | 🟢 2/5 | 8 state containers + dashboard panel |
| `src/voice-capture.js` | 106 | 🟢 1/5 | Audio capture + WAV encoding (clean, single-purpose) |
| `templates/_schema.yaml` | 36 | 🟢 1/5 | Template format spec |
| `templates/pr-amends.yaml` | 48 | 🟢 1/5 | PR workflow template |
| `vite.config.js` | 12 | 🟢 1/5 | Dev server config |

### Dependency Graph

```
index.html
  └─ src/app.js (module)
       ├─ src/voice-capture.js (import)
       ├─ window.__TAURI__.core.invoke  → lib.rs (28 commands)
       └─ window.__TAURI__.event.listen → lib.rs (events)

lib.rs
  ├─ AppState { task: Mutex<TaskState>, ollama_available: Mutex<Option<bool>> }
  ├─ External: whisper-cli (shell), Claude API (reqwest), Ollama API (reqwest)
  ├─ Filesystem: ~/.taskflow/{config.toml, vocabulary.yaml, corrections.yaml, logs/}
  └─ Templates: ./templates/*.yaml
```

No circular dependencies. Dependency flow is strictly: HTML → JS → Tauri IPC → Rust → External Services/Filesystem.

### Issues Identified

| # | Issue | Severity | Category |
|---|-------|----------|----------|
| 1 | `app.js` is 1,975 lines with 77 methods in one class | 🔴 Critical | Architecture |
| 2 | `lib.rs` is 1,516 lines with 45 functions in one file | 🔴 Critical | Architecture |
| 3 | `styles.css` is 1,152 lines with 24 sections | 🟠 High | Architecture |
| 4 | Dual transcription state (`this.transcription` + `this._session.transcription`) | 🟠 High | Data consistency |
| 5 | 16 scattered instance variables on TaskFlowApp | 🟠 High | State management |
| 6 | 7 `.unwrap()` calls in Rust (mutex + path) | 🟠 High | Reliability |
| 7 | 8× `.catch(() => {})` silent error swallowing in JS | 🟡 Medium | Error handling |
| 8 | `generate_clarification_questions` and `generate_exit_question` share ~80% code | 🟡 Medium | DRY violation |
| 9 | Log file path construction repeated 6+ times in Rust | 🟡 Medium | DRY violation |
| 10 | 126 hardcoded DOM selectors scattered across methods | 🟡 Medium | Fragility |
| 11 | `ScriptProcessor` (deprecated Web Audio API) in voice-capture.js | 🟡 Medium | Future-proofing |
| 12 | `pulldown-cmark-to-cmark` dependency unused in code | 🟢 Low | Dead dependency |
| 13 | CSP disabled in tauri.conf.json | 🟢 Low | Security |
| 14 | No tests, no CI/CD | 🟢 Low | Quality infrastructure |
| 15 | Hardcoded whisper-cli path | 🟢 Low | Portability |

---

## Part 2: Proposed Modular Architecture

### Rust Backend — Split lib.rs into Modules

```
src-tauri/src/
├── main.rs                    # Entry point (unchanged)
├── lib.rs                     # run() + AppState + module declarations only (~80 lines)
├── commands/
│   ├── mod.rs                 # Re-export all command modules
│   ├── task.rs                # get_state, set_mode, start_task, end_task
│   ├── audio.rs               # transcribe_audio
│   ├── daily_log.rs           # append_daily_log, append_completion_log, read_daily_*
│   ├── todos.rs               # append_todo_entry, update_todo_entry, complete_todo_entry, discard_todo_entry
│   ├── templates.rs           # load_templates, get_template
│   ├── vocabulary.rs          # get_vocabulary, add_vocabulary_term, get/add_correction
│   ├── llm.rs                 # generate_clarification_questions, generate_exit_question, detect_mode_llm, check_ollama
│   ├── agent_context.rs       # read_agent_context, read_completion_context
│   └── window.rs              # hide_overlay, expand_for_dashboard, collapse_from_dashboard
├── helpers/
│   ├── mod.rs
│   ├── config.rs              # load_config, load_api_key
│   ├── markdown.rs            # find_section_byte_offset, extract_section, ensure_log_sections, daily_log_skeleton
│   ├── corrections.rs         # apply_corrections, regex_lite_escape, load/save corrections
│   ├── http_client.rs         # Shared Claude/Ollama HTTP client builder
│   └── paths.rs               # Log path, vocabulary path, corrections path helpers
└── state.rs                   # AppState, TaskState structs
```

**Rationale:** Each command module maps to a responsibility cluster identified in analysis. Helpers extract the repeated patterns (HTTP client, markdown parsing, file I/O). `state.rs` centralizes the shared state definition.

### Frontend JS — Split app.js into Modules

```
src/
├── app.js                     # TaskFlowApp shell: constructor, init(), show(), close() (~200 lines)
├── voice-capture.js           # Unchanged (already clean)
├── state-machine.js           # State transitions, advance(), refreshState()
├── mode-detection.js          # detectMode(), _parseTranscription(), MARKERS array
├── dashboard.js               # showDashboard(), _refreshDashboardTodos(), dashboardVoiceTap(), todo CRUD
├── exit-flow.js               # showExitState(), submitExit(), skipExit(), _toggleExitVoice()
├── entry-flow.js              # showEntryState(), _fetchClarificationQuestions(), template matching
├── completion-flow.js         # showCompletionState(), submitCompletion(), _loadCompletionContext()
├── transcription-editor.js    # _renderClickableTranscript(), _startWordEdit(), word selection/correction
├── waveform.js                # populateWaveform(), startWaveform(), stopWaveform()
└── dom-refs.js                # Centralized DOM element cache (getElementById once, export refs)
```

**Key design decisions:**
- `dom-refs.js` queries all elements once at init, exports a frozen object → eliminates 126 scattered `getElementById` calls
- Each flow module exports functions that receive the app session/state as parameters (no class inheritance)
- `app.js` imports all modules and wires them together as the orchestrator

### CSS — Split by State

```
src/
├── styles/
│   ├── base.css               # Reset, overlay container, typography scale, color variables, shared components
│   ├── buttons.css            # .btn, .btn-primary, .btn-context, .btn-sm
│   ├── listening.css          # #s-listening, mic, waveform, recording status
│   ├── exit.css               # #s-exit, textarea, voice input, interview nudge
│   ├── transition.css         # #s-transition, auto-advance
│   ├── entry.css              # #s-entry, phases, clarification
│   ├── completion.css         # #s-completion layout
│   ├── coaching.css           # #s-coaching, #s-gate, signal boxes
│   ├── dashboard.css          # #s-dashboard, backdrop, todos, pills
│   └── corrections.css        # Word tokens, inline editing
├── styles.css                 # @import aggregator (or Vite handles this)
```

**Key improvement:** Extract CSS custom properties for the color system into `base.css`:
```css
:root {
  --c-indigo: 99, 102, 241;
  --c-red: 239, 68, 68;
  --c-teal: 20, 184, 166;
  --c-cyan: 6, 182, 212;
  --c-amber: 234, 179, 8;
  /* Usage: rgba(var(--c-indigo), 0.12) */
}
```

---

## Part 3: Refactoring Plan

### Phase 1 — Rust Module Extraction (Low Risk) ✅ DONE

> Completed 2026-03-25. Commit `7e01e69`. `lib.rs` → 95 lines + 16 module files. `cargo build` passes.

**Steps:**
1. ✅ Create `src-tauri/src/state.rs` — `AppState`, `TaskState` structs
2. ✅ Create `src-tauri/src/helpers/` — `config.rs`, `vocabulary.rs`, `markdown.rs`, `corrections.rs`
3. ✅ Create `src-tauri/src/commands/` — 9 command modules (`task`, `audio`, `daily_log`, `todos`, `templates`, `vocabulary`, `llm`, `agent_context`, `window`)
4. ✅ Update `lib.rs` to declare modules and re-export for `generate_handler!`
5. ✅ `cargo build` — zero behavior change confirmed

### Phase 2 — CSS Split (Zero Risk) ✅ DONE

> Completed 2026-03-25. Commit `7a5b6df`. `styles.css` → `@import` aggregator + 10 module files. `npx vite build` passes.

**Steps:**
1. ✅ Create `src/styles/` directory
2. ✅ Split `styles.css` by section comments into 10 files: `base`, `buttons`, `listening`, `exit`, `transition`, `entry`, `completion`, `coaching`, `corrections`, `dashboard`
3. ✅ Create aggregator `styles.css` with `@import` statements (Vite resolves at build time)
4. ✅ `index.html` unchanged — still references `/src/styles.css`
5. CSS custom properties extraction deferred to Phase 4 (quality fixes)
6. Visual regression check requires `npx tauri dev` — build verified via `npx vite build`

### Phase 3 — JS Module Extraction (Medium Risk)

**Steps:**
1. Create `src/dom-refs.js` — centralize all `getElementById` calls into a single init function
2. Extract `src/mode-detection.js` (pure functions, no DOM) — easiest to test
3. Extract `src/waveform.js` (self-contained animation)
4. Extract flow modules one at a time: `dashboard.js` → `exit-flow.js` → `entry-flow.js` → `completion-flow.js`
5. Extract `src/transcription-editor.js` last (most DOM-coupled)
6. Slim `app.js` to orchestrator (~200 lines)

**Safe commit point:** After each module extraction. Test by opening app and running through the flow.

### Phase 4 — Code Quality Fixes (Low Risk)

**Steps:**
1. Replace 7 `.unwrap()` with `.expect("context")` or proper error handling in Rust
2. Extract shared Claude API helper in Rust (deduplicate `generate_clarification_questions` / `generate_exit_question`)
3. Extract log path helper (deduplicate 6 path constructions)
4. Consolidate `this.transcription` / `this._session.transcription` to single source of truth
5. Replace `.catch(() => {})` with `.catch(e => console.warn(...))` for debuggability
6. Remove unused `pulldown-cmark-to-cmark` dependency

---

## Part 4: Simplification Recommendations

### Dead Code to Remove
- `pulldown-cmark-to-cmark` crate (documented but grep finds zero usage in code)
- Verify `tauri-plugin-shell` is actually used (whisper invocation may use `std::process::Command` instead)

### Patterns to Replace

| Current | Proposed | Impact |
|---------|----------|--------|
| 7× `mutex.lock().unwrap()` | `mutex.lock().expect("state lock poisoned")` | Clearer panic messages |
| 6× log path construction | `fn log_path_for(date: &str) -> PathBuf` helper | DRY, single place to change |
| 2× Claude API setup (91 + 98 lines) | `async fn call_claude(prompt, system, timeout) -> Option<String>` | ~100 lines saved |
| 8× `.catch(() => {})` | `.catch(e => console.warn('[TF]', e))` | Debuggability |
| 126× `document.getElementById(...)` | `dom-refs.js` init-once cache | Fragility reduction |
| Dual `this.transcription` + `this._session.transcription` | Single `this._session.transcription` | Data consistency |
| `ScriptProcessor` (deprecated) | `AudioWorkletNode` | Future-proofing (non-urgent) |

### Missing Infrastructure
- **Tests:** At minimum, unit tests for `_parseTranscription()` and `detectMode()` (pure functions, easy to test)
- **CI:** GitHub Actions for `cargo build` + `npm run build` on PR
- **CSP:** Enable a restrictive Content Security Policy in `tauri.conf.json`

### What NOT to Change
- The single-class `TaskFlowApp` pattern is fine as an orchestrator after extracting modules
- `AppState` with `Mutex` is correct for Tauri (no `Arc` needed)
- Commented-out Cargo deps are intentional roadmap markers — keep them
- No media queries is correct for a fixed-size overlay
- The color system is systematic despite 192 rgba values — but extract to CSS vars

---

## Risk Assessment

| Refactoring Phase | Risk | Mitigation |
|-------------------|------|------------|
| Rust module split | Low | Compiler catches all import errors. Zero behavior change. |
| CSS split | Zero | Pure file reorganization. Visual regression check. |
| JS module split | Medium | No test suite. Manual testing required for each state flow. |
| Code quality fixes | Low | Each fix is isolated and independently verifiable. |

**Recommended order:** Phase 2 (CSS) → Phase 1 (Rust) → Phase 4 (quality) → Phase 3 (JS)

Start with the zero-risk CSS split to build momentum, then Rust (compiler-verified), then quality fixes while the code is still familiar, then the JS split last (highest risk, benefits most from the quality fixes being done first).
