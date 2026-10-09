#!/usr/bin/env node
/*!
 * build-vo-hindi.js — the Hindi voice, from the user's recordings to what both halves play.
 *
 *   node tools/build-vo-hindi.js --align   first: where each word falls in each recording
 *                                          (tools/align-vo-hindi.py; needs torch — see that file)
 *                                          → docs/vo-hindi.json, then builds as below
 *   node tools/build-vo-hindi.js           builds from docs/vo-hindi.json (needs only ffmpeg/ffprobe):
 *
 *   Part 1  assets/vo/hi/<id>.mp3 + .ogg, word-timings.json, index.json + index.js
 *           — played by src/audio/vo.js when the lesson speaks Hindi (?lan=hi)
 *   Part 2  ../part2-frozen-rush/game/assets/audio/vo-lines-hi.mp3 + .ogg, and its windows in
 *           ../part2-frozen-rush/game/js/vo-hi.js — the Hindi take engine.js plays instead of the
 *           English one (then rebuild Part 2's bundle: node tools/build-bundle.mjs there)
 *   docs/VO-HINDI.md  every recording, the line it is, and the lines that have none yet
 *
 * WHICH RECORDING IS WHICH LINE is tools/vo-hindi.js. A new recording: add its id there, run
 * --align, and the build picks it up.
 *
 * THE WORDS ARE TIMED OFF THE HINDI VOICE. Each recording is aligned against the Hindi words
 * the game shows for its line (polygon-locales.json "hi"), one onset per word — the same count
 * the bubble, the plank and the tutorial split the line into — so each word appears as it is said.
 *
 * AS THE ENGLISH IS. Part 1's clips are cut like the English ones: 0.1 s before the first word
 * (the recordings open on 0.3 s of silence) and the natural tail kept; mono mp3 at 64 kbps and
 * an Opus twin. Part 2's lines are one take with a window each, padded 60 ms before the first
 * word and 120 ms after the last, 0.65 s apart, like the English take. One gain per take
 * (tools/vo-hindi.js `take`: the recordings made together) brings that take's median loudness to
 * the English clips' (-21 LUFS), so the voice sits over the music as the English one does, every
 * take as loud as the others, and no line in a take louder than another than it was.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const { recordings, derived } = require('./vo-hindi.js');

const LESSON = path.resolve(__dirname, '..');
const REPO = path.resolve(LESSON, '..');
const P2 = path.join(REPO, 'part2-frozen-rush', 'game');
const ALIGN = path.join(LESSON, 'docs', 'vo-hindi.json');
const OUT1 = path.join(LESSON, 'assets', 'vo', 'hi');
const TAKE = path.join(P2, 'assets', 'audio', 'vo-lines-hi');
const MODULE = path.join(P2, 'js', 'vo-hi.js');
const DOC = path.join(LESSON, 'docs', 'VO-HINDI.md');
if (!fs.existsSync(P2)) {
  console.error('This is the lesson on its own: rebuilding the Hindi clips needs the combined repository\n' +
    '(POLYGON-PART-1), where Frozen Rush and the recordings of sw1-sw3 live. The clips in assets/vo/hi\n' +
    'are built already and the game plays them; nothing to do here.');
  process.exit(1);
}
const LOC = JSON.parse(fs.readFileSync(path.join(REPO, 'polygon-locales.json'), 'utf8'));
const TARGET_LUFS = -21;
const RATE = 44100;

const plain = (s) => String(s == null ? '' : s).replace(/<\/?strong>/g, '');
const wordsOf = (s) => plain(s).trim().split(/\s+/).filter(Boolean);
const textOf = (id) => {
  if (typeof LOC.hi[id] !== 'string') throw new Error('no Hindi text for ' + id + ' in polygon-locales.json');
  return plain(LOC.hi[id]);
};
const abs = (f) => path.resolve(LESSON, f);
const rel = (f) => path.relative(LESSON, f).split(path.sep).join('/');
const run = (cmd, args, input) => {
  const r = spawnSync(cmd, args, { input, maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(cmd + ' ' + args.join(' ') + '\n' + (r.stderr || '').toString());
  return r;
};

/* ---------------- 1. ALIGN (only with --align) ---------------- */
if (process.argv.includes('--align')) {
  const tmp = path.join(require('node:os').tmpdir(), 'vo-hindi-' + process.pid);
  fs.mkdirSync(tmp, { recursive: true });
  const req = recordings.map((r) => ({ file: abs(r.file), words: wordsOf(textOf(r.id)) }));
  fs.writeFileSync(path.join(tmp, 'req.json'), JSON.stringify(req));
  const py = process.env.PYTHON || 'python3';
  const r = spawnSync(py, [path.join(__dirname, 'align-vo-hindi.py'), path.join(tmp, 'req.json'), path.join(tmp, 'out.json')], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) { console.error('the aligner failed (' + py + ') — see tools/align-vo-hindi.py for what it needs'); process.exit(1); }
  const out = JSON.parse(fs.readFileSync(path.join(tmp, 'out.json'), 'utf8'));
  const doc = {
    note: 'Where each Hindi word falls in each recording, in seconds from the start of the file: torchaudio MMS_FA forced alignment ' +
          '(tools/align-vo-hindi.py) against the words the game shows for the line. tools/build-vo-hindi.js cuts the clips and the ' +
          'take from this. A word with no sound (an em dash) is null.',
    model: 'torchaudio.pipelines.MMS_FA',
    recordings: recordings.map((rc, i) => {
      const o = out[req[i].file];
      return { id: rc.id, file: rc.file, text: textOf(rc.id), seconds: o.dur,
               words: req[i].words.map((w, k) => (o.words[k] ? { w, start: o.words[k][0], end: o.words[k][1] } : { w, start: null, end: null })) };
    })
  };
  fs.writeFileSync(ALIGN, JSON.stringify(doc, null, 1) + '\n');
  console.log('docs/vo-hindi.json  ' + doc.recordings.length + ' recordings aligned');
}

