/*!
 * dual-coding.js — the same idea through two channels at once.
 *
 * Dual coding theory (Paivio) and the multimedia principle that follows from
 * it: a learner builds a stronger, more retrievable memory when an idea
 * arrives verbally AND pictorially, and when the two are bound to each other
 * rather than merely co-present.
 *
 * The lesson already had both channels and no binding. Swiftee says
 * "diagonal"; a white dashed line appears somewhere on a shape; nothing
 * tells a seven-year-old that the word and the line are the same thing. The
 * child has to guess the mapping, and guessing the mapping is the cognitive
 * work that dual coding is supposed to remove.
 *
 * So this module adds three bindings, and not one new word of copy — the
 * brief forbids inventing instructional text, and every term below is
 * already spoken in the deck:
 *
 *   1. TERM CHIPS      A key term in the speech bubble is tinted its own
 *                      colour — the same colour the thing it names is about
 *                      to be haloed in on the stage. The bubble holds words
 *                      only; the picture half of the pair is the lesson
 *                      itself, which is the better half to point at.
 *
 *   2. STAGE HALO      At the same instant, the thing the term names is
 *                      haloed on the stage in that same colour. Colour is
 *                      the binding: same hue, same moment, same referent.
 *                      This is the contiguity principle — the label and the
 *                      picture must coincide in space and time, or the
 *                      learner pays a search cost that cancels the benefit.
 *
 *   3. GESTURE GLYPH   The instruction card is words only: "Drag the vertex
                      inward".
 *                      beside the words, so the action is coded twice too.
 *
 * Everything here is additive and fails soft. If Stage is not mounted, if
 * the term is not on screen, if animation is off — the words still show and
 * the lesson is unchanged.
 *
 *   DualCode.markup(text)        -> HTML for the bubble, terms chipped
 *   DualCode.cue(text)           -> halo whatever those terms name, on stage
 *   DualCode.taught()            -> the terms encountered so far
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * The registry.
   *
   * `color` is the binding hue and is deliberately near what the stage
   * already paints: vertices highlight amber, diagonals draw yellow, and the
   * four category words carry the category palette. `target` is a reference
   * stage.js's own `targets()` already understands, so nothing here needs
   * to know how a polygon is drawn.
   * ------------------------------------------------------------------ */

  // `mode` is how the stage marks the referent: 'ring' draws a ring round a
  // thing with an area, 'trace' re-draws a set of lines in the term's colour.
  // A ring round the diagonals of a pentagon is a ring round the pentagon,
  // which points at the wrong noun.
  var TERMS = {
    polygon:   { color: '#1030c8', tint: '#e3e9ff', target: 'polygon',          mode: 'none' },
    // Amber on cream is the one pairing in this table that does not survive
    // the arithmetic: at #c47800 this read 3.14:1 against its own chip, well
    // under the 4.5:1 floor for body text, and 3.29:1 against the bubble's
    // paper. Darkened to 6.0:1. The hue is what binds the word to the halo on
    // stage, so it stays amber — it only stops being pale.
    vertex:    { color: '#8a5200', tint: '#fff2d6', target: 'polygon.vertices', mode: 'ring' },
    // 'none': the word "side" used to trace every side of the shape at once,
    // which lit the whole outline for a moment and said nothing about the
    // one side being shown. The highlighted segment is the lesson's own mark.
    side:      { color: '#0b7a5e', tint: '#d8f5ec', target: 'polygon.sides',    mode: 'none' },
    // Same problem, 4.03:1, and it has to stay distinct from vertex as well as
    // legible — so this one goes redder rather than browner. 7.2:1.
    diagonal:  { color: '#8a3d00', tint: '#fff4cc', target: 'polygon.diagonals', mode: 'trace' },
    angle:     { color: '#1d7a2e', tint: '#ddf6e1', target: 'polygon.vertices', mode: 'ring' },
    // THE FOUR CATEGORY WORDS TAKE THE CATEGORY PALETTE.
    //
    // These are the same four concepts the bins, the drop zones, the badges
    // and the option buttons are drawn in (see CONCEPT in stage.js), and the
    // whole point of colouring a word is that the word and the thing agree.
    // While convex was green here and cyan on the bin, the sentence "sort
    // these as convex or concave" was printed in one pair of colours directly
    // above a pair of bins in another — two colour schemes for one idea, on
    // one screen. These are the deep/wash values of the same four concepts.
    convex:    { color: '#0f6f86', tint: '#e4f8fc', target: 'polygon',          mode: 'none' },
    concave:   { color: '#95590a', tint: '#fff3dd', target: 'polygon',          mode: 'none' },
    regular:   { color: '#0a6c60', tint: '#e3f8f4', target: 'polygon',          mode: 'none' },
    irregular: { color: '#54399e', tint: '#f1ebfe', target: 'polygon',          mode: 'none' }
  };



  /** Surface forms the deck actually uses, longest first so that
   *  "irregular" is never matched as "regular" with a stray prefix. */
  var FORMS = [
    ['irregular', 'irregular'],
    ['polygons', 'polygon'], ['polygon', 'polygon'],
    ['vertices', 'vertex'], ['vertex', 'vertex'],
    ['diagonals', 'diagonal'], ['diagonal', 'diagonal'],
    ['sides', 'side'], ['side', 'side'],
    ['angles', 'angle'], ['angle', 'angle'],
    ['convex', 'convex'], ['concave', 'concave'],
    ['regular', 'regular']
  ];

  /* THE WORD'S OWN INK. The child reads the sentence on cream wood or a
     white bubble, and a warm orange is the one thing on either that is not
     blue or white: the parts of a shape in deep amber, the kinds of shape in
     orange. The stage's halo keeps each concept's own colour (TERMS.color);
     only the lettering changes. */
  var INK = { vertex: '#d98a00', side: '#d98a00', diagonal: '#d98a00', angle: '#d98a00',
              polygon: '#e8590c', convex: '#e8590c', concave: '#e8590c', regular: '#e8590c', irregular: '#e8590c' };

  var RE = new RegExp('\\b(' + FORMS.map(function (f) { return f[0]; }).join('|') + ')\\b', 'gi');
  var LOOKUP = {};
  FORMS.forEach(function (f) { LOOKUP[f[0]] = f[1]; });

  var seen = {};                 // terms encountered so far, in order

  /* ------------------------------------------------------------------ *
   * Verbal channel — the bubble
   * ------------------------------------------------------------------ */

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }



  /**
   * Wrap every key term in a chip carrying its own miniature. The chip is
   * inline, so the sentence still reads as a sentence — the picture is
   * *inside* the words rather than in a legend somewhere else, which is the
   * whole point.
   */
  function markup(text) {
    if (!text) return '';
    var out = '', last = 0, m;
    RE.lastIndex = 0;
    while ((m = RE.exec(text)) !== null) {
      var term = LOOKUP[m[1].toLowerCase()];
      var def = TERMS[term];
      if (!def) continue;
      out += esc(text.slice(last, m.index));
      // The word only. The chip used to carry a miniature diagram of itself,
      // which put a picture inside every sentence the child had to read. The
      // colour still does the binding on its own: the term is tinted, and the
      // thing it names lights up on the stage in that same colour as the word
      // appears. Same pairing, one less thing in the text.
      var chip = '<span class="dc-term" data-term="' + term + '" style="color:' + (INK[term] || '#e8590c') +
                 '">' + esc(m[0]) + '</span>';
      last = m.index + m[0].length;

      // PUNCTUATION NEVER LEAVES THE WORD IT BELONGS TO.
      //
      // A chip is an inline-block, so the line is allowed to break straight
      // after it — and the question mark in "Which of these are polygons?"
      // is a separate word span, because it arrives after the chip has
      // already been closed. So it could wrap onto a line of its own: a
      // sentence ending in a lone "?" two rows down. After an ordinary word
      // this cannot happen, since word and punctuation are one whitespace-
      // delimited token; it is only ever the chips.
      //
      // Wrapping the pair in a nowrap span fixes the break, and the negative
      // margin inside it closes the gap the chip's own right padding opens —
      // which is why it read as "polygons ?" with a space in front of the
      // mark. The margin is scoped to this wrapper, so ordinary words after a
      // chip keep their normal spacing.
      var tail = /^[.,!?;:%)\]]+/.exec(text.slice(last));
      if (tail) {
        out += '<span class="dc-keep">' + chip + esc(tail[0]) + '</span>';
        last += tail[0].length;
      } else {
        out += chip;
      }
    }
    out += esc(text.slice(last));
    return out;
  }

  /** Which terms a line mentions, de-duplicated, in order of appearance. */
  function termsIn(text) {
    var found = [], m;
    RE.lastIndex = 0;
    while ((m = RE.exec(text || '')) !== null) {
      var term = LOOKUP[m[1].toLowerCase()];
      if (term && found.indexOf(term) < 0) found.push(term);
    }
    return found;
  }

  /* ------------------------------------------------------------------ *
   * Pictorial channel — the stage
   * ------------------------------------------------------------------ */

  /**
   * Halo whatever the terms name, in the terms' own colours, now. The word
   * lights up amber in the bubble and the vertices light up amber on the
   * stage in the same beat: that co-occurrence is the binding the learner
   * actually encodes.
   *
   * Staggered when a line names more than one term, because two halos at
   * once is two things to look at and the sentence only says one at a time.
   */
  function cue(text) {
    if (!global.Stage || !Stage.halo) return [];
    var terms = termsIn(text);
    terms.forEach(function (term, i) {
      var def = TERMS[term];
      seen[term] = true;
      setTimeout(function () {
        try { Stage.halo(def.target, def.color, def.mode); } catch (e) {}
      }, i * 520);
    });
    return terms;
  }

  function cueTerm(term) {
    var def = TERMS[term];
    if (!def || !global.Stage || !Stage.halo) return false;
    seen[term] = true;
    try { Stage.halo(def.target, def.color, def.mode); } catch (e) {}
    return true;
  }

  global.DualCode = {
    markup: markup,
    cue: cue,
    cueTerm: cueTerm,
    termsIn: termsIn,
    taught: function () { return Object.keys(seen); },
    reset: function () { seen = {}; },
    TERMS: TERMS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.DualCode;

})(typeof window !== 'undefined' ? window : this);
