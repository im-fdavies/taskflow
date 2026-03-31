// ===================================================================
// TaskFlow — Overlay App
// State machine + Tauri IPC + UI logic
// ===================================================================

import { VoiceCapture } from './voice-capture.js';
import { detectMode as _detectMode, parseTranscription, matchTemplate as _matchTemplate, parseTodoIntent, isStartIntent, isCompletionIntent, isNoteIntent, extractNoteText, parseTaskNoteIntent } from './logic.js';
import { populateWaveform, startWaveform, stopWaveform } from './waveform.js';
import { renderClickableTranscript } from './transcription-editor.js';
import { findExistingTask, renderStartContext } from './start-flow.js';
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
  dismissTodoAdded as _dismissTodoAdded,
  setLastAddedTodo,
} from './dashboard.js';
import {
  showExitState as _showExitState,
  submitExit as _submitExit,
  skipExitWithExtracted as _skipExitWithExtracted,
  loadAgentContext as _loadAgentContext,
  updateExitMicBtn,
  toggleExitVoice,
} from './exit-flow.js';
import {
  showTransitionState as _showTransitionState,
  showEntryState as _showEntryState,
  renderPhases,
} from './entry-flow.js';
import {
  refreshLeftPanel as _refreshLeftPanel,
  resumeTask as _resumeTask,
} from './left-panel.js';

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
      onStateChange: (isRec) => updateExitMicBtn('exit-mic-btn', isRec),
      onAmplitude: () => {},
      onError: (msg) => console.error('Exit voice error:', msg),
    });

    // Audio recording — EXIT state (bookmark)
    this._exitBookmarkVoiceCapture = new VoiceCapture({
      onStateChange: (isRec) => updateExitMicBtn('exit-bookmark-mic-btn', isRec),
      onAmplitude: () => {},
      onError: (msg) => console.error('Exit bookmark voice error:', msg),
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

    // Track hold-to-record mode
    this._holdMode = false;
    this._holdTimer = null;

    // Listen for overlay open event from Rust
    await listen("overlay-opened", () => {
      this.show("listening");
      startWaveform("waveform", () => this._lastAmplitude);
      this.startRecording();

      // Start a 300ms timer — if shortcut-released fires after this, it was a hold.
      this._holdMode = false;
      if (this._holdTimer) clearTimeout(this._holdTimer);
      this._holdTimer = setTimeout(() => {
        this._holdMode = true;
        this._holdTimer = null; // Mark timer as fired
        const hint = document.getElementById("listening-hint");
        if (hint && this._voiceCapture.isRecording()) {
          hint.textContent = "Release to finish";
        }
      }, 300);
    });

    // Listen for key release — stops recording if user was holding
    await listen("shortcut-released", () => {
      if (this._holdMode && this._voiceCapture.isRecording()) {
        this.stopRecording();
      }
      if (this._holdTimer) { clearTimeout(this._holdTimer); this._holdTimer = null; }
      this._holdMode = false;
      // Reset hint if timer fired prematurely (tap that released after 300ms)
      const hint = document.getElementById("listening-hint");
      if (hint && hint.textContent === "Release to finish" && this._voiceCapture.isRecording()) {
        hint.textContent = "Speak, then press Enter";
      }
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
          toggleExitVoice('exit-notes', this._exitVoiceCapture, 'exit-mic-btn');
          return;
        }
        if (this._exitBookmarkVoiceCapture.isRecording()) {
          toggleExitVoice('exit-bookmark', this._exitBookmarkVoiceCapture, 'exit-bookmark-mic-btn');
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
        if (el.id === 's-dashboard' || el.id === 's-dashboard-left') return;
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
    if (exitMicBtn) exitMicBtn.addEventListener('click', () => toggleExitVoice('exit-notes', this._exitVoiceCapture, 'exit-mic-btn'));

    const exitBookmarkMicBtn = document.getElementById('exit-bookmark-mic-btn');
    if (exitBookmarkMicBtn) exitBookmarkMicBtn.addEventListener('click', () => toggleExitVoice('exit-bookmark', this._exitBookmarkVoiceCapture, 'exit-bookmark-mic-btn'));

    // Enter key on dashboard text inputs
    document.getElementById("dashboard-switch-input")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); this.dashboardSwitch(); }
    });
    document.getElementById("dashboard-todo-input")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); this.dashboardAddTodo(); }
    });

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
      // Reset start context
      const startCtx = document.getElementById("start-context");
      if (startCtx) startCtx.style.display = "none";
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
    }
  }

  advance(to) {
    this.show(to);
  }

  async close() {
    if (this._urgentTimer) { clearTimeout(this._urgentTimer); this._urgentTimer = null; }
    // Reset hold mode
    this._holdMode = false;
    if (this._holdTimer) { clearTimeout(this._holdTimer); this._holdTimer = null; }
    if (this._voiceCapture.isRecording()) await this._voiceCapture.stop().catch(e => console.warn('[TF] voice stop:', e));
    if (this._exitVoiceCapture.isRecording()) await this._exitVoiceCapture.stop().catch(e => console.warn('[TF] exit voice stop:', e));
    if (this._exitBookmarkVoiceCapture.isRecording()) await this._exitBookmarkVoiceCapture.stop().catch(e => console.warn('[TF] bookmark voice stop:', e));

    const backdrop = document.getElementById("dashboard-backdrop");
    const leftPanel = document.getElementById("s-dashboard-left");
    if (this.currentState === "dashboard") {
      // Slide panels out, fade backdrop, then restore window and hide
      const panel = document.getElementById("s-dashboard");
      if (panel) panel.style.transform = "translateX(100%)";
      if (leftPanel) leftPanel.style.transform = "translateX(-110%)";
      if (backdrop) backdrop.classList.remove("visible");
      await new Promise(resolve => setTimeout(resolve, 300));
      if (panel) panel.style.transform = "";
      if (leftPanel) { leftPanel.style.transform = ""; leftPanel.classList.remove("active"); }
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

    // Reject blank, junk, or degenerate transcriptions
    const cleanedTranscription = (this.transcription || '').trim();
    if (!cleanedTranscription || /^\[.*BLANK.*\]$/i.test(cleanedTranscription) || cleanedTranscription.replace(/[.\s]/g, '').length < 2) {
      this.startAgain();
      const hint = document.getElementById('listening-hint');
      if (hint) hint.textContent = 'No speech detected — try again';
      return;
    }

    // Check for targeted task note intent — "add note to {taskName} {noteText}"
    try {
      const openTasks = await invoke("read_open_tasks");
      const taskNames = openTasks.map(t => t.name);
      const taskNoteResult = parseTaskNoteIntent(this.transcription, taskNames);
      if (taskNoteResult) {
        await invoke("append_task_note", { taskName: taskNoteResult.taskName, noteText: taskNoteResult.noteText });
        const hint = document.getElementById('listening-hint');
        if (hint) hint.textContent = `📝 Note added to ${taskNoteResult.taskName}`;
        setTimeout(() => {
          this.startAgain();
          invoke("hide_overlay").catch(() => {});
        }, 1500);
        return;
      }
    } catch (e) {
      console.error("[TaskFlow] Failed targeted task note check:", e);
    }

    // Check for note intent — quick thought, no context switch
    if (isNoteIntent(this.transcription)) {
      const noteText = extractNoteText(this.transcription) || cleanedTranscription;
      try {
        await invoke("append_note", { noteText });
      } catch (e) {
        console.error("[TaskFlow] Failed to save note:", e);
      }
      const hint = document.getElementById('listening-hint');
      if (hint) hint.textContent = '📝 Note saved';
      setTimeout(() => {
        this.startAgain();
        invoke("hide_overlay").catch(() => {});
      }, 1500);
      return;
    }

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

    // Check for completion intent — "I've finished", "task is done", etc.
    if (isCompletionIntent(this.transcription, currentTask)) {
      this._session = {
        mode: 4,
        confidence: "completion_intent",
        transcription: this.transcription,
        taskName: currentTask,  // Use CURRENT task, not parsed transcription
        exitCapture: "",
        template: null,
        extractedExit: null,
        extractedBookmark: null,
      };
      this.mode = 4;
      this.showCompletionState();
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
    const startContext = document.getElementById("start-context");

    // Reset start context from previous use
    if (startContext) startContext.style.display = "none";

    // Detect fresh start (no active task, start-style language)
    const freshStart = isStartIntent(this.transcription, currentTask);

    if (freshStart) {
      // --- START TASK FLOW (skip exit + transition) ---
      if (taskEl) taskEl.textContent = `Starting: ${taskName}`;
      if (transcriptEl) renderClickableTranscript(transcriptEl, this.transcription, (newText, parsed) => {
        this.transcription = newText;
        if (this._session) {
          this._session.taskName = parsed.taskName;
          this._session.transcription = newText;
          const taskEl2 = document.getElementById("confirmed-task-name");
          if (taskEl2) taskEl2.textContent = `Starting: ${parsed.taskName}`;
        }
      }, parseTranscription);

      if (modeBadge) {
        modeBadge.textContent = "New Task";
        modeBadge.className = "mode-badge mode-start";
      }

      // Store session
      this._session = {
        mode: 2, // light mode - no exit needed
        confidence: "start",
        transcription: this.transcription,
        taskName,
        exitCapture: "",
        template,
        extractedExit: null,
        extractedBookmark: null,
        isNewStart: true,
        currentTask: null,
      };
      this.mode = 2;

      // Wire try-again
      if (tryAgainLink) {
        tryAgainLink.onclick = (e) => { e.preventDefault(); this.startAgain(); };
      }

      // Check for matching paused tasks / todos (async, non-blocking)
      if (continueBtn) {
        continueBtn.style.display = "inline-flex";
        continueBtn.textContent = "Start →";
        continueBtn.onclick = () => this.proceedFromStart();
      }

      findExistingTask(taskName).then((found) => {
        if (found) {
          console.log(`[TaskFlow] Matched existing task: ${found.match.name} (${found.type}, ${found.score})`);
          if (found.type === "paused") {
            if (modeBadge) {
              modeBadge.textContent = "Resuming";
              modeBadge.className = "mode-badge mode-start";
            }
            if (taskEl) taskEl.textContent = `Resuming: ${found.match.name}`;
            this._session.taskName = found.match.name;
          }
          renderStartContext(found);
        }
      }).catch(e => console.warn("[TaskFlow] Task matching failed:", e));

      return;
    }

    // --- CONTEXT SWITCH FLOW (existing behaviour) ---
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
        modeBadge.textContent = "Detecting\u2026";
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
        console.log(`[TaskFlow] Ollama -> mode ${mode}, reason: ${llmResult.reason}`);
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
      currentTask,
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
      if (continueBtn) continueBtn.textContent = "Go now ->";
      this._urgentTimer = setTimeout(() => {
        this._urgentTimer = null;
        this.proceedToExit();
      }, 1500);
    }

    // Mode 4: completion - go straight to completion capture
    if (mode === 4) {
      if (continueBtn) continueBtn.textContent = "Log it ->";
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

  // ---- Start task flow (skip exit + transition) ----

  proceedFromStart() {
    this.showEntryState();
  }

  showExitState() {
    _showExitState(this._session, {
      showState: (s) => this.show(s),
      showTransitionState: () => this.showTransitionState(),
      skipExitWithExtracted: () => this.skipExitWithExtracted(),
    });
  }

  // ---- Dashboard ----

  async showDashboard() {
    await _showDashboard((s) => this.show(s));
    const leftPanel = document.getElementById("s-dashboard-left");
    if (leftPanel) leftPanel.classList.add("active");
    await _refreshLeftPanel();
  }

  _refreshDashboardTodos() {
    return refreshDashboardTodos();
  }

  async dismissTodoAdded() {
    await _dismissTodoAdded();
  }

  async collapseDashboard() {
    const backdrop = document.getElementById("dashboard-backdrop");
    const leftPanel = document.getElementById("s-dashboard-left");
    const rightPanel = document.getElementById("s-dashboard");
    if (rightPanel) rightPanel.style.transform = "translateX(100%)";
    if (leftPanel) leftPanel.style.transform = "translateX(-110%)";
    if (backdrop) backdrop.classList.remove("visible");
    await new Promise(resolve => setTimeout(resolve, 300));
    if (rightPanel) rightPanel.style.transform = "";
    if (leftPanel) { leftPanel.style.transform = ""; leftPanel.classList.remove("active"); }
    if (backdrop) backdrop.style.display = "none";
    await invoke("collapse_from_dashboard").catch(e => console.warn('[TF] collapse:', e));
  }

  async dashboardSwitch() {
    const input = document.getElementById("dashboard-switch-input");
    const text = input ? input.value.trim() : "";
    if (!text) return;

    const btn = document.getElementById("dashboard-switch-btn");
    if (btn) btn.disabled = true;

    try {
      const currentState = await invoke("get_state");
      if (currentState.current_task) {
        await invoke("append_daily_log", {
          taskName: currentState.current_task,
          taskType: null,
          exitCapture: "",
          bookmark: null,
          mode: 2,
          durationMinutes: this._calculateDuration(currentState.task_started_at),
        }).catch(e => console.warn("[TF] Could not log task pause:", e));
      }

      const newState = await invoke("start_task", { name: text });
      this._updateTaskBadge(newState.current_task);

      if (input) input.value = "";

      await _refreshLeftPanel(false);
    } catch (e) {
      console.error("[TaskFlow] Dashboard switch failed:", e);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async dashboardAddTodo() {
    const input = document.getElementById("dashboard-todo-input");
    const text = input ? input.value.trim() : "";
    if (!text) return;

    try {
      await invoke("append_todo_entry", { taskName: text });
      input.value = "";
      const addedPanel = document.getElementById("dashboard-todo-added");
      const editInput = document.getElementById("dashboard-todo-edit");
      const status = document.getElementById("dashboard-voice-status");
      if (status) { status.textContent = `✓ Added: "${text}"`; status.style.display = "block"; }
      if (addedPanel) addedPanel.style.display = "flex";
      if (editInput) { editInput.value = text; editInput.focus(); editInput.select(); }
      setLastAddedTodo(text);
      await this._refreshDashboardTodos();
    } catch (e) {
      console.error("[TaskFlow] Failed to add todo:", e);
    }
  }

  async dashboardComplete() {
    try {
      const state = await invoke("get_state");
      const taskName = state.current_task || "Unknown task";
      await this.collapseDashboard();
      this._session.taskName = taskName;
      this.showCompletionState();
    } catch (e) {
      console.error("[TaskFlow] dashboardComplete failed:", e);
    }
  }

  async dashboardPause() {
    try {
      await this.collapseDashboard();
      this._session = {
        mode: 1,
        confidence: "dashboard",
        transcription: "",
        taskName: "",
        exitCapture: "",
        template: null,
        extractedExit: null,
        extractedBookmark: null,
      };
      this.showExitState();
    } catch (e) {
      console.error("[TaskFlow] dashboardPause failed:", e);
    }
  }

  // ---- Left panel ----

  async resumeTask(taskName) {
    await _resumeTask(taskName, () => this.close());
  }

  async refreshLeftPanel() {
    await _refreshLeftPanel(true);
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
    const result = _skipExitWithExtracted();
    this._session.exitCapture = result.exitCapture;
    this._session.extractedBookmark = result.bookmark;
    this.showTransitionState();
  }

  loadAgentContext() {
    _loadAgentContext();
  }

  submitExit() {
    const result = _submitExit(this._session);
    if (!result.valid) return;
    this._session.exitCapture = result.exitCapture;
    this._session.extractedBookmark = result.bookmark;
    this.showTransitionState();
  }

  skipExit() {
    this._session.exitCapture = "";
    this.showTransitionState();
  }

  // ---- Protocol: Exit → Transition ----

  async showTransitionState() {
    await _showTransitionState(this._session, {
      showState: (s) => this.show(s),
      showEntryState: () => this.showEntryState(),
    });
  }

  confirmTransition() {
    this.showEntryState();
  }

  // ---- Protocol: Transition → Entry ----

  showEntryState() {
    this.pendingTask = _showEntryState(this._session, this.transcription, (s) => this.show(s));
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

  _calculateDuration(taskStartedAt) {
    if (!taskStartedAt) return null;
    try {
      const [h, m] = taskStartedAt.split(':').map(Number);
      const now = new Date();
      const minutes = Math.round((now.getHours() * 60 + now.getMinutes()) - (h * 60 + m));
      return minutes > 0 ? minutes : null;
    } catch {
      return null;
    }
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
      renderPhases(template, container);
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

      // Guard: reject blank or empty transcription
      const trimmed = (text || '').trim();
      if (!trimmed || trimmed === '[BLANK_AUDIO]' || trimmed.length < 2) {
        if (btn) { btn.disabled = false; btn.textContent = 'Try again'; btn.onclick = () => this.startAgain(); }
        if (hint) hint.textContent = 'No speech detected - try again';
        return;
      }

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
    // Reset hold mode — go back to tap flow
    this._holdMode = false;
    if (this._holdTimer) { clearTimeout(this._holdTimer); this._holdTimer = null; }
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
