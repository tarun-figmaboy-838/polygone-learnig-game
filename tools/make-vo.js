#!/usr/bin/env node
/*!
 * make-vo.js — Swiftee's voice, generated, with the moment of every word.
 *
 *   node tools/make-vo.js                 every line that has no clip yet
 *   node tools/make-vo.js --all           every line, again
 *   node tools/make-vo.js p21 p22         just these
 *   options: --voice en-US-AvaNeural --pitch +6% --rate -20%
 *
 *   then:    npm run build:vo
 *
 * Every line the game can say (tools/vo-lines.js — the storyboard, the
 * answers, the reasons, the reminders) is spoken by one natural neural voice
 * from Microsoft Edge's read-aloud service and saved as assets/vo/<id>.mp3.
 * The service reports when each word begins (its WordBoundary events), and
 * those times are written to assets/vo/word-timings.json against the words
 * the BUBBLE shows — so each word appears as it is said, not on a clock of
 * its own. build-vo-index.js folds them into index.json for the game.
 *
 * THE VOICE. Swiftee's lesson lines are a RECORDING (assets/source/gamevo.mp3,
 * cut by tools/split-vo.js); this voices only what the take does not — the
 * feedback cheers and nudges — until they are recorded too. So the voice here
 * is the one that sits beside the recording: measured against the take's own
 * lines, Ana is by far the nearest of the en-US voices in timbre (3.7 dB
 * long-term mel-spectrum distance, against 5.5 dB and more for every other)
 * and in pitch, and the defaults below pull her pitch and pace onto the
 * take's (a 262 Hz median; about 128 words a minute, the pace split-vo cuts
 * the take to). Any Edge voice can be tried with --voice.
 *
 * THE LEVEL. Each clip is brought to TARGET LUFS, the level the take's clips
 * are cut at (split-vo.js), so a cheer is never louder than the line before
 * it — and written straight out in the game's formats (mono 64k mp3 for
 * Safari, Vorbis q1 for everyone else), so no encode step follows.
 *
 * THE WORDS SHOWN AND THE WORDS SPOKEN can differ ("Atleast" is said "at
 * least"; "Hmm…" is said "Hmm"). Each word of the bubble takes the start of
 * the first spoken word that begins it, matched on letters alone.
 *
 * WHY NOT THE edge-tts PACKAGE. Its built-in browser version is refused by the
 * service now (HTTP 403); this speaks the same protocol with a current one,
 * over Node's own WebSocket, and needs nothing installed.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const lines = require('./vo-lines');

const ROOT = path.resolve(__dirname, '..');
const VO = path.join(ROOT, 'assets', 'vo');
const TIMINGS = path.join(VO, 'word-timings.json');

const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : dflt; };
const VOICE = arg('voice', 'en-US-AnaNeural');
// -11%: Ana's own median is ~300 Hz against the take's 262; at -11% she
// reads at 262-276 on the take's lines, and the timbre distance is at its
// lowest there (2.7-2.9 dB; 3.7 at her own pitch, and it climbs past -13%)
const PITCH = arg('pitch', '-11%');
// -5%: on the take's lines Ana at her own rate runs 5% quicker than the
// take cut to its unhurried ~128 words a minute; this brings her level with it
const RATE = arg('rate', '-5%');
const { spawnSync, execFileSync } = require('node:child_process');
const TARGET = -20.5, PEAK_DB = -1.5;                 // as tools/split-vo.js cuts the take
const TMP = path.join(VO, '.make-vo.tmp.mp3');
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
/* how loud a clip is (integrated LUFS) and its peak (dBFS) */
function levelOf(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'ebur128=peak=sample', '-f', 'null', '-'], { encoding: 'utf8' });
  const log = r.stderr || '';
  const I = /I:\s+(-?[\d.]+) LUFS\s*\n\s*Threshold/.exec(log), P = /Peak:\s+(-?[\d.]+) dBFS/.exec(log.slice(log.lastIndexOf('Summary')));
  return { lufs: I ? parseFloat(I[1]) : null, peak: P ? parseFloat(P[1]) : null };
}
/* WHERE A WORD'S SOUND BEGINS. The service's boundary for a word after a
   pause — the first word most of all — sits 80-130 ms before anything can be
   heard (measured on every cheer: the mark at 103 ms, sound from 170-230);
   inside running speech its boundaries are right ("more" lands on its dip).
   So a mark with quiet beside it is moved to the rise out of that quiet, as
   split-vo.js does for the take; a mark in running speech is left alone. */
