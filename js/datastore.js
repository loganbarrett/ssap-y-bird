/* Collects results, builds SSAP-style output files, and (only when the lab has turned collection
 * on and the participant has consented) lets the participant send them. */
const DataStore = (function () {
  'use strict';
  const base = { study: 'SSAP-y Bird', collect: { enabled: false, endpoint: '', token: '', boxUploadUrl: '', saveAudio: true },
                 consentFile: 'consent.html', consentVersion: 'unset', requireParticipantId: true,
                 participantPrefix: 'SSAP-y_Bird_P', idDigits: 3 };
  const user = window.SSAP_CONFIG || {};
  const cfg = Object.assign({}, base, user, { collect: Object.assign({}, base.collect, user.collect || {}) });

  const S = {
    pid: null, consent: null, started: new Date().toISOString(),
    voice: null,            // {key, who, medianCents}
    imit: [],               // imitation rows (non-practice)
    songs: [],              // familiar-song accuracy rows
    perception: null,       // {threshold, history}
    extra: [],              // guided-song / free-play summaries
    audio: new Map(),       // file name -> Blob
    sent: new Set(),
  };

  const enabled = () => !!cfg.collect.enabled;
  const consented = () => !!S.consent;
  const audioOn = () => enabled() && consented() && !!cfg.collect.saveAudio;
  const user_ = () => 'USER_' + (S.pid || 'anon');

  // ---- recording the results -------------------------------------------------------------
  function addImitation(section, part, trial, notes) {
    notes.forEach((n, i) => S.imit.push({ section, part, trial, note: i + 1, target: n.targetOct, sung: n.sungOct,
      cents: n.cents, abs: n.abs, err: n.err, frames: n.n }));
  }
  function addSong(song, part, cond, r) { S.songs.push({ song, part, cond, score: r.score, r: r.r, lowest: r.lowestCents, fine: r.fineShift }); }
  function addPerception(threshold, history) { S.perception = { threshold, history }; }
  function addExtra(row) { S.extra.push(row); }
  function addAudio(name, blob) { if (audioOn() && blob) S.audio.set(name, blob); }

  // ---- file formats ----------------------------------------------------------------------
  const pad = (s, n) => String(s).padStart(n, ' ');
  const f2 = v => (isFinite(v) ? v.toFixed(2) : 'NaN');

  // same columns/spacing as USER_<id>_OUTPUT.txt from matSSAP_Imitation_Processing.m
  function outputTxt() {
    return S.imit.map(r => pad('Imitation', 20) + '     ' + pad(r.part, 2) + '     ' + pad(r.trial, 20) + '  ' + r.note + '      ' +
      pad(f2(r.target), 4) + '   ' + pad(f2(r.sung), 4) + '  ' + pad(f2(r.cents), 4) + '   ' + pad(f2(r.abs), 4) + '  ' + r.err).join('\n') + '\n';
  }
  function singMemoryTxt() {
    return S.songs.map(r => pad('Familiar Song', 20) + '     ' + pad(r.song, 10) + '         ' + pad(r.cond, 4) + '         ' +
      r.score.toFixed(3) + '  ' + pad(Math.round(r.lowest), 4) + '       ' + pad(r.fine, 2)).join('\n') + '\n';
  }
  const q = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function csv() {
    const head = ['participant', 'study_version', 'consent_version', 'task', 'section', 'part', 'trial', 'note', 'target_oct_re440',
      'sung_oct_re440', 'signed_cents', 'abs_cents', 'error_ge_50c', 'n_frames'];
    const rows = [head];
    const common = [S.pid || '', cfg.study, cfg.consentVersion];
    S.imit.forEach(r => rows.push([...common, 'imitation', r.section, r.part, r.trial, r.note, r.target.toFixed(4), r.sung.toFixed(4),
      r.cents.toFixed(2), r.abs.toFixed(2), r.err, r.frames]));
    S.songs.forEach(r => rows.push([...common, 'song_' + r.cond, '', r.part, r.song, '', '', '', '', '', '', 'score=' + r.score.toFixed(3) + ';r=' + r.r.toFixed(3)]));
    S.extra.forEach(r => rows.push([...common, r.task, '', '', r.label || '', r.note == null ? '' : r.note, r.target == null ? '' : r.target, r.sung == null ? '' : r.sung,
      r.cents == null ? '' : r.cents, r.abs == null ? '' : r.abs, r.err == null ? '' : r.err, r.info || '']));
    if (S.perception) S.perception.history.forEach(h => rows.push([...common, 'perception', '', '', 'trial ' + h.trial, '', h.comparison, h.resp,
      '', '', h.accurate ? 0 : 1, 'change_hz=' + h.change + ';correct=' + h.correct + ';reversal=' + h.reversal]));
    if (S.perception) rows.push([...common, 'perception_threshold', '', '', '500Hz', '', '', '', S.perception.threshold, '', '', 'hz; cents=' +
      (1200 * Math.log2((500 + S.perception.threshold) / 500)).toFixed(2)]);
    return rows.map(r => r.map(q).join(',')).join('\n') + '\n';
  }
  // percent accurate per phase, like matSSAP_participant_summary.m
  function summary() {
    const by = f => { const r = S.imit.filter(f); return r.length ? Math.round(100 - 100 * r.reduce((a, x) => a + x.err, 0) / r.length) : null; };
    const song = c => { const r = S.songs.filter(x => x.part === c); return r.length ? Math.round(100 * r.reduce((a, x) => a + x.score, 0) / r.length) : null; };
    return {
      imitation_all: by(() => true), single_voice: by(r => r.section === 2), single_piano: by(r => r.section === 3), pattern_voice: by(r => r.section === 4),
      song_with_lyrics: song(1), song_from_memory: song(2),
      perception_hz: S.perception ? S.perception.threshold : null,
      perception_cents: S.perception ? +(1200 * Math.log2((500 + S.perception.threshold) / 500)).toFixed(1) : null,
    };
  }

  // all text/data files for this participant, name -> string
  function textFiles() {
    const u = user_(), f = {};
    f[u + '_OUTPUT.txt'] = outputTxt();
    f[u + '_SINGMEMORY.txt'] = singMemoryTxt();
    f[u + '_RESULTS.csv'] = csv();
    f[u + '_SUMMARY.json'] = JSON.stringify({ participant: S.pid, started: S.started, study: cfg.study, consentVersion: cfg.consentVersion,
      voice: S.voice, summary: summary(),
      audio: { status: S.audioStatus || null, error: S.audioError || null, files: S.audio.size, setting: cfg.collect.saveAudio } }, null, 2);
    if (S.voice) f[u + '_KEY.txt'] = S.voice.key;
    if (S.perception) {
      f[u + '_PERCEPTION_THRESHOLD.txt'] = S.perception.threshold.toFixed(4);
      f[u + '_PERCEPTION_DATA.txt'] = S.perception.history.map(h => [u, h.trial, h.change, h.comparison, h.resp, h.correct, h.accurate, h.rightcnt, h.reversal, h.revcnt].join('\t')).join('\n') + '\n';
    }
    if (S.consent) f[u + '_CONSENT.txt'] = 'consent_version=' + cfg.consentVersion + '\naccepted_at=' + S.consent.at + '\nparticipant=' + S.pid + '\n';
    return f;
  }

  // ---- ZIP (store-only, no compression needed for WAV/CSV of this size) ------------------
  let crcTable = null;
  function crc32(u8) {
    if (!crcTable) { crcTable = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; } }
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  async function toU8(x) { return typeof x === 'string' ? new TextEncoder().encode(x) : new Uint8Array(await x.arrayBuffer()); }
  async function zip(entries) {   // entries: [{name, data: string|Blob}]
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    const d = new Date(), dosT = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosD = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const e of entries) {
      const data = await toU8(e.data), name = enc.encode(e.name), crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosT, true); lh.setUint16(12, dosD, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(lh.buffer, name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dosT, true); ch.setUint16(14, dosD, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(ch.buffer, name);
      offset += 30 + name.length + data.length;
    }
    let csize = 0; for (let i = 0; i < central.length; i++) csize += central[i].byteLength;
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, csize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
  }
  async function zipBlob() {
    const tf = textFiles(), entries = Object.keys(tf).map(n => ({ name: n, data: tf[n] }));
    S.audio.forEach((blob, name) => entries.push({ name: 'recordings/' + name, data: blob }));
    return zip(entries);
  }

  // Network calls must never leave the page waiting forever (offline lab computer, firewall, VPN...).
  function timedFetch(url, opts, ms) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = new Promise((_, rej) => setTimeout(() => { if (ctl) ctl.abort(); rej(new Error('timeout')); }, ms));
    const req = fetch(url, Object.assign({}, opts, ctl ? { signal: ctl.signal } : {}));
    return Promise.race([req, timer]);
  }

  // ---- sending to the lab's Google Drive (Apps Script receiver) ---------------------------
  // Saved as the session goes: after every trial only what changed is sent, in one request,
  // so a participant who leaves part-way still leaves their data behind.
  function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
  const canSend = () => enabled() && consented() && !!cfg.collect.endpoint && !!S.pid;
  const mimeOf = n => (n.endsWith('.csv') ? 'text/csv' : n.endsWith('.json') ? 'application/json' : n.endsWith('.wav') ? 'audio/wav' : 'text/plain');
  const lastSent = new Map();            // text file name -> content the lab already has
  let flushing = null, again = false;

  async function postBatch(files) {
    const body = JSON.stringify({ token: cfg.collect.token, participant: S.pid, consentVersion: cfg.consentVersion, files });
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await timedFetch(cfg.collect.endpoint, { method: 'POST', body }, 25000);
        const j = await r.json();
        if (j && j.ok) return j;
        lastErr = new Error((j && j.error) || 'rejected');
      } catch (e) { lastErr = e; }
      await new Promise(r => setTimeout(r, 700 * (attempt + 1)));
    }
    throw lastErr;
  }

  async function flushOnce() {
    const tf = textFiles(), items = [];
    Object.keys(tf).forEach(n => { if (lastSent.get(n) !== tf[n]) items.push({ name: n, mime: mimeOf(n), get: async () => b64(await toU8(tf[n])), done: () => lastSent.set(n, tf[n]) }); });
    S.audio.forEach((blob, name) => { if (!S.sent.has(name)) items.push({ name, mime: 'audio/wav', get: async () => b64(await toU8(blob)), done: () => S.sent.add(name) }); });
    if (!items.length) return { sent: 0, failed: [] };
    // keep each request modest (a few seconds of audio plus the small text files)
    const batches = []; let cur = [], size = 0;
    for (const it of items) {
      const data = await it.get(), file = { name: it.name, mime: it.mime, data };
      if (cur.length && (size + data.length > 2.5e6 || cur.length >= 30)) { batches.push(cur); cur = []; size = 0; }
      cur.push({ file, done: it.done }); size += data.length;
    }
    if (cur.length) batches.push(cur);
    let sent = 0; const failed = [];
    for (const b of batches) {
      try { await postBatch(b.map(x => x.file)); b.forEach(x => x.done()); sent += b.length; }
      catch (e) { b.forEach(x => failed.push(x.file.name)); }
    }
    return { sent, failed };
  }

  // coalesces overlapping requests: if called while sending, it sends again straight after
  function flush() {
    if (!canSend()) return Promise.resolve({ skipped: true, sent: 0, failed: [] });
    if (flushing) { again = true; return flushing; }
    flushing = (async () => {
      let res; let guard = 0;
      do { again = false; res = await flushOnce(); } while (again && guard++ < 5);
      return res;
    })().finally(() => { flushing = null; });
    return flushing;
  }
  const send = flush;                    // kept for the "Send now" button

  // last-chance send when the page is hidden/closed (small text files only; the browser limits this)
  function beacon() {
    if (!canSend() || !navigator.sendBeacon) return;
    const tf = textFiles(), files = [];
    Object.keys(tf).forEach(n => { if (lastSent.get(n) !== tf[n]) files.push({ name: n, mime: mimeOf(n), data: btoa(unescape(encodeURIComponent(tf[n]))) }); });
    if (!files.length) return;
    const body = JSON.stringify({ token: cfg.collect.token, participant: S.pid, consentVersion: cfg.consentVersion, files });
    if (body.length < 60000) navigator.sendBeacon(cfg.collect.endpoint, new Blob([body], { type: 'text/plain' }));
  }

  const idFromNumber = n => {
    const k = parseInt(String(n).replace(/\D/g, ''), 10);
    if (!isFinite(k) || k < 1 || k > 99999) return null;
    return cfg.participantPrefix + String(k).padStart(cfg.idDigits, '0');
  };
  // asks the lab's receiver for the next free number (also reserves its folder)
  async function assignId() {
    if (!canSend0()) throw new Error('no endpoint');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('offline');
    let lastErr;
    for (let i = 0; i < 2; i++) {
      try {
        const r = await timedFetch(cfg.collect.endpoint, { method: 'POST', body: JSON.stringify({ token: cfg.collect.token, action: 'assign' }) }, 5000);
        const j = await r.json();
        if (j && j.ok && /^[A-Za-z0-9_-]{1,40}$/.test(j.participant || '')) return j.participant;
        lastErr = new Error((j && j.error) || 'rejected');
      } catch (e) { lastErr = e; }
      await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }
    throw lastErr;
  }
  const canSend0 = () => enabled() && !!cfg.collect.endpoint;

  function setParticipant(id) { S.pid = String(id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || null; return S.pid; }
  function setConsent() { S.consent = { at: new Date().toISOString(), version: cfg.consentVersion }; }

  return { cfg, S, enabled, consented, audioOn, canSend, setParticipant, idFromNumber, assignId, timedFetch, setConsent, flush, beacon, addImitation, addSong, addPerception, addExtra, addAudio,
           outputTxt, csv, summary, textFiles, zipBlob, send, user: user_ };
})();
