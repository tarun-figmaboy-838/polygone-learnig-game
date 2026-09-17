/*!
 * transition.js — the screen freezes over, cracks, and shatters.
 *
 * ONE EVENT, IN ONE MATERIAL. Between two screens the window becomes a sheet
 * of frosted glass: the scene behind it blurs and pales as rime creeps in
 * from the edges, until the whole pane is ice. It holds. Then it is struck —
 * a point, a flash, and cracks run out from it, gathering speed, throwing
 * branches, and joining up into a lattice the way real glass fails: not all
 * at once, and never in straight lines. It holds again, split but whole. Then
 * it lets go: the cells between the cracks separate, tip, and fall out of the
 * frame, inner pieces first, and the next screen is what was behind the glass
 * all along.
 *
 * The previous version was two effects wearing one name — crystals that flew
 * in laying frost patches, and then a web of thick blue lines — which is
 * what "the two transitions merge" and "the crack does not look real" were
 * both describing. Everything here is glass: the sheet, the cracks in it, the
 * pieces of it.
 *
 *   Transition.cover()    freeze the screen (resolves when it is hidden)
 *   Transition.reveal()   crack, shatter, and clear (resolves when gone)
 *   Transition.wipe(fn)   cover -> fn() -> reveal
 *
 * game.js does the screen change between cover() and reveal(); nothing here
 * knows or cares what changed.
 */