function snapCues(cs, file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 1 << 26 });
  if (r.status || !r.stdout || !r.stdout.length) return cs;
  const x = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length / 4);
  const STEP = 10, per = 160, n = Math.floor(x.length / per), db = new Float32Array(n);
  for (let k = 0; k < n; k++) { let m = 0; for (let i = k * per; i < (k + 1) * per; i++) m = Math.max(m, Math.abs(x[i])); db[k] = 20 * Math.log10(m + 1e-9); }
  const quietAt = (k) => k < 0 || k >= n || db[k] <= -45;
  const out = [];
  cs.forEach((c, i) => {
    if (i && c === cs[i - 1]) { out.push(out[i - 1]); return; }      // a mark riding on the word before
    let nearQuiet = false;
    for (let k = Math.floor((c - 60) / STEP); k <= Math.floor((c + 60) / STEP); k++) if (quietAt(k)) { nearQuiet = true; break; }
    if (!nearQuiet) { out.push(c); return; }
    // the rise NEAREST the mark, and strictly between its neighbours: after
    // the word before is shown and before the word after is marked. The
    // latest rise in the window was taken before, and where a word dips into
    // quiet before the next ("You | got it!") it moved "You" onto "got";
    // the nearest, unbounded, could pull "one" back onto "that".
    let nextMark = Infinity; for (let z = i + 1; z < cs.length; z++) if (cs[z] > c) { nextMark = cs[z]; break; }
    const floor = i ? out[i - 1] + 40 : -Infinity, ceil = nextMark - 40;
    const hi = Math.min(n - 5, Math.floor((c + 300) / STEP), Math.floor(ceil / STEP)), lo = Math.max(3, Math.floor((c - 150) / STEP));
    let at = c, best = Infinity;
    for (let j = hi; j >= lo; j--) {
      if (db[j] <= -35) continue;
      // the quiet it rose out of, within 60 ms: a nasal or a fricative
      // ("Nice", "That's") climbs through the threshold over a few steps
      let q = -1; for (let z = j - 1; z >= j - 6 && z >= 0; z--) if (quietAt(z)) { q = z; break; }
      if (q < 0 || !quietAt(q - 1) || !quietAt(q - 2)) continue;
      let held = 0; for (let z = j; z < j + 5 && z < n; z++) if (db[z] > -30) held++;
      if (held < 3) continue;
      const onset = (q + 1) * STEP;                        // the first step out of the quiet
      if (onset < floor || onset > ceil) continue;
      if (Math.abs(onset - c) < best) { best = Math.abs(onset - c); at = onset; }
    }
    out.push(i ? Math.max(at, out[i - 1]) : at);
  });
  return out;
}
const ALL = process.argv.includes('--all');
const only = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !(all[i - 1] || '').startsWith('--'));

const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const EDGE = '143.0.3650.75';
const WSS = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';

/* the service's short-lived key: a hash of the time (to five minutes) and the token */
function secGec() {
  let t = Math.floor(Date.now() / 1000) + 11644473600;
  t -= t % 300;
  return crypto.createHash('sha256').update((t * 1e7).toFixed(0) + TOKEN, 'ascii').digest('hex').toUpperCase();
}
const uid = () => crypto.randomUUID().replace(/-/g, '');
const stamp = () => new Date().toUTCString().replace('GMT', 'GMT+0000 (Coordinated Universal Time)');
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* what is SAID for a line (the bubble keeps its own spelling) */
function spoken(text) {
  return String(text)
    .replace(/\bAtleast\b/g, 'At least').replace(/\batleast\b/g, 'at least')
    .replace(/…/g, '...');
}

/** One line: its audio and its word boundaries (ms from the start of the audio). */
function speak(text) {
  return new Promise((resolve, reject) => {
    const url = WSS + '?TrustedClientToken=' + TOKEN + '&Sec-MS-GEC=' + secGec() + '&Sec-MS-GEC-Version=1-' + EDGE + '&ConnectionId=' + uid();
    const ws = new WebSocket(url, { headers: {
      Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
      Pragma: 'no-cache', 'Cache-Control': 'no-cache'
    } });
    ws.binaryType = 'arraybuffer';
    const audio = [], words = [];
    let done = false;
    const finish = (err) => { if (done) return; done = true; clearTimeout(timer); try { ws.close(); } catch (e) {} err ? reject(err) : resolve({ audio: Buffer.concat(audio), words }); };
    const timer = setTimeout(() => finish(new Error('timed out')), 30000);
    ws.onopen = () => {
      ws.send('X-Timestamp:' + stamp() + '\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n' +
        '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n');
      const ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='" + VOICE + "'>" +
                   "<prosody pitch='" + PITCH + "' rate='" + RATE + "' volume='+0%'>" + xml(spoken(text)) + '</prosody></voice></speak>';
      ws.send('X-RequestId:' + uid() + '\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:' + stamp() + 'Z\r\nPath:ssml\r\n\r\n' + ssml);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        const cut = ev.data.indexOf('\r\n\r\n');
        const head = ev.data.slice(0, cut), body = ev.data.slice(cut + 4);
        const p = (/Path:([^\r\n]+)/.exec(head) || [])[1];
        if (p === 'audio.metadata') {
          (JSON.parse(body).Metadata || []).forEach((m) => {
            if (m.Type === 'WordBoundary') words.push({ text: m.Data.text.Text, ms: Math.round(m.Data.Offset / 1e4), dur: Math.round(m.Data.Duration / 1e4) });
          });
        } else if (p === 'turn.end') finish();
        return;
      }
      const buf = Buffer.from(ev.data);
      const hl = buf.readUInt16BE(0);
      const head = buf.slice(2, 2 + hl).toString();
      if (/Path:audio/.test(head)) { const data = buf.slice(2 + hl); if (data.length) audio.push(data); }
    };
    ws.onerror = () => finish(new Error('connection refused'));
    ws.onclose = () => { if (!done) finish(audio.length ? null : new Error('closed before any audio')); };
  });
}

