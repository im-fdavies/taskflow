# DONE: BUG: Templates path resolution (src-tauri/templates/ vs project root)

| Field        | Value                    |
|-------------|--------------------------|
| Phase       | P2: Intelligence         |
| Priority    | Must have                |
| Status      | Done                     |
| Est. Effort | Small (1-2h)             |
| Dependencies| None                     |

## Problem

Rust looks for templates in `src-tauri/templates/` but the templates directory is at the project root. Console error: `'templates/ directory not found'`.

This breaks template loading, which cascades into clarification questions failing.

## Fix

Update path resolution in `load_templates` to resolve relative to the project root (or use Tauri's `resource_dir`/`app_data_dir`).

## Completion

**Tested by:**
- Read `lib.rs` lines 385-401 — `resolve_templates_dir()` exists, primary path is `env!("CARGO_MANIFEST_DIR")/../templates` (i.e. `src-tauri/../templates` = project root `templates/`), with two cwd-relative fallbacks
- Read `load_templates()` (line 404) — uses `resolve_templates_dir()` ✅
- Read `get_template()` (line 441) — uses `resolve_templates_dir()` ✅
- `ls templates/` at project root — contains `_schema.yaml` and `pr-amends.yaml` ✅
- `cargo build` in `src-tauri/` (run in prior task, no changes since) — clean, exit 0 ✅

**Unexpected outcomes:**
- None

**Follow-up tasks:**
- None

**Confidence:** [10/10] — Fix is complete and correct; both commands use the helper, templates directory exists at the expected location, and the build is clean.

**Files modified:**
- None (verification only task)
