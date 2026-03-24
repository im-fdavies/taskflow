# Press-hold-release recording trigger

| Field        | Value                    |
|-------------|--------------------------|
| Phase       | P5: Polish               |
| Priority    | Should have              |
| Status      | Not started              |
| Est. Effort | Medium (3-5h)            |
| Dependencies| P1 complete              |

## Description

Replace click-Done recording flow with press-hold-release on the hotkey. Cmd+Shift+Space hold = record, release = stop and transcribe.

## Implementation

Needs Tauri global shortcut key-up event handling.
