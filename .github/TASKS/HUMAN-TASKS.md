# Human Testing Tasks

Manual runtime checks the dev agent can't perform (requires macOS app + microphone).

## BUG-EXIT-TEXTAREA-PREPOPULATE

**Status:** Code looks correct (commit `23222a8`), needs runtime confirmation.

- [ ] Launch app, start a task, then voice-trigger a context switch with exit context (e.g. "I was working on the login page, it's about half done")
- [ ] Confirm the EXIT state's first textarea (`#exit-notes`) pre-populates with the extracted exit context
- [ ] Check console for `[TaskFlow] EXIT pre-pop: { extractedExit: "...", ... }` log at line 508
- [ ] If textarea is empty despite `extractedExit` having a value in the log: wrap line 611 in `setTimeout(() => { if (extractedExit && notes) notes.value = extractedExit; }, 50);`
- [ ] Confirm bookmark textarea still works independently in Mode 1

## VOCABULARY-CORRECTIONS

**Status:** Fully implemented, param naming blocker resolved. Needs runtime confirmation of the full loop.

- [ ] Launch app, do a voice transcription
- [ ] Click a wrong word in the transcription display - confirm edit UI appears with "Fix" and "Always" buttons
- [ ] Click "Fix" - confirm the word is replaced in the display only (one-time)
- [ ] Click "Always fix" on a different word - confirm `~/.taskflow/corrections.yaml` now has an entry
- [ ] Do another transcription containing the corrected phrase - confirm it's auto-replaced
- [ ] Shift+click to select a multi-word phrase (e.g. "PR immense") - confirm range highlights and edit UI accepts the phrase
- [ ] Click "Always" on the multi-word phrase - confirm corrections.yaml stores it
- [ ] Check `~/.taskflow/vocabulary.yaml` gains new terms after "Always" clicks

## DRAGGABLE-OVERLAY

**Status:** Implemented, needs runtime drag test.

- [ ] Launch app, try dragging the overlay by its background padding area (the gap around the card) - window should move
- [ ] Try dragging from a header label (e.g. "Listening", "Exit - Full") - should also drag
- [ ] Click buttons, type in textareas, click word tokens - confirm none of these trigger a drag
- [ ] Try the exit mic button - confirm it still works (covered by `-webkit-app-region: no-drag`)

## DAILY-MARKDOWN-LOG

**Status:** Implemented, needs runtime test.

- [ ] Launch app, complete a context switch (any mode)
- [ ] Check `~/.taskflow/logs/` for today's date file (e.g. `2026-03-24.md`)
- [ ] Verify file has H1 date header and a correctly formatted entry (timestamp, mode, template, duration, exit notes, bookmark)
- [ ] Do a second switch - verify a second entry is appended (not overwritten)
- [ ] Check Mode 2 (light) and Mode 3 (urgent) also produce entries
- [ ] Known issue: if you edit the bookmark textarea manually, the log captures the pre-populated value not your edit (follow-up bug)

## TASK-COMPLETION-CAPTURE

**Status:** Mode 4 detection + completion UI implemented. Needs full flow test.

- [ ] Launch app, say "I just finished the API refactor" - mode badge should show "Completion" (green)
- [ ] Click "Log it →" - completion form should appear with 4 fields (outcome, PRs, follow-ups, handoff)
- [ ] Fill in at least the outcome, click "Log completion →" - check `~/.taskflow/logs/YYYY-MM-DD.md` for a `COMPLETED:` entry
- [ ] Click "Copy /completion command" - verify clipboard contains `copilot /completion`
- [ ] Test "Skip" button - should close overlay without logging
- [ ] Verify "finished X, moving on to Y" still triggers Mode 2 (not Mode 4)

## SLACK-GITHUB-ACTIONS-SETUP

**Status:** Workflow deployed, needs secrets configured.

Follow the setup instructions in `SLACK-SUMMARY.md` → "Option A: GitHub Actions":

- [ ] Create a Dropbox app at https://www.dropbox.com/developers/apps (Scoped access, Full Dropbox)
- [ ] Enable `files.content.read` permission, generate an access token
- [ ] Add three repo secrets at https://github.com/im-fdavies/taskflow/settings/secrets/actions:
  - `ANTHROPIC_API_KEY`
  - `SLACK_WEBHOOK_URL`
  - `DROPBOX_ACCESS_TOKEN`
- [ ] Optionally set `DROPBOX_LOGS_PATH` repo variable (defaults to `/DailyNotes`)
- [ ] Trigger a manual run: Actions → "Slack Morning Summary" → "Run workflow"
- [ ] Confirm Slack message arrives with yesterday's summary
- [ ] Confirm the next weekday morning at 09:45 UTC it runs automatically
