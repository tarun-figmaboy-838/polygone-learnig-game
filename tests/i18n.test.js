/*!
 * i18n.test.js — the game in every language it ships in (?lan=hi, mr, te, gu, od).
 *
 *   node tests/i18n.test.js
 *
 *   COPIES       polygon-locales.json is copied into the scripts both halves load, and the
 *                lesson's src/core/i18n.js into Frozen Rush (tools/build-locales.js): every
 *                copy matches its source, so a translation edited and not rebuilt is a red test.
 *
 *   EVERY WORD   Every line, instruction, part, label, answer and badge the lesson's screens
 *                can show, the lines game.js and runner-stage.js write themselves, Frozen Rush's
 *                questions, hints and tutorial — each one has a translation in every language,
 *                and a translated line keeps its line's bubble breaks and its key word.
 *
 *   THE WORDS THE SCENES WAIT FOR   A name tag, an answer, a bin arrives on its word
 *                (stage.js holdForWord, in English). In every language the line that names it
 *                says a word that stands for that English word (I18N.cues), or the thing would
 *                wait for the end of the line instead of arriving with its word.
 *
 *   ENGLISH      With no ?lan= nothing is touched: tr() hands back what it was given.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const LESSON = path.join(__dirname, '..');
const REPO = path.join(LESSON, '..');
const DATA = JSON.parse(fs.readFileSync([path.join(LESSON, 'polygon-locales.json'), path.join(REPO, 'polygon-locales.json')].find((f) => fs.existsSync(f)), 'utf8'));
const LANGS = ['hi', 'mr', 'te', 'gu', 'od'];

let pass = 0, fail = 0;
const t = (label, cond, extra) => {
  if (cond) pass++;
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
};

/* ---- COPIES ---- */
const { outputs } = require('../tools/build-locales.js');
for (const [file, text] of outputs()) {
  const now = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  t('up to date: ' + path.relative(REPO, file) + ' (node part1-swiftee-lesson/tools/build-locales.js)', now === text);
}

/* ---- the module, as a page with no ?lan= loads it ---- */
global.window = global;
global.POLYGON_LOCALES = DATA;
const I18N = require('../src/core/i18n.js');
t('no ?lan= is English', I18N.lang === 'en' && I18N.on === false && I18N.voice === true);
const EN = I18N.make('en');
['Select any vertex.', 'Inside', '6 cm', 'Hello there', ''].forEach((s) => t('English is untouched: ' + JSON.stringify(s), EN.tr(s) === s && EN.html(s) === s));
t('English cues are the word itself', JSON.stringify(EN.cues('Inside')) === '["Inside"]');
t('English links are untouched', EN.keep('x.html?a=1') === 'x.html?a=1');
t('an unknown language is English', I18N.make('xx').lang === 'en' && I18N.make('or').lang === 'od');

/* ---- EVERY WORD: what the lesson's screens can show ---- */
require('../src/core/polygon-math.js');
const Screens = require('../src/game/screens.js');
const SHOWN = new Set(), PARTED = [], NUMBERED = [];
const SKIP_KEYS = new Set(['id', 'vo', 'cue', 'what', 'original', 'originalInstruction', 'correct', 'tone', 'kind', 'type', 'face', 'react',
  'sfx', 'enter', 'panel', 'at', 'pos', 'size', 'if', 'made', 'captionCue', 'word', 'lit', 'show', 'pulse', 'focus', 'glow', 'outsideOn', 'pace', 'endsAt', 'under', 'purpose']);