/* ---------------- 2. BUILD ---------------- */
if (!fs.existsSync(ALIGN)) { console.error('no docs/vo-hindi.json — run: node tools/build-vo-hindi.js --align'); process.exit(1); }
const A = JSON.parse(fs.readFileSync(ALIGN, 'utf8'));
const byId = {};
A.recordings.forEach((r) => { byId[r.id] = r; });
// a line re-worded since it was aligned is timed against words it no longer has
const stale = recordings.filter((r) => !byId[r.id] || byId[r.id].text !== textOf(r.id) || byId[r.id].file !== r.file);
if (stale.length) { console.error('aligned against other words (or not aligned): ' + stale.map((r) => r.id).join(' ') + ' — run with --align'); process.exit(1); }

/* A WORD IS SHOWN AS IT IS SAID, NEVER AFTER. The aligner places a word's start 30-70 ms after
   the sound begins (measured against the recordings' own energy, where a word follows a pause),
   so every start is brought forward by LEAD. */
const LEAD = 0.04;
/** Each word's start, with a silent word (an em dash) given the next word's. */
function onsets(r) {
  const out = r.words.map((w) => (w.start == null ? null : Math.max(0, w.start - LEAD)));
  for (let i = out.length - 1; i >= 0; i--) if (out[i] == null) out[i] = i + 1 < out.length ? out[i + 1] : r.words[i - 1].end;
  return out;
}
/** Where the speech starts and ends in a file, and the pauses inside it (ffmpeg silencedetect). */
function speech(file) {
  const log = run('ffmpeg', ['-hide_banner', '-i', file, '-af', 'silencedetect=noise=-45dB:d=0.08', '-f', 'null', '-']).stderr.toString();
  const dur = parseFloat(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).stdout.toString());
  const st = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => parseFloat(m[1]));
  const en = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => parseFloat(m[1]));
  const sil = st.map((s, i) => [s, en[i] != null ? en[i] : dur]);
  const start = sil.length && sil[0][0] < 0.01 ? sil[0][1] : 0;
  const last = sil[sil.length - 1];
  const end = last && last[1] >= dur - 0.01 && last[0] > start ? last[0] : dur;
  return { dur, start, end, pauses: sil.filter((p) => p[0] > start + 0.01 && p[1] < end - 0.01) };
}
function lufs(file) {
  const log = run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128', '-f', 'null', '-']).stderr.toString();
  const m = /Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+) LUFS/.exec(log);
  return m ? parseFloat(m[1]) : null;
}
/** A piece of a recording as mono 16-bit PCM at 44.1 kHz, the gain applied. */
function pcm(file, from, to, gainDb) {
  return run('ffmpeg', ['-v', 'error', '-i', file, '-af', 'atrim=start=' + from.toFixed(4) + (to != null ? ':end=' + to.toFixed(4) : '') +
    ',asetpts=PTS-STARTPTS,volume=' + gainDb.toFixed(2) + 'dB', '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-']).stdout;
}
/* (bit-exact: an Ogg stream otherwise takes a random serial number, so every rebuild would change
   every clip's bytes — and its revision, sending every returning player to fetch it again) */
