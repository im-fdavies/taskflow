# BUG: EXIT first textarea not pre-populating from initial transcription

| Field        | Value                    |
|-------------|--------------------------|
| Phase       | P2: Intelligence         |
| Priority    | Must have                |
| Status      | Not started              |
| Est. Effort | Medium (3-5h)            |
| Dependencies| None                     |

## Problem

The EXIT state's first textarea ("what were you doing") does not pre-populate with exit context extracted from the initial transcription. The second textarea (bookmark field) works correctly.

Multiple blind patch attempts have failed (3+).

## Fix approach

The agent MUST read the actual `extractExitContext` and `showExitState` functions in `app.js` and trace the data flow before writing a fix - do not write another speculative patch.

Check:
1. Is `exitContext` being extracted?
2. Is it being passed to `showExitState`?
3. Is the textarea's value being set?
4. Is something overwriting it after?
