#!/usr/bin/env node
/*!
 * export-used-sprites.js — copy out the sheets the game actually plays.
 *
 *   node tools/export-used-sprites.js
 *
 * assets/swiftee/spritesheets/ holds every animation the rig was exported
 * with, and the lesson plays about two thirds of them. Re-costuming the
 * character means finding those, and finding them in a flat folder of a
 * hundred and twenty-five files named after rig states means knowing which
 * rig state is which semantic state — which is a lookup nobody should have to
 * do by hand.
 *
 * So this writes swiftee-in-use/, one folder per state the lesson drives,
 * named for what the state MEANS rather than what the rig calls it, holding
 * the @1x and @2x sheets for that state's start, loop and stop. Redraw what
 * is in there and nothing else, and the game is fully re-costumed.
 *
 * It copies rather than moves, and writes nowhere the game reads from, so
 * running it can never break anything. Re-run it after adding a state.
 */
'use strict';

const fs = require('fs');
const path = require('path');

global.window = global;
const ROOT = path.join(__dirname, '..');
const F = require(path.join(ROOT, 'src/character/swiftee-frames.js'));
const S = require(path.join(ROOT, 'src/character/swiftee.js'));

const OUT = path.join(ROOT, 'swiftee-in-use');

/* What each state is for, in the lesson's terms. The renderer knows which rig
   animation to play; only this file knows why. */
const WHY = {
  idle:        'resting — the pose he holds between everything else',
  explain:     'narration and definitions',
  think:       'a question, or working something out',
  inspect:     'examining a shape closely',
  look:        'looking at the lesson',
  point:       'showing where to do something',
  wave:        'the greeting, screen one',
  nod:         'confirming — "yes, go on"',
  celebrate:   'a correct answer. Awaited, so it gates every right answer',
  encourage:   'after a wrong answer; warm, never a telling-off',
  confused:    'the wrong answer itself — puzzled WITH the child',
  surprised:   '"Whoa!" — the diagonal going outside',
  mischief:    '"Let us make a change"',
  'step-back': 'stepping aside to give the child room',
  proud:       'held in reserve',
  excited:     'the finale, the biggest reaction in the game',
  happy:       'pleased — a right answer that has already been scored',
  daydream:    'the long idle, after thirty seconds of nothing',
  sleep:       'the longer idle, after seventy-five',
  enter:       'the arrival — he flies in from off-stage and lands',
  exit:        'leaving',
  move:        'travelling between marks'
};

const STANDALONE_WHY = {
  wake:  'leaving the sleep pose',
  reset: 'a hard neutral reset'
};

function copy(rel, intoDir) {
  const from = path.join(ROOT, F.base, rel);
  if (!fs.existsSync(from)) return null;
  const to = path.join(intoDir, path.basename(rel));
  fs.copyFileSync(from, to);
  return path.basename(rel);
}

/** Every sheet of a clip, at both scales. */
function sheetsOf(name) {
  const c = F.clips[name];
  if (!c) return [];
  const out = [];
  ['1x', '2x'].forEach((scale) => {
    (c.sheets[scale] || []).forEach((p) => { if (out.indexOf(p.image) < 0) out.push(p.image); });
  });
  return out;
}

/**
 * A rig state ships as start -> loop -> stop, and all three are played.
 *
 * The three are NOT named off a common stem — celebrate_start and
 * celebrate_stop bracket a loop called celebrating — so the triad has to come
 * from the frame table's own states map rather than from string arithmetic.
 * Guessing the names silently exported the loop alone and left the start and
 * stop behind, which is exactly the pair that keeps expressions from jumping.
 */
function clipsFor(rig) {
  const s = F.states[rig];
  const names = s ? [s.start, s.loop, s.stop] : [rig];
  return names.filter((n) => n && F.clips[n]);
}

