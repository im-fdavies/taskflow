# DONE: Additional templates (bug, code review, spike)

| Field        | Value                    |
|-------------|--------------------------|
| Phase       | P5: Polish               |
| Priority    | Should have              |
| Status      | Done                     |
| Est. Effort | Medium (3-5h)            |
| Dependencies| Template storage working |

## Description

Design and add templates for:
- Bug investigation
- Code review (someone else's PR)
- New feature spike

Same principles: 3 phases max, signal-triggered coaching only.

## Completion

**Tested by:**
- `python3 -c "import yaml; yaml.safe_load(open('templates/bug-investigation.yaml'))"` — OK
- `python3 -c "import yaml; yaml.safe_load(open('templates/code-review.yaml'))"` — OK
- `python3 -c "import yaml; yaml.safe_load(open('templates/investigation.yaml'))"` — OK
- `cargo build --manifest-path src-tauri/Cargo.toml` — Finished in 0.77s, no errors
- `ls templates/*.yaml` — 4 templates present (plus `_schema.yaml`)

**Unexpected outcomes:**
- None

**Follow-up tasks:**
- None

**Confidence:** [10/10] — Files were created verbatim from the prompt spec and all three parse as valid YAML with a clean Rust build.

**Files modified:**
- `templates/bug-investigation.yaml`
- `templates/code-review.yaml`
- `templates/investigation.yaml`
- `.github/TASKS/ADDITIONAL-TEMPLATES-TASK.md`

