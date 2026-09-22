#!/usr/bin/env node
/*!
 * build-vo-index.js — lists the voice clips that exist, and how long each is.
 *
 *   assets/vo/*.mp3  →  assets/vo/index.json
 *       { "clips": ["p01", ...], "seconds": { "p01": 5.11, ... } }
 *
 * THE LIST. The game (src/audio/vo.js) only ever asks for a clip in this
 * list, so a missing clip is silence rather than a 404 in the console.
 *
 * THE LENGTHS. A line of two or three sentences is shown as two or three
 * bubbles in turn, and the game used to pace them by counting words — which
 * is a guess, and a guess that drifts from the recording within a sentence.
 * With the real length in hand it paces the bubbles by the voice instead, so
 * the words on the screen are the words being spoken. Read with ffprobe if it
 * is on PATH; without it the list still works and the game falls back to its
 * own reading time.
 *
 * Run it after adding or removing clips:  npm run build:vo
 */
'use strict';
const fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process');

const dir = path.resolve(__dirname, '..', 'assets', 'vo');
fs.mkdirSync(dir, { recursive: true });
const clips = fs.readdirSync(dir).filter((f) => /\.mp3$/i.test(f)).map((f) => f.replace(/\.mp3$/i, '')).sort();

const seconds = {};
let probed = 0;
clips.forEach((id) => {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0',
                                  path.join(dir, id + '.mp3')], { encoding: 'utf8' });
  const d = parseFloat((r.stdout || '').trim());
  if (d > 0) { seconds[id] = Math.round(d * 100) / 100; probed++; }
});

fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ clips, seconds }, null, 2) + '\n');
console.log('assets/vo/index.json  ' + clips.length + ' clip' + (clips.length === 1 ? '' : 's') +
            (probed ? ', ' + probed + ' timed' : ', no ffprobe — lengths unknown'));
