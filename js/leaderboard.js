/* Public leaderboards (top 10 per section), talking to the same receiver script as the study data.
 * Only the "just play" path can post: no consent, no ID, no recording, and never mixed with study data. */
const Leaderboard = (function () {
  'use strict';
  const cfg = window.SSAP_CONFIG || {};
  const lb = cfg.leaderboard || { enabled: false };
  const endpoint = () => (cfg.collect && cfg.collect.endpoint) || '';
  const token = () => (cfg.collect && cfg.collect.token) || '';

  const BOARDS = {
    echo_voice: { title: 'Echo: Voice', unit: 'notes on target', fmt: s => s + '%' },
    echo_piano: { title: 'Echo: Piano', unit: 'notes on target', fmt: s => s + '%' },
    four_note:  { title: 'Four-Note Run', unit: 'notes on target', fmt: s => s + '%' },
    song:       { title: 'Song', unit: 'accuracy', fmt: s => s + '%' },
    perception: { title: 'Higher or Lower', unit: 'smallest difference heard (smaller is better)', fmt: s => s + ' Hz', lower: true },
    free_play:  { title: 'Free Play', unit: 'pipes cleared', fmt: s => s + ' pipes' },
  };
  const ORDER = ['echo_voice', 'echo_piano', 'four_note', 'song', 'perception', 'free_play'];

  const enabled = () => !!lb.enabled && !!endpoint() && !(typeof navigator !== 'undefined' && navigator.onLine === false);

  function clientId() {
    try {
      let id = localStorage.getItem('ssap2-client');
      if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()); localStorage.setItem('ssap2-client', id); }
      return id.replace(/[^A-Za-z0-9-]/g, '').slice(0, 40);
    } catch (e) { return 'anon' + Math.random().toString(36).slice(2, 10); }
  }
  const savedNick = () => { try { return localStorage.getItem('ssap2-nick') || ''; } catch (e) { return ''; } };
  const rememberNick = n => { try { localStorage.setItem('ssap2-nick', n); } catch (e) { /* ignore */ } };

  async function call(action, board, extra) {
    const body = JSON.stringify(Object.assign({ token: token(), action, board, client: clientId() }, extra || {}));
    // leaderboards are a nicety: give up quickly instead of holding the game
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = new Promise((_, rej) => setTimeout(() => { if (ctl) ctl.abort(); rej(new Error('timeout')); }, 6000));
    const r = await Promise.race([fetch(endpoint(), Object.assign({ method: 'POST', body }, ctl ? { signal: ctl.signal } : {})), timer]);
    const j = await r.json();
    if (!j || !j.ok) throw new Error((j && j.error) || 'request failed');
    return j;
  }
  const top = board => call('lb_top', board).then(j => j.rows);
  const check = (board, payload) => call('lb_check', board, payload);
  const submit = (board, payload, nickname) => call('lb_submit', board, Object.assign({ nickname }, payload));

  return { BOARDS, ORDER, enabled, top, check, submit, savedNick, rememberNick };
})();