const pcmIn = ['-f', 's16le', '-ar', String(RATE), '-ac', '1', '-i', '-', '-fflags', '+bitexact', '-flags:a', '+bitexact'];
const r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;

// ONE GAIN PER TAKE: each take's median loudness to the English clips'
const GAIN = {};
[...new Set(recordings.map((r) => r.take || 1))].sort().forEach((tk) => {
  const levels = recordings.filter((r) => (r.take || 1) === tk).map((r) => lufs(abs(r.file))).filter((x) => x != null).sort((a, b) => a - b);
  const median = levels[Math.floor(levels.length / 2)];
  GAIN[tk] = Math.max(-12, Math.min(6, TARGET_LUFS - median));
  console.log('loudness, take ' + tk + ': median ' + median.toFixed(1) + ' LUFS of ' + levels.length + ' recordings -> ' + (GAIN[tk] >= 0 ? '+' : '') + GAIN[tk].toFixed(1) + ' dB to ' + TARGET_LUFS);
});
const takeOf = (id) => (recordings.find((r) => r.id === id) || {}).take || 1;

/* ---- Part 1: one clip per line ---- */
fs.mkdirSync(OUT1, { recursive: true });
const want1 = new Set(recordings.filter((r) => r.plays === 1).map((r) => r.id));
for (const f of fs.readdirSync(OUT1)) {                 // a clip whose line is no longer mapped goes
  const id = f.replace(/\.(mp3|ogg)$/, '');
  if (/\.(mp3|ogg)$/.test(f) && !want1.has(id)) fs.unlinkSync(path.join(OUT1, f));
}
const timings1 = {};
recordings.filter((r) => r.plays === 1).forEach((rc) => {
  const file = abs(rc.file), r = byId[rc.id], sp = speech(file);
  /* 0.1 s before the first word — or before its first sound, a soft attack just ahead of it —
     but not a breath further ahead: the second take draws one before some lines (p37a: 0.3 s of
     it at -53 dB), and a clip that opened on it put its first word 0.4 s after the bubble */
  const on0 = onsets(r)[0];
  const first = Math.max(Math.min(sp.start, on0), on0 - 0.15);
  const cut = Math.max(0, first - 0.10);
  const raw = pcm(file, cut, null, GAIN[rc.take || 1]);
  const mp3 = path.join(OUT1, rc.id + '.mp3'), ogg = path.join(OUT1, rc.id + '.ogg');
  run('ffmpeg', ['-v', 'error', '-y', ...pcmIn, '-c:a', 'libmp3lame', '-b:a', '64k', '-map_metadata', '-1', mp3], raw);
  // the Opus twin, at the first rate that is smaller than the mp3 (tools/make-opus.js)
  for (const kb of [40, 32, 24]) {
    run('ffmpeg', ['-v', 'error', '-y', ...pcmIn, '-c:a', 'libopus', '-b:a', kb + 'k', '-vbr', 'on', '-application', 'voip', '-map_metadata', '-1', '-f', 'ogg', ogg], raw);
    if (fs.statSync(ogg).size < fs.statSync(mp3).size) break;
  }
  let prev = -1;
  timings1[rc.id] = onsets(r).map((t) => { const ms = Math.max(prev, Math.round((t - cut) * 100) * 10, 0); prev = ms; return ms; });
});
fs.writeFileSync(path.join(OUT1, 'word-timings.json'), JSON.stringify(timings1, null, 2) + '\n');
execFileSync(process.execPath, [path.join(__dirname, 'build-vo-index.js'), '--lang', 'hi'], { stdio: 'inherit' });

