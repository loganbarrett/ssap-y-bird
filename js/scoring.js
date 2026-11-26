/* Scoring helpers, ported from the SSAP MATLAB code.
 *
 *   scoreNote       <- matSSAP_imitate_plot_stats_bynote_knowledge.m (single note)
 *   scoreSequence   <- same file, 4-note case. Uses equal time slices (the README's
 *                      "version 2" idea) instead of amplitude-envelope onsets.
 *   songAccuracy    <- matSSAP_pitchdistributionacc.m
 *
 * Pitch is carried as octaves re 440 Hz everywhere (what yin.m returns).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SSAPScoring = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const median = a => {
    if (!a.length) return NaN;
    const s = a.slice().sort((x, y) => x - y), n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  };
  const semiToOct = m => (m - 69) / 12;
  const octToSemi = o => 69 + 12 * o;

  // MATLAB: rows(floor(L*.25) : ceil(L*.75))  (1-based, inclusive; floor(0) is treated as 1)
  function middleHalf(a) {
    const L = a.length;
    if (!L) return [];
    const lo = Math.max(Math.floor(L * 0.25), 1), hi = Math.ceil(L * 0.75);
    return a.slice(lo - 1, hi);
  }

  // SSAP octave correction: only if the frames jump around (> 300 cents between neighbours),
  // pull anything half an octave or more away from the target back by an octave.
  function foldOctaves(oct, target) {
    const out = oct.slice();
    let jumpy = false;
    for (let i = 1; i < out.length; i++) if (Math.abs(out[i] - out[i - 1]) > 0.25) { jumpy = true; break; }
    if (jumpy) {
      for (let i = 0; i < out.length; i++) {
        const d = out[i] - target;
        if (d >= 0.5) out[i] -= 1; else if (d <= -0.5) out[i] += 1;
      }
    }
    return out;
  }

  function noteResult(sungOct, targetOct, n) {
    const cents = (sungOct - targetOct) * 1200;
    return { sungOct, targetOct, cents, abs: Math.abs(cents), err: Math.abs(cents) >= 50 ? 1 : 0, n };
  }

  // octFrames: pitch of each voiced frame (octaves re 440), in time order
  function scoreNote(octFrames, targetOct) {
    const f = octFrames.length > 1 ? octFrames.slice(1) : octFrames.slice();   // SSAP starts at the 2nd usable frame
    if (!f.length) return null;
    const mid = middleHalf(foldOctaves(f, targetOct));
    return noteResult(median(mid), targetOct, f.length);
  }

  // frames: [{t, oct}] voiced frames in time order. Equal time slices from 2nd frame to last frame.
  function sliceEqual(frames, n) {
    if (frames.length < n + 1) return null;
    const a = frames[1].t, b = frames[frames.length - 1].t;
    if (!(b > a)) return null;
    const out = Array.from({ length: n }, () => []);
    for (let i = 1; i < frames.length; i++) {
      let k = Math.floor((frames[i].t - a) / (b - a) * n);
      if (k >= n) k = n - 1;
      if (k >= 0) out[k].push(frames[i].oct);
    }
    return out;
  }

  function scoreSequence(frames, targetOcts) {
    const n = targetOcts.length;
    const slices = sliceEqual(frames, n);
    if (!slices) return null;
    return slices.map((s, i) => {
      if (!s.length) return null;
      return noteResult(median(middleHalf(foldOctaves(s, targetOcts[i]))), targetOcts[i], s.length);
    });
  }

  // ---- song accuracy (pitch distribution fit) -----------------------------------------
  function histc(vals, edges) {
    const h = new Array(edges.length).fill(0);
    for (const v of vals) {
      if (v === edges[edges.length - 1]) { h[edges.length - 1]++; continue; }
      if (v < edges[0] || v > edges[edges.length - 1]) continue;
      // edges are evenly spaced
      const k = Math.floor((v - edges[0]) / (edges[1] - edges[0]));
      if (k >= 0 && k < edges.length - 1) h[k]++;
    }
    return h;
  }
  function pearson(a, b) {
    const n = a.length;
    let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
    return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : NaN;
  }

  // octFrames: voiced frames (octaves re 440). hist: SSAP token counts per semitone, lowest note first.
  function songAccuracy(octFrames, hist) {
    if (octFrames.length < 10) return null;
    const cents = octFrames.map(o => o * 1200 + 1200);                  // cents re 220 Hz
    const med = median(cents);
    const lo = Math.floor(med / 100) * 100 - 1200, hi = Math.ceil(med / 100) * 100 + 1200;
    const edges = [];
    for (let b = lo; b <= hi; b += 100) edges.push(b);
    if (hist.length > edges.length) return null;
    const ph = histc(cents, edges);
    const scale = Math.max(...ph) / Math.max(...hist);
    const nOff = edges.length - hist.length + 1;
    const templ = i => { const t = new Array(edges.length).fill(0); hist.forEach((v, j) => { t[i + j] = v * scale; }); return t; };
    let best = 0, bestR = -Infinity;
    for (let i = 0; i < nOff; i++) {
      const r = pearson(templ(i), ph);
      if (r > bestR || (isNaN(bestR) && !isNaN(r))) { bestR = r; best = i; }
    }
    const tb = templ(best);
    let bestShift = 0, bestR2 = -Infinity;
    for (let s = -50; s <= 50; s++) {
      const r = pearson(tb, histc(cents.map(c => c + s), edges));
      if (r > bestR2) { bestR2 = r; bestShift = s; }
    }
    const adjusted = 1 / (1 + Math.exp(4 - 7 * bestR)) * 0.63 + 0.4;    // SSAP's logistic correction
    return {
      r: bestR, score: adjusted,
      lowestCents: edges[best],                                         // cents re 220 Hz of the template's lowest note
      lowestMidi: 57 + edges[best] / 100,
      fineShift: bestShift,
    };
  }

  return { median, middleHalf, foldOctaves, scoreNote, sliceEqual, scoreSequence, songAccuracy, histc, pearson, semiToOct, octToSemi };
});
