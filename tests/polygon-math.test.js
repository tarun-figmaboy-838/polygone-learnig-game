/*!
 * test-polygon-math.js — every judgement the game makes about a shape.
 *
 *   node tests/polygon-math.test.js
 *
 * This file decides whether a child is right. If it is wrong the game
 * teaches the wrong thing with total confidence, so the cases below are the
 * exact shapes in the storyboard, including the two traps page 21 sets on
 * purpose: a rhombus (equal sides, unequal angles) and a rectangle (equal
 * angles, unequal sides). Both are irregular. A build that calls either of
 * them regular fails here rather than in front of a class.
 */
'use strict';

global.window = global;
const Poly = require('../src/core/polygon-math.js');

let pass = 0, fail = 0;
function t(label, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
}

/* ---------------------------------------------------------------- *
 * Fixtures — the shapes the deck actually draws
 * ---------------------------------------------------------------- */

const pent = Poly.regular(5, 100, 500, 300);
const hexa = Poly.regular(6, 100, 500, 300);
const tri = Poly.regular(3, 100, 500, 300);
const square = Poly.regular(4, 100, 500, 300);
const octa = Poly.regular(8, 100, 500, 300);

// page 19: one vertex dragged inside
const dented = Poly.pullInward(pent, 0, 0.72);

// page 21 traps. The rhombus is stage.js's own `shapeVerts('rhombus')` with
// r = 100 — deliberately not a rotated square, which is what you get if the
// half-diagonals are equal, and which would be regular.
const rhombus = [{ x: 500, y: 240 }, { x: 600, y: 300 }, { x: 500, y: 360 }, { x: 400, y: 300 }];
const rect = [{ x: 400, y: 250 }, { x: 620, y: 250 }, { x: 620, y: 360 }, { x: 400, y: 360 }];

// a bowtie: what a child makes by dragging a vertex clean through the far side
const bowtie = [{ x: 400, y: 250 }, { x: 600, y: 250 }, { x: 400, y: 400 }, { x: 600, y: 400 }];

const star = (() => {
  const o = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 42 : 100;
    o.push({ x: 500 + Math.cos(a) * r, y: 300 + Math.sin(a) * r });
  }
  return o;
})();

/* ---------------------------------------------------------------- *
 * Structure
 * ---------------------------------------------------------------- */

t('regular pentagon is simple', Poly.isSimple(pent));
t('regular hexagon is simple', Poly.isSimple(hexa));
t('dented pentagon is still simple', Poly.isSimple(dented));
t('star is simple', Poly.isSimple(star));
t('bowtie is NOT simple', !Poly.isSimple(bowtie));
t('two points are not a polygon', !Poly.isSimple([{ x: 0, y: 0 }, { x: 1, y: 1 }]));

t('triangle is convex', Poly.isConvex(tri));
t('square is convex', Poly.isConvex(square));
t('pentagon is convex', Poly.isConvex(pent));
t('octagon is convex', Poly.isConvex(octa));
t('dented pentagon is NOT convex', !Poly.isConvex(dented));
t('star is NOT convex', !Poly.isConvex(star));

t('convexity does not depend on winding', Poly.isConvex(pent.slice().reverse()));
t('concavity does not depend on winding', !Poly.isConvex(dented.slice().reverse()));

t('convex polygon has no reflex vertices', Poly.reflexVertices(pent).length === 0);
t('dented pentagon has exactly one reflex vertex', Poly.reflexVertices(dented).length === 1, Poly.reflexVertices(dented));
t('the reflex vertex is the one that was dragged', Poly.reflexVertices(dented)[0] === 0);
t('star has five reflex vertices', Poly.reflexVertices(star).length === 5);

/* ---------------------------------------------------------------- *
 * Diagonals — the whole first unit of the lesson
 * ---------------------------------------------------------------- */

t('vertex 0 and 1 are adjacent in a pentagon', Poly.isAdjacent(0, 1, 5));
t('vertex 0 and 4 are adjacent in a pentagon (wrap)', Poly.isAdjacent(0, 4, 5));
t('vertex 0 and 2 are NOT adjacent in a pentagon', !Poly.isAdjacent(0, 2, 5));

