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
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const dir = path.resolve(__dirname, '..', 'assets', 'vo');
fs.mkdirSync(dir, { recursive: true });
const clips = fs.readdirSync(dir).filter((f) => /\.mp3$/i.test(f)).map((f) => f.replace(/\.mp3$/i, '')).sort();

/* THE REVISION, AND WHY A CLIP NEEDS ONE.
 *
 * vercel.json serves everything under /assets/ with
 * `max-age=31536000, immutable` — a year, and the browser is told not even to
 * ask. That is right for art, which is replaced by adding a file, and wrong
 * for these, which are replaced IN PLACE: re-cutting the take fixes the words
 * inside p03.mp3 and leaves it called p03.mp3. Every returning child would go
 * on hearing the wrong line for a year, and the deploy would look fine.
 *
 * So each clip carries a short hash of its own bytes, and src/audio/vo.js asks
 * for <id>.ogg?v=<rev>. index.json is the one file that is revalidated, so a
 * new hash arrives at once and only the clips that actually changed are
 * fetched again. */
const revOf = (id) => {
  const h = crypto.createHash('md5');
  let any = false;
  ['.mp3', '.ogg'].forEach((ext) => {
    const f = path.join(dir, id + ext);
    if (!fs.existsSync(f)) return;
    any = true;
    h.update(fs.readFileSync(f));
  });
  return any ? h.digest('hex').slice(0, 8) : '';
};

const seconds = {};
const rev = {};
const wordMs = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'word-timings.json'), 'utf8')); }
  catch (e) { return {}; }
})();
let probed = 0;
clips.forEach((id) => {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0',
                                  path.join(dir, id + '.mp3')], { encoding: 'utf8' });
  const d = parseFloat((r.stdout || '').trim());
  if (d > 0) { seconds[id] = Math.round(d * 100) / 100; probed++; }
  const v = revOf(id);
  if (v) rev[id] = v;
});

const words = {};
clips.forEach((id) => { if (Array.isArray(wordMs[id])) words[id] = wordMs[id]; });
fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ clips, seconds, rev, words }, null, 2) + '\n');
console.log('assets/vo/index.json  ' + clips.length + ' clip' + (clips.length === 1 ? '' : 's') +
            (probed ? ', ' + probed + ' timed' : ', no ffprobe — lengths unknown'));
