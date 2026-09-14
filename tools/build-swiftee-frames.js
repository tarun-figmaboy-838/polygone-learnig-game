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

fs.writeFileSync(OUT, out);
console.log(`  swiftee-frames.js written — ${names.length} clips, ${Object.keys(m.states).length} states, ${(out.length / 1024).toFixed(0)} KB`);
