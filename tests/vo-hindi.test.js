/*!
 * vo-hindi.test.js — the Hindi voice (?lan=hi) says the line on the screen, in step with its words.
 *
 *   node tests/vo-hindi.test.js
 *
 *   PART 1   Every clip in assets/vo/hi is a line the game asks for (an English VO id), has its
 *            mp3 and its Opus twin, a length, and one word onset per Hindi word the bubble shows
 *            for that line — the count game.js and Instruction.voice need before they step the
 *            words by the voice (a different count and the words fall back to a guess).
 *
 *   PART 2   The Hindi take's windows (game/js/vo-hi.js) are lines Frozen Rush says, in order and
 *            apart, inside the take, and each has one onset per Hindi word the plank or the
 *            tutorial shows (an em dash shares the onset of the word after it).
 *
 *   WHO SPEAKS   vo.js reads assets/vo/hi/ in Hindi, assets/vo/ in English, and nothing at all in
 *            a language with no recordings (Marathi); engine.js swaps in the Hindi take.
 *
 *   THE MAP  tools/vo-hindi.js names each recording once, and docs/vo-hindi.json was aligned
 *            against the Hindi words the game shows today (a re-worded line must be re-aligned).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const LESSON = path.join(__dirname, '..');
const REPO = path.join(LESSON, '..');
const DATA = JSON.parse(fs.readFileSync([path.join(LESSON, 'polygon-locales.json'), path.join(REPO, 'polygon-locales.json')].find((f) => fs.existsSync(f)), 'utf8'));
const HI_DIR = path.join(LESSON, 'assets', 'vo', 'hi');

let pass = 0, fail = 0;
const t = (label, cond, extra) => {
  if (cond) pass++;
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
};

global.window = global;
global.POLYGON_LOCALES = DATA;
const I18N = require('../src/core/i18n.js');
const HI = I18N.make('hi');
const words = (s) => String(s).replace(/<\/?strong>/g, '').trim().split(/\s+/).filter(Boolean);
/** What the screen shows for a line: the English line, turned as game.js turns it. */
const shown = (id) => HI.tr(String(DATA.en[id]).replace(/<\/?strong>/g, ''));

/* ---- PART 1 ---- */
const idx = JSON.parse(fs.readFileSync(path.join(HI_DIR, 'index.json'), 'utf8'));
const en = JSON.parse(fs.readFileSync(path.join(LESSON, 'assets', 'vo', 'index.json'), 'utf8'));
t('Part 1 has its Hindi clips', idx.clips.length >= 50, idx.clips.length);
const offDisk = fs.readFileSync(path.join(HI_DIR, 'index.js'), 'utf8');
t('the Hindi index is also a script, for a page opened off the disk', offDisk.indexOf(JSON.stringify(idx.clips)) > 0);
idx.clips.forEach((id) => {
  t(id + ': a line the game asks for', en.clips.indexOf(id) >= 0);
  t(id + ': mp3 and ogg', fs.existsSync(path.join(HI_DIR, id + '.mp3')) && fs.existsSync(path.join(HI_DIR, id + '.ogg')));
  t(id + ': measured', idx.seconds[id] > 0.4 && !!idx.rev[id], [idx.seconds[id], idx.rev[id]]);
  const text = shown(id), on = idx.words[id] || [];
  t(id + ': the screen shows Hindi', text !== DATA.en[id] && /[ऀ-ॿ]/.test(text), text);
  t(id + ': one onset per word shown ("' + text + '")', on.length === words(text).length, [on.length, words(text).length]);
  t(id + ': the onsets run forward, inside the clip', on.every((ms, i) => ms >= 0 && (!i || ms >= on[i - 1]) && ms < idx.seconds[id] * 1000), on);
  t(id + ': the first word is said at once (no long silence before it)', on[0] <= 400, on[0]);
  if (idx.spoken[id]) t(id + ': the last word starts before the speech ends', on[on.length - 1] < idx.spoken[id], [on[on.length - 1], idx.spoken[id]]);
});
// EVERY LINE IS VOICED: each line the lesson has an English clip and a Hindi text for has its Hindi
// clip too (a new line needs its recording — docs/VO-HINDI.md lists any that have none)
const unvoiced = en.clips.filter((id) => typeof DATA.en[id] === 'string' && typeof DATA.hi[id] === 'string' && idx.clips.indexOf(id) < 0);
t('every line the lesson says has its Hindi clip (docs/VO-HINDI.md)', unvoiced.length === 0, unvoiced);
// Swiftee's lines over Frozen Rush are said by the lesson's page (runner-stage.js), so they are Part 1's
['sw1', 'sw2', 'sw3'].forEach((id) => t(id + ' (over the game) is a Part 1 clip', idx.clips.indexOf(id) >= 0));

