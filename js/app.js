/* SSAP-y Bird: game flows, scenes and screens. */
(function () {
  'use strict';
  const { W, H, BIRD_X, BIRD_R } = Draw;
  const SC = SSAPScoring, SO = SSAPSongs, ST = SSAPStaircase;
  const IN = PitchInput, S = PitchInput.S, DS = DataStore;
  const $ = id => document.getElementById(id);
  const ABORT = { aborted: true };
  const clamp = Draw.clamp;
  const octToSemi = SC.octToSemi, semiToOct = SC.semiToOct;

  // SSAP key table (matSSAP_Global_Variable_Initializer.m)
  const KEYS = ['A2', 'C3', 'D3', 'F3', 'A3', 'C4', 'D4', 'F4'];
  const KEY_HZ = [140, 166, 187, 222, 280, 333, 373, 444];
  const MALE_KEYS = ['A2', 'C3', 'D3', 'F3', 'A3'], FEMALE_KEYS = ['F3', 'A3', 'C4', 'D4', 'F4'];
  const keyMidi = k => { const n = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[k[0]]; return 12 * (parseInt(k[1], 10) + 1) + n; };

  const App = {
    clock: 0, timers: [], pending: new Set(), aborted: false, running: false,
    settings: { live: false, cue: true },
    voice: null, stim: null,
  };

  // ---------------------------------------------------------------- time, panels, abort
  function wait(sec) {
    return new Promise((res, rej) => {
      if (App.aborted) return rej(ABORT);
      App.timers.push({ at: App.clock + sec, res, rej });
    });
  }
  function until(poll, maxSec) {
    return new Promise((res, rej) => {
      if (App.aborted) return rej(ABORT);
      App.timers.push({ poll, deadline: maxSec ? App.clock + maxSec : Infinity, res, rej });
    });
  }
  function abortAll() {
    App.aborted = true;
    const t = App.timers; App.timers = [];
    t.forEach(x => x.rej(ABORT));
    App.pending.forEach(f => f(ABORT)); App.pending.clear();
  }
  function fireTimers() {
    if (!App.timers.length) return;
    const keep = [];
    for (const t of App.timers) {
      if (t.poll) {
        let done = false;
        try { done = t.poll(); } catch (e) { done = true; }
        if (done || App.clock >= t.deadline) t.res(done); else keep.push(t);
      } else if (App.clock >= t.at) t.res(); else keep.push(t);
    }
    App.timers = keep;
  }

  const panel = $('panel');
  function showPanel(html, dock) { panel.className = 'overlay' + (dock ? ' dock' : ''); panel.innerHTML = html; panel.scrollTop = 0; }
  function hidePanel() { panel.className = 'overlay hidden'; panel.innerHTML = ''; }
  function say(html) { $('callout').innerHTML = html || ''; }
  function setStatus(s) { $('status').textContent = s || ''; }
  // Persistent on-screen guidance: the 1-2-3 step guide, the coach line, and help text.
  const stepsEl = $('steps'), coachEl = $('coach'), recEl = $('rec'), recText = $('rec-text'), vuEl = $('vu');
  App.help = ''; App.paused = false; App.singCoach = null; App.micCheck = null;
  function guide(o) {
    if ('step' in o) {
      stepsEl.hidden = !o.step;
      stepsEl.querySelectorAll('li').forEach(li => {
        const n = +li.dataset.s;
        li.classList.toggle('on', n === o.step); li.classList.toggle('done', o.step > 0 && n < o.step);
      });
    }
    if ('coach' in o) { coachEl.className = 'coach' + (o.tone ? ' ' + o.tone : ''); coachEl.innerHTML = o.coach || ''; }
    if ('help' in o) App.help = o.help || '';
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Show a card and wait for a [data-act] button (or its data-key shortcut). Resolves { act, form }.
  function ask(html, opts) {
    opts = opts || {};
    return new Promise((res, rej) => {
      if (App.aborted) return rej(ABORT);
      showPanel(html, opts.dock);
      const done = act => {
        panel.removeEventListener('click', onClick); window.removeEventListener('keydown', onKey);
        App.pending.delete(onAbort);
        const form = {};
        panel.querySelectorAll('input, select').forEach(el => {
          if (el.type === 'radio') { if (el.checked) form[el.name] = el.value; }
          else if (el.type === 'checkbox') form[el.name || el.id] = el.checked;
          else form[el.name || el.id] = el.value;
        });
        if (!opts.keep) hidePanel();
        res({ act, form });
      };
      const onClick = e => { const b = e.target.closest('[data-act]'); if (b && !b.disabled) done(b.dataset.act); };
      const onKey = e => {
        if (/INPUT|SELECT|TEXTAREA/.test((document.activeElement || {}).tagName || '') && e.key !== 'Enter') return;
        const b = panel.querySelector('[data-key="' + (e.key === ' ' ? 'Space' : e.key) + '"]');
        if (b && !b.disabled) { e.preventDefault(); done(b.dataset.act); }
      };
      const onAbort = () => { panel.removeEventListener('click', onClick); window.removeEventListener('keydown', onKey); rej(ABORT); };
      App.pending.add(onAbort);
      panel.addEventListener('click', onClick); window.addEventListener('keydown', onKey);
    });
  }

  // ---------------------------------------------------------------- the world (canvas)
  const cv = $('cv'), g = cv.getContext('2d');
  const world = {
    kind: 'idle', birdSemi: 60, vy: 0, follow: false, fall: false, grounded: false,
    labels: [], rings: null, ringLevel: 0,
    speed: 170, t: 0, pipes: [], lyrics: true,
    gates: [], rev: { t: 0, dur: 1, x0: 130, y0: 60 },
    pucks: [], hop: 0,
    time: 0,
  };
  function setView(lo, hi) { Draw.setView(lo, hi); }
  function defaultView() { const v = App.voice; if (v) setView(v.low - 2.5, v.high + 2.5); else setView(48, 72); }
  function toIdle(o) {
    o = o || {};
    world.kind = 'idle'; world.follow = !!o.follow; world.fall = false; world.grounded = false;
    world.labels = []; world.rings = o.rings || null; world.pipes = []; world.gates = []; world.pucks = [];
    world.vy = 0;
    const v = Draw.getView(); world.birdSemi = (v.lo + v.hi) / 2;
  }

  function worldUpdate(dt) {
    world.time += dt;
    const v = Draw.getView();
    if (world.kind === 'reveal') {
      world.rev.t += dt;
    }
    if (world.kind === 'idle' || world.kind === 'scroll') {
      if (world.follow) {
        if (S.voiced && isFinite(S.semi)) {
          world.birdSemi += (S.semi - world.birdSemi) * (1 - Math.exp(-dt * 22)); world.vy = 0;
        } else if (world.fall && App.clock - S.lastVoicedT > 0.18) {
          world.vy += 16 * dt; world.birdSemi -= world.vy * dt;
        }
      }
      if (world.birdSemi > v.hi) world.birdSemi = v.hi;
      if (world.birdSemi <= v.lo) { world.birdSemi = v.lo; world.grounded = true; } else world.grounded = false;
    }
    if (world.hop > 0) world.hop = Math.max(0, world.hop - dt * 2.5);
  }

  const smooth = u => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };

  function worldDraw() {
    Draw.sky(g);
    const T = world.time;
    if (world.kind === 'tones') { drawTones(T); return; }
    if (world.kind === 'reveal') { drawReveal(T); return; }

    Draw.grid(g, world.labels);
    if (world.kind === 'scroll') {
      for (const p of world.pipes) {
        const x0 = BIRD_X + (p.t0 - world.t) * world.speed, x1 = BIRD_X + (p.t1 - world.t) * world.speed;
        if (x1 < -40 || x0 > W + 40) continue;
        const inside = x0 <= BIRD_X && BIRD_X <= x1;
        let state = p.state || 'normal';
        if (inside && world.liveJudge) state = Math.abs(world.birdSemi - p.midi) <= p.tol ? 'good' : 'bad';
        Draw.pipe(g, x0, Math.max(x1, x0 + 14), p.midi, p.tol, state);
        if (p.syl && world.lyrics) Draw.text(g, p.syl, (x0 + Math.max(x1, x0 + 14)) / 2, Draw.CEIL + 12, { size: 16, weight: 700 });
        if (p.tag) Draw.text(g, p.tag, (x0 + x1) / 2, Draw.y(p.midi + p.tol) - BIRD_R - 18, { size: 13 });
      }
    }
    // bird (hidden-pitch tests keep the bird at rest so it does not give the answer away)
    const by = Draw.y(world.birdSemi);
    if (world.rings === 'listen') Draw.rings(g, BIRD_X, by, 0.4, T, 'rgba(255,210,63,.8)');
    if (world.rings === 'sing') Draw.rings(g, BIRD_X, by, S.level, T, 'rgba(120,200,255,.9)');
    Draw.bird(g, BIRD_X, by - Math.sin(T * 3) * (world.follow ? 0 : 3), { voiced: S.voiced || !world.follow, tilt: -world.vy * 0.06, t: T });
  }

  function revealPath(x) {
    const gs = world.gates;
    if (!gs.length) return world.rev.y0;
    let prevX = world.rev.x0, prevY = world.rev.y0;
    for (const gt of gs) {
      const startX = prevX + 28, endX = gt.x - 46;
      if (x < endX) return prevY + (gt.ySung - prevY) * smooth((x - startX) / Math.max(1, endX - startX));
      prevX = gt.x; prevY = gt.ySung;
    }
    return prevY;
  }
  function drawReveal(T) {
    const gs = world.gates, last = gs[gs.length - 1];
    Draw.grid(g, []);
    const speed = 210;
    const x = Math.min(world.rev.x0 + world.rev.t * speed, last.x + 130);
    for (const gt of gs) {
      const passed = x > gt.x;
      Draw.pipe(g, gt.x - 30, gt.x + 30, gt.target, 0.5, passed ? (gt.err ? 'bad' : 'good') : 'normal');
      Draw.text(g, Draw.noteName(gt.target), gt.x, Draw.CEIL + 14, { size: 14 });
      if (passed) {
        Draw.text(g, (gt.cents >= 0 ? '+' : '') + Math.round(gt.cents) + '¢', gt.x, Draw.y(gt.target + 0.5) - BIRD_R - 26, { size: 18, weight: 750, color: gt.err ? '#ff9a9a' : '#9af0c4' });
        Draw.text(g, gt.err ? (gt.cents > 0 ? 'sharp' : 'flat') : 'on target', gt.x, Draw.y(gt.target + 0.5) - BIRD_R - 8, { size: 12, weight: 500 });
      }
    }
    const y = revealPath(x);
    Draw.bird(g, x, y, { voiced: true, t: T, tilt: 0, glow: gs.some(gt => gt.x < x && !gt.err && x < gt.x + 60) });
  }
  function drawTones(T) {
    Draw.grid(g, []);
    Draw.text(g, 'First sound', 300, 150, { size: 16, weight: 500 });
    Draw.text(g, 'Second sound', 660, 150, { size: 16, weight: 500 });
    world.pucks.forEach((p, i) => {
      const cx = i === 0 ? 300 : 660, cy = p.y;
      g.fillStyle = p.on ? '#ffd23f' : 'rgba(255,255,255,.18)';
      g.beginPath(); g.arc(cx, cy, 36, 0, 7); g.fill();
      if (p.on) Draw.rings(g, cx, cy, 0.5, T, 'rgba(255,210,63,.8)');
    });
    const by = 400 - Math.sin(world.hop * Math.PI) * 60 * (world.hopDir || 1);
    Draw.bird(g, 480, by, { voiced: true, t: T, glow: world.glow });
  }

  // ---------------------------------------------------------------- main loop
  let last = performance.now();
  function step(dt) {
    if (App.paused) { worldDraw(); return; }          // Help is open: everything waits
    App.clock += dt;
    IN.sample(App.clock, dt);
    fireTimers();
    if (App.onFrame) App.onFrame(dt);
    worldUpdate(dt);
    worldDraw();
    updateChrome();
  }
  function frame(ts) {
    const dt = Math.min(0.05, (ts - last) / 1000); last = ts;
    if (dt > 0) step(dt);
    requestAnimationFrame(frame);
  }
  function resize() {
    const r = cv.getBoundingClientRect();
    if (r.width < 2) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    g.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
  }
  window.addEventListener('resize', resize);
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(cv);
  document.addEventListener('visibilitychange', resize);

  let lastLevelText = '';
  let lastRec = '', lastCoach = '';
  function updateChrome() {
    vuEl.style.width = Math.round(S.level * 100) + '%';
    // the recording light says honestly what is happening to the sound
    let cls = 'idle', txt;
    if (S.mode === 'mouse') txt = 'Mouse mode: no sound is used';
    else if (S.rec && App.audio === 'on') { cls = 'rec-on'; txt = 'RECORDING your singing'; }
    else if (S.rec) { cls = 'listen'; txt = 'Listening (not saved)'; }
    else if (S.mode === 'mic') txt = 'Microphone on, not recording';
    else txt = 'Microphone not in use';
    const key = cls + '|' + txt;
    if (key !== lastRec) { lastRec = key; recEl.className = 'rec ' + cls; recText.textContent = txt; }

    // live coaching while the person is singing
    if (App.singCoach && S.rec) {
      const r = S.rec, el = App.clock - r.startT, C = App.singCoach;
      let msg, tone = '';
      if (r.voicedSec < 0.15) {
        if (S.mode === 'mic' && el > 2.5) {
          tone = 'warn';
          msg = S.reason === 'noisy' ? 'I can hear sound but not a clear note. Sing a steady “doo” rather than whispering or humming.'
              : S.reason === 'range' ? 'That pitch is outside what I can follow. Try a more comfortable note.'
              : 'I can’t hear you yet. Sing a little louder or move closer. If the bar at the top hardly moves, turn up the microphone volume in your computer’s sound settings.';
        } else msg = C.start;
      } else if (r.voicedSec < C.need) { msg = 'I can hear you. Keep going…'; tone = 'good'; }
      else { msg = C.finish; tone = 'good'; }
      const k = tone + '|' + msg;
      if (k !== lastCoach) { lastCoach = k; guide({ coach: msg, tone }); }
    } else if (!App.singCoach) lastCoach = '';

    // microphone check card
    if (App.micCheck) {
      const m = App.micCheck, bar = $('mcbar'), msgEl = $('mcmsg'), ok = $('mcok');
      if (bar) bar.style.width = Math.round(S.level * 100) + '%';
      if (S.voiced) m.heard += 1 / 60; m.t += 1 / 60;
      if (m.heard > 0.4 && ok && ok.disabled) { ok.disabled = false; if (msgEl) msgEl.innerHTML = '<span class="ok">I can hear you ✓</span> You’re all set.'; }
      else if (m.heard <= 0.4 && m.t > 5 && msgEl) msgEl.innerHTML = S.level > 0.05 ? '<span class="err">I can hear something, but not a clear note.</span> Say a steady \u201Caah\u201D, like singing one note, a little closer to the microphone.' : '<span class="err">I can\u2019t hear anything.</span> Check the right microphone is chosen and not muted, and turn the input volume up in your computer\u2019s sound settings.';
    }
  }

  // mouse mode: pointer height = pitch
  $('stage').addEventListener('pointermove', e => {
    if (S.mode !== 'mouse') return;
    const r = cv.getBoundingClientRect(), v = Draw.getView();
    const y = (e.clientY - r.top) / r.height * H;
    S.mouseSemi = clamp(v.lo + (Draw.GROUND - y) / (Draw.GROUND - Draw.CEIL) * (v.hi - v.lo), v.lo, v.hi);
  });

  // ---------------------------------------------------------------- stimuli & voice
  async function loadManifest() {
    if (App.stim) return App.stim;
    const r = await fetch('data/stimuli.json');
    App.stim = await r.json();
    return App.stim;
  }
  function stimName(kind, k) {
    const v = App.voice;
    if (kind === 'voice') return v.who + '.' + v.key + '.1note.' + k;
    if (kind === 'piano') return 'piano.' + v.key + '.1note.' + k;
    return v.who + '.' + v.key + '.4note.' + k;
  }
  function saveVoice() { try { localStorage.setItem('ssap2-voice', JSON.stringify(App.voice)); } catch (e) { /* private mode */ } }
  function loadVoice() { try { const v = JSON.parse(localStorage.getItem('ssap2-voice')); if (v && v.key && v.low && v.high) App.voice = v; } catch (e) { /* none */ } }
  function ensureMouseVoice() {
    if (!App.voice) App.voice = { who: 'female', key: 'C4', medianSemi: 60, low: 55, high: 67, source: 'default' };
    DS.S.voice = { key: App.voice.key, who: App.voice.who, medianSemi: App.voice.medianSemi };
  }

  // ---------------------------------------------------------------- recording helper
  // Sing until `need` seconds of voiced sound and then `tail` seconds of quiet (or max / Done).
  async function singPhase(o) {
    const rec = IN.startRec(App.clock);
    if (Recorder.isReady()) Recorder.start();
    let userDone = false;
    App.singCoach = o.coach || null;
    guide({ step: o.step == null ? 2 : o.step });
    if (App.singCoach) guide({ coach: App.singCoach.start });
    showPanel(`<div class="card dockcard"><div class="row center"><button data-act="done" data-key="Enter" class="finish ${o.donePrimary ? 'primary' : ''}">I’m finished singing</button></div></div>`, true);
    const onClick = e => { if (e.target.closest('[data-act="done"]')) userDone = true; };
    panel.addEventListener('click', onClick);
    try {
      await until(() => {
        const r = S.rec; if (!r) return true;
        if (userDone) return true;
        if (o.hint) o.hint(r);
        if (S.mode === 'mouse') return r.voicedSec >= (o.mouseSec || o.need + 0.6);   // the pointer is always 'voiced'
        return (r.voicedSec >= o.need && App.clock - r.lastVoicedT >= o.tail) || App.clock - r.startT >= o.max;
      });
    } finally { panel.removeEventListener('click', onClick); App.singCoach = null; guide({ coach: '' }); }
    hidePanel();
    const r = IN.stopRec() || rec;
    const wav = Recorder.isReady() ? Recorder.stop() : null;
    if (Recorder.isReady() && !wav && r.voicedSec > 1 && App.audio === 'on') {
      App.audio = 'unavailable'; DS.S.audioStatus = 'unavailable (recorder returned no samples)';
    }
    return { frames: r.frames, voicedSec: r.voicedSec, wav, userDone };
  }

  function audioName(kind, a, b) {
    const u = DS.user();
    if (kind === 'imit') return u + '_IMIT_SECT_' + a + '_P_' + b + '.wav';
    if (kind === 'song') return u + '_FAMILIAR_SONG_PART_' + a + '.wav';
    return u + '_WARMUP_' + a + '.wav';
  }

  // ---------------------------------------------------------------- warm-up
  async function runWarmup(opts) {
    opts = opts || {};
    await loadManifest();
    setView(48, 76); toIdle({ follow: false });
    let r = await ask(`<div class="card">
      <h2>Warm-up: find your range</h2>
      <p class="strong">Two short exercises so the games can use notes that are comfortable for you.</p>
      <p>First you will sing a song you know, then hold one comfortable note on “doo”. No accompaniment is played.</p>
      <h3>Pick a song you know</h3>
      ${SO.ORDER.map((id, i) => `<label class="opt"><input type="radio" name="song" value="${id}" ${i === 1 ? 'checked' : ''}> ${esc(SO.SONGS[id].title)}</label>`).join('')}
      <div class="row"><button class="primary" data-act="go" data-key="Enter">Start</button><button data-act="skip">Skip warm-up</button></div>
    </div>`);
    if (r.act === 'skip') { if (!App.voice) ensureMouseVoice(); return App.voice; }
    const song = SO.SONGS[r.form.song || 'twinkle'];
    let allFrames = [];

    // part 1: familiar song
    for (;;) {
      toIdle({ follow: false, rings: 'sing' }); say('Sing it your way<small>Start on any note that feels comfortable</small>');
      showPanel(`<div class="card"><h2>${esc(song.title)}</h2><div class="lyrics">${esc(song.lyrics.join('\n'))}</div>
        <div class="row"><button class="primary" data-act="start" data-key="Enter">I’m ready, start recording</button></div></div>`);
      await ask(`<div class="card"><h2>${esc(song.title)}</h2><div class="lyrics">${esc(song.lyrics.join('\n'))}</div>
        <p>Sing it once through, on your own. Press the button when you are ready; recording starts right away.</p>
        <div class="row"><button class="primary" data-act="start" data-key="Enter">Start recording</button></div></div>`);
      say('Sing!<small>Press “I’m done” when you finish</small>');
      guide({ help: 'Sing the whole song once, in any key that feels comfortable. When you reach the end, press \u201CI\u2019m finished singing\u201D.' });
      const p = await singPhase({ need: 3, tail: 2.2, max: 40, mouseSec: 3.5, donePrimary: true, step: 0, coach: {
        start: 'Sing the song all the way through, starting on any note you like.', need: 3,
        finish: 'Keep going to the end, then press \u201CI\u2019m finished singing\u201D.' } });
      say('');
      if (p.voicedSec >= 1.5) { allFrames = allFrames.concat(p.frames); if (p.wav) DS.addAudio(audioName('warm', 'FAMILIAR'), p.wav.blob); break; }
      const again = await ask(`<div class="card"><h2>I could not hear much</h2><p>${S.mode === 'mic' ? 'Try singing a little louder, closer to the microphone.' : 'Move the pointer up and down to make notes.'}</p>
        <div class="row"><button class="primary" data-act="retry" data-key="Enter">Try again</button><button data-act="skip">Skip</button></div></div>`);
      if (again.act === 'skip') break;
    }

    // part 2: comfortable note
    for (;;) {
      toIdle({ follow: false, rings: 'sing' });
      await ask(`<div class="card"><h2>Now one comfortable note</h2>
        <p class="strong">Sing a note that feels easy on “doo” and hold it for at least two seconds.</p>
        <div class="row"><button class="primary" data-act="start" data-key="Enter">Start recording</button></div></div>`);
      say('Hold a comfortable note on “doo”');
      guide({ help: 'Sing one comfortable note on \u201Cdoo\u201D and hold it for at least two seconds.' });
      const p = await singPhase({ need: 2.0, tail: 0.6, max: 14, mouseSec: 2.5, step: 0, coach: {
        start: 'Sing one comfortable note on \u201Cdoo\u201D and hold it for two seconds.', need: 2.0,
        finish: 'Got it \u2713 You can stop singing now.' } });
      say('');
      if (p.voicedSec >= 1.0) { allFrames = allFrames.concat(p.frames); if (p.wav) DS.addAudio(audioName('warm', 'COMFORT'), p.wav.blob); break; }
      const again = await ask(`<div class="card"><h2>I could not hear a clear note</h2>
        <div class="row"><button class="primary" data-act="retry" data-key="Enter">Try again</button><button data-act="skip">Skip</button></div></div>`);
      if (again.act === 'skip') break;
    }

    if (!allFrames.length) { ensureMouseVoice(); return App.voice; }
    const semis = allFrames.map(f => f.m).sort((a, b) => a - b);
    const med = SC.median(semis), pct = p => semis[Math.floor((semis.length - 1) * p)];
    // key: nearest of the eight SSAP keys to the median pitch (cents re 220 Hz), as in WarmUp_Processing
    const medCents = (med - 57) * 100;
    let pos = 0, bestD = 1e9;
    KEY_HZ.forEach((hzv, i) => { const d = Math.abs(medCents - 1200 * Math.log2(hzv / 220)); if (d < bestD) { bestD = d; pos = i; } });
    const medHz = AudioKit.hz(med);
    const suggest = medHz <= 250 ? 'male' : 'female';
    const pick = await ask(`<div class="card"><h2>Your comfortable pitch is around ${Draw.noteName(med)}</h2>
      <p>The echo games use recordings of a singer in a similar range to yours. Which set sounds closer to your voice?</p>
      <label class="opt"><input type="radio" name="who" value="male" ${suggest === 'male' ? 'checked' : ''}> Lower voice (recorded by a man)</label>
      <label class="opt"><input type="radio" name="who" value="female" ${suggest === 'female' ? 'checked' : ''}> Higher voice (recorded by a woman)</label>
      <div class="row"><button class="primary" data-act="ok" data-key="Enter">Continue</button></div></div>`);
    const who = pick.form.who || suggest;
    // SSAP limits: lower set = A2..A3, higher set = F3..F4
    let kp = pos;
    if (who === 'male') { if (kp > 4) kp = 4; } else { if (kp < 3) kp = 3; }
    const key = KEYS[kp];
    let low = pct(0.05), high = pct(0.95);
    if (high - low < 9) { low = med - 4.5; high = med + 4.5; }
    App.voice = { who, key, medianSemi: med, low, high, source: 'warmup' };
    saveVoice();
    DS.S.voice = { key, who, medianSemi: med };
    autoSave();
    await ask(`<div class="card"><h2>All set</h2>
      <p class="strong">Comfortable pitch: ${Draw.noteName(med)} &middot; practice range: ${Draw.noteName(low)} to ${Draw.noteName(high)} &middot; key for the echo games: ${key}</p>
      <div class="row"><button class="primary" data-act="ok" data-key="Enter">Continue</button></div></div>`);
    return App.voice;
  }

  // ---------------------------------------------------------------- echo games
  const ECHO = {
    voice: { section: 2, count: 10, n: 1, title: 'Echo: Voice', about: 'You will hear a single note sung on “doo”.' },
    piano: { section: 3, count: 10, n: 1, title: 'Echo: Piano', about: 'You will hear a single note played on a piano.' },
    four:  { section: 4, count: 6,  n: 4, title: 'Four-Note Run', about: 'You will hear four notes in a steady rhythm.' },
  };

  async function echoTrial(kind, k, idxLabel) {
    const cfgE = ECHO[kind], name = stimName(kind, k), meta = App.stim[name];
    if (!meta) throw new Error('Missing stimulus ' + name);
    const buf = await AudioKit.loadStim(name);
    const practice = k === 0, n = cfgE.n;
    const need = n === 4 ? 1.2 : 0.35, tail = n === 4 ? 1.4 : 0.9, max = n === 4 ? 11 : 6.5;
    for (;;) {
      defaultView(); toIdle({ follow: false });
      setStatus((practice ? 'Practice' : idxLabel) + ' · ' + cfgE.title);
      say(esc(practice ? 'Practice' : idxLabel) + '<small>Listen…</small>');
      guide({ step: 1, coach: 'Listen to the ' + (n === 4 ? 'four notes' : 'note') + '. You don\u2019t need to do anything yet.',
        help: 'Right now a recording is playing. Just listen. When it ends you will sing it back.' + (practice ? ' This is practice and is not scored.' : '') });
      await wait(0.9);
      world.rings = 'listen';
      AudioKit.playBuffer(buf, 1.0);
      await wait(meta.dur + 0.2);
      world.rings = null;
      await wait(0.3);
      say('Sing it back!');
      AudioKit.click(true);
      world.follow = App.settings.live; world.rings = 'sing';
      const mouse = S.mode === 'mouse';
      guide({ help: 'Sing what you heard, on \u201Cdoo\u201D. ' + (n === 4 ? 'Sing the four notes one after another, in the same rhythm.' : 'Hold the note for about a second.') +
        ' When you stop singing, I move on by myself after a short pause. You can also press \u201CI\u2019m finished singing\u201D.' });
      const p = await singPhase({ need, tail, max, mouseSec: n === 4 ? 4.8 : 1.6, coach: {
        start: mouse ? 'Move the pointer to the note and hold it there.'
          : n === 4 ? 'Sing the four notes one after another, on \u201Cdoo\u201D, in the same rhythm.' : 'Sing the note now, on \u201Cdoo\u201D. Hold it for about a second.',
        need: need + 0.2,
        finish: n === 4 ? 'Got it \u2713 Pause when you\u2019ve finished and I\u2019ll move on.' : 'Got it \u2713 Stop singing and I\u2019ll move on by myself.' } });
      world.follow = false; world.rings = null; say('');

      let res = null;
      if (p.voicedSec >= need * 0.8) {
        const frames = p.frames.map(f => ({ t: f.t, oct: semiToOct(f.m) }));
        if (n === 1) { const r = SC.scoreNote(frames.map(f => f.oct), meta.notes[0].f0); res = r ? [r] : null; }
        else { res = SC.scoreSequence(frames, meta.notes.map(x => x.f0)); if (res && res.some(x => !x)) res = null; }
      }
      if (!res) {
        const a = await ask(`<div class="card"><h2>I did not catch a clear ${n === 4 ? 'set of notes' : 'note'}</h2>
          <p>${S.mode === 'mic' ? 'Sing a little louder or closer to the microphone, using “doo”.' : 'Move the pointer to the note, then hold it.'}</p>
          <div class="row"><button class="primary" data-act="retry" data-key="Enter">Try again</button>${practice ? '' : '<button data-act="skip">Skip this one</button>'}</div></div>`);
        if (a.act === 'skip') return null;
        continue;
      }
      if (p.wav) DS.addAudio(audioName('imit', cfgE.section, k), p.wav.blob);
      if (!practice) DS.addImitation(cfgE.section, k, name, res);
      autoSave();
      await reveal(meta, res, practice);
      return res;
    }
  }

  async function reveal(meta, res, practice) {
    guide({ step: 3, coach: practice ? 'That was practice, so it is not scored. The real ones come next.' : 'This is how close you were. The next one starts by itself.',
      help: 'The pipes show where the notes were. Green means within half a semitone (50 cents) of the target.' });
    const tg = meta.notes.map(x => octToSemi(x.f0)), sg = res.map(r => octToSemi(r.sungOct));
    const lo = Math.min(...tg, ...sg) - 2.5, hi = Math.max(...tg, ...sg) + 2.5, mid = (lo + hi) / 2;
    setView(Math.min(lo, mid - 5), Math.max(hi, mid + 5));
    const n = tg.length, x0 = 150, xs = n === 1 ? [560] : tg.map((_, i) => 340 + i * 170);
    world.gates = tg.map((t, i) => ({ x: xs[i], target: t, ySung: Draw.y(sg[i]), cents: res[i].cents, err: res[i].err }));
    world.rev = { t: 0, dur: 1, x0, y0: Draw.y(mid) };
    world.kind = 'reveal'; world.rings = null; world.time = 0;
    const total = (xs[xs.length - 1] + 140 - x0) / 210 + 0.5;
    await wait(total);
    const mean = res.reduce((a, r) => a + r.abs, 0) / res.length;
    const ok = res.filter(r => !r.err).length;
    say((n === 1 ? (res[0].err ? 'Close, but not quite' : 'On target!') : ok + ' of ' + n + ' notes on target') +
        '<small>' + (practice ? 'Practice · not scored' : 'Average error ' + Math.round(mean) + ' cents') + '</small>');
    await wait(1.6);
    say('');
    guide({ step: 0, coach: '' });
    world.kind = 'idle'; defaultView();
  }

  async function runEcho(kind) {
    const E = ECHO[kind];
    await loadManifest();
    if (!App.voice) { await runWarmup(); }
    let r = await ask(`<div class="card"><h2>${E.title}</h2>
      <p class="strong">${E.about} After you hear it, sing it back on “doo”.</p>
      <ul><li>${E.n === 4 ? 'Try to keep the same rhythm: four notes, one after another.' : 'Match the pitch, not the voice. You do not have to sound like the recording.'}</li>
          <li>You will do a practice round first, then ${E.count} scored ${E.n === 4 ? 'patterns' : 'notes'}.</li>
          <li>${App.settings.live ? 'The bird follows your voice while you sing (practice mode).' : 'The bird stays still while you sing, as in the SSAP test; after each one it shows how close you were.'}</li>
          <li>Use headphones so the recording does not get picked up by the microphone.</li>
          <li>Watch the top-left light: <b>RECORDING</b> in red means I am capturing your singing; the little bar moves when I can hear you.</li></ul>
      <div class="row"><button class="primary" data-act="go" data-key="Enter">Start practice</button><button data-act="back">Back</button></div></div>`);
    if (r.act === 'back') return null;
    for (;;) {
      await echoTrial(kind, 0, 'Practice');
      const again = await ask(`<div class="card"><h2>Practice done</h2><p>Ready for the real trials?</p>
        <div class="row"><button class="primary" data-act="go" data-key="Enter">Start</button><button data-act="again">Another practice</button></div></div>`);
      if (again.act === 'go') break;
    }
    const out = [];
    for (let k = 1; k <= E.count; k++) {
      const res = await echoTrial(kind, k, 'Trial ' + k + ' of ' + E.count);
      out.push(res);
    }
    autoSave();
    const sum = await showEchoSummary(kind, out);
    const notes = out.filter(Boolean).flat().map(x => Math.round(x.abs * 10) / 10);
    await postScore(kind === 'voice' ? 'echo_voice' : kind === 'piano' ? 'echo_piano' : 'four_note', { notes });
    return sum;
  }

  async function showEchoSummary(kind, out) {
    const E = ECHO[kind];
    const all = out.filter(Boolean).flat();
    const acc = all.length ? Math.round(100 * all.filter(x => !x.err).length / all.length) : 0;
    const mae = all.length ? Math.round(all.reduce((a, x) => a + x.abs, 0) / all.length) : 0;
    const sgn = all.length ? Math.round(all.reduce((a, x) => a + x.cents, 0) / all.length) : 0;
    const rows = out.map((r, i) => r ? `<tr><td>${i + 1}</td><td>${r.map(x => (x.cents >= 0 ? '+' : '') + Math.round(x.cents)).join(', ')}</td>
      <td class="${r.every(x => !x.err) ? 'ok' : 'err'}">${r.every(x => !x.err) ? 'accurate' : 'off'}</td></tr>` : `<tr><td>${i + 1}</td><td>skipped</td><td></td></tr>`).join('');
    say(''); setStatus('');
    await ask(`<div class="card"><h2>${E.title}: results</h2>
      <div class="stats"><div class="stat"><b>${acc}%</b><span>notes within 50¢</span></div>
        <div class="stat"><b>${mae}</b><span>mean error (cents)</span></div>
        <div class="stat"><b>${sgn >= 0 ? '+' : ''}${sgn}</b><span>average direction (¢)</span></div></div>
      <table class="res"><tr><th>Trial</th><th>Error (cents)</th><th></th></tr>${rows}</table>
      <div class="row"><button class="primary" data-act="ok" data-key="Enter">Continue</button></div></div>`);
    return { acc, mae };
  }

  // ---------------------------------------------------------------- free play
  async function runFree() {
    if (!App.voice) await runWarmup();
    const v = App.voice;
    const notes = []; const tonic = Math.round(v.low);
    for (let o = 0; o < 4; o++) for (const s of [0, 2, 4, 5, 7, 9, 11]) { const m = tonic + o * 12 + s; if (m >= v.low - 0.5 && m <= v.high + 0.5) notes.push(m); }
    if (notes.length < 3) notes.push(Math.round(v.low), Math.round((v.low + v.high) / 2), Math.round(v.high));
    const best = (() => { try { return +localStorage.getItem('ssap2-best') || 0; } catch (e) { return 0; } })();
    const r = await ask(`<div class="card"><h2>Free Play</h2>
      <p class="strong">Sing to fly. Match each pipe’s note to slip through. If you stop singing, the bird falls.</p>
      <p>Gaps start wide (±100 cents) and narrow to ±50 cents. ${App.settings.cue ? 'You will hear each note shortly before its pipe arrives; use headphones.' : ''}</p>
      ${best ? `<p>Your best: ${best} pipes.</p>` : ''}
      <div class="row"><button class="primary" data-act="go" data-key="Enter">Start</button><button data-act="back">Back</button></div></div>`);
    if (r.act === 'back') return null;
    for (;;) {
      const res = await freeRound(notes);
      const best2 = (() => { try { return +localStorage.getItem('ssap2-best') || 0; } catch (e) { return 0; } })();
      let note = res.reason === 'ground' ? 'The bird dropped because you stopped singing.' : 'Missed the gap.';
      if (res.cleared > best2) { try { localStorage.setItem('ssap2-best', String(res.cleared)); } catch (e) { /* ignore */ } note += ' New best!'; }
      const errs = res.errs.map(Math.abs);
      const a = await ask(`<div class="card"><h2>Game over</h2>
        <div class="stats"><div class="stat"><b>${res.cleared}</b><span>pipes cleared</span></div>
          <div class="stat"><b>${errs.length ? Math.round(errs.reduce((x, y) => x + y, 0) / errs.length) : '–'}</b><span>mean error (¢)</span></div>
          <div class="stat"><b>${errs.length ? Math.round(100 * errs.filter(e => e <= 50).length / errs.length) + '%' : '–'}</b><span>within 50¢</span></div></div>
        <p>${note}</p>
        <div class="row"><button class="primary" data-act="again" data-key="Enter">Play again</button><button data-act="back">Back</button></div></div>`);
      await postScore('free_play', { score: res.cleared });
      autoSave();
      if (res.errs.length) DS.addExtra({ task: 'free_play', label: 'round', info: 'cleared=' + res.cleared, abs: errs.reduce((x, y) => x + y, 0) / errs.length });
      if (a.act === 'back') return res;
    }
  }

  function freeRound(notes) {
    return new Promise(async (resolve, reject) => {
      try {
        const v = App.voice, speed = 170, every = 2.4;
        setView(v.low - 2.5, v.high + 2.5);
        toIdle({ follow: true });
        world.kind = 'scroll'; world.fall = true; world.speed = speed; world.t = 0; world.liveJudge = false; world.lyrics = false;
        world.labels = notes; world.birdSemi = (v.low + v.high) / 2;
        let spawned = 0, nextSpawn = 3.0, lastTarget = null, cleared = 0; const errs = [];
        const tol = i => (i < 5 ? 1.0 : i < 12 ? 0.75 : 0.5);
        const pick = () => {
          if (lastTarget == null) return notes[Math.floor(notes.length / 2)];
          const idx = notes.indexOf(lastTarget), cand = notes.filter((n, i) => Math.abs(i - idx) <= 3 && n !== lastTarget);
          return cand[Math.floor(Math.random() * cand.length)];
        };
        say('');
        guide({ step: 0, coach: 'Sing to fly! Match the note on each pipe. Keep singing or the bird falls.',
          help: 'Sing higher to go up and lower to go down. Match the note shown on each pipe. If you stop singing, the bird falls.' });
        setTimeout(() => { if (App.onFrame) guide({ coach: '' }); }, 7000);
        App.onFrame = dt => {
          world.t += dt;
          if (world.t >= nextSpawn) {
            const target = pick(); lastTarget = target;
            const arrive = world.t + (W + 30 - BIRD_X) / speed;
            world.pipes.push({ t0: arrive - 30 / speed, t1: arrive + 30 / speed, midi: target, tol: tol(spawned), tag: Draw.noteName(target), cued: false, passed: false });
            spawned++; nextSpawn += every;
          }
          setStatus('Free Play · pipes ' + cleared);
          for (const p of world.pipes) {
            if (App.settings.cue && !p.cued && p.t0 - world.t < 2.0) { p.cued = true; AudioKit.tone(p.midi, 0.9, { gain: 0.55 }); }
            if (world.t >= p.t0 && world.t <= p.t1 && Math.abs(world.birdSemi - p.midi) > p.tol + 0.0) { p.state = 'bad'; return finish('pipe'); }
            if (!p.passed && world.t > (p.t0 + p.t1) / 2) { p.passed = true; cleared++; errs.push((world.birdSemi - p.midi) * 100); p.state = 'good'; }
          }
          world.pipes = world.pipes.filter(p => (p.t1 - world.t) * speed > -120);
          if (world.grounded && App.clock - S.lastVoicedT > 0.3) return finish('ground');
        };
        const finish = reason => { App.onFrame = null; world.kind = 'idle'; world.follow = false; setStatus(''); resolve({ cleared, errs, reason }); };
        // if the user aborts (Menu button), the pending promise chain rejects elsewhere
        App.abortFree = () => { App.onFrame = null; reject(ABORT); };
      } catch (e) { reject(e); }
    });
  }

  // ---------------------------------------------------------------- songs
  async function runSongs(fixedId) {
    if (!App.voice) await runWarmup();
    let id = fixedId;
    if (!id) {
      const ids = SO.ORDER.concat('birthday');
      const r = await ask(`<div class="card"><h2>Song Time</h2>
        <p>Pick a song. <b>Play along</b> scrolls the notes past with a beat. <b>Sing it yourself</b> is the SSAP test: sing with the words, then again from memory.</p>
        ${ids.map(i => `<div class="row" style="margin-top:6px"><span style="flex:1;min-width:180px;align-self:center">${esc(SO.SONGS[i].title)}</span>
          <button class="blue" data-act="play:${i}">Play along</button><button data-act="ssap:${i}">Sing it yourself</button></div>`).join('')}
        <div class="row"><button data-act="back">Back</button></div></div>`);
      if (r.act === 'back') return null;
      const [mode, sid] = r.act.split(':');
      return mode === 'play' ? songGuided(sid) : songSSAP(sid);
    }
    return songSSAP(id);
  }

  async function songSSAP(id) {
    const song = SO.SONGS[id], out = [];
    setView(48, 76);
    for (const part of [1, 2]) {
      toIdle({ follow: false, rings: 'sing' }); defaultView();
      for (;;) {
        const lyr = part === 1 ? `<div class="lyrics">${esc(song.lyrics.join('\n'))}</div>` : '<p>This time sing it from memory, using “doo” for every syllable.</p>';
        await ask(`<div class="card"><h2>${esc(song.title)}${part === 2 ? ' again' : ''}</h2>${lyr}
          <p>${part === 1 ? 'Sing it once through using the words, starting on any note you like.' : 'There are no words on screen.'}</p>
          <div class="row"><button class="primary" data-act="go" data-key="Enter">Start recording</button></div></div>`);
        say('Sing!<small>Press “I’m done” when you finish</small>');
        guide({ help: 'Sing the song once through' + (part === 1 ? ' using the words' : ' from memory, on \u201Cdoo\u201D') + '. When you reach the end, press \u201CI\u2019m finished singing\u201D.' });
        const p = await singPhase({ need: 4, tail: 2.5, max: 90, mouseSec: 6, donePrimary: true, step: 0, coach: {
          start: part === 1 ? 'Sing the song all the way through, using the words.' : 'Sing the song again from memory, on \u201Cdoo\u201D.', need: 4,
          finish: 'Keep going to the end, then press \u201CI\u2019m finished singing\u201D.' } });
        say('');
        if (p.voicedSec < 2) {
          const a = await ask(`<div class="card"><h2>I could not hear enough</h2><div class="row"><button class="primary" data-act="retry" data-key="Enter">Try again</button><button data-act="skip">Skip</button></div></div>`);
          if (a.act === 'skip') break; else continue;
        }
        const octs = p.frames.map(f => semiToOct(f.m));
        const r = SC.songAccuracy(octs, song.hist);
        if (!r) { out.push({ part, r: null }); break; }
        if (p.wav) DS.addAudio(audioName('song', part), p.wav.blob);
        DS.addSong(song.short, part, part === 1 ? 'text' : 'memo', r);
        autoSave();
        out.push({ part, r });
        break;
      }
    }
    autoSave();
    const rowsH = out.map(o => o.r ? `<tr><td>${o.part === 1 ? 'With the words' : 'From memory'}</td><td>${Math.round(o.r.score * 100)}%</td></tr>` : `<tr><td>Part ${o.part}</td><td>skipped</td></tr>`).join('');
    await ask(`<div class="card"><h2>${esc(song.title)}: result</h2>
      <p>The score compares the notes you sang with the song’s notes. It does not matter which key you chose.</p>
      <table class="res"><tr><th>Part</th><th>Accuracy</th></tr>${rowsH}</table>
      <div class="row"><button class="primary" data-act="ok" data-key="Enter">Continue</button></div></div>`);
    const scored = out.filter(o => o.r).map(o => Math.round(o.r.score * 100));
    if (scored.length) await postScore('song', { score: Math.max(...scored), extra: song.short });
    return out;
  }

  async function songGuided(id) {
    const song = SO.SONGS[id], v = App.voice;
    const sp = SO.span(song);
    const lo = Math.min(v.low, 0) , hi = v.high;
    const tonic = SO.chooseTonic(song, v.low, v.high);
    const notes = SO.layout(song, tonic);
    const beat = 60 / song.bpm, pxPerBeat = 150, speed = pxPerBeat / beat, countIn = song.beatsPerBar;
    const tol = 0.75;
    const first = notes[0].midi;
    const viewLo = Math.min(v.low, tonic + sp.min) - 2.5, viewHi = Math.max(v.high, tonic + sp.max) + 2.5;
    const wide = (tonic + sp.max) - (tonic + sp.min) > (v.high - v.low) + 1.5;
    const r = await ask(`<div class="card"><h2>${esc(song.title)}</h2>
      <p class="strong">Notes scroll toward the bird. Sing each one as it reaches you, keeping time with the beat.</p>
      <ul><li>You will hear a ${song.beatsPerBar}-beat count-in; the first note is played to get you started.</li>
          <li>Key chosen for you: tonic ${Draw.noteName(tonic)}${wide ? ' (this song is wider than your warm-up range, so some notes may be a stretch)' : ''}.</li>
          <li>Use headphones so the beat is not picked up by the microphone.</li></ul>
      <div class="row"><button class="primary" data-act="go" data-key="Enter">Start</button><button data-act="back">Back</button></div></div>`);
    if (r.act === 'back') return null;

    setView(viewLo, viewHi); toIdle({ follow: true });
    world.kind = 'scroll'; world.fall = true; world.speed = speed; world.liveJudge = true; world.lyrics = true;
    world.labels = [...new Set(notes.map(n => n.midi))];
    world.birdSemi = (viewLo + viewHi) / 2;
    const zero = App.clock + (countIn + 0.2) * beat;                       // clock time at which song time = 0
    world.pipes = notes.map(n => ({ t0: n.beat * beat + 0.04, t1: (n.beat + n.dur) * beat - 0.05, midi: n.midi, tol, syl: n.syl, state: 'normal' }));
    world.t = -(countIn + 0.2) * beat;
    const total = SO.totalBeats(song) * beat;
    let beatIdx = -countIn - 1;
    say('Get ready…');
    guide({ step: 0, coach: 'Sing each note as it reaches the bird, and keep time with the beat.',
      help: 'Notes scroll toward the bird. Sing the pitch of each pipe when it reaches the bird. The clicks are the beat.' });
    const rec = IN.startRec(App.clock);
    if (Recorder.isReady()) Recorder.start();
    await new Promise((resolve, reject) => {
      App.onFrame = () => {
        world.t = App.clock - zero;
        const b = Math.floor(world.t / beat);
        if (b > beatIdx) {
          beatIdx = b;
          if (b >= -countIn && b < SO.totalBeats(song)) AudioKit.click(((b % song.beatsPerBar) + song.beatsPerBar) % song.beatsPerBar === 0);
          if (b === -countIn) AudioKit.tone(first, beat * 1.6, { gain: 0.5 });
          if (b === 0) say('');
        }
        setStatus(esc(song.short));
        if (world.t > total + 0.8) { App.onFrame = null; resolve(); }
      };
      App.abortFree = () => { App.onFrame = null; reject(ABORT); };
    });
    const got = IN.stopRec() || rec;
    const wav = Recorder.isReady() ? Recorder.stop() : null;
    world.kind = 'idle'; world.follow = false; setStatus(''); defaultView();

    // score: median of the middle half of voiced frames inside each note
    const scored = [];
    notes.forEach((n, i) => {
      const t0 = zero + n.beat * beat + 0.12 * n.dur * beat, t1 = zero + (n.beat + n.dur) * beat;
      const fr = got.frames.filter(f => f.t >= t0 && f.t <= t1).map(f => semiToOct(f.m));
      if (fr.length < 3) { scored.push(null); return; }
      const target = semiToOct(n.midi);
      const med = SC.median(SC.middleHalf(SC.foldOctaves(fr, target)));
      const cents = (med - target) * 1200;
      scored.push({ i, syl: n.syl, target, sung: med, cents, abs: Math.abs(cents), err: Math.abs(cents) >= 50 ? 1 : 0 });
    });
    const ok = scored.filter(Boolean);
    const med = ok.length ? SC.median(ok.map(x => x.cents)) : 0;
    const absAcc = ok.length ? Math.round(100 * ok.filter(x => !x.err).length / ok.length) : 0;
    const relAcc = ok.length ? Math.round(100 * ok.filter(x => Math.abs(x.cents - med) < 50).length / ok.length) : 0;
    const mae = ok.length ? Math.round(ok.reduce((a, x) => a + x.abs, 0) / ok.length) : 0;
    scored.forEach((x, i) => { if (x) DS.addExtra({ task: 'song_guided', label: song.short, note: i + 1, target: x.target, sung: x.sung, cents: x.cents, abs: x.abs, err: x.err, info: 'syl=' + notes[i].syl + ';tonic=' + tonic }); });
    if (wav) DS.addAudio(DS.user() + '_SONG_GUIDED_' + song.short.toUpperCase() + '.wav', wav.blob);
    autoSave();
    say('');
    await ask(`<div class="card"><h2>${esc(song.title)}</h2>
      <div class="stats"><div class="stat"><b>${ok.length}/${notes.length}</b><span>notes heard</span></div>
        <div class="stat"><b>${absAcc}%</b><span>on the exact note</span></div>
        <div class="stat"><b>${relAcc}%</b><span>in tune with yourself</span></div></div>
      <p>${ok.length ? 'Average error ' + mae + ' cents. ' + (Math.abs(med) >= 20 ? 'You drifted about ' + Math.round(Math.abs(med)) + ' cents ' + (med > 0 ? 'sharp' : 'flat') + ' overall; “in tune with yourself” ignores that.' : '') : 'I could not hear enough singing to score.'}</p>
      <div class="row"><button class="primary" data-act="again" data-key="Enter">Play again</button><button data-act="back">Back</button></div></div>`).then(a => a.act === 'again' ? songGuided(id) : null);
  }

  // ---------------------------------------------------------------- pitch perception (sine tones)
  async function runPerception() {
    const r = await ask(`<div class="card"><h2>Higher or Lower?</h2>
      <p class="strong">You will hear two tones. Say whether the <b>second</b> tone was higher or lower than the first.</p>
      <ul><li>Differences start large and get smaller as you answer correctly. It is meant to get hard; guess when unsure.</li>
          <li>Use headphones and a quiet room. Keys: ↑ higher, ↓ lower.</li></ul>
      <div class="row"><button class="primary" data-act="go" data-key="Enter">Start</button><button data-act="back">Back</button></div></div>`);
    if (r.act === 'back') return null;
    const sc = new ST.Staircase();
    guide({ step: 0, coach: 'Listen to both tones, then choose Higher or Lower.',
      help: 'You hear two tones. Decide whether the second tone was higher or lower than the first. Guess if you are unsure.' });
    defaultView(); toIdle({ follow: false });
    world.kind = 'tones'; world.pucks = [{ on: false, y: 220 }, { on: false, y: 220 }]; world.hop = 0; world.glow = false;
    let n = 0;
    while (!sc.done) {
      const t = sc.next(); n++;
      setStatus('Higher or Lower? · round ' + n);
      world.pucks[0].on = false; world.pucks[1].on = false; world.glow = false; world.hop = 0;
      say('Listen…');
      await wait(0.7);
      world.pucks[0].on = true; AudioKit.sine(t.standard, 1.0); await wait(1.0);
      world.pucks[0].on = false; await wait(0.5);
      world.pucks[1].on = true; AudioKit.sine(t.comparison, 1.0); await wait(1.0);
      world.pucks[1].on = false;
      say('Was the second tone higher or lower?');
      const a = await ask(`<div class="card"><div class="row center">
          <button class="blue big" data-act="higher" data-key="ArrowUp">↑ Higher</button>
          <button class="blue big" data-act="lower" data-key="ArrowDown">↓ Lower</button></div></div>`, { dock: true });
      const ok = sc.answer(a.act);
      world.hop = 1; world.hopDir = t.comparison > t.standard ? 1 : -1; world.glow = ok;
      say(ok ? 'Yes!' : 'Not quite');
      await wait(0.7); say('');
    }
    say(''); setStatus('');
    world.kind = 'idle';
    DS.addPerception(sc.threshold, sc.history);
    autoSave();
    const cents = ST.centsOf(sc.threshold);
    await ask(`<div class="card"><h2>Higher or Lower: result</h2>
      <div class="stats"><div class="stat"><b>${sc.threshold.toFixed(1)} Hz</b><span>smallest difference you reliably heard</span></div>
        <div class="stat"><b>${cents.toFixed(0)}¢</b><span>that is about ${(cents / 100).toFixed(1)} semitones at 500 Hz</span></div>
        <div class="stat"><b>${sc.history.length}</b><span>rounds</span></div></div>
      <p>Smaller is better. Most people can tell tones apart well within a semitone (100 cents).</p>
      <div class="row"><button class="primary" data-act="ok" data-key="Enter">Continue</button></div></div>`);
    await postScore('perception', { score: sc.threshold });
    return sc;
  }

  // ---------------------------------------------------------------- results, saving
  let saveStatus = '';
  // Non-blocking and safe to call often; overlapping calls are merged by the data store.
  function autoSave() {
    if (!DS.canSend()) return Promise.resolve();
    saveStatus = 'Saving\u2026'; setStatus(saveStatus);
    return DS.flush().then(r => {
      saveStatus = r.failed && r.failed.length ? 'Not saved yet, will retry' : 'Saved \u2713';
      setStatus(saveStatus);
    }).catch(() => { saveStatus = 'Not saved yet, will retry'; setStatus(saveStatus); });
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') DS.beacon(); });
  window.addEventListener('pagehide', () => DS.beacon());

  // ---------------------------------------------------------------- leaderboards
  const LB = Leaderboard;
  // Everyone who plays with a real microphone can post (mouse mode would be too easy to game).
  const lbAllowed = () => LB.enabled() && S.mode === 'mic';
  App.deferBoards = null;          // while set, board prompts are queued (used by the full session)

  function boardTable(board, rows, mine) {
    const B = LB.BOARDS[board];
    if (!rows.length) return '<p>No scores yet. Be the first!</p>';
    return `<table class="res lb"><tr><th>#</th><th>Nickname</th><th>${esc(B.unit)}</th></tr>${rows.map((r, i) =>
      `<tr${mine && r.nick === mine ? ' style="background:rgba(255,210,63,.15)"' : ''}><td>${i + 1}</td><td style="text-align:left">${esc(r.nick)}</td><td>${esc(B.fmt(r.score))}${r.extra ? ' <span class="chip">' + esc(r.extra) + '</span>' : ''}</td></tr>`).join('')}</table>`;
  }

  // After a finished section: see if the score makes the top 10, ask for a nickname if so, show the board.
  async function postScore(board, payload) {
    if (!lbAllowed()) return;
    if (App.deferBoards) { App.deferBoards.push({ board, payload }); return; }
    const B = LB.BOARDS[board];
    let chk;
    try { chk = await LB.check(board, payload); } catch (e) { return; }              // offline: just skip quietly
    let mine = null, rows = [];
    if (chk.qualifies) {
      let msg = '';
      for (;;) {
        const a = await ask(`<div class="card"><h2>You’re in the top 10!</h2>
          <p class="strong">#${chk.rank} on ${esc(B.title)}: ${esc(B.fmt(chk.score))}</p>
          <p>Choose a nickname to show on the leaderboard. Please don’t use your real name or anything that identifies you.</p>
          <input id="nick" name="nick" type="text" maxlength="16" autocomplete="off" value="${esc(LB.savedNick())}"
            style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--line);background:#0b1626;color:var(--ink)">
          <p class="err" role="alert">${esc(msg)}</p>
          <div class="row"><button class="primary" data-act="add" data-key="Enter">Add me</button><button data-act="no">No thanks</button></div></div>`, { keep: true });
        if (a.act === 'no') { hidePanel(); break; }
        try {
          await LB.submit(board, payload, a.form.nick || '');
          LB.rememberNick((a.form.nick || '').trim()); mine = (a.form.nick || '').trim().replace(/\s+/g, ' ');
          hidePanel(); break;
        } catch (e) { msg = String(e && e.message ? e.message : e); }
      }
    }
    try { rows = await LB.top(board); } catch (e) { return; }
    await ask(`<div class="card"><h2>${esc(B.title)}: top 10</h2>
      ${chk.qualifies ? '' : `<p>Your score: <b>${esc(B.fmt(chk.score))}</b> (#${chk.rank}). Keep going to reach the top 10.</p>`}
      ${boardTable(board, rows, mine)}
      <div class="row"><button class="primary" data-act="ok" data-key="Enter">Continue</button></div></div>`);
  }

  async function showLeaderboards() {
    let cur = LB.ORDER[0];
    for (;;) {
      let rows = [], err = '';
      try { rows = await LB.top(cur); } catch (e) { err = 'Could not load this leaderboard right now.'; }
      const B = LB.BOARDS[cur];
      const a = await ask(`<div class="card"><h2>Leaderboards</h2>
        <div class="row" style="margin-top:6px">${LB.ORDER.map(b => `<button class="mini ${b === cur ? 'primary' : ''}" data-act="b:${b}">${esc(LB.BOARDS[b].title)}</button>`).join('')}</div>
        <h3>${esc(B.title)} <span class="chip">${esc(B.unit)}</span></h3>
        ${err ? `<p class="err">${esc(err)}</p>` : boardTable(cur, rows)}
        ${S.mode === 'mic' ? '' : '<p>Scores can only be posted when you play with a microphone.</p>'}
        <div class="row"><button data-act="back">Back</button></div></div>`);
      if (a.act === 'back') return;
      if (a.act.indexOf('b:') === 0) cur = a.act.slice(2);
    }
  }

  async function showResults() {
    for (;;) {
      const s = DS.summary(), line = (l, v, u) => `<tr><td>${l}</td><td>${v == null ? '–' : v + (u || '')}</td></tr>`;
      const a = await ask(`<div class="card"><h2>Your results</h2>
        <table class="res"><tr><th>Measure</th><th>Result</th></tr>
          ${line('Echo tests, all notes within 50¢', s.imitation_all, '%')}
          ${line('Single notes, voice', s.single_voice, '%')}
          ${line('Single notes, piano', s.single_piano, '%')}
          ${line('Four-note patterns', s.pattern_voice, '%')}
          ${line('Song with words', s.song_with_lyrics, '%')}
          ${line('Song from memory', s.song_from_memory, '%')}
          ${line('Pitch discrimination', s.perception_hz == null ? null : s.perception_hz.toFixed(1), ' Hz (' + s.perception_cents + '¢)')}</table>
        ${DS.enabled() ? (DS.consented() ? `<p>${DS.canSend() ? 'Your results are saved to the lab as you go. ' + esc(saveStatus) : 'Results are kept on this page. Download the file below and send it to the lab as instructed.'}</p>` : '<p>You chose not to share data, so nothing has been recorded or sent.</p>') : '<p>These results stay on this page. Nothing is sent anywhere.</p>'}
        <div class="row">
          <button class="primary" data-act="zip">Download results (ZIP)</button>
          <button data-act="csv">Download CSV only</button>
          ${DS.canSend() ? '<button data-act="send">Send to the lab now</button>' : ''}
          ${DS.cfg.collect.boxUploadUrl ? '<button data-act="box">Open the upload page</button>' : ''}
          <button data-act="back">Back</button></div></div>`, { keep: false });
      if (a.act === 'back') return;
      if (a.act === 'zip') download(await DS.zipBlob(), DS.user() + '_results.zip');
      if (a.act === 'csv') download(new Blob([DS.csv()], { type: 'text/csv' }), DS.user() + '_RESULTS.csv');
      if (a.act === 'send') { say('Sending…'); await autoSave(); say(''); }
      if (a.act === 'box') window.open(DS.cfg.collect.boxUploadUrl, '_blank', 'noopener');
    }
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  // ---------------------------------------------------------------- full session
  async function fullSession() {
    const r = await ask(`<div class="card"><h2>Full SSAP session</h2>
      <p class="strong">All of the tests, in order. About 15 to 20 minutes.</p>
      <ol style="color:var(--muted)"><li>Warm-up</li><li>Echo: Voice (10 notes)</li><li>Echo: Piano (10 notes)</li><li>Four-Note Run (6 patterns)</li>
        <li>A familiar song, with words and from memory</li><li>Higher or Lower</li></ol>
      <div class="row"><button class="primary" data-act="go" data-key="Enter">Begin</button><button data-act="back">Back</button></div></div>`);
    if (r.act === 'back') return;
    const was = App.settings.live; App.settings.live = false;       // test conditions: no live bird
    App.deferBoards = [];
    try {
      await runWarmup();
      await runEcho('voice'); await runEcho('piano'); await runEcho('four');
      const ids = SO.ORDER, pick = await ask(`<div class="card"><h2>Pick a song</h2><p>Choose one you know well.</p>
        ${ids.map(i => `<label class="opt"><input type="radio" name="song" value="${i}" ${i === 'twinkle' ? 'checked' : ''}> ${esc(SO.SONGS[i].title)}</label>`).join('')}
        <div class="row"><button class="primary" data-act="go" data-key="Enter">Continue</button></div></div>`);
      await runSongs(pick.form.song || 'twinkle');
      await runPerception();
    } finally { App.settings.live = was; if (!App.deferBoards || App.aborted) App.deferBoards = App.aborted ? null : App.deferBoards; }
    const queued = App.deferBoards || []; App.deferBoards = null;
    await showResults();
    for (const q of queued) await postScore(q.board, q.payload);
  }

  // ---------------------------------------------------------------- start, consent, menu
  // Terms-and-conditions style: link to the consent form + a checkbox. Nothing is recorded before this.
  // Participant ID = SSAP-y_Bird_P + number, assigned by the lab's receiver in the order people take part.
  async function consentFlow(msg, needNumber) {
    if (!DS.enabled()) return true;
    const urlNum = new URLSearchParams(location.search).get('p');
    const auto = !!DS.cfg.collect.endpoint && !needNumber;
    const manual = !auto && !urlNum;
    const a = await ask(`<div class="card">
      <h2>Before you begin</h2>
      <p class="strong">This is a research study. Please read the
        <a href="${esc(DS.cfg.consentFile)}" target="_blank" rel="noopener">online consent form (opens in a new tab)</a>.</p>
      <label class="opt"><input type="checkbox" id="agree" name="agree">
        <span>I have read the consent form and I agree to take part, including having my singing recorded.</span></label>
      ${manual ? `<h3>Participant number</h3>
        <p>Enter the number the researcher gave you. Your ID will be ${esc(DS.cfg.participantPrefix)}…</p>
        <input id="pnum" name="pnum" type="text" inputmode="numeric" autocomplete="off" maxlength="5" placeholder="e.g. 12"
          style="width:10rem;padding:10px;border-radius:8px;border:1px solid var(--line);background:#0b1626;color:var(--ink)">` :
        '<p>You will be given an anonymous participant ID automatically.</p>'}
      <p class="err" role="alert">${esc(msg || '')}</p>
      <div class="row"><button class="primary" data-act="agree">Accept and continue</button>
        <button data-act="decline">Decline</button></div></div>`, { keep: true });
    if (a.act === 'decline') {
      const d = await ask(`<div class="card"><h2>Thank you</h2>
        <p>You chose not to take part, so nothing has been recorded or sent.</p>
        <p>If you like, you can still try the game on your own. In that case no data is collected at all.</p>
        <div class="row"><button class="primary" data-act="play">Play without sharing any data</button>
          <button data-act="end">Close</button></div></div>`);
      if (d.act === 'end') { say('Session ended. You can close this page.'); await new Promise(() => {}); }
      return false;
    }
    if (!a.form.agree) return consentFlow('Please tick the box to agree, or choose Decline.', needNumber);

    let id = null;
    if (urlNum) id = DS.idFromNumber(urlNum);
    else if (manual) id = DS.idFromNumber(a.form.pnum);
    else {
      showPanel('<div class="card"><p>Getting your participant ID…</p></div>');
      try { id = await DS.assignId(); }
      catch (e) { return consentFlow('Could not reach the lab’s server to give you an ID automatically (no connection?). Enter the number the researcher gave you.', true); }
    }
    if (!id) return consentFlow('Please enter a participant number (digits only).', needNumber);
    DS.setParticipant(id); DS.setConsent(); autoSave();
    await ask(`<div class="card"><h2>Thank you</h2>
      <p class="strong">Your participant ID is <b>${esc(id)}</b>.</p>
      <p>You do not need to remember it. Let’s begin.</p>
      <div class="row"><button class="primary" data-act="ok" data-key="Enter">Continue</button></div></div>`, { keep: true });
    hidePanel();
    return true;
  }

  async function micCheck() {
    guide({ step: 0, coach: '' });
    App.micCheck = { heard: 0, t: 0 };
    try {
      await ask(`<div class="card"><h2>Quick microphone check</h2>
        <p class="strong">Say “aah” out loud for a second, as if you were singing.</p>
        <div class="meter level big"><i id="mcbar"></i></div>
        <p id="mcmsg" class="strong">Waiting for sound…</p>
        <p>Headphones help, and a quiet room. Hold the microphone about a hand’s width from your mouth.</p>
        <div class="row"><button class="primary" id="mcok" data-act="ok" data-key="Enter" disabled>Continue</button><button data-act="skip">Skip</button></div></div>`);
    } finally { App.micCheck = null; }
  }

  function helpHtml() {
    const rec = S.mode === 'mouse' ? 'Mouse mode does not use any sound.'
      : (DS.consented() && DS.audioOn()) ? 'You agreed to take part, so during the <b>Sing</b> step your singing is recorded and saved for the study. The light at the top turns red <b>RECORDING</b> only while that is happening.'
      : 'Your microphone is used to follow your pitch. Nothing is saved or recorded.';
    return `<div class="card help-card"><h2>Help</h2>
      ${App.help ? `<h3>What to do now</h3><p class="strong">${App.help}</p>` : ''}
      <h3>The recording light</h3><p>${rec}</p>
      <h3>Singing tips</h3>
      <ul><li>Sing on “doo” in a normal speaking-to-singing voice. Whispering and humming are hard to follow.</li>
          <li>Use headphones in a quiet room, and stay about a hand’s width from the microphone.</li>
          <li>If I move on too early or late, stop singing for a moment, or press “I’m finished singing”.</li></ul>
      <h3>Something wrong?</h3>
      <ul><li><b>Nothing is heard:</b> check the microphone is not muted and was allowed in the browser.</li>
          <li><b>Stuck:</b> press <b>Menu</b> (top right) to go back, or reload the page.</li></ul>
      <div class="row"><button class="primary" id="help-close">Back to the game</button></div></div>`;
  }
  function openHelp() {
    const el = $('help'); el.innerHTML = helpHtml(); el.classList.remove('hidden'); App.paused = true;
    const close = () => { el.classList.add('hidden'); el.innerHTML = ''; App.paused = false; window.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    $('help-close').addEventListener('click', close);
    $('help-close').focus();
  }
  $('btn-help').addEventListener('click', openHelp);

  async function start() {
    $('btn-menu').hidden = true; setStatus('');
    toIdle({}); setView(48, 76); say('');
    loadVoice();
    const r = await ask(`<div class="card">
      <h2>Sing to fly</h2>
      <p class="strong">Games and tests of how accurately you sing, based on the Seattle Singing Accuracy Protocol.</p>
      <p>You will need a microphone. Headphones are best. ${DS.enabled() ? 'This version is part of a research study; you will be asked to consent first.' : 'Nothing is recorded or sent anywhere.'}</p>
      <div class="row"><button class="primary" data-act="mic" data-key="Enter">Start with microphone</button>
        <button data-act="mouse">Try with mouse (no mic)</button></div>
      <p id="smsg" class="err" role="alert"></p></div>`, { keep: true });
    let useMic = r.act === 'mic';
    if (DS.enabled()) { await consentFlow(); }
    $('stage').dataset.ready = '1';
    App.audio = 'disabled';                       // 'on' | 'off-mouse' | 'unavailable' | 'disabled'
    if (useMic) {
      showPanel('<div class="card"><p>Waiting for microphone permission… allow it in the browser prompt.</p></div>');
      try {
        await IN.startMic();
        if (DS.audioOn()) {
          try { await Recorder.attach(AudioKit.ctx(), S.source); App.audio = 'on'; }
          catch (e) { App.audio = 'unavailable'; DS.S.audioError = String((e && e.message) || e); console.warn('audio recorder unavailable', e); }
        }
      } catch (e) {
        const a = await ask(`<div class="card"><h2>Could not use the microphone</h2><p>${esc(e && e.message ? e.message : e)}</p>
          <div class="row"><button class="primary" data-act="mouse">Continue with the mouse</button><button data-act="retry">Try again</button></div></div>`);
        if (a.act === 'retry') return start();
        useMic = false;
      }
    }
    if (!useMic) { IN.startMouse(); ensureMouseVoice(); App.audio = DS.audioOn() ? 'off-mouse' : 'disabled'; }
    DS.S.audioStatus = App.audio;
    if (App.audio === 'unavailable') {
      await ask(`<div class="card"><h2>Audio recording is not available</h2>
        <p>This browser could not start the recorder, so your scores will be saved but your singing will <b>not</b> be recorded.</p>
        <p>If recordings matter for this study, try Chrome or Edge on a laptop, or an up-to-date Safari on iPhone.</p>
        <div class="row"><button class="primary" data-act="ok" data-key="Enter">Continue anyway</button></div></div>`);
    }
    if (S.mode === 'mic') await micCheck();
    autoSave();
    await menu();
  }

  function audioNote() {
    if (!DS.enabled() || !DS.consented()) return '';
    const m = {
      'on': '<span class="ok">Audio recording is on.</span> Your singing is saved for the study.',
      'off-mouse': '<span class="err">Mouse mode does not record audio.</span> Use the microphone for study data.',
      'unavailable': '<span class="err">Audio recording is not available in this browser.</span> Scores are still saved.',
      'disabled': 'Audio recording is not part of this study setup.',
    }[App.audio || 'disabled'];
    return `<p style="margin:0 0 6px;font-size:.88rem">${m}</p>`;
  }

  async function menu() {
    $('btn-menu').hidden = true;
    for (;;) {
      toIdle({}); defaultView(); say(''); setStatus('');
      guide({ step: 0, coach: '', help: 'Choose a game. If you are new, start with the Warm-up. Each game explains itself before it begins.' });
      const v = App.voice, done = v && v.source === 'warmup';
      const tile = (act, t, d, extra) => `<button class="tile ${extra || ''}" data-act="${act}"><b>${t}</b><span>${d}</span></button>`;
      const a = await ask(`<div class="card">
        <h2>Choose a game ${S.mode === 'mouse' ? '<span class="chip">mouse mode</span>' : ''}</h2>
        ${audioNote()}
        <div class="menu-grid">
          ${tile('warmup', 'Warm-up' + (done ? '<span class="chip ok">done</span>' : ''), done ? `Key ${v.key}, range ${Draw.noteName(v.low)}–${Draw.noteName(v.high)}. Redo any time.` : 'Find your comfortable range. Do this first.', done ? '' : 'rec')}
          ${tile('free', 'Free Play', 'Sing to fly through pipes. Gaps narrow as you go.')}
          ${tile('voice', 'Echo: Voice', 'Hear a sung note, sing it back. 10 notes.')}
          ${tile('piano', 'Echo: Piano', 'Same, but the note is played on a piano.')}
          ${tile('four', 'Four-Note Run', 'Hear four notes in rhythm, sing them back. 6 patterns.')}
          ${tile('songs', 'Song Time', 'Play along with a familiar song, or the SSAP song test.')}
          ${tile('percept', 'Higher or Lower?', 'A listening game: which of two tones is higher?')}
          ${tile('session', 'Full SSAP session', 'Every test in order, with a results report.')}
          ${LB.enabled() ? tile('boards', 'Leaderboards', 'Top 10 for each game. Play with the microphone to post a score.') : ''}
        </div>
        <label class="opt"><input type="checkbox" id="live" ${App.settings.live ? 'checked' : ''}> <span>Show the bird while I sing in the echo games (practice mode; leave off for SSAP-style testing)</span></label>
        <label class="opt"><input type="checkbox" id="cue" ${App.settings.cue ? 'checked' : ''}> <span>Play each target note before its pipe in Free Play (use headphones)</span></label>
        <div class="row"><button class="mini" data-act="results">Results and downloads</button></div>
      </div>`);
      App.settings.live = !!a.form.live; App.settings.cue = !!a.form.cue;
      App.aborted = false;
      $('btn-menu').hidden = false;
      try {
        if (a.act === 'warmup') await runWarmup();
        else if (a.act === 'free') await runFree();
        else if (a.act === 'voice' || a.act === 'piano' || a.act === 'four') await runEcho(a.act);
        else if (a.act === 'songs') await runSongs();
        else if (a.act === 'percept') await runPerception();
        else if (a.act === 'session') await fullSession();
        else if (a.act === 'results') await showResults();
        else if (a.act === 'boards') await showLeaderboards();
      } catch (e) {
        if (e !== ABORT) { console.error(e); await ask(`<div class="card"><h2>Something went wrong</h2><p>${esc(e && e.message ? e.message : e)}</p><div class="row"><button class="primary" data-act="ok">Back to menu</button></div></div>`).catch(() => {}); }
      }
      App.aborted = false; App.onFrame = null; IN.stopRec(); if (Recorder.isReady()) Recorder.stop();
      hidePanel(); say('');
    }
  }

  $('btn-menu').addEventListener('click', () => { if (App.abortFree) { const f = App.abortFree; App.abortFree = null; f(); } abortAll(); });

  // Privacy wording must match what this build actually does.
  if (DS.enabled()) {
    const line = $('privacy-line');
    if (line) line.textContent = 'This is a research study. Pitch is tracked on your device with YIN, as in the original SSAP. If you consent, your results' +
      (DS.cfg.collect.saveAudio ? ' and recordings of your singing' : '') + ' are collected under an anonymous participant ID, as described in the consent form.';
    document.querySelectorAll('details.about p').forEach(p => {
      if (p.textContent.indexOf('Privacy.') === 0)
        p.innerHTML = '<b>Privacy.</b> This is a research study. Microphone audio is analysed on your device as a pitch trace. If you consent, ' +
          'your scores' + (DS.cfg.collect.saveAudio ? ' and recordings of your singing' : '') + ' are collected under an anonymous participant ID, as set out in the ' +
          '<a href="' + esc(DS.cfg.consentFile) + '" target="_blank" rel="noopener">consent form</a>. If you decline, nothing is recorded or sent.';
    });
  }

  // ---------------------------------------------------------------- go
  resize();
  requestAnimationFrame(frame);
  start();
})();
