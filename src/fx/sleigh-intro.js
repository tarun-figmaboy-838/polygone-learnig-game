/*!
 * sleigh-intro.js — Swiftee arrives by reindeer sled.
 *
 * Three sprite sheets, one continuous animation. The child should not be able
 * to tell where one sheet ends and the next begins, and almost everything in
 * here exists to make that true, because the three sheets agree about very
 * little:
 *
 *   NOT THE SAME GRID. The ride sheet is a tidy 4x2. The dismount sheet is
 *   not a grid at all — nine shapes in one row and five in the next, at nine
 *   different widths. Every frame is drawn from a measured source rectangle
 *   (see tools/build-sleigh-frames.js), never from a cell index.
 *
 *   NOT THE SAME SCALE. The same reindeer measures 314px on the ride sheet,
 *   263 on the dismount and 195 on the departure. Left alone, the character
 *   would shrink by a fifth halfway through its own arrival and again on
 *   landing. Each sheet carries a normalisation factor and is drawn through it.
 *
 *   NOT THE SAME SUBJECT. The ride frames are one shape. Halfway through the
 *   dismount the bird becomes its own island, and every departure frame is a
 *   bird standing still beside a reindeer walking away. Which island a frame
 *   is anchored by is what decides whether the bird holds still while the deer
 *   leaves, or the deer holds still while the bird slides off the screen.
 *
 * ONE BIRD, ALWAYS. The departure sheet draws Swiftee itself, so the game's
 * own Swiftee stays hidden until the very last frame — at which point it is
 * placed exactly where the drawn one was standing and at exactly the height
 * it was drawn. The handoff is the reason the scale is derived from the
 * final frame rather than chosen.
 *
 * Time, not frames. Every state is a duration and the loop asks the clock
 * where it is, so a slow frame costs smoothness and never timing.
 *
 *   SleighIntro.play(container, { markX, markY, birdHeight })  -> Promise
 *   SleighIntro.cancel()
 */
