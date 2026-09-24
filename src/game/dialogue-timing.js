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
 *   Timing.cues(text)                 -> [0, 150, 310, ...] one offset per word
 *   Timing.speakMs(text)              -> how long the whole line takes to arrive
 *   Timing.readingPause(text)         -> the beat after the last word of a line that is read
 *   Timing.interactionDelay(text)     -> the beat after the last word of a line that asks for something
 *   Timing.lineType(beats, i)         -> 'narration' | 'action' | 'question' | 'question-ready'
 *   Timing.schedule(parts, opts)      -> when every bubble of a line goes up, and when the line is done
 */
(function (global) {
  'use strict';

  /* THE BASE PACE: A CALM READ-ALOUD, not a ripple. 55ms between words
     (the polish pass's figure) put a whole sentence up in half a second, and
     the user's verdict was plain: "text animation look very fast user cant
     read — make animation slow and decent". A seven-year-old reads along at
     speaking pace, so the words arrive at about that: ~280ms apart, the small
     words a little quicker, the lesson's own words a little slower, and a
     real breath at every comma and full stop (AFTER, below). A recording,
     when there is one, paces the words by its own timestamps instead. */
  var WORD_MS = 280;

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
    [/(…|\.\.\.)["”’)]*$/, 600],   // ellipsis — the longest think
    [/[?]["”’)]*$/, 480],
    [/[.!]["”’)]*$/, 420],
    [/[,;:]["”’)]*$/, 220]
  ];

  var clean = function (w) {
    return String(w).toLowerCase().replace(/[^a-z-]/g, '');
  };

  /** The gap owed BEFORE the next word, given the word just shown. */
  function gapAfter(word) {
    var w = clean(word);
    var ms = WORD_MS;
    if (QUICK[w]) ms -= 70;
    else if (WEIGHTY[w] || w.length >= 9) ms += 90;
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
   * child. It is not right for a harness playing all thirty-four screens
   * against a clock: the director already has one knob for this — msPerWord —
   * and everything else in the game is timed off it, so a suite that turns it
   * down runs fast. The scale is that knob, as a fraction of the reading pace
   * the lesson is written at: one in the game, a fortieth in a suite, and the
   * shape of the timing — which word waits, where the breath after a full stop
   * goes — identical either way. */
  var WRITTEN_PACE = 300;            // the director's msPerWord in real play

  function scaleOf(msPerWord) {
    if (!msPerWord || msPerWord <= 0) return 1;
    return Math.min(1, msPerWord / WRITTEN_PACE);
  }

  /** One offset per word, the first at zero. `breaks`: word indices the
      script breaks a sentence after ("The sides look" / "suspiciously
      alike.") — a short breath there, inside the one bubble. */
  function cues(text, scale, breaks) {
    var k = scale == null ? 1 : scale;
    var ws = words(text), out = [], at = 0;
    for (var i = 0; i < ws.length; i++) {
      out.push(Math.round(at * k));
      at += gapAfter(ws[i]);
      if (breaks && breaks.indexOf(i) >= 0 && !/[.!?…,;:]["”’)]*$/.test(ws[i])) at += FRAGMENT_GAP;
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
    // time to read it again after the last word: a child reads slower than
    // the words arrive, so the line waits for them (floor 1.5s, cap 3.6s)
    var ms = Math.min(3600, Math.max(1500, 900 + n * 200));
    return Math.round(ms * (scale == null ? 1 : scale));
  }

  /* A LINE THAT ASKS FOR SOMETHING IS NOT LEFT TO BE READ — IT IS OBEYED.
   *
   * "Pick any vertex." is understood the instant its last word lands, and a
   * child who has understood it and is not allowed to act is a child being
   * made to wait for the animation. So the gap between the last word of an
   * instruction and the moment the thing it names becomes touchable is short:
   * three to six hundred milliseconds for a short one, six hundred to a second
   * for a long one — enough that no finger already moving lands on a target
   * that was not there a moment ago, never so long that the child is waiting
   * on the game. The instruction stays up afterwards; this only decides when
   * the hands may start. */
  function interactionDelay(text, scale) {
    var n = words(text).length;
    var ms = n <= 6 ? Math.min(600, Math.max(300, 240 + n * 60))
                    : Math.min(1000, Math.max(600, 360 + n * 45));
    return Math.round(ms * (scale == null ? 1 : scale));
  }

  /* BETWEEN TWO HALVES OF ONE THOUGHT. "Polygons are closed shapes" and "made
     from straight lines." are one sentence shown in two bubbles; a full
     reading pause between them would break the sentence in half. Long enough
     to register as a new bubble, short enough to still be the same breath.
     A fragment that ENDS a sentence ("Your turn!", "suspiciously alike.") is
     a finished thought and gets the reading pause instead: it is going to be
     taken away, and it has to have been read first. */
  var FRAGMENT_GAP = 450;
  function endsSentence(text) { return /[.!?…]["”’)]*\s*$/.test(String(text || '')); }

  /* THE BUBBLE'S OWN MOTION, which the words have to wait for.
   *
   * A line's box comes in first — a soft pop, 94% to 102% and settle, over
   * PANEL_MS — and the first word follows PANEL_LEAD into that, so the reader
   * sees the panel arrive and then the words begin, rather than everything at
   * once. Between two bubbles of one line the old one lifts away over
   * SWAP_OUT, the next pops in over SWAP_IN, and its first word lands
   * SWAP_LEAD after the change began. These are CSS durations (see #bubble in
   * index.html) and are scaled with the pace only so a harness is not held
   * up by them. */
  var PANEL_MS = 220, PANEL_LEAD = 120, SWAP_OUT = 170, SWAP_IN = 220, SWAP_LEAD = 270;

  /* WHAT KIND OF LINE THIS IS, read off what the screen does after it.
   *
   *   narration       nothing is asked of the child next — another line
   *                   follows, or the Next button, or a new scene. Read, then
   *                   go on: the full reading pause.
   *   action          the next thing is an interaction ("Pick any vertex.").
   *                   The line stays up and the hands are let in after the
   *                   short interaction delay.
   *   question        a choice is asked and its answers are still to come
   *                   ("Are they inside or outside?" before the buttons rise):
   *                   the reading pause, then the answers.
   *   question-ready  a choice whose answers are already on the screen ("Which
   *                   of these are polygons?" over the grid): the child can
   *                   answer as soon as it is read, so the short delay.
   *
   * An instruction that only repeats the words just said — the script's own
   * "Draw all the diagonals / from this vertex." followed by the card's "Draw
   * all the diagonals from this vertex." — is looked through: it settles the
   * line into one piece, it is not another line to read. */
  function norm(t) {
    return String(t || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  /** Does `instruction` only repeat the end of `line`? */
  function repeats(instruction, line) {
    var a = norm(instruction), b = norm(line);
    if (!a || !b) return false;
    return b === a || (b.length > a.length && b.slice(b.length - a.length) === a && b.charAt(b.length - a.length - 1) === ' ');
  }
  function lineText(b) {
    if (!b || typeof b !== 'object') return null;
    if (typeof b.say === 'string') return b.say;
    if (typeof b.instruction === 'string') return b.instruction;
    return null;
  }
  function lineType(beats, i) {
    var list = beats || [];
    // A RECAP LINE is said, held for a short breath and moved on from: the
    // end-game summary has eight of them, and each is a reminder of a thing
    // already learned, not a new thing to take in (finalPause 'recap').
    if (list[i] && list[i].pace === 'recap') return 'recap';
    var own = lineText(list[i]);
    var answersToCome = false;
    for (var k = i + 1; k < list.length; k++) {
      var b = list[k];
      if (!b || typeof b !== 'object') continue;                // a bare number is a wait
      var said = lineText(b);
      if (said != null) {
        if (b.instruction != null && own && repeats(said, own)) continue;   // a settle, not a new line
        return 'narration';
      }
      if (b.instruction === null) continue;                      // clearing the card is not a line
      if (b.stage && b.stage.choices && b.stage.choices.length) { answersToCome = true; continue; }
      if (b.stage && b.stage.kind) return 'narration';           // a new scene arrives first
      if (b.input) {
        var t = b.input.type;
        if (t === 'tap-anywhere') return 'narration';
        if (t === 'choice' || t === 'multi-select' || t === 'swipe') return answersToCome ? 'question' : 'question-ready';
        return 'action';
      }
      if (b.branch != null || b.feedback != null) return 'narration';
    }
    return 'narration';
  }

  /** The beat after the last word, for a line of this kind. */
  var RECAP_PAUSE = 550;   // the summary's reading pause: 0.4–0.7s, then the card moves on
  function finalPause(type, text, scale) {
    if (type === 'recap') return Math.round(RECAP_PAUSE * (scale == null ? 1 : scale));
    return (type === 'action' || type === 'question-ready') ? interactionDelay(text, scale) : readingPause(text, scale);
  }

  /* THE WHOLE LINE, LAID OUT IN TIME.
   *
   * One entry per bubble: when it is put up (`at`, from the moment the line
   * starts), how long after that its first word lands (`lead` — the panel
   * coming in, or the old bubble lifting away), its words' own offsets
   * (`cues`, from its first word), and how long it holds once its last word
   * is in (`hold`). `lastWord` is when the final word of the line lands and
   * `total` is when the line is done with — the kind-of-line pause after it.
   *
   * opts: { scale, type, showing }  — `showing` when a bubble is already up,
   * so the first part is a change of bubble rather than an arrival. */
  function schedule(parts, opts) {
    opts = opts || {};
    var k = opts.scale == null ? 1 : opts.scale;
    // a part is a string, or { text, breaks } (a whole sentence with the
    // script's own fragment breaks inside it)
    var list = (parts || []).map(function (p) { return typeof p === 'string' ? { text: p, breaks: null } : p; })
                            .filter(function (p) { return p && String(p.text || '').trim(); });
    var out = [], at = 0, lastWord = 0;
    for (var i = 0; i < list.length; i++) {
      var lead = Math.round((i === 0 && !opts.showing ? PANEL_LEAD : SWAP_LEAD) * k);
      var c = cues(list[i].text, k, list[i].breaks);
      var first = at + lead;
      lastWord = first + (c.length ? c[c.length - 1] : 0);
      var hold = i + 1 < list.length
        ? (endsSentence(list[i].text) ? readingPause(list[i].text, k) : Math.round(FRAGMENT_GAP * k))
        : finalPause(opts.type || 'narration', list[i].text, k);
      out.push({ text: list[i].text, at: at, lead: lead, cues: c, hold: hold });
      at = lastWord + hold;
    }
    return { parts: out, lastWord: lastWord, total: at };
  }

  global.Timing = {
    cues: cues,
    speakMs: speakMs,
    readingPause: readingPause,
    interactionDelay: interactionDelay,
    finalPause: finalPause,
    lineType: lineType,
    repeats: repeats,
    endsSentence: endsSentence,
    schedule: schedule,
    words: words,
    FRAGMENT_GAP: FRAGMENT_GAP,
    PANEL_MS: PANEL_MS, PANEL_LEAD: PANEL_LEAD, SWAP_OUT: SWAP_OUT, SWAP_IN: SWAP_IN, SWAP_LEAD: SWAP_LEAD,
    scaleOf: scaleOf,
    WORD_MS: WORD_MS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.Timing;

})(typeof window !== 'undefined' ? window : this);
