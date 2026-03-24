# DONE: Dashboard: slide-in panel from right with frosted backdrop

| Field | Value |
|---|---|
| Phase | P5: Polish |
| Priority | Should have |
| Status | Done |
| Est. Effort | Small (1-2h) |
| Dependencies | Dashboard overlay (done) |

## Description

The dashboard currently renders centred in the overlay like the other states. It should instead:

1. **Slide in from the right** - panel takes up full height of the screen, fixed width (e.g. 360-400px), slides in with a CSS transition
2. **Frosted glass backdrop** - the rest of the screen behind the panel gets a subtle `backdrop-filter: blur()` frost effect
3. Clicking the frosted backdrop or pressing Escape closes the dashboard
4. The panel should slide back out on close (not just disappear)

## Notes

- This is CSS/HTML only - no Rust changes needed
- The `#s-dashboard` state needs different layout rules to the other states (not centred, not full-width of overlay)
- Consider whether the dashboard should sit outside the normal `#overlay` flow or override its positioning when active

## Completion

**Tested by:**
- `cargo build` — clean, no errors (no Rust changes needed)
- Reviewed `#dashboard-backdrop` placement in `index.html`: sits before `#s-dashboard`, inside `#overlay`, independent of the panel
- Reviewed backdrop CSS: `display:none` / `opacity:0` base; `.visible` class transitions opacity to 1; `-webkit-backdrop-filter: blur(8px)` for frosted effect; `z-index: 10`
- Reviewed `#s-dashboard` CSS: `position: fixed; right: 0; width: 380px; height: 100vh` takes it out of the centred flex layout; `display: flex` always (overrides `.state { display: none }`) so CSS `transform` transition fires correctly; `translateX(100%)` default → `translateX(0)` on `.active`; `animation: none` suppresses the base fadeIn; `z-index: 11` above backdrop
- Reviewed `.dashboard-backdrop` added to `-webkit-app-region: no-drag` rule so clicks register
- Reviewed `showDashboard()`: sets `backdrop.style.display = "block"`, forces reflow with `offsetHeight`, then adds `.visible` to trigger opacity transition — then calls `this.show("dashboard")` to add `.active` (triggers panel slide)
- Reviewed `close()`: dashboard branch sets inline `style.transform = "translateX(100%)"` (slides out), removes `.visible` from backdrop, awaits 300ms matching CSS duration, clears inline style, hides backdrop, then calls `invoke("hide_overlay")`; non-dashboard branch clears backdrop immediately
- Reviewed backdrop click handler in `init()`: guards on `this.currentState === "dashboard"` before calling `close()`
- Verified `#s-dashboard .footer` no longer has `border-radius` or `flex-shrink` / `margin-top` overrides (correct for flush panel)

**Unexpected outcomes:**
- Made `#s-dashboard` always `display: flex` (overriding `.state { display: none }`) so the CSS `transform` transition fires on open — the prompt implied this but didn't state it explicitly; without it the slide-in animation cannot work because display-none → flex jumps don't trigger transitions
- `dashboard-todo-list`'s `max-height: 170px` constraint left unchanged per minimal-changes rule; in a 100vh panel this may feel limiting — noted as follow-up

**Follow-up tasks:**
- Remove `max-height: 170px` constraint from `.dashboard-todo-list` now that the panel is full-height (currently capped at ~170px of the available 100vh)

**Confidence:** [9/10] — CSS transition logic is correct; the `display: flex` override is the right solution; untested in live Tauri WebKit but the approach matches WebKit's known transition behaviour.

**Files modified:**
- `index.html`
- `src/styles.css`
- `src/app.js`
