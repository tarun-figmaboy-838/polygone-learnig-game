#!/usr/bin/env node
/*!
 * split-vo.js — cut one long voice take into the per-line clips the game plays.
 *
 *   node tools/split-vo.js [src/audio/voices.mp3] [--gap 0.26] [--noise -34dB] [--min 0.35]
 *       finds the gaps between lines, cuts the take into assets/vo/take/NN.mp3,
 *       and writes assets/vo/take/mapping.json — one row per segment, with an
 *       empty `id` for you to fill in from the list the file carries.
 *
 *   node tools/split-vo.js --refine 37 [--gap 0.14] [--noise -30dB]
 *       re-cuts ONE segment at a finer threshold, in place, and leaves every
 *       other segment and every id already filled in alone. This is what the
 *       run of short lines needs: a gap wide enough to keep a two-sentence
 *       line whole is too wide to separate "Nice!" from "That's it!".
 *
 *   node tools/split-vo.js --apply
 *       copies every segment whose row has an id to assets/vo/<id>.mp3,
 *       encodes the .ogg beside it, rebuilds assets/vo/index.json, and names
 *       every clip the game can still not say.
 *
 * WHY A MAPPING FILE AND NOT A GUESS. The game has sixty-one lines and the
 * take that was recorded has thirty-seven runs of speech in it at the gap it
 * was first cut at, so segment 12 is not line 12 and nothing in the audio
 * says which line it is. Cutting is a machine's job; saying which line a
 * segment is is not.
 *
 * AND THE GUESS WAS WRONG. The first pass settled it by length, and the
 * lengths do not agree: measured against the syllable count of the line each
 * clip is filed under, the correlation is 0.22 — which is no relationship at
 * all. Two of them give it away on their own: p13 is filed as 9.6s for a
 * ten-word line and p27 as 11.1s for a nine-word line, so those files hold
 * two or three utterances each. A child on screen 3 hears the line belonging
 * to screen 4. Nothing here can fix that; only hearing it can, and
 * tools/vo-check.html is the half-hour that does it.
 *
 * Needs ffmpeg on PATH. The cut is a stream copy, so it is fast and loses
 * nothing; each clip keeps a little of the silence either side (PAD) so it
 * does not start on a clipped consonant.
 */
'use strict';
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const voLines = require('./vo-lines');

const ROOT = path.resolve(__dirname, '..');
const VO = path.join(ROOT, 'assets', 'vo');
const TAKE = path.join(VO, 'take');
const MAP = path.join(TAKE, 'mapping.json');

const PAD = 0.12;          // seconds of room kept either side of a line
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

/* ---- arguments ---------------------------------------------------- */
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  if (i < 0 || i + 1 >= argv.length) return dflt;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const has = (name) => {
  const i = argv.indexOf('--' + name);
  if (i < 0) return false;
  argv.splice(i, 1);
  return true;
};

const REFINE = flag('refine', null);
const APPLY = has('apply');
const NOISE = flag('noise', REFINE ? '-30dB' : '-34dB');
const GAP = parseFloat(flag('gap', REFINE ? '0.14' : '0.26'));
const MIN = parseFloat(flag('min', REFINE ? '0.22' : '0.35'));

