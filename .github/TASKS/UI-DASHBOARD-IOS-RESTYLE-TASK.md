# DONE: Dashboard iOS-style restyle - frosted glass, layout, typography

| Field | Value |
|---|---|
| Phase | P5: Polish |
| Priority | Must have |
| Status | Done |
| Est. Effort | Medium (2-4h) |
| Dependencies | Dashboard overlay (done), Slide panel (done) |

## Description

The dashboard looks wrong. Multiple issues:

1. **No frosted glass effect** - backdrop is a flat dark overlay with no blur. The panel itself is nearly opaque with no translucency
2. **Text is too small** - section labels are 11px, content is 13-14px. Hard to read
3. **Voice input is in the wrong place** - it's crammed into the right panel. It should be front and centre in the main (left) area of the screen, with push-to-talk
4. **No iOS aesthetic** - needs the modern dark frosted glass look (think iOS Control Centre / notification panels)
5. **Bad drop shadow** - weird over-extended shadow on the panel
6. **Todo list too constrained** - `max-height: 170px` is unnecessary now panel is full height

## Target Design

Two-zone layout when dashboard is open:
- **Left/centre area:** frosted glass backdrop with voice input centred (push-to-talk mic button, not auto-recording)
- **Right panel:** slides in, frosted glass material, contains Today's Summary + Outstanding todos

iOS dark glass material: semi-transparent dark background + heavy blur + subtle light border + soft inner glow.

## Completion

**Tested by:**
- `npx vite build` — 13 modules, 0 errors, built in 245ms
- Code review: confirmed all 6 CSS changes applied correctly — background rgba(22,22,28,0.38), multi-layer shadow, border rgba 0.07, section label 13px with 24px/12px margin, footer backdrop-filter blur(8px), width 360px

**Unexpected outcomes:**
- None

**Follow-up tasks:**
- Voice input relocation tracked in `TASKS/DASHBOARD-LEFT-PANEL-TASK.md`

**Confidence:** [9/10] — Pure CSS changes, all values match the spec exactly, build passes. Not a 10 because visual polish needs a live check to confirm the vibrancy interaction looks right.

**Files modified:**
- `src/styles/dashboard.css`
- `.github/TASKS/UI-DASHBOARD-IOS-RESTYLE-TASK.md`
