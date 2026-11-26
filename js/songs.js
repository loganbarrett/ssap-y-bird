/* Familiar songs used by SSAP. `hist` is SSAP's own token-count template (lowest note first),
 * used for the from-memory accuracy score. `melody` is a simple rendition for the guided game:
 * n = semitones from the tonic, d = beats, s = syllable. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SSAPSongs = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const C = 0, D = 2, E = 4, F = 5, G = 7, A = 9, B = 11, Gl = -5, Al = -3, Bl = -1;
  // helper: [[n, d, syllable], ...]
  const M = rows => rows.map(r => ({ n: r[0], d: r[1], s: r[2] }));

  const TW = [C, C, G, G, A, A, G, F, F, E, E, D, D, C, G, G, F, F, E, E, D, G, G, F, F, E, E, D, C, C, G, G, A, A, G, F, F, E, E, D, D, C];
  const TWd = [1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2];
  const tune = (notes, durs, syl) => M(notes.map((n, i) => [n, durs[i], syl[i] || '']));
  const split = s => s.split(/\s+/);

  const SONGS = {
    twinkle: {
      id: 'twinkle', title: 'Twinkle, Twinkle, Little Star', short: 'Twinkle', bpm: 84, beatsPerBar: 4,
      hist: [6, 0, 6, 0, 8, 8, 0, 10, 0, 4],
      melody: tune(TW, TWd, split('Twin kle twin kle lit tle star How I won der what you are Up a bove the world so high Like a dia mond in the sky Twin kle twin kle lit tle star How I won der what you are')),
      lyrics: ['Twinkle, twinkle, little star', 'How I wonder what you are', 'Up above the world so high', 'Like a diamond in the sky', 'Twinkle, twinkle, little star', 'How I wonder what you are'],
    },
    abc: {
      id: 'abc', title: 'The ABC Song', short: 'ABC', bpm: 84, beatsPerBar: 4,
      hist: [6, 0, 6, 0, 8, 8, 0, 10, 0, 4],
      melody: tune(
        [C, C, G, G, A, A, G, F, F, E, E, D, D, C, G, G, F, F, E, E, D, G, G, F, F, E, E, D, C, C, G, G, A, A, G, F, F, E, E, D, D, C],
        TWd,
        split('A B C D E F G H I J K LM NO P Q R S T U V - W X Y and Z - - Now I know my A B Cs Next time won\'t you sing with me')),
      lyrics: ['A - B - C - D - E - F - G', 'H - I - J - K - L - M - N - O - P', 'Q - R - S - T - U - V', 'W - X - Y - and Z', 'Now I know my ABCs', 'Next time won\'t you sing with me'],
    },
    mary: {
      id: 'mary', title: 'Mary Had a Little Lamb', short: 'Mary', bpm: 92, beatsPerBar: 4,
      hist: [3, 0, 10, 0, 11, 0, 0, 2],
      melody: tune(
        [E, D, C, D, E, E, E, D, D, D, E, G, G, E, D, C, D, E, E, E, E, D, D, E, D, C],
        [1, 1, 1, 1, 1, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 4],
        split('Ma ry had a lit tle lamb lit tle lamb lit tle lamb Ma ry had a lit tle lamb its fleece was white as snow')),
      lyrics: ['Mary had a little lamb', 'Little lamb', 'Little lamb', 'Mary had a little lamb', 'Whose fleece was white as snow'],
    },
    frere: {
      id: 'frere', title: 'Are You Sleeping? (Frère Jacques)', short: 'Frere', bpm: 100, beatsPerBar: 4,
      hist: [2, 0, 0, 0, 0, 9, 0, 2, 0, 5, 3, 0, 4, 0, 1],
      melody: tune(
        [C, D, E, C, C, D, E, C, E, F, G, E, F, G, G, A, G, F, E, C, G, A, G, F, E, C, C, Gl, C, C, Gl, C],
        [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 2, .5, .5, .5, .5, 1, 1, .5, .5, .5, .5, 1, 1, 1, 1, 2, 1, 1, 2],
        split('Are you sleep ing are you sleep ing Broth er John Broth er John Morn ing bells are ring ing morn ing bells are ring ing Ding dang dong ding dang dong')),
      lyrics: ['Are you sleeping, are you sleeping,', 'Brother John, Brother John,', 'Morning bells are ringing,', 'morning bells are ringing,', 'Ding, dang, dong, ding, dang, dong'],
    },
    bells: {
      id: 'bells', title: 'Jingle Bells', short: 'Bells', bpm: 108, beatsPerBar: 4,
      hist: [3, 0, 6, 0, 26, 11, 0, 5],
      melody: tune(
        [E, E, E, E, E, E, E, G, C, D, E, F, F, F, F, F, E, E, E, E, E, D, D, E, D, G, E, E, E, E, E, E, E, G, C, D, E, F, F, F, F, F, E, E, E, G, G, F, D, C],
        [1, 1, 2, 1, 1, 2, 1, 1, 1.5, .5, 4, 1, 1, 1.5, .5, 1, 1, 1, .5, .5, 1, 1, 1, 1, 2, 2, 1, 1, 2, 1, 1, 2, 1, 1, 1.5, .5, 4, 1, 1, 1.5, .5, 1, 1, 1, 1, 1, 1, 1, 1, 4],
        split('Jin gle bells jin gle bells jin gle all the way Oh what fun it is to ride in a one horse o pen sleigh hey Jin gle bells jin gle bells jin gle all the way Oh what fun it is to ride in a one horse o pen sleigh')),
      lyrics: ['Jingle bells, jingle bells, jingle all the way', 'Oh, what fun it is to ride', 'in a one-horse open sleigh'],
    },
    birthday: {
      id: 'birthday', title: 'Happy Birthday', short: 'Birthday', bpm: 96, beatsPerBar: 3,
      hist: [8, 0, 3, 0, 2, 5, 0, 2, 0, 2, 2, 0, 1],
      melody: tune(
        [Gl, Gl, Al, Gl, C, Bl, Gl, Gl, Al, Gl, D, C, Gl, Gl, G, E, C, Bl, Al, F, F, E, C, D, C],
        [.75, .25, 1, 1, 1, 2, .75, .25, 1, 1, 1, 2, .75, .25, 1, 1, 1, 1, 1, .75, .25, 1, 1, 1, 2],
        split('Hap py birth day to you Hap py birth day to you Hap py birth day dear name here Hap py birth day to you')),
      lyrics: ['Happy birthday to you', 'Happy birthday to you', 'Happy birthday dear (name)', 'Happy birthday to you'],
    },
  };

  const ORDER = ['abc', 'twinkle', 'mary', 'frere', 'bells'];     // SSAP's menu order (birthday is optional)

  // Place a song in a key: returns notes with start beat and MIDI pitch.
  function layout(song, tonicMidi) {
    let beat = 0;
    return song.melody.map(n => { const o = { midi: tonicMidi + n.n, beat, dur: n.d, syl: n.s }; beat += n.d; return o; });
  }
  function span(song) {
    const ns = song.melody.map(n => n.n);
    return { min: Math.min(...ns), max: Math.max(...ns) };
  }
  // choose a tonic so the melody sits in [low, high] (MIDI semitones, may be fractional)
  function chooseTonic(song, low, high) {
    const s = span(song), centre = (low + high) / 2;
    return Math.round(centre - (s.min + s.max) / 2);
  }
  function totalBeats(song) { return song.melody.reduce((a, n) => a + n.d, 0); }

  return { SONGS, ORDER, layout, span, chooseTonic, totalBeats };
});
