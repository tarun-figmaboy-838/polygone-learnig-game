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
 * Four places carry a clip id:
 *   src/story/story-data.js  the story before the lesson: narrator, Momo, Popo
 *   src/game/screens.js   every beat with `vo:` — the narration and the
 *                         instructions, nested inside on/otherwise/feedback
 *   src/game/game.js      PRAISE and NUDGE, the answers to right and wrong
 *   src/game/stage.js     the reasons a particular try fell short
 *   src/opening/runner-stage.js  Swiftee's lines over Frozen Rush, at the broken path and the ditch
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
      // a line's alternative, chosen by what is on screen (director `alt`)
      if (b.alt && b.alt.vo) walk([b.alt]);
    });
    walk(s.beats);
    // the shape taught up close after a second miss (screens.js `teach`)
    if (s.teach) Object.keys(s.teach).forEach((k) => walk(s.teach[k]));
    // a reminder after a miss (game.js replyFor) carries its own clip id
    if (s.remind && s.remind.vo) {
      out.push({ id: s.remind.vo, text: String(s.remind.say), kind: 'reminder',
                 where: 'screen ' + (i + 1) + ' (' + s.id + '), after a wrong answer' });
    }
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

/* THE STORY BEFORE THE LESSON (src/story/story-data.js): its lines, each with who says
   it — the narrator, Momo or Popo, who are not Swiftee and do not speak in his voice
   (tools/make-vo.js STORY). Run the same way as the deck: a plain script over window. */
function fromStory() {
  const g = {};
  // (the story is kept outside the repository, in POLYGON-1/story-draft (its README says how to bring it back) — the user: "remove the story part and add on draft" —
  // and while it is, the game says none of its lines)
  const file = path.join(ROOT, 'src', 'story', 'story-data.js');
  if (!fs.existsSync(file)) return [];
  const src = fs.readFileSync(file, 'utf8');
  new Function('window', src)(g);
  const out = [];
  ((g.StoryData && g.StoryData.scenes) || []).forEach((s, i) => {
    (s.lines || []).forEach((l) => {
      if (!l.vo) return;
      out.push({ id: l.vo, text: String(l.text), kind: 'story', speaker: l.who,
                 where: 'story scene ' + (i + 1) + ', ' + l.who });
    });
  });
  return out;
}

function lines() {
  const all = fromStory()
    .concat(fromDeck())
    .concat(fromPairs('game.js', 'said after an answer (game.js)'))
    .concat(fromPairs('stage.js', 'said when a try falls short (stage.js)'))
    // Swiftee over Frozen Rush, before the lesson and after it (the game-lesson kit)
    .concat(fromPairs('../opening/runner-stage.js', 'said by Swiftee over Frozen Rush (src/opening/runner-stage.js)'));
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
