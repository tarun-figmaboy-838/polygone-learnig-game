/*!
 * test-swiftee.js — the sprite-sheet contract.
 *
 *   node tests/swiftee.test.js
 *
 * The Swiftee assets ship with one promise: any frame of any animation is
 * interchangeable with any other, because every frame is one cell of a
 * uniform grid with the pivot at the exact cell centre. Everything the game
 * does with the character rests on that, and on `swiftee-frames.js` being a
 * faithful, current derivation of `atlas/swiftee.manifest.json`.
 *
 * So this suite checks the things that would silently rot:
 *
 *   - the generated frame table still matches the manifest it came from
 *   - every grid can actually address every frame it claims
 *   - every sheet the table names exists on disk
 *   - every rig state the game asks for resolves to a real start/loop/stop
 *   - the game's sixteen semantic states all map to something that exists
 *   - no reaction is long enough to hit the director's beat ceiling
 *
 * A failure here means `node tools/build-swiftee-frames.js` needs re-running, or
 * the assets and the code have genuinely diverged.
 */
'use strict';

global.window = global;

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const F = require('../src/character/swiftee-frames.js');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/swiftee/swiftee.manifest.json'), 'utf8'));

let pass = 0, fail = 0;
const t = (label, cond, extra) => {
  if (cond) pass++;
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
};

/* ------------------------------------------------------------------ *
 * The generated table is the manifest
 * ------------------------------------------------------------------ */

t('the frame table carries the manifest fps', F.fps === MANIFEST.fps, [F.fps, MANIFEST.fps]);
t('the frame table carries both cell sizes',
  F.cell['1x'] === MANIFEST.cell['1x'] && F.cell['2x'] === MANIFEST.cell['2x'], F.cell);
t('the pivot is the exact cell centre', F.pivot.x === 0.5 && F.pivot.y === 0.5, F.pivot);
t('the baseline is the manifest baseline, not the cell edge',
  Math.abs(F.baselineY - MANIFEST.baselineY.normalized) < 1e-9 && F.baselineY < 1, F.baselineY);

t('every animation in the manifest is in the table',
  Object.keys(MANIFEST.animations).every((n) => !!F.clips[n]),
  Object.keys(MANIFEST.animations).filter((n) => !F.clips[n]));
t('the table invents no animations',
  Object.keys(F.clips).every((n) => !!MANIFEST.animations[n]),
  Object.keys(F.clips).filter((n) => !MANIFEST.animations[n]));

t('frame counts match the manifest exactly',
  Object.keys(F.clips).every((n) => F.clips[n].frames === MANIFEST.animations[n].frames),
  Object.keys(F.clips).filter((n) => F.clips[n].frames !== MANIFEST.animations[n].frames));

t('pingpong flags match the manifest',
  Object.keys(F.clips).every((n) => F.clips[n].pingpong === !!MANIFEST.animations[n].pingpong));

t('all 26 states are carried over', Object.keys(F.states).length === Object.keys(MANIFEST.states).length);
t('all 6 standalone clips are carried over', F.standalone.length === MANIFEST.standalone.length);

/* ------------------------------------------------------------------ *
 * Every grid can address every frame it claims
 * ------------------------------------------------------------------ */

{
  const bad = [];
  Object.keys(F.clips).forEach((name) => {
    const c = F.clips[name];
    ['1x', '2x'].forEach((scale) => {
      const pages = c.sheets[scale];
      if (!pages) return;                         // 2x may legitimately be absent
      let covered = 0;
      pages.forEach((p) => {
        if (p.frames > p.cols * p.rows) bad.push(name + '@' + scale + ': ' + p.frames + ' frames in a ' + p.cols + 'x' + p.rows + ' grid');
        covered += p.frames;
      });
      if (covered !== c.frames) bad.push(name + '@' + scale + ': pages cover ' + covered + ' of ' + c.frames + ' frames');
      // Pages must tile the frame range with no gap and no overlap.
      const sorted = pages.slice().sort((a, b) => a.first - b.first);
      let next = 0;
      sorted.forEach((p) => { if (p.first !== next) bad.push(name + '@' + scale + ': page starts at ' + p.first + ', expected ' + next); next = p.first + p.frames; });
    });
  });
  t('every grid can address every frame, across every page', bad.length === 0, bad.slice(0, 5));
}

