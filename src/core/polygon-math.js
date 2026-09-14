/*!
 * polygon-math.js — every geometric judgement the game makes.
 *
 * This file decides whether the learner is right. If anything here is wrong
 * the game teaches the wrong thing with total confidence, so it is small,
 * dependency-free, and tested against the exact shapes in the storyboard.
 *
 * Vertices are [{x, y}, ...] in screen space (y down). Winding does not
 * matter; every test normalises for it.
 *
 *   Poly.isConvex(v)              // all diagonals inside
 *   Poly.diagonalsFrom(i, n)      // the n-3 non-adjacent partners of vertex i
 *   Poly.isDiagonalInside(v,i,j)  // the concave-pentagon moment
 *   Poly.classify(v)              // { sides, simple, convex, equilateral, equiangular, regular }
 *   Poly.regular(n, r, cx, cy)    // generator
 */
(function (global) {
  'use strict';

  var EPS = 1e-9;

  /* ------------------------------------------------------------------ *
   * Tolerances for "equal" — measured against a dragged shape on a touch
   * screen, so they have to be forgiving. Too tight and a regular pentagon
   * the child never touched reads as irregular after one rounding pass;
   * too loose and an obviously lopsided one reads as regular.
   * ------------------------------------------------------------------ */
  var TOL = {
    sideRatio: 0.025,   // 2.5% of the mean side length
    angleDeg:  2.0      // degrees
  };

  /* ------------------------------------------------------------------ *
   * Primitives
   * ------------------------------------------------------------------ */

  function cross(o, a, b) {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  }

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function signedArea(v) {
    var s = 0;
    for (var i = 0, n = v.length; i < n; i++) {
      var a = v[i], b = v[(i + 1) % n];
      s += a.x * b.y - b.x * a.y;
    }
    return s / 2;
  }

  /** Proper segment intersection — touching at an endpoint does not count. */
  function segmentsCross(p1, p2, p3, p4) {
    var d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2);
    var d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
    return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) &&
           ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
  }

  /** Ray-cast point-in-polygon. */
  function contains(v, p) {
    var inside = false;
    for (var i = 0, j = v.length - 1; i < v.length; j = i++) {
      var a = v[i], b = v[j];
      if ((a.y > p.y) !== (b.y > p.y) &&
          p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
    return inside;
  }

  /* ------------------------------------------------------------------ *
   * Structure
   * ------------------------------------------------------------------ */

  /**
   * No two non-adjacent edges cross. A child dragging a vertex "inward" can
   * drag it clean through the far side and make a bowtie — that is not a
   * concave pentagon, it is not a polygon at all, and every other test
   * below is meaningless on it. Check this first and clamp or reject.
   */
  function isSimple(v) {
    var n = v.length;
    if (n < 3) return false;
    for (var i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) {
        // adjacent edges share a vertex; skip them (and the wrap pair)
        if (j === i + 1 || (i === 0 && j === n - 1)) continue;
        if (segmentsCross(v[i], v[(i + 1) % n], v[j], v[(j + 1) % n])) return false;
      }
    }
    return true;
  }

  /**
   * Every turn is the same direction. This is the *definition* the game
   * teaches operationally ("all diagonals inside"), and the two agree for
   * simple polygons — see the test file for the proof-by-storyboard.
   */
  function isConvex(v) {
    var n = v.length;
    if (n < 3) return false;
    var sign = 0;
    for (var i = 0; i < n; i++) {
      var c = cross(v[i], v[(i + 1) % n], v[(i + 2) % n]);
      if (Math.abs(c) < EPS) continue;         // collinear triple, ignore
      var s = c > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
    return true;
  }

  /** Indices of the vertices with a reflex (> 180°) interior angle. */
  function reflexVertices(v) {
    var n = v.length, out = [];
    var orient = signedArea(v) > 0 ? 1 : -1;
    for (var i = 0; i < n; i++) {
      var c = cross(v[(i + n - 1) % n], v[i], v[(i + 1) % n]);
      if (c * orient < -EPS) out.push(i);
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Diagonals
   * ------------------------------------------------------------------ */

  function isAdjacent(i, j, n) {
    var d = Math.abs(i - j);
    return d === 1 || d === n - 1;
  }

  /** Partners of vertex i that form a diagonal, not a side. Always n-3. */
  function diagonalsFrom(i, n) {
    var out = [];
    for (var j = 0; j < n; j++) {
      if (j !== i && !isAdjacent(i, j, n)) out.push(j);
    }
    return out;
  }

  /** Every diagonal once, as [i, j] with i < j. Count is n(n-3)/2. */
  function allDiagonals(n) {
    var out = [];
    for (var i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) {
        if (!isAdjacent(i, j, n)) out.push([i, j]);
      }
    }
    return out;
  }

  /**
   * Does the diagonal i–j lie entirely inside the polygon?
   *
   * Two checks, both needed: the midpoint must be inside (catches the
   * storyboard's concave pentagon, where the diagonal across the dent sits
   * wholly outside), and the segment must not cross any edge (catches a
   * diagonal that pokes out and comes back in, whose midpoint could be
   * inside by luck).
   */
  function isDiagonalInside(v, i, j) {
    var n = v.length;
    if (isAdjacent(i, j, n)) return false;   // that is a side, not a diagonal
    var a = v[i], b = v[j];
    var mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (!contains(v, mid)) return false;
    for (var k = 0; k < n; k++) {
      // edges touching either endpoint may share a point; skip them
      if (k === i || (k + 1) % n === i || k === j || (k + 1) % n === j) continue;
      if (segmentsCross(a, b, v[k], v[(k + 1) % n])) return false;
    }
    return true;
  }

  /** The diagonals that fall outside. Empty for a convex polygon. */
  function outsideDiagonals(v) {
    return allDiagonals(v.length).filter(function (d) {
      return !isDiagonalInside(v, d[0], d[1]);
    });
  }

  /* ------------------------------------------------------------------ *
   * Measurement — the "suspiciously alike" screens
   * ------------------------------------------------------------------ */

  function sideLengths(v) {
    var n = v.length, out = [];
    for (var i = 0; i < n; i++) out.push(dist(v[i], v[(i + 1) % n]));
    return out;
  }

  /** Interior angles in degrees, reflex angles included (> 180 for a dent). */
  function interiorAngles(v) {
    var n = v.length, out = [];
    var orient = signedArea(v) > 0 ? 1 : -1;
    for (var i = 0; i < n; i++) {
      var p = v[(i + n - 1) % n], c = v[i], q = v[(i + 1) % n];
      var ax = p.x - c.x, ay = p.y - c.y, bx = q.x - c.x, by = q.y - c.y;
      var dot = ax * bx + ay * by;
      var cr = ax * by - ay * bx;
      var ang = Math.atan2(Math.abs(cr), dot) * 180 / Math.PI;   // 0..180
      if (cr * orient > EPS) ang = 360 - ang;                     // reflex
      out.push(ang);
    }
    return out;
  }

  function allClose(values, tol) {
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    return max - min <= tol;
  }

  function isEquilateral(v, tol) {
    var s = sideLengths(v);
    var mean = s.reduce(function (a, b) { return a + b; }, 0) / s.length;
    return allClose(s, (tol == null ? TOL.sideRatio : tol) * mean);
  }

  function isEquiangular(v, tol) {
    return allClose(interiorAngles(v), tol == null ? TOL.angleDeg : tol);
  }

  /**
   * Regular = all sides equal AND all angles equal. The storyboard's own
   * page 21 states exactly this, and it has two deliberate traps built in:
   * a rhombus (equal sides, unequal angles) and a rectangle (equal angles,
   * unequal sides). Both are irregular. Test both, or ship a game that
   * calls a rhombus regular.
   */
  function isRegular(v) {
    return isSimple(v) && isConvex(v) && isEquilateral(v) && isEquiangular(v);
  }

  function classify(v) {
    var simple = isSimple(v);
    var convex = simple && isConvex(v);
    var eqSides = simple && isEquilateral(v);
    var eqAngles = simple && isEquiangular(v);
    return {
      sides: v.length,
      simple: simple,
      convex: convex,
      concave: simple && !convex,
      equilateral: eqSides,
      equiangular: eqAngles,
      regular: convex && eqSides && eqAngles,
      irregular: simple && !(convex && eqSides && eqAngles),
      reflexVertices: simple ? reflexVertices(v) : [],
      outsideDiagonals: simple ? outsideDiagonals(v) : []
    };
  }

  /* ------------------------------------------------------------------ *
   * Generators
   * ------------------------------------------------------------------ */

  /** Regular n-gon, one vertex straight up, like every shape in the deck. */
  function regular(n, r, cx, cy) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    return out;
  }

  /**
   * Move vertex i toward the centroid by fraction t (0 = unchanged,
   * 1 = at the centroid). This is "drag the vertex inward" as data.
   */
  function pullInward(v, i, t) {
    var c = centroid(v);
    var out = v.map(function (p) { return { x: p.x, y: p.y }; });
    out[i] = {
      x: v[i].x + (c.x - v[i].x) * t,
      y: v[i].y + (c.y - v[i].y) * t
    };
    return out;
  }

  function centroid(v) {
    var x = 0, y = 0;
    for (var i = 0; i < v.length; i++) { x += v[i].x; y += v[i].y; }
    return { x: x / v.length, y: y / v.length };
  }

  /**
   * Given a proposed new position for vertex i, return the nearest position
   * that keeps the polygon simple. Lets a drag stop at the edge of validity
   * instead of turning into a bowtie mid-gesture.
   */
  function clampSimple(v, i, proposed) {
    var trial = v.map(function (p) { return { x: p.x, y: p.y }; });
    trial[i] = proposed;
    if (isSimple(trial)) return proposed;
    // Binary search back toward the original along the drag vector.
    var lo = 0, hi = 1, from = v[i];
    for (var k = 0; k < 18; k++) {
      var mid = (lo + hi) / 2;
      trial[i] = { x: from.x + (proposed.x - from.x) * mid,
                   y: from.y + (proposed.y - from.y) * mid };
      if (isSimple(trial)) lo = mid; else hi = mid;
    }
    return { x: from.x + (proposed.x - from.x) * lo,
             y: from.y + (proposed.y - from.y) * lo };
  }

  global.Poly = {
    TOL: TOL,
    isSimple: isSimple,
    isConvex: isConvex,
    reflexVertices: reflexVertices,
    isAdjacent: isAdjacent,
    diagonalsFrom: diagonalsFrom,
    allDiagonals: allDiagonals,
    isDiagonalInside: isDiagonalInside,
    outsideDiagonals: outsideDiagonals,
    sideLengths: sideLengths,
    interiorAngles: interiorAngles,
    isEquilateral: isEquilateral,
    isEquiangular: isEquiangular,
    isRegular: isRegular,
    classify: classify,
    regular: regular,
    pullInward: pullInward,
    centroid: centroid,
    clampSimple: clampSimple,
    contains: contains
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.Poly;

})(typeof window !== 'undefined' ? window : this);