/* ---- Part 2: one take, a window per line ---- */
const lines2 = recordings.filter((r) => r.plays === 2).map((rc) => {
  const file = abs(rc.file), r = byId[rc.id], sp = speech(file), on = onsets(r);
  const from = Math.max(0, Math.min(sp.start, on[0]) - 0.06), to = Math.min(sp.dur, sp.end + 0.12);
  return { id: rc.id, text: r.text, file, from, to, take: rc.take || 1, words: on.map((t) => t - from) };
}).concat(derived.filter((d) => d.plays === 2).map((d) => {
  const r = byId[d.from], file = abs(r.file), sp = speech(file), on = onsets(r);
  const from = Math.max(0, Math.min(sp.start, on[0]) - 0.06);
  // up to the pause after its words: the first pause that starts after the last of them has begun
  const after = sp.pauses.find((p) => p[0] > on[d.words - 1]);
  const to = after ? Math.min(after[0] + 0.12, after[1]) : sp.end + 0.12;
  return { id: d.id, text: r.words.slice(0, d.words).map((w) => w.w).join(' '), file, from, to, take: takeOf(d.from), words: on.slice(0, d.words).map((t) => t - from) };
}));
const GAP = Buffer.alloc(Math.round(RATE * 0.65) * 2);
const parts = [], windows = [];
let samples = 0;
lines2.forEach((ln, i) => {
  if (i) { parts.push(GAP); samples += GAP.length / 2; }
  const raw = pcm(ln.file, ln.from, ln.to, GAIN[ln.take]);
  const dur = raw.length / 2 / RATE;
  let prev = -1;
  const words = ln.words.map((t) => { const v = Math.max(prev, r2(t), 0); prev = v; return v; });
  windows.push({ id: ln.id, text: ln.text, at: r3(samples / RATE), dur: r3(dur), words });
  parts.push(raw); samples += raw.length / 2;
});
const take = Buffer.concat(parts);
run('ffmpeg', ['-v', 'error', '-y', ...pcmIn, '-c:a', 'libmp3lame', '-b:a', '128k', '-map_metadata', '-1', TAKE + '.mp3'], take);
run('ffmpeg', ['-v', 'error', '-y', ...pcmIn, '-c:a', 'libopus', '-b:a', '40k', '-vbr', 'on', '-application', 'voip', '-map_metadata', '-1', '-f', 'ogg', TAKE + '.ogg'], take);
const pad = Math.max(...windows.map((w) => w.id.length)) + 3;
fs.writeFileSync(MODULE,
  '/* GENERATED by part1-swiftee-lesson/tools/build-vo-hindi.js from the Hindi recordings — DO NOT EDIT.\n' +
  ' *\n' +
  ' * THE HINDI TAKE (?lan=hi): every Part 2 line the user recorded in Hindi, one after another in one\n' +
  ' * file, and a window per line in the English take\'s form — [start, length, word onsets], seconds —\n' +
  ' * with one onset per Hindi word shown, timed off the Hindi recording. engine.js plays this instead\n' +
  ' * of CFG.vo when the game speaks Hindi (VO_TAKES). A line with no window here is not heard. */\n' +
  'export const VO_HI = {\n' +
  "  src: 'assets/audio/vo-lines-hi.mp3', gain: 1,\n" +
  '  lines: {\n' +
  windows.map((w) => '    ' + (JSON.stringify(w.id) + ':').padEnd(pad) + JSON.stringify([w.at, w.dur, w.words]).replace(/,/g, ', ') + ',   // ' + w.text).join('\n') + '\n' +
  '  }\n' +
  '};\n');
