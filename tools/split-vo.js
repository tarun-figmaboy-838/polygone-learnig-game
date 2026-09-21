#!/usr/bin/env node
/*!
 * split-vo.js — cut one long voice take into the per-line clips the game plays.
 *
 *   node tools/split-vo.js [src/audio/voices.mp3]
 *       finds the gaps between lines, cuts the take into assets/vo/take/NN.mp3,
 *       and writes assets/vo/take/mapping.json — one row per segment, with an
 *       empty `id` for you to fill in from docs/VO.md.
 *
 *   node tools/split-vo.js --apply
 *       copies every segment whose row has an id to assets/vo/<id>.mp3 and
 *       rebuilds assets/vo/index.json, which is the list the game will play.
 *
 * WHY A MAPPING FILE AND NOT A GUESS. The game has 59 lines and the take that
 * was recorded has 37 runs of speech in it, so segment 12 is not line 12 and
 * nothing in the audio says which line it is. Cutting is a machine's job;
 * saying which line a segment is is not. Fill the ids in once and --apply is
 * repeatable for ever after.
 *
 * Needs ffmpeg on PATH. The cut is a stream copy, so it is fast and loses
 * nothing; each clip keeps a little of the silence either side (PAD) so it
 * does not start on a clipped consonant.
 */
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const VO = path.join(ROOT, 'assets', 'vo');
const TAKE = path.join(VO, 'take');
const MAP = path.join(TAKE, 'mapping.json');

const PAD = 0.12;          // seconds of room kept either side of a line
const NOISE = '-34dB';     // quieter than this counts as silence
const GAP = 0.45;          // a gap this long counts as the end of a line
const MIN = 0.35;          // anything shorter than this is a breath, not a line

function ffmpeg(args) {
  return execFileSync('ffmpeg', ['-hide_banner', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function probeSilences(src) {
  // ffmpeg writes silencedetect's report to STDERR and exits 0, so reading
  // stdout gives an empty string and a confident "0 segments".
  const r = require('node:child_process').spawnSync('ffmpeg',
    ['-hide_banner', '-i', src, '-af', `silencedetect=noise=${NOISE}:d=${GAP}`, '-f', 'null', '-'],
    { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(out);
  const total = dur ? (+dur[1]) * 3600 + (+dur[2]) * 60 + parseFloat(dur[3]) : 0;
  const quiet = [];
  const re = /silence_start: ([\d.]+)|silence_end: ([\d.]+)/g;
  let m, open = null;
  while ((m = re.exec(out))) {
    if (m[1] != null) open = parseFloat(m[1]);
    else if (open != null) { quiet.push([open, parseFloat(m[2])]); open = null; }
  }
  if (open != null) quiet.push([open, total]);
  return { total, quiet };
}
function speechRuns({ total, quiet }) {
  const runs = [];
  let at = 0;
  quiet.forEach(([s, e]) => { if (s - at > MIN) runs.push([at, s]); at = e; });
  if (total - at > MIN) runs.push([at, total]);
  return runs;
}

const args = process.argv.slice(2);
if (args[0] === '--apply') {
  if (!fs.existsSync(MAP)) { console.error('no ' + path.relative(ROOT, MAP) + ' — run the split first'); process.exit(1); }
  const rows = JSON.parse(fs.readFileSync(MAP, 'utf8')).segments || [];
  let n = 0;
  rows.forEach((r) => {
    const id = (r.id || '').trim();
    if (!id) return;
    if (!/^[a-z0-9]+$/i.test(id)) { console.error('skipping odd id ' + JSON.stringify(id)); return; }
    fs.copyFileSync(path.join(TAKE, r.file), path.join(VO, id + '.mp3'));
    n++;
  });
  execFileSync(process.execPath, [path.join(__dirname, 'build-vo-index.js')], { stdio: 'inherit' });
  console.log(n + ' clip' + (n === 1 ? '' : 's') + ' placed from the take');
  process.exit(0);
}

const src = path.resolve(ROOT, args[0] || path.join('src', 'audio', 'voices.mp3'));
if (!fs.existsSync(src)) { console.error('no take at ' + src); process.exit(1); }
fs.mkdirSync(TAKE, { recursive: true });

const found = probeSilences(src);
const runs = speechRuns(found);
const segments = runs.map(([s, e], i) => {
  const file = String(i + 1).padStart(2, '0') + '.mp3';
  const from = Math.max(0, s - PAD), to = Math.min(found.total, e + PAD);
  ffmpeg(['-y', '-ss', from.toFixed(3), '-to', to.toFixed(3), '-i', src, '-c', 'copy', path.join(TAKE, file)]);
  return { file, start: +from.toFixed(2), seconds: +(to - from).toFixed(2), id: '' };
});
const old = fs.existsSync(MAP) ? JSON.parse(fs.readFileSync(MAP, 'utf8')).segments || [] : [];
segments.forEach((s, i) => { if (old[i] && old[i].id) s.id = old[i].id; });   // keep work already done
fs.writeFileSync(MAP, JSON.stringify({
  source: path.relative(ROOT, src).replace(/\\/g, '/'),
  note: 'Put a voice id from docs/VO.md in each row, then: node tools/split-vo.js --apply',
  segments
}, null, 2) + '\n');
console.log(segments.length + ' segments cut into ' + path.relative(ROOT, TAKE).replace(/\\/g, '/'));
console.log('next: fill in the ids in ' + path.relative(ROOT, MAP).replace(/\\/g, '/') + ', then run with --apply');
