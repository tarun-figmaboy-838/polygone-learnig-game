#!/usr/bin/env node
/*!
 * list-sprites.js — every sprite sheet the game actually plays.
 *
 *   node tools/list-sprites.js           grouped by the moment it appears
 *   node tools/list-sprites.js --files   just the file paths, one per line
 *   node tools/list-sprites.js --unused  the sheets nothing ever plays
 *
 * For redrawing the character. The rig ships 82 animations; this lesson plays
 * far fewer, so knowing which ones matter is the difference between
 * re-rendering a handful and re-rendering all of them. Read from the live
 * state table and the storyboard, so it cannot drift from what the game does.
 *
 * Whatever is redrawn must keep the invariants, or the character will jump
 * between expressions:
 *   - same uniform cell (512 @2x / 256 @1x), no trimming, no re-packing
 *   - pivot at the exact cell centre
 *   - feet on the baseline at 87.7% down the cell
 *   - 20 fps
 * Re-run `node tools/build-swiftee-frames.js` after replacing any sheet.
 */
'use strict';

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
global.window = global;
const F = require(path.join(ROOT, 'src/character/swiftee-frames.js'));
const Swiftee = require(path.join(ROOT, 'src/character/swiftee.js'));
require(path.join(ROOT, 'src/core/polygon-math.js'));
const Screens = require(path.join(ROOT, 'src/game/screens.js'));

const MODE = process.argv[2] || '';

/** Which semantic states the storyboard actually asks for. */
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

/** What each semantic state is for, in the child's terms. */
const WHY = {
  idle:        'resting — the default between everything else',
  explain:     'mouth moves for exactly as long as a spoken line lasts',
  think:       'a question is on screen and he is waiting with the child',
  inspect:     'looking closely at the shape ("the sides look suspiciously alike")',
  look:        'glancing at whatever was just pointed out',
  point:       'drawing attention to a vertex, a side, a panel',
  wave:        'the greeting, right after he lands',
  nod:         'agreeing, moving the lesson on',
  celebrate:   'a correct answer — awaited, so it gates every right answer',
  encourage:   'after a wrong answer; warm, never a telling-off',
  confused:    'the wrong answer itself',
  surprised:   'the "Whoa!" when a diagonal falls outside',
  mischief:    '"Let’s make a change" before breaking the shape',
  'step-back': 'getting out of the way so the child can work',
  proud:       'the end of the lesson',
  excited:     'the finale, the biggest reaction in the game',
  stuck:       'held in reserve for a child who keeps missing',
  happy:       'a small yes',
  daydream:    'idle about 30 seconds',
  sleep:       'idle a long time',
  enter:       'the arrival — he flies in from off-stage and lands',
  exit:        'leaving',
  move:        'crossing to a new position'
};

const rig = Swiftee.rig;
const rows = [];
const seen = new Set();

Object.keys(rig).forEach((state) => {
  const def = rig[state];
  const st = F.states[def.rig];
  const clips = st ? [st.start, st.loop, st.stop].filter(Boolean) : [def.rig];
  clips.forEach((c) => seen.add(c));
  rows.push({
    state,
    used: asked.has(state) || ['idle', 'explain', 'daydream', 'sleep', 'proud', 'excited', 'stuck', 'happy'].includes(state),
    inStoryboard: asked.has(state),
    rig: def.rig,
    clips,
    why: WHY[state] || ''
  });
});
['wake', 'reset'].forEach((c) => seen.add(c));

function sheets(clip) {
  const c = F.clips[clip];
  if (!c) return [];
  const out = [];
  ['1x', '2x'].forEach((scale) => {
    (c.sheets[scale] || []).forEach((p) => out.push(F.base + p.image));
  });
  return out;
}

if (MODE === '--files') {
  const all = new Set();
  seen.forEach((c) => sheets(c).forEach((f) => all.add(f)));
  [...all].sort().forEach((f) => console.log(f));
  process.exit(0);
}

if (MODE === '--unused') {
  const unused = Object.keys(F.clips).filter((c) => !seen.has(c)).sort();
  console.log(`\n  ${unused.length} of ${Object.keys(F.clips).length} animations are never played by this lesson.`);
  console.log('  Nothing here needs redrawing unless you want it for a future lesson.\n');
  unused.forEach((c) => console.log('    ' + c.padEnd(22) + F.clips[c].frames + ' frames'));
  process.exit(0);
}

/* ---------------- the report ---------------- */

console.log('\n  SPRITES THIS GAME PLAYS');
console.log('  ' + '='.repeat(74));
console.log(`  ${seen.size} of ${Object.keys(F.clips).length} rig animations, ${[...seen].reduce((n, c) => n + (F.clips[c] ? F.clips[c].frames : 0), 0)} frames in total.`);
console.log('  Cell 512px @2x / 256px @1x, pivot dead centre, feet on the 87.7% baseline, 20 fps.');
console.log('  Keep all four when you redraw, or expressions will jump when they swap.\n');

rows.sort((a, b) => (b.inStoryboard - a.inStoryboard) || a.state.localeCompare(b.state));

rows.forEach((r) => {
  const tag = r.inStoryboard ? '' : '  (not in the storyboard; reached by the game itself)';
  console.log(`  ${r.state.toUpperCase()}${tag}`);
  console.log(`    ${r.why}`);
  console.log(`    rig state: ${r.rig}`);
  r.clips.forEach((c) => {
    const n = F.clips[c] ? F.clips[c].frames : '?';
    const files = sheets(c);
    console.log(`      ${c.padEnd(20)} ${String(n).padStart(3)} frames`);
    files.forEach((f) => console.log(`        ${f}`));
  });
  console.log('');
});

console.log('  STANDALONE');
console.log('    wake / reset — leaving the sleep pose, and a hard neutral reset');
['wake', 'reset'].forEach((c) => sheets(c).forEach((f) => console.log('        ' + f)));

console.log('\n  THE ARRIVAL');
console.log('    He flies in on `flapping` and lands. There is no separate art:');
console.log('    the entrance IS the rig, so redrawing flapping redraws the intro.\n');

console.log('  AFTER REPLACING ANY RIG SHEET: node tools/build-swiftee-frames.js');
console.log('  (it regenerates the frame table and fails if the art and manifest disagree)\n');
