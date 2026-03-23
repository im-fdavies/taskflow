# Handover Notes — TaskFlow Project

**Session date:** 23 March 2026
**Project:** TaskFlow — Voice-activated context switching system for Mac
**Status:** P0 + P1 complete. P2 in progress (P2a + P2b done, P2c done, UX patches in flight).

---

## Step 0: Context gap warning

This handover covers a build session. The new agent has NOT seen:

- The original design session visualisations (protocol flow diagram, architecture diagram, overlay UX walkthrough)
- The iterative debugging of Tauri 2.x API changes during P0 setup
- Flynn's real-time UX feedback that drove several mid-P2 patches

All design decisions and rationale are captured in the Notion project page. The milestone tracker is up to date. The new agent should read both before making changes.

---

## What was done this session

### P0: Skeleton — COMPLETE

Got the Tauri app running from the scaffold (`taskflow-scaffold.tar.gz`). Several issues hit and resolved during setup:

1. **Rust toolchain missing** — installed via `rustup`
2. **cmake missing** — installed via `brew install cmake`
3. **Missing icon file** — `src-tauri/icons/icon.png` didn't exist, Tauri refused to compile. Created a valid 32x32 PNG placeholder.
4. **Tauri 2.x API mismatch** — scaffold used `tauri::WebviewWindowExt` which doesn't exist in Tauri 2.x. Fixed by importing `tauri::Emitter` instead.
5. **`global-shortcut` plugin config format** — had `"global-shortcut": {}` in tauri.conf.json plugins section. Tauri 2.x expects unit type, not map. Removed the entry.
6. **`withGlobalTauri` not set** — `window.__TAURI__` wasn't being injected. Added `"withGlobalTauri": true` to the app config.
7. **Overlay too transparent** — bumped `.state` background alpha from `0.75` to `0.97` for a near-opaque card.

**Validation:** Overlay renders, Cmd+Shift+Space hotkey works, all six states visible via `app.demo()`. P0 passed.

### P1: Core Loop — COMPLETE

Wired mic capture + whisper.cpp transcription via CLI agent prompt. The agent made changes across 5 files:

- **`lib.rs`** — `transcribe_audio` command: writes WAV to `/tmp/taskflow_audio.wav`, spawns whisper.cpp, parses stdout
- **`app.js`** — `startRecording()` / `stopRecording()` / `_encodeWav()`: Web Audio API → 16kHz mono WAV → Tauri invoke
- **`index.html`** — Recording UI elements (mic dot, status, transcription result, stop button)
- **`styles.css`** — Frosted glass consistent styles for new elements
- **`tauri.conf.json` + `entitlements.plist`** — Mic permission entitlements

**whisper.cpp setup:**
- Built at `~/Documents/GitHub/whisper.cpp/`
- Binary: `./build/bin/whisper-cli`
- Model: `./models/ggml-base.en.bin` (base English, ~147MB)
- Performance: **765ms** for a 6.5s clip on M3 Pro — well under the 2s target

**Validation:** Hotkey → speak → transcription appears in overlay. P1 passed.

### P2: Intelligence — IN PROGRESS

Broken into three sub-tasks, all implemented via CLI agent prompts:

**P2a: Mode Detection + Templates + Protocol Flow — DONE**
- Rule-based mode detection (keyword matching for Full/Light/Urgent)
- Template loading from YAML via Rust (`serde_yaml`)
- Full protocol state flow: LISTENING → EXIT → TRANSITION → ENTRY
- Mode-specific behaviour (firm gate vs skip button vs bookmark)
- Template matching against trigger phrases

**P2b: Claude Haiku API — DONE**
- `generate_clarification_questions` Tauri command
- Calls Anthropic Messages API (claude-haiku-4-5-20251001)
- API key loaded from `ANTHROPIC_API_KEY` env var or `~/.taskflow/config.toml`
- 1-3 context-aware questions displayed in ENTRY state
- Non-blocking — template shows immediately, questions enhance
- 5s timeout, graceful fallback if no key or API error

**P2c: Ollama Fallback — DONE**
- `detect_mode_llm` Tauri command
- Calls Ollama (llama3.1:8b) at localhost:11434 for ambiguous mode detection
- Only fires when rule-based detection returns "default" confidence (no strong keywords)
- 3s timeout, silent fallback to Mode 1 if Ollama unavailable
- Availability check on app startup

### UX Patches Applied (post-P2a feedback)

**Patch: Voice capture in EXIT phase**
- Extracted reusable `VoiceCapture` module from LISTENING state
- Added mic button next to exit textareas — voice and text coexist
- Voice appends to existing text, doesn't replace

**Patch: Post-transcription UX flow**
- After transcription, LISTENING card transforms into CONFIRMED sub-state
- Shows mode badge ("FULL SWITCH" / "QUICK SWITCH" / "URGENT") + extracted task name
- "Not right? Try again" option to re-record
- Mode 3 (Urgent) auto-advances after 1.5s

**Patch: Exit context pre-population**
- Initial transcription parsed for exit context and bookmark info
- EXIT fields pre-populated from what user already said
- "Looks right — skip to next" shortcut when both fields populated