/* ---- PART 2 ---- (only beside Frozen Rush, in POLYGON-PART-1: this repository is the lesson on its own) */
const GAME = path.join(REPO, 'part2-frozen-rush', 'game');
if (fs.existsSync(path.join(GAME, 'js', 'vo-hi.js'))) {
const mod = fs.readFileSync(path.join(GAME, 'js', 'vo-hi.js'), 'utf8');
const VO_HI = vm.runInNewContext('(' + mod.slice(mod.indexOf('{', mod.indexOf('export const VO_HI'))).replace(/;\s*$/, '') + ')');
const engine = fs.readFileSync(path.join(GAME, 'js', 'engine.js'), 'utf8');
const lines = Object.keys(VO_HI.lines);
t('Part 2 plays the Hindi take', VO_HI.src === 'assets/audio/vo-lines-hi.mp3' && fs.existsSync(path.join(GAME, VO_HI.src)) && fs.existsSync(path.join(GAME, VO_HI.src.replace(/\.mp3$/, '.ogg'))));
t('Part 2 has its Hindi lines', lines.length >= 22, lines.length);
const versions = fs.readFileSync(path.join(GAME, 'js', 'asset-versions.js'), 'utf8');
t('the Hindi take is versioned (tools/build-bundle.mjs)', /"assets\/audio\/vo-lines-hi\.ogg": "[0-9a-f]{8}"/.test(versions));
t('no recording (.wav or .opus) is listed as a game asset', !/\.(wav|opus)"/.test(versions));
const bundle = fs.readFileSync(path.join(GAME, 'js', 'game.bundle.js'), 'utf8');
t('the bundle carries the Hindi take (tools/build-bundle.mjs)', bundle.indexOf(JSON.stringify(VO_HI.lines['p2-1-diagonal'])) > 0 || bundle.indexOf(JSON.stringify(VO_HI.lines['p2-1-diagonal']).replace(/,/g, ', ')) > 0);
let end = 0;
lines.forEach((id, i) => {
  const [at, dur, on] = VO_HI.lines[id];
  t(id + ': a line Frozen Rush says (its English window)', new RegExp("'" + id + "':\\s*\\[").test(engine));
  t(id + ': in order and apart from the line before', i ? at >= end + 0.3 : at >= 0, [at, end]);
  end = at + dur;
  if (typeof DATA.en[id] !== 'string') return;          // the cheer, which is shown nowhere
  const ws = words(DATA.hi[id]);
  t(id + ': one onset per word shown ("' + DATA.hi[id] + '")', on.length === ws.length, [on.length, ws.length]);
  t(id + ': the onsets run forward, inside the window', on.every((s, i) => s >= 0 && s < dur && (!i || (ws[i - 1] === '—' ? s >= on[i - 1] : s > on[i - 1]))), on);
});
t('the windows end inside the take', end < 200);
}

/* ---- WHO SPEAKS: vo.js ---- */
const voSrc = fs.readFileSync(path.join(LESSON, 'src', 'audio', 'vo.js'), 'utf8');
function voIn(lang) {
  const asked = [];
  const I = I18N.make(lang);
  const g = { I18N: I, location: { protocol: 'http:' }, document: { createElement: () => ({ canPlayType: () => 'probably' }) },
              fetch: (u) => { asked.push(u); return Promise.resolve({ ok: false }); }, console };
  g.window = g;
  vm.runInNewContext(voSrc, g);
  return asked;
}
t('English reads assets/vo/', JSON.stringify(voIn('en')) === '["assets/vo/index.json"]', voIn('en'));
t('Hindi reads assets/vo/hi/', JSON.stringify(voIn('hi')) === '["assets/vo/hi/index.json"]', voIn('hi'));
t('Marathi (no recordings) reads nothing', voIn('mr').length === 0, voIn('mr'));
if (fs.existsSync(path.join(GAME, 'js', 'engine.js'))) t('engine.js swaps in the Hindi take when the game speaks Hindi', /VO_TAKES\s*=\s*\{\s*hi:\s*VO_HI\s*\}/.test(engine) && /if \(VO_TAKE\) CFG\.vo = VO_TAKE;/.test(engine));

/* ---- THE MAP ---- */
const { recordings } = require('../tools/vo-hindi.js');
const ids = recordings.map((r) => r.id), files = recordings.map((r) => r.file);
t('each line is recorded once', new Set(ids).size === ids.length);
t('each recording is one line', new Set(files).size === files.length);
const aligned = JSON.parse(fs.readFileSync(path.join(LESSON, 'docs', 'vo-hindi.json'), 'utf8'));
recordings.forEach((r) => {
  const a = aligned.recordings.find((x) => x.id === r.id);
  t(r.id + ': aligned against the words the game shows now (node tools/build-vo-hindi.js --align)', a && a.text === String(DATA.hi[r.id]).replace(/<\/?strong>/g, '') && a.file === r.file);
});

console.log((fail ? 'FAILED' : 'ok') + '  vo-hindi: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
