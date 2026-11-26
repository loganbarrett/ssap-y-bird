/* Adaptive pitch-discrimination staircase, ported from matSSAP_pitchdis_adaptive.m
 * (after Loui et al. 2008/2009; 3-down / 1-up style):
 *   standard 500 Hz; comparison = 500 +/- change, direction random; start change 98 Hz
 *   every 3rd consecutive correct answer halves the change; every error doubles it
 *   a reversal is a change in accuracy from one trial to the next (trial 2 onward)
 *   after the 6th reversal the current change is the threshold
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SSAPStaircase = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const STANDARD = 500, START = 98, MAX_CHANGE = 400, REVERSALS = 6, MAX_TRIALS = 80;

  function Staircase(rng) {
    this.rng = rng || Math.random;
    this.change = START; this.revcnt = 0; this.rightcnt = 0; this.trialn = 1;
    this.history = []; this.accuracy = []; this.done = false; this.threshold = null;
    this.cur = null;
  }
  Staircase.prototype.next = function () {
    const dir = this.rng() < 0.5 ? 1 : -1;
    const comparison = STANDARD + this.change * dir;
    this.cur = { trial: this.trialn, change: this.change, standard: STANDARD, comparison, correct: comparison > STANDARD ? 'higher' : 'lower' };
    return this.cur;
  };
  // resp: 'higher' | 'lower'
  Staircase.prototype.answer = function (resp) {
    const c = this.cur, i = this.trialn - 1;
    const ok = resp === c.correct;
    let nextChange = this.change;
    if (!ok) { nextChange = Math.min(this.change * 2, MAX_CHANGE); this.accuracy[i] = 0; this.rightcnt = 0; }
    else {
      this.accuracy[i] = 1; this.rightcnt++;
      if (this.rightcnt === 3) nextChange = this.change / 2;
    }
    let rev = 0;
    if (i >= 1 && this.accuracy[i] !== this.accuracy[i - 1]) { rev = 1; this.revcnt++; }
    this.history.push({ trial: this.trialn, change: c.change, comparison: c.comparison, resp, correct: c.correct, accurate: this.accuracy[i], rightcnt: this.rightcnt, reversal: rev, revcnt: this.revcnt });
    if (this.rightcnt === 3) this.rightcnt = 0;
    if (this.revcnt < REVERSALS && this.trialn < MAX_TRIALS) { this.trialn++; this.change = nextChange; }
    else { this.done = true; this.threshold = c.change; }
    return ok;
  };
  const centsOf = hz => 1200 * Math.log2((STANDARD + hz) / STANDARD);
  return { Staircase, STANDARD, START, REVERSALS, centsOf };
});
