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
    enter:    1400,   // off-stage left to cruising speed
    cruise:   1000,   // the happy ride
    brake:     560,   // easing to a stop, never a dead stop
    dismount:  760,   // he stands up in the sled (dismount frames 0-2)
    land:      980,   // the leap, the arc, the touch down, the settle
    exit:     1750,   // the reindeer walks away and OFF the right edge
    beat:      320    // a breath before the lesson starts
  };

  /**
   * When each beat starts, in ms from the first frame.
   *
   * The sound for this animation is scheduled by the caller, on its own
   * timers, because it has to start before the first sheet has decoded. That
   * means two copies of the same schedule, and the moment one of these
   * durations changes the runners bite while the sled is still cruising. So
   * the durations are published rather than repeated: see swiftee.js enter().
   */
  function timeline() {
    var b = { enter: 0 };
    b.cruise   = b.enter    + T.enter;
    b.brake    = b.cruise   + T.cruise;
    b.dismount = b.brake    + T.brake;
    b.land     = b.dismount + T.dismount;
    b.exit     = b.land     + T.land;
    b.end      = b.exit     + T.exit + T.beat;
    return b;
  }

  var RIDE_FPS = 10;        // the walk cycle. Independent of travel speed.
  var GROUND_FRAC = 0.86;   // fallback only; the caller's mark wins

  var host = null, canvas = null, ctx = null;
  var images = {}, raf = 0, cancelled = false, running = null;

  /* The resolver of the run currently in flight.
   *
   * A CANCELLED INTRO STILL HAS TO END. cancel() drops the animation frame,
   * and the animation frame was the only thing that ever resolved this
   * promise — so cancelling used to leave it pending for the rest of the
   * session. The caller (swiftee.js enter()) reveals Swiftee in its .then,
   * which meant that interrupting the arrival left the mascot hidden for
   * every screen that followed: no error, no warning, just no bird. */
  var settle = null;

  function settleNow() {
    var r = settle; settle = null;
    if (r) r();
  }

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

  /**
   * Draw ONE island of a frame, at a chosen height, anchored on its own feet.
   *
   * `k` is a SCALE, not a target height. Re-fitting each frame to a fixed
   * height is what made the reindeer breathe: the art in a receding frame is
   * drawn smaller inside its own box, so forcing that box to one height
   * quietly magnifies it. One scale for every frame of a cycle, always.
   */
  function drawIsland(sheet, island, wx, wy, k) {
    var img = images[sheet] && images[sheet].__img;
    if (!img || !island) return 0;
    var w = island.w * k, h = island.h * k;
    ctx.drawImage(img, island.x, island.y, island.w, island.h,
                  wx - w / 2, wy - h, w, h);
    return w;
  }

  /* ------------------------------------------------------------------ *
   * Snow
   *
   * Runners throw it up, a braking sled pushes a bank of it, and a bird
   * landing knocks a little loose. Small and short-lived — the point is that
   * the sled is touching the ground, not that there is weather.
   * ------------------------------------------------------------------ */

  var puffs = [];

  function puff(x, y, n, spread, power) {
    for (var i = 0; i < n; i++) {
      puffs.push({
        x: x + (Math.random() - 0.5) * spread,
        y: y - Math.random() * 6,
        vx: (Math.random() - 0.35) * power * 1.7,
        vy: -Math.random() * power * 1.15 - 0.4,
        r: 5 + Math.random() * 12,
        life: 1
      });
    }
    if (puffs.length > 150) puffs.splice(0, puffs.length - 150);
  }

  function drawPuffs(dt) {
    for (var i = puffs.length - 1; i >= 0; i--) {
      var p = puffs[i];
      p.life -= dt / 620;
      if (p.life <= 0) { puffs.splice(i, 1); continue; }
      p.x += p.vx * dt * 0.06;
      p.y += p.vy * dt * 0.06;
      p.vy += dt * 0.0016;                 // settles back down
      // A cold shadow under a white crown. Flat white on a white snowfield
      // is invisible, which is why the first version of this read as no
      // effect at all rather than as a subtle one.
      var rr = p.r * (0.45 + p.life * 0.55);
      ctx.globalAlpha = Math.max(0, p.life) * 0.34;
      ctx.fillStyle = '#a9cfe8';
      ctx.beginPath(); ctx.arc(p.x, p.y + rr * 0.22, rr * 1.25, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = Math.max(0, p.life) * 0.95;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
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

    /* THE RIG, FROM THE LEAP ONWARDS.
     *
     * Three sheets draw the reindeer and its sled, and in two of them the
     * bird is drawn into the same shape: the ride frames are one island with
     * Swiftee sitting in the sled, and dismount frames 0-2 are the same. Only
     * the departure sheet keeps them apart — every frame there is a bird
     * standing on the left and a reindeer pulling an EMPTY sled on the right.
     *
     * So that right-hand island is the rig for everything after the leap. Two
     * bugs came from not having noticed this:
     *
     *   TWO BIRDS. The landing used to draw the WHOLE of dismount frame 4 to
     *   keep the sled on screen, and that frame contains the bird mid-hop. It
     *   was drawn beside the bird that was actually flying — the same
     *   character, twice, one of them frozen.
     *
     *   THE SLED LOST ITS SEAT, AND THE DEER SHRANK. Dismount frames 3-4 are
     *   drawn from a different distance: the reindeer is two-thirds the size
     *   it is in frames 0-2 and the sled is foreshortened to a runner and a
     *   shaft. Played inline they read as the rig suddenly shrinking and
     *   being cut in half. Those two frames are no longer drawn at all; the
     *   bird's own leap is carried by dismount 5-9, which is bird-only art.
     *
     * WHICH FRAMES WALK. Departure frames 0-3 are one constant-size walk
     * cycle. Frames 4-6 recede into the distance, and the last has no
     * reindeer at all. Only frames that match the first one's box to within a
     * few percent are kept, so the cycle cannot shrink — and the reindeer
     * leaves by walking off the right-hand edge at full size, which is what
     * leaving looks like.
     */
    var depK = worldScale * f.norm.departure;
    var depRig = [];
    dep.forEach(function (fr) {
      var isl = fr.islands || [];
      if (isl.length < 2) return;
      var rigI = isl[isl.length - 1];
      if (!depRig.length) { depRig.push(rigI); return; }
      var ref = depRig[0];
      if (Math.abs(rigI.h - ref.h) > ref.h * 0.05) return;
      if (Math.abs(rigI.w - ref.w) > ref.w * 0.08) return;
      depRig.push(rigI);
    });
    var rigW = (depRig[0] ? depRig[0].w : 256) * depK;
    var rigH = (depRig[0] ? depRig[0].h : 195) * depK;

    /* WHERE IT STOPS.
     *
     * Far enough right that the whole rig — sled included — is clear of the
     * mark Swiftee has to stand on. It used to stop a fraction of his own
     * width past the mark, which was fine while the sled on screen was the
     * dismount sheet's foreshortened one and wrong the moment the real,
     * full-length sled was parked there: the seat came down exactly where he
     * lands, and he touched down inside it.
     *
     * Clamped so a narrow window parks the rig on screen rather than off it.
     */
    var stopX = markX + (opts.birdHeight || 200) * 0.46 + rigW / 2;
    stopX = Math.min(stopX, S.w - rigW / 2 - 12);
    var startX = -S.w * 0.42 - rigW / 2;

    // The bird's position at the instant the dismount art lets go of it, so
    // the arc starts exactly where the last drawn bird was rather than
    // somewhere near it.
    var run = { landed: false };
    puffs.length = 0;

    var total = T.enter + T.cruise + T.brake + T.dismount + T.land + T.exit + T.beat;
    var t0 = 0;

    if (reduced()) {
      // The story still happens, in a quarter of the time and without the
      // travel: someone who asked for less motion should still see him arrive
      // by sled, get out, and the reindeer leave.
      total = 1500;
    }

    return new Promise(function (resolve) {
      settle = resolve;
      function frameAt(list, ms, fps) {
        var i = Math.floor(ms / (1000 / fps)) % list.length;
        return list[i];
      }

      var prev = 0;
      function step(now) {
        if (cancelled) { settle = null; resolve(); return; }
        if (!t0) t0 = now;
        var t = now - t0;
        var dt = prev ? Math.min(48, now - prev) : 16;
        prev = now;
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
          var ex = startX + (stopX - startX) * p * 0.72;
          drawFrame('ride', fr, { x: rig.x + rig.w / 2, y: rig.y + rig.h }, ex, groundY, worldScale);
          if (ex > -40) puff(ex - (opts.birdHeight || 200) * 0.5, groundY, 1, 18, 1.0);
          drawPuffs(dt);
          raf = requestAnimationFrame(step); return;
        }

        /* ---- CRUISE: steady, the walk cycle doing the work ---- */
        if (t < (mark += T.cruise)) {
          var p2 = clamp01((t - T.enter) / T.cruise);
          var fr2 = frameAt(ride, t, RIDE_FPS);
          var rig2 = rigIsland(fr2);
          var x2 = startX + (stopX - startX) * (0.72 + 0.20 * p2);
          // a breath of vertical life, a couple of pixels, tied to the stride —
          // enough that the rig is not a picture being slid across the screen
          var bob2 = Math.sin(t / 1000 * Math.PI * 2 * (RIDE_FPS / 4)) * (opts.birdHeight || 200) * 0.008;
          drawFrame('ride', fr2, { x: rig2.x + rig2.w / 2, y: rig2.y + rig2.h },
                    x2, groundY + bob2, worldScale);
          puff(x2 - (opts.birdHeight || 200) * 0.5, groundY, 1, 20, 1.1);
          drawPuffs(dt);
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
          // a bank of snow pushed up in front of the runners as it pulls up
          if (p3 < 0.8) puff(x3 - (opts.birdHeight || 200) * 0.42, groundY, 2, 26, 2.1 * (1 - p3));
          drawPuffs(dt);
          raf = requestAnimationFrame(step); return;
        }

        /* ---- DISMOUNT: he gets to his feet in the sled ---- */
        if (t < (mark += T.dismount)) {
          var p4 = clamp01((t - T.enter - T.cruise - T.brake) / T.dismount);
          // 0-2 ONLY. 3 and 4 are drawn from a different distance — see the
          // note on depRig — and 5 onwards is the bird by itself.
          var early = dis.slice(0, 3);
          var fr4 = early[Math.min(early.length - 1, Math.floor(p4 * early.length))];
          var rig4 = rigIsland(fr4);
          drawFrame('dismount', fr4, { x: rig4.x + rig4.w / 2, y: rig4.y + rig4.h },
                    stopX, groundY, worldScale);
          drawPuffs(dt);
          raf = requestAnimationFrame(step); return;
        }

        /* ---- LAND: he leaps out, arcs across, and touches down ---- */
        if (t < (mark += T.land)) {
          var p5 = clamp01((t - T.enter - T.cruise - T.brake - T.dismount) / T.land);
          var late = dis.slice(5);                 // bird only: flap, flap, land, stand
          var fr5 = late[Math.min(late.length - 1, Math.floor(p5 * late.length))];
          var bi = rigIsland(fr5);

          // The rig, parked and empty, from here to the end of the intro.
          drawIsland('departure', depRig[0], stopX, groundY, depK);

          // He leaves from the seat of that sled — measured off the rig's own
          // box rather than off a frame, so it stays right at any size.
          var from = { x: stopX - rigW * 0.24, y: groundY - rigH * 0.40 };
          var bx = from.x + (markX - from.x) * p5;
          var lift = Math.sin(Math.PI * p5) * (opts.birdHeight || 200) * 0.34;
          var by = from.y + (groundY - from.y) * easeIn(p5) - lift;

          // and settles, very slightly, as it touches
          var squash = p5 > 0.88 ? 1 - Math.sin((p5 - 0.88) / 0.12 * Math.PI) * 0.045 : 1;
          ctx.save();
          ctx.translate(bx, by);
          ctx.scale(1, squash);
          ctx.translate(-bx, -by);
          drawIsland('dismount', bi, bx, by, worldScale * f.norm.dismount);
          ctx.restore();

          // snow knocked loose the moment his feet arrive, and a ring with it
          if (p5 > 0.9 && !run.landed) {
            run.landed = true;
            puff(markX, groundY, 16, 44, 2.6);
            if (global.SFX) SFX.play('pop');
          }
          drawPuffs(dt);
          raf = requestAnimationFrame(step); return;
        }

        /* ---- DEER_EXIT: he stands, the reindeer walks away and OFF ---- */
        if (t < (mark += T.exit)) {
          var p6 = clamp01((t - T.enter - T.cruise - T.brake - T.dismount - T.land) / T.exit);

          // An animal leaning into a walk gathers pace and then holds it. A
          // cubic ease-in does neither: it stands still for two thirds of the
          // beat and then leaves in three frames, which is why it read as
          // vanishing rather than walking. This is always moving.
          var travel = p6 * (0.55 + 0.45 * p6) * ((S2.w - stopX) + rigW);
          var wf = depRig[Math.floor(t / 120) % depRig.length];
          var w = drawIsland('departure', wf, stopX + travel, groundY, depK);

          // Snow off the runners for as long as they are on the screen.
          if (stopX + travel - w * 0.5 < S2.w) {
            puff(stopX + travel - w * 0.42, groundY, 2, w * 0.26, 1.3);
          }

          // The bird: the standing pose, fixed on his mark and drawn last so
          // the rig passes BEHIND nothing. Nothing about him moves, which is
          // what makes this read as the reindeer leaving rather than the
          // world sliding.
          var birdIs = leftIsland(dep[dep.length - 1]);
          drawIsland('departure', birdIs, markX, groundY, depK);

          drawPuffs(dt);
          raf = requestAnimationFrame(step); return;
        }

        /* ---- the last beat, holding the final pose ---- */
        if (t < total) {
          drawIsland('departure', leftIsland(dep[dep.length - 1]), markX, groundY, depK);
          drawPuffs(dt);
          raf = requestAnimationFrame(step); return;
        }

        finish(resolve);
      }

      raf = requestAnimationFrame(step);
    });
  }

  function finish(resolve) {
    if (canvas) { clear(host.clientWidth, host.clientHeight); canvas.style.display = 'none'; }
    settle = null;
    resolve();
  }

  function cancel() {
    cancelled = true;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (canvas) {
      // Cleared as well as hidden. A hidden canvas still holding its last
      // frame flashes that frame back the moment anything shows it again —
      // a resize, a replay — and what it is holding is a reindeer standing
      // in the middle of a geometry lesson.
      if (ctx && host) clear(host.clientWidth, host.clientHeight);
      canvas.style.display = 'none';
    }
    puffs.length = 0;
    settleNow();
  }

  global.SleighIntro = {
    timeline: timeline,
    play: play,
    cancel: cancel,
    preload: preload,
    get durationMs() {
      return T.enter + T.cruise + T.brake + T.dismount + T.land + T.exit + T.beat;
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.SleighIntro;

})(typeof window !== 'undefined' ? window : this);
