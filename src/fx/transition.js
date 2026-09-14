/*!
 * transition.js — the snow wipe between screens.
 *
 * A cut between two screens is the moment a lesson feels like a slideshow.
 * This replaces the cut with a flurry: fairy snow sweeps up over the whole
 * screen, the scene changes behind it, and the flurry blows away.
 *
 * Two halves, deliberately separate:
 *
 *   cover()   snow sweeps in and the veil goes opaque. Resolves when the old
 *             screen is genuinely hidden — the caller may only rebuild the
 *             stage after this, or the child sees the change happen.
 *   reveal()  the veil drops and the flurry disperses downward. Resolves when
 *             the screen is clear again.
 *
 * Splitting them is what makes it a transition rather than a flash: the work
 * between the two calls is invisible, however long it takes, so a slow scene
 * build can never show its seams.
 *
 * Costs: about 70 short-lived elements for a second, then nothing. Under
 * reduced motion both halves resolve immediately and nothing is drawn, so the
 * screen changes instantly rather than swirling at someone who asked it not
 * to.
 *
 *   Transition.mount(container)
 *   await Transition.cover(); ...change the scene...; await Transition.reveal();
 *   Transition.wipe(fn)       // the two halves with `fn` in between
 */
(function (global) {
  'use strict';

  var COVER_MS = 560;
  var REVEAL_MS = 620;
  var FLAKES = 54;
  var SPARKS = 14;

  var host = null, veil = null, field = null;
  var reduced = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (global.matchMedia) {
    try {
      var mq = global.matchMedia('(prefers-reduced-motion: reduce)');
      if (mq.addEventListener) mq.addEventListener('change', function (e) { reduced = e.matches; });
    } catch (e) {}
  }

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

    // The veil is what actually hides the scene. The particles sell it; the
    // veil does the work, which is why it is a plain gradient and not a
    // thousand overlapping flakes.
    veil = doc.createElement('div');
    veil.style.cssText =
      'position:absolute;inset:-10%;opacity:0;' +
      'background:radial-gradient(120% 80% at 50% 60%, #ffffff 0%, #eaf6ff 45%, #cfe9fb 100%);';

    field = doc.createElement('div');
    field.style.cssText = 'position:absolute;inset:0;';

    host.appendChild(veil);
    host.appendChild(field);
    container.appendChild(host);
    return host;
  }

  function clear() {
    if (field) while (field.firstChild) field.removeChild(field.firstChild);
  }

  /** A soft round flake with a faint glow. */
  function flake(doc, w, h) {
    var el = doc.createElement('div');
    var r = 3 + Math.random() * 11;
    el.style.cssText =
      'position:absolute;border-radius:50%;background:#fff;' +
      'width:' + r.toFixed(1) + 'px;height:' + r.toFixed(1) + 'px;' +
      'left:' + (Math.random() * w).toFixed(0) + 'px;' +
      'top:' + (Math.random() * h).toFixed(0) + 'px;' +
      'box-shadow:0 0 ' + (r * 1.6).toFixed(0) + 'px ' + (r * 0.5).toFixed(0) + 'px rgba(214,240,255,.9);' +
      'opacity:0;will-change:transform,opacity;';
    return el;
  }

  /** A four-point sparkle — the "fairy" half of fairy snow. */
  function spark(doc, w, h) {
    var el = doc.createElement('div');
    var s = 10 + Math.random() * 22;
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

  function seed(doc) {
    var w = host.clientWidth || 1280, h = host.clientHeight || 720;
    var i, el, parts = [];
    for (i = 0; i < FLAKES; i++) { el = flake(doc, w, h); field.appendChild(el); parts.push({ el: el, spark: false }); }
    for (i = 0; i < SPARKS; i++) { el = spark(doc, w, h); field.appendChild(el); parts.push({ el: el, spark: true }); }
    return { parts: parts, h: h };
  }

  function run(el, frames, opts) {
    if (!el.animate) return Promise.resolve();
    try { return el.animate(frames, opts).finished.catch(function () {}); }
    catch (e) { return Promise.resolve(); }
  }

  /**
   * Sweep in and hide the screen.
   *
   * Flakes rise rather than fall on the way in: it reads as the snow being
   * caught up and thrown over the scene, which is the storybook gesture. They
   * fall on the way out, when gravity is allowed back.
   */
  function cover() {
    if (reduced || !host) return Promise.resolve();
    var doc = host.ownerDocument;
    clear();
    host.style.visibility = 'visible';
    host.style.opacity = '1';

    var s = seed(doc);
    s.parts.forEach(function (p) {
      var drift = (Math.random() - 0.5) * 160;
      var rise = s.h * (0.5 + Math.random() * 0.7);
      run(p.el, [
        { transform: 'translate(0,' + rise.toFixed(0) + 'px) scale(.3) rotate(0deg)', opacity: 0 },
        { transform: 'translate(' + (drift * 0.4).toFixed(0) + 'px,' + (rise * 0.35).toFixed(0) + 'px) scale(1) rotate(' + (drift).toFixed(0) + 'deg)', opacity: 1, offset: 0.55 },
        { transform: 'translate(' + drift.toFixed(0) + 'px,0) scale(' + (p.spark ? 1.25 : 1.1) + ') rotate(' + (drift * 1.8).toFixed(0) + 'deg)', opacity: 1 }
      ], { duration: COVER_MS + Math.random() * 160, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
    });

    if (global.SFX) SFX.play('menuWhoosh');

    // The veil deliberately lags the snow. Ramped evenly it reached half
    // opacity while the flakes were still arriving, so the screen was
    // effectively white before there was anything to look at and the flurry
    // was wasted. Held low for the first half, it reads as snow gathering
    // over the scene and only then closing over it.
    return run(veil, [
      { opacity: 0, transform: 'scale(1.06)' },
      { opacity: 0.12, transform: 'scale(1.03)', offset: 0.45 },
      { opacity: 1, transform: 'scale(1)' }
    ], { duration: COVER_MS, easing: 'cubic-bezier(.55,0,.3,1)', fill: 'forwards' });
  }

  /** Drop the veil and let the flurry blow away downward. */
  function reveal() {
    if (reduced || !host) return Promise.resolve();

    var kids = field ? [].slice.call(field.childNodes) : [];
    var h = host.clientHeight || 720;
    kids.forEach(function (el) {
      var drift = (Math.random() - 0.5) * 220;
      run(el, [
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: 'translate(' + drift.toFixed(0) + 'px,' + (h * (0.5 + Math.random() * 0.6)).toFixed(0) + 'px) scale(.4) rotate(' + (drift * 2).toFixed(0) + 'deg)', opacity: 0 }
      ], { duration: REVEAL_MS + Math.random() * 320, easing: 'cubic-bezier(.3,.1,.3,1)', fill: 'forwards' });
    });

    if (global.SFX) SFX.play('sparkle');

    return run(veil, [
      { opacity: 1, transform: 'scale(1)' },
      { opacity: 0, transform: 'scale(1.08)' }
    ], { duration: REVEAL_MS, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }).then(function () {
      host.style.opacity = '0';
      host.style.visibility = 'hidden';
      clear();
    });
  }

  /** cover -> do the work -> reveal. The work is never seen, however slow. */
  function wipe(fn) {
    return cover()
      .then(function () { return fn ? fn() : null; })
      .then(function (r) { return reveal().then(function () { return r; }); },
            function (e) { return reveal().then(function () { throw e; }); });
  }

  /** Is the screen currently hidden behind the snow? */
  function covered() { return !!host && host.style.visibility === "visible"; }

  global.Transition = {
    mount: mount,
    covered: covered,
    cover: cover,
    reveal: reveal,
    wipe: wipe,
    get reducedMotion() { return reduced; },
    COVER_MS: COVER_MS,
    REVEAL_MS: REVEAL_MS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.Transition;

})(typeof window !== 'undefined' ? window : this);
