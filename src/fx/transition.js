/*!
 * transition.js — the snowfall between screens.
 *
 * A gentle shower of magical snowflakes sweeps the screen to move the story
 * forward. Flakes appear at the top and fall in three depths — big slow ones
 * in front, small soft ones behind — swaying, turning and twinkling as they
 * go. Under them a veil of pale ice thickens until the old screen is hidden;
 * the game rebuilds the scene behind it; then a soft bloom of light swells
 * over everything, the veil melts away under a denser flurry, and the new
 * screen comes up through the falling snow as it clears.
 *
 * It is a storybook effect, not weather: no wind, no blizzard, nothing fast.
 *
 * HOW THE GAME USES IT (game.js):
 *   Transition.mount(container)         once, over the whole game
 *   Transition.cover()  -> Promise      the snow builds until the screen is hidden
 *   Transition.covered()                is the screen hidden right now?
 *   Transition.reveal() -> Promise      the veil melts, the snow clears
 *   Transition.wipe(fn)                 cover, run fn, reveal
 *   Transition.play(onMidpoint, onComplete)   the same, as two callbacks
 *
 * WHERE TO TUNE IT: CONFIG below, or Transition.configure({...}) at runtime.
 * Every number that matters to the feel is there — duration, count, size
 * range, fall speed, drift, rotation, glow, peak density — nothing is buried
 * in the code.
 *
 * SOUND HOOKS (all optional, all through SFX if it is loaded):
 *   sfx.chime    as the first flakes appear
 *   sfx.whoosh   at the midpoint, as the veil begins to melt
 *   sfx.sparkle  with the denser flurry at the midpoint
 *
 * Every flake is the supplied artwork (assets/ui/snowflake.webp, built from
 * snowflake-src.png by tools/build-snowflake.js): pale ice arms with a blue
 * rim and a gem at the heart, drawn at every size and depth.
 *
 * Reduced motion: the transition does nothing at all, and the game simply
 * changes screen. Performance: about two hundred nodes at the peak, all of
 * them animated with the Web Animations API on transform and opacity only,
 * all removed when the snow clears.
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Settings — the feel lives here
   * ------------------------------------------------------------------ */
  var CONFIG = {
    coverMs: 1100,          // from the first flake to the old screen hidden
    revealMs: 1400,         // from the veil beginning to melt to the last flake gone
    count: 84,              // flakes over a 1280×720 window; scales with area
    size: [22, 124],        // px: the smallest back flake .. the biggest front flake
    fallSpeed: 1,           // 1 = a slow storybook fall; 2 = twice as fast
    drift: 46,              // px of side-to-side sway
    rotation: 70,           // degrees a flake turns over its whole fall
    glow: 0.8,              // 0 = the artwork as is, 1 = a soft bloom round every front flake
    peakDensity: 1.6,       // the flurry at the midpoint, as a multiple of the base density
    sparkles: 26,           // tiny twinkles between the flakes
    flake: 'assets/ui/snowflake.webp',   // the artwork every flake is drawn from
    sfx: { chime: 'sparkle', whoosh: 'menuWhoosh', sparkle: 'sparkle' }
  };

  /* the three depths: how big, how slow, how bright */
  var LAYERS = [
    { id: 'back',  share: 0.40, size: [0.00, 0.30], fall: [1500, 2300], opacity: 0.55, glow: 0.0, blur: 0.6 },
    { id: 'mid',   share: 0.38, size: [0.28, 0.62], fall: [2000, 2900], opacity: 0.85, glow: 0.0, blur: 0.0 },
    { id: 'front', share: 0.22, size: [0.60, 1.00], fall: [2600, 3500], opacity: 1.00, glow: 1.0, blur: 0.0 }
  ];

  var host = null, veil = null, bloom = null, layerEls = {}, sparkleLayer = null;
  var gen = 0;            // a new cover() or clear() retires every pending timer
  var timers = [];

  function reduced() { return !!(global.Juice && Juice.reducedMotion); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function later(ms, fn) {
    var g = gen;
    var t = setTimeout(function () { if (g === gen) fn(); }, ms);
    timers.push(t);
    return t;
  }
  function run(el, frames, opts) {
    if (!el || !el.animate) return Promise.resolve();
    try { return el.animate(frames, opts).finished.catch(function () {}); }
    catch (e) { return Promise.resolve(); }
  }
  function sfx(name, o) {
    if (!name || !global.SFX || !SFX.play) return;
    try { SFX.play(name, o || {}); } catch (e) {}
  }
  function weather(on) {
    if (global.Stage && Stage.flurry) { try { Stage.flurry(on); } catch (e) {} }
  }

  /* ------------------------------------------------------------------ *
   * Mounting
   * ------------------------------------------------------------------ */
  function mount(container) {
    if (!container || !container.ownerDocument) return null;
    if (host && host.parentNode === container) return host;
    var doc = container.ownerDocument;

    host = doc.createElement('div');
    host.className = 'snow-wipe';
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText =
      'position:absolute;inset:0;z-index:8;overflow:hidden;pointer-events:none;' +
      'opacity:0;visibility:hidden;';

    // THE VEIL. Pale ice that thickens under the snow until the old screen is
    // gone. It is what guarantees the cover: sixty flakes are a shower, not a
    // wall, and a wall of flakes would be the clutter this must not be.
    veil = doc.createElement('div');
    veil.style.cssText =
      'position:absolute;inset:0;opacity:0;' +
      'background:radial-gradient(ellipse at 50% 40%, rgba(255,255,255,.55), rgba(255,255,255,0) 70%),' +
      'linear-gradient(180deg,#e9f7ff 0%,#d4ecff 55%,#eef9ff 100%);';
    host.appendChild(veil);

    // THE BLOOM. A soft light that swells and fades at the midpoint, over
    // everything: it is the magic of the moment, and it hides the instant
    // the veil begins to thin.
    bloom = doc.createElement('div');
    bloom.style.cssText =
      'position:absolute;inset:-10%;opacity:0;pointer-events:none;' +
      'background:radial-gradient(ellipse at 50% 45%, rgba(255,255,255,.95) 0%, rgba(240,250,255,.6) 35%, rgba(240,250,255,0) 70%);';
    host.appendChild(bloom);

    LAYERS.forEach(function (L) {
      var el = doc.createElement('div');
      el.className = 'snow-layer snow-' + L.id;
      el.style.cssText = 'position:absolute;inset:0;overflow:hidden;' + (L.blur ? 'filter:blur(' + L.blur + 'px);' : '');
      host.appendChild(el);
      layerEls[L.id] = el;
    });
    sparkleLayer = doc.createElement('div');
    sparkleLayer.style.cssText = 'position:absolute;inset:0;';
    host.appendChild(sparkleLayer);

    container.appendChild(host);
    preloadFlake(doc);
    return host;
  }

  /* The promises a cover or a reveal handed out, so a cover that interrupts
     a reveal still lets whoever was waiting on the reveal go on. */
  var waiting = [];
  function settleAll() { waiting.splice(0).forEach(function (r) { try { r(); } catch (e) {} }); }
  function clear() {
    gen++;
    timers.forEach(function (t) { clearTimeout(t); });
    timers.length = 0;
    // EVERYTHING THAT WAS MOVING STOPS, the overlay's own fade included. A
    // reveal ends by fading the whole layer to nothing and holding it there;
    // a cover that began before that fade was cancelled drew its snow into a
    // layer pinned at opacity 0 — the new screen was built in full view. And
    // each flake's sway and twinkle run forever, so without this they went on
    // running on flakes that were no longer on the page.
    if (host) { try { host.getAnimations({ subtree: true }).forEach(function (a) { a.cancel(); }); } catch (e) {} }
    settleAll();
    Object.keys(layerEls).forEach(function (k) { var el = layerEls[k]; while (el.firstChild) el.removeChild(el.firstChild); });
    if (sparkleLayer) while (sparkleLayer.firstChild) sparkleLayer.removeChild(sparkleLayer.firstChild);
    if (veil) { try { veil.getAnimations().forEach(function (a) { a.cancel(); }); } catch (e) {} veil.style.opacity = '0'; veil.style.clipPath = ''; }
    if (bloom) { try { bloom.getAnimations().forEach(function (a) { a.cancel(); }); } catch (e) {} bloom.style.opacity = '0'; }
  }

  /* ------------------------------------------------------------------ *
   * One flake
   * ------------------------------------------------------------------ */

  /**
   * THE FLAKE IS THE ARTWORK. One painted snowflake — pale ice arms with a
   * blue rim and a gem at the heart, supplied for this — drawn at every size
   * and depth. A few carry a lavender cast for variety; the front ones carry
   * a soft bloom. The image is decoded once and shared by every <img>.
   */
  var flakeReady = null;
  function preloadFlake(doc) {
    if (flakeReady || !doc) return;
    var im = doc.createElement('img'); im.src = CONFIG.flake; flakeReady = im;
  }
  function flakeIMG(size, glow, lavender) {
    var f = [];
    if (glow > 0.02) f.push('drop-shadow(0 0 ' + (size * 0.1 * glow).toFixed(1) + 'px rgba(170,225,255,' + (0.9 * glow).toFixed(2) + '))');
    if (lavender) f.push('hue-rotate(22deg) saturate(1.15)');
    return '<img src="' + CONFIG.flake + '" alt="" draggable="false" ' +
           'style="display:block;width:100%;height:100%;user-select:none;' + (f.length ? 'filter:' + f.join(' ') + ';' : '') + '">';
  }

  /**
   * Drop one flake from the top. Three nested boxes, each with one job the
   * Web Animations API can run on the compositor: the outer falls, the
   * middle sways, the inner turns, breathes and twinkles.
   */
  function drop(L, w, h, delay, scaleK) {
    var doc = host.ownerDocument, el = layerEls[L.id];
    var c = CONFIG;
    var t = rnd(L.size[0], L.size[1]);
    var size = (c.size[0] + (c.size[1] - c.size[0]) * t) * scaleK;
    var x = rnd(-size, w + size * 0.2);
    var fall = rnd(L.fall[0], L.fall[1]) / Math.max(0.2, c.fallSpeed);
    var sway = rnd(1700, 2900), driftPx = c.drift * rnd(0.5, 1.15) * (Math.random() < 0.5 ? -1 : 1);
    var turn = c.rotation * rnd(0.5, 1.1) * (Math.random() < 0.5 ? -1 : 1);

    var outer = doc.createElement('div');
    outer.style.cssText = 'position:absolute;left:' + x.toFixed(0) + 'px;top:' + (-size * 1.4).toFixed(0) + 'px;' +
                          'width:' + size + 'px;height:' + size + 'px;opacity:0;will-change:transform,opacity;';
    var mid = doc.createElement('div');
    // only the outer box is promoted: a hundred flakes with three promoted
    // boxes each was three hundred compositor layers
    mid.style.cssText = 'position:absolute;inset:0;';
    var inner = doc.createElement('div');
    inner.style.cssText = 'position:absolute;inset:0;';
    inner.innerHTML = flakeIMG(size, L.glow * c.glow, Math.random() < 0.14);
    mid.appendChild(inner); outer.appendChild(mid); el.appendChild(outer);

    var peak = L.opacity;
    // the fall, with a soft arrival and a fade before the ground
    run(outer, [
      { transform: 'translate3d(0,0,0)', opacity: 0, offset: 0 },
      { transform: 'translate3d(0,' + (h * 0.08).toFixed(0) + 'px,0)', opacity: peak, offset: 0.1 },
      { transform: 'translate3d(0,' + (h * 0.84 + size).toFixed(0) + 'px,0)', opacity: peak, offset: 0.86 },
      { transform: 'translate3d(0,' + (h + size * 2.8).toFixed(0) + 'px,0)', opacity: 0, offset: 1 }
    ], { duration: fall, delay: delay, easing: 'cubic-bezier(.3,.12,.55,1)', fill: 'forwards' })
      .then(function () {
        // its endless sway and twinkle go with it
        try { outer.getAnimations({ subtree: true }).forEach(function (a) { a.cancel(); }); } catch (e) {}
        if (outer.parentNode) outer.parentNode.removeChild(outer);
      });
    // the sway, to and fro for as long as it falls
    run(mid, [
      { transform: 'translate3d(' + (-driftPx).toFixed(0) + 'px,0,0)' },
      { transform: 'translate3d(' + driftPx.toFixed(0) + 'px,0,0)' }
    ], { duration: sway, delay: delay, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
    // the turn, the breath and the twinkle
    run(inner, [
      { transform: 'rotate(0deg) scale(.92)' },
      { transform: 'rotate(' + (turn * 0.5).toFixed(0) + 'deg) scale(1.06)', offset: 0.5 },
      { transform: 'rotate(' + turn.toFixed(0) + 'deg) scale(.96)' }
    ], { duration: fall, delay: delay, easing: 'ease-in-out' });
    if (Math.random() < 0.5) {
      var svg = inner.firstChild;
      run(svg, [{ opacity: 1 }, { opacity: 0.62 }, { opacity: 1 }],
          { duration: rnd(700, 1300), delay: delay + rnd(0, 600), iterations: Infinity, easing: 'ease-in-out' });
    }
  }

  /** A tiny twinkle between the flakes: a soft dot that flares and is gone. */
  function twinkle(w, h, delay) {
    var doc = host.ownerDocument;
    var s = rnd(5, 11), x = rnd(w * 0.04, w * 0.96), y = rnd(h * 0.04, h * 0.9);
    var el = doc.createElement('div');
    el.style.cssText =
      'position:absolute;left:' + x.toFixed(0) + 'px;top:' + y.toFixed(0) + 'px;width:' + s + 'px;height:' + s + 'px;' +
      'margin:' + (-s / 2) + 'px;opacity:0;border-radius:50%;will-change:transform,opacity;' +
      'background:radial-gradient(circle,#fff 0%,rgba(255,255,255,.95) 35%,rgba(190,235,255,0) 72%);';
    sparkleLayer.appendChild(el);
    run(el, [
      { opacity: 0, transform: 'scale(.3) rotate(0deg)' },
      { opacity: 1, transform: 'scale(1.4) rotate(45deg)', offset: 0.35 },
      { opacity: 0, transform: 'scale(.4) rotate(90deg)' }
    ], { duration: rnd(600, 1000), delay: delay, easing: 'ease-in-out', fill: 'forwards' })
      .then(function () { if (el.parentNode) el.parentNode.removeChild(el); });
  }

  /** The flake count for this window, and the size scale for its height. */
  function measure() {
    var w = host.clientWidth || 1280, h = host.clientHeight || 720;
    var area = Math.max(0.55, Math.min(1.6, (w * h) / (1280 * 720)));
    var k = Math.max(0.7, Math.min(1.25, h / 720));
    return { w: w, h: h, count: Math.round(CONFIG.count * area), k: k };
  }

  /** A shower of n flakes over `spread` ms, ramping denser toward the end. */
  function shower(n, spread, m, ramp) {
    var i, L, k;
    for (i = 0; i < n; i++) {
      var r = Math.random();
      var acc = 0;
      for (k = 0; k < LAYERS.length; k++) { acc += LAYERS[k].share; if (r <= acc) break; }
      L = LAYERS[Math.min(k, LAYERS.length - 1)];
      var frac = (i + Math.random()) / n;
      var delay = spread * (ramp ? Math.pow(frac, 0.65) : frac);
      drop(L, m.w, m.h, delay, m.k);
    }
  }

  /* ------------------------------------------------------------------ *
   * The two halves
   * ------------------------------------------------------------------ */

  /** The snow begins, and thickens until the old screen is hidden. */
  function cover() {
    if (reduced() || !host) return Promise.resolve();
    clear();
    var m = measure(), c = CONFIG;
    host.style.visibility = 'visible';
    host.style.opacity = '1';
    weather(true);
    sfx(c.sfx.chime, { gain: 0.06 });

    // the flakes appear from the top over most of the cover, denser as it goes
    shower(m.count, c.coverMs * 0.85, m, true);
    // and a few twinkles as the veil thickens
    for (var i = 0; i < Math.round(c.sparkles * 0.5); i++) twinkle(m.w, m.h, c.coverMs * (0.35 + 0.55 * Math.random()));

    // the veil: nothing, then a haze, then a wall — behind the flakes, and
    // late, so the snow is seen to bring it
    run(veil, [
      { opacity: 0, offset: 0 },
      { opacity: 0.18, offset: 0.4 },
      { opacity: 0.7, offset: 0.78 },
      { opacity: 1, offset: 1 }
    ], { duration: c.coverMs, easing: 'cubic-bezier(.45,.05,.55,1)', fill: 'forwards' });

    return new Promise(function (resolve) { waiting.push(resolve); later(c.coverMs, settleAll); });
  }

  /** The veil lifts from the top down, a last flurry drifts by, the snow clears. */
  function reveal() {
    if (reduced() || !host) { weather(false); return Promise.resolve(); }
    var m = measure(), c = CONFIG;
    var g = gen;
    sfx(c.sfx.whoosh, { gain: 0.05 });

    // THE MIDPOINT FLURRY: a little denser for a moment, with its twinkles,
    // so the change of scene has a flourish
    shower(Math.round(m.count * Math.max(0, c.peakDensity - 1) + m.count * 0.25), 320, m, false);
    for (var i = 0; i < Math.round(c.sparkles * 0.6); i++) twinkle(m.w, m.h, rnd(0, 500));
    later(140, function () { sfx(c.sfx.sparkle, { gain: 0.05 }); });

    // THE MELT. Not a sheet drawn off the screen: the veil thins everywhere
    // at once under the flurry, slowly at first, and the new scene comes up
    // through the falling snow — as the bloom fades from over it.
    var melt = c.revealMs * 0.78, wait = 140;
    run(veil, [
      { opacity: 1, offset: 0 },
      { opacity: 0.85, offset: 0.25 },
      { opacity: 0.3, offset: 0.7 },
      { opacity: 0, offset: 1 }
    ], { duration: melt, delay: wait, easing: 'cubic-bezier(.5,.1,.35,1)', fill: 'forwards' });
    run(bloom, [
      { opacity: 0, transform: 'scale(.7)' },
      { opacity: 0.9, transform: 'scale(1)', offset: 0.3 },
      { opacity: 0, transform: 'scale(1.25)' }
    ], { duration: Math.min(900, c.revealMs * 0.6), easing: 'ease-out', fill: 'forwards' });

    // the last flakes fade with the whole layer, so none is cut off mid-fall
    var fadeMs = 380;
    run(host, [{ opacity: 1 }, { opacity: 0 }],
        { duration: fadeMs, delay: Math.max(0, c.revealMs - fadeMs), easing: 'ease-in', fill: 'forwards' });

    return new Promise(function (resolve) {
      waiting.push(resolve);
      later(c.revealMs, function () {
        if (g !== gen) { resolve(); return; }
        weather(false);
        host.style.opacity = '0';
        host.style.visibility = 'hidden';
        try { host.getAnimations().forEach(function (a) { a.cancel(); }); } catch (e) {}
        clear();
        resolve();
      });
    });
  }

  /** Cover, do the thing, reveal. */
  function wipe(fn) {
    return cover()
      .then(function () { return fn ? fn() : null; })
      .then(function (r) { return reveal().then(function () { return r; }); },
            function (e) { return reveal().then(function () { throw e; }); });
  }

  /** The same, as callbacks: playSnowTransition(onMidpoint, onComplete). */
  function play(onMidpoint, onComplete) {
    return wipe(onMidpoint).then(function (r) { if (onComplete) onComplete(r); return r; });
  }

  /** Is the screen hidden behind the snow right now? */
  function covered() { return !!host && host.style.visibility === 'visible'; }

  /** Change any setting at runtime: Transition.configure({ count: 90, glow: 0.4 }). */
  function configure(opts) {
    Object.keys(opts || {}).forEach(function (k) {
      if (k === 'sfx') CONFIG.sfx = Object.assign({}, CONFIG.sfx, opts.sfx || {});
      else if (k in CONFIG) CONFIG[k] = opts[k];
    });
    return CONFIG;
  }

  global.Transition = {
    mount: mount,
    covered: covered,
    cover: cover,
    reveal: reveal,
    wipe: wipe,
    play: play,
    configure: configure,
    get config() { return CONFIG; },
    get reducedMotion() { return reduced(); },
    get COVER_MS() { return CONFIG.coverMs; },
    get REVEAL_MS() { return CONFIG.revealMs; }
  };
  global.playSnowTransition = play;
  if (typeof module !== 'undefined' && module.exports) module.exports = global.Transition;

})(typeof window !== 'undefined' ? window : this);
