#!/usr/bin/env node
/*!
 * build-swiftee-frames.js — turns the Swiftee manifest into the frame table.
 *
 * The manifest is the single source of truth for frame counts, grids, sheet
 * paths and state triads. Nothing in the game may hardcode any of them. The
 * game is a plain <script> page with no bundler and has to run over file://,
 * where fetching a JSON sibling is blocked — so instead of parsing the
 * manifest at runtime, we parse it here, once, and emit a constants file.
 *
 * Re-run after replacing the assets:
 *
 *   node tools/build-swiftee-frames.js
 *
 * Reads  assets/swiftee/swiftee.manifest.json
 * Writes src/character/swiftee-frames.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ASSETS = 'assets/swiftee';
const MANIFEST = path.join(ROOT, ASSETS, 'swiftee.manifest.json');
const OUT = path.join(ROOT, 'src/character/swiftee-frames.js');

const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

/** One scale's sheet entry -> the page list the renderer walks. */
function pages(entry) {
  if (entry.pageList) {
    return entry.pageList.map((p) => ({
      image: p.image,
      cols: p.cols,
      rows: p.rows,
      first: p.firstFrame,
      frames: p.frames
    }));
  }
  return [{ image: entry.image, cols: entry.cols, rows: entry.rows, first: 0, frames: entry.frames }];
}

const clips = {};
const names = Object.keys(m.animations).sort();
let missing = [];

for (const name of names) {
  const a = m.animations[name];
  const s1 = m.scales['1x'].sheets[name];
  const s2 = m.scales['2x'].sheets[name];
  if (!s1) { missing.push(name + ' @1x'); continue; }

  for (const p of pages(s1)) {
    if (!fs.existsSync(path.join(ROOT, ASSETS, p.image))) missing.push(p.image);
  }
  if (s2) {
    for (const p of pages(s2)) {
      if (!fs.existsSync(path.join(ROOT, ASSETS, p.image))) missing.push(p.image);
    }
  }

  clips[name] = {
    frames: a.frames,
    fps: a.fps,
    ms: a.durationMs,
    loop: !!a.loop,
    pingpong: !!a.pingpong,
    exitsCell: !!a.exitsCell,
    sheets: { '1x': pages(s1), '2x': s2 ? pages(s2) : null }
  };

  // The manifest's per-scale frame count must agree with the animation's, or
  // the renderer would index past the end of a grid.
  if (s1.frames !== a.frames) missing.push(name + ': 1x frames ' + s1.frames + ' != ' + a.frames);
  if (s2 && s2.frames !== a.frames) missing.push(name + ': 2x frames ' + s2.frames + ' != ' + a.frames);
}

if (missing.length) {
  console.error('  manifest/asset mismatch:\n   ' + missing.join('\n   '));
  process.exit(1);
}

/* EVERY SHEET CARRIES ITS OWN CONTENT HASH (?v=), as the rest of the art does. The sheets are
   cached for an hour (vercel.json) under names that never change, so a redrawn sheet could meet
   a browser still holding the old one — new frame data, old drawing. The hash changes when the
   file does, so an updated sheet is a new URL and can never be served stale; an unchanged one
   keeps its URL and its cache. The renderer, the loading bar (Swiftee.sheetUrls) and the paint
   all read this one string, so they always ask for the same URL. */
const crypto = require('crypto');
const hashOf = (rel) => crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, ASSETS, rel))).digest('hex').slice(0, 8);
for (const name of Object.keys(clips)) {
  for (const sc of ['1x', '2x']) {
    (clips[name].sheets[sc] || []).forEach((pg) => { pg.image = pg.image + '?v=' + hashOf(pg.image); });
  }
}

const out =
`/*!
 * swiftee-frames.js — GENERATED, DO NOT EDIT.
 *
 * Source: ${ASSETS}/swiftee.manifest.json
 * Rebuild: node build-swiftee-frames.js
 *
 * ${names.length} animations, ${Object.keys(m.states).length} start/loop/stop states,
 * ${m.standalone.length} standalone clips. Cell ${m.cell['2x']}px @2x / ${m.cell['1x']}px @1x,
 * pivot at the exact cell centre, ${m.fps} fps, uniform grid left-to-right
 * then top-to-bottom. Every one of those numbers comes from the manifest.
 */
(function (global) {
  'use strict';

  var FRAMES = {
    base: ${JSON.stringify(ASSETS + '/')},
    fps: ${m.fps},
    cell: ${JSON.stringify(m.cell)},
    pivot: { x: ${m.pivot.x}, y: ${m.pivot.y} },
    baselineY: ${m.baselineY.normalized},
    states: ${JSON.stringify(m.states)},
    standalone: ${JSON.stringify(m.standalone)},
    exitsCell: ${JSON.stringify(m.exitsCell)},
    clips: ${JSON.stringify(clips)}
  };

  global.SwifteeFrames = FRAMES;
  if (typeof module !== 'undefined' && module.exports) module.exports = FRAMES;

})(typeof window !== 'undefined' ? window : this);
`;

/* --check: WRITE NOTHING, SAY WHETHER THE FILE IS STILL WHAT THIS MAKES.
   The frame table is generated and must never be edited by hand — a patched
   coordinate there moves a frame the manifest knows nothing about. The test
   suite runs this, so a hand edit (or a manifest change nobody rebuilt for)
   fails the build instead of shipping. Line endings are not a difference. */
if (process.argv.includes('--check')) {
  const onDisk = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
  if (onDisk !== out) {
    console.error('  swiftee-frames.js is not what the manifest produces: rebuild it (node tools/build-swiftee-frames.js), never edit it');
    process.exit(1);
  }
  console.log('  swiftee-frames.js matches the manifest');
  process.exit(0);
}

fs.writeFileSync(OUT, out);
console.log(`  swiftee-frames.js written — ${names.length} clips, ${Object.keys(m.states).length} states, ${(out.length / 1024).toFixed(0)} KB`);
