/*!
 * transition.js — the fairy-snow wipe between screens.
 *
 * A cut between two screens is the moment a lesson feels like a slideshow.
 * This replaces the cut with weather: the snow already falling in the scene
 * thickens into a gust, then a handful of enormous fairy snow crystals swing
 * in from every edge, and each one lays down a patch of frost where it lands.
 * The patches overlap until the screen is ice. The scene changes behind it,
 * and the ice breaks up and blows away.
 *
 * Three things this is deliberately NOT:
 *
 *   NOT A WHITE SHEET. The cover is ice, not paper — a cool blue-white with
 *   a frost lattice over it and a deep rim, lit from above. Flat white reads
 *   as a missing frame; ice reads as a place.
 *
 *   NOT A FADE. The crystals are the cover. They arrive one after another on
 *   a diagonal sweep and their frost patches fuse into the sheet, so the
 *   screen is covered BY something rather than merely hidden.
 *
 *   NOT A SURPRISE. Stage.flurry() raises the scene's own snowfall a beat
 *   before the first crystal lands, so the storm builds. Without that lead
 *   the whole thing reads as an effect switching on.
 *
 * Two halves, deliberately separate:
 *
 *   cover()   the gust, the crystals, the ice. Resolves when the old screen
 *             is genuinely hidden — the caller may only rebuild the stage
 *             after this, or the child sees the change happen.
 *   reveal()  the crystals lift away and the ice clears. Resolves when the
 *             screen is its own again.
 *
 * Splitting them is what makes it a transition rather than a flash: the work
 * between the two calls is invisible, however long it takes, so a slow scene
 * build can never show its seams.
 *
 * Costs: nine crystals and about twenty sparks for a second and a half, then
 * nothing. Under reduced motion both halves resolve immediately and nothing
 * is drawn or sped up, so the screen changes instantly rather than swirling
 * at someone who asked it not to.
 *
 *   Transition.mount(container)
 *   await Transition.cover(); ...change the scene...; await Transition.reveal();
 *   Transition.wipe(fn)       // the two halves with `fn` in between
 */
