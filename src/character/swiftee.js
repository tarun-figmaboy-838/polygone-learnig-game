/*!
 * swiftee.js — the companion, driven by the real sprite sheets.
 *
 * The vector placeholder is gone. This plays the rendered Rive rig from
 * `assets/swiftee/` through `swiftee-frames.js`, which is generated from
 * `atlas/swiftee.manifest.json` — nothing here hardcodes a frame count, a
 * grid, a sheet path or a state name, and `tools/build-swiftee-frames.js` fails
 * the build if the manifest and the files on disk ever disagree.
 *
 * What makes the sheets work, and what this file must not break:
 *
 *   UNIFORM GRID   Frame i lives at (i % cols, i / cols), one cell each,
 *                  left-to-right then top-to-bottom. Slicing needs nothing
 *                  but the cell size.
 *   CENTRE PIVOT   Every frame of every animation registers on the exact
 *                  cell centre, so swapping expressions never makes the
 *                  character jump. We render one cell at a fixed 256 CSS px
 *                  and scale the wrapper, so the pivot survives every size.
 *   BASELINE       The standing character's feet are at 87.7% down the cell,
 *                  not the cell edge. That, not the bottom, is aligned to
 *                  the ground — which is why `translate(-50%, -87.7%)`.
 *   FULL TRIAD     Most expressions ship as start -> loop -> stop. Cutting
 *                  from one loop into another skips the transition the
 *                  animator drew. Every switch here plays the outgoing
 *                  `stop` before the incoming `start`.
 *
 * The game speaks sixteen semantic states (screens.js has never heard of
 * "puzzleing"). STATES below is the whole translation layer; the storyboard
 * did not change to accommodate the art.
 *
 *   Swiftee.mount(container, { layout })
 *   Swiftee.play('celebrate')            -> Promise (resolves when it settles)
 *   Swiftee.play('move', { to: 'left-low', size: 'medium' })
 *   Swiftee.speaking(true|false)          // rests on `talking` while narrating
 *   Swiftee.lookAt(elementOrPoint)        // lean, not pupils — it is a sprite
 */