(function (global) {
  'use strict';

  /* ---- timeline ------------------------------------------------------ *
   *
   *   FREEZE   the glass forms: blur rises, rime closes in from the edges
   *   HOLD     solid, still. Without this beat the crack arrives before the
   *            child has registered that the screen froze.
   *   CRACK    the fracture runs out from the impact, in generations
   *   SETTLE   split but whole — the pause before ice lets go
   *   FALL     the pieces separate and drop out of the frame
   */
  var FREEZE_MS = 760;
  var HOLD_MS = 280;
  var CRACK_MS = 980;
  var SETTLE_MS = 170;
  var FALL_MS = 920;
  var COVER_MS = FREEZE_MS;
  var REVEAL_MS = HOLD_MS + CRACK_MS + SETTLE_MS + FALL_MS;

  /* The fracture: rays from the impact and rings across them. The cells
     between are the shards. Nine by four is enough to read as broken glass
     and few enough to animate on a school tablet. */
  var RAYS = 9;
  var RINGS = [0, 0.20, 0.44, 0.76, 1.36];

  /* The glass, as one string, so the sheet and every shard cut from it are
     painted from the same source and the break is invisible until it moves.
     Translucent on purpose: a shard falling across the new screen should let
     the screen show through it, paler and colder, the way ice does. */
  var GLASS_PAINT =
    'linear-gradient(162deg,' +
      'rgba(240,249,255,.93) 0%,rgba(222,240,253,.90) 38%,' +
      'rgba(198,228,250,.90) 70%,rgba(176,216,246,.92) 100%)';

  var host = null, glass = null, rime = null, lattice = null, field = null;

  /* One source of truth for whether this machine wants motion. juice.js owns
     it — it watches the media query and exposes a test seam (Juice.disable)
     that has to turn off the transition too. */
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

    // THE PANE. The scene behind it blurs and pales through it; this is what
    // makes it glass rather than a curtain. It is inset past the edges so
    // the sheet has no visible border of its own.
    glass = doc.createElement('div');
    glass.style.cssText =
      'position:absolute;inset:-4%;opacity:0;background:' + GLASS_PAINT + ';' +
      '-webkit-backdrop-filter:blur(0px);backdrop-filter:blur(0px);';

    // RIME. Frost is thickest where the glass is coldest — the edges — and
    // thins toward the middle, and it grows inward. Scaled down from a size
    // larger than the pane, its inner edge travels toward the centre.
    rime = doc.createElement('div');
    rime.style.cssText =
      'position:absolute;inset:-8%;opacity:0;pointer-events:none;' +
      'background:radial-gradient(120% 95% at 50% 48%,' +
        'rgba(255,255,255,0) 0%,rgba(255,255,255,0) 40%,' +
        'rgba(246,252,255,.55) 66%,rgba(255,255,255,.92) 100%);';

    // THE LATTICE. Fine bright slivers at two angles, very faint, screened
    // over the pane: the crystalline grain frost has when you look closely.
    lattice = doc.createElement('div');
    lattice.style.cssText =
      'position:absolute;inset:-4%;opacity:0;mix-blend-mode:screen;pointer-events:none;' +
      'background:' +
        'repeating-linear-gradient(56deg,rgba(255,255,255,.22) 0 1.5px,rgba(255,255,255,0) 1.5px 23px),' +
        'repeating-linear-gradient(-61deg,rgba(226,244,255,.20) 0 1.5px,rgba(255,255,255,0) 1.5px 29px);';

    // Everything transient — sparkles, cracks, shards — goes here and is
    // cleared as a whole.
    field = doc.createElement('div');
    field.style.cssText = 'position:absolute;inset:0;';

    host.appendChild(glass);
    host.appendChild(rime);
    host.appendChild(lattice);
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

  function run(el, frames, opts) {
    if (!el || !el.animate) return Promise.resolve();
    try { return el.animate(frames, opts).finished.catch(function () {}); }
    catch (e) { return Promise.resolve(); }
  }

  function later(ms, fn) { return setTimeout(fn, ms); }

  /* ---- the freeze ---------------------------------------------------- */

  /** A pinprick of light on the ice. */
  function sparkle(doc, w, h, delay) {
    var el = doc.createElement('div');
    var x = w * (0.08 + Math.random() * 0.84), y = h * (0.08 + Math.random() * 0.84);
    var s = 6 + Math.random() * 8;
    el.style.cssText =
      'position:absolute;left:' + x.toFixed(0) + 'px;top:' + y.toFixed(0) + 'px;' +
      'width:' + s + 'px;height:' + s + 'px;margin:' + (-s / 2) + 'px;opacity:0;' +
      'background:radial-gradient(circle,#fff 0%,rgba(255,255,255,.9) 30%,rgba(255,255,255,0) 70%);' +
      'box-shadow:0 0 ' + (s * 1.4) + 'px rgba(255,255,255,.9);border-radius:50%;';
    field.appendChild(el);
    run(el, [
      { opacity: 0, transform: 'scale(.3)' },
      { opacity: 1, transform: 'scale(1.2)', offset: 0.5 },
      { opacity: 0, transform: 'scale(.4)' }
    ], { duration: 520 + Math.random() * 300, delay: delay, easing: 'ease-in-out', fill: 'forwards' });
  }

  /**
   * Freeze the screen. Resolves when the pane is solid — nothing behind it
   * can be made out — which is when the caller may change the scene.
   */
  function cover() {
    if (reduced() || !host) return Promise.resolve();
    var doc = host.ownerDocument;
    var w = host.clientWidth || 1280, h = host.clientHeight || 720;
    clear();
    host.style.visibility = 'visible';
    host.style.opacity = '1';
    weather(true);

    // The pane: blur rises as the frost thickens, so the scene goes soft
    // before it goes white — glass fogging, not a fade.
    run(glass, [
      { opacity: 0, backdropFilter: 'blur(0px) saturate(1)', webkitBackdropFilter: 'blur(0px) saturate(1)' },
      { opacity: 0.55, backdropFilter: 'blur(3px) saturate(1.05)', webkitBackdropFilter: 'blur(3px) saturate(1.05)', offset: 0.45 },
      { opacity: 1, backdropFilter: 'blur(7px) saturate(1.1)', webkitBackdropFilter: 'blur(7px) saturate(1.1)' }
    ], { duration: FREEZE_MS, easing: 'cubic-bezier(.3,.6,.35,1)', fill: 'forwards' });

    // Rime closes in from the edges: it starts larger than the pane, so its
    // clear centre is the whole screen, and shrinks until only a thin clear
    // middle is left, then fills.
    run(rime, [
      { opacity: 0, transform: 'scale(1.5)' },
      { opacity: 0.85, transform: 'scale(1.12)', offset: 0.55 },
      { opacity: 0.95, transform: 'scale(1)' }
    ], { duration: FREEZE_MS, easing: 'cubic-bezier(.25,.5,.3,1)', fill: 'forwards' });

    run(lattice, [{ opacity: 0 }, { opacity: 0.6 }],
        { duration: FREEZE_MS, delay: FREEZE_MS * 0.35, easing: 'ease-out', fill: 'forwards' });

    for (var i = 0; i < 9; i++) sparkle(doc, w, h, FREEZE_MS * 0.4 + Math.random() * FREEZE_MS * 0.6);

    return new Promise(function (done) { later(FREEZE_MS, done); });
  }

  /* ---- the fracture -------------------------------------------------- */

  /**
   * Where the glass gives way, and into what.
   *
   * A radial fracture: rays out from one point, rings across them, and the
   * cells between are the shards. The rays are jittered so no two wedges are
   * the same width, the rings are jittered so no two cells are the same
   * depth, and the outermost ring lies well past the corners so the edge
   * pieces are big and irregular like the edge of a real break.
   */
  function fracture(w, h) {
    var ix = w * (0.40 + Math.random() * 0.20);
    var iy = h * (0.34 + Math.random() * 0.20);
    var R = Math.max(Math.hypot(ix, iy), Math.hypot(w - ix, iy), Math.hypot(ix, h - iy), Math.hypot(w - ix, h - iy));
    var ang = [];
    for (var i = 0; i < RAYS; i++) {
      ang.push((i / RAYS) * Math.PI * 2 + (Math.random() - 0.5) * (Math.PI / RAYS) * 0.9);
    }
    // each ray has its own ring radii, so rings are not circles
    var rad = [];
    for (var k = 0; k < RAYS; k++) {
      rad.push(RINGS.map(function (f, j) { return j === 0 ? 0 : R * f * (0.84 + Math.random() * 0.32); }));
    }
    var at = function (i, j) {
      var k = ((i % RAYS) + RAYS) % RAYS;
      return [ix + Math.cos(ang[k]) * rad[k][j], iy + Math.sin(ang[k]) * rad[k][j]];
    };
    var shards = [];
    for (var j = 0; j < RINGS.length - 1; j++) {
      for (var q = 0; q < RAYS; q++) {
        var p = [at(q, j), at(q + 1, j), at(q + 1, j + 1), at(q, j + 1)];
        var mx = 0, my = 0;
        p.forEach(function (v) { mx += v[0]; my += v[1]; });
        mx /= 4; my /= 4;
        shards.push({ pts: p, ring: j, bearing: Math.atan2(my - iy, mx - ix) });
      }
    }
    return { ix: ix, iy: iy, R: R, ang: ang, rad: rad, at: at, shards: shards };
  }

  /* A crack wanders: every run is walked in short steps with a sideways kick
     at each, and the kicks are bigger further from the impact. */
  function jag(ax, ay, bx, by, amp) {
    var dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    var nx = -dy / len, ny = dx / len;
    var steps = Math.max(3, Math.round(len / 40));
    var out = [[ax, ay]];
    for (var t = 1; t < steps; t++) {
      var u = t / steps;
      var k = (Math.random() - 0.5) * amp * (0.4 + u);
      out.push([ax + dx * u + nx * k, ay + dy * u + ny * k]);
    }
    out.push([bx, by]);
    return out;
  }
  function poly(pts) {
    return 'M' + pts.map(function (p, i) { return (i ? 'L' : '') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('');
  }
  function pathLen(pts) {
    var L = 0;
    for (var i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return L;
  }

  /**
   * The cracks, as runs that each know when to start and how long to take.
   *
   * Generations: the first three rays leave the impact at once, the next
   * three a beat later, the rest after that. A branch leaves its parent at
   * the moment the parent's tip passes the branch point. Ring cracks — the
   * ones that join rays — are the last to form, and not every gap gets one,
   * which is what keeps this from being a dartboard.
   */
  function plan(f) {
    var runs = [];
    var order = [];
    for (var i = 0; i < RAYS; i++) order.push(i);
    order.sort(function () { return Math.random() - 0.5; });
    order.forEach(function (i, n) {
      var gen = n < 3 ? 0 : (n < 6 ? 1 : 2);
      var end = f.at(i, RINGS.length - 1);
      var pts = jag(f.ix, f.iy, end[0], end[1], 30);
      var L = pathLen(pts);
      var delay = gen * 130 + Math.random() * 60;
      var dur = 380 + L * 0.28;
      runs.push({ pts: pts, delay: delay, dur: dur, w: 1 });
      // one or two branches, off the middle third, that run a short way and stop
      var nb = Math.random() < 0.7 ? (Math.random() < 0.4 ? 2 : 1) : 0;
      for (var b = 0; b < nb; b++) {
        var t = 0.3 + Math.random() * 0.4;
        var at = pts[Math.max(1, Math.floor(pts.length * t))];
        var a = Math.atan2(end[1] - f.iy, end[0] - f.ix) + (Math.random() < 0.5 ? 1 : -1) * (0.45 + Math.random() * 0.5);
        var reach = f.R * (0.10 + Math.random() * 0.14);
        var bp = jag(at[0], at[1], at[0] + Math.cos(a) * reach, at[1] + Math.sin(a) * reach, 14);
        runs.push({ pts: bp, delay: delay + dur * t, dur: 220 + Math.random() * 120, w: 0.7 });
      }
    });
    // ring cracks: most gaps on the inner rings, fewer further out
    for (var j = 1; j < RINGS.length - 1; j++) {
      for (var k = 0; k < RAYS; k++) {
        if (Math.random() > (j === 1 ? 0.85 : j === 2 ? 0.7 : 0.5)) continue;
        var p = f.at(k, j), q = f.at(k + 1, j);
        runs.push({ pts: jag(p[0], p[1], q[0], q[1], 12), delay: 460 + j * 110 + Math.random() * 180, dur: 240 + Math.random() * 120, w: 0.8 });
      }
    }
    return runs;
  }

  /** Draw the planned runs into one SVG, each ready to be revealed along its own length. */
  function crackLayer(doc, runs, w, h) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = doc.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;';
    var strokes = [];
    runs.forEach(function (r) {
      var d = poly(r.pts), L = pathLen(r.pts);
      // two strokes per run: a cold shadow under a bright core, which is what
      // a split in glass looks like — the light catches the new edge
      [['rgba(52,96,140,.38)', 3.2 * r.w, 'none'], ['rgba(255,255,255,.96)', 1.5 * r.w, 'drop-shadow(0 0 2px rgba(255,255,255,.9))']].forEach(function (s) {
        var el = doc.createElementNS(ns, 'path');
        el.setAttribute('d', d);
        el.setAttribute('fill', 'none');
        el.setAttribute('stroke', s[0]);
        el.setAttribute('stroke-width', s[1]);
        el.setAttribute('stroke-linecap', 'round');
        el.setAttribute('stroke-linejoin', 'round');
        el.style.strokeDasharray = L + ' ' + (L + 10);
        el.style.strokeDashoffset = L;
        if (s[2] !== 'none') el.style.filter = s[2];
        svg.appendChild(el);
        strokes.push({ el: el, L: L, delay: r.delay, dur: r.dur });
      });
    });
    return { svg: svg, strokes: strokes };
  }

  /** The flash at the point of impact. */
  function impactFlash(doc, x, y) {
    var el = doc.createElement('div');
    el.style.cssText =
      'position:absolute;left:' + x.toFixed(0) + 'px;top:' + y.toFixed(0) + 'px;width:26px;height:26px;margin:-13px;' +
      'border-radius:50%;opacity:0;pointer-events:none;' +
      'background:radial-gradient(circle,#fff 0%,rgba(255,255,255,.95) 35%,rgba(210,236,255,.4) 60%,rgba(255,255,255,0) 72%);' +
      'box-shadow:0 0 30px 10px rgba(255,255,255,.85),0 0 90px 30px rgba(190,226,255,.5);';
    field.appendChild(el);
    run(el, [
      { opacity: 0, transform: 'scale(.2)' },
      { opacity: 1, transform: 'scale(1.6)', offset: 0.25 },
      { opacity: 0, transform: 'scale(2.6)' }
    ], { duration: 520, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' });
  }

  /** Tiny slivers thrown from the impact when the sheet lets go. */
  function splinters(doc, x, y, n) {
    for (var i = 0; i < n; i++) {
      var el = doc.createElement('div');
      var a = Math.random() * Math.PI * 2, d = 120 + Math.random() * 260;
      var len = 6 + Math.random() * 14;
      el.style.cssText =
        'position:absolute;left:' + x.toFixed(0) + 'px;top:' + y.toFixed(0) + 'px;width:' + len + 'px;height:3px;' +
        'margin:-1.5px 0 0 ' + (-len / 2) + 'px;border-radius:2px;opacity:0;pointer-events:none;' +
        'background:linear-gradient(90deg,rgba(255,255,255,.2),#fff,rgba(255,255,255,.2));';
      field.appendChild(el);
      run(el, [
        { opacity: 1, transform: 'rotate(' + (a * 57.3).toFixed(0) + 'deg) translate(0,0)' },
        { opacity: 0, transform: 'rotate(' + (a * 57.3 + 140).toFixed(0) + 'deg) translate(' + d.toFixed(0) + 'px,' + (d * 0.55).toFixed(0) + 'px)' }
      ], { duration: 620 + Math.random() * 300, delay: Math.random() * 90, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'forwards' });
    }
  }

  /**
   * Crack the glass and let it fall. Resolves when the last piece is gone
   * and the layer is hidden and empty.
   */
  function reveal() {
    if (reduced() || !host) { weather(false); return Promise.resolve(); }
    var doc = host.ownerDocument;
    var w = host.clientWidth || 1280, h = host.clientHeight || 720;
    var f = fracture(w, h);
    var runs = plan(f);
    var cracks = crackLayer(doc, runs, w, h);
    var ox = w * 0.04, oy = h * 0.04;   // the glass box is inset 4% beyond the host

    // the shards, cut from the same glass, hidden until the fall
    var shardEls = f.shards.map(function (sh) {
      var el = doc.createElement('div');
      var clip = sh.pts.map(function (p) { return (p[0] + ox).toFixed(1) + 'px ' + (p[1] + oy).toFixed(1) + 'px'; }).join(',');
      var lit = 0.94 + Math.random() * 0.16;
      el.style.cssText =
        'position:absolute;inset:-4%;background:' + GLASS_PAINT + ';' +
        'clip-path:polygon(' + clip + ');-webkit-clip-path:polygon(' + clip + ');' +
        'filter:brightness(' + lit.toFixed(2) + ');' +
        'box-shadow:inset 0 0 0 1px rgba(255,255,255,.7);' +
        'opacity:0;will-change:transform,opacity;pointer-events:none;';
      field.appendChild(el);
      return { el: el, sh: sh };
    });

    return new Promise(function (done) {
      later(HOLD_MS, function () {
        /* ---- the strike, and the cracks that run from it ---- */
        if (global.SFX) SFX.play('crack');
        impactFlash(doc, f.ix, f.iy);
        cracks.svg.style.opacity = '1';
        field.appendChild(cracks.svg);
        cracks.strokes.forEach(function (s) {
          run(s.el, [{ strokeDashoffset: s.L }, { strokeDashoffset: 0 }],
              { duration: s.dur, delay: s.delay, easing: 'cubic-bezier(.25,.8,.35,1)', fill: 'forwards' });
        });

        later(CRACK_MS + SETTLE_MS, function () {
          /* ---- it lets go ---- */
          if (global.SFX) SFX.play('shatter');
          splinters(doc, f.ix, f.iy, 22);
          // the sheet itself is replaced by its pieces
          glass.style.opacity = '0';
          run(rime, [{ opacity: 0.95 }, { opacity: 0 }], { duration: 140, fill: 'forwards' });
          run(lattice, [{ opacity: 0.6 }, { opacity: 0 }], { duration: 140, fill: 'forwards' });
          run(cracks.svg, [{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' });

          shardEls.forEach(function (x) {
            var out = f.R * (0.10 + x.sh.ring * 0.08) * (0.7 + Math.random() * 0.6);
            var dx = Math.cos(x.sh.bearing) * out;
            var drop = h * (0.9 + Math.random() * 0.5);
            var spin = (Math.random() - 0.5) * 70;
            var tilt = (Math.random() - 0.5) * 40;
            x.el.style.opacity = '1';
            // gravity: little movement at first, most of it at the end
            run(x.el, [
              { transform: 'translate(0,0) rotate(0deg) rotateX(0deg)', opacity: 1, offset: 0 },
              { transform: 'translate(' + (dx * 0.3).toFixed(0) + 'px,' + (drop * 0.12).toFixed(0) + 'px) rotate(' + (spin * 0.3).toFixed(0) + 'deg) rotateX(' + (tilt * 0.4).toFixed(0) + 'deg)', opacity: 1, offset: 0.35 },
              { transform: 'translate(' + dx.toFixed(0) + 'px,' + drop.toFixed(0) + 'px) rotate(' + spin.toFixed(0) + 'deg) rotateX(' + tilt.toFixed(0) + 'deg)', opacity: 0.85, offset: 1 }
            ], {
              duration: FALL_MS,
              delay: x.sh.ring * 85 + Math.random() * 70,
              easing: 'cubic-bezier(.45,0,.85,.5)',
              fill: 'forwards'
            });
          });

          later(FALL_MS + 330, function () {
            clear();
            glass.style.opacity = '0';
            rime.style.opacity = '0';
            lattice.style.opacity = '0';
            host.style.opacity = '0';
            host.style.visibility = 'hidden';
            // The gust outlives the glass by a moment: the snow is still heavy
            // as the new screen appears and settles back over the next beat.
            later(360, function () { weather(false); });
            done();
          });
        });
      });
    });
  }

  /** cover -> do the work -> reveal. The work is never seen, however slow. */
  function wipe(fn) {
    return cover()
      .then(function () { return fn ? fn() : null; })
      .then(function (r) { return reveal().then(function () { return r; }); },
            function (e) { return reveal().then(function () { throw e; }); });
  }

  /** Is the screen currently hidden behind the glass? */
  function covered() { return !!host && host.style.visibility === 'visible'; }

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
