/*!
 * game.js — wires everything and runs the screens.
 *
 * screens.js  →  director.js  →  { Stage, Swiftee, Input, SFX, Juice }
 *
 * Also owns the things no module should: the layout (semantic positions to
 * pixels per aspect ratio), the HUD, loading, persistence of the audio
 * settings, resize, and replay. Everything here is thin; the behaviour
 * lives in the modules.
 */
(function (global) {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var root, stageEl, hud, bubble, card, progress, loadEl, nextBtn;
  var director, current = -1, playing = false, settleTimer = null, mouthTimer = null, bubbleTimer = null;
  var refitTimer = null, refitRaf = 0;
  var SAVE_KEY = 'swiftee.audio';
  var quest = Quest.create(), rewardTimer;

  /**
   * Say "well done" without saying it.
   *
   * This used to raise a yellow toast reading "+25 XP · Challenge complete!".
   * A caption on a joke: the child had already seen the shape go right, heard
   * the cue and watched Swiftee react, and then had to read a label telling
   * them so. It also competed with the speech bubble for the same corner of
   * attention at the same moment.
   *
   * So the screen celebrates instead. Confetti comes down over everything,
   * Swiftee celebrates, and the sound carries the size of it — a finished
   * task is a shower, a badge is a downpour with a fanfare. The words stay in
   * the DOM for a screen reader, which cannot see any of it.
   */
  function reward(text, big) {
    clearTimeout(rewardTimer);
    var el = $('#reward');
    if (el) el.textContent = text || '';
    rewardTimer = setTimeout(function () { if (el) el.textContent = ''; }, 4000);

    if (global.Juice) Juice.shower({ count: big ? 110 : 55, duration: big ? 2300 : 1800 });
    if (global.SFX) SFX.play(big ? 'levelUp' : 'sparkle');
    if (global.Swiftee && Swiftee.play) {
      try {
        Swiftee.play('celebrate');
        if (global.Juice && Swiftee.el) Juice.tada(Swiftee.el);
      } catch (e) {}
    }
  }
  /**
   * Record the attempt. Deliberately says nothing.
   *
   * This used to put its own copy in the speech bubble — hints on a wrong
   * answer, praise on a right one — and then restore the lesson line a couple
   * of seconds later. Two problems with that. The deck contains no
   * wrong-answer dialogue at all, and the brief forbids inventing any, so
   * every one of those lines was copy nobody approved. And the bubble is
   * where the lesson speaks: borrowing it for feedback means the child reads
   * a sentence, loses it, and gets it back.
   *
   * The feedback is still there, and it is the feedback the storyboard
   * actually specifies: Swiftee reacts, the object refuses, a cue plays,
   * the input re-opens. All of it non-verbal, all of it from screens.js.
   */
  /**
   * Swiftee answers the child with his face, having nothing to say.
   *
   * This used to record the attempt and do nothing else, and it was the
   * loudest thing out of sync in the game: a child could get an answer wrong
   * three times running while the bird stood beside the shape smiling at
   * them. Sound said "no" and the character said nothing, so the two halves
   * of the feedback disagreed.
   *
   * It still says nothing, and that part was right — the deck contains no
   * wrong-answer dialogue and the brief forbids inventing any, and the bubble
   * belongs to the lesson. But an expression is not a line. He is puzzled
   * WITH them on a wrong answer, never disappointed in them: 'confused' is
   * the rig's own "hmm, that's odd" and it reads as company rather than as a
   * verdict. On a right one he is simply pleased, which is a smaller thing
   * than the full celebration a first-time award gets.
   */
  function react(kind) {
    if (kind === 'wrong') quest.mistake();
    if (!global.Swiftee || !Swiftee.play) return;
    try {
      if (kind === 'wrong') Swiftee.play('confused');
      else if (kind === 'correct') Swiftee.play('happy');
    } catch (e) {}
  }

  /* ------------------------------------------------------------------ *
   * Layout — semantic Swiftee positions → pixels, per aspect ratio.
   * The stage SVG scales itself; only Swiftee needs mapping because he is
   * an HTML overlay, not part of the SVG.
   * ------------------------------------------------------------------ */

  function frame() {
    // The visible 1000×562 stage box inside the container (meet-fit).
    var r = stageEl.getBoundingClientRect();
    var s = Math.min(r.width / 1000, r.height / 562);
    var w = 1000 * s, h = 562 * s;
    return { x: (r.width - w) / 2, y: (r.height - h) / 2, w: w, h: h, s: s, portrait: r.height > r.width };
  }

  /**
   * Swiftee's size, as a fraction of the stage height he should occupy.
   *
   * Expressed as the height of the DRAWN BIRD, not of the sprite cell. The
   * cell is 256px with the character filling 76% of it vertically (top of
   * the head at 58/512, feet on the baseline at 449/512), so sizing by the
   * cell overstates him by a third — which is how he ended up towering over
   * the lesson. These are the numbers to change if he looks wrong.
   */
  var BIRD_H = { small: 0.17, medium: 0.24, large: 0.31 };
  var CONTENT_FRAC = 0.764;      // (449 - 58) / 512, from the manifest bounds
  var EDGE = 8;                  // px of breathing room at the viewport edge

  /**
   * Whether anything on this screen is drawn beneath the shape.
   *
   * A caption, a Convex/Concave badge, a checklist, a row of options or a
   * stepper. Beats included, because most screens add theirs a beat or two
   * after the stage is built.
   */
  /** Does this screen put a row of options up at any point? */
  function screenAsksChoices(scr) {
    var beats = (scr.beats || []).concat(
      Object.keys(scr.perTap || {}).reduce(function (a, k) { return a.concat(scr.perTap[k] || []); }, []));
    var has = function (o) { return !!(o && o.choices); };
    if (has(scr.stage)) return true;
    return beats.some(function (b) {
      return has(b.stage) ||
        (b.on && Object.keys(b.on).some(function (k) { return (b.on[k] || []).some(function (x) { return has(x.stage); }); })) ||
        (b.otherwise || []).some(function (x) { return has(x.stage); });
    });
  }

  function wantsRoomBelow(scr) {
    var beats = (scr.beats || []).concat(
      Object.keys(scr.perTap || {}).reduce(function (a, k) { return a.concat(scr.perTap[k] || []); }, []));
    var has = function (o) {
      return !!(o && (o.label || o.badge || o.choices || o.checklist || o.stepper || o.measurements));
    };
    if (has(scr.stage)) return true;
    return beats.some(function (b) {
      return has(b.stage) ||
        (b.on && Object.keys(b.on).some(function (k) { return (b.on[k] || []).some(function (x) { return has(x.stage); }); })) ||
        (b.otherwise || []).some(function (x) { return has(x.stage); });
    });
  }

  function layout(pos, size) {
    var f = frame();

    // stageH * wanted fraction = cell * scale * CONTENT_FRAC
    var want = BIRD_H[size] || BIRD_H.medium;
    var scale = (f.h * want) / (256 * CONTENT_FRAC);

    var map = {
      'left':               { x: 0.20, y: 0.88 },
      'left-low':           { x: 0.15, y: 0.97 },
      // 'polygon-top-right' is gone. The lesson slab occupies the right of
      // the stage and the HUD the corner above it, so there is no point at the
      // polygon's top-right that is not already something else. Two screens
      // used it, and on both he simply stood on the card.
      // For screens whose lesson reaches all the way across — the swipe
      // practice puts a drop zone against each edge — the only clear ground
      // left is the near corner, and he has to be small enough to stand in
      // it without leaning on either zone.
      'right-low':          { x: 0.90, y: 1.00 },
      // Up in the corner, off the ground — for screens where the lesson needs
      // the whole floor and he should be a narrator rather than a bystander
      // standing in it.
      // 0.075, not 0.11: at 0.11 his wing reached four pixels into the first
      // card of the sorting tray.
      'top-left':           { x: 0.075, y: 0.30 },
      'centre':             { x: 0.50, y: 0.93 },
      'off':                { x: -0.3, y: 0.9 }
    };
    if (f.portrait) {
      // Stage letterboxes; put Swiftee below the box so he never covers it.
      map['left'] = { x: 0.18, y: 1.02 }; map['left-low'] = { x: 0.16, y: 1.02 };
      map['right-low'] = { x: 0.84, y: 1.02 };
      map['top-left'] = { x: 0.13, y: 0.26 };
      map['polygon-top-right'] = { x: 0.86, y: 0.22 }; map['centre'] = { x: 0.5, y: 1.02 };
      // ...which means the stage height is the wrong yardstick down here. A
      // portrait stage letterboxes to a short band, so sizing against it left
      // him a thumbnail in a tall empty strip. Size against the strip he is
      // actually standing in instead.
      var below = Math.max(120, (window.innerHeight || 800) - (f.y + f.h));
      scale = (below * ({ small: 0.40, medium: 0.52, large: 0.64 }[size] || 0.52)) / (256 * CONTENT_FRAC);
    }

    // When the stage is nothing but scenery, standing off to one side leaves
    // a hole where the lesson would be and makes him look parked. The screens
    // do not need to know this — they still say "left"; the layout decides
    // that "left of nothing" means the middle, with a little more presence.
    var m = map[pos] || map['left-low'];
    if (pos !== 'off' && soloed()) { m = map['centre']; scale *= 1.08; }

    var y = f.y + m.y * f.h;

    // In portrait he stands in the strip below the letterboxed stage. "1.02 of
    // the stage height" was a guess at where that begins, and on a tall phone
    // it put the top of his head back inside the stage, over the shape. Place
    // him from the stage's actual bottom edge and his own drawn height, so he
    // clears it whatever the aspect ratio.
    if (f.portrait && pos !== 'off' && m.y >= 1) {
      y = Math.max(y, f.y + f.h + 8 + 256 * CONTENT_FRAC * scale);
    }

    return fit({ x: f.x + m.x * f.w, y: y, scale: scale }, pos);
  }

  /**
   * Nudge the anchor so the whole sprite cell stays on screen.
   *
   * The anchor is his feet (the sheet's baseline), and positions like
   * 'left-low' deliberately sit him low, so on a short window the top of his
   * head could fall outside the viewport and he would render decapitated.
   * Clamping here rather than at each call site means the bubble, which is
   * placed from the same numbers, follows him automatically.
   *
   * Off-stage is exempt: being outside the viewport is the entire point.
   */
  function fit(L, pos) {
    if (pos === 'off') return L;
    var vw = window.innerWidth || document.documentElement.clientWidth;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var cell = 256 * L.scale;
    var top = L.y - 0.877 * cell, bottom = L.y + 0.123 * cell;
    var left = L.x - cell / 2, right = L.x + cell / 2;

    // Head first: if he cannot fit whole, the top of the cell is the edge to
    // keep, because everything below the baseline is empty anyway.
    if (bottom > vh - EDGE) L.y -= (bottom - (vh - EDGE));
    if (L.y - 0.877 * cell < EDGE) L.y = EDGE + 0.877 * cell;
    if (left < EDGE) L.x += EDGE - left;
    if (right > vw - EDGE) L.x -= right - (vw - EDGE);
    return L;
  }

  /** True while Swiftee is holding the middle of an otherwise empty stage. */
  function soloed() { return !!(global.Stage && Stage.isEmpty && Stage.isEmpty()); }

  /* ------------------------------------------------------------------ *
   * HUD
   * ------------------------------------------------------------------ */

  /**
   * Reveal a line one word at a time.
   *
   * Every word — and every dual-coding chip, which counts as one word — is
   * wrapped in its own span and faded in on a timer. Two things make this
   * safe rather than fiddly:
   *
   * The words are hidden with `opacity`, never `display`. The bubble is
   * therefore laid out at its full final size before the first word appears,
   * so it cannot grow as the line arrives — no jitter, and placeBubble's work
   * keeping it off the lesson holds for the whole line instead of being
   * invalidated on every tick.
   *
   * And a term's halo fires as its own word lands, rather than on a fixed
   * stagger guessed in advance. The word and the thing it names now light up
   * in the same frame, which is the binding dual coding is actually after.
   */
  var revealTimer = null, revealUnits = null;

  function revealAll() {
    clearInterval(revealTimer); revealTimer = null;
    if (!revealUnits) return false;
    var pending = revealUnits.filter(function (u) { return !u.el.classList.contains('in'); });
    pending.forEach(function (u) { u.el.classList.add('in'); if (u.term) DualCode.cueTerm(u.term); });
    revealUnits = null;
    return pending.length > 0;
  }

  /** Split a rendered line into word-sized units, chips counting as one. */
  function unitsOf(line) {
    var out = [];
    (function split(node) {
      [].slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 1) {
          if (n.classList && n.classList.contains('dc-term')) {
            out.push({ el: n, term: n.getAttribute('data-term') });
            return;
          }
          split(n);
          return;
        }
        if (n.nodeType !== 3) return;
        var frag = document.createDocumentFragment();
        n.nodeValue.split(/(\s+)/).forEach(function (p) {
          if (!p) return;
          if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(p)); return; }
          var w = document.createElement('span');
          w.className = 'w'; w.textContent = p;
          frag.appendChild(w); out.push({ el: w, term: null });
        });
        node.replaceChild(frag, n);
      });
    })(line);
    return out;
  }

  function reveal(line, ms, units) {
    clearInterval(revealTimer); revealTimer = null;
    // Split already, if the caller did it. unitsOf mutates the line — running
    // it twice would wrap every word span in another word span.
    units = units || unitsOf(line);
    if (!units.length) return;

    var reduced = !!(global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (reduced) { units.forEach(function (u) { u.el.classList.add('in'); if (u.term) DualCode.cueTerm(u.term); }); return; }

    line.classList.add('revealing');
    revealUnits = units;

    // Finish comfortably inside the reading time, so the line is whole and
    // still for most of the beat rather than only just done when it ends.
    var step = Math.max(45, Math.min(120, (ms || 1400) * 0.55 / units.length));
    var i = 0;
    revealTimer = setInterval(function () {
      if (i >= units.length) { clearInterval(revealTimer); revealTimer = null; revealUnits = null; return; }
      var u = units[i++];
      u.el.classList.add('in');
      if (u.term && global.DualCode) DualCode.cueTerm(u.term);
    }, step);
  }

  function say(text, mood, ms) {
    clearInterval(revealTimer); revealTimer = null; revealUnits = null;
    if (!text) { bubble.classList.add('out'); bubble.classList.remove('show'); return; }
    mood = mood || (/\?|Hmm|What if/.test(text) ? 'think' : /Yay|Great|Nice|Whoa/.test(text) ? 'win' : 'talk');
    bubble.dataset.mood = mood;
    // Only the line is replaced. The frame, the panel, the highlight and the
    // accent marks are permanent markup: rebuilding them for every sentence
    // would restart their own transitions, and the bubble carries the line
    // and nothing else anyway. `mood` stays as a data attribute for styling
    // and is never rendered as text.
    var line = bubble.querySelector('.bubble-line');
    if (global.DualCode) {
      // Dual coding: each key term is drawn as a chip carrying a miniature of
      // itself. The halo that lights up the matching thing on stage is NOT
      // fired here — reveal() fires each one as its own word appears, which
      // is tighter than any stagger set in advance. Calling cue() as well
      // would halo everything twice. DualCode.markup escapes what it is given.
      line.innerHTML = DualCode.markup(text);
    } else {
      line.textContent = text;
    }
    bubble.classList.remove('out');
    bubble.classList.add('show');
    // SPLIT INTO WORDS FIRST, then measure, then reveal.
    //
    // fitLine counts rows by where the words sit, and until unitsOf has run
    // the words are bare text nodes — which have no bounding box. It saw only
    // the tinted chips, counted one row, and never shrank anything: "Which of
    // these are polygons?" stayed on two rows with the fit silently doing
    // nothing. Splitting first gives every word a box to be measured by, and
    // costs nothing, since reveal needed the same split a moment later.
    var units = unitsOf(line);
    fitLine();
    reveal(line, ms, units);

    // AND AGAIN ONCE THE SCENE HAS STOPPED MOVING.
    //
    // fitLine measures the room the line has at the instant the line is set,
    // and on several screens that instant is too early: the sort tray arrives
    // on staggered timers, Swiftee is still travelling to his mark, the panel
    // is mid-entrance. The line gets placed against a scene that is not
    // finished, and nothing ever asks again — which is how a sentence that
    // fits on one row across the top of the screen ended up on three, in a
    // half-width slot, over the cards it was asking about.
    //
    // Two more passes: the next frame, for anything that had not been laid
    // out yet, and after the entrances are over. Both cancelled by the next
    // line or the next screen, and both are measure-and-place with no side
    // effects, so running them when nothing has changed costs a layout read.
    clearTimeout(refitTimer);
    if (refitRaf) cancelAnimationFrame(refitRaf);
    var again = function () { if (bubble.classList.contains('show')) fitLine(); };
    refitRaf = requestAnimationFrame(again);
    refitTimer = setTimeout(again, 700);
  }

  /**
   * Keep the line on one row, and the box no wider than the line.
   *
   * Two faults with one cause. The bubble's width is capped by the free space
   * beside the lesson, so a sentence longer than that cap wraps — and once it
   * wraps, `text-wrap: balance` evens the rows out, which leaves every row
   * shorter than the box and a band of empty paper down both sides. A short
   * sentence in a wide frame reads as a mistake.
   *
   * So: shrink the TYPE until the sentence fits on one row, down to two
   * thirds of its size and no further — past that it is a genuinely long
   * sentence and wrapping is the right answer, not six-point text. Then snap
   * the cap to the widest row that actually rendered, which takes the empty
   * band away whether it wrapped or not.
   *
   * Only the type shrinks, never #bubble's own font-size: padding, radius and
   * the horn are all em of that, and shrinking it would shrink the frame and
   * the horn along with the words.
   */
  /**
   * Lay the line out and place the bubble.
   *
   * THE TYPE IS ONE SIZE. The stylesheet gives it two — the full size on a
   * screen where Swiftee speaks alone, a smaller one where he is sharing the
   * screen with a shape — and this does not touch either of them.
   *
   * It used to. It shrank the type, sentence by sentence, until the line fit
   * on a single row: three per cent at a time, down to half. It worked, and
   * it was wrong. A child reading this game saw the words change size every
   * time Swiftee spoke — forty pixels on one screen, thirty-five on the next,
   * twenty-nine on the one after — because the size was being decided by how
   * long that particular sentence happened to be. Text that changes size is
   * text that looks like it is being squeezed in, and it is the single
   * loudest way for a game to read as unfinished.
   *
   * A long sentence wraps to two rows instead. Two rows at a size the child
   * already knows is easier than one row at a size they have never seen, and
   * it is the same answer a book would give.
   */
  function fitLine() {
    bubble.style.maxWidth = '';
    var inner = bubble.querySelector('.dialogue-inner');
    if (inner) inner.style.fontSize = '';    // nothing is sized from JS any more
    bubble.classList.remove('tight');
    placeBubble();

    // Step down ONCE if the sentence still runs past two rows in the space it
    // was given. Not a scale — a second size, declared in the stylesheet, the
    // same on every screen that needs it. Three rows of a speech bubble is a
    // paragraph, and that is the only thing worth spending a size change on.
    if (rowsOfLine() > 2) {
      bubble.classList.add('tight');
      placeBubble();
    }
    paintSkin();
  }

  /** How many rows the line actually rendered on. */
  function rowsOfLine() {
    var line = bubble.querySelector('.bubble-line');
    if (!line) return 1;
    var kids = line.childNodes, tops = {}, k, r;
    for (k = 0; k < kids.length; k++) {
      if (!kids[k].getBoundingClientRect) continue;
      r = kids[k].getBoundingClientRect();
      if (!r.width) continue;
      tops[Math.round(r.top / 2) * 2] = 1;
    }
    return Object.keys(tops).length || 1;
  }

  /**
   * Place the speech bubble somewhere it does not cover the lesson.
   *
   * The old version anchored it beside Swiftee and capped its width against
   * whatever was to his right. That works until it does not: on the builder
   * screen the panel runs through the middle and there is no "beside", and a
   * cap measured while the scene was still animating in came out too generous.
   * Each fix moved the collision somewhere else.
   *
   * So it does not guess a spot and then try to make it fit. It works out the
   * free space around the lesson — left of it, right of it, above it, below it
   * — discards anything too small to hold a sentence, and puts the bubble in
   * the best of what remains, preferring the side Swiftee is on so the tail
   * still points at the speaker. The last step measures what was actually laid
   * out and nudges it back inside its own rectangle, because a long word can
   * push past a max-width and that is exactly the case that used to escape.
   */
  function placeBubble() {
    var L = layout(Swiftee.pos, Swiftee.size || 'medium');
    var f = frame();
    var solo = soloed();
    var vw = window.innerWidth || document.documentElement.clientWidth;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    // MIN_W is the narrowest the bubble can actually render: min-width 170,
    // plus 22px padding and a 3px border on each side. Asking for less than
    // that does not produce a narrower bubble, it produces one that hangs out
    // of the space it was promised — which is how it kept clipping the
    // polygon by a few pixels on a phone.
    // GAP is the margin the bubble keeps from every edge it can reach. At 14
    // it sat hard against the side of the screen and read as something that
    // had slid off rather than been placed.
    var GAP = 26, MIN_W = 240, MIN_H = 64;

    // Type size is the stylesheet's job; it only needs to know whether this
    // is a screen with room to breathe.
    bubble.style.marginLeft = '0px';
    bubble.style.minWidth = '';
    bubble.classList.toggle('solo', solo);
    bubble.style.right = 'auto';

    // Everything the bubble must stay out of.
    var content = Stage.contentBox && Stage.contentBox();
    var cardBox = card.classList.contains('show') ? card.getBoundingClientRect() : null;
    var hudBox = hud.getBoundingClientRect();
    var nextBox = nextBtn && nextBtn.classList.contains('show') ? nextBtn.getBoundingClientRect() : null;

    // With nothing on stage he simply speaks over the middle of the screen.
    if (solo || !content) {
      // No floor here. The stylesheet carries a minimum in em, which scales
      // with the type; a floor in pixels is dead space the moment the line is
      // shorter than it, and most of the thirty-six lines are.
      // A screen with nothing on it but Swiftee has no lesson to keep clear
      // of, so the only reason to cap the width at all is the reading line —
      // and 620px forced most of the thirty-six sentences onto two rows for
      // no benefit. Wide enough now that short and middling lines stay on one.
      bubble.style.maxWidth = Math.min(f.w * 0.86, 1040) + 'px';
      bubble.style.left = '50%';
      bubble.style.marginLeft = -(bubble.offsetWidth / 2) + 'px';
      var birdTop = L.y - 256 * layout(Swiftee.pos, 'large').scale * CONTENT_FRAC;
      bubble.style.top = Math.max(hudBox.bottom + GAP, birdTop - bubble.offsetHeight - 26) + 'px';
      // He stands directly below on these screens, but aim it properly all the
      // same — "below" is only true once he has landed.
      paintSkin();
      return;
    }

    var top = Math.max(GAP, (cardBox ? cardBox.bottom + 10 : GAP));
    var bottom = vh - GAP - (nextBox ? nextBox.height + 16 : 0);

    // The bands around the lesson, and the bands through it. Each is a place
    // a bubble could live.
    // SWIFTEE IS SOMETHING TO AVOID TOO.
    //
    // The placement checked the bubble against the lesson — the polygon, the
    // panels, the trays — and against nothing else, so the one thing on the
    // screen it was most likely to land on was the one thing it never looked
    // at.
    //
    // His DRAWN bounds, not his element's: the sprite cell is mostly empty by
    // design, and treating the whole cell as solid would push the bubble a
    // fifth of the screen further away than it needs to go.
    var birdBox = null;
    if (global.Swiftee && Swiftee.bounds) {
      var bb = Swiftee.bounds();
      if (bb && bb.width) {
        birdBox = {
          left: bb.left - f.x - 10, right: bb.right - f.x + 10,
          top: bb.top - f.y - 10, bottom: bb.bottom - f.y + 10
        };
      }
    }

    var slots = [
      { id: 'left',  x: GAP,                  y: top, w: content.left - GAP * 2,  h: bottom - top },
      { id: 'right', x: content.right + GAP,  y: top, w: vw - content.right - GAP * 2, h: bottom - top },
      { id: 'above', x: GAP, y: top, w: vw - GAP * 2, h: content.top - top - GAP },
      { id: 'below', x: GAP, y: content.bottom + GAP, w: vw - GAP * 2, h: bottom - content.bottom - GAP }
    ];

    // Full-width bands between the lesson's own pieces. The sorting screen
    // puts the tray at the top and the bins at the bottom; the strip between
    // them is the most comfortable place on that screen for a line of
    // dialogue, and a single union box cannot see it.
    var rows = (Stage.contentParts ? Stage.contentParts() : [])
      .map(function (r) { return [r.top, r.bottom]; })
      .sort(function (a, b) { return a[0] - b[0]; });
    var merged = [];
    rows.forEach(function (r) {
      var last = merged[merged.length - 1];
      if (last && r[0] <= last[1] + 2) last[1] = Math.max(last[1], r[1]);
      else merged.push([r[0], r[1]]);
    });
    for (var i = 0; i + 1 < merged.length; i++) {
      slots.push({ id: 'gap', x: GAP, y: merged[i][1] + GAP,
                   w: vw - GAP * 2, h: merged[i + 1][0] - merged[i][1] - GAP * 2 });
    }

    // CARVE SWIFTEE OUT OF THE SLOTS.
    //
    // Scoring slots by whether they contain him does not work, because on a
    // screen where he stands beside the lesson EVERY vertical band contains
    // him — the left band runs the full height of the play area and he is
    // somewhere in it. So they all score the same and the bubble lands on his
    // face anyway, which is what page 10 was doing: covering the character
    // supposedly speaking, by 156 by 103 pixels.
    //
    // A slot that contains him is replaced by the largest part of itself that
    // does not. Four candidates — the strip above him, below him, left of him,
    // right of him — and the biggest wins. That turns "the left band" into
    // "the left band above his head", which is a real place to put a sentence.
    // EVERYTHING FIXED ON TOP OF THE LESSON IS AN OBSTACLE, not just him.
    //
    // Only Swiftee was carved out, so the sound and restart buttons in the
    // top-right corner were invisible to this: on the screens whose lesson
    // reaches both edges the only band left is the strip along the top, and
    // the line was published straight across the HUD — the two controls a
    // child needs to turn the sound off, behind a speech bubble.
    //
    // The same is true of the Next button and of the screen picker. They are
    // all fixed boxes over the play area, they are all off limits, and there
    // is no reason for the rule to name one of them.
    // The screen picker is NOT in this list. It is a temporary review tool
    // sitting across the top of the window, and treating it as an obstacle
    // split the full-width band above the lesson into two short ones — so a
    // sentence that fits on one row across the top came out on three, in a
    // half-width slot, over the corner of the panel. A debug control must not
    // be able to change how the game lays itself out.
    var blocks = [birdBox];
    [hudBox, nextBox].forEach(function (b) {
      if (!b || !b.width) return;
      blocks.push({ left: b.left - f.x - 8, right: b.right - f.x + 8,
                    top: b.top - f.y - 8, bottom: b.bottom - f.y + 8 });
    });

    blocks.forEach(function (box) {
      if (!box) return;
      slots = slots.map(function (r) {
        var ov = r.x < box.right && r.x + r.w > box.left &&
                 r.y < box.bottom && r.y + r.h > box.top;
        if (!ov) return r;
        var cands = [
          { id: r.id, x: r.x, y: r.y, w: r.w, h: box.top - r.y },
          { id: r.id, x: r.x, y: box.bottom, w: r.w, h: r.y + r.h - box.bottom },
          { id: r.id, x: r.x, y: r.y, w: box.left - r.x, h: r.h },
          { id: r.id, x: box.right, y: r.y, w: r.x + r.w - box.right, h: r.h }
        ].filter(function (c) { return c.w >= MIN_W && c.h >= MIN_H; });
        if (!cands.length) return r;          // nowhere clear: leave it and let hits() fight
        cands.sort(function (a, b) { return (b.w * b.h) - (a.w * a.h); });
        return cands[0];
      });
    });

    slots = slots.filter(function (r) { return r.w >= MIN_W && r.h >= MIN_H; });

    if (!slots.length) {
      // Nowhere is genuinely clear. Sit above the lesson and be as small as
      // possible: covering the top of a panel is better than covering the
      // shape, and better than not speaking at all.
      slots = [{ id: 'above', x: GAP, y: top, w: vw - GAP * 2, h: Math.max(MIN_H, content.top - top) }];
    }

    // Prefer the side he is standing on, then the roomiest.
    var onLeft = L.x < vw / 2;
    slots.sort(function (a, b) {
      var pref = function (r) { return (r.id === (onLeft ? 'left' : 'right')) ? 1 : 0; };
      return (pref(b) - pref(a)) || (b.w * b.h - a.w * a.h);
    });
    // Height depends on width, and width depends on the slot, so the only
    // way to know whether a line of dialogue fits a band is to lay it out
    // there and look. Take the first slot it actually fits; if it fits none,
    // take the one it overflows least.
    // Beside him a bubble wants to be book-width so it reads as speech. In a
    // horizontal band it should use the band: the sorting screen leaves a
    // 128px strip between the tray and the bins, and the same sentence is two
    // lines at 520px and one line across the width — which is the difference
    // between not fitting and fitting comfortably.
    // SAFE keeps the cap just inside the slot. The bubble is tilted, so the
    // box it actually paints is a couple of pixels wider than the width it
    // was given, and a cap set to exactly the slot width produced a bubble
    // that was exactly too big for it.
    var SAFE = 10;
    var capFor = function (r) {
      var room = (r.id === 'left' || r.id === 'right')
        ? Math.min(r.w - SAFE, 640)
        : Math.min(r.w - SAFE, vw * 0.8);
      return room;
    };

    // Measure the LAYOUT box. The bubble now plays a bouncy entrance that
    // scales it from 82% to 103% and back, so the painted box is whatever
    // frame the animation happens to be on when we look — useless for
    // deciding whether a sentence fits beside a polygon. offsetWidth and
    // offsetHeight ignore transforms and report where the box actually is.
    // The settle pass re-runs this once the animation is over anyway.
    var size = function () { return { w: bubble.offsetWidth, h: bubble.offsetHeight }; };

    // PICK THE SLOT THE SENTENCE READS BEST IN, not the first one it fits.
    //
    // This used to take the first slot tall enough to hold the bubble and
    // stop. A slot beside the lesson is narrow and tall, so it always
    // qualified — and the sentence was then squeezed into three rows in a
    // 250px column while a full-width band above or below the lesson sat
    // empty. Measuring every slot and keeping the one where the bubble comes
    // out SHORTEST is the same thing as keeping the one where it wraps least,
    // and costs three more layout reads on a path that now runs twice a line.
    // Where a bubble of a given size ends up in a given slot. Used twice —
    // once per slot while choosing, and once on the slot that wins — so the
    // thing that is scored is the thing that is placed.
    var placeIn = function (r, ww, hh) {
      var wx = (r.id === 'left' || r.id === 'right')
        ? L.x - ww / 2
        : (onLeft ? Math.max(r.x, L.x - ww * 0.35) : Math.min(r.x + r.w - ww, L.x - ww * 0.65));
      var wy = (r.id === 'left' || r.id === 'right')
        ? L.y - 256 * L.scale * CONTENT_FRAC - hh - 26
        : r.y + (r.h - hh) / 2;
      return {
        x: Math.max(r.x, Math.min(wx, r.x + r.w - ww)),
        y: Math.max(r.y, Math.min(wy, r.y + r.h - hh))
      };
    };

    // How many rows a given height is. A row is one line-height; everything
    // else in the box is padding and border, and that is paid once.
    var lineH = parseFloat(getComputedStyle(bubble).lineHeight) || 30;
    bubble.style.maxWidth = '100000px';
    var chrome = bubble.offsetHeight - lineH;
    var rowsOf = function (hh) { return Math.max(1, Math.round((hh - chrome) / lineH)); };

    // The top of his head, which is what the pointer has to reach.
    var headX = L.x, headY = L.y - 256 * L.scale * CONTENT_FRAC;
    var reach = function (p, ww, hh) {
      var dx = Math.max(p.x - headX, 0, headX - (p.x + ww));
      var dy = Math.max(p.y - headY, 0, headY - (p.y + hh));
      return Math.sqrt(dx * dx + dy * dy);
    };

    // PICK THE SLOT NEAREST HIS HEAD, not the one the sentence is shortest in.
    //
    // Shortest-first sounds right and is wrong: the shortest layout is always
    // the widest band, and the widest band is the full-width strip along the
    // top of the screen. So every long line was published up there, six
    // hundred pixels from the character supposedly saying it, with a pointer
    // aimed at empty sky. A speech bubble that is not attached to a speaker
    // is a caption.
    //
    // Distance from his head decides it. Wrapping still matters — a line that
    // fits on one row reads better than the same line on two — but it is a
    // nudge, not the rule, because "near him on two rows" beats "across the
    // top on one" every time. Three rows is the thing actually worth
    // avoiding: that is where a bubble starts to be a paragraph.
    var slot = null, w = 0, h = 0, best = Infinity;
    for (var si = 0; si < slots.length; si++) {
      var r = slots[si];
      bubble.style.maxWidth = capFor(r) + 'px';
      var m = size();
      var fits = m.h <= r.h && m.w <= r.w;
      var rows = rowsOf(m.h);
      var score = reach(placeIn(r, m.w, m.h), m.w, m.h)
                + (rows - 1) * 40                          // one row is nicer
                + (rows > 2 ? 4200 : 0)                    // three is a paragraph
                + (fits ? 0 : 2400 + Math.max(0, m.h - r.h));
      if (score < best) { best = score; slot = r; }
    }
    bubble.style.maxWidth = capFor(slot) + 'px';
    var m2 = size(); w = m2.w; h = m2.h;
    var at = placeIn(slot, w, h);
    var x = at.x, y = at.y;

    bubble.style.left = x + 'px';
    bubble.style.top = y + 'px';

    // One correction pass. Everything above reasons in layout coordinates,
    // but the bubble is rotated about a corner, so where it actually lands is
    // a few pixels off where it was told to go — enough to clip the stepper
    // on the builder screen. Rather than model the rotation, put it down,
    // look at where it ended up, and shift by the difference.
    // Against the layout box for the same reason: mid-animation the painted
    // box is meaningless, and the bubble is no longer rotated, so layout and
    // painted position agree once the entrance has finished.
    var got = { left: x, right: x + w, top: y, bottom: y + h };
    var dx = 0, dy = 0;
    if (got.left < slot.x) dx = slot.x - got.left;
    else if (got.right > slot.x + slot.w) dx = (slot.x + slot.w) - got.right;
    if (got.top < slot.y) dy = slot.y - got.top;
    else if (got.bottom > slot.y + slot.h) dy = (slot.y + slot.h) - got.bottom;
    if (dx || dy) {
      bubble.style.left = (x + dx) + 'px';
      bubble.style.top = (y + dy) + 'px';
    }
    // Then check. Everything above is a model of where the bubble will land —
    // slot arithmetic, a rotation, a font that may not have loaded yet — and
    // each of those has been wrong at least once. This asks the only question
    // that matters, of the real geometry: is any part of the lesson underneath
    // it? If so, shrink and try again, and failing that put it in the band
    // with the most room. Cheap, and it cannot be fooled by a cause nobody
    // thought of.
    var parts = Stage.contentParts ? Stage.contentParts() : [];
    var hits = function () {
      var l = parseFloat(bubble.style.left) || 0, t = parseFloat(bubble.style.top) || 0;
      var r = { left: l, right: l + bubble.offsetWidth, top: t, bottom: t + bubble.offsetHeight };
      var over = function (p) {
        return r.left < p.right && r.right > p.left && r.top < p.bottom && r.bottom > p.top;
      };
      for (var i = 0; i < parts.length; i++) if (over(parts[i])) return true;
      return !!(birdBox && over(birdBox));
    };

    for (var attempt = 0; attempt < 3 && hits(); attempt++) {
      var cur = { width: bubble.offsetWidth, height: bubble.offsetHeight };
      var narrower = Math.max(MIN_W, cur.width * 0.78);
      bubble.style.maxWidth = narrower + 'px';
      var now = { width: bubble.offsetWidth, height: bubble.offsetHeight };
      // Re-seat it in the slot at the new size.
      bubble.style.left = Math.max(slot.x, Math.min(parseFloat(bubble.style.left),
                                                    slot.x + slot.w - now.width)) + 'px';
      bubble.style.top = Math.max(slot.y, Math.min(parseFloat(bubble.style.top),
                                                   slot.y + slot.h - now.height)) + 'px';
      var afterL = parseFloat(bubble.style.left) || 0;
      bubble.style.left = (afterL + (slot.x - afterL > 0 ? slot.x - afterL : 0)) + 'px';
    }

    paintSkin();
  }

  /**
   * Point the tail at Swiftee's head, from whichever edge of the bubble faces
   * him.
   *
   * It used to be two CSS classes that slid the tail to 18% or 82% along the
   * bottom edge. That is only ever right when he is below the bubble; placed
   * beside the lesson, with him standing off to one side at the same height,
   * a tail hanging off the bottom points at the floor. And it is the one part
   * of a speech bubble that carries meaning — it is what says who is talking.
   *
   * So the edge is chosen by where his head actually is, the tail slides to
   * the point on that edge nearest to it, and the square turns so its
   * bordered corner is the one facing out. The lip has to turn with it: the
   * body's shadow falls 9px straight down, and for a square rotated by t that
   * is (9·sin t, 9·cos t) in the square's own axes, or the underside would
   * end up running along the wrong two sides.
   */
  /* ------------------------------------------------------------------ *
   * The bubble's outline
   *
   * ONE PATH FOR BODY AND HORN. Every previous version drew the body as a
   * CSS box — border, radius, background — and laid a second SVG over its
   * bottom edge for the horn. There is no good answer to that seam. Cover
   * the body's rim with the horn's fill and the outline has a gap where the
   * rim used to be; leave it and a straight line runs across the horn's base.
   * Half a dozen passes moved that fault about without removing it, because
   * it is not a bug in the numbers, it is a bug in having two shapes.
   *
   * So the outline is walked once, clockwise from the top-left corner, and
   * the horn is emitted in its place along whichever edge it belongs to.
   * Filled once, stroked once, no junction.
   * ------------------------------------------------------------------ */

  // How far the skin reaches beyond the bubble's own box: the horn's length
  // plus room for the stroke and the glow.
  function skinPad(em) { return Math.round(em * 1.5); }

  /**
   * The outline, as SVG path data.
   *
   * `horn` is { edge, at, hw, len, lean } in the bubble's own pixels — `at`
   * measured along the edge from the box's top-left in reading order, so the
   * caller never has to think about which way round a given edge is walked.
   */
  function outlinePath(w, h, r, pad, horn) {
    var d = [];
    r = Math.max(2, Math.min(r, Math.min(w, h) / 2));

    // Each edge as an origin, a direction along it, and an outward normal.
    // Everything about the horn is then the same four lines of arithmetic
    // whichever edge it is on.
    var EDGE = {
      top:    { o: [0, 0], t: [1, 0],  n: [0, -1], len: w },
      right:  { o: [w, 0], t: [0, 1],  n: [1, 0],  len: h },
      bottom: { o: [w, h], t: [-1, 0], n: [0, 1],  len: w },
      left:   { o: [0, h], t: [0, -1], n: [-1, 0], len: h }
    };

    var P = function (x, y) { return (x + pad).toFixed(1) + ' ' + (y + pad).toFixed(1); };
    var at = function (E, u, v) {
      return [E.o[0] + E.t[0] * u + E.n[0] * v, E.o[1] + E.t[1] * u + E.n[1] * v];
    };
    var pt = function (E, u, v) { var p = at(E, u, v); return P(p[0], p[1]); };

    // Where along this edge the horn sits, in the edge's own travel direction.
    var along = function (name) {
      if (!horn || horn.edge !== name) return -1;
      var E = EDGE[name];
      var u = (name === 'top' || name === 'left') ? horn.at : E.len - horn.at;
      // never so close to a corner that the horn grows out of the curve
      return Math.max(r + horn.hw, Math.min(E.len - r - horn.hw, u));
    };

    var run = function (name) {
      var E = EDGE[name], c = along(name);
      if (c < 0) return;
      var hw = horn.hw, L = horn.len, ln = horn.lean || 0;
      d.push('L' + pt(E, c - hw, 0));
      // Leaves the edge square-on, so base and body make a clean corner.
      // Out to the tip. The second control stays on the side the curve came
      // from: pulled PAST the tip, as it was, the curve overshoots and comes
      // back, so the two halves meet in a cusp rather than a point — and a
      // cusp under a 4px round join renders as a little hook hanging off the
      // end. That hook was the 'extra part'.
      d.push('C' + pt(E, c - hw * 0.98, L * 0.5) + ' ' + pt(E, c + ln - hw * 0.3, L * 0.86) + ' ' + pt(E, c + ln, L));
      // and back up the other side, mirrored, so the tip is a clean point
      d.push('C' + pt(E, c + ln + hw * 0.3, L * 0.86) + ' ' + pt(E, c + hw * 0.98, L * 0.5) + ' ' + pt(E, c + hw, 0));
    };

    d.push('M' + P(r, 0));
    run('top');
    d.push('L' + P(w - r, 0));
    d.push('Q' + P(w, 0) + ' ' + P(w, r));
    run('right');
    d.push('L' + P(w, h - r));
    d.push('Q' + P(w, h) + ' ' + P(w - r, h));
    run('bottom');
    d.push('L' + P(r, h));
    d.push('Q' + P(0, h) + ' ' + P(0, h - r));
    run('left');
    d.push('L' + P(0, r));
    d.push('Q' + P(0, 0) + ' ' + P(r, 0));
    d.push('Z');
    return d.join('');
  }

  /**
   * Measure the bubble, work out where the horn belongs, and redraw the skin.
   *
   * The horn goes on whichever edge faces Swiftee and slides to the point on
   * it nearest his head — it is the part of a speech bubble that says who is
   * talking, so it is worth aiming rather than parking. The bubble's
   * transform-origin then follows it, so the bubble springs out of the horn,
   * which is to say out of him.
   */
  function paintSkin() {
    var skin = bubble.querySelector('.bubble-skin');
    if (!skin) return;
    var r = layoutRect(bubble);
    if (!r.width || !r.height) return;

    var em = parseFloat(getComputedStyle(bubble).fontSize) || 20;
    var pad = skinPad(em);
    var radius = em * 0.62;

    var head = headPoint();
    var horn = null;
    if (head) {
      var dx = (head.x - (r.left + r.width / 2)) / (r.width / 2);
      var dy = (head.y - (r.top + r.height / 2)) / (r.height / 2);
      var edge = Math.abs(dy) >= Math.abs(dx)
        ? (dy > 0 ? 'bottom' : 'top')
        : (dx > 0 ? 'right' : 'left');
      var vertical = edge === 'bottom' || edge === 'top';
      // SIZED OFF THE BOX, NOT OFF THE TYPE.
      //
      // At em * 0.52 the horn came out 42px wide and 46px long under a 951px
      // bubble, and a taper that thin does not read as a speech tail — it
      // reads as a line drawn next to the character. A tail has to be a
      // fraction of the shape it grows from: about a quarter of the box's
      // shorter side across the base, and about half of it long. The em
      // bounds only stop it collapsing on a tiny box or swamping a narrow one.
      var shortSide = Math.min(r.width, r.height);
      var clampTo = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
      var hw = clampTo(shortSide * 0.26, em * 0.7, em * 1.4);
      var len = clampTo(shortSide * 0.5, em * 1.0, em * 2.0);

      // IT POINTS AT HIM. IT DOES NOT REACH HIM.
      //
      // The horn is aimed at his head, and when the bubble sits close the
      // tip simply arrived there — across his beak and over his face. A
      // speech tail indicates the speaker from a distance; one that lands on
      // him reads as a spike through his head. Capped at rather over half
      // the clear gap, so there is always visible air between the point and
      // the bird.
      var gap = edge === 'bottom' ? head.y - (r.top + r.height)
              : edge === 'top'    ? r.top - head.y
              : edge === 'right'  ? head.x - (r.left + r.width)
              :                     r.left - head.x;
      if (gap > 0) len = clampTo(Math.min(len, gap * 0.58), em * 0.7, len);

      // And the tip leans toward his head rather than hanging straight down,
      // so the tail points at the speaker instead of merely starting near him.
      var lean = 0;
      if (vertical) lean = clampTo((head.x - r.left) - (head.x - r.left), -hw, hw);
      var aimAt = vertical ? (head.x - r.left) : (head.y - r.top);
      var base = clampTo(aimAt, hw + em, (vertical ? r.width : r.height) - hw - em);
      // Bounded well inside the base width. The tip stays a clean point at any
      // lean — its two controls sit either side of it by construction — but a
      // tail leaning further than its own base reads as bent rather than aimed.
      lean = clampTo(aimAt - base, -hw * 0.75, hw * 0.75);

      horn = {
        edge: edge,
        at: base,
        hw: hw,
        len: len,
        lean: lean
      };
    }

    skin.setAttribute('width', r.width + pad * 2);
    skin.setAttribute('height', r.height + pad * 2);
    skin.setAttribute('viewBox', '0 0 ' + (r.width + pad * 2) + ' ' + (r.height + pad * 2));
    skin.style.left = -pad + 'px';
    skin.style.top = -pad + 'px';

    var d = outlinePath(r.width, r.height, radius, pad, horn);
    var fill = skin.querySelector('.skin-fill');
    var line = skin.querySelector('.skin-line');
    var sheen = skin.querySelector('.skin-sheen');
    if (fill) fill.setAttribute('d', d);
    if (line) line.setAttribute('d', d);
    if (sheen) {
      // the catch-light, inside the top-left corner
      sheen.setAttribute('cx', pad + radius * 1.1);
      sheen.setAttribute('cy', pad + em * 0.44);
      sheen.setAttribute('rx', em * 0.26);
      sheen.setAttribute('ry', em * 0.1);
      sheen.setAttribute('transform', 'rotate(-22 ' + (pad + radius * 1.1) + ' ' + (pad + em * 0.44) + ')');
    }

    // The bubble grows out of the horn.
    if (horn) {
      var ox = horn.edge === 'left' ? 0 : horn.edge === 'right' ? r.width : horn.at;
      var oy = horn.edge === 'top' ? 0 : horn.edge === 'bottom' ? r.height : horn.at;
      bubble.style.transformOrigin =
        (ox / r.width * 100).toFixed(1) + '% ' + (oy / r.height * 100).toFixed(1) + '%';
    }
  }

  /* The supplied design glides the box between two lines of one speech —
     its greeting is two sentences in the same bubble. That was built and then
     taken out again: no screen in this storyboard says more than one line, so
     it could never once have run. Between screens the box does not glide
     either, because the slot itself can move and a straight interpolation
     between two slots would sweep the bubble across the polygon — which is
     what the snow wipe is for. */

  /**
   * The bubble's rectangle in page pixels, ignoring any transform on it.
   *
   * getBoundingClientRect() reports the PAINTED box, and the bubble spends
   * the first half-second of every screen scaled up out of its own horn — so
   * anything measured from it during the pop is wrong by whatever frame the
   * animation happened to be on. That was quietly true of the old tail
   * aiming, which computed the edge from a rect at 86% of the real size.
   *
   * offsetWidth, offsetHeight, offsetLeft and offsetTop are all layout, not
   * paint, and #game is not itself transformed, so this is the box the CSS
   * actually laid out.
   */
  function layoutRect(el) {
    var p = el.offsetParent || el.ownerDocument.body;
    var pr = p.getBoundingClientRect();
    return {
      left: pr.left + el.offsetLeft, top: pr.top + el.offsetTop,
      width: el.offsetWidth, height: el.offsetHeight
    };
  }


  /**
   * Swiftee's head in page pixels.
   *
   * bounds() is the drawn bird, not the mostly-empty sprite cell; the head is
   * the top fifth of it. Pointing at his centre puts the tail at his chest,
   * which looks like the sledge is talking.
   */
  function headPoint() {
    if (!global.Swiftee || !Swiftee.bounds) return null;
    var b = Swiftee.bounds();
    if (!b || !b.width) return null;
    return { x: b.left + b.width / 2, y: b.top + b.height * 0.18 };
  }

  function setCard(text) {
    // THE CARD CHANGES WHERE THE BUBBLE MAY SIT. placeBubble() treats a shown
    // card as something to stay out of, and reads that at the moment it runs
    // — so a card that appears after the line was placed was simply not
    // there to avoid, and the bubble was left sitting on top of it. Both
    // paths re-place: appearing takes room away, disappearing gives it back.
    if (!text) {
      card.classList.remove('show'); card.textContent = '';
      placeBubble();
      return;
    }
    if (global.DualCode) {
      // Words only. The card used to lead with a pictogram of the gesture —
      // a finger sliding for "drag", and so on — which is good dual coding in
      // principle and was a small grey mark beside a line of text in
      // practice, read as a stray icon rather than as a second channel. The
      // picture half of the pair is the lesson itself, which is the better
      // half to point at, and the tinted terms already bind the words to it.
      card.innerHTML = '<span class="card-text">' + DualCode.markup(text) + '</span>';
    } else {
      card.textContent = text;
    }
    card.classList.add('show');
    placeBubble();
    // Same reasoning as the bubble: the card lives top-left and the polygon
    // panel lives right, so cap it where the panel begins rather than at a
    // percentage that happens to work on one window size.
    var content = Stage.contentBox && Stage.contentBox();
    var cardLeft = card.getBoundingClientRect().left;
    var cardRoom = content ? content.left - cardLeft - 16 : Infinity;
    // Only cap when capping leaves a card worth reading.
    //
    // 200px was not that. Once the compare pair was centred, the room to the
    // left of the lesson fell to about that, the cap took it, and a sentence
    // that fits on one line came out on FIVE in a column narrower than it was
    // tall. A card that has to be capped below a readable width is a card
    // that should not be beside the lesson at all: it sits above it instead,
    // which its own top-left placement already does, and the panels start low
    // enough to leave room for it.
    card.style.maxWidth = (isFinite(cardRoom) && cardRoom >= 420) ? cardRoom + 'px' : '';
    card.style.top = (content && content.top < 90) ? '2%' : '';
    if (global.Juice) Juice.pop(card, { scale: 0.05 });
  }

  /**
   * Re-place everything that is positioned from the layout.
   *
   * Swiftee's position depends on the window, and the bubble's on Swiftee's,
   * so the two have to move together or the tail ends up pointing at empty
   * snow. One function, called from the resize handler and from anything that
   * changes the scene.
   */
  function relayout() {
    Swiftee.relayout();
    // placeBubble, not fitLine: the fit was worked out when the line was set
    // and the settle pass only needs to re-place it. Re-running the whole
    // whole fit here measured a box the previous run had already narrowed.
    placeBubble();
    paintSkin();
  }

  function showNext(on) {
    if (!nextBtn) return;
    nextBtn.classList.toggle('show', !!on);
    nextBtn.disabled = !on;
  }

  function setProgress(i) {
    progress.style.width = ((i + 1) / Screens.list.length * 100).toFixed(1) + '%';
  }

  /* ------------------------------------------------------------------ *
   * Persistence — audio only, kept with the game's own key. sfx.js does
   * no storage of its own; this is the one place that does.
   * ------------------------------------------------------------------ */

  function loadAudio() {
    try { var s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (s && global.SFX) SFX.restore(s); } catch (e) {}
  }
  function saveAudio() {
    try { if (global.SFX) localStorage.setItem(SAVE_KEY, JSON.stringify(SFX.state())); } catch (e) {}
  }

  /* ------------------------------------------------------------------ *
   * Per-tap feedback — fire-and-forget beats, no awaiting.
   * ------------------------------------------------------------------ */

  function fire(beats) {
    (beats || []).forEach(function (b) {
      if (b.sfx && global.SFX) SFX.play(b.sfx, b);
      if (b.juice && global.Juice && Juice[b.juice]) Juice[b.juice](Stage.element(b.target), b);
      if (b.swiftee) Swiftee.play(b.swiftee, b);
      if (b.stage) Stage.apply(b.stage);
    });
  }

  /* ------------------------------------------------------------------ *
   * Director handlers
   * ------------------------------------------------------------------ */

  function handlers() {
    return {
      stage: function (spec) {
        // A beat that (re)builds a scene names the kind; the scene's full
        // configuration — options, bins, items, compare panels — lives on
        // the screen's `stage`. Merge so the beat stays short and the data
        // has one home.
        var scr = Screens.list[current];
        if (spec && spec.kind && scr && scr.stage && scr.stage.kind === spec.kind) {
          spec = Object.assign({}, scr.stage, spec);
        }
        // DOES ANYTHING GO UNDER THE SHAPE ON THIS SCREEN?
        //
        // The shape sits a little above the middle of its panel to leave room
        // for its name, its badge or a row of options. On a screen that has
        // none of those the room is not room, it is a gap: the shape reads as
        // having drifted upward and the bottom third of the panel is empty.
        //
        // The stage cannot know — the label and the badge arrive later, in
        // beats — so it is worked out here, where the whole screen is
        // visible, and passed in.
        if (spec && spec.kind && scr) spec = Object.assign({}, spec, { below: wantsRoomBelow(scr) });
        var wasSolo = soloed();
        Stage.apply(spec);
        // Building or clearing a scene changes whether Swiftee is alone, and
        // "alone" is what decides between centre stage and off to one side.
        // Without this he stays centred over the cards the beat just dealt,
        // until the next move beat happens to fix it.
        // The panel's size and position change what the overlays have room
        // for, so re-place them on every scene build, not only when his side
        // of the screen changes. Twice: once now, and once after the scene's
        // entrance animations have settled, because cards and sort items
        // arrive on staggered timers and the layout they imply is not final
        // until they have.
        relayout();
        clearTimeout(settleTimer);
        settleTimer = setTimeout(relayout, 620);
        void wasSolo;
      },
      swiftee: function (state, opts, ctx) {
        var o = Object.assign({}, opts);
        if (o.at) o.at = Stage.element(o.at);

        var p = Swiftee.play(state, o, ctx);
        if (state === 'move' || state === 'enter') p.then(placeBubble);
        return p;
      },
      say: function (text, opts, ctx) {
        say(text, null, opts.reading);
        // The lesson is read, not spoken. Swiftee still rests on the
        // `talking` loop while a line is up — his mouth moving is what makes
        // the bubble read as him saying it rather than as a caption — and it
        // runs for the director's reading time, which is now what paces the
        // line. Cleared on every exit path, cancellation included.
        Swiftee.speaking(true);
        var stop = function () { clearTimeout(mouthTimer); Swiftee.speaking(false); };
        clearTimeout(mouthTimer);
        mouthTimer = setTimeout(stop, opts.reading || 1200);

        // THE LINE CLEARS ITSELF once it has been read.
        //
        // A spoken line used to stay up until something else replaced it, so
        // narration from the top of a screen was still sitting over the
        // polygon while the child tried to drag it. It comes down a beat after
        // the reading time — long enough to finish the sentence, short enough
        // that the play area is clear while they play in it.
        //
        // NOT when it is the only thing telling them what to do. Screens that
        // carry an instruction card can lose the bubble safely; screens
        // without one would be left saying nothing at all, so those keep it.
        clearTimeout(bubbleTimer);
        bubbleTimer = setTimeout(function () {
          if (card && card.classList.contains('show')) say(null);
        }, (opts.reading || 1200) + 1100);
        if (ctx && ctx.onCancel) ctx.onCancel(function () { clearTimeout(bubbleTimer); });
        if (ctx && ctx.onCancel) ctx.onCancel(stop);
        return Promise.resolve();
      },
      instruction: function (text) { setCard(text); },
      focus: function (target, opts) { Stage.focus(target, opts.style); },
      input: function (spec, ctx) {
        // Next is shown only while the game is actually waiting to be told to
        // move on. Every other interaction wants the child looking at the
        // stage, not at a button in the corner.
        // The line is complete and still before the child is asked to do
        // anything. Narration and interaction could otherwise overlap by a
        // few hundred milliseconds — words still fading in while the polygon
        // had already become draggable — which is the worst possible moment
        // to split a seven-year-old's attention.
        revealAll();

        var waiting = spec.type === 'tap-anywhere';
        showNext(waiting);
        if (ctx && ctx.onCancel) ctx.onCancel(function () { showNext(false); });
        return Stage.waitFor(spec, ctx).then(function (r) {
          showNext(false);
          if (waiting) say(null);
          else if (r && r.result === 'correct') {
            var earned = quest.award(current + ':' + spec.type);
            // The award only fires the first time a screen is solved. Without
            // the else, replaying a screen — or solving one whose XP was
            // already banked — got no reaction at all, which is the same
            // desync as a wrong answer getting none.
            if (earned) reward('+' + earned + ' XP. Challenge complete.', false);
            else react('correct');
          } else if (r && r.result === 'wrong') react('wrong');
          return r;
        }, function (e) { showNext(false); throw e; });
      },
      sfx: function (name, opts) { if (global.SFX) SFX.play(name, opts); },
      juice: function (name, target, opts) { if (global.Juice && Juice[name]) Juice[name](Stage.element(target), opts); }
    };
  }

  /* ------------------------------------------------------------------ *
   * Screen loop
   * ------------------------------------------------------------------ */

  function runScreen(i) {
    var s = Screens.list[i];
    say(null);
    // THE CARD IS CLEARED, NOT INHERITED.
    //
    // It was only ever replaced — set by a screen that has an instruction,
    // and left alone by one that does not. So the card from the screen before
    // stayed up: "Drag the highlighted vertex." over a screen that asks the
    // child to swipe, and again over the builder. Every screen that wants a
    // card sets one in its beats, so clearing here costs nothing and the
    // failure mode it removes is an instruction telling a child to do
    // something the screen cannot do.
    setCard(null);
    clearTimeout(bubbleTimer);

    // AND THE OPTIONS ARE CLEARED, NOT INHERITED.
    //
    // Only a screen that rebuilds the stage replaces them, so a screen that
    // merely highlights something — 'Whoa! One of the diagonals went outside'
    // — kept the previous screen's answer buttons sitting across the bottom.
    // They are inert by then: the interaction that bound them has ended. So a
    // child is shown two buttons, taps one, and nothing happens, which is a
    // worse lesson than no buttons at all.
    if (!screenAsksChoices(s) && global.Stage && Stage.apply) Stage.apply({ choices: null });

    // WHERE HE STANDS ON THIS SCREEN.
    //
    // Every screen in screens.js carries a `swiftee: { pos, size }` block and
    // NOTHING READ IT. He was placed once at boot — left, large — and moved
    // only where a beat explicitly told him to, so thirty-nine screens of
    // carefully chosen positions were dead configuration and he stood in the
    // same spot for the whole lesson, including on the screens whose lesson
    // reaches into that spot.
    //
    // Applied here, before the beats run, so it lands underneath the
    // transition on every screen that wipes rather than as a jump.
    if (s.swiftee && Swiftee.place) {
      var wantPos = s.swiftee.pos || Swiftee.pos;
      var wantSize = s.swiftee.size || Swiftee.size;
      if (wantPos !== Swiftee.pos || wantSize !== Swiftee.size) {
        Swiftee.place(wantPos, wantSize);
        if (Swiftee.el) Swiftee.el.classList.toggle('hover-float', wantPos === 'top-left');
        placeBubble();
      }
    }

    current = i; setProgress(i);
    Stage.onTap(function (kind) { if (s.perTap) fire(s.perTap[kind] || s.perTap.any); react(kind); });
    if (global.Input) Input.mode('locked');
    return director.run(s.beats);
  }

  /**
   * Reveal once the new screen has actually drawn itself.
   *
   * The snow covers the screen before the scene changes, so the rebuild is
   * never seen. What we cannot know in advance is when the rebuild happens:
   * most screens open with a stage beat, some only carry dialogue over from
   * the screen before. So wait for the director's first stage beat, with a
   * short deadline for the screens that never emit one — a transition that
   * hangs waiting for a scene that is not coming would be far worse than one
   * that clears a moment early.
   */
  function revealWhenReady() {
    if (!global.Transition || !Transition.covered || !Transition.covered()) return;
    var done = false;
    var go = function () {
      if (done) return; done = true;
      director.off('stage', go);
      Transition.reveal();
    };
    director.on('stage', go);
    setTimeout(go, 420);
  }

  /**
   * Does this screen build a new scene, or carry on with the one already up?
   *
   * Only twelve of the thirty-nine rebuild the stage. The rest add to what is
   * already there — a label, a diagonal, a badge on the same pentagon.
   */
  /* ------------------------------------------------------------------ *
   * When the snow comes
   *
   * The wipe marks one thing: that there is something new to do. It fires
   * when a screen builds a new scene, or when it asks for a kind of doing
   * the child has not been asked for yet — the first time they have to
   * choose, the first time they have to drag, the first time they have to
   * sort. It never fires for a screen that only says another sentence.
   *
   * Interaction types are grouped into families on purpose. Going from
   * drag-endpoint to drag-vertex is the same hand doing the same thing; it
   * does not deserve a storm. Going from dragging to sorting does.
   *
   * tap-anywhere maps to nothing. It is not an interaction, it is reading —
   * counting it would put a wipe between every second screen and bury the
   * lesson in weather.
   * ------------------------------------------------------------------ */

  var FAMILY = {
    'tap-anywhere':  null,      // reading on, not doing
    'choice':        'choose',
    'multi-select':  'choose',
    'vertex-pick':   'pick',
    'tap-each':      'pick',
    'drag-endpoint': 'drag',
    'drag-vertex':   'drag',
    'draw-diagonal': 'draw',
    'draw-diagonals':'draw',
    'sort':          'sort',
    'stepper':       'build'
  };

  function inputTypes(s) {
    var out = [];
    ((s && s.beats) || []).forEach(function (b) {
      if (!b) return;
      if (b.input && b.input.type) out.push(b.input.type);
      if (b.parallel) b.parallel.forEach(function (p) {
        if (p && p.input && p.input.type) out.push(p.input.type);
      });
    });
    if (s && s.input && s.input.type) out.push(s.input.type);
    return out;
  }

  /** The first real interaction a screen asks for, as a family, or null. */
  function familyOf(s) {
    var t = inputTypes(s), i, f;
    for (i = 0; i < t.length; i++) { f = FAMILY[t[i]]; if (f) return f; }
    return null;
  }

  function rebuildsScene(i) {
    var s = Screens.list[i];
    return !!(s && (s.beats || []).some(function (b) { return b && b.stage && b.stage.kind; }));
  }

  // Worked out once from the storyboard rather than from runtime state, so
  // it is the same on a replay, the same when a screen is entered out of
  // order, and answerable by a test without playing the game.
  var wipeTable = null;
  function wipesAt(i) {
    if (!wipeTable) {
      var last = null;
      wipeTable = (Screens.list || []).map(function (s, k) {
        var fam = familyOf(s);
        var newDoing = !!fam && fam !== last;
        if (fam) last = fam;
        return k > 0 && (rebuildsScene(k) || newDoing);
      });
    }
    return !!wipeTable[i];
  }

  /**
   * The wipe between screens — and, more importantly, when NOT to wipe.
   *
   * A snow wipe hides a scene change, which is exactly what you want when the
   * scene changes. Running it between every screen did two bad things. It
   * spent about fifteen seconds of the lesson on white-outs nobody asked for.
   * And on the twenty-seven screens that keep the same shape it destroyed the
   * continuity the teaching depends on: the child picks a vertex, the screen
   * whites out, and the next line says "I will connect it to another vertex"
   * about a vertex they can no longer see they chose.
   *
   * So the wipe marks new work: a new scene, or a new kind of doing. Screens
   * that only carry the lesson forward a sentence flow into each other, which
   * is what makes them read as one continuous demonstration rather than a
   * slideshow. See wipesAt() above for the rule.
   *
   * The first screen is exempt too: the arrival is the opening, and burying
   * it under snow would waste it.
   */
  function changeScreen(i, first) {
    if (first || !global.Transition || !wipesAt(i)) {
      var r = runScreen(i);
      revealWhenReady();
      return r;
    }
    return Transition.cover().then(function () {
      var p = runScreen(i);
      revealWhenReady();
      return p;
    });
  }

  async function play(from) {
    if (playing) return; playing = true;
    var start = from || 0;
    for (var i = start; i < Screens.list.length; i++) {
      var r = await changeScreen(i, i === start);
      if (r === Director.CANCELLED) { playing = false; return; }
      var badge = quest.complete(i);
      if (badge) { reward('Badge unlocked: ' + badge.name + '.', true); }
    }
    playing = false;
    finish();
  }

  function finish() {
    say(null); setCard(null); showNext(false);
    say('Honk-tastic! ' + quest.snapshot().xp + ' XP and ' + quest.snapshot().badges.length + ' badges. You are a polygon adventurer!', 'win');
    if (global.Juice) { Juice.confetti(Stage.svg, { count: 60 }); Juice.confetti(Stage.svg, { count: 40, offsetX: -200 }); }
    if (global.SFX) SFX.sequence(['drumroll', 1.2, 'levelUp', 0.3, 'sparkle']);
    // The end of the whole lesson earns the biggest clip in the rig, then
    // settles into `proud`. Everywhere else `celebrate` is the ceiling.
    Swiftee.play('excited').then(function () { return Swiftee.play('proud'); });
    hud.querySelector('.replay').classList.add('show');
  }

  function restart() {
    director.abort(); playing = false; showNext(false);
    clearTimeout(rewardTimer);
    quest = Quest.create(); say(null);
    $('#reward').classList.remove('show');
    hud.querySelector('.replay').classList.remove('show');
    Stage.apply({ kind: 'vista' });
    Swiftee.place('left', 'large');
    setTimeout(function () { play(0); }, 200);
  }

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */

  function boot() {
    root = $('#game'); stageEl = $('#stage'); hud = $('#hud'); bubble = $('#bubble');
    card = $('#card'); progress = $('#progress'); loadEl = $('#loading'); nextBtn = $('#next');

    Stage.mount(stageEl);
    Swiftee.mount(root, { layout: layout });
    Swiftee.place('left', 'large'); Swiftee.visible(false);   // he flies in on screen 1

    if (global.Juice) Juice.stage(stageEl);
    if (global.Transition) Transition.mount(root);
    if (global.Input) {
      Input.attach(stageEl);
      Input.mode('locked');
      // A tap on the stage fast-forwards the narration text. It does NOT
      // advance the screen — that is the Next button's job, and keeping the
      // two separate is what stopped an impatient tap from also poking the
      // vertex underneath it.
      // A tap finishes the line first. Only once it is all there does the
      // same gesture shorten the hold — otherwise an impatient child skips
      // past words they never saw.
      Input.on('tap', function () {
        if (revealAll()) return;
        director.skip();
      });
    }
    if (global.SFX) SFX.key('C pentatonic');
    loadAudio();

    director = Director.create(handlers(), { msPerWord: 300, sayMinMs: 1100 });


    // HUD wiring. Audio is optional at every call site: a build without
    // sfx.js should still teach the lesson silently rather than die on boot.
    var muteBtn = hud.querySelector('.mute');
    muteBtn.addEventListener('click', function () {
      var m = global.SFX ? SFX.mute() : true;
      this.classList.toggle('on', m); this.setAttribute('aria-pressed', String(m)); saveAudio();
    });
    nextBtn.addEventListener('click', function () {
      if (global.SFX) SFX.play('select');
      if (global.Input) Input.advance();
    });
    // Keyboard parity: a child on a laptop should not have to find the mouse.
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'ArrowRight') return;
      if (!nextBtn.classList.contains('show')) return;
      e.preventDefault();
      if (global.SFX) SFX.play('select');
      if (global.Input) Input.advance();
    });

    hud.querySelector('.restart').addEventListener('click', restart);
    hud.querySelector('.replay').addEventListener('click', restart);
    muteBtn.classList.toggle('on', !!(global.SFX && SFX.isMuted()));

    // Tap anywhere on the bubble skips narration too.
    bubble.addEventListener('pointerdown', function () { director.skip(); });

    window.addEventListener('resize', relayout);

    // Everything positioned from a measurement has to be measured again once
    // the real font is in. Until Nunito loads, the bubble is laid out in the
    // fallback face, comes out narrower, and is placed on that basis — then
    // the webfont arrives, it reflows wider, and the right-hand edge ends up
    // over the panel it was carefully kept clear of.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(relayout, function () {});
    }

    loadEl.classList.add('ready');
    if (global.TitleFx) TitleFx.mount(loadEl);

    // Audio needs a real gesture. The start button is that gesture, so
    // nothing plays before the learner is ready.
    wireJump();

    // POINTERDOWN, NOT CLICK, for everything the child is meant to feel.
    // click does not fire until the finger lifts, and by then this handler is
    // also dropping the curtain — so the pop and the squash were being played
    // behind the thing that covers them. The gesture that unlocks audio is
    // the press, so the cue can land on the press too.
    var startEl = $('#start');
    var armed = false;
    startEl.addEventListener('pointerdown', function () {
      if (armed) return;
      armed = true;
      if (global.SFX) { SFX.unlock(); SFX.play('pop'); }
      if (global.TitleFx) TitleFx.pressDown();
    });
    // Released without completing the tap: undo the squash, keep the screen.
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
      startEl.addEventListener(ev, function () {
        if (!armed) return;
        armed = false;
        if (global.TitleFx) TitleFx.pressUp();
      });
    });

    startEl.addEventListener('click', function () {
      // The gesture that unlocks audio is also the first thing that should
      // make a sound. Unlock, then play on the same tick — the context is
      // resumed by the gesture, so the cue lands with the press rather than
      // a screen later.
      // sequence(), not two play() calls with a delay option: a cue only
      // honours the options it reads, and sparkle reads none — so the delay
      // was ignored and both landed on the same instant as one thicker pop.
      // The pop already rang on the press; this is the release on top of it.
      if (global.SFX) { SFX.unlock(); SFX.play('sparkle'); }
      if (global.TitleFx) { TitleFx.pressUp(); TitleFx.press(); }
      // A beat before the curtain, so the burst is something the child sees
      // rather than something the transition eats.
      setTimeout(function () { loadEl.classList.add('gone'); }, 120);
      // The title screen's weather is thirty infinite animations. Nothing can
      // see them once the curtain is down, so they are cancelled rather than
      // left running behind the lesson for the rest of the session.
      setTimeout(function () { if (global.TitleFx) TitleFx.stop(); }, 640);
      setTimeout(function () { play(0); }, 430);
    });
  }

  /**
   * TEMPORARY: the screen picker in the top-left corner.
   *
   * Reviewing a layout means looking at one screen, not at the thirty-eight
   * in front of it. This lists every screen by number and id and jumps
   * straight there.
   *
   * Delete this function, its call in boot(), the #jump element and the
   * #jump rules in the stylesheet, and nothing else changes — it reads the
   * screen list and calls the same play() the lesson does, and owns no state
   * of its own. It also keeps itself in step: jumping by any other route
   * still moves the selection, so the box never claims you are somewhere you
   * are not.
   */
  function wireJump() {
    var box = $('#jump-sel');
    if (!box || !global.Screens) return;
    Screens.list.forEach(function (s, i) {
      var o = document.createElement('option');
      o.value = i;
      o.textContent = (i + 1) + '. ' + s.id;
      box.appendChild(o);
    });
    box.addEventListener('change', function () {
      var n = +box.value;
      if (!(n >= 0 && n < Screens.list.length)) return;
      // play() is a loop over the remaining screens and refuses to start a
      // second one while the first is running, so jumping is not 'call play'
      // — it is 'end the loop that is running, then start one at n'. abort()
      // makes the awaited screen resolve CANCELLED, which is that loop's own
      // way out; the beat after it is so the old loop has unwound before the
      // new one claims the flag.
      director.abort();
      playing = false;
      showNext(false);

      // Some screens never build a stage — they add a question to whatever
      // the screen before them put up. Played in order that is exactly
      // right; jumped to, it means you inherit whichever stage happened to
      // be on screen, which for a picker is every stage but the correct one.
      // So walk back to the nearest screen that does declare one and build
      // that first.
      for (var b = n; b >= 0; b--) {
        var sp = Screens.list[b].stage;
        if (sp && sp.kind) { Stage.apply(sp); break; }
      }
      box.blur();                       // so the arrow keys go back to the lesson
      setTimeout(function () { play(n); }, 80);
    });
    if (director && director.on) {
      director.on('start', function () {
        if (current >= 0 && +box.value !== current) box.value = current;
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  global.Game = {
    restart: restart, play: play, relayout: relayout,
    get screen() { return current; },
    get director() { return director; }
  };

})(typeof window !== 'undefined' ? window : this);
