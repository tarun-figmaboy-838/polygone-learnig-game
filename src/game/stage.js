/*!
 * stage.js — everything the learner sees and touches, except Swiftee.
 *
 * One SVG, viewBox 1000×562, scaled by CSS. Six scene kinds and a set of
 * incremental ops from screens.js. Eleven interaction types, each returning
 * a promise the director awaits.
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
  var VISTA_SRC = 'assets/bg/ice-vista.png';

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
    var p = (st.kind === 'polygon' && st.panel) ? st.panel : null;
    var target = (plankFree && p) ? -Math.max(0, Math.min(52, p.y - 56)) : 0;
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
   * A HINT BEFORE THE FIRST TOUCH, AND AGAIN WHEN THE CHILD GOES IDLE.
   * `build` makes the hint (a pulse, a gesture ghost) and returns its stop
   * function. The hint is shown at once; the first touch takes it down; if
   * six seconds then pass with no touch, it is built again — from the
   * current state of the screen, since `build` reads that when it runs.
   */
  var IDLE_HINT_MS = 6000;
  function hintLoop(build) {
    if (reduced() || !svg) return;
    var stop = null, idleT = null, live = true;
    var hide = function () { if (stop) { try { stop(); } catch (e) {} stop = null; } };
    var show = function () { if (!live || stop) return; try { stop = build() || null; } catch (e) { stop = null; } };
    var arm = function () { clearTimeout(idleT); idleT = setTimeout(show, IDLE_HINT_MS); };
    on(svg, 'pointerdown', function () { hide(); clearTimeout(idleT); });
    on(svg, 'pointerup', arm);
    on(svg, 'pointercancel', arm);
    cleanup.push(function () { live = false; hide(); clearTimeout(idleT); });
    show();
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
  function pulseHint(els) {
    if (reduced() || !svg) return function () {};
    var list = (els || []).filter(Boolean);
    if (!list.length) return function () {};
    var anims = [];
    list.slice(0, 10).forEach(function (e, i) {
      if (!e.animate) return;
      e.style.transformBox = 'fill-box'; e.style.transformOrigin = 'center';
      try {
        anims.push(e.animate([{ scale: '1' }, { scale: '1.075' }, { scale: '1' }],
          { duration: 1250, iterations: Infinity, delay: 420 + i * 120, easing: 'ease-in-out' }));
      } catch (x) {}
    });
    var stop = function () { anims.forEach(function (a) { try { a.cancel(); } catch (e) {} }); anims = []; };
    cleanup.push(stop);
    return stop;
  }


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
    var anims = [];
    if (mover.animate) anims.push(mover.animate(frames, { duration: opts.duration || 3200, iterations: Infinity, delay: opts.delay || 700 }));
    if (trail && trail.animate) anims.push(trail.animate([
      { opacity: 0, offset: 0 }, { opacity: 0.55, offset: 0.2 }, { opacity: 0.55, offset: 0.76 }, { opacity: 0, offset: 0.92 }, { opacity: 0, offset: 1 }
    ], { duration: opts.duration || 3200, iterations: Infinity, delay: opts.delay || 700 }));
    var stop = function () {
      if (!live) return; live = false;
      anims.forEach(function (a) { try { a.cancel(); } catch (e) {} });
      if (g.animate) {
        try { var f = g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' }); f.finished.then(function () { g.remove(); }, function () { g.remove(); }); return; } catch (e) {}
      }
      g.remove();
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
    right:  { x: 396, y: 108, w: 456, h: 430 },
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
    var floor = BOTTOM - CONTROL_H - CONTROL_GAP;
    var h = Math.min(p.h, Math.max(240, floor - p.y));
    var slack = (BOTTOM - TOP) - (h + CONTROL_GAP + CONTROL_H);
    return { x: p.x, y: TOP + Math.max(0, slack / 2), w: p.w, h: h };
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
  function enter(el, kind) {
    if (reduced() || !el.animate) return;
    var k = kind === 'rise'
      ? [{ translate: '0 40px', opacity: 0 }, { translate: '0 0', opacity: 1 }]
      : kind === 'fade'
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [{ scale: '.7', opacity: 0 }, { scale: '1.04', opacity: 1, offset: .7 }, { scale: '1', opacity: 1 }];
    el.style.transformBox = 'fill-box'; el.style.transformOrigin = 'center';
    el.animate(k, { duration: 460, easing: 'cubic-bezier(.22,1,.36,1)' });
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
    if (opts.room === 'measure') { mx = Math.max(face.w * 0.07, 48); mt = Math.max(face.h * 0.06, 48); mb = Math.max(mb, face.h * 0.10, 48); }
    var box = { x: face.x + mx, y: face.y + mt, w: face.w - mx * 2, h: face.h - mt - mb };

    // Built at unit size WITH its deformations, so what gets measured is what
    // gets drawn: a dented or stretched shape has a different bounding box
    // from the regular one it started as.
    // ONE SIDE IS A LINE, TWO ARE A CORNER. Below three there is no polygon
    // to draw, and the builder starts there on purpose: the child adds the
    // sides one at a time and sees the third one close the shape.
    var u = n === 1 ? [{ x: -1, y: 0 }, { x: 1, y: 0 }]
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
        // drawn in slowly enough to be watched, glow and core together
        var len = Math.hypot(b.x - a.x, b.y - a.y);
        [line].forEach(function (ln) {
          ln.style.strokeDasharray = len; ln.style.strokeDashoffset = len;
          ln.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 720, delay: (d.delay || 0), easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' })
            .finished.then(function () { if (!d.solid) { ln.style.strokeDasharray = '14 12'; } ln.style.strokeDashoffset = 0; });
        });
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

    // THE SIDE IS NOT REMOVED, AND IT IS NOT LIT EITHER.
    //
    // Page 11 asks the child to drag the end of the side they have just made
    // across to a far corner. The line used to travel with the drag, so the
    // side was spent to buy the diagonal — it is kept now: st.sideMark
    // records it, and the polygon's own outline draws it, like every other
    // side. It is deliberately NOT drawn lit: a second white line of the
    // same weight beside the new one reads as a leftover, or as a second
    // diagonal, and the one thing this screen has to say is "that new line
    // is a diagonal". Only the diagonal is lit.

    // highlighted segment (side or new diagonal)
    if (st.segment) {
      var sa = v[st.segment[0]], sb = v[st.segment[1]];
      var seg = litLine(g, { x1: sa.x, y1: sa.y, x2: sb.x, y2: sb.y, 'stroke-width': 5, 'stroke-linecap': 'round' });
      st.segGlow = seg[0]; st.segLine = seg[1];
    }

    // edges as tap targets (invisible, wide) — an open figure has no closing side
    st.edgeEls = [];
    for (var i = 0; i < (isOpen() ? n - 1 : n); i++) {
      var e1 = v[i], e2 = v[(i + 1) % n];
      var edge = mk('line', { x1: e1.x, y1: e1.y, x2: e2.x, y2: e2.y, stroke: 'transparent', 'stroke-width': 30, 'class': 'edge', 'data-i': i }, g);
      st.edgeEls.push(edge);
    }

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
      var c = mk('circle', {
        cx: v[j].x, cy: v[j].y, r: 15,
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
  function drawMeasurements(g) {
    var v = st.verts, n = v.length, L = Poly.sideLengths(v), A = Poly.interiorAngles(v);
    var c = Poly.centroid(v);
    var has = function (set, i) { return !!set && (set === 'all' || set.indexOf(i) >= 0); };
    var listOf = function (set) { var o = []; for (var k = 0; k < n; k++) if (has(set, k)) o.push(k); return o; };
    var sides = listOf(st.measure.sides), angles = listOf(st.measure.angles);
    var sMark = marksBy(L, sides, 15), aMark = marksBy(A, angles, 3);   // half a centimetre, three degrees
    var measuringAngles = !!st.measure.angles;
    var sideText  = !measuringAngles && sMark.groups <= 1;
    var sideTicks = sides.length === n;
    var angleText = aMark.groups <= 1;

    for (var i = 0; i < n; i++) {
      if (has(st.measure.sides, i)) {
        var a = v[i], b = v[(i + 1) % n];
        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        var dx = mx - c.x, dy = my - c.y, len = Math.hypot(dx, dy) || 1;
        var ux = dx / len, uy = dy / len;
        var t = mk('g', { 'class': 'meas', 'data-side': i }, g);
        if (sideText) {
          // AN ICE TAG, SET OFF BY ITS OWN SIZE. The same plate as the name
          // tag; its distance from the side is what keeps its near corner off
          // the stroke — a wide plate beside a steep side needs more room
          // than a plate under a flat one — so nothing touches and nothing
          // crowds.
          var TW = 66, TH = 30;
          var off = 10 + Math.abs(ux) * (TW / 2) + Math.abs(uy) * (TH / 2);
          var lx = mx + ux * off, ly = my + uy * off;
          mk('rect', { x: lx - TW / 2, y: ly - TH / 2, width: TW, height: TH, rx: 10, fill: '#f3fcff', stroke: HI.rim, 'stroke-width': 2.5 }, t);
          mk('text', { x: lx, y: ly + 6, 'text-anchor': 'middle', 'font-size': 17, 'font-weight': 800, fill: '#0f3f8f', text: (L[i] / 30).toFixed(0) + ' cm' }, t);
        }
        if (sideTicks) {
          // the ticks sit across the side at its middle, spaced along it
          var sl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          var tdx = (b.x - a.x) / sl, tdy = (b.y - a.y) / sl;
          var tnx = -tdy, tny = tdx, TL = 9, TS = 7, cnt = sMark.mark[i] || 1;
          for (var k = 0; k < cnt; k++) {
            var o = (k - (cnt - 1) / 2) * TS, cx2 = mx + tdx * o, cy2 = my + tdy * o;
            litLine(t, { x1: cx2 - tnx * TL, y1: cy2 - tny * TL, x2: cx2 + tnx * TL, y2: cy2 + tny * TL, 'stroke-width': 3, 'stroke-linecap': 'round' }, { warm: true });
          }
        }
      }
      if (has(st.measure.angles, i)) drawArc(g, i, angleText ? A[i] : null, aMark.groups > 1 ? (aMark.mark[i] || 1) : 1);
    }
  }
  function drawArc(g, i, deg, rings) {
    // INTO THE MEASUREMENTS GROUP. This said `ag` — itself, before it
    // existed — so every arc and every number was parented to undefined and
    // landed in the ui layer instead, where renderPoly() never clears them.
    // Dragging a corner stacked a fresh set of five numbers on the old ones
    // every frame: the "119°93°" smear over a corner of the distort screen.
    var ag = mk('g', { 'data-angle': i }, g);   // the arc and its number, one thing to pop in
    var v = st.verts, n = v.length, p = v[i], q = v[(i + n - 1) % n], s = v[(i + 1) % n];
    var a1 = Math.atan2(q.y - p.y, q.x - p.x), a2 = Math.atan2(s.y - p.y, s.x - p.x), r = 30;
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
    if (deg != null && Math.abs(deg - 90) < 1.5) {
      // the right-angle square: two short lines meeting inside the corner
      var rs = r * 0.7, ux = Math.cos(a1) * rs, uy = Math.sin(a1) * rs, wx = Math.cos(a2) * rs, wy = Math.sin(a2) * rs;
      d = 'M' + (p.x + ux) + ' ' + (p.y + uy) + ' L' + (p.x + ux + wx) + ' ' + (p.y + uy + wy) + ' L' + (p.x + wx) + ' ' + (p.y + wy);
    }
    var w = mk('path', { d: d, fill: 'none', stroke: HI.line, 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', style: litGlow(HI.lit) }, ag);
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
                 'irregular-quad': '#ffb27a', 'equilateral-concave-hexagon': '#a97bff' };

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
    applySeat(false);
  }

  var BUILD = {
    vista: function () { reset(); },

    polygon: function (spec) {
      var morph = spec.enter === 'morph' && st.verts;
      var prev = morph ? st.verts.slice() : null;
      reset();
      var p = panelFor(spec.panel || 'right', spec);
      st.panel = p; st.kind = 'polygon';
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
      reset(); st.kind = 'compare';
      var sides = [['left', PANELS.left2, spec.left], ['right', PANELS.right2, spec.right]];
      st.compare = {};
      sides.forEach(function (s, i) {
        var pnl = s[1], cfg = s[2] || {};
        var g = panel(pnl, { enter: spec.enter === 'split' ? 'rise' : 'pop' });
        // the caption goes UNDER the card as a name tag, so the shape has the whole face
        var P = polygonIn(pnl, cfg.sides || 5, { dent: cfg.dent, stretch: cfg.stretch });
        var pg = mk('g', {}, layers.poly);
        mk('path', { d: pathOf(P.verts), fill: 'url(#' + candy(SHAPE.fill) + ')', stroke: SHAPE.edge, 'stroke-width': SHAPE.edgeW, 'stroke-linejoin': 'round' }, pg);
        if (cfg.diagonals === 'all') {
          Poly.allDiagonals(P.verts.length).forEach(function (d) {
            var a = P.verts[d[0]], b = P.verts[d[1]];
            var out = !Poly.isDiagonalInside(P.verts, d[0], d[1]);
            litLine(pg, { x1: a.x, y1: a.y, x2: b.x, y2: b.y, 'stroke-width': out ? 5 : 4, 'stroke-dasharray': '10 9', 'stroke-linecap': 'round' }, { bad: out });
          });
        }
        if (cfg.dent != null) mk('circle', { cx: P.verts[cfg.dent].x, cy: P.verts[cfg.dent].y, r: 9, fill: HI.fill, stroke: HI.edge, 'stroke-width': 2.5 }, pg);
        if (cfg.caption) nameTag(layers.ui, pnl.x + pnl.w / 2, pnl.y + pnl.h + 38, cfg.caption, cfg.tone);
        st.compare[s[0]] = { panel: pnl, g: g, pg: pg, verts: P.verts, tone: cfg.tone };
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

      // The card is 192 across and lives in the middle. Zones at 168 left the
      // gap either side of it at exactly nothing — the card's edge and the
      // zone's edge touching, which reads as an overlap and gives a child
      // dragging it nowhere to start from. Pushed out to leave a real corridor.
      // BIG ENOUGH TO BE A PLACE. These are not labels, they are the two
      // halves of the answer and they hold everything the child has sorted so
      // far, so they get real size and a real shelf inside them.
      var ZW = 316, ZH = 340, ZY = TOP;
      [{ id: 'regular', x: 58 },
       { id: 'irregular', x: W - 58 - ZW }].forEach(function (z) {
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
      var bw = 360, gap = 30, bh = 236, by = 282;   // the collection is the point: it gets the room; 360 seats three cards at full size
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
      var p = panelFor('right', Object.assign({ controls: true }, spec)); st.panel = p;
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
    }
  };

  /* ------------------------------------------------------------------ *
   * Swipe classification
   * ------------------------------------------------------------------ */

  var SWIPE_HOME = { x: W / 2, y: 276 };   // level with the middle of the zones

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
      optionCard(at, seat.half, nm);
      if (reduced() || !cell.animate) return;
      cell.style.transformBox = 'fill-box'; cell.style.transformOrigin = 'center';
      if (i === n - 1) {
        // THE NEWEST ONE HAS JUST LANDED — the card flew here at this size —
        // so it settles with a small bounce rather than growing out of nothing.
        cell.animate([{ scale: '1' }, { scale: '1.14', offset: .45 }, { scale: '1' }],
                     { duration: 300, easing: 'cubic-bezier(.3,1.4,.5,1)' });
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
      // The pile has to stay in the corridor between the two zones: they
      // run to x 374 and from x 626, and the card is 192 wide at x 500, so a
      // blank may lean about twenty-five pixels out before its corner is over
      // a zone the child is meant to be dropping into.
      var dxk = (k === 1 ? -1 : 1) * (12 + k * 7), scale = 1 - k * 0.06, rot = (k === 1 ? -1 : 1) * (3 + k * 2);
      var c = mk('g', { opacity: String(0.92 - k * 0.16) }, g);
      optionCard(c, 96, null);   // a blank card: the pile, not the answers
      c.setAttribute('transform', 'translate(' + (SWIPE_HOME.x + dxk) + ',' + (SWIPE_HOME.y + 10 * k) + ') rotate(' + rot + ') scale(' + scale.toFixed(3) + ')');
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
    var card = optionCard(g, 96, name);
    g.setAttribute('transform', 'translate(' + SWIPE_HOME.x + ',' + SWIPE_HOME.y + ')');
    g._name = name;
    // The radius the card actually drew at, not a number typed beside it:
    // these vertices are what Poly.isRegular judges the swipe against.
    g._verts = shapeVerts(name, card._pane.r, card._pane.cx, card._pane.cy);
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
  function whyShape(card) {
    if (!card || !card._verts || reduced()) return null;
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
    var g = mk('g', { 'class': 'why', 'pointer-events': 'none' }, card);

    // the sides, marked in groups of equals
    for (var i2 = 0; i2 < n; i2++) {
      var a = v[i2], b = v[(i2 + 1) % n];
      var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, sl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      var tdx = (b.x - a.x) / sl, tdy = (b.y - a.y) / sl, tnx = -tdy, tny = tdx;
      var cnt = sideM.mark[i2] || 1;
      for (var k = 0; k < cnt; k++) {
        var o = (k - (cnt - 1) / 2) * 6, cx = mx + tdx * o, cy = my + tdy * o;
        litLine(g, { x1: cx - tnx * 7, y1: cy - tny * 7, x2: cx + tnx * 7, y2: cy + tny * 7,
                     'stroke-width': 3, 'stroke-linecap': 'round' }, { warm: true });
      }
    }

    // AND THE CORNERS, when the corners are the reason. Equal angles take
    // the same number of arcs, so "the sides all match but these two corners
    // do not" is a thing the child can see rather than a thing they are told.
    if (verdict !== 'sides') {
      for (var j = 0; j < n; j++) {
        var p = v[j], q = v[(j + n - 1) % n], r2 = v[(j + 1) % n];
        var a1 = Math.atan2(q.y - p.y, q.x - p.x), a2 = Math.atan2(r2.y - p.y, r2.x - p.x);
        var sweep = ((a2 - a1) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        var large = sweep > Math.PI ? 1 : 0;
        var mid = a1 + sweep / 2;
        var inside = Poly.contains(v, { x: p.x + Math.cos(mid) * 6, y: p.y + Math.sin(mid) * 6 });
        var rings = angM.groups > 1 ? (angM.mark[j] || 1) : 1;
        for (var ri = 0; ri < rings; ri++) {
          var rr = 15 - ri * 4; if (rr < 5) break;
          var x1 = p.x + Math.cos(a1) * rr, y1 = p.y + Math.sin(a1) * rr;
          var x2 = p.x + Math.cos(a2) * rr, y2 = p.y + Math.sin(a2) * rr;
          var d2 = inside
            ? 'M' + x1 + ' ' + y1 + ' A' + rr + ' ' + rr + ' 0 ' + large + ' 1 ' + x2 + ' ' + y2
            : 'M' + x1 + ' ' + y1 + ' A' + rr + ' ' + rr + ' 0 ' + (1 - large) + ' 0 ' + x2 + ' ' + y2;
          mk('path', { d: d2, fill: 'none', stroke: '#ffffff', 'stroke-width': 2.4, 'stroke-linecap': 'round',
                       style: litGlow('#ffe27a') }, g);
        }
      }
    }

    if (g.animate) g.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: 'backwards' });
    // AND THE CARD COMES FORWARD WHILE IT EXPLAINS. Small gold ticks on a
    // card the size of a beer mat are not an explanation a seven-year-old
    // will look at; the card lifts toward them for as long as the marks are
    // up, which is the difference between showing and being seen.
    if (card.animate) {
      card.style.transformBox = 'fill-box'; card.style.transformOrigin = 'center';
      try {
        card.animate([{ scale: '1' }, { scale: '1.14', offset: 0.12 }, { scale: '1.14', offset: 0.82 }, { scale: '1' }],
                     { duration: 2100, easing: 'cubic-bezier(.3,1.2,.4,1)' });
      } catch (x) {}
    }
    later(1700, function () {
      if (!g.parentNode) return;
      var fade = g.animate ? g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' }) : null;
      var go = function () { if (g.parentNode) g.parentNode.removeChild(g); };
      if (fade && fade.finished) fade.finished.then(go, go); else go();
    });
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
  function optionCard(parent, half, name) {
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
    var r = Math.min(paneW, paneH) / 2 * 0.86;

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
      if (state === 'correct' && global.Juice && Juice.confetti && !reduced()) {
        try { Juice.confetti(g, { count: 46, fromEdge: true, speed: 0.62 }); } catch (e) {}
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

    g._pane = { cx: cx, cy: cy, r: r };
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
     unreadable, so each of these carries its own ink as a third value. Sun
     and tangerine come first because two options is by far the commonest
     row, and a yellow button beside an orange one is unmistakably a pair of
     buttons. */
  var NEUTRAL = ['sun', 'tangerine', 'sky', 'plum'];

  /* [face, lip, ink] — ink optional, white when absent. */
  var PILL_TONES = {
    correct:   EVAL.yes,
    wrong:     EVAL.no,
    sun:       ['#ffc53d', '#c07a00', '#5a3400'],
    tangerine: ['#ff9138', '#bf5200', '#5a2300'],
    sky:       ['#4f9df5', '#2b6fc4'],
    plum:      ['#b271d8', '#7a3c9c'],
    blue:      ['#4f9df5', '#2b6fc4']
  };
  Object.keys(CONCEPT).forEach(function (k) {
    PILL_TONES[k] = [CONCEPT[k].face, CONCEPT[k].deep];
  });

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
  function nameTag(parent, x, y, text, tone) {
    var c = CONCEPT[tone] || null;
    var g = mk('g', { 'class': 'badge' }, parent);
    var H0 = 50;
    var probe = mk('text', { x: x, y: y + 9, 'text-anchor': 'middle', 'font-size': 26, 'font-weight': 900,
                             fill: c ? c.ink : '#0b3f7a', text: text }, g);
    var w = 0; try { w = probe.getComputedTextLength ? probe.getComputedTextLength() : 0; } catch (e) { w = 0; }
    if (!w) w = text.length * 14;
    var bw = w + 52, bx = x - bw / 2, by = y - H0 / 2;
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
   * THE ARTWORK, IN THREE PIECES. assets/ui/btn.png is a sheet of
   * finished buttons; tools/build-buttons.js cuts the four this lesson needs
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
    var DARK_ON = { sun: 1, tangerine: 1, concave: 1, sky: 1, convex: 1, regular: 1 };
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
    put(x, cap, 0, B.cap);                                   // left cap
    put(x + cap, w - cap * 2, B.cap, B.w - B.cap * 2);        // the stretch
    put(x + w - cap, cap, B.w - B.cap, B.cap);                // right cap
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
        if (st.panel && lceil == null) {
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
          var tw = (String(l.text).length * 15) + 36, th = 40;
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
          for (var guard = 0; guard < 14 && hits(x, y); guard++) { x += ox * 14; y += oy * 14; }
          // on the stage, whatever happened: the rim is fair game, the edge is not
          x = Math.max(tw / 2 + 12, Math.min(W - tw / 2 - 12, x));
          y = Math.max(46, Math.min(BOTTOM - 14, y));
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
        // from just outside the plate to just short of the side, in the
        // highlight's own colour, so the word and the thing are one idea
        var dx = m.x - x, dy = m.y - y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        var from = 30, to = 14;
        mk('line', {
          x1: x + dx / d * from, y1: y + dy / d * from - 8,
          x2: m.x - dx / d * to, y2: m.y - dy / d * to,
          stroke: HI.rim, 'stroke-width': 3.5, 'stroke-linecap': 'round'
        }, g);
        // the pin, where the string meets the thing
        mk('circle', { cx: m.x - dx / d * to, cy: m.y - dy / d * to, r: 5, fill: '#f3fcff', stroke: HI.rim, 'stroke-width': 2.5 }, g);
      }
      st.labelEl = g; if (l.enter && !reduced()) enter(g, 'pop');
    },
    badge: function (b) {
      var key = b.under || 'main';
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
      if (b.enter && !reduced()) enter(g, 'pop');
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
        st.diagonals = Poly.allDiagonals(st.n).map(function (pair, k) { return Object.assign(pair, { animate: d.animate === 'sequential', delay: k * (d.each || 200) }); });
        st.segment = null; st.vcolor = null; renderPoly();
      }
    },
    choices: function (list) {
      if (st.choiceG) { st.choiceG.remove(); st.choiceG = null; }
      if (!list) return;
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
        var b = pill(g, {
          x: x, y: y, w: bw, h: bh, label: label,
          tone: 'sun',
          press: true, attrs: { 'class': 'choice', 'data-label': label }
        });
        st.choiceEls.push(b);
        if (!reduced()) { b.style.opacity = 0; later(90 * i, function () { b.style.opacity = 1; enter(b, 'rise'); }); }
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
    stepper: function (s) { if (s === 'locked' && st.stepMinus) { st.stepMinus.style.opacity = .35; st.stepPlus.style.opacity = .35; st.stepLocked = true; } },
    measurements: function (m) { if (m === 'live') { st.measure = { sides: 'all', angles: 'all' }; renderPoly(); } }
  };

  function apply(spec) {
    if (!spec) return;
    if (spec.kind) BUILD[spec.kind] && BUILD[spec.kind](spec);
    if (spec.highlight) op.highlight(spec.highlight);
    if (spec.draw) op.draw(spec.draw);
    if (spec.diagonals && !spec.kind) op.diagonals(spec);
    if ('ghost' in spec && !spec.kind) op.ghost(spec.ghost);
    if (spec.label && !spec.kind) op.label(spec.label);
    // a carried name tag is taken down by a beat that says label: null
    if (spec.label === null && st.labelEl) { st.labelEl.remove(); st.labelEl = null; }
    if (spec.badge && !spec.kind) op.badge(spec.badge);
    if ('choices' in spec) op.choices(spec.choices);
    if (spec.stepper && typeof spec.stepper === 'string') op.stepper(spec.stepper);
    if (spec.measurements) op.measurements(spec.measurements);
    if (spec.returnItem && st.sort && st.sort.dragging) returnItem(st.sort.dragging);
    if (spec.kind) applySeat(false);
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
    return [];
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
      });
      return;
    }
    els.forEach(function (e) {
      if (!e) return;
      if (e.classList && e.classList.contains('vertex')) { e.setAttribute('opacity', 1); e.setAttribute('r', 15); }
      if (reduced() || !e.animate) return;
      e.style.transformBox = 'fill-box'; e.style.transformOrigin = 'center';
      e.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 900, iterations: 3, easing: 'ease-in-out' });
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
  function dragVertex(i, moveFn, upFn, ctx) { return dragVertices([i], moveFn, upFn, ctx); }

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
        // all of them: any corner is a vertex, and breathing one would have
        // been an answer rather than an invitation
        hintLoop(function () { return pulseHint((st.knobEls || []).slice()); });
        st.vertEls.forEach(function (c, i) {
          c.style.cursor = 'pointer';
          on(c, 'pointerdown', function (e) {
            e.preventDefault();
            st.picked = i; st.lastEl = knobOf(i) || c; st.vcolor = {}; st.vcolor[i] = HI.fill; st.showVerts = false; renderPoly();
            endInteraction(); resolve({ result: 'correct', vertex: i });
          });
        });
        if (ctx && ctx.onCancel) ctx.onCancel(endInteraction);
      });
    },

    'drag-endpoint': function (spec, ctx) {
      return new Promise(function (resolve) {
        if (global.Input) Input.mode('polygon');
        // The segment is drawn on the screen before; entered without one —
        // a jump, a restart — the picked vertex and its neighbour stand in.
        if (!st.segment) { var p0 = st.picked == null ? 0 : st.picked; st.segment = [p0, (p0 + 1) % st.n]; renderPoly(); }
        var from = st.segment[0], moving = st.segment[1];
        var ghostLine = mk('line', { x1: st.verts[from].x, y1: st.verts[from].y, x2: st.verts[moving].x, y2: st.verts[moving].y, stroke: HI.line, 'stroke-width': 5, 'stroke-linecap': 'round', opacity: 0 }, layers.fx);
        // the gesture: the endpoint slides to a vertex it may be dropped on
        hintLoop(function () {
          if (!st.segment) return null;
          var gt = Poly.diagonalsFrom(from, st.n).filter(function (j) { return j !== moving; })[0];
          return gt != null ? gestureGhost(st.verts[moving], st.verts[gt], { r: 11 }) : null;
        });
        dragVertex(moving, function (p) {
          ghostLine.setAttribute('opacity', 1); ghostLine.setAttribute('x2', p.x); ghostLine.setAttribute('y2', p.y);
          if (st.segLine) st.segLine.setAttribute('opacity', .25);
        }, function (p) {
          ghostLine.remove();
          var j = nearestVertex(p, from);
          if (j < 0) {
            // dropped in space: not a wrong answer, but not nothing either
            if (st.segLine) st.segLine.setAttribute('opacity', 1);
            missedCorner(Poly.diagonalsFrom(from, st.n));
            return;
          }
          var ok = !Poly.isAdjacent(from, j, st.n);
          endInteraction();
          if (ok) {
            // the side stays where it was; the drag has made a second line
            st.sideMark = [from, moving];
            st.diagonals = st.diagonals || []; st.diagonals.push(Object.assign([Math.min(from, j), Math.max(from, j)], { solid: true }));
            st.segment = null; st.vcolor = {}; st.vcolor[from] = HI.fill; st.vcolor[j] = HI.fill; renderPoly(); st.lastEl = st.polyG;
            resolve({ result: 'correct', vertex: j });
          } else { st.lastEl = st.vertEls[j]; renderPoly(); resolve({ result: 'wrong', vertex: j }); }
        }, ctx);
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
        hintLoop(function () {
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
            var np = Poly.clampSimple(st.verts, i, p);
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
            if (judge(i)) {
              done = true; st.lastEl = st.polyG; endInteraction();
              // the vertex they moved keeps its knob: the dent IS a vertex
              st.vcolor = {}; st.vcolor[i] = HI.fill;
              // the dent is made: the diagonals that stayed inside step back,
              // and the one that went outside is the whole picture
              if (spec.live === 'diagonals') st.onlyOutside = true;
              renderPoly(); resolve({ result: 'correct', vertex: i });
              return;
            }
            var moved = Math.hypot(st.verts[i].x - from.x, st.verts[i].y - from.y);
            if (moved < 6) return;
            st.lastEl = knobOf(i) || st.polyG;
            juice('refuse', knobOf(i) || st.polyG);
            // a dent too shallow to see gets the reason, not a bare "no"
            onTap('wrong', spec.until === 'concave' ? { t: 'Pull it in more!', vo: 'fb11' } : null);
          }, ctx);
      });
    },

    choice: function (spec, ctx) {
      return new Promise(function (resolve) {
        if (global.Input) Input.mode('polygon');
        (st.choiceEls || []).forEach(function (b) {
          // THE HAND COMES BACK FOR A RETRY. endInteraction() strips every
          // cursor when an answer lands; the retry input arms the same
          // buttons again, and they must look live again — a child reads a
          // button with no hand and no change as a button that is finished.
          b.style.cursor = 'pointer';
          on(b, 'pointerdown', function (e) {
            e.preventDefault(); st.lastEl = b;
            var ok = b.getAttribute('data-label') === spec.correct;
            // _retint, not firstChild: a pill draws its LIP first, so setting
            // a fill on the first child recoloured the three-pixel shadow
            // under the button and left the face it sits on untouched.
            if (ok && b._retint) b._retint('correct');
            if (!ok && b._retint) {
              // the wrong one flushes red for a moment and comes back, so
              // the child sees which they pressed and that it is still there
              b._retint('wrong');
              later(650, function () { if (b._retint) b._retint('sun'); });
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

        var W_CARD = 192;
        var THRESHOLD = W_CARD * 0.22;
        var resolving = false, dragging = false, demo = null;
        var startX = 0, startY = 0, dx = 0, pid = null;

        function place(card, x, rot, scale) {
          card.setAttribute('transform',
            'translate(' + (SWIPE_HOME.x + x) + ',' + SWIPE_HOME.y + ') rotate(' + rot.toFixed(2) + ')' +
            (scale ? ' scale(' + scale + ')' : ''));
        }

        function sideOf(x) { return x < -THRESHOLD ? 'regular' : x > THRESHOLD ? 'irregular' : null; }
        // the tilt the card is drawn at for a given pull, the same in the
        // drag and in the flight that follows it
        function tiltOf(x) { return Math.max(-1, Math.min(1, x / (THRESHOLD * 2.2))) * 6; }

        /* ---- the one submission path ---- */
        function classify(answer) {
          if (resolving || !answer || !sw.card) return;
          stopDemo();
          resolving = true;
          var card = sw.card;
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
            var pulled = dx, tilt = tiltOf(dx);
            place(card, 0, 0);   // the pull moves into the flight
            var seat = zone ? shelfSeats(zone, zone._kept.length + 1)[zone._kept.length] : null;
            var tx = seat ? seat.x : SWIPE_HOME.x, ty = seat ? seat.y : SWIPE_HOME.y;
            var k = seat ? seat.half / 96 : 0.4;
            var ox = tx - SWIPE_HOME.x, oy = ty - SWIPE_HOME.y;
            var fly = card.animate
              ? card.animate([
                  { translate: pulled + 'px 0', rotate: tilt + 'deg', scale: '1' },
                  { translate: ((pulled + ox) * 0.5) + 'px ' + (Math.min(0, oy) * 0.5 - 46) + 'px', rotate: (tilt * 0.5) + 'deg', scale: String((1 + k) * 0.5 + 0.08), offset: 0.5 },
                  { translate: ox + 'px ' + oy + 'px', rotate: '0deg', scale: String(k) }
                ], { duration: 520, easing: 'cubic-bezier(.3,.75,.3,1)', fill: 'forwards' })
              : null;
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
              });
            };
            if (fly && fly.finished) fly.finished.then(after, after); else after();
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
            // a nudge toward the side they chose, then home again
            var pulledBack = dx, tiltBack = tiltOf(dx);
            place(card, 0, 0);   // the pull moves into the animation
            var back = card.animate
              ? card.animate([
                  { translate: pulledBack + 'px 0', rotate: tiltBack + 'deg' },
                  { translate: (dir * Math.max(Math.abs(pulledBack), 70) + dir * 22) + 'px 0', rotate: (dir * 7) + 'deg', offset: 0.42 },
                  { translate: '0 0', rotate: '0deg' }
                ], { duration: 520, easing: 'cubic-bezier(.3,.9,.35,1)' })
              : null;
            var reset2 = function () {
              dx = 0; place(card, 0, 0);
              leanZone(null, false);
              resolving = false;
            };
            if (back && back.finished) back.finished.then(reset2, reset2); else reset2();
          }
        }

        /* ---- the demonstration, first round only ---- */
        function runDemo() {
          if (reduced() || !sw.card || !sw.card.animate || sw.i !== 0) return;
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
          ], { duration: 3400, iterations: Infinity, easing: 'ease-in-out' });
        }
        function stopDemo() {
          if (demo) { try { demo.cancel(); } catch (e) {} demo = null; }
          if (sw.ghost) { try { sw.ghost.remove(); } catch (e) {} sw.ghost = null; }
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
          dx = 0; if (sw.card) place(sw.card, 0, 0);
          if (sw.card && sw.card.animate && !reduced()) {
            sw.card.animate([{ translate: pulledHome + 'px 0', rotate: tiltHome + 'deg' }, { translate: '0 0', rotate: '0deg' }],
                            { duration: 260, easing: 'cubic-bezier(.3,1.4,.5,1)' });
          }
        }
        function onCancel() {
          if (!dragging) return;
          dragging = false;
          leanZone(null, false);
          dx = 0; if (sw.card) { place(sw.card, 0, 0); sw.card.style.cursor = 'grab'; }
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
          runDemo();
        }

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
        hintLoop(function () {
          return pulseHint(st.cards.filter(function (c) { return !c._done; }));
        });
        st.cards.forEach(function (c) {
          c.style.cursor = 'pointer';
          on(c, 'pointerdown', function (e) {
            e.preventDefault(); if (c._done) return; st.lastEl = c;
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
        cleanup.push(function () { cancelled = true; queue.length = 0; });
        st.measure = st.measure || {}; st.measure[isSides ? 'sides' : 'angles'] = [];
        st.showVerts = !isSides; st.touchVerts = !isSides; renderPoly();
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
        hintLoop(function () {
          if (!st.verts || st.verts.length < 2) return null;
          var k = 0; while (k < st.verts.length && seen[k]) k++;
          if (k >= st.verts.length) return null;
          var g0 = st.verts[k], g1 = st.verts[(k + 1) % st.verts.length];
          void g1;
          // a side has no body to swell — the .edge.hint glow along the line
          // is its pulse — so only the corners are breathed here
          return isSides ? null : pulseHint((st.knobEls || []).filter(function (_, q) { return !seen[q]; }));
        });
        // Delegated: renderPoly() runs after every reveal.
        on(st.polyG, 'pointerdown', function (e) {
          var t = e.target; if (!t || !t.classList || !t.classList.contains(cls)) return;
          var i = +t.getAttribute('data-i'); if (seen[i]) return;
          e.preventDefault(); seen[i] = true;
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
            onTap('correct'); measuring = false;
            if (count >= need) { endInteraction(); resolve({ result: 'correct' }); }
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
        hintLoop(function () {
          var first = S.items.filter(function (it) { return !it._placed; })[0];
          if (!first || !S.bins || !S.bins.length) return null;
          var b0 = S.bins[0]._rect, b1 = S.bins[S.bins.length - 1]._rect;
          var gapX = (b0.x + b0.w + b1.x) / 2, home = first._pos || first._home;
          return gestureGhost(home, { x: gapX, y: b0.y + 40 }, { clone: first, trail: false, duration: 2600 });
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
          onTap('any');
          if (n === spec.target) { endInteraction(); resolve({ result: 'correct' }); }
        }
        on(st.stepMinus, 'pointerdown', function (e) { e.preventDefault(); if (!st.stepLocked) set(st.n - 1); });
        on(st.stepPlus, 'pointerdown', function (e) { e.preventDefault(); if (!st.stepLocked) set(st.n + 1); });
        if (ctx && ctx.onCancel) ctx.onCancel(endInteraction);
      });
    }
  };

  function drawDiagonals(spec, count, ctx) {
    return new Promise(function (resolve) {
      if (global.Input) Input.mode('polygon');
      var from = spec.from === 'picked' ? (st.picked == null ? 0 : st.picked) : spec.from;
      st.picked = from; st.vcolor = {}; st.vcolor[from] = HI.fill; st.showVerts = true; st.touchVerts = true; renderPoly();
      var made = 0, active = false;
      var rubber = mk('line', { x1: st.verts[from].x, y1: st.verts[from].y, x2: st.verts[from].x, y2: st.verts[from].y, stroke: HI.line, 'stroke-width': 5, 'stroke-linecap': 'round', opacity: 0 }, layers.fx);
      function used(j) { var k = [Math.min(from, j), Math.max(from, j)].join('-'); return (st.diagonals || []).some(function (d) { return d.join('-') === k; }); }
      // THE MOVE, SHOWN. This screen asks for a gesture the child has made
      // once, two screens ago, and showed them nothing: a lit corner and a
      // sentence. A ghost runs from the corner out to a corner it may be
      // joined to, and goes again until they touch the stage. It gives no
      // answer away — every non-adjacent corner is a diagonal, and this
      // screen wants all of them.
      hintLoop(function () {
        var t = Poly.diagonalsFrom(from, st.n).filter(function (j) { return !used(j); })[0];
        return t == null ? null : gestureGhost(st.verts[from], st.verts[t], { r: 11 });
      });
      // Delegated: the source vertex element is rebuilt after each diagonal.
      on(st.polyG, 'pointerdown', function (e) {
        var t = e.target; if (!t || !t.classList || !t.classList.contains('vertex') || +t.getAttribute('data-i') !== from) return;
        if (global.Input && Input.guarded) return;
        active = true; e.preventDefault(); rubber.setAttribute('opacity', 1);
      });
      on(svg, 'pointermove', function (e) { if (!active) return; var p = pt(e); rubber.setAttribute('x2', p.x); rubber.setAttribute('y2', p.y); });
      on(svg, 'pointerup', function (e) {
        if (!active) return; active = false; rubber.setAttribute('opacity', 0);
        var j = nearestVertex(pt(e), from);
        if (j < 0) {
          missedCorner(Poly.diagonalsFrom(from, st.n).filter(function (k) { return !used(k); }));
          return;
        }
        var ok = !Poly.isAdjacent(from, j, st.n) && !used(j);
        st.lastEl = knobOf(j) || st.vertEls[j];
        if (ok) {
          st.diagonals = st.diagonals || []; st.diagonals.push(Object.assign([Math.min(from, j), Math.max(from, j)], { solid: true })); st.ghost = null; renderPoly(); made++;
          if (count > 1) onTap('correct');
          if (made >= count) { rubber.remove(); endInteraction(); resolve({ result: 'correct' }); }
        } else { if (count > 1) onTap('wrong'); else { rubber.remove(); endInteraction(); resolve({ result: 'wrong' }); } }
      });
      if (ctx && ctx.onCancel) ctx.onCancel(function () { rubber.remove(); endInteraction(); });
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
    var sel = ((opts && opts.glass) ? '' : '.panel, ') + '.polygon, .meas, .card, .sort-item, .bin, .choice, .stepper, .shape, .badge';
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
    peekAnchor: function () {
      if (st.panel) return seatY ? Object.assign({}, st.panel, { y: st.panel.y + seatY }) : st.panel;
      if (st.compare) {
        // the card the lesson is looking at — the one glowing — else the left
        var k = st.compareFocus && st.compare[st.compareFocus] ? st.compareFocus : 'left';
        if (st.compare[k] && st.compare[k].panel) return st.compare[k].panel;
      }
      if (st.swipe && st.swipe.zones && st.swipe.zones.regular && st.swipe.zones.regular._rect) {
        // the swipe practice: he comes up behind the Regular zone's rim,
        // left of the plank, and drops back before the cards are dealt
        return Object.assign({ frame: 'regular' }, st.swipe.zones.regular._rect);
      }
      return null;
    },
    onTap: function (fn) { onTap = fn || function () {}; },
    /** A plank-free screen lifts a lone card to the centre; a plank seats it under the band. Animated. */
    seat: function (free) { plankFree = !!free; applySeat(true); },
    get seatY() { return seatY; },
    flurry: flurry, alive: alive,
    /* How many delayed callbacks from a finished scene have been refused.
       A test reads this: a suppression mechanism that never suppresses
       anything looks exactly like one that was never wired up. */
    get staleSuppressed() { return staleSuppressed; },
    get pendingTimers() { return sceneTimers.length; },
    get svg() { return svg; }, get state() { return st; },
    shapeVerts: shapeVerts
  };
  global.Stage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : this);
