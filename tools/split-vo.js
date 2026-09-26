#!/usr/bin/env node
/*!
 * split-vo.js — cut the recorded take into the per-line clips the game plays.
 *
 *   node tools/split-vo.js [assets/source/gamevo.mp3] [--keep-others]
 *       reads docs/vo-timeline.json (tools/align-vo.js), writes
 *       assets/vo/<id>.mp3 + .ogg for every line in it, their word starts into
 *       assets/vo/word-timings.json, and rebuilds assets/vo/index.json.
 *
 * ONE VOICE. A lesson clip (p…) in assets/vo that the take does not voice is
 * removed (--keep-others keeps it): it is the earlier generated voice, and
 * beside the recording it was heard at once ("the feedback sounds look
 * different?"). The feedback lines the take does not have are left alone:
 * tools/make-vo.js voices those in the voice matched to the take, at the
 * take's level, until they are recorded. Where the take DOES say a feedback
 * line inside another one, that is used (DERIVED): "Yay!" is the first word
 * of p12.
 *
 * WHERE A CLIP BEGINS AND ENDS. Only between lines, never inside one: the
 * pauses inside a line ("Hmm… The sides look…", "Look! This corner…") are the
 * performance and stay in its clip. Both edges are found in the take's own
 * sound, not guessed from the word times:
 *   - it ENDS once the take has stayed quiet for HUSH after the last word,
 *     plus POST of room. Not at the first dip below the threshold: a final
 *     "k" or "t" has a closure and then a release ("Let's check!"), and a cut
 *     in the closure took the release off the word.
 *   - it STARTS in the last quiet stretch before the first word, a little
 *     room before it. Several lines open on a breath, then a beat of quiet,
 *     then the word; a fixed lead-in cut those breaths in half.
 * A 15 ms fade in and 60 ms fade out, both in quiet, keep the edges click-free.
 *
 * THE LEVEL. Every clip is brought to about TARGET (-20.5 LUFS, where the
 * game was mixed and the music's dip under the voice was tuned), so no line is
 * louder or softer than the one before it: read as a performance the take
 * runs from -25 LUFS ("The angles match too!", said softly) to -19.7
 * ("Honk-tastic!"), 5.5 dB, and that is a jump a child hears between screens.
 * Each clip goes MATCH of the way there, never more than MAX_DB, so a soft
 * line is still a little softer than a shout — the reading keeps its shape —
 * and never so far that its peak goes over PEAK_DB.
 *
 * THE PACE. The take is read at about 154 words a minute; the lesson was
 * tuned, and approved, at an unhurried 130-135 ("make sure vo not look very
 * fast", and of this take: "look fast"). TEMPO slows it to that with
 * Rubber Band — pitch and formants kept, so it is the same voice, only
 * unhurried — and the pauses inside a line stretch with it. Measured on the
 * stretched audio, every onset lands where the original's divided by TEMPO
 * says, so the word times are scaled by the same factor.
 *
 * THE WORDS. Each clip's word starts, in ms from the clip's own start, one per
 * word on screen. The model marks a word on the frame its first letter is
 * scored, which is a few frames into the sound — 60 ms on the median, and on a
 * soft or nasal start after a pause as much as 180 ("Look! … No corner"). So:
 *   - a word that follows a pause is SNAPPED to where its sound begins in the
 *     take (the rise out of the quiet just before it), which is exact;
 *   - a word inside running speech has no such edge, and is shown LEAD early.
 * A word shown with its sound reads as said; a tenth of a second after, as
 * lagging behind the voice.
 *
 * Encoded as the rest of assets/vo is (tools/encode-vo.js): mono, 64k mp3 for
 * Safari, Vorbis q1 for everyone else.
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const VO = path.join(ROOT, 'assets', 'vo');
const SRC = path.resolve(ROOT, process.argv.slice(2).find((a) => !a.startsWith('--')) || 'assets/source/gamevo.mp3');
const TIMELINE = path.join(ROOT, 'docs', 'vo-timeline.json');
const ROOM = 0.06, POST = 0.28, HUSH = 0.15, QUIET_DB = -45, LEAD = 60, TEMPO = 0.88;
const TARGET = -20.5, MATCH = 0.8, MAX_DB = 3, PEAK_DB = -1.5;
const LOUD_DB = -35;                                // a word's sound has begun
const STRETCH = 'rubberband=tempo=' + TEMPO + ':detector=soft:formant=preserved:pitchq=quality:window=standard';
const KEEP_OTHERS = process.argv.includes('--keep-others');
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

const tl = JSON.parse(fs.readFileSync(TIMELINE, 'utf8'));
const lines = tl.lines;
// feedback the take says inside a lesson line (align-vo.js DERIVED): [id, line, first word, last word]
const DERIVED = (tl.derived || []).map((d) => [d.id, d.from, d.words[0], d.words[1]]);

// the take decoded once, so every cut is sample-exact on the timeline the
// alignment was measured on
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-cut-'));
const wav = path.join(tmp, 'take.wav');
ff(['-i', SRC, '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', wav]);

// the take's loudness in 10 ms steps: the peak of each step, in dBFS
const pcm = (() => { const b = fs.readFileSync(wav); let o = 12; while (o < b.length - 8) { const id = b.toString('ascii', o, o + 4), n = b.readUInt32LE(o + 4); if (id === 'data') return new Int16Array(b.buffer.slice(b.byteOffset + o + 8, b.byteOffset + o + 8 + n)); o += 8 + n; } throw new Error('no audio in the decoded take'); })();
const STEP = 0.01, per = Math.round(44100 * STEP), steps = Math.floor(pcm.length / per);
const peak = new Float32Array(steps);
for (let k = 0; k < steps; k++) { let m = 0; for (let j = k * per; j < (k + 1) * per; j++) { const v = Math.abs(pcm[j]); if (v > m) m = v; } peak[k] = 20 * Math.log10(m / 32768 + 1e-9); }
const quiet = (t, len) => { for (let k = Math.floor(t / STEP); k < Math.ceil((t + len) / STEP); k++) if (k >= steps || peak[k] > QUIET_DB) return false; return true; };

/* where a word's sound really begins, if it follows a pause: the latest rise
   out of 30 ms of quiet (through at most one soft step) into sound that
   holds, no more than 300 ms before the model's mark and no earlier than
   `floor` — the word before, or for a line's first word the clip's own
   start, which is after any breath (a breath is not the word). null in
   running speech. */
