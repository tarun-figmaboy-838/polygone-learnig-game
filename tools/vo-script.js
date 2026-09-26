#!/usr/bin/env node
/*!
 * vo-script.js — the voice-over script, written from the storyboard.
 *
 *   node tools/vo-script.js        writes docs/VO.md and docs/vo-lines.csv
 *
 * Every line the game can say, IN THE ORDER A CHILD MEETS IT, with the file
 * the game looks for, how the bubble splits it, when it is heard, and how it
 * should sound. It is generated, not typed, because the typed one drifted: it
 * still had "What if we connect it to a different vertex." with a full stop,
 * "vertices" where the deck says "sides", and "Your turn!" as a line of its
 * own. The storyboard is the script; this only prints it.
 *
 * To voice the game: record (or generate) each line, save it as
 * assets/vo/<id>.mp3, and run `npm run build:vo`. The game then plays each
 * clip as its words appear and paces the bubbles by the recording; a clip
 * that is not there yet is simply silent.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const lines = require('./vo-lines');

function deck() {
  const g = {}; g.window = g;
  const src = fs.readFileSync(path.join(ROOT, 'src', 'game', 'screens.js'), 'utf8');
  new Function('window', 'global', src)(g, g);
  return g.Screens;
}

/* Where each id is first heard, and in which arm of the screen. */
function contexts(Screens) {
  const at = new Map();
  Screens.list.forEach((s, i) => {
    const walk = (beats, arm) => (beats || []).forEach((b) => {
      if (!b || typeof b !== 'object') return;
      if (b.vo && !at.has(b.vo)) at.set(b.vo, { screen: i + 1, id: s.id, page: s.page, arm: arm, parts: b.parts || null });
      if (b.on) Object.keys(b.on).forEach((k) => walk(b.on[k], k === 'correct' ? 'right' : k));
      if (b.otherwise) walk(b.otherwise, 'wrong');
      if (b.feedback) walk(b.feedback, 'after');
      if (b.parallel) walk(b.parallel, arm);
    });
    walk(s.beats, 'open');
    const r = s.remind, seen = r && r.vo && at.get(r.vo);
    if (r && r.vo && !seen) at.set(r.vo, { screen: i + 1, screens: [i + 1], id: s.id, page: s.page, arm: 'remind', after: r.after || 1, parts: null });
    else if (seen && seen.arm === 'remind') seen.screens.push(i + 1);
  });
  return at;
}

function when(r, c) {
  if (r.kind === 'feedback') {
    if (/^fb0[1-6]$/.test(r.id)) return 'the first right answer on a screen (rotates)';
    if (/^fb(0[7-9]|10)$/.test(r.id)) return 'a wrong answer (rotates, at most every 3 s)';
    return 'a try that falls short, with the reason';
  }
  if (!c) return '';
  if (c.arm === 'right') return 'screen ' + c.screen + ', after the right answer';
  if (c.arm === 'wrong') return 'screen ' + c.screen + ', after a wrong answer';
  if (c.arm === 'after') return 'screen ' + c.screen + ', after the task';
  if (c.arm === 'remind') return (c.screens.length > 1 ? 'screens ' + c.screens.join(' and ') : 'screen ' + c.screen) + ', from the ' + (c.after > 1 ? 'second' : 'first') + ' wrong answer on';
  return 'screen ' + c.screen + (r.kind === 'instruction' ? ', the instruction' : '');
}

function delivery(r) {
  const t = r.text;
  if (r.kind === 'instruction') return 'an instruction: plain, steady, every word clear';
  if (r.kind === 'feedback' && /^fb(0[7-9]|1\d)$/.test(r.id)) return 'gentle and encouraging, never disappointed';
  if (r.kind === 'reminder') return 'a gentle reminder: warm, clear, never disappointed';
  if (/^Hi\b/.test(t)) return 'arriving, friendly';
  if (/^(Pick|Drag|Tap|Draw|Set|Adjust)\b/.test(t)) return 'friendly, clear';
  if (/^Whoa/.test(t)) return 'surprised, amazed';
  if (/^(Yay|Great|Nice|Yes|Well done|You got it|That’s it)/.test(t)) return 'a cheer, delighted';
  if (/^(Hmm|Remember|What if)/.test(t)) return 'wondering aloud, a little slower';
  if (/^(Let’s|Your turn|Help me|Can you)/.test(t)) return 'playful, inviting';
  if (/\?\s*$/.test(t)) return 'asking: curious, open';
  return 'explaining, warm and clear';
}

