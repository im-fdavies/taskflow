// ===================================================================
// TaskFlow — Overlay App
// State machine + Tauri IPC + UI logic
// ===================================================================

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// -------------------------------------------------------------------
// State machine
// -------------------------------------------------------------------

const STATES = [
  "listening",
  "exit",
  "transition",
  "entry",
  "coaching",
  "gate",
];

class TaskFlowApp {
  constructor() {
    this.currentState = "listening";
    this.pendingTask = null;
    this.transcription = "";
    this.mode = 1; // 1 = full, 2 = light, 3 = urgent

    // Audio recording state
    this._audioChunks = [];
    this._mediaStream = null;
    this._audioContext = null;
    this._scriptProcessor = null;
    this._isRecording = false;

    this.init();
  }

  async init() {
    // Listen for overlay open event from Rust
    await listen("overlay-opened", () => {
      this.show("listening");
      this.startWaveform("waveform");
      this.startRecording();
    });

    // Escape key closes the overlay
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.close();
      }
      if (e.key === "Enter") {
        if (this._isRecording) {
          // Stop recording and transcribe
          this.stopRecording();
        } else if (this.transcription && this.currentState === "listening") {
          // Transcription ready — advance to exit phase
          this.advance("exit");
        }
      }
    });

    // Populate waveform bars on load
    this.populateWaveform("waveform");
    this.populateWaveform("waveform-exit");

    // Load current task state
    this.refreshState();
  }

  // ---- State transitions ----

  show(stateName) {
    STATES.forEach((s) => {
      const el = document.getElementById(`s-${s}`);
      if (el) el.classList.toggle("active", s === stateName);
    });
    this.currentState = stateName;

    // Reset listening state UI when showing it
    if (stateName === "listening") {
      this.transcription = "";
      const status = document.getElementById("recording-status");
      const result = document.getElementById("transcription-result");
      const btn = document.getElementById("btn-stop-recording");
      const hint = document.getElementById("listening-hint");
      if (status) { status.style.display = "none"; status.textContent = ""; }
      if (result) { result.style.display = "none"; result.textContent = ""; }
      if (btn) { btn.disabled = false; btn.textContent = "Done"; btn.onclick = () => this.stopRecording(); }
      if (hint) hint.textContent = "Speak, then press Enter";
    }
  }

  advance(to) {
    this.show(to);
    if (to === "exit") {
      this.startWaveform("waveform-exit");
    }
  }

  async close() {
    this.stopRecordingCleanup();
    await invoke("hide_overlay");
  }

  // ---- Audio recording ----

  async startRecording() {
    if (this._isRecording) return;

    try {
      this._audioChunks = [];
      this._mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

      // Use 16kHz sample rate — what whisper.cpp expects
      this._audioContext = new AudioContext({ sampleRate: 16000 });
      const source = this._audioContext.createMediaStreamSource(this._mediaStream);

      // ScriptProcessorNode collects raw PCM samples
      this._scriptProcessor = this._audioContext.createScriptProcessor(4096, 1, 1);
      this._scriptProcessor.onaudioprocess = (e) => {
        if (!this._isRecording) return;
        // Copy the channel data (Float32Array) into our buffer
        const channelData = e.inputBuffer.getChannelData(0);
        this._audioChunks.push(new Float32Array(channelData));
      };

      source.connect(this._scriptProcessor);
      this._scriptProcessor.connect(this._audioContext.destination);

      this._isRecording = true;

      const micDot = document.getElementById("mic-dot");
      if (micDot) micDot.classList.remove("idle");

    } catch (err) {
      console.error("Microphone access denied or unavailable:", err);
      const status = document.getElementById("recording-status");
      if (status) {
        status.textContent = "⚠ Microphone unavailable";
        status.style.display = "block";
      }
    }
  }

  async stopRecording() {
    if (!this._isRecording) return;
    this._isRecording = false;

    const btn = document.getElementById("btn-stop-recording");
    const hint = document.getElementById("listening-hint");
    const status = document.getElementById("recording-status");
    const micDot = document.getElementById("mic-dot");

    if (btn) { btn.disabled = true; btn.textContent = "Processing…"; }
    if (hint) hint.textContent = "";
    if (status) { status.textContent = "Transcribing…"; status.style.display = "block"; }
    if (micDot) micDot.classList.add("idle");
    this.stopWaveform();

    // Collect all samples
    const totalLength = this._audioChunks.reduce((sum, c) => sum + c.length, 0);
    const samples = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of this._audioChunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }

    this.stopRecordingCleanup();

    // Encode as 16kHz mono 16-bit PCM WAV
    const wavBytes = this._encodeWav(samples, 16000);

    try {
      const text = await invoke("transcribe_audio", { wavData: Array.from(wavBytes) });
      this.transcription = text;

      if (status) status.style.display = "none";

      const result = document.getElementById("transcription-result");
      if (result) {
        result.textContent = text;
        result.style.display = "block";
      }

      if (btn) { btn.disabled = false; btn.textContent = "Continue"; }
      btn.onclick = () => this.advance("exit");
      if (hint) hint.textContent = "Press Enter to continue";

    } catch (err) {
      console.error("Transcription failed:", err);
      if (status) { status.textContent = `⚠ ${err}`; status.style.display = "block"; }
      if (btn) { btn.disabled = false; btn.textContent = "Try again"; btn.onclick = () => this.startAgain(); }
    }
  }

  startAgain() {
    const result = document.getElementById("transcription-result");
    const status = document.getElementById("recording-status");
    const btn = document.getElementById("btn-stop-recording");
    const hint = document.getElementById("listening-hint");
    if (result) { result.style.display = "none"; result.textContent = ""; }
    if (status) { status.style.display = "none"; status.textContent = ""; }
    if (btn) { btn.disabled = false; btn.textContent = "Done"; btn.onclick = () => this.stopRecording(); }
    if (hint) hint.textContent = "Speak, then press Enter";
    this.populateWaveform("waveform");
    this.startWaveform("waveform");
    this.startRecording();
  }

  stopRecordingCleanup() {
    if (this._scriptProcessor) {
      this._scriptProcessor.disconnect();
      this._scriptProcessor = null;
    }
    if (this._audioContext) {
      this._audioContext.close();
      this._audioContext = null;
    }
    if (this._mediaStream) {
      this._mediaStream.getTracks().forEach((t) => t.stop());
      this._mediaStream = null;
    }
    this._audioChunks = [];
  }

  // ---- WAV encoding ----
  // Produces a 16kHz mono 16-bit PCM WAV from Float32Array samples

  _encodeWav(samples, sampleRate) {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataLen = samples.length * 2; // 2 bytes per sample
    const buffer = new ArrayBuffer(44 + dataLen);
    const view = new DataView(buffer);

    const writeStr = (offset, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };

    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataLen, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);           // PCM chunk size
    view.setUint16(20, 1, true);            // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeStr(36, "data");
    view.setUint32(40, dataLen, true);

    // Convert Float32 [-1, 1] to Int16 [-32768, 32767]
    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 32768 : s * 32767, true);
      offset += 2;
    }

    return new Uint8Array(buffer);
  }

  // ---- Task lifecycle ----

  async refreshState() {
    try {
      const state = await invoke("get_state");
      const badge = document.getElementById("current-task-badge");
      if (badge) {
        badge.textContent = state.current_task || "No active task";
      }
    } catch (e) {
      console.error("Failed to get state:", e);
    }
  }

  async startTask() {
    const name =
      this.pendingTask || document.getElementById("entry-task-name").textContent;
    try {
      await invoke("start_task", { name });
    } catch (e) {
      console.error("Failed to start task:", e);
    }
    this.close();
  }

  async dismissCoaching(action) {
    console.log("Coaching response:", action);
    this.close();
  }

  async dismissGate(confirmed) {
    if (confirmed) {
      try {
        await invoke("end_task");
      } catch (e) {
        console.error("Failed to end task:", e);
      }
    }
    this.close();
  }

  // ---- Template rendering ----

  renderTemplate(template) {
    const container = document.getElementById("template-phases");
    container.innerHTML = "";

    const colours = ["amber", "teal", "purple"];

    template.phases.forEach((phase, i) => {
      const div = document.createElement("div");
      div.className = "phase";
      div.innerHTML = `
        <div class="phase-dot ${colours[i] || "teal"}">${i + 1}</div>
        <div>
          <div class="phase-text">${phase.name}</div>
          <div class="phase-sub">${phase.guidance}</div>
        </div>
      `;
      container.appendChild(div);
    });

    document.getElementById("entry-task-name").textContent = template.name;
    document.getElementById("entry-label").textContent =
      `Entry \u00b7 ${template.name}`;
    document.getElementById("template-badge").textContent = template.name;
    this.pendingTask = template.name;
  }

  // ---- Waveform visualisation ----

  populateWaveform(id) {
    const container = document.getElementById(id);
    if (!container) return;
    container.innerHTML = "";

    for (let i = 0; i < 36; i++) {
      const bar = document.createElement("span");
      bar.style.height = `${3 + Math.random() * 4}px`;
      bar.style.opacity = "0.3";
      container.appendChild(bar);
    }
  }

  startWaveform(id) {
    const container = document.getElementById(id);
    if (!container) return;

    const bars = container.children;
    const animate = () => {
      for (let i = 0; i < bars.length; i++) {
        const h = 3 + Math.random() * 15;
        bars[i].style.height = `${h}px`;
        bars[i].style.opacity = `${0.3 + Math.random() * 0.7}`;
      }
    };

    this._waveformInterval = setInterval(animate, 100);
  }

  stopWaveform() {
    if (this._waveformInterval) {
      clearInterval(this._waveformInterval);
      this._waveformInterval = null;
    }
    // Reset waveform bars to rest state
    const container = document.getElementById("waveform");
    if (container) {
      for (const bar of container.children) {
        bar.style.height = "3px";
        bar.style.opacity = "0.3";
      }
    }
  }

  // ---- Demo: simulate a full context switch ----

  async demo() {
    this.show("listening");
    this.startWaveform("waveform");

    await this.wait(2000);

    this.stopWaveform();
    document.getElementById("exit-context").textContent =
      'Switching to PR amends. You were mid-task on auth middleware \u2014 bookmark where you are.';
    this.show("exit");
    this.startWaveform("waveform-exit");

    await this.wait(3000);

    this.stopWaveform();
    document.getElementById("bookmark-content").textContent =
      '"Halfway through extracting token validation into its own service. Tests passing but haven\'t updated the route middleware yet."';
    this.show("transition");

    await this.wait(2000);

    this.renderTemplate({
      name: "PR amends",
      phases: [
        {
          name: "Survey all feedback first",
          guidance: "Read every comment before changing code",
        },
        {
          name: "Fix in order",
          guidance: "Structural first, surface last",
        },
        {
          name: "Re-read diff before pushing",
          guidance: "Full diff, as the reviewer would see it",
        },
      ],
    });
    this.show("entry");
  }

  wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// -------------------------------------------------------------------
// Boot
// -------------------------------------------------------------------

const app = new TaskFlowApp();
window.app = app;
