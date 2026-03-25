// ===================================================================
// TaskFlow — Pure logic functions (no DOM, no Tauri IPC)
// Extracted for testability. Used by TaskFlowApp and test suite.
// ===================================================================

/**
 * Rule-based context switch mode detection.
 * @param {string} text - Transcribed user utterance
 * @param {string|null} currentTask - Currently active task name
 * @returns {{ mode: number, confidence: string }}
 */
export function detectMode(text, currentTask) {
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

/**
 * Parse a voice transcription into task name, exit context, and bookmark.
 * @param {string} text - Raw transcription
 * @returns {{ taskName: string|null, exitContext: string|null, bookmark: string|null }}
 */
export function parseTranscription(text) {
  const result = { taskName: null, exitContext: null, bookmark: null };
  if (!text) return result;

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

  return result;
}

/**
 * Match a transcription against template trigger phrases.
 * @param {string} text - Transcription text
 * @param {Array} templates - Array of template objects with `triggers` arrays
 * @returns {object|null} Matched template or null
 */
export function matchTemplate(text, templates) {
  const lower = text.toLowerCase();
  for (const template of templates) {
    const triggers = Array.isArray(template.triggers) ? template.triggers : [];
    if (triggers.some((t) => lower.includes(t.toLowerCase()))) {
      return template;
    }
  }
  return null;
}

/**
 * Detect whether a transcription is a "start task" intent (first task of the day)
 * rather than a context switch between tasks.
 * @param {string} text - Transcribed user utterance
 * @param {string|null} currentTask - Currently active task name (null = no active task)
 * @returns {boolean} True if this is a fresh start, not a switch
 */
export function isStartIntent(text, currentTask) {
  // If there's already an active task, this is a switch, not a fresh start
  if (currentTask) return false;

  const lower = text.toLowerCase();

  // Explicit start language at the beginning
  const startPatterns = [
    /^(?:i'm |i am )?(?:starting|picking up|beginning|working on|kicking off)\b/,
    /^(?:let me |gonna |going to )(?:start|pick up|work on|begin|do)\b/,
    /^(?:time to |let's )(?:start|work on|pick up|do|begin)\b/,
    /^(?:picking up|resuming|continuing|back to|back on)\b/,
  ];

  if (startPatterns.some(p => p.test(lower))) return true;

  // No exit markers = probably just stating what they're doing, not switching
  const hasExitMarkers = /\b(?:was working on|done with|finished|leaving|coming from|interrupted|pulled away|in the middle of|got distracted)\b/i.test(text);
  if (!hasExitMarkers) return true;

  return false;
}

/**
 * Fuzzy match a task name against a list of known task names.
 * Returns the best match or null.
 * @param {string} taskName - What the user said they're starting
 * @param {Array<{name: string}>} candidates - Tasks/todos to match against
 * @returns {{ match: object, score: string }|null}
 */
export function fuzzyMatchTask(taskName, candidates) {
  if (!taskName || !candidates.length) return null;

  const lower = taskName.toLowerCase().trim();

  // Pass 1: exact match (case insensitive)
  for (const c of candidates) {
    if (c.name.toLowerCase().trim() === lower) {
      return { match: c, score: "exact" };
    }
  }

  // Pass 2: one contains the other
  for (const c of candidates) {
    const cLower = c.name.toLowerCase().trim();
    if (cLower.includes(lower) || lower.includes(cLower)) {
      return { match: c, score: "contains" };
    }
  }

  // Pass 3: significant word overlap (words > 3 chars)
  const taskWords = lower.split(/\s+/).filter(w => w.length > 3);
  if (taskWords.length === 0) return null;

  let bestMatch = null;
  let bestOverlap = 0;

  for (const c of candidates) {
    const cWords = c.name.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const overlap = taskWords.filter(w => cWords.some(cw => cw.includes(w) || w.includes(cw))).length;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestMatch = c;
    }
  }

  if (bestMatch && bestOverlap >= 1) {
    return { match: bestMatch, score: "overlap" };
  }

  return null;
}

/**
 * Extract a todo task from a voice command.
 * @param {string} text - Transcription text
 * @param {boolean} fromDashboard - Whether called from the dashboard voice tap
 * @returns {string|null} Task name or null
 */
export function parseTodoIntent(text, fromDashboard = false) {
  const tailPattern = /\s+to\s+(?:my\s+)?(?:to[- ]?do\s+)?(?:todos?|list|tasks?)\s*\.?$/i;
  if (/^add\s+/i.test(text) && tailPattern.test(text)) {
    const task = text.replace(/^add\s+/i, '').replace(tailPattern, '').trim();
    if (task) return task;
  }
  const rememberMatch = text.match(/^(?:remember|remind me to?)\s+(.+)/i);
  if (rememberMatch) return rememberMatch[1].trim();
  const stripped = text.replace(/^(?:add|todo|task|I need to|I want to|please)\s+/i, '').trim();
  if (fromDashboard && stripped) return stripped;
  return null;
}