(function (global) {
  'use strict';

  var COLS = 3, ROWS = 3;
  var PATCHES = COLS * ROWS;
  var SPARKS = 18;

  var LEAD_MS = 140;        // gust only — nothing has landed yet
  var FLIGHT_MS = 430;      // one crystal, edge to its place
  var STAGGER_MS = 34;      // between crystals, along the diagonal
  var COVER_MS = LEAD_MS + FLIGHT_MS + STAGGER_MS * (PATCHES - 1);
  var REVEAL_MS = 620;

  var host = null, ice = null, frost = null, field = null;

  /* One source of truth for whether this machine wants motion. juice.js owns
     it — it watches the media query and exposes a test seam (Juice.disable)
     that has to turn off the transition too, or a suite that switched motion
     off would still be waiting a second and a half between screens. */
  function reduced() { return !!(global.Juice && Juice.reducedMotion); }

  function mount(container) {
    if (!container || !container.ownerDocument) return null;
    if (host && host.parentNode === container) return host;
    var doc = container.ownerDocument;

    host = doc.createElement('div');
    host.className = 'snow-wipe';
    host.setAttribute('aria-hidden', 'true');
    // Above the stage, the character and the overlays, but below the start
    // gate — the loading screen is its own curtain and must stay on top.
    host.style.cssText =
      'position:absolute;inset:0;z-index:8;overflow:hidden;pointer-events:none;' +
      'opacity:0;visibility:hidden;';

    // The ice is what actually hides the scene. The crystals sell it; this
    // does the work. Lit from above and deepening to a cold blue at the rim,
    // because a flat fill of any colour reads as a dropped frame.
    ice = doc.createElement('div');
    ice.style.cssText =
      'position:absolute;inset:-12%;opacity:0;' +
      'background:radial-gradient(130% 95% at 50% 36%,' +
        '#ffffff 0%,#f2fbff 30%,#d8eefd 58%,#b2daf5 82%,#96cbed 100%);' +
      'box-shadow:inset 0 0 200px rgba(112,172,212,.55),inset 0 0 70px rgba(255,255,255,.7);';

    // The lattice. Fine bright slivers at two angles plus a radial fan, which
    // together read as frost forming on glass rather than as a texture tiled
    // over the top. Screen blend keeps it light-on-light; it must brighten
    // the ice, never draw lines across it.
    frost = doc.createElement('div');
    frost.style.cssText =
      'position:absolute;inset:-12%;opacity:0;mix-blend-mode:screen;' +
      'background:' +
        'repeating-conic-gradient(from 14deg at 50% 42%,rgba(255,255,255,.30) 0deg 2.2deg,rgba(255,255,255,0) 2.2deg 16deg),' +
        'repeating-linear-gradient(58deg,rgba(255,255,255,.20) 0 2px,rgba(255,255,255,0) 2px 27px),' +
        'repeating-linear-gradient(-58deg,rgba(219,242,255,.18) 0 2px,rgba(255,255,255,0) 2px 33px);';

    field = doc.createElement('div');
    field.style.cssText = 'position:absolute;inset:0;';

    host.appendChild(ice);
    host.appendChild(frost);
    host.appendChild(field);
    container.appendChild(host);
    return host;
  }

  function clear() {
    if (field) while (field.firstChild) field.removeChild(field.firstChild);
  }

  function weather(on) {
    if (global.Stage && Stage.flurry) { try { Stage.flurry(on); } catch (e) {} }
  }

  /**
   * One big crystal and the frost it lays down.
   *
   * The patch is a blurred radial blob a good deal wider than its grid cell,
   * so neighbours fuse instead of tiling — nine visible discs would be nine
   * visible discs, and what is wanted is one sheet of ice that happened to
   * arrive in nine pieces.
   */
  function bigFlake(doc, cx, cy, size, seed) {
    var wrap = doc.createElement('div');
    wrap.style.cssText =
      'position:absolute;left:' + (cx - size / 2).toFixed(0) + 'px;top:' + (cy - size / 2).toFixed(0) + 'px;' +
      'width:' + size.toFixed(0) + 'px;height:' + size.toFixed(0) + 'px;' +
      'display:flex;align-items:center;justify-content:center;' +
      'opacity:0;will-change:transform,opacity;';

    var patch = doc.createElement('div');
    patch.style.cssText =
      'position:absolute;inset:0;border-radius:50%;filter:blur(9px);' +
      'background:radial-gradient(closest-side,' +
        'rgba(255,255,255,.98) 0 34%,rgba(240,250,255,.94) 54%,' +
        'rgba(206,235,252,.62) 78%,rgba(198,231,250,0) 100%);';
    wrap.appendChild(patch);

    var crystal = doc.createElement('div');
    crystal.style.cssText = 'position:relative;filter:drop-shadow(0 0 14px rgba(150,205,240,.85));';
    if (global.Snowflake) {
      crystal.innerHTML = Snowflake.svg(size * 0.42, seed, { weight: Math.max(1.6, size * 0.0085) });
    }
    wrap.appendChild(crystal);

    return wrap;
  }

  /** A four-point sparkle — the "fairy" half of fairy snow. */
  function spark(doc, w, h) {
    var el = doc.createElement('div');
    var s = 12 + Math.random() * 26;
    el.style.cssText =
      'position:absolute;width:' + s.toFixed(0) + 'px;height:' + s.toFixed(0) + 'px;' +
      'left:' + (Math.random() * w).toFixed(0) + 'px;' +
      'top:' + (Math.random() * h).toFixed(0) + 'px;opacity:0;will-change:transform,opacity;' +
      'background:' +
        'radial-gradient(closest-side, rgba(255,255,255,.95), rgba(255,255,255,0) 70%),' +
        'linear-gradient(0deg, transparent 46%, #fff 50%, transparent 54%),' +
        'linear-gradient(90deg, transparent 46%, #fff 50%, transparent 54%);';
    return el;
  }

  function run(el, frames, opts) {
    if (!el || !el.animate) return Promise.resolve();
    try { return el.animate(frames, opts).finished.catch(function () {}); }
    catch (e) { return Promise.resolve(); }
  }

  /**
   * Lay out the nine crystals on a jittered grid and give each one the flight
   * that brings it in.
   *
   * Each comes from straight outside its own position, so the screen closes
   * in from every edge at once rather than being swept from one side. They
   * land in diagonal order — top-left first, bottom-right last — which is
   * what turns nine separate arrivals into one legible sweep.
   */
  function seed(doc) {
    var w = host.clientWidth || 1280, h = host.clientHeight || 720;
    var cellW = w / COLS, cellH = h / ROWS;
    var size = Math.max(cellW, cellH) * 1.9;
    var reach = Math.max(w, h) * 0.82 + size * 0.3;
    var flakes = [], c, r, i;

    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        var cx = (c + 0.5) * cellW + (Math.random() - 0.5) * cellW * 0.34;
        var cy = (r + 0.5) * cellH + (Math.random() - 0.5) * cellH * 0.34;
        var dx = cx - w / 2, dy = cy - h / 2;
        var len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1) { var a = Math.random() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a); len = 1; }
        flakes.push({
          el: bigFlake(doc, cx, cy, size, (c + r) % 3),
          // outward along its own radius, with a sideways kick so it arcs in
          fx: (dx / len) * reach + (-dy / len) * (Math.random() - 0.5) * 220,
          fy: (dy / len) * reach + (dx / len) * (Math.random() - 0.5) * 220,
          spin: (Math.random() < 0.5 ? -1 : 1) * (150 + Math.random() * 130),
          order: cx + cy
        });
      }
    }

    flakes.sort(function (a, b) { return a.order - b.order; });
    flakes.forEach(function (f) { field.appendChild(f.el); });

    var sparks = [];
    for (i = 0; i < SPARKS; i++) { var s = spark(doc, w, h); field.appendChild(s); sparks.push(s); }

    return { flakes: flakes, sparks: sparks, w: w, h: h };
  }

  var last = null;   // what cover() seeded, so reveal() can send it back out

  /** The gust, the crystals, the ice. Resolves once the screen is hidden. */
  function cover() {
    if (reduced() || !host) return Promise.resolve();
    var doc = host.ownerDocument;
    clear();
    host.style.visibility = 'visible';
    host.style.opacity = '1';

    // The storm builds first. By the time the first crystal lands the scene's
    // own snow is already coming down hard, so the cover is the weather
    // arriving rather than a effect being switched on over the top of it.
    weather(true);
    if (global.SFX) SFX.play('menuWhoosh');

    var s = seed(doc);
    last = s;

    s.flakes.forEach(function (f, i) {
      run(f.el, [
        { transform: 'translate(' + f.fx.toFixed(0) + 'px,' + f.fy.toFixed(0) + 'px) rotate(' + f.spin.toFixed(0) + 'deg) scale(.16)', opacity: 0 },
        { transform: 'translate(' + (f.fx * 0.5).toFixed(0) + 'px,' + (f.fy * 0.5).toFixed(0) + 'px) rotate(' + (f.spin * 0.55).toFixed(0) + 'deg) scale(.55)', opacity: 1, offset: 0.34 },
        { transform: 'translate(' + (f.fx * 0.1).toFixed(0) + 'px,' + (f.fy * 0.1).toFixed(0) + 'px) rotate(' + (f.spin * 0.12).toFixed(0) + 'deg) scale(1.05)', opacity: 1, offset: 0.82 },
        { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 1 }
      ], {
        duration: FLIGHT_MS,
        delay: LEAD_MS + i * STAGGER_MS,
        easing: 'cubic-bezier(.2,.72,.25,1)',
        fill: 'both'
      });
    });

    s.sparks.forEach(function (el) {
      var drift = (Math.random() - 0.5) * 200;
      run(el, [
        { transform: 'translate(' + drift.toFixed(0) + 'px,' + (s.h * 0.5).toFixed(0) + 'px) scale(.3) rotate(0deg)', opacity: 0 },
        { transform: 'translate(' + (drift * 0.4).toFixed(0) + 'px,' + (s.h * 0.16).toFixed(0) + 'px) scale(1) rotate(' + drift.toFixed(0) + 'deg)', opacity: 1, offset: 0.6 },
        { transform: 'translate(0,0) scale(1.2) rotate(' + (drift * 1.6).toFixed(0) + 'deg)', opacity: 1 }
      ], {
        duration: COVER_MS * 0.8,
        delay: LEAD_MS + Math.random() * 220,
        easing: 'cubic-bezier(.2,.7,.3,1)',
        fill: 'both'
      });
    });

    // The ice deliberately lags the crystals. Ramped evenly it reaches half
    // opacity while they are still arriving, so the screen is effectively
    // covered before there is anything to look at and the flurry is wasted.
    // Held low through the first half, it reads as frost spreading from where
    // each one landed and only then closing over.
    run(frost, [
      { opacity: 0, transform: 'scale(1.16) rotate(-4deg)' },
      { opacity: 0.5, transform: 'scale(1.06) rotate(-1.5deg)', offset: 0.6 },
      { opacity: 0.9, transform: 'scale(1) rotate(0deg)' }
    ], { duration: COVER_MS, easing: 'cubic-bezier(.4,0,.25,1)', fill: 'forwards' });

    return run(ice, [
      { opacity: 0, transform: 'scale(1.05)' },
      { opacity: 0.1, transform: 'scale(1.03)', offset: 0.42 },
      { opacity: 0.95, transform: 'scale(1)', offset: 0.84 },
      { opacity: 1, transform: 'scale(1)' }
    ], { duration: COVER_MS, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'forwards' });
  }

  /** The crystals lift away, the ice clears, the weather settles. */
  function reveal() {
    if (reduced() || !host) { weather(false); return Promise.resolve(); }

    var s = last;
    var h = host.clientHeight || 720;

    if (s) {
      // Out the way they came, last-landed first, so the sweep unwinds.
      var n = s.flakes.length;
      s.flakes.forEach(function (f, i) {
        run(f.el, [
          { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 1 },
          { transform: 'translate(0,0) rotate(' + (f.spin * -0.06).toFixed(0) + 'deg) scale(1.07)', opacity: 1, offset: 0.18 },
          { transform: 'translate(' + f.fx.toFixed(0) + 'px,' + f.fy.toFixed(0) + 'px) rotate(' + (f.spin * -0.9).toFixed(0) + 'deg) scale(.2)', opacity: 0 }
        ], {
          duration: REVEAL_MS,
          delay: (n - 1 - i) * 22,
          easing: 'cubic-bezier(.45,0,.3,1)',
          fill: 'forwards'
        });
      });
      s.sparks.forEach(function (el) {
        var drift = (Math.random() - 0.5) * 240;
        run(el, [
          { transform: 'translate(0,0) scale(1)', opacity: 1 },
          { transform: 'translate(' + drift.toFixed(0) + 'px,' + (h * (0.45 + Math.random() * 0.5)).toFixed(0) + 'px) scale(.35) rotate(' + (drift * 2).toFixed(0) + 'deg)', opacity: 0 }
        ], { duration: REVEAL_MS + Math.random() * 260, easing: 'cubic-bezier(.3,.1,.3,1)', fill: 'forwards' });
      });
    }

    if (global.SFX) SFX.play('sparkle');

    run(frost, [
      { opacity: 0.9, transform: 'scale(1)' },
      { opacity: 0, transform: 'scale(1.12) rotate(3deg)' }
    ], { duration: REVEAL_MS, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });

    return run(ice, [
      { opacity: 1, transform: 'scale(1)' },
      { opacity: 0, transform: 'scale(1.07)' }
    ], { duration: REVEAL_MS, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }).then(function () {
      host.style.opacity = '0';
      host.style.visibility = 'hidden';
      clear();
      last = null;
      // The gust outlives the cover by a moment on purpose: the snow is still
      // heavy as the new screen appears and settles back over the next beat,
      // so the weather does not stop dead the instant the ice lifts.
      setTimeout(function () { weather(false); }, 360);
    });
  }

  /** cover -> do the work -> reveal. The work is never seen, however slow. */
  function wipe(fn) {
    return cover()
      .then(function () { return fn ? fn() : null; })
      .then(function (r) { return reveal().then(function () { return r; }); },
            function (e) { return reveal().then(function () { throw e; }); });
  }

  /** Is the screen currently hidden behind the ice? */
  function covered() { return !!host && host.style.visibility === "visible"; }

  global.Transition = {
    mount: mount,
    covered: covered,
    cover: cover,
    reveal: reveal,
    wipe: wipe,
    get reducedMotion() { return reduced(); },
    COVER_MS: COVER_MS,
    REVEAL_MS: REVEAL_MS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.Transition;

})(typeof window !== 'undefined' ? window : this);