function ffmpeg(args) {
  return execFileSync('ffmpeg', ['-hide_banner', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function probeSilences(src) {
  // ffmpeg writes silencedetect's report to STDERR and exits 0, so reading
  // stdout gives an empty string and a confident "0 segments".
  const r = spawnSync('ffmpeg',
    ['-hide_banner', '-i', src, '-af', `silencedetect=noise=${NOISE}:d=${GAP}`, '-f', 'null', '-'],
    { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(out);
  const total = dur ? (+dur[1]) * 3600 + (+dur[2]) * 60 + parseFloat(dur[3]) : 0;
  const quiet = [];
  const re = /silence_start: ([-\d.]+)|silence_end: ([\d.]+)/g;
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

/* The list of ids goes into the mapping file, so whoever fills it in has the
   words in front of them and cannot invent an id the game never asks for. */
function mappingFile(src, segments) {
  const rows = voLines();
  const taken = new Set(segments.map((s) => s.id).filter(Boolean));
  return {
    source: rel(src),
    cut: { noise: NOISE, gap: GAP, min: MIN },
    note: 'Put a voice id from `ids` in each row, then: node tools/split-vo.js --apply'
        + '  —  to hear them against their lines first, serve the game and open /tools/vo-check.html',
    ids: rows.map((r) => ({ id: r.id, said: r.text, where: r.where, filled: taken.has(r.id) })),
    segments
  };
}

function writeMapping(src, segments) {
  fs.writeFileSync(MAP, JSON.stringify(mappingFile(src, segments), null, 2) + '\n');
}

/* ---- --apply ------------------------------------------------------ */
if (APPLY) {
  if (!fs.existsSync(MAP)) { console.error('no ' + rel(MAP) + ' — run the split first'); process.exit(1); }
  const rows = JSON.parse(fs.readFileSync(MAP, 'utf8')).segments || [];
  const wanted = new Map(voLines().map((r) => [r.id, r]));
  let n = 0;
  const unknown = [];
  rows.forEach((r) => {
    const id = (r.id || '').trim();
    if (!id) return;
    if (!/^[a-z0-9]+$/i.test(id)) { console.error('skipping odd id ' + JSON.stringify(id)); return; }
    // AN ID THE GAME NEVER ASKS FOR IS A TYPO, and it used to be copied in
    // silently and then sit in the index for ever, never played.
    if (!wanted.has(id)) { unknown.push(id); return; }
    fs.copyFileSync(path.join(TAKE, r.file), path.join(VO, id + '.mp3'));
    n++;
  });
  if (unknown.length) console.error('not ids this game asks for, skipped: ' + unknown.join(' '));

  // THE FORMAT THE BROWSER ACTUALLY FETCHES.
  //
  // src/audio/vo.js asks for <id>.ogg wherever Vorbis plays, which is Chrome,
  // Firefox and every Android — the .mp3 is there for Safari alone. This step
  // used to be a separate tool nobody was told to run, so a clip placed here
  // was listed in the index, requested as .ogg, and 404'd for all but iOS:
  // added, named, wired and inaudible. Cutting a clip and encoding it are one
  // operation, so they are one command.
  execFileSync(process.execPath, [path.join(__dirname, 'encode-vo.js')], { stdio: 'inherit' });
  execFileSync(process.execPath, [path.join(__dirname, 'build-vo-index.js')], { stdio: 'inherit' });
  console.log(n + ' clip' + (n === 1 ? '' : 's') + ' placed from the take');

  // and say what the game still cannot say
  const idx = JSON.parse(fs.readFileSync(path.join(VO, 'index.json'), 'utf8'));
  const have = new Set(idx.clips);
  const silent = [...wanted.keys()].filter((id) => !have.has(id));
  if (!silent.length) console.log('every line the game can ask for has a clip');
  else {
    console.log('\nSTILL SILENT — ' + silent.length + ' of ' + wanted.size + ' lines have no clip:');
    silent.forEach((id) => console.log('  ' + id.padEnd(5) + ' "' + wanted.get(id).text + '"  — ' + wanted.get(id).where));
  }
  process.exit(0);
}

/* ---- --refine N --------------------------------------------------- */
if (REFINE) {
  if (!fs.existsSync(MAP)) { console.error('no ' + rel(MAP) + ' — run the split first'); process.exit(1); }
  const book = JSON.parse(fs.readFileSync(MAP, 'utf8'));
  const segs = book.segments || [];
  const n = parseInt(REFINE, 10);
  const at = segs.findIndex((s) => s.file === String(n).padStart(2, '0') + '.mp3');
  if (at < 0) { console.error('no segment ' + n + ' in ' + rel(MAP)); process.exit(1); }
  const target = segs[at];
  if (target.id) console.error('note: segment ' + n + ' already carries the id ' + target.id + ' — re-cutting it drops that');

  const file = path.join(TAKE, target.file);
  const found = probeSilences(file);
  const runs = speechRuns(found);
  if (runs.length < 2) {
    console.log('segment ' + n + ' does not divide at noise=' + NOISE + ' gap=' + GAP + 's — try a smaller --gap');
    process.exit(0);
  }
  // cut the pieces out of the SEGMENT, but record their start in the TAKE, so
  // every row in the file keeps meaning the same thing
  const tmp = runs.map(([s, e], i) => {
    const out = path.join(TAKE, 'refine-' + String(i + 1).padStart(2, '0') + '.mp3');
    const from = Math.max(0, s - PAD), to = Math.min(found.total, e + PAD);
    ffmpeg(['-y', '-ss', from.toFixed(3), '-to', to.toFixed(3), '-i', file, '-c', 'copy', out]);
    return { tmp: out, start: +(target.start + from).toFixed(2), seconds: +(to - from).toFixed(2) };
  });
  // renumber everything from the cut point on, back to front so nothing is
  // overwritten while it is still needed
  const tailOld = segs.slice(at + 1);
  for (let i = tailOld.length - 1; i >= 0; i--) {
    const from = path.join(TAKE, tailOld[i].file);
    const to = path.join(TAKE, String(at + 1 + tmp.length + i + 1).padStart(2, '0') + '.mp3');
    if (fs.existsSync(from)) fs.renameSync(from, to);
    tailOld[i] = Object.assign({}, tailOld[i], { file: path.basename(to) });
  }
  fs.unlinkSync(file);
  const fresh = tmp.map((t, i) => {
    const name = String(at + 1 + i).padStart(2, '0') + '.mp3';
    fs.renameSync(t.tmp, path.join(TAKE, name));
    return { file: name, start: t.start, seconds: t.seconds, id: '' };
  });
  writeMapping(path.resolve(ROOT, book.source || 'src/audio/voices.mp3'),
               segs.slice(0, at).concat(fresh, tailOld));
  console.log('segment ' + n + ' (' + target.seconds + 's) became ' + fresh.length + ' segments at noise='
              + NOISE + ' gap=' + GAP + 's');
  fresh.forEach((f) => console.log('  ' + f.file + '  ' + f.seconds.toFixed(2) + 's  (take ' + f.start + 's)'));
  console.log('\nnext: fill in their ids in ' + rel(MAP) + ', then run with --apply');
  process.exit(0);
}

/* ---- the full split ----------------------------------------------- */
const src = path.resolve(ROOT, argv[0] || path.join('src', 'audio', 'voices.mp3'));
if (!fs.existsSync(src)) { console.error('no take at ' + src); process.exit(1); }
fs.mkdirSync(TAKE, { recursive: true });

const found = probeSilences(src);
const runs = speechRuns(found);

// clear the old pieces out, so a shorter cut does not leave stale files that
// no row points at and --apply could still copy
fs.readdirSync(TAKE).filter((f) => /^\d+\.mp3$/.test(f)).forEach((f) => fs.unlinkSync(path.join(TAKE, f)));

const segments = runs.map(([s, e], i) => {
  const file = String(i + 1).padStart(2, '0') + '.mp3';
  const from = Math.max(0, s - PAD), to = Math.min(found.total, e + PAD);
  ffmpeg(['-y', '-ss', from.toFixed(3), '-to', to.toFixed(3), '-i', src, '-c', 'copy', path.join(TAKE, file)]);
  return { file, start: +from.toFixed(2), seconds: +(to - from).toFixed(2), id: '' };
});

/* KEEP WORK ALREADY DONE — BY WHERE THE AUDIO IS, NOT BY ROW NUMBER.
 *
 * This used to be `if (old[i].id) new[i].id = old[i].id`, which is only right
 * while the cut never changes. Re-run with any other --gap and the segments
 * are different audio at the same row numbers, so every id already filled in
 * moves quietly onto the wrong sound — thirty-six correct answers turned into
 * thirty-six wrong ones by a flag. A segment is the same segment when it
 * starts at the same place in the take; that is what an id is carried by. */
const old = fs.existsSync(MAP) ? (JSON.parse(fs.readFileSync(MAP, 'utf8')).segments || []) : [];
let kept = 0, dropped = 0;
old.forEach((o) => {
  if (!o.id) return;
  const hit = segments.find((s) => Math.abs(s.start - o.start) < 0.20 && Math.abs(s.seconds - o.seconds) < 0.35);
  if (hit && !hit.id) { hit.id = o.id; kept++; } else dropped++;
});

writeMapping(src, segments);
console.log(segments.length + ' segments cut into ' + rel(TAKE) + '  (noise=' + NOISE + ' gap=' + GAP + 's)');
if (kept || dropped) {
  console.log(kept + ' id' + (kept === 1 ? '' : 's') + ' carried over by start time'
              + (dropped ? ', ' + dropped + ' dropped because that cut no longer exists' : ''));
}
console.log('the game asks for ' + voLines().length + ' clips');
console.log('next: fill in the ids in ' + rel(MAP) + ', then run with --apply');
console.log('to hear each one against its line first: npm start, then open /tools/vo-check.html');