(function (global) {
  'use strict';

  /* Every duration in one place. They add to about six and a half seconds,
     which is the spec's five-to-seven: long enough to read as a journey,
     short enough that a child is not waiting for the lesson. */
  var T = {
    enter:    1500,   // off-stage left to cruising speed
    cruise:   1200,   // the happy ride
    brake:     560,   // easing to a stop, never a dead stop
    dismount:  980,   // seated -> prepare -> push -> out of the sled
    land:      920,   // the arc, the touch down, the settle
    exit:     1250,   // the reindeer walks away and off
    beat:      180    // a breath before the lesson starts
  };

  var RIDE_FPS = 10;        // the walk cycle. Independent of travel speed.
  var GROUND_FRAC = 0.86;   // fallback only; the caller's mark wins

  var host = null, canvas = null, ctx = null;
  var images = {}, raf = 0, cancelled = false, running = null;

  function reduced() { return !!(global.Juice && Juice.reducedMotion); }
  function F() { return global.SleighFrames; }

  /* ------------------------------------------------------------------ *
   * Loading
   * ------------------------------------------------------------------ */

  function load(key) {
    if (images[key]) return images[key];
    var f = F(); if (!f) return Promise.reject(new Error('no frame table'));
    images[key] = new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('sleigh sheet: ' + key)); };
      img.src = f.sheets[key].file;
    });
    return images[key];
  }

  /** Everything, before anything is drawn: a half-loaded intro is a flash. */
  function preload() {
    return Promise.all(['ride', 'dismount', 'departure'].map(load));
  }

  /* ------------------------------------------------------------------ *
   * Geometry
   * ------------------------------------------------------------------ */

  /** The biggest island in a frame — the reindeer and its sled. */
  function rigIsland(fr) {
    var best = null;
    (fr.islands || []).forEach(function (i) {
      if (!best || i.w * i.h > best.w * best.h) best = i;
    });
    return best || { x: fr.sx, y: fr.sy, w: fr.sw, h: fr.sh };
  }

  /** The leftmost island — on the departure sheet, that is always the bird. */
  function leftIsland(fr) {
    var best = null;
    (fr.islands || []).forEach(function (i) { if (!best || i.x < best.x) best = i; });
    return best || { x: fr.sx, y: fr.sy, w: fr.sw, h: fr.sh };
  }

  /**
   * Draw one frame so that a chosen point of it lands on a chosen point of
   * the screen.
   *
   * `anchor` is in the sheet's own pixels; `wx`/`wy` are on the canvas. Every
   * alignment in this file is expressed this way — it is the only thing that
   * keeps a reindeer's hooves on the same line across three sheets drawn at
   * three different sizes.
   */
  function drawFrame(sheet, fr, anchor, wx, wy, worldScale) {
    var img = images[sheet] && images[sheet].__img;
    if (!img || !fr) return;
    var k = worldScale * F().norm[sheet];
    var dx = wx - (anchor.x - fr.sx) * k;
    var dy = wy - (anchor.y - fr.sy) * k;
    ctx.drawImage(img, fr.sx, fr.sy, fr.sw, fr.sh, dx, dy, fr.sw * k, fr.sh * k);
  }

  /* ------------------------------------------------------------------ *
   * The performance
   * ------------------------------------------------------------------ */

  function mount(container) {
    if (canvas && canvas.parentNode === container) return;
    var doc = container.ownerDocument;
    canvas = doc.createElement('canvas');
    canvas.className = 'sleigh-intro';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;z-index:5;pointer-events:none;';
    container.appendChild(canvas);
    ctx = canvas.getContext('2d');
    host = container;
  }

  function size() {
    var dpr = Math.min(2, global.devicePixelRatio || 1);
    var w = host.clientWidth, h = host.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: w, h: h };
  }

  function clear(w, h) { ctx.clearRect(0, 0, w, h); }

  var easeOut = function (t) { return 1 - Math.pow(1 - t, 3); };
  var easeIn = function (t) { return t * t * t; };
  var clamp01 = function (t) { return t < 0 ? 0 : t > 1 ? 1 : t; };

  /**
   * Play it.
   *
   * `markX` / `markY` are where Swiftee will be standing when the lesson
   * begins — his own mark, in canvas pixels — and `birdHeight` is how tall he
   * is drawn there. The whole intro is scaled from that last number, so the
   * bird the intro leaves behind and the bird the game takes over are the
   * same size to the pixel.
   */
  function play(container, opts) {
    opts = opts || {};
    cancel();
    cancelled = false;
    if (!F()) return Promise.resolve();

    mount(container);

    running = preload().then(function (imgs) {
      ['ride', 'dismount', 'departure'].forEach(function (k, i) { images[k].__img = imgs[i]; });
      if (cancelled) return;
      return run(opts);
    }).catch(function () { /* a missing sheet must not stop the lesson */ });

    return running;
  }

  function run(opts) {
    var f = F();
    var S = size();
    var groundY = opts.markY != null ? opts.markY : S.h * GROUND_FRAC;
    var markX = opts.markX != null ? opts.markX : S.w * 0.22;

    // THE SCALE COMES FROM THE HANDOFF. The last departure frame is the bird
    // alone; whatever height the game draws Swiftee at, that frame must match
    // it, or he changes size the moment the intro ends.
    var lastDep = f.sheets.departure.frames[f.sheets.departure.frames.length - 1];
    var lastBird = leftIsland(lastDep);
    var worldScale = (opts.birdHeight || 200) / (lastBird.h * f.norm.departure);

    var ride = f.sheets.ride.frames.filter(Boolean);
    var dis = f.sheets.dismount.frames.filter(Boolean);
    var dep = f.sheets.departure.frames.filter(Boolean);

    // Where the rig has to stop so the sled sits just behind his mark.
    var stopX = markX + (opts.birdHeight || 200) * 0.30;
    var startX = -S.w * 0.42;

    // The bird's position at the instant the dismount art lets go of it, so
    // the arc starts exactly where the last drawn bird was rather than
    // somewhere near it.
    var handoff = null;

    var total = T.enter + T.cruise + T.brake + T.dismount + T.land + T.exit + T.beat;
    var t0 = 0;

    if (reduced()) {
      // The story still happens, in a quarter of the time and without the
      // travel: someone who asked for less motion should still see him arrive
      // by sled, get out, and the reindeer leave.
      total = 1500;
    }

    return new Promise(function (resolve) {
      function frameAt(list, ms, fps) {
        var i = Math.floor(ms / (1000 / fps)) % list.length;
        return list[i];
      }

      function step(now) {
        if (cancelled) { resolve(); return; }
        if (!t0) t0 = now;
        var t = now - t0;
        var S2 = { w: host.clientWidth, h: host.clientHeight };
        clear(S2.w, S2.h);

        if (reduced()) {
          // a still of each beat, held
          var pick = t < 500 ? { sheet: 'ride', fr: ride[0] }
                   : t < 1000 ? { sheet: 'dismount', fr: dis[dis.length - 3] }
                   : { sheet: 'departure', fr: dep[dep.length - 1] };
          var an = pick.sheet === 'departure' ? leftIsland(pick.fr) : rigIsland(pick.fr);
          drawFrame(pick.sheet, pick.fr,
            { x: an.x + an.w / 2, y: an.y + an.h },
            pick.sheet === 'departure' ? markX : stopX, groundY, worldScale);
          if (t >= total) { finish(resolve); return; }
          raf = requestAnimationFrame(step);
          return;
        }

        var mark = 0;

        /* ---- ENTER: from off-stage, easing into cruising speed ---- */
        if (t < (mark += T.enter)) {
          var p = easeOut(clamp01(t / T.enter));
          var fr = frameAt(ride, t, RIDE_FPS);
          var rig = rigIsland(fr);
          drawFrame('ride', fr, { x: rig.x + rig.w / 2, y: rig.y + rig.h },
                    startX + (stopX - startX) * p * 0.72, groundY, worldScale);
          raf = requestAnimationFrame(step); return;
        }

        /* ---- CRUISE: steady, the walk cycle doing the work ---- */
        if (t < (mark += T.cruise)) {
          var p2 = clamp01((t - T.enter) / T.cruise);
          var fr2 = frameAt(ride, t, RIDE_FPS);
          var rig2 = rigIsland(fr2);
          var x2 = startX + (stopX - startX) * (0.72 + 0.20 * p2);
          drawFrame('ride', fr2, { x: rig2.x + rig2.w / 2, y: rig2.y + rig2.h },
                    x2, groundY, worldScale);
          raf = requestAnimationFrame(step); return;
        }

        /* ---- BRAKE: a sled has weight; it does not stop dead ---- */
        if (t < (mark += T.brake)) {
          var p3 = easeOut(clamp01((t - T.enter - T.cruise) / T.brake));
          var fr3 = frameAt(ride, t, RIDE_FPS * (1 - p3 * 0.65));
          var rig3 = rigIsland(fr3);
          var x3 = startX + (stopX - startX) * (0.92 + 0.08 * p3);
          drawFrame('ride', fr3, { x: rig3.x + rig3.w / 2, y: rig3.y + rig3.h },
                    x3, groundY, worldScale);
          raf = requestAnimationFrame(step); return;
        }

        /* ---- DISMOUNT: the art carries him out of the sled ---- */
        if (t < (mark += T.dismount)) {
          var p4 = clamp01((t - T.enter - T.cruise - T.brake) / T.dismount);
          var early = dis.slice(0, 5);
          var i4 = Math.min(early.length - 1, Math.floor(p4 * early.length));
          var fr4 = early[i4];
          var rig4 = rigIsland(fr4);
          drawFrame('dismount', fr4, { x: rig4.x + rig4.w / 2, y: rig4.y + rig4.h },
                    stopX, groundY, worldScale);

          // remember where the drawn bird is on the LAST of these frames
          if (i4 === early.length - 1) {
            var last = early[early.length - 1];
            var birds = (last.islands || []).filter(function (i) { return i !== rigIsland(last) && i.w > 40; });
            var bird = birds.length ? birds[birds.length - 1] : null;
            if (bird) {
              var k4 = worldScale * F().norm.dismount;
              handoff = {
                x: stopX + (bird.x + bird.w / 2 - (rig4.x + rig4.w / 2)) * k4,
                y: groundY + (bird.y + bird.h - (rig4.y + rig4.h)) * k4
              };
            }
          }
          raf = requestAnimationFrame(step); return;
        }

        /* ---- LAND: the arc, then the touch down ---- */
        if (t < (mark += T.land)) {
          var p5 = clamp01((t - T.enter - T.cruise - T.brake - T.dismount) / T.land);
          var late = dis.slice(5);
          var i5 = Math.min(late.length - 1, Math.floor(p5 * late.length));
          var fr5 = late[i5];
          var bi = rigIsland(fr5);

          // the sled stays where it stopped, behind him
          var still = dis[4], rigS = rigIsland(still);
          drawFrame('dismount', still, { x: rigS.x + rigS.w / 2, y: rigS.y + rigS.h },
                    stopX, groundY, worldScale);

          // and the bird travels from where the art let go to his mark, over
          // a small arc — cute rather than acrobatic, and never off the top
          var from = handoff || { x: stopX, y: groundY - (opts.birdHeight || 200) };
          var bx = from.x + (markX - from.x) * p5;
          var lift = Math.sin(Math.PI * p5) * (opts.birdHeight || 200) * 0.30;
          var by = from.y + (groundY - from.y) * easeIn(p5) - lift;

          // and settles, very slightly, as it touches
          var squash = p5 > 0.88 ? 1 - Math.sin((p5 - 0.88) / 0.12 * Math.PI) * 0.035 : 1;
          ctx.save();
          ctx.translate(bx, by);
          ctx.scale(1, squash);
          ctx.translate(-bx, -by);
          drawFrame('dismount', fr5, { x: bi.x + bi.w / 2, y: bi.y + bi.h }, bx, by, worldScale);
          ctx.restore();

          raf = requestAnimationFrame(step); return;
        }

        /* ---- DEER_EXIT: he stands, the reindeer walks off ---- */
        if (t < (mark += T.exit)) {
          var p6 = clamp01((t - T.enter - T.cruise - T.brake - T.dismount - T.land) / T.exit);
          var i6 = Math.min(dep.length - 1, Math.floor(p6 * dep.length));
          var fr6 = dep[i6];
          // ANCHORED ON THE BIRD, which is why he holds still and the sled
          // leaves rather than the other way about.
          var b6 = leftIsland(fr6);
          // No drift on X. He is standing still; the twelve pixels of
          // 'settling' that used to be here put the drawn bird twelve pixels
          // from where the game's own Swiftee appears, which is a visible
          // hop at the exact moment the handoff is supposed to be invisible.
          drawFrame('departure', fr6, { x: b6.x + b6.w / 2, y: b6.y + b6.h },
                    markX, groundY, worldScale);
          raf = requestAnimationFrame(step); return;
        }

        /* ---- the last beat, holding the final pose ---- */
        if (t < total) {
          var frL = dep[dep.length - 1], bL = leftIsland(frL);
          drawFrame('departure', frL, { x: bL.x + bL.w / 2, y: bL.y + bL.h },
                    markX, groundY, worldScale);
          raf = requestAnimationFrame(step); return;
        }

        finish(resolve);
      }

      raf = requestAnimationFrame(step);
    });
  }

  function finish(resolve) {
    if (canvas) { clear(host.clientWidth, host.clientHeight); canvas.style.display = 'none'; }
    resolve();
  }

  function cancel() {
    cancelled = true;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (canvas) canvas.style.display = 'none';
  }

  global.SleighIntro = {
    play: play,
    cancel: cancel,
    preload: preload,
    get durationMs() {
      return T.enter + T.cruise + T.brake + T.dismount + T.land + T.exit + T.beat;
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.SleighIntro;

})(typeof window !== 'undefined' ? window : this);
