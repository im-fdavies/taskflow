// ===================================================================
// TaskFlow — Overlay App
// State machine + Tauri IPC + UI logic
// ===================================================================

import { VoiceCapture } from './voice-capture.js';

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
    this._waveformRaf = null;
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
      this.startWaveform("waveform");
      this.startRecording();
    });

    // Listen for dashboard open event from Rust (Cmd+Shift+D)
    await listen("dashboard-opened", () => {
      this.showDashboard();
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

    // Populate waveform bars on load
    this.populateWaveform("waveform");

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
    const lower = text.toLowerCase();

    // Mode 3: urgent — highest priority
    if (/\burgent\b/.test(lower)) {
      return { mode: 3, confidence: "keyword" };
    }

    // Mode 1: interrupted/mid-task signals — checked before mode 2
    const mode1Keywords = [
      "interrupted", "pulled away", "in the middle of",
      "was working on", "got distracted",
    ];
    if (mode1Keywords.some((k) => lower.includes(k))) {
      return { mode: 1, confidence: "keyword" };
    }

    // Mode 4: completion — user finished a task, no next task implied
    const mode4Keywords = [
      "i just finished", "i've completed", "i've finished",
      "just completed", "task is done", "wrapped up",
      "all done with", "finished up",
    ];
    if (mode4Keywords.some((k) => lower.includes(k))) {
      return { mode: 4, confidence: "keyword" };
    }

    // Mode 2: clean switch signals
    const mode2Keywords = [
      "finished", "done with", "completed", "moving on to",
      "same pr", "same ticket", "related to", "continuing",
    ];
    if (mode2Keywords.some((k) => lower.includes(k))) {
      return { mode: 2, confidence: "keyword" };
    }

    // Mode 2 heuristic: task name overlaps with current active task
    if (currentTask) {
      const currentWords = currentTask.toLowerCase().split(/\s+/);
      const hasOverlap = currentWords.some(
        (w) => w.length > 3 && lower.includes(w)
      );
      if (hasOverlap) {
        return { mode: 2, confidence: "heuristic" };
      }
    }

    // Default: Mode 1 (full protocol — safer to over-decompress)
    return { mode: 1, confidence: "default" };
  }

  // ---- Template matching ----
  // Returns the best matching template object or null

  matchTemplate(text) {
    const lower = text.toLowerCase();
    for (const template of this._templates) {
      const triggers = Array.isArray(template.triggers) ? template.triggers : [];
      if (triggers.some((t) => lower.includes(t.toLowerCase()))) {
        return template;
      }
    }
    return null;
  }

  // ---- Transcription parsing (marker-based) ----
  // Finds semantic marker phrases in the transcription, splits at those positions,
  // and extracts task name, exit context, and bookmark from the typed segments.

  _parseTranscription(text) {
    const result = { taskName: null, exitContext: null, bookmark: null };
    if (!text) return result;

    // Semantic markers ordered by specificity (most specific first within each type).
    // Content AFTER each marker (until the next marker or end of text) belongs to that type.
    const MARKERS = [
      // Bookmark boundaries
      { re: /\bwhen i (?:come back|return|get back),?\s*(?:i'll\s+)?/i, type: "bookmark" },
      { re: /\b(?:need to |want to |should |i'll )?(pick up|come back to|remember to|get back to)\s+/i, type: "bookmark", keepVerb: true },

      // Exit markers (what user was/is doing — switching FROM)
      { re: /\bi(?:'m| am) currently (?:working on|doing|on)\s+/i, type: "exit" },
      { re: /\bcurrently (?:working on|doing|on)\s+/i, type: "exit" },
      { re: /\bi was (?:working on|doing|in the middle of)\s+/i, type: "exit" },
      { re: /\bi was\s+(?=\w+ing\b)/i, type: "exit" },
      { re: /\bwas (?:working on|doing)\s+/i, type: "exit" },
      { re: /\b(?:been doing|was on|coming from|leaving)\s+/i, type: "exit" },
      { re: /\bdone with\s+/i, type: "exit" },
      { re: /\bfinished(?:\s+with)?\s+/i, type: "exit" },

      // Entry markers (what user is switching TO)
      { re: /\bi(?:'m| am) (?:switching to|moving (?:on )?to|going to)\s+/i, type: "entry" },
      { re: /\b(?:switching to|moving on to|moving to)\s+/i, type: "entry" },
      { re: /\bneed to (?:switch to|do|work on|handle|look at)\s+/i, type: "entry" },
      { re: /\bi (?:need|want|have) to\s+/i, type: "entry" },
      { re: /\b(?:let me|i should(?:\s+probably)?)\s+/i, type: "entry" },

      // Mode signal (urgent at start only)
      { re: /^urgent\b[,.]?\s*/i, type: "mode_signal" },
    ];

    // Find first occurrence of each marker pattern in the text
    const found = [];
    for (const mk of MARKERS) {
      const m = text.match(mk.re);
      if (m) {
        found.push({
          start: m.index,
          end: m.index + m[0].length,
          type: mk.type,
          matchText: m[0],
          keepVerb: mk.keepVerb || false,
          verbGroup: m[1] || null,
        });
      }
    }

    // Sort by position; at same position prefer longer match. Deduplicate overlaps.
    found.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    const markers = [];
    let lastEnd = -1;
    for (const m of found) {
      if (m.start >= lastEnd) {
        markers.push(m);
        lastEnd = m.end;
      }
    }

    console.log("[TaskFlow] Markers:", markers.map((m) => `${m.type}@${m.start}: "${m.matchText.trim()}"`));

    // Build typed segments from the gaps between markers
    const segments = [];

    if (markers.length === 0) {
      segments.push({ type: "unclassified", text: text.replace(/[.!?,\s]+$/, "").trim() });
    } else {
      // Any text before the first marker
      if (markers[0].start > 0) {
        const pre = text.substring(0, markers[0].start).replace(/[.!?,\s]+$/, "").trim();
        if (pre) segments.push({ type: "pre", text: pre });
      }

      for (let i = 0; i < markers.length; i++) {
        const mk = markers[i];
        const nextStart = i + 1 < markers.length ? markers[i + 1].start : text.length;
        let content = text.substring(mk.end, nextStart).replace(/^[.!?,\s]+/, "").replace(/[.!?,\s]+$/, "").trim();

        if (mk.keepVerb && mk.verbGroup) {
          content = mk.verbGroup + " " + content;
        }

        if (content) {
          segments.push({ type: mk.type, text: content });
        }
      }
    }

    console.log("[TaskFlow] Segments:", segments.map((s) => `${s.type}: "${s.text}"`));

    const cap = (s) => {
      if (!s) return null;
      s = s.replace(/[.!?]+$/, "").trim();
      return s ? s.charAt(0).toUpperCase() + s.slice(1) : null;
    };

    const entry = segments.find((s) => s.type === "entry");
    const exit = segments.find((s) => s.type === "exit");
    const bookmark = segments.find((s) => s.type === "bookmark");
    const mode = segments.find((s) => s.type === "mode_signal");
    const unclassified = segments.find((s) => s.type === "unclassified");
    const pre = segments.find((s) => s.type === "pre");

    // Task name: entry > mode_signal remainder > unclassified > pre-marker text > full text
    result.taskName = cap(entry?.text) || cap(mode?.text) || cap(unclassified?.text) || cap(pre?.text) || cap(text);

    if (exit) result.exitContext = cap(exit.text);
    if (bookmark) result.bookmark = cap(bookmark.text);

    console.log("[TaskFlow] Extracted:", result);
    return result;
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
        this._exitVoiceCapture.stop().catch(() => {});
      }
      if (this._exitBookmarkVoiceCapture && this._exitBookmarkVoiceCapture.isRecording()) {
        this._exitBookmarkVoiceCapture.stop().catch(() => {});
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
    if (this._voiceCapture.isRecording()) await this._voiceCapture.stop().catch(() => {});
    if (this._exitVoiceCapture.isRecording()) await this._exitVoiceCapture.stop().catch(() => {});
    if (this._exitBookmarkVoiceCapture.isRecording()) await this._exitBookmarkVoiceCapture.stop().catch(() => {});
    if (this._dashboardVoiceCapture.isRecording()) await this._dashboardVoiceCapture.stop().catch(() => {});
    try { await invoke("hide_overlay"); } catch (e) { console.error("[TaskFlow] Failed to hide overlay:", e); }
  }

  // ---- Protocol: Listening → Confirmed → Exit ----

  async showConfirmation() {
    const badgeEl = document.getElementById("current-task-badge");
    const currentTask =
      badgeEl && badgeEl.textContent !== "No active task"
        ? badgeEl.textContent
        : null;

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
    if (transcriptEl) this._renderClickableTranscript(transcriptEl, this.transcription);

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
    this.show("dashboard");

    // Load today's summary
    const summaryEl = document.getElementById("dashboard-summary");
    try {
      const summary = await invoke("read_daily_summary");
      if (summaryEl) summaryEl.textContent = summary || "No summary written yet for today.";
    } catch (e) {
      if (summaryEl) summaryEl.textContent = "—";
    }

    await this._refreshDashboardTodos();
  }

  async _refreshDashboardTodos() {
    const list = document.getElementById("dashboard-todo-list");
    if (!list) return;

    try {
      const todos = await invoke("read_daily_todos");
      list.innerHTML = "";
      if (todos.length === 0) {
        list.innerHTML = '<div class="dashboard-empty">No todos logged today yet</div>';
      } else {
        for (const todo of todos) {
          const div = document.createElement("div");
          div.className = "dashboard-todo-item";
          div.textContent = todo;
          list.appendChild(div);
        }
      }
    } catch (e) {
      list.innerHTML = '<div class="dashboard-empty">Could not load todos</div>';
    }
  }

  _parseTodoIntent(text) {
    const addMatch = text.match(/add\s+(.+?)\s+to\s+(?:my\s+)?(?:todos?|list|tasks?)/i);
    if (addMatch) return addMatch[1].trim();
    const rememberMatch = text.match(/^(?:remember|remind me to?)\s+(.+)/i);
    if (rememberMatch) return rememberMatch[1].trim();
    return null;
  }

  async dashboardVoiceTap() {
    const btn = document.getElementById("dashboard-voice-btn");
    const hint = document.getElementById("dashboard-voice-hint");
    const status = document.getElementById("dashboard-voice-status");

    if (this._dashboardVoiceCapture.isRecording()) {
      if (btn) { btn.disabled = true; btn.textContent = '…'; btn.classList.remove("recording"); }
      if (hint) hint.style.display = "none";
      try {
        const text = await this._dashboardVoiceCapture.stop();
        if (text) {
          const taskName = this._parseTodoIntent(text);
          if (taskName) {
            await invoke("append_todo_entry", { taskName });
            if (status) { status.textContent = `✓ Added: "${taskName}"`; status.style.display = "block"; }
            await this._refreshDashboardTodos();
            setTimeout(() => { if (status) status.style.display = "none"; }, 3000);
          } else {
            if (status) { status.textContent = `Couldn't parse that — try "add X to my todos"`; status.style.display = "block"; }
            setTimeout(() => { if (status) status.style.display = "none"; }, 4000);
          }
        }
      } catch (e) {
        console.error("[TaskFlow] Dashboard voice failed:", e);
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🎤'; }
        if (hint) hint.style.display = "inline";
      }
    } else {
      try {
        await this._dashboardVoiceCapture.start();
        if (btn) { btn.classList.add("recording"); btn.textContent = '⬛'; }
        if (hint) hint.style.display = "none";
        if (status) status.style.display = "none";
      } catch (e) {
        console.error("[TaskFlow] Dashboard mic start failed:", e);
      }
    }
  }

  // ---- Protocol: Listening → Completion (Mode 4) ----

  showCompletionState() {
    const { taskName } = this._session;
    const promptEl = document.getElementById("completion-prompt");
    if (promptEl) promptEl.textContent = `Wrapping up: ${taskName}`;

    // Reset fields
    const outcome = document.getElementById("completion-outcome");
    const prs = document.getElementById("completion-prs");
    const followups = document.getElementById("completion-followups");
    const handoff = document.getElementById("completion-handoff");
    if (outcome) outcome.value = "";
    if (prs) prs.value = "";
    if (followups) followups.value = "";
    if (handoff) handoff.value = "";

    // Reset skill button
    const copiedEl = document.getElementById("completion-skill-copied");
    const copyBtn = document.getElementById("completion-copy-skill-btn");
    if (copiedEl) copiedEl.style.display = "none";
    if (copyBtn) copyBtn.style.display = "inline-flex";

    // Reset refresh feedback
    const ctxLoaded = document.getElementById("completion-context-loaded");
    if (ctxLoaded) ctxLoaded.style.display = "none";

    this.show("completion");
    setTimeout(() => { if (outcome) outcome.focus(); }, 200);

    // Try to pre-populate from any existing completion-context.json
    this._loadCompletionContext();
  }

  async _loadCompletionContext() {
    try {
      const ctx = await invoke("read_completion_context");
      if (!ctx) return;

      const outcome = document.getElementById("completion-outcome");
      const prs = document.getElementById("completion-prs");
      const followups = document.getElementById("completion-followups");
      const handoff = document.getElementById("completion-handoff");

      if (ctx.outcome && outcome) { outcome.value = ctx.outcome; outcome.classList.add("prefilled"); }
      if (ctx.prs && prs) { prs.value = ctx.prs; prs.classList.add("prefilled"); }
      if (ctx.follow_ups && followups) { followups.value = ctx.follow_ups; followups.classList.add("prefilled"); }
      if (ctx.handoff && handoff) { handoff.value = ctx.handoff; handoff.classList.add("prefilled"); }

      const ctxLoaded = document.getElementById("completion-context-loaded");
      if (ctxLoaded) ctxLoaded.style.display = "block";
    } catch (e) {
      // Silent fail — user can still fill in manually
    }
  }

  async refreshCompletionContext() {
    const ctxLoaded = document.getElementById("completion-context-loaded");
    if (ctxLoaded) ctxLoaded.style.display = "none";
    await this._loadCompletionContext();
  }

  async submitCompletion() {
    const outcome = document.getElementById("completion-outcome");
    const prs = document.getElementById("completion-prs");
    const followups = document.getElementById("completion-followups");
    const handoff = document.getElementById("completion-handoff");
    const { taskName } = this._session;

    try {
      const state = await invoke("get_state");
      let durationMinutes = null;
      if (state.task_started_at) {
        const [h, m] = state.task_started_at.split(':').map(Number);
        const now = new Date();
        durationMinutes = Math.round((now.getHours() * 60 + now.getMinutes()) - (h * 60 + m));
        if (durationMinutes < 0) durationMinutes = null;
      }

      invoke("append_completion_log", {
        taskName: taskName || "Unknown",
        outcome: outcome ? outcome.value.trim() : "",
        prLinks: prs ? prs.value.trim() || null : null,
        followUps: followups ? followups.value.trim() || null : null,
        handoffNotes: handoff ? handoff.value.trim() || null : null,
        durationMinutes: durationMinutes,
      });
    } catch (e) {
      console.error("[TaskFlow] Completion log failed:", e);
    }

    await invoke("end_task");
    this.close();
  }

  async skipCompletion() {
    await invoke("end_task");
    this.close();
  }

  async copyCompletionSkill() {
    try {
      await navigator.clipboard.writeText("copilot /completion");
      const copiedEl = document.getElementById("completion-skill-copied");
      const copyBtn = document.getElementById("completion-copy-skill-btn");
      if (copiedEl) copiedEl.style.display = "block";
      if (copyBtn) copyBtn.style.display = "none";
    } catch (e) {
      console.error("[TaskFlow] Clipboard write failed:", e);
    }
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
      if (entryTaskName) entryTaskName.textContent = taskName || this._session.transcription;
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

      this.pendingTask = taskName || this._session.transcription;
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
      if (entryTaskName) entryTaskName.textContent = taskName || this._session.transcription;
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

      this.pendingTask = taskName || this._session.transcription;
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
    this.stopWaveform();

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
    this.populateWaveform("waveform");
    this.startWaveform("waveform");
    this.startRecording();
  }

  // ---- Inline transcription correction ----

  _renderClickableTranscript(container, text) {
    container.innerHTML = '';
    this._selectedRange = null; // track shift-click range

    const quote = (side) => {
      const q = document.createElement('span');
      q.textContent = side === 'open' ? '\u201c' : '\u201d';
      q.className = 'transcript-quote';
      return q;
    };
    container.appendChild(quote('open'));

    // Split preserving whitespace so we can reconstruct
    const tokens = text.split(/(\s+)/);
    this._transcriptTokens = tokens;

    tokens.forEach((token, i) => {
      if (/^\s+$/.test(token)) {
        container.appendChild(document.createTextNode(token));
        return;
      }
      const span = document.createElement('span');
      span.className = 'transcript-word';
      span.textContent = token;
      span.dataset.index = i;
      span.addEventListener('click', (e) => this._handleWordClick(container, span, i, e));
      container.appendChild(span);
    });

    container.appendChild(quote('close'));
  }

  _handleWordClick(container, span, tokenIndex, event) {
    // If edit is already open, ignore
    if (container.querySelector('.word-edit-wrap')) return;

    if (event.shiftKey && this._selectedRange !== null) {
      // Shift+click: extend selection to a range
      const start = Math.min(this._selectedRange, tokenIndex);
      const end = Math.max(this._selectedRange, tokenIndex);
      this._selectRange(container, start, end);
      return;
    }

    // Single click: mark this as selection anchor and open editor
    this._selectedRange = tokenIndex;
    this._startWordEdit(container, [tokenIndex]);
  }

  _selectRange(container, startIdx, endIdx) {
    // Clear any prior highlights
    container.querySelectorAll('.word-selected').forEach(el => el.classList.remove('word-selected'));

    // Collect all word token indices in the range
    const indices = [];
    const tokens = this._transcriptTokens;
    for (let i = startIdx; i <= endIdx; i++) {
      if (tokens[i] && !/^\s+$/.test(tokens[i])) {
        indices.push(i);
        const el = container.querySelector(`[data-index="${i}"]`);
        if (el) el.classList.add('word-selected');
      }
    }

    if (indices.length > 0) {
      this._startWordEdit(container, indices);
    }
  }

  _startWordEdit(container, tokenIndices) {
    // Don't open two editors at once
    if (container.querySelector('.word-edit-wrap')) return;

    const tokens = this._transcriptTokens;
    // Build the original phrase from token indices (including whitespace between)
    const minIdx = Math.min(...tokenIndices);
    const maxIdx = Math.max(...tokenIndices);
    const originalPhrase = tokens.slice(minIdx, maxIdx + 1).join('');

    // Find the first word span in range and replace it with the editor
    const firstSpan = container.querySelector(`[data-index="${minIdx}"]`);
    if (!firstSpan) return;

    // Hide all spans in the range (except the first, which we'll replace)
    for (let i = minIdx + 1; i <= maxIdx; i++) {
      const el = container.querySelector(`[data-index="${i}"]`);
      if (el) el.style.display = 'none';
      // Also hide whitespace text nodes between spans
    }
    // Hide intermediate whitespace text nodes
    let node = firstSpan.nextSibling;
    const hiddenNodes = [];
    while (node) {
      const nextNode = node.nextSibling;
      if (node.nodeType === Node.ELEMENT_NODE && node.dataset.index !== undefined) {
        const idx = parseInt(node.dataset.index, 10);
        if (idx > maxIdx) break;
        if (idx > minIdx) { node.style.display = 'none'; hiddenNodes.push(node); }
      } else if (node.nodeType === Node.TEXT_NODE) {
        // Check if this text node is between our range
        const prevEl = node.previousSibling;
        const nextEl = node.nextSibling;
        if (prevEl && nextEl && prevEl.dataset && nextEl.dataset) {
          const prevIdx = parseInt(prevEl.dataset.index, 10);
          const nextIdx = parseInt(nextEl.dataset.index, 10);
          if (prevIdx >= minIdx && nextIdx <= maxIdx) {
            const placeholder = document.createComment('ws');
            node.replaceWith(placeholder);
            hiddenNodes.push({ text: node, placeholder });
          }
        }
      }
      node = nextNode;
    }

    const wrap = document.createElement('span');
    wrap.className = 'word-edit-wrap';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'word-edit-input';
    input.value = originalPhrase.trim();
    input.size = Math.max(originalPhrase.length + 2, 8);

    const fixBtn = document.createElement('button');
    fixBtn.className = 'word-edit-fix';
    fixBtn.textContent = 'Fix';
    fixBtn.title = 'Fix this time only (Enter)';

    const alwaysBtn = document.createElement('button');
    alwaysBtn.className = 'word-edit-always';
    alwaysBtn.textContent = 'Always';
    alwaysBtn.title = 'Always auto-correct this (Shift+Enter)';

    wrap.appendChild(input);
    wrap.appendChild(fixBtn);
    wrap.appendChild(alwaysBtn);

    firstSpan.replaceWith(wrap);
    input.focus();
    input.select();

    const restoreAll = () => {
      // Restore hidden nodes
      for (const item of hiddenNodes) {
        if (item.placeholder) {
          item.placeholder.replaceWith(item.text);
        } else {
          item.style.display = '';
        }
      }
      // Restore first span
      const restored = document.createElement('span');
      restored.className = 'transcript-word';
      restored.textContent = tokens[minIdx];
      restored.dataset.index = minIdx;
      restored.addEventListener('click', (e) => this._handleWordClick(container, restored, minIdx, e));
      wrap.replaceWith(restored);
      // Clear selection highlights
      container.querySelectorAll('.word-selected').forEach(el => el.classList.remove('word-selected'));
      this._selectedRange = null;
    };

    const applyFix = (newText, flash) => {
      const trimmed = newText.trim();
      if (!trimmed || trimmed === originalPhrase.trim()) {
        restoreAll();
        return;
      }

      // Remove hidden intermediate spans/whitespace from DOM
      for (const item of hiddenNodes) {
        if (item.placeholder) item.placeholder.remove();
        else item.remove();
      }

      // Replace token range with the corrected text
      // Clear tokens from minIdx+1..maxIdx, put new text at minIdx
      for (let i = minIdx + 1; i <= maxIdx; i++) {
        tokens[i] = '';
      }
      tokens[minIdx] = trimmed;
      this.transcription = tokens.filter(t => t !== '').join('');

      // Update session data
      if (this._session) {
        const parsed = this._parseTranscription(this.transcription);
        this._session.taskName = parsed.taskName;
        this._session.transcription = this.transcription;
        const taskEl = document.getElementById("confirmed-task-name");
        if (taskEl) taskEl.textContent = `Switching to: ${parsed.taskName}`;
      }

      // Create corrected span
      const corrected = document.createElement('span');
      corrected.className = `transcript-word ${flash}`;
      corrected.textContent = trimmed;
      corrected.dataset.index = minIdx;
      corrected.addEventListener('click', (e) => this._handleWordClick(container, corrected, minIdx, e));
      wrap.replaceWith(corrected);

      container.querySelectorAll('.word-selected').forEach(el => el.classList.remove('word-selected'));
      this._selectedRange = null;

      setTimeout(() => corrected.classList.remove(flash), 600);
    };

    const doFix = () => {
      applyFix(input.value, 'word-fixed');
    };

    const doAlwaysFix = async () => {
      const newText = input.value.trim();
      const oldText = originalPhrase.trim();
      if (!newText || newText === oldText) { restoreAll(); return; }

      applyFix(input.value, 'word-corrected');

      // Determine match phrase: real word → save with context, non-word → save standalone
      let matchPhrase = oldText;
      const words = oldText.split(/\s+/);
      if (words.length === 1 && this._isLikelyRealWord(oldText)) {
        // Single real word — add surrounding context to avoid false positives
        matchPhrase = this._buildContextPhrase(tokens, minIdx, maxIdx);
        // Also build the replacement with the same context
        const replacementPhrase = this._buildReplacementPhrase(tokens, minIdx, maxIdx, newText);
        try {
          await Promise.all([
            invoke('add_correction', { matchPhrase: matchPhrase, replacement: replacementPhrase }),
            invoke('add_vocabulary_term', { term: newText }),
          ]);
        } catch (e) { console.warn('[TaskFlow] Failed to save correction:', e); }
        return;
      }

      // Non-word or multi-word — save as-is
      try {
        await Promise.all([
          invoke('add_correction', { matchPhrase: oldText, replacement: newText }),
          invoke('add_vocabulary_term', { term: newText }),
        ]);
      } catch (e) { console.warn('[TaskFlow] Failed to save correction:', e); }
    };

    fixBtn.addEventListener('click', doFix);
    alwaysBtn.addEventListener('click', doAlwaysFix);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); doAlwaysFix(); }
      else if (e.key === 'Enter') { e.preventDefault(); doFix(); }
      else if (e.key === 'Escape') { restoreAll(); }
    });
  }

  // Heuristic: is this likely a real English word (vs a transcription artefact)?
  // Real words: all lowercase, no unusual patterns. Artefacts: mixed case, all-caps with >1 char, etc.
  _isLikelyRealWord(word) {
    const clean = word.replace(/[^a-zA-Z]/g, '');
    if (clean.length === 0) return false;
    // All lowercase → likely real
    if (clean === clean.toLowerCase()) return true;
    // Title case (e.g. "Symphony") → likely real
    if (clean[0] === clean[0].toUpperCase() && clean.slice(1) === clean.slice(1).toLowerCase()) return true;
    // Short words (1-2 chars) in any case → likely real (e.g. "I", "PR")
    if (clean.length <= 2) return false; // short caps like "PR" are jargon, not real words
    // Mixed case or all-caps with 3+ chars → likely artefact
    return false;
  }

  // Build a context phrase: word + 1 word of context on each side
  _buildContextPhrase(tokens, minIdx, maxIdx) {
    const wordTokens = [];
    for (let i = 0; i < tokens.length; i++) {
      if (!/^\s+$/.test(tokens[i]) && tokens[i] !== '') {
        wordTokens.push({ text: tokens[i], idx: i });
      }
    }
    // Find position of our target in word list
    const startPos = wordTokens.findIndex(w => w.idx === minIdx);
    const endPos = wordTokens.findIndex(w => w.idx === maxIdx);
    if (startPos === -1) return tokens.slice(minIdx, maxIdx + 1).join('');

    const ctxStart = Math.max(0, startPos - 1);
    const ctxEnd = Math.min(wordTokens.length - 1, endPos + 1);
    return wordTokens.slice(ctxStart, ctxEnd + 1).map(w => w.text).join(' ');
  }

  // Build a replacement phrase with the same context but the corrected word(s)
  _buildReplacementPhrase(tokens, minIdx, maxIdx, newText) {
    const wordTokens = [];
    for (let i = 0; i < tokens.length; i++) {
      if (!/^\s+$/.test(tokens[i]) && tokens[i] !== '') {
        wordTokens.push({ text: tokens[i], idx: i });
      }
    }
    const startPos = wordTokens.findIndex(w => w.idx === minIdx);
    const endPos = wordTokens.findIndex(w => w.idx === maxIdx);
    if (startPos === -1) return newText;

    const ctxStart = Math.max(0, startPos - 1);
    const ctxEnd = Math.min(wordTokens.length - 1, endPos + 1);
    const parts = [];
    for (let i = ctxStart; i <= ctxEnd; i++) {
      if (i >= startPos && i <= endPos) {
        if (i === startPos) parts.push(newText); // only push replacement once
      } else {
        parts.push(wordTokens[i].text);
      }
    }
    return parts.join(' ');
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

  // ---- Waveform visualisation ----

  populateWaveform(id) {
    const container = document.getElementById(id);
    if (!container) return;
    container.innerHTML = "";

    for (let i = 0; i < 36; i++) {
      const bar = document.createElement("span");
      bar.style.height = `${3 + Math.random() * 4}px`;
      bar.style.opacity = "0.3";
      container.appendChild(bar);
    }
  }

  startWaveform(id) {
    const container = document.getElementById(id);
    if (!container) return;
    const bars = container.children;
    const barCount = bars.length;
    const mid = barCount / 2;

    const animate = () => {
      const amp = Math.min(this._lastAmplitude * 8, 1);
      for (let i = 0; i < barCount; i++) {
        const distFromMid = Math.abs(i - mid) / mid;
        const taper = 1 - distFromMid * 0.6;
        const jitter = 0.85 + Math.random() * 0.3;
        const h = 3 + amp * 15 * taper * jitter;
        bars[i].style.height = `${h}px`;
        bars[i].style.opacity = `${0.3 + amp * 0.7 * taper}`;
      }
      this._waveformRaf = requestAnimationFrame(animate);
    };

    this._waveformRaf = requestAnimationFrame(animate);
  }

  stopWaveform() {
    if (this._waveformRaf) {
      cancelAnimationFrame(this._waveformRaf);
      this._waveformRaf = null;
    }
    this._lastAmplitude = 0;
    const container = document.getElementById("waveform");
    if (container) {
      for (const bar of container.children) {
        bar.style.height = "3px";
        bar.style.opacity = "0.3";
      }
    }
  }

  // ---- Demo ----

  async demo() {
    this.show("listening");
    this.startWaveform("waveform");
    await this.wait(2000);

    this.stopWaveform();
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
