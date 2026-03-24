# Draggable overlay window

| Field        | Value                    |
|-------------|--------------------------|
| Phase       | P5: Polish               |
| Priority    | Should have              |
| Status      | Not started              |
| Est. Effort | Small (1-2h)             |
| Dependencies| P0 complete              |

## Description

Make the overlay card draggable so it can be repositioned when it covers text the user needs to read.

## Implementation

Tauri supports this via `data-tauri-drag-region` attribute on an element, or via the `window.startDragging()` API.
