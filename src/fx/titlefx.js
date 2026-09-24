/*!
 * titlefx.js — weather and sparkle on the title screen.
 *
 * The title art is a painting, and a painting that never moves announces
 * that nothing here moves. This puts the same snow that falls all through
 * the lesson in front of it, gives the picture a slow drift so it breathes,
 * and sets the play button glinting so the eye knows where to go.
 *
 * Three pieces, all cancellable:
 *
 *   snow     crystals from the same generator the weather and the transition
 *            use, falling across the whole screen in three depths — the near
 *            ones big, fast and softly out of focus, the far ones small, slow
 *            and faint. One field at one size reads as a screensaver; three
 *            depths read as being outdoors.
 *   drift    a very slow push in and out on the art itself, plus one pass of
 *            light across it, so the picture is never quite still.
 *   sparkle  fairy snow around the play button: crystals turning on its rim
 *            and four-point glints that fire and fade, staggered so they
 *            never twinkle in unison, over a glow that breathes. The button
 *            itself never moves — see sparkle().
 *
 * All of it is torn down the moment the lesson starts. A title screen that
 * keeps animating behind the game is a title screen that keeps costing
 * battery for something nobody can see.
 *
 *   TitleFx.mount(loadingEl)
 *   TitleFx.stop()
 */
