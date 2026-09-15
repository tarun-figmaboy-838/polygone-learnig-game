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
   * already paints: vertices highlight amber, diagonals draw yellow, convex
   * badges are green, concave badges pink. `target` is a reference
   * stage.js's own `targets()` already understands, so nothing here needs
   * to know how a polygon is drawn.
   * ------------------------------------------------------------------ */

  // `mode` is how the stage marks the referent: 'ring' draws a ring round a
  // thing with an area, 'trace' re-draws a set of lines in the term's colour.
  // A ring round the diagonals of a pentagon is a ring round the pentagon,
  // which points at the wrong noun.
  var TERMS = {
    polygon:   { color: '#1030c8', tint: '#e3e9ff', target: 'polygon',          mode: 'ring' },
    // Amber on cream is the one pairing in this table that does not survive
    // the arithmetic: at #c47800 this read 3.14:1 against its own chip, well
    // under the 4.5:1 floor for body text, and 3.29:1 against the bubble's
    // paper. Darkened to 6.0:1. The hue is what binds the word to the halo on
    // stage, so it stays amber — it only stops being pale.
    vertex:    { color: '#8a5200', tint: '#fff2d6', target: 'polygon.vertices', mode: 'ring' },
    side:      { color: '#0b7a5e', tint: '#d8f5ec', target: 'polygon.sides',    mode: 'trace' },
    // Same problem, 4.03:1, and it has to stay distinct from vertex as well as
    // legible — so this one goes redder rather than browner. 7.2:1.
    diagonal:  { color: '#8a3d00', tint: '#fff4cc', target: 'polygon.diagonals', mode: 'trace' },
    angle:     { color: '#1d7a2e', tint: '#ddf6e1', target: 'polygon.vertices', mode: 'ring' },
    convex:    { color: '#1d6b3a', tint: '#ddf1e3', target: 'polygon',          mode: 'ring' },
    concave:   { color: '#a3245a', tint: '#fbe0ea', target: 'polygon',          mode: 'ring' },
    regular:   { color: '#2c63c9', tint: '#e1ecff', target: 'polygon',          mode: 'ring' },
    irregular: { color: '#7a3fb0', tint: '#f0e6fb', target: 'polygon',          mode: 'ring' }
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
      out += '<span class="dc-term" data-term="' + term + '" style="color:' + def.color +
             ';background:' + def.tint + '">' + esc(m[0]) + '</span>';
      last = m.index + m[0].length;
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
