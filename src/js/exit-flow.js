// ===================================================================
// TaskFlow — Exit flow
// Exit state: capture what user was doing before switching.
// Includes voice mic helpers, exit interview question, agent context.
// ===================================================================

const { invoke } = window.__TAURI__.core;

let _agentContextContent = null;

/**
 * Configure and show the exit state.
 * @param {object} session - Current session data
 * @param {object} callbacks - { showState, showTransitionState, skipExitWithExtracted }
 * @returns {boolean} true if exit state was shown, false if skipped (mode 3 + extracted exit)
 */
export function showExitState(session, callbacks) {
  const { mode, taskName, extractedExit, extractedBookmark } = session;
  console.log("[TaskFlow] EXIT pre-pop:", { extractedExit, extractedBookmark });

  const label = document.getElementById("exit-label");
  const prompt = document.getElementById("exit-prompt");
  const subtitle = document.getElementById("exit-subtitle");
  const notes = document.getElementById("exit-notes");
  const skipBtn = document.getElementById("exit-skip-btn");
  const submitBtn = document.getElementById("exit-submit-btn");

  if (notes) notes.value = "";

  // Mode 3 with extracted exit context: skip exit entirely
  if (mode === 3 && extractedExit) {
    session.exitCapture = extractedExit;
    callbacks.showTransitionState();
    return false;
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
    if (label) label.textContent = "Exit · Full";
    if (prompt) prompt.textContent = "Where are you leaving off?";
    if (subtitle) subtitle.textContent = "What were you doing? What state is the work in? What would you pick up first if you came back?";
    if (notes) notes.placeholder = "What were you just doing? What state is it in?";
    if (notes) notes.rows = 3;
    if (skipBtn) skipBtn.style.display = "none";
    if (submitBtn) submitBtn.textContent = "Continue →";
  }

  // Pre-populate exit notes
  if (extractedExit && notes) {
    notes.classList.add("prefilled");
    const hintEl = document.getElementById("exit-prefilled-hint");
    if (hintEl) { hintEl.textContent = "From your description"; hintEl.style.display = "block"; }
  } else if (!extractedExit && session.currentTask && notes) {
    notes.value = session.currentTask;
    notes.classList.add("prefilled");
    const hintEl = document.getElementById("exit-prefilled-hint");
    if (hintEl) { hintEl.textContent = "Current task"; hintEl.style.display = "block"; }
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
      skipBtn.onclick = () => callbacks.skipExitWithExtracted();
    }
  } else if (mode === 2 && hasExit) {
    if (skipBtn) {
      skipBtn.style.display = "inline-flex";
      skipBtn.textContent = "Looks right — skip →";
      skipBtn.onclick = () => callbacks.skipExitWithExtracted();
    }
  }

  callbacks.showState('exit');
  // Apply value after show() — WKWebView textarea reset workaround
  if (extractedExit && notes) notes.value = extractedExit;
  else if (!extractedExit && session.currentTask && notes) notes.value = session.currentTask;
  setTimeout(() => { if (notes) notes.focus(); }, 200);
  if (mode !== 3) {
    fetchExitQuestion(session);
    checkAgentContext();
  }
  return true;
}

export async function fetchExitQuestion(session) {
  const { transcription, exitCapture, extractedExit, taskName, template } = session;

  const nudge = document.getElementById('exit-question-nudge');
  const thinking = document.getElementById('exit-question-thinking');
  const body = document.getElementById('exit-question-body');
  const textEl = document.getElementById('exit-question-text');
  if (!nudge || !thinking || !body || !textEl) return;

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
    nudge.style.display = 'none';
    thinking.style.display = 'none';
  }
}

export async function checkAgentContext() {
  const btn = document.getElementById('exit-context-btn');
  if (!btn) return;

  btn.style.display = 'none';
  _agentContextContent = null;

  try {
    const context = await invoke('read_agent_context');
    if (context) {
      _agentContextContent = context;
      btn.style.display = 'block';
    }
  } catch (err) {
    // Silent fail — no context available
  }
}

export function loadAgentContext() {
  const btn = document.getElementById('exit-context-btn');
  const notes = document.getElementById('exit-notes');
  if (!_agentContextContent || !notes) return;

  const existing = notes.value.trim();
  const separator = existing ? '\n\n---\n' : '';
  notes.value = existing + separator + _agentContextContent;
  notes.classList.add('prefilled');

  if (btn) btn.style.display = 'none';
  const loadedEl = document.getElementById('exit-context-loaded');
  if (loadedEl) loadedEl.style.display = 'block';

  notes.focus();
  notes.setSelectionRange(notes.value.length, notes.value.length);
}

/**
 * Validate and collect exit data, returning it for the orchestrator to use.
 * @param {object} session
 * @returns {{ valid: boolean, exitCapture: string, bookmark: string }}
 */
export function submitExit(session) {
  const notes = document.getElementById("exit-notes");
  const exitCapture = notes ? notes.value.trim() : "";

  if (session.mode === 1 && !exitCapture) {
    const notes_el = document.getElementById("exit-notes");
    if (notes_el) {
      notes_el.style.borderColor = "rgba(239, 68, 68, 0.5)";
      notes_el.placeholder = "Required — what state is your work in?";
      notes_el.focus();
      setTimeout(() => { notes_el.style.borderColor = ""; }, 2000);
    }
    return { valid: false };
  }

  const bookmarkNotes = document.getElementById("exit-bookmark");
  const bookmark = bookmarkNotes ? bookmarkNotes.value.trim() : "";
  const lessonEl = document.getElementById("exit-lesson");
  const lesson = lessonEl ? lessonEl.value.trim() : "";
  return { valid: true, exitCapture, bookmark, lesson };
}

export function skipExitWithExtracted() {
  const notes = document.getElementById("exit-notes");
  const bookmarkNotes = document.getElementById("exit-bookmark");
  const lessonEl = document.getElementById("exit-lesson");
  return {
    exitCapture: notes ? notes.value.trim() : "",
    bookmark: bookmarkNotes ? bookmarkNotes.value.trim() : "",
    lesson: lessonEl ? lessonEl.value.trim() : "",
  };
}

export function updateExitMicBtn(btnId, isRecording) {
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

export async function toggleExitVoice(textareaId, capture, btnId) {
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
