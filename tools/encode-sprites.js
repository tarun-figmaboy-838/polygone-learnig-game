#!/usr/bin/env node
/*!
 * encode-sprites.js — the sprite sheets the game draws, as WebP, from their PNG masters.
 *
 *   node tools/encode-sprites.js
 *
 *   assets/source/intro/sheet1-3.png       ->  assets/swiftee/intro/sheet1-3.webp   (the sleigh intro)
 *   assets/source/swiftee-measuring.png    ->  assets/swiftee/swiftee-measuring.webp (the measuring walk)
 *
 * NEAR-LOSSLESS, NOT LOSSY. These are flat-shaded cartoon sprites with dark outlines and soft
 * alpha edges. Lossy WebP at quality 85 was a third of the size and visibly wrong: it washed
 * out Swiftee's beak outline and the reindeer's collar, and 7-24% of the visible pixels moved
 * by more than 8/255 (the worst by 100). Near-lossless at level 40 moves no pixel, over white
 * or over the sky, by more than 8/255 — which cannot be seen — and is half the size of the PNG.
 *
 * The PNGs stay as the masters (assets/source is not deployed): tools/build-sleigh-frames.js
 * and tools/build-measuring.js measure and write those, and this turns them into what ships.
 * A WebP that is not smaller than its PNG is refused, not written.
 *
 * sharp is Part 2's (part2-frozen-rush/node_modules), as for tools/build-story.js.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
let sharp;
try { sharp = require('sharp'); }
catch (e) { sharp = require(path.join(ROOT, '..', 'part2-frozen-rush', 'node_modules', 'sharp')); }

const PAIRS = [
  ['assets/source/intro/sheet1.avif', 'assets/swiftee/intro/sheet1.webp'],
  ['assets/source/intro/sheet2.avif', 'assets/swiftee/intro/sheet2.webp'],
  ['assets/source/intro/sheet3.avif', 'assets/swiftee/intro/sheet3.webp'],
  ['assets/source/swiftee-measuring.png', 'assets/swiftee/swiftee-measuring.webp']
];
const LEVEL = 40;   // near-lossless preprocessing: 100 is lossless, 0 the most

(async () => {
  let failed = 0;
  for (const [src, out] of PAIRS) {
    const from = path.join(ROOT, src), to = path.join(ROOT, out);
    const buf = await sharp(from).webp({ nearLossless: true, quality: LEVEL, effort: 6 }).toBuffer();
    const was = fs.statSync(from).size;
    if (buf.length >= was) { console.error('REFUSED ' + out + ': ' + buf.length + ' bytes is not smaller than ' + was); failed++; continue; }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, buf);
    console.log(out.padEnd(40) + (buf.length / 1024).toFixed(0).padStart(5) + ' KB  (' + (100 * buf.length / was).toFixed(0) + '% of the ' + (was / 1024).toFixed(0) + ' KB png)');
  }
  if (failed) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
