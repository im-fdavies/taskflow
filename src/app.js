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

    this.init();
  }

  async init() {
    // Listen for overlay open event from Rust
    await listen("overlay-opened", () => {
      this.show("listening");
      this.startWaveform("waveform");
    });

    // Escape key closes the overlay
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.close();
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
  }

  advance(to) {
    this.show(to);
    if (to === "exit") {
      this.startWaveform("waveform-exit");
    }
  }

  async close() {
    await invoke("hide_overlay");
  }

  // ---- Task lifecycle ----

  async refreshState() {
    try {
      const state = await invoke("get_state");
      const badge = document.getElementById("current-task-badge");
      if (state.current_task) {
        badge.textContent = state.current_task;
      } else {
        badge.textContent = "No active task";
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
    if (!container || container.children.length > 0) return;

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

    // Animate bars to simulate audio input
    // This will be replaced with real audio data in P1
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
  }

  // ---- Demo: simulate a full context switch ----
  // Call this from the browser console to test the flow:
  //   app.demo()

  async demo() {
    // 1. Show listening state
    this.show("listening");
    this.startWaveform("waveform");

    await this.wait(2000);

    // 2. Detected: switching to PR amends while mid-task → Mode 1
    this.stopWaveform();
    document.getElementById("exit-context").textContent =
      'Switching to PR amends. You were mid-task on auth middleware \u2014 bookmark where you are.';
    this.show("exit");
    this.startWaveform("waveform-exit");

    await this.wait(3000);

    // 3. Transition with bookmark
    this.stopWaveform();
    document.getElementById("bookmark-content").textContent =
      '"Halfway through extracting token validation into its own service. Tests passing but haven\'t updated the route middleware yet."';
    this.show("transition");

    await this.wait(2000);

    // 4. Entry with PR amends template
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
window.app = app; // Expose for console debugging
