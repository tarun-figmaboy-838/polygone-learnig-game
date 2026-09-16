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
  /* THE REVEAL IS A BREAK, NOT A FADE.
   *
   *   HOLD     the sheet is solid and still. Without this beat the crack
   *            arrives before the child has registered that the screen froze,
   *            and the whole thing reads as a flicker.
   *   CRACK    the fracture runs out from a point, drawn not faded.
   *   SETTLE   a moment with the cracks drawn and nothing moving — the pause
   *            before ice lets go, which is what makes the fall land.
   *   FALL     the shards separate and go.
   */
  var HOLD_MS = 300;
  var CRACK_MS = 260;
  var SETTLE_MS = 190;
  var FALL_MS = 680;
  var REVEAL_MS = HOLD_MS + CRACK_MS + SETTLE_MS + FALL_MS;

  /* The fracture: rays from the impact, and the rings that cross them. The
     shards are the cells between. Ten by three is enough to read as broken
     glass and few enough to animate on a school tablet. */
  var RAYS = 10;
  var RINGS = [0, 0.24, 0.52, 1.32];

  /* The ice, as one string, so the sheet and every shard cut from it are
     painted from the same source and the break is invisible until it moves. */
  var ICE_PAINT =
    'radial-gradient(130% 95% at 50% 36%,' +
      '#ffffff 0%,#f2fbff 30%,#d8eefd 58%,#b2daf5 82%,#96cbed 100%)';

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
      'background:' + ICE_PAINT + ';' +
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

    /* THE SCREEN FREEZES OVER. IT IS NOT SNOWED ON.
     *
     * These used to fly in from the edges, each carrying a frost patch, and
     * then the sheet cracked — two different events with two different
     * vocabularies, one after the other, which is what "the two transitions
     * merge" was describing. There is one event now: frost takes hold in a
     * dozen places and spreads until the screen is a single sheet, and then
     * that sheet breaks. Nothing travels; it grows where it starts, which is
     * what ice actually does. */
    s.flakes.forEach(function (f, i) {
      run(f.el, [
        { transform: 'scale(.08) rotate(' + (f.spin * 0.3).toFixed(0) + 'deg)', opacity: 0 },
        { transform: 'scale(.62) rotate(' + (f.spin * 0.12).toFixed(0) + 'deg)', opacity: .9, offset: 0.45 },
        { transform: 'scale(1) rotate(0deg)', opacity: 1 }
      ], {
        duration: FLIGHT_MS,
        delay: LEAD_MS + i * STAGGER_MS,
        easing: 'cubic-bezier(.16,.84,.3,1)',
        fill: 'both'
      });
    });

    s.sparks.forEach(function (el) {
      var drift = (Math.random() - 0.5) * 200;
      run(el, [
        { transform: 'translate(0,0) scale(.2) rotate(0deg)', opacity: 0 },
        { transform: 'translate(' + (drift * 0.2).toFixed(0) + 'px,' + (-s.h * 0.05).toFixed(0) + 'px) scale(1) rotate(' + drift.toFixed(0) + 'deg)', opacity: 1, offset: 0.6 },
        { transform: 'translate(' + (drift * 0.3).toFixed(0) + 'px,' + (-s.h * 0.08).toFixed(0) + 'px) scale(1.15) rotate(' + (drift * 1.6).toFixed(0) + 'deg)', opacity: 1 }
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
  /**
   * Where the ice gives way, and into what.
   *
   * A radial fracture: rays out from one point, rings across them, and the
   * cells between are the shards. Two things make it read as ice rather than
   * as a grid coming apart — the rays are jittered so no two wedges are the
   * same width, and the outermost ring is drawn well past the corners so the
   * edge pieces are big and irregular like the edge of a real break.
   *
   * Everything is returned in host pixels; the caller offsets into the ice's
   * own box, which is inset beyond the host so the sheet has no visible edge.
   */
  function fracture(w, h) {
    var ix = w * (0.42 + Math.random() * 0.16);
    var iy = h * (0.34 + Math.random() * 0.18);
    var R = Math.max(
      Math.hypot(ix, iy), Math.hypot(w - ix, iy),
      Math.hypot(ix, h - iy), Math.hypot(w - ix, h - iy));

    var ang = [];
    for (var i = 0; i < RAYS; i++) {
      ang.push((i / RAYS) * Math.PI * 2 + (Math.random() - 0.5) * (Math.PI / RAYS) * 0.85);
    }
    var rad = RINGS.map(function (k, j) {
      return j === 0 ? 0 : R * k * (0.86 + Math.random() * 0.28);
    });

    var at = function (i, j) {
      var a = ang[i % RAYS];
      return [ix + Math.cos(a) * rad[j], iy + Math.sin(a) * rad[j]];
    };

    var shards = [];
    for (var j = 0; j < rad.length - 1; j++) {
      for (var k = 0; k < RAYS; k++) {
        var p = [at(k, j), at(k + 1, j), at(k + 1, j + 1), at(k, j + 1)];
        var mx = 0, my = 0;
        p.forEach(function (q) { mx += q[0]; my += q[1]; });
        mx /= 4; my /= 4;
        shards.push({ pts: p, ring: j, bearing: Math.atan2(my - iy, mx - ix) });
      }
    }
    return { ix: ix, iy: iy, R: R, ang: ang, rad: rad, at: at, shards: shards };
  }

  /** The crack lines themselves, drawn on rather than faded in. */
  function crackLines(doc, f, w, h) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = doc.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';

    /* A CRACK WANDERS. A straight line from a point is a spoke, and twelve
       spokes with three clean rings across them is a dartboard — which is
       what "the crack does not look real" was seeing. Ice splits along
       whatever is weakest, so every run here is walked in short steps with a
       sideways kick at each one, and a few of them throw a short branch off
       at an angle and stop. The rings wander the same way. */
    var jag = function (ax, ay, bx, by, amp) {
      var dx = bx - ax, dy = by - ay;
      var len = Math.hypot(dx, dy) || 1;
      var nx = -dy / len, ny = dx / len;
      var steps = Math.max(3, Math.round(len / 46));
      var out = [[ax, ay]];
      for (var t = 1; t < steps; t++) {
        var u = t / steps;
        var k = (Math.random() - 0.5) * amp * Math.sin(Math.PI * u);
        out.push([ax + dx * u + nx * k, ay + dy * u + ny * k]);
      }
      out.push([bx, by]);
      return out;
    };
    var poly = function (pts, close) {
      return 'M' + pts.map(function (p, i) {
        return (i ? 'L' : '') + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
      }).join('') + (close ? 'Z' : '');
    };

    var d = [];
    for (var i = 0; i < RAYS; i++) {
      var a = f.at(i, f.rad.length - 1);
      var run1 = jag(f.ix, f.iy, a[0], a[1], 26);
      d.push(poly(run1, false));
      // a splinter off the main run, the way a crack forks and dies
      if (Math.random() < 0.55) {
        var at = run1[Math.max(1, Math.floor(run1.length * (0.35 + Math.random() * 0.35)))];
        var ang = Math.atan2(a[1] - f.iy, a[0] - f.ix) + (Math.random() < 0.5 ? 1 : -1) * (0.5 + Math.random() * 0.5);
        var reach = f.R * (0.12 + Math.random() * 0.16);
        d.push(poly(jag(at[0], at[1], at[0] + Math.cos(ang) * reach, at[1] + Math.sin(ang) * reach, 14), false));
      }
    }
    for (var j = 1; j < f.rad.length - 1; j++) {
      var ring = [];
      for (var k = 0; k < RAYS; k++) {
        var p = f.at(k, j), q = f.at(k + 1, j);
        ring = ring.concat(jag(p[0], p[1], q[0], q[1], 13).slice(0, -1));
      }
      d.push(poly(ring, true));
    }
    var path = d.join('');

    /* two strokes: a dark seam with a bright edge riding on it, which is what
       a split in white ice actually looks like */
    [['rgba(70,132,178,.92)', 9], ['rgba(255,255,255,.98)', 3.5]].forEach(function (p) {
      var el = doc.createElementNS(ns, 'path');
      el.setAttribute('d', path);
      el.setAttribute('fill', 'none');
      el.setAttribute('stroke', p[0]);
      el.setAttribute('stroke-width', p[1]);
      el.setAttribute('stroke-linecap', 'round');
      el.setAttribute('stroke-linejoin', 'round');
      el.style.strokeDasharray = '9000';
      el.style.strokeDashoffset = '9000';
      svg.appendChild(el);
    });
    return svg;
  }

  function reveal() {
    if (reduced() || !host) { weather(false); return Promise.resolve(); }

    var s = last;
    var h = host.clientHeight || 720;

    /* The crystals that laid the sheet down go WITH it, not before it.
       Sent out at reveal() they were already flying while the ice was meant
       to be holding still, so the freeze never read as frozen. */
    /* FALL_MS, not REVEAL_MS. These carry big blurred frost patches, and
       fading them over the whole reveal left a white veil across the scene
       long after the shards had gone — the break finished and the screen was
       still milk. They leave on the same clock as the ice they laid down. */
    var sendFlakesOut = function () {
      if (s) {
        // Out the way they came, last-landed first, so the sweep unwinds.
        var n = s.flakes.length;
        s.flakes.forEach(function (f, i) {
          run(f.el, [
            { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 1 },
            { transform: 'translate(0,0) rotate(' + (f.spin * -0.06).toFixed(0) + 'deg) scale(1.07)', opacity: 1, offset: 0.18 },
            { transform: 'translate(' + f.fx.toFixed(0) + 'px,' + f.fy.toFixed(0) + 'px) rotate(' + (f.spin * -0.9).toFixed(0) + 'deg) scale(.2)', opacity: 0 }
          ], {
            duration: FALL_MS,
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
          ], { duration: FALL_MS + Math.random() * 260, easing: 'cubic-bezier(.3,.1,.3,1)', fill: 'forwards' });
        });
      }

    };

    /* ---- the break ----------------------------------------------------
       The sheet holds, splits from a point, holds again with the cracks
       showing, and then lets go. Each shard is the SAME ice, clipped: cut
       from one painted box, so until they move there is no seam to see. */
    var doc = host.ownerDocument;
    var w = host.clientWidth || 1280;
    var f = fracture(w, h);
    var ox = w * 0.12, oy = h * 0.12;          // the ice box is inset beyond the host

    var lines = crackLines(doc, f, w, h);
    lines.style.opacity = '0';
    // into `field`, which clear() empties — appended to the host they would
    // survive the transition and stack up, one broken sheet per screen.
    field.appendChild(lines);

    var shardEls = f.shards.map(function (sh) {
      var el = doc.createElement('div');
      var poly = sh.pts.map(function (p) {
        return (p[0] + ox).toFixed(1) + 'px ' + (p[1] + oy).toFixed(1) + 'px';
      }).join(',');
      /* A PIECE OF ICE IS NOT A PIECE OF THE GRADIENT. Cut from one painting
         they are invisible until they move and then read as a picture torn
         up; real shards each catch the light at their own angle. A per-shard
         brightness, and a bright edge along one side, is enough for the eye
         to take them as separate solid things. */
      var lit = 0.92 + Math.random() * 0.2;
      el.style.cssText =
        'position:absolute;inset:-12%;background:' + ICE_PAINT + ';' +
        'clip-path:polygon(' + poly + ');-webkit-clip-path:polygon(' + poly + ');' +
        'filter:brightness(' + lit.toFixed(2) + ');' +
        'box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.75);' +
        'opacity:0;will-change:transform,opacity;';
      field.appendChild(el);
      return { el: el, sh: sh };
    });

    return new Promise(function (done) {
      setTimeout(function () {
        /* the split runs out from the point */
        if (global.SFX) SFX.play('crack');
        lines.style.opacity = '1';
        Array.prototype.forEach.call(lines.childNodes, function (p) {
          run(p, [{ strokeDashoffset: 9000 }, { strokeDashoffset: 0 }],
              { duration: CRACK_MS, easing: 'cubic-bezier(.2,.9,.3,1)', fill: 'forwards' });
        });

        setTimeout(function () {
          /* and it lets go. Inner pieces first: the break travels outward. */
          if (global.SFX) SFX.play('shatter');
          sendFlakesOut();
          ice.style.opacity = '0';
          run(frost, [{ opacity: 0.9 }, { opacity: 0 }], { duration: 160, fill: 'forwards' });
          run(lines, [{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' });

          shardEls.forEach(function (x, i) {
            // Far enough that the wedges genuinely part. At 0.42R the outer
            // pieces still overlapped each other and the scene never showed.
            var reach = f.R * (0.78 + x.sh.ring * 0.42) * (0.85 + Math.random() * 0.4);
            var dx = Math.cos(x.sh.bearing) * reach;
            var dy = Math.sin(x.sh.bearing) * reach + h * 0.26;   // and gravity
            var spin = (Math.random() - 0.5) * 84;
            x.el.style.opacity = '1';
            run(x.el, [
              { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
              { transform: 'translate(' + dx.toFixed(0) + 'px,' + dy.toFixed(0) + 'px) rotate(' + spin.toFixed(0) + 'deg)', opacity: 0 }
            ], {
              duration: FALL_MS,
              delay: x.sh.ring * 70 + Math.random() * 60,
              easing: 'cubic-bezier(.32,.04,.36,1)',
              fill: 'forwards'
            });
          });

          setTimeout(done, FALL_MS + 220);
        }, CRACK_MS + SETTLE_MS);
      }, HOLD_MS);
    }).then(function () {

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