const Screens = deck();
const ctx = contexts(Screens);
const rows = lines();
const have = (() => { try { return new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'vo', 'index.json'), 'utf8')).clips || []); } catch (e) { return new Set(); } })();

const esc = (s) => String(s).replace(/\|/g, '\\|');
let md = '';
md += '# Voice-over script — Swiftee & the Polygons\n\n';
md += '_Generated from the storyboard by `node tools/vo-script.js`; do not edit by hand._\n\n';
md += 'Every line Swiftee says, **in the order a child hears it**, with the file the game plays. ';
md += 'Save each clip as `assets/vo/<id>.mp3`, then run `npm run build:vo`: the game plays it as the words appear and paces the bubbles by the recording. ';
md += 'A clip that is not there yet is silent, so they can be added a few at a time.\n\n';
md += '**Voice:** Swiftee, a small, warm, playful teal bird talking to a seven-year-old. Clear, unhurried and smiling, never shouty. Lines end with a smile, not a drop.\n\n';
md += '**Files:** mono MP3, 44.1 kHz, 128 kbps or better, about −16 LUFS, no more than 0.2 s of silence at either end. Aim for about 0.4 s per word plus 0.4 s.\n\n';
md += '**Breaths:** record every line as ONE clip, read naturally, with a short breath at each `/` in the Breaths column. On screen each sentence is one bubble; the breaths are where the words pause inside it.\n\n';
const lesson = rows.filter((r) => r.kind !== 'feedback');
const fb = rows.filter((r) => r.kind === 'feedback');
md += '## Lesson lines (' + lesson.length + '), in timeline order\n\n';
md += '| # | Screen | Screen id | File | Type | Line | Breaths | When | Delivery | Recorded |\n';
md += '|---|--------|-----------|------|------|------|---------|------|----------|----------|\n';
lesson.forEach((r, k) => {
  const c = ctx.get(r.id) || {};
  md += '| ' + (k + 1) + ' | ' + (c.screen || '') + ' | ' + (c.id || '') + ' | `assets/vo/' + r.id + '.mp3` | ' + r.kind + ' | ' + esc(r.text) + ' | ' +
        (c.parts ? esc(c.parts.join(' / ')) : '') + ' | ' + when(r, c) + ' | ' + delivery(r) + ' | ' + (have.has(r.id) ? 'yes' : '—') + ' |\n';
});
md += '\n## Answers (' + fb.length + '), said when the child answers\n\n';
md += '| File | Line | When | Delivery | Recorded |\n|------|------|------|----------|----------|\n';
fb.forEach((r) => {
  md += '| `assets/vo/' + r.id + '.mp3` | ' + esc(r.text) + ' | ' + when(r, null) + ' | ' + delivery(r) + ' | ' + (have.has(r.id) ? 'yes' : '—') + ' |\n';
});
md += '\n## Not recorded\n\nThe score between the two finale lines ("<XP> XP and <badges> badges.") is the child’s own, so it is shown and not voiced.\n';

fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'VO.md'), md);
const q = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
const csv = ['order,id,file,kind,screen,screen_id,text,breaths,when,delivery'].concat(rows.map((r, k) => {
  const c = ctx.get(r.id) || {};
  return [k + 1, r.id, 'assets/vo/' + r.id + '.mp3', r.kind, c.screen || '', c.id || '', q(r.text), q(c.parts ? c.parts.join(' / ') : ''), q(when(r, r.kind === 'feedback' ? null : c)), q(delivery(r))].join(',');
})).join('\n') + '\n';
fs.writeFileSync(path.join(ROOT, 'docs', 'vo-lines.csv'), csv);
console.log('docs/VO.md and docs/vo-lines.csv written — ' + lesson.length + ' lesson lines, ' + fb.length + ' answers');
