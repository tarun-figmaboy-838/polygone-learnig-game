#!/usr/bin/env node
/*!
 * encode-vo.js — make every voice clip small, and make it play everywhere.
 *
 *   node tools/encode-vo.js
 *
 * For each assets/vo/<id>.mp3 it writes assets/vo/<id>.ogg (Vorbis, mono,
 * 56 kbps — speech, not music) and re-encodes the mp3 to mono 64 kbps. Both
 * are kept on purpose: Chrome, Firefox and Android take the ogg, which is
 * about half the size, and Safari and iOS take the mp3, which they are the
 * only ones that need. src/audio/vo.js asks the browser which it can play
 * and requests that one, so nobody downloads the format they cannot use.
 *
 * Needs ffmpeg on PATH. Safe to run again: it always encodes from the mp3 it
 * finds, and a re-encode of an already small mp3 is a no-op in practice.
 */
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');

const VO = path.resolve(__dirname, '..', 'assets', 'vo');
if (!fs.existsSync(VO)) { console.error('no assets/vo'); process.exit(1); }

const ids = fs.readdirSync(VO).filter((f) => /\.mp3$/i.test(f)).map((f) => f.replace(/\.mp3$/i, '')).sort();
if (!ids.length) { console.log('no clips to encode'); process.exit(0); }

const size = (f) => { try { return fs.statSync(f).size; } catch (e) { return 0; } };
let before = 0, mp3After = 0, oggAfter = 0;

ids.forEach((id) => {
  const mp3 = path.join(VO, id + '.mp3');
  const ogg = path.join(VO, id + '.ogg');
  const tmp = path.join(VO, id + '.tmp.mp3');
  before += size(mp3);
  // one voice, one channel, and a bitrate that suits speech
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', mp3,
                          '-ac', '1', '-c:a', 'libvorbis', '-q:a', '1', ogg]);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', mp3,
                          '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', tmp]);
  if (size(tmp) && size(tmp) < size(mp3)) fs.renameSync(tmp, mp3); else fs.unlinkSync(tmp);
  mp3After += size(mp3); oggAfter += size(ogg);
});

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log(ids.length + ' clips');
console.log('  mp3 ' + kb(before) + ' -> ' + kb(mp3After));
console.log('  ogg ' + kb(oggAfter) + '  (what most browsers will fetch)');
execFileSync(process.execPath, [path.join(__dirname, 'build-vo-index.js')], { stdio: 'inherit' });
