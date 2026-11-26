/* Raw-audio capture of the participant's responses (only used when the lab has enabled
 * collection AND the participant has consented). Produces 16-bit mono 22050 Hz WAV files,
 * the same format the original SSAP saved. */
const Recorder = (function () {
  'use strict';
  const TARGET_SR = 22050;
  let node = null, sink = null, chunks = [], capturing = false, srcRate = 0, ready = false;

  async function attach(ctx, source) {
    if (ready) return true;
    srcRate = ctx.sampleRate;
    try {
      await ctx.audioWorklet.addModule('js/recorder-worklet.js');
      node = new AudioWorkletNode(ctx, 'ssap-rec');
      node.port.onmessage = e => { if (capturing) chunks.push(e.data); };
    } catch (e) {
      // older browsers: ScriptProcessor still works, it is just deprecated
      node = ctx.createScriptProcessor(2048, 1, 1);
      node.onaudioprocess = ev => { if (capturing) chunks.push(new Float32Array(ev.inputBuffer.getChannelData(0))); };
    }
    sink = ctx.createGain(); sink.gain.value = 0;           // keeps the node pulled without playing the mic aloud
    source.connect(node); node.connect(sink); sink.connect(ctx.destination);
    ready = true;
    return true;
  }

  function start() { chunks = []; capturing = true; }

  // returns { blob, seconds } or null if nothing was captured
  function stop() {
    capturing = false;
    let n = 0; for (const c of chunks) n += c.length;
    if (!n) return null;
    const all = new Float32Array(n); let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    chunks = [];
    return { blob: toWav(downsample(all, srcRate, TARGET_SR), TARGET_SR), seconds: n / srcRate };
  }

  function downsample(x, from, to) {
    if (from === to) return x;
    const ratio = from / to, n = Math.floor(x.length / ratio), out = new Float32Array(n);
    const w = Math.max(1, Math.round(ratio));
    for (let i = 0; i < n; i++) {                           // boxcar average then pick: cheap anti-alias
      const c = Math.floor(i * ratio); let s = 0, k = 0;
      for (let j = c - (w >> 1); j < c + w - (w >> 1); j++) { if (j >= 0 && j < x.length) { s += x[j]; k++; } }
      out[i] = k ? s / k : 0;
    }
    return out;
  }

  function toWav(f32, sr) {
    const n = f32.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, f32[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
    return new Blob([buf], { type: 'audio/wav' });
  }

  return { attach, start, stop, isReady: () => ready };
})();