**Patch: Task name extraction fix — IN PROGRESS (last agent prompt sent)**
- Bug: task name was consuming the entire transcription including exit context
- Fix: marker-based semantic splitting (not punctuation-based)
- Splits on phrases like "currently working on", "switching to", "when I come back"
- Example: "Switching to PR amends currently working on Tori invocation" → Task: "PR amends", Exit: "Tori invocation"
- Agent prompt delivered, may or may not be applied yet — verify by testing

---

## Current state of the codebase

### Key files

| File | State |
|------|-------|
| `src-tauri/src/lib.rs` | Tauri commands: `transcribe_audio`, `load_templates`, `get_template`, `generate_clarification_questions`, `detect_mode_llm`, `check_ollama` |
| `src/app.js` | State machine with 6 states, voice capture module, mode detection, template matching, clause extraction (may be mid-fix), Tauri IPC |
| `src/styles.css` | Dark frosted glass theme, all overlay states styled |
| `index.html` | All state containers with recording, exit, transition, entry elements |
| `src-tauri/Cargo.toml` | Dependencies: `serde`, `serde_json`, `serde_yaml`, `reqwest`, `toml`, `tauri` + plugins |
| `src-tauri/tauri.conf.json` | `withGlobalTauri: true`, transparent borderless window, global-shortcut plugin |
| `templates/pr-amends.yaml` | First template — 3 phases, 2 signals, 1 gate |
| `templates/_schema.yaml` | Template format definition |

### External dependencies

| Dependency | Location | Status |
|------------|----------|--------|
| whisper.cpp | `~/Documents/GitHub/whisper.cpp/build/bin/whisper-cli` | Built, working |
| Whisper model | `~/Documents/GitHub/whisper.cpp/models/ggml-base.en.bin` | Downloaded, 147MB |
| Ollama | `brew install ollama` | Installed, llama3.1:8b pulled |
| Anthropic API key | `~/.taskflow/config.toml` or `ANTHROPIC_API_KEY` env var | Configured |

---

## What's next

### Immediate: Verify task name extraction fix

The last agent prompt (patch-fix-task-name-splitting.md) addresses the task name consuming exit context. Test with:
1. "Switching to PR amends currently working on Tori invocation" → Task: "PR amends", Exit: "Tori invocation"
2. "PR amends on the authentication and authorisation refactor" → Task: whole thing, Exit: null
3. "I need to fix the login page and the registration form" → Task: whole thing, Exit: null
4. "Done with the auth refactor, moving on to code review" → Task: "Code review", Exit: "The auth refactor"

### Then: Full P2 validation

Run through the 9-test suite to confirm all P2 functionality:
- Mode 1/2/3 detection with correct protocol flows
- Template matching (PR amends triggers match)
- Clarification questions from Claude API
- Ollama fallback for ambiguous phrases
- Graceful degradation (no API key, Ollama down)
- Voice capture in exit phase
- Exit context pre-population

### After P2 validation: Design decisions needed

Flynn raised two ideas that shift the direction of P3:

1. **Intelligent exit interview** (ticketed, P3, Must have) — Replace static exit prompts with LLM-driven conversational follow-ups. Quality bar: only ask if the answer changes what you'd do on return. Example good question: "Are you creating new tests or fixing broken tests?" Example bad question: "How many tests have you written?"

2. **Agent context bridge** (ticketed, P3, Should have) — Connect TaskFlow to the running Copilot agent/codebase context to auto-generate exit briefs. Could use `/handover` skill or a new dedicated skill. Output: what you've done, what's remaining, things to remember, quick start on return. Needs a design session.

Flynn's feedback: "I think we need to be a little less reliant on templates... it could be like asking questions intelligently, leveraging the LLMs thinking rather than my own." The templates work for ENTRY (approach guidance), but EXIT needs to be conversational and smart.

### P3: Coaching (after P2 validated)

- Intelligent exit interview (LLM-driven follow-ups)
- Agent context bridge (auto-generate exit brief)
- Task timer + signal detection engine
- Signal-triggered coaching prompts during active work
- Completion gates

### P5: Polish tickets (queued)

- Press-hold-release recording trigger (Should have, Medium)
- Voice-reactive waveform animation (Should have, Medium)
- Draggable overlay window (Should have, Small)

---

## Notion resources

- **Project page:** https://www.notion.so/326c4a154cdb81e7a50ccc4b13d3b2b2
- **Milestone tracker:** https://www.notion.so/332189e48e184796afdbb3b130cd6326
  - Data source ID: `ceefbeb8-202e-4c56-8d6c-048954fd2755`

Both are up to date as of this session. P0 and P1 milestones marked Done. P2 milestones still marked Not Started in Notion (should be updated to In Progress / Done as verified).

---

## Key constraints and preferences (unchanged from previous handover)

- "Perfect or I won't use it" — quality bar is high
- Coaching prompts: signal-triggered only, never clock-based
- Templates: 3 phases max, one sentence each
- Local-first for speed, cloud for quality
- No em-dashes in written content (hyphens preferred)
- Prefers agent prompts for CLI over in-chat code generation
- Iterative feedback loop — tests frequently, flags UX issues immediately
