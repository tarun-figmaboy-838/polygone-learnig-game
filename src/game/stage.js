/*!
 * stage.js — everything the learner sees and touches, except Swiftee.
 *
 * One SVG, viewBox 1000×562, scaled by CSS. The scene kinds (BUILD) and a
 * set of incremental ops from screens.js; the interaction types (INTERACT),
 * each returning a promise the director awaits.
 *
 * Nothing here decides right or wrong. Every judgement is a call into
 * polygon-math.js on the live vertices, so the shape on screen and the
 * verdict can never disagree.
 */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var W = 1000, H = 562;

  /** The painted backdrop. 16:9, which is exactly the viewBox's aspect. */

  var svg, layers = {}, st = {};

  /* SEATING. Every panel is laid out under the plank's band, because a scene
     is often carried into a screen that shows a plank. On a screen with no
     plank at all — Swiftee says the line — that band is empty, and the card
     sat low. So the whole scene (panel, shape, controls, effects) is drawn
     with one translate on its layers: lifted to centre the card when the
     screen is plank-free, and eased back down when a plank arrives on a
     carried scene. Stage coordinates never change; the few readers that map
     stage to page (pt, contentParts, contentBox, nook, peekAnchor, the
     measuring flight) add seatY. */
  var seatY = 0, plankFree = false;
  var SEAT_LAYERS = ['panel', 'poly', 'ui', 'fx'];
  function applySeat(animate) {
    // the builder is a single card too (with its stepper under it): it sat
    // unseated, a fifth of the screen of empty sky above it and the stepper
    // on the floor
    var p = ((st.kind === 'polygon' || st.kind === 'builder') && st.panel) ? st.panel : null;
    /* CENTRED ON WHAT IS THERE. A fixed lift of 52 centred a full card, and a
       card with its answer row under it — and left a card whose row had gone
       (lets-change, drag-inward, whoa carry the Inside/Outside card on)
       sitting high over 180px of empty snow. The scene is the card, plus the
       control band when it has one, centred in the stage; its foot never
       comes below Next's top (495), and the lift never passes 64. */
    var target = 0;
    if (plankFree && p) {
      var band = (p.controls || st.stepperG) ? CONTROL_GAP + CONTROL_H : 0;
      var groupH = p.h + band;
      var want = Math.max(40, (H - groupH) / 2);
      var lift = Math.max(p.y - want, (p.y + p.h) - 490);
      target = -Math.max(0, Math.min(64, lift));
    }
    if (target === seatY) return;
    var from = seatY; seatY = target;
    SEAT_LAYERS.forEach(function (n) {
      var g = layers[n]; if (!g) return;
      g.setAttribute('transform', target ? 'translate(0,' + target + ')' : '');
      if (animate && !reduced() && g.animate) {
        try {
          g.animate([{ transform: 'translate(0,' + from + 'px)' }, { transform: 'translate(0,' + target + 'px)' }],
                    { duration: 640, easing: 'cubic-bezier(.22,1,.36,1)' });
        } catch (e) {}
      }
    });
  }
  var onTap = function () {};       // game.js hooks perTap feedback here
  /* The things the child does, by name — vertex:selected, diagonal:start,
     measurement:complete, answer:selected — for the director's event stream.
     game.js connects it; the stage only says what happened. */
  var onEvent = function () {};
  function evt(name, payload) { try { onEvent(name, payload || {}); } catch (e) {} }
  var cleanup = [];                 // listeners to remove when an interaction ends

  /* ------------------------------------------------------------------ *
   * DOM helpers
   * ------------------------------------------------------------------ */

  function mk(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in (attrs || {})) {
      if (k === 'text') e.textContent = attrs[k];
      else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    }
    (parent || layers.ui).appendChild(e);
    return e;
  }
  function clear(layer) { var l = layers[layer]; while (l.firstChild) l.removeChild(l.firstChild); }
  function pt(e) {
    var p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
    var m = svg.getScreenCTM(); if (!m) return { x: 0, y: 0 };
    var q = p.matrixTransform(m.inverse());
    return { x: q.x, y: q.y - seatY };   // into the seated layers' own space
  }
  function on(el, ev, fn, opts) { el.addEventListener(ev, fn, opts); cleanup.push(function () { el.removeEventListener(ev, fn, opts); }); }
  /**
   * HINTS WAIT FOR THE CHILD TO NEED THEM.
   *
   * This used to put its hint up the instant an input armed — a breathing
   * corner, a ghost sliding across the card — and keep it going, forever,
   * until the first touch. So every screen opened with something moving at
   * the child while they were still reading what to do, and a child who
   * stopped to think was pulsed at the whole time they thought.
   *
   * It is a ladder now, and it only climbs while nothing is happening:
   *
   *   level 1   at once: the targets are simply shown as touchable — the
   *             corners visible, the hand cursor, a steady glow on a side.
   *             Nothing moves. (The interaction does this itself.)
   *   level 2   after HINT_PULSE_MS of stillness, the targets pulse ONCE.
   *   level 3   HINT_DEMO_MS after that, the move is shown once — a ghost
   *             running the gesture — or, where there is no gesture to show,
   *             a clearer pulse.
   *   then      level 3 again every HINT_AGAIN_MS for as long as they wait,
   *             so a child is never left with nothing, and never pulsed at.
   *
   * Anything the child does puts it back to the bottom: a press takes the hint
   * down at once, and no hint is ever started while a finger is on the glass.
   * A pointer that is only moving counts as trying, and restarts the wait.
   *
   * `opts.pulse` and `opts.demo` each build a hint from the screen as it is
   * NOW and return its stop function.
   */
  // 2.5s of stillness before the first, single hint (the polish pass: 2.5–3s;
  // the diagonal pass: about 2s), the move shown 7s after that, and then no
  // oftener than every 12s — a child thinking is not pulsed at.
  // (the demo 4.5s after the first pulse, not 7s: a move a child has never
  // made is shown while they are still looking for it, not after they have
  // given up — the user: "add hand hint... only for user idle")
  var HINT_PULSE_MS = 2500, HINT_DEMO_MS = 4500, HINT_AGAIN_MS = 12000;
  function hintLadder(opts) {
    if (reduced() || !svg) return;
    var pulse = opts.pulse || null, demo = opts.demo || opts.pulse || null;
    var stop = null, t = null, live = true, pressing = false, lastMove = 0;
    var hide = function () { if (stop) { try { stop(); } catch (e) {} stop = null; } };
    var run = function (fn) { hide(); if (!live || pressing || !fn) return; try { stop = fn() || null; } catch (e) { stop = null; } };
    var climb = function (level) {
      clearTimeout(t);
      if (!live) return;
      var wait = level === 2 ? HINT_PULSE_MS : level === 3 ? HINT_DEMO_MS : HINT_AGAIN_MS;
      t = setTimeout(function () {
        if (!live || pressing) return;
        run(level === 2 ? pulse : demo);
        // said on the event stream, so the companion can make his ONE small
        // gesture toward it (game.js) without the stage knowing he exists
        evt('hint:show', { rung: level === 2 ? 'pulse' : 'demo' });
        climb(level === 2 ? 3 : 4);
      }, wait);
    };
    on(svg, 'pointerdown', function () { pressing = true; hide(); clearTimeout(t); });
    var release = function () { pressing = false; climb(2); };
    on(svg, 'pointerup', release);
    on(svg, 'pointercancel', release);
    on(svg, 'pointermove', function () {
      if (pressing) return;
      var now = Date.now();
      if (now - lastMove < 200) return;       // a moving pointer is one signal, not sixty
      lastMove = now;
      // It restarts the wait, and it leaves what is showing alone: a mouse
      // drifting toward the corner the ghost pointed at is the child FOLLOWING
      // the hint, and taking the ghost's end mark away under it would hide the
      // very place they are heading for. Only a press takes a hint down.
      climb(2);
    });
    cleanup.push(function () { live = false; hide(); clearTimeout(t); });
    climb(2);
  }

  /**
   * THE TAP GHOST. Two ice rings close on the place to tap, again and
   * again, until the child touches the stage. The tapping equivalent of the
   * drag ghost: it shows the gesture, on the first of the things to tap.
   */
  /**
   * WHERE TO TAP: THE THING ITSELF BREATHES.
   *
   * This drew a ring that grew out of the tap point and faded — a ripple.
   * On a card it read as a target painted over the picture, and on the
   * choose-the-polygons grid it was drawn over a CORRECT card, which handed
   * the child the answer. What is tappable now swells and settles, a little
   * out of step with its neighbours, so the invitation is the object and
   * every valid object gets it.
   *
   * Animates `scale`, never `transform`: half the furniture here is placed
   * by a transform attribute and animating that would throw it to the origin.
   */
  /* ONCE, NOT FOREVER. A hint is a nudge the child can notice and then
     forget; a pulse that never stops is a screen talking over them. `o.strong`
     is the ladder's clearer rung: a little bigger, twice. A line has no body
     to swell, so a side brightens instead. */
  function pulseHint(els, o) {
    o = o || {};
    if (reduced() || !svg) return function () {};
    var list = (els || []).filter(Boolean);
    if (!list.length) return function () {};
    var anims = [];
    var peak = o.strong ? '1.12' : '1.075', times = o.strong ? 2 : 1;
    list.slice(0, 10).forEach(function (e, i) {
      if (!e.animate) return;
      try {
        if (e.tagName === 'line' || e.tagName === 'path') {
          anims.push(e.animate([{ strokeOpacity: 0.45 }, { strokeOpacity: 1 }, { strokeOpacity: 0.45 }],
            { duration: o.pop ? 600 : 900, iterations: times, delay: i * (o.pop ? 80 : 110), easing: 'ease-in-out' }));
          return;
        }
        e.style.transformBox = 'fill-box'; e.style.transformOrigin = 'center';
        // o.pop: one quick springy "here!" — up, a touch past, and settle
        anims.push(o.pop
          ? e.animate([{ scale: '1' }, { scale: '1.22', offset: 0.35 }, { scale: '0.96', offset: 0.7 }, { scale: '1' }],
                      { duration: 480, delay: i * 80, easing: 'ease-out' })
          : e.animate([{ scale: '1' }, { scale: peak }, { scale: '1' }],
                      { duration: 900, iterations: times, delay: i * 110, easing: 'ease-in-out' }));
      } catch (x) {}
    });
    var stop = function () { anims.forEach(function (a) { try { a.cancel(); } catch (e) {} }); anims = []; };
    cleanup.push(stop);
    return stop;
  }


  /* ------------------------------------------------------------------ *
   * THE HAND (assets/ui/hand.webp, built by tools/build-hand.js)
   *
   * The ladder's last rung shows the gesture with a hand, because that is
   * what a child copies: a glove whose FINGERTIP (HandArt.tip, measured from
   * the artwork) lands exactly on the thing, presses, and lifts. It is about
   * a fingertip's size beside a corner knob — big enough to read as a hand,
   * small enough never to cover the shape it points into — with a soft shadow
   * under it so it floats just above the glass.
   *
   * It only ever shows a MOVE, never an answer: it taps a corner when any
   * corner is right, a side when every side is to be measured, the stepper
   * the target asks for; it rides a drag ghost. It never taps a choice.
   * ------------------------------------------------------------------ */
  var HAND_H = 62;   // stage units; the glove is 62 tall, its tip ~8 across
  if (global.HandArt && typeof Image !== 'undefined') { try { (new Image()).src = HandArt.src; } catch (e) {} }
  /** A glove with its fingertip at (x, y) in `parent`. Mirrored when the
      glove would run off the stage's right edge, so it always comes in from
      the side there is room on. */
  function handAt(parent, x, y) {
    var A = global.HandArt; if (!A || !A.src) return null;
    var h = HAND_H, w = h * A.w / A.h, tx = A.tip.x * w, ty = A.tip.y * h;
    var flip = x + (w - tx) > W - 6;
    var g = mk('g', { 'class': 'hint-hand', 'pointer-events': 'none', transform: 'translate(' + x.toFixed(1) + ',' + y.toFixed(1) + ')' }, parent);
    // the press, felt: a ring leaves the fingertip
    var ripple = mk('circle', { cx: 0, cy: 0, r: 18, fill: 'none', stroke: '#ffffff', 'stroke-width': 3, opacity: 0 }, g);
    var body = mk('g', flip ? { transform: 'scale(-1,1)' } : {}, g);
    var im = mk('image', { x: (-tx).toFixed(1), y: (-ty).toFixed(1), width: w.toFixed(1), height: h.toFixed(1), preserveAspectRatio: 'none' }, body);
    im.setAttribute('href', A.src); im.setAttributeNS('http://www.w3.org/1999/xlink', 'href', A.src);
    im.style.filter = 'drop-shadow(0 3px 2.5px rgba(8, 44, 96, .35))';
    im.style.transformBox = 'fill-box'; im.style.transformOrigin = (A.tip.x * 100).toFixed(1) + '% ' + (A.tip.y * 100).toFixed(1) + '%';
    ripple.style.transformBox = 'fill-box'; ripple.style.transformOrigin = 'center';
    return { g: g, img: im, ripple: ripple, side: flip ? -1 : 1 };
  }
  /** Where a hint target is, in stage units: a knob's centre, a line's
      middle, a pill's box. */
  function centreOf(el) {
    if (!el) return null;
    if (el._rect) return { x: el._rect.x + el._rect.w / 2, y: el._rect.y + el._rect.h / 2 };
    var tag = (el.tagName || '').toLowerCase();
    if (tag === 'circle') return { x: +el.getAttribute('cx'), y: +el.getAttribute('cy') };
    if (tag === 'line') return { x: (+el.getAttribute('x1') + +el.getAttribute('x2')) / 2, y: (+el.getAttribute('y1') + +el.getAttribute('y2')) / 2 };
    try { var b = el.getBBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; } catch (e) { return null; }
  }
  /** THE TAP, SHOWN: in from below and to the side, onto the thing, two
      presses — the glove dips, a ring leaves the fingertip — and away. Once
      per rung; the ladder's press, or the interaction ending, takes it down. */
  function tapHand(p, o) {
    o = o || {};
    if (reduced() || !svg || !p || !isFinite(p.x) || !isFinite(p.y)) return function () {};
    var Hd = handAt(layers.fx, p.x, p.y); if (!Hd) return function () {};
    var s1 = Hd.side, ms = o.duration || 2800, anims = [];
    var lift = (s1 * 7) + 'px 8px', away = (s1 * 30) + 'px 38px';
    try {
      anims.push(Hd.g.animate([
        { translate: away, opacity: 0, offset: 0 },
        { translate: lift, opacity: 1, offset: 0.16 },
        { translate: '0px 0px', opacity: 1, offset: 0.26 },     // press
        { translate: lift, opacity: 1, offset: 0.37 },
        { translate: '0px 0px', opacity: 1, offset: 0.5 },      // and again
        { translate: lift, opacity: 1, offset: 0.61 },
        { translate: lift, opacity: 1, offset: 0.8 },
        { translate: away, opacity: 0, offset: 1 }
      ], { duration: ms, easing: 'ease-in-out', fill: 'forwards' }));
      anims.push(Hd.img.animate([
        { scale: '1', offset: 0 }, { scale: '1', offset: 0.2 }, { scale: '.9', offset: 0.26 }, { scale: '1', offset: 0.34 },
        { scale: '1', offset: 0.44 }, { scale: '.9', offset: 0.5 }, { scale: '1', offset: 0.58 }, { scale: '1', offset: 1 }
      ], { duration: ms }));
      anims.push(Hd.ripple.animate([
        { opacity: 0, scale: '.3', offset: 0 }, { opacity: 0, scale: '.3', offset: 0.26 },
        { opacity: 0.9, scale: '.45', offset: 0.27 }, { opacity: 0, scale: '1.3', offset: 0.42 },
        { opacity: 0, scale: '.3', offset: 0.5 }, { opacity: 0.9, scale: '.45', offset: 0.51 },
        { opacity: 0, scale: '1.3', offset: 0.66 }, { opacity: 0, scale: '.3', offset: 1 }
      ], { duration: ms }));
    } catch (e) {}
    var live = true;
    var stop = function () { if (!live) return; live = false; anims.forEach(function (a) { try { a.cancel(); } catch (e) {} }); if (Hd.g.parentNode) Hd.g.remove(); };
    if (anims[0] && anims[0].finished) anims[0].finished.then(stop, function () {});
    cleanup.push(stop);
    return stop;
  }
  /** Two hints as one: the strong pulse on every target, and the hand on one. */
  function both(a, b) { return function () { try { a && a(); } catch (e) {} try { b && b(); } catch (e) {} }; }

  function endInteraction() {
    cleanup.splice(0).forEach(function (f) { f(); });
    // NOTHING INACTIVE SHOWS A HAND. Whatever an interaction dressed as
    // touchable is plain again the moment the interaction is over.
    if (svg) {
      svg.style.cursor = '';
      var dressed = svg.querySelectorAll('[style*="cursor"]');
      for (var i = 0; i < dressed.length; i++) dressed[i].style.cursor = '';
    }
  }
  function pathOf(v) { return v.map(function (p, i) { return (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' ') + ' Z'; }
  /** The same chain of points, left open: one side is a line, two are a corner. */
  function pathOpen(v) { return v.map(function (p, i) { return (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' '); }
  /** Is the figure on the stage still open — fewer than three sides? */
  function isOpen() { return st.n != null && st.n < 3; }
  function juice(name, el, o) { if (global.Juice && el && Juice[name]) Juice[name](el, o); }

  /**
   * THE GHOST SHOWS THE MOVE. Where a screen asks for a drag, a translucent
   * knob (or a translucent copy of the thing to drag) leaves the start, slides
   * to where the drag goes, fades, and goes again — until the child touches
   * the stage, when it is gone for good. It never shows an answer the child
   * must find; it shows the gesture.
   *
   * Returns a stop function; the interaction's cleanup calls it too.
   */
  function gestureGhost(from, to, opts) {
    opts = opts || {};
    if (reduced() || !svg) return function () {};
    var g = mk('g', { 'class': 'gesture-ghost', 'pointer-events': 'none' }, layers.fx);
    var mover;
    if (opts.clone) {
      mover = opts.clone.cloneNode(true);
      mover.removeAttribute('class'); mover.setAttribute('class', 'gesture-ghost-copy');
      // inert to every selector: no data attributes, no classes on what it copied
      mover.removeAttribute('data-shape'); mover.removeAttribute('data-id');
      var copied = mover.querySelectorAll('[class]'); for (var ci = 0; ci < copied.length; ci++) copied[ci].removeAttribute('class');
      mover.style.pointerEvents = 'none';
      mover.setAttribute('transform', 'translate(' + from.x + ',' + from.y + ')');
      g.appendChild(mover);
    } else {
      mover = mk('circle', { cx: from.x, cy: from.y, r: opts.r || 11, fill: HI.knob, stroke: HI.edge, 'stroke-width': 2.5 }, g);
    }
    var trail = null;
    if (opts.trail !== false) {
      var tp = litLine(g, { x1: from.x, y1: from.y, x2: to.x, y2: to.y, 'stroke-width': 4, 'stroke-linecap': 'round', 'stroke-dasharray': '8 10', opacity: 0 });
      trail = mk('g', {}, g); trail.appendChild(tp[0]); trail.appendChild(tp[1]);
      g.insertBefore(trail, mover);
    }
    var dx = to.x - from.x, dy = to.y - from.y, live = true;
    var frames = [
      { translate: '0 0', opacity: 0, offset: 0 },
      { translate: '0 0', opacity: 0.85, offset: 0.14 },
      { translate: dx + 'px ' + dy + 'px', opacity: 0.85, offset: 0.66, easing: 'cubic-bezier(.35,.6,.3,1)' },
      { translate: dx + 'px ' + dy + 'px', opacity: 0.85, offset: 0.82 },
      { translate: dx + 'px ' + dy + 'px', opacity: 0, offset: 0.94 },
      { translate: dx + 'px ' + dy + 'px', opacity: 0, offset: 1 }
    ];

    /* WHERE THE MOVE ENDS, AND IT STAYS THERE.
     *
     * The ghost slid from the start to the end and faded, and the end faded
     * with it: a child who looked up a second late saw a hand vanishing
     * somewhere over the shape and nothing to say where it had been going.
     * The end is marked now — a dashed ice ring round the place the drag
     * finishes, with a dot at its heart — and the ring is the one part of the
     * hint that stays: it rises as the ghost sets off, catches the ghost as it
     * lands (one small pop), and is still there after the ghost has gone,
     * perfectly still, until the child touches the screen. The ladder's
     * press takes it down (hide -> stop), and so does the interaction ending.
     * Not a moving hint: a mark. */
    var ms = opts.duration || 3200;
    var ringR = opts.endR || ((opts.r || 11) + 9);
    var endG = mk('g', { 'class': 'gesture-ghost-end', 'pointer-events': 'none',
                         transform: 'translate(' + to.x + ',' + to.y + ')' }, layers.fx);
    mk('circle', { r: ringR, fill: HI.lit, 'fill-opacity': 0.16, stroke: HI.line, 'stroke-width': 3,
                   'stroke-dasharray': '6 5', 'stroke-linecap': 'round' }, endG);
    mk('circle', { r: 4.5, fill: HI.knob, stroke: HI.edge, 'stroke-width': 1.5 }, endG);
    endG.style.opacity = '0';

    var anims = [];
    // ONCE PER RUNG of the hint ladder, not on a loop: the move is shown, and
    // then the child has the screen to themselves again.
    var times = opts.times || 1, delay = opts.delay == null ? 120 : opts.delay;
    if (mover.animate) anims.push(mover.animate(frames, { duration: ms, iterations: times, delay: delay }));
    /* AND A HAND DOES IT. The glove comes down onto the start, presses, and
       carries the ghost along the move with its fingertip on it; at the end it
       lifts off and away, leaving the mark where the move finishes. */
    var hand = opts.hand === false ? null : handAt(g, from.x, from.y);
    if (hand && hand.g.animate) {
      var hs = hand.side, dxy = dx + 'px ' + dy + 'px';
      try {
        anims.push(hand.g.animate([
          { translate: (hs * 24) + 'px 30px', opacity: 0, offset: 0 },
          { translate: '0px 0px', opacity: 1, offset: 0.12 },
          { translate: '0px 0px', opacity: 1, offset: 0.16 },
          { translate: dxy, opacity: 1, offset: 0.66, easing: 'cubic-bezier(.35,.6,.3,1)' },
          { translate: dxy, opacity: 1, offset: 0.76 },
          { translate: (dx + hs * 20) + 'px ' + (dy + 26) + 'px', opacity: 0, offset: 0.92 },
          { translate: (dx + hs * 20) + 'px ' + (dy + 26) + 'px', opacity: 0, offset: 1 }
        ], { duration: ms, iterations: times, delay: delay, fill: 'both' }));
        anims.push(hand.img.animate([
          { scale: '1', offset: 0 }, { scale: '1', offset: 0.12 }, { scale: '.92', offset: 0.16 },
          { scale: '.92', offset: 0.7 }, { scale: '1', offset: 0.78 }, { scale: '1', offset: 1 }
        ], { duration: ms, iterations: times, delay: delay }));
      } catch (e) {}
    }
    if (trail && trail.animate) anims.push(trail.animate([
      { opacity: 0, offset: 0 }, { opacity: 0.55, offset: 0.2 }, { opacity: 0.55, offset: 0.76 }, { opacity: 0, offset: 0.92 }, { opacity: 0, offset: 1 }
    ], { duration: ms, iterations: times, delay: delay }));
    var ringIn = null;
    if (endG.animate) {
      try {
        endG.style.transformBox = 'fill-box'; endG.style.transformOrigin = 'center';
        ringIn = endG.animate([
          { opacity: 0, scale: '.7', offset: 0 },
          { opacity: 0.95, scale: '1', offset: 0.18 },
          { opacity: 0.95, scale: '1', offset: 0.62 },
          { opacity: 1, scale: '1.22', offset: 0.7 },       // the ghost arrives
          { opacity: 0.95, scale: '1', offset: 0.8 },
          { opacity: 0.95, scale: '1', offset: 1 }
        ], { duration: ms, delay: delay, fill: 'forwards', easing: 'ease-out' });
      } catch (e) { endG.style.opacity = '0.95'; }
    } else endG.style.opacity = '0.95';
    // THE GHOST GOES WHEN IT HAS SHOWN THE MOVE; THE MARK DOES NOT.
    var ghostGone = false;
    var fadeGhost = function () {
      if (ghostGone) return; ghostGone = true;
      if (g.animate) {
        try { var f = g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' }); f.finished.then(function () { g.remove(); }, function () { g.remove(); }); return; } catch (e) {}
      }
      g.remove();
    };
    if (anims[0] && anims[0].finished) anims[0].finished.then(function () { if (live) { fadeGhost(); endG.style.opacity = '0.95'; } }, function () {});
    var stop = function () {
      if (!live) return; live = false;
      anims.forEach(function (a) { try { a.cancel(); } catch (e) {} });
      fadeGhost();
      // from wherever the ring is now — mid-rise, or standing — to nothing
      var cur = 0;
      try { cur = parseFloat(global.getComputedStyle(endG).opacity) || 0; } catch (e) { cur = 0; }
      endG.style.opacity = String(cur);
      if (ringIn) { try { ringIn.cancel(); } catch (e) {} }
      if (cur > 0.02 && endG.animate && endG.parentNode) {
        try { var f2 = endG.animate([{ opacity: cur }, { opacity: 0 }], { duration: 180, fill: 'forwards' }); f2.finished.then(function () { endG.remove(); }, function () { endG.remove(); }); return; } catch (e) {}
      }
      endG.remove();
    };
    cleanup.push(stop);
    return stop;
  }
  /** The visible knob at vertex i (the touch disc over it is st.vertEls[i]). */
  function knobOf(i) { return (st.knobEls && st.knobEls[i]) || null; }
  function sfx(name, o) { if (global.SFX) SFX.play(name, o); }
  /* ------------------------------------------------------------------ *
   * Scene generation
   *
   * Every delayed callback in this file used to be a bare setTimeout, and
   * reset() — which tears the scene down and builds the next one — cancelled
   * none of them. So a callback scheduled by one screen ran against the next:
   * a staggered checklist row playing its tick on a screen that has no
   * checklist, the touch affordance being switched on for an interaction that
   * had already been replaced, a sort item fading itself in after its tray was
   * gone.
   *
   * None of that is visible as an error. It shows up as a sound with no cause
   * and a screen that lights up something nobody asked about, which is the
   * hardest class of bug to find by looking.
   *
   * So the scene has a number, reset() advances it, and later() refuses to run
   * anything scheduled by an older one. Every timer in this file goes through
   * it. The count of what it has refused is exposed, because a mechanism that
   * silently does nothing is indistinguishable from one that is not wired up.
   * ------------------------------------------------------------------ */
  var sceneGen = 0;
  var sceneTimers = [];
  var staleSuppressed = 0;

  function later(ms, fn) {
    var g = sceneGen;
    var id = setTimeout(function () {
      var i = sceneTimers.indexOf(id);
      if (i >= 0) sceneTimers.splice(i, 1);
      if (g !== sceneGen) { staleSuppressed++; return; }
      fn();
    }, ms);
    sceneTimers.push(id);
    return id;
  }

  /** Drop everything the outgoing scene was still waiting on. */
  function dropTimers() {
    sceneGen++;
    sceneTimers.splice(0).forEach(function (id) { clearTimeout(id); });
  }

  /** A wait that belongs to a scene: resolves false once that scene is over. */
  function hold(ms) {
    var g = sceneGen;
    return new Promise(function (r) {
      setTimeout(function () { r(g === sceneGen); }, ms);
    });
  }
  function reduced() { return !!(global.Juice && Juice.reducedMotion); }

  /* ------------------------------------------------------------------ *
   * Mount and background
   * ------------------------------------------------------------------ */

  function mount(container) {
    svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('class', 'stage');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    // OVERFLOW VISIBLE, SO THE PAINTING CAN LEAVE THE BOX. The lesson is a
    // 1000x562 board fitted inside the window, and on any other shape of
    // screen that leaves a strip the board does not reach. Letting the
    // background layer paint past the viewBox — and only the background
    // layer draws out there — means the sky and the snow run to the edge of
    // the glass instead of stopping at a line.
    svg.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;user-select:none';
    container.appendChild(svg);
    // a finger on the glass: while it is down the board is the child's, and
    // a vocabulary word does not light anything under their hand (emphasize)
    svg.addEventListener('pointerdown', function () { pressed = true; });
    var lift = function () { pressed = false; };
    (container.ownerDocument && container.ownerDocument.defaultView || global).addEventListener('pointerup', lift);
    (container.ownerDocument && container.ownerDocument.defaultView || global).addEventListener('pointercancel', lift);
    ['bg', 'panel', 'poly', 'ui', 'fx'].forEach(function (n) {
      layers[n] = mk('g', { 'class': 'layer-' + n }, svg);
    });
    // `fx` is pure feedback — the rubber-band line while a diagonal is being
    // drawn, the ghost while an endpoint is dragged — and it is the topmost
    // layer, so anything in it covers the vertices the child has to grab.
    // Those strokes are 7px wide and run straight through the vertex they
    // start from, and `opacity: 0` does not exempt an element from hit
    // testing: the pointerdown landed on the ghost and the drag never began.
    // Nothing in this layer is ever interactive, so say so once, here,
    // rather than remembering it at each element.
    layers.fx.setAttribute('pointer-events', 'none');
    drawVista();
    armPress();

    // A backgrounded tab should not be paying for snow it cannot show.
    if (document.addEventListener) {
      document.addEventListener('visibilitychange', function () { ambientPlay(!document.hidden); });
    }
    return api;
  }

  /* ------------------------------------------------------------------ *
   * The vista — painted artwork, plus a layer of weather over it.
   *
   * The backdrop is a single image drawn to the full viewBox. Behind it
   * sits the old gradient sky, so a missing or slow file degrades to a
   * clean sky rather than a white hole.
   *
   * Over it, three things move, none of which the learner ever interacts
   * with and all of which stop dead under reduced motion. They are all light
   * and particles, deliberately: anything with a drawn edge sits on top of a
   * painting instead of joining it.
   *
   *   snow     drifting six-armed crystals, each with its own fall time,
   *            sway and spin, seeded once and looped forever with WAAPI
   *            rather than per-frame JS — plus a gust held paused in reserve
   *            for Stage.flurry(), which the transition raises before it
   *            covers the screen
   *   glints   occasional sparkles on the snowfield, staggered so they never
   *            pulse in unison
   *   shimmer  one slow band of light travelling across the ice
   *
   * All of it lives in the `bg` layer, which reset() does not clear — it is
   * painted once at mount and then left alone for the whole lesson.
   * ------------------------------------------------------------------ */

  var HORIZON = 405;          // where the painted snowfield begins, in viewBox units
  var SNOW = 26, GUST = 16, GLINTS = 10;  // ambient element counts — see ambientLife()
  var ambient = [];           // running WAAPI animations, so they can be stopped
  var snowAnims = [];         // just the snowfall, so a gust can speed it up
  var gustAnims = [], gustG = null, gusting = false;

  function drawVista() {
    clear('bg');
    var d = mk('defs', {}, layers.bg);
    d.innerHTML =
      '<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3fb3f6"/><stop offset=".55" stop-color="#a8dcfb"/><stop offset="1" stop-color="#eef8ff"/></linearGradient>' +
      '<linearGradient id="bleed" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#40b7fd"/><stop offset="1" stop-color="#acd8fd"/></linearGradient>' +
      '<linearGradient id="snowlit" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
      '<radialGradient id="sun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="vignette" cx=".5" cy=".45" r=".75"><stop offset=".6" stop-color="#0a2a4a" stop-opacity="0"/><stop offset="1" stop-color="#0a2a4a" stop-opacity=".16"/></radialGradient>' +
      // the panel: a slab of ice, lit from above
      '<linearGradient id="panelFace" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".93"/><stop offset=".55" stop-color="#f2fbff" stop-opacity=".88"/><stop offset="1" stop-color="#d9eefb" stop-opacity=".9"/></linearGradient>' +
      '<linearGradient id="panelSheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".85"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>';

    /* THE PAINTING IS ONE LAYER, AND IT IS NOT THIS ONE.
     *
     * The backdrop used to be drawn twice: once here, fitted to the 1000x562
     * board, and once behind the whole window so the strip either side of the
     * board was not bare. Two copies of one picture at two scales meet along
     * a line, and that line is exactly what "the background is not fitting"
     * was — a seam between two versions of the same mountains.
     *
     * The window-wide copy (#backdrop in index.html, the same trick the title
     * screen uses) is now the only one. On a 16:9 screen it lands pixel for
     * pixel where this one did; on any other shape it simply continues past
     * the board instead of stopping at it. The weather still belongs here,
     * because it is drawn in board coordinates like everything else.
     */
    ambientLife();
  }

  function keep(a) { if (a && a.cancel) ambient.push(a); return a; }

  function loopAnim(el, frames, opts) {
    if (reduced() || !el.animate) return null;
    try { return keep(el.animate(frames, Object.assign({ iterations: Infinity }, opts))); }
    catch (e) { return null; }
  }

  function ambientLife() {
    var g = mk('g', { 'class': 'weather', 'pointer-events': 'none' }, layers.bg);
    var i;

    // --- sun glow, breathing slowly -------------------------------------
    var sun = mk('circle', { cx: 500, cy: 120, r: 230, fill: 'url(#sun)' }, g);
    loopAnim(sun, [{ opacity: 0.45 }, { opacity: 0.8 }, { opacity: 0.45 }],
             { duration: 9000, easing: 'ease-in-out' });

    // No drifting clouds. The backdrop is painted, clouds and all, and the
    // vector wisps that used to cross it read as stray shapes laid over the
    // art rather than as weather in it — flat, hard-edged and a different
    // white. Snow and light work over a painting; drawn clouds do not.

    // --- snowfall -------------------------------------------------------
    // Six-armed crystals, not dots. At these sizes a filled circle reads as
    // white noise over the painting; a lattice reads as snow. The shape comes
    // from the same generator the transition uses for its enormous flakes, so
    // the one that swings across the screen between two screens is visibly
    // the same crystal that has been drifting past all lesson.
    //
    // Seeded once. Each flake carries its own duration and negative delay, so
    // the field is already mid-fall on the first frame instead of starting as
    // an empty sky that fills in. Each is its own compositor layer and its own
    // infinite WAAPI animation, and the target is a low-end tablet, so the
    // count stays low and the small ones use the cheapest of the three builds.
    snowAnims = seedSnow(g, SNOW, 3.2, 8.4, 1);

    // --- the gust, held in reserve ---------------------------------------
    // Bigger, faster flakes that are not running and not visible until the
    // transition asks for them. The storm has to build before the screen is
    // covered, or the cover arrives out of nowhere.
    gustG = mk('g', { 'class': 'gust' }, g);
    gustG.style.opacity = '0';
    gustG.style.transition = 'opacity 240ms linear';
    gustAnims = seedSnow(gustG, GUST, 5.5, 13, 0.5);
    gustAnims.forEach(function (a) { try { a.pause(); } catch (e) {} });

    // --- glints on the ice ----------------------------------------------
    for (i = 0; i < GLINTS; i++) {
      var gx = 40 + Math.random() * (W - 80);
      var gy = HORIZON + 20 + Math.random() * (H - HORIZON - 30);
      var s = 3 + Math.random() * 4;
      var star = mk('path', {
        d: 'M0 ' + -s + ' Q' + (s * 0.22) + ' ' + (-s * 0.22) + ' ' + s + ' 0 Q' + (s * 0.22) + ' ' + (s * 0.22) + ' 0 ' + s +
           ' Q' + (-s * 0.22) + ' ' + (s * 0.22) + ' ' + -s + ' 0 Q' + (-s * 0.22) + ' ' + (-s * 0.22) + ' 0 ' + -s + ' Z',
        fill: '#ffffff', opacity: 0,
        transform: 'translate(' + gx.toFixed(0) + ',' + gy.toFixed(0) + ')'
      }, g);
      loopAnim(star, [
        { opacity: 0, transform: 'scale(.4)' },
        { opacity: 0, transform: 'scale(.4)', offset: 0.76 },
        { opacity: 0.95, transform: 'scale(1.25)', offset: 0.85 },
        { opacity: 0, transform: 'scale(.4)' }
      ], { duration: 4200 + Math.random() * 3800, delay: -Math.random() * 6000, easing: 'ease-in-out' });
      star.style.transformBox = 'fill-box'; star.style.transformOrigin = 'center';
    }

    // --- one slow band of light across the snow --------------------------
    var band = mk('rect', { x: -400, y: HORIZON, width: 300, height: H - HORIZON, fill: 'url(#snowlit)', opacity: 0.5 }, g);
    loopAnim(band, [
      { transform: 'translateX(0) skewX(-14deg)' },
      { transform: 'translateX(' + (W + 800) + 'px) skewX(-14deg)' }
    ], { duration: 17000, easing: 'ease-in-out' });
  }

  /**
   * Seed one field of falling crystals into `parent`.
   *
   * `slow` scales the fall time: the gust uses half, so its flakes visibly
   * outrun the calm ones when it arrives rather than merely adding to them.
   * The build is picked by size — the small distant flakes get the bare star,
   * which is a fifth of the path data of a full dendrite nobody could resolve
   * at that scale anyway.
   */
  function seedSnow(parent, count, rMin, rMax, slow) {
    var out = [], i;
    for (i = 0; i < count; i++) {
      var r = rMin + Math.random() * (rMax - rMin);
      var build = r < 5 ? 2 : (r < 7.5 ? 1 : 0);
      var x = Math.random() * W;
      var dur = (7000 + Math.random() * 9000) * slow;
      var sway = 14 + Math.random() * 34;
      var spin = (Math.random() < 0.5 ? -1 : 1) * (140 + Math.random() * 340);

      var f = mk('path', {
        'class': 'flake',
        d: Snowflake.path(r, build),
        fill: 'none', stroke: '#ffffff',
        'stroke-width': (r * 0.14 + 0.34).toFixed(2),
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        opacity: (0.3 + Math.random() * 0.5).toFixed(2)
      }, parent);
      // The crystal is drawn around its own origin, so the box it turns about
      // is its own — without this it would orbit the viewBox corner.
      f.style.transformBox = 'fill-box';
      f.style.transformOrigin = 'center';

      var a = loopAnim(f, [
        { transform: 'translate(' + x.toFixed(0) + 'px,-28px) rotate(0deg)' },
        { transform: 'translate(' + (x + sway).toFixed(0) + 'px,' + (H * 0.3).toFixed(0) + 'px) rotate(' + (spin * 0.3).toFixed(0) + 'deg)', offset: 0.3 },
        { transform: 'translate(' + (x - sway * 0.6).toFixed(0) + 'px,' + (H * 0.7).toFixed(0) + 'px) rotate(' + (spin * 0.7).toFixed(0) + 'deg)', offset: 0.7 },
        { transform: 'translate(' + (x + sway * 0.3).toFixed(0) + 'px,' + (H + 34) + 'px) rotate(' + spin.toFixed(0) + 'deg)' }
      ], { duration: dur, delay: -Math.random() * dur, easing: 'linear' });
      if (a) out.push(a);
    }
    return out;
  }

  /**
   * Thicken the weather, or let it settle again.
   *
   * The transition calls this a beat before it covers the screen: the gust
   * joins the calm snow and the calm snow speeds up, so by the time the big
   * crystals arrive it is already snowing hard. Without it the cover reads as
   * an effect switching on. With it, the storm closes in.
   */
  function flurry(on) {
    gusting = !!on;
    if (!gustG) return;
    gustG.style.opacity = on ? '1' : '0';
    gustAnims.forEach(function (a) { try { on ? a.play() : a.pause(); } catch (e) {} });
    snowAnims.forEach(function (a) { try { a.playbackRate = on ? 3.4 : 1; } catch (e) {} });
  }

  /** Stop the weather. Used when the page is hidden, so a backgrounded tab costs nothing. */
  function ambientPlay(on) {
    ambient.forEach(function (a) {
      try { on ? a.play() : a.pause(); } catch (e) {}
    });
    // Resuming the tab must not also resume a gust nobody asked for.
    if (on && !gusting) gustAnims.forEach(function (a) { try { a.pause(); } catch (e) {} });
  }

  /* ------------------------------------------------------------------ *
   * Panels and polygons
   * ------------------------------------------------------------------ */

  /* THE SCREEN READS TOP TO BOTTOM: INSTRUCTION, OBJECT, INTERACTION.
   *
   *   TOP      the plank's band. Two lines of it, at the widest the game
   *            runs, come down to about 117 stage units; nothing the lesson
   *            draws starts above this line, so the plank never covers it.
   *   BOTTOM   the foot, above the progress bar.
   *   CONTROL  the row of answers or the stepper bar: one height, one gap,
   *            always directly under the panel it belongs to, so a control
   *            is found where the eye lands after the object — not parked at
   *            the bottom edge because there happened to be room there.
   */
  var TOP = 120;
  var BOTTOM = H - 16;
  var CONTROL_H = 56;
  var CONTROL_GAP = 16;

  /* The look of every card the stage draws itself. The artwork cards carry
     their own; these keep the drawn ones — bins, the stepper bar, the
     checklist, a tag — from each inventing a radius and a rim. */
  var UI = {
    radius: 18, rim: 2.5,
    ink: '#1c2a4a', muted: '#5a6a8a',
    paper: '#fff8ee', paperRim: '#d9bd92',        // warm, so the ice is the only blue
    title: 22, body: 17
  };

  /* The learning object. One blue, used for nothing else on the stage, with
     an edge that is a darker step of the same colour rather than a black
     line — a coloured shape with a soft edge, not a diagram. */
  var SHAPE = { fill: '#5f97f0', edge: '#2f5fc4', edgeW: 3.5 };

  /* WHAT THE CHILD IS BEING SHOWN, OR CAN TAKE HOLD OF. One gold, with a
     deep amber edge, for every highlight and every handle: it is the
     stepper's coins and the yellow pill, so "gold means touch me or look
     here" holds across the game. Pure yellow on the blue shape read as a
     warning stripe; cream knobs with brown rims read as buttons from
     another game. */
  /* FROZEN, NOT GOLD. The gold knobs and amber rings read as coins from
     another game against the ice. Everything the child can take hold of is
     now cut from the same ice as the cards: a knob of frost-white with a
     deep-water edge, a picked one of bright glacier cyan, a second one of
     aqua, and the thing that is WRONG — a diagonal that runs outside — in
     aurora violet, which is the irregular concept's own colour and the one
     hue on this stage that is neither blue nor warm. Highlighted sides are
     ice-white over a deep-water under-edge, so they stand off the blue. */
  var HI = { fill: '#4be0ff', edge: '#0b4f9e', line: '#eafcff', lit: '#4be0ff', hot: '#7ff0d0',
             bad: '#b98cff', badLit: '#7a4cff', knob: '#eaf9ff', rim: '#4fb8ea' };
  /** A lit line: the glow first (wider, translucent, the same dashes), then the ice core. Returns [glow, core]. */
  /**
   * THE GLOW IS ON THE LINE ITSELF. An SVG blur filter takes its region from
   * the element's own box, and a thin tick lying nearly along an axis has a
   * box a few pixels tall — the glow came out cropped to a slot, and on a
   * vertical tick to nothing. A CSS drop-shadow grows its own region and
   * follows the dashes, so every lit line glows the same way, whole.
   */
  /**
   * The lit look: ONE tight shadow, not a haze.
   *
   * Two stacked drop-shadows at 3px and 7px put a halo round every stroke
   * wider than the stroke itself, and on a dashed line — where the halo
   * closes over the gaps — the whole thing read as out of focus. One shadow
   * at 2px reads as light coming off the line and leaves the edge sharp.
   */
  function litGlow(col) {
    return 'filter: drop-shadow(0 0 2px ' + col + ');';
  }
  /** A lit line: an ice core with its own glow. Returns [core, core] — the same element twice, for callers that kept a glow and a core. */
  function litLine(parent, attrs, o) {
    o = o || {};
    var bad = !!o.bad;
    var glowCol = bad ? HI.badLit : (o.warm ? '#ffb020' : HI.lit), coreCol = bad ? HI.bad : (o.warm ? '#ffe27a' : HI.line);
    var core = mk('line', Object.assign({}, attrs, { stroke: coreCol, style: litGlow(glowCol) }), parent);
    return [core, core];
  }
  // LINES ARE GOLD. A diagonal, a drawn segment, the side being measured:
  // each is a gold dash or stroke, the one lit thing on the blue shape. The
  // diagonal that has fallen OUTSIDE is violet instead, so the child sees
  // the odd one without reading anything.

  var PANELS = {
    // THE NEXT BUTTON LIVES IN THE BOTTOM-RIGHT CORNER, always, over the
    // stage. At h:460 this slab ran to y 520 and Next starts at 493, so on
    // every screen that offers Next the button sat on the corner of the
    // lesson — a fixed number against a fixed number, wrong everywhere.
    // y 100, not 60: the instruction plank occupies the top band of every
    // screen now, and at 60 this slab ran up underneath it. Height comes down
    // with it so the foot still clears the Next button.
    // BIGGER, AND IN FROM THE CORNER. At 500..960 × 120..485 the slab left
    // a hundred and forty units of nothing between him and it, another
    // sixty above it to the plank, and stopped short of the floor to clear
    // Next — which it never needed to, because Next lives right of x 855
    // and the slab can simply end before that. So: shifted left to 380,
    // up to 108 (fourteen under the plank's foot), and down to the floor,
    // 456 × 438: nearly square around a shape that nearly is, and a fifth
    // bigger. Its right edge, 836, keeps clear of Next.
    // 396..852 × 108..538: in from the corner, clear of Next (x 855+, y 495+)
    // and 18 under the plank's foot. When no plank is on the screen the whole
    // scene is SEATED higher — see applySeat() — so the card is centred.
    // 452, NOT 396: the layout audit measured a 30–60px gap between his line
    // and the card and 190px of empty ice to its right — the card crowded the
    // bird and left the far side to nobody. Seated, the card's foot ends
    // above Next's top (applySeat keeps it there), so it can use that room.
    right:  { x: 452, y: 108, w: 456, h: 430 },
    // WITHOUT HIM, THE LESSON TAKES THE MIDDLE. The right-hand slab exists
    // to leave the bottom-left to Swiftee. On the twenty-eight screens he is
    // not on, it left half the screen to nobody; this is what a 'right'
    // request becomes when he is off.
    // Nearly square, because the thing it frames nearly is: a 600-wide slab
    // around a pentagon was two thirds glass, and the shape read as small.
    // The same slab, centred: the measuring screens, where he waits inside
    // it, and the screens he is off.
    solo:   { x: 272, y: 108, w: 456, h: 430 },
    // THE MEASURING SLAB: the wide ice frame the user supplied, at its own
    // aspect (1672×941), the full height of the band and nearly the width
    // of the stage. He waits small in its bottom-left corner and the shape
    // has the middle to be big in. Chosen by panelFor() for a 'measure'
    // room when he is not standing on the ice beside the card.
    // Centred in the whole height, with the same air above and below: he
    // narrates these screens, so no plank ever sits over this slab. Its
    // right edge stops at 912 and its top at 49, just clear of the HUD.
    // 100..900 × 34..484, its own aspect: clear of the HUD's corner above
    // and of Next below, which used to sit on this slab's bottom-right rim.
    measure: { x: 100, y: 34, w: 800, h: 450, frame: 'measure' },
    // THE INSTRUCTION CARD COMES DOWN TO y 115. It is pinned top-left and
    // capped to whatever room the lesson leaves beside it — but a centred
    // panel leaves 200 units, which is narrower than the sentence is tall, so
    // the cap is refused and the card sits ABOVE the lesson instead. That
    // only works if the lesson actually starts below it, which at y 70 it did
    // not: the card lay across the top quarter of the slab.
    center: { x: 230, y: 128, w: 540, h: 330 },
    // THE COMPARE PAIR WAS PUSHED INTO THE RIGHT-HAND HALF and drawn small
    // with it: 490 to 985 of a 1000-wide stage, so the whole left third was
    // empty and the two shapes being compared were the smallest things on the
    // screen. The margin existed to keep clear of Swiftee, who stood bottom
    // left — he goes up into the corner on these screens now, so the lesson
    // can have the room. Centred on 500, and half again as tall.
    // 290, not 306: at 306 the pair reached 556px on a 720 window and he
    // stands centre-bottom on one of these screens with his head at 547.
    // 150, not 128: he peeks over the left one, and his head has to clear a
    // one-line plank above it. The check lines below still end above the foot.
    // Shifted right of centre by 60: he stands on the ice at the left of
    // the pair and instructs from there, and the pair's right edge (882)
    // stays clear of the HUD.
    // x 270 / 608: the band between the stage's edge and the left card is
    // where his line goes, and at 238 it was too narrow for "Compare the
    // diagonals in both pentagons." in three rows, so the line fell under
    // the cards. The pair's right edge (914) still clears the stage's own
    // margin and Next (which starts at y 495, below the pair's 440).
    // UP, so the tags under them are in the picture. At y 150 the pair's
    // name tags landed at 470 of a 562 stage — on the snow, level with the
    // progress bar, reading as a caption printed under a slide rather than
    // as part of the game.
    // ACROSS, NOT CENTRED. The pair used to start at x 270, which left a
    // 218px column on his side of the stage — narrower than a speech bubble
    // can render — so the placement had nowhere beside him to put a line and
    // sent every one of them to the band along the top of the screen, six
    // hundred pixels from the bird saying it. Moved right, the column is 248
    // and the longest line on these screens sits at his head in three rows.
    // 278 OF COLUMN, NOT 248. The longest line on these screens — "At least
    // one diagonal outside means concave polygon." — is four rows in a 248px
    // box and three in a 278px one, and four rows is the width at which the
    // placement gives up on standing beside him and puts the words in the
    // band along the top of the screen instead. Thirty pixels of column is
    // the difference between his line being his and being a caption.
    left2:  { x: 330, y: 118, w: 290, h: 290, frame: 'compare' },
    right2: { x: 652, y: 118, w: 290, h: 290, frame: 'compare' }
  };

  /* ------------------------------------------------------------------ *
   * THE OPTION ROW OWNS THE BOTTOM OF THE STAGE.
   *
   * The row of answer buttons is pinned to the bottom edge, and the panels
   * were sized as though it were not there: the right-hand panel runs to 520
   * in a 562-tall stage and the row starts at 484, so on every screen that
   * asks a question the buttons were drawn across the foot of the panel —
   * over the stepper's own card on the builder screens, over whatever caption
   * was under the shape on the rest.
   *
   * Nothing about that depended on the window, the content or the device. It
   * was two fixed numbers that overlapped, so it was wrong everywhere.
   *
   * A panel on a screen that asks a question stops above the band. Screens
   * that ask nothing keep the full height — reserving the band on all of them
   * would buy empty space on two thirds of the lesson to solve a problem it
   * does not have.
   * ------------------------------------------------------------------ */
  function panelFor(name, spec) {
    var p = PANELS[name] || PANELS.right;
    // The right-hand slab is for a bird standing bottom-left, so his bubble
    // has the left half to open in. Off, or up in the top-left corner where
    // his bubble opens along the top band, the lesson takes the middle.
    var standsLeft = global.Swiftee && /^left/.test(Swiftee.pos || '');
    if (p === PANELS.right && !standsLeft) {
      p = (spec && spec.room === 'measure' && global.CardFrame && CardFrame.measure) ? PANELS.measure : PANELS.solo;
    }
    var controls = spec && ((spec.choices && spec.choices.length) || spec.controls);
    if (!controls) return p;
    // A panel with a control under it stops above the control, and the pair
    // is centred in the band between the plank and the foot — so a screen
    // with a question is balanced, not weighted to whichever edge had room.
    // Sized from the top it is actually given (TOP), not from the free
    // panel's own y: measured from 108 and then placed at 120, the card ran
    // twelve units into the gap above its control, and the stepper sat four
    // units under the card instead of sixteen.
    var floor = BOTTOM - CONTROL_H - CONTROL_GAP;
    var h = Math.min(p.h, Math.max(240, floor - TOP));
    var slack = (BOTTOM - TOP) - (h + CONTROL_GAP + CONTROL_H);
    // `controls`: the band under it is part of the scene (applySeat centres both)
    return { x: p.x, y: TOP + Math.max(0, slack / 2), w: p.w, h: h, frame: p.frame, controls: true };
  }

  /** Where a control bar sits: under the panel, and never off the foot. */
  function controlY() {
    var y = st.panel ? st.panel.y + st.panel.h + CONTROL_GAP + CONTROL_H / 2 : BOTTOM - CONTROL_H / 2;
    return Math.min(y, BOTTOM - CONTROL_H / 2);
  }

  /**
   * The slab the lesson stands on.
   *
   * It was one flat white rectangle with a thin blue outline, which is what a
   * website card looks like — in a game about ice, on a painted glacier. It
   * is a slab now: lit along its top edge, deepening to pale blue at the
   * bottom, with a darker underside beneath it so it has thickness. That is
   * the same grammar as everything else in this game — the speech bubble, the
   * instruction card and the buttons all have a rim and an underside — so the
   * panel stops being the one piece of furniture from somewhere else.
   *
   * THE SHAPE IS STILL THE HERO. Four crystals sit in the corners at a tenth
   * opacity and nothing sits anywhere else: the middle, where the polygon
   * goes, is clean ice. A theme that competes with the thing being taught is
   * not a theme, it is clutter — which is why the frost is in the corners,
   * the gradient is gentle, and there is no pattern across the face.
   *
   * Everything is drawn in viewBox units, so it scales with the stage and
   * needs no breakpoints of its own.
   */
  /**
   * The slab a shape is DISPLAYED on.
   *
   * THIS IS THE CARD FOR THINGS YOU CANNOT TOUCH. The game now has two, and
   * the difference between them is the affordance: an option — anything in
   * the sorting tray, the swipe deck, the choose-the-polygons grid — sits in
   * the small block of ice, and a shape that is simply being shown to you
   * sits on this one. A child can tell which is which before they reach for
   * it, which one slab used for both could never say.
   *
   * It was drawn here: a face, a rim, an underside, four frost crystals and a
   * sheen, about forty lines of it. It is the artwork now, so what the lesson
   * shows and what the designer drew cannot drift apart, and redrawing it is
   * a file swap.
   *
   * `_face` is the area INSIDE its rim, which is what the shape and its
   * caption have to stay within. The bottom rim is a sixth of the card, so a
   * caption placed against the bottom of the PANEL sits on the frame rather
   * than on the ice.
   */
  function panel(p, opts) {
    opts = opts || {};
    var g = mk('g', { 'class': 'panel' }, layers.panel);
    st.panelEl = g;
    g._rect = { x: p.x, y: p.y, w: p.w, h: p.h };
    var F = global.CardFrame && (CardFrame[p.frame || 'panel'] || CardFrame.panel);

    if (F) {
      var img = mk('image', {
        x: p.x, y: p.y, width: p.w, height: p.h,
        preserveAspectRatio: 'none', 'pointer-events': 'none'
      }, g);
      img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', F.src);
      img.setAttribute('href', F.src);
    } else {
      // No frame table: a plain slab rather than no lesson.
      mk('rect', { x: p.x, y: p.y + 7, width: p.w, height: p.h, rx: 34,
                   fill: '#7cb6dc', opacity: 0.38, 'pointer-events': 'none' }, g);
      mk('rect', { x: p.x, y: p.y, width: p.w, height: p.h, rx: 34,
                   fill: 'url(#panelFace)', stroke: '#a3d4ef', 'stroke-width': 3 }, g);
    }

    if (opts.enter !== false) enter(g, opts.enter || 'pop');
    return g;
  }

  /**
   * The little pop or rise as a thing arrives.
   *
   * Animates the independent `scale` and `translate` properties, never
   * `transform`. A sort item is positioned by a `transform="translate(x,y)"`
   * attribute, and a WAAPI animation of `transform` replaces that outright
   * for its whole duration — so every item in the tray was drawn at the top
   * left corner of the stage for 460ms and then snapped into place. `scale`
   * and `translate` compose with the attribute instead of overwriting it.
   */
  /* A THING ARRIVES; IT DOES NOT BOUNCE IN.
   *
   * The lesson's objects — a card, a polygon, a pair of pentagons — came in
   * from seventy per cent with an overshoot, which is a toy landing, and a
   * shape the child is about to study should arrive as itself: up a few
   * pixels, from just under full size, settled. Only the small pieces of UI
   * — a name tag, a badge, an answer — keep a hint of spring ('ui'), because
   * those are meant to feel like things you press. */
  /* ------------------------------------------------------------------ *
   * THE WORD AND THE THING ARRIVE TOGETHER.
   *
   * "Are they inside or outside?" was said over an empty foot of the stage,
   * and then both answers were dealt in together once the sentence was over
   * — so the button that says "Inside" arrived a second after the word did,
   * and the child had to connect the two by themselves. A piece of UI that
   * a line names can wait for its word instead: it is built where it goes,
   * held invisible and untouchable, and it comes in (the same small 'ui'
   * entrance) in the frame the bubble reveals the word that names it. "Inside"
   * appears on "inside", "Outside" on "outside"; a name tag on the word it
   * says; a bin on its category; the stepper on "sides".
   *
   * NOTHING WAITS FOR EVER. If the word never comes — the line was changed,
   * motion is reduced, the words were all shown at once by a tap — everything
   * still held is shown when the line is over or when the child is handed
   * control (releaseHeld, called by game.js as an input arms). A new scene
   * forgets the old scene's holds. Reduced motion holds nothing at all.
   * ------------------------------------------------------------------ */
  /* THE SHAPES THE CHILD MADE, by what they were asked to make and how many
     sides it had — kept across scenes (a scene reset does not clear it; a
     Restart does, via Stage.forgetMade). Copies, so nothing the card does to
     them can reach back. */
  var made = {};
  function rememberMade(cond, verts, moved) {
    if (!cond || !verts || verts.length < 3) return;
    made[cond + '-' + verts.length] = { verts: verts.map(function (p) { return { x: p.x, y: p.y }; }), moved: moved };
  }
  function madeShape(cond, n) {
    var m = made[cond + '-' + n];
    return m ? { verts: m.verts.map(function (p) { return { x: p.x, y: p.y }; }), moved: m.moved } : null;
  }

  var heldForWord = [];
  function wordKey(w) { return String(w == null ? '' : w).toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  function holdForWord(el, words) {
    if (!el || !el.style || reduced()) return false;
    var list = (Array.isArray(words) ? words : [words]).map(wordKey).filter(Boolean);
    if (!list.length) return false;
    el.style.opacity = '0';
    el._heldEvents = el.style.pointerEvents || '';
    el.style.pointerEvents = 'none';
    heldForWord.push({ words: list, el: el });
    return true;
  }
  function showHeld(h, delay) {
    var el = h.el;
    if (!el || !el.parentNode) return;
    var go = function () {
      if (!el.parentNode) return;
      el.style.opacity = '';
      el.style.pointerEvents = el._heldEvents || '';
      enter(el, 'ui');
    };
    if (delay) later(delay, go); else go();
  }
  /** A word of the line has just appeared in the bubble. */
  function said(word) {
    if (!heldForWord.length) return 0;
    var w = wordKey(word);
    if (!w) return 0;
    var still = [], shown = 0;
    heldForWord.forEach(function (h) {
      if (h.words.indexOf(w) >= 0) { showHeld(h); shown++; }
      else still.push(h);
    });
    heldForWord = still;
    return shown;
  }
  /** The line is over, or the child is about to act: show whatever is left. */
  function releaseHeld() {
    var all = heldForWord; heldForWord = [];
    all.forEach(function (h, i) { showHeld(h, i * 90); });
    return all.length;
  }

  var ENTER_MS = 380;
  function enter(el, kind) {
    if (reduced() || !el.animate) return;
    var k = kind === 'rise'
      ? [{ translate: '0 12px', opacity: 0 }, { translate: '0 0', opacity: 1 }]
      : kind === 'fade'
      ? [{ opacity: 0 }, { opacity: 1 }]
      : kind === 'ui'
      ? [{ scale: '.94', translate: '0 8px', opacity: 0 }, { scale: '1.02', translate: '0 0', opacity: 1, offset: .7 }, { scale: '1', translate: '0 0', opacity: 1 }]
      : [{ scale: '.94', translate: '0 8px', opacity: 0 }, { scale: '1', translate: '0 0', opacity: 1 }];
    el.style.transformBox = 'fill-box'; el.style.transformOrigin = 'center';
    el.animate(k, { duration: ENTER_MS, easing: 'cubic-bezier(.22,1,.36,1)' });
  }

  /**
   * Fit a polygon into the room its panel actually has.
   *
   * THE SHAPE FILLS THE CARD; THE CARD DOES NOT PAD THE SHAPE.
   *
   * This used to be three constants that did not know about each other: a
   * fixed fraction of the panel's short side for the size, dead centre for
   * the position, and a fixed percentage lift on top. Nothing in that chain
   * knew what else was on the screen, so the slack pooled wherever the
   * arithmetic left it — on a 460x406 panel whose caption sits BESIDE the
   * shape rather than under it, a hundred pixels of it ended up as a band of
   * empty card along the bottom, under a shape that had been pushed up to
   * make room for something that was never going there.
   *
   * It is a fit now. The box is worked out first — the panel, less a margin,
   * less the strip a caption or a badge needs WHEN one is coming — and the
   * shape is built at unit size, measured, and scaled until it touches the
   * sides of that box. Two consequences worth having: there is no slack left
   * to pool anywhere, and a pentagon and a hexagon in the same panel come out
   * the same visual weight, which a common circumradius never gave them —
   * a hexagon is 15% wider than a pentagon at the same r.
   *
   * The fit also replaces the clamp that used to follow it. A shape sized to
   * its box cannot leave the box, so there is nothing left to correct.
   */
  /**
   * The clear face of a panel: the card, less the frame around it.
   *
   * The artwork's rim is not a hairline — the bottom of it is a sixth of the
   * card — so the box a shape may use is not the box the panel occupies.
   */
  function panelFace(p) {
    var F = global.CardFrame && (CardFrame[p.frame || 'panel'] || CardFrame.panel);
    var q = F && F.pane;
    if (!q) return p;
    return { x: p.x + p.w * q.x, y: p.y + p.h * q.y, w: p.w * q.w, h: p.h * q.h };
  }

  function polygonIn(p, n, opts) {
    opts = opts || {};

    var face = panelFace(p);
    // Tight to the glass. The face is already inset from the rim by the
    // artwork's own measurement, so the margin here only keeps a vertex off
    // the inner edge; more than that was shape-sized emptiness.
    var mx = face.w * 0.02, mt = face.h * 0.02;
    // Room for what is drawn beneath it, and none when nothing is.
    // Room for a word on a plate under the shape: the plate is 38 units, so
    // a fifth of the face was more than the word needed and left the shape
    // small and high. Thirteen percent seats the plate and keeps the shape
    // near the middle.
    // Room for the tag under the shape: 13% of a full slab, and never less
    // than the tag's own height plus air (it is 40 tall, kept 32 off the
    // foot), so the word never sits on the shape's bottom edge.
    var mb = opts.below ? Math.max(face.h * 0.13, 76) : face.h * 0.02;
    // A SHAPE THAT WILL BE MEASURED keeps a margin all round: the readings
    // sit outside its sides, and the measurer walks outside them too, and
    // both have to stay on the glass.
    // 12%, not 15%: on the wide measuring slab the face is short, and the
    // readings (a 28-tall plate 28 outside the side) fit in twelve.
    // and never less than 64: the measuring sprite stands on the side, some
    // 58 units out from it, and must not reach the rim on any side
    // 48: the walking bird stands 3 out from the side and is 45 tall at the
    // 56 cell, so his head stays on the glass; a reading tag sits within 44.
    /* THE MEASURING ROOM, RE-MEASURED.
     *
     * These margins were cut for the old readout: a 66-wide ice plate pushed
     * straight out from each side, which needed up to forty units of clear
     * card beside every edge. The readout is a dimension line now — fifteen
     * units out, a five-unit tick, and the figure sitting in a gap in the
     * line — so it needs barely half that, and the shape was left swimming in
     * a card it no longer had to share. The shape is the lesson; the room
     * around it is only what the marks actually occupy. */
    if (opts.room === 'measure') { mx = Math.max(face.w * 0.045, 32); mt = Math.max(face.h * 0.04, 30); mb = Math.max(mb, face.h * 0.07, 32); }
    var box = { x: face.x + mx, y: face.y + mt, w: face.w - mx * 2, h: face.h - mt - mb };

    // Built at unit size WITH its deformations, so what gets measured is what
    // gets drawn: a dented or stretched shape has a different bounding box
    // from the regular one it started as.
    // ONE SIDE IS A LINE, TWO ARE A CORNER. Below three there is no polygon
    // to draw, and the builder starts there on purpose: the child adds the
    // sides one at a time and sees the third one close the shape.
    // a given outline (the child's own shape) is fitted exactly as it is
    var u = opts.shape && opts.shape.length >= 3 ? opts.shape.map(function (q) { return { x: q.x, y: q.y }; })
          : n === 1 ? [{ x: -1, y: 0 }, { x: 1, y: 0 }]
          : n === 2 ? [{ x: -0.92, y: 0.62 }, { x: 0, y: -0.62 }, { x: 0.92, y: 0.62 }]
          : Poly.regular(n, 1, 0, 0);
    // 0.92, not 0.72. Pulled 72% of the way to the centre, a pentagon's top
    // vertex lands three hundredths of a radius below its neighbours: a
    // flat top with a red line along it, which no child reads as a dent.
    // At 92% it sits well inside the line between them — a clear notch,
    // and the diagonal that runs outside plainly runs outside.
    if (opts.dent != null) u = Poly.pullInward(u, opts.dent, 0.92);
    if (opts.stretch != null) u[opts.stretch] = { x: u[opts.stretch].x, y: u[opts.stretch].y - 0.55 };

    var lo = { x: Infinity, y: Infinity }, hi = { x: -Infinity, y: -Infinity };
    u.forEach(function (q) {
      if (q.x < lo.x) lo.x = q.x;
      if (q.x > hi.x) hi.x = q.x;
      if (q.y < lo.y) lo.y = q.y;
      if (q.y > hi.y) hi.y = q.y;
    });

    // The handles are painted OUTSIDE the outline, so the fit leaves room for
    // them; otherwise a corner dot hangs over the edge of the panel.
    var fill = opts.fill == null ? 0.96 : opts.fill;
    // a flat line has no height to fit: give it the height of a corner, so
    // the line is drawn at the width a two-sided corner would have
    var ext = { x: Math.max(hi.x - lo.x, 0.5), y: Math.max(hi.y - lo.y, 1.24) };
    var k = Math.min((box.w - VERT_PAINT * 2) / ext.x,
                     (box.h - VERT_PAINT * 2) / ext.y) * fill;

    var cx = box.x + box.w / 2 - (lo.x + hi.x) / 2 * k;
    var cy = box.y + box.h / 2 - (lo.y + hi.y) / 2 * k + (opts.dy || 0);

    var v = u.map(function (q) { return { x: cx + q.x * k, y: cy + q.y * k }; });
    return { verts: v, cx: cx, cy: cy, r: k };
  }

  /* A DIAGONAL DRAWN THE WAY A HAND DRAWS IT.
   *
   * The five used to be stroked in with a dash-offset trick: a solid line
   * that wiped across in 0.7s and then, at the end, snapped into dashes — and
   * the next one started before the last had landed, 0.42s apart, so the
   * star arrived as a flicker of overlapping strokes a child could not
   * follow. Now each one GROWS from its first corner to its second, already
   * dashed (the dashes are measured from where it starts, so they do not
   * crawl), with a small bright point at its tip like the end of a pencil,
   * eased in and out; and it waits for the one before to land. One line, one
   * corner to another, five times — which is what "the diagonals of this
   * pentagon" are. Stepped by frame, and it gives up quietly if the line is
   * taken off the stage under it. */
  function drawIn(dg, pair, a, b, delay, each) {
    var lines = pair.filter(function (x, i, all) { return x && all.indexOf(x) === i; });
    var dur = Math.max(500, Math.min(1000, (each || 1150) - 250));
    var tip = mk('circle', { cx: a.x, cy: a.y, r: 5.5, fill: '#ffffff', 'fill-opacity': 0.95, 'pointer-events': 'none' }, dg);
    if (tip.style) tip.style.filter = 'drop-shadow(0 0 5px rgba(170, 240, 255, .95))';
    tip.setAttribute('opacity', 0);
    lines.forEach(function (ln) { ln.setAttribute('x2', a.x); ln.setAttribute('y2', a.y); ln.setAttribute('opacity', 0); });
    var t0 = null;
    var frame = global.requestAnimationFrame || function (f) { return setTimeout(function () { f(Date.now()); }, 16); };
    var ease = function (k) { return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; };
    var step = function (now) {
      if (!dg.parentNode) return;                      // redrawn or torn down: stop
      if (t0 == null) t0 = now;
      var el = now - t0 - delay;
      if (el < 0) { frame(step); return; }
      var k = Math.min(1, el / dur), e = ease(k);
      var x = a.x + (b.x - a.x) * e, y = a.y + (b.y - a.y) * e;
      lines.forEach(function (ln) { ln.setAttribute('opacity', 1); ln.setAttribute('x2', x); ln.setAttribute('y2', y); });
      tip.setAttribute('cx', x); tip.setAttribute('cy', y);
      tip.setAttribute('opacity', k < 0.9 ? 1 : Math.max(0, (1 - k) * 10));
      if (k < 1) frame(step);
      else { lines.forEach(function (ln) { ln.setAttribute('x2', b.x); ln.setAttribute('y2', b.y); }); tip.remove(); }
    };
    frame(step);
  }

  /** (Re)draw the main polygon from st.verts. Called on every change. */
  function renderPoly() {
    var g = st.polyG;
    if (!g) return;
    while (g.firstChild) g.removeChild(g.firstChild);
    var v = st.verts, n = v.length;

    st.fill = isOpen()
      // not a shape yet: the sides alone, thick and rounded, nothing to fill
      ? mk('path', { d: pathOpen(v), fill: 'none', stroke: SHAPE.edge, 'stroke-width': 8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g)
      : mk('path', { d: pathOf(v), fill: 'url(#' + candy(SHAPE.fill) + ')', stroke: SHAPE.edge, 'stroke-width': SHAPE.edgeW, 'stroke-linejoin': 'round' }, g);

    // diagonals
    st.diagG = mk('g', {}, g);
    (st.diagonals || []).forEach(function (d, k) {
      var a = v[d[0]], b = v[d[1]];
      var outside = !Poly.isDiagonalInside(v, d[0], d[1]);
      var hl = st.highlightOutside && outside;
      // one group per diagonal — glow under, line over — so updatePoly can
      // find diagonal k as child k whatever is drawn for it
      var dg = mk('g', {}, st.diagG);
      // ONCE THE DENT IS MADE, ONLY THE ONE THAT MATTERS. Five dashed lines
      // over a shape that has just changed is a tangle; the child needs to
      // see the one diagonal that now runs outside, alone.
      if (st.onlyOutside && !outside) dg.style.display = 'none';
      var pair = litLine(dg, {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        'stroke-width': hl || d.solid ? 4 : 3.5, 'stroke-linecap': 'round',
        'stroke-dasharray': d.solid ? null : '14 12'
      }, { bad: hl });
      var line = pair[1];
      if (d.animate && !reduced()) {
        // ONCE. The flag lives on the diagonal itself, and renderPoly runs
        // again for anything that touches the shape — a word lighting up, a
        // corner dressed — so a flag left standing replayed the whole
        // five-line draw-in every time, which looked like the animation
        // stuttering back to the start. It is spent as it is used.
        d.animate = false;
        drawIn(dg, pair, a, b, d.delay || 0, d.each);
      }
    });

    // THE GHOST SHOWS THE MOVE, IT DOES NOT DRAW THE ANSWER. A dashed line
    // from the picked vertex to the right one was the answer, printed on
    // the shape; what the child needs is to see the gesture. So a ghost
    // knob leaves the picked vertex and slides to the other, drawing a
    // faint trail behind it as it goes, then both fade and it goes again —
    // until the child does it, when st.ghost is cleared.
    if (st.ghost) {
      var ga = v[st.ghost.from], gb = v[st.ghost.to];
      var gg = mk('g', { 'class': 'ghost-demo', 'pointer-events': 'none' }, g);
      var glen = Math.hypot(gb.x - ga.x, gb.y - ga.y) || 1;
      var trailPair = litLine(gg, { x1: ga.x, y1: ga.y, x2: gb.x, y2: gb.y, 'stroke-width': 4, 'stroke-linecap': 'round' });
      var trail = trailPair[1]; trailPair[0].setAttribute('opacity', .3); trail.setAttribute('opacity', .55);
      var gk = mk('circle', { cx: ga.x, cy: ga.y, r: 9, fill: HI.knob, stroke: HI.edge, 'stroke-width': 2.5, opacity: .6 }, gg);
      if (reduced() || !gk.animate) {
        // no motion: the trail alone, dashed, so the hint is still there
        trail.setAttribute('stroke-dasharray', '14 12');
      } else {
        trail.style.strokeDasharray = glen + ' ' + glen;
        trail.animate([
          { strokeDashoffset: glen + 'px', opacity: 0.45, offset: 0 },
          { strokeDashoffset: '0px', opacity: 0.45, offset: 0.62, easing: 'cubic-bezier(.3,.7,.3,1)' },
          { strokeDashoffset: '0px', opacity: 0.45, offset: 0.78 },
          { strokeDashoffset: '0px', opacity: 0, offset: 1 }
        ], { duration: 3400, iterations: Infinity });
        gk.animate([
          { translate: '0 0', opacity: 0.6, offset: 0 },
          { translate: (gb.x - ga.x) + 'px ' + (gb.y - ga.y) + 'px', opacity: 0.6, offset: 0.62, easing: 'cubic-bezier(.3,.7,.3,1)' },
          { translate: (gb.x - ga.x) + 'px ' + (gb.y - ga.y) + 'px', opacity: 0.6, offset: 0.78 },
          { translate: (gb.x - ga.x) + 'px ' + (gb.y - ga.y) + 'px', opacity: 0, offset: 1 }
        ], { duration: 3400, iterations: Infinity });
      }
    }

    // THE SIDE BEING TALKED ABOUT: the one the child just connected, drawn in
    // pale ice over the outline. The connect step lights it while it is named
    // ("This is a side of the polygon.") and takes it down before the next
    // try (clearSide); nothing else on the shape is drawn over a side.
    if (st.segment) {
      var sa = v[st.segment[0]], sb = v[st.segment[1]];
      var segEl = mk('line', { x1: sa.x, y1: sa.y, x2: sb.x, y2: sb.y, stroke: HI.line, 'stroke-width': 4.5,
                               'stroke-linecap': 'round', 'pointer-events': 'none', 'class': 'segment' }, g);
      st.segGlow = segEl; st.segLine = segEl;
    }

    // edges as tap targets (invisible, wide) — an open figure has no closing side
    st.edgeEls = [];
    for (var i = 0; i < (isOpen() ? n - 1 : n); i++) {
      var e1 = v[i], e2 = v[(i + 1) % n];
      // 46 units wide — well past a fingertip on every screen the game runs
      // on — so a side is hit by a tap anywhere near it, not only on the line
      var edge = mk('line', { x1: e1.x, y1: e1.y, x2: e2.x, y2: e2.y, stroke: 'transparent', 'stroke-width': 46, 'stroke-linecap': 'round', 'class': 'edge', 'data-i': i }, g);
      st.edgeEls.push(edge);
    }

    /* A SIDE STILL TO MEASURE BREATHES, the whole length of it. It was a dot
       at its middle, which read as a corner to tap; the side itself is the
       thing, so the side softly brightens and dims — each a beat after the
       one before — until it has been measured, and then it is still. The
       wide edge above takes the tap anywhere along it. (st.sideDotEls keeps
       its name: the hints and the word "side" find the to-do marks there.) */
    st.sideDotEls = [];
    (st.sideTodo || []).forEach(function (si, order) {
      var p1 = v[si], p2 = v[(si + 1) % n];
      if (!p1 || !p2) return;
      var todo = mk('line', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, stroke: '#fff4c9', 'stroke-width': 7,
                              'stroke-linecap': 'round', 'class': 'side-todo', 'data-i': si, 'pointer-events': 'none' }, g);
      todo.style.animationDelay = (order * 0.22).toFixed(2) + 's';
      st.sideDotEls[si] = todo;
    });

    // measurements and arcs live in a sub-group so drags can refresh them
    st.measG = mk('g', { 'class': 'measurements' }, g);
    if (st.measure) drawMeasurements(st.measG);

    // ---- vertices ----
    //
    // THE ONE THING A CHILD HAS TO SEE IS WHAT THEY CAN TOUCH.
    //
    // These were #1030c8 dots on a #5a8dee polygon — dark blue on mid blue,
    // nine units across on a thousand-unit stage. On the screen where the
    // instruction is "Pick any vertex", there was nothing to tell a
    // seven-year-old which part of the picture was theirs. Colour alone is
    // never the signal either, so a touchable vertex is bigger AND amber AND
    // ringed AND breathing (see alive()).
    //
    // A CREAM CORE WITH A DARK AMBER RING, because a vertex sits ON the
    // outline: half of it is over the blue fill and half over the pale panel,
    // and no single colour reads against both. Measured against #5a8dee and
    // #f2fbff: the old dot managed 2.84 and 8.78, solid amber managed 1.83,
    // and this manages 3.06 and 9.46 — it fixes the weak side without giving
    // up the strong one. Warm, so it still speaks the same language as the
    // Next button, the play button and the speech bubble's rim: in this game
    // warm means "you can touch this".
    //
    // NO SEPARATE HIT CIRCLE. A wider transparent circle over each vertex is
    // the usual way to give small fingers a bigger target, and here it stalled
    // the lesson outright: the handlers for picking and dragging are bound to
    // the vertex ELEMENTS, so a tap that landed on the invisible disc over the
    // top reached something with no handler and nothing happened. The target
    // grows by growing the dot instead — nine units to fourteen — and the
    // glow, the breathing and the press response do the rest of the work of
    // being findable.
    // A SMALL KNOB TO SEE, A WIDE DISC TO TOUCH. The knob a child sees is
    // eight units across — a point, not a coin — and under it is nothing;
    // over it is an unpainted disc of fifteen, and THAT is the vertex the
    // handlers, the finger and the QA gate meet. The disc is on top, so a
    // tap lands on the element that owns the handler (the earlier failure
    // with a hit circle was a disc UNDER the dot, reached by nothing). What
    // the child sees move, pulse or pop is the knob, so every visual ref to
    // a vertex resolves to the knob and every handler to the disc.
    st.vertEls = []; st.knobEls = [];
    var touch = !!st.touchVerts;
    for (var j = 0; j < n; j++) {
      var col = st.vcolor && st.vcolor[j] ? st.vcolor[j] : null;
      var shown = !!(col || st.showVerts || isOpen());   // an open figure shows its corners
      // THE CORNER THE CHILD CHOSE keeps a quiet icy ring for as long as it
      // is the start of their lines — both diagonals are drawn from it — so
      // "this is my corner" never has to be remembered.
      if (st.picked === j && !isOpen()) {
        mk('circle', { cx: v[j].x, cy: v[j].y, r: 16, fill: 'none', stroke: HI.line, 'stroke-width': 3,
                       opacity: 0.95, 'class': 'anchor-ring', 'pointer-events': 'none',
                       style: 'filter: drop-shadow(0 0 4px rgba(75, 224, 255, .85));' }, g);
      }
      var knob = mk('circle', {
        cx: v[j].x, cy: v[j].y,
        r: col ? 10 : (touch ? 9 : 6),
        fill: col || (touch ? HI.knob : SHAPE.edge),
        stroke: col ? shade(col, -0.45) : (touch ? HI.edge : 'none'),
        'stroke-width': col ? 3 : (touch ? 2.5 : 2),
        'class': 'knob', 'data-i': j,
        opacity: shown ? 1 : 0,
        'pointer-events': 'none'
      }, g);
      // 18 units: 36 across, which is 37px on a 1024-wide window and more on
      // anything bigger — the 36–44px a finger needs, however small the
      // knob it lands on looks.
      var c = mk('circle', {
        cx: v[j].x, cy: v[j].y, r: 18,
        fill: '#000', 'fill-opacity': 0, stroke: 'none',
        'class': 'vertex', 'data-i': j
      }, g);
      c.style.pointerEvents = touch ? 'all' : 'none';
      st.knobEls.push(knob);
      st.vertEls.push(c);
    }
  }

  /**
   * Update geometry in place during a drag: path, diagonals, edges, vertex
   * positions. No nodes are created or destroyed, so pointer capture and
   * listeners survive every move. renderPoly() is for structural changes.
   */
  function updatePoly() {
    var v = st.verts, n = v.length, i;
    if (st.fill) st.fill.setAttribute('d', pathOf(v));
    if (st.diagG) {
      var groups = st.diagG.childNodes;
      for (i = 0; i < groups.length && i < (st.diagonals || []).length; i++) {
        var d = st.diagonals[i], a = v[d[0]], b = v[d[1]], G = groups[i];
        var out = !Poly.isDiagonalInside(v, d[0], d[1]);
        var hl = st.highlightOutside && out;
        var kids = G.childNodes, w = hl || d.solid ? 6 : 5;
        for (var q = 0; q < kids.length; q++) {
          var L = kids[q], isGlow = kids.length > 1 && q === 0;
          L.setAttribute('x1', a.x); L.setAttribute('y1', a.y); L.setAttribute('x2', b.x); L.setAttribute('y2', b.y);
          L.setAttribute('stroke', isGlow ? (hl ? HI.badLit : HI.lit) : (hl ? HI.bad : HI.line));
          L.setAttribute('stroke-width', isGlow ? w + 7 : w);
          L.style.strokeDasharray = d.solid ? '' : '14 12'; L.style.strokeDashoffset = 0;
        }
        G.style.display = (st.onlyOutside && !out) ? 'none' : '';
      }
    }
    if (st.segLine && st.segment) {
      var sa = v[st.segment[0]], sb = v[st.segment[1]];
      [st.segGlow, st.segLine].forEach(function (ln) { if (!ln) return; ln.setAttribute('x1', sa.x); ln.setAttribute('y1', sa.y); ln.setAttribute('x2', sb.x); ln.setAttribute('y2', sb.y); });
    }
    for (i = 0; i < n && st.edgeEls; i++) { var e1 = v[i], e2 = v[(i + 1) % n], E = st.edgeEls[i]; if (!E) continue; E.setAttribute('x1', e1.x); E.setAttribute('y1', e1.y); E.setAttribute('x2', e2.x); E.setAttribute('y2', e2.y); }
    for (i = 0; i < n && st.vertEls; i++) {
      var C = st.vertEls[i]; if (C) { C.setAttribute('cx', v[i].x); C.setAttribute('cy', v[i].y); }
      var K = st.knobEls && st.knobEls[i]; if (K) { K.setAttribute('cx', v[i].x); K.setAttribute('cy', v[i].y); }
    }
    // the chosen corner's ring goes where the corner goes
    var ring = st.polyG && st.picked != null && v[st.picked] ? st.polyG.querySelector('.anchor-ring') : null;
    if (ring) { ring.setAttribute('cx', v[st.picked].x); ring.setAttribute('cy', v[st.picked].y); }
    if (st.measG) { while (st.measG.firstChild) st.measG.removeChild(st.measG.firstChild); if (st.measure) drawMeasurements(st.measG); }
  }

  // Actual measuring frames, kept upright and entirely outside the edge.
  // Both the tape and the character use SVG coordinates, including on resize.
  function measureSide(index, done) {
    var frames = global.MeasuringFrames;
    if (reduced() || !frames || !global.requestAnimationFrame) { done(); return; }
    var a = st.verts[index], b = st.verts[(index + 1) % st.verts.length];
    // CLOCKWISE, ALWAYS. Vertex order is the shape's own; in screen
    // coordinates a positive shoelace sum is a clockwise ring, so a side is
    // walked from its first vertex to its second when the ring is clockwise
    // and the other way round when it is not.
    var shoe = 0, VV = st.verts;
    for (var si = 0; si < VV.length; si++) { var P1 = VV[si], P2 = VV[(si + 1) % VV.length]; shoe += P1.x * P2.y - P2.x * P1.y; }
    if (shoe < 0) { var swap = a; a = b; b = swap; }
    var dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (length < 1) { done(); return; }
    var angle = Math.atan2(dy, dx) * 180 / Math.PI;
    var center = Poly.centroid(st.verts), nx = -dy / length, ny = dx / length;
    if (nx * ((a.x + b.x) / 2 - center.x) + ny * ((a.y + b.y) / 2 - center.y) < 0) { nx = -nx; ny = -ny; }
    // 56: small enough that, standing on the side, his head stays inside the
    // slab's face with a 48-unit margin — and the shape gets the rest.
    var cell = 56, baseline = cell * frames.baseline / frames.cell;
    // WHERE THE TAPE IS IN HIS HAND, measured from the sheet: the housing and
    // its tongue lie at y 136..185 of the 256 cell (centre 158), from x 86.
    // The drawn tape runs along the side at that height above his feet and
    // ends under the housing, so the tape he holds and the tape on the shape
    // are one tape.
    var sc = cell / frames.cell, TAPE_Y = 158, TAPE_HEAD = 86;
    var TAPE_OUT = 3 + (frames.baseline - TAPE_Y) * sc;
    var TAPE_TRAIL = (128 - TAPE_HEAD) * sc - 4 * sc;   // how far the strip stops short of his feet' centre
    // Minimum projection of the full upright sprite box onto the outward
    // normal. This keeps every pixel outside, even along the bottom edge.
    // ON THE LINE. His feet are on the side itself and his body stands out
    // from it, the way an ant walks the edge of a leaf; the sprite is turned
    // to the side's outward normal in tick(). Three units keeps his soles
    // just clear of the stroke.
    var ON_LINE = 3;
    var g = mk('g', { 'class': 'swiftee-measuring', 'pointer-events': 'none', 'aria-hidden': 'true', 'data-side': index }, layers.fx);
    g.style.opacity = '0';   // nothing at the side until he has flown there
    var tapeG = mk('g', { transform: 'translate(' + (a.x + nx * TAPE_OUT) + ',' + (a.y + ny * TAPE_OUT) + ') rotate(' + angle + ')' }, g);
    var tape = mk('rect', { x: 0, y: -3.5, width: 0, height: 7, rx: 1.5, fill: '#ffe278', stroke: '#875b13', 'stroke-width': 1.2 }, tapeG);
    var ticks = mk('g', {}, tapeG), marks = [];
    for (var x = 0; x <= length; x += 6) {
      marks.push(mk('line', { x1: x, x2: x, y1: -3.5, y2: x % 30 === 0 ? 2.5 : -0.5,
        stroke: '#65491f', 'stroke-width': 1, visibility: 'hidden' }, ticks));
    }
    mk('path', { d: 'M0,-6 L0,6 L4,6', fill: 'none', stroke: '#586c7c', 'stroke-width': 3 }, tapeG);   // the hook, at the start
    var walker = mk('g', { 'class': 'measuring-walker' }, g);
    var crop = mk('svg', { x: -cell / 2, y: -baseline, width: cell, height: cell,
      viewBox: '0 0 ' + frames.cell + ' ' + frames.cell, overflow: 'hidden' }, walker);
    var sheet = mk('image', { href: frames.image, width: frames.cols * frames.cell, height: frames.rows * frames.cell }, crop);
    var companion = global.Swiftee && Swiftee.el;
    var opacity = companion && companion.style.opacity;
    var raf = null, started = null, stopped = false;
    var duration = Math.max(1600, Math.min(2600, length * 10));   // a walk the child can watch

    /* HE FLIES TO THE SIDE, MEASURES IT, AND FLIES BACK.
     *
     * The measuring sprite used to appear at the side while he vanished from
     * his mark, and vanish while he reappeared: two cuts, both sudden. Now
     * the bird on his mark flies to the start of the side and fades as the
     * measuring sprite takes over there; when the tape is laid he fades back
     * in at the far end and flies home. One bird, one journey. Skipped when
     * he is not on screen, or motion is reduced, or the element cannot
     * animate — then it is the old cut. */
    var M = svg.getScreenCTM && svg.getScreenCTM();
    var page = function (x, y) { return M ? { x: M.a * x + M.e, y: M.d * (y + seatY) + M.f } : null; };
    var flies = !!(companion && companion.animate && global.Swiftee.bounds && parseFloat(opacity || '0') > 0.05 && M);

    /* THIS SEQUENCE OWNS HIM, from the flight out to the flight home.
     *
     * The measuring walk is a dedicated animation and nothing generic may
     * touch the companion while it runs — a face played by a tap, the resting
     * loop, an idle hint, being shown by a line of dialogue. Before this lock
     * one of those did exactly that: the per-tap "well done" face put him back
     * on his mark, visible, while his measuring self was still out walking the
     * side. swiftee.js defers whatever is asked for until release() below. */
    var owns = !!(global.Swiftee && Swiftee.lock);
    if (owns) Swiftee.lock('measuring');
    var released = false;
    var release = function () {
      if (released) return; released = true;
      var at = cleanup.indexOf(release); if (at >= 0) cleanup.splice(at, 1);
      if (owns && Swiftee.unlock) Swiftee.unlock('measuring');
    };
    cleanup.push(release);   // a screen change mid-walk lets go of him too
    var finished = done;
    done = function () { release(); finished(); };
    var here = null, hb = flies && Swiftee.bounds();
    if (hb && hb.width) here = { x: (hb.left + hb.right) / 2, y: hb.bottom }; else flies = false;
    var startAt = page(a.x + nx * ON_LINE, a.y + ny * ON_LINE);
    var endAt = page(b.x + nx * ON_LINE, b.y + ny * ON_LINE);
    function fly(fromD, toD, fadeIn) {
      return new Promise(function (res) {
        var an;
        try {
          an = companion.animate([
            { translate: fromD.x.toFixed(0) + 'px ' + fromD.y.toFixed(0) + 'px', opacity: fadeIn ? 0 : 1 },
            { translate: toD.x.toFixed(0) + 'px ' + toD.y.toFixed(0) + 'px', opacity: fadeIn ? 1 : 0 }
          ], { duration: 640, easing: 'cubic-bezier(.3,.7,.3,1)', composite: 'add', fill: 'none' });
        } catch (e) { res(); return; }
        an.finished.then(res, res);
      });
    }

    function stop() {
      if (stopped) return;
      stopped = true;
      if (raf !== null) global.cancelAnimationFrame(raf);
      g.remove();
      if (companion) companion.style.opacity = opacity;
      var at = cleanup.indexOf(stop); if (at >= 0) cleanup.splice(at, 1);
    }
    cleanup.push(stop);
    // The walk ends: the tape is laid. He comes home before the next side.
    function finish() {
      if (stopped) return;
      stop();
      if (flies && endAt) {
        fly({ x: endAt.x - here.x, y: endAt.y - here.y }, { x: 0, y: 0 }, true).then(done);
      } else done();
    }
    function tick(time) {
      if (stopped) return;
      if (started === null) started = time;
      var elapsed = time - started, progress = Math.min(1, elapsed / duration), distance = length * progress;
      var drawn = Math.max(0, distance - TAPE_TRAIL);   // the strip ends under the housing in his hand
      tape.setAttribute('width', drawn);
      marks.forEach(function (mark, i) { mark.setAttribute('visibility', i * 6 <= drawn ? 'visible' : 'hidden'); });
      var px = a.x + dx * progress, py = a.y + dy * progress;
      var wx = px + nx * ON_LINE, wy = py + ny * ON_LINE;
      // Turned so his "up" is the side's outward normal, and mirrored when
      // the walk runs against the sheet's own left-to-right stride, so he
      // always faces the way he is going.
      var rot = Math.atan2(nx, -ny) * 180 / Math.PI;
      var rr = rot * Math.PI / 180, rx = Math.cos(rr), ry = Math.sin(rr);   // the sprite's "right", in stage space
      var faceLeft = (dx * rx + dy * ry) < 0;
      walker.setAttribute('transform', 'translate(' + wx + ',' + wy + ') rotate(' + rot.toFixed(2) + ')' + (faceLeft ? ' scale(-1,1)' : ''));
      var frame = frames.order[Math.floor(Math.min(elapsed, duration) * frames.fps / 1000) % frames.order.length];
      sheet.setAttribute('x', -(frame % frames.cols) * frames.cell);
      sheet.setAttribute('y', -Math.floor(frame / frames.cols) * frames.cell);
      walker.setAttribute('data-frame', frame);
      if (elapsed < duration + 180) raf = global.requestAnimationFrame(tick);
      else finish();
    }
    var begin = function () {
      if (stopped) return;
      g.style.opacity = '1';
      if (companion) companion.style.opacity = '0';
      raf = global.requestAnimationFrame(tick);
    };
    if (flies && startAt) fly({ x: 0, y: 0 }, { x: startAt.x - here.x, y: startAt.y - here.y }, false).then(begin);
    else begin();
  }

  /**
   * SIDES OF A LENGTH, ANGLES OF A SIZE — who matches whom.
   *
   * Returns a mark number per index: every index of the same measurement
   * gets the same number, 1 for the largest set of equals, then 2, then 3.
   * That is how a figure in a textbook is marked, and it is why one tick
   * across two sides means what it means. Rounded before grouping, or a
   * pixel of drag would split a set of equals into two.
   */
  function marksBy(vals, idxs, q) {
    var groups = {}, order = [];
    idxs.forEach(function (i) {
      var key = String(Math.round(vals[i] / q));
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(i);
    });
    order.sort(function (a, b) { return groups[b].length - groups[a].length || (+a) - (+b); });
    var mark = {};
    order.forEach(function (k, n) { groups[k].forEach(function (i) { mark[i] = Math.min(4, n + 1); }); });
    return { mark: mark, groups: order.length };
  }

  /**
   * THE READINGS ON THE SHAPE.
   *
   * A number is for reading a ruler; a mark is for seeing a match. This
   * draws whichever the moment calls for, and never both at once.
   *
   *   measuring the sides   each tap puts that side's length on an ice tag.
   *                         The equal-side ticks do NOT arrive with them: a
   *                         tick says "this side matches that one", which is
   *                         a statement about the whole shape, so they come
   *                         together once the last side is in.
   *
   *   measuring the angles  the centimetre tags come off. Five tags, five
   *                         arcs and five numbers on one pentagon is a wall
   *                         of type; from here the ticks carry the sides,
   *                         which is exactly what a textbook figure does.
   *
   *   once they differ      the numbers go altogether. Each set of equal
   *                         sides takes its own number of ticks and each set
   *                         of equal angles its own number of arcs, so "these
   *                         three still match and those two no longer do" is
   *                         seen at a glance instead of being worked out from
   *                         ten numbers printed over each other.
   */
  /* HOW MANY DECIMALS BEFORE UNEQUAL SIDES LOOK UNEQUAL.
   *
   * A rounded number lies: 114 units and 120 units are different sides and
   * both come out "4 cm", so a figure printing whole centimetres would claim
   * an equality the shape does not have. That is why the measuring screens
   * stop printing numbers the moment the sides differ — but the stretching
   * screen is ABOUT the sides differing, and a child told to watch the sides
   * change needs to see them change. So instead of dropping the numbers, find
   * the shortest rounding that still tells them apart: if any two sides the
   * shape says are different would print the same, everything gains a decimal
   * place until they do not. `marks` is the grouping the ticks use, so the
   * numbers and the ticks can never disagree. */
  function decimalsFor(vals, marks, unit, cap) {
    for (var d = 0; d <= cap; d++) {
      var ok = true;
      for (var i = 0; i < vals.length && ok; i++) {
        for (var j = i + 1; j < vals.length; j++) {
          if (marks[i] === marks[j]) continue;           // the shape says these two match
          if ((vals[i] / unit).toFixed(d) === (vals[j] / unit).toFixed(d)) { ok = false; break; }
        }
      }
      if (ok) return d;
    }
    return cap;
  }

  function drawMeasurements(g) {
    var v = st.verts, n = v.length, L = Poly.sideLengths(v), A = Poly.interiorAngles(v);
    var c = Poly.centroid(v);
    var has = function (set, i) { return !!set && (set === 'all' || set.indexOf(i) >= 0); };
    var listOf = function (set) { var o = []; for (var k = 0; k < n; k++) if (has(set, k)) o.push(k); return o; };
    var sides = listOf(st.measure.sides), angles = listOf(st.measure.angles);
    var sMark = marksBy(L, sides, 15), aMark = marksBy(A, angles, 3);   // half a centimetre, three degrees
    var measuringAngles = !!st.measure.angles;
    /* THE STRETCHING SCREEN KEEPS ITS NUMBERS.
     *
     * "Watch the sides and angles!" and then the numbers vanish the instant
     * the child does: sideText was false whenever angles were being measured,
     * and the degrees dropped out as soon as two corners differed — so the
     * one screen whose whole point is watching a measurement change was the
     * one that stopped showing measurements the moment it started changing.
     *
     * With `units` the sides print throughout, rounded to whatever it takes
     * to keep unequal sides looking unequal (decimalsFor), and the corners go
     * back to arcs. Centimetres a seven-year-old has met; degrees they have
     * not, and ten numbers on one shape is a wall of type either way. */
    var units = !!st.measure.units;
    var sideText  = units || (!measuringAngles && sMark.groups <= 1);
    var sideTicks = !units && sides.length === n;
    /* THE ANGLES ARE PLAYED WITH TOO. On the stretching screen the corners
       carry their degrees, live, the same way the sides carry centimetres:
       drag the corner and both change under the child's hand. They used to
       go back to nested rings (the textbook's "not the same size" mark),
       which says that two corners differ but not how, and read as a sign in
       a language the lesson never taught. A number is what a child can
       watch change. */
    var angleText = units || aMark.groups <= 1;
    var sideDec = units ? decimalsFor(L, sMark.mark, 30, 2) : 0;

    for (var i = 0; i < n; i++) {
      if (has(st.measure.sides, i)) {
        var a = v[i], b = v[(i + 1) % n];
        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        var dx = mx - c.x, dy = my - c.y, len = Math.hypot(dx, dy) || 1;
        var ux = dx / len, uy = dy / len;
        var t = mk('g', { 'class': 'meas', 'data-side': i }, g);
        if (sideText) {
          /* A TICK ACROSS THE SIDE, AND ITS LENGTH BESIDE IT.
           *
           * This was a dimension line: a second line held off the side for
           * its whole length, capped at both ends — a line running along the
           * side, which read as another side. A measured side is marked the
           * way a geometry book marks one: a short stroke CROSSING it at its
           * middle, square to it, and the figure just outside the shape. The
           * side itself is never redrawn.
           *
           * Once every side is in, the gold equal-side ticks below take the
           * middle instead (a mark per group of equal sides), so the tick
           * here is only drawn while that claim is not yet made. */
          var dink = HI.edge || '#0b4f9e';
          /* NO MARK ACROSS A SIDE WHILE THE SIDES ARE STILL BEING MEASURED.
             A stroke across a side is how a figure says "this one matches that
             one" — the conclusion — and it was drawn on each side as it was
             measured, before there was anything to compare it with. While the
             tape is still going round, a measured side shows its length; the
             marks come when the last side is in (sideTicks, below: one mark
             per group of equal sides, dealt in one after another).
             AND NONE ON THE STRETCHING SCREEN EITHER. Its live readout kept a
             stroke at each middle for the number to hang from — the same
             stroke that means "equal" — so a pulled, lopsided pentagon still
             wore five matching marks while its numbers said otherwise. The
             number stands beside the side on its own; the corners carry
             their degrees. */
          // the figure outside the side, pushed out by its own size so it
          // never sits on the stroke, and kept on the glass
          var dtext = (L[i] / 30).toFixed(sideDec) + ' cm';
          var dtw = dtext.length * 9.5, dth = 17;
          var doff = 16 + Math.abs(ux) * (dtw / 2) + Math.abs(uy) * (dth / 2);
          var lx2 = mx + ux * doff, ly2 = my + uy * doff;
          if (st.panel) {
            var gf2 = panelFace(st.panel);
            lx2 = Math.max(gf2.x + dtw / 2 + 6, Math.min(gf2.x + gf2.w - dtw / 2 - 6, lx2));
            ly2 = Math.max(gf2.y + dth + 4, Math.min(gf2.y + gf2.h - 6, ly2));
          }
          mk('text', { x: lx2, y: ly2 + 6, 'text-anchor': 'middle', 'font-size': 17, 'font-weight': 800,
                       fill: dink, stroke: '#ffffff', 'stroke-width': 3.5, 'paint-order': 'stroke',
                       'stroke-linejoin': 'round', text: dtext }, t);
        }
        if (sideTicks) {
          // the ticks sit across the side at its middle, spaced along it
          var sl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          var tdx = (b.x - a.x) / sl, tdy = (b.y - a.y) / sl;
          var tnx = -tdy, tny = tdx, TL = 9, TS = 7, cnt = sMark.mark[i] || 1;
          var tg = mk('g', { 'class': 'eq-tick', 'data-side': i }, t);
          for (var k = 0; k < cnt; k++) {
            var o = (k - (cnt - 1) / 2) * TS, cx2 = mx + tdx * o, cy2 = my + tdy * o;
            litLine(tg, { x1: cx2 - tnx * TL, y1: cy2 - tny * TL, x2: cx2 + tnx * TL, y2: cy2 + tny * TL, 'stroke-width': 3, 'stroke-linecap': 'round' }, { warm: true });
          }
        }
      }
      // a live readout names each corner by its number, so no rings on top
      if (has(st.measure.angles, i)) drawArc(g, i, angleText ? A[i] : null, units ? 1 : (aMark.groups > 1 ? (aMark.mark[i] || 1) : 1));
    }
  }
  /** Hold a point inside the card's glass, with room for a vertex knob. */
  function clampToCard(p) {
    if (!st.panel) return p;
    var f = panelFace(st.panel), m = 20;
    return { x: Math.max(f.x + m, Math.min(f.x + f.w - m, p.x)),
             y: Math.max(f.y + m, Math.min(f.y + f.h - m, p.y)) };
  }

  function drawArc(g, i, deg, rings) {
    // INTO THE MEASUREMENTS GROUP. This said `ag` — itself, before it
    // existed — so every arc and every number was parented to undefined and
    // landed in the ui layer instead, where renderPoly() never clears them.
    // Dragging a corner stacked a fresh set of five numbers on the old ones
    // every frame: the "119°93°" smear over a corner of the distort screen.
    var ag = mk('g', { 'data-angle': i }, g);   // the arc and its number, one thing to pop in
    var v = st.verts, n = v.length, p = v[i], q = v[(i + n - 1) % n], s = v[(i + 1) % n];
    // SMALL, AND FILLED: a wedge in the corner, the size a textbook draws
    // one, not a wide open arc half way along both sides
    var a1 = Math.atan2(q.y - p.y, q.x - p.x), a2 = Math.atan2(s.y - p.y, s.x - p.x), r = 21;
    var sweep = ((a2 - a1) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    // THE ANGLE IS DRAWN THE WAY A GEOMETRY BOOK DRAWS IT: a line, not a
    // fill. A gold arc inside the corner, from one side to the other, and
    // for a right angle the small square instead — the mark the child will
    // meet in every textbook after this one, lit gold so it is a game's.
    var large = sweep > Math.PI ? 1 : 0;
    var x1 = p.x + Math.cos(a1) * r, y1 = p.y + Math.sin(a1) * r, x2 = p.x + Math.cos(a2) * r, y2 = p.y + Math.sin(a2) * r;
    // the arc from a1 to a2 the positive way round has its midpoint at a1 +
    // sweep/2 (the mean of the two angles is wrong once they wrap at +/-pi);
    // it is the interior arc when that midpoint is inside the shape
    var mid = a1 + sweep / 2;
    var inside = Poly.contains(v, { x: p.x + Math.cos(mid) * 10, y: p.y + Math.sin(mid) * 10 });
    var d = inside
      ? 'M' + x1 + ' ' + y1 + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x2 + ' ' + y2
      : 'M' + x1 + ' ' + y1 + ' A' + r + ' ' + r + ' 0 ' + (1 - large) + ' 0 ' + x2 + ' ' + y2;
    // THE WEDGE: the corner itself, filled — from the vertex out along one
    // side, round the arc, and back along the other — so the angle reads as
    // a piece of the shape rather than as a line drawn near it
    var wedge = 'M' + p.x + ' ' + p.y + ' L' + x1 + ' ' + y1 + ' ' + d.slice(d.indexOf('A')) + ' Z';
    if (deg != null && Math.abs(deg - 90) < 1.5) {
      // the right-angle square: two short lines meeting inside the corner
      var rs = r * 0.7, ux = Math.cos(a1) * rs, uy = Math.sin(a1) * rs, wx = Math.cos(a2) * rs, wy = Math.sin(a2) * rs;
      d = 'M' + (p.x + ux) + ' ' + (p.y + uy) + ' L' + (p.x + ux + wx) + ' ' + (p.y + uy + wy) + ' L' + (p.x + wx) + ' ' + (p.y + wy);
      wedge = 'M' + p.x + ' ' + p.y + ' L' + (p.x + ux) + ' ' + (p.y + uy) + ' L' + (p.x + ux + wx) + ' ' + (p.y + uy + wy) + ' L' + (p.x + wx) + ' ' + (p.y + wy) + ' Z';
    }
    // warm gold on the cool blue shape: the one mark on it that is an angle
    mk('path', { d: wedge, fill: '#ffd35a', 'fill-opacity': 0.82, stroke: 'none' }, ag);
    var w = mk('path', { d: d, fill: 'none', stroke: '#fff4c9', 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, ag);
    // EQUAL ANGLES, EQUAL ARCS. A second and a third ring nested inside the
    // first is how a figure says "this corner is not the same size as that
    // one" without printing a single degree.
    for (var ri = 1; ri < (rings || 1) && deg == null; ri++) {
      var rr = r - ri * 7; if (rr < 8) break;
      var qx1 = p.x + Math.cos(a1) * rr, qy1 = p.y + Math.sin(a1) * rr, qx2 = p.x + Math.cos(a2) * rr, qy2 = p.y + Math.sin(a2) * rr;
      var dd = inside
        ? 'M' + qx1 + ' ' + qy1 + ' A' + rr + ' ' + rr + ' 0 ' + large + ' 1 ' + qx2 + ' ' + qy2
        : 'M' + qx1 + ' ' + qy1 + ' A' + rr + ' ' + rr + ' 0 ' + (1 - large) + ' 0 ' + qx2 + ' ' + qy2;
      mk('path', { d: dd, fill: 'none', stroke: HI.line, 'stroke-width': 3, 'stroke-linecap': 'round', style: litGlow(HI.lit) }, ag);
    }
    // THE NUMBER SITS INSIDE THE SHAPE, on the corner's bisector, past the
    // wedge — degrees inside, centimetres outside, and neither on the other.
    if (deg != null) {
      var cc = Poly.centroid(v), bx = cc.x - p.x, by = cc.y - p.y, bl = Math.hypot(bx, by) || 1;
      var tx = p.x + bx / bl * (r + 24), ty = p.y + by / bl * (r + 24);
      mk('text', { x: tx, y: ty + 6, 'text-anchor': 'middle', 'font-size': 17, 'font-weight': 800, fill: '#f2fdff',
                   stroke: '#123a7a', 'stroke-width': 3.5, 'paint-order': 'stroke', 'stroke-linejoin': 'round',
                   text: Math.round(deg) + '°' }, ag);
    }
    return w;
  }

  /* ------------------------------------------------------------------ *
   * Shape library for grids and sorting — judged by Poly at runtime
   * ------------------------------------------------------------------ */

  function shapeVerts(name, r, cx, cy) {
    switch (name) {
      case 'triangle':  return Poly.regular(3, r, cx, cy + r * 0.15);
      case 'square':    return Poly.regular(4, r, cx, cy);
      case 'pentagon':  return Poly.regular(5, r, cx, cy);
      case 'hexagon':   return Poly.regular(6, r, cx, cy);
      case 'octagon':   return Poly.regular(8, r, cx, cy);
      case 'rhombus':   return [{ x: cx, y: cy - r * 0.6 }, { x: cx + r, y: cy }, { x: cx, y: cy + r * 0.6 }, { x: cx - r, y: cy }];
      // A quadrilateral with no two sides the same and no two angles the
      // same. The deck's second classification case wants "both sides AND
      // angles unequal", and a rhombus is the wrong shape for it: its sides
      // ARE all equal, which is the fifth case's property, not the second's.
      // Two cards teaching the same fact leaves one of the five facts untaught.
      case 'irregular-quad': return [
        { x: cx - r * 0.58, y: cy - r * 0.92 },
        { x: cx + r * 1.02, y: cy - r * 0.10 },
        { x: cx + r * 0.22, y: cy + r * 0.48 },
        { x: cx - r * 0.98, y: cy + r * 0.94 }
      ];
      case 'chevron':   return [{ x: cx - r, y: cy + r * .7 }, { x: cx, y: cy - r * .8 }, { x: cx + r, y: cy + r * .7 }, { x: cx, y: cy + r * .1 }];
      case 'l-shape':   return [{ x: cx - r * .8, y: cy - r * .8 }, { x: cx - r * .1, y: cy - r * .8 }, { x: cx - r * .1, y: cy + r * .1 }, { x: cx + r * .8, y: cy + r * .1 }, { x: cx + r * .8, y: cy + r * .8 }, { x: cx - r * .8, y: cy + r * .8 }];
      // A RECTANGLE: every angle the same, the sides not — irregular for the
      // opposite reason to the rhombus beside it in the swipe deck
      case 'rectangle': return [{ x: cx - r, y: cy - r * 0.58 }, { x: cx + r, y: cy - r * 0.58 }, { x: cx + r, y: cy + r * 0.58 }, { x: cx - r, y: cy + r * 0.58 }];
      case 'star': { var o = []; for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .42 : r; o.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr }); } return o; }
      case 'stretched-hexagon': { var h = Poly.regular(6, r, cx, cy); return h.map(function (p) { return { x: cx + (p.x - cx) * 1.35, y: p.y }; }); }
      case 'equilateral-concave-hexagon': {
        // Regular hexagon with one vertex reflected across the chord of its
        // two neighbours. Both adjacent sides keep their length exactly, so
        // all six sides stay equal while one angle becomes reflex — the
        // deck's "angles unequal, sides same length" case.
        var h6 = Poly.regular(6, r, cx, cy);
        var a = h6[5], b = h6[1], m = h6[0];
        var dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1;
        var t = ((m.x - a.x) * dx + (m.y - a.y) * dy) / len2;
        var fx = a.x + t * dx, fy = a.y + t * dy;
        h6[0] = { x: 2 * fx - m.x, y: 2 * fy - m.y };
        return h6;
      }
      default: return Poly.regular(5, r, cx, cy);
    }
  }
  // NO TWO SHAPES ON ONE SCREEN SHARE A COLOUR. The square and the chevron
  // were both green and the rhombus and pentagon both pink, so a sorting
  // tray showed pairs that read as one kind before the child had looked at
  // their corners. Colour never marks the category — the sort is judged
  // by Poly.classify, and a green shape may land in either bin — it only
  // tells the cards apart.
  var COLORS = { triangle: '#a97bff', square: '#2fd6c8', pentagon: '#ff7a91', hexagon: '#45bdff', octagon: '#4c8fe8',
                 rhombus: '#f06cff', chevron: '#35b06a', 'l-shape': '#ffc93c', star: '#ff9f5a', 'stretched-hexagon': '#6f8cff',
                 'irregular-quad': '#ffb27a', 'equilateral-concave-hexagon': '#a97bff', rectangle: '#ff9f5a' };

  function drawShape(name, r, cx, cy, parent) {
    var g = mk('g', { 'class': 'shape', 'data-shape': name }, parent);
    var col = COLORS[name] || '#5b95ee';
    if (name === 'circle') { mk('circle', { cx: cx, cy: cy, r: r * .85, fill: '#ffb27a', stroke: '#c9611a', 'stroke-width': 4 }, g); return g; }
    if (name === 'open-path') { mk('path', { d: 'M' + (cx - r) + ' ' + (cy + r * .7) + ' L' + (cx - r * .5) + ' ' + (cy - r * .6) + ' L' + (cx + r * .5) + ' ' + (cy - r * .6) + ' L' + (cx + r) + ' ' + (cy + r * .7), fill: 'none', stroke: '#a23bd6', 'stroke-width': 5, 'stroke-linecap': 'round' }, g); return g; }
    var v = shapeVerts(name, r, cx, cy);
    // Edged in a darker step of its own colour, not in ink: a pink pentagon
    // with a pink edge is a shape; with a black edge it is a diagram of one.
    mk('path', { d: pathOf(v), fill: 'url(#' + candy(col) + ')', stroke: shade(col, -0.42), 'stroke-width': 3, 'stroke-linejoin': 'round' }, g);
    g._verts = v;
    return g;
  }

  /* ------------------------------------------------------------------ *
   * Scene builders
   * ------------------------------------------------------------------ */

  function reset() {
    dropTimers();
    alive(false);
    endInteraction();
    clear('panel'); clear('poly'); clear('ui'); clear('fx');
    st = { showVerts: false, touchVerts: false };
    heldForWord = [];          // the old scene's pieces are gone, and so is their wait
    applySeat(false);
  }

  var BUILD = {
    vista: function () { reset(); },

    polygon: function (spec) {
      var morph = spec.enter === 'morph' && st.verts;
      var prev = morph ? st.verts.slice() : null;
      reset();
      var p = spec._panel ? Object.assign({}, spec._panel) : panelFor(spec.panel || 'right', spec);
      st.panel = p; st.kind = 'polygon'; st.buildSpec = specOf(spec);
      panel(p, { enter: morph ? false : spec.enter });
      var P = polygonIn(p, spec.sides || 5, { below: spec.below, room: spec.room });
      st.verts = P.verts; st.cx = P.cx; st.cy = P.cy; st.r = P.r; st.n = spec.sides || 5;
      st.polyG = mk('g', { 'class': 'polygon' }, layers.poly);
      st.diagonals = [];
      renderPoly();
      if (morph && prev) morphFrom(prev);
      else if (!reduced()) enter(st.polyG, 'pop');
      if (spec.label) op.label(spec.label);
      if (spec.badge) op.badge(spec.badge);
      if (spec.diagonals) op.diagonals(spec);
    },

    'choice-grid': function (spec) {
      reset(); st.kind = 'grid';
      var opts = spec.options || [];
      // CENTRED. The four cells sat at 500..970 of a 1000-wide stage, so the
      // question filled the right-hand third and the left half of the screen
      // held nothing at all. Pulled in far enough to read as the middle of the
      // screen, and still clear of where Swiftee stands on this one.
      // Two by two, centred on the stage, in the band below the plank: the
      // cells used to start at y 50 and the top row ran up under the plank.
      // WITH HIM ON THE LEFT, THE OPTIONS TAKE THE RIGHT: a two-by-two block
      // with the asker standing on the ice beside it and his question over
      // his head. He asks it, so there is no plank on this screen, and the
      // block does not hang from the plank line: the four cards are as big
      // as the height allows, a thumb's width apart, and the block is
      // centred in the WHOLE stage height with the same margin above and
      // below. Its right edge stops short of the HUD's corner (x 910), so
      // the top-right card and the buttons never meet. Sat on the plank band
      // it started a fifth of the way down and its bottom row touched the
      // floor. Without him the block is centred and spread to use the width.
      var standsLeft = global.Swiftee && Swiftee.pos === 'left';
      var HALF = standsLeft ? 124 : 98, GAP = standsLeft ? 22 : 28, band = BOTTOM - TOP;
      var OF = global.CardFrame && CardFrame.option;
      var cardH = 2 * HALF * (OF ? OF.h / OF.w : 1);
      var PITCH_X = standsLeft ? 2 * HALF + GAP : 400;
      var gx = standsLeft ? 638 : W / 2;
      var cells;
      if (standsLeft) {
        var y0 = (H - (2 * cardH + GAP)) / 2 + cardH / 2;
        var y1 = y0 + cardH + GAP;
        cells = [[gx - PITCH_X / 2, y0], [gx + PITCH_X / 2, y0], [gx - PITCH_X / 2, y1], [gx + PITCH_X / 2, y1]];
      } else {
        cells = [
          [gx - PITCH_X / 2, TOP + band * 0.25], [gx + PITCH_X / 2, TOP + band * 0.25],
          [gx - PITCH_X / 2, TOP + band * 0.75], [gx + PITCH_X / 2, TOP + band * 0.75]
        ];
      }
      st.cards = opts.map(function (o, i) {
        var x = cells[i][0], y = cells[i][1];
        var g = mk('g', { 'class': 'card', 'data-id': o.id }, layers.ui);
        var seat = mk('g', { transform: 'translate(' + x + ',' + y + ')' }, g);
        g._card = optionCard(seat, HALF, o.shape);
        g._opt = o;
        if (spec.enter === 'stagger' && !reduced()) { g.style.opacity = 0; later(i * 110, function () { g.style.opacity = 1; enter(g, 'pop'); }); }
        return g;
      });
    },

    compare: function (spec) {
      reset(); st.kind = 'compare'; st.buildSpec = specOf(spec);
      var sides = [['left', PANELS.left2, spec.left], ['right', PANELS.right2, spec.right]];
      st.compare = {};
      sides.forEach(function (s, i) {
        var pnl = s[1], cfg = s[2] || {};
        var g = panel(pnl, { enter: spec.enter === 'split' ? 'rise' : 'pop' });
        /* THE CHILD'S OWN SHAPE, when the card is showing the kind of shape
           they have just made. "This one" beside a stock stretched pentagon
           is a different pentagon from the one they pulled a minute ago; the
           one they made is the one they understand. `made` names it (the
           condition the drag stopped at: 'concave', 'irregular'); a screen
           reached without making it — a jump, Back past it — shows the stock
           shape, marked the same way. */
        var mine = cfg.made ? madeShape(cfg.made, cfg.sides || 5) : null;
        // the caption goes UNDER the card as a name tag, so the shape has the whole face
        var P = polygonIn(pnl, cfg.sides || 5, mine ? { shape: mine.verts } : { dent: cfg.dent, stretch: cfg.stretch });
        var markAt = mine ? mine.moved : cfg.dent;
        var pg = mk('g', {}, layers.poly);
        mk('path', { d: pathOf(P.verts), fill: 'url(#' + candy(SHAPE.fill) + ')', stroke: SHAPE.edge, 'stroke-width': SHAPE.edgeW, 'stroke-linejoin': 'round' }, pg);
        if (cfg.diagonals === 'all') {
          Poly.allDiagonals(P.verts.length).forEach(function (d) {
            var a = P.verts[d[0]], b = P.verts[d[1]];
            var out = !Poly.isDiagonalInside(P.verts, d[0], d[1]);
            litLine(pg, { x1: a.x, y1: a.y, x2: b.x, y2: b.y, 'stroke-width': out ? 5 : 4, 'stroke-dasharray': '10 9', 'stroke-linecap': 'round' }, { bad: out });
          });
        }
        if (markAt != null && P.verts[markAt] && (cfg.dent != null || mine)) mk('circle', { cx: P.verts[markAt].x, cy: P.verts[markAt].y, r: 9, fill: HI.fill, stroke: HI.edge, 'stroke-width': 2.5 }, pg);
        var tagEl = cfg.caption ? nameTag(layers.ui, pnl.x + pnl.w / 2, pnl.y + pnl.h + 38, cfg.caption, cfg.tone) : null;
        // a name that is spoken arrives when it is (holdForWord)
        if (tagEl && cfg.captionCue) holdForWord(tagEl, cfg.captionCue);
        st.compare[s[0]] = { panel: pnl, g: g, pg: pg, verts: P.verts, tone: cfg.tone, tag: tagEl };
      });
    },

    /**
     * Swipe classification: one shape, two destinations.
     *
     * The deck's own mechanic for this page — `originalMechanic: 'swipe'` in
     * screens.js records that it was swapped for drag-to-bin once and has now
     * been asked back. It is a different question from the drag-to-bin sort
     * on page 27: that one asks "which pile does each of these belong in",
     * this one asks "this one — left or right?", and a binary choice made
     * with the whole hand is a better fit for a binary property than a
     * journey across the screen.
     *
     * FIVE ROUNDS, ONE AT A TIME. The five shapes are never on screen
     * together; the interaction below walks them. The zones and the hint are
     * built once and stay put, so nothing moves under the child between
     * rounds except the card itself.
     *
     * The zones are inset far enough to clear Swiftee on the left and the
     * HUD on the right — a zone the character stands on top of is a zone the
     * gate for "no overlay covers the lesson" would fail on, and rightly.
     */
    'swipe-sort': function (spec) {
      reset(); st.kind = 'swipe-sort';
      st.swipe = { zones: {}, items: (spec.items || []).slice(), i: 0, spec: spec, card: null };

      /* THE TWO BINS ARE THE ANSWER; THE SHAPE IS THE QUESTION.
       *
       * They were 316 wide against a 192 card, so two thirds of the screen
       * was taken by the places to put the shape and the shape itself was the
       * smallest thing on it — a child looking for what to decide had to look
       * past the decision to find it. The bins are destinations: they need to
       * be big enough to read, to hit, and to hold a pile, and no bigger. The
       * corridor they leave is the stage now, and the card in it is where the
       * eye goes first.
       */
      var ZW = 232, ZH = 268, ZY = TOP + 26;
      [{ id: 'regular', x: 38 },
       { id: 'irregular', x: W - 38 - ZW }].forEach(function (z) {
        var def = (spec.zones || []).filter(function (d) { return d.id === z.id; })[0] || { id: z.id, label: z.id };
        var c = CONCEPT[z.id] || CONCEPT.regular;
        var tone = [c.wash, c.face, c.ink];
        var g = mk('g', { 'class': 'zone', 'data-zone': z.id }, layers.ui);

        /* THE ZONE IS THE ARTWORK, AND THE WORD IS LETTERED ON ITS GLASS.
         *
         * The frames are blank ice — a cyan rim for regular, a violet one for
         * irregular, the concept's own colours — so the title is drawn here,
         * in the concept's ink on a band of its wash, inside the top of the
         * pane. The shelf for what the child has caught begins under it. */
        var Z = global.CardFrame && CardFrame[z.id];
        var TITLE_H = 46, titleBottom = 0;
        /* THE WHOLE ZONE TAKES A TAP. The artwork is not hit-testable (its
           transparent corners must not catch taps meant for the card), so a
           tap anywhere on the glass found nothing under it and did nothing —
           only the title strip answered. The tap is the swipe's accessible
           twin; it has to work wherever a child would press. */
        mk('rect', { x: z.x + 6, y: ZY + 6, width: ZW - 12, height: ZH - 12, rx: 24,
                     fill: '#000', 'fill-opacity': 0, 'class': 'zone-hit' }, g);
        if (Z) {
          var im = mk('image', {
            x: z.x, y: ZY, width: ZW, height: ZH,
            preserveAspectRatio: 'none', 'pointer-events': 'none'
          }, g);
          im.setAttributeNS('http://www.w3.org/1999/xlink', 'href', Z.src);
          im.setAttribute('href', Z.src);
          var pane = Z.pane || { x: 0.06, y: 0.09, w: 0.88, h: 0.82 };
          var px0 = z.x + ZW * pane.x, pw = ZW * pane.w, py0 = ZY + ZH * pane.y + 10;
          mk('rect', { x: px0 + 14, y: py0, width: pw - 28, height: TITLE_H, rx: 14, fill: c.face, opacity: 0.30 }, g);
          mk('text', { x: z.x + ZW / 2, y: py0 + 32, 'text-anchor': 'middle', 'font-size': 27,
                       'font-weight': 800, fill: c.ink, text: def.label }, g);
          titleBottom = py0 + TITLE_H + 8;
        } else {
          // No artwork: the drawn zone, so the practice still works.
          mk('rect', { x: z.x, y: ZY + 7, width: ZW, height: ZH, rx: 26, fill: tone[1], opacity: 0.35 }, g);
          mk('rect', { x: z.x, y: ZY, width: ZW, height: ZH, rx: 26, fill: tone[0], stroke: tone[1], 'stroke-width': 3 }, g);
          mk('rect', { x: z.x + 16, y: ZY + 12, width: ZW - 32, height: 52, rx: 16, fill: c.deep }, g);
          mk('text', { x: z.x + ZW / 2, y: ZY + 47, 'text-anchor': 'middle', 'font-size': 30,
                       'font-weight': 700, fill: '#fff', text: def.label }, g);
        }

        g._rect = { x: z.x, y: ZY, w: ZW, h: ZH };
        var q = Z && Z.pane;
        g._shelf = q
          ? { x: z.x + ZW * q.x, y: titleBottom, w: ZW * q.w, h: ZY + ZH * (q.y + q.h) - titleBottom - 6 }
          : { x: z.x + 26, y: ZY + 86, w: ZW - 52, h: ZH - 112 };
        g._kept = [];
        g._keptG = mk('g', { 'class': 'zone-kept' }, g);
        // No counter. The pile itself is the count — a child can see two
        // shapes in one zone and three in the other without being told, and a
        // number in the corner of a picture reads as part of the picture.
        g._tone = tone;
        st.swipe.zones[z.id] = g;
        if (spec.enter !== false) enter(g, 'rise');
      });

      dealCard();
    },

    sort: function (spec) {
      reset(); st.kind = 'sort'; st.sort = { bins: [], items: [], placed: 0, spec: spec };
      var bins = spec.bins || [];
      // CENTRED. The row was pushed 120 to the right to leave a column for
      // Swiftee on the left, which left the lesson sitting off-centre on every
      // screen that uses it — and he is placed by the screen now, so the
      // lesson does not have to make room for a guess about where he is.
      // The collection is the point: it gets the room; 360 seats three cards
      // at full size. The foot stops at 492 so the Convex bin's corner clears
      // the Back pill in the bottom-left (it ended at 518, on top of it).
      var bw = 360, gap = 30, bh = 226, by = 266;
      var x0 = (W - (bins.length * bw + (bins.length - 1) * gap)) / 2;
      bins.forEach(function (b, i) {
        var x = x0 + i * (bw + gap), y = by;
        var g = mk('g', { 'class': 'bin', 'data-bin': b.id }, layers.ui);
        var c = CONCEPT[b.tone] || CONCEPT.convex;
        var tone = [c.wash, c.face, c.ink];
        // THE BIN IS A CARD FROM THE KIT — aqua for convex, lilac for
        // concave — with the word lettered on a band of the concept's colour
        // inside the top of its glass. The drawn card remains as the fallback.
        var BF = global.CardFrame && CardFrame[b.tone + 'Bin'];
        var pane = { x: x + 12, y: y + 10, w: bw - 24, h: bh - 20 };
        if (BF) {
          var im = mk('image', { x: x, y: y, width: bw, height: bh, preserveAspectRatio: 'none', 'pointer-events': 'none' }, g);
          im.setAttributeNS('http://www.w3.org/1999/xlink', 'href', BF.src);
          im.setAttribute('href', BF.src);
          if (BF.pane) pane = { x: x + bw * BF.pane.x, y: y + bh * BF.pane.y, w: bw * BF.pane.w, h: bh * BF.pane.h };
        } else {
          mk('rect', { x: x, y: y, width: bw, height: bh, rx: UI.radius, fill: tone[0], stroke: tone[1], 'stroke-width': UI.rim }, g);
        }
        mk('rect', { x: pane.x + 10, y: pane.y + 8, width: pane.w - 20, height: 40, rx: 12, fill: tone[1], opacity: .30 }, g);
        mk('text', { x: x + bw / 2, y: pane.y + 36, 'text-anchor': 'middle', 'font-size': UI.title, 'font-weight': 800, fill: c.ink, text: b.label }, g);
        g._bin = b; g._rect = { x: x, y: y, w: bw, h: bh }; g._count = 0;
        // the shelf: the glass below the title band
        g._pane = { x: pane.x, y: pane.y + 52, w: pane.w, h: pane.h - 56 };
        st.sort.bins.push(g);
        // "...as convex or concave?": each bin comes in on its own word
        if (spec.binsCue && holdForWord(g, b.cueWord || b.id)) return;
        if (spec.enter && !reduced()) enter(g, 'rise');
      });
      var items = spec.items || [];
      var visible = spec.oneAtATime ? [items[0]] : items;
      st.sort.queue = spec.oneAtATime ? items.slice(1) : [];
      st.sort.total = items.length;
      // The tray has to fit the stage whatever the screen asks for. A fixed
      // 132px pitch put the sixth of six shapes at x = 1005 in a 1000-wide
      // viewBox: drawn off the edge, clipped, and impossible to drag. Derive
      // the pitch from the width instead, and never exceed the natural one.
      var ITEM = 92, MARGIN = 24;
      var pitch = Math.min(ITEM + 12, (W - 2 * MARGIN - ITEM) / Math.max(1, visible.length - 1));
      var span = (visible.length - 1) * pitch;
      var ix0 = (W - span) / 2;
      visible.forEach(function (name, i) {
        st.sort.items.push(makeSortItem(
          name,
          spec.oneAtATime ? W / 2 + 120 : ix0 + i * pitch,
          spec.oneAtATime ? 210 : TOP + 58,           // clear of the plank
          i
        ));
      });
    },

    builder: function (spec) {
      reset(); st.kind = 'builder';
      // THE SAME CARD AS EVERY OTHER SINGLE-SHAPE SCREEN: on the right, with
      // him on the ice at the left and his words beside his head. Centred,
      // the card left no band for the bubble, and his line went to the top.
      var p = spec._panel ? Object.assign({}, spec._panel) : panelFor('right', Object.assign({ controls: true }, spec)); st.panel = p;
      st.buildSpec = specOf(spec);
      panel(p, { enter: spec.enter });
      var n = spec.sides || 3;
      var P = polygonIn(p, n, {});
      st.verts = P.verts; st.cx = P.cx; st.cy = P.cy; st.r = P.r; st.n = n;
      // NO HANDLES UNTIL THERE IS SOMETHING TO TAKE HOLD OF. The builder
      // used to dress every vertex as a drag handle from the first screen,
      // where the only control is the stepper — five cream knobs on a shape
      // nobody could drag yet. The 'drag-vertex' input dresses them when it
      // arms, which is when they mean something.
      st.showVerts = false; st.touchVerts = false;
      st.polyG = mk('g', { 'class': 'polygon' }, layers.poly);
      st.diagonals = [];
      renderPoly();
      // stepper
      // The label sat ten pixels above the value and overlapped it, and the
      // two buttons disagreed with each other — a grey minus beside a blue
      // plus, as though one of them were disabled. The label has its own line
      // above the control now, and both buttons are the same amber pill as
      // everything else pressable in the game.
      // A COMPACT BAR UNDER THE PANEL, not a feature card on top of the
      // shape. It was 328 by 104 inside the slab, sitting on the polygon's
      // own base vertices; it is an indicator now — the word, the number,
      // and the two buttons — in the control band every other question
      // uses, so the polygon has the whole panel to itself.
      var sy = controlY(), sx = p.x + p.w / 2;
      var g = mk('g', { 'class': 'stepper' }, layers.ui);
      st.stepperG = g;
      // JUST THE CONTROL. The plank already says what the number is; a
      // second label beside the bar said it again. Minus, the number, plus,
      // centred under the shape.
      var SH = CONTROL_H, BW = 186;
      var x1 = sx - BW / 2;
      mk('rect', { x: x1, y: sy - SH / 2, width: BW, height: SH, rx: UI.radius,
                   fill: UI.paper, stroke: UI.paperRim, 'stroke-width': UI.rim }, g);
      st.stepMinus = pill(g, { x: x1 + 8, y: sy, w: 50, h: 44, label: '−', tone: 'sun', glyph: 'stepMinus', press: true, attrs: { 'class': 'step-minus' } });
      st.stepPlus  = pill(g, { x: x1 + BW - 58, y: sy, w: 50, h: 44, label: '+', tone: 'sun', glyph: 'stepPlus', press: true, attrs: { 'class': 'step-plus' } });
      st.stepText = mk('text', { x: x1 + BW / 2, y: sy + 11, 'text-anchor': 'middle', 'font-size': 30, 'font-weight': 800, fill: UI.ink, text: n }, g);
      st.stepper = { min: (spec.stepper && spec.stepper.min) || 1, max: (spec.stepper && spec.stepper.max) || 8 };
      syncStepper();
      // "Adjust the number of sides": the control arrives with the words
      // that tell the child to use it (not on a restored scene, which was seen)
      if (spec.stepper && spec.stepper.cue && !spec._panel) holdForWord(g, spec.stepper.cue);
    },

    /**
     * THE END-GAME SUMMARY: everything the lesson taught, collected.
     *
     * One large card at a time in the middle, its idea shown by animating it
     * — the polygon drawing itself, a corner lighting, a side drawing between
     * two corners — with its name on a tag hung off its bottom edge. He rises
     * from behind it to say what it is, sinks back, and the card shrinks away
     * into the collection: the parts of a polygon down the left edge, the
     * kinds of polygon down the right, so the middle is always clear for the
     * card that is being shown. The screen's beats run it (screens.js
     * summaryBeats); this only draws, and says which state it is in.
     */
    summary: function (spec) {
      reset(); st.kind = 'summary';
      st.summary = { concepts: (spec.concepts || []).slice(), cards: {}, collected: [], active: null, state: 'SUMMARY_START' };
      evt('summary:state', { state: 'SUMMARY_START' });
    }
  };

  /* ------------------------------------------------------------------ *
   * The end-game summary's card
   *
   * ONE CARD, EIGHT IDEAS. Every concept is the same card — the display
   * slab (a thing to look at, not the block of ice a thing is touched on),
   * a tag hung off its bottom edge — and what differs is data: which corners
   * light, which line draws, which corner moves (SUMMARY_VISUALS). It is
   * drawn in stage coordinates with no transform of its own until it is
   * collected, so the word cues can trace its lines (emphasize clones them
   * onto the effects layer) and the juice that animates `transform` cannot
   * throw it to the origin.
   *
   * THE STATES, one at a time, never two (Stage.summaryState()):
   *   SUMMARY_START → CARD_ENTER → CONCEPT_REVEAL → SWIFTEE_ENTER →
   *   EXPLANATION → READING_PAUSE → SWIFTEE_EXIT → CARD_COLLECT →
   *   NEXT_CONCEPT → … → FINAL_SUMMARY
   * The card's own states are set here; his rising, his line, its reading
   * pause and his sinking are the screen's beats, and game.js passes on the
   * director's word for when each begins (summaryPhase).
   * ------------------------------------------------------------------ */
  var SUM = {
    // THE BIG CARD, IN THE CLEAR MIDDLE — and low enough that the band over
    // it holds his line: he rises behind its top edge, and a card any higher
    // left no room above his head, so each line went wherever there was room
    // (top-left for one card, top-right for the next, a banner for a third)
    card: { cx: 500, cy: 350, w: 280 },
    shape: { cx: 500, cy: 354, r: 80 },            // the pentagon every idea is shown on
    // THE COLLECTION: four down each edge, the parts of a polygon on the
    // left and the kinds on the right, clear of the HUD above and of Back
    // and Next below, each card's name with a clear gap under it
    mini: { w: 76, x: [70, 930], y0: 94, pitch: 110 },
    enterMs: 420, collectMs: 580
  };

  /* WHAT EACH CARD SHOWS, as data.
   *   hi     the corners that light       line   a segment between two of them:
   *   sides  the sides lit from a corner          'side' warm, 'diag' ice, 'out' violet
   *   wedge  the corner whose angle fills  diags  every diagonal, in turn
   *   move   a corner that travels, [index, x, y] in radii from the middle
   *   marks  the lesson's own equal-side notation (shapeMarks options)
   *   draw   the polygon draws itself first
   * Every one is checked against polygon-math by the tests (summaryGeometry). */
  var SUMMARY_VISUALS = {
    vertex:    { draw: true, hi: [0], pulse: true, near: 0 },
    side:      { hi: [0, 1], line: [0, 1, 'side'] },
    angle:     { hi: [0], sides: [[0, 4], [0, 1]], wedge: 0 },
    diagonal:  { hi: [0, 2], line: [0, 2, 'diag'] },
    convex:    { tone: 'convex', diags: true },
    concave:   { tone: 'concave', move: [0, 0, 0.08], line: [1, 4, 'out'] },
    regular:   { tone: 'regular', marks: { all: true, degrees: false } },
    irregular: { tone: 'irregular', move: [1, 1.273, -0.568], marks: {} }
  };

  /** The card's pentagon: as it starts, or as it ends once its corner has moved. */
  function summaryVerts(id, final) {
    var S = SUM.shape, V = SUMMARY_VISUALS[id] || {};
    var v = global.Poly ? Poly.regular(5, S.r, S.cx, S.cy) : [];
    if (final && V.move && v[V.move[0]]) v[V.move[0]] = { x: S.cx + V.move[1] * S.r, y: S.cy + V.move[2] * S.r };
    return v;
  }

  function setSummary(state, id) {
    var S = st.summary;
    if (!S || S.state === state) return;
    S.state = state;
    evt('summary:state', { state: state, card: id || S.active || null });
  }

  /** A pause that belongs to the summary: resolves when it is up, or at once if the scene has gone. */
  function sumHold(ms) { return reduced() ? Promise.resolve(true) : hold(ms); }

  /** A line that grows from one end to the other, stepped on its own end point. */
  function growLine(line, a, b, ms, delay) {
    var set = function (t) { line.setAttribute('x2', (a.x + (b.x - a.x) * t).toFixed(1)); line.setAttribute('y2', (a.y + (b.y - a.y) * t).toFixed(1)); };
    line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
    if (reduced() || !global.requestAnimationFrame) { set(1); line.setAttribute('opacity', 1); return; }
    set(0);
    later(delay || 0, function () {
      line.setAttribute('opacity', 1);
      var g = sceneGen, t0 = null;
      var step = function (now) {
        if (g !== sceneGen) return;
        if (t0 == null) t0 = now;
        var t = Math.min(1, (now - t0) / ms);
        set(1 - Math.pow(1 - t, 3));
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  /** A mark arrives: small, a touch past full size, settled. */
  function sumPop(el, delay, big) {
    el.setAttribute('opacity', 1);
    if (reduced() || !el.animate) return;
    el.style.transformBox = 'fill-box'; el.style.transformOrigin = 'center';
    try {
      el.animate([{ opacity: 0, scale: '.3' }, { opacity: 1, scale: big ? '1.35' : '1.2', offset: 0.6 }, { opacity: 1, scale: '1' }],
                 { duration: 320, delay: delay || 0, easing: 'cubic-bezier(.3,1.3,.5,1)', fill: 'backwards' });
    } catch (e) {}
  }

  /** A corner travels, and the outline (and its knob) go with it. */
  function moveCorner(c, i, to, ms, delay, then) {
    var from = { x: c._verts[i].x, y: c._verts[i].y };
    var put = function (t) {
      var e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      c._verts[i] = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
      c._outline.setAttribute('d', pathOf(c._verts));
      if (c._mover) { c._mover.setAttribute('cx', c._verts[i].x.toFixed(1)); c._mover.setAttribute('cy', c._verts[i].y.toFixed(1)); }
    };
    if (reduced() || !global.requestAnimationFrame) { put(1); if (then) then(); return; }
    later(delay || 0, function () {
      var g = sceneGen, t0 = null;
      var step = function (now) {
        if (g !== sceneGen) return;
        if (t0 == null) t0 = now;
        var t = Math.min(1, (now - t0) / ms);
        put(t);
        if (t < 1) requestAnimationFrame(step); else if (then) then();
      };
      requestAnimationFrame(step);
    });
  }

  /** The one card: the slab, the pentagon on it (drawn in its starting state), the tag. */
  function summaryCard(c) {
    var id = c.id, V = SUMMARY_VISUALS[id] || {};
    var F = global.CardFrame && CardFrame.panel;
    var w = SUM.card.w, h = w * (F ? F.h / F.w : 0.96);
    var x = SUM.card.cx - w / 2, y = SUM.card.cy - h / 2;
    var g = mk('g', { 'class': 'summary-card', 'data-concept': id }, layers.ui);
    g._rect = { x: x, y: y, w: w, h: h }; g._id = id;
    // TWO GROUPS, ON PURPOSE. The outer one carries only the transform that
    // puts the card in the collection; every animation of the card itself —
    // its entrance, a word's pulse — runs on the inner one. An animation needs
    // a transform-origin, and a transform-origin on the outer group moved the
    // collect transform with it: the cards landed half a screen from their
    // places and only their name tags arrived.
    var pop = mk('g', { 'class': 'summary-pop' }, g);
    g._pop = pop;
    if (F) {
      var img = mk('image', { x: x, y: y, width: w, height: h, preserveAspectRatio: 'none', 'pointer-events': 'none' }, pop);
      img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', F.src); img.setAttribute('href', F.src);
    } else {
      mk('rect', { x: x, y: y, width: w, height: h, rx: 34, fill: '#f4fbff', stroke: '#a3d4ef', 'stroke-width': 3 }, pop);
    }
    var vis = mk('g', { 'class': 'summary-visual' }, pop);
    g._vis = vis;
    var tone = V.tone && CONCEPT[V.tone];
    var v = summaryVerts(id, false);
    g._verts = v;
    g._outline = mk('path', { d: pathOf(v), fill: 'url(#' + candy(tone ? tone.face : SHAPE.fill) + ')',
                              stroke: tone ? tone.deep : SHAPE.edge, 'stroke-width': SHAPE.edgeW, 'stroke-linejoin': 'round', opacity: 0 }, vis);
    g._linesG = mk('g', {}, vis);               // under the knobs: a line starts under its corner
    // the two sides that meet at a corner, for the word "sides" to light
    // (drawn invisible; a trace copies their line, not their paint)
    if (V.near != null) {
      var n0 = V.near, nv = v.length;
      g._near = [v[(n0 + nv - 1) % nv], v[(n0 + 1) % nv]].map(function (q) {
        return mk('line', { x1: v[n0].x, y1: v[n0].y, x2: q.x, y2: q.y, stroke: 'none', opacity: 0 }, g._linesG);
      });
    }
    g._knobs = (V.hi || []).map(function (i) {
      return mk('circle', { cx: v[i].x, cy: v[i].y, r: 11, fill: HI.fill, stroke: HI.edge, 'stroke-width': 2.5, opacity: 0 }, vis);
    });
    if (V.move) g._mover = mk('circle', { cx: v[V.move[0]].x, cy: v[V.move[0]].y, r: 10, fill: HI.fill, stroke: HI.edge, 'stroke-width': 2.5, opacity: 0 }, vis);
    // THE NAME, ON A TAG HUNG OFF THE BOTTOM EDGE: on the rim, below the
    // glass, so it is attached to the card and never over what it shows
    g._tag = nameTag(pop, SUM.card.cx, y + h + 4, c.label || id, V.tone || null);
    g._tag.setAttribute('opacity', 0);
    return g;
  }

  /* THE IDEA, SHOWN — in well under a second, and simply: each step is one
     thing happening, in the order a teacher would draw it on a board. */
  function summaryReveal(g) {
    var id = g._id, V = SUMMARY_VISUALS[id] || {}, v = g._verts, t = 0;
    var line = function (a, b, kind, dur, delay) {
      var el = kind === 'side'
        ? litLine(g._linesG, { x1: a.x, y1: a.y, x2: a.x, y2: a.y, 'stroke-width': 7, 'stroke-linecap': 'round', opacity: 0 }, { warm: true })[0]
        : litLine(g._linesG, { x1: a.x, y1: a.y, x2: a.x, y2: a.y, 'stroke-width': kind === 'out' ? 5 : 4, 'stroke-dasharray': '10 8',
                               'stroke-linecap': 'round', opacity: 0 }, { bad: kind === 'out' })[0];
      growLine(el, a, b, dur, delay);
      return el;
    };
    // the polygon: drawn round (the first card, where "a polygon" is the
    // subject), faded up everywhere else
    var out = g._outline;
    out.setAttribute('opacity', 1);
    if (V.draw && !reduced() && out.animate) {
      out.setAttribute('pathLength', 1);
      out.style.strokeDasharray = '1 1';
      try {
        out.animate([{ strokeDashoffset: 1, fillOpacity: 0 }, { strokeDashoffset: 0, fillOpacity: 0, offset: 0.55 }, { strokeDashoffset: 0, fillOpacity: 1 }],
                    { duration: 560, easing: 'ease-in-out', fill: 'backwards' });
      } catch (e) {}
      later(600, function () { out.style.strokeDasharray = ''; out.removeAttribute('pathLength'); });
      t = 480;
    } else if (!reduced() && out.animate) {
      try { out.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: 'backwards' }); } catch (e) {}
      t = 140;
    }
    // the corners it is about
    g._knobs.forEach(function (k, j) { sumPop(k, t + j * 120, true); });
    if (g._knobs.length) { later(reduced() ? 0 : t, function () { sfx('pop', { gain: 0.55 }); }); t += 120 * g._knobs.length + 120; }
    if (V.pulse && g._knobs[0] && !reduced()) {
      // a soft ring leaves the corner, twice: "this one"
      var k0 = g._knobs[0];
      var ring = mk('circle', { cx: k0.getAttribute('cx'), cy: k0.getAttribute('cy'), r: 12, fill: 'none', stroke: HI.fill, 'stroke-width': 3, opacity: 0 }, g._vis);
      if (ring.animate) {
        ring.style.transformBox = 'fill-box'; ring.style.transformOrigin = 'center';
        try { ring.animate([{ opacity: 0.9, scale: '1' }, { opacity: 0, scale: '2.6' }], { duration: 640, delay: t - 60, iterations: 2, easing: 'ease-out' }); } catch (e) {}
      }
    }
    // (a line that proves what a moved corner did waits for the corner: the
    // concave card's violet diagonal is INSIDE the pentagon before the dent)
    if (V.line && !V.move) {
      var L = V.line;
      g._line = line(v[L[0]], v[L[1]], L[2], 380, t); g._lineKind = L[2];
      later(reduced() ? 0 : t, function () { sfx('zip', { gain: 0.6 }); });
      t += 400;
    }
    if (V.sides) {
      g._sideLines = V.sides.map(function (s) { return line(v[s[0]], v[s[1]], 'side', 300, t); });
      later(reduced() ? 0 : t, function () { sfx('zip', { gain: 0.5 }); });
      t += 320;
    }
    if (V.wedge != null) {
      var p = v[V.wedge], q = v[(V.wedge + v.length - 1) % v.length], r2 = v[(V.wedge + 1) % v.length], rr = 26;
      var a1 = Math.atan2(q.y - p.y, q.x - p.x), a2 = Math.atan2(r2.y - p.y, r2.x - p.x);
      var sw = ((a2 - a1) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI), large = sw > Math.PI ? 1 : 0;
      var inside = Poly.contains(v, { x: p.x + Math.cos(a1 + sw / 2) * 8, y: p.y + Math.sin(a1 + sw / 2) * 8 });
      var flag = inside ? large : 1 - large, dir = inside ? 1 : 0;
      g._wedge = mk('path', { d: 'M' + p.x + ' ' + p.y + ' L' + (p.x + Math.cos(a1) * rr) + ' ' + (p.y + Math.sin(a1) * rr) +
                              ' A' + rr + ' ' + rr + ' 0 ' + flag + ' ' + dir + ' ' + (p.x + Math.cos(a2) * rr) + ' ' + (p.y + Math.sin(a2) * rr) + ' Z',
                              fill: '#ffd24a', 'fill-opacity': 0.9, stroke: '#b07800', 'stroke-width': 2, 'stroke-linejoin': 'round', opacity: 0 }, g._linesG);
      sumPop(g._wedge, t, true);
      later(reduced() ? 0 : t, function () { sfx('tick', { gain: 0.7 }); });
      t += 320;
    }
    if (V.diags) {
      g._diags = Poly.allDiagonals(v.length).map(function (d, k) { return line(v[d[0]], v[d[1]], 'diag', 280, t + k * 110); });
      later(reduced() ? 0 : t, function () { sfx('zip', { gain: 0.6 }); });
      t += 110 * 4 + 280;
    }
    if (V.move) {
      // the corner moves: in, into a dent; or out, and the sides stop matching
      var M = V.move, to = summaryVerts(id, true)[M[0]];
      sumPop(g._mover, Math.max(0, t - 60), true);
      later(reduced() ? 0 : t + 120, function () { sfx(id === 'concave' ? 'boing' : 'slideWhistle', { gain: 0.6 }); });
      moveCorner(g, M[0], to, 460, t + 120);
      t += 120 + 480;
      if (V.line) {
        // the line that proves it, drawn once the dent is there
        var L2 = V.line, fv = summaryVerts(id, true);
        g._line = line(fv[L2[0]], fv[L2[1]], L2[2], 320, t); g._lineKind = L2[2];
        if (L2[2] === 'out') g._line._out = true;
        later(reduced() ? 0 : t, function () { sfx('zip', { gain: 0.6 }); });
        t += 340;
      }
    }
    if (V.marks) {
      // THE LESSON'S OWN NOTATION, on the shape as it now is: equal sides
      // take the same tick, equal corners the same wedge
      var drawMarks = function () {
        g._vis._verts = g._verts.map(function (q) { return { x: q.x, y: q.y }; });
        var m = shapeMarks(g._vis, V.marks);
        if (!m || !m.g) return;
        var kids = [].slice.call(m.g.childNodes);
        g._ticks = kids.filter(function (k) { return k.tagName === 'line'; });
        g._wedges = kids.filter(function (k) { return k.tagName === 'path'; });
        g._ticks.forEach(function (k, j) { sumPop(k, j * 80); });
        g._wedges.forEach(function (k, j) { sumPop(k, g._ticks.length * 80 + 80 + j * 60); });
        sfx('sparkle', { gain: 0.5 });
      };
      if (reduced()) drawMarks(); else later(t, drawMarks);
      t += 80 * 5 + 380;
    }
    return t;
  }

  /* ONE CARD IN, AND ITS IDEA SHOWN. Resolves when the idea has been shown
     and the name is on its tag — the moment he may rise to talk about it. */
  function summaryShow(id) {
    var S = st.summary;
    if (!S) return Promise.resolve(false);
    // never two at once: a card still in the middle is put away first
    if (S.active && S.active !== id) summaryCollect(S.active, true);
    var c = S.concepts.filter(function (k) { return k.id === id; })[0] || { id: id, label: id };
    var g = S.cards[id] || (S.cards[id] = summaryCard(c));
    S.active = id;
    setSummary('CARD_ENTER', id);
    sfx('menuWhoosh', { gain: 0.45 });
    var pp = g._pop;
    if (!reduced() && pp.animate) {
      pp.style.transformBox = 'fill-box'; pp.style.transformOrigin = 'center';
      try {
        pp.animate([{ opacity: 0, scale: '.82', translate: '0 14px' }, { opacity: 1, scale: '1.03', translate: '0 0', offset: 0.62 }, { opacity: 1, scale: '1', translate: '0 0' }],
                  { duration: SUM.enterMs, easing: 'cubic-bezier(.22,1,.36,1)' });
      } catch (e) {}
    }
    return sumHold(SUM.enterMs).then(function (live) {
      if (!live || S !== st.summary) return false;
      setSummary('CONCEPT_REVEAL', id);
      var ms = summaryReveal(g);
      return sumHold(ms + 60).then(function (live2) {
        if (!live2 || S !== st.summary) return false;
        sumPop(g._tag, 0);
        return sumHold(260);
      });
    });
  }

  /** Where a collected card lives: the first half of the lesson's order down the left, the rest down the right. */
  function summarySlot(id) {
    var S = st.summary, order = S ? S.concepts.map(function (k) { return k.id; }) : [];
    var i = Math.max(0, order.indexOf(id)), half = Math.ceil(order.length / 2) || 4;
    var col = i < half ? 0 : 1, row = col ? i - half : i;
    return { x: SUM.mini.x[col], y: SUM.mini.y0 + row * SUM.mini.pitch, col: col, row: row };
  }

  /* THE CARD GOES INTO THE COLLECTION: its name lifts off, and it shrinks
     and travels, on a slight arc, to its place at the edge, where it lands
     with its name on a small tag of its own. Resolves once it is there. */
  function summaryCollect(id, now) {
    var S = st.summary, c = S && S.cards[id];
    if (!c || c._collected) return Promise.resolve(true);
    c._collected = true;
    if (S.active === id) S.active = null;
    setSummary('CARD_COLLECT', id);
    var r = c._rect, cx0 = r.x + r.w / 2, cy0 = r.y + r.h / 2;
    var slot = summarySlot(id), k = SUM.mini.w / r.w;
    var land = function () {
      c.setAttribute('transform', 'translate(' + slot.x + ',' + slot.y + ') scale(' + k.toFixed(4) + ') translate(' + (-cx0) + ',' + (-cy0) + ')');
      c._rect = { x: slot.x - r.w * k / 2, y: slot.y - r.h * k / 2, w: r.w * k, h: r.h * k };
      c._slot = slot;
      var mini = nameTag(layers.ui, slot.x, slot.y + r.h * k / 2 + 13, (S.concepts.filter(function (q) { return q.id === id; })[0] || {}).label || id,
                         (SUMMARY_VISUALS[id] || {}).tone || null, { h: 22, size: 13, pad: 18 });
      mini.setAttribute('class', 'badge summary-tag');
      c._mini = mini;
      if (!now) sumPop(mini, 0);
      if (S.collected.indexOf(id) < 0) S.collected.push(id);
      setSummary('NEXT_CONCEPT', id);
    };
    // its big name lifts off first: at a quarter of the size it would be unreadable
    if (!now && !reduced() && c._tag.animate) { try { c._tag.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150 }); } catch (e) {} }
    c._tag.setAttribute('opacity', 0);
    if (now || reduced() || !global.requestAnimationFrame) { land(); return Promise.resolve(true); }
    sfx('menuWhoosh', { gain: 0.35 });
    var g0 = sceneGen;
    return new Promise(function (resolve) {
      var t0 = null;
      var step = function (ts) {
        if (g0 !== sceneGen) { resolve(false); return; }
        if (t0 == null) t0 = ts;
        var t = Math.min(1, (ts - t0) / SUM.collectMs);
        var e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        var s = 1 + (k - 1) * e;
        var x = cx0 + (slot.x - cx0) * e, y = cy0 + (slot.y - cy0) * e - 40 * Math.sin(Math.PI * e);
        c.setAttribute('transform', 'translate(' + x.toFixed(1) + ',' + y.toFixed(1) + ') scale(' + s.toFixed(4) + ') translate(' + (-cx0) + ',' + (-cy0) + ')');
        if (t < 1) { requestAnimationFrame(step); return; }
        land(); sfx('pop', { gain: 0.45 });
        resolve(true);
      };
      requestAnimationFrame(step);
    });
  }

  /* ALL OF IT COLLECTED: the two columns gather in a little, each card
     hopping into place in the order it was learned. Then he comes. */
  function summaryFinal() {
    var S = st.summary;
    if (!S) return Promise.resolve(false);
    if (S.active) summaryCollect(S.active, true);
    setSummary('FINAL_SUMMARY');
    sfx('sparkle', { gain: 0.6 });
    S.collected.forEach(function (id, i) {
      var c = S.cards[id], dx = c._slot && c._slot.col ? -16 : 16;
      later(reduced() ? 0 : i * 70, function () {
        [c, c._mini].forEach(function (el) {
          if (!el) return;
          if (reduced() || !el.animate) { el.style.translate = dx + 'px 0'; return; }
          // the hop, and then its end written down and the animation let go,
          // so sixteen finished animations are not held open to the end
          try {
            var hop = el.animate([{ translate: '0 0' }, { translate: (dx / 2) + 'px -12px', offset: 0.45 }, { translate: dx + 'px 0' }],
                                 { duration: 440, easing: 'cubic-bezier(.3,1.2,.5,1)', fill: 'forwards' });
            hop.finished.then(function () { el.style.translate = dx + 'px 0'; hop.cancel(); }, function () {});
          } catch (e) { el.style.translate = dx + 'px 0'; }
        });
        c._rect = { x: c._rect.x + dx, y: c._rect.y, w: c._rect.w, h: c._rect.h };
        if (c._mini && c._mini._rect) c._mini._rect = { x: c._mini._rect.x + dx, y: c._mini._rect.y, w: c._mini._rect.w, h: c._mini._rect.h };
      });
    });
    return sumHold(S.collected.length * 70 + 460);
  }

  /* ------------------------------------------------------------------ *
   * Swipe classification
   * ------------------------------------------------------------------ */

  /* THE CARD IN HAND. 96 was half of a 192 card that had to fit a 252
     corridor; the corridor is 460 now, so the card is 304 across and the
     shape inside it is nearly three times the area it was. Kept in one place
     because the pile behind it is drawn from the same number. */
  var SWIPE_HALF = 152;
  var SWIPE_HOME = { x: W / 2, y: 300 };   // level with the middle of the zones

  /**
   * Put a sorted shape on a zone's shelf.
   *
   * A FRESH ICON, NOT THE FLYING CARD. The card used to be flown into place
   * with a translate measured from its home, left there, and trusted to have
   * landed — three assumptions (the home is where it started, the transform
   * composes, fill:forwards survives) any one of which puts the pile
   * somewhere else on the screen entirely, which is where the last few ended
   * up: stacked above the zones instead of inside them.
   *
   * So the card flies as decoration and is thrown away at the end of its
   * flight, and what stays is drawn here, in the zone, in a grid derived from
   * the shelf. It cannot land anywhere but on the shelf, and the icons shrink
   * to fit as the pile grows rather than running out of the bottom.
   */
  /** The grid the shelf lays n shapes in: each seat's centre and the half
      the card is drawn at. Asked before a card flies, so the flight ends in
      the seat the shape will keep, and again to draw the pile. */
  function shelfSeats(zone, n) {
    var sh = zone._shelf;
    var cols = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(n))));
    var rows = Math.ceil(n / cols);
    var cw = sh.w / cols, ch = sh.h / rows;
    var half = Math.min(cw, ch) * 0.34 * 1.35;
    var seats = [];
    for (var i = 0; i < n; i++) {
      seats.push({ x: sh.x + cw * ((i % cols) + 0.5), y: sh.y + ch * (Math.floor(i / cols) + 0.5), half: half });
    }
    return seats;
  }

  function keepInZone(zone, name) {
    if (!zone) return;
    zone._kept.push(name);
    var was = zone._seats || [];
    while (zone._keptG.firstChild) zone._keptG.removeChild(zone._keptG.firstChild);

    var n = zone._kept.length;
    var seats = shelfSeats(zone, n);
    zone._seats = seats;

    zone._kept.forEach(function (nm, i) {
      var seat = seats[i];
      var cell = mk('g', { 'class': 'kept' }, zone._keptG);
      var at = mk('g', { transform: 'translate(' + seat.x.toFixed(1) + ',' + seat.y.toFixed(1) + ')' }, cell);
      // drawn exactly as the card that flew here was, so the swap is invisible
      optionCard(at, seat.half, nm, { fill: reduced() ? 0.86 : 0.74 });
      if (reduced() || !cell.animate) return;
      cell.style.transformBox = 'fill-box'; cell.style.transformOrigin = 'center';
      if (i === n - 1) {
        // THE NEWEST ONE HAS JUST LANDED — the card flew here at this size —
        // so it settles with a small bounce rather than growing out of nothing.
        cell.animate([{ opacity: 0.85 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
      } else if (was[i] && (was[i].x !== seat.x || was[i].y !== seat.y || was[i].half !== seat.half)) {
        // THE REST MAKE ROOM. When the pile re-lays for a new column or row,
        // each shape already there slides from its old seat to its new one
        // instead of jumping.
        var k = was[i].half / seat.half;
        cell.animate([
          { translate: (was[i].x - seat.x) + 'px ' + (was[i].y - seat.y) + 'px', scale: String(k) },
          { translate: '0 0', scale: '1' }
        ], { duration: 320, easing: 'cubic-bezier(.22,1,.36,1)' });
      }
    });

  }

  /**
   * Put the next shape on the table.
   *
   * Never a pop: it rises and fades in, because a card that appears fully
   * formed reads as the same card changing shape rather than as a new
   * question arriving.
   */
  /**
   * THE ONES STILL TO COME, stacked behind the card in hand.
   *
   * One card alone on the ice says nothing about how long this goes on for;
   * a child who cannot see the pile does not know whether they are near the
   * end. Two blanks behind it, fanned left and right and a little smaller,
   * say "there are more" without saying which shapes — the answer stays in
   * the card that is turned over. The fan shrinks to one, then to none, so
   * the last question looks like the last question.
   */
  function dealStack() {
    var sw = st.swipe; if (!sw) return;
    if (sw.stackG && sw.stackG.parentNode) sw.stackG.parentNode.removeChild(sw.stackG);
    sw.stackG = null;
    var left = sw.items.length - sw.i - 1;
    if (left <= 0) return;
    var g = mk('g', { 'class': 'swipe-stack', 'pointer-events': 'none' }, layers.ui);
    sw.stackG = g;
    // drawn far to near, so the nearest blank is on top of the one behind it
    for (var k = Math.min(2, left); k >= 1; k--) {
      // The pile has to stay in the corridor between the two zones: they run
      // to x 270 and from x 730, and the card is 304 wide at x 500, so a
      // blank may lean about seventy pixels out before its corner is over a
      // zone the child is meant to be dropping into.
      // The lean and the drop are a fraction of the card, not a number of
      // pixels: at 96 they read as a pile, and at 152 the same numbers put a
      // second frame a few pixels off the first, which reads as a misprint
      // rather than as cards behind cards.
      var pileK = SWIPE_HALF / 96;
      var dxk = (k === 1 ? -1 : 1) * (12 + k * 7) * pileK, scale = 1 - k * 0.075, rot = (k === 1 ? -1 : 1) * (3 + k * 2);
      var c = mk('g', { opacity: String(0.92 - k * 0.16) }, g);
      optionCard(c, SWIPE_HALF, null);   // a blank card: the pile, not the answers
      c.setAttribute('transform', 'translate(' + (SWIPE_HOME.x + dxk) + ',' + (SWIPE_HOME.y + 10 * k * pileK) + ') rotate(' + rot + ') scale(' + scale.toFixed(3) + ')');
    }
  }

  function dealCard() {
    var sw = st.swipe;
    if (!sw || sw.i >= sw.items.length) return null;
    dealStack();
    // WHERE IT CAN GO. Both zones breathe while a card is waiting — the
    // hint is the destination, never the answer — and stop when it lands.
    Object.keys(sw.zones).forEach(function (k) { if (sw.zones[k].classList) sw.zones[k].classList.add('hint'); });
    var name = sw.items[sw.i];
    var g = mk('g', { 'class': 'swipe-card', 'data-shape': name }, layers.ui);
    var card = optionCard(g, SWIPE_HALF, name, { fill: reduced() ? 0.86 : 0.74 });
    g.setAttribute('transform', 'translate(' + SWIPE_HOME.x + ',' + SWIPE_HOME.y + ')');
    g._name = name;
    // The radius the card actually drew at, not a number typed beside it:
    // these vertices are what Poly.isRegular judges the swipe against.
    g._verts = shapeVerts(name, card._pane.r, card._pane.cx, card._pane.cy);
    // the ticks and arcs the answer is read off, on the card from the start
    if (!reduced()) shapeMarks(g, { numbers: true, cls: 'units', pane: card._pane,
                                    ink: shade(COLORS[name] || '#5b95ee', -0.42) });
    g.style.cursor = 'grab';
    g.style.touchAction = 'pan-y';
    sw.card = g;
    if (!reduced() && g.animate) {
      g.animate([{ translate: '0 26px', scale: '.92', opacity: 0 }, { translate: '0 0', scale: '1', opacity: 1 }],
                { duration: 300, easing: 'cubic-bezier(.22,1,.36,1)' });
    }
    return g;
  }

  /**
   * WHY THAT WAS NOT IT — shown on the shape, in one line.
   *
   * A wrong swipe used to be a shake and a "not quite", which tells a child
   * they are wrong and nothing else. The marks the lesson taught two screens
   * ago are put straight onto the card instead: equal sides take the same
   * tick, so a regular shape flowers into five identical marks and an
   * irregular one into a two-and-three. It is on the screen for a second
   * and a half and then gone — long enough to see, too short to sit through.
   */
  /**
   * THE MARKS THEMSELVES, drawn onto a card and left there.
   *
   * These were only ever shown to explain a wrong answer, for a second and a
   * half. But they are not an explanation — they are the EVIDENCE, and a
   * child asked "regular or irregular?" with no marks on the shape is being
   * asked to judge by eye whether five sides are the same length, which is
   * exactly the thing the ticks were invented to save them from. Equal sides
   * take the same tick and equal corners the same arc, so the answer is
   * something to read off the shape rather than something to guess.
   *
   * `all` draws the corners as well as the sides. The explanation only shows
   * corners when the corners are the reason; the question shows both, because
   * a child comparing has to see that the sides DO match before "but look at
   * the corners" means anything.
   */
  function verdictOf(v) {
    var ix = []; for (var q = 0; q < v.length; q++) ix.push(q);
    if (Poly.isRegular(v)) return 'regular';
    return marksBy(Poly.sideLengths(v), ix, 6).groups > 1 ? 'sides' : 'angles';
  }

  /* WHERE A FIGURE MAY GO ON A CARD: inside the glass by a margin, clear of
     every side of the shape and of the corner wedges, and clear of every
     figure already put down. fit() takes the first candidate that is. */
  function labelSpace(v, pane, wedgeR) {
    var M = 6, PAD = 3.5, boxes = [];
    var area = pane && pane.w ? { l: pane.cx - pane.w / 2 + M, r: pane.cx + pane.w / 2 - M,
                                  t: pane.cy - pane.h / 2 + M, b: pane.cy + pane.h / 2 - M } : null;
    var distPtSeg = function (px, py, ax, ay, bx, by) {
      var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      var t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
      return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
    };
    var inBox = function (px, py, b) { return px >= b.l && px <= b.r && py >= b.t && py <= b.b; };
    var segCross = function (ax, ay, bx, by, cx, cy, dx, dy) {
      var d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax), d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
      var d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx), d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
      return (d1 * d2 < 0) && (d3 * d4 < 0);
    };
    // how close a side comes to a box: 0 if it crosses it
    var segBox = function (ax, ay, bx, by, b) {
      if (inBox(ax, ay, b) || inBox(bx, by, b)) return 0;
      var cs = [[b.l, b.t], [b.r, b.t], [b.r, b.b], [b.l, b.b]];
      for (var e = 0; e < 4; e++) {
        var p = cs[e], q = cs[(e + 1) % 4];
        if (segCross(ax, ay, bx, by, p[0], p[1], q[0], q[1])) return 0;
      }
      var d = Infinity;
      cs.forEach(function (c) { d = Math.min(d, distPtSeg(c[0], c[1], ax, ay, bx, by)); });
      // and the side's own ends against the box's edges
      [[ax, ay], [bx, by]].forEach(function (p) {
        var cx = Math.max(b.l, Math.min(b.r, p[0])), cy = Math.max(b.t, Math.min(b.b, p[1]));
        d = Math.min(d, Math.hypot(p[0] - cx, p[1] - cy));
      });
      return d;
    };
    var ok = function (b) {
      if (area && (b.l < area.l || b.r > area.r || b.t < area.t || b.b > area.b)) return false;
      for (var i = 0; i < v.length; i++) {
        var a = v[i], c = v[(i + 1) % v.length];
        if (segBox(a.x, a.y, c.x, c.y, b) < PAD) return false;
        var nx = Math.max(b.l, Math.min(b.r, a.x)), ny = Math.max(b.t, Math.min(b.b, a.y));
        if (Math.hypot(a.x - nx, a.y - ny) < (wedgeR || 0) + 2) return false;   // a corner's wedge
      }
      for (var k = 0; k < boxes.length; k++) {
        var o2 = boxes[k];
        if (b.l < o2.r + 3 && b.r > o2.l - 3 && b.t < o2.b + 3 && b.b > o2.t - 3) return false;
      }
      return true;
    };
    return {
      fit: function (cands, w, h) {
        for (var i = 0; i < cands.length; i++) {
          var c = cands[i], b = { l: c.x - w / 2, r: c.x + w / 2, t: c.y - h / 2, b: c.y + h / 2 };
          if (ok(b)) { boxes.push(b); return c; }
        }
        // nowhere is clear: the first place, still kept inside the glass
        var c0 = cands[0];
        if (!c0) return null;
        var x = c0.x, y = c0.y;
        if (area) { x = Math.max(area.l + w / 2, Math.min(area.r - w / 2, x)); y = Math.max(area.t + h / 2, Math.min(area.b - h / 2, y)); }
        boxes.push({ l: x - w / 2, r: x + w / 2, t: y - h / 2, b: y + h / 2 });
        return { x: x, y: y };
      },
      get count() { return boxes.length; }
    };
  }

  function shapeMarks(card, o) {
    o = o || {};
    if (!card || !card._verts) return null;
    var v = card._verts, n = v.length;
    var L = Poly.sideLengths(v), A2 = Poly.interiorAngles(v);
    var idxs = []; for (var i = 0; i < n; i++) idxs.push(i);
    var sideM = marksBy(L, idxs, 6), angM = marksBy(A2, idxs, 4);
    // WHAT MAKES THIS SHAPE WHAT IT IS — the same test the answer is judged
    // by, not a guess from the sides alone. A rhombus has four equal sides
    // and is irregular, and an explanation that only counted sides told the
    // child it was regular: the opposite of the truth, in the one moment
    // they were listening.
    var verdict = Poly.isRegular(v) ? 'regular' : (sideM.groups > 1 ? 'sides' : 'angles');
    var g = mk('g', { 'class': o.cls || 'why', 'pointer-events': 'none' }, card);
    var drawnNumbers = false;

    /* THE MEASUREMENTS THEMSELVES, in centimetres and degrees.
     *
     * A tick says "this side matches that one" and leaves the child to take
     * it on trust. A number says how long it is, and five of the same number
     * round a pentagon is the definition of regular written on the shape.
     *
     * WHY THE MEASURING SCREENS DO NOT DO THIS, and why this can. Those print
     * a number only while every side is in one group, because a rounded
     * number lies: 114 units and 120 units are different sides and both come
     * out "4 cm", so the figure would say equal about a shape that is not.
     * That is a reason to round carefully, not a reason not to measure — so
     * the rounding is checked here. If any two sides the shape says are
     * DIFFERENT would print the same, every side gains a decimal place until
     * they do not. The numbers never claim an equality the shape does not
     * have.
     */
    if (o.numbers) {
      var cen = Poly.centroid(v);
      var UNIT = 30;                                   // the scale the measuring screens read in
      // how many decimals it takes before unequal sides look unequal
      var sd = decimalsFor(L, sideM.mark, UNIT, 2);

      /* A DIMENSION LINE, THE WAY A DRAWING MEASURES A THING.
       *
       * Five white pills round a pentagon are five more objects on the card,
       * and they are the wrong kind of object: a plate is a label stuck ON
       * the picture, and what is wanted is the picture SAYING how long its
       * own side is. So each side gets what a technical drawing gives it — a
       * thin line held just off the side, running exactly its length, capped
       * at both ends by a short tick, with the figure sitting in a gap in the
       * middle of it. It reads as part of the drawing because it IS the
       * drawing: it measures from corner to corner, so the length it claims
       * is the length you can see.
       *
       * Drawn in the shape's own ink — the darker step of its fill that the
       * outline already uses — for the same reason the outline is: a pink
       * pentagon measured in pink belongs to itself, and one measured in
       * navy is a diagram someone put on top of it.
       */
      var ink = o.ink || '#0f3f8f';
      /* THE NUMBER ALONE, AND NEVER ON ANYTHING.
       *
       * The dimension lines went: a capped line held off every side ran round
       * the shape a second time, just outside it, and on a card that is
       * already a rim, a shape, five corner marks and ten numbers, it was one
       * outline too many. Each side keeps only its length, set just outside
       * its middle — and the place is CHECKED rather than assumed: the figure
       * must sit inside the glass with a margin, clear of every side of the
       * shape, clear of the corner marks and of every figure already placed.
       * The first place that passes is used: out from the middle, then a
       * little further, then slid along the side, then inside the shape. */
      var placed = labelSpace(v, o.pane || card._pane, 13);
      for (var si = 0; si < n; si++) {
        var sa = v[si], sb = v[(si + 1) % n];
        var slen = Math.hypot(sb.x - sa.x, sb.y - sa.y) || 1;
        var stx = (sb.x - sa.x) / slen, sty = (sb.y - sa.y) / slen;   // along the side
        var smx = (sa.x + sb.x) / 2, smy = (sa.y + sb.y) / 2;
        var snx = -sty, sny = stx;                                     // square to it...
        if (snx * (smx - cen.x) + sny * (smy - cen.y) < 0) { snx = -snx; sny = -sny; }   // ...and outward
        var text = (L[si] / UNIT).toFixed(sd) + ' cm';
        var tw = text.length * 7.4 + 4, th = 15;
        var base = 7 + Math.abs(snx) * tw / 2 + Math.abs(sny) * th / 2;
        var cands = [];
        [0, 0.18, -0.18, 0.32, -0.32].forEach(function (along) {
          [base, base + 6].forEach(function (off) {
            cands.push({ x: smx + stx * slen * along + snx * off, y: smy + sty * slen * along + sny * off });
          });
        });
        cands.push({ x: smx - snx * base, y: smy - sny * base });      // inside, as a last resort
        var at = placed.fit(cands, tw, th) || cands[0];
        mk('text', { x: at.x, y: at.y + 5, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 800,
                     fill: ink, stroke: '#ffffff', 'stroke-width': 3, 'paint-order': 'stroke',
                     'stroke-linejoin': 'round', text: text }, g);
      }
      card._labelSpace = placed;
      /* NO DEGREES. Ten labels on one card is a wall of type, and a number of
       * degrees is not a thing a seven-year-old reads \u2014 they have met
       * centimetres and they have not met angles measured.
       *
       * THE CORNERS STILL HAVE TO SAY SOMETHING, though, and this is the one
       * place it cannot be dropped: a rhombus has four sides of the same
       * length and is IRREGULAR, and so does a star. Sides alone would print
       * "4 cm" four times under a shape whose answer is irregular \u2014 the
       * figure would be telling the child the opposite of the truth in the
       * one moment they are looking at it. So the corners keep the arcs
       * below: equal angles take the same number, unequal ones do not, which
       * is the same fact without a number on it. */
      drawnNumbers = true;
    }

    // the sides, marked in groups of equals \u2014 unless they are already
    // carrying their measurement
    if (!drawnNumbers) for (var i2 = 0; i2 < n; i2++) {
      var a = v[i2], b = v[(i2 + 1) % n];
      var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, sl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      var tdx = (b.x - a.x) / sl, tdy = (b.y - a.y) / sl, tnx = -tdy, tny = tdx;
      var cnt = sideM.mark[i2] || 1;
      for (var k = 0; k < cnt; k++) {
        // (`along`, not `o`: a var named o here overwrote the options object,
        // so everything after the ticks forgot what it had been asked for)
        var along = (k - (cnt - 1) / 2) * 6, cx = mx + tdx * along, cy = my + tdy * along;
        litLine(g, { x1: cx - tnx * 7, y1: cy - tny * 7, x2: cx + tnx * 7, y2: cy + tny * 7,
                     'stroke-width': 3, 'stroke-linecap': 'round' }, { warm: true });
      }
    }

    // AND THE CORNERS, when the corners are the reason. Equal angles take
    // the same number of arcs, so "the sides all match but these two corners
    // do not" is a thing the child can see rather than a thing they are told.
    if (o.all || o.numbers || verdict !== 'sides') {
      for (var j = 0; j < n; j++) {
        var p = v[j], q = v[(j + n - 1) % n], r2 = v[(j + 1) % n];
        var a1 = Math.atan2(q.y - p.y, q.x - p.x), a2 = Math.atan2(r2.y - p.y, r2.x - p.x);
        var sweep = ((a2 - a1) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        var large = sweep > Math.PI ? 1 : 0;
        var mid = a1 + sweep / 2;
        var inside = Poly.contains(v, { x: p.x + Math.cos(mid) * 6, y: p.y + Math.sin(mid) * 6 });
        /* A SMALL FILLED WEDGE WITH ITS NUMBER ON IT.
         *
         * The open arc was drawn big so that several of them could be nested
         * to say "these corners match" — but the sides carry a measurement
         * now, so the corner does not have to say it in rings: it can simply
         * say how many degrees it is. One small wedge, filled, is a quieter
         * mark than a stack of thin arcs and it leaves the shape's face
         * clear, which is what keeps ten marks on one pentagon from reading
         * as clutter.
         *
         * The number goes just outside the wedge on the corner's bisector,
         * pointing into the shape, so it never sits on a side or on a tick.
         */
        var rr = 13;
        var x1 = p.x + Math.cos(a1) * rr, y1 = p.y + Math.sin(a1) * rr;
        var x2 = p.x + Math.cos(a2) * rr, y2 = p.y + Math.sin(a2) * rr;
        var sweepFlag = inside ? large : (1 - large), dir = inside ? 1 : 0;
        var arcD = 'A' + rr + ' ' + rr + ' 0 ' + sweepFlag + ' ' + dir + ' ' + x2 + ' ' + y2;
        /* THE CORNER MARK BELONGS TO THE SHAPE, so it is drawn in the shape's
         * own ink. A saturated gold wedge glowing on a pink pentagon is a
         * sticker: it is the brightest thing in the picture, it is a colour
         * the shape does not contain, and the eye reads it as something
         * placed on top rather than as part of what is being measured. The
         * same darker step of the fill that the outline uses, washed back, is
         * a corner of the shape that has been marked. */
        var aink = o.ink || '#0f3f8f';
        mk('path', { d: 'M' + p.x + ' ' + p.y + ' L' + x1 + ' ' + y1 + ' ' + arcD + ' Z',
                     fill: aink, 'fill-opacity': 0.22, stroke: aink, 'stroke-opacity': 0.85,
                     'stroke-width': 2, 'stroke-linejoin': 'round' }, g);
        if (o.degrees !== false) {
          /* THE NUMBER SITS ON THE SHAPE'S FACE, NOT ON ITS EDGE.
           *
           * Pushed just past the wedge, it landed in the corner itself —
           * where two sides, the outline and a gold wedge already are. Five
           * numbers each crowding the busiest point of the drawing is what
           * turned ten marks into a mess rather than a measurement. A third
           * of the way in toward the middle puts every number on open colour,
           * clear of the outline and clear of its own wedge, and the middle
           * of a polygon is empty by definition. */
          var dtx = p.x + (cen.x - p.x) * 0.30;
          var dty = p.y + (cen.y - p.y) * 0.30;
          // but never so far in that two corners' numbers meet in the middle
          var pull = Math.hypot(dtx - p.x, dty - p.y);
          if (pull < rr + 14) {
            var kk = (rr + 14) / (pull || 1);
            dtx = p.x + (dtx - p.x) * kk; dty = p.y + (dty - p.y) * kk;
          }
          // and checked like the lengths: clear of the sides, the wedges and
          // every number already down — along the bisector, nearer or further
          if (card._labelSpace) {
            var bxl = cen.x - p.x, byl = cen.y - p.y, bll = Math.hypot(bxl, byl) || 1;
            var dw = String(Math.round(A2[j])).length * 7 + 12, dh = 14, dc = [{ x: dtx, y: dty }];
            [0.24, 0.36, 0.42, 0.18, 0.5].forEach(function (f) { dc.push({ x: p.x + bxl * f, y: p.y + byl * f }); });
            var da = card._labelSpace.fit(dc, dw, dh, true);
            if (da) { dtx = da.x; dty = da.y; }
            void bll;
          }
          mk('text', { x: dtx, y: dty + 4, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 800,
                       fill: o.ink || '#0f3f8f', stroke: '#ffffff', 'stroke-width': 2.8,
                       'paint-order': 'stroke', 'stroke-linejoin': 'round',
                       text: Math.round(A2[j]) + '°' }, g);
        }
      }
    }

    if (g.animate) g.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: 'backwards' });
    return { g: g, verdict: verdict };
  }

  /**
   * WHY THAT WAS NOT IT.
   *
   * The marks are already on the card — they are what the question is asked
   * with — so this no longer draws a second set over the top of them. It
   * brings the card forward and names what is there, which is the part a
   * wrong answer actually needs: small gold ticks on a card are not an
   * explanation a seven-year-old will look at until something asks them to.
   */
  function whyShape(card) {
    if (!card || !card._verts || reduced()) return null;
    var already = !!(card.querySelector && card.querySelector('.units'));
    // the marks are already there: read the verdict, do not draw a second set
    var verdict = already ? verdictOf(card._verts) : null;
    var r = already ? null : shapeMarks(card);
    if (!already && !r) return null;
    if (r) verdict = r.verdict;
    if (card.animate) {
      card.style.transformBox = 'fill-box'; card.style.transformOrigin = 'center';
      try {
        card.animate([{ scale: '1' }, { scale: '1.14', offset: 0.12 }, { scale: '1.14', offset: 0.82 }, { scale: '1' }],
                     { duration: 2100, easing: 'cubic-bezier(.3,1.2,.4,1)' });
      } catch (x) {}
    }
    if (!already && r) {
      var g = r.g;
      later(1700, function () {
        if (!g.parentNode) return;
        var fade = g.animate ? g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' }) : null;
        var go = function () { if (g.parentNode) g.parentNode.removeChild(g); };
        if (fade && fade.finished) fade.finished.then(go, go); else go();
      });
    }
    return verdict;
  }

  /** Lean a zone toward the child while they are dragging at it. */
  function leanZone(id, on) {
    var sw = st.swipe; if (!sw) return;
    Object.keys(sw.zones).forEach(function (k) {
      var g = sw.zones[k], want = (k === id && on);
      if (g._lean === want) return;
      g._lean = want;
      g.style.transformBox = 'fill-box'; g.style.transformOrigin = 'center';
      if (!reduced() && g.animate) {
        g.animate([{ scale: want ? '1' : '1.045' }, { scale: want ? '1.045' : '1' }],
                  { duration: 160, easing: 'ease-out', fill: 'forwards' });
      }
      g.classList.toggle('zone-live', want);
    });
  }

  /**
   * Lay out the cards a bin has been given, inside the bin.
   *
   * THE OLD GRID OVERLAPPED BY ARITHMETIC. A card is 112 square drawn at
   * 0.8, so it paints 90 across; the grid stepped 110 along a row and 80 down
   * to the next. Eighty is less than ninety: the second row began ten pixels
   * before the first one ended, every time, and a third row hung out through
   * the bottom of the bin. Nothing about it depended on the content, so it
   * was wrong on every screen and every device equally.
   *
   * The grid is derived from the bin and from how many cards are in it, and
   * every card is re-laid whenever one lands — so three cards are drawn
   * large and six shrink to fit rather than piling up on each other. Capped
   * at the original 0.8 so a bin holding one card does not blow it up.
   */
  function packBin(bin) {
    var items = bin._items || [];
    if (!items.length) return;
    var r = bin._pane || bin._rect;
    var PAD_X = bin._pane ? 6 : 12, PAD_TOP = bin._pane ? 6 : 56, PAD_BOT = bin._pane ? 6 : 12;   // a pane already excludes the title band
    // ONE ROW, ONE SIZE. A card the child drops keeps the size it had in
    // the tray, and the row fills left to right in the order they came —
    // the bin is wide enough for every card that can belong in it. Only if
    // a row could not fit does the whole row shrink, together.
    var ITEM_W = 92, gapX = 16, n = items.length;
    var roomW = r.w - PAD_X * 2;
    var k = Math.min(1, (roomW - gapX * (n - 1)) / (n * ITEM_W));
    k = Math.max(0.5, k);
    var cw = ITEM_W * k, total = n * cw + gapX * (n - 1);
    var x0 = r.x + (r.w - total) / 2 + cw / 2;
    var cy = r.y + PAD_TOP + (r.h - PAD_TOP - PAD_BOT) / 2;
    items.forEach(function (it, i) {
      var cx = x0 + i * (cw + gapX);
      it._pos = { x: cx, y: cy };
      it.setAttribute('transform', 'translate(' + cx + ',' + cy + ') scale(' + k.toFixed(3) + ')');
    });
  }

  /**
   * An option: the card, and the shape printed on its glass.
   *
   * THE CARD IS THE SUPPLIED ARTWORK, not a drawing of it. There were four
   * hand-built rectangles here — the sorting tray, the swipe card, the icons
   * stacked in a bin, the four in the choose-the-polygons grid — with four
   * different fills and rims, three of them near-white on a white snowfield
   * and one with a rim that was literally white-on-white. They are one
   * <image> now, so the card cannot drift between the places it appears and
   * redrawing it is a file swap rather than a hunt through this module.
   *
   * THE SHAPE GOES IN THE GLASS, NOT ON THE CARD. The frozen rim is not the
   * same thickness on every edge — the top carries the snow caps — so the
   * middle of the card is not the middle of the pane. Both come from
   * card-frame.js, measured off the artwork by tools/build-card.js, and the
   * shape is sized to the SHORT side of the pane so a wide hexagon and a tall
   * pentagon both sit inside it.
   *
   * Returns the radius it drew at, because the swipe card keeps its own copy
   * of the vertices and they have to be the ones on the screen.
   */
  function optionCard(parent, half, name, opts) {
    var F = global.CardFrame && CardFrame.option;
    var g = mk('g', { 'class': 'shape-card' }, parent);

    // The artwork is not square; forcing it into a square box would stretch
    // the corners it is recognised by.
    var aspect = F ? F.h / F.w : 1;
    var halfH = half * aspect;

    if (F) {
      var img = mk('image', {
        x: -half, y: -halfH, width: half * 2, height: halfH * 2,
        preserveAspectRatio: 'none'
      }, g);
      img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', F.src);
      img.setAttribute('href', F.src);
    } else {
      // No frame table: a plain slab rather than nothing at all.
      mk('rect', { x: -half, y: -halfH, width: half * 2, height: halfH * 2, rx: half * 0.3,
                   fill: '#f4fbff', stroke: '#2f96f5', 'stroke-width': Math.max(2, half * 0.06) }, g);
    }

    var p = (F && F.pane) || { x: 0.08, y: 0.09, w: 0.84, h: 0.8 };
    var paneW = half * 2 * p.w;
    var paneH = halfH * 2 * p.h;
    var cx = -half + half * 2 * (p.x + p.w / 2);
    var cy = -halfH + halfH * 2 * (p.y + p.h / 2);
    // 0.86 of the half-extent: a regular polygon's width is up to twice its
    // circumradius, and it needs air inside the glass rather than touching it.
    // A card that will carry its measurements (the swipe card) draws the shape
    // smaller, 0.74, so every length has room OUTSIDE its side: at 0.86 the
    // hexagon's upright sides left 40 units to the glass, a "3 cm" needs 47,
    // and the figure fell back inside the shape onto the 120° marks.
    var r = Math.min(paneW, paneH) / 2 * ((opts && opts.fill) || 0.86);

    if (name) drawShape(name, r, cx, cy, g);

    /* PICKED, AND WRONG.
     *
     * The card is a picture, so there is no fill or stroke on it to change —
     * which is exactly how the choose-the-polygons grid lost its feedback the
     * moment the artwork replaced the drawn rectangle: it was recolouring the
     * card's first child, and the first child became an <image>. Tapping the
     * right shape did nothing visible at all.
     *
     * A ring around the block, a tick in the corner, and a pop. All three are
     * built here and hidden, so marking a card is a colour change rather than
     * a DOM edit under a finger that is still on it. */
    // A RIGHT CARD GLOWS GREEN AND THROWS CONFETTI FROM BEHIND ITSELF; a
    // wrong one flushes red and shrinks back. No ring, no tick: the glow is
    // the verdict, and the burst comes out from under the card's edges
    // rather than being sprayed over the shape.
    g._mark = function (state) {
      if (g.classList) {
        g.classList.remove('mark-good', 'mark-bad');
        if (state === 'correct') g.classList.add('mark-good');
        if (state === 'wrong') g.classList.add('mark-bad');
      }
      // A GLINT, NOT A PARTY. One right card among four is not a milestone;
      // the confetti is kept for the moments that are (a sort finished, a
      // shape built, the lesson over), so those still feel like something.
      if (state === 'correct' && global.Juice && Juice.sparkle && !reduced()) {
        try { Juice.sparkle(g); } catch (e) {}
      }
      if (state && !reduced() && g.animate) {
        g.style.transformBox = 'fill-box';
        g.style.transformOrigin = 'center';
        try {
          g.animate([{ scale: '1' }, { scale: state === 'wrong' ? '.93' : '1.09' }, { scale: '1' }],
                    { duration: 320, easing: 'cubic-bezier(.3,1.35,.5,1)' });
        } catch (e) {}
      }
    };

    g._pane = { cx: cx, cy: cy, r: r, w: paneW, h: paneH };
    return g;
  }

  function makeSortItem(name, x, y, i) {
    var g = mk('g', { 'class': 'sort-item', 'data-shape': name }, layers.ui);
    var card = optionCard(g, 46, name);   // the option is the small thing; the bin it goes in is the big one
    g.setAttribute('transform', 'translate(' + x + ',' + y + ')');
    g._home = { x: x, y: y }; g._name = name;
    g._verts = shapeVerts(name, card._pane.r, card._pane.cx, card._pane.cy);
    if (!reduced()) { g.style.opacity = 0; later(i * 90, function () { g.style.opacity = 1; enter(g, 'pop'); }); }
    return g;
  }

  /* ------------------------------------------------------------------ *
   * The one button
   *
   * Every pressable thing on this stage drew its own rectangle: a pale
   * pastel fill, a thin outline, dark text. Several places, several slightly
   * different versions, and all of them looking like a slide — an option
   * looked the same as the card behind it, a badge looked the same as an
   * option, and none of them looked like they could be pressed.
   *
   *   a saturated face — the colour carries the meaning, so it has to BE a
   *                      colour, not a tint of white
   *   a darker lip     — underneath, not around. Thickness is what makes a
   *                      thing look pressable; an outline makes it look
   *                      printed. Same grammar as the speech bubble, the
   *                      instruction card and the ice panel, so the whole
   *                      game is made of one material
   *   a top highlight  — light across the upper half, so the face reads as
   *                      curved rather than flat
   *   white bold type  — on the colour, not dark type on a tint
   *
   * `press: true` sets the cursor, and that is the signal Stage.alive()
   * keys off — so anything pressable inherits the halo, the breathing and
   * the squash for free. A badge is the same object without it: same
   * material, obviously not a control.
   */
  /* ------------------------------------------------------------------ *
   * Colour has two jobs here, and they must never be the same colour.
   *
   * EVALUATION answers "did I get that right?" — green yes, coral no. It is
   * about the child.
   *
   * CONCEPT answers "what kind of shape is this?" — convex, concave, regular,
   * irregular. It is about the shape, and none of the four is a mistake.
   *
   * They used to share one palette. The Convex bin, the Regular drop zone and
   * the first of every pair of option buttons were drawn in the same green as
   * a correct answer; the Concave bin, the Irregular zone and the second
   * option were the same pink as a wrong one. So a child sorting shapes into
   * a green box and a pink box was being told, in the fastest-reading
   * language a screen has, that half the shapes were wrong — and asked to put
   * a perfectly good concave hexagon in the "wrong" box.
   *
   * The two palettes now share no hue. EVAL is used only where the game is
   * judging an answer; nothing else may touch it.
   *
   * Each concept carries four values, because a category shows up as a
   * button, a drop zone and a label: "face" is the saturated body, "deep" is
   * the shadow under it and the plate white type sits on, "wash" is the tint
   * a drop zone is filled with, and "ink" is type on that wash. White on
   * every `deep` clears 4.5:1, and every `ink` on its own `wash` clears 7:1.
   * ------------------------------------------------------------------ */
  var EVAL = {
    yes: ['#58c47c', '#2e8a4e'],
    no:  ['#f0789e', '#b93c66']
  };

  var CONCEPT = {
    convex:    { face: '#2bb8d6', deep: '#0f6f86', wash: '#e4f8fc', ink: '#0b5566' },
    concave:   { face: '#f2a222', deep: '#95590a', wash: '#fff3dd', ink: '#6d4100' },
    regular:   { face: '#19b5a2', deep: '#0a6c60', wash: '#e3f8f4', ink: '#07564c' },
    irregular: { face: '#9270e6', deep: '#54399e', wash: '#f1ebfe', ink: '#3d2775' }
  };

  /** The four words this lesson sorts shapes by. Anything else is not a
      category and must not borrow a category's colour. */
  function conceptOf(text) {
    var k = String(text == null ? '' : text).trim().toLowerCase();
    return CONCEPT[k] ? k : null;
  }

  /* Options that are not categories — "Inside"/"Outside", "Still equal" —
     need to look like a row of arcade buttons without claiming to mean
     anything by their colour.

     WARM, AND DARK-INKED. The cool blue and violet pair read as interface
     rather than as something to press, and white type on a light warm face is
     unreadable, so each of these carries its own ink as a third value. */

  /* [face, lip, ink] — ink optional, white when absent. */
  var PILL_TONES = {
    sun:       ['#ffc53d', '#c07a00', '#5a3400'],
    blue:      ['#4f9df5', '#2b6fc4'],
    // the new kit's tones, drawn the same colours if the art is missing
    uiPrimary: ['#ffc53d', '#c07a00', '#5a3400'],
    uiSuccess: EVAL.yes,
    uiDanger:  EVAL.no
  };

  /**
   * A LABEL. Not a button.
   *
   * "Convex" under a shape is the game TELLING the child what the shape is.
   * It was drawn with pill(): a saturated face, a darker lip under it and a
   * gloss highlight along the top — which is the exact vocabulary this game
   * uses for the things you press. So the one word on the screen that is a
   * statement of fact looked like the control you were being asked to use,
   * and a child who pressed it got nothing, which teaches them that pressing
   * things in this game sometimes does nothing.
   *
   * A tag is flat: the concept's wash, a thin rim in the concept's deep, the
   * concept's ink. No lip, no gloss, no pointer. It reads as a caption
   * attached to the shape, which is what it is.
   *
   * It also fixes an overlap the pill caused. The badge is placed by its
   * CENTRE and the lip hangs 7px below the face, so a label positioned to
   * clear the bottom of the panel by its own half-height was still crossing
   * the edge by the depth of a lip it did not need.
   */
  /** A NAME TAG under a card: the ice plate the shape's own label uses, sized to its words. */
  /**
   * AND IT WENT BACK TO BEING A BUTTON.
   *
   * Everything above was written, and then the tag was given a drop shadow
   * and a bright white rim inside its edge — the two marks that say "this
   * lifts off the page and can be pressed". A shadow is depth and depth is
   * an invitation; the inner rim is the gloss every real button here wears.
   * "Regular pentagon" and "Irregular pentagon" sat under the two shapes
   * looking exactly like the pair of answer buttons the child had been
   * tapping all lesson, and they are not answers — they are the names of
   * what is above them.
   *
   * So: flat. The concept's wash, one thin rim in the concept's deep, the
   * concept's ink, and nothing underneath it. It sits ON the ice rather than
   * over it, which is what a caption does. A tone gives it the concept's
   * colours; without one it is warm ice.
   */
  // `o` { h, size, pad }: a smaller plate, for a word on a card (the showdown)
  function nameTag(parent, x, y, text, tone, o) {
    var c = CONCEPT[tone] || null;
    var g = mk('g', { 'class': 'badge' }, parent);
    var H0 = (o && o.h) || 50, fs = (o && o.size) || 26;
    var probe = mk('text', { x: x, y: y + (o && o.size ? fs * 0.35 : 9), 'text-anchor': 'middle', 'font-size': fs, 'font-weight': 900,
                             fill: c ? c.ink : '#0b3f7a', text: text }, g);
    var w = 0; try { w = probe.getComputedTextLength ? probe.getComputedTextLength() : 0; } catch (e) { w = 0; }
    if (!w) w = text.length * (o && o.size ? fs * 0.54 : 14);
    var bw = w + ((o && o.pad) || 52), bx = x - bw / 2, by = y - H0 / 2;
    var r = H0 * 0.44;
    // one face, one rim, no shadow and no gloss
    var face = mk('rect', { x: bx, y: by, width: bw, height: H0, rx: r,
                            fill: c ? c.wash : '#f3fcff', stroke: c ? c.deep : HI.edge, 'stroke-width': 3 }, g);
    g.insertBefore(face, probe);
    g._text = probe;
    g._rect = { x: bx, y: by, w: bw, h: H0 };
    return g;
  }

  function tag(parent, o) {
    var c = CONCEPT[o.tone] || null;
    var h = o.h == null ? 44 : o.h;
    var g = mk('g', o.attrs || {}, parent);
    var face = mk('rect', {
      x: o.x, y: o.y - h / 2, width: o.w, height: h, rx: h * 0.42,
      fill: c ? c.wash : UI.paper, stroke: c ? c.deep : UI.paperRim, 'stroke-width': UI.rim
    }, g);
    var t = mk('text', {
      x: o.x + o.w / 2, y: o.y + h * 0.15, 'text-anchor': 'middle',
      'font-size': o.size || Math.round(h * 0.48), 'font-weight': 700,
      fill: c ? c.ink : '#1c2a4a', text: o.label
    }, g);
    g._text = t;
    g._rect = { x: o.x, y: o.y - h / 2, w: o.w, h: h };
    // The live badge changes what it says WHILE the child drags a vertex, so
    // it has to be able to change what it is, too.
    g._retint = function (tone) {
      var cc = CONCEPT[tone];
      face.setAttribute('fill', cc ? cc.wash : UI.paper);
      face.setAttribute('stroke', cc ? cc.deep : UI.paperRim);
      t.setAttribute('fill', cc ? cc.ink : '#1c2a4a');
    };
    return g;
  }

  /* Lighten or darken a hex colour. The gloss on a button is the same
     colour at four brightnesses, so the palette carries one and this makes
     the rest — a table of eighty hand-picked values would be a table nobody
     could keep in step. */
  function shade(hex, t) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var to = t > 0 ? 255 : 0, k = Math.abs(t);
    var mix = function (c) { return Math.round(c + (to - c) * k); };
    return '#' + ((1 << 24) + (mix(r) << 16) + (mix(g) << 8) + mix(b)).toString(16).slice(1);
  }

  /**
   * A button.
   *
   * THE ARTWORK, IN THREE PIECES. assets/source/image.png is a sheet of
   * finished buttons; tools/build-buttons.js cuts the ones this lesson draws
   * out of it and measures where each round end finishes.
   *
   * A button here is every width from a 64-unit stepper key to a 184-unit
   * answer, and the sheet is one aspect ratio, so the picture cannot simply
   * be scaled to fit: a round end becomes an oval and the specular highlight
   * smears across the face. It is drawn as three pieces instead — the left
   * cap at its true proportions, the right cap at its true proportions, and
   * the sliver between them stretched to fill. That middle is a flat vertical
   * gradient, which is the only part of a pill that CAN stretch without
   * deforming.
   *
   * Each piece is a nested <svg> with a viewBox over the region it wants,
   * which is how SVG crops an image: an <image> has no source rectangle.
   *
   * WHICH BUTTONS EXIST is decided in the build tool, and the sheet cannot
   * supply the four CATEGORY colours — two of its twenty are the green and
   * the red that mean right and wrong. Categories are flat tags and tinted
   * drop zones, never buttons. A tone the sheet does not carry falls through
   * to the drawn gloss below, which is the same shape in the same light.
   */
  function pill(parent, o) {
    var tone = PILL_TONES[o.tone] || PILL_TONES.blue;
    var w = o.w, h = o.h == null ? 62 : o.h;
    var x = o.x, y = o.y;                        // y is the CENTRE of the face
    var r = o.r == null ? h / 2 : o.r;
    var lip = o.lip == null ? Math.max(4, h * 0.15) : o.lip;
    var top = y - h / 2;

    var g = mk('g', o.attrs || {}, parent);
    var art = null, drawn = null;

    // A GLYPH BUTTON IS ONE PICTURE. The stepper's minus and plus are cut
    // whole from the kit — snow-capped ice cubes with the sign already on
    // them — so they are drawn at their own proportions, and there is no
    // word to fit.
    var G = o.glyph && global.ButtonFrame && ButtonFrame[o.glyph];
    if (G && G.glyph) {
      var gw = h * (G.w / G.h);
      var gx = x + (w - gw) / 2;
      var im = mk('image', { x: gx, y: top, width: gw, height: h, preserveAspectRatio: 'none', 'pointer-events': 'none' }, g);
      im.setAttributeNS('http://www.w3.org/1999/xlink', 'href', G.src);
      im.setAttribute('href', G.src);
      // a wide invisible target, so a small picture is still an easy tap
      mk('rect', { x: x, y: top - 4, width: w, height: h + 8, fill: 'transparent' }, g);
      g._rect = { x: gx, y: top, w: gw, h: h };
      g._text = null; g._retint = function () {};
      if (o.press) g.style.cursor = 'pointer';
      return g;
    }

    var B = global.ButtonFrame && ButtonFrame[o.tone];

    // THE WORD FILLS THE PILL. A pill was 150 wide whatever it said, so
    // "Inside" swam in it and a long word crowded it. Measured first, the
    // pill is as wide as its word plus the two round caps — no empty face.
    var size = o.size || Math.round(h * 0.52);
    var probe = mk('text', { x: 0, y: 0, 'font-size': size, 'font-weight': 800, text: o.label, opacity: 0 }, g);
    var tw = 0;
    try { tw = probe.getComputedTextLength ? probe.getComputedTextLength() : 0; } catch (e) { tw = 0; }
    g.removeChild(probe);
    if (o.fit && tw > 0) {
      var want = Math.ceil(tw + h * 0.95);
      var nw = Math.max(o.minW || Math.round(h * 1.9), want);
      x = x + (w - nw) / 2;          // keep the centre where the caller put it
      w = nw;
    }

    if (B) {
      art = sliced(g, B, x, top, w, h);
    } else {
      drawn = drawnPill(g, tone, x, top, w, h, r, lip);
    }

    // FLAT AND BOLD. No shadow under the word: on a matte pill a shadow
    // read as a smear. Dark ink on the light pills, white on the dark ones.
    var DARK_ON = { sun: 1, uiPrimary: 1 };
    var ink = o.ink || (DARK_ON[o.tone] ? '#3a2410' : '#ffffff');
    var t = mk('text', {
      x: x + w / 2, y: y + h * 0.18,
      'text-anchor': 'middle', 'font-size': size, 'font-weight': 800,
      fill: ink, text: o.label,
      'pointer-events': 'none'
    }, g);

    g._text = t;
    g._rect = { x: x, y: top, w: w, h: h };
    // Kept so a badge can change what it says WHILE the child drags: the
    // shape turns concave under their hand and the label has to follow.
    g._retint = function (name) {
      var p = PILL_TONES[name] || PILL_TONES.blue;
      var nb = global.ButtonFrame && ButtonFrame[name];
      if (art && nb) art.href(nb);
      else if (drawn) drawn.paint(p);
      t.setAttribute('fill', o.ink || (DARK_ON[name] ? '#3a2410' : '#ffffff'));
    };

    if (o.press) g.style.cursor = 'pointer';
    return g;
  }

  /** The three pieces, and a way to point them all at another button. */
  function sliced(g, B, x, top, w, h) {
    var k = h / B.h;                 // the sheet's pixels, at this size
    var cap = Math.min(B.cap * k, w / 2);
    var pieces = [];
    var put = function (dx, dw, sx, sw) {
      var box = mk('svg', {
        x: dx, y: top, width: dw, height: h,
        viewBox: sx + ' 0 ' + sw + ' ' + B.h,
        preserveAspectRatio: 'none', overflow: 'hidden'
      }, g);
      var im = mk('image', { x: 0, y: 0, width: B.w, height: B.h,
                             preserveAspectRatio: 'none' }, box);
      im.setAttributeNS('http://www.w3.org/1999/xlink', 'href', B.src);
      im.setAttribute('href', B.src);
      pieces.push(im);
    };
    /* NO SEAM BETWEEN THE PIECES. Three pieces meeting edge to edge meet at
       a fraction of a pixel, and each is antialiased on its own, so a
       hairline of whatever is behind showed down both joins. The stretch is
       drawn first and a little wider, tucked under both caps; the caps are
       drawn over it, and there is no join left to see through. */
    var tuck = Math.min(2, Math.max(0, w / 2 - cap));
    put(x + cap - tuck, w - cap * 2 + tuck * 2, B.cap, B.w - B.cap * 2);   // the stretch, under the caps
    put(x, cap, 0, B.cap);                                                // left cap
    put(x + w - cap, cap, B.w - B.cap, B.cap);                            // right cap
    return {
      href: function (nb) {
        pieces.forEach(function (im) {
          im.setAttributeNS('http://www.w3.org/1999/xlink', 'href', nb.src);
          im.setAttribute('href', nb.src);
        });
      }
    };
  }

  /** The fallback: the same button, drawn, for a tone the sheet has not got. */
  function drawnPill(g, tone, x, top, w, h, r, lip) {
    var lipEl = mk('rect', { x: x, y: top + lip, width: w, height: h, rx: r, fill: tone[1] }, g);
    var face = mk('rect', { x: x, y: top, width: w, height: h, rx: r, fill: tone[0] }, g);
    var lit = mk('rect', { x: x, y: top, width: w, height: h, rx: r, fill: 'none', 'pointer-events': 'none' }, g);
    var rim = mk('rect', { x: x + 1, y: top + 1, width: w - 2, height: h - 2, rx: Math.max(0, r - 1),
                           fill: 'none', stroke: tone[1], 'stroke-width': 2, opacity: 0.55,
                           'pointer-events': 'none' }, g);
    mk('ellipse', { cx: x + w - h * 0.34, cy: top + h * 0.27, rx: h * 0.17, ry: h * 0.12,
                    fill: '#ffffff', opacity: 0.92, 'pointer-events': 'none' }, g);
    mk('ellipse', { cx: x + h * 0.36, cy: top + h * 0.72, rx: h * 0.1, ry: h * 0.07,
                    fill: '#ffffff', opacity: 0.55, 'pointer-events': 'none' }, g);
    var paint = function (p) {
      face.setAttribute('fill', shade(p[0], 0.04));
      lipEl.setAttribute('fill', p[1]);
      rim.setAttribute('stroke', p[1]);
      lit.setAttribute('fill', 'url(#' + gloss(p[0]) + ')');
    };
    paint(tone);
    return { paint: paint };
  }


  /* One gradient per colour, made once and reused: a button is drawn up to
     six times on a screen and the gloss is the same every time.
     Asked of the DOM rather than remembered in a map, because the map would
     go on claiming a gradient exists after the defs it lived in were cleared,
     and every button drawn after that would have no face. */
  /* THE SHAPE IS A SOLID THING, not a swatch. A flat fill with a dark line
     round it is a diagram; the same colour lit from above and deepening
     toward its foot, with an edge that is its own darker step, is a piece
     of coloured candy sitting on the ice — which is what a seven-year-old
     should want to pick up. One gradient per colour, made once. */
  function candy(hex) {
    var id = 'candy' + hex.slice(1);
    if (!svg) return id;
    if (svg.querySelector('#' + id)) return id;
    var defs = svg.querySelector('defs');
    if (!defs) return id;
    var ns = 'http://www.w3.org/2000/svg';
    var lg = document.createElementNS(ns, 'linearGradient');
    lg.setAttribute('id', id);
    lg.setAttribute('x1', '0'); lg.setAttribute('y1', '0');
    lg.setAttribute('x2', '0'); lg.setAttribute('y2', '1');
    [[0, shade(hex, 0.34)], [0.42, hex], [1, shade(hex, -0.2)]].forEach(function (st) {
      var stop = document.createElementNS(ns, 'stop');
      stop.setAttribute('offset', st[0]);
      stop.setAttribute('stop-color', st[1]);
      lg.appendChild(stop);
    });
    defs.appendChild(lg);
    return id;
  }

  function gloss(hex) {
    var id = 'gloss' + hex.slice(1);
    if (!svg) return id;
    if (svg.querySelector('#' + id)) return id;
    var defs = svg.querySelector('defs');
    if (!defs) return id;
    var ns = 'http://www.w3.org/2000/svg';
    var lg = document.createElementNS(ns, 'linearGradient');
    lg.setAttribute('id', id);
    lg.setAttribute('x1', '0'); lg.setAttribute('y1', '0');
    lg.setAttribute('x2', '0'); lg.setAttribute('y2', '1');
    [[0, shade(hex, 0.42)], [0.5, shade(hex, 0.02)], [0.52, hex], [1, shade(hex, -0.26)]]
      .forEach(function (st) {
        var stop = document.createElementNS(ns, 'stop');
        stop.setAttribute('offset', st[0]);
        stop.setAttribute('stop-color', st[1]);
        lg.appendChild(stop);
      });
    defs.appendChild(lg);
    return id;
  }



  /**
   * A y below the shape with real clearance, never past the panel.
   *
   * Anything that sits "under the polygon" has to clear the LOWEST VERTEX,
   * not a fixed height. A hexagon has a vertex at the very bottom where a
   * pentagon has a flat side well above it, and a fixed height put the word
   * through the corner of one and left a gap under the other.
   */
  /**
   * The lowest a caption may reach when a row of option buttons is up, or
   * null when there is no row.
   */
  function choiceCeiling() {
    if (!st.choiceEls || !st.choiceEls.length) return null;
    var top = Infinity;
    st.choiceEls.forEach(function (b) { if (b._rect && b._rect.y < top) top = b._rect.y; });
    return top === Infinity ? null : top - 18;
  }

  /**
   * Move anything already on the stage up off the option row.
   *
   * Clamping a caption when it is DRAWN is not enough, because on several
   * screens the row is built after it: the polygon and its "Diagonal" label
   * go up first, the options arrive a beat later, and the label had nothing
   * to clamp against at the time. So the row, once it exists, pushes.
   *
   * Running animations are finished first. The entrance pop is a transform,
   * and a transform attribute set underneath a running transform animation
   * is simply ignored — which is the same bug as the pulsing play button,
   * one layer down.
   */
  function liftAboveChoices() {
    var ceil = choiceCeiling();
    if (ceil == null) return;
    // The stepper as well as the captions. Some screens do not rebuild the
    // stage at all — they inherit the previous screen's builder and only add
    // a question — so panelFor() never sees them and the row arrives over a
    // stepper that was placed for a taller panel.
    // THE SLAB TOO, AND BY SHRINKING RATHER THAN MOVING.
    //
    // Some screens never build a stage: they inherit the one before and add a
    // question to it. panelFor() never sees those, so the slab is still the
    // full height it was given for a screen with no buttons, and the row
    // arrives across its foot — two thirds of each button on the card.
    //
    // It cannot be moved up: the shape is drawn in another layer against
    // coordinates taken from this box, and sliding the picture alone would
    // leave the polygon floating beside it. Made shorter, the shape stays
    // exactly where the child left it — which matters here, because the whole
    // point of these screens is the shape they just distorted.
    if (st.panelEl && st.panel) {
      var over = (st.panel.y + st.panel.h) - ceil;
      if (over > 0) {
        var nh = Math.max(200, st.panel.h - over);
        st.panel.h = nh;
        st.panelEl._rect.h = nh;
        var im = st.panelEl.querySelector('image, rect');
        if (im) im.setAttribute('height', nh);
      }
    }

    var movers = [];
    if (st.labelEl) movers.push(st.labelEl);
    if (st.stepperG) movers.push(st.stepperG);
    Object.keys(st.badges || {}).forEach(function (k) { movers.push(st.badges[k]); });
    movers.forEach(function (g) {
      if (!g || !g.getBBox) return;
      if (g.getAnimations) { try { g.getAnimations().forEach(function (a) { a.finish(); }); } catch (e) {} }
      var b;
      try { b = g.getBBox(); } catch (e) { return; }
      if (!b || !b.height) return;
      var over = b.y + b.height - ceil;
      if (over > 0) g.setAttribute('transform', 'translate(0,' + (-Math.ceil(over)) + ')');
    });
  }

  /* A vertex is drawn as a disc with a stroke, and on touch it is drawn
     bigger still. Clearing the CENTRE of the lowest one leaves a caption
     sitting on the dot; the clearance has to start from the edge of what is
     actually painted. */
  var VERT_PAINT = 12;   // a knob is r11 now

  /* WHERE A NAME TAG MAY GO ON THE GLASS: clear of every side, every corner
     (its knob, the chosen corner's ring and their glow), every diagonal, the
     inside of the shape and the frame's corner crystals. `r` is the plate's
     box. Tested against the shape itself, not its bounding box: the box of a
     pentagon is a third empty glass, and ruling all of it out is how the tag
     ended up on the one place left — over the corner knob. */
  function distToRect(p, r) {
    var dx = Math.max(r.x0 - p.x, 0, p.x - r.x1), dy = Math.max(r.y0 - p.y, 0, p.y - r.y1);
    return Math.sqrt(dx * dx + dy * dy);
  }
  function segHitsRect(a, b, r) {
    // Liang–Barsky: does any part of a→b lie inside r?
    var t0 = 0, t1 = 1, dx = b.x - a.x, dy = b.y - a.y;
    var p = [-dx, dx, -dy, dy], q = [a.x - r.x0, r.x1 - a.x, a.y - r.y0, r.y1 - a.y];
    for (var i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return false; continue; }
      var t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return true;
  }
  function tagClear(r) {
    var v = st.verts; if (!v || !v.length) return true;
    var pf = st.panel ? panelFace(st.panel) : { x: 0, y: 0, w: W, h: H };
    if (r.x0 < pf.x + 14 || r.x1 > pf.x + pf.w - 14 || r.y0 < pf.y + 14 || r.y1 > pf.y + pf.h - 8) return false;
    if (st.panel) {
      // the frame's crystals reach in over the glass at its four corners
      var P = st.panel, cw = P.w * 0.17, ch = P.h * 0.15;
      var corners = [{ x0: P.x, y0: P.y }, { x0: P.x + P.w - cw, y0: P.y }, { x0: P.x, y0: P.y + P.h - ch }, { x0: P.x + P.w - cw, y0: P.y + P.h - ch }];
      for (var c = 0; c < 4; c++) {
        var K = corners[c];
        if (r.x0 < K.x0 + cw && r.x1 > K.x0 && r.y0 < K.y0 + ch && r.y1 > K.y0) return false;
      }
    }
    var n = v.length, pad = 8, R = { x0: r.x0 - pad, y0: r.y0 - pad, x1: r.x1 + pad, y1: r.y1 + pad };
    for (var k = 0; k < n; k++) if (distToRect(v[k], r) < 26) return false;
    for (var e = 0; e < n; e++) if (segHitsRect(v[e], v[(e + 1) % n], R)) return false;
    var ds = st.diagonals || [];
    for (var d = 0; d < ds.length; d++) if (v[ds[d][0]] && v[ds[d][1]] && segHitsRect(v[ds[d][0]], v[ds[d][1]], R)) return false;
    return !Poly.contains(v, { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });
  }
  /* BESIDE THE SIDE IT NAMES. The first place along the side's outward
     normal — nearest the side, then sliding along it — where the whole plate
     is clear (tagClear). Returns the text baseline, or null if the card has
     no such place. The plate is tw × 40, its centre 7 above the baseline. */
  function besideSide(a, b, tw) {
    var m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    var sl = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / sl, uy = (b.y - a.y) / sl;
    var nx = -uy, ny = ux;
    if ((m.x - st.cx) * nx + (m.y - st.cy) * ny < 0) { nx = -nx; ny = -ny; }
    var hx = tw / 2, hy = 20, reach = Math.abs(nx) * hx + Math.abs(ny) * hy;
    for (var gap = 14; gap <= 150; gap += 8) {
      for (var k = 0; k < 11; k++) {
        var slide = Math.ceil(k / 2) * 16 * (k % 2 ? -1 : 1);
        var cx = m.x + nx * (reach + gap) + ux * slide, cy = m.y + ny * (reach + gap) + uy * slide;
        if (tagClear({ x0: cx - hx, y0: cy - hy, x1: cx + hx, y1: cy + hy })) return { x: cx, y: cy + 7 };
      }
    }
    return null;
  }

  /* A STEP THAT CANNOT BE TAKEN LOOKS IT. At the fewest sides the minus did
     nothing when pressed and looked exactly like the plus; at the most, the
     plus did. The button that has run out goes grey and flat, takes no hand
     and does not breathe (alive() reads the hand); both do when the stepper
     is locked. */
  function dressStep(btn, on) {
    if (!btn) return;
    btn.style.opacity = on ? '' : '0.42';
    btn.style.filter = on ? '' : 'grayscale(1)';
    btn.style.cursor = on ? 'pointer' : 'default';
    btn.setAttribute('aria-disabled', on ? 'false' : 'true');
    if (btn.classList) btn.classList.toggle('disabled', !on);
  }
  function syncStepper() {
    if (!st.stepMinus || !st.stepper) return;
    var free = !st.stepLocked;
    dressStep(st.stepMinus, free && st.n > st.stepper.min);
    dressStep(st.stepPlus, free && st.n < st.stepper.max);
  }

  function belowShape(gap, floorPad) {
    var lowest = st.verts && st.verts.length
      ? st.verts.reduce(function (m, p) { return p.y > m ? p.y : m; }, -Infinity) + VERT_PAINT
      : null;
    var f = st.panel ? panelFace(st.panel) : null;
    var floorY = f ? f.y + f.h - (floorPad == null ? 8 : floorPad * 0.4) : H - 30;
    var ceil = choiceCeiling();
    if (ceil != null) floorY = Math.min(floorY, ceil);
    if (lowest == null) return floorY;
    return Math.min(floorY, lowest + (gap == null ? 52 : gap));
  }


  /**
   * THE SHAPE MAKES ROOM FOR ITS NAME. A scene built on one screen is
   * named on a later one — "Side", "Diagonal" — and the shape was fitted
   * to the whole face before the word existed, so the tag landed on its
   * bottom edge and on the rim. Now, when the tag needs `need` units under
   * the lowest corner and there are not that many, the whole polygon slides
   * up if the top has the room, and otherwise shrinks about its top edge
   * until it does — animated as one piece, so the child sees the shape
   * step up to let its name in.
   */
  function makeRoomBelow(floorY, need) {
    var v = st.verts; if (!v || !v.length || !st.panel) return;
    var lo = Infinity, hi = -Infinity, xl = Infinity, xr = -Infinity;
    v.forEach(function (p) { if (p.y < lo) lo = p.y; if (p.y > hi) hi = p.y; if (p.x < xl) xl = p.x; if (p.x > xr) xr = p.x; });
    var want = floorY - need;                    // the lowest corner may sit here at most
    if (hi + VERT_PAINT <= want) return;
    var pf = panelFace(st.panel);
    var top = pf.y + pf.h * 0.02 + VERT_PAINT;
    var deficit = hi + VERT_PAINT - want;
    var k = 1, newTop;
    if (deficit <= lo - top) newTop = lo - deficit;          // slide up, whole
    else { newTop = top; k = Math.max(0.5, (want - VERT_PAINT - top) / (hi - lo)); }   // shrink about the top
    var cx = (xl + xr) / 2;
    st.verts = v.map(function (p) { return { x: cx + (p.x - cx) * k, y: newTop + (p.y - lo) * k }; });
    st.cx = cx; st.cy = newTop + (hi - lo) * k / 2; if (st.r) st.r *= k;
    renderPoly();
    // one piece: the group is drawn where it now belongs and animated from
    // where it was — scaled about its top-centre, then moved
    var g = st.polyG;
    if (g && g.animate && !reduced()) {
      g.style.transformBox = 'fill-box'; g.style.transformOrigin = '50% 0%';
      g.animate([
        { transform: 'translate(0px, ' + (lo - newTop).toFixed(1) + 'px) scale(' + (1 / k).toFixed(4) + ')' },
        { transform: 'none' }
      ], { duration: 520, easing: 'cubic-bezier(.22,1,.36,1)' });
    }
  }

  /**
   * THE NAME GOES UNDER THE CARD, NOT IN IT. A tag inside the glass took
   * the shape's room and sat on its bottom edge; under the card, in the
   * band the answer buttons use, it is a name tag on the thing it names.
   * The card gives up its foot for it — shortened to the control line, as
   * panelFor() would have built it had the name been declared — and the
   * shape steps up to fit the smaller face (makeRoomBelow), as big as that
   * face allows.
   */
  function bandBelow() {
    if (!st.panel || !st.panelEl) return;
    var ceil = BOTTOM - CONTROL_H - CONTROL_GAP;
    if (st.panel.y + st.panel.h > ceil + 0.5) {
      var nh = Math.max(200, ceil - st.panel.y);
      st.panel.h = nh;
      if (st.panelEl._rect) st.panelEl._rect.h = nh;
      var im = st.panelEl.querySelector('image, rect');
      if (im) im.setAttribute('height', nh);
    }
    var pf = panelFace(st.panel);
    makeRoomBelow(pf.y + pf.h, VERT_PAINT + 10);
  }

  function morphFrom(prev) {
    if (reduced() || !st.fill || !st.fill.animate) return;
    // Resample both outlines to a common count so the path can tween.
    // An open figure tweens as an open chain and a closed one as a ring;
    // the two path forms cannot interpolate, so the NEW figure decides.
    // Closing a corner into a triangle draws the third side in; opening a
    // triangle back to a corner takes it away.
    var open = isOpen();
    var from = open ? resampleOpen(prev, 60) : resample(prev, 60);
    var to = open ? resampleOpen(st.verts, 60) : resample(st.verts, 60);
    var P = open ? pathOpen : pathOf;
    var f = st.fill;
    var a = f.animate([{ d: 'path("' + P(from) + '")' }, { d: 'path("' + P(to) + '")' }], { duration: 640, easing: 'cubic-bezier(.22,1,.36,1)' });
    void a;
  }
  /** The open chain through v, resampled to count points (the last vertex kept). */
  function resampleOpen(v, count) {
    var segs = Math.max(1, v.length - 1), out = [], per = (count - 1) / segs;
    for (var i = 0; i < segs; i++) {
      var a = v[i], b = v[Math.min(i + 1, v.length - 1)];
      for (var k = 0; k < per; k++) { var t = k / per; out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }); }
    }
    out.push(v[v.length - 1]);
    return out;
  }
  function resample(v, count) {
    var n = v.length, out = [], per = count / n;
    for (var i = 0; i < n; i++) {
      var a = v[i], b = v[(i + 1) % n];
      for (var k = 0; k < per; k++) { var t = k / per; out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }); }
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Incremental ops
   * ------------------------------------------------------------------ */

  function resolveVertex(ref) {
    if (typeof ref === 'number') return ref;
    if (ref === 'picked') return st.picked == null ? 0 : st.picked;
    if (ref === 'adjacent') return (st.picked == null ? 0 : st.picked) + 1 >= st.n ? 0 : (st.picked == null ? 0 : st.picked) + 1;
    if (ref === 'remaining-diagonal') {
      var used = (st.diagonals || []).map(function (d) { return d.join('-'); });
      var cands = Poly.diagonalsFrom(st.picked == null ? 0 : st.picked, st.n).filter(function (j) {
        var k = [Math.min(st.picked, j), Math.max(st.picked, j)].join('-'); return used.indexOf(k) < 0;
      });
      return cands[0] == null ? 0 : cands[0];
    }
    return 0;
  }

  var op = {
    highlight: function (h) {
      if (h.vertex != null) {
        st.vcolor = st.vcolor || {};
        var i = resolveVertex(h.vertex);
        st.vcolor[i] = h.color === 'red' ? HI.bad : h.color === 'orange' ? HI.hot : HI.fill;
        renderPoly();
        if (knobOf(i)) juice('pop', knobOf(i), { scale: 0.5 });
      }
      if (h.diagonal === 'outside') {
        // Entered with the pentagon still convex — a jump, a restart — there
        // is no outside diagonal to show, so the vertex is pulled in first:
        // the screen then says what it shows.
        if (global.Poly && Poly.classify && !Poly.classify(st.verts).concave) {
          var c0 = Poly.centroid(st.verts), p0 = st.verts[0];
          st.verts[0] = { x: c0.x + (p0.x - c0.x) * 0.1, y: c0.y + (p0.y - c0.y) * 0.1 };
          st.vcolor = st.vcolor || {}; st.vcolor[0] = HI.fill;
        }
        st.highlightOutside = true; st.onlyOutside = true; renderPoly(); juice('flash', st.diagG);
      }
    },
    /**
     * A label on one side of the shape.
     *
     * OUTSIDE THE SHAPE, ALWAYS. It used to sit at the segment's midpoint
     * plus a fixed (+110, -40): up and to the right, whatever the side was.
     * On the bottom edge of a pentagon that is INTO the polygon — the word
     * "Side" landed on the fill, on top of the right-hand vertex, with its
     * leader line crossing the shape to reach a midpoint a few pixels away.
     *
     * A fixed offset cannot work, because which way is "away" depends on
     * which side is labelled. The label now sits along the segment's outward
     * normal — the direction from the shape's centre through the midpoint —
     * so it is beside the side it names and clear of the shape whichever
     * side that is, and the leader crosses nothing.
     */
    label: function (l) {
      st.labelSpec = specOf(l);
      if (st.labelEl) st.labelEl.remove();
      var x, y, m = null;
      if (l.at === 'below-polygon' || !st.segment) {
        // Below the SHAPE, not at the bottom of the panel. Pinned to the
        // panel it sat at a fixed height whatever the shape did, and a
        // hexagon — which has a vertex at the very bottom, where a pentagon
        // has a flat side well above it — reached down into the word. The
        // clearance is measured from the lowest vertex, and only falls back
        // to the panel when the shape leaves no room.
        var lceil = choiceCeiling();
        /* ON THE GLASS, UNDER THE SHAPE (inside: true), when the card has the
           room: the name belongs on the card beside the line it names. In the
           band under the card it sat on the stage's floor with Back and the
           progress bar, a card's height from its diagonal. */
        var under = null;
        if (l.inside && st.panel && lceil == null && st.verts && st.verts.length) {
          var utw = String(l.text).length * 15 + 36;
          var ulow = st.verts.reduce(function (mm, p) { return p.y > mm ? p.y : mm; }, -Infinity);
          for (var ug = 22; ug <= 70 && !under; ug += 6) {
            for (var uk = 0; uk < 9 && !under; uk++) {
              var ucx = st.cx + Math.ceil(uk / 2) * 22 * (uk % 2 ? -1 : 1), ucy = ulow + ug + 20;
              if (tagClear({ x0: ucx - utw / 2, y0: ucy - 20, x1: ucx + utw / 2, y1: ucy + 20 })) under = { x: ucx, y: ucy + 7 };
            }
          }
        }
        if (under) { x = under.x; y = under.y; }
        else if (st.panel && lceil == null) {
          // under the card, centred, in the control band (see bandBelow)
          bandBelow();
          x = st.panel.x + st.panel.w / 2;
          y = controlY() + 9;   // the text baseline, so the plate is centred in the band
        } else {
          var pf = panelFace(st.panel);
          var floorY = pf.y + pf.h - 8;
          if (lceil != null) floorY = Math.min(floorY, lceil);
          x = st.cx;
          var lowest = st.verts && st.verts.length
            ? st.verts.reduce(function (m, p) { return p.y > m ? p.y : m; }, -Infinity) + VERT_PAINT
            : null;
          y = lowest == null ? Math.min(floorY, st.panel.y + st.panel.h - 30)
                             : Math.min(floorY, lowest + 52);
        }
      } else {
        var a = st.verts[st.segment[0]], b = st.verts[st.segment[1]];
        m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        var beside = besideSide(a, b, String(l.text).length * 15 + 36);
        if (beside) { x = beside.x; y = beside.y; }
        else {
        // (no clear place beside it on this card: the older search, which
        // keeps the tag on the glass and off the shape's box)
        var nx = m.x - st.cx, ny = m.y - st.cy;
        var len = Math.sqrt(nx * nx + ny * ny) || 1;
        var OUT = 74;
        x = m.x + nx / len * OUT;
        y = m.y + ny / len * OUT;
        // and never off the glass, however the shape is oriented: the word
        // used to land on the rim of the card
        var pfc = st.panel ? panelFace(st.panel) : { x: 0, y: 0, w: W, h: H };
        // the tag is 40 tall about y-7, so 32 from the foot keeps its whole
        // plate on the glass and off the rim
        x = Math.max(pfc.x + 70, Math.min(pfc.x + pfc.w - 70, x));
        // a tag on the glass stays on the glass; one in the band under the
        // card stays above the foot of the stage
        if (y <= pfc.y + pfc.h) y = Math.max(pfc.y + 40, Math.min(pfc.y + pfc.h - 32, y));
        else y = Math.min(y, BOTTOM - 14);

        /* AND NEVER ON THE SHAPE ITSELF.
         *
         * The tag is pushed out from the middle of the side it names, and
         * then pulled back inside the glass — and on a card the shape nearly
         * fills, those two pull against each other and the word ends up
         * lying across the very outline it is pointing at, with its string
         * crossing the shape. A tag on top of the thing it names is worse
         * than a tag further away, so if the plate still covers the shape it
         * is walked outwards along the same line until it is clear, and it
         * is allowed onto the rim to get there. */
        if (st.verts && st.verts.length) {
          var tw = (String(l.text).length * 15) + 36;
          var bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
          st.verts.forEach(function (p) {
            if (p.x < bx0) bx0 = p.x; if (p.x > bx1) bx1 = p.x;
            if (p.y < by0) by0 = p.y; if (p.y > by1) by1 = p.y;
          });
          var ox = (m.x - st.cx), oy = (m.y - st.cy);
          var ol = Math.sqrt(ox * ox + oy * oy) || 1;
          ox /= ol; oy /= ol;
          var hits = function (px, py) {
            return px - tw / 2 < bx1 + 6 && px + tw / 2 > bx0 - 6 &&
                   py - 27 < by1 + 6 && py + 13 > by0 - 6;
          };

          /* OFF THE SHAPE, AND OFF THE FRAME.
           *
           * This walked the tag outwards until it cleared the shape and then
           * clamped it to the STAGE — which threw away the clamp to the glass
           * a few lines above and let it finish on the card's rim, across a
           * moulded corner and its snow cap. Two clamps pulling opposite ways,
           * and the last one won.
           *
           * The rim is not fair game: it is the most decorated part of the
           * picture, and a white plate lying over a corner reads as a mistake
           * whatever it is pointing at. So the search is two-dimensional now —
           * out along the line from the middle of the side, and sideways
           * along the rim from there — and it takes the first place that is
           * both clear of the shape and wholly on the glass. If the card is
           * too full for any such place to exist, the tag stays on the glass
           * and overlaps the shape, because a tag over the thing it names is
           * still the lesser of the two. */
          var glassX0 = pfc.x + tw / 2 + 14, glassX1 = pfc.x + pfc.w - tw / 2 - 14;
          var glassY0 = pfc.y + 44, glassY1 = pfc.y + pfc.h - 18;
          var onGlass = function (px, py) {
            return px >= glassX0 - 0.5 && px <= glassX1 + 0.5 && py >= glassY0 - 0.5 && py <= glassY1 + 0.5;
          };
          var px0 = -oy, py0 = ox;                     // along the rim, not away from it
          var best = null;
          if (glassX1 >= glassX0 && glassY1 >= glassY0) {
            for (var step = 0; step <= 12 && !best; step++) {
              for (var side = 0; side < 7 && !best; side++) {
                var sgn = side % 2 ? -1 : 1, slide = Math.ceil(side / 2) * 26 * sgn;
                var tx = x + ox * step * 14 + px0 * slide;
                var ty = y + oy * step * 14 + py0 * slide;
                if (onGlass(tx, ty) && !hits(tx, ty)) best = { x: tx, y: ty };
              }
            }
          }
          if (best) { x = best.x; y = best.y; }
          else {
            // nowhere clear: stay on the glass rather than climb onto the frame
            for (var g2 = 0; g2 < 14 && hits(x, y); g2++) { x += ox * 14; y += oy * 14; }
            if (glassX1 >= glassX0) x = Math.max(glassX0, Math.min(glassX1, x));
            else x = pfc.x + pfc.w / 2;
            if (glassY1 >= glassY0) y = Math.max(glassY0, Math.min(glassY1, y));
            else y = pfc.y + pfc.h / 2;
          }
          // and never off the stage, whatever the card did
          x = Math.max(tw / 2 + 12, Math.min(W - tw / 2 - 12, x));
          y = Math.max(46, Math.min(BOTTOM - 14, y));
        }
        }
      }
      var g = mk('g', { 'class': 'label' }, layers.ui);
      // THE WORD ON A PLATE. Ink straight on the glass sat on the rim and the
      // grain; a small paper plate, the same one the stepper and the
      // checklist use, gives it a place. Measured after it is set, so the
      // plate is as wide as the word.
      // A NAME TAG, NOT A BUTTON. On cream with a tan rim the word read as
      // something to press. Cut from the same ice as the cards — frost-white
      // glass with a glacier rim, deep-water lettering — it reads as a tag
      // pinned to the thing it names, and the leader is its string.
      var lt = mk('text', { x: x, y: y, 'text-anchor': 'middle', 'font-size': 26, 'font-weight': 800,
                            fill: '#0f3f8f', text: l.text }, g);
      var lw = 0; try { lw = lt.getComputedTextLength ? lt.getComputedTextLength() : 0; } catch (e) { lw = 0; }
      if (!lw) lw = l.text.length * 15;
      var plate = mk('rect', { x: x - lw / 2 - 18, y: y - 27, width: lw + 36, height: 40, rx: 11,
                               fill: '#f3fcff', stroke: HI.rim, 'stroke-width': 3 }, g);
      g.insertBefore(plate, lt);
      if (l.arrow && m) {
        /* THE STRING, FROM THE PLATE'S EDGE TO A PIN IN THE SIDE. It started
           30 units from the plate's centre — under the plate — and stopped 14
           short of the side, so all that showed was a dot in the air beside
           the line. It leaves the plate where the plate ends, and the pin is
           ON the side, at its middle: the tag is pinned to the thing. */
        var pcx = x, pcy = y - 7, phx = (lw + 36) / 2, phy = 20;
        var dx = m.x - pcx, dy = m.y - pcy, d = Math.sqrt(dx * dx + dy * dy) || 1;
        var te = Math.min(dx ? phx / Math.abs(dx) : Infinity, dy ? phy / Math.abs(dy) : Infinity);
        var sx = pcx + dx * te + dx / d * 3, sy = pcy + dy * te + dy / d * 3;
        var ex = m.x - dx / d * 6, ey = m.y - dy / d * 6;
        if (te < 1 && Math.hypot(ex - sx, ey - sy) > 6) {
          mk('line', { x1: sx, y1: sy, x2: ex, y2: ey, stroke: HI.rim, 'stroke-width': 3.5, 'stroke-linecap': 'round' }, g);
        }
        mk('circle', { cx: m.x, cy: m.y, r: 5.5, fill: '#f3fcff', stroke: HI.rim, 'stroke-width': 2.5, 'class': 'tag-pin' }, g);
      }
      st.labelEl = g;
      if (l.cue && holdForWord(g, l.cue)) return;               // the tag arrives on its word
      if (l.enter && !reduced()) enter(g, 'ui');
    },
    badge: function (b) {
      var key = b.under || 'main';
      st.badgeSpecs = st.badgeSpecs || {}; st.badgeSpecs[key] = specOf(b);
      st.badges = st.badges || {};
      if (st.badges[key]) st.badges[key].remove();
      var x, y;
      if (b.under && st.compare && st.compare[b.under.split('.')[1]]) {
        var pnl = st.compare[b.under.split('.')[1]].panel;
        x = pnl.x + pnl.w / 2; y = pnl.y + pnl.h + 46;
      } else {
        if (st.panel && !(st.choiceEls && st.choiceEls.length)) {
          // under the card, in the control band, like a label (bandBelow)
          bandBelow();
          x = st.panel.x + st.panel.w / 2;
          y = controlY();
        } else {
          // Clear of the SHAPE, not at a fixed height above the panel's foot —
          // which a hexagon's bottom vertex reached straight through.
          x = st.cx;
          y = belowShape(30, 34);
          if (st.choiceEls && st.choiceEls.length) y = Math.min(y, H - 64 - 60);
        }
      }
      var g = tag(layers.ui, {
        x: x - 84, y: y, w: 168, h: 44,
        label: b.text, tone: b.tone || conceptOf(b.text),
        attrs: { 'class': 'badge' }
      });
      st.badges[key] = g; if (b.live) st.liveBadge = g;
      // a tag put under a card that has stepped back steps back too
      if (b.under && st.compareFocus && b.under !== 'compare.' + st.compareFocus) dimTag(g, true);
      if (b.cue && holdForWord(g, b.cue)) return;                // it arrives with its word
      if (b.enter && !reduced()) enter(g, 'ui');
    },
    ghost: function (gh) { st.ghost = gh ? { from: resolveVertex(gh.from), to: resolveVertex(gh.to) } : null; renderPoly(); },
    draw: function (d) {
      st.segment = [resolveVertex(d.segment[0]), resolveVertex(d.segment[1])];
      renderPoly();
      if (d.animate && st.segLine && !reduced()) {
        var a = st.verts[st.segment[0]], b = st.verts[st.segment[1]], len = Math.hypot(b.x - a.x, b.y - a.y);
        st.segLine.style.strokeDasharray = len; st.segLine.style.strokeDashoffset = len;
        st.segLine.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: d.animate, fill: 'forwards' });
      }
    },
    diagonals: function (d) {
      if (d.diagonals === 'all') {
        st.diagonals = Poly.allDiagonals(st.n).map(function (pair, k) { return Object.assign(pair, { animate: d.animate === 'sequential', delay: k * (d.each || 200), each: d.each }); });
        st.segment = null; st.vcolor = null; renderPoly();
      }
    },
    choices: function (list, spec) {
      if (st.choiceG) { st.choiceG.remove(); st.choiceG = null; }
      if (!list) {
        // no row left to answer with: nothing should still point at its
        // buttons, and the card is no longer sitting above a band
        st.choiceEls = [];
        if (st.panel && st.panel.controls && !st.stepperG) { st.panel.controls = false; applySeat(true); }
        return;
      }
      // `cue`: each answer waits for the word that names it (holdForWord).
      // true reads the words off the label itself ("Inside" on "inside");
      // an object says which word, for an answer the line never says whole.
      var cue = spec && spec.cue;
      var cueFor = function (label) {
        if (!cue) return null;
        if (cue === true) return String(label).split(/\s+/);
        return cue[label] || null;
      };
      var g = mk('g', { 'class': 'choices' }, layers.ui); st.choiceG = g; st.choiceEls = [];
      // SMALLER. At 216x64 of a 1000x562 stage these came out 276x82 real
      // pixels on a laptop — a pair of slabs that took the eye before the
      // question did. This is still well past a 44px finger target at every
      // size the game runs at, and it lets the row sit clear of the card
      // rather than jammed against it.
      // Under the object, sized to be found and not to be looked at first:
      // a row of answers is the third thing on the screen, after the plank
      // and the shape.
      // ONE SIZE, ONE COLOUR. Two answers in two colours and two widths read
      // as two different kinds of thing; they are the same kind of thing.
      // Every pill in the row is the sun-yellow one, as wide as the longest
      // word wants, and no narrower than a comfortable finger.
      var longest = list.reduce(function (n, t) { return Math.max(n, String(t).length); }, 0);
      var bw = Math.max(150, Math.min(250, longest * 13 + 62)), gap = 24, bh = 50;
      var row = list.length * bw + (list.length - 1) * gap;
      var x0 = (st.panel ? st.panel.x + st.panel.w / 2 : W / 2) - row / 2;
      var rowCentre = x0 + row / 2;
      // Directly under the panel (controlY), never off the foot. A panel
      // built before its question arrived is full height; liftAboveChoices()
      // then shortens it to clear the row, as it always has.
      var y = controlY();
      x0 = Math.max(14, Math.min(x0, W - row - 14));
      list.forEach(function (label, i) {
        var x = x0 + i * (bw + gap);
        // An option that NAMES a category is drawn in that category's colour,
        // so the word on the button, the bin it belongs in and the badge it
        // earns all agree. Everything else gets a colour that means nothing —
        // enough for a row to read as separate choices, never enough to hint
        // which one is right.
        // THE NEW KIT'S BUTTON: the glossy gold capsule every other control in
        // the game now wears (btn-uiPrimary), not the matte lesson pill
        var b = pill(g, {
          x: x, y: y, w: bw, h: bh, label: label,
          tone: 'uiPrimary',
          press: true, attrs: { 'class': 'choice', 'data-label': label }
        });
        st.choiceEls.push(b);
        var words = cueFor(label);
        if (words && holdForWord(b, words)) return;       // arrives with its word
        if (!reduced()) { b.style.opacity = 0; later(90 * i, function () { b.style.opacity = 1; enter(b, 'ui'); }); }
      });
      // Each pill is now as wide as its word, so the row is laid again from
      // the real widths and centred where the fixed row would have been.
      var total = st.choiceEls.reduce(function (n, b) { return n + b._rect.w; }, 0) + gap * (list.length - 1);
      var cursor = rowCentre - total / 2;
      st.choiceEls.forEach(function (b) {
        var dx = cursor - b._rect.x;
        if (Math.abs(dx) > 0.5) {
          b.setAttribute('transform', 'translate(' + dx.toFixed(1) + ',0)');
          b._rect = { x: b._rect.x + dx, y: b._rect.y, w: b._rect.w, h: b._rect.h };
        }
        cursor += b._rect.w + gap;
      });
      liftAboveChoices();
    },
    stepper: function (s) { if (s === 'locked' && st.stepMinus) { st.stepLocked = true; syncStepper(); } },
    measurements: function (m) {
      if (m === 'live') { st.measure = { sides: 'all', angles: 'all', units: true }; renderPoly(); }
    },
    /* "ALL DIAGONALS ARE STILL INSIDE." — SHOWN, NOT LABELLED.
     *
     * Once the second diagonal is in, the picture says it before the words
     * do: each diagonal brightens in turn, then both together, and the inside
     * of the shape glows for a moment, softly, and settles. No arrow, no
     * "INSIDE" tag, no particles — the lines are inside, and the glow is
     * where they are. */
    observe: function (what) {
      if (what !== 'diagonals' || !st.diagG || !st.polyG || reduced()) return;
      var groups = [].slice.call(st.diagG.childNodes).filter(function (g) { return g.style.display !== 'none'; });
      if (!groups.length) return;
      var STEP = 420;
      var lift = function (el, delay, dur) {
        if (!el.animate) return;
        try {
          el.animate([{ filter: 'brightness(1)' },
                      { filter: 'brightness(1.6) drop-shadow(0 0 5px rgba(191, 244, 255, .95))', offset: 0.4 },
                      { filter: 'brightness(1)' }], { duration: dur, delay: delay, easing: 'ease-in-out' });
        } catch (e) {}
      };
      groups.forEach(function (g, k) { lift(g, k * STEP, 520); });                 // one after another
      groups.forEach(function (g) { lift(g, groups.length * STEP + 80, 640); });    // then together
      var glow = document.createElementNS(NS, 'path');
      glow.setAttribute('d', pathOf(st.verts)); glow.setAttribute('fill', '#e8fbff');
      glow.setAttribute('fill-opacity', 0); glow.setAttribute('pointer-events', 'none');
      glow.setAttribute('class', 'inside-glow');
      st.polyG.insertBefore(glow, st.diagG);                                      // over the fill, under the lines
      if (!glow.animate) { glow.remove(); return; }
      try {
        glow.animate([{ fillOpacity: 0 }, { fillOpacity: 0.34, offset: 0.45 }, { fillOpacity: 0 }],
                     { duration: 1100, delay: groups.length * STEP + 160, easing: 'ease-in-out', fill: 'both' })
          .finished.then(function () { glow.remove(); }, function () { glow.remove(); });
      } catch (e) { glow.remove(); }
    },

    /* THE END-GAME SUMMARY, driven by the screen's beats: `card` brings one
       in and shows its idea, `collect` puts it away, `final` gathers the
       collection. Each returns a promise the beat waits on, so no state of it
       ever overlaps the next. */
    summary: function (o) {
      if (!o || st.kind !== 'summary') return null;
      if (o.card) return summaryShow(o.card);
      if (o.collect) return summaryCollect(o.collect);
      if (o.final) return summaryFinal();
      return null;
    }
  };

  /* A SPEC WITHOUT ITS ENTRANCE: what to build, not how it arrived. */
  function specOf(o) {
    if (!o || typeof o !== 'object') return o;
    var c = JSON.parse(JSON.stringify(o));
    delete c.enter; delete c._panel;
    return c;
  }

  /* THE SCENE, WRITTEN DOWN.
   *
   * Back used to rebuild a screen from the nearest one that declared a
   * scene — which gives the right pentagon but not the child's pentagon: not
   * the corner they picked, the diagonal they drew, the dent they pulled, the
   * sides they measured. So a screen that had any of that on it could not be
   * landed on, and Back from "Yay! You made a diagonal." skipped six screens
   * to "Pick any vertex." Now game.js writes the scene down as each screen
   * begins, and restore() puts back exactly that — the same card in the same
   * place, the same shape, the same marks — so Back is one screen, like Next.
   *
   * Plain data only: no elements, nothing that belongs to a running
   * animation. Scenes a screen always builds for itself (the grid, the sort,
   * the swipe, the vista) are not written down; that screen's own beats
   * rebuild them. */
  function snapshot() {
    if (!st.kind || !st.buildSpec || !/^(polygon|builder|compare)$/.test(st.kind)) return st.kind ? { kind: st.kind } : null;
    var copy = function (o) { return o == null ? (o === undefined ? null : o) : JSON.parse(JSON.stringify(o)); };
    return {
      kind: st.kind, spec: copy(st.buildSpec), panel: copy(st.panel),
      verts: copy(st.verts), n: st.n, cx: st.cx, cy: st.cy, r: st.r,
      picked: st.picked == null ? null : st.picked,
      segment: copy(st.segment), vcolor: copy(st.vcolor),
      diagonals: (st.diagonals || []).map(function (d) { return { a: d[0], b: d[1], solid: !!d.solid }; }),
      measure: copy(st.measure), highlightOutside: !!st.highlightOutside, onlyOutside: !!st.onlyOutside,
      ghost: copy(st.ghost), label: copy(st.labelSpec), badges: copy(st.badgeSpecs),
      compareFocus: st.compareFocus || null, stepLocked: !!st.stepLocked,
      liveText: st.liveBadge && st.liveBadge._text ? st.liveBadge._text.textContent : null
    };
  }

  /** Put a written-down scene back. False if it is not one that can be. */
  function restore(snap) {
    if (!snap || !snap.spec || !BUILD[snap.kind]) return false;
    var spec = Object.assign({}, snap.spec, { enter: false, _panel: snap.panel });
    if (snap.kind === 'polygon') { spec.label = null; spec.badge = null; spec.diagonals = null; }
    if (snap.kind === 'builder') spec.sides = snap.n;
    BUILD[snap.kind](spec);
    if (snap.kind !== 'compare') {
      st.verts = snap.verts; st.n = snap.n; st.cx = snap.cx; st.cy = snap.cy; st.r = snap.r;
      st.picked = snap.picked == null ? null : snap.picked;
      st.segment = snap.segment; st.vcolor = snap.vcolor;
      st.diagonals = (snap.diagonals || []).map(function (d) { return Object.assign([d.a, d.b], d.solid ? { solid: true } : {}); });
      st.measure = snap.measure; st.highlightOutside = snap.highlightOutside; st.onlyOutside = snap.onlyOutside;
      st.ghost = snap.ghost;
      if (st.stepText) st.stepText.textContent = snap.n;
      renderPoly();
      if (snap.stepLocked) op.stepper('locked');
      // put back as they were seen: shown, not waiting again for a word
      if (snap.label) op.label(Object.assign({}, snap.label, { cue: null, enter: false }));
    } else if (snap.compareFocus) {
      focus('compare.' + snap.compareFocus, 'dim-others');
    }
    Object.keys(snap.badges || {}).forEach(function (k) { op.badge(Object.assign({}, snap.badges[k], { cue: null, enter: false })); });
    if (snap.liveText && st.liveBadge && st.liveBadge._text) st.liveBadge._text.textContent = snap.liveText;
    applySeat(false);
    return true;
  }

  function apply(spec) {
    if (!spec) return;
    if (spec.kind) BUILD[spec.kind] && BUILD[spec.kind](spec);
    if (spec.highlight) op.highlight(spec.highlight);
    if (spec.draw) op.draw(spec.draw);
    if (spec.diagonals && !spec.kind) op.diagonals(spec);
    if ('ghost' in spec && !spec.kind) op.ghost(spec.ghost);
    if (spec.label && !spec.kind) op.label(spec.label);
    // a carried name tag is taken down by a beat that says label: null
    if (spec.label === null && st.labelEl) { st.labelEl.remove(); st.labelEl = null; st.labelSpec = null; }
    // the side that was named, and its tag, fade before the next try
    if (spec.side === null) clearSide();
    if (spec.badge && !spec.kind) op.badge(spec.badge);
    if ('choices' in spec) op.choices(spec.choices, spec);
    if (spec.stepper && typeof spec.stepper === 'string') op.stepper(spec.stepper);
    if (spec.measurements) op.measurements(spec.measurements);
    if (spec.observe) op.observe(spec.observe);
    if (spec.returnItem && st.sort && st.sort.dragging) returnItem(st.sort.dragging);
    if (spec.kind) applySeat(false);
    if (spec.summary) return op.summary(spec.summary);
  }

  /* ------------------------------------------------------------------ *
   * Focus
   * ------------------------------------------------------------------ */

  function targets(ref) {
    if (!ref) return [];
    if (ref === 'polygon' || ref === 'polygon.vertices') return ref === 'polygon' ? [st.polyG] : (st.knobEls || st.vertEls || []);
    if (ref === 'polygon.sides') return st.edgeEls || [];
    if (ref === 'polygon.diagonals') return st.diagG ? [st.diagG] : [];
    if (ref.indexOf('polygon.vertex.') === 0) { var i = +ref.split('.')[2]; return knobOf(i) ? [knobOf(i)] : []; }
    if (ref === 'segment.endpoint') return st.segment && knobOf(st.segment[1]) ? [knobOf(st.segment[1])] : [];
    if (ref === 'diagonal.endpoints') {
      // while it is still the live segment, that; afterwards the last
      // diagonal drawn — which is what "this diagonal" means on the screen
      // that names it, and it used to resolve to nothing at all there.
      var dd = st.segment || ((st.diagonals || []).length ? st.diagonals[st.diagonals.length - 1] : null);
      return dd && knobOf(dd[0]) ? [knobOf(dd[0]), knobOf(dd[1])] : [];
    }
    if (ref === 'picked') return st.picked != null && knobOf(st.picked) ? [knobOf(st.picked)] : [];
    if (ref === 'grid') return st.cards || [];
    if (ref.indexOf('compare.') === 0) { var c = st.compare && st.compare[ref.split('.')[1]]; return c ? [c.g, c.pg] : []; }
    if (ref === 'sort.tray' || ref === 'sort.item') return st.sort ? st.sort.items : [];
    if (ref === 'builder.stepper') return st.stepPlus ? [st.stepPlus] : [];
    if (ref === 'summary') return st.summary ? Object.keys(st.summary.cards).map(function (k) { return st.summary.cards[k]; }) : [];
    if (ref === 'summary.card') return st.summary && st.summary.active ? [st.summary.cards[st.summary.active]] : [];
    return [];
  }

  /** A name tag goes with its card: faded and drained when the card is. */
  function dimTag(el, dim) {
    if (!el || !el.style) return;
    el.style.transition = 'opacity 320ms ease, filter 320ms ease';
    el.style.opacity = dim ? .42 : '';
    el.style.filter = dim ? 'saturate(.25) brightness(1.04)' : '';
  }

  function focus(ref, style) {
    var els = targets(ref);
    if (style === 'dim-others' && st.compare) {
      // The card not being talked about steps back — paler, drained of
      // colour — and the one that is comes forward with a soft glow, so the
      // eye has nowhere else to go. Remembered: Swiftee peeks from behind
      // the card in focus, not from behind the one that has stepped back.
      st.compareFocus = ref.split('.')[1];
      Object.keys(st.compare).forEach(function (k) {
        var c = st.compare[k]; var dim = 'compare.' + k !== ref;
        [c.g, c.pg].forEach(function (el) {
          el.style.opacity = dim ? .42 : 1;
          el.style.filter = dim ? 'saturate(.25) brightness(1.04)' : '';
          el.style.transition = 'opacity 320ms ease, filter 320ms ease';
        });
        // No glow on the one in focus: the card's face is translucent glass,
        // and a drop-shadow showed through it as a pale line inside the rim.
        // The other card stepping back is the whole cue.
        c.g.style.filter = dim ? 'saturate(.25) brightness(1.04)' : '';
        // AND ITS NAME TAG STEPS BACK WITH IT. "Convex" stayed full strength
        // under a card that had faded to grey, so the one bright thing on the
        // stepped-back side was a label for the card nobody was talking about.
        dimTag((st.badges || {})['compare.' + k], dim);
        dimTag(c.tag, dim);
      });
      return;
    }
    els.forEach(function (e) {
      if (!e) return;
      if (e.classList && e.classList.contains('vertex')) { e.setAttribute('opacity', 1); e.setAttribute('r', 15); }
      if (reduced() || !e.animate) return;
      // ONCE, SOFTLY. Three swells at a quarter over size was the loudest
      // thing on the screen at the very moment the child was being told what
      // to do; the thing named gives one small breath and settles, and the
      // hint ladder takes over if they need more.
      e.style.transformBox = 'fill-box'; e.style.transformOrigin = 'center';
      e.animate([{ scale: '1' }, { scale: '1.14' }, { scale: '1' }], { duration: 700, iterations: 1, easing: 'ease-in-out' });
    });
  }

  /**
   * Ring whatever `ref` names, in `color`, for a moment.
   *
   * This is the stage half of dual-coding.js: the term lights up in the
   * speech bubble in this colour at the same instant the thing it names
   * lights up here, and the shared hue is what binds the word to the
   * picture. It is deliberately a ring around the element rather than a
   * recolouring of it — the lesson's own highlighting (a picked vertex, an
   * outside diagonal in red) carries meaning that must not be overwritten
   * by a label cue.
   *
   * Drawn into `fx`, which is pointer-events: none, so a halo can never sit
   * between a child and the vertex they are reaching for.
   */
  /* ------------------------------------------------------------------ *
   * THE WORD, SHOWN ON THE BOARD.
   *
   * A highlighted word in the bubble is not decoration: at the moment it
   * appears, the thing it names answers it — briefly, in a warm light that
   * belongs to the orange of the word, and then back to the lesson's own
   * colours. "vertex" and the corners swell; "side" and the side brightens;
   * "diagonal" and the diagonals draw over themselves; "inside" and the
   * inside of the shape glows; "outside" and a band of light runs round the
   * outside of its outline.
   *
   * WHAT IT MUST NEVER DO IS ANSWER. A word lights what the sentence already
   * points at, or everything of its kind equally: "Which of these are
   * polygons?" lights every card at once, never the right ones; "convex" on
   * the sorting screen lights the Convex bin, never the convex shapes in the
   * tray. A word with nothing on the board to name — an action, a shape not
   * made yet — lights nothing.
   *
   * One mapping, here, keyed by the vocabulary's own ids (dual-coding.js
   * TERMS); nothing per screen. Short (300–600ms), one effect at a time, and
   * never while the child is dragging (a live drag keeps the board theirs).
   * ------------------------------------------------------------------ */
  var WARM = 'rgba(255, 150, 40, 0.85)';
  function warmPulse(els, o) {
    o = o || {};
    var n = 0;
    (els || []).filter(Boolean).slice(0, 12).forEach(function (e, i) {
      if (!e.animate) return;
      e.style.transformBox = 'fill-box'; e.style.transformOrigin = 'center';
      var knob = e.classList && e.classList.contains('knob');
      var peak = o.peak || (knob ? '1.5' : '1.045');
      try {
        e.animate([
          { scale: '1', filter: 'brightness(1) drop-shadow(0 0 0 rgba(255,150,40,0))' },
          { scale: peak, filter: 'brightness(1.12) drop-shadow(0 0 7px ' + WARM + ')', offset: 0.4 },
          { scale: '1', filter: 'brightness(1) drop-shadow(0 0 0 rgba(255,150,40,0))' }
        ], { duration: o.ms || 480, delay: (o.together ? 0 : i * 60) + (o.delay || 0), easing: 'cubic-bezier(.3,1.25,.45,1)' });
        n++;
      } catch (x) {}
    });
    return n;
  }
  /** The polygon's own outline, as a path to borrow the shape of. */
  function outlineOf() { return st.fill && st.fill.getAttribute && st.fill.getAttribute('d'); }
  /** Light a region for a moment: the inside of the shape, or a band round its outside. */
  function regionGlow(d, outside) {
    if (!d || !layers.fx) return 0;
    var g = mk('g', { 'class': 'concept-glow', 'pointer-events': 'none' }, layers.fx);
    var el;
    if (outside) {
      // a wide soft stroke on the outline, clipped to the OUTSIDE of the
      // shape (a board-sized rectangle with the shape cut out of it)
      var id = 'outside-clip-' + (++glowSeq);
      var defs = mk('defs', {}, g);
      var cp = mk('clipPath', { id: id }, defs);
      mk('path', { d: 'M-50 -50 H' + (W + 50) + ' V' + (H + 50) + ' H-50 Z ' + d, 'clip-rule': 'evenodd' }, cp);
      el = mk('path', { d: d, fill: 'none', stroke: '#fff4d6', 'stroke-width': 26, 'stroke-linejoin': 'round', 'clip-path': 'url(#' + id + ')' }, g);
    } else {
      el = mk('path', { d: d, fill: '#fff4d6', stroke: 'none' }, g);
    }
    el.setAttribute('opacity', 0);
    if (!el.animate) { g.remove(); return 0; }
    try {
      el.animate([{ opacity: 0 }, { opacity: outside ? 0.55 : 0.38, offset: 0.4 }, { opacity: 0 }], { duration: 620, easing: 'ease-in-out' })
        .finished.then(function () { g.remove(); }, function () { g.remove(); });
    } catch (e) { g.remove(); return 0; }
    return 1;
  }
  var glowSeq = 0;
  /** Which corners the sentence means: the one(s) the lesson has marked, else all. */
  function relevantKnobs() {
    var ks = st.knobEls || [];
    var marked = st.vcolor ? Object.keys(st.vcolor).map(Number).filter(function (i) { return ks[i]; }) : [];
    if (st.picked != null && ks[st.picked] && marked.indexOf(st.picked) < 0) marked.push(st.picked);
    var shown = marked.length ? marked.map(function (i) { return ks[i]; }) : ks;
    return shown.filter(function (k) { return k && k.getAttribute('opacity') !== '0'; });
  }
  function reflexCorners(v) {
    var A = Poly.interiorAngles(v), out = [];
    for (var i = 0; i < A.length; i++) if (A[i] > 180.5) out.push(i);
    return out;
  }
  /* THE SUMMARY'S WORDS NAME WHAT IS ON ITS CARD. "Vertex" swells the corner
     that lit, "sides" traces the sides that meet there, "angle" the wedge,
     "diagonals" the lines drawn across; "inside" and "outside" glow the
     shape; "equal" its marks; the kind of polygon, the card's own name. Only
     the card in the middle answers — the collected ones have had their say —
     except in the last line, where "polygon" is all of them. */
  function summaryWord(term, line) {
    void line;
    var S = st.summary; if (!S) return 0;
    var c = S.active ? S.cards[S.active] : null;
    if (!c) return term === 'polygon' ? warmPulse(S.collected.map(function (k) { return S.cards[k]._pop; }), { together: true, peak: '1.05' }) : 0;
    switch (term) {
      case 'polygon': return warmPulse([c._outline], { peak: '1.04' });
      case 'vertex': return c._knobs.length ? warmPulse(c._knobs, { peak: '1.5' }) : (c._mover ? warmPulse([c._mover], { peak: '1.5' }) : 0);
      case 'side': {
        var sl = c._sideLines || (c._line && c._lineKind === 'side' ? [c._line] : null) || c._near;
        if (sl && sl.length) return trace(sl);
        return c._ticks && c._ticks.length ? warmPulse(c._ticks, { peak: '1.5' }) : trace([c._outline]);
      }
      case 'angle':
        if (c._wedge) return warmPulse([c._wedge], { peak: '1.25' });
        return c._wedges && c._wedges.length ? warmPulse(c._wedges, { peak: '1.25' }) : 0;
      case 'diagonal': {
        var ds = (c._diags || []).concat(c._line && c._lineKind !== 'side' ? [c._line] : []);
        return ds.length ? trace(ds) : 0;
      }
      case 'inside': return regionGlow(pathOf(c._verts));
      case 'outside': return regionGlow(pathOf(c._verts), true);
      case 'equal': { var eq = (c._ticks || []).concat(c._wedges || []); return eq.length ? warmPulse(eq, { peak: '1.3' }) : 0; }
      case 'convex': case 'concave': case 'regular': case 'irregular':
        return c._id === term ? warmPulse([c._tag], { peak: '1.08' }) : 0;
      default: return 0;
    }
  }
  function emphasize(term, ctx) {
    if (!svg || reduced() || dragging()) return 0;
    var kind = st.kind, line = String((ctx && ctx.line) || '').toLowerCase();
    if (kind === 'summary') return summaryWord(term, line);
    switch (term) {
      case 'polygon':
        if (kind === 'grid') return warmPulse(st.cards, { together: true, peak: '1.03' });   // every card, never the right ones
        if (kind === 'compare') return warmPulse(Object.keys(st.compare || {}).map(function (k) { return st.compare[k].pg; }), { together: true });
        if (kind === 'sort') return warmPulse(st.sort && st.sort.items, { together: true, peak: '1.06' });
        if (kind === 'swipe-sort') return warmPulse(st.swipe && st.swipe.card ? [st.swipe.card] : [], { peak: '1.03' });
        return warmPulse([st.polyG]);
      case 'vertex': {
        // "another vertex", "a different vertex": the OTHER corners; "this
        // vertex", "the same vertex": the one the lesson has marked
        var mine = relevantKnobs(), all = (st.knobEls || []).filter(function (k) { return k && k.getAttribute('opacity') !== '0'; });
        if (/(another|different|other)s+vert/.test(line) && mine.length < all.length) {
          return warmPulse(all.filter(function (k) { return mine.indexOf(k) < 0; }));
        }
        return warmPulse(mine);
      }
      case 'side':
        if (st.segLine) return trace([st.segLine]);
        if (st.sideDotEls && st.sideDotEls.filter(Boolean).length) return warmPulse(st.sideDotEls, { peak: '1.6' });
        return st.fill ? trace([st.fill]) : 0;
      case 'line segment':
        return st.segLine ? trace([st.segLine]) : 0;
      case 'diagonal': {
        if (kind === 'compare') {
          // "this one" is the card in focus; otherwise both cards' diagonals
          var cards = Object.keys(st.compare || {}).filter(function (k) { return !st.compareFocus || /both/.test(line) || k === st.compareFocus; });
          var dl = [];
          cards.forEach(function (k) { var pg = st.compare[k].pg; if (pg) dl = dl.concat([].slice.call(pg.querySelectorAll('line'))); });
          return dl.length ? trace(dl) : 0;
        }
        // only the diagonals that are showing: the dent screen hides the ones
        // that stayed inside, and a word must not flash them back
        var shown = st.diagG ? [].slice.call(st.diagG.childNodes).filter(function (g) { return g.style.display !== 'none'; }) : [];
        return shown.length ? trace(shown) : 0;
      }
      case 'angle': {
        var wedges = st.measG ? [].slice.call(st.measG.querySelectorAll('[data-angle]')) : [];
        return wedges.length ? warmPulse(wedges, { peak: '1.15' }) : warmPulse(relevantKnobs());
      }
      case 'inside':
        if (kind === 'compare') { var f1 = st.compareFocus ? st.compare[st.compareFocus] : null; return f1 ? regionGlow(pathOf(f1.verts)) : 0; }
        return regionGlow(outlineOf());
      case 'outside':
        if (kind === 'compare') { var f2 = st.compareFocus ? st.compare[st.compareFocus] : null; return f2 ? regionGlow(pathOf(f2.verts), true) : 0; }
        return regionGlow(outlineOf(), true);
      case 'equal': {
        var ticks = st.measG ? [].slice.call(st.measG.querySelectorAll('.eq-tick')) : [];
        return ticks.length ? warmPulse(ticks, { peak: '1.3' }) : 0;
      }
      case 'convex':
      case 'concave': {
        var want = term === 'concave';
        var isIt = function (v) { var c = Poly.classify(v); return want ? c.concave : c.convex; };
        if (kind === 'sort') {                                  // the bin that is named, never the answers
          return warmPulse((st.sort ? st.sort.bins : []).filter(function (b) { return b._bin && b._bin.id === term; }), { peak: '1.03' });
        }
        if (kind === 'compare') {
          var hit = Object.keys(st.compare || {}).map(function (k) { return st.compare[k]; }).filter(function (c) { return isIt(c.verts); });
          return warmPulse(hit.map(function (c) { return c.pg; }).concat(hit.map(function (c) { return (st.badges || {})['compare.' + (st.compare.left === c ? 'left' : 'right')]; })));
        }
        if ((kind === 'polygon' || kind === 'builder') && st.verts && st.verts.length >= 3 && isIt(st.verts)) {
          if (want) {
            // the corner that caves in first, then the whole shape
            var bent = reflexCorners(st.verts).map(knobOf).filter(Boolean);
            var n0 = warmPulse(bent, { peak: '1.6' });
            later(n0 ? 260 : 0, function () { warmPulse([st.polyG]); });
            return 1;
          }
          return warmPulse([st.polyG]);
        }
        return 0;                                              // not made yet: nothing to name
      }
      case 'regular':
      case 'irregular': {
        var reg = term === 'regular';
        if (kind === 'compare') {
          var cs = Object.keys(st.compare || {}).map(function (k) { return st.compare[k]; }).filter(function (c) { return !!Poly.isRegular(c.verts) === reg; });
          return warmPulse(cs.map(function (c) { return c.pg; }).concat(cs.map(function (c) { return c.tag; })));
        }
        // the evidence: the equal marks, or the readings that differ
        var ev = st.measG ? [].slice.call(st.measG.querySelectorAll(reg ? '.eq-tick,[data-angle]' : '.meas,[data-angle]')) : [];
        return ev.length ? warmPulse(ev, { peak: '1.12' }) : 0;
      }
      default:
        return 0;                                               // an action word: lettering only
    }
  }
  /** A finger is on the glass moving something: the board is the child's. */
  var pressed = false;
  function dragging() { return pressed; }

  function halo(ref, color, mode) {
    void color;   // the theme decides every colour on the stage; kept for the API
    if (!svg || reduced()) return 0;
    var els = targets(ref).filter(Boolean);
    if (!els.length) return 0;
    // A ring is the right mark for a thing with an area — a vertex, the whole
    // shape. It is the wrong mark for a set of lines: the bounding box of a
    // pentagon's diagonals is the pentagon, so the ring says "the shape"
    // exactly when the word said "the diagonals". Trace the strokes instead.
    if (mode === 'none') return 0;
    if (mode === 'trace') return trace(els, color);
    /* 'pop': THE THING ITSELF ANSWERS THE WORD.
     *
     * reveal() lets the words of a line arrive one at a time and fires this
     * on the word that names something — so this is the one moment in the
     * game where a cue can be exactly in time with the voice. A ring drawn
     * round the shape was refused, and rightly: it is a second object. The
     * shape swells a little and settles instead, on the syllable, which is
     * the same signal with nothing added to the picture. */
    if (mode === 'pop') {
      var popped = 0;
      els.slice(0, 10).forEach(function (e, i) {
        if (!e.animate) return;
        e.style.transformBox = 'fill-box'; e.style.transformOrigin = 'center';
        try {
          e.animate([{ scale: '1' }, { scale: e.classList && e.classList.contains('knob') ? '1.55' : '1.05' }, { scale: '1' }],
                    { duration: 460, delay: i * 55, easing: 'cubic-bezier(.3,1.3,.4,1)' });
          popped++;
        } catch (x) {}
      });
      return popped;
    }
    var drawn = 0;
    els.slice(0, 12).forEach(function (e, i) {
      // A KNOB SWELLS, IT IS NOT RINGED: a ring round a corner read as a
      // second circle on the shape. The knob itself grows and settles.
      if (e.classList && e.classList.contains('knob')) {
        if (e.animate) {
          e.style.transformBox = 'fill-box'; e.style.transformOrigin = 'center';
          e.animate([{ scale: '1' }, { scale: '1.9', offset: 0.35 }, { scale: '1' }],
                    { duration: 900, delay: i * 70, easing: 'cubic-bezier(.3,1.2,.4,1)' });
        }
        drawn++;
        return;
      }
      // NO RING ROUND A SHAPE OR A CARD. A rounded frame used to pop around
      // the polygon's box when a word for the whole shape was said, and it
      // read as a second card drawn over the first. A word for the whole
      // shape leaves the picture as it is; the knobs above are the only
      // thing that moves for a term.
    });
    return drawn;
  }

  /**
   * Re-draw the geometry of `els` in `color`, over the top, then fade it.
   *
   * A copy rather than a recolour, because the lesson's own strokes carry
   * meaning — a diagonal is red precisely when it has fallen outside the
   * shape, and a label cue must not overwrite that for a second and a half.
   * Every layer shares the svg's user space, so a clone needs no transform.
   */
  function trace(els, color) {
    var lines = [];
    els.forEach(function (e) {
      if (!e) return;
      if (e.tagName === 'line' || e.tagName === 'path') { lines.push(e); return; }
      var kids = e.querySelectorAll ? e.querySelectorAll('line,path') : [];
      for (var i = 0; i < kids.length; i++) lines.push(kids[i]);
    });
    if (!lines.length) return 0;
    var drawn = 0;
    lines.slice(0, 24).forEach(function (src, i) {
      var copy;
      try { copy = src.cloneNode(false); } catch (e) { return; }
      // renderPoly() sets the dash pattern as an inline *style* while a
      // diagonal draws itself in, and style beats attribute — leaving the
      // clone dashed, with the white original showing through the gaps, so
      // the cue arrived as a washed-out beige instead of the term's colour.
      // The trace wants to be one solid stroke, so drop the style outright.
      copy.removeAttribute('style');
      copy.setAttribute('class', 'dc-trace');
      // frost over the blue, whatever the word's ink (see halo())
      void color;
      copy.setAttribute('stroke', '#f2fdff');
      copy.setAttribute('stroke-width', 9);
      copy.setAttribute('stroke-linecap', 'round');
      copy.setAttribute('fill', 'none');
      copy.removeAttribute('stroke-dasharray');
      copy.setAttribute('opacity', 0);
      layers.fx.appendChild(copy);
      drawn++;
      if (!copy.animate) { copy.remove(); return; }
      var a = copy.animate(
        [{ opacity: 0 }, { opacity: 0.9, offset: 0.25 }, { opacity: 0.9, offset: 0.6 }, { opacity: 0 }],
        { duration: 1500, delay: i * 55, easing: 'ease-out', fill: 'forwards' }
      );
      a.finished.then(function () { copy.remove(); }, function () { copy.remove(); });
    });
    return drawn;
  }

  function element(ref) {
    if (ref === 'answer' || ref === 'option' || ref === 'item') return st.lastEl || st.polyG || svg;
    if (ref === 'vertex') return st.lastEl || svg;
    if (ref === 'side' || ref === 'angle' || ref === 'diagonal') return st.lastEl || st.polyG || svg;
    if (ref === 'stage') return svg;
    var t = targets(ref); return t[0] || st.polyG || svg;
  }

  /* ------------------------------------------------------------------ *
   * Interactions
   * ------------------------------------------------------------------ */

  function nearestVertex(p, exclude) {
    var best = -1, bd = Infinity;
    st.verts.forEach(function (v, i) { if (i === exclude) return; var d = Math.hypot(v.x - p.x, v.y - p.y); if (d < bd) { bd = d; best = i; } });
    // 76, not 60: a seven-year-old's finger covers the corner it is aiming
    // at, and the difference between "nearly there" and "nothing happened"
    // was sixteen pixels on a shape whose corners are a hundred apart.
    return bd < 76 ? best : -1;
  }

  /**
   * THE LINE LANDED ON NOTHING — say so, and show where it may go.
   *
   * Letting go in the middle of the shape used to do nothing at all: the
   * ghost vanished, the line went home and the child was told neither that
   * they had missed nor what they were aiming at. Silence is the one answer
   * a lesson may never give. The corners that would have taken the line
   * breathe for a moment, and he says where it goes.
   */
  function missedCorner(targets, said) {
    var els = (targets || []).map(function (i) { return knobOf(i); }).filter(Boolean);
    els.forEach(function (e) { e.setAttribute('opacity', 1); });
    var stop = pulseHint(els);
    later(1800, stop);
    juice('refuse', st.polyG);
    onTap('wrong', said || { t: 'Drop it on a corner!', vo: 'fb15' });
  }

  /**
   * Drag one or more vertices. Pointerdown is delegated to the polygon group
   * and matched by data-i, so it survives any re-render; move/up listen on
   * the SVG so they keep firing wherever the pointer goes.
   */
  function dragVertices(idxs, moveFn, upFn, ctx) {
    var active = -1;
    idxs.forEach(function (i) {
      var h = st.vertEls[i]; if (h) { h.style.cursor = 'grab'; h.style.pointerEvents = 'all'; }
      var k = knobOf(i); if (k) k.setAttribute('opacity', 1);
    });
    function down(e) {
      var t = e.target; if (!t || !t.classList || !t.classList.contains('vertex')) return;
      var i = +t.getAttribute('data-i'); if (idxs.indexOf(i) < 0) return;
      if (global.Input && Input.guarded) return;
      active = i; try { svg.setPointerCapture && svg.setPointerCapture(e.pointerId); } catch (x) {}
      e.preventDefault();
    }
    function move(e) { if (active < 0) return; moveFn(pt(e), active); }
    function up(e) { if (active < 0) return; var i = active; active = -1; upFn(pt(e), i); }
    on(st.polyG, 'pointerdown', down); on(svg, 'pointermove', move); on(svg, 'pointerup', up); on(svg, 'pointercancel', up);
    if (ctx && ctx.onCancel) ctx.onCancel(endInteraction);
  }

  /**
   * HOW DEEP THE DENT IS — as a fraction of the shape's own radius.
   *
   * The distance of vertex i inside the line between its two neighbours,
   * positive once it has crossed toward the middle. A polygon becomes
   * concave the instant its vertex crosses that line, and at that instant
   * it still looks convex with a knob sitting on a flat edge — which is
   * what a live "Concave" badge over an apparently flat top was reporting.
   * So the concave activities ask for a depth, not a crossing.
   *
   * Measured against the mean radius, NOT against the neighbours' chord.
   * Against the chord the same-looking notch scores differently on every
   * shape — a pentagon's vertex sits 0.69 radii inside its neighbours'
   * chord and a hexagon's only 0.5 — so one threshold was unreachable on
   * the pentagon and far too easy on the hexagon. A fraction of the radius
   * is a depth in pixels on the screen, which is the thing being judged.
   */
  function dentDepth(v, i) {
    var n = v.length, a = v[(i + n - 1) % n], b = v[(i + 1) % n], p = v[i];
    var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    var c = Poly.centroid(v);
    var side = (dx * (c.y - a.y) - dy * (c.x - a.x)) >= 0 ? 1 : -1;
    var d = (dx * (p.y - a.y) - dy * (p.x - a.x)) / len;
    var R = 0;
    for (var k = 0; k < n; k++) R += Math.hypot(v[k].x - c.x, v[k].y - c.y);
    R = (R / n) || 1;
    return d * side / R;
  }
  // HOW DEEP BEFORE IT COUNTS. Fifteen percent of the shape's radius — on a
  // card-sized polygon a notch of about twenty-five pixels, which nobody
  // can mistake for a straight edge. The answer and the live badge both
  // wait for it, so the word and the picture always agree.
  var DENT_MIN = 0.15;

  var INTERACT = {

    /**
     * Wait for the child to say they are ready.
     *
     * Named for the gesture it used to be; it is the Next button now, and
     * screens.js did not have to change for that. Only Input.advance()
     * resolves it, and only the Next button calls Input.advance().
     */
    'tap-anywhere': function (spec, ctx) {
      // THE WHOLE STAGE IS THE BUTTON HERE, so the whole stage shows a hand.
      // Every other interaction in this file marks its own targets and the
      // cursor follows; this one has no target to mark, and was the only
      // place in the lesson where something was pressable and looked inert.
      var wide = [svg, svg.parentNode].filter(Boolean);
      wide.forEach(function (n) { if (n.style) n.style.cursor = 'pointer'; });
      cleanup.push(function () {
        wide.forEach(function (n) { if (n.style) n.style.cursor = ''; });
      });
      return new Promise(function (resolve) {
        if (!global.Input) { on(svg, 'pointerdown', function () { resolve({ result: 'tap' }); }); return; }
        Input.mode('dialogue');
        var fn = function () { Input.off('advance', fn); endInteraction(); resolve({ result: 'tap' }); };
        Input.on('advance', fn);
        cleanup.push(function () { Input.off('advance', fn); });
        if (ctx && ctx.onCancel) ctx.onCancel(function () { Input.off('advance', fn); });
      });
    },

    'vertex-pick': function (spec, ctx) {
      return new Promise(function (resolve) {
        if (global.Input) Input.mode('polygon');
        st.showVerts = true; st.touchVerts = true; renderPoly();
        setConnect('SELECT_VERTEX');
        // all of them: any corner is a vertex, and breathing one would have
        // been an answer rather than an invitation
        // every corner is right, so the hand may tap one: the lowest on the
        // right, where the glove lies outside the shape rather than over it.
        // ON THE FIRST IDLE HINT, not the last: tapping is the move, and a
        // child who has not tapped yet is shown it.
        var pickHand = function (strong) {
          var v = st.verts || [], best = null;
          v.forEach(function (p) { if (!best || p.x + p.y > best.x + best.y) best = p; });
          return both(pulseHint((st.knobEls || []).slice(), strong ? { strong: true } : null), tapHand(best));
        };
        hintLadder({
          pulse: function () { return pickHand(false); },
          demo: function () { return pickHand(true); }
        });
        st.vertEls.forEach(function (c, i) {
          c.style.cursor = 'pointer';
          on(c, 'pointerdown', function (e) {
            e.preventDefault();
            evt('vertex:selected', { vertex: i });
            st.picked = i; st.lastEl = knobOf(i) || c; st.vcolor = {}; st.vcolor[i] = HI.fill; st.showVerts = false; renderPoly();
            setConnect('VERTEX_SELECTED', { from: i });
            endInteraction(); resolve({ result: 'correct', vertex: i });
          });
        });
        if (ctx && ctx.onCancel) ctx.onCancel(endInteraction);
      });
    },

    'draw-diagonal': function (spec, ctx) { return drawDiagonals(spec, 1, ctx); },
    'draw-diagonals': function (spec, ctx) { return drawDiagonals(spec, spec.count || 1, ctx); },

    'drag-vertex': function (spec, ctx) {
      return new Promise(function (resolve) {
        if (global.Input) Input.mode('polygon');
        // Every vertex may be taken: dress them all as handles, now that
        // they are. A single named vertex keeps its own highlight instead.
        if (spec.vertex === 'any') { st.showVerts = true; st.touchVerts = true; }
        renderPoly();
        var idxs = spec.vertex === 'any' ? st.verts.map(function (_, i) { return i; }) : [spec.vertex];
        var start = null, done = false, held = -1, grabAt = null;
        if (spec.live === 'diagonals') st.highlightOutside = true;
        // the gesture: from the vertex, inward toward the middle to make a
        // dent, or out along its own line to stretch the shape
        var ghostOf = function () {
          if (done) return null;
          var gi = idxs[0], gv = st.verts[gi], gc = Poly.centroid(st.verts);
          var glen = Math.hypot(gc.x - gv.x, gc.y - gv.y) || 1;
          // THE GHOST SHOWS THE WHOLE MOVE. A fixed 78px hop was shorter than
          // the drag the screen accepts — it taught a gesture that fails —
          // so the dent ghost goes most of the way to the middle, which is
          // what making a notch actually takes.
          var to = spec.until === 'concave'
            ? { x: gv.x + (gc.x - gv.x) * 0.9, y: gv.y + (gc.y - gv.y) * 0.9 }
            : { x: gv.x - (gc.x - gv.x) / glen * 78 * 0.55, y: gv.y - (gc.y - gv.y) / glen * 78 * 0.55 };
          return gestureGhost(gv, to, { r: 11 });
        };
        hintLadder({
          pulse: function () { return done ? null : pulseHint(idxs.map(knobOf)); },
          demo: ghostOf
        });
        // WHAT THE DRAG IS ASKED TO MAKE, judged from the shape as it stands
        var judge = function (i) {
          var np = st.verts[i];
          return spec.until === 'concave' ? (Poly.classify(st.verts).concave && dentDepth(st.verts, i) >= DENT_MIN)
               : spec.until === 'irregular' ? (!Poly.isRegular(st.verts) && !!start && Math.hypot(np.x - start.x, np.y - start.y) >= (spec.minMove || 0))
               : false;
        };
        // a single named vertex wears its knob from the start; when any may
        // be taken they all show as handles and the one in hand lights on touch
        if (spec.vertex !== 'any') {
          idxs.forEach(function (i) { st.vcolor = st.vcolor || {}; if (!st.vcolor[i]) st.vcolor[i] = HI.fill; });
          renderPoly();
        }
        dragVertices(idxs, function (p, i) {
            if (done) return;
            if (held !== i) {
              // TAKEN. Where this drag began, for the verdict on release, and
              // the point in hand lit, so the child sees which one they hold.
              held = i; grabAt = { x: st.verts[i].x, y: st.verts[i].y };
              if (!start) start = grabAt;
              st.vcolor = st.vcolor || {}; st.vcolor[i] = HI.fill;
              var hk = knobOf(i);
              if (hk) { hk.setAttribute('fill', HI.fill); hk.setAttribute('stroke', shade(HI.fill, -0.45)); hk.setAttribute('stroke-width', 3); hk.setAttribute('r', 10); }
            }
            /* AND IT STAYS ON THE CARD.
             *
             * clampSimple only stops the outline crossing itself; nothing
             * stopped the corner leaving the ice altogether, so a child could
             * drag a vertex out onto the snow and the shape they were being
             * taught about was half off the thing it was drawn on. The glass
             * is the boundary, with room left for the knob and its ring. */
            var np = Poly.clampSimple(st.verts, i, clampToCard(p));
            st.verts[i] = np;
            updatePoly();
            if (spec.live === 'badge' && st.liveBadge) {
              // the readout flips when the dent is one a child can SEE — the
              // same depth the answer is judged by. A shape concave by a hair
              // that still reads convex must not be called concave.
              var cc = Poly.classify(st.verts).concave && dentDepth(st.verts, i) >= DENT_MIN;
              st.liveBadge._text.textContent = cc ? 'Concave' : 'Convex';
              if (st.liveBadge._retint) st.liveBadge._retint(cc ? 'concave' : 'convex');
            }
          }, function (p, i) {
            // JUDGED ON RELEASE. The vertex stays where the finger let go.
            // If the shape has become what was asked, that is the answer;
            // if not, he says so, the knob shakes, and the child tries again
            // from where they left it. A touch that hardly moved is not a
            // try and gets no verdict.
            if (done) return;
            var from = grabAt || st.verts[i]; held = -1; grabAt = null;
            evt('vertex:dragged', { vertex: i });
            if (judge(i)) {
              done = true; st.lastEl = st.polyG; endInteraction();
              // the vertex they moved keeps its knob: the dent IS a vertex
              st.vcolor = {}; st.vcolor[i] = HI.fill;
              // the dent is made: the diagonals that stayed inside step back,
              // and the one that went outside is the whole picture
              if (spec.live === 'diagonals') st.onlyOutside = true;
              // KEPT: the shape the child made, so a later card that shows
              // "a concave pentagon" or "an irregular pentagon" can show theirs
              if (spec.until) rememberMade(spec.until, st.verts, i);
              renderPoly(); resolve({ result: 'correct', vertex: i });
              return;
            }
            var moved = Math.hypot(st.verts[i].x - from.x, st.verts[i].y - from.y);
            if (moved < 6) return;
            st.lastEl = knobOf(i) || st.polyG;
            juice('refuse', knobOf(i) || st.polyG);
            // HEARD, as every other wrong answer is (the dent drags had no sound)
            sfx('wrong');
            // a dent too shallow to see gets the reason, not a bare "no"
            onTap('wrong', spec.until === 'concave' ? { t: 'Pull it in more!', vo: 'fb11' } : null);
          }, ctx);
      });
    },

    choice: function (spec, ctx) {
      return new Promise(function (resolve) {
        if (global.Input) Input.mode('polygon');
        // Both answers breathe when the child has been still a while — never
        // the right one alone, which would be the answer given away.
        hintLadder({
          pulse: function () { return pulseHint((st.choiceEls || []).slice()); },
          demo: function () { return pulseHint((st.choiceEls || []).slice(), { strong: true }); }
        });
        (st.choiceEls || []).forEach(function (b) {
          // THE HAND COMES BACK FOR A RETRY. endInteraction() strips every
          // cursor when an answer lands; the retry input arms the same
          // buttons again, and they must look live again — a child reads a
          // button with no hand and no change as a button that is finished.
          b.style.cursor = 'pointer';
          on(b, 'pointerdown', function (e) {
            e.preventDefault(); st.lastEl = b;
            var ok = b.getAttribute('data-label') === spec.correct;
            evt('answer:selected', { label: b.getAttribute('data-label'), correct: ok });
            if (ok && global.Juice && Juice.sparkle && !reduced()) { try { Juice.sparkle(b); } catch (x) {} }
            // _retint, not firstChild: a pill draws its LIP first, so setting
            // a fill on the first child recoloured the three-pixel shadow
            // under the button and left the face it sits on untouched.
            if (ok && b._retint) b._retint('uiSuccess');
            if (!ok && b._retint) {
              // the wrong one flushes red for a moment and comes back, so
              // the child sees which they pressed and that it is still there
              b._retint('uiDanger');
              later(650, function () { if (b._retint) b._retint('uiPrimary'); });
            }
            endInteraction(); resolve({ result: ok ? 'correct' : 'wrong', label: b.getAttribute('data-label') });
          });
        });
        if (ctx && ctx.onCancel) ctx.onCancel(endInteraction);
      });
    },

    /**
     * Swipe a shape left for Regular or right for Irregular.
     *
     * ONE SUBMISSION PATH. The swipe, a tap on a zone and the arrow keys all
     * end in classify(), so there is exactly one place where an answer is
     * judged, one place that locks input and one place that advances the
     * round. Three parallel copies of that logic is how a fast double-swipe
     * ends up skipping a question or finishing the practice twice.
     *
     * JUDGED FROM THE SHAPE, NOT FROM A TABLE. Poly.isRegular runs on the
     * card's own vertices, so the answer cannot drift from the drawing —
     * redraw a shape and the answer follows it. Colour means nothing here.
     *
     * A WRONG ANSWER KEEPS THE SAME CARD. It nudges toward the side that was
     * chosen, the zone says "not quite", and the card springs back. Nothing
     * is removed, nothing is revealed, and the child tries again — which is
     * the only way a classification practice teaches rather than tests.
     */
    swipe: function (spec, ctx) {
      return new Promise(function (resolve) {
        if (global.Input) Input.mode('polygon');
        var sw = st.swipe;
        if (!sw || !sw.card) { resolve({ result: 'correct' }); return; }

        var W_CARD = SWIPE_HALF * 2;
        var THRESHOLD = W_CARD * 0.2;
        var resolving = false, dragging = false, demo = null;
        var startX = 0, startY = 0, dx = 0, pid = null;

        function place(card, x, rot, scale) {
          card.setAttribute('transform',
            'translate(' + (SWIPE_HOME.x + x) + ',' + SWIPE_HOME.y + ') rotate(' + rot.toFixed(2) + ')' +
            (scale ? ' scale(' + scale + ')' : ''));
        }

        /* A card's journey, stepped on its own transform attribute (so it
           turns and scales about its own middle), eased out, with an optional
           lift at the middle of the path. Reduced motion lands it at once. */
        function flyCard(card, a, b, ms, lift, then) {
          var set = function (p) {
            card.setAttribute('transform', 'translate(' + p.x.toFixed(2) + ',' + p.y.toFixed(2) + ') rotate(' + p.rot.toFixed(2) + ')' + (Math.abs(p.s - 1) > 1e-3 ? ' scale(' + p.s.toFixed(4) + ')' : ''));
          };
          if (reduced() || !global.requestAnimationFrame) { set(b); if (then) then(); return; }
          var t0 = null;
          var step = function (now) {
            if (!card.parentNode) { if (then) then(); return; }
            if (t0 == null) t0 = now;
            var k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
            set({ x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e - (lift || 0) * 4 * e * (1 - e),
                  rot: a.rot + (b.rot - a.rot) * e, s: a.s + (b.s - a.s) * e });
            if (k < 1) global.requestAnimationFrame(step);
            else if (then) then();
          };
          global.requestAnimationFrame(step);
        }

        function sideOf(x) { return x < -THRESHOLD ? 'regular' : x > THRESHOLD ? 'irregular' : null; }
        // the tilt the card is drawn at for a given pull, the same in the
        // drag and in the flight that follows it
        function tiltOf(x) { return Math.max(-1, Math.min(1, x / (THRESHOLD * 2.2))) * 6; }

        /* ---- the one submission path ---- */
        function classify(answer) {
          if (resolving || !answer || !sw.card) return;
          stopDemo();
          evt('answer:selected', { item: sw.card._name, zone: answer });
          resolving = true;
          var card = sw.card;
          st.lastEl = card;
          var right = Poly.isRegular(card._verts) ? 'regular' : 'irregular';
          var ok = answer === right;
          var dir = answer === 'regular' ? -1 : 1;

          if (ok) {
            var zone = sw.zones[answer];
            sfx('correct');
            Object.keys(sw.zones).forEach(function (k) { if (sw.zones[k].classList) sw.zones[k].classList.remove('hint'); });
            if (zone && zone.classList) {
              // the zone that caught it lights up for a moment
              zone.classList.remove('landed'); void zone.getBBox && zone.getBBox();
              zone.classList.add('landed');
              later(700, function () { zone.classList.remove('landed'); });
            }
            juice('pop', card);
            if (zone && !reduced() && zone.animate) {
              zone.animate([{ scale: '1' }, { scale: '1.07' }, { scale: '1' }],
                           { duration: 320, easing: 'cubic-bezier(.3,1.3,.5,1)' });
            }
            leanZone(null, false);
            // THE SHAPE IS COLLECTED, NOT DISCARDED.
            //
            // It used to shrink and fade out, which is tidy and tells the
            // child nothing: five rounds went by and the two zones stayed as
            // empty as they started. The card travels into the zone it earned
            // and STAYS there, small, in a row — so the piles fill up as the
            // practice goes on and the progress is the thing on the screen
            // rather than a number somewhere else.
            //
            // It keeps its own drawing, so what is sitting in the Regular pile
            // is visibly the pentagon that was just judged.
            // THE CARD IS PLACED ON THE ZONE. It flies from where the child
            // let go, in a low arc, to the very seat on the shelf it will
            // keep — shrinking to the pile's size on the way and straightening
            // as it lands — and is swapped for the kept drawing there, at the
            // same size, so nothing vanishes and nothing appears. It used to
            // be flung out past the zone, shrink to nothing and fade while a
            // copy popped up on the shelf: two events where the child made one.
            /* ONE FLIGHT, FROM THE HAND TO THE SEAT. It was a CSS animation of
               translate, rotate and scale on an SVG group — and an SVG group
               turns and shrinks about the corner of the stage, not about
               itself, so the card jumped as it set off; and it shrank to
               seat/96 of its size when the card is 152 across, so it landed
               half again too big and then snapped down. It is stepped on the
               card's own transform now, which turns and scales it about its
               own middle: from exactly where the child let go, along a low
               arc, straight into the seat on the shelf it keeps, at exactly
               the size of the card that is left there. Nothing bounces. */
            var pulled = dx, tilt = tiltOf(dx);
            var seat = zone ? shelfSeats(zone, zone._kept.length + 1)[zone._kept.length] : null;
            var tx = seat ? seat.x : SWIPE_HOME.x, ty = seat ? seat.y : SWIPE_HOME.y;
            var k = seat ? seat.half / SWIPE_HALF : 0.4;
            var after = function () {
              card.style.pointerEvents = 'none';
              if (card.parentNode) card.parentNode.removeChild(card);
              keepInZone(zone, card._name);
              sw.card = null;
              sw.i++;
              if (sw.i >= sw.items.length) { hold(260).then(function () { done(); }); return; }
              // a beat to understand what happened, then the next question
              hold(300).then(function () {
                if (!st.swipe) return;
                dealCard();
                arm();
                resolving = false;
                // the next card is on the table (game.js brings him back up behind it)
                later(420, function () { if (st.swipe && sw.card && !dragging) evt('swipe:home', { i: sw.i }); });
              });
            };
            flyCard(card, { x: SWIPE_HOME.x + pulled, y: SWIPE_HOME.y, rot: tilt, s: 1 }, { x: tx, y: ty, rot: 0, s: k }, 560, 46, after);
            if (ctx && ctx.onCorrect) ctx.onCorrect();
          } else {
            sfx('wrong');
            juice('refuse', card);
            // the marks go on the card and he names what they show
            var why = whyShape(card);
            onTap('wrong',
              why === 'regular' ? { t: 'Every side AND every angle matches \u2014 regular!', vo: 'fb12' } :
              why === 'sides'   ? { t: 'Look \u2014 the sides are different lengths.', vo: 'fb13' } :
              why === 'angles'  ? { t: 'Equal sides, but look at the corners!', vo: 'fb14' } : null);
            var z = sw.zones[answer];
            if (z && !reduced() && z.animate) {
              z.animate([{ translate: '0 0' }, { translate: '-6px 0' }, { translate: '6px 0' }, { translate: '0 0' }],
                        { duration: 260, easing: 'ease-in-out' });
            }
            if (ctx && ctx.onWrong) ctx.onWrong();
            // NOT A SWING AND A SPRING: it glides back to the middle, where the
            // marks on it say why (whyShape), and waits for another try
            var pulledBack = dx, tiltBack = tiltOf(dx);
            void dir;
            var reset2 = function () {
              dx = 0; place(card, 0, 0);
              leanZone(null, false);
              resolving = false;
              evt('swipe:home', { i: sw.i });
            };
            flyCard(card, { x: SWIPE_HOME.x + pulledBack, y: SWIPE_HOME.y, rot: tiltBack, s: 1 }, { x: SWIPE_HOME.x, y: SWIPE_HOME.y, rot: 0, s: 1 }, 260, 0, reset2);
          }
        }

        /* ---- the demonstration: the hint ladder's top rung ---- */
        function runDemo() {
          if (reduced() || !sw.card || !sw.card.animate) return null;
          // A GHOST SHOWS THE MOVE. The card itself stays where the child will
          // take hold of it; a translucent copy slides out along the left arc
          // and fades, then along the right, until they do.
          stopDemo();
          var ghost = sw.card.cloneNode(true);
          ghost.setAttribute('class', 'swipe-ghost');
          ghost.style.pointerEvents = 'none';
          ghost.style.opacity = '0.45';
          sw.card.parentNode.insertBefore(ghost, sw.card);
          sw.ghost = ghost;
          demo = ghost.animate([
            { translate: '0 0', rotate: '0deg', opacity: 0.45, offset: 0 },
            { translate: '-150px -62px', rotate: '-12deg', opacity: 0, offset: 0.36 },
            { translate: '0 0', rotate: '0deg', opacity: 0, offset: 0.40 },
            { translate: '0 0', rotate: '0deg', opacity: 0.45, offset: 0.52 },
            { translate: '150px -62px', rotate: '12deg', opacity: 0, offset: 0.88 },
            { translate: '0 0', rotate: '0deg', opacity: 0, offset: 1 }
          ], { duration: 3400, iterations: 1, easing: 'ease-in-out' });
          // the hand holds the card's middle and swipes it, left and then right
          var hd = handAt(layers.fx, SWIPE_HOME.x, SWIPE_HOME.y);
          if (hd && hd.g.animate) {
            sw.demoHand = hd.g;
            try {
              sw.demoHandAnim = hd.g.animate([
                { translate: '24px 30px', opacity: 0, offset: 0 },
                { translate: '0px 0px', opacity: 1, offset: 0.06 },
                { translate: '-150px -62px', opacity: 1, offset: 0.33 },
                { translate: '-150px -62px', opacity: 0, offset: 0.37 },
                { translate: '0px 0px', opacity: 0, offset: 0.42 },
                { translate: '0px 0px', opacity: 1, offset: 0.5 },
                { translate: '150px -62px', opacity: 1, offset: 0.85 },
                { translate: '150px -62px', opacity: 0, offset: 0.9 },
                { translate: '150px -62px', opacity: 0, offset: 1 }
              ], { duration: 3400, easing: 'ease-in-out', fill: 'forwards' });
              hd.img.animate([{ scale: '1' }, { scale: '.92', offset: 0.06 }, { scale: '.92', offset: 0.9 }, { scale: '1' }], { duration: 3400 });
            } catch (e) {}
          }
          if (demo && demo.finished) demo.finished.then(stopDemo, function () {});
          return stopDemo;
        }
        function stopDemo() {
          if (demo) { try { demo.cancel(); } catch (e) {} demo = null; }
          if (sw.ghost) { try { sw.ghost.remove(); } catch (e) {} sw.ghost = null; }
          if (sw.demoHandAnim) { try { sw.demoHandAnim.cancel(); } catch (e) {} sw.demoHandAnim = null; }
          if (sw.demoHand) { try { sw.demoHand.remove(); } catch (e) {} sw.demoHand = null; }
        }

        /* ---- pointer, the only input path that needs geometry ---- */
        function onDown(e) {
          if (resolving || !sw.card) return;
          stopDemo();
          dragging = true; pid = e.pointerId;
          startX = e.clientX; startY = e.clientY; dx = 0;
          sw.card.style.cursor = 'grabbing';
          try { if (e.target.setPointerCapture) e.target.setPointerCapture(pid); } catch (err) {}
          e.preventDefault();
        }
        function onMove(e) {
          if (!dragging || resolving || !sw.card) return;
          var m = svg.getScreenCTM();
          var scale = m ? m.a : 1;
          dx = (e.clientX - startX) / (scale || 1);
          // the card is on rails: this is a left-or-right question, not a
          // free drag, so vertical travel is ignored entirely
          var t = Math.max(-1, Math.min(1, dx / (THRESHOLD * 2.2)));
          place(sw.card, dx, t * 6);
          leanZone(sideOf(dx), !!sideOf(dx));
          e.preventDefault();
        }
        function onUp(e) {
          if (!dragging) return;
          dragging = false;
          if (sw.card) sw.card.style.cursor = 'grab';
          try { if (e.target.releasePointerCapture && pid != null) e.target.releasePointerCapture(pid); } catch (err) {}
          var side = sideOf(dx);
          if (side) { classify(side); return; }
          // not far enough to mean anything: spring home
          leanZone(null, false);
          var pulledHome = dx, tiltHome = tiltOf(dx);
          dx = 0;
          // back to the middle, smoothly — no spring past it
          if (sw.card) flyCard(sw.card, { x: SWIPE_HOME.x + pulledHome, y: SWIPE_HOME.y, rot: tiltHome, s: 1 }, { x: SWIPE_HOME.x, y: SWIPE_HOME.y, rot: 0, s: 1 }, 220, 0,
                               function () { if (!dragging && !resolving) evt('swipe:home', { i: sw.i }); });
        }
        function onCancel() {
          if (!dragging) return;
          dragging = false;
          leanZone(null, false);
          dx = 0; if (sw.card) { place(sw.card, 0, 0); sw.card.style.cursor = 'grab'; }
          evt('swipe:home', { i: sw.i });
        }

        function onKey(e) {
          if (e.key === 'ArrowLeft') { classify('regular'); e.preventDefault(); }
          else if (e.key === 'ArrowRight') { classify('irregular'); e.preventDefault(); }
        }

        /* ---- arm whatever is currently on the table ---- */
        function arm() {
          if (!sw.card) return;
          on(sw.card, 'pointerdown', onDown);
          on(sw.card, 'pointermove', onMove);
          on(sw.card, 'pointerup', onUp);
          on(sw.card, 'pointercancel', onCancel);
          on(sw.card, 'lostpointercapture', onCancel);
        }
        hintLadder({
          /* THE DESTINATIONS BREATHE, NOT THE CARD. He is peeking from behind
             the card, hidden by a copy of its rim laid over him; pulsing the
             card scaled it out from under that copy (off-centre, eighteen
             pixels at 1900 wide), and the copy became a flat band of ice
             across his face. The card holds still while he is behind it; the
             two zones it can go to pulse instead — "put it there", which is
             the hint anyway. */
          pulse: function () {
            var zs = Object.keys(sw.zones || {}).map(function (k) { return sw.zones[k]; }).filter(Boolean);
            return zs.length ? pulseHint(zs) : null;
          },
          demo: runDemo
        });

        // Tapping a zone does the same thing as swiping to it — the swipe is
        // the experience, but it must never be the only way in.
        Object.keys(sw.zones).forEach(function (id) {
          var g = sw.zones[id];
          g.style.cursor = 'pointer';
          on(g, 'pointerdown', function (e) { e.preventDefault(); stopDemo(); classify(id); });
        });
        on(svg.ownerDocument, 'keydown', onKey);

        arm();

        function done() {
          endInteraction();
          resolve({ result: 'correct' });
        }
      });
    },

    'multi-select': function (spec, ctx) {
      return new Promise(function (resolve) {
        if (global.Input) Input.mode('polygon');
        var need = st.cards.filter(function (c) { return c._opt.correct; }).length, got = 0;
        // EVERY card still in play, not the correct ones. The hint used to
        // pick the first unfound answer and pulse that, which is the whole
        // exercise given away to anyone who waited six seconds.
        hintLadder({
          pulse: function () { return pulseHint(st.cards.filter(function (c) { return !c._done; })); },
          demo: function () { return pulseHint(st.cards.filter(function (c) { return !c._done; }), { strong: true }); }
        });
        st.cards.forEach(function (c) {
          c.style.cursor = 'pointer';
          on(c, 'pointerdown', function (e) {
            e.preventDefault(); if (c._done) return; st.lastEl = c;
            evt('answer:selected', { option: c._opt.id, correct: !!c._opt.correct });
            if (c._opt.correct) {
              c._done = true; got++; c.style.cursor = '';
              if (c._card) c._card._mark('correct');
              onTap('correct');
              if (got >= need) { endInteraction(); resolve({ result: 'correct' }); }
            } else {
              if (c._card) c._card._mark('wrong');
              later(500, function () { if (c._card) c._card._mark(null); });
              onTap('wrong');
            }
          });
        });
        if (ctx && ctx.onCancel) ctx.onCancel(endInteraction);
      });
    },

    'tap-each': function (spec, ctx) {
      return new Promise(function (resolve) {
        if (global.Input) Input.mode('polygon');
        var isSides = spec.targets === 'sides', seen = {}, count = 0, need = spec.count || st.n;
        var queue = [], measuring = false, cancelled = false;
        cleanup.push(function () {
          cancelled = true; queue.length = 0;
          // the to-do dots go with the interaction, whichever way it ends
          if (st.sideTodo) { st.sideTodo = null; if (st.polyG) renderPoly(); }
        });
        st.measure = st.measure || {}; st.measure[isSides ? 'sides' : 'angles'] = [];
        st.showVerts = !isSides; st.touchVerts = !isSides;
        // every side starts on the to-do list, marked by a dot at its middle
        st.sideTodo = isSides ? st.verts.map(function (_, k) { return k; }) : null;
        renderPoly();
        var cls = isSides ? 'edge' : 'vertex';
        // WHERE TO TAP. Every target still waiting carries a soft pulse — a
        // glow along the side, a breath on the corner — and loses it the
        // moment it has been measured, so the pulse is always the to-do list.
        var hint = function () {
          (isSides ? st.edgeEls : st.vertEls).forEach(function (el, i) {
            el.style.cursor = seen[i] ? '' : 'pointer';   // a measured side is done with
            if (el.classList) el.classList.toggle('hint', !seen[i]);
            // the pulse is drawn on the knob, the tap is taken by the disc
            if (!isSides && knobOf(i) && knobOf(i).classList) knobOf(i).classList.toggle('hint', !seen[i]);
          });
        };
        hint();
        // what is still to measure: the sides' dots and the corners breathe
        var todo = function () {
          return isSides ? (st.sideDotEls || []).filter(function (d, q) { return d && !seen[q]; })
                         : (st.knobEls || []).filter(function (_, q) { return !seen[q]; });
        };
        // every one of them is to be measured: the hand taps the next — from
        // the first idle hint, because "tap the sides" is a move no screen
        // before has asked for
        hintLadder({
          pulse: function () { var t = todo(); return both(pulseHint(t), tapHand(centreOf(t[0]))); },
          demo: function () { var t = todo(); return both(pulseHint(t, { strong: true }), tapHand(centreOf(t[0]))); }
        });
        // Delegated: renderPoly() runs after every reveal.
        on(st.polyG, 'pointerdown', function (e) {
          var t = e.target; if (!t || !t.classList || !t.classList.contains(cls)) return;
          var i = +t.getAttribute('data-i'); if (seen[i]) return;
          e.preventDefault(); seen[i] = true;
          evt('measurement:start', { what: isSides ? 'side' : 'angle', index: i });
          // its dot goes at once: the tap has been taken
          if (isSides && st.sideTodo) {
            st.sideTodo = st.sideTodo.filter(function (k) { return k !== i; });
            renderPoly(); hint();
          }
          queue.push(i); next();
        });
        function next() {
          if (cancelled || measuring || !queue.length) return;
          var i = queue.shift(); measuring = true;
          function reveal() {
            if (cancelled) return;
            count++;
            st.measure[isSides ? 'sides' : 'angles'].push(i); renderPoly();
            // the new reading pops in; the ones already there stay put
            var fresh = st.measG && st.measG.querySelector(isSides ? '.meas[data-side="' + i + '"]' : '[data-angle="' + i + '"]');
            if (fresh) enter(fresh, 'pop');
            st.lastEl = isSides ? st.edgeEls[i] : (knobOf(i) || st.vertEls[i]);
            hint();
            evt('measurement:complete', { what: isSides ? 'side' : 'angle', index: i });
            onTap('correct'); measuring = false;
            if (count >= need) {
              st.sideTodo = null; renderPoly();
              // THE LAST SIDE IS IN, AND NOW THE MARKS SAY IT: the equal-side
              // ticks are dealt in round the shape one after another — the
              // conclusion drawn when there is something to conclude
              if (isSides && st.measG && !reduced()) {
                var ticks = st.measG.querySelectorAll('.eq-tick');
                for (var tk = 0; tk < ticks.length; tk++) {
                  var te = ticks[tk];
                  if (!te.animate) continue;
                  te.style.transformBox = 'fill-box'; te.style.transformOrigin = 'center';
                  try { te.animate([{ opacity: 0, scale: '.3' }, { opacity: 1, scale: '1.25', offset: 0.6 }, { opacity: 1, scale: '1' }],
                                   { duration: 420, delay: 160 + tk * 150, easing: 'cubic-bezier(.3,1.4,.5,1)', fill: 'backwards' }); } catch (x) {}
                }
                if (ticks.length) sfx('sparkle', { gain: 0.5 });
              }
              endInteraction(); resolve({ result: 'correct' });
            }
            else next();
          }
          if (isSides) measureSide(i, reveal);
          else reveal();
        }
        if (ctx && ctx.onCancel) ctx.onCancel(endInteraction);
      });
    },

    sort: function (spec, ctx) {
      return new Promise(function (resolve) {
        if (global.Input) Input.mode('polygon');
        var S = st.sort;
        function armItem(item) {
          var active = false, off = { x: 0, y: 0 };
          item.style.cursor = 'grab';
          on(item, 'pointerdown', function (e) { if (item._placed) return; active = true; S.dragging = item; var p = pt(e); var m = item._pos || item._home; off = { x: m.x - p.x, y: m.y - p.y }; item.setPointerCapture && item.setPointerCapture(e.pointerId); layers.ui.appendChild(item); e.preventDefault(); });
          on(svg, 'pointermove', function (e) { if (!active) return; var p = pt(e); item._pos = { x: p.x + off.x, y: p.y + off.y }; item.setAttribute('transform', 'translate(' + item._pos.x + ',' + item._pos.y + ')'); });
          on(svg, 'pointerup', function (e) {
            if (!active) return; active = false; var p = item._pos || item._home;
            var bin = S.bins.filter(function (b) { var r = b._rect; return p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h; })[0];
            st.lastEl = item;
            if (bin) evt('answer:selected', { item: item._name, bin: bin._bin.id });
            if (!bin) { returnItem(item); return; }
            var c = Poly.classify(item._verts);
            var truth = bin._bin.id === 'convex' ? c.convex : bin._bin.id === 'concave' ? c.concave : bin._bin.id === 'regular' ? c.regular : c.irregular;
            if (truth) {
              item._placed = true; S.placed++; bin._count++; item.style.cursor = '';
              bin._items = bin._items || [];
              bin._items.push(item);
              packBin(bin);
              onTap('correct');
              if (S.queue && S.queue.length) { var next = makeSortItem(S.queue.shift(), W / 2 + 120, 210, 0); S.items.push(next); armItem(next); }
              if (S.placed >= S.total) { endInteraction(); resolve({ result: 'correct' }); }
            } else { onTap('wrong'); returnItem(item); }
          });
        }
        S.items.forEach(armItem);
        // the gesture: a ghost of the first card slides down toward the bins
        // and fades — the move, not the answer — until the child takes one
        var firstLeft = function () { return S.items.filter(function (it) { return !it._placed; })[0]; };
        hintLadder({
          pulse: function () { var f = firstLeft(); return f ? pulseHint([f]) : null; },
          demo: function () {
            var first = firstLeft();
            if (!first || !S.bins || !S.bins.length) return null;
            var b0 = S.bins[0]._rect, b1 = S.bins[S.bins.length - 1]._rect;
            var gapX = (b0.x + b0.w + b1.x) / 2, home = first._pos || first._home;
            return gestureGhost(home, { x: gapX, y: b0.y + 40 }, { clone: first, trail: false, duration: 2600 });
          }
        });
        if (ctx && ctx.onCancel) ctx.onCancel(endInteraction);
      });
    },

    stepper: function (spec, ctx) {
      return new Promise(function (resolve) {
        if (global.Input) Input.mode('polygon');
        function set(n) {
          n = Math.max(st.stepper.min, Math.min(st.stepper.max, n));
          if (n === st.n) return;
          var prev = st.verts.slice(); st.n = n;
          var P = polygonIn(st.panel, n, {}); st.verts = P.verts; st.stepText.textContent = n; renderPoly(); morphFrom(prev);
          syncStepper();
          onTap('any');
          if (n === spec.target) { endInteraction(); resolve({ result: 'correct' }); }
        }
        hintLadder({
          pulse: function () { var b = st.n < spec.target ? st.stepPlus : st.stepMinus; return both(pulseHint([b]), tapHand(centreOf(b))); },
          demo: function () { var b = st.n < spec.target ? st.stepPlus : st.stepMinus; return both(pulseHint([b], { strong: true }), tapHand(centreOf(b))); }
        });
        syncStepper();
        on(st.stepMinus, 'pointerdown', function (e) { e.preventDefault(); if (!st.stepLocked && st.n > st.stepper.min) set(st.n - 1); });
        on(st.stepPlus, 'pointerdown', function (e) { e.preventDefault(); if (!st.stepLocked && st.n < st.stepper.max) set(st.n + 1); });
        if (ctx && ctx.onCancel) ctx.onCancel(endInteraction);
      });
    }
  };

  /* ------------------------------------------------------------------ *
   * A LINE FROM A CORNER, DRAWN BY THE FINGER
   *
   * Both diagonal screens are the same gesture: from the corner the child
   * chose, to a corner that is neither beside it nor already joined to it.
   * These are the pieces of that gesture, so both screens feel identical:
   *
   *   the corners it may go to light up as the drag begins, and only those;
   *   the line runs from the chosen corner to the finger, and within SNAP of
   *   a corner it may go to it jumps there — a magnetic snap, with an icy
   *   tick — so a finger that is nearly there is there;
   *   let go anywhere else and the line slides back home;
   *   a new diagonal shimmers once.
   *
   * Everything is in the stage's own units and read from the corners as they
   * are now, so a resize or a moved corner can never leave a line behind.
   * ------------------------------------------------------------------ */
  var SNAP = 60;

  /** Is the pair (a, b) already a diagonal on the shape? Pairs are unordered. */
  function diagonalUsed(a, b) {
    var k = Math.min(a, b) + '-' + Math.max(a, b);
    return (st.diagonals || []).some(function (d) { return Math.min(d[0], d[1]) + '-' + Math.max(d[0], d[1]) === k; });
  }

  /** The line under the finger, hidden until the drag begins. */
  function previewLine(from) {
    var a = st.verts[from];
    return mk('line', { x1: a.x, y1: a.y, x2: a.x, y2: a.y, stroke: HI.line, 'stroke-width': 5,
                        'stroke-linecap': 'round', opacity: 0, 'pointer-events': 'none',
                        style: litGlow(HI.lit) }, layers.fx);
  }

  /** Light the corners a line may go to (or put them back as they were).
      Attributes only — no re-render, so the corners the child is holding on
      to keep their handlers and the drag can be tried again at once. */
  var KNOB_ATTRS = ['opacity', 'r', 'fill', 'stroke', 'stroke-width'];
  function showTargets(idxs, on) {
    (st.knobEls || []).forEach(function (k, i) {
      if (!k) return;
      if (on && idxs.indexOf(i) >= 0) {
        if (!k._was) { k._was = {}; KNOB_ATTRS.forEach(function (a) { k._was[a] = k.getAttribute(a); }); }
        k.setAttribute('opacity', 1); k.setAttribute('r', 9);
        k.setAttribute('fill', HI.knob); k.setAttribute('stroke', HI.rim); k.setAttribute('stroke-width', 3);
        k.classList.add('target');
      } else if (k._was) {
        KNOB_ATTRS.forEach(function (a) { if (k._was[a] == null) k.removeAttribute(a); else k.setAttribute(a, k._was[a]); });
        k._was = null;
        k.classList.remove('target', 'hot');
      }
    });
  }

  /** Move the line's free end: to the finger, or snapped to a corner it may
      join. Returns the corner it is snapped to, or -1. */
  function followFinger(line, from, p, valid, was) {
    var best = -1, bd = SNAP;
    valid.forEach(function (j) { var q = st.verts[j], d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = j; } });
    var end = best >= 0 ? st.verts[best] : p;
    line.setAttribute('opacity', 1);
    line.setAttribute('x2', end.x); line.setAttribute('y2', end.y);
    if (best !== was) {
      if (was >= 0 && knobOf(was)) { knobOf(was).classList.remove('hot'); knobOf(was).setAttribute('r', 9); }
      if (best >= 0 && knobOf(best)) {
        knobOf(best).classList.add('hot'); knobOf(best).setAttribute('r', 12);
        sfx('tick', { gain: 0.5 });                     // the icy tick of a line finding its corner
      }
    }
    return best;
  }

  /** A line let go in the wrong place goes home, gently, and is gone.
      x2/y2 are attributes, not CSS, so it is stepped by frame for 200ms. */
  function retract(line, from, then) {
    var a = st.verts[from];
    var finished = false;
    var done = function () { if (finished) return; finished = true; line.remove(); if (then) then(); };
    if (reduced() || line.getAttribute('opacity') === '0') { done(); return; }
    var x2 = +line.getAttribute('x2'), y2 = +line.getAttribute('y2');
    var frame = global.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
    var t0 = Date.now();
    (function step() {
      var k = Math.min(1, (Date.now() - t0) / 200), e = k * k;
      line.setAttribute('x2', x2 + (a.x - x2) * e); line.setAttribute('y2', y2 + (a.y - y2) * e);
      line.setAttribute('opacity', 1 - k);
      if (k < 1 && line.parentNode) frame(step);
      else done();
    }());
  }

  /** A line the child has just made catches the light once. */
  function shimmerLine(ln) {
    if (reduced() || !ln || !ln.animate) return;
    try {
      ln.animate([{ strokeWidth: 4.5, filter: 'brightness(1)' }, { strokeWidth: 8, filter: 'brightness(1.5)', offset: 0.35 }, { strokeWidth: 4.5, filter: 'brightness(1)' }],
                 { duration: 560, easing: 'ease-out' });
    } catch (e) {}
  }

  /** A new diagonal catches the light once — or, the first one the child
      finds for themselves (`found`), twice and slower: the glow is the
      answer, so it lasts long enough to be seen while "Yay!" arrives. */
  function shimmer(k, found) {
    if (reduced() || !st.diagG) return;
    var g = st.diagG.childNodes[k], ln = g && g.querySelector('line');
    if (!ln || !ln.animate) return;
    var timing = found ? { duration: 760, iterations: 2, easing: 'ease-in-out' } : { duration: 560, easing: 'ease-out' };
    try {
      ln.animate([
        { strokeWidth: 4, opacity: 1 },
        { strokeWidth: found ? 9 : 7.5, opacity: 1, offset: 0.35 },
        { strokeWidth: 4, opacity: 1 }
      ], timing);
      g.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(' + (found ? 1.6 : 1.45) + ')', offset: 0.35 }, { filter: 'brightness(1)' }], timing);
    } catch (e) {}
  }

  /* THE CONNECTING STEP, AS A STATE. Pick → connect has several moments in
     which the shape must not take a line — while he names a side, while the
     next instruction is still being said, while the diagonal is cheered — and
     the stage says which one it is in, so nothing overlaps and a test can
     ask:
       SELECT_VERTEX     corners showing, any one may be picked
       VERTEX_SELECTED   the corner is theirs; the instruction is being given
       READY_TO_CONNECT  a line may be drawn from it
       DRAWING           a finger is down, the line follows it
       SIDE_FEEDBACK     it landed on a neighbour: a side, being named
       DIAGONAL_SUCCESS  it landed on any other corner: a diagonal
     Drawing is only taken in READY_TO_CONNECT; every other state belongs to
     the lesson. */
  function setConnect(state, detail) {
    if (st.connect === state) return;
    st.connect = state;
    evt('connect:state', Object.assign({ state: state }, detail || {}));
  }

  /** The side that was named goes: its mark and its tag fade, and the shape is
      as it was before the line was drawn (the corner stays theirs). */
  function clearSide() {
    var ln = st.segLine, tag = st.labelEl;
    st.segment = null; st.segLine = st.segGlow = null;
    if (tag) { st.labelEl = null; st.labelSpec = null; }
    [ln, tag].forEach(function (el) {
      if (!el) return;
      if (reduced() || !el.animate) { el.remove(); return; }
      try {
        var a = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 280, easing: 'ease-in', fill: 'forwards' });
        a.onfinish = function () { el.remove(); };
      } catch (e) { el.remove(); }
    });
  }

  function drawDiagonals(spec, count, ctx) {
    return new Promise(function (resolve) {
      if (global.Input) Input.mode('polygon');
      var from = spec.from === 'picked' ? (st.picked == null ? 0 : st.picked) : spec.from;
      /* `sides`: CONNECT IT TO ANY CORNER, AND FIND OUT. The child joins their
         corner to another themselves. A neighbour (by vertex ORDER, i±1,
         wrapping at the first and last corner — Poly.isAdjacent) makes a
         SIDE: it lights for a moment and the lesson names it. Any other
         corner makes the DIAGONAL.
         THE OTHER CORNERS ARE POINTS TO CONNECT TO. They vanished when the
         corner was picked — only the chosen one remained — and, asked to
         "connect it to another vertex", the child had one dot on the screen
         and nothing to connect it to (the user: "why points not added").
         From the moment the connecting starts they are back, as plain
         corner points, and their own stays bright and ringed; the one the
         line snaps to grows under the finger. */
      var sides = !!spec.sides;
      st.picked = from; st.vcolor = {}; st.vcolor[from] = HI.fill; st.showVerts = true; st.touchVerts = true; renderPoly();
      /* THE CORNER THE LINE STARTS FROM TAKES A HAND. It is the one thing on
         the shape to press, and it showed the plain arrow: the corners are
         rebuilt after every line, so the hand is put back each time. */
      var dressFrom = function () { var c = st.vertEls && st.vertEls[from]; if (c) c.style.cursor = 'grab'; };
      dressFrom();
      if (sides) setConnect('READY_TO_CONNECT', { from: from });
      var made = 0, active = false, hot = -1;
      var line = previewLine(from);
      var valid = function () { return Poly.diagonalsFrom(from, st.n).filter(function (j) { return !diagonalUsed(from, j); }); };
      var targets = function () {
        if (!sides) return valid();
        var all = [];
        for (var q = 0; q < st.n; q++) if (q !== from && !diagonalUsed(from, q)) all.push(q);
        return all;
      };
      // THE MOVE, SHOWN — once the child has been still a while (hintLadder).
      // First the corners a line may go to breathe; then a ghost runs from the
      // chosen corner to one of them. It gives no answer away: every corner
      // it may go to is a diagonal, and the child still chooses.
      hintLadder({
        // connecting, the one that breathes first is their own corner, where
        // the line starts (any of the others is somewhere it may go)
        pulse: function () { return pulseHint(sides ? [knobOf(from)].filter(Boolean) : targets().map(knobOf)); },
        demo: function () {
          // connecting for the first time, the ghost shows JOINING TWO CORNERS
          // (to a neighbour: the side is the lesson's first answer); after a
          // side has been made, it shows a line that is not one
          var t = (sides && !spec.retry) ? (from + 1) % st.n : valid()[0];
          return t == null ? null : gestureGhost(st.verts[from], st.verts[t], { r: 11 });
        }
      });
      // Delegated: the source vertex element is rebuilt after each diagonal.
      on(st.polyG, 'pointerdown', function (e) {
        var t = e.target; if (!t || !t.classList || !t.classList.contains('vertex') || +t.getAttribute('data-i') !== from) return;
        if (global.Input && Input.guarded) return;
        if (sides && st.connect !== 'READY_TO_CONNECT') return;
        active = true; e.preventDefault();
        try { svg.setPointerCapture && svg.setPointerCapture(e.pointerId); } catch (x) {}
        // connecting, nothing lights up front; the corner the line finds does
        if (sides) { showTargets([], false); setConnect('DRAWING', { from: from }); }
        else showTargets(targets(), true);
        svg.style.cursor = 'grabbing';
        evt('diagonal:start', { from: from });
      });
      on(svg, 'pointermove', function (e) {
        if (!active) return;
        var was = hot;
        hot = followFinger(line, from, pt(e), targets(), hot);
        if (sides && hot !== was) {
          // only the corner it has snapped to shows, for as long as it is there
          showTargets(hot >= 0 ? [hot] : [], true);
          if (hot >= 0 && knobOf(hot)) { knobOf(hot).classList.add('hot'); knobOf(hot).setAttribute('r', 12); }
        }
      });
      var release = function (e) {
        if (!active) return; active = false;
        svg.style.cursor = '';
        var j = hot >= 0 ? hot : nearestVertex(pt(e), from);
        hot = -1;
        showTargets([], false);
        if (j < 0) {
          retract(line, from, function () { line = previewLine(from); });
          if (sides) {
            // NOTHING WAS CONNECTED, SO THERE IS NO VERDICT. The line goes home,
            // and every corner lights for a moment — where a line can go, all
            // of them, neighbours included, so it is not an answer — and
            // settles back to a plain point.
            setConnect('READY_TO_CONNECT', { from: from });
            showTargets(targets(), true);
            later(1400, function () { if (!active) showTargets([], false); });
            return;
          }
          missedCorner(valid());
          return;
        }
        var ok = !Poly.isAdjacent(from, j, st.n) && !diagonalUsed(from, j);
        st.lastEl = knobOf(j) || st.vertEls[j];
        if (sides && !ok && Poly.isAdjacent(from, j, st.n)) {
          // A SIDE: the line lands along the outline and stays there, marked,
          // for the lesson to name ("This is a side of the polygon.")
          line.remove();
          st.segment = [from, j]; st.ghost = null; renderPoly();
          st.lastEl = st.segLine || knobOf(j);
          // lit while it is being named, and only then (clearSide takes it
          // down before the next try)
          if (st.segLine) { st.segLine.setAttribute('style', litGlow(HI.lit)); shimmerLine(st.segLine); }
          setConnect('SIDE_FEEDBACK', { from: from, to: j });
          evt('side:made', { from: from, to: j });
          endInteraction(); resolve({ result: 'side', vertex: j });
          return;
        }
        if (ok) {
          if (sides) {
            // the side that was named steps aside for the diagonal
            st.segment = null;
            if (st.labelEl) { st.labelEl.remove(); st.labelEl = null; st.labelSpec = null; }
          }
          line.remove(); line = previewLine(from);
          // (connecting: the corner it reached shows as a corner too — a
          // diagonal joins two vertices, and a line into a hidden corner read
          // as a line that stopped in mid-air)
          if (sides) st.vcolor[j] = HI.fill;
          st.diagonals = st.diagonals || []; st.diagonals.push(Object.assign([Math.min(from, j), Math.max(from, j)], { solid: true })); st.ghost = null; renderPoly(); made++;
          if (made < count) dressFrom();
          st.lastEl = knobOf(j) || st.vertEls[j];
          shimmer(st.diagonals.length - 1, sides);
          if (sides) setConnect('DIAGONAL_SUCCESS', { from: from, to: j });
          evt('diagonal:complete', { from: from, to: j });
          if (count > 1) onTap('correct');
          if (made >= count) { line.remove(); endInteraction(); resolve({ result: 'correct' }); }
        } else if (count > 1) {
          retract(line, from, function () { line = previewLine(from); });
          onTap('wrong');
        } else {
          endInteraction();
          retract(line, from, function () { resolve({ result: 'wrong' }); });
        }
      };
      on(svg, 'pointerup', release);
      on(svg, 'pointercancel', function () {
        if (!active) return; active = false; hot = -1; showTargets([], false);
        if (sides) setConnect('READY_TO_CONNECT', { from: from });
        retract(line, from, function () { line = previewLine(from); });
      });
      if (ctx && ctx.onCancel) ctx.onCancel(function () { if (line) line.remove(); endInteraction(); });
    });
  }

  function returnItem(item) {
    if (!item || item._placed) return;
    item._pos = null; juice('refuse', item);
    item.setAttribute('transform', 'translate(' + item._home.x + ',' + item._home.y + ')');
  }

  /* ------------------------------------------------------------------ *
   * Keeping the interaction alive
   * ------------------------------------------------------------------ */


  /**
   * Breathe whatever the child is meant to touch, for as long as they have
   * to decide.
   *
   * focus() pulses a target three times and stops. That is right as an
   * announcement and useless as an invitation: a seven-year-old thinking for
   * fifteen seconds spends twelve of them looking at a still picture, and a
   * still picture of a shape is a slide. Everything touchable now keeps a
   * slow breath until the answer is in — staggered, so the screen ripples
   * rather than throbbing in unison, which is the difference between a scene
   * that is alive and one that is flashing at you.
   *
   * Touchables are found by their inline cursor rather than from a list.
   * Every one of them sets cursor:pointer as it is built, so this cannot fall
   * out of step with a new interaction the way a hand-kept set of selectors
   * would — and there is exactly one thing to remember when adding one.
   *
   * It animates `scale`, never `transform`. Half the furniture on this stage
   * is positioned by a transform attribute, and animating transform replaces
   * it — which is how the sort items once spent half a second stacked at the
   * SVG origin.
   */
  function alive(on) {
    if (svg) {
      var was = svg.querySelectorAll('.touchable');
      for (var k = 0; k < was.length; k++) was[k].classList.remove('touchable');
    }
    if (!on || !svg) return;
    // The dressing survives reduced motion even though the breathing does
    // not: someone who has asked for less movement still has to be able to
    // see what they are meant to touch.
    if (reduced()) return;

    var els = svg.querySelectorAll('[style*="cursor: pointer"],[style*="cursor:pointer"]');
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      // The same signal that earns the breath earns the look. A class rather
      // than inline paint, so it cannot fight whatever the lesson is already
      // saying with colour — a picked vertex, an outside diagonal in red.
      if (e.classList) e.classList.add('touchable');
    }

    // NO IDLE ANIMATION. Everything a target does now, it does in answer to
    // the pointer — see the .touchable rules in the stylesheet. What used to
    // be here was an infinite breath on every target at once, which is the
    // screen talking over the child rather than waiting for them.
  }

  /**
   * Turn an element about its own middle — but never overwrite a pivot it
   * already has. A sprite or a marker with its own transform-origin has it
   * for a reason, and quietly replacing it is how the character once sat
   * twenty-two pixels below the ground for a whole session.
   */
  function pivot(e) {
    if (e.style && !e.style.transformOrigin) {
      e.style.transformBox = 'fill-box';
      e.style.transformOrigin = 'center';
    }
    return e;
  }

  /**
   * Press feedback, for anything at all that can be touched.
   *
   * One delegated listener rather than a handler per element: it finds the
   * nearest touchable ancestor of whatever was hit and squashes it. Without
   * this a tap is answered only by whatever the lesson does next, which on a
   * wrong answer can be most of a second later — long enough for a child to
   * wonder whether the screen noticed them at all.
   */
  /**
   * Everything touchable answers the finger, and makes a noise doing it.
   *
   * One delegated listener rather than a handler per control: the squash and
   * the click belong to "this is a button", not to what the button does, and
   * a new interaction should not have to remember to ask for them.
   *
   * THE SOUND IS ON THE PRESS, not on the verdict. A child who taps and hears
   * nothing until the game has decided whether they were right has had no
   * answer for three hundred milliseconds — long enough to tap again.
   */
  function armPress() {
    if (!svg) return;
    on(svg, 'pointerdown', function (ev) {
      var t = ev.target;
      while (t && t !== svg && !(t.style && /pointer/.test(t.style.cursor))) t = t.parentNode;
      if (!t || t === svg) return;
      sfx('select');
      if (reduced() || !t.animate) return;
      pivot(t);
      try {
        t.animate([{ scale: '1' }, { scale: '.9' }, { scale: '1.04' }, { scale: '1' }],
                  { duration: 260, easing: 'cubic-bezier(.3,1.35,.5,1)' });
      } catch (e) {}
    });
  }

  /** What an interaction wants touched, for the pop that hands it over. */
  function armTargets(spec) {
    var t = spec.type, ks = (st.knobEls || []).filter(Boolean);
    if (t === 'vertex-pick') return ks;
    if (t === 'draw-diagonal' || t === 'draw-diagonals') return st.picked != null && knobOf(st.picked) ? [knobOf(st.picked)] : [];
    if (t === 'drag-vertex') return spec.vertex === 'any' || spec.vertex == null ? ks : (knobOf(spec.vertex) ? [knobOf(spec.vertex)] : []);
    if (t === 'tap-each') return spec.targets === 'sides' ? (st.sideDotEls || []).filter(Boolean) : ks;
    if (t === 'choice') return (st.choiceEls || []).slice();
    if (t === 'multi-select') return (st.cards || []).slice();
    if (t === 'sort') return st.sort && st.sort.items ? st.sort.items.filter(function (it) { return !it._placed; }).slice(0, 1) : [];
    if (t === 'swipe') return st.swipe && st.swipe.zones ? Object.keys(st.swipe.zones).map(function (k) { return st.swipe.zones[k]; }) : [];
    if (t === 'stepper') return st.stepPlus ? [st.n < (spec.target || 0) ? st.stepPlus : st.stepMinus].filter(Boolean) : [];
    return [];
  }

  function waitFor(spec, ctx) {
    var fn = INTERACT[spec.type];
    if (!fn) { if (global.console) console.warn('Stage: no interaction "' + spec.type + '"'); return Promise.resolve({ result: 'correct' }); }

    // tap-anywhere is reading, not doing. Breathing the polygon's vertices
    // while the child is only meant to read the line invites a tap that does
    // nothing, which is worse than no invitation at all.
    var invite = spec.type !== 'tap-anywhere';
    // A frame late on purpose: the interaction builds its own furniture — the
    // choice row, the sort tray — inside fn(), so asking now would find the
    // previous screen's.
    if (invite) later(60, function () { alive(true); });

    var p;
    try { p = fn(spec, ctx); }
    catch (e) { alive(false); throw e; }
    // THE FIRST THING THE CHILD SEES WHEN IT IS THEIR TURN: the things to
    // touch pop once, in turn — "here". Then the idle ladder takes over: a
    // pulse (and a hand, for a tap) after 2.5s of stillness, the move itself
    // shown by a hand after 7s. Not on a retry: the child has just used them.
    if (invite && !spec.retry) later(90, function () { var t = armTargets(spec); if (t.length) pulseHint(t, { pop: true }); });
    return Promise.resolve(p).then(
      function (r) { alive(false); return r; },
      function (e) { alive(false); throw e; }
    );
  }

  /**
   * Is the stage showing nothing but scenery?
   *
   * game.js uses this to decide where Swiftee belongs. On a screen with a
   * polygon or a card grid he has to stand out of the way; on a screen that
   * is only him talking, standing off to one side just leaves a large empty
   * space where the lesson should be, so he takes the middle instead.
   */
  function isEmpty() { return !st.kind; }

  /**
   * The screen-space box the lesson content occupies, or null when there is
   * none. Everything overlaid on the stage — the speech bubble, the
   * instruction card — is sized against this rather than against a guessed
   * percentage, which is what stops a long line of dialogue from growing
   * across the shape the child is being asked to look at.
   *
   * The panel layer is included because it is visible lesson furniture. The
   * bubble may use gaps between individual pieces via contentParts(), but it
   * must not cover the slab that visually groups those pieces.
   */
  function contentBox() {
    if (!svg || !st.kind) return null;
    var m = svg.getScreenCTM && svg.getScreenCTM();
    if (!m) return null;
    var box = null;
    // 'panel' INCLUDED. It was not, so the slab the whole lesson stands on
    // was invisible to everything that asks where the lesson is — and the
    // speech bubble, which keeps clear of the lesson by asking exactly this,
    // was placed across the middle of it on six screens. The shape and the
    // controls were being avoided; the card they sit on was not.
    ['panel', 'poly', 'ui'].forEach(function (name) {
      var layer = layers[name];
      if (!layer || !layer.getBBox || !layer.childNodes.length) return;
      var b;
      try { b = layer.getBBox(); } catch (e) { return; }
      if (!b || (!b.width && !b.height)) return;
      box = box
        ? { x: Math.min(box.x, b.x), y: Math.min(box.y, b.y),
            r: Math.max(box.r, b.x + b.width), b2: Math.max(box.b2, b.y + b.height) }
        : { x: b.x, y: b.y, r: b.x + b.width, b2: b.y + b.height };
    });
    if (!box) return null;
    // viewBox units -> CSS pixels, through the live matrix, so this is right
    // at every letterbox and every zoom.
    var p = svg.createSVGPoint();
    p.x = box.x; p.y = box.y + seatY; var tl = p.matrixTransform(m);
    p.x = box.r; p.y = box.b2 + seatY; var br = p.matrixTransform(m);
    return { left: tl.x, top: tl.y, right: br.x, bottom: br.y, width: br.x - tl.x, height: br.y - tl.y };
  }

  /**
   * The lesson's pieces as separate boxes, in page pixels.
   *
   * contentBox() unions them, which is right for "how much room is left at
   * the side" and wrong for "is there a gap in the middle". On the sorting
   * screen the tray sits at the top and the bins at the bottom with a clear
   * band between them, and the union hides that band completely — so the
   * speech bubble concluded there was nowhere to go and sat on the shapes.
   */
  /**
   * The boxes the lesson actually occupies.
   *
   * PAINTED, NOT REPORTED. A button is three nested <svg> slices of one
   * picture, and getBoundingClientRect on a nested <svg> gives the bounds of
   * the CONTENT inside it rather than the viewport that clips it — so a
   * 184-unit button measured 244, and two buttons with a 30-unit gap between
   * them appeared to overlap by a tenth of their area. Anything the stage
   * built knows its own box and records it as _rect; that is the one to
   * believe, and getBoundingClientRect is the fallback for the rest.
   */
  function contentParts(opts) {
    if (!svg || !st.kind) return [];
    // `glass`: the slab itself does not count, only what is drawn on it —
    // for a bird waiting INSIDE the card, whose words belong beside him on
    // the glass rather than banished above the rim.
    var sel = ((opts && opts.glass) ? '' : '.panel, ') + '.polygon, .meas, .card, .sort-item, .bin, .choice, .stepper, .shape, .badge, .summary-card';
    var out = [];
    var nodes = svg.querySelectorAll(sel);
    // Through the live matrix, as contentBox() does. Scaling by the svg box
    // alone put every painted rect 96px too high on a 4:3 screen, where the
    // stage is letterboxed inside the element and its top is not the top.
    var m = svg.getScreenCTM && svg.getScreenCTM();
    var px = function (x) { return m ? m.a * x + m.e : x; }, py = function (y) { return m ? m.d * y + m.f : y; };
    for (var i = 0; i < nodes.length; i++) {
      var q = nodes[i]._rect;
      // on the glass, the polygon counts as its outline alone (see nook())
      var el = (opts && opts.glass && nodes[i] === st.polyG && st.fill) ? st.fill : nodes[i];
      var r = q
        ? { left: px(q.x), top: py(q.y + seatY), right: px(q.x + q.w), bottom: py(q.y + q.h + seatY),
            width: px(q.x + q.w) - px(q.x), height: py(q.y + q.h) - py(q.y) }
        : el.getBoundingClientRect();
      if (r.width > 4 && r.height > 4) out.push(r);
    }
    return out;
  }

  var api = {
    mount: mount, apply: apply, focus: focus, waitFor: waitFor, element: element, halo: halo,
    snapshot: snapshot, restore: restore,
    isEmpty: isEmpty, contentBox: contentBox, contentParts: contentParts,
    /** The card's face and the shape's box, in page pixels: the nook beside
        the shape where a bird waiting in the corner can be spoken from. */
    nook: function () {
      if (!st.panel || !st.polyG || !svg || !svg.getScreenCTM) return null;
      var m = svg.getScreenCTM(); if (!m) return null;
      var pf = panelFace(st.panel);
      var face = { left: m.a * pf.x + m.e, top: m.d * (pf.y + seatY) + m.f, right: m.a * (pf.x + pf.w) + m.e, bottom: m.d * (pf.y + pf.h + seatY) + m.f };
      // the shape's own outline, not the readings and tags hung round it:
      // those sit inside the shape's margin, and the bubble may pass over
      // that margin on its way to his head
      var poly; try { poly = (st.fill || st.polyG).getBoundingClientRect(); } catch (e) { return null; }
      return { face: face, poly: poly };
    },
    /** The slab Swiftee peeks over or stands beside: the panel, or the left of a compared pair. */
    /** The swipe card now, against its home: the rim copy laid over him
        follows this, so it never hangs where the card used to be. */
    swipeCardOffset: function () {
      var S = st.swipe, card = S && S.card;
      if (!card) return null;
      var tf = card.getAttribute('transform') || '';
      var t = /translate\(\s*([-\d.]+)[\s,]+([-\d.]+)\s*\)/.exec(tf), r = /rotate\(\s*([-\d.]+)/.exec(tf), k = /scale\(\s*([-\d.]+)/.exec(tf);
      return { dx: t ? +t[1] - SWIPE_HOME.x : 0, dy: t ? +t[2] - SWIPE_HOME.y : 0, rot: r ? +r[1] : 0, scale: k ? +k[1] : 1,
               cx: SWIPE_HOME.x, cy: SWIPE_HOME.y + seatY };
    },
    peekAnchor: function (o) {
      // THE SUMMARY: behind the card in the middle, at the middle of its top
      // edge, the same place for every card — and nowhere while it travels
      if (st.kind === 'summary') {
        var sc = st.summary && st.summary.active ? st.summary.cards[st.summary.active] : null;
        if (!sc || sc._collected) return null;
        var sr = sc._rect;
        return { frame: 'panel', at: 0.5, x: sr.x, y: sr.y + seatY, w: sr.w, h: sr.h };
      }
      if (st.panel) return seatY ? Object.assign({}, st.panel, { y: st.panel.y + seatY }) : st.panel;
      if (st.compare) {
        // the card the lesson is looking at — the one glowing — else the left
        var k = st.compareFocus && st.compare[st.compareFocus] ? st.compareFocus : 'left';
        if (st.compare[k] && st.compare[k].panel) {
          var cp = st.compare[k].panel;
          return seatY ? Object.assign({}, cp, { y: cp.y + seatY }) : cp;
        }
      }
      if (st.swipe) {
        /* HE COMES UP BEHIND THE CARD IN HAND, not behind a bin.
         *
         * He used to peek over the Regular zone, off at the left edge, and
         * ask "where does this polygon belong?" from the far side of the
         * screen from the polygon. Behind the card he is asking ABOUT the
         * thing he is standing behind, and the question, the shape and the
         * face asking it are one group in the middle instead of three things
         * spread across the width. He drops back before the child drags.
         *
         * The frame is the card's own, so the rim copy drawn over him
         * (syncPeekRim in game.js) is the same ice he is behind. */
        var ch = SWIPE_HALF * ((global.CardFrame && CardFrame.option)
                               ? CardFrame.option.h / CardFrame.option.w : 1);
        // THE STRIP OVER HIM IS THE CARD'S OWN TOP, exactly where the card is:
        // the card layer is seated (seatY) and this was not, so the copy of
        // the rim hung that far below the real one and cut across the card.
        // And only while the card is at home: once it is being dragged, or is
        // flying to a zone, there is no rim there to be behind (null — he
        // stands down and the strip is taken away).
        var card = st.swipe.card;
        var tm = card && /translate\(\s*([-\d.]+)[\s,]+([-\d.]+)\s*\)/.exec(card.getAttribute('transform') || '');
        var home = !!card && (!tm || (Math.abs(+tm[1] - SWIPE_HOME.x) < 0.5 && Math.abs(+tm[2] - SWIPE_HOME.y) < 0.5));
        // (o.home: where the card's home is whether or not it is there — the
        // rim copy is placed on it and then follows the card, swipeCardOffset)
        if (!home && !(o && o.home)) return null;
        // `at` is where along the card's width his head comes up. A bin is
        // peeked over near its corner cap; a card the whole screen is about
        // is peeked over in the MIDDLE, so he and the shape and the question
        // line up as one column instead of leaning off to one side.
        return { frame: 'option', at: 0.5,
                 x: SWIPE_HOME.x - SWIPE_HALF, y: SWIPE_HOME.y - ch + seatY,
                 w: SWIPE_HALF * 2, h: ch * 2 };
      }
      return null;
    },
    onTap: function (fn) { onTap = fn || function () {}; },
    onEvent: function (fn) { onEvent = fn || function () {}; },
    /** A plank-free screen lifts a lone card to the centre; a plank seats it under the band. Animated. */
    seat: function (free) { plankFree = !!free; applySeat(true); },
    get seatY() { return seatY; },
    /* How long an answer row of n takes to be dealt: the director holds the
       question until it has, so no answer is live before it can be seen. */
    choicesEnterMs: function (n) { return reduced() ? 0 : 90 * Math.max(0, (n || 0) - 1) + ENTER_MS; },
    /* THE WORD AND THE THING (holdForWord). game.js calls said() for every
       word as the bubble reveals it, and releaseHeld() when control is handed
       over, so nothing a line names is ever left hidden. */
    said: said,
    releaseHeld: releaseHeld,
    /** The board answers a vocabulary word (see THE WORD, SHOWN ON THE BOARD). */
    emphasizeConcept: emphasize,
    get heldCount() { return heldForWord.length; },
    /** The child's own shapes, from the start again (Restart). */
    forgetMade: function () { made = {}; },
    madeShape: madeShape,
    /** Where the pick → connect step is (setConnect), or null off it. */
    connectState: function () { return st.connect || null; },
    flurry: flurry, alive: alive,
    /* How many delayed callbacks from a finished scene have been refused.
       A test reads this: a suppression mechanism that never suppresses
       anything looks exactly like one that was never wired up. */
    get staleSuppressed() { return staleSuppressed; },
    get pendingTimers() { return sceneTimers.length; },
    get svg() { return svg; }, get state() { return st; },
    shapeVerts: shapeVerts,
    /** Where the end-game summary is: its state, the card in the middle, what has been collected. */
    summaryState: function () { var S = st.summary; return S && st.kind === 'summary' ? { state: S.state, active: S.active, collected: S.collected.slice() } : null; },
    /* His part of it — rising, the line, its reading pause, sinking — is the
       director's; game.js passes each on as it begins. */
    summaryPhase: function (name) {
      var S = st.summary;
      if (st.kind !== 'summary' || !S || !S.active) return;
      if (['SWIFTEE_ENTER', 'EXPLANATION', 'READING_PAUSE', 'SWIFTEE_EXIT'].indexOf(name) < 0) return;
      setSummary(name, S.active);
    },
    /** What a summary card shows, as geometry, for the tests to check against polygon-math. */
    summaryGeometry: function (id) {
      var V = SUMMARY_VISUALS[id]; if (!V) return null;
      return { start: summaryVerts(id, false), end: summaryVerts(id, true), hi: (V.hi || []).slice(), line: V.line ? V.line.slice() : null,
               sides: V.sides ? V.sides.map(function (q) { return q.slice(); }) : null, wedge: V.wedge == null ? null : V.wedge,
               diags: !!V.diags, move: V.move ? V.move.slice() : null, marks: V.marks || null, tone: V.tone || null };
    }
  };
  global.Stage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : this);
