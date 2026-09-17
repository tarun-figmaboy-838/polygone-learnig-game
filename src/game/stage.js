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
    var m = svg.getScreenCTM(); return m ? p.matrixTransform(m.inverse()) : { x: 0, y: 0 };
  }
  function on(el, ev, fn, opts) { el.addEventListener(ev, fn, opts); cleanup.push(function () { el.removeEventListener(ev, fn, opts); }); }
  function endInteraction() { cleanup.splice(0).forEach(function (f) { f(); }); }
  function pathOf(v) { return v.map(function (p, i) { return (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' ') + ' Z'; }
  function juice(name, el, o) { if (global.Juice && el && Juice[name]) Juice[name](el, o); }
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
      '<linearGradient id="snowlit" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
      '<radialGradient id="sun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="vignette" cx=".5" cy=".45" r=".75"><stop offset=".6" stop-color="#0a2a4a" stop-opacity="0"/><stop offset="1" stop-color="#0a2a4a" stop-opacity=".16"/></radialGradient>' +
      // the panel: a slab of ice, lit from above
      '<linearGradient id="panelFace" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".93"/><stop offset=".55" stop-color="#f2fbff" stop-opacity=".88"/><stop offset="1" stop-color="#d9eefb" stop-opacity=".9"/></linearGradient>' +
      '<linearGradient id="panelSheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".85"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>';

    mk('rect', { width: W, height: H, fill: 'url(#sky)' }, layers.bg);

    var img = mk('image', {
      x: 0, y: 0, width: W, height: H,
      preserveAspectRatio: 'xMidYMid slice',
      'class': 'vista'
    }, layers.bg);
    // href for SVG 2, xlink:href for the engines that still want it.
    img.setAttribute('href', VISTA_SRC);
    img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', VISTA_SRC);

    ambientLife();


    // A soft vignette ties the panels and Swiftee to the painting instead of
    // letting them float on top of it.
    mk('rect', { width: W, height: H, fill: 'url(#vignette)', 'pointer-events': 'none' }, layers.bg);
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

  var PANELS = {
    // THE NEXT BUTTON LIVES IN THE BOTTOM-RIGHT CORNER, always, over the
    // stage. At h:460 this slab ran to y 520 and Next starts at 493, so on
    // every screen that offers Next the button sat on the corner of the
    // lesson — a fixed number against a fixed number, wrong everywhere.
    // y 100, not 60: the instruction plank occupies the top band of every
    // screen now, and at 60 this slab ran up underneath it. Height comes down
    // with it so the foot still clears the Next button.
    right:  { x: 500, y: TOP, w: 460, h: 365 },
    // WITHOUT HIM, THE LESSON TAKES THE MIDDLE. The right-hand slab exists
    // to leave the bottom-left to Swiftee. On the twenty-eight screens he is
    // not on, it left half the screen to nobody; this is what a 'right'
    // request becomes when he is off.
    // Nearly square, because the thing it frames nearly is: a 600-wide slab
    // around a pentagon was two thirds glass, and the shape read as small.
    solo:   { x: 270, y: TOP, w: 460, h: 365 },
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
    left2:  { x: 178, y: 150, w: 306, h: 290, frame: 'compare' },
    right2: { x: 516, y: 150, w: 306, h: 290, frame: 'compare' }
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
    if (p === PANELS.right && !standsLeft) p = PANELS.solo;
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
    var mx = face.w * 0.03, mt = face.h * 0.03;
    // Room for what is drawn beneath it, and none when nothing is.
    var mb = opts.below ? face.h * 0.2 : face.h * 0.03;
    // A SHAPE THAT WILL BE MEASURED keeps a margin all round: the readings
    // sit outside its sides, and the measurer walks outside them too, and
    // both have to stay on the glass.
    if (opts.room === 'measure') { mx = face.w * 0.11; mt = face.h * 0.15; mb = Math.max(mb, face.h * 0.15); }
    var box = { x: face.x + mx, y: face.y + mt, w: face.w - mx * 2, h: face.h - mt - mb };

    // Built at unit size WITH its deformations, so what gets measured is what
    // gets drawn: a dented or stretched shape has a different bounding box
    // from the regular one it started as.
    var u = Poly.regular(n, 1, 0, 0);
    if (opts.dent != null) u = Poly.pullInward(u, opts.dent, 0.72);
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
    var k = Math.min((box.w - VERT_PAINT * 2) / (hi.x - lo.x),
                     (box.h - VERT_PAINT * 2) / (hi.y - lo.y)) * fill;

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

    st.fill = mk('path', { d: pathOf(v), fill: SHAPE.fill, stroke: SHAPE.edge, 'stroke-width': SHAPE.edgeW, 'stroke-linejoin': 'round' }, g);

    // diagonals
    st.diagG = mk('g', {}, g);
    (st.diagonals || []).forEach(function (d, k) {
      var a = v[d[0]], b = v[d[1]];
      var outside = !Poly.isDiagonalInside(v, d[0], d[1]);
      var hl = st.highlightOutside && outside;
      var line = mk('line', {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        stroke: hl ? '#ff2a2a' : (d.solid ? '#ffe600' : '#ffffff'),
        'stroke-width': hl || d.solid ? 6 : 4, 'stroke-linecap': 'round',
        'stroke-dasharray': d.solid ? null : '14 12'
      }, st.diagG);
      if (d.animate && !reduced()) {
        var len = Math.hypot(b.x - a.x, b.y - a.y);
        line.style.strokeDasharray = len; line.style.strokeDashoffset = len;
        line.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 380, delay: (d.delay || 0), fill: 'forwards' })
          .finished.then(function () { if (!d.solid) { line.style.strokeDasharray = '14 12'; } line.style.strokeDashoffset = 0; });
      }
    });

    // ghost
    if (st.ghost) {
      var ga = v[st.ghost.from], gb = v[st.ghost.to];
      mk('line', { x1: ga.x, y1: ga.y, x2: gb.x, y2: gb.y, stroke: '#fff', 'stroke-width': 4, 'stroke-dasharray': '14 12', opacity: .85 }, g);
    }

    // highlighted segment (side or new diagonal)
    if (st.segment) {
      var sa = v[st.segment[0]], sb = v[st.segment[1]];
      st.segLine = mk('line', { x1: sa.x, y1: sa.y, x2: sb.x, y2: sb.y, stroke: '#ffe600', 'stroke-width': 7, 'stroke-linecap': 'round' }, g);
    }

    // edges as tap targets (invisible, wide)
    st.edgeEls = [];
    for (var i = 0; i < n; i++) {
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
    st.vertEls = [];
    var touch = !!st.touchVerts;
    for (var j = 0; j < n; j++) {
      var col = st.vcolor && st.vcolor[j] ? st.vcolor[j] : null;
      var c = mk('circle', {
        cx: v[j].x, cy: v[j].y,
        // A handle is a knob on a corner, not a coin on it: fifteen units
        // is still thirty-plus device pixels to a finger at every size the
        // game runs at, and reads as part of the shape rather than over it.
        r: col ? 13 : (touch ? 15 : 9),
        fill: col || (touch ? '#fff8e7' : SHAPE.edge),
        stroke: col ? '#5a4a00' : (touch ? '#6b3400' : 'none'),
        'stroke-width': col ? 2 : (touch ? 3 : 2),
        'class': 'vertex', 'data-i': j,
        opacity: col || st.showVerts ? 1 : 0
      }, g);
      if (touch) c.style.pointerEvents = 'all';
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
      var lines = st.diagG.childNodes;
      for (i = 0; i < lines.length && i < (st.diagonals || []).length; i++) {
        var d = st.diagonals[i], a = v[d[0]], b = v[d[1]], L = lines[i];
        L.setAttribute('x1', a.x); L.setAttribute('y1', a.y); L.setAttribute('x2', b.x); L.setAttribute('y2', b.y);
        var out = !Poly.isDiagonalInside(v, d[0], d[1]);
        var hl = st.highlightOutside && out;
        L.setAttribute('stroke', hl ? '#ff2a2a' : (d.solid ? '#ffe600' : '#ffffff'));
        L.setAttribute('stroke-width', hl || d.solid ? 6 : 4);
        L.style.strokeDasharray = d.solid ? '' : '14 12'; L.style.strokeDashoffset = 0;
      }
    }
    if (st.segLine && st.segment) { var sa = v[st.segment[0]], sb = v[st.segment[1]]; st.segLine.setAttribute('x1', sa.x); st.segLine.setAttribute('y1', sa.y); st.segLine.setAttribute('x2', sb.x); st.segLine.setAttribute('y2', sb.y); }
    for (i = 0; i < n && st.edgeEls; i++) { var e1 = v[i], e2 = v[(i + 1) % n], E = st.edgeEls[i]; if (!E) continue; E.setAttribute('x1', e1.x); E.setAttribute('y1', e1.y); E.setAttribute('x2', e2.x); E.setAttribute('y2', e2.y); }
    for (i = 0; i < n && st.vertEls; i++) { var C = st.vertEls[i]; if (!C) continue; C.setAttribute('cx', v[i].x); C.setAttribute('cy', v[i].y); }
    if (st.measG) { while (st.measG.firstChild) st.measG.removeChild(st.measG.firstChild); if (st.measure) drawMeasurements(st.measG); }
  }

  // Actual measuring frames, kept upright and entirely outside the edge.
  // Both the tape and the character use SVG coordinates, including on resize.
  function measureSide(index, done) {
    var frames = global.MeasuringFrames;
    if (reduced() || !frames || !global.requestAnimationFrame) { done(); return; }
    var a = st.verts[index], b = st.verts[(index + 1) % st.verts.length];
    if (a.x > b.x) { var swap = a; a = b; b = swap; }
    var dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (length < 1) { done(); return; }
    var angle = Math.atan2(dy, dx) * 180 / Math.PI;
    var center = Poly.centroid(st.verts), nx = -dy / length, ny = dx / length;
    if (nx * ((a.x + b.x) / 2 - center.x) + ny * ((a.y + b.y) / 2 - center.y) < 0) { nx = -nx; ny = -ny; }
    var cell = 72, baseline = cell * frames.baseline / frames.cell;
    // Minimum projection of the full upright sprite box onto the outward
    // normal. This keeps every pixel outside, even along the bottom edge.
    var clearance = 9 + Math.abs(nx) * cell / 2 + Math.max(0, ny * baseline) + Math.max(0, -ny * (cell - baseline));
    var g = mk('g', { 'class': 'swiftee-measuring', 'pointer-events': 'none', 'aria-hidden': 'true', 'data-side': index }, layers.fx);
    g.style.opacity = '0';   // nothing at the side until he has flown there
    var tapeG = mk('g', { transform: 'translate(' + (a.x + nx * 7) + ',' + (a.y + ny * 7) + ') rotate(' + angle + ')' }, g);
    var tape = mk('rect', { x: 0, y: -4, width: 0, height: 8, rx: 2, fill: '#ffe278', stroke: '#875b13', 'stroke-width': 1.2 }, tapeG);
    var ticks = mk('g', {}, tapeG), marks = [];
    for (var x = 0; x <= length; x += 6) {
      marks.push(mk('line', { x1: x, x2: x, y1: -4, y2: x % 30 === 0 ? 3 : 0,
        stroke: '#65491f', 'stroke-width': 1, visibility: 'hidden' }, ticks));
    }
    mk('path', { d: 'M0,-7 L0,7 L5,7', fill: 'none', stroke: '#586c7c', 'stroke-width': 3 }, tapeG);
    var lead = mk('path', { fill: 'none', stroke: '#d7a530', 'stroke-width': 3, 'stroke-linecap': 'round' }, g);
    var walker = mk('g', { 'class': 'measuring-walker' }, g);
    var crop = mk('svg', { x: -cell / 2, y: -baseline, width: cell, height: cell,
      viewBox: '0 0 ' + frames.cell + ' ' + frames.cell, overflow: 'hidden' }, walker);
    var sheet = mk('image', { href: frames.image, width: frames.cols * frames.cell, height: frames.rows * frames.cell }, crop);
    var companion = global.Swiftee && Swiftee.el;
    var opacity = companion && companion.style.opacity;
    var raf = null, started = null, stopped = false;
    var duration = Math.max(1100, Math.min(1800, length * 7));

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
    var page = function (x, y) { return M ? { x: M.a * x + M.e, y: M.d * y + M.f } : null; };
    var flies = !!(companion && companion.animate && global.Swiftee.bounds && parseFloat(opacity || '0') > 0.05 && M);
    var here = null, hb = flies && Swiftee.bounds();
    if (hb && hb.width) here = { x: (hb.left + hb.right) / 2, y: hb.bottom }; else flies = false;
    var startAt = page(a.x + nx * clearance, a.y + ny * clearance);
    var endAt = page(b.x + nx * clearance, b.y + ny * clearance);
    function fly(fromD, toD, fadeIn) {
      return new Promise(function (res) {
        var an;
        try {
          an = companion.animate([
            { translate: fromD.x.toFixed(0) + 'px ' + fromD.y.toFixed(0) + 'px', opacity: fadeIn ? 0 : 1 },
            { translate: toD.x.toFixed(0) + 'px ' + toD.y.toFixed(0) + 'px', opacity: fadeIn ? 1 : 0 }
          ], { duration: 420, easing: 'cubic-bezier(.3,.7,.3,1)', composite: 'add', fill: 'none' });
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
      tape.setAttribute('width', distance);
      marks.forEach(function (mark, i) { mark.setAttribute('visibility', i * 6 <= distance ? 'visible' : 'hidden'); });
      var px = a.x + dx * progress, py = a.y + dy * progress;
      var wx = px + nx * clearance, wy = py + ny * clearance;
      // FACING THE SIDE. The sheet walks to the right; on a side whose
      // outside is to the right of the shape that had him walking away from
      // the thing he was measuring. Mirrored there, he faces it.
      var faceLeft = nx > 0.25;
      walker.setAttribute('transform', 'translate(' + wx + ',' + wy + ')' + (faceLeft ? ' scale(-1,1)' : ''));
      var frame = frames.order[Math.floor(Math.min(elapsed, duration) * frames.fps / 1000) % frames.order.length];
      sheet.setAttribute('x', -(frame % frames.cols) * frames.cell);
      sheet.setAttribute('y', -Math.floor(frame / frames.cols) * frames.cell);
      walker.setAttribute('data-frame', frame);
      lead.setAttribute('d', 'M' + (px + nx * 7) + ',' + (py + ny * 7) + ' L' + (wx + (faceLeft ? -30 : 30)) + ',' + (wy - 24));
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

  function drawMeasurements(g) {
    var v = st.verts, n = v.length, L = Poly.sideLengths(v), A = Poly.interiorAngles(v);
    var c = Poly.centroid(v);
    for (var i = 0; i < n; i++) {
      if (st.measure.sides && (st.measure.sides === 'all' || st.measure.sides.indexOf(i) >= 0)) {
        var a = v[i], b = v[(i + 1) % n];
        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        var dx = mx - c.x, dy = my - c.y, len = Math.hypot(dx, dy) || 1;
        var lx = mx + dx / len * 28, ly = my + dy / len * 28;   // outside the side, where a ruler's reading goes
        var t = mk('g', { 'class': 'meas' }, g);
        mk('rect', { x: lx - 30, y: ly - 14, width: 60, height: 28, rx: 8, fill: '#fff', stroke: '#9fd6fb' }, t);
        mk('text', { x: lx, y: ly + 6, 'text-anchor': 'middle', 'font-size': 18, 'font-weight': 700, fill: '#1c2a4a', text: (L[i] / 30).toFixed(0) + ' cm' }, t);
      }
      if (st.measure.angles && (st.measure.angles === 'all' || st.measure.angles.indexOf(i) >= 0)) {
        drawArc(g, i, A[i]);
      }
    }
  }

  function drawArc(g, i, deg) {
    var v = st.verts, n = v.length, p = v[i], q = v[(i + n - 1) % n], s = v[(i + 1) % n];
    var a1 = Math.atan2(q.y - p.y, q.x - p.x), a2 = Math.atan2(s.y - p.y, s.x - p.x), r = 34;
    var sweep = ((a2 - a1) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    var orient = Poly.interiorAngles(v)[i] > 180 ? 1 : 0;
    // draw the interior wedge
    var large = sweep > Math.PI ? 1 : 0;
    var x1 = p.x + Math.cos(a1) * r, y1 = p.y + Math.sin(a1) * r, x2 = p.x + Math.cos(a2) * r, y2 = p.y + Math.sin(a2) * r;
    var d = 'M' + p.x + ' ' + p.y + ' L' + x1 + ' ' + y1 + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x2 + ' ' + y2 + ' Z';
    var inside = Poly.contains(v, { x: p.x + Math.cos((a1 + a2) / 2) * 10, y: p.y + Math.sin((a1 + a2) / 2) * 10 });
    if (!inside) d = 'M' + p.x + ' ' + p.y + ' L' + x1 + ' ' + y1 + ' A' + r + ' ' + r + ' 0 ' + (1 - large) + ' 0 ' + x2 + ' ' + y2 + ' Z';
    var w = mk('path', { d: d, fill: '#2ee63a', opacity: .9 }, g);
    if (deg != null) mk('text', { x: p.x + (v[i].x < st.cx ? 40 : -40), y: p.y - 34, 'text-anchor': 'middle', 'font-size': 18, 'font-weight': 700, fill: '#1c2a4a', text: Math.round(deg) + '°' }, g);
    void orient;
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
  var COLORS = { triangle: '#b98cff', chevron: '#63e0a4', pentagon: '#ff8fa3', 'l-shape': '#ffd166', hexagon: '#5ec8ff', star: '#ffb27a', octagon: '#4c8fe8', square: '#63e0a4', rhombus: '#ff8fa3', 'stretched-hexagon': '#ffb27a', 'equilateral-concave-hexagon': '#b98cff' };

  function drawShape(name, r, cx, cy, parent) {
    var g = mk('g', { 'class': 'shape', 'data-shape': name }, parent);
    var col = COLORS[name] || '#5b95ee';
    if (name === 'circle') { mk('circle', { cx: cx, cy: cy, r: r * .85, fill: '#ffb27a', stroke: '#c9611a', 'stroke-width': 4 }, g); return g; }
    if (name === 'open-path') { mk('path', { d: 'M' + (cx - r) + ' ' + (cy + r * .7) + ' L' + (cx - r * .5) + ' ' + (cy - r * .6) + ' L' + (cx + r * .5) + ' ' + (cy - r * .6) + ' L' + (cx + r) + ' ' + (cy + r * .7), fill: 'none', stroke: '#a23bd6', 'stroke-width': 5, 'stroke-linecap': 'round' }, g); return g; }
    var v = shapeVerts(name, r, cx, cy);
    // Edged in a darker step of its own colour, not in ink: a pink pentagon
    // with a pink edge is a shape; with a black edge it is a diagram of one.
    mk('path', { d: pathOf(v), fill: col, 'fill-opacity': .9, stroke: shade(col, -0.38), 'stroke-width': 3, 'stroke-linejoin': 'round' }, g);
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
      var HALF = 84, PITCH_X = 270, band = BOTTOM - TOP;
      var cells = [
        [W / 2 - PITCH_X / 2, TOP + band * 0.25], [W / 2 + PITCH_X / 2, TOP + band * 0.25],
        [W / 2 - PITCH_X / 2, TOP + band * 0.75], [W / 2 + PITCH_X / 2, TOP + band * 0.75]
      ];
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
        var P = polygonIn(pnl, cfg.sides || 5, { dent: cfg.dent, stretch: cfg.stretch, below: !!cfg.caption });
        var pg = mk('g', {}, layers.poly);
        mk('path', { d: pathOf(P.verts), fill: SHAPE.fill, stroke: SHAPE.edge, 'stroke-width': SHAPE.edgeW, 'stroke-linejoin': 'round' }, pg);
        if (cfg.diagonals === 'all') {
          Poly.allDiagonals(P.verts.length).forEach(function (d) {
            var a = P.verts[d[0]], b = P.verts[d[1]];
            var out = !Poly.isDiagonalInside(P.verts, d[0], d[1]);
            mk('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: out ? '#ff2a2a' : '#fff', 'stroke-width': out ? 5 : 3, 'stroke-dasharray': '10 9', 'stroke-linecap': 'round' }, pg);
          });
        }
        if (cfg.dent != null) mk('circle', { cx: P.verts[cfg.dent].x, cy: P.verts[cfg.dent].y, r: 9, fill: '#ffe600' }, pg);
        if (cfg.caption) mk('text', { x: pnl.x + pnl.w / 2, y: pnl.y + pnl.h - 16, 'text-anchor': 'middle', 'font-size': 20, 'font-weight': 700, fill: '#1c2a4a', text: cfg.caption }, layers.ui);
        st.compare[s[0]] = { panel: pnl, g: g, pg: pg, verts: P.verts, checks: cfg.checks, tone: cfg.tone };
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

      // The direction hint.
      //
      // Both labels used to be centred a few dozen pixels either side of the
      // middle, and each is three hundred wide — so they were printed straight
      // over one another and neither could be read. Each now sits under its
      // OWN arrow, out where its zone is, and says the one word that matters:
      // the arrow carries the direction, so the sentence does not have to.
      var hint = mk('g', { 'class': 'swipe-hint' }, layers.ui);
      st.swipe.hint = hint;
      [[-1, 'regular', 'Regular'], [1, 'irregular', 'Irregular']].forEach(function (d) {
        var dir = d[0], side = d[1], word = d[2];
        var col = (CONCEPT[side] || CONCEPT.regular).deep;
        var cx = W / 2 + dir * 188;
        var ax = cx - dir * 62, bx = cx + dir * 50;
        mk('path', {
          d: 'M' + ax + ' 470 L' + bx + ' 470 ' +
             'M' + (bx - dir * 17) + ' 458 L' + bx + ' 470 L' + (bx - dir * 17) + ' 482',
          fill: 'none', stroke: col, 'stroke-width': 8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
          'class': 'swipe-arrow', 'data-zone': side, opacity: 0.9
        }, hint);
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
      var bw = 340, gap = 30, bh = 236, by = 282;   // the collection is the point: it gets the room
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
      var p = panelFor('center', Object.assign({ controls: true }, spec)); st.panel = p;
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
      st.stepper = { min: (spec.stepper && spec.stepper.min) || 3, max: (spec.stepper && spec.stepper.max) || 8 };
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
  function keepInZone(zone, name) {
    if (!zone) return;
    zone._kept.push(name);
    while (zone._keptG.firstChild) zone._keptG.removeChild(zone._keptG.firstChild);

    var sh = zone._shelf, n = zone._kept.length;
    var cols = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(n))));
    var rows = Math.ceil(n / cols);
    var cw = sh.w / cols, ch = sh.h / rows;
    var r = Math.min(cw, ch) * 0.34;

    zone._kept.forEach(function (nm, i) {
      var cx = sh.x + cw * ((i % cols) + 0.5);
      var cy = sh.y + ch * (Math.floor(i / cols) + 0.5);
      var cell = mk('g', { 'class': 'kept' }, zone._keptG);
      var seat = mk('g', { transform: 'translate(' + cx.toFixed(1) + ',' + cy.toFixed(1) + ')' }, cell);
      optionCard(seat, r * 1.35, nm);
      // only the newest one celebrates; the rest are already part of the pile
      if (i === n - 1 && !reduced() && cell.animate) {
        cell.style.transformBox = 'fill-box'; cell.style.transformOrigin = 'center';
        cell.animate([{ scale: '.2', opacity: 0 }, { scale: '1.18', opacity: 1, offset: .6 }, { scale: '1', opacity: 1 }],
                     { duration: 340, easing: 'cubic-bezier(.3,1.4,.5,1)' });
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
  function dealCard() {
    var sw = st.swipe;
    if (!sw || sw.i >= sw.items.length) return null;
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
    (sw.hint ? [].slice.call(sw.hint.querySelectorAll('[data-zone]')) : []).forEach(function (el) {
      el.setAttribute('opacity', (on && el.getAttribute('data-zone') === id) ? 1 : 0.85);
      el.setAttribute('stroke-width', el.tagName === 'path'
        ? ((on && el.getAttribute('data-zone') === id) ? 9 : 7) : null);
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
    var cols = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(items.length))));
    var rows = Math.ceil(items.length / cols);
    var cw = (r.w - PAD_X * 2) / cols;
    var chh = (r.h - PAD_TOP - PAD_BOT) / rows;
    var k = Math.min(0.8, Math.min(cw, chh) * 0.94 / 112);
    items.forEach(function (it, i) {
      var cx = r.x + PAD_X + cw * ((i % cols) + 0.5);
      var cy = r.y + PAD_TOP + chh * (Math.floor(i / cols) + 0.5);
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
    var ringW = Math.max(3, half * 0.085);
    var ring = mk('rect', {
      x: -half + ringW, y: -halfH + ringW,
      width: (half - ringW) * 2, height: (halfH - ringW) * 2,
      rx: half * 0.24, fill: 'none', stroke: 'none', 'stroke-width': ringW,
      'pointer-events': 'none'
    }, g);
    var tick = mk('g', { opacity: 0, 'pointer-events': 'none' }, g);
    var tr = half * 0.26;
    mk('circle', { cx: half - tr * 0.75, cy: -halfH + tr * 0.85, r: tr, fill: EVAL.yes[1] }, tick);
    mk('path', {
      d: 'M' + (half - tr * 1.35) + ' ' + (-halfH + tr * 0.85) +
         ' l' + (tr * 0.45) + ' ' + (tr * 0.45) + ' l' + (tr * 0.85) + ' ' + (-tr * 0.95),
      fill: 'none', stroke: '#ffffff', 'stroke-width': Math.max(2, tr * 0.28),
      'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    }, tick);

    g._mark = function (state) {
      ring.setAttribute('stroke', state === 'correct' ? EVAL.yes[1]
                                : state === 'wrong' ? EVAL.no[1] : 'none');
      tick.setAttribute('opacity', state === 'correct' ? 1 : 0);
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
    var size = o.size || Math.round(h * 0.5);
    var probe = mk('text', { x: 0, y: 0, 'font-size': size, 'font-weight': 600, text: o.label, opacity: 0 }, g);
    var tw = 0;
    try { tw = probe.getComputedTextLength ? probe.getComputedTextLength() : 0; } catch (e) { tw = 0; }
    g.removeChild(probe);
    if (o.fit && tw > 0) {
      var want = Math.ceil(tw + h * 1.15);
      var nw = Math.max(o.minW || Math.round(h * 1.9), want);
      x = x + (w - nw) / 2;          // keep the centre where the caller put it
      w = nw;
    }

    if (B) {
      art = sliced(g, B, x, top, w, h);
    } else {
      drawn = drawnPill(g, tone, x, top, w, h, r, lip);
    }

    // Evident on glass: the word in white, semi-bold, over its own shadow.
    mk('text', {
      x: x + w / 2, y: y + h * 0.17 + 2,
      'text-anchor': 'middle', 'font-size': size, 'font-weight': 600,
      fill: 'rgba(30,20,10,.45)', text: o.label, 'pointer-events': 'none'
    }, g);
    var t = mk('text', {
      x: x + w / 2, y: y + h * 0.17,
      'text-anchor': 'middle', 'font-size': size, 'font-weight': 600,
      fill: o.ink || tone[2] || '#ffffff', text: o.label,
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
      t.setAttribute('fill', o.ink || p[2] || '#ffffff');
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
  var VERT_PAINT = 16;   // a handle is r15 now; the reserve was sized for r19

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

  function button(parent, x, y, w, h, label, fill, color) {
    var g = mk('g', { 'class': 'btn' }, parent);
    mk('rect', { x: x, y: y - h / 2, width: w, height: h, rx: 12, fill: fill, stroke: 'rgba(0,0,0,.08)' }, g);
    mk('text', { x: x + w / 2, y: y + 9, 'text-anchor': 'middle', 'font-size': 26, 'font-weight': 700, fill: color, text: label }, g);
    g.style.cursor = 'pointer';
    return g;
  }

  function morphFrom(prev) {
    if (reduced() || !st.fill || !st.fill.animate) return;
    // Resample both outlines to a common count so the path can tween.
    var from = resample(prev, 60), to = resample(st.verts, 60);
    var f = st.fill;
    var a = f.animate([{ d: 'path("' + pathOf(from) + '")' }, { d: 'path("' + pathOf(to) + '")' }], { duration: 560, easing: 'cubic-bezier(.22,1,.36,1)' });
    void a;
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
        st.vcolor[i] = h.color === 'red' ? '#ff2a2a' : h.color === 'orange' ? '#ff9d2a' : '#ffe600';
        renderPoly();
        if (st.vertEls[i]) juice('pop', st.vertEls[i], { scale: 0.5 });
      }
      if (h.diagonal === 'outside') { st.highlightOutside = true; renderPoly(); juice('flash', st.diagG); }
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
        x = st.cx;
        var lowest = st.verts && st.verts.length
          ? st.verts.reduce(function (m, p) { return p.y > m ? p.y : m; }, -Infinity) + VERT_PAINT
          : null;
        var pf = panelFace(st.panel);
        var floorY = pf.y + pf.h - 8;
        var lceil = choiceCeiling();
        if (lceil != null) floorY = Math.min(floorY, lceil);
        y = lowest == null ? Math.min(floorY, st.panel.y + st.panel.h - 30)
                           : Math.min(floorY, lowest + 52);
        // NO ROOM UNDER THE SHAPE INSIDE THE SLAB — the shape was fitted to
        // the whole face before this word existed — so the word goes under
        // the slab, in the band the controls use, rather than onto the
        // handles of the two lowest corners.
        if (lowest != null && y < lowest + 52 && lceil == null) {
          var under = st.panel.y + st.panel.h + 34;
          if (under <= BOTTOM - 6) y = under;
        }
      } else {
        var a = st.verts[st.segment[0]], b = st.verts[st.segment[1]];
        m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        var nx = m.x - st.cx, ny = m.y - st.cy;
        var len = Math.sqrt(nx * nx + ny * ny) || 1;
        var OUT = 74;
        x = m.x + nx / len * OUT;
        y = m.y + ny / len * OUT;
        // and never off the stage, however the shape is oriented
        x = Math.max(78, Math.min(W - 78, x));
        y = Math.max(46, Math.min(H - 34, y));
      }
      var g = mk('g', { 'class': 'label' }, layers.ui);
      mk('text', { x: x, y: y, 'text-anchor': 'middle', 'font-size': 30, 'font-weight': 700,
                   fill: '#1c2a4a', text: l.text }, g);
      if (l.arrow && m) {
        // from just outside the word to just short of the side, so neither
        // end of the leader touches what it is connecting
        var dx = m.x - x, dy = m.y - y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        var from = 26, to = 12;
        mk('line', {
          x1: x + dx / d * from, y1: y + dy / d * from - 8,
          x2: m.x - dx / d * to, y2: m.y - dy / d * to,
          stroke: '#4a5a7a', 'stroke-width': 3, 'stroke-linecap': 'round'
        }, g);
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
        // Clear of the SHAPE, not at a fixed height above the panel's foot —
        // which a hexagon's bottom vertex reached straight through.
        x = st.cx;
        y = belowShape(30, 34);
        if (st.choiceEls && st.choiceEls.length) y = Math.min(y, H - 64 - 60);
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
      var bw = 150, gap = 24, bh = 50;
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
          x: x, y: y, w: bw, h: bh, label: label, fit: true,
          tone: conceptOf(label) || NEUTRAL[i % NEUTRAL.length],
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
    checklist: function (c) {
      var items = c.checklist || [];
      var res = Poly.classify(st.verts);
      var verdict = [res.sides + ' sides', res.concave ? 'Concave' : 'Convex', res.irregular ? 'Irregular' : 'Regular'];
      var x = st.panel.x + st.panel.w + 20, y = st.panel.y + 40;
      var g = mk('g', { 'class': 'checklist' }, layers.ui);
      // Ice, not green. This panel holds ticks AND crosses, and a green card
      // announces the result before the first row has been read.
      mk('rect', { x: x, y: y - 20, width: 200, height: 40 * items.length + 30, rx: UI.radius, fill: UI.paper, stroke: UI.paperRim, 'stroke-width': UI.rim }, g);
      items.forEach(function (label, i) {
        var ok = !c.verify || verdict.indexOf(label) >= 0;
        var row = mk('g', {}, g);
        mk('circle', { cx: x + 26, cy: y + 10 + i * 40, r: 12, fill: ok ? '#2eab4e' : '#e05b5b' }, row);
        mk('text', { x: x + 21, y: y + 15 + i * 40, 'font-size': 16, 'font-weight': 700, fill: '#fff', text: ok ? '✓' : '✕' }, row);
        mk('text', { x: x + 50, y: y + 16 + i * 40, 'font-size': 20, 'font-weight': 600, fill: '#1c2a4a', text: label }, row);
        if (c.animate && !reduced()) { row.style.opacity = 0; later(i * (c.each || 300), function () { row.style.opacity = 1; enter(row, 'pop'); sfx('tick'); }); }
      });
    },
    reveal: function (r) {
      if (r.reveal !== 'checks' || !st.compare) return;
      Object.keys(st.compare).forEach(function (side, si) {
        var c = st.compare[side]; if (!c.checks) return;
        var x = c.panel.x + 16, y = c.panel.y + c.panel.h + 30;
        c.checks.forEach(function (label, i) {
          // THESE ARE FACTS, NOT A SCORE. Each line states something true
          // about the shape above it — "All sides equal" of the regular
          // pentagon, "Sides not all equal" of the irregular one. The second
          // column's lines were marked with a red cross because its tone
          // happened to be pink, so the screen told the child that the true
          // sentence was the wrong answer, in the colour they read fastest.
          // Both columns tick. What differs between them is the concept, so
          // the concept's colour is what carries the difference.
          var cc = CONCEPT[c.tone] || CONCEPT.convex;
          var row = mk('g', {}, layers.ui);
          mk('circle', { cx: x + 12, cy: y + i * 30, r: 10, fill: cc.face }, row);
          mk('text', { x: x + 8, y: y + 5 + i * 30, 'font-size': 14, 'font-weight': 700, fill: '#fff', text: '✓' }, row);
          mk('text', { x: x + 32, y: y + 6 + i * 30, 'font-size': 17, fill: '#1c2a4a', text: label }, row);
          if (r.animate && !reduced()) { row.style.opacity = 0; later((si * 2 + i) * 260, function () { row.style.opacity = 1; enter(row, 'pop'); }); }
        });
      });
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
    if (spec.badge && !spec.kind) op.badge(spec.badge);
    if ('choices' in spec) op.choices(spec.choices);
    if (spec.checklist) op.checklist(spec);
    if (spec.reveal) op.reveal(spec);
    if (spec.stepper && typeof spec.stepper === 'string') op.stepper(spec.stepper);
    if (spec.measurements) op.measurements(spec.measurements);
    if (spec.returnItem && st.sort && st.sort.dragging) returnItem(st.sort.dragging);
  }

  /* ------------------------------------------------------------------ *
   * Focus
   * ------------------------------------------------------------------ */

  function targets(ref) {
    if (!ref) return [];
    if (ref === 'polygon' || ref === 'polygon.vertices') return ref === 'polygon' ? [st.polyG] : (st.vertEls || []);
    if (ref === 'polygon.sides') return st.edgeEls || [];
    if (ref === 'polygon.diagonals') return st.diagG ? [st.diagG] : [];
    if (ref.indexOf('polygon.vertex.') === 0) { var i = +ref.split('.')[2]; return st.vertEls && st.vertEls[i] ? [st.vertEls[i]] : []; }
    if (ref === 'segment.endpoint') return st.segment && st.vertEls ? [st.vertEls[st.segment[1]]] : [];
    if (ref === 'diagonal.endpoints') return st.segment && st.vertEls ? [st.vertEls[st.segment[0]], st.vertEls[st.segment[1]]] : [];
    if (ref === 'picked') return st.vertEls && st.picked != null ? [st.vertEls[st.picked]] : [];
    if (ref === 'grid') return st.cards || [];
    if (ref.indexOf('compare.') === 0) { var c = st.compare && st.compare[ref.split('.')[1]]; return c ? [c.g, c.pg] : []; }
    if (ref === 'sort.tray' || ref === 'sort.item') return st.sort ? st.sort.items : [];
    if (ref === 'builder.stepper') return st.stepPlus ? [st.stepPlus] : [];
    return [];
  }

  function focus(ref, style) {
    var els = targets(ref);
    if (style === 'dim-others' && st.compare) {
      Object.keys(st.compare).forEach(function (k) { var c = st.compare[k]; var dim = 'compare.' + k !== ref; c.g.style.opacity = dim ? .45 : 1; c.pg.style.opacity = dim ? .45 : 1; });
      return;
    }
    els.forEach(function (e) {
      if (!e) return;
      if (e.classList && e.classList.contains('vertex')) { e.setAttribute('opacity', 1); e.setAttribute('r', 12); }
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
    if (!svg || reduced()) return 0;
    var els = targets(ref).filter(Boolean);
    if (!els.length) return 0;
    // A ring is the right mark for a thing with an area — a vertex, the whole
    // shape. It is the wrong mark for a set of lines: the bounding box of a
    // pentagon's diagonals is the pentagon, so the ring says "the shape"
    // exactly when the word said "the diagonals". Trace the strokes instead.
    if (mode === 'trace') return trace(els, color);
    var drawn = 0;
    els.slice(0, 12).forEach(function (e, i) {
      var b;
      try { b = e.getBBox(); } catch (x) { return; }
      if (!b || (!b.width && !b.height)) return;
      var pad = Math.max(9, Math.min(22, Math.max(b.width, b.height) * 0.12));
      var ring = mk('rect', {
        x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2,
        rx: Math.min(28, (Math.min(b.width, b.height) + pad * 2) / 2),
        fill: 'none', stroke: color, 'stroke-width': 4, opacity: 0, 'class': 'dc-halo'
      }, layers.fx);
      drawn++;
      if (!ring.animate) { ring.remove(); return; }
      var a = ring.animate([
        { opacity: 0, strokeWidth: 10 },
        { opacity: 0.95, strokeWidth: 4, offset: 0.22 },
        { opacity: 0.95, strokeWidth: 4, offset: 0.66 },
        { opacity: 0, strokeWidth: 3 }
      ], { duration: 1500, delay: i * 70, easing: 'ease-out', fill: 'forwards' });
      a.finished.then(function () { ring.remove(); }, function () { ring.remove(); });
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
      copy.setAttribute('stroke', color);
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
    return bd < 60 ? best : -1;
  }

  /**
   * Drag one or more vertices. Pointerdown is delegated to the polygon group
   * and matched by data-i, so it survives any re-render; move/up listen on
   * the SVG so they keep firing wherever the pointer goes.
   */
  function dragVertices(idxs, moveFn, upFn, ctx) {
    var active = -1;
    idxs.forEach(function (i) { var h = st.vertEls[i]; if (h) { h.setAttribute('opacity', 1); h.style.cursor = 'grab'; } });
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
        st.vertEls.forEach(function (c, i) {
          c.style.cursor = 'pointer';
          on(c, 'pointerdown', function (e) {
            e.preventDefault();
            st.picked = i; st.lastEl = c; st.vcolor = {}; st.vcolor[i] = '#ffe600'; st.showVerts = false; renderPoly();
            endInteraction(); resolve({ result: 'correct', vertex: i });
          });
        });
        if (ctx && ctx.onCancel) ctx.onCancel(endInteraction);
      });
    },

    'drag-endpoint': function (spec, ctx) {
      return new Promise(function (resolve) {
        if (global.Input) Input.mode('polygon');
        var from = st.segment[0], moving = st.segment[1];
        var ghostLine = mk('line', { x1: st.verts[from].x, y1: st.verts[from].y, x2: st.verts[moving].x, y2: st.verts[moving].y, stroke: '#ffe600', 'stroke-width': 7, 'stroke-linecap': 'round', opacity: 0 }, layers.fx);
        dragVertex(moving, function (p) {
          ghostLine.setAttribute('opacity', 1); ghostLine.setAttribute('x2', p.x); ghostLine.setAttribute('y2', p.y);
          if (st.segLine) st.segLine.setAttribute('opacity', .25);
        }, function (p) {
          ghostLine.remove();
          var j = nearestVertex(p, from);
          if (j < 0) { if (st.segLine) st.segLine.setAttribute('opacity', 1); return; }   // dropped in space: no verdict, keep waiting
          var ok = !Poly.isAdjacent(from, j, st.n);
          endInteraction();
          if (ok) {
            st.segment = [from, j]; st.diagonals = st.diagonals || []; st.diagonals.push(Object.assign([Math.min(from, j), Math.max(from, j)], { solid: true }));
            st.segment = null; st.vcolor = {}; st.vcolor[from] = '#ffe600'; st.vcolor[j] = '#ffe600'; renderPoly(); st.lastEl = st.polyG;
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
        var start = null, done = false;
        if (spec.live === 'diagonals') st.highlightOutside = true;
        dragVertices(idxs, function (p, i) {
            if (done) return;
            if (!start) start = { x: st.verts[i].x, y: st.verts[i].y };
            var np = Poly.clampSimple(st.verts, i, p);
            st.verts[i] = np;
            updatePoly();
            if (spec.live === 'badge' && st.liveBadge) {
              var c = Poly.classify(st.verts);
              st.liveBadge._text.textContent = c.concave ? 'Concave' : 'Convex';
              if (st.liveBadge._retint) st.liveBadge._retint(c.concave ? 'concave' : 'convex');
            }
            var reached = spec.until === 'concave' ? Poly.classify(st.verts).concave
                        : spec.until === 'irregular' ? (!Poly.isRegular(st.verts) && Math.hypot(np.x - start.x, np.y - start.y) >= (spec.minMove || 0))
                        : false;
            if (reached) { done = true; st.lastEl = st.polyG; endInteraction(); st.vcolor = {}; renderPoly(); resolve({ result: 'correct', vertex: i }); }
          }, function () {}, ctx);
      });
    },

    choice: function (spec, ctx) {
      return new Promise(function (resolve) {
        if (global.Input) Input.mode('polygon');
        (st.choiceEls || []).forEach(function (b) {
          on(b, 'pointerdown', function (e) {
            e.preventDefault(); st.lastEl = b;
            var ok = b.getAttribute('data-label') === spec.correct;
            // _retint, not firstChild: a pill draws its LIP first, so setting
            // a fill on the first child recoloured the three-pixel shadow
            // under the button and left the face it sits on untouched.
            if (ok && b._retint) b._retint('correct');
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
            // the card arcs into the mouth of the zone and is gone; what the
            // child keeps is drawn on the shelf by keepInZone()
            var tx = zone ? zone._shelf.x + zone._shelf.w / 2 : SWIPE_HOME.x;
            var ty = zone ? zone._shelf.y + zone._shelf.h / 2 : SWIPE_HOME.y;
            var fly = card.animate
              ? card.animate([
                  { translate: dx + 'px 0', scale: '1', opacity: 1 },
                  { translate: (dir * 150) + 'px -34px', scale: '.8', opacity: 1, offset: 0.5 },
                  { translate: (tx - SWIPE_HOME.x) + 'px ' + (ty - SWIPE_HOME.y) + 'px', scale: '.22', opacity: 0 }
                ], { duration: 460, easing: 'cubic-bezier(.3,.8,.35,1)', fill: 'forwards' })
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
            var z = sw.zones[answer];
            if (z && !reduced() && z.animate) {
              z.animate([{ translate: '0 0' }, { translate: '-6px 0' }, { translate: '6px 0' }, { translate: '0 0' }],
                        { duration: 260, easing: 'ease-in-out' });
            }
            if (ctx && ctx.onWrong) ctx.onWrong();
            // a nudge toward the side they chose, then home again
            var back = card.animate
              ? card.animate([
                  { translate: dx + 'px 0', rotate: (dir * 5) + 'deg' },
                  { translate: (dir * 92) + 'px 0', rotate: (dir * 7) + 'deg', offset: 0.42 },
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
          demo = sw.card.animate([
            { translate: '0 0', rotate: '0deg' },
            { translate: '-54px 0', rotate: '-4deg', offset: 0.22 },
            { translate: '0 0', rotate: '0deg', offset: 0.44 },
            { translate: '54px 0', rotate: '4deg', offset: 0.66 },
            { translate: '0 0', rotate: '0deg' }
          ], { duration: 2600, iterations: Infinity, easing: 'ease-in-out' });
        }
        function stopDemo() { if (demo) { try { demo.cancel(); } catch (e) {} demo = null; } }

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
          if (sw.card && sw.card.animate && !reduced()) {
            sw.card.animate([{ translate: dx + 'px 0' }, { translate: '0 0' }],
                            { duration: 260, easing: 'cubic-bezier(.3,1.4,.5,1)' });
          }
          dx = 0; if (sw.card) place(sw.card, 0, 0);
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
        st.cards.forEach(function (c) {
          c.style.cursor = 'pointer';
          on(c, 'pointerdown', function (e) {
            e.preventDefault(); if (c._done) return; st.lastEl = c;
            if (c._opt.correct) {
              c._done = true; got++;
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
            el.style.cursor = 'pointer';
            if (el.classList) el.classList.toggle('hint', !seen[i]);
          });
        };
        hint();
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
            st.lastEl = (isSides ? st.edgeEls : st.vertEls)[i];
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
              item._placed = true; S.placed++; bin._count++;
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
          var P = polygonIn(st.panel, n, { below: true }); st.verts = P.verts; st.stepText.textContent = n; renderPoly(); morphFrom(prev);
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
      st.picked = from; st.vcolor = {}; st.vcolor[from] = '#ffe600'; st.showVerts = true; st.touchVerts = true; renderPoly();
      var made = 0, active = false;
      var rubber = mk('line', { x1: st.verts[from].x, y1: st.verts[from].y, x2: st.verts[from].x, y2: st.verts[from].y, stroke: '#ffe600', 'stroke-width': 7, 'stroke-linecap': 'round', opacity: 0 }, layers.fx);
      function used(j) { var k = [Math.min(from, j), Math.max(from, j)].join('-'); return (st.diagonals || []).some(function (d) { return d.join('-') === k; }); }
      // Delegated: the source vertex element is rebuilt after each diagonal.
      on(st.polyG, 'pointerdown', function (e) {
        var t = e.target; if (!t || !t.classList || !t.classList.contains('vertex') || +t.getAttribute('data-i') !== from) return;
        if (global.Input && Input.guarded) return;
        active = true; e.preventDefault(); rubber.setAttribute('opacity', 1);
      });
      on(svg, 'pointermove', function (e) { if (!active) return; var p = pt(e); rubber.setAttribute('x2', p.x); rubber.setAttribute('y2', p.y); });
      on(svg, 'pointerup', function (e) {
        if (!active) return; active = false; rubber.setAttribute('opacity', 0);
        var j = nearestVertex(pt(e), from); if (j < 0) return;
        var ok = !Poly.isAdjacent(from, j, st.n) && !used(j);
        st.lastEl = st.vertEls[j];
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
   * The `panel` layer is deliberately excluded. A panel is a translucent card
   * with 60px of padding around a much smaller shape; counting it made the
   * box about a third larger than anything the child actually looks at, and
   * on the builder screen that left literally nowhere for a sentence to go.
   * Overlapping a panel's empty margin is fine. Overlapping the polygon is
   * not, and that is what this measures.
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
    p.x = box.x; p.y = box.y; var tl = p.matrixTransform(m);
    p.x = box.r; p.y = box.b2; var br = p.matrixTransform(m);
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
  function contentParts() {
    if (!svg || !st.kind) return [];
    var sel = '.panel, .polygon, .card, .sort-item, .bin, .choice, .stepper, .shape, .checklist, .badge';
    var out = [];
    var nodes = svg.querySelectorAll(sel);
    // Through the live matrix, as contentBox() does. Scaling by the svg box
    // alone put every painted rect 96px too high on a 4:3 screen, where the
    // stage is letterboxed inside the element and its top is not the top.
    var m = svg.getScreenCTM && svg.getScreenCTM();
    var px = function (x) { return m ? m.a * x + m.e : x; }, py = function (y) { return m ? m.d * y + m.f : y; };
    for (var i = 0; i < nodes.length; i++) {
      var q = nodes[i]._rect;
      var r = q
        ? { left: px(q.x), top: py(q.y), right: px(q.x + q.w), bottom: py(q.y + q.h),
            width: px(q.x + q.w) - px(q.x), height: py(q.y + q.h) - py(q.y) }
        : nodes[i].getBoundingClientRect();
      if (r.width > 4 && r.height > 4) out.push(r);
    }
    return out;
  }

  var api = {
    mount: mount, apply: apply, focus: focus, waitFor: waitFor, element: element, halo: halo,
    isEmpty: isEmpty, contentBox: contentBox, contentParts: contentParts,
    /** The slab Swiftee peeks over or stands beside: the panel, or the left of a compared pair. */
    peekAnchor: function () {
      if (st.panel) return st.panel;
      if (st.compare && st.compare.left && st.compare.left.panel) return st.compare.left.panel;
      return null;
    },
    onTap: function (fn) { onTap = fn || function () {}; },
    ambient: ambientPlay, flurry: flurry, alive: alive,
    /* How many delayed callbacks from a finished scene have been refused.
       A test reads this: a suppression mechanism that never suppresses
       anything looks exactly like one that was never wired up. */
    get staleSuppressed() { return staleSuppressed; },
    get pendingTimers() { return sceneTimers.length; },
    get svg() { return svg; }, get state() { return st; },
    shapeVerts: shapeVerts, PANELS: PANELS, HORIZON: HORIZON
  };
  global.Stage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : this);
