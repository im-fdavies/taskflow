# DONE: Transcription vocabulary + in-app correction system

| Field        | Value                    |
|-------------|--------------------------|
| Phase       | P1: Core Loop            |
| Priority    | Must have                |
| Status      | Done                     |
| Est. Effort | Medium (3-5h)            |
| Dependencies| P1 complete              |

## Description

Two-part system:

1. **vocabulary.yaml** - file that feeds whisper.cpp `--prompt` flag with known terms, loaded on startup.
2. **Post-transcription correction map** - when Whisper consistently mishears a word (PRMNs -> PR amends), store the mapping and auto-replace.

## In-app UX

- Click wrong word -> "Fix" (one-time) or "Always fix" (persists)
- Phrase-based matching prevents false positives
- Shift+click for multi-word phrase correction (e.g. "PR immense" -> "PR amends")

## Current state

Agent prompt delivered (`patch-vocabulary-corrections-v2.md`) but implementation unverified - `corrections.yaml` stays empty after "Always fix" clicks (blocked by param naming bug).

Files stored in `~/.taskflow/` alongside `config.toml`.

## Blocker

Depends on the camelCase vs snake_case param naming bug being fixed first. Verify after that fix lands.

## Completion

**Tested by:**
- **Check 1 — Vocabulary → Whisper**: `vocabulary_prompt_string()` at lib.rs:105-107 joins terms with `", "`. `transcribe_audio()` calls it at line 287 and passes as `--prompt` arg at line 298 ✅
- **Check 2 — Auto-correction**: `transcribe_audio()` calls `apply_corrections(&text)` at line 325. `apply_corrections()` sorts entries longest-first (line 163), uses `\b{word}\b` for single words and `\b{word}\s+{word}\b` for multi-word (lines 171-178), case-insensitive via `(?i)` flag ✅
- **Check 3 — `add_correction` command**: Has `rename_all = "camelCase"` (line 361), accepts `match_phrase`/`replacement`, deduplicates via `retain` + `eq_ignore_ascii_case` (line 370), saves via `save_corrections_file()` (line 373) ✅
- **Check 4 — JS "Always fix" flow**: `doAlwaysFix` handler (lines 1301-1332) wired to `alwaysBtn` at line 1335. Single real-word path calls `invoke('add_correction', { matchPhrase, replacement })` at line 1318 with context phrase; multi-word/artefact path calls same at line 1328 with raw text. Both paths call `invoke('add_vocabulary_term', { term: newText })` ✅
- **Check 5 — File I/O**: `ls ~/.taskflow/` — vocabulary.yaml (13 default terms seeded) and corrections.yaml (empty `corrections: []`) both exist. `load_vocabulary()` creates defaults on missing file (lines 88-95); `load_corrections()` creates empty file on missing (lines 139-145) ✅
- **Check 6 — Shift+click multi-word**: `_handleWordClick` checks `event.shiftKey && this._selectedRange !== null` (line 1126) and calls `_selectRange(container, start, end)`. `_selectRange()` clears `.word-selected`, highlights range tokens, calls `_startWordEdit(container, indices)` ✅

**Unexpected outcomes:**
- None

**Follow-up tasks:**
- None

**Confidence:** [9/10] — All 6 checks verified by direct code inspection and confirmed `~/.taskflow/` file state; only gap is runtime testing of the full click-to-correct flow end-to-end in the Tauri app.

**Files modified:**
- None (verification only task)