{
  // The actual slicing the renderer does, for the first and last frame of
  // every clip at both scales. This is the arithmetic that puts a head where
  // a foot should be if a grid is ever wrong.
  const bad = [];
  Object.keys(F.clips).forEach((name) => {
    const c = F.clips[name];
    ['1x', '2x'].forEach((scale) => {
      const pages = c.sheets[scale];
      if (!pages) return;
      [0, c.frames - 1].forEach((frame) => {
        const page = pages.filter((p) => frame >= p.first && frame < p.first + p.frames)[0];
        if (!page) { bad.push(name + '@' + scale + ' frame ' + frame + ': no page'); return; }
        const local = frame - page.first;
        const col = local % page.cols, row = Math.floor(local / page.cols);
        if (col >= page.cols || row >= page.rows) bad.push(name + '@' + scale + ' frame ' + frame + ' -> ' + col + ',' + row + ' outside ' + page.cols + 'x' + page.rows);
      });
    });
  });
  t('the first and last frame of every clip land inside their grid', bad.length === 0, bad.slice(0, 5));
}

/* ------------------------------------------------------------------ *
 * Every sheet exists on disk
 * ------------------------------------------------------------------ */

{
  const missing = [];
  Object.keys(F.clips).forEach((name) => {
    const c = F.clips[name];
    ['1x', '2x'].forEach((scale) => {
      (c.sheets[scale] || []).forEach((p) => {
        if (!fs.existsSync(path.join(ROOT, F.base, p.image))) missing.push(p.image);
      });
    });
  });
  t('every sheet the table names is on disk', missing.length === 0, missing.slice(0, 5));
}

t('the asset base path is where index.html expects it',
  fs.existsSync(path.join(ROOT, F.base)), F.base);

/* ------------------------------------------------------------------ *
 * Every state resolves
 * ------------------------------------------------------------------ */

{
  const bad = [];
  Object.keys(F.states).forEach((state) => {
    const s = F.states[state];
    [s.start, s.loop, s.stop].forEach((clip) => {
      if (clip && !F.clips[clip]) bad.push(state + ' -> ' + clip);
    });
    if (!s.loop) bad.push(state + ': no loop clip');
  });
  t('every start/loop/stop in every state resolves to a real clip', bad.length === 0, bad);
}

t('the states without a stop clip are exactly the two documented ones',
  Object.keys(F.states).filter((k) => !F.states[k].stop).sort().join(',') === 'driving,sleeping',
  Object.keys(F.states).filter((k) => !F.states[k].stop));

t('the clips that leave the cell are flagged, not silently cropped',
  F.exitsCell.length > 0 && F.exitsCell.every((n) => !!F.clips[n]), F.exitsCell);

t('every standalone clip exists', F.standalone.every((n) => !!F.clips[n]),
  F.standalone.filter((n) => !F.clips[n]));
t('the escape hatches from the stop-less states exist',
  !!F.clips.wake && !!F.clips.drive_away && !!F.clips.reset);

/* ------------------------------------------------------------------ *
 * The game's own mapping
 * ------------------------------------------------------------------ */

// swiftee.js needs a DOM to mount, but its state table is readable without
// one: load it with a stub global and inspect what it exposes.
global.SwifteeFrames = F;
global.document = undefined;
const Swiftee = require('../src/character/swiftee.js');

const RIG = Swiftee.rig;
t('the game exposes its semantic state table', RIG && Object.keys(RIG).length >= 16, Object.keys(RIG || {}).length);

