#!/usr/bin/env node
/*!
 * vo-lines.js — every voice clip the game can ask for, with its words and
 * where it is said. The one list; everything else reads it.
 *
 *   node tools/vo-lines.js            print the list
 *   require('./vo-lines')()           [{ id, text, kind, where }]
 *
 * WHY IT IS SCRAPED AND NOT TYPED. docs/VO.md is the script a person reads
 * and it drifts: it lists sixty lines, the deck asks for sixty-one, and the
 * five feedback ids the stage added last were in the doc and in no list the
 * tools could see. The ids the GAME asks for are the only ones that matter,
 * and they are in the source — the storyboard's beats, and the two reaction
 * tables and the stage's reasons-for-a-wrong-answer. Reading them from there
 * cannot drift, because a line the game cannot reach is not in the list and a
 * line it can reach always is.
 *
 * Three places carry a clip id:
 *   src/game/screens.js   every beat with `vo:` — the narration and the
 *                         instructions, nested inside on/otherwise/feedback
 *   src/game/game.js      PRAISE and NUDGE, the answers to right and wrong
 *   src/game/stage.js     the reasons a particular try fell short
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function fromDeck() {
  const g = {};
  g.window = g;
  const sandbox = g;
  const src = fs.readFileSync(path.join(ROOT, 'src', 'game', 'screens.js'), 'utf8');
  // screens.js is a plain script over `window`; run it against a bare object
  new Function('window', 'global', src)(sandbox, sandbox);
  const Screens = sandbox.Screens;
  const out = [];
  Screens.list.forEach((s, i) => {
    const walk = (beats) => (beats || []).forEach((b) => {
      if (!b || typeof b !== 'object') return;
      if (b.vo) {
        const text = b.say != null ? b.say : (b.instruction != null ? b.instruction : '');
        out.push({ id: b.vo, text: String(text),
                   kind: b.say != null ? 'say' : 'instruction',
                   where: 'screen ' + (i + 1) + ' (' + s.id + ')' });
      }
      if (b.on) Object.keys(b.on).forEach((k) => walk(b.on[k]));
      if (b.otherwise) walk(b.otherwise);
      if (b.feedback) walk(b.feedback);
      if (b.parallel) walk(b.parallel);
    });
    walk(s.beats);
  });
  return out;
}

/* PRAISE, NUDGE and the stage's reasons are `{ t: '...', vo: '...' }` pairs
   written inline. Read as text: running game.js needs a document, and the
   pairs are a table, not logic. */
function fromPairs(file, where) {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'game', file), 'utf8');
  const out = [];
  const re = /\{\s*t:\s*'((?:[^'\\]|\\.)*)'\s*,\s*vo:\s*'([^']+)'\s*\}/g;
  let m;
  while ((m = re.exec(src))) {
    const text = m[1].replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
                     .replace(/\\'/g, '\u2019').replace(/\\\\/g, '\\');
    out.push({ id: m[2], text: text, kind: 'feedback', where: where });
  }
  return out;
}

function lines() {
  const all = fromDeck()
    .concat(fromPairs('game.js', 'said after an answer (game.js)'))
    .concat(fromPairs('stage.js', 'said when a try falls short (stage.js)'));
  // one row per id; keep the first place it is used and note the rest
  const byId = new Map();
  all.forEach((r) => {
    const seen = byId.get(r.id);
    if (!seen) { byId.set(r.id, Object.assign({}, r, { uses: 1 })); return; }
    seen.uses++;
    if (seen.where.indexOf(r.where) < 0 && seen.uses < 4) seen.where += '; ' + r.where;
  });
  return [...byId.values()];
}

module.exports = lines;

if (require.main === module) {
  const rows = lines();
  const idx = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'vo', 'index.json'), 'utf8')); }
    catch (e) { return { clips: [], seconds: {} }; }
  })();
  const have = new Set(idx.clips);
  console.log(rows.length + ' clips the game can ask for\n');
  rows.forEach((r) => {
    const mark = have.has(r.id) ? 'have' : ' -- ';
    console.log('  [' + mark + '] ' + r.id.padEnd(5) + ' ' + r.kind.padEnd(11) + ' "' + r.text + '"');
    console.log('           ' + r.where);
  });
  const missing = rows.filter((r) => !have.has(r.id));
  console.log('\n' + (rows.length - missing.length) + ' recorded, ' + missing.length + ' still silent');
  if (missing.length) console.log('silent: ' + missing.map((r) => r.id).join(' '));
}
