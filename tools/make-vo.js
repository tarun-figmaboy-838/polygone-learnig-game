#!/usr/bin/env node
/*!
 * make-vo.js — Swiftee's voice, generated, with the moment of every word.
 *
 *   node tools/make-vo.js                 every line that has no clip yet
 *   node tools/make-vo.js --all           every line, again
 *   node tools/make-vo.js p21 p22         just these
 *   options: --voice en-US-AvaNeural --pitch +6% --rate -20%
 *
 *   then:    npm run vo:encode && npm run build:vo
 *
 * Every line the game can say (tools/vo-lines.js — the storyboard, the
 * answers, the reasons, the reminders) is spoken by one natural neural voice
 * from Microsoft Edge's read-aloud service and saved as assets/vo/<id>.mp3.
 * The service reports when each word begins (its WordBoundary events), and
 * those times are written to assets/vo/word-timings.json against the words
 * the BUBBLE shows — so each word appears as it is said, not on a clock of
 * its own. build-vo-index.js folds them into index.json for the game.
 *
 * THE VOICE. Swiftee is a small, curious, clever bird talking to a
 * seven-year-old: a natural female voice, young and warm, clear and a little
 * bright — not a baby voice and not a narrator. Ava is the most natural and
 * expressive of the en-US voices; a touch of lift and an easy, unhurried pace
 * make her Swiftee. Any Edge voice can be tried with --voice.
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
const VOICE = arg('voice', 'en-US-AvaNeural');
const PITCH = arg('pitch', '+6%');
// -20%: about 130-135 words a minute, an unhurried classroom pace (at the
// service's own pace she spoke nearly 200 a minute — the user: "make sure vo
// not look very fast to hear")
const RATE = arg('rate', '-20%');
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
  const todo = lines().filter((l) => l.text && (only.length ? only.includes(l.id) : (ALL || !fs.existsSync(path.join(VO, l.id + '.mp3')))));
  console.log('voice ' + VOICE + ' (pitch ' + PITCH + ', rate ' + RATE + '), ' + todo.length + ' line' + (todo.length === 1 ? '' : 's'));
  let ok = 0, unsynced = [];
  for (const l of todo) {
    let res = null, err = null;
    for (let attempt = 0; attempt < 3 && !res; attempt++) {
      try { res = await speak(l.text); } catch (e) { err = e; await new Promise((r) => setTimeout(r, 800 * (attempt + 1))); }
    }
    if (!res || !res.audio.length) { console.log('  FAILED ' + l.id + ': ' + (err && err.message)); continue; }
    fs.writeFileSync(path.join(VO, l.id + '.mp3'), res.audio);
    const c = cues(l.text, res.words);
    if (c) timings[l.id] = c; else { delete timings[l.id]; unsynced.push(l.id); }
    ok++;
    console.log('  ' + l.id.padEnd(5) + ' ' + (c ? c.length + ' words' : 'NO WORD SYNC') + '  "' + l.text + '"');
    await new Promise((r) => setTimeout(r, 250));
  }
  const sorted = {};
  Object.keys(timings).sort().forEach((k) => { sorted[k] = timings[k]; });
  fs.writeFileSync(TIMINGS, JSON.stringify(sorted, null, 1) + '\n');
  console.log(ok + ' spoken' + (unsynced.length ? '; word sync missing for ' + unsynced.join(' ') : '') + '. Next: npm run vo:encode && npm run build:vo');
})().catch((e) => { console.error(e); process.exit(1); });
