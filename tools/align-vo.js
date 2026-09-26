#!/usr/bin/env node
/*!
 * align-vo.js — where every word of the recorded take is said, to the frame.
 *
 *   node tools/align-vo.js [assets/source/gamevo.mp3] [--modules <dir>]
 *       → docs/vo-timeline.json
 *
 * The take is Swiftee reading the lesson end to end: p01 … p37i, then the
 * finale's "Honk-tastic!" and "You are a polygon adventurer!" (the feedback
 * cheers and nudges are not in it). This finds, for every word of every one
 * of those lines, the moment it starts and ends in the take. Then
 * tools/split-vo.js cuts the take into the per-line clips the game plays and
 * writes each clip's word starts, which the bubbles step against the voice's
 * own clock (game.js reveal).
 *
 * FORCED ALIGNMENT, NOT RECOGNITION. Speech-to-text timestamps were tried
 * first (whisper.cpp, plain and DTW) and measured against the silences in the
 * take: "I am Swiftee" starts at 0.94 s and they put it at 0.70 and 1.08; a
 * quarter of a second is a word visibly early or late. So the script is known
 * and only its timing is asked for: a wav2vec2 CTC model scores every letter
 * in every 20 ms frame, and a Viterbi pass forces the whole script — every
 * line, in order, letter by letter — through those scores. Each word starts
 * on the frame its first letter is emitted. Run once, at development time; the
 * game never does any of this.
 *
 * The model runs in Node through transformers.js, which is NOT a dependency
 * of the game: install it anywhere (`npm i @huggingface/transformers@3` in a
 * scratch folder) and pass that folder with --modules.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const voLines = require('./vo-lines');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf('--' + name); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const MODULES = flag('modules');
const SRC = path.resolve(ROOT, argv[0] || 'assets/source/gamevo.mp3');
const OUT = path.join(ROOT, 'docs', 'vo-timeline.json');
const MODEL = 'Xenova/wav2vec2-base-960h';
const RATE = 16000, FRAME = 320;                  // the model's hop: 20 ms
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

/* THE LINES, IN THE ORDER THE TAKE READS THEM: the deck's narration and
   instructions (p…), which ends with the finale's two. */
const lines = voLines().filter((l) => /^p\d/.test(l.id));
/* FEEDBACK THE TAKE SAYS INSIDE A LESSON LINE: cut out as a clip of its own by
   split-vo.js (words [first, last] of that line), and known to make-vo.js as
   recorded, so it is never generated over. */
const DERIVED = [{ id: 'fb18', from: 'p12', words: [0, 0] }];          // "Yay!"

/* WHAT IS SAID FOR A WORD ON SCREEN. The model spells in capitals and
   apostrophes; "non-adjacent" is said as two words and "Atleast" as "at
   least". A word can be several spoken tokens; its time is its first one's. */
function spokenOf(word) {
  const w = String(word).replace(/[‘’]/g, "'").toUpperCase();
  if (w.replace(/[^A-Z]/g, '') === 'ATLEAST') return ['AT', 'LEAST'];
  return w.split(/[-—–]+/).map((p) => p.replace(/[^A-Z']/g, '').replace(/^'+|'+$/g, '')).filter(Boolean);
}

function decode(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'],
                      { maxBuffer: 1 << 28 });
  if (r.status) throw new Error('ffmpeg could not decode ' + file + ': ' + r.stderr);
  const b = r.stdout;
  return new Float32Array(b.buffer, b.byteOffset, b.length / 4);
}

function silences(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'silencedetect=noise=-40dB:d=0.1', '-f', 'null', '-'], { encoding: 'utf8' });
  const log = (r.stderr || '') + (r.stdout || '');
  const out = []; let open = null;
  log.split(/\r?\n/).forEach((ln) => {
    let m = /silence_start: ([\d.]+)/.exec(ln); if (m) open = parseFloat(m[1]);
    m = /silence_end: ([\d.]+)/.exec(ln); if (m && open != null) { out.push([+open.toFixed(3), +parseFloat(m[1]).toFixed(3)]); open = null; }
  });
  if (open != null) out.push([+open.toFixed(3), null]);
  return out;
}