console.log('vo-lines-hi  ' + windows.length + ' windows, ' + (samples / RATE).toFixed(2) + ' s  (part2-frozen-rush/game/js/vo-hi.js)');

/* ---- the record of it ---- */
const EN = LOC.en;
const playedBy = (r) => (r.plays === 1 ? 'Part 1' : 'Part 2');
const recorded = new Set(recordings.map((r) => r.id).concat(derived.map((d) => d.id)));
const enClips = JSON.parse(fs.readFileSync(path.join(LESSON, 'assets', 'vo', 'index.json'), 'utf8')).clips;
// in the order they stand in polygon-locales.json, as the recordings are numbered — so each has the
// number its file should take in the lesson's folder, after the ones there now
const missing = Object.keys(EN).filter((id) => enClips.indexOf(id) >= 0 && !recorded.has(id) && typeof EN[id] === 'string');
const next1 = recordings.filter((r) => /vo-part-1-hindi/.test(r.file)).length + 1;
const cell = (s) => String(s).replace(/\|/g, '\\|');
fs.writeFileSync(DOC,
  '# Hindi voice-over — which recording is which line\n\n' +
  '_Generated by `node tools/build-vo-hindi.js` from `tools/vo-hindi.js`; do not edit by hand._\n\n' +
  'With `?lan=hi` both halves speak Hindi: the lesson plays `assets/vo/hi/<id>.ogg` (or `.mp3`) and Frozen Rush its Hindi take ' +
  '(`game/assets/audio/vo-lines-hi`), each word shown as the Hindi voice says it. Every other language stays silent.\n\n' +
  '**Recordings:** `assets/vo-part-1-hindi/<n>.opus` and `../part2-frozen-rush/game/assets/vo-part-2-hindi/<n>.opus`, one line each, ' +
  'numbered in the order the lines stand in `polygon-locales.json`. To add one: put the file in the folder, add its id to ' +
  '`tools/vo-hindi.js`, then `PYTHON=<python with torch> node tools/build-vo-hindi.js --align` and, in `part2-frozen-rush`, `node tools/build-bundle.mjs`.\n\n' +
  '## Recorded (' + recordings.length + ')\n\n' +
  '| Folder | # | Line | Played by | Hindi (on screen and spoken) | English |\n|---|---|---|---|---|---|\n' +
  recordings.map((r) => '| ' + (/part-1/.test(r.file) ? 'Part 1' : 'Part 2') + ' | ' + path.basename(r.file, '.opus') + ' | `' + r.id + '` | ' + playedBy(r) + ' | ' +
    cell(textOf(r.id)) + ' | ' + cell(plain(EN[r.id])) + ' |').join('\n') + '\n' +
  derived.map((d) => '| — | — | `' + d.id + '` | Part ' + d.plays + ' | ' + cell(lines2.find((l) => l.id === d.id).text) + ' (the opening of `' + d.from + '`) | (the ending\'s cheer) |').join('\n') + '\n\n' +
  '## Not recorded yet (' + missing.length + ')\n\n' +
  (!missing.length ? 'None: every line the game says has its Hindi recording.\n' :
  'In Hindi these lines are shown and not heard (the English voice is never played over Hindi words). To record one, save it as ' +
  '`assets/vo-part-1-hindi/<File>` — the numbers carry on from the recordings already there, in the same order — and add its ' +
  'id to `tools/vo-hindi.js`.\n\n' +
  '| File | Line | Hindi (to record) | English |\n|---|---|---|---|\n' +
  missing.map((id, i) => '| ' + (next1 + i) + '.opus | `' + id + '` | ' + cell(textOf(id)) + ' | ' + cell(plain(EN[id])) + ' |').join('\n') + '\n'));
console.log('docs/VO-HINDI.md  ' + recordings.length + ' recorded, ' + missing.length + ' not yet');
