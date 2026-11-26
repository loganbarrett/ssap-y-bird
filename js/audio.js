/* Audio output: stimuli, cue tones, metronome, perception sines. */
const AudioKit = (function () {
  'use strict';
  let ctx = null;
  const cache = {};

  function ensure() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);

  async function loadStim(id) {
    if (cache[id]) return cache[id];
    const c = ensure();
    const res = await fetch('audio/' + id + '.mp3');
    if (!res.ok) throw new Error('Could not load stimulus ' + id);
    const data = await res.arrayBuffer();
    const buf = await new Promise((ok, no) => { const p = c.decodeAudioData(data, ok, no); if (p && p.then) p.then(ok, no); });
    cache[id] = buf;
    return buf;
  }

  function playBuffer(buf, gain) {
    const c = ensure(), s = c.createBufferSource(), g = c.createGain();
    s.buffer = buf; g.gain.value = gain == null ? 0.9 : gain;
    s.connect(g).connect(c.destination); s.start();
    return s;
  }

  // cue tone for a MIDI note. Triangle keeps low notes audible on small speakers.
  function tone(midi, dur, o) {
    o = o || {};
    const c = ensure(), t = c.currentTime, osc = c.createOscillator(), g = c.createGain(), peak = o.gain == null ? 0.5 : o.gain;
    osc.type = o.type || 'triangle'; osc.frequency.value = hz(midi);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.03);
    g.gain.setValueAtTime(peak, t + Math.max(0.05, dur - 0.12)); g.gain.linearRampToValueAtTime(0, t + dur);
    osc.connect(g).connect(c.destination); osc.start(t); osc.stop(t + dur + 0.05);
  }

  function click(accent, whenOffset) {
    const c = ensure(), t = c.currentTime + (whenOffset || 0), osc = c.createOscillator(), g = c.createGain();
    osc.type = 'square'; osc.frequency.value = accent ? 1500 : 1000;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(accent ? 0.35 : 0.22, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    osc.connect(g).connect(c.destination); osc.start(t); osc.stop(t + 0.08);
  }

  // Perception stimulus, same envelope as buildsine.m (time constants given at 22050 Hz):
  // a = .5 * (1 - exp(-t/1000)) * (1 - exp(-(T - t)/200)) with t in samples
  function sine(freq, dur) {
    const c = ensure(), sr = c.sampleRate, n = Math.round(sr * dur), buf = c.createBuffer(1, n, sr), d = buf.getChannelData(0);
    const rise = 1000 / 22050, fall = 200 / 22050;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      d[i] = 0.5 * (1 - Math.exp(-t / rise)) * (1 - Math.exp(-(dur - t) / fall)) * Math.sin(2 * Math.PI * freq * t);
    }
    return playBuffer(buf, 0.8);
  }

  return { ensure, ctx: () => ctx, hz, loadStim, playBuffer, tone, click, sine };
})();
