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
  function hold(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
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

  var PANELS = {
    right:  { x: 500, y: 60,  w: 460, h: 460 },
    center: { x: 230, y: 70,  w: 540, h: 430 },
    left2:  { x: 490, y: 130, w: 235, h: 250 },
    right2: { x: 750, y: 130, w: 235, h: 250 }
  };

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
  function panel(p, opts) {
    opts = opts || {};
    var g = mk('g', { 'class': 'panel' }, layers.panel);
    var R = 34;

    // the thickness, showing beneath the face
    mk('rect', { x: p.x, y: p.y + 7, width: p.w, height: p.h, rx: R,
                 fill: '#7cb6dc', opacity: 0.38, 'pointer-events': 'none' }, g);

    // the face
    mk('rect', { x: p.x, y: p.y, width: p.w, height: p.h, rx: R,
                 fill: 'url(#panelFace)', stroke: '#a3d4ef', 'stroke-width': 3 }, g);

    // light along the top inside edge
    mk('rect', { x: p.x + 9, y: p.y + 7, width: p.w - 18, height: p.h * 0.36, rx: R * 0.72,
                 fill: 'url(#panelSheen)', opacity: 0.55, 'pointer-events': 'none' }, g);

    // FROST, NOT FOUR STAMPS.
    //
    // The first version put a crystal a twelfth of the panel wide in each
    // corner at a quarter opacity, and at that size they stopped being
    // texture: four big hard-edged stars, identical, one per corner, reading
    // as clip-art pressed onto the card and competing with the shape in the
    // middle. Frost on a window is small, uneven and barely there.
    //
    // So: half the size, half the opacity, a thinner line, each one a
    // different size and build, and tucked further into the corners where
    // the shape never reaches.
    if (global.Snowflake) {
      var inset = Math.min(p.w, p.h) * 0.085;
      var base = Math.min(p.w, p.h) * 0.036;
      [[p.x + inset, p.y + inset, 0, 1.0],
       [p.x + p.w - inset, p.y + inset * 0.82, 1, 0.72],
       [p.x + inset * 0.86, p.y + p.h - inset, 2, 0.84],
       [p.x + p.w - inset * 0.92, p.y + p.h - inset * 0.88, 1, 0.62]
      ].forEach(function (c) {
        mk('path', {
          'class': 'panel-frost',
          d: Snowflake.path(base * c[3], c[2]),
          transform: 'translate(' + c[0].toFixed(1) + ',' + c[1].toFixed(1) + ')',
          fill: 'none', stroke: '#9ccbe8', 'stroke-width': 1.1,
          'stroke-linecap': 'round', 'stroke-linejoin': 'round',
          opacity: 0.13, 'pointer-events': 'none'
        }, g);
      });
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

  function polygonIn(p, n, opts) {
    opts = opts || {};
    var cx = p.x + p.w / 2, cy = p.y + p.h / 2 + (opts.dy || 0);
    var r = Math.min(p.w, p.h) * (opts.rScale || 0.36);
    var v = Poly.regular(n, r, cx, cy);
    if (opts.dent != null) v = Poly.pullInward(v, opts.dent, 0.72);
    if (opts.stretch != null) v[opts.stretch] = { x: v[opts.stretch].x, y: v[opts.stretch].y - r * 0.55 };
    return { verts: v, cx: cx, cy: cy, r: r };
  }

  /** (Re)draw the main polygon from st.verts. Called on every change. */
  function renderPoly() {
    var g = st.polyG;
    if (!g) return;
    while (g.firstChild) g.removeChild(g.firstChild);
    var v = st.verts, n = v.length;

    st.fill = mk('path', { d: pathOf(v), fill: '#5b95ee', stroke: '#1030c8', 'stroke-width': 6, 'stroke-linejoin': 'round' }, g);

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
        r: col ? 13 : (touch ? 14 : 9),
        fill: col || (touch ? '#fff8e7' : '#1030c8'),
        stroke: col ? '#5a4a00' : (touch ? '#6b3400' : 'none'),
        'stroke-width': col ? 2 : (touch ? 3.5 : 2),
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

  function drawMeasurements(g) {
    var v = st.verts, n = v.length, L = Poly.sideLengths(v), A = Poly.interiorAngles(v);
    var c = Poly.centroid(v);
    for (var i = 0; i < n; i++) {
      if (st.measure.sides && (st.measure.sides === 'all' || st.measure.sides.indexOf(i) >= 0)) {
        var a = v[i], b = v[(i + 1) % n];
        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        var dx = mx - c.x, dy = my - c.y, len = Math.hypot(dx, dy) || 1;
        var lx = mx + dx / len * 30, ly = my + dy / len * 30;
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
    mk('path', { d: pathOf(v), fill: col, 'fill-opacity': .85, stroke: '#1c2a4a', 'stroke-width': 4, 'stroke-linejoin': 'round' }, g);
    g._verts = v;
    return g;
  }

  /* ------------------------------------------------------------------ *
   * Scene builders
   * ------------------------------------------------------------------ */

  function reset() {
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
      var p = PANELS[spec.panel || 'right'];
      st.panel = p; st.kind = 'polygon';
      panel(p, { enter: morph ? false : spec.enter });
      var P = polygonIn(p, spec.sides || 5);
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
      var cells = [[600, 60], [870, 60], [600, 330], [870, 330]];
      st.cards = opts.map(function (o, i) {
        var x = cells[i][0], y = cells[i][1];
        var g = mk('g', { 'class': 'card', 'data-id': o.id }, layers.ui);
        mk('rect', { x: x - 100, y: y, width: 200, height: 200, rx: 30, fill: 'rgba(255,255,255,.85)', stroke: '#9fd6fb', 'stroke-width': 3 }, g);
        drawShape(o.shape, 62, x, y + 100, g);
        g._opt = o;
        if (spec.enter === 'stagger' && !reduced()) { g.style.opacity = 0; setTimeout(function () { g.style.opacity = 1; enter(g, 'pop'); }, i * 110); }
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
        var P = polygonIn(pnl, cfg.sides || 5, { dent: cfg.dent, stretch: cfg.stretch, rScale: 0.34 });
        var pg = mk('g', {}, layers.poly);
        mk('path', { d: pathOf(P.verts), fill: '#5b95ee', stroke: '#1030c8', 'stroke-width': 5, 'stroke-linejoin': 'round' }, pg);
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

      var ZW = 236, ZH = 250, ZY = 128;
      [{ id: 'regular', x: 168, tone: 'green' },
       { id: 'irregular', x: W - 168 - ZW, tone: 'pink' }].forEach(function (z) {
        var def = (spec.zones || []).filter(function (d) { return d.id === z.id; })[0] || { id: z.id, label: z.id };
        var tone = z.tone === 'pink' ? ['#ffeef3', '#f08aa4', '#7a1b3a'] : ['#edfbf1', '#7fd49a', '#1d5a33'];
        var g = mk('g', { 'class': 'zone', 'data-zone': z.id }, layers.ui);
        // the slab, in the same grammar as every other surface in this game:
        // a face, a rim, and an underside so it has thickness
        mk('rect', { x: z.x, y: ZY + 7, width: ZW, height: ZH, rx: 26, fill: tone[1], opacity: 0.35 }, g);
        mk('rect', { x: z.x, y: ZY, width: ZW, height: ZH, rx: 26, fill: tone[0], stroke: tone[1], 'stroke-width': 3 }, g);
        // the title plate
        mk('rect', { x: z.x + 16, y: ZY + 12, width: ZW - 32, height: 52, rx: 16, fill: tone[1] }, g);
        mk('text', { x: z.x + ZW / 2, y: ZY + 47, 'text-anchor': 'middle', 'font-size': 30, 'font-weight': 700, fill: '#fff', text: def.label }, g);
        // the dashed landing area
        mk('rect', { x: z.x + 18, y: ZY + 78, width: ZW - 36, height: ZH - 96, rx: 18,
                     fill: 'none', stroke: tone[1], 'stroke-width': 3, 'stroke-dasharray': '11 9', opacity: 0.85 }, g);
        g._rect = { x: z.x, y: ZY, w: ZW, h: ZH };
        g._tone = tone;
        st.swipe.zones[z.id] = g;
        if (spec.enter !== false) enter(g, 'rise');
      });

      // the direction hint, under the card
      var hint = mk('g', { 'class': 'swipe-hint' }, layers.ui);
      st.swipe.hint = hint;
      [[-1, 'regular'], [1, 'irregular']].forEach(function (d) {
        var dir = d[0], side = d[1];
        var col = side === 'regular' ? '#1d7a4a' : '#c2325c';
        var x = W / 2 + dir * 74;
        var a = mk('path', {
          d: dir < 0 ? 'M' + (x + 46) + ' 474 L' + (x - 34) + ' 474 M' + (x - 16) + ' 462 L' + (x - 36) + ' 474 L' + (x - 16) + ' 486'
                     : 'M' + (x - 46) + ' 474 L' + (x + 34) + ' 474 M' + (x + 16) + ' 462 L' + (x + 36) + ' 474 L' + (x + 16) + ' 486',
          fill: 'none', stroke: col, 'stroke-width': 7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
          'class': 'swipe-arrow', 'data-zone': side, opacity: 0.85
        }, hint);
        mk('text', { x: x + dir * 8, y: 512, 'text-anchor': 'middle', 'font-size': 23, 'font-weight': 700,
                     fill: col, 'class': 'swipe-label', 'data-zone': side,
                     text: dir < 0 ? 'Swipe left for Regular' : 'Swipe right for Irregular' }, hint);
      });

      dealCard();
    },

    sort: function (spec) {
      reset(); st.kind = 'sort'; st.sort = { bins: [], items: [], placed: 0, spec: spec };
      var bins = spec.bins || [];
      var bw = 300, gap = 30, x0 = (W - (bins.length * bw + (bins.length - 1) * gap)) / 2 + 120;
      bins.forEach(function (b, i) {
        var x = x0 + i * (bw + gap), y = 330;
        var g = mk('g', { 'class': 'bin', 'data-bin': b.id }, layers.ui);
        var tone = b.tone === 'pink' ? ['#ffe3ea', '#f08aa4', '#7a1b3a'] : ['#e3f8ea', '#7fd49a', '#1d5a33'];
        mk('rect', { x: x, y: y, width: bw, height: 190, rx: 24, fill: tone[0], stroke: tone[1], 'stroke-width': 3, 'stroke-dasharray': '10 8' }, g);
        mk('rect', { x: x + 40, y: y - 24, width: bw - 80, height: 48, rx: 14, fill: tone[1] }, g);
        mk('text', { x: x + bw / 2, y: y + 8, 'text-anchor': 'middle', 'font-size': 26, 'font-weight': 700, fill: tone[2], text: b.label }, g);
        g._bin = b; g._rect = { x: x, y: y, w: bw, h: 190 }; g._count = 0;
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
      var ITEM = 112, MARGIN = 24;
      var pitch = Math.min(ITEM + 12, (W - 2 * MARGIN - ITEM) / Math.max(1, visible.length - 1));
      var span = (visible.length - 1) * pitch;
      var ix0 = (W - span) / 2;
      visible.forEach(function (name, i) {
        st.sort.items.push(makeSortItem(
          name,
          spec.oneAtATime ? W / 2 + 120 : ix0 + i * pitch,
          spec.oneAtATime ? 210 : 150,
          i
        ));
      });
    },

    builder: function (spec) {
      reset(); st.kind = 'builder';
      var p = PANELS.center; st.panel = p;
      panel(p, { enter: spec.enter });
      var n = spec.sides || 3;
      var P = polygonIn(p, n, { dy: -30, rScale: 0.32 });
      st.verts = P.verts; st.cx = P.cx; st.cy = P.cy; st.r = P.r; st.n = n; st.showVerts = true;
      // A vertex that can be dragged is dressed as a handle — cream core,
      // dark amber ring, larger — wherever that is true. It was only being
      // set where a vertex is PICKED, so on "Drag any vertex to make this
      // polygon concave" the handles were plain blue dots on a blue shape
      // and there was nothing to say what to take hold of.
      st.touchVerts = true;
      st.polyG = mk('g', { 'class': 'polygon' }, layers.poly);
      st.diagonals = [];
      renderPoly();
      // stepper
      var sy = p.y + p.h - 70, sx = p.x + p.w / 2;
      var g = mk('g', { 'class': 'stepper' }, layers.ui);
      mk('rect', { x: sx - 150, y: sy - 34, width: 300, height: 68, rx: 18, fill: '#fff', stroke: '#9fd6fb', 'stroke-width': 3 }, g);
      mk('text', { x: sx, y: sy - 10, 'text-anchor': 'middle', 'font-size': 16, fill: '#5a6a8a', text: (spec.stepper && spec.stepper.label) || 'Number of sides' }, g);
      st.stepMinus = button(g, sx - 110, sy + 4, 56, 40, '−', '#e8edf5', '#1c2a4a');
      st.stepPlus = button(g, sx + 54, sy + 4, 56, 40, '+', '#3d8bff', '#fff');
      st.stepText = mk('text', { x: sx, y: sy + 26, 'text-anchor': 'middle', 'font-size': 26, 'font-weight': 700, fill: '#1c2a4a', text: n }, g);
      st.stepper = { min: (spec.stepper && spec.stepper.min) || 3, max: (spec.stepper && spec.stepper.max) || 8 };
    }
  };

  /* ------------------------------------------------------------------ *
   * Swipe classification
   * ------------------------------------------------------------------ */

  var SWIPE_HOME = { x: W / 2, y: 268 };

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
    var name = sw.items[sw.i];
    var g = mk('g', { 'class': 'swipe-card', 'data-shape': name }, layers.ui);
    mk('rect', { x: -96, y: -96, width: 192, height: 192, rx: 28, fill: 'rgba(255,255,255,.5)', stroke: 'rgba(255,255,255,.75)', 'stroke-width': 3 }, g);
    drawShape(name, 74, 0, 0, g);
    g.setAttribute('transform', 'translate(' + SWIPE_HOME.x + ',' + SWIPE_HOME.y + ')');
    g._name = name;
    g._verts = shapeVerts(name, 74, 0, 0);
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

  function makeSortItem(name, x, y, i) {
    var g = mk('g', { 'class': 'sort-item', 'data-shape': name }, layers.ui);
    mk('rect', { x: -56, y: -56, width: 112, height: 112, rx: 22, fill: 'rgba(255,255,255,.92)', stroke: '#9fd6fb', 'stroke-width': 3 }, g);
    drawShape(name, 40, 0, 0, g);
    g.setAttribute('transform', 'translate(' + x + ',' + y + ')');
    g._home = { x: x, y: y }; g._name = name; g._verts = shapeVerts(name, 40, 0, 0);
    if (!reduced()) { g.style.opacity = 0; setTimeout(function () { g.style.opacity = 1; enter(g, 'pop'); }, i * 90); }
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
  var PILL_TONES = {
    green: ['#58c47c', '#2e8a4e'],
    pink:  ['#f0789e', '#b93c66'],
    amber: ['#ffb515', '#d07f00'],
    blue:  ['#4f9df5', '#2b6fc4']
  };

  function pill(parent, o) {
    var tone = PILL_TONES[o.tone] || PILL_TONES.blue;
    var w = o.w, h = o.h == null ? 62 : o.h;
    var x = o.x, y = o.y;                        // y is the CENTRE of the face
    var r = o.r == null ? Math.min(20, h * 0.34) : o.r;
    var lip = o.lip == null ? Math.max(4, h * 0.13) : o.lip;

    var g = mk('g', o.attrs || {}, parent);
    mk('rect', { x: x, y: y - h / 2 + lip, width: w, height: h, rx: r, fill: tone[1] }, g);
    mk('rect', { x: x, y: y - h / 2, width: w, height: h, rx: r, fill: tone[0] }, g);
    mk('rect', { x: x + w * 0.05, y: y - h / 2 + h * 0.1, width: w * 0.9, height: h * 0.34,
                 rx: r * 0.7, fill: '#ffffff', opacity: 0.22 }, g);
    var t = mk('text', {
      x: x + w / 2, y: y + h * 0.14,
      'text-anchor': 'middle', 'font-size': o.size || Math.round(h * 0.44),
      'font-weight': 700, fill: o.ink || '#ffffff', text: o.label
    }, g);

    // The face and the lip are kept, because a badge can change what it
    // says WHILE the child drags — the shape turns concave under their hand
    // and the badge has to follow. Retinting means both, not just the face:
    // a green face over a pink lip is a different bug, not a fix.
    g._text = t; g._face = g.childNodes[1]; g._lip = g.childNodes[0];
    g._retint = function (tone) {
      var p = PILL_TONES[tone] || PILL_TONES.blue;
      g._face.setAttribute('fill', p[0]);
      g._lip.setAttribute('fill', p[1]);
    };
    if (o.press) g.style.cursor = 'pointer';
    return g;
  }

  /**
   * A y below the shape with real clearance, never past the panel.
   *
   * Anything that sits "under the polygon" has to clear the LOWEST VERTEX,
   * not a fixed height. A hexagon has a vertex at the very bottom where a
   * pentagon has a flat side well above it, and a fixed height put the word
   * through the corner of one and left a gap under the other.
   */
  function belowShape(gap, floorPad) {
    var lowest = st.verts && st.verts.length
      ? st.verts.reduce(function (m, p) { return p.y > m ? p.y : m; }, -Infinity)
      : null;
    var floorY = st.panel ? st.panel.y + st.panel.h - (floorPad == null ? 18 : floorPad) : H - 30;
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
          ? st.verts.reduce(function (m, p) { return p.y > m ? p.y : m; }, -Infinity)
          : null;
        var floorY = st.panel.y + st.panel.h - 18;
        y = lowest == null ? st.panel.y + st.panel.h - 30
                           : Math.min(floorY, lowest + 52);
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
        y = belowShape(58, 34);
        if (st.choiceEls && st.choiceEls.length) y = Math.min(y, H - 64 - 60);
      }
      var g = pill(layers.ui, {
        x: x - 96, y: y, w: 192, h: 56,
        label: b.text, tone: b.tone || (b.text === 'Concave' ? 'pink' : 'green'),
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
      var bw = 216, gap = 26, bh = 64;
      var row = list.length * bw + (list.length - 1) * gap;
      var x0 = (st.panel ? st.panel.x + st.panel.w / 2 : W / 2) - row / 2;
      // Keep the row on the stage. `panel.y + panel.h + 44` is 564 for the
      // right-hand panel, which is past the bottom of a 562-tall viewBox:
      // the buttons were drawn mostly below the visible area, clipped, and
      // unclickable. Sit them just inside the edge instead, and keep them
      // inside the left and right edges for the same reason.
      // Along the bottom edge of the stage, always. Measured from the panel
      // they collided with whatever was under the shape: the row came out over
      // the shape's own label on a tall panel, and past the bottom of the
      // viewBox on a taller one — clipped, and unclickable.
      var y = H - bh / 2 - 14;
      x0 = Math.max(14, Math.min(x0, W - row - 14));
      list.forEach(function (label, i) {
        var x = x0 + i * (bw + gap);
        // Two tones, so a pair of options reads as a CHOICE rather than as
        // two copies of one control — the same green/pink the sorting bins
        // and the swipe zones already use for the same pairs.
        var b = pill(g, {
          x: x, y: y, w: bw, h: bh, label: label,
          tone: ['green', 'pink', 'amber', 'blue'][i % 4],
          press: true, attrs: { 'class': 'choice', 'data-label': label }
        });
        st.choiceEls.push(b);
        if (!reduced()) { b.style.opacity = 0; setTimeout(function () { b.style.opacity = 1; enter(b, 'rise'); }, 90 * i); }
      });
    },
    checklist: function (c) {
      var items = c.checklist || [];
      var res = Poly.classify(st.verts);
      var verdict = [res.sides + ' sides', res.concave ? 'Concave' : 'Convex', res.irregular ? 'Irregular' : 'Regular'];
      var x = st.panel.x + st.panel.w + 20, y = st.panel.y + 40;
      var g = mk('g', { 'class': 'checklist' }, layers.ui);
      mk('rect', { x: x, y: y - 20, width: 200, height: 40 * items.length + 30, rx: 18, fill: '#e6f8ea', stroke: '#7fd49a', 'stroke-width': 3 }, g);
      items.forEach(function (label, i) {
        var ok = !c.verify || verdict.indexOf(label) >= 0;
        var row = mk('g', {}, g);
        mk('circle', { cx: x + 26, cy: y + 10 + i * 40, r: 12, fill: ok ? '#2eab4e' : '#e05b5b' }, row);
        mk('text', { x: x + 21, y: y + 15 + i * 40, 'font-size': 16, 'font-weight': 700, fill: '#fff', text: ok ? '✓' : '✕' }, row);
        mk('text', { x: x + 50, y: y + 16 + i * 40, 'font-size': 20, 'font-weight': 600, fill: '#1c2a4a', text: label }, row);
        if (c.animate && !reduced()) { row.style.opacity = 0; setTimeout(function () { row.style.opacity = 1; enter(row, 'pop'); sfx('tick'); }, i * (c.each || 300)); }
      });
    },
    reveal: function (r) {
      if (r.reveal !== 'checks' || !st.compare) return;
      Object.keys(st.compare).forEach(function (side, si) {
        var c = st.compare[side]; if (!c.checks) return;
        var x = c.panel.x + 16, y = c.panel.y + c.panel.h + 30;
        c.checks.forEach(function (label, i) {
          var ok = c.tone !== 'pink';
          var row = mk('g', {}, layers.ui);
          mk('circle', { cx: x + 12, cy: y + i * 30, r: 10, fill: ok ? '#2eab4e' : '#e05b5b' }, row);
          mk('text', { x: x + 8, y: y + 5 + i * 30, 'font-size': 14, 'font-weight': 700, fill: '#fff', text: ok ? '✓' : '✕' }, row);
          mk('text', { x: x + 32, y: y + 6 + i * 30, 'font-size': 17, fill: '#1c2a4a', text: label }, row);
          if (r.animate && !reduced()) { row.style.opacity = 0; setTimeout(function () { row.style.opacity = 1; enter(row, 'pop'); }, (si * 2 + i) * 260); }
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
        st.showVerts = spec.vertex === 'any'; renderPoly();
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
              if (st.liveBadge._retint) st.liveBadge._retint(c.concave ? 'pink' : 'green');
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
            if (ok) { b.firstChild.setAttribute('fill', '#c8f2d2'); b.firstChild.setAttribute('stroke', '#5da86e'); }
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
            sfx('correct');
            juice('pop', card);
            var zone = sw.zones[answer];
            if (zone && !reduced() && zone.animate) {
              zone.animate([{ scale: '1' }, { scale: '1.07' }, { scale: '1' }],
                           { duration: 320, easing: 'cubic-bezier(.3,1.3,.5,1)' });
            }
            leanZone(null, false);
            // the card finishes its journey into the zone it earned
            var fly = card.animate
              ? card.animate([
                  { translate: dx + 'px 0', opacity: 1 },
                  { translate: (dir * 330) + 'px -18px', scale: '.55', opacity: 0 }
                ], { duration: 340, easing: 'cubic-bezier(.3,.8,.35,1)', fill: 'forwards' })
              : null;
            var after = function () {
              if (card.parentNode) card.parentNode.removeChild(card);
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
            if (c._opt.correct) { c._done = true; got++; c.firstChild.setAttribute('stroke', '#5da86e'); c.firstChild.setAttribute('fill', '#e6f8ea'); onTap('correct'); if (got >= need) { endInteraction(); resolve({ result: 'correct' }); } }
            else { c.firstChild.setAttribute('stroke', '#e05b5b'); setTimeout(function () { c.firstChild.setAttribute('stroke', '#9fd6fb'); }, 500); onTap('wrong'); }
          });
        });
        if (ctx && ctx.onCancel) ctx.onCancel(endInteraction);
      });
    },

    'tap-each': function (spec, ctx) {
      return new Promise(function (resolve) {
        if (global.Input) Input.mode('polygon');
        var isSides = spec.targets === 'sides', seen = {}, count = 0, need = spec.count || st.n;
        st.measure = st.measure || {}; st.measure[isSides ? 'sides' : 'angles'] = [];
        st.showVerts = !isSides; st.touchVerts = !isSides; renderPoly();
        var cls = isSides ? 'edge' : 'vertex';
        (isSides ? st.edgeEls : st.vertEls).forEach(function (el) { el.style.cursor = 'pointer'; });
        // Delegated: renderPoly() runs after every reveal.
        on(st.polyG, 'pointerdown', function (e) {
          var t = e.target; if (!t || !t.classList || !t.classList.contains(cls)) return;
          var i = +t.getAttribute('data-i'); if (seen[i]) return;
          e.preventDefault(); seen[i] = true; count++;
          st.measure[isSides ? 'sides' : 'angles'].push(i); st.lastEl = t; renderPoly();
          (isSides ? st.edgeEls : st.vertEls).forEach(function (el) { el.style.cursor = 'pointer'; });
          onTap('correct');
          if (count >= need) { endInteraction(); resolve({ result: 'correct' }); }
        });
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
              item._placed = true; S.placed++; var r = bin._rect; var slot = bin._count++;
              item._pos = { x: r.x + 60 + (slot % 2) * 110, y: r.y + 70 + Math.floor(slot / 2) * 80 };
              item.setAttribute('transform', 'translate(' + item._pos.x + ',' + item._pos.y + ') scale(.8)');
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
          var P = polygonIn(st.panel, n, { dy: -30, rScale: 0.32 }); st.verts = P.verts; st.stepText.textContent = n; renderPoly(); morphFrom(prev);
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

  var aliveAnims = [];

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
    aliveAnims.forEach(function (a) { try { a.cancel(); } catch (e) {} });
    aliveAnims = [];
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
      if (!e.animate) continue;
      pivot(e);
      try {
        aliveAnims.push(e.animate(
          [{ scale: '1' }, { scale: '1.055' }, { scale: '1' }],
          {
            duration: 1500 + (i % 5) * 130,
            delay: (i % 7) * 95,
            iterations: Infinity,
            easing: 'ease-in-out'
          }
        ));
      } catch (err) {}
    }
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
  function armPress() {
    if (!svg) return;
    on(svg, 'pointerdown', function (ev) {
      if (reduced()) return;
      var t = ev.target;
      while (t && t !== svg && !(t.style && /pointer/.test(t.style.cursor))) t = t.parentNode;
      if (!t || t === svg || !t.animate) return;
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
    if (invite) setTimeout(function () { alive(true); }, 60);

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
    ['poly', 'ui'].forEach(function (name) {
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
  function contentParts() {
    if (!svg || !st.kind) return [];
    var sel = '.polygon, .card, .sort-item, .bin, .choice, .stepper, .shape, .checklist, .badge';
    var out = [];
    var nodes = svg.querySelectorAll(sel);
    for (var i = 0; i < nodes.length; i++) {
      var r = nodes[i].getBoundingClientRect();
      if (r.width > 4 && r.height > 4) out.push(r);
    }
    return out;
  }

  var api = {
    mount: mount, apply: apply, focus: focus, waitFor: waitFor, element: element, halo: halo,
    isEmpty: isEmpty, contentBox: contentBox, contentParts: contentParts,
    onTap: function (fn) { onTap = fn || function () {}; },
    ambient: ambientPlay, flurry: flurry, alive: alive,
    get svg() { return svg; }, get state() { return st; },
    shapeVerts: shapeVerts, PANELS: PANELS, HORIZON: HORIZON
  };
  global.Stage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : this);
