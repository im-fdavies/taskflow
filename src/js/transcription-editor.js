// ===================================================================
// TaskFlow — Inline transcription correction editor
// Renders clickable word tokens. Click to fix, Shift+click for ranges.
// ===================================================================

const { invoke } = window.__TAURI__.core;

let _tokens = [];
let _selectedRange = null;

/**
 * Render a transcription as clickable word tokens inside a container.
 * @param {HTMLElement} container - DOM element to render into
 * @param {string} text - The transcription text
 * @param {function} onUpdate - Callback: (newTranscription, newParsed) when user corrects a word
 * @param {function} parseTranscription - Function to re-parse transcription text
 */
export function renderClickableTranscript(container, text, onUpdate, parseTranscription) {
  container.innerHTML = '';
  _selectedRange = null;

  const quote = (side) => {
    const q = document.createElement('span');
    q.textContent = side === 'open' ? '\u201c' : '\u201d';
    q.className = 'transcript-quote';
    return q;
  };
  container.appendChild(quote('open'));

  _tokens = text.split(/(\s+)/);

  _tokens.forEach((token, i) => {
    if (/^\s+$/.test(token)) {
      container.appendChild(document.createTextNode(token));
      return;
    }
    const span = document.createElement('span');
    span.className = 'transcript-word';
    span.textContent = token;
    span.dataset.index = i;
    span.addEventListener('click', (e) => _handleWordClick(container, span, i, e, onUpdate, parseTranscription));
    container.appendChild(span);
  });

  container.appendChild(quote('close'));
}

function _handleWordClick(container, span, tokenIndex, event, onUpdate, parseTranscription) {
  if (container.querySelector('.word-edit-wrap')) return;

  if (event.shiftKey && _selectedRange !== null) {
    const start = Math.min(_selectedRange, tokenIndex);
    const end = Math.max(_selectedRange, tokenIndex);
    _selectRange(container, start, end, onUpdate, parseTranscription);
    return;
  }

  _selectedRange = tokenIndex;
  _startWordEdit(container, [tokenIndex], onUpdate, parseTranscription);
}

function _selectRange(container, startIdx, endIdx, onUpdate, parseTranscription) {
  container.querySelectorAll('.word-selected').forEach(el => el.classList.remove('word-selected'));

  const indices = [];
  for (let i = startIdx; i <= endIdx; i++) {
    if (_tokens[i] && !/^\s+$/.test(_tokens[i])) {
      indices.push(i);
      const el = container.querySelector(`[data-index="${i}"]`);
      if (el) el.classList.add('word-selected');
    }
  }

  if (indices.length > 0) {
    _startWordEdit(container, indices, onUpdate, parseTranscription);
  }
}

function _startWordEdit(container, tokenIndices, onUpdate, parseTranscription) {
  if (container.querySelector('.word-edit-wrap')) return;

  const tokens = _tokens;
  const minIdx = Math.min(...tokenIndices);
  const maxIdx = Math.max(...tokenIndices);
  const originalPhrase = tokens.slice(minIdx, maxIdx + 1).join('');

  const firstSpan = container.querySelector(`[data-index="${minIdx}"]`);
  if (!firstSpan) return;

  // Hide all spans in the range (except the first, which we'll replace)
  for (let i = minIdx + 1; i <= maxIdx; i++) {
    const el = container.querySelector(`[data-index="${i}"]`);
    if (el) el.style.display = 'none';
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
    for (const item of hiddenNodes) {
      if (item.placeholder) {
        item.placeholder.replaceWith(item.text);
      } else {
        item.style.display = '';
      }
    }
    const restored = document.createElement('span');
    restored.className = 'transcript-word';
    restored.textContent = tokens[minIdx];
    restored.dataset.index = minIdx;
    restored.addEventListener('click', (e) => _handleWordClick(container, restored, minIdx, e, onUpdate, parseTranscription));
    wrap.replaceWith(restored);
    container.querySelectorAll('.word-selected').forEach(el => el.classList.remove('word-selected'));
    _selectedRange = null;
  };

  const applyFix = (newText, flash) => {
    const trimmed = newText.trim();
    if (!trimmed || trimmed === originalPhrase.trim()) {
      restoreAll();
      return;
    }

    for (const item of hiddenNodes) {
      if (item.placeholder) item.placeholder.remove();
      else item.remove();
    }

    for (let i = minIdx + 1; i <= maxIdx; i++) {
      tokens[i] = '';
    }
    tokens[minIdx] = trimmed;
    const newTranscription = tokens.filter(t => t !== '').join('');

    // Notify the app of the change
    if (onUpdate && parseTranscription) {
      const parsed = parseTranscription(newTranscription);
      onUpdate(newTranscription, parsed);
    }

    const corrected = document.createElement('span');
    corrected.className = `transcript-word ${flash}`;
    corrected.textContent = trimmed;
    corrected.dataset.index = minIdx;
    corrected.addEventListener('click', (e) => _handleWordClick(container, corrected, minIdx, e, onUpdate, parseTranscription));
    wrap.replaceWith(corrected);

    container.querySelectorAll('.word-selected').forEach(el => el.classList.remove('word-selected'));
    _selectedRange = null;

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

    let matchPhrase = oldText;
    const words = oldText.split(/\s+/);
    if (words.length === 1 && _isLikelyRealWord(oldText)) {
      matchPhrase = _buildContextPhrase(tokens, minIdx, maxIdx);
      const replacementPhrase = _buildReplacementPhrase(tokens, minIdx, maxIdx, newText);
      try {
        await Promise.all([
          invoke('add_correction', { matchPhrase: matchPhrase, replacement: replacementPhrase }),
          invoke('add_vocabulary_term', { term: newText }),
        ]);
      } catch (e) { console.warn('[TaskFlow] Failed to save correction:', e); }
      return;
    }

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

function _isLikelyRealWord(word) {
  const clean = word.replace(/[^a-zA-Z]/g, '');
  if (clean.length === 0) return false;
  if (clean === clean.toLowerCase()) return true;
  if (clean[0] === clean[0].toUpperCase() && clean.slice(1) === clean.slice(1).toLowerCase()) return true;
  if (clean.length <= 2) return false;
  return false;
}

function _buildContextPhrase(tokens, minIdx, maxIdx) {
  const wordTokens = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!/^\s+$/.test(tokens[i]) && tokens[i] !== '') {
      wordTokens.push({ text: tokens[i], idx: i });
    }
  }
  const startPos = wordTokens.findIndex(w => w.idx === minIdx);
  const endPos = wordTokens.findIndex(w => w.idx === maxIdx);
  if (startPos === -1) return tokens.slice(minIdx, maxIdx + 1).join('');

  const ctxStart = Math.max(0, startPos - 1);
  const ctxEnd = Math.min(wordTokens.length - 1, endPos + 1);
  return wordTokens.slice(ctxStart, ctxEnd + 1).map(w => w.text).join(' ');
}

function _buildReplacementPhrase(tokens, minIdx, maxIdx, newText) {
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
      if (i === startPos) parts.push(newText);
    } else {
      parts.push(wordTokens[i].text);
    }
  }
  return parts.join(' ');
}
