// ===================================================================
// TaskFlow — Overlay App
// State machine + Tauri IPC + UI logic
// ===================================================================

import { VoiceCapture } from './voice-capture.js';
import { detectMode as _detectMode, parseTranscription, matchTemplate as _matchTemplate, parseTodoIntent } from './logic.js';
import { populateWaveform, startWaveform, stopWaveform } from './waveform.js';
import { renderClickableTranscript } from './transcription-editor.js';
import {
  showCompletionState as _showCompletionState,
  submitCompletion as _submitCompletion,
  skipCompletion as _skipCompletion,
  copyCompletionSkill as _copyCompletionSkill,
  refreshCompletionContext as _refreshCompletionContext,
} from './completion-flow.js';
import {
  showDashboard as _showDashboard,
  refreshDashboardTodos,
  dashboardVoiceTap as _dashboardVoiceTap,
  dismissTodoAdded as _dismissTodoAdded,
  setLastAddedTodo,
} from './dashboard.js';

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// -------------------------------------------------------------------
// State machine
// -------------------------------------------------------------------

const STATES = [
  "listening",
  "exit",
  "transition",
  "entry",
  "completion",
  "coaching",
  "gate",
  "dashboard",
];

class TaskFlowApp {
  constructor() {
    this.currentState = "listening";
    this.pendingTask = null;
    this.transcription = "";
    this.mode = 1; // 1 = full, 2 = light, 3 = urgent
    this._lastAmplitude = 0;

    // Audio recording — LISTENING state
    this._voiceCapture = new VoiceCapture({
      onStateChange: (isRec) => {
        const micDot = document.getElementById('mic-dot');
        if (micDot) micDot.classList.toggle('idle', !isRec);
      },
      onAmplitude: (rms) => {
        this._lastAmplitude = rms;
      },
      onError: (msg) => {
        const status = document.getElementById('recording-status');
        if (status) { status.textContent = `⚠ ${msg}`; status.style.display = 'block'; }
      },
    });

    // Audio recording — EXIT state (main notes)
    this._exitVoiceCapture = new VoiceCapture({
      onStateChange: (isRec) => this._updateExitMicBtn('exit-mic-btn', isRec),
      onAmplitude: () => {},
      onError: (msg) => console.error('Exit voice error:', msg),
    });

    // Audio recording — EXIT state (bookmark)
    this._exitBookmarkVoiceCapture = new VoiceCapture({
      onStateChange: (isRec) => this._updateExitMicBtn('exit-bookmark-mic-btn', isRec),
      onAmplitude: () => {},
      onError: (msg) => console.error('Exit bookmark voice error:', msg),
    });

    // Audio recording — DASHBOARD state (push-to-talk)
    this._dashboardVoiceCapture = new VoiceCapture({
      onStateChange: () => {},
      onAmplitude: () => {},
      onError: (msg) => console.error('Dashboard voice error:', msg),
    });

    // P2a: template cache and current session
    this._templates = [];
    this._ollamaAvailable = false;
    this._session = {
      mode: 1,
      confidence: "default",
      transcription: "",
      taskName: "",
      exitCapture: "",
      template: null,
      extractedExit: null,
      extractedBookmark: null,
    };

    this.init();
  }

