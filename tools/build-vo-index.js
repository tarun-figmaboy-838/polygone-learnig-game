#!/usr/bin/env node
/*!
 * build-vo-index.js — lists the voice clips that exist.
 *
 *   assets/vo/*.mp3  →  assets/vo/index.json   { "clips": ["p01", "fb01", ...] }
 *
 * The game (src/audio/vo.js) only ever asks for clips in this list, so a
 * missing clip is silence rather than a 404 in the console. Run it after
 * adding or removing clips:
 *   node tools/build-vo-index.js
 */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const dir = path.resolve(__dirname, '..', 'assets', 'vo');
fs.mkdirSync(dir, { recursive: true });
const clips = fs.readdirSync(dir).filter((f) => /\.mp3$/i.test(f)).map((f) => f.replace(/\.mp3$/i, '')).sort();
fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ clips }, null, 2) + '\n');
console.log('assets/vo/index.json  ' + clips.length + ' clip' + (clips.length === 1 ? '' : 's') + (clips.length ? ': ' + clips.join(' ') : ''));
