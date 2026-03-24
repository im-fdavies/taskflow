# DONE: UI copy: Rename 'EXIT CAPTURE' label in transition state

| Field        | Value                    |
|-------------|--------------------------|
| Phase       | P5: Polish               |
| Priority    | Nice to have             |
| Status      | Done                     |
| Est. Effort | Small (1-2h)             |
| Dependencies| None                     |

## Description

The transition state currently shows "EXIT CAPTURE" as a label. Should read "Previously working on" or similar. Quick string change in `app.js`.

## Completion

**Tested by:** Confirmed `index.html:96` already reads `Putting on hold:` which is the desired label. No dynamic JS overrides exist.

**Unexpected outcomes:** Label had already been changed manually before this task was picked up.

**Follow-up tasks:** None

**Confidence:** [10/10] - Verified in source, label matches user's intent.

**Files modified:** None (already done)
