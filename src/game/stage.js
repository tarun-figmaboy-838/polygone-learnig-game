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
   *   snow     drifting flakes, each with its own fall time and sway, seeded
   *            once and looped forever with WAAPI rather than per-frame JS
   *   glints   occasional sparkles on the snowfield, staggered so they never
   *            pulse in unison
   *   shimmer  one slow band of light travelling across the ice
   *
   * All of it lives in the `bg` layer, which reset() does not clear — it is
   * painted once at mount and then left alone for the whole lesson.
   * ------------------------------------------------------------------ */

  var HORIZON = 405;          // where the painted snowfield begins, in viewBox units
  var SNOW = 30, GLINTS = 10; // ambient element counts — see ambientLife()
  var ambient = [];           // running WAAPI animations, so they can be stopped

  function drawVista() {
    clear('bg');
    var d = mk('defs', {}, layers.bg);
    d.innerHTML =
      '<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3fb3f6"/><stop offset=".55" stop-color="#a8dcfb"/><stop offset="1" stop-color="#eef8ff"/></linearGradient>' +
      '<linearGradient id="snowlit" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
      '<radialGradient id="sun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="vignette" cx=".5" cy=".45" r=".75"><stop offset=".6" stop-color="#0a2a4a" stop-opacity="0"/><stop offset="1" stop-color="#0a2a4a" stop-opacity=".16"/></radialGradient>';

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
    // Seeded once. Each flake carries its own duration and negative delay,
    // so the field is already mid-fall on the first frame instead of
    // starting as an empty sky that fills in.
    //
    // Each flake is its own compositor layer and its own infinite WAAPI
    // animation, and the target here is a low-end tablet. Kept deliberately
    // sparse: the snow reads as weather, not as a particle system.
    for (i = 0; i < SNOW; i++) {
      var x = Math.random() * W;
      var r = 1.2 + Math.random() * 2.6;
      var dur = 7000 + Math.random() * 9000;
      var sway = 14 + Math.random() * 34;
      var flake = mk('circle', { cx: x, cy: -10, r: r, fill: '#ffffff', opacity: 0.35 + Math.random() * 0.5 }, g);
      loopAnim(flake, [
        { transform: 'translate(0px,0px)' },
        { transform: 'translate(' + sway.toFixed(0) + 'px,' + (H * 0.3).toFixed(0) + 'px)', offset: 0.3 },
        { transform: 'translate(' + (-sway * 0.6).toFixed(0) + 'px,' + (H * 0.7).toFixed(0) + 'px)', offset: 0.7 },
        { transform: 'translate(' + (sway * 0.3).toFixed(0) + 'px,' + (H + 20) + 'px)' }
      ], { duration: dur, delay: -Math.random() * dur, easing: 'linear' });
    }

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

  /** Stop the weather. Used when the page is hidden, so a backgrounded tab costs nothing. */
  function ambientPlay(on) {
    ambient.forEach(function (a) {
      try { on ? a.play() : a.pause(); } catch (e) {}
    });
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

  function panel(p, opts) {
    opts = opts || {};
    var g = mk('g', { 'class': 'panel' }, layers.panel);
    mk('rect', { x: p.x, y: p.y, width: p.w, height: p.h, rx: 34, fill: 'rgba(255,255,255,.82)', stroke: '#9fd6fb', 'stroke-width': 3 }, g);
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

    // vertices
    st.vertEls = [];
    for (var j = 0; j < n; j++) {
      var col = st.vcolor && st.vcolor[j] ? st.vcolor[j] : null;
      var c = mk('circle', { cx: v[j].x, cy: v[j].y, r: col ? 13 : 9, fill: col || '#1030c8', stroke: col ? '#5a4a00' : 'none', 'stroke-width': 2, 'class': 'vertex', 'data-i': j, opacity: col || st.showVerts ? 1 : 0 }, g);
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
    endInteraction();
    clear('panel'); clear('poly'); clear('ui'); clear('fx');
    st = { showVerts: false };
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

  function makeSortItem(name, x, y, i) {
    var g = mk('g', { 'class': 'sort-item', 'data-shape': name }, layers.ui);
    mk('rect', { x: -56, y: -56, width: 112, height: 112, rx: 22, fill: 'rgba(255,255,255,.92)', stroke: '#9fd6fb', 'stroke-width': 3 }, g);
    drawShape(name, 40, 0, 0, g);
    g.setAttribute('transform', 'translate(' + x + ',' + y + ')');
    g._home = { x: x, y: y }; g._name = name; g._verts = shapeVerts(name, 40, 0, 0);
    if (!reduced()) { g.style.opacity = 0; setTimeout(function () { g.style.opacity = 1; enter(g, 'pop'); }, i * 90); }
    return g;
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
    label: function (l) {
      if (st.labelEl) st.labelEl.remove();
      var x, y;
      if (l.at === 'below-polygon' || !st.segment) { x = st.cx; y = st.panel.y + st.panel.h - 30; }
      else { var a = st.verts[st.segment[0]], b = st.verts[st.segment[1]]; x = (a.x + b.x) / 2 + 110; y = (a.y + b.y) / 2 - 40; }
      var g = mk('g', { 'class': 'label' }, layers.ui);
      mk('text', { x: x, y: y, 'text-anchor': 'middle', 'font-size': 30, 'font-weight': 700, fill: '#1c2a4a', text: l.text }, g);
      if (l.arrow && st.segment) { var m = { x: (st.verts[st.segment[0]].x + st.verts[st.segment[1]].x) / 2, y: (st.verts[st.segment[0]].y + st.verts[st.segment[1]].y) / 2 }; mk('line', { x1: x - 40, y1: y + 6, x2: m.x + 8, y2: m.y - 6, stroke: '#4a5a7a', 'stroke-width': 3, 'marker-end': 'none' }, g); }
      st.labelEl = g; if (l.enter && !reduced()) enter(g, 'pop');
    },
    badge: function (b) {
      var key = b.under || 'main';
      st.badges = st.badges || {};
      if (st.badges[key]) st.badges[key].remove();
      var x, y;
      if (b.under && st.compare && st.compare[b.under.split('.')[1]]) { var pnl = st.compare[b.under.split('.')[1]].panel; x = pnl.x + pnl.w / 2; y = pnl.y + pnl.h + 46; }
      else { x = st.cx; y = st.panel.y + st.panel.h - 44; }
      var tone = (b.tone || (b.text === 'Concave' ? 'pink' : 'green')) === 'pink' ? ['#f6c9d6', '#7a1b3a', '#c0537a'] : ['#a7dcb0', '#1d4d2a', '#5da86e'];
      var g = mk('g', { 'class': 'badge' }, layers.ui);
      mk('rect', { x: x - 90, y: y - 28, width: 180, height: 56, rx: 14, fill: tone[0], stroke: tone[2], 'stroke-width': 3 }, g);
      var t = mk('text', { x: x, y: y + 10, 'text-anchor': 'middle', 'font-size': 28, 'font-weight': 700, fill: tone[1], text: b.text }, g);
      g._text = t; g._rect = g.firstChild; st.badges[key] = g; if (b.live) st.liveBadge = g;
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
      var bw = 210, gap = 20, bh = 60;
      var row = list.length * bw + (list.length - 1) * gap;
      var x0 = (st.panel ? st.panel.x + st.panel.w / 2 : W / 2) - row / 2;
      // Keep the row on the stage. `panel.y + panel.h + 44` is 564 for the
      // right-hand panel, which is past the bottom of a 562-tall viewBox:
      // the buttons were drawn mostly below the visible area, clipped, and
      // unclickable. Sit them just inside the edge instead, and keep them
      // inside the left and right edges for the same reason.
      var y = Math.min((st.panel ? st.panel.y + st.panel.h + 44 : 480), H - bh / 2 - 12);
      x0 = Math.max(12, Math.min(x0, W - row - 12));
      list.forEach(function (label, i) {
        var x = x0 + i * (bw + gap);
        var b = mk('g', { 'class': 'choice', 'data-label': label }, g);
        mk('rect', { x: x, y: y - 30, width: bw, height: 60, rx: 14, fill: 'rgba(255,255,255,.9)', stroke: '#9fd6fb', 'stroke-width': 3 }, b);
        mk('text', { x: x + bw / 2, y: y + 10, 'text-anchor': 'middle', 'font-size': 28, 'font-weight': 600, fill: '#1c2a4a', text: label }, b);
        b.style.cursor = 'pointer'; st.choiceEls.push(b);
        if (!reduced()) { b.style.opacity = 0; setTimeout(function () { b.style.opacity = 1; enter(b, 'rise'); }, 80 * i); }
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
        st.showVerts = true; renderPoly();
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
            if (spec.live === 'badge' && st.liveBadge) { var c = Poly.classify(st.verts); st.liveBadge._text.textContent = c.concave ? 'Concave' : 'Convex'; st.liveBadge._rect.setAttribute('fill', c.concave ? '#f6c9d6' : '#a7dcb0'); }
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
        st.showVerts = !isSides; renderPoly();
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
      st.picked = from; st.vcolor = {}; st.vcolor[from] = '#ffe600'; st.showVerts = true; renderPoly();
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

  function waitFor(spec, ctx) {
    var fn = INTERACT[spec.type];
    if (!fn) { if (global.console) console.warn('Stage: no interaction "' + spec.type + '"'); return Promise.resolve({ result: 'correct' }); }
    return fn(spec, ctx);
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
    ambient: ambientPlay,
    get svg() { return svg; }, get state() { return st; },
    shapeVerts: shapeVerts, PANELS: PANELS, HORIZON: HORIZON
  };
  global.Stage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : this);
