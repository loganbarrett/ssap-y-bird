/* Pitch input: microphone (YIN) or mouse. One frame of state per animation frame. */
const PitchInput = (function () {
  'use strict';
  // Pitch tracking does not depend on loudness (YIN's periodicity test is a ratio), so the loudness
  // gate only has to separate "someone is singing" from room noise. It adapts to the room:
  // gate = max(ABS_MIN, 2.5 x the typical background level).
  const ABS_MIN = 0.0005;     // about -66 dBFS; SSAP itself used 0.001 on its own recordings
  const MAX_AP = 0.2;         // SSAP: sqrt(aperiodicity) < 0.2
  const MIN_HZ = 60, MAX_HZ = 1100, YIN_W = 1024;

  const S = {
    mode: null,               // 'mic' | 'mouse'
    analyser: null, buf: null, stream: null, source: null,
    mouseSemi: 60,
    voiced: false, level: 0, reason: 'quiet',
    rms: 0, floor: 0.0005, gate: 0.0012, peak: 0, rmsHist: [], tick: 0,   // loudness bookkeeping
    raw: NaN, semi: NaN, hz: NaN,   // raw: this frame; semi: 5-frame median
    hist: [], lastVoicedT: -1,
    rec: null,                // active response recording {frames:[{t,m}], voicedSec, startT, lastVoicedT}
  };

  async function startMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
      throw new Error('This browser has no microphone access. Use Chrome, Edge, Safari or Firefox over https.');
    const ctx = AudioKit.ensure();
    if (S.stream) S.stream.getTracks().forEach(t => t.stop());
    S.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 }
    });
    S.source = ctx.createMediaStreamSource(S.stream);
    S.analyser = ctx.createAnalyser();
    S.analyser.fftSize = 4096; S.analyser.smoothingTimeConstant = 0;
    S.source.connect(S.analyser);
    S.buf = new Float32Array(S.analyser.fftSize);
    S.mode = 'mic';
  }
  function startMouse() { AudioKit.ensure(); S.mode = 'mouse'; }
  function stop() {
    if (S.stream) S.stream.getTracks().forEach(t => t.stop());
    S.stream = null; S.analyser = null; S.source = null; S.mode = null;
  }

  const median = a => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

  // call once per frame; now = seconds on the game clock, dt = seconds since last call
  function sample(now, dt) {
    if (S.mode === 'mouse') {
      S.voiced = true; S.level = 0.5; S.reason = 'ok';
      S.raw = S.mouseSemi; S.hz = 440 * Math.pow(2, (S.raw - 69) / 12);
      S.hist.push(S.raw); if (S.hist.length > 3) S.hist.shift();
      S.semi = median(S.hist); S.lastVoicedT = now;
    } else if (S.mode === 'mic' && S.analyser) {
      S.analyser.getFloatTimeDomainData(S.buf);
      const sr = AudioKit.ctx().sampleRate, tauMax = Math.ceil(sr / MIN_HZ);
      const r = SSAPYin.yin(S.buf, S.buf.length - (YIN_W + tauMax), sr, { W: YIN_W, minF: MIN_HZ, maxF: MAX_HZ });
      const rms = Math.sqrt(r.pwr);
      S.rms = rms;
      // meter on a dB scale (-62 dB .. -12 dB) so quiet microphones still visibly move
      const db = 20 * Math.log10(Math.max(rms, 1e-6));
      S.level = Math.max(0, Math.min(1, (db + 62) / 50));
      // The room level is the quiet end of the last ~8 seconds (people breathe and pause), so quiet
      // singing is never mistaken for noise. The gate is also never allowed above 40% of recent peak.
      S.peak = Math.max(S.peak * 0.999, rms);
      S.rmsHist.push(rms); if (S.rmsHist.length > 480) S.rmsHist.shift();
      if (++S.tick % 8 === 0 && S.rmsHist.length > 30) {
        const sorted = S.rmsHist.slice().sort((a, b) => a - b);
        S.floor = sorted[Math.floor(sorted.length * 0.15)];
      }
      S.gate = Math.min(Math.max(ABS_MIN, S.floor * 2), Math.max(ABS_MIN, S.peak * 0.4));
      const periodic = Math.sqrt(r.ap0) < MAX_AP && r.hz >= MIN_HZ && r.hz <= MAX_HZ;
      const ok = rms > S.gate && periodic;
      S.voiced = ok;
      S.reason = ok ? 'ok' : rms <= S.gate ? 'quiet' : (r.hz < MIN_HZ || r.hz > MAX_HZ) ? 'range' : 'noisy';
      if (ok) {
        S.raw = 69 + 12 * Math.log2(r.hz / 440); S.hz = r.hz;
        S.hist.push(S.raw); if (S.hist.length > 5) S.hist.shift();   // median removes single-frame octave glitches
        S.semi = median(S.hist); S.lastVoicedT = now;
      } else { S.hist.length = 0; S.hz = NaN; }
    } else { S.voiced = false; S.level = 0; }

    const r = S.rec;
    if (r && S.voiced && isFinite(S.raw)) {
      r.frames.push({ t: now, m: S.raw });
      r.voicedSec += dt; r.lastVoicedT = now;
    }
  }

  function startRec(now) { S.rec = { frames: [], voicedSec: 0, startT: now, lastVoicedT: -1 }; return S.rec; }
  function stopRec() { const r = S.rec; S.rec = null; return r; }

  return { S, startMic, startMouse, stop, sample, startRec, stopRec, MIN_HZ, MAX_HZ };
})();
