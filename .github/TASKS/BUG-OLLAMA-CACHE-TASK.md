# DONE: BUG: Ollama availability check not cached

| Field        | Value                    |
|-------------|--------------------------|
| Phase       | P2: Intelligence         |
| Priority    | Should have              |
| Status      | Done                     |
| Est. Effort | Small (1-2h)             |
| Dependencies| None                     |

## Problem

When Ollama is not running, the app retries the availability check on every context switch instead of caching the result. Causes repeated timeout warnings in console.

## Fix

Cache the Ollama availability result (with a TTL or until next app restart) so it only checks once.

## Completion

**Tested by:**
- Read `AppState` struct (lib.rs:222-227) — `ollama_available: Mutex<Option<bool>>` field present ✅
- Read `check_ollama()` (lib.rs:797-822) — cache read at lines 800-805, early return if `Some(available)` exists ✅
- Read `check_ollama()` line 820 — `*state.ollama_available.lock().unwrap() = Some(available)` writes result back to cache ✅
- Read `AppState` initialization (lib.rs:956-959) — `ollama_available: Mutex::new(None)` ensures first call does a real check ✅
- Grep for all `11434` occurrences in lib.rs — two hits: line 812 (the `check_ollama` availability check) and line 862 (`detect_mode_llm` actual LLM generation call). The generation call is not an availability re-check — it's only reached from JS when `this._ollamaAvailable` is already `true` (set once at startup via `check_ollama`). No uncached bypass paths exist ✅

**Unexpected outcomes:**
- None

**Follow-up tasks:**
- None

**Confidence:** [10/10] — Cache read/write paths confirmed in code, initialization is `None`, JS gates `detect_mode_llm` behind `_ollamaAvailable`, and the only other Ollama hit is the actual LLM call (not an availability re-check).

**Files modified:**
- None (verification only task)
