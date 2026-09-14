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
 *                      inward". It now carries a pictogram of the gesture
 *                      beside the words, so the action is coded twice too.
 *
 * Everything here is additive and fails soft. If Stage is not mounted, if
 * the term is not on screen, if animation is off — the words still show and
 * the lesson is unchanged.
 *
 *   DualCode.markup(text)        -> HTML for the bubble, terms chipped
 *   DualCode.cue(text)           -> halo whatever those terms name, on stage
 *   DualCode.gesture(text)       -> HTML pictogram for the instruction card
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
    vertex:    { color: '#c47800', tint: '#fff2d6', target: 'polygon.vertices', mode: 'ring' },
    side:      { color: '#0b7a5e', tint: '#d8f5ec', target: 'polygon.sides',    mode: 'trace' },
    diagonal:  { color: '#a86a00', tint: '#fff4cc', target: 'polygon.diagonals', mode: 'trace' },
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

  /* ------------------------------------------------------------------ *
   * The instruction card — code the gesture, not just the words
   * ------------------------------------------------------------------ */

  var GESTURES = {
    tap:  '<circle cx="12" cy="12" r="4.2" fill="CUR"/>' +
          '<circle cx="12" cy="12" r="8.4" fill="none" stroke="CUR" stroke-width="1.8" opacity=".55"><animate attributeName="r" values="5;10.5" dur="1.4s" repeatCount="indefinite"/><animate attributeName="opacity" values=".6;0" dur="1.4s" repeatCount="indefinite"/></circle>',
    drag: '<path d="M4 16h13" stroke="CUR" stroke-width="1.8" stroke-dasharray="3 3" opacity=".6" fill="none"/>' +
          '<path d="M14.5 12.5 18.5 16l-4 3.5" fill="none" stroke="CUR" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity=".6"/>' +
          '<circle cx="6" cy="16" r="4" fill="CUR"><animate attributeName="cx" values="6;15;6" dur="2.2s" repeatCount="indefinite"/></circle>',
    draw: '<path d="M5 19 19 5" stroke="CUR" stroke-width="2.2" stroke-linecap="round" fill="none" stroke-dasharray="20" stroke-dashoffset="20"><animate attributeName="stroke-dashoffset" values="20;0;0" dur="2s" repeatCount="indefinite"/></path>' +
          '<circle cx="5" cy="19" r="2.4" fill="CUR"/><circle cx="19" cy="5" r="2.4" fill="CUR" opacity=".55"/>',
    pick: '<path d="M12 3 21 10 17.6 20.5H6.4L3 10Z" fill="none" stroke="CUR" stroke-width="1.6" opacity=".45" stroke-linejoin="round"/>' +
          '<circle cx="12" cy="3" r="3.2" fill="CUR"><animate attributeName="r" values="2.6;4;2.6" dur="1.4s" repeatCount="indefinite"/></circle>'
  };

  /** Match the card's own verb. The deck writes the verb first, every time. */
  function gestureFor(text) {
    var s = String(text || '').toLowerCase();
    if (/\bdraw\b/.test(s)) return 'draw';
    if (/\bdrag\b/.test(s)) return 'drag';
    if (/\b(pick|choose|select)\b/.test(s)) return 'pick';
    if (/\btap\b/.test(s)) return 'tap';
    return null;
  }

  function gesture(text) {
    var kind = gestureFor(text);
    if (!kind) return '';
    var body = GESTURES[kind].split('CUR').join('#3d8bff');
    return '<svg class="dc-gesture" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false">' + body + '</svg>';
  }

  /**
   * Halo one term, now.
   *
   * `cue()` fires a whole line's terms on a fixed stagger, which was the best
   * it could do when the line appeared all at once. Now that the words arrive
   * one at a time, the caller can fire each halo at the moment its own word
   * does — which is what the contiguity principle actually asks for, and a
   * tighter binding than any guessed delay.
   */
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
    gesture: gesture,
    gestureFor: gestureFor,
    termsIn: termsIn,
    taught: function () { return Object.keys(seen); },
    reset: function () { seen = {}; },
    TERMS: TERMS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.DualCode;

})(typeof window !== 'undefined' ? window : this);
