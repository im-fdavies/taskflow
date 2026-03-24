# DONE: Voice-reactive waveform animation

| Field        | Value                    |
|-------------|--------------------------|
| Phase       | P5: Polish               |
| Priority    | Should have              |
| Status      | Done                     |
| Est. Effort | Medium (3-5h)            |
| Dependencies| P1 complete              |

## Description

Replace random waveform animation with real-time mic input visualisation. Use Web Audio `AnalyserNode` to drive the waveform bars from actual audio amplitude data.

## Completion

**Tested by:**
- Verified `voice-capture.js` line 26: fires `onAmplitude(Math.sqrt(sum / data.length))` — RMS in range 0.0–~0.15 for speech ✅
- `onAmplitude` at app.js line 40 now stores `rms` in `this._lastAmplitude` ✅
- `_waveformInterval = null` replaced with `_waveformRaf = null` + `_lastAmplitude = 0` in constructor ✅
- `startWaveform()` replaced: uses `requestAnimationFrame`, tapers from centre, `amp = Math.min(rms * 8, 1)`, jitter 0.85–1.15 ✅
- `stopWaveform()` replaced: cancels RAF, resets `_lastAmplitude`, resets bars to 3px / 0.3 opacity ✅
- `grep _waveformInterval` — 0 remaining references ✅
- Exit state `onAmplitude` callbacks intentionally left as no-ops — no waveform element in exit state (confirmed: only `#waveform` in listening state HTML) ✅
- No Rust changes needed; no `cargo build` required ✅

**Unexpected outcomes:**
- None

**Follow-up tasks:**
- RMS normalisation multiplier (`* 8`) may need runtime tuning — noted in prompt

**Confidence:** [8/10] — All code paths verified and no `_waveformInterval` refs remain; gap is no runtime test of actual mic response.

**Files modified:**
- `src/app.js`
- `.github/TASKS/WAVEFORM-ANIMATION-TASK.md`