function onsetOf(w, floor) {
  const hi = Math.min(steps - 6, Math.floor((w.start + 0.02) / STEP));
  const lo = Math.max(5, Math.ceil(Math.max(w.start - 0.3, floor) / STEP));
  for (let j = hi; j >= lo; j--) {
    if (peak[j] <= LOUD_DB || peak[j - 1] > LOUD_DB) continue;
    let q = j - 1; if (peak[q] > QUIET_DB) q--;
    if (q - 2 < lo - 3 || peak[q] > QUIET_DB || peak[q - 1] > QUIET_DB || peak[q - 2] > QUIET_DB) continue;
    let held = 0; for (let z = j; z < j + 5; z++) if (peak[z] > -30) held++;
    if (held >= 3) return (q + 1) * STEP;
  }
  return null;
}
const snapped = (words, clipStart) => words.map((w, k) => {
  const at = onsetOf(w, k ? words[k - 1].start + 0.1 : clipStart);
  return at == null ? { start: w.start, lead: LEAD } : { start: at, lead: 0 };
});

/* what is cut: every line of the take, and the feedback said inside them.
   Each knows the sound either side of it — where the one before ends and the
   one after begins — which its edges may not cross. */
const segs = lines.map((l, i) => ({ id: l.id, start: l.start, end: l.end, words: l.words,
                                    before: i ? lines[i - 1].end : 0, after: lines[i + 1] ? lines[i + 1].start : null }));
DERIVED.forEach(([id, from, a, b]) => {
  const i = lines.findIndex((l) => l.id === from); if (i < 0) return;
  const l = lines[i], ws = l.words.slice(a, b + 1);
  segs.push({ id, start: ws[0].start, end: ws[ws.length - 1].end, words: ws,
              before: a ? l.words[a - 1].end : (i ? lines[i - 1].end : 0),
              after: l.words[b + 1] ? l.words[b + 1].start : (lines[i + 1] ? lines[i + 1].start : null) });
});
const cuts = segs.map((l) => {
  // the start: the latest quiet stretch (30 ms) that ends before the first word
  let start = null;
  // (and up to ROOM more before it, only as far as the quiet goes: a breath
  // just before that gap is left out whole, never sliced)
  for (let t = l.start - 0.08; t >= l.start - 0.6 && t >= 0; t -= STEP) {
    if (!quiet(t, 0.03)) continue;
    start = t;
    while (start - STEP >= t - ROOM && start - STEP >= 0 && quiet(start - STEP, STEP)) start -= STEP;
    break;
  }
  if (start == null) start = l.start - 0.18;
  if (l.before) start = Math.max(start, l.before + 0.06);
  start = Math.max(0, start);
  // the end: once the take has stayed quiet for HUSH after the last word
  const limit = l.after != null ? l.after : l.end + 1.5;
  let end = null, hush = null;
  for (let t = l.end; t < limit; t += STEP) {
    if (!quiet(t, HUSH)) continue;
    hush = t; end = t + POST;
    // (but not into a breath or a sound that comes after the quiet)
    for (let u = t + HUSH; u < t + POST; u += STEP) if (!quiet(u, STEP)) { end = u - 0.03; break; }
    break;
  }
  // no long quiet before the next sound ("Yay!", then a breath, then "You
  // made…"): stop in the first short one, and let silence make up the rest
  if (end == null) for (let t = l.end; t < limit; t += STEP) {
    if (!quiet(t, 0.05)) continue;
    let u = t; while (u < t + POST && quiet(u, STEP)) u += STEP;
    hush = t; end = u - 0.02;
    break;
  }
  if (end == null) end = l.end + POST;
  // and never into the sound that follows
  if (l.after != null) end = Math.min(end, l.after - 0.08);
  end = Math.max(end, l.end + 0.06);
  // true silence after the fade, so every clip ends on POST of quiet
  const pad = hush != null ? Math.max(0, hush + POST - end) : 0;
  return { id: l.id, start, end, pad, words: snapped(l.words, start) };
});

