# Transcription vocabulary + in-app correction system

| Field        | Value                    |
|-------------|--------------------------|
| Phase       | P1: Core Loop            |
| Priority    | Must have                |
| Status      | In progress              |
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
