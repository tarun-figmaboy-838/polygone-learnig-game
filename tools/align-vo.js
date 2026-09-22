#!/usr/bin/env node
/* Align the known game script with word timestamps produced by whisper.cpp.
 *
 * Usage:
 *   node tools/align-vo.js path/to/whisper.json
 *   node tools/align-vo.js path/to/whisper.json --apply
 *
 * This is deliberately a report-only tool.  It lets us recover clip and word
 * boundaries from the master take without trusting silence gaps (which occur
 * inside several two-sentence lines as well as between lines).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const voLines = require('./vo-lines');

const file = process.argv[2];
if (!file) throw new Error('pass whisper.cpp full-json output');
const transcript = JSON.parse(fs.readFileSync(file, 'utf8'));

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
// The master take ends at fb10. p31i was added to the game later; the words
// "tap the angles" are already part of p30 in this recording.
const expectedLines = voLines().slice(0, 56).filter((line) => line.id !== 'p31i');
const expected = [];
const aligned = [];
expectedLines.forEach((line, lineIndex) => {
  String(line.text).trim().split(/\s+/).forEach((text, wordIndex) => {
    expected.push({ text, key: norm(text), lineIndex, wordIndex });
  });
});

// Whisper tokens use a leading space to mark a new word. Join BPE pieces and
// punctuation back onto the word they belong to while retaining time bounds.
const heard = [];
(transcript.transcription || []).forEach((segment) => {
  (segment.tokens || []).forEach((token) => {
    const text = token.text || '';
    if (/^\[_/.test(text)) return;
    const key = norm(text);
    if (!key) return;
    const start = token.offsets.from;
    const end = token.offsets.to;
    if (/^\s/.test(text) || !heard.length) {
      heard.push({ text: text.trim(), key, start, end });
    } else {
      const word = heard[heard.length - 1];
      word.text += text;
      word.key += key;
      word.end = Math.max(word.end, end);
    }
  });
});

// Global sequence alignment. Exact words dominate; a fuzzy substitution is
// cheaper than inserting and deleting when Whisper merely misspells Swiftee.
const n = expected.length, m = heard.length;
const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
const back = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
for (let i = 1; i <= n; i++) { dp[i][0] = i; back[i][0] = 1; }
for (let j = 1; j <= m; j++) { dp[0][j] = j; back[0][j] = 2; }
function edit(a, b) {
  const x = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = x[0]; x[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const old = x[i];
      x[i] = Math.min(x[i] + 1, x[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = old;
    }
  }
  return x[a.length];
}
function subCost(a, b) {
  if (a === b) return 0;
  const d = edit(a, b) / Math.max(a.length, b.length, 1);
  return d <= 0.34 ? 0.45 : 1.5;
}
for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
  const del = dp[i - 1][j] + 1;
  const ins = dp[i][j - 1] + 1;
  const sub = dp[i - 1][j - 1] + subCost(expected[i - 1].key, heard[j - 1].key);
  if (sub <= del && sub <= ins) { dp[i][j] = sub; back[i][j] = 3; }
  else if (del <= ins) { dp[i][j] = del; back[i][j] = 1; }
  else { dp[i][j] = ins; back[i][j] = 2; }
}

const matches = new Map();
let i = n, j = m;
while (i || j) {
  const b = back[i][j];
  if (b === 3) { matches.set(i - 1, j - 1); i--; j--; }
  else if (b === 1) i--;
  else j--;
}

expectedLines.forEach((line, lineIndex) => {
  const words = expected.map((w, at) => ({ ...w, at })).filter((w) => w.lineIndex === lineIndex);
  const linked = words.filter((w) => matches.has(w.at));
  const exact = linked.filter((w) => {
    const h = heard[matches.get(w.at)];
    return subCost(w.key, h.key) <= 0.45;
  });
  const first = linked.length ? heard[matches.get(linked[0].at)] : null;
  const last = linked.length ? heard[matches.get(linked[linked.length - 1].at)] : null;
  const pct = Math.round(exact.length * 100 / words.length);
  aligned.push({ line, words, linked, exact, first, last, pct });
  console.log(`${String(lineIndex + 1).padStart(2, '0')} ${line.id.padEnd(5)} ${String(pct).padStart(3)}%  ` +
              `${first ? (first.start / 1000).toFixed(2) : '--'}-${last ? (last.end / 1000).toFixed(2) : '--'}  ${line.text}`);
});

console.log(`\n${n} expected words, ${m} recognized words, alignment cost ${dp[n][m].toFixed(1)}`);

if (process.argv.includes('--apply')) {
  const root = path.resolve(__dirname, '..');
  const source = path.join(root, 'src', 'audio', 'voices.mp3');
  const outDir = path.join(root, 'assets', 'vo');
  const timings = {};
  let made = 0;

  aligned.forEach((entry) => {
    if (entry.pct < 75 || !entry.first || !entry.last) {
      console.warn(`skip ${entry.line.id}: only ${entry.pct}% of its words match the recording`);
      return;
    }
    const start = Math.max(0, entry.first.start - 120);
    const end = entry.last.end + 180;
    const duration = end - start;
    const mp3 = path.join(outDir, entry.line.id + '.mp3');
    const ogg = path.join(outDir, entry.line.id + '.ogg');
    const common = ['-hide_banner', '-loglevel', 'error', '-y', '-ss', (start / 1000).toFixed(3),
      '-t', (duration / 1000).toFixed(3), '-i', source, '-ac', '1'];
    let r = spawnSync('ffmpeg', common.concat(['-codec:a', 'libmp3lame', '-b:a', '128k', mp3]), { encoding: 'utf8' });
    if (r.status) throw new Error(`ffmpeg mp3 ${entry.line.id}: ${r.stderr}`);
    r = spawnSync('ffmpeg', common.concat(['-codec:a', 'libvorbis', '-q:a', '5', ogg]), { encoding: 'utf8' });
    if (r.status) throw new Error(`ffmpeg ogg ${entry.line.id}: ${r.stderr}`);

    const starts = entry.words.map((word) => {
      const hit = matches.get(word.at);
      return hit == null ? null : Math.max(0, heard[hit].start - start);
    });
    // Fill the rare ASR miss between recognized neighbours. This is only a
    // visual cue; clip boundaries themselves always come from heard words.
    starts.forEach((value, at) => {
      if (value != null) return;
      let left = at - 1, right = at + 1;
      while (left >= 0 && starts[left] == null) left--;
      while (right < starts.length && starts[right] == null) right++;
      if (left >= 0 && right < starts.length) {
        starts[at] = Math.round(starts[left] + (starts[right] - starts[left]) * (at - left) / (right - left));
      } else if (left >= 0) starts[at] = starts[left] + 260 * (at - left);
      else if (right < starts.length) starts[at] = Math.max(0, starts[right] - 260 * (right - at));
      else starts[at] = 0;
    });
    timings[entry.line.id] = starts.map(Math.round);
    made++;
  });

  fs.writeFileSync(path.join(outDir, 'word-timings.json'), JSON.stringify(timings, null, 2) + '\n');
  console.log(`\n${made} correctly mapped clips written; word-timings.json updated`);
}