/* Each word of the BUBBLE takes the start of the first spoken word that begins
   it, matched on letters alone ("pentagons." ~ "pentagons", "Atleast" ~
   "at"+"least"); a word with no letters rides on the one before it. */
const key = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
function cues(text, heard) {
  const shown = String(text).trim().split(/\s+/);
  const out = [];
  let h = 0;
  for (let i = 0; i < shown.length; i++) {
    const want = key(shown[i]);
    if (!want) { out.push(out.length ? out[out.length - 1] : (heard[0] ? heard[0].ms : 0)); continue; }
    if (h >= heard.length) return null;
    const start = heard[h].ms;
    let got = '';
    while (h < heard.length && got.length < want.length) { got += key(heard[h].text); h++; }
    if (got !== want) return null;
    out.push(start);
  }
  return out;
}

(async () => {
  fs.mkdirSync(VO, { recursive: true });
  let timings = {};
  try { timings = JSON.parse(fs.readFileSync(TIMINGS, 'utf8')); } catch (e) { timings = {}; }
  // never the recording's own lines: those are cut from the take by split-vo.js
  const taken = new Set((() => {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'vo-timeline.json'), 'utf8'));
      return t.lines.map((l) => l.id).concat((t.derived || []).map((d) => d.id));
    } catch (e) { return []; }
  })());
  const todo = lines().filter((l) => l.text && !taken.has(l.id) && (only.length ? only.includes(l.id) : (ALL || !fs.existsSync(path.join(VO, l.id + '.mp3')))));
  console.log('voice ' + VOICE + ' (pitch ' + PITCH + ', rate ' + RATE + '), ' + todo.length + ' line' + (todo.length === 1 ? '' : 's'));
  let ok = 0, unsynced = [];
  for (const l of todo) {
    let res = null, err = null;
    for (let attempt = 0; attempt < 3 && !res; attempt++) {
      try { res = await speak(l.text); } catch (e) { err = e; await new Promise((r) => setTimeout(r, 800 * (attempt + 1))); }
    }
    if (!res || !res.audio.length) { console.log('  FAILED ' + l.id + ': ' + (err && err.message)); continue; }
    // at the take's level, in the game's formats
    fs.writeFileSync(TMP, res.audio);
    const lv = levelOf(TMP);
    let gain = lv.lufs == null ? 0 : TARGET - lv.lufs;
    if (lv.peak != null) gain = Math.min(gain, PEAK_DB - lv.peak);
    const af = 'volume=' + gain.toFixed(2) + 'dB';
    ff(['-i', TMP, '-af', af, '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', path.join(VO, l.id + '.mp3')]);
    ff(['-i', TMP, '-af', af, '-ac', '1', '-c:a', 'libvorbis', '-q:a', '1', path.join(VO, l.id + '.ogg')]);
    const c0 = cues(l.text, res.words);
    const c = c0 ? snapCues(c0, path.join(VO, l.id + '.ogg')) : null;
    if (c) timings[l.id] = c; else { delete timings[l.id]; unsynced.push(l.id); }
    ok++;
    console.log('  ' + l.id.padEnd(5) + ' ' + (c ? c.length + ' words' : 'NO WORD SYNC') + '  "' + l.text + '"');
    await new Promise((r) => setTimeout(r, 250));
  }
  const sorted = {};
  Object.keys(timings).sort().forEach((k) => { sorted[k] = timings[k]; });
  fs.writeFileSync(TIMINGS, JSON.stringify(sorted, null, 1) + '\n');
  try { fs.unlinkSync(TMP); } catch (e) {}
  console.log(ok + ' spoken' + (unsynced.length ? '; word sync missing for ' + unsynced.join(' ') : '') + '. Next: npm run build:vo');
})().catch((e) => { console.error(e); process.exit(1); });