t('a pentagon vertex has n-3 = 2 diagonals', Poly.diagonalsFrom(0, 5).length === 2, Poly.diagonalsFrom(0, 5));
t('a hexagon vertex has n-3 = 3 diagonals', Poly.diagonalsFrom(0, 6).length === 3, Poly.diagonalsFrom(0, 6));
t('a triangle vertex has no diagonals', Poly.diagonalsFrom(0, 3).length === 0);
t('the diagonals from a vertex are the non-adjacent ones', Poly.diagonalsFrom(0, 5).join() === '2,3');

t('a pentagon has n(n-3)/2 = 5 diagonals', Poly.allDiagonals(5).length === 5);
t('a hexagon has 9 diagonals', Poly.allDiagonals(6).length === 9);
t('a triangle has 0 diagonals', Poly.allDiagonals(3).length === 0);
t('an octagon has 20 diagonals', Poly.allDiagonals(8).length === 20);

t('every diagonal of a convex pentagon is inside',
  Poly.allDiagonals(5).every((d) => Poly.isDiagonalInside(pent, d[0], d[1])));
t('a convex polygon has no outside diagonals', Poly.outsideDiagonals(pent).length === 0);
t('a side is not a diagonal', !Poly.isDiagonalInside(pent, 0, 1));

// page 20: "exactly one diagonal went outside"
t('the dented pentagon has at least one outside diagonal', Poly.outsideDiagonals(dented).length >= 1,
  Poly.outsideDiagonals(dented));
t('the outside diagonal spans the dent',
  Poly.outsideDiagonals(dented).every((d) => d.indexOf(0) < 0), Poly.outsideDiagonals(dented));
t('a star has many outside diagonals', Poly.outsideDiagonals(star).length > 0);

/* ---------------------------------------------------------------- *
 * Measurement — pages 28 to 33
 * ---------------------------------------------------------------- */

const L = Poly.sideLengths(pent);
t('a pentagon has five sides', L.length === 5);
t('a regular pentagon has equal sides', Math.max(...L) - Math.min(...L) < 1e-6);

const A = Poly.interiorAngles(pent);
t('interior angles of a pentagon sum to 540', Math.abs(A.reduce((a, b) => a + b, 0) - 540) < 1e-6,
  A.reduce((a, b) => a + b, 0));
t('interior angles of a hexagon sum to 720',
  Math.abs(Poly.interiorAngles(hexa).reduce((a, b) => a + b, 0) - 720) < 1e-6);
t('each angle of a regular pentagon is 108 degrees', A.every((a) => Math.abs(a - 108) < 1e-6));
t('a dented polygon has one reflex (>180) angle',
  Poly.interiorAngles(dented).filter((a) => a > 180).length === 1);
t('angle sum holds for a concave polygon too',
  Math.abs(Poly.interiorAngles(dented).reduce((a, b) => a + b, 0) - 540) < 1e-6);

t('regular pentagon is equilateral', Poly.isEquilateral(pent));
t('regular pentagon is equiangular', Poly.isEquiangular(pent));
t('regular pentagon is regular', Poly.isRegular(pent));
t('regular hexagon is regular', Poly.isRegular(hexa));
t('square is regular', Poly.isRegular(square));

// THE TRAPS
t('TRAP: a rhombus has equal sides', Poly.isEquilateral(rhombus));
t('TRAP: a rhombus does NOT have equal angles', !Poly.isEquiangular(rhombus));
t('TRAP: a rhombus is NOT regular', !Poly.isRegular(rhombus));
t('TRAP: a rectangle has equal angles', Poly.isEquiangular(rect));
t('TRAP: a rectangle does NOT have equal sides', !Poly.isEquilateral(rect));
t('TRAP: a rectangle is NOT regular', !Poly.isRegular(rect));

t('a concave equilateral shape is not regular', !Poly.isRegular(star));

/* ---------------------------------------------------------------- *
 * classify() — what every stage judgement actually calls
 * ---------------------------------------------------------------- */

