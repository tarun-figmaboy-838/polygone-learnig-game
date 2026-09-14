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
  var director, current = -1, playing = false, settleTimer = null, mouthTimer = null;
  var SAVE_KEY = 'swiftee.audio';
  var quest = Quest.create(), rewardTimer;

  function reward(text) {
    clearTimeout(rewardTimer);
    $('#reward').textContent = text;
    $('#reward').classList.add('show');
    rewardTimer = setTimeout(function () { $('#reward').classList.remove('show'); }, 3200);
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
  function react(kind) {
    if (kind === 'wrong') quest.mistake();
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

  function layout(pos, size) {
    var f = frame();

    // stageH * wanted fraction = cell * scale * CONTENT_FRAC
    var want = BIRD_H[size] || BIRD_H.medium;
    var scale = (f.h * want) / (256 * CONTENT_FRAC);

    var map = {
      'left':               { x: 0.20, y: 0.88 },
      'left-low':           { x: 0.15, y: 0.97 },
      'polygon-top-right':  { x: 0.905, y: 0.34 },
      'centre':             { x: 0.50, y: 0.93 },
      'off':                { x: -0.3, y: 0.9 }
    };
    if (f.portrait) {
      // Stage letterboxes; put Swiftee below the box so he never covers it.
      map['left'] = { x: 0.18, y: 1.02 }; map['left-low'] = { x: 0.16, y: 1.02 };
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

  function reveal(line, ms) {
    clearInterval(revealTimer); revealTimer = null;
    var units = unitsOf(line);
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
    if (!text) { bubble.classList.remove('show'); return; }
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
    bubble.classList.add('show');
    // Place it at full size FIRST, then start hiding words. The other order
    // would measure an empty bubble.
    placeBubble();
    reveal(line, ms);
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
    var GAP = 14, MIN_W = 240, MIN_H = 64;

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
      // A short line shrinks the bubble to fit it — "Hi! I am Swiftee." came
      // out 291px wide in a 1280px scene, and next to a 217px bird in an
      // empty snowfield that reads as two small stickers rather than a
      // composed shot. On a screen with nothing else on it the panel gets a
      // real minimum, so every line lands in the same substantial frame
      // instead of the frame shrink-wrapping the sentence.
      bubble.style.minWidth = Math.round(Math.min(460, f.w * 0.4)) + 'px';
      bubble.style.maxWidth = Math.min(f.w * 0.72, 620) + 'px';
      bubble.style.left = '50%';
      bubble.style.marginLeft = -(bubble.offsetWidth / 2) + 'px';
      var birdTop = L.y - 256 * layout(Swiftee.pos, 'large').scale * CONTENT_FRAC;
      bubble.style.top = Math.max(hudBox.bottom + GAP, birdTop - bubble.offsetHeight - 26) + 'px';
      // He is directly below the bubble on these screens, so the tail goes
      // down the middle rather than off to one side.
      // He stands directly below on these screens, so the tail stays in the
      // middle — which is where it sits by default.
      bubble.classList.remove('tail-left');
      bubble.classList.remove('tail-right');
      return;
    }

    var top = Math.max(GAP, (cardBox ? cardBox.bottom + 10 : GAP));
    var bottom = vh - GAP - (nextBox ? nextBox.height + 16 : 0);

    // The bands around the lesson, and the bands through it. Each is a place
    // a bubble could live.
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
      return (r.id === 'left' || r.id === 'right')
        ? Math.min(r.w - SAFE, 520)
        : Math.min(r.w - SAFE, vw * 0.8);
    };

    // Measure the LAYOUT box. The bubble now plays a bouncy entrance that
    // scales it from 82% to 103% and back, so the painted box is whatever
    // frame the animation happens to be on when we look — useless for
    // deciding whether a sentence fits beside a polygon. offsetWidth and
    // offsetHeight ignore transforms and report where the box actually is.
    // The settle pass re-runs this once the animation is over anyway.
    var size = function () { return { w: bubble.offsetWidth, h: bubble.offsetHeight }; };

    var slot = null, w = 0, h = 0, best = Infinity;
    for (var si = 0; si < slots.length; si++) {
      bubble.style.maxWidth = capFor(slots[si]) + 'px';
      var m = size();
      if (m.h <= slots[si].h) { slot = slots[si]; break; }
      if (m.h - slots[si].h < best) { best = m.h - slots[si].h; slot = slots[si]; }
    }
    bubble.style.maxWidth = capFor(slot) + 'px';
    var m2 = size(); w = m2.w; h = m2.h;
    var wantX = (slot.id === 'left' || slot.id === 'right')
      ? L.x - w / 2
      : (onLeft ? Math.max(slot.x, L.x - w * 0.35) : Math.min(slot.x + slot.w - w, L.x - w * 0.65));
    var wantY = (slot.id === 'left' || slot.id === 'right')
      ? L.y - 256 * L.scale * CONTENT_FRAC - h - 26
      : slot.y + (slot.h - h) / 2;

    var x = Math.max(slot.x, Math.min(wantX, slot.x + slot.w - w));
    var y = Math.max(slot.y, Math.min(wantY, slot.y + slot.h - h));

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
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (r.left < p.right && r.right > p.left && r.top < p.bottom && r.bottom > p.top) return true;
      }
      return false;
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

    // The tail points down at him when he is below the bubble, which is the
    // only case it can be honest about.
    // The tail points at the speaker: right by default, mirrored when he is
    // standing to the left of the bubble, which he usually is.
    // The tail points at the speaker, whichever side of the bubble he is on.
    var onHisLeft = L.x < parseFloat(bubble.style.left) + w / 2;
    bubble.classList.toggle('tail-left', onHisLeft);
    bubble.classList.toggle('tail-right', !onHisLeft);
  }

  function setCard(text) {
    if (!text) { card.classList.remove('show'); card.textContent = ''; return; }
    if (global.DualCode) {
      // The card says what to do; the pictogram shows it. Same instruction,
      // two channels, side by side — a child who cannot yet read "Drag"
      // fluently still sees a finger sliding.
      card.innerHTML = DualCode.gesture(text) + '<span class="card-text">' + DualCode.markup(text) + '</span>';
    } else {
      card.textContent = text;
    }
    card.classList.add('show');
    // Same reasoning as the bubble: the card lives top-left and the polygon
    // panel lives right, so cap it where the panel begins rather than at a
    // percentage that happens to work on one window size.
    var content = Stage.contentBox && Stage.contentBox();
    var cardLeft = card.getBoundingClientRect().left;
    var cardRoom = content ? content.left - cardLeft - 16 : Infinity;
    // Only cap when capping helps. On a centred panel there is no room to the
    // left at all, and forcing a minimum width there just guarantees the
    // overlap it was meant to prevent — the card sits above the panel instead,
    // which its own top-left placement already achieves.
    card.style.maxWidth = (isFinite(cardRoom) && cardRoom >= 200) ? cardRoom + 'px' : '';
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
    placeBubble();
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
            if (earned) { reward('✦ +' + earned + ' XP · Challenge complete!'); }
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
  function rebuildsScene(i) {
    var s = Screens.list[i];
    return !!(s && (s.beats || []).some(function (b) { return b && b.stage && b.stage.kind; }));
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
   * So the wipe marks a change of place, and only that. Screens that carry
   * the same shape now flow into each other, which is what makes them read as
   * one continuous demonstration rather than a slideshow.
   *
   * The first screen is exempt too: the arrival is the opening, and burying
   * it under snow would waste it.
   */
  function changeScreen(i, first) {
    if (first || !global.Transition || !rebuildsScene(i)) {
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
      if (badge) { reward(badge.icon + ' Badge unlocked: ' + badge.name + '!'); }
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

    // Audio needs a real gesture. The start button is that gesture, so
    // nothing plays before the learner is ready.
    $('#start').addEventListener('click', function () {
      if (global.SFX) SFX.unlock();
      loadEl.classList.add('gone');
      setTimeout(function () { play(0); }, 250);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  global.Game = {
    restart: restart, play: play, relayout: relayout,
    get screen() { return current; },
    get director() { return director; }
  };

})(typeof window !== 'undefined' ? window : this);
