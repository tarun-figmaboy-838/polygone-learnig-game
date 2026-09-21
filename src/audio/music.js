/*!
 * music.js — the tune under the lesson.
 *
 * SYNTHESISED, NOT A FILE. Everything this game makes a noise with is built
 * from oscillators (sfx.js), and the music is too: a few hundred bytes of
 * code rather than a megabyte of loop that would have to be licensed, cached
 * and downloaded before a child could play. It also means the tune can bend
 * to the lesson — brighter on a win, out of the way while Swiftee talks —
 * which a recording cannot do.
 *
 * WHAT IT SOUNDS LIKE. A bouncing marimba figure over a soft bass pulse, in
 * F major, at a walking 96 beats a minute: the pace of a picture book being
 * read aloud, not of a chase. Two bars repeat, and every fourth time round a
 * bell sprinkles the top of the bar, so it does not become wallpaper. It is
 * quiet — a quarter the level of the effects — because it is the floor of
 * the scene and never the thing being listened to.
 *
 *   Music.start()          begin, if it is not already going
 *   Music.stop()           stop and forget the timer
 *   Music.mood('win')      'play' (default), 'win', 'think'
 *   Music.level(0.8)       scale the whole thing, 0..1
 *
 * It rides the music bus (SFX.musicBus()), so muting the game mutes it and
 * SFX.duck() pulls it down under anything that needs the foreground.
 */
(function (global) {
  'use strict';

  var BPM = 96;
  var BEAT = 60 / BPM;              // seconds
  var BAR = BEAT * 4;
  var LOOK = 0.9;                   // how far ahead notes are scheduled

  // F major, one octave and a bit. The tune is written as scale degrees so a
  // change of key is one line, not thirty numbers.
  var ROOT = 174.61;                // F3
  var STEP = [0, 2, 4, 5, 7, 9, 11];
  function hz(deg, oct) {
    var d = ((deg % 7) + 7) % 7, o = (oct || 0) + Math.floor(deg / 7);
    return ROOT * Math.pow(2, (STEP[d] + o * 12) / 12);
  }

  // the two-bar figure: [degree, beat, length]. It steps up, hops down and
  // lands — the shape of somebody skipping.
  var FIGURE = [
    [0, 0.0, 0.5], [2, 0.5, 0.5], [4, 1.0, 0.5], [2, 1.5, 0.5],
    [5, 2.0, 0.75], [4, 2.75, 0.25], [2, 3.0, 0.5], [0, 3.5, 0.5],
    [4, 4.0, 0.5], [6, 4.5, 0.5], [7, 5.0, 0.75], [6, 5.75, 0.25],
    [4, 6.0, 0.5], [2, 6.5, 0.5], [0, 7.0, 1.0]
  ];
  var BASS = [[0, 0, 1], [0, 2, 1], [3, 4, 1], [4, 6, 1]];

  var ctx = null, out = null, timer = null, nextAt = 0, bar = 0;
  var mood = 'play', level = 1, running = false;

  function gainFor() {
    return (mood === 'win' ? 0.30 : mood === 'think' ? 0.14 : 0.20) * level;
  }

  function ping(at, f, len, kind, vol) {
    if (!ctx || !out) return;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = kind || 'triangle';
    o.frequency.setValueAtTime(f, at);
    // a plucked shape: straight up, then a long soft tail, which is what
    // makes a triangle wave read as a marimba rather than as a beep
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(0.08, len));
    o.connect(g); g.connect(out);
    o.start(at); o.stop(at + Math.max(0.1, len) + 0.05);
  }

  function schedule() {
    if (!running || !ctx) return;
    var now = ctx.currentTime;
    while (nextAt < now + LOOK) {
      var t0 = nextAt, v = gainFor();
      FIGURE.forEach(function (n) {
        ping(t0 + n[1] * BEAT, hz(n[0], 1), n[2] * BEAT * 0.9, 'triangle', v * 0.5);
      });
      BASS.forEach(function (n) {
        ping(t0 + n[1] * BEAT, hz(n[0], 0), n[2] * BEAT * 0.9, 'sine', v * 0.7);
      });
      // every fourth time round, a little bell over the top of the bar
      if (bar % 4 === 3) {
        [[7, 0.25], [9, 0.75], [11, 1.25]].forEach(function (s) {
          ping(t0 + s[1] * BEAT, hz(s[0], 1), BEAT * 0.5, 'sine', v * 0.28);
        });
      }
      bar++;
      nextAt += BAR * 2;            // the figure is two bars long
    }
    timer = setTimeout(schedule, 400);
  }

  function start() {
    if (running) return;
    if (!global.SFX || !SFX.musicBus) return;
    out = SFX.musicBus();
    ctx = SFX.context && SFX.context();
    if (!out || !ctx) { out = null; return; }
    running = true;
    nextAt = ctx.currentTime + 0.12;
    schedule();
  }

  function stop() {
    running = false;
    if (timer) { clearTimeout(timer); timer = null; }
  }

  global.Music = {
    start: start,
    stop: stop,
    /** 'play' under the lesson, 'win' for a celebration, 'think' while working. */
    mood: function (m) { if (m) mood = m; return mood; },
    level: function (v) { if (v != null) level = Math.max(0, Math.min(1, v)); return level; },
    get playing() { return running; }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.Music;
})(typeof window !== 'undefined' ? window : this);