const cp = Poly.classify(pent);
t('classify: pentagon sides', cp.sides === 5);
t('classify: pentagon convex', cp.convex && !cp.concave);
t('classify: pentagon regular', cp.regular && !cp.irregular);

const cd = Poly.classify(dented);
t('classify: dented pentagon is concave', cd.concave && !cd.convex);
t('classify: dented pentagon is irregular', cd.irregular && !cd.regular);
t('classify: dented pentagon reports its reflex vertex', cd.reflexVertices.length === 1);
t('classify: dented pentagon reports its outside diagonals', cd.outsideDiagonals.length >= 1);

const cb = Poly.classify(bowtie);
t('classify: a bowtie is not simple', !cb.simple);
t('classify: a non-simple shape is neither convex nor concave', !cb.convex && !cb.concave);
t('classify: a non-simple shape is not regular', !cb.regular);

t('classify: rhombus is convex but irregular',
  Poly.classify(rhombus).convex && Poly.classify(rhombus).irregular);

/* ---------------------------------------------------------------- *
 * The drag clamp — what stops a drag becoming a bowtie mid-gesture
 * ---------------------------------------------------------------- */

t('clampSimple leaves a legal move alone', (() => {
  const p = { x: pent[0].x + 4, y: pent[0].y + 4 };
  const r = Poly.clampSimple(pent, 0, p);
  return Math.abs(r.x - p.x) < 1e-6 && Math.abs(r.y - p.y) < 1e-6;
})());

t('clampSimple keeps the polygon simple on an illegal move', (() => {
  const far = { x: pent[0].x, y: pent[0].y + 600 };     // straight through the far side
  const r = Poly.clampSimple(pent, 0, far);
  const v = pent.map((q, i) => (i === 0 ? r : q));
  return Poly.isSimple(v);
})());

t('clampSimple stops short of the original position, not at it', (() => {
  const far = { x: pent[0].x, y: pent[0].y + 600 };
  const r = Poly.clampSimple(pent, 0, far);
  return Math.hypot(r.x - pent[0].x, r.y - pent[0].y) > 1;
})());

t('a drag toward the centroid can reach concave without breaking simplicity', (() => {
  let v = pent.map((p) => ({ x: p.x, y: p.y }));
  const c = Poly.centroid(pent);
  for (let s = 0.05; s <= 0.95; s += 0.05) {
    const want = { x: pent[0].x + (c.x - pent[0].x) * s, y: pent[0].y + (c.y - pent[0].y) * s };
    v[0] = Poly.clampSimple(v, 0, want);
    if (!Poly.isSimple(v)) return false;
  }
  return Poly.classify(v).concave;
})());

/* ---------------------------------------------------------------- *
 * Generators
 * ---------------------------------------------------------------- */

t('regular() puts one vertex straight up', Math.abs(Poly.regular(5, 100, 0, 0)[0].x) < 1e-9 &&
  Poly.regular(5, 100, 0, 0)[0].y < 0);
t('regular() honours the radius', Math.abs(Math.hypot(...Object.values(Poly.regular(6, 77, 0, 0)[3])) - 77) < 1e-6);
t('centroid of a regular polygon is its centre', (() => {
  const c = Poly.centroid(Poly.regular(7, 90, 310, 220));
  return Math.abs(c.x - 310) < 1e-6 && Math.abs(c.y - 220) < 1e-6;
})());
t('pullInward(0) changes nothing', (() => {
  const v = Poly.pullInward(pent, 2, 0);
  return v.every((p, i) => Math.abs(p.x - pent[i].x) < 1e-9 && Math.abs(p.y - pent[i].y) < 1e-9);
})());
t('pullInward does not mutate the input', (() => {
  const before = JSON.stringify(pent);
  Poly.pullInward(pent, 1, 0.5);
  return JSON.stringify(pent) === before;
})());

t('contains: the centroid is inside', Poly.contains(pent, Poly.centroid(pent)));
t('contains: a far point is outside', !Poly.contains(pent, { x: 5000, y: 5000 }));
t('contains: a point in the dent is outside', !Poly.contains(dented, pent[0]));

console.log('\npolygon-math: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
