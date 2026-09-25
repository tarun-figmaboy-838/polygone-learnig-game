/*!
 * snowflake.js — the shape of a snow crystal, as path data.
 *
 * One generator, two consumers that could not look more different: the
 * ambient weather in stage.js draws about forty of these small inside the
 * scene's SVG, and the transition draws nine of them enormous in an overlay
 * on top of everything. Sharing the generator is the point — the huge flake
 * that swings across the screen between two screens is recognisably the same
 * crystal that has been drifting past all lesson, which is what makes the
 * transition feel like the weather rather than like a wipe effect.
 *
 * Why a path and not a circle. A dot is not a snowflake; it is a dot. At the
 * sizes this game draws them, six arms with paired branches is the difference
 * between "it is snowing" and "there is white noise on the screen", and it
 * costs one path node either way.
 *
 * Real crystals are hexagonal — six arms, sixty degrees apart, each a stem
 * carrying paired side branches that shorten toward the tip, around a
 * hexagonal plate at the centre. Those are the only facts in here; the rest
 * is jitter, and the jitter is seeded so a flake keeps its shape instead of
 * reshuffling on every re-render.
 *
 *   Snowflake.path(r, seed)      -> SVG path `d`, centred on (0,0)
 *   Snowflake.svg(size, seed, o) -> a standalone <svg> string, for the DOM
 */
(function (global) {
  'use strict';

  var ARMS = 6;
  var TAU = Math.PI * 2;

  /* Three builds of crystal. Snow does not fall as one shape, and a field of
     identical flakes reads as a texture rather than as weather.

       0  stellar dendrite — long arms, three branch pairs, the storybook one
       1  sectored plate   — shorter arms, wide branches near the tip
       2  simple star      — bare arms, for the small distant flakes
  */
  var BUILDS = [
    { at: [0.30, 0.52, 0.74], len: [0.34, 0.26, 0.17], spread: 60, plate: 0.17, tip: 0.13 },
    { at: [0.38, 0.66],       len: [0.30, 0.34],       spread: 52, plate: 0.22, tip: 0.10 },
    { at: [0.58],             len: [0.20],             spread: 64, plate: 0.13, tip: 0.09 }
  ];

  function n(v) { return Math.round(v * 100) / 100; }

  /** Rotate a unit vector by `a` radians. */
  function rot(x, y, a) {
    var c = Math.cos(a), s = Math.sin(a);
    return [x * c - y * s, x * s + y * c];
  }

  /**
   * Path data for one crystal, centred on (0,0), arms `r` long.
   *
   * Drawn as strokes rather than fills: a snowflake is a lattice, and a
   * filled blob of one would just be the dot again.
   */
  function path(r, seed) {
    var b = BUILDS[((seed | 0) % BUILDS.length + BUILDS.length) % BUILDS.length];
    var d = [], k, j, a, u, v, bx, by, e, tipA;

    for (k = 0; k < ARMS; k++) {
      a = (k / ARMS) * TAU - Math.PI / 2;         // first arm points up
      u = Math.cos(a); v = Math.sin(a);

      // the stem
      d.push('M0 0L' + n(u * r) + ' ' + n(v * r));

      // paired branches, shortening toward the tip
      for (j = 0; j < b.at.length; j++) {
        bx = u * r * b.at[j]; by = v * r * b.at[j];
        e = rot(u, v, b.spread * Math.PI / 180);
        d.push('M' + n(bx) + ' ' + n(by) + 'L' + n(bx + e[0] * r * b.len[j]) + ' ' + n(by + e[1] * r * b.len[j]));
        e = rot(u, v, -b.spread * Math.PI / 180);
        d.push('M' + n(bx) + ' ' + n(by) + 'L' + n(bx + e[0] * r * b.len[j]) + ' ' + n(by + e[1] * r * b.len[j]));
      }

      // a small fork at the very end, so the arm finishes instead of stopping
      tipA = 150 * Math.PI / 180;
      e = rot(u, v, tipA);
      d.push('M' + n(u * r) + ' ' + n(v * r) + 'L' + n(u * r + e[0] * r * b.tip) + ' ' + n(v * r + e[1] * r * b.tip));
      e = rot(u, v, -tipA);
      d.push('M' + n(u * r) + ' ' + n(v * r) + 'L' + n(u * r + e[0] * r * b.tip) + ' ' + n(v * r + e[1] * r * b.tip));
    }

    // the hexagonal plate at the centre
    var p = r * b.plate, pts = [];
    for (k = 0; k < ARMS; k++) {
      a = (k / ARMS) * TAU - Math.PI / 2;
      pts.push(n(Math.cos(a) * p) + ' ' + n(Math.sin(a) * p));
    }
    d.push('M' + pts.join('L') + 'Z');

    return d.join('');
  }

  /**
   * A standalone crystal as SVG markup, `size` across, ready to drop into
   * the DOM. Two strokes on the same path: a wide soft one underneath for
   * the frosted glow and a fine bright one on top for the lattice.
   */
  function svg(size, seed, o) {
    o = o || {};
    var r = size / 2 * 0.92;
    var d = path(r, seed);
    var w = o.weight || Math.max(1.2, size * 0.012);
    return '<svg viewBox="' + (-size / 2) + ' ' + (-size / 2) + ' ' + size + ' ' + size + '" ' +
           'width="' + size + '" height="' + size + '" aria-hidden="true" ' +
           'style="display:block;overflow:visible">' +
           '<path d="' + d + '" fill="none" stroke="' + (o.glow || 'rgba(186,226,255,.85)') + '" ' +
             'stroke-width="' + (w * 3.4).toFixed(2) + '" stroke-linecap="round" stroke-linejoin="round"/>' +
           '<path d="' + d + '" fill="none" stroke="' + (o.stroke || '#ffffff') + '" ' +
             'stroke-width="' + w.toFixed(2) + '" stroke-linecap="round" stroke-linejoin="round"/>' +
           '</svg>';
  }

  global.Snowflake = { path: path, svg: svg };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.Snowflake;

})(typeof window !== 'undefined' ? window : this);
