/* Canvas drawing helpers shared by every game scene. */
const Draw = (function () {
  'use strict';
  const W = 960, H = 540, CEIL = 50, GROUND = H - 46, BIRD_X = 190, BIRD_R = 13;
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  let view = { lo: 50, hi: 74 };

  const noteName = m => { const r = Math.round(m); return NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1); };
  const setView = (lo, hi) => { view = { lo, hi }; };
  const getView = () => view;
  const y = semi => GROUND - (semi - view.lo) / (view.hi - view.lo) * (GROUND - CEIL);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function sky(g) {
    const s = g.createLinearGradient(0, 0, 0, H);
    s.addColorStop(0, '#17335a'); s.addColorStop(1, '#2d6290');
    g.fillStyle = s; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,.07)';
    for (let i = 0; i < 4; i++) { const cx = (i * 270 + 60) % W; g.beginPath(); g.ellipse(cx, 90 + (i % 2) * 60, 70, 18, 0, 0, 7); g.fill(); }
    g.fillStyle = '#1b3b2d'; g.fillRect(0, GROUND, W, H - GROUND);
    g.fillStyle = '#2d6a4a'; g.fillRect(0, GROUND, W, 5);
    g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(0, 0, W, CEIL - 16);
  }

  // semitone guide lines; `labelSet` = array of MIDI numbers to label
  function grid(g, labelSet) {
    g.font = '12px system-ui, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
    const set = new Set((labelSet || []).map(Math.round));
    for (let m = Math.ceil(view.lo); m <= Math.floor(view.hi); m++) {
      const yy = y(m), on = set.has(m);
      g.strokeStyle = on ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.05)';
      g.lineWidth = 1; g.beginPath(); g.moveTo(46, yy); g.lineTo(W, yy); g.stroke();
      if (on) { g.fillStyle = 'rgba(255,255,255,.6)'; g.fillText(noteName(m), 8, yy); }
    }
  }

  // state: 'normal' | 'good' | 'bad' | 'dim'
  function pipe(g, x0, x1, target, tol, state) {
    const top = y(target + tol) - BIRD_R, bot = y(target - tol) + BIRD_R, w = x1 - x0;
    const base = state === 'bad' ? ['#a33', '#c55'] : state === 'good' ? ['#2f8f55', '#58e08f'] : state === 'dim' ? ['#2d5a45', '#3b7358'] : ['#3aa35f', '#4fcf7c'];
    g.fillStyle = base[0];
    g.fillRect(x0, 0, w, Math.max(0, top)); g.fillRect(x0, bot, w, H - bot);
    g.fillStyle = base[1];
    g.fillRect(x0 - 4, top - 12, w + 8, 12); g.fillRect(x0 - 4, bot, w + 8, 12);
    g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1.5; g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(x0 - 4, y(target)); g.lineTo(x1 + 4, y(target)); g.stroke(); g.setLineDash([]);
  }

  function bird(g, x, yy, o) {
    o = o || {};
    const tilt = clamp(o.tilt || 0, -0.5, 0.5), flap = Math.sin((o.t || 0) * 18) * (o.voiced ? 5 : 1.2);
    g.save(); g.translate(x, yy); g.rotate(tilt);
    if (o.glow) { g.fillStyle = 'rgba(90,209,154,.35)'; g.beginPath(); g.arc(0, 0, BIRD_R + 9, 0, 7); g.fill(); }
    g.fillStyle = o.voiced === false ? '#d9b73a' : '#ffd23f';
    g.beginPath(); g.arc(0, 0, BIRD_R, 0, 7); g.fill();
    g.fillStyle = '#f08a24'; g.beginPath(); g.moveTo(BIRD_R - 2, -3); g.lineTo(BIRD_R + 9, 1); g.lineTo(BIRD_R - 2, 5); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(4, -4, 4, 0, 7); g.fill();
    g.fillStyle = '#111'; g.beginPath(); g.arc(5, -4, 1.8, 0, 7); g.fill();
    g.fillStyle = '#e6b82e'; g.beginPath(); g.ellipse(-4, 3 + flap * .3, 8, 4 + Math.abs(flap) * .4, -.4, 0, 7); g.fill();
    g.restore();
  }

  function text(g, s, x, yy, o) {
    o = o || {};
    g.font = (o.weight || 600) + ' ' + (o.size || 14) + 'px system-ui, sans-serif';
    g.textAlign = o.align || 'center'; g.textBaseline = o.base || 'alphabetic';
    if (o.shadow !== false) { g.fillStyle = 'rgba(0,0,0,.45)'; g.fillText(s, x + 1, yy + 1); }
    g.fillStyle = o.color || '#fff'; g.fillText(s, x, yy);
  }

  // speaker waves / mic level ring, drawn around (x,yy)
  function rings(g, x, yy, level, t, color) {
    g.strokeStyle = color || 'rgba(255,255,255,.55)'; g.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      const r = 24 + ((t * 40 + i * 22) % 66) * (0.5 + level);
      g.globalAlpha = Math.max(0, 1 - (r - 24) / 70) * (0.25 + level * 0.75);
      g.beginPath(); g.arc(x, yy, r, 0, 7); g.stroke();
    }
    g.globalAlpha = 1;
  }

  return { W, H, CEIL, GROUND, BIRD_X, BIRD_R, noteName, setView, getView, y, sky, grid, pipe, bird, text, rings, clamp };
})();