  async init() {
    // Load templates at startup
    await this.loadTemplates();

    // Check if Ollama is available for LLM mode detection fallback
    try {
      this._ollamaAvailable = await invoke("check_ollama");
      if (this._ollamaAvailable) {
        console.log("[TaskFlow] Ollama available — LLM fallback enabled");
      } else {
        console.warn("[TaskFlow] Ollama not available — using rule-based detection only");
      }
    } catch (e) {
      console.warn("[TaskFlow] Ollama check failed:", e);
      this._ollamaAvailable = false;
    }

    // Listen for overlay open event from Rust
    await listen("overlay-opened", () => {
      this.show("listening");
      startWaveform("waveform", () => this._lastAmplitude);
      this.startRecording();
    });

    // Listen for dashboard open event from Rust (Cmd+Shift+D)
    await listen("dashboard-opened", () => {
      this.showDashboard();
    });

    // Clicking the frosted backdrop closes the dashboard
    const dashboardBackdrop = document.getElementById("dashboard-backdrop");
    if (dashboardBackdrop) {
      dashboardBackdrop.addEventListener("click", (e) => {
        if (e.target === dashboardBackdrop && this.currentState === "dashboard") {
          this.close();
        }
      });
    }

    // Dashboard pill toggle (priority/reminder selectors)
    document.querySelectorAll('.dashboard-pill-group').forEach(group => {
      group.addEventListener('click', (e) => {
        const pill = e.target.closest('.dashboard-pill');
        if (!pill) return;
        // Toggle: if already active, deactivate. Otherwise activate and deactivate siblings.
        if (pill.classList.contains('active')) {
          pill.classList.remove('active');
        } else {
          group.querySelectorAll('.dashboard-pill').forEach(p => p.classList.remove('active'));
          pill.classList.add('active');
        }
      });
    });

    // Escape key closes the overlay
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.close();
      }
      if (e.key === 'Enter') {
        // If exit voice is recording, Enter stops it
        if (this._exitVoiceCapture.isRecording()) {
          this._toggleExitVoice('exit-notes', this._exitVoiceCapture, 'exit-mic-btn');
          return;
        }
        if (this._exitBookmarkVoiceCapture.isRecording()) {
          this._toggleExitVoice('exit-bookmark', this._exitBookmarkVoiceCapture, 'exit-bookmark-mic-btn');
          return;
        }
        // Don't intercept Enter inside exit textareas
        const activeId = document.activeElement && document.activeElement.id;
        if (activeId === 'exit-notes' || activeId === 'exit-bookmark') return;

        if (this._voiceCapture.isRecording()) {
          this.stopRecording();
        } else if (this.currentState === 'listening') {
          // In confirmed sub-state: Enter advances to exit
          const confirmed = document.getElementById('listening-confirmed');
          if (confirmed && confirmed.style.display !== 'none' && this.transcription) {
            this.proceedToExit();
          }
        }
      }
    });

    // Enable window dragging on state cards (non-dashboard)
    const tauriWindow = window.__TAURI__.window;
    if (tauriWindow) {
      const appWindow = tauriWindow.getCurrentWindow();
      document.querySelectorAll('.state').forEach(el => {
        if (el.id === 's-dashboard') return;
        el.addEventListener('mousedown', (e) => {
          // Only drag on the card background, not interactive elements
          const tag = e.target.tagName.toLowerCase();
          if (['button', 'textarea', 'input', 'select', 'a'].includes(tag)) return;
          if (e.target.closest('button, textarea, input, select, a, .exit-mic-btn, .word-token, [contenteditable]')) return;
          appWindow.startDragging();
        });
      });
    }

    // Populate waveform bars on load
    populateWaveform("waveform");

    // Wire EXIT state mic buttons
    const exitMicBtn = document.getElementById('exit-mic-btn');
    if (exitMicBtn) exitMicBtn.addEventListener('click', () => this._toggleExitVoice('exit-notes', this._exitVoiceCapture, 'exit-mic-btn'));

    const exitBookmarkMicBtn = document.getElementById('exit-bookmark-mic-btn');
    if (exitBookmarkMicBtn) exitBookmarkMicBtn.addEventListener('click', () => this._toggleExitVoice('exit-bookmark', this._exitBookmarkVoiceCapture, 'exit-bookmark-mic-btn'));

    // Load current task state
    this.refreshState();
  }

  // ---- Template loading ----

  async loadTemplates() {
    try {
      this._templates = await invoke("load_templates");
    } catch (e) {
      console.error("Failed to load templates:", e);
      this._templates = [];
    }
  }

  // ---- Mode detection ----
  // Returns { mode: 1|2|3, confidence: 'keyword'|'heuristic'|'default' }

  detectMode(text, currentTask) {
    return _detectMode(text, currentTask);
  }

  // ---- Template matching ----
  // Returns the best matching template object or null

  matchTemplate(text) {
    return _matchTemplate(text, this._templates);
  }

  // ---- Transcription parsing (marker-based) ----
  // Finds semantic marker phrases in the transcription, splits at those positions,
  // and extracts task name, exit context, and bookmark from the typed segments.

  _parseTranscription(text) {
    return parseTranscription(text);
  }

  // ---- State transitions ----

  show(stateName) {
    STATES.forEach((s) => {
      const el = document.getElementById(`s-${s}`);
      if (el) el.classList.toggle("active", s === stateName);
    });
    this.currentState = stateName;

    // Reset listening state UI when showing it
    if (stateName === "listening") {
      this.transcription = "";
      this._session = { mode: 1, confidence: "default", transcription: "", taskName: "", exitCapture: "", template: null, extractedExit: null, extractedBookmark: null };
      // Clear any urgent auto-advance timer
      if (this._urgentTimer) { clearTimeout(this._urgentTimer); this._urgentTimer = null; }
      // Show recording sub-state, hide confirmed sub-state
      const recording = document.getElementById("listening-recording");
      const confirmed = document.getElementById("listening-confirmed");
      if (recording) recording.style.display = "block";
      if (confirmed) confirmed.style.display = "none";
      // Reset urgent progress bar for next use
      const urgentBar = document.getElementById("urgent-progress-bar");
      if (urgentBar) urgentBar.style.width = "0%";
      const urgentProgress = document.getElementById("urgent-progress");
      if (urgentProgress) urgentProgress.style.display = "none";
      // Reset recording UI
      const status = document.getElementById("recording-status");
      const btn = document.getElementById("btn-stop-recording");
      const hint = document.getElementById("listening-hint");
      if (status) { status.style.display = "none"; status.textContent = ""; }
      if (btn) { btn.disabled = false; btn.textContent = "Done"; btn.onclick = () => this.stopRecording(); }
      if (hint) hint.textContent = "Speak, then press Enter";
      // Stop any exit voice captures in progress
      if (this._exitVoiceCapture && this._exitVoiceCapture.isRecording()) {
        this._exitVoiceCapture.stop().catch(e => console.warn('[TF] exit voice stop:', e));
      }
      if (this._exitBookmarkVoiceCapture && this._exitBookmarkVoiceCapture.isRecording()) {
        this._exitBookmarkVoiceCapture.stop().catch(e => console.warn('[TF] bookmark voice stop:', e));
      }
      // Reset exit interview nudge
      const exitNudge = document.getElementById('exit-question-nudge');
      if (exitNudge) exitNudge.style.display = 'none';
      // Reset agent context button
      const ctxBtn = document.getElementById('exit-context-btn');
      if (ctxBtn) ctxBtn.style.display = 'none';
      const ctxLoaded = document.getElementById('exit-context-loaded');
      if (ctxLoaded) ctxLoaded.style.display = 'none';
      this._agentContextContent = null;
    }
  }

  advance(to) {
    this.show(to);
  }

  async close() {
    if (this._urgentTimer) { clearTimeout(this._urgentTimer); this._urgentTimer = null; }
    if (this._voiceCapture.isRecording()) await this._voiceCapture.stop().catch(e => console.warn('[TF] voice stop:', e));
    if (this._exitVoiceCapture.isRecording()) await this._exitVoiceCapture.stop().catch(e => console.warn('[TF] exit voice stop:', e));
    if (this._exitBookmarkVoiceCapture.isRecording()) await this._exitBookmarkVoiceCapture.stop().catch(e => console.warn('[TF] bookmark voice stop:', e));
    if (this._dashboardVoiceCapture.isRecording()) await this._dashboardVoiceCapture.stop().catch(e => console.warn('[TF] dashboard voice stop:', e));

    const backdrop = document.getElementById("dashboard-backdrop");
    if (this.currentState === "dashboard") {
      // Slide panel out, fade backdrop, then restore window and hide
      const panel = document.getElementById("s-dashboard");
      if (panel) panel.style.transform = "translateX(100%)";
      if (backdrop) backdrop.classList.remove("visible");
      await new Promise(resolve => setTimeout(resolve, 300));
      if (panel) panel.style.transform = "";
      if (backdrop) backdrop.style.display = "none";
      await invoke("collapse_from_dashboard").catch(e => console.warn('[TF] collapse:', e));
    } else {
      if (backdrop) { backdrop.classList.remove("visible"); backdrop.style.display = "none"; }
    }

    try { await invoke("hide_overlay"); } catch (e) { console.error("[TaskFlow] Failed to hide overlay:", e); }
  }

  // ---- Protocol: Listening → Confirmed → Exit ----

  async showConfirmation() {
    const badgeEl = document.getElementById("current-task-badge");
    const currentTask =
      badgeEl && badgeEl.textContent !== "No active task"
        ? badgeEl.textContent
        : null;

    // Check for todo intent first - "add X to my todos/list"
    const todoTask = parseTodoIntent(this.transcription, false);
    if (todoTask) {
      try {
        await invoke("append_todo_entry", { taskName: todoTask });
      } catch (e) {
        console.error("[TaskFlow] Failed to add todo from voice:", e);
      }
      await this.showDashboard();
      const status = document.getElementById("dashboard-voice-status");
      const addedPanel = document.getElementById("dashboard-todo-added");
      const editInput = document.getElementById("dashboard-todo-edit");
      if (status) { status.textContent = `✓ Added: "${todoTask}"`; status.style.display = "block"; }
      if (addedPanel) addedPanel.style.display = "flex";
      if (editInput) { editInput.value = todoTask; editInput.focus(); editInput.select(); }
      setLastAddedTodo(todoTask);
      return;
    }

    // Run rule-based detection first
    let { mode, confidence } = this.detectMode(this.transcription, currentTask);
    const template = this.matchTemplate(this.transcription);
    const { taskName, exitContext, bookmark } = this._parseTranscription(this.transcription);

    // Swap to confirmed sub-state
    const recording = document.getElementById("listening-recording");
    const confirmed = document.getElementById("listening-confirmed");
    if (recording) recording.style.display = "none";
    if (confirmed) confirmed.style.display = "block";

    // Show initial state
    const modeBadge = document.getElementById("confirmed-mode-badge");
    const taskEl = document.getElementById("confirmed-task-name");
    const transcriptEl = document.getElementById("confirmed-transcript");
    const continueBtn = document.getElementById("btn-confirmed-continue");
    const tryAgainLink = document.getElementById("try-again-link");
    const urgentProgress = document.getElementById("urgent-progress");

    if (taskEl) taskEl.textContent = mode === 4 ? `Completing: ${taskName}` : `Switching to: ${taskName}`;
    if (transcriptEl) renderClickableTranscript(transcriptEl, this.transcription, (newText, parsed) => {
      this.transcription = newText;
      if (this._session) {
        this._session.taskName = parsed.taskName;
        this._session.transcription = newText;
        const taskEl2 = document.getElementById("confirmed-task-name");
        if (taskEl2) taskEl2.textContent = `Switching to: ${parsed.taskName}`;
      }
    }, parseTranscription);

    // Wire up try-again link
    if (tryAgainLink) {
      tryAgainLink.onclick = (e) => {
        e.preventDefault();
        this.startAgain();
      };
    }

    // LLM fallback for ambiguous detection
    if (confidence === "default" && this._ollamaAvailable) {
      if (modeBadge) {
        modeBadge.textContent = "Detecting…";
        modeBadge.className = "mode-badge mode-detecting";
      }
      if (continueBtn) continueBtn.style.display = "none";

      try {
        const llmResult = await invoke("detect_mode_llm", {
          transcription: this.transcription,
          currentTask: currentTask || null,
        });
        mode = llmResult.mode;
        confidence = "llm";
        console.log(`[TaskFlow] Ollama → mode ${mode}, reason: ${llmResult.reason}`);
      } catch (e) {
        console.warn("[TaskFlow] Ollama fallback failed, using default:", e);
      }
    }

    // Update mode badge with final result
    const modeLabels = { 1: "Full Switch", 2: "Quick Switch", 3: "Urgent", 4: "Completion" };
    const modeClasses = { 1: "mode-full", 2: "mode-light", 3: "mode-urgent", 4: "mode-complete" };
    if (modeBadge) {
      modeBadge.textContent = modeLabels[mode] || "Full Switch";
      modeBadge.className = `mode-badge ${modeClasses[mode] || "mode-full"}`;
    }

    // Store session data (exitContext + bookmark already extracted by _parseTranscription)
    this._session = {
      mode,
      confidence,
      transcription: this.transcription,
      taskName,
      exitCapture: "",
      template,
      extractedExit: exitContext,
      extractedBookmark: bookmark,
    };
    this.mode = mode;

    // Wire continue button
    if (continueBtn) {
      continueBtn.style.display = "inline-flex";
      continueBtn.onclick = () => this.proceedToExit();
    }

    // Mode 3: auto-advance after 1.5s with progress bar
    if (mode === 3) {
      if (urgentProgress) {
        urgentProgress.style.display = "block";
        const bar = document.getElementById("urgent-progress-bar");
        // Trigger CSS transition on next frame
        requestAnimationFrame(() => {
          if (bar) bar.style.width = "100%";
        });
      }
      if (continueBtn) continueBtn.textContent = "Go now →";
      this._urgentTimer = setTimeout(() => {
        this._urgentTimer = null;
        this.proceedToExit();
      }, 1500);
    }

    // Mode 4: completion — go straight to completion capture
    if (mode === 4) {
      if (continueBtn) continueBtn.textContent = "Log it →";
      continueBtn.onclick = () => this.showCompletionState();
    }
  }

  proceedToExit() {
    // Clear urgent auto-advance if user clicked manually
    if (this._urgentTimer) { clearTimeout(this._urgentTimer); this._urgentTimer = null; }
    if (this._session.mode === 4) {
      this.showCompletionState();
      return;
    }
    this.showExitState();
  }

  showExitState() {
    const { mode, taskName, extractedExit, extractedBookmark } = this._session;
    console.log("[TaskFlow] EXIT pre-pop:", { extractedExit, extractedBookmark });

    const label = document.getElementById("exit-label");
    const prompt = document.getElementById("exit-prompt");
    const subtitle = document.getElementById("exit-subtitle");
    const notes = document.getElementById("exit-notes");
    const skipBtn = document.getElementById("exit-skip-btn");
    const submitBtn = document.getElementById("exit-submit-btn");

    // Reset
    if (notes) notes.value = "";

    // Mode 3 with extracted exit context: skip exit entirely
    if (mode === 3 && extractedExit) {
      this._session.exitCapture = extractedExit;
      this.showTransitionState();
      return;
    }

    if (mode === 3) {
      if (label) label.textContent = "Exit · Urgent";
      if (prompt) prompt.textContent = `Capturing: ${taskName}`;
      if (subtitle) subtitle.textContent = "One sentence — where are you leaving off?";
      if (notes) notes.placeholder = "One sentence on where you are...";
      if (notes) notes.rows = 2;
      if (skipBtn) skipBtn.style.display = "none";
      if (submitBtn) submitBtn.textContent = "Go →";
    } else if (mode === 2) {
      if (label) label.textContent = "Exit · Light";
      if (prompt) prompt.textContent = `Switching to: ${taskName}`;
      if (subtitle) subtitle.textContent = "Quick note — or skip if the switch is clean.";
      if (notes) notes.placeholder = "Optional: where you're leaving off...";
      if (notes) notes.rows = 2;
      if (skipBtn) skipBtn.style.display = "inline-flex";
      if (submitBtn) submitBtn.textContent = "Continue →";
    } else {
      // Mode 1 — full protocol
      if (label) label.textContent = "Exit · Full";
      if (prompt) prompt.textContent = "Where are you leaving off?";
      if (subtitle) subtitle.textContent = "What were you doing? What state is the work in? What would you pick up first if you came back?";
      if (notes) notes.placeholder = "What were you just doing? What state is it in?";
      if (notes) notes.rows = 3;
      if (skipBtn) skipBtn.style.display = "none";
      if (submitBtn) submitBtn.textContent = "Continue →";
    }

    // Pre-populate exit notes: set CSS class/hint before show(), but defer the
    // value assignment to after show(). WKWebView resets textarea.value to the
    // element's defaultValue ("") during first layout, which happens when the
    // parent #s-exit transitions from display:none → display:flex via .active.
    // Assigning after show() means the element is already laid out — no reset.
    if (extractedExit && notes) {
      notes.classList.add("prefilled");
      const hintEl = document.getElementById("exit-prefilled-hint");
      if (hintEl) { hintEl.textContent = "From your description"; hintEl.style.display = "block"; }
    } else {
      if (notes) notes.classList.remove("prefilled");
      const hintEl = document.getElementById("exit-prefilled-hint");
      if (hintEl) hintEl.style.display = "none";
    }

    // Show/hide bookmark row (Mode 1 only)
    const bookmarkLabel = document.getElementById('exit-bookmark-label');
    const bookmarkRow = document.getElementById('exit-bookmark-row');
    const bookmarkNotes = document.getElementById('exit-bookmark');
    const showBookmark = mode === 1;
    if (bookmarkLabel) bookmarkLabel.style.display = showBookmark ? 'block' : 'none';
    if (bookmarkRow) bookmarkRow.style.display = showBookmark ? 'flex' : 'none';
    if (bookmarkNotes) bookmarkNotes.value = '';

    // Pre-populate bookmark from transcription extraction
    if (extractedBookmark && bookmarkNotes && showBookmark) {
      bookmarkNotes.value = extractedBookmark;
      bookmarkNotes.classList.add("prefilled");
      const bmHint = document.getElementById("exit-bookmark-prefilled-hint");
      if (bmHint) { bmHint.textContent = "From your description"; bmHint.style.display = "block"; }
    } else {
      if (bookmarkNotes) bookmarkNotes.classList.remove("prefilled");
      const bmHint = document.getElementById("exit-bookmark-prefilled-hint");
      if (bmHint) bmHint.style.display = "none";
    }

    // Show "Looks right — skip to next" when both fields have content
    const hasExit = !!(extractedExit);
    const hasBookmark = !!(extractedBookmark && showBookmark);
    if (hasExit && hasBookmark) {
      if (skipBtn) {
        skipBtn.style.display = "inline-flex";
        skipBtn.textContent = "Looks right — skip →";
        skipBtn.onclick = () => this.skipExitWithExtracted();
      }
    } else if (mode === 2 && hasExit) {
      // Mode 2 with pre-populated context: show skip more prominently
      if (skipBtn) {
        skipBtn.style.display = "inline-flex";
        skipBtn.textContent = "Looks right — skip →";
        skipBtn.onclick = () => this.skipExitWithExtracted();
      }
    }

    this.show('exit');
    // Apply value after show() — #s-exit is now display:flex so WKWebView
    // won't reset the textarea on first layout.
    if (extractedExit && notes) notes.value = extractedExit;
    // Focus the textarea after transition, then fire exit interview question
    setTimeout(() => { if (notes) notes.focus(); }, 200);
    if (mode !== 3) {
      this._fetchExitQuestion();
      this._checkAgentContext();
    }
  }

  // ---- Dashboard ----

  async showDashboard() {
    await _showDashboard((s) => this.show(s));
  }

  _refreshDashboardTodos() {
    return refreshDashboardTodos();
  }

  async dashboardVoiceTap() {
    await _dashboardVoiceTap(this._dashboardVoiceCapture);
  }

  async dismissTodoAdded() {
    await _dismissTodoAdded();
  }

  // ---- Protocol: Listening → Completion (Mode 4) ----

  showCompletionState() {
    _showCompletionState(this._session.taskName, (s) => this.show(s));
  }

  refreshCompletionContext() {
    _refreshCompletionContext();
  }

  async submitCompletion() {
    await _submitCompletion(this._session.taskName, () => this.close());
  }

  async skipCompletion() {
    await _skipCompletion(() => this.close());
  }

  async copyCompletionSkill() {
    await _copyCompletionSkill();
  }

  skipExitWithExtracted() {
    const notes = document.getElementById("exit-notes");
    const bookmarkNotes = document.getElementById("exit-bookmark");
    this._session.exitCapture = notes ? notes.value.trim() : "";
    this._session.extractedBookmark = bookmarkNotes ? bookmarkNotes.value.trim() : "";
    this.showTransitionState();
  }

  async _fetchExitQuestion() {
    const { transcription, exitCapture, extractedExit, taskName, template } = this._session;

    const nudge = document.getElementById('exit-question-nudge');
    const thinking = document.getElementById('exit-question-thinking');
    const body = document.getElementById('exit-question-body');
    const textEl = document.getElementById('exit-question-text');
    if (!nudge || !thinking || !body || !textEl) return;

    // Reset
    nudge.style.display = 'block';
    thinking.style.display = 'inline';
    body.style.display = 'none';
    textEl.textContent = '';

    const exitContext = extractedExit || exitCapture || '';
    const templateName = template ? (template.name || '') : '';

    try {
      const question = await Promise.race([
        invoke('generate_exit_question', {
          transcription: transcription || '',
          exitContext,
          taskName: taskName || '',
          templateName,
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]);

      thinking.style.display = 'none';

      if (!question) {
        nudge.style.display = 'none';
        return;
      }

      textEl.textContent = question;
      body.style.display = 'flex';
    } catch (err) {
      // Silent fail — nudge stays hidden
      nudge.style.display = 'none';
      thinking.style.display = 'none';
    }
  }

  async _checkAgentContext() {
    const btn = document.getElementById('exit-context-btn');
    if (!btn) return;

    btn.style.display = 'none';
    this._agentContextContent = null;

    try {
      const context = await invoke('read_agent_context');
      if (context) {
        this._agentContextContent = context;
        btn.style.display = 'block';
      }
    } catch (err) {
      // Silent fail — no context available
    }
  }

  loadAgentContext() {
    const btn = document.getElementById('exit-context-btn');
    const notes = document.getElementById('exit-notes');
    if (!this._agentContextContent || !notes) return;

    // Append context to existing notes (don't replace what the user typed)
    const existing = notes.value.trim();
    const separator = existing ? '\n\n---\n' : '';
    notes.value = existing + separator + this._agentContextContent;
    notes.classList.add('prefilled');

    // Replace the button with a "loaded" confirmation
    if (btn) {
      btn.style.display = 'none';
    }
    const loadedEl = document.getElementById('exit-context-loaded');
    if (loadedEl) {
      loadedEl.style.display = 'block';
    }

    // Focus at end of textarea
    notes.focus();
    notes.setSelectionRange(notes.value.length, notes.value.length);
  }

  submitExit() {
    const notes = document.getElementById("exit-notes");
    const exitCapture = notes ? notes.value.trim() : "";

    // Mode 1: require something
    if (this._session.mode === 1 && !exitCapture) {
      const notes_el = document.getElementById("exit-notes");
      if (notes_el) {
        notes_el.style.borderColor = "rgba(239, 68, 68, 0.5)";
        notes_el.placeholder = "Required — what state is your work in?";
        notes_el.focus();
        setTimeout(() => { notes_el.style.borderColor = ""; }, 2000);
      }
      return;
    }

    this._session.exitCapture = exitCapture;
    const bookmarkNotes = document.getElementById("exit-bookmark");
    if (bookmarkNotes) this._session.extractedBookmark = bookmarkNotes.value.trim();
    this.showTransitionState();
  }

  skipExit() {
    // Only available in Mode 2
    this._session.exitCapture = "";
    this.showTransitionState();
  }

  // ---- Protocol: Exit → Transition ----

  async showTransitionState() {
    const { mode, exitCapture, taskName } = this._session;

    // Fire-and-forget: log this context switch before any early returns
    try {
      const previousState = await invoke("get_state");
      const startTime = previousState.task_started_at;
      let durationMinutes = null;
      if (startTime) {
        const [h, m] = startTime.split(':').map(Number);
        const now = new Date();
        durationMinutes = Math.round((now.getHours() * 60 + now.getMinutes()) - (h * 60 + m));
        if (durationMinutes < 0) durationMinutes = null;
      }
      invoke("append_daily_log", {
        taskName: taskName || "Unknown",
        taskType: this._session.template?.name || null,
        exitCapture: exitCapture || "",
        bookmark: this._session.extractedBookmark || null,
        mode: mode,
        durationMinutes: durationMinutes,
      });
    } catch (e) {
      console.warn("[TaskFlow] Failed to log context switch:", e);
    }

    const prompt = document.getElementById("transition-prompt");
    const bookmark = document.getElementById("transition-bookmark");
    const bookmarkContent = document.getElementById("bookmark-content");
    const autoMsg = document.getElementById("transition-auto-msg");
    const confirmBtn = document.getElementById("transition-confirm-btn");
    const footerText = document.getElementById("transition-footer-text");

    if (mode === 3) {
      // Mode 3: skip transition entirely, go straight to entry
      this.showEntryState();
      return;
    }

    if (mode === 2) {
      // Mode 2: brief visual boundary, auto-advance after 1.5s
      if (prompt) prompt.textContent = "Context boundary set.";
      if (bookmark) bookmark.style.display = "none";
      if (autoMsg) {
        autoMsg.textContent = `Moving to: ${taskName}`;
        autoMsg.style.display = "block";
        autoMsg.classList.add("transition-auto-advancing");
      }
      if (confirmBtn) confirmBtn.style.display = "none";
      if (footerText) footerText.textContent = "Auto-advancing…";

      this.show("transition");
      setTimeout(() => this.showEntryState(), 1500);
      return;
    }

    // Mode 1: show exit capture summary, manual confirm
    if (prompt) prompt.textContent = "Context saved.";
    if (bookmark) bookmark.style.display = "block";
    if (bookmarkContent) {
      bookmarkContent.textContent = exitCapture || "—";
    }
    if (autoMsg) autoMsg.style.display = "none";
    if (confirmBtn) { confirmBtn.style.display = "inline-flex"; confirmBtn.textContent = "Confirmed"; }
    if (footerText) footerText.textContent = "Saved to daily log";

    this.show("transition");
  }

  confirmTransition() {
    this.showEntryState();
  }

  // ---- Protocol: Transition → Entry ----

  showEntryState() {
    const { mode, template, taskName } = this._session;

    const entryLabel = document.getElementById("entry-label");
    const entryTaskName = document.getElementById("entry-task-name");
    const modeNote = document.getElementById("entry-mode-note");
    const templateBadge = document.getElementById("template-badge");
    const phasesContainer = document.getElementById("template-phases");

    // Clear previous phases
    if (phasesContainer) phasesContainer.innerHTML = "";
    if (modeNote) { modeNote.style.display = "none"; modeNote.textContent = ""; }

    if (mode === 3) {
      // Urgent — minimal entry, no template
      if (entryLabel) entryLabel.textContent = "Entry · Urgent";
      if (entryTaskName) entryTaskName.textContent = taskName || this.transcription;
      if (templateBadge) {
        templateBadge.textContent = "Urgent";
        templateBadge.className = "badge badge-mode3";
      }

      if (phasesContainer) {
        const div = document.createElement("div");
        div.className = "urgent-entry";
        div.textContent = `Captured. Focus on ${taskName}. System will check back later.`;
        phasesContainer.appendChild(div);
      }

      this.pendingTask = taskName || this.transcription;
      this.show("entry");
      return;
    }

    if (template) {
      // Render template phases
      if (entryLabel) {
        entryLabel.textContent = mode === 2
          ? `Entry · ${template.name} (light)`
          : `Entry · ${template.name}`;
      }
      if (entryTaskName) entryTaskName.textContent = template.name;
      if (templateBadge) {
        templateBadge.textContent = template.name;
        templateBadge.className = "badge";
      }

      if (mode === 2 && modeNote) {
        modeNote.textContent = "Quick entry — template for reference.";
        modeNote.style.display = "block";
      }

      this._renderPhases(template, phasesContainer);
      this.pendingTask = template.name;
    } else {
      // No template match — generic entry
      if (entryLabel) entryLabel.textContent = "Entry";
      if (entryTaskName) entryTaskName.textContent = taskName || this.transcription;
      if (templateBadge) {
        templateBadge.textContent = "No template";
        templateBadge.className = "badge";
      }

      if (mode === 2 && modeNote) {
        modeNote.textContent = "Quick entry — no template matched.";
        modeNote.style.display = "block";
      }

      // Show a generic starting message
      if (phasesContainer) {
        const div = document.createElement("div");
        div.className = "phase";
        div.innerHTML = `
          <div class="phase-dot teal">→</div>
          <div>
            <div class="phase-text">Starting: ${taskName}</div>
            <div class="phase-sub">No template matched — working without structure.</div>
          </div>
        `;
        phasesContainer.appendChild(div);
      }

      this.pendingTask = taskName || this.transcription;
    }

    this.show("entry");
    this._fetchClarificationQuestions();
  }

  async _fetchClarificationQuestions() {
    const { mode, template, transcription, exitCapture } = this._session;
    const container = document.getElementById('clarification-questions');
    if (!container) return;

    // Reset
    container.style.display = 'none';
    container.innerHTML = '';

    // Mode 3 never gets questions
    if (mode === 3) return;

    // Show thinking indicator
    container.style.display = 'block';
    const thinking = document.createElement('div');
    thinking.className = 'clarification-thinking';
    thinking.textContent = 'Thinking…';
    container.appendChild(thinking);

    const templateName = template ? (template.name || '') : '';
    const templateContext = template ? JSON.stringify(template) : '';
    const maxQuestions = mode === 2 ? 1 : 3;

    try {
      // Race the API call against a 5s timeout
      const questions = await Promise.race([
        invoke('generate_clarification_questions', {
          transcription: transcription || '',
          templateName,
          templateContext,
          exitCapture: exitCapture || '',
          maxQuestions,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 5000)
        ),
      ]);

      container.innerHTML = '';

      if (!questions || questions.length === 0) {
        container.style.display = 'none';
        return;
      }

      const list = document.createElement('div');
      list.className = 'clarification-list';
      questions.forEach((q) => {
        const item = document.createElement('div');
        item.className = 'clarification-item';
        item.textContent = q;
        list.appendChild(item);
      });
      container.appendChild(list);
    } catch (err) {
      console.error('[TaskFlow] Clarification questions failed:', err.message);
      container.style.display = 'none';
      container.innerHTML = '';
    }
  }

  _renderPhases(template, container) {
    const colours = ["amber", "teal", "purple"];
    const phases = Array.isArray(template.phases) ? template.phases : [];

    phases.forEach((phase, i) => {
      const div = document.createElement("div");
      div.className = "phase";
      const colour = phase.colour || colours[i] || "teal";
      div.innerHTML = `
        <div class="phase-dot ${colour}">${i + 1}</div>
        <div>
          <div class="phase-text">${phase.name}</div>
          <div class="phase-sub">${phase.guidance}</div>
        </div>
      `;
      container.appendChild(div);
    });
  }

  // ---- Task lifecycle ----

  async refreshState() {
    try {
      const state = await invoke("get_state");
      this._updateTaskBadge(state.current_task);
    } catch (e) {
      console.error("Failed to get state:", e);
    }
  }

  _updateTaskBadge(taskName) {
    const badge = document.getElementById("current-task-badge");
    if (badge) badge.textContent = taskName || "No active task";
  }

  async startTask() {
    const name = this.pendingTask || this._session.taskName
      || document.getElementById("entry-task-name")?.textContent
      || "Unknown task";

    try {
      const newState = await invoke("start_task", { name });
      this._updateTaskBadge(newState.current_task);
    } catch (e) {
      console.error("Failed to start task:", e);
    }
    this.close();
  }

  async dismissCoaching(action) {
    console.log("Coaching response:", action);
    this.close();
  }

  async dismissGate(confirmed) {
    if (confirmed) {
      try {
        await invoke("end_task");
      } catch (e) {
        console.error("Failed to end task:", e);
      }
    }
    this.close();
  }

  // ---- Legacy: kept for backward compat with demo() ----

  renderTemplate(template) {
    const container = document.getElementById("template-phases");
    if (container) {
      container.innerHTML = "";
      this._renderPhases(template, container);
    }
    const entryTaskName = document.getElementById("entry-task-name");
    if (entryTaskName) entryTaskName.textContent = template.name;
    const entryLabel = document.getElementById("entry-label");
    if (entryLabel) entryLabel.textContent = `Entry · ${template.name}`;
    const templateBadge = document.getElementById("template-badge");
    if (templateBadge) templateBadge.textContent = template.name;
    this.pendingTask = template.name;
  }

  // ---- Audio recording ----

  async startRecording() {
    if (this._voiceCapture.isRecording()) return;
    try {
      await this._voiceCapture.start();
    } catch (err) {
      console.error('Microphone access denied or unavailable:', err);
    }
  }

  async stopRecording() {
    if (!this._voiceCapture.isRecording()) return;

    const btn = document.getElementById('btn-stop-recording');
    const hint = document.getElementById('listening-hint');
    const status = document.getElementById('recording-status');

    if (btn) { btn.disabled = true; btn.textContent = 'Processing…'; }
    if (hint) hint.textContent = '';
    if (status) { status.textContent = 'Transcribing…'; status.style.display = 'block'; }
    stopWaveform();

    try {
      const text = await this._voiceCapture.stop();
      this.transcription = text;
      if (status) status.style.display = 'none';

      // Auto-trigger confirmation flow after brief pause
      await this.wait(300);
      this.showConfirmation();
    } catch (err) {
      console.error('Transcription failed:', err);
      if (status) status.style.display = 'none';
      if (btn) { btn.disabled = false; btn.textContent = 'Try again'; btn.onclick = () => this.startAgain(); }
      if (hint) hint.textContent = 'Transcription failed — try again';
    }
  }

  startAgain() {
    // Clear urgent timer if running
    if (this._urgentTimer) { clearTimeout(this._urgentTimer); this._urgentTimer = null; }
    // Swap back to recording sub-state
    const recording = document.getElementById("listening-recording");
    const confirmed = document.getElementById("listening-confirmed");
    if (recording) recording.style.display = "block";
    if (confirmed) confirmed.style.display = "none";
    // Reset recording UI
    const status = document.getElementById("recording-status");
    const btn = document.getElementById("btn-stop-recording");
    const hint = document.getElementById("listening-hint");
    if (status) { status.style.display = "none"; status.textContent = ""; }
    if (btn) { btn.disabled = false; btn.textContent = "Done"; btn.onclick = () => this.stopRecording(); }
    if (hint) hint.textContent = "Speak, then press Enter";
    this.transcription = "";
    populateWaveform("waveform");
    startWaveform("waveform", () => this._lastAmplitude);
    this.startRecording();
  }

  _updateExitMicBtn(btnId, isRecording) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    if (isRecording) {
      btn.textContent = '⏹';
      btn.classList.add('recording');
    } else {
      btn.textContent = '🎤';
      btn.classList.remove('recording');
    }
  }

  async _toggleExitVoice(textareaId, capture, btnId) {
    if (capture.isRecording()) {
      const btn = document.getElementById(btnId);
      if (btn) { btn.disabled = true; btn.textContent = '…'; }
      try {
        const text = await capture.stop();
        if (text) {
          const ta = document.getElementById(textareaId);
          if (ta) {
            ta.value = ta.value ? ta.value + ' ' + text : text;
          }
        }
      } catch (err) {
        console.error('Exit transcription failed:', err);
      } finally {
        const btn2 = document.getElementById(btnId);
        if (btn2) { btn2.disabled = false; }
      }
    } else {
      try {
        await capture.start();
      } catch (err) {
        console.error('Exit mic start failed:', err);
      }
    }
  }

  // ---- Demo ----

  async demo() {
    this.show("listening");
    startWaveform("waveform", () => this._lastAmplitude);
    await this.wait(2000);

    stopWaveform();
    this.transcription = "I need to do PR amends";
    await this.wait(300);
    this.showConfirmation();
  }

  wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// -------------------------------------------------------------------
// Boot
// -------------------------------------------------------------------

const app = new TaskFlowApp();
window.app = app;