(async () => {
  const entry = MODULES ? require.resolve('@huggingface/transformers', { paths: [path.resolve(MODULES)] })
                        : require.resolve('@huggingface/transformers');
  const mod = await import(pathToFileURL(entry).href);
  const T = mod.env ? mod : mod.default;
  if (MODULES) T.env.cacheDir = path.join(path.resolve(MODULES), 'models');
  const processor = await T.AutoProcessor.from_pretrained(MODEL);
  const model = await T.AutoModelForCTC.from_pretrained(MODEL, { dtype: 'fp32' });
  const vocabFile = path.join(T.env.cacheDir, MODEL, 'tokenizer.json');
  const vocab = JSON.parse(fs.readFileSync(vocabFile, 'utf8')).model.vocab;
  const BLANK = vocab['<pad>'], SEP = vocab['|'];

  const pcm = decode(SRC);
  const seconds = pcm.length / RATE;
  console.log(rel(SRC) + ': ' + seconds.toFixed(2) + ' s, ' + lines.length + ' lines');

  /* 1. LETTER SCORES FOR EVERY FRAME. In windows of 20 s, each keeping only
     its middle so every frame is scored with context either side. */
  const nFrames = Math.floor(pcm.length / FRAME);
  let V = 0, logp = null;
  const HOP = 15 * RATE, CTX = Math.round(2.5 * RATE);
  for (let keep0 = 0; keep0 < pcm.length; keep0 += HOP) {
    const s0 = Math.max(0, keep0 - CTX), s1 = Math.min(pcm.length, keep0 + HOP + CTX);
    const w0 = Math.floor(s0 / FRAME) * FRAME;
    const inputs = await processor(pcm.slice(w0, s1));
    const { logits } = await model(inputs);
    const [, tn, vn] = logits.dims; V = vn;
    if (!logp) logp = new Float32Array(nFrames * V).fill(-1e4);
    const d = logits.data, f0 = w0 / FRAME;
    const k0 = Math.floor(keep0 / FRAME), k1 = Math.min(nFrames, Math.floor((keep0 + HOP) / FRAME));
    for (let t = 0; t < tn; t++) {
      const g = f0 + t; if (g < k0 || g >= k1) continue;
      let mx = -Infinity; for (let v = 0; v < V; v++) mx = Math.max(mx, d[t * V + v]);
      let sum = 0; for (let v = 0; v < V; v++) sum += Math.exp(d[t * V + v] - mx);
      const lz = mx + Math.log(sum);
      for (let v = 0; v < V; v++) logp[g * V + v] = d[t * V + v] - lz;
    }
    process.stdout.write('.');
  }
  process.stdout.write('\n');

  /* 2. THE SCRIPT AS ONE STRING OF LETTERS, words parted by the model's '|',
     each letter remembering which word on screen it belongs to. */
  const tokens = [], owner = [];      // owner[k] = { li, wi } for letters, null for '|'
  const words = lines.map((l) => String(l.text).trim().split(/\s+/));
  words.forEach((ws, li) => ws.forEach((w, wi) => {
    spokenOf(w).forEach((sp) => {
      if (tokens.length) { tokens.push(SEP); owner.push(null); }
      for (const ch of sp) {
        if (vocab[ch] == null) throw new Error('no letter ' + ch + ' in the model (' + lines[li].id + ': ' + w + ')');
        tokens.push(vocab[ch]); owner.push({ li, wi });
      }
    });
  }));

  /* 3. VITERBI. States are the letters with a blank before, between and after
     each; a frame stays, steps to the next state, or skips a blank between
     two different letters. */
  const L = tokens.length, S = 2 * L + 1, Tn = nFrames;
  const lab = (s) => (s % 2 === 0 ? BLANK : tokens[(s - 1) >> 1]);
  let prev = new Float32Array(S).fill(-Infinity), cur = new Float32Array(S);
  const back = new Uint8Array(Tn * S);
  prev[0] = logp[BLANK]; prev[1] = logp[lab(1)];
  for (let t = 1; t < Tn; t++) {
    const base = t * V, lo = Math.max(0, S - 2 * (Tn - t) - 1), hi = Math.min(S - 1, 2 * t + 1);
    cur.fill(-Infinity);
    for (let s = lo; s <= hi; s++) {
      let best = prev[s], how = 0;
      if (s > 0 && prev[s - 1] > best) { best = prev[s - 1]; how = 1; }
      if (s > 1 && s % 2 === 1 && tokens[(s - 1) >> 1] !== tokens[(s - 3) >> 1] && prev[s - 2] > best) { best = prev[s - 2]; how = 2; }
      if (best === -Infinity) continue;
      cur[s] = best + logp[base + lab(s)];
      back[t * S + s] = how;
    }
    const x = prev; prev = cur; cur = x;
  }
  let s = prev[S - 1] >= prev[S - 2] ? S - 1 : S - 2;
  const first = new Int32Array(L).fill(-1), last = new Int32Array(L).fill(-1);
  for (let t = Tn - 1; t >= 0; t--) {
    if (s % 2 === 1) { const k = (s - 1) >> 1; first[k] = t; if (last[k] < 0) last[k] = t; }
    const how = back[t * S + s];
    s -= how;
  }

  /* 4. EACH WORD ON SCREEN: from its first letter's first frame to its last
     letter's last frame. */
  const at = words.map((ws) => ws.map(() => ({ start: null, end: null })));
  owner.forEach((o, k) => {
    if (!o) return;
    const w = at[o.li][o.wi];
    const a = first[k] * FRAME / RATE, b = (last[k] + 1) * FRAME / RATE;
    if (w.start == null || a < w.start) w.start = a;
    if (w.end == null || b > w.end) w.end = b;
  });
  const sil = silences(SRC);
  const timeline = {
    source: rel(SRC), seconds: +seconds.toFixed(3), model: MODEL, frameMs: FRAME * 1000 / RATE,
    note: 'Word times in seconds from the start of the take, by CTC forced alignment (tools/align-vo.js). ' +
          'tools/split-vo.js cuts the clips from this and writes their word starts into assets/vo/word-timings.json.',
    silences: sil,
    derived: DERIVED,
    lines: lines.map((l, li) => ({
      id: l.id, text: l.text,
      start: +at[li][0].start.toFixed(3), end: +at[li][at[li].length - 1].end.toFixed(3),
      words: words[li].map((w, wi) => ({ text: w, start: +at[li][wi].start.toFixed(3), end: +at[li][wi].end.toFixed(3) }))
    }))
  };
  fs.writeFileSync(OUT, JSON.stringify(timeline, null, 1) + '\n');

  /* HOW GOOD IS IT. Every line begins after a pause, and the pause's end is
     measured independently of the model (silencedetect): the first word of
     each line should start within a frame or two of it. */
  const errs = [];
  timeline.lines.forEach((l) => {
    const before = sil.filter((q) => q[1] != null && q[1] <= l.start + 0.3 && q[1] >= l.start - 0.5).pop();
    const e = before ? Math.round((l.start - before[1]) * 1000) : null;
    if (e != null) errs.push(e);
    console.log(l.id.padEnd(6) + l.start.toFixed(2).padStart(7) + ' ' + l.end.toFixed(2).padStart(7) +
                (e == null ? '      ' : ('  ' + (e >= 0 ? '+' : '') + e + 'ms').padEnd(9)) + '  ' + l.text);
  });
  const sorted = errs.slice().sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)];
  console.log('\nfirst word vs the pause before it: median ' + med + ' ms, ' +
              errs.filter((e) => Math.abs(e - med) <= 40).length + '/' + errs.length + ' within 40 ms of it');
  console.log(rel(OUT) + ' written');
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