(function walk(v, key) {
  if (v == null) return;
  if (typeof v === 'string') {
    if (SKIP_KEYS.has(key) || !/[A-Za-z]{2,}/.test(v)) return;
    if (['say', 'instruction', 'text', 'label', 'caption', 'merge', 'left', 'right', 'choices', 'parts', 'remind'].includes(key)) SHOWN.add(v);
    return;
  }
  if (Array.isArray(v)) { v.forEach((x) => walk(x, key)); return; }
  if (typeof v !== 'object') return;
  if (typeof v.say === 'string' && Array.isArray(v.parts)) PARTED.push([v.say, v.parts]);
  if (v.alt && typeof v.alt.say === 'string' && Array.isArray(v.alt.parts)) PARTED.push([v.alt.say, v.alt.parts]);
  if (typeof v.say === 'string' && Array.isArray(v.shows)) NUMBERED.push([v.say, v.shows]);
  if (typeof v.say === 'string' && v.show && typeof v.on === 'number') NUMBERED.push([v.say, [{ what: v.show, on: v.on }]]);
  Object.keys(v).forEach((k) => walk(v[k], k));
}(Screens.list, ''));
// the lines game.js, quest.js and the opening write themselves
const src = (f) => fs.readFileSync(path.join(LESSON, f), 'utf8');
const unq = (s) => s.replace(/\\u2019/g, '’').replace(/\\u2026/g, '…').replace(/\\'/g, "'");
[...src('src/game/game.js').matchAll(/\{ t: '((?:[^'\\]|\\.)+)'/g)].forEach((m) => SHOWN.add(unq(m[1])));
if (fs.existsSync(path.join(LESSON, 'src/opening/runner-stage.js')))   // the opening (POLYGON-PART-1 only)
  [...src('src/opening/runner-stage.js').matchAll(/\{ t: '((?:[^'\\]|\\.)+)'/g)].forEach((m) => SHOWN.add(unq(m[1])));
[...src('src/game/quest.js').matchAll(/name: '((?:[^'\\]|\\.)+)'/g)].forEach((m) => SHOWN.add(unq(m[1])));
['Concave', 'Convex', 'INSIDE', 'OUTSIDE', '6 cm', '4.9 cm'].forEach((s) => SHOWN.add(s));
t('the screens were read (lines, labels and answers found)', SHOWN.size > 120, SHOWN.size);

/* Frozen Rush: its questions and nudges (engine.js), its tutorial (tutorial.js) — when it is beside
   the lesson (POLYGON-PART-1); this repository is the lesson on its own, so these lists stay empty */
const P2 = path.join(REPO, 'part2-frozen-rush', 'game', 'js');
const HAS_P2 = fs.existsSync(path.join(P2, 'engine.js'));
const engine = HAS_P2 ? fs.readFileSync(path.join(P2, 'engine.js'), 'utf8') : '', tut = HAS_P2 ? fs.readFileSync(path.join(P2, 'tutorial.js'), 'utf8') : '';
const QUESTIONS = [...engine.matchAll(/instruction: '((?:[^'\\]|\\.)+)'/g)].map((m) => unq(m[1]));
const n0 = engine.indexOf('instructions: {'), NUDGES = n0 < 0 ? [] : [...engine.slice(n0, engine.indexOf('}', n0)).matchAll(/: (?:'((?:[^'\\]|\\.)+)'|"([^"]+)")/g)].map((m) => unq(m[1] || m[2]));
const TUTORIAL = [...tut.matchAll(/text: '((?:[^'\\]|\\.)+)'/g)].map((m) => unq(m[1]));
if (HAS_P2) t('Frozen Rush was read', QUESTIONS.length === 9 && NUDGES.length === 5 && TUTORIAL.length >= 8, { q: QUESTIONS.length, n: NUDGES.length, t: TUTORIAL.length });

for (const lang of LANGS) {
  const I = I18N.make(lang);
  // (Hindi has its own recordings — tests/vo-hindi.test.js — and the rest have none)
  t(lang + ': chosen', I.lang === lang && I.on && I.voice === (lang === 'hi') && !!I.font);
  const untranslated = [...SHOWN].filter((s) => I.tr(s) === s);
  t(lang + ': every line, label and answer of the lesson is translated', untranslated.length === 0, untranslated.slice(0, 6));
  t(lang + ': nothing reached tr() without a translation', I.misses.length === 0, I.misses.slice(0, 6));
  PARTED.forEach(([say, parts]) => {
    const tp = I.trParts(say, parts);
    t(lang + ': the bubble breaks of "' + say + '"', tp && tp.length === parts.length && tp.join(' ') === I.tr(say), tp);
  });
  // each `show` on a word finds that word in the translation (the same key word, not a guess)
  NUMBERED.forEach(([say, shows]) => {
    const en = say.split(/\s+/), tw = I.tr(say).split(/\s+/);
    shows.forEach((sh) => {
      const want = en[sh.on] && EN.cues(en[sh.on])[0].toLowerCase().replace(/[^a-z]/g, '');
      if (!/^(side|sides|angle|angles|vertex|diagonal|diagonals|inside|outside)$/.test(want || '')) return;
      const i = I.wordIndex(say, I.tr(say), sh.on);
      t(lang + ': "' + want + '" of "' + say + '" is found again', I.cues(tw[i]).some((c) => c.toLowerCase() === want || c.toLowerCase() + 's' === want || c.toLowerCase() === want + 's'), tw[i]);
    });
  });
  // Frozen Rush: every question and nudge, the key word marked wherever the English one is
  QUESTIONS.concat(NUDGES).concat(TUTORIAL).forEach((s) => t(lang + ': Frozen Rush "' + s + '"', I.tr(s) !== s, I.tr(s)));
  QUESTIONS.forEach((s) => {
    const keyed = /\bthe\s/i.test(s);
    t(lang + ': the key word of "' + s + '" is marked', /<strong>[^<]+<\/strong>/.test(I.html(s)) === keyed, I.html(s));
  });
  // and the tutorial leans on a word in every sentence the English does
  if (HAS_P2) t(lang + ': the tutorial accent words', DATA[lang].tutKeyWords.length >= 6 && TUTORIAL.every((s) => {
    const sentences = I.tr(s).match(/[^.!?।]+[.!?।]*/g) || [];
    return sentences.length >= 1;
  }));
  t(lang + ': links keep the language', I.keep('../part2-frozen-rush/game/index.html?resume=1') === '../part2-frozen-rush/game/index.html?resume=1&lan=' + lang);
  t(lang + ': a reading in centimetres', /^6\s\S+$/.test(I.tr('6 cm')) && I.tr('6 cm') !== '6 cm');
  t(lang + ': numbers and degrees are left alone', I.tr('108°') === '108°' && I.tr('5') === '5');
}

