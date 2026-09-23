/*!
 * dialogue-timing.js — when each word arrives, and how long the line is left up.
 *
 * The lesson had two ways of pacing a line and neither was how people talk.
 * With a recording it used the clip's own word timestamps, which is right.
 * Without one it spread the words evenly across the reading time — every word
 * the same distance from the last, a metronome, so "Hmm… The sides look
 * suspiciously alike." arrived at the same rate through the pause after
 * "Hmm…" as through the middle of "suspiciously".
 *
 * This is the second mode, written to produce the SAME shape of answer as the
 * first: an array of millisecond offsets, one per word. Everything downstream
 * — the reveal, the bubble switching, the beat's length — already consumes
 * that, because the voice taught it to. So a line is paced by its own words
 * when there is no recording, and by the recording when there is, and nothing
 * else in the game has to know which.
 *
 *   Timing.cues(text)           -> [0, 150, 310, ...] one offset per word
 *   Timing.speakMs(text)        -> how long the whole line takes to arrive
 *   Timing.readingPause(text)   -> the beat after the last word
 *   Timing.FRAGMENT_GAP         -> between two halves of one thought
 */
(function (global) {
  'use strict';

  /* THE BASE PACE. Slower than a metronome needs to be, faster than speech:
     the words are read, not heard, and a child reading along wants them to
     keep arriving. */
  var WORD_MS = 150;

  /* Short function words are not read, they are taken in with the word beside
     them; giving them a full beat makes the line stutter. The long ones are
     the lesson's own vocabulary and are the words the child is here for, so
     they are given a moment to land. */
  var QUICK = { a: 1, an: 1, the: 1, to: 1, is: 1, it: 1, of: 1, and: 1,
                in: 1, on: 1, at: 1, or: 1, so: 1, we: 1, i: 1, am: 1 };
  var WEIGHTY = { diagonal: 1, diagonals: 1, polygon: 1, polygons: 1,
                  pentagon: 1, pentagons: 1, hexagon: 1, vertex: 1, vertices: 1,
                  convex: 1, concave: 1, regular: 1, irregular: 1,
                  'non-adjacent': 1, angles: 1, sides: 1, equal: 1 };

  /* A MARK IS A BREATH. These are added AFTER the word that carries the mark,
     so the pause falls where the speaker's would. */
  var AFTER = [
    [/…$/, 350],        // ellipsis — the longest think
    [/[?]$/, 280],
    [/[.!]$/, 220],
    [/[,;:]$/, 100]
  ];

  var clean = function (w) {
    return String(w).toLowerCase().replace(/[^a-z-]/g, '');
  };

  /** The gap owed BEFORE the next word, given the word just shown. */
  function gapAfter(word) {
    var w = clean(word);
    var ms = WORD_MS;
    if (QUICK[w]) ms -= 30;
    else if (WEIGHTY[w] || w.length >= 9) ms += 30;
    for (var i = 0; i < AFTER.length; i++) {
      if (AFTER[i][0].test(String(word))) { ms += AFTER[i][1]; break; }
    }
    return ms;
  }

  function words(text) {
    return String(text == null ? '' : text).trim().split(/\s+/).filter(Boolean);
  }

  /* THE PACE IS THE DIRECTOR'S TO SET.
   *
   * These numbers are the pace a child reads at, and that is right for a
   * child. It is not right for a harness playing all thirty-nine screens
   * against a clock: the director already has one knob for this — msPerWord —
   * and everything else in the game is timed off it, so a suite that turns it
   * down runs fast. This ignored it, so the whole lesson went back to full
   * speed and the playthrough ran out of its budget six screens from the end.
   *
   *  is that knob, as a fraction of the reading pace the lesson is
   * written at. One in the game; a fortieth in a suite; the shape of the
   * timing — which word waits, where the breath after a full stop goes — is
   * identical either way. */
  var WRITTEN_PACE = 300;            // the director's msPerWord in real play

  function scaleOf(msPerWord) {
    if (!msPerWord || msPerWord <= 0) return 1;
    return Math.min(1, msPerWord / WRITTEN_PACE);
  }

  /** One offset per word, the first at zero. */
  function cues(text, scale) {
    var k = scale == null ? 1 : scale;
    var ws = words(text), out = [], at = 0;
    for (var i = 0; i < ws.length; i++) {
      out.push(Math.round(at * k));
      at += gapAfter(ws[i]);
    }
    return out;
  }

  /** From the first word appearing to the last one having appeared. */
  function speakMs(text, scale) {
    var c = cues(text, scale);
    return c.length ? c[c.length - 1] : 0;
  }

  /* AFTER THE LAST WORD, BEFORE ANYTHING ELSE MOVES.
   *
   * A line is not read when its last word appears — that is the moment it
   * becomes readable. This is the beat the child gets to actually take it in,
   * and it is the only thing between the sentence finishing and whatever the
   * screen does next. Floored so a three-word line is not gone in a blink,
   * capped so a long one does not sit there after it has been understood. */
  function readingPause(text, scale) {
    var n = words(text).length;
    var ms = Math.min(2400, Math.max(900, 500 + n * 120));
    return Math.round(ms * (scale == null ? 1 : scale));
  }

  /* BETWEEN TWO HALVES OF ONE THOUGHT. "Polygons are closed shapes" and "made
     from straight lines." are one sentence shown in two bubbles; a full
     reading pause between them would break the sentence in half. Long enough
     to register as a new bubble, short enough to still be the same breath. */
  var FRAGMENT_GAP = 320;

  global.Timing = {
    cues: cues,
    speakMs: speakMs,
    readingPause: readingPause,
    words: words,
    FRAGMENT_GAP: FRAGMENT_GAP,
    scaleOf: scaleOf,
    WORD_MS: WORD_MS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.Timing;

})(typeof window !== 'undefined' ? window : this);