{
  const bad = [];
  Object.keys(RIG).forEach((name) => {
    const rig = RIG[name].rig;
    const isState = !!F.states[rig];
    const isClip = !!F.clips[rig];
    if (!isState && !isClip) bad.push(name + ' -> ' + rig);
  });
  t('every semantic state maps to a real rig state or standalone clip', bad.length === 0, bad);
}

{
  // Every state screens.js can ask for must be in the mapping. This is the
  // check that catches a storyboard edit adding a reaction the art cannot do.
  require('../src/core/polygon-math.js');
  const Screens = require('../src/game/screens.js');
  const asked = new Set();
  Screens.list.forEach((s) => {
    (function walk(list) {
      (list || []).forEach((b) => {
        if (!b || typeof b !== 'object') return;
        if (b.swiftee) asked.add(b.swiftee);
        ['feedback', 'parallel', 'otherwise'].forEach((k) => { if (b[k]) walk(b[k]); });
        if (b.on) Object.keys(b.on).forEach((k) => walk(b.on[k]));
      });
    })(s.beats);
    Object.keys(s.perTap || {}).forEach((k) => (s.perTap[k] || []).forEach((b) => { if (b.swiftee) asked.add(b.swiftee); }));
  });
  const unmapped = [...asked].filter((a) => !RIG[a]);
  t('every Swiftee state the storyboard asks for is mapped to the art',
    unmapped.length === 0, unmapped);
  t('the storyboard exercises a real range of the rig', asked.size >= 14, asked.size);
}

{
  // A reaction that outruns the director's 12s beat ceiling would be cut off
  // mid-animation, and `celebrate` is awaited on every correct answer.
  const dur = (n) => {
    const c = F.clips[n];
    if (!c) return 0;
    return (c.pingpong ? c.frames * 2 - 2 : c.frames) / F.fps * 1000;
  };
  const slow = [];
  Object.keys(RIG).forEach((name) => {
    const def = RIG[name];
    if (def.hold) return;                          // held loops never finish by design
    const s = F.states[def.rig] || { loop: def.rig };
    const total = (s.start ? dur(s.start) : 0) + dur(s.loop) * (def.loops == null ? 1 : def.loops) + (s.stop ? dur(s.stop) : 0);
    if (total > 12000) slow.push(name + ' ' + Math.round(total) + 'ms');
  });
  t('no one-shot reaction outruns the director beat ceiling', slow.length === 0, slow);

  const s = F.states.celebrating;
  const celebrate = dur(s.start) + dur(s.loop) * RIG.celebrate.loops + dur(s.stop);
  t('celebrate stays short enough to gate every correct answer', celebrate <= 4000, Math.round(celebrate) + 'ms');
  t('the narration loop is short enough to track speech', dur('talking') <= 600, Math.round(dur('talking')) + 'ms');
}

/* EVERY RIG A STATE NAMES MUST EXIST.
 *
 * Two of them did not. `idle` pointed at 'blinking' and `exit`/`move` at
 * 'flapping', and neither is among the twenty-six the sheets carry — so the
 * state Swiftee spends most of the lesson in had no animation at all. It
 * threw nothing and logged nothing: he simply held whichever frame was last
 * painted, which looks like a character who has stopped moving rather than
 * like a bug. A name is cheap to check and impossible to notice.
 */
(function () {
  var src = require('fs').readFileSync(__dirname + '/../src/character/swiftee.js', 'utf8');
  var Frames = require('../src/character/swiftee-frames.js');
  var named = (src.match(/rig:s*'[a-z-]+'/g) || []).map(function (x) { return x.split('\x27')[1]; });
  var uniq = named.filter(function (v, i) { return named.indexOf(v) === i; });
  var missing = uniq.filter(function (r) { return !Frames.states[r]; });
  t('every rig a state names exists in the sheet set', missing.length === 0, missing.join(', '));
})();

console.log('\nswiftee: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