/* ---- THE WORDS THE SCENES WAIT FOR ----
   (the line, and the English word its scene waits for — stage.js holdForWord / onWord) */
const WAITS = [
  ['This is a side of the polygon.', 'side'],
  ['Yay! You made a diagonal!', 'diagonal'],
  ['Your turn! Let’s draw all the diagonals from this vertex.', 'vertex'],
  ['Are the diagonals inside or outside?', 'inside'], ['Are the diagonals inside or outside?', 'outside'],
  ['The diagonals are inside.', 'diagonals'], ['The diagonals are inside.', 'inside'],
  ['Help me pull this vertex inside.', 'vertex'],
  ['Let’s compare the diagonals in both the pentagons.', 'pentagons'],
  ['This one has all the diagonals inside.', 'inside'],
  ['But this one has atleast one diagonal outside.', 'outside'],
  ['All diagonals inside means convex polygon.', 'convex'],
  ['Atleast one diagonal outside means concave polygon.', 'concave'],
  ['Can you sort these polygons as convex or concave?', 'convex'], ['Can you sort these polygons as convex or concave?', 'concave'],
  ['Are the sides and angles still equal?', 'still'], ['Are the sides and angles still equal?', 'equal'],
  ['The sides and angles changed, so they are not equal.', 'equal'],
  ['All the sides and angles are equal in this pentagon.', 'sides'], ['All the sides and angles are equal in this pentagon.', 'angles'],
  ['But this pentagon has unequal sides and unequal angles.', 'sides'], ['But this pentagon has unequal sides and unequal angles.', 'angles'],
  ['All sides and angles equal means a regular polygon. Sides and angles unequal means an irregular polygon.', 'regular'],
  ['All sides and angles equal means a regular polygon. Sides and angles unequal means an irregular polygon.', 'irregular']
];
for (const lang of LANGS) {
  const I = I18N.make(lang);
  WAITS.forEach(([line, word]) => {
    const said = I.tr(line).split(/\s+/).some((w) => I.cues(w).indexOf(word) >= 0);
    t(lang + ': "' + word + '" is said in "' + I.tr(line) + '"', said);
  });
  // the regular / irregular rule waits for the SECOND "sides" of its line
  const fb58 = I.tr(WAITS[WAITS.length - 1][0]).split(/\s+/).filter((w) => I.cues(w).indexOf('sides') >= 0);
  t(lang + ': the second "sides" of the regular / irregular rule', fb58.length >= 2, fb58);
  // and the bubble's key words are found word by word
  t(lang + ': key words are found (dual-coding.js)', I.termOf(I.tr('Select any vertex.').split(/\s+/).find((w) => I.termOf(w))) === 'vertex');
}

console.log('i18n: ' + SHOWN.size + ' lesson texts, ' + PARTED.length + ' broken lines, ' + NUMBERED.length + ' lines with a word cue, ' + (QUESTIONS.length + NUDGES.length + TUTORIAL.length) + ' Frozen Rush texts, in ' + LANGS.length + ' languages');
console.log('i18n: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