const timings = (() => { try { return JSON.parse(fs.readFileSync(path.join(VO, 'word-timings.json'), 'utf8')); } catch (e) { return {}; } })();
/* how loud a stretch of the take is (integrated LUFS) and its peak (dBFS) */
function levelOf(a, b) {
  const r = require('node:child_process').spawnSync('ffmpeg', ['-hide_banner', '-ss', a.toFixed(3), '-t', (b - a).toFixed(3), '-i', wav,
                                                               '-af', 'ebur128=peak=sample', '-f', 'null', '-'], { encoding: 'utf8' });
  const log = r.stderr || '';
  const I = /I:\s+(-?[\d.]+) LUFS\s*\n\s*Threshold/.exec(log), P = /Peak:\s+(-?[\d.]+) dBFS/.exec(log.slice(log.lastIndexOf('Summary')));
  return { lufs: I ? parseFloat(I[1]) : null, peak: P ? parseFloat(P[1]) : null };
}
cuts.forEach((c) => {
  const dur = c.end - c.start, out = dur / TEMPO;
  const lv = levelOf(c.start, c.end);
  let gain = lv.lufs == null ? TARGET + 18.4 : (TARGET - lv.lufs) * MATCH;
  gain = Math.max(-MAX_DB - 2, Math.min(MAX_DB - 2, gain));        // (around the take's own -2 dB offset)
  if (lv.peak != null) gain = Math.min(gain, PEAK_DB - lv.peak);
  c.gain = gain; c.lufs = lv.lufs;
  const af = STRETCH + ',volume=' + gain.toFixed(2) + 'dB,afade=t=in:st=0:d=0.015,afade=t=out:st=' + Math.max(0, out - 0.06).toFixed(3) + ':d=0.06' +
             (c.pad > 0.005 ? ',apad=pad_dur=' + (c.pad / TEMPO).toFixed(3) : '');
  const common = ['-ss', c.start.toFixed(3), '-t', dur.toFixed(3), '-i', wav, '-af', af, '-ac', '1'];
  ff(common.concat(['-c:a', 'libmp3lame', '-b:a', '64k', path.join(VO, c.id + '.mp3')]));
  ff(common.concat(['-c:a', 'libvorbis', '-q:a', '1', path.join(VO, c.id + '.ogg')]));
  timings[c.id] = c.words.map((w) => Math.max(0, Math.round((w.start - c.start) * 1000 / TEMPO - w.lead)));
  c.snaps = c.words.filter((w) => !w.lead).length;
  console.log(c.id.padEnd(6) + ' ' + c.start.toFixed(2).padStart(7) + ' +' + (out + c.pad / TEMPO).toFixed(2) + 's  first word at ' +
              timings[c.id][0] + ' ms, ' + timings[c.id].length + ' words (' + c.snaps + ' on their onset), ' +
              (c.gain >= 0 ? '+' : '') + c.gain.toFixed(1) + ' dB from ' + c.lufs + ' LUFS');
});
if (!KEEP_OTHERS) {
  const made = new Set(cuts.map((c) => c.id)), gone = [];
  fs.readdirSync(VO).forEach((f) => {
    const m = /^(p\d.+)\.(mp3|ogg)$/.exec(f);
    if (!m || made.has(m[1])) return;
    fs.unlinkSync(path.join(VO, f)); if (gone.indexOf(m[1]) < 0) gone.push(m[1]);
  });
  Object.keys(timings).forEach((k) => { if (/^p\d/.test(k) && !made.has(k)) delete timings[k]; });
  if (gone.length) console.log('\nlesson clips not in the take, removed: ' + gone.sort().join(' '));
}
const sorted = {}; Object.keys(timings).sort().forEach((k) => { sorted[k] = timings[k]; });
fs.writeFileSync(path.join(VO, 'word-timings.json'), JSON.stringify(sorted, null, 2) + '\n');
fs.rmSync(tmp, { recursive: true, force: true });
console.log(cuts.length + ' clips cut from ' + rel(SRC) + '; word starts in assets/vo/word-timings.json');
execFileSync(process.execPath, [path.join(__dirname, 'build-vo-index.js')], { stdio: 'inherit' });
