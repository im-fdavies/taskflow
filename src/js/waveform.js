// ===================================================================
// TaskFlow — Waveform visualisation
// Self-contained animation for the mic recording indicator.
// ===================================================================

let _rafId = null;
let _amplitudeFn = () => 0;

export function populateWaveform(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";

  for (let i = 0; i < 36; i++) {
    const bar = document.createElement("span");
    bar.style.height = `${3 + Math.random() * 4}px`;
    bar.style.opacity = "0.3";
    container.appendChild(bar);
  }
}

export function startWaveform(containerId, amplitudeFn) {
  const container = document.getElementById(containerId);
  if (!container) return;
  _amplitudeFn = amplitudeFn;
  const bars = container.children;
  const barCount = bars.length;
  const mid = barCount / 2;

  const animate = () => {
    const amp = Math.min(_amplitudeFn() * 8, 1);
    for (let i = 0; i < barCount; i++) {
      const distFromMid = Math.abs(i - mid) / mid;
      const taper = 1 - distFromMid * 0.6;
      const jitter = 0.85 + Math.random() * 0.3;
      const h = 3 + amp * 15 * taper * jitter;
      bars[i].style.height = `${h}px`;
      bars[i].style.opacity = `${0.3 + amp * 0.7 * taper}`;
    }
    _rafId = requestAnimationFrame(animate);
  };

  _rafId = requestAnimationFrame(animate);
}

export function stopWaveform() {
  if (_rafId) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }
  _amplitudeFn = () => 0;
  const container = document.getElementById("waveform");
  if (container) {
    for (const bar of container.children) {
      bar.style.height = "3px";
      bar.style.opacity = "0.3";
    }
  }
}
