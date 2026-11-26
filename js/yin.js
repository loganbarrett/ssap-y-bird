/* YIN pitch estimator for the SSAP-y Bird game.
 * Same algorithm and outputs as python/ssap_yin.py (itself a port of yin.m):
 * f0 in octaves re 440 Hz, ap0 = aperiodic/total power, pwr = mean-square power.
 * Works one analysis window at a time, so it can run on live mic buffers. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SSAPYin = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  let scratch = new Float64Array(0), dBuf = new Float64Array(0),
      eBuf = new Float64Array(0), nBuf = new Float64Array(0);

  function yin(x, start, sr, o) {
    o = o || {};
    const minF = o.minF || 60;
    const maxF = o.maxF || Math.floor(sr / 4);
    const thresh = o.thresh == null ? 0.1 : o.thresh;
    const W = o.W || 1024;
    const tauMax = Math.ceil(sr / minF);
    const tauMin = Math.max(2, Math.floor(sr / maxF));
    const L = W + tauMax;

    if (scratch.length < L) {
      scratch = new Float64Array(L);
      dBuf = new Float64Array(tauMax + 2); eBuf = new Float64Array(tauMax + 2); nBuf = new Float64Array(tauMax + 2);
    }
    if (dBuf.length < tauMax + 2) {
      dBuf = new Float64Array(tauMax + 2); eBuf = new Float64Array(tauMax + 2); nBuf = new Float64Array(tauMax + 2);
    }
    const seg = scratch, d = dBuf, e = eBuf, dn = nBuf;
    for (let i = 0; i < L; i++) {
      const k = start + i;
      seg[i] = (k >= 0 && k < x.length) ? x[k] : 0;
    }

    let e0 = 0;
    for (let j = 0; j < W; j++) e0 += seg[j] * seg[j];
    const out = { hz: NaN, f0: NaN, ap0: 1, pwr: e0 / W };
    if (e0 < 1e-12) return out;

    e[0] = e0;
    for (let t = 0; t < tauMax; t++) e[t + 1] = e[t] - seg[t] * seg[t] + seg[t + W] * seg[t + W];

    let csum = 0;
    d[0] = 0; dn[0] = 1;
    for (let t = 1; t <= tauMax; t++) {
      let r = 0;
      for (let j = 0; j < W; j++) r += seg[j] * seg[j + t];
      const dt = e0 + e[t] - 2 * r;
      d[t] = dt;
      csum += dt;
      dn[t] = dt * t / Math.max(csum, 1e-30);
    }

    let dmin = Infinity, argmin = tauMin;
    for (let t = tauMin; t <= tauMax; t++) if (dn[t] < dmin) { dmin = dn[t]; argmin = t; }
    const lim = dmin + thresh;
    let t = -1;
    for (let k = tauMin; k <= tauMax; k++) if (dn[k] < lim) { t = k; break; }
    if (t < 0) t = argmin;
    else while (t + 1 <= tauMax && dn[t + 1] < dn[t]) t++;

    let tf = t;
    if (t >= 1 && t < tauMax) {
      const s0 = d[t - 1], s1 = d[t], s2 = d[t + 1];
      const den = s0 + s2 - 2 * s1;
      if (den > 1e-30) tf = t + 0.5 * (s0 - s2) / den;
    }
    if (!(tf > 0)) tf = t;

    out.hz = sr / tf;
    out.f0 = Math.log2(out.hz / 440);
    out.ap0 = Math.max(0, d[t]) / Math.max(e0 + e[t], 1e-30);
    return out;
  }
  return { yin: yin };
});
