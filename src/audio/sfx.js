/*!
 * sfx.js — every sound the game makes, synthesised.
 *
 * No audio files. Fourteen cues built from oscillators and shaped noise, so
 * the whole sound design ships in this file and stays loudness-matched by
 * construction: every cue is written against one peak target and routed
 * through the same bus, not mixed by ear per clip.
 *
 * Two buses under one master:
 *
 *   sfx    every cue below
 *   music  a loop, if one is ever wired
 *
 * duck() pulls both down and returns the release, so anything that needs the
 * foreground for a moment can take it without fighting a tick or a pop.
 *
 * Pitched cues are quantised to a key (SFX.key('C pentatonic')). Anything
 * that plays a note picks from that scale, so two cues landing together are
 * consonant instead of accidental.
 */
(function (global) {
  'use strict';

  var SCALES = {
    'C pentatonic':  [261.63, 293.66, 329.63, 392.00, 440.00],
    'C major':       [261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88],
    'A minor':       [220.00, 246.94, 261.63, 293.66, 329.63, 349.23, 392.00]
  };

  var ctx = null, master = null, buses = {}, comp = null;
  var scale = SCALES['C pentatonic'];
  var muted = false, volume = 0.85;
  var ducks = 0, noiseBuf = null;
  var unlocked = false;

  /* ------------------------------------------------------------------ *
   * Graph — built lazily so nothing is constructed before a gesture.
   * ------------------------------------------------------------------ */

  function AC() { return global.AudioContext || global.webkitAudioContext; }

  function build() {
    if (ctx || !AC()) return ctx;
    try { ctx = new (AC())(); } catch (e) { ctx = null; return null; }

    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;

    // A gentle limiter keeps a celebration stack from clipping a tablet
    // speaker. Optional: some engines in test harnesses have no compressor.
    if (ctx.createDynamicsCompressor) {
      try {
        comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -10; comp.knee.value = 20;
        comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.18;
        master.connect(comp); comp.connect(ctx.destination);
      } catch (e) { master.connect(ctx.destination); }
    } else {
      master.connect(ctx.destination);
    }

    ['sfx', 'music'].forEach(function (n) {
      var g = ctx.createGain();
      g.gain.value = n === 'music' ? 0.45 : 1;
      g.connect(master);
      buses[n] = g;
    });

    // One second of white noise, reused by every noise-based cue.
    try {
      noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate), ctx.sampleRate);
      var data = noiseBuf.getChannelData(0);
      for (var i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    } catch (e) { noiseBuf = null; }

    return ctx;
  }

  function now() { return ctx ? ctx.currentTime : 0; }

  /* ------------------------------------------------------------------ *
   * Voices
   * ------------------------------------------------------------------ */

  /** A shaped sine/triangle/square note. Returns the time it ends. */
  function tone(o) {
    if (!build()) return 0;
    var t = now() + (o.delay || 0);
    var dur = o.dur || 0.18;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.to != null) {
      if (o.glide === 'exp') osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t + dur);
      else osc.frequency.linearRampToValueAtTime(o.to, t + dur);
    }
    var peak = (o.gain == null ? 0.22 : o.gain);
    var atk = o.attack == null ? 0.006 : o.attack;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(bus(o.bus));
    osc.start(t); osc.stop(t + dur + 0.02);
    return t + dur;
  }

  /** Filtered noise — ticks, whooshes, slices, drum rolls. */
  function noise(o) {
    if (!build() || !noiseBuf) return 0;
    var t = now() + (o.delay || 0);
    var dur = o.dur || 0.12;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    if (o.rate) src.playbackRate.value = o.rate;
    var f = ctx.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.frequency.setValueAtTime(o.f || 1200, t);
    if (o.to != null) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + dur);
    f.Q.value = o.q == null ? 1 : o.q;
    var g = ctx.createGain();
    var peak = o.gain == null ? 0.18 : o.gain;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + (o.attack == null ? 0.004 : o.attack));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(bus(o.bus));
    src.start(t); src.stop(t + dur + 0.02);
    return t + dur;
  }

  function bus(name) { build(); return buses[name || 'sfx'] || master; }

  /** Degree `i` of the current key, `oct` octaves up. */
  function note(i, oct) {
    var n = scale.length;
    var wrapped = ((i % n) + n) % n;
    var extra = Math.floor(i / n);
    return scale[wrapped] * Math.pow(2, (oct || 0) + extra);
  }

  /* ------------------------------------------------------------------ *
   * The cues. Every one is written to the same peak target so nothing in
   * screens.js needs a per-call volume.
   * ------------------------------------------------------------------ */

  var CUES = {

    /** A single soft blip. The smallest confirmation in the game. */
    tick: function () {
      noise({ f: 2600, to: 1400, dur: 0.045, q: 3, gain: 0.10 });
      tone({ f: note(3, 1), dur: 0.06, type: 'sine', gain: 0.09 });
    },

    /** UI selection — a shape, a button, a bin. */
    select: function () {
      tone({ f: note(2, 0), to: note(4, 0), dur: 0.10, type: 'triangle', gain: 0.16, glide: 'exp' });
    },

    /** Something appeared. Short, round, no tail. */
    pop: function () {
      tone({ f: note(1, 0), to: note(4, 1), dur: 0.09, type: 'sine', gain: 0.22, glide: 'exp' });
      noise({ f: 1800, to: 600, dur: 0.05, q: 2, gain: 0.07 });
    },

    /** Right answer. Rising third, warm. */
    correct: function () {
      tone({ f: note(0, 1), dur: 0.13, type: 'triangle', gain: 0.20 });
      tone({ f: note(2, 1), dur: 0.16, type: 'triangle', gain: 0.20, delay: 0.09 });
      tone({ f: note(4, 1), dur: 0.26, type: 'sine', gain: 0.17, delay: 0.18 });
    },

    /**
     * Wrong answer. Deliberately not a buzzer: the brief wants retry, not
     * punishment. Two soft descending notes and a little air — reads as
     * "not that one" rather than "you failed".
     */
    wrong: function () {
      tone({ f: note(2, 0), dur: 0.12, type: 'triangle', gain: 0.15 });
      tone({ f: note(0, 0), dur: 0.22, type: 'triangle', gain: 0.15, delay: 0.10 });
      noise({ f: 500, to: 260, dur: 0.16, q: 1.2, gain: 0.05, delay: 0.02 });
    },

    /** Comic bounce for a refused drop. */
    boing: function () {
      tone({ f: 520, to: 150, dur: 0.26, type: 'sine', gain: 0.20, glide: 'exp' });
      tone({ f: 300, to: 110, dur: 0.30, type: 'triangle', gain: 0.10, delay: 0.05, glide: 'exp' });
    },

    /** Cartoon horn. Used sparingly; it is the loudest thing here. */
    honk: function () {
      tone({ f: 340, dur: 0.16, type: 'square', gain: 0.11 });
      tone({ f: 255, dur: 0.20, type: 'square', gain: 0.10, delay: 0.12 });
    },

    /** Level or unit complete. The only cue with a real tail. */
    levelUp: function () {
      [0, 2, 4, 5].forEach(function (d, i) {
        tone({ f: note(d, 1), dur: 0.3, type: 'triangle', gain: 0.18, delay: i * 0.085 });
      });
      tone({ f: note(0, 2), dur: 0.7, type: 'sine', gain: 0.13, delay: 0.34 });
    },

    /** Glittery reward dust. Five random degrees, high. */
    sparkle: function () {
      for (var i = 0; i < 6; i++) {
        tone({
          f: note(Math.floor(Math.random() * 5), 2),
          dur: 0.18, type: 'sine', gain: 0.09, delay: i * 0.045 + Math.random() * 0.02
        });
      }
    },

    /**
     * Sleigh bells. A handful of small bells struck at slightly different
     * moments, which is what a shake is — hitting them together makes a
     * chord, and a chord is a bell, not a harness.
     *
     * `n` and `spread` let the arrival ring it harder as the sleigh gets
     * closer without it becoming a different sound.
     */
    sleighBells: function (o) {
      var n = o.n || 7, spread = o.spread == null ? 0.05 : o.spread;
      var gain = o.gain == null ? 0.07 : o.gain;
      for (var i = 0; i < n; i++) {
        var t = i * spread + Math.random() * spread * 0.6;
        // two partials per bell: the strike and the ring above it
        tone({ f: note(3 + (Math.random() * 3 | 0), 3), dur: 0.5, type: 'triangle', gain: gain, delay: t });
        tone({ f: note(1 + (Math.random() * 4 | 0), 4), dur: 0.34, type: 'sine', gain: gain * 0.55, delay: t + 0.008 });
      }
    },

    /**
     * One hoof on packed snow: a low thud with the crunch on top. Called
     * repeatedly by the arrival rather than looped, so the gait can slow as
     * the sleigh pulls up.
     */
    hoofbeat: function (o) {
      var g = o.gain == null ? 0.09 : o.gain, d = o.delay || 0;
      tone({ f: 92, to: 54, dur: 0.11, type: 'sine', gain: g, delay: d });
      noise({ f: 1600, to: 700, dur: 0.07, q: 1.1, filter: 'bandpass', gain: g * 0.5, delay: d });
    },

    /** Transition whoosh, screen to screen. */
    menuWhoosh: function () {
      noise({ f: 400, to: 3000, dur: 0.26, q: 0.8, filter: 'bandpass', gain: 0.13 });
    },

    /** A line being drawn — the diagonal cue. */
    slice: function () {
      noise({ f: 3400, to: 900, dur: 0.15, q: 2.5, gain: 0.12 });
      tone({ f: note(4, 1), to: note(1, 1), dur: 0.13, type: 'sine', gain: 0.07, glide: 'exp' });
    },

    /** Something moved a long way, comically. */
    slideWhistle: function () {
      tone({ f: 400, to: 1500, dur: 0.42, type: 'sine', gain: 0.14, glide: 'exp' });
    },

    /** Fast travel — a vertex snapping, an item flying home. */
    zip: function () {
      noise({ f: 900, to: 4200, dur: 0.12, q: 1.6, gain: 0.10 });
      tone({ f: note(0, 1), to: note(4, 2), dur: 0.11, type: 'sine', gain: 0.08, glide: 'exp' });
    },

    /** Anticipation before the finale. */
    drumroll: function () {
      for (var i = 0; i < 26; i++) {
        noise({ f: 180 + Math.random() * 90, dur: 0.05, q: 1.1, filter: 'lowpass',
                gain: 0.05 + i * 0.0035, delay: i * 0.045 });
      }
    }
  };

  /* ------------------------------------------------------------------ *
   * Public surface
   * ------------------------------------------------------------------ */

  function play(name, opts) {
    if (muted || !name) return false;
    var cue = CUES[name];
    if (!cue) { if (global.console) console.warn('SFX: no cue "' + name + '"'); return false; }
    if (!build()) return false;
    resume();
    try { cue(opts || {}); } catch (e) { if (global.console) console.warn('SFX: cue "' + name + '" failed', e); }
    return true;
  }

  /**
   * Play cues in order. Numbers in the list are gaps in seconds:
   *   SFX.sequence(['drumroll', 1.2, 'levelUp', 0.3, 'sparkle'])
   */
  function sequence(list) {
    var delay = 0;
    (list || []).forEach(function (item) {
      if (typeof item === 'number') { delay += item * 1000; return; }
      setTimeout(function () { play(item); }, delay);
    });
    return delay;
  }

  function resume() {
    if (ctx && ctx.state === 'suspended' && ctx.resume) { try { ctx.resume(); } catch (e) {} }
  }

  /**
   * Pull effects and music down for a moment. Returns the release; call it
   * when whatever needed the foreground is done. Nested ducks are counted,
   * so two overlapping holds do not restore the level early.
   */
  function duck(amount) {
    if (!build()) return function () {};
    var target = amount == null ? 0.28 : amount;
    ducks++;
    ramp(buses.sfx.gain, target, 0.12);
    ramp(buses.music.gain, target * 0.6, 0.12);
    var released = false;
    return function () {
      if (released) return; released = true;
      ducks = Math.max(0, ducks - 1);
      if (ducks === 0) { ramp(buses.sfx.gain, 1, 0.3); ramp(buses.music.gain, 0.45, 0.3); }
    };
  }

  function ramp(param, to, secs) {
    if (!param || !ctx) return;
    try {
      param.cancelScheduledValues(now());
      param.setValueAtTime(param.value, now());
      param.linearRampToValueAtTime(to, now() + secs);
    } catch (e) { param.value = to; }
  }

  function applyMaster() {
    if (!master) return;
    ramp(master.gain, muted ? 0 : volume, 0.08);
  }

  var SFX = {
    /** Cue by name. Unknown names warn and return false; they never throw. */
    play: play,
    sequence: sequence,

    /** Call once from a real user gesture, before anything plays. */
    unlock: function () {
      build(); resume(); unlocked = true;
      // A silent blip completes the unlock on iOS.
      if (ctx) { try { tone({ f: 440, dur: 0.01, gain: 0.0001 }); } catch (e) {} }
      return unlocked;
    },

    /** Toggle, or set explicitly. Returns the resulting muted state. */
    mute: function (force) {
      muted = force == null ? !muted : !!force;
      applyMaster();
      return muted;
    },
    isMuted: function () { return muted; },

    volume: function (v) {
      if (v != null) { volume = Math.max(0, Math.min(1, v)); applyMaster(); }
      return volume;
    },

    /** Set the key every pitched cue quantises to. */
    key: function (name) {
      if (SCALES[name]) scale = SCALES[name];
      else if (Array.isArray(name)) scale = name.slice();
      return scale;
    },
    keys: Object.keys(SCALES),

    duck: duck,

    /** Bus nodes, for anything that wants to route its own audio. */
    musicBus: function () { build(); return buses.music || null; },
    sfxBus: function () { build(); return buses.sfx || null; },
    context: function () { return build(); },

    /** Persistence — game.js owns the storage key, not this module. */
    state: function () { return { muted: muted, volume: volume }; },
    restore: function (s) {
      if (!s) return;
      if (typeof s.muted === 'boolean') muted = s.muted;
      if (typeof s.volume === 'number') volume = Math.max(0, Math.min(1, s.volume));
      applyMaster();
    },

    cues: Object.keys(CUES)
  };

  global.SFX = SFX;
  if (typeof module !== 'undefined' && module.exports) module.exports = SFX;

})(typeof window !== 'undefined' ? window : this);
