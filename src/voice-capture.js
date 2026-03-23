export class VoiceCapture {
  constructor({ onStateChange = () => {}, onAmplitude = () => {}, onError = () => {} } = {}) {
    this._onStateChange = onStateChange;
    this._onAmplitude = onAmplitude;
    this._onError = onError;
    this._recording = false;
    this._chunks = [];
    this._mediaStream = null;
    this._audioContext = null;
    this._scriptProcessor = null;
  }

  async start() {
    this._mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true }
    });
    this._audioContext = new AudioContext({ sampleRate: 16000 });
    const source = this._audioContext.createMediaStreamSource(this._mediaStream);
    this._scriptProcessor = this._audioContext.createScriptProcessor(4096, 1, 1);

    this._scriptProcessor.onaudioprocess = (event) => {
      const data = event.inputBuffer.getChannelData(0).slice();
      this._chunks.push(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      this._onAmplitude(Math.sqrt(sum / data.length));
    };

    source.connect(this._scriptProcessor);
    this._scriptProcessor.connect(this._audioContext.destination);
    this._recording = true;
    this._onStateChange(true);
  }

  async stop() {
    if (!this._recording) return '';

    try {
      this._scriptProcessor.disconnect();
      this._mediaStream.getTracks().forEach(t => t.stop());
      await this._audioContext.close();

      const totalLength = this._chunks.reduce((acc, c) => acc + c.length, 0);
      const samples = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of this._chunks) {
        samples.set(chunk, offset);
        offset += chunk.length;
      }

      const wavBytes = this._encodeWav(samples, 16000);
      const text = await window.__TAURI__.core.invoke('transcribe_audio', {
        wavData: Array.from(wavBytes)
      });

      return text;
    } catch (err) {
      this._onError(err.message);
      throw err;
    } finally {
      this._recording = false;
      this._onStateChange(false);
      this._chunks = [];
    }
  }

  isRecording() {
    return this._recording;
  }

  onAmplitude(callback) {
    this._onAmplitude = callback;
  }

  _encodeWav(samples, sampleRate) {
    const numSamples = samples.length;
    const byteRate = sampleRate * 2;
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    const writeStr = (offset, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, numSamples * 2, true);

    for (let i = 0; i < numSamples; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, s * 32767, true);
    }

    return new Uint8Array(buffer);
  }
}