function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const index = [];
  let files = 0, frames = 0;
  let n = 0;

  Object.keys(S.rig).forEach((state) => {
    const rig = S.rig[state].rig;
    const clips = clipsFor(rig);
    if (!clips.length) return;

    n++;
    const dir = path.join(OUT, String(n).padStart(2, '0') + '-' + state);
    fs.mkdirSync(dir, { recursive: true });

    const lines = [];
    clips.forEach((clip) => {
      const c = F.clips[clip];
      frames += c.frames;
      const copied = sheetsOf(clip).map((rel) => copy(rel, dir)).filter(Boolean);
      files += copied.length;
      lines.push('  ' + clip.padEnd(24) + String(c.frames).padStart(3) + ' frames   ' + copied.join('  '));
    });

    fs.writeFileSync(path.join(dir, '_what-this-is.txt'),
      state.toUpperCase() + '\n' +
      (WHY[state] || '') + '\n\n' +
      'rig state: ' + rig + '\n\n' +
      lines.join('\n') + '\n\n' +
      'Redraw start, loop and stop together — all three are played, and cutting\n' +
      'between loops skips the transition the animator drew.\n');

    index.push(path.basename(dir).padEnd(18) + 'rig: ' + rig.padEnd(14) + (WHY[state] || ''));
  });

  // the two the game plays outside any state
  const extra = path.join(OUT, String(++n).padStart(2, '0') + '-standalone');
  fs.mkdirSync(extra, { recursive: true });
  const extraLines = [];
  ['wake', 'reset'].forEach((clip) => {
    if (!F.clips[clip]) return;
    frames += F.clips[clip].frames;
    const copied = sheetsOf(clip).map((rel) => copy(rel, extra)).filter(Boolean);
    files += copied.length;
    extraLines.push('  ' + clip.padEnd(24) + String(F.clips[clip].frames).padStart(3) + ' frames   ' + copied.join('  '));
  });
  fs.writeFileSync(path.join(extra, '_what-this-is.txt'),
    'STANDALONE\n' + Object.keys(STANDALONE_WHY).map((k) => k + ' — ' + STANDALONE_WHY[k]).join('\n') +
    '\n\n' + extraLines.join('\n') + '\n');
  index.push(path.basename(extra).padEnd(18) + 'rig: —             wake and a hard reset');

  fs.writeFileSync(path.join(OUT, 'READ-ME-FIRST.txt'),
`SWIFTEE — THE ANIMATIONS THIS GAME PLAYS
================================================================
${files} sheet files, ${frames} frames, ${index.length} folders.

One folder per state the lesson drives, named for what the state MEANS.
Each holds that state's start, loop and stop sheets at @1x and @2x, plus a
note saying what it is for. Redraw what is in here and nothing else, and
the character is fully re-costumed — the rest of assets/swiftee/ is never
played.

FOUR RULES THAT MUST HOLD, or expressions will jump when they swap:

  1. one uniform cell         512px @2x, 256px @1x
  2. pivot at the exact cell centre
  3. feet on the baseline     87.7% down the cell
  4. 20 fps

'enter' IS the intro. He flies in on the flapping loop and lands; there is
no separate arrival art, so redrawing flapping redraws the opening of the
game.

WHEN YOU HAVE REDRAWN SOMETHING
  1. put the new sheet back over the original in
     assets/swiftee/spritesheets/<scale>/ — same filename
  2. run:  node tools/build-swiftee-frames.js
     it regenerates the frame table and FAILS if the art and the manifest
     disagree, so a wrong grid cannot reach the game
  3. run:  npm test

THIS FOLDER IS A COPY. Nothing reads from it, so you cannot break the game
by editing it — and re-running this tool will overwrite whatever is here.

${index.join('\n')}
`);

  console.log('swiftee-in-use/  ' + index.length + ' folders, ' + files + ' files, ' + frames + ' frames');
  console.log('start at swiftee-in-use/READ-ME-FIRST.txt');
}

main();