(function (global) {
  'use strict';

  var F = global.SwifteeFrames;

  /** One cell, always rendered at this CSS size; the wrapper scales. */
  var CELL_PX = 256;

  /* ------------------------------------------------------------------ *
   * The translation layer: storyboard state -> rig state.
   *
   * `loops` is how many times the loop clip repeats before the stop clip
   * plays. `hold: true` means stay in the loop until something else is
   * asked for — right for a thinking pose that has to last a whole line of
   * narration, wrong for a cheer.
   * ------------------------------------------------------------------ */

  var STATES = {
    // resting
    idle:        { rig: 'blinking',    hold: true },

    // narration and attention
    explain:     { rig: 'talking',     hold: true },
    think:       { rig: 'thinking',    hold: true },
    inspect:     { rig: 'focussed',    hold: true },
    look:        { rig: 'curious',     loops: 2,  lean: true },
    // NOT 'calling'. That rig is a phone call — he lies down and a handset
    // rings beside him — which is a charming animation and has nothing to do
    // with showing a child where to tap. It was mapped here on the name alone.
    //
    // This rig has no pointing animation; there are twenty-six states and not
    // one of them points. 'confident' is the nearest thing to "go on, it is
    // there": an open, assured pose rather than a gesture at a target.
    //
    // Which is fine, because the character was never carrying this job on its
    // own. What actually says WHERE is on the stage: focus() pulses the
    // target and Stage.alive() haloes everything touchable. The character
    // says "your turn"; the stage says "here".
    point:       { rig: 'confident',   loops: 2,  lean: true },

    // reactions
    wave:        { rig: 'waving',      loops: 2 },
    // `confident` is the closer match for a nod, but its loop is a 4.4s
    // pingpong — far too long for a beat that just means "yes, go on".
    nod:         { rig: 'happy',       loops: 1 },
    // The director awaits this one, so it gates every correct answer. One
    // loop is 3.4s end to end; two made the reward outstay its welcome.
    celebrate:   { rig: 'celebrating', loops: 1 },
    encourage:   { rig: 'love',        loops: 1 },
    confused:    { rig: 'confused',    loops: 1 },
    surprised:   { rig: 'surprised',   loops: 1 },
    mischief:    { rig: 'playful',     loops: 2 },
    'step-back': { rig: 'relieved',    loops: 1, shift: -34 },

    // moments the game reaches outside screens.js
    proud:       { rig: 'proud',       loops: 2 },
    excited:     { rig: 'excited',     loops: 1 },
    stuck:       { rig: 'puzzleing',   loops: 2 },
    happy:       { rig: 'happy',       loops: 1 },
    daydream:    { rig: 'daydreaming', hold: true },
    // NOT 'sleeping'. Seventy-five seconds is a child reading a definition
    // and thinking about it, and a companion who lies down with a pillow and
    // Zs over its head at that point is telling them they have taken too
    // long. It also reads as a broken game — the screen looks finished.
    //
    // 'curious' instead: he looks about, as if wondering where they have got
    // to. Known-good, because it is the same rig the lesson already plays for
    // 'look' — which matters after 'calling', where a rig was chosen on the
    // strength of its name and turned out to be a phone ringing.
    sleep:       { rig: 'curious',     hold: true },

    // travel — a standalone loop under a WAAPI move
    enter:       { rig: 'driving',     hold: true },
    exit:        { rig: 'flapping',    hold: true },
    move:        { rig: 'flapping',    hold: true }
  };

  /**
   * Warmed before the start button is released: the resting loop, the
   * greeting and the narration loop — the only clips screen 1 can reach.
   * Everything else is fetched the first time it is asked for, which costs
   * one 400ms grace period per expression, once per session.
   */
  var PRELOAD = ['blinking', 'wave_start', 'waving', 'wave_stop', 'talk_start', 'talking', 'talk_stop', 'flapping'];

  /**
   * How many sheet pages may stay decoded at once.
   *
   * This is the one number in the file with real teeth. A @2x sheet is a
   * uniform grid of 512px cells — `blinking` alone is 3584x3072, which is
   * 44 MB once the browser has decoded it to a bitmap. Holding all 50-odd
   * clips the state table can reach is several gigabytes, and it takes the
   * renderer out on a tablet (and, measurably, on a desktop Chrome too).
   *
   * So the cache is an LRU: past the cap, the least recently painted sheet
   * has its Image released and is re-fetched from the HTTP cache if it is
   * needed again. The resting and narration loops are pinned, because those
   * are the two that would otherwise be evicted and reloaded constantly.
   */
  var SHEET_BUDGET = 10;
  var PINNED = { blinking: 1, talking: 1, talk_start: 1, talk_stop: 1, flapping: 1 };

  var IDLE_DAYDREAM_MS = 30000;
  var IDLE_SLEEP_MS = 75000;

  /* ------------------------------------------------------------------ *
   * Module state
   * ------------------------------------------------------------------ */

  var el = null, cellEl = null, shadowEl = null;
  var layout = null;                  // function(pos, size) -> { x, y, scale }
  var pos = 'left', size = 'medium';
  var scale = '1x';                   // which sheet resolution is being sampled
  var reduced = false;
  var ready = false;

  var live = [];                      // WAAPI animations on the wrapper
  var shiftAnim = null;               // the one animation allowed to persist
  var active = null;                  // the clip currently on screen
  var gen = 0;                        // bumped by every play(); stale sequences bail
  var stateName = 'idle';             // the storyboard state we are resting in
  var rigLoop = null;                 // the rig loop clip that still owes a `stop`
  var speaking = false;
  var idleTimer = null, idleLevel = 0;
  var rafId = null, lastT = 0, painted = null;   // url of the sheet currently bound
  var sheets = {};                    // url -> { img, promise, ok, used, pinned }
  var sheetClock = 0;                 // monotonic counter for LRU ordering
  // URLs that have completed a load at least once this session. Survives
  // eviction, because the bytes survive it too — they are in the browser's
  // HTTP cache. Without this, a clip that comes back after being evicted
  // would wait out the grace period again and issue a redundant request.
  var everLoaded = {};

  function nowMs() {
    return (global.performance && global.performance.now) ? global.performance.now() : Date.now();
  }

  /* ------------------------------------------------------------------ *
   * Sheet loading — one Image per page, decoded once, never per frame.
   * ------------------------------------------------------------------ */

  function url(rel) { return F.base + rel; }

  function sheet(rel, clipName) {
    var u = url(rel);
    if (sheets[u]) { sheets[u].used = ++sheetClock; return sheets[u]; }
    var rec = { ok: false, url: u, used: ++sheetClock, pinned: !!PINNED[clipName] };
    rec.promise = new Promise(function (resolve) {
      if (!global.Image) { resolve(false); return; }
      var img = new global.Image();
      img.onload = function () { rec.ok = true; everLoaded[u] = true; resolve(true); };
      img.onerror = function () {
        // Do not cache a failure. A sheet can fail for reasons that pass —
        // a device briefly out of resources, a flaky connection — and a
        // stuck `ok: false` record would leave the character on a broken
        // cell for the rest of the session, because every later request
        // would resolve instantly against the failed promise. Forgetting it
        // costs one retry and gets the expression back.
        delete sheets[u];
        resolve(false);
      };
      img.src = u;
      rec.img = img;
      if (img.complete && img.naturalWidth) { rec.ok = true; resolve(true); }
    });
    sheets[u] = rec;
    evict();
    return rec;
  }

  /** Drop the least recently painted unpinned sheets past the budget. */
  function evict() {
    var keys = Object.keys(sheets);
    if (keys.length <= SHEET_BUDGET) return;
    keys.filter(function (k) { return !sheets[k].pinned && sheets[k].url !== painted; })
        .sort(function (a, b) { return sheets[a].used - sheets[b].used; })
        .slice(0, keys.length - SHEET_BUDGET)
        .forEach(function (k) {
          var rec = sheets[k];
          // Detach and drop the reference only. Do NOT reassign `src`: an
          // empty string resolves against the document, so the browser
          // cancels the real request and fires a fresh one for the page
          // itself — dozens of those is how a run ends in
          // ERR_INSUFFICIENT_RESOURCES. Past this point the decoded bitmap
          // is the browser's own image cache to manage, which it does well;
          // all this map ever owned was the load-completion promise.
          if (rec.img) { rec.img.onload = rec.img.onerror = null; rec.img = null; }
          delete sheets[k];
        });
  }

  /** Every page of a clip at the current scale, with a 1x fallback. */
  function pagesOf(name) {
    var c = F.clips[name];
    if (!c) return null;
    return c.sheets[scale] || c.sheets['1x'];
  }

  function preload(names) {
    (names || []).forEach(function (n) {
      var ps = pagesOf(n);
      if (ps) ps.forEach(function (p) { sheet(p.image, n); });
    });
  }

  /**
   * Wait for a clip's first page, but never longer than `ms`. A sheet that
   * is slow (or, in a headless test, never loads at all) costs a moment of
   * the previous frame staying up — not a stalled lesson.
   */
  function awaitSheet(name, ms) {
    var ps = pagesOf(name);
    if (!ps || !ps.length) return Promise.resolve(false);
    var rec = sheet(ps[0].image, name);
    if (rec.ok || everLoaded[rec.url]) return Promise.resolve(true);
    return Promise.race([rec.promise, delay(ms == null ? 400 : ms)]);
  }

  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ------------------------------------------------------------------ *
   * Painting one frame
   * ------------------------------------------------------------------ */

  function paint(name, frame) {
    var ps = pagesOf(name);
    if (!ps || !cellEl) return;
    var page = ps[0], k;
    for (k = 0; k < ps.length; k++) {
      if (frame >= ps[k].first && frame < ps[k].first + ps[k].frames) { page = ps[k]; break; }
    }
    var local = frame - page.first;
    var col = local % page.cols, row = Math.floor(local / page.cols);

    // Only touch background-image when the page actually changes; the
    // position is the per-frame work and it is a single style write.
    var u = url(page.image);
    if (painted !== u) {
      cellEl.style.backgroundImage = 'url("' + u + '")';
      cellEl.style.backgroundSize = (page.cols * CELL_PX) + 'px ' + (page.rows * CELL_PX) + 'px';
      painted = u;
    }
    if (sheets[u]) sheets[u].used = ++sheetClock;   // keep what is on screen hot
    cellEl.style.backgroundPosition = (-col * CELL_PX) + 'px ' + (-row * CELL_PX) + 'px';
  }

  /* ------------------------------------------------------------------ *
   * The ticker. One rAF for the whole character, stepping at the rig's fps
   * from a wall clock rather than per-callback, so a 120 Hz display and a
   * struggling 30 Hz tablet play the animation at the same speed.
   * ------------------------------------------------------------------ */

  function tick() {
    rafId = global.requestAnimationFrame ? global.requestAnimationFrame(tick) : setTimeout(tick, 50);
    var t = nowMs();
    var dt = lastT ? Math.min(250, t - lastT) : 0;
    lastT = t;
    if (!active) return;
    active.acc += dt;
    var step = 1000 / F.fps;
    var guard = 0;
    while (active && active.acc >= step && guard++ < 8) {
      active.acc -= step;
      advance();
    }
  }

  function startTicker() {
    if (rafId != null) return;
    lastT = 0;
    rafId = global.requestAnimationFrame ? global.requestAnimationFrame(tick) : setTimeout(tick, 50);
  }

  /** Frame order for one pass: forward, or forward-then-back for pingpong. */
  function order(c) {
    var out = [], i;
    for (i = 0; i < c.frames; i++) out.push(i);
    if (c.pingpong) for (i = c.frames - 2; i > 0; i--) out.push(i);
    return out;
  }

  function advance() {
    var a = active;
    a.i++;
    if (a.i >= a.order.length) {
      a.passes++;
      if (a.repeats !== Infinity && a.passes >= a.repeats) { settle(); return; }
      a.i = 0;
    }
    paint(a.name, a.order[a.i]);
  }

  function settle() {
    var a = active; active = null;
    if (a && a.resolve) a.resolve({ done: true });
  }

  /**
   * Play one rig clip for `repeats` passes. Resolves when it finishes, or
   * as `{ interrupted: true }` if something else takes over first.
   */
  function clip(name, repeats) {
    var c = F.clips[name];
    if (!c) {
      if (global.console) console.warn('Swiftee: no clip "' + name + '"');
      return Promise.resolve({ missing: true });
    }
    if (active && active.resolve) active.resolve({ interrupted: true });
    active = null;

    return awaitSheet(name).then(function () {
      return new Promise(function (resolve) {
        var a = {
          name: name, order: order(c), i: 0, passes: 0,
          repeats: repeats == null ? 1 : repeats, acc: 0, resolve: resolve
        };
        active = a;
        paint(name, a.order[0]);
        // Reduced motion gets the pose, not the performance: the first frame
        // of every clip is a legible expression on its own. A finite clip
        // resolves at once so the sequence keeps moving; an endless loop
        // stays `active` (so a scale change can repaint it) but never ticks.
        if (reduced) { if (a.repeats !== Infinity) settle(); return; }
        startTicker();
      });
    });
  }

  function stopActive() {
    if (active && active.resolve) active.resolve({ interrupted: true });
    active = null;
  }

  /* ------------------------------------------------------------------ *
   * States: start -> loop -> stop, and the stop that is owed on the way out
   * ------------------------------------------------------------------ */

  function triad(rig) {
    var s = F.states[rig];
    if (s) return { start: s.start, loop: s.loop, stop: s.stop };
    return { start: null, loop: rig, stop: null };     // a standalone clip
  }

  function fresh() { return ++gen; }
  function stale(g) { return g !== gen; }

  /** Pay off the outgoing state's `stop` clip before anything new begins. */
  function closeCurrent(g) {
    var owed = rigLoop; rigLoop = null;
    if (!owed) return Promise.resolve();
    var t = triad(owed);
    if (!t.stop) return Promise.resolve();             // sleeping/driving leave by their own clip
    return clip(t.stop, 1).then(function () { return stale(g) ? 'stale' : null; });
  }

  /**
   * Run a storyboard state to completion. `hold` states park in their loop
   * and resolve immediately, so a thinking pose lasts the whole line without
   * the director waiting on it.
   */
  function runState(name, g) {
    var def = STATES[name] || STATES.idle;
    var t = triad(def.rig);
    var repeats = def.hold ? Infinity : (def.loops == null ? 1 : def.loops);

    return closeCurrent(g).then(function () {
      if (stale(g)) return { cancelled: true };
      return t.start ? clip(t.start, 1) : null;
    }).then(function () {
      if (stale(g)) return { cancelled: true };
      rigLoop = def.rig;
      var loop = clip(t.loop, repeats);
      if (def.hold) return { holding: true };          // do not await an endless loop
      return loop.then(function (r) {
        if (stale(g) || (r && r.interrupted)) return { cancelled: true };
        rigLoop = null;
        return t.stop ? clip(t.stop, 1) : null;
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * Resting behaviour — what he does when nobody asked for anything
   * ------------------------------------------------------------------ */

  function restingState() {
    if (speaking) return 'explain';                    // narrating -> talking loop
    if (idleLevel === 2) return 'sleep';
    if (idleLevel === 1) return 'daydream';
    return 'idle';
  }

  function rest() {
    // Whatever he stepped aside for is over.
    if (shiftAnim) { try { shiftAnim.cancel(); } catch (e) {} shiftAnim = null; }
    var want = restingState();
    // Already resting in the right loop: re-running the triad here would
    // play a stop and a start for no visible reason, which reads as a hitch
    // every time narration begins on a screen that is already talking.
    if (want === stateName && rigLoop === STATES[want].rig) return Promise.resolve({ resting: true });
    var g = fresh();
    stateName = want;
    return runState(stateName, g);
  }

  function armIdle() {
    clearTimeout(idleTimer);
    if (reduced) return;
    idleTimer = setTimeout(function () {
      idleLevel = 1;
      if (isResting()) rest();
      idleTimer = setTimeout(function () {
        idleLevel = 2;
        if (isResting()) rest();
      }, IDLE_SLEEP_MS - IDLE_DAYDREAM_MS);
    }, IDLE_DAYDREAM_MS);
  }

  function isResting() {
    return stateName === 'idle' || stateName === 'daydream' || stateName === 'sleep' || stateName === 'explain';
  }

  /**
   * Any real activity brings him back to attention.
   *
   * No `wake` clip any more. That existed to get him up off the floor, and
   * the deep idle no longer puts him on it — playing a getting-up animation
   * from a standing pose is a stumble, not a wake.
   */
  function stir() {
    idleLevel = 0;
    armIdle();
    return Promise.resolve();
  }

  /* ------------------------------------------------------------------ *
   * Placement and motion
   * ------------------------------------------------------------------ */

  function place(p, s) {
    if (!layout || !el) return;
    var L = layout(p, s);
    el.style.left = L.x + 'px';
    el.style.top = L.y + 'px';
    el.style.transform = 'translate(-50%,-' + (F.baselineY * 100).toFixed(1) + '%) scale(' + L.scale + ')';
    chooseScale(L.scale);
  }

  /**
   * Pick the sheet resolution from the pixels actually being drawn. Below
   * one device pixel per source pixel the @1x sheet is indistinguishable and
   * a third of the bytes; above it, @2x is the difference between crisp and
   * soft on a retina tablet.
   */
  function chooseScale(k) {
    var dpr = global.devicePixelRatio || 1;
    // Deliberately generous toward @1x. A @2x sheet costs roughly four times
    // the decoded memory, and the art is flat-shaded vector, so it upscales
    // cleanly well past 1:1. Only a mascot drawn appreciably larger than the
    // @1x cell earns the bigger sheets.
    var want = (CELL_PX * k * dpr) > (F.cell['1x'] * 1.6) ? '2x' : '1x';
    if (want === scale) return;
    scale = want;
    painted = null;                                    // force a background-image swap
    sheets = {};                                       // the other scale's pages are dead weight
    if (active) paint(active.name, active.order[active.i]);
  }

  /** Shrink and soften the contact shadow while he is off the ground. */
  function liftShadow(ms) {
    if (!shadowEl || !shadowEl.animate || reduced) return;
    try {
      shadowEl.animate([
        { transform: 'translate(-50%,-35%) scale(1)', opacity: 1 },
        { transform: 'translate(-50%,-35%) scale(.62)', opacity: .45, offset: .5 },
        { transform: 'translate(-50%,-35%) scale(1)', opacity: 1 }
      ], { duration: ms, easing: 'ease-in-out' });
    } catch (e) {}
  }

  function anim(keyframes, opts) {
    if (!el || !el.animate || reduced) return { finished: Promise.resolve(), cancel: function () {} };
    var a;
    try { a = el.animate(keyframes, Object.assign({ composite: 'add', fill: 'none' }, opts)); }
    catch (e) { return { finished: Promise.resolve(), cancel: function () {} }; }
    live.push(a);
    a.finished.then(drop, drop);
    function drop() { var i = live.indexOf(a); if (i >= 0) live.splice(i, 1); }
    return a;
  }

  function cancelAll() {
    live.slice().forEach(function (a) { try { a.cancel(); } catch (e) {} });
    live.length = 0;
    shiftAnim = null;
  }

  function centre(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

  /**
   * A sprite has no pupils to aim, so "looking at" something is a lean and a
   * small step toward it. It reads, and it cannot desync from the art.
   */
  function lean(target) {
    if (!el || !target || reduced) return;
    var p = target.getBoundingClientRect ? centre(target.getBoundingClientRect()) : target;
    if (!p || p.x == null) return;
    var me = centre(el.getBoundingClientRect());
    var dir = p.x >= me.x ? 1 : -1;
    var far = Math.min(1, Math.abs(p.x - me.x) / 500);
    anim([
      { transform: 'translateX(0) rotate(0deg)' },
      { transform: 'translateX(' + (dir * 10 * far).toFixed(1) + 'px) rotate(' + (dir * 4 * far).toFixed(1) + 'deg)', offset: 0.4 },
      { transform: 'translateX(' + (dir * 8 * far).toFixed(1) + 'px) rotate(' + (dir * 3 * far).toFixed(1) + 'deg)', offset: 0.8 },
      { transform: 'translateX(0) rotate(0deg)' }
    ], { duration: 1400, easing: 'ease-in-out' });
  }

  /* ------------------------------------------------------------------ *
   * The state handlers the director drives
   * ------------------------------------------------------------------ */

  /**
   * Hop down onto the spot and settle.
   *
   * The cart intro calls this at the hand-off: the painted Swiftee leaves with
   * the cart, this one takes over from the seat and jumps clear. `from` is how
   * far left of the landing spot the seat was, `lift` how high the arc goes —
   * both in page pixels, so the caller can match them to the cart's own size
   * rather than guessing at this module's scale.
   *
   * Used on its own it is just a hop in place, which is why `enter` falls back
   * to it when the intro art is missing.
   */
  function land(o) {
    o = o || {};
    if (!el) return Promise.resolve();
    var from = o.from || 0, lift = o.lift || 56;
    var g = fresh(); stateName = 'enter'; rigLoop = null;
    el.style.opacity = '1';

    // Arms out on the way down reads as a jump; blinking would read as a
    // teleport. `flapping` is the rig's only airborne loop.
    clip('flapping', Infinity);
    liftShadow(HOP_MS);
    if (global.SFX) SFX.play('boing');

    var a = anim([
      { transform: 'translate(' + from + 'px, 0) scale(1,1)' },
      { transform: 'translate(' + (from * 0.55) + 'px, ' + (-lift) + 'px) scale(.94,1.08)', offset: 0.45 },
      { transform: 'translate(0, 0) scale(1.14,.86)', offset: 0.84 },
      { transform: 'translate(0, 0) scale(1,1)' }
    ], { duration: HOP_MS, easing: 'cubic-bezier(.3,.85,.4,1)' });

    return a.finished.then(function () {
      if (global.Juice) Juice.squash(el, { amount: 0.2 });
      if (global.SFX) SFX.play('pop');
      if (stale(g)) return;
      return rest();
    });
  }

  var HOP_MS = 620;      // the hop in land()
  var FLIGHT_MS = 2200;  // off-stage to touchdown

  var MOVES = {

    /**
     * He flies in.
     *
     * One continuous move rather than a slide: in from off-stage and high up,
     * a dip and a rise across the middle so the path reads as flight and not
     * as a tween, then a flare and a drop onto the spot. The rig has exactly
     * one airborne loop — `flapping` — and it runs for the whole journey.
     *
     * Three details do most of the work. He banks into the direction of
     * travel and levels off before landing, because a bird that stays upright
     * looks like a sticker being dragged. He comes in slightly small and
     * grows to full size, which reads as distance closing. And the contact
     * shadow stays shrunk until the moment his feet arrive, which is what
     * makes the landing land.
     */
    /**
     * The arrival: he rides in on the sleigh, and the deer takes it away.
     *
     * Three clips the rig has always had and the game had never played.
     * Measured frame by frame before this was built, because `exitsCell`
     * says the art leaves frame during a clip but not which way or when, and
     * an arrival built on a clip that drives the character OUT would have
     * been fighting its own travel:
     *
     *   driving      51 frames, ZERO net drift — a run-in-place cycle. The
     *                legs and the sleigh work while the art stays centred,
     *                so the travel is the ELEMENT moving, not the clip.
     *   drive_away   20 frames, and it ends on opaque bounds of 0.164–0.853
     *                wide with the foot at 0.875 — which is the standing
     *                pose, to three decimal places. It puts him down on his
     *                mark by itself; nothing has to catch him.
     *
     * driving_start is skipped. It is twenty frames in which nothing moves —
     * the art is identical in all of them — so it would be a second of
     * stillness before the arrival began.
     *
     * The bells ride the approach: seven of them as he appears, rung again
     * softer as he pulls up. The hoofbeats are struck one at a time rather
     * than looped, so the gait can slow into the stop instead of cutting off
     * mid-stride.
     */
    /**
     * The arrival: he rides in on the reindeer sled.
     *
     * Three sprite sheets and about six seconds of it, all of which belongs
     * to SleighIntro — see src/fx/sleigh-intro.js for why three separately
     * drawn sheets need that much care to read as one animation.
     *
     * ONE BIRD. The departure sheet draws Swiftee itself, so this element
     * stays hidden for the whole intro and is revealed on the last frame,
     * standing where the drawn one was standing. The intro is scaled FROM
     * this element's own drawn height rather than to some chosen size, so the
     * bird the intro leaves behind and the bird the lesson takes over are the
     * same to the pixel.
     *
     * If anything at all goes wrong — a sheet missing, no canvas, the module
     * not loaded — it falls through to simply being here. An arrival is worth
     * six seconds; it is not worth a lesson that will not start.
     */
    enter: function (o) {
      var g = fresh(); stateName = 'enter'; rigLoop = null;
      var container = (el && el.parentNode) || null;

      if (!global.SleighIntro || !container || !global.SleighFrames) {
        el.style.opacity = '1';
        return rest();
      }

      el.style.opacity = '0';
      var box = api.bounds();
      var cr = container.getBoundingClientRect();
      var mark = box ? {
        markX: (box.left + box.right) / 2 - cr.left,
        markY: box.bottom - cr.top,
        birdHeight: box.height
      } : {};

      if (global.SFX) {
        SFX.play('sleighBells', { n: 7, spread: 0.055, gain: 0.05 });
        var t = 0, stepMs = 0.16;
        for (var i = 0; i < 12; i++) {
          SFX.play('hoofbeat', { delay: t, gain: 0.085 - i * 0.004 });
          t += stepMs; stepMs *= 1.05;
        }
        // the runners biting as it pulls up, then the jump
        setTimeout(function () { if (!stale(g) && global.SFX) SFX.play('slice', { gain: 0.05 }); }, 2900);
        setTimeout(function () { if (!stale(g) && global.SFX) SFX.play('zip', { gain: 0.06 }); }, 3300);
        setTimeout(function () { if (!stale(g) && global.SFX) SFX.play('pop'); }, 4900);
        setTimeout(function () {
          if (stale(g) || !global.SFX) return;
          SFX.play('sleighBells', { n: 4, spread: 0.09, gain: 0.03 });
          for (var k = 0; k < 5; k++) SFX.play('hoofbeat', { delay: k * 0.2, gain: 0.05 - k * 0.008 });
        }, 5200);
      }

      return SleighIntro.play(container, mark).then(function () {
        if (stale(g)) return;
        el.style.opacity = '1';
        if (global.Juice) Juice.squash(el, { amount: 0.1 });
        return rest();
      }, function () {
        if (stale(g)) return;
        el.style.opacity = '1';
        return rest();
      });
    },

    exit: function (o) {
      var to = (o && o.to === 'right') ? 1 : -1;
      var g = fresh(); stateName = 'exit'; rigLoop = null;
      clip('flapping', Infinity);
      var a = anim([
        { transform: 'translateX(0) translateY(0)', opacity: 1 },
        { transform: 'translateX(' + (to * 400) + 'px) translateY(-40px)', opacity: 0 }
      ], { duration: 620, easing: 'cubic-bezier(.36,0,.66,-.56)' });
      return a.finished.then(function () {
        el.style.opacity = '0';
        stopActive();
        void g;
      });
    },

    /**
     * Reposition. The element is moved first, then animated from where it
     * used to be — a FLIP, so the wrapper's final `left/top/scale` is always
     * the truth and the bubble can be placed against it the moment this
     * resolves.
     */
    move: function (o) {
      if (!layout) return Promise.resolve();
      var fromP = layout(pos, size);
      var toPos = o.to || pos, toSize = o.size || size;
      var toP = layout(toPos, toSize);
      pos = toPos; size = toSize;
      el.style.opacity = toPos === 'off' ? '0' : '1';

      var g = fresh(); stateName = 'move'; rigLoop = null;
      clip('flapping', Infinity);
      liftShadow(680);
      place(pos, size);

      var dx = toP.x - fromP.x, dy = toP.y - fromP.y, ds = fromP.scale / toP.scale;
      var a = anim([
        { transform: 'translate(' + (-dx) + 'px,' + (-dy) + 'px) scale(' + ds + ')' },
        { transform: 'translate(0,0) scale(1)' }
      ], { duration: 680, easing: 'cubic-bezier(.22,1,.36,1)' });
      return a.finished.then(function () {
        if (stale(g)) return;
        return rest();
      });
    }
  };

  /* ------------------------------------------------------------------ *
   * Public entry point
   * ------------------------------------------------------------------ */

  function play(state, opts, ctx) {
    if (!el) return Promise.resolve();
    opts = opts || {};
    if (ctx && ctx.onCancel) ctx.onCancel(function () { cancelAll(); });

    if (MOVES[state]) { stir(); return MOVES[state](opts); }

    var def = STATES[state];
    if (!def) {
      if (global.console) console.warn('Swiftee: no state "' + state + '"');
      return Promise.resolve();
    }

    if (def.lean && opts.at) lean(opts.at);
    if (def.shift) {
      // Held, not permanent. `fill: 'forwards'` with `composite: 'add'` means
      // this offset survives the state, the screen and the rest of the lesson:
      // one step-back on page 15 left him 34px to the left for the remaining
      // 24 screens, and on a phone that walked him off the edge. rest() drops
      // it when he settles, so he steps aside and then comes back.
      if (shiftAnim) { try { shiftAnim.cancel(); } catch (e) {} }
      shiftAnim = anim([{ transform: 'translateX(0)' }, { transform: 'translateX(' + def.shift + 'px)' }],
                       { duration: 520, easing: 'ease-out', fill: 'forwards' });
    }

    var g = fresh();
    stateName = state;
    var seq = stir().then(function () {
      if (stale(g)) return { cancelled: true };
      return runState(state, g);
    });

    // A one-shot reaction returns to whatever he should be resting in —
    // `talking` if a line is still playing, otherwise blinking or, after a
    // long silence, daydreaming.
    if (!def.hold) {
      seq = seq.then(function (r) {
        if (stale(g) || (r && r.cancelled)) return r;
        return rest().then(function () { return r; });
      });
    }
    return seq;
  }

  /* ------------------------------------------------------------------ *
   * Mount
   * ------------------------------------------------------------------ */

  function mount(container, opts) {
    opts = opts || {};
    if (!F) { if (global.console) console.error('Swiftee: swiftee-frames.js must load first'); return api; }

    reduced = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);

    el = document.createElement('div');
    el.className = 'swiftee';
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText =
      'position:absolute;left:0;top:0;width:' + CELL_PX + 'px;height:' + CELL_PX + 'px;' +
      'pointer-events:none;will-change:transform;transform-origin:50% ' + (F.baselineY * 100).toFixed(1) + '%;';

    // A contact shadow at the baseline, not the cell edge, so he reads as
    // standing on the ice rather than floating above it. It squashes and
    // fades with him, which is most of what sells a hop as a hop.
    shadowEl = document.createElement('div');
    shadowEl.style.cssText =
      'position:absolute;left:50%;top:' + (F.baselineY * 100).toFixed(1) + '%;' +
      'width:50%;height:8%;transform:translate(-50%,-35%);border-radius:50%;' +
      'background:radial-gradient(closest-side, rgba(24,52,96,.42), rgba(24,52,96,.14) 62%, rgba(24,52,96,0));';

    cellEl = document.createElement('div');
    // He is a mid-tone bird on a near-white snowfield, which is exactly the
    // case where a character disappears into its own background. A tight
    // white rim plus a soft drop shadow cuts him out of it without touching
    // the art: the rim separates the silhouette, the shadow gives it weight.
    // drop-shadow follows the sprite's alpha, so it traces the bird rather
    // than boxing the cell.
    cellEl.style.cssText =
      'position:absolute;inset:0;background-repeat:no-repeat;image-rendering:auto;' +
      'filter:' +
        'drop-shadow(0 0 2px rgba(255,255,255,.95)) ' +
        'drop-shadow(0 0 5px rgba(255,255,255,.7)) ' +
        'drop-shadow(0 8px 12px rgba(24,52,96,.28));';

    el.appendChild(shadowEl);
    el.appendChild(cellEl);
    container.appendChild(el);

    if (opts.layout) layout = opts.layout;
    preload(PRELOAD);
    ready = true;

    // Park on the idle loop immediately so there is never an empty cell.
    rest();
    armIdle();

    return api;
  }

  /* ------------------------------------------------------------------ *
   * API
   * ------------------------------------------------------------------ */

  var api = {
    mount: mount,
    play: play,
    lookAt: lean,

    /**
     * Narration started or ended. While true, every settle returns to the
     * `talking` loop instead of `blinking`, so his mouth moves for exactly
     * as long as the line does — and reactions still cut in over the top.
     */
    speaking: function (v) {
      var was = speaking;
      speaking = !!v;
      if (was !== speaking) { stir(); if (isResting()) rest(); }
      return speaking;
    },

    place: function (p, s) {
      pos = p || pos; size = s || size;
      if (!el) return;
      el.style.opacity = pos === 'off' ? '0' : '1';
      place(pos, size);
    },

    /**
     * Where the drawn bird actually is, in page pixels.
     *
     * getBoundingClientRect() on the element returns the whole 512-cell, which
     * is mostly transparent by design — the pivot is the cell centre and the
     * art floats inside it. Anything reasoning about what he covers (does the
     * bubble clear him? is he over the lesson? is he cropped?) has to use the
     * drawn extent or it will be wrong by roughly a fifth of the cell on every
     * side. These fractions are the manifest's own opaque bounds for the
     * standing pose, so they track the art.
     */
    bounds: function () {
      if (!el) return null;
      var r = el.getBoundingClientRect();
      var L = 84 / 512, R = 437 / 512, T = 58 / 512, B = F.baselineY;
      return {
        left: r.left + r.width * L, right: r.left + r.width * R,
        top: r.top + r.height * T, bottom: r.top + r.height * B,
        width: r.width * (R - L), height: r.height * (B - T)
      };
    },

    /** Show or hide without moving him. Safe before mount(). */
    visible: function (v) { if (el) el.style.opacity = v ? '1' : '0'; return !!v; },
    relayout: function () { place(pos, size); },
    setLayout: function (fn) { layout = fn; place(pos, size); },

    /** Stop every WAAPI move. The sprite keeps animating; only travel stops. */
    cancel: cancelAll,

    /** Hop down onto the spot. See land() above; the cart intro drives it. */
    land: land,

    /** Hard reset to the rig's 3-frame neutral pose. */
    reset: function () { fresh(); rigLoop = null; stateName = 'idle'; return clip('reset', 1).then(rest); },

    get el() { return el; },
    get pos() { return pos; },
    get size() { return size; },
    get state() { return stateName; },
    get scale() { return scale; },
    get ready() { return ready; },
    states: Object.keys(STATES),
    rig: STATES
  };

  global.Swiftee = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : this);