(function (global) {
  'use strict';

  var FLAKES = 30;      // across the whole screen, in three depths
  var RIM_CRYSTALS = 5; // turning on the button's rim
  var GLINTS = 10;      // four-point sparkles around the button

  var anims = [], mounted = null;

  /* juice.js owns the motion preference for the whole game — see the note in
     transition.js. Asking the OS here as well would mean Juice.disable() left
     the title screen snowing. */
  function reduced() { return !!(global.Juice && Juice.reducedMotion); }

  function run(el, frames, opts) {
    if (!el || !el.animate) return null;
    try { var a = el.animate(frames, opts); anims.push(a); return a; }
    catch (e) { return null; }
  }

  function rnd(a, b) { return a + Math.random() * (b - a); }

  /* ------------------------------------------------------------------ *
   * Snow across the title art
   * ------------------------------------------------------------------ */

  /* Near, middle and far. Size, speed, opacity and blur all move together,
     because that is what depth is — one of them alone just looks like a
     mistake in the other three. */
  var DEPTHS = [
    { size: [40, 76], dur: [7000, 11000], op: [0.5, 0.8],  blur: 2.4, sway: 70, n: 0.22 },
    { size: [20, 38], dur: [11000, 17000], op: [0.55, 0.9], blur: 0.6, sway: 46, n: 0.36 },
    { size: [9, 18],  dur: [17000, 26000], op: [0.35, 0.7], blur: 0,   sway: 26, n: 0.42 }
  ];

  function snow(host) {
    var doc = host.ownerDocument, made = 0, d, i, count;
    for (d = 0; d < DEPTHS.length; d++) {
      count = Math.round(FLAKES * DEPTHS[d].n);
      for (i = 0; i < count; i++) { flake(doc, host, DEPTHS[d]); made++; }
    }
    return made;
  }

  function flake(doc, host, dep) {
    var size = rnd(dep.size[0], dep.size[1]);
    var build = size > 34 ? 0 : (size > 17 ? 1 : 2);
    var el = doc.createElement('div');
    el.className = 'tf-flake';
    el.style.cssText =
      'position:absolute;top:0;left:' + rnd(-4, 104).toFixed(1) + '%;' +
      'width:' + size.toFixed(0) + 'px;height:' + size.toFixed(0) + 'px;' +
      'opacity:' + rnd(dep.op[0], dep.op[1]).toFixed(2) + ';' +
      (dep.blur ? 'filter:blur(' + dep.blur + 'px);' : '') +
      'will-change:transform;';
    if (global.Snowflake) {
      el.innerHTML = Snowflake.svg(size, build, {
        weight: Math.max(1, size * 0.028),
        glow: 'rgba(190,228,255,.75)'
      });
    }
    host.appendChild(el);

    var sway = dep.sway * (Math.random() < 0.5 ? -1 : 1);
    var spin = (Math.random() < 0.5 ? -1 : 1) * rnd(160, 420);
    var dur = rnd(dep.dur[0], dep.dur[1]);

    // Fall measured in viewport height rather than pixels, so a window
    // resize on the title screen cannot strand a flake halfway.
    run(el, [
      { transform: 'translate(0px,-14vh) rotate(0deg)' },
      { transform: 'translate(' + sway.toFixed(0) + 'px,32vh) rotate(' + (spin * 0.35).toFixed(0) + 'deg)', offset: 0.35 },
      { transform: 'translate(' + (-sway * 0.7).toFixed(0) + 'px,74vh) rotate(' + (spin * 0.74).toFixed(0) + 'deg)', offset: 0.74 },
      { transform: 'translate(' + (sway * 0.4).toFixed(0) + 'px,116vh) rotate(' + spin.toFixed(0) + 'deg)' }
    ], { duration: dur, delay: -Math.random() * dur, iterations: Infinity, easing: 'linear' });
  }

  /* ------------------------------------------------------------------ *
   * The art itself
   * ------------------------------------------------------------------ */

  function drift(banner, sheen) {
    // Slow enough that it is never caught moving, large enough that the
    // screen is never the same twice.
    run(banner, [
      { transform: 'scale(1.035) translate(0,0)' },
      { transform: 'scale(1.055) translate(-.8%,-.5%)', offset: 0.5 },
      { transform: 'scale(1.035) translate(0,0)' }
    ], { duration: 26000, iterations: Infinity, easing: 'ease-in-out' });

    // One pass of cold light across the ice, a long way apart.
    run(sheen, [
      { transform: 'translateX(-130%) skewX(-16deg)', opacity: 0 },
      { transform: 'translateX(-40%) skewX(-16deg)', opacity: 0.5, offset: 0.14 },
      { transform: 'translateX(40%) skewX(-16deg)', opacity: 0.5, offset: 0.24 },
      { transform: 'translateX(130%) skewX(-16deg)', opacity: 0, offset: 0.38 },
      { transform: 'translateX(130%) skewX(-16deg)', opacity: 0 }
    ], { duration: 13000, iterations: Infinity, easing: 'linear' });
  }

  /* ------------------------------------------------------------------ *
   * Fairy snow on the play button
   * ------------------------------------------------------------------ */

  function sparkle(host, halo, btn) {
    var doc = host.ownerDocument, i;

    // THE GLOW BREATHES, NOT THE BUTTON.
    //
    // The obvious version scales #start itself, and it is wrong twice. A
    // WAAPI transform on the button outranks the :active press, so it stops
    // giving under the finger. And a target that never stops moving is a
    // target a seven-year-old has to chase — the one control on the screen
    // is the last thing that should be sliding about under their thumb.
    //
    // So the halo behind it pulses and the button holds still. The button
    // gets a glow that swells with it, through `filter`, which paints outside
    // the layout box and therefore moves nothing.
    run(halo, [
      { transform: 'scale(.94)', opacity: 0.65 },
      { transform: 'scale(1.08)', opacity: 1, offset: 0.5 },
      { transform: 'scale(.94)', opacity: 0.65 }
    ], { duration: 2400, iterations: Infinity, easing: 'ease-in-out' });

    if (btn) run(btn, [
      { filter: 'drop-shadow(0 10px 18px rgba(12,64,102,.45)) drop-shadow(0 0 0 rgba(255,229,150,0))' },
      { filter: 'drop-shadow(0 10px 18px rgba(12,64,102,.45)) drop-shadow(0 0 14px rgba(255,229,150,.85))', offset: 0.5 },
      { filter: 'drop-shadow(0 10px 18px rgba(12,64,102,.45)) drop-shadow(0 0 0 rgba(255,229,150,0))' }
    ], { duration: 2400, iterations: Infinity, easing: 'ease-in-out' });

    // Crystals turning on the rim.
    //
    // Two elements per crystal, not one. A ring carries it round — a plain
    // infinite rotation, so the radius is the ring's size and never has to be
    // recomputed when the button resizes — and the crystal inside fades up and
    // down on its own clock. Folded into a single animation the two would have
    // to share a period, and every flake would wink at the same point of every
    // lap.
    for (i = 0; i < RIM_CRYSTALS; i++) {
      var a0 = (i / RIM_CRYSTALS) * 360 + rnd(-16, 16);
      var size = rnd(18, 32);

      var ring = doc.createElement('div');
      ring.className = 'tf-ring';
      ring.style.cssText = 'position:absolute;inset:0;will-change:transform;';

      var el = doc.createElement('div');
      el.className = 'tf-rim';
      el.style.cssText =
        'position:absolute;left:50%;top:-7%;width:' + size.toFixed(0) + 'px;height:' + size.toFixed(0) + 'px;' +
        'margin-left:' + (-size / 2).toFixed(0) + 'px;opacity:0;will-change:transform,opacity;';
      if (global.Snowflake) {
        el.innerHTML = Snowflake.svg(size, i % 3, { weight: Math.max(1.1, size * 0.05), glow: 'rgba(255,238,186,.9)' });
      }
      ring.appendChild(el);
      host.appendChild(ring);

      run(ring, [
        { transform: 'rotate(' + a0.toFixed(0) + 'deg)' },
        { transform: 'rotate(' + (a0 + 360).toFixed(0) + 'deg)' }
      ], { duration: rnd(9000, 15000), iterations: Infinity, easing: 'linear' });

      run(el, [
        { transform: 'scale(.25) rotate(0deg)', opacity: 0 },
        { transform: 'scale(1) rotate(70deg)', opacity: 0.95, offset: 0.3 },
        { transform: 'scale(.95) rotate(180deg)', opacity: 0.85, offset: 0.68 },
        { transform: 'scale(.25) rotate(260deg)', opacity: 0 }
      ], {
        duration: rnd(3000, 4600),
        delay: -Math.random() * 4200,
        iterations: Infinity,
        easing: 'ease-in-out'
      });
    }

    // Four-point glints, firing in their own time.
    for (i = 0; i < GLINTS; i++) {
      var s = rnd(10, 26);
      var ang = Math.random() * Math.PI * 2;
      var rad = rnd(38, 62);
      var g = doc.createElement('div');
      g.className = 'tf-glint';
      g.style.cssText =
        'position:absolute;left:' + (50 + Math.cos(ang) * rad).toFixed(1) + '%;' +
        'top:' + (50 + Math.sin(ang) * rad).toFixed(1) + '%;' +
        'width:' + s.toFixed(0) + 'px;height:' + s.toFixed(0) + 'px;margin:' + (-s / 2).toFixed(0) + 'px 0 0 ' + (-s / 2).toFixed(0) + 'px;' +
        'opacity:0;will-change:transform,opacity;' +
        'background:' +
          'radial-gradient(closest-side,rgba(255,255,255,.95),rgba(255,255,255,0) 70%),' +
          'linear-gradient(0deg,transparent 46%,#fff 50%,transparent 54%),' +
          'linear-gradient(90deg,transparent 46%,#fff 50%,transparent 54%);';
      host.appendChild(g);

      run(g, [
        { transform: 'scale(.2) rotate(0deg)', opacity: 0 },
        { transform: 'scale(.2) rotate(0deg)', opacity: 0, offset: 0.62 },
        { transform: 'scale(1.25) rotate(50deg)', opacity: 1, offset: 0.78 },
        { transform: 'scale(.2) rotate(100deg)', opacity: 0 }
      ], {
        duration: rnd(2600, 4400),
        delay: -Math.random() * 4000,
        iterations: Infinity,
        easing: 'ease-in-out'
      });
    }
  }

  /**
   * The burst when the button is pressed.
   *
   * A press that only fades a screen out is a press you are not sure landed.
   * The glow flares, and a ring of crystals goes out from under the finger —
   * the same crystals falling behind it, so the button appears to knock the
   * snow off itself rather than to fire a generic particle effect.
   *
   * Each flake takes itself out of the document when it is done, because this
   * fires on the way to a screen where TitleFx.stop() is about to run and
   * anything left behind would be swept up half a second later regardless —
   * but the one case that matters is a press that does NOT start the game,
   * and there is no reason for it to leave litter.
   */
  /**
   * The button going down, and coming back up.
   *
   * THE IMAGE MOVES, THE BUTTON DOES NOT. A transform on #start changes the
   * box that a fingertip — and the browser's own hit testing — aims at, and a
   * control that moves out from under a press is a control that drops it.
   * The artwork inside it is free to squash as far as it likes.
   *
   * These are bound to pointerdown/up rather than to click, because click
   * does not arrive until the finger lifts. The press used to be drawn on
   * click alongside the curtain that covers it, so the one frame of feedback
   * a child gets for touching the only button on the screen was painted
   * underneath the transition that hid it.
   */
  function pressDown() {
    if (!mounted || reduced()) return;
    var img = mounted.querySelector('#start img');
    var halo = mounted.querySelector('.start-halo');
    if (img) run(img, [
      { transform: 'scale(1) translateY(0)' },
      { transform: 'scale(.9) translateY(5px)' }
    ], { duration: 90, easing: 'cubic-bezier(.3,0,.7,1)', fill: 'forwards' });
    if (halo) run(halo, [
      { transform: 'scale(1)', opacity: 1 },
      { transform: 'scale(.92)', opacity: 0.6 }
    ], { duration: 90, fill: 'forwards' });
  }

  function pressUp() {
    if (!mounted || reduced()) return;
    var img = mounted.querySelector('#start img');
    // the halo was held squashed by pressDown; let it breathe again
    var halo = mounted.querySelector('.start-halo');
    if (halo) run(halo, [
      { transform: 'scale(.92)', opacity: 0.6 },
      { transform: 'scale(1)', opacity: 1 }
    ], { duration: 160, fill: 'forwards' });
    if (img) run(img, [
      { transform: 'scale(.9) translateY(5px)' },
      { transform: 'scale(1.08) translateY(-3px)' },
      { transform: 'scale(1) translateY(0)' }
    ], { duration: 420, easing: 'cubic-bezier(.2,1.4,.35,1)', fill: 'forwards' });
  }

  function press() {
    if (!mounted || reduced()) return;
    var host = mounted.querySelector('.start-sparks');
    var halo = mounted.querySelector('.start-halo');
    if (!host) return;
    var doc = host.ownerDocument, i, n = 11;

    for (i = 0; i < n; i++) burstFlake(doc, host, (i / n) * 360 + rnd(-14, 14), i % 3);

    if (halo) run(halo, [
      { transform: 'scale(1)', opacity: 1 },
      { transform: 'scale(1.55)', opacity: 0 }
    ], { duration: 540, easing: 'cubic-bezier(.2,.8,.3,1)' });
  }

  function burstFlake(doc, host, deg, seed) {
    var size = rnd(14, 27);
    var el = doc.createElement('div');
    el.className = 'tf-burst';
    el.style.cssText =
      'position:absolute;left:50%;top:50%;width:' + size.toFixed(0) + 'px;height:' + size.toFixed(0) + 'px;' +
      'margin:' + (-size / 2).toFixed(0) + 'px 0 0 ' + (-size / 2).toFixed(0) + 'px;' +
      'will-change:transform,opacity;';
    if (global.Snowflake) {
      el.innerHTML = Snowflake.svg(size, seed, { weight: Math.max(1, size * 0.06), glow: 'rgba(255,240,196,.95)' });
    }
    host.appendChild(el);

    var a = deg * Math.PI / 180, r = rnd(72, 132);
    var an = run(el, [
      { transform: 'translate(0,0) scale(.25) rotate(0deg)', opacity: 1 },
      { transform: 'translate(' + (Math.cos(a) * r).toFixed(0) + 'px,' + (Math.sin(a) * r).toFixed(0) + 'px) scale(1.1) rotate(' + (deg > 180 ? -200 : 200) + 'deg)', opacity: 0 }
    ], { duration: rnd(520, 780), easing: 'cubic-bezier(.15,.8,.3,1)', fill: 'forwards' });

    var drop = function () { if (el.parentNode) el.parentNode.removeChild(el); };
    if (an && an.finished) an.finished.then(drop, drop); else setTimeout(drop, 800);
  }

  /* ------------------------------------------------------------------ *
   * Where the play button goes
   * ------------------------------------------------------------------ */

  // A point in the PAINTING, not in the window: the open ice below the logo,
  // clear of the sledge on the left, the deer in the middle and the dark
  // snow mound in the bottom-right corner.
  var PLAY_AT = { x: 0.775, y: 0.755 };

  // The idle mid-point of the drift in drift(): the art is held at 1.035 and
  // pushed to 1.055, so on average it is showing at this zoom. Ignoring it
  // puts the button a couple of per cent off the mark it was measured for.
  var ART_ZOOM = 1.045;

  /**
   * Put the button on that point.
   *
   * `object-fit: cover` means the picture and the window only agree about
   * where anything is when their aspect ratios match. Everywhere else the art
   * is cropped — on a phone held upright, most of its width — so a button
   * positioned as a percentage of the WINDOW slides off the ice and ends up
   * over the deer. This does the cover arithmetic the browser does, finds the
   * anchor inside the drawn picture, and clamps the result so the button can
   * never leave the screen even when the crop takes the ice with it.
   */
  function placePlay(root) {
    var art = root.querySelector('.title-art');
    var play = root.querySelector('.title-play');
    if (!art || !play) return;

    var W = root.clientWidth, H = root.clientHeight;
    if (!W || !H) return;
    var nw = art.naturalWidth || 1400, nh = art.naturalHeight || 788;

    var s = Math.max(W / nw, H / nh);            // cover
    var dw = nw * s, dh = nh * s;
    var ox = (W - dw) * 0.5;                     // object-position: 50% 40%
    var oy = (H - dh) * 0.40;

    var px = ox + dw * PLAY_AT.x;
    var py = oy + dh * PLAY_AT.y;

    // ...then the CSS scale, which happens about the element's own centre.
    px = W / 2 + ART_ZOOM * (px - W / 2);
    py = H / 2 + ART_ZOOM * (py - H / 2);

    var pad = (play.offsetWidth || 120) * 0.7 + 14;
    play.style.left = Math.max(pad, Math.min(W - pad, px)).toFixed(0) + 'px';
    play.style.top = Math.max(pad, Math.min(H - pad, py)).toFixed(0) + 'px';
  }

  /* ------------------------------------------------------------------ */

  function onResize() { if (mounted) placePlay(mounted); }

  function mount(root) {
    if (!root || mounted === root) return;
    stop();
    // Reduced motion loses the weather, not the layout: the button still has
    // to be on the ice.
    if (reduced()) { mounted = root; placePlay(root); global.addEventListener('resize', onResize); return; }

    var banner = root.querySelector('.title-art');
    var sheen = root.querySelector('.title-sheen');
    var field = root.querySelector('.title-snow');
    var sparks = root.querySelector('.start-sparks');
    var halo = root.querySelector('.start-halo');
    var btn = root.querySelector('#start');

    if (field) snow(field);
    if (banner && sheen) drift(banner, sheen);
    if (sparks && halo) sparkle(sparks, halo, btn);

    mounted = root;
    placePlay(root);
    // naturalWidth is 0 until the banner has decoded, and the whole placement
    // is arithmetic on the banner's own dimensions.
    if (banner && !banner.complete) banner.addEventListener('load', onResize, { once: true });
    global.addEventListener('resize', onResize);
  }

  /** Cancel everything and take the particles back out of the document. */
  function stop() {
    global.removeEventListener('resize', onResize);
    anims.forEach(function (a) { try { a.cancel(); } catch (e) {} });
    anims = [];
    if (mounted) {
      ['.title-snow', '.start-sparks'].forEach(function (sel) {
        var h = mounted.querySelector(sel);
        while (h && h.firstChild) h.removeChild(h.firstChild);
      });
    }
    mounted = null;
  }

  global.TitleFx = {
    mount: mount, stop: stop, placePlay: placePlay, press: press,
    pressDown: pressDown, pressUp: pressUp,
    get running() { return anims.length > 0; }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.TitleFx;

})(typeof window !== 'undefined' ? window : this);
