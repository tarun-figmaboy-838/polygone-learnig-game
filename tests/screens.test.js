/*!
 * test-screens.js — the storyboard as data, checked against the deck.
 *
 *   node tests/screens.test.js
 *
 * Three groups:
 *
 *   STRUCTURAL   ids and VO ids unique; every line a screen claims to say is
 *                actually said in its beats; every judged screen has a wrong
 *                path; no wrong path contains words; no "your turn" screen
 *                ships the answer as a ghost; the definition on page 13 says
 *                vertices, not sides.
 *
 *   CARD         The instruction card is simulated through all 39 screens.
 *                The deck drops the card on pages 16, 18, 20, 22, 24, 27 and
 *                32b, and a build that only ever *sets* the card would leave
 *                the previous one showing. This walks the whole lesson and
 *                asserts the card matches the deck on every screen.
 *
 *   VOCABULARY   Nothing in the data references a Swiftee state, interaction
 *                type, stage kind, SFX cue or juice effect that the handlers
 *                do not implement. That is the contract between screens.js
 *                and everything downstream, and it is cheap to check.
 */
'use strict';

global.window = global;
require('../src/core/polygon-math.js');
const Screens = require('../src/game/screens.js');
require('../src/character/swiftee-frames.js');   // swiftee.js reads the frame table at load
const Stage = require('../src/game/stage.js');   // for shapeVerts: the shapes are content

let pass = 0, fail = 0;
const t = (label, cond, extra) => {
  if (cond) pass++;
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
};

const S = Screens.list;

/** Every beat in a screen, feedback and branch arms flattened in. */
function allBeats(screen) {
  const out = [];
  (function walk(list) {
    (list || []).forEach((b) => {
      if (!b || typeof b !== 'object') return;
      out.push(b);
      if (b.feedback) walk(b.feedback);
      if (b.parallel) walk(b.parallel);
      if (b.on) Object.keys(b.on).forEach((k) => walk(b.on[k]));
      if (b.otherwise) walk(b.otherwise);
    });
  })(screen.beats);
  return out;
}

/** Only the beats a wrong answer can reach. */
function wrongBeats(screen) {
  const out = [];
  (function walk(list) {
    (list || []).forEach((b) => {
      if (!b || typeof b !== 'object') return;
      if (b.on && b.on.wrong) collect(b.on.wrong);
      if (b.otherwise) collect(b.otherwise);
      if (b.feedback) walk(b.feedback);
      if (b.parallel) walk(b.parallel);
      if (b.on) Object.keys(b.on).forEach((k) => { if (k !== 'wrong') walk(b.on[k]); });
    });
  })(screen.beats);
  function collect(list) {
    (list || []).forEach((b) => {
      if (!b || typeof b !== 'object') return;
      out.push(b);
      if (b.feedback) collect(b.feedback);
      if (b.parallel) collect(b.parallel);
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Structural
 * ------------------------------------------------------------------ */

t('there are 39 screens', S.length === 39, S.length);

const ids = S.map((s) => s.id);
t('every screen id is unique', new Set(ids).size === ids.length,
  ids.filter((v, i) => ids.indexOf(v) !== i));
t('every screen has a page number', S.every((s) => typeof s.page === 'number'));
t('pages never go backwards', S.every((s, i) => i === 0 || s.page >= S[i - 1].page),
  S.filter((s, i) => i > 0 && s.page < S[i - 1].page).map((s) => s.id));

const vos = [];
S.forEach((s) => allBeats(s).forEach((b) => { if (b.vo) vos.push(b.vo); }));
t('every VO id is unique', new Set(vos).size === vos.length,
  vos.filter((v, i) => vos.indexOf(v) !== i));
t('every spoken line carries a VO id',
  S.every((s) => allBeats(s).every((b) => b.say == null || !!b.vo)),
  S.filter((s) => allBeats(s).some((b) => b.say != null && !b.vo)).map((s) => s.id));

t('a screen that claims a line actually says it in its beats',
  S.every((s) => !s.say || allBeats(s).some((b) => b.say === s.say)),
  S.filter((s) => s.say && !allBeats(s).some((b) => b.say === s.say)).map((s) => s.id));

t('no beat says a line the screen does not declare',
  S.every((s) => allBeats(s).every((b) => b.say == null || b.say === s.say)),
  S.filter((s) => allBeats(s).some((b) => b.say != null && b.say !== s.say)).map((s) => s.id));

t('the VO script covers every speaking screen',
  Screens.voScript().length === S.filter((s) => s.say).length);
t('every line in the VO script has an id', Screens.voScript().every((l) => !!l.vo),
  Screens.voScript().filter((l) => !l.vo).map((l) => l.id));

/* --- the deck's own errors, as corrected ------------------------- */

const p13 = Screens.byId['define-diagonal'];
t('page 13 exists', !!p13);
t('the definition of a diagonal says VERTICES, not sides',
  /vertices/i.test(p13.say) && !/non-adjacent sides/i.test(p13.say), p13.say);
t('the original wording is kept beside the correction, not discarded',
  typeof p13.original === 'string' && /sides/i.test(p13.original), p13.original);

const p15 = Screens.byId['hexagon-your-turn'];
t('page 15 exists', !!p15);
t('the "your turn" screen ships no ghost answers',
  !allBeats(p15).some((b) => b.stage && b.stage.ghost), allBeats(p15).filter((b) => b.stage && b.stage.ghost));

t('Screens.flags() reports every deviation from the deck', Screens.flags().length >= 8, Screens.flags().length);
t('flags name the answer leak', Screens.flags().some((f) => f.kind === 'answer-leak'));
t('flags name the page 15 sequence break', Screens.flags().some((f) => f.kind === 'sequence'));
t('the watermarked reference page is marked do-not-ship',
  Screens.flags().some((f) => f.kind === 'do-not-ship'));
t('pages 34 and 36 are declared as not-screens',
  !!Screens.notScreens[34] && !!Screens.notScreens[36]);
t('no screen claims page 34 or 36', !S.some((s) => s.page === 34 || s.page === 36));

/* --- wrong answers are encouraging and wordless ------------------ */

/**
 * Only some interactions can return a verdict of "wrong". The rest cannot be
 * answered incorrectly by construction and it would be wrong to demand a
 * wrong path from them:
 *
 *   vertex-pick   any vertex is a valid pick; the lesson continues from it
 *   drag-vertex   completes when the shape reaches a state (concave,
 *                 irregular); an incomplete drag is not an error, it is an
 *                 unfinished gesture, and the clamp keeps it legal throughout
 *   tap-each      each target reveals its own measurement; there is nothing
 *                 to get wrong
 *   stepper       counts to a target; over-stepping just steps back
 *   swipe         left or right; the wrong side keeps the same shape
 *
 * Splitting them is the point: a build that quietly dropped the wrong path
 * from `choice` would otherwise hide behind these.
 */
const JUDGING = ['drag-endpoint', 'draw-diagonal', 'draw-diagonals', 'choice', 'multi-select', 'sort', 'swipe'];
const OPEN = ['vertex-pick', 'drag-vertex', 'tap-each', 'stepper', 'tap-anywhere'];

const inputsOf = (s) => allBeats(s).filter((b) => b.input).map((b) => b.input.type);
const judged = S.filter((s) => inputsOf(s).some((ty) => JUDGING.indexOf(ty) >= 0));

t('there are judged screens to check', judged.length >= 8, judged.length);
t('every interaction is either judging or open, with nothing unclassified',
  S.every((s) => inputsOf(s).every((ty) => JUDGING.indexOf(ty) >= 0 || OPEN.indexOf(ty) >= 0)),
  S.flatMap(inputsOf).filter((ty) => JUDGING.indexOf(ty) < 0 && OPEN.indexOf(ty) < 0));
t('no open interaction ships a wrong path it can never reach',
  S.filter((s) => inputsOf(s).length && inputsOf(s).every((ty) => OPEN.indexOf(ty) >= 0))
   .every((s) => wrongBeats(s).length === 0),
  S.filter((s) => inputsOf(s).length && inputsOf(s).every((ty) => OPEN.indexOf(ty) >= 0) && wrongBeats(s).length).map((s) => s.id));

t('every judged screen offers a wrong path',
  judged.every((s) => wrongBeats(s).length > 0 || (s.perTap && s.perTap.wrong)),
  judged.filter((s) => wrongBeats(s).length === 0 && !(s.perTap && s.perTap.wrong)).map((s) => s.id));

const verbalWrong = [];
S.forEach((s) => {
  wrongBeats(s).forEach((b) => { if (b.say != null || b.instruction != null) verbalWrong.push(s.id); });
  if (s.perTap && s.perTap.wrong) {
    s.perTap.wrong.forEach((b) => { if (b.say != null || b.instruction != null) verbalWrong.push(s.id + ':perTap'); });
  }
});
t('no wrong path ever contains words — the deck has no wrong-answer copy and the build must not invent any',
  verbalWrong.length === 0, [...new Set(verbalWrong)]);

t('every wrong path still reacts — Swiftee, a cue, or an effect',
  S.every((s) => {
    const w = wrongBeats(s).concat((s.perTap && s.perTap.wrong) || []);
    return w.length === 0 || w.some((b) => b.swiftee || b.sfx || b.juice || b.stage);
  }));

t('every wrong path re-opens the input or is judged per tap',
  judged.every((s) => {
    if (s.perTap && s.perTap.wrong) return true;
    return wrongBeats(s).some((b) => b.input);
  }),
  judged.filter((s) => !(s.perTap && s.perTap.wrong) && !wrongBeats(s).some((b) => b.input)).map((s) => s.id));

/* ------------------------------------------------------------------ *
 * The instruction card, simulated through all 39 screens
 * ------------------------------------------------------------------ */

{
  let card = null;                       // what a real build would be showing
  const mismatches = [];
  S.forEach((s) => {
    allBeats(s).forEach((b) => { if ('instruction' in b) card = b.instruction; });
    const want = s.instruction === undefined ? card : s.instruction;
    if (card !== want) mismatches.push({ page: s.page, id: s.id, showing: card, deck: want });
  });
  t('the instruction card matches the deck on every one of the 39 screens',
    mismatches.length === 0, mismatches.slice(0, 4));
}

{
  // The six screens the deck drops the card on must clear it EXPLICITLY.
  // Setting-only is the bug this guards; it would leave "Drag the vertex
  // inward" on screen through "Whoa!".
  const clearing = ['look-diagonals', 'lets-change', 'whoa', 'all-inside', 'one-outside', 'sort-convex-concave'];
  const missing = clearing.filter((id) => {
    const s = Screens.byId[id];
    return !s || !allBeats(s).some((b) => 'instruction' in b && b.instruction === null);
  });
  t('the screens that drop the card clear it explicitly', missing.length === 0, missing);
}

/* ------------------------------------------------------------------ *
 * Vocabulary — nothing references a capability that does not exist
 * ------------------------------------------------------------------ */

// Read off the renderer rather than kept as a list here. A hand-kept copy
// only answers 'is it on the list', and it drifted: the rig has implemented
// 'excited' since the sprite sheets landed, and a storyboard beat that used
// it failed a test whose message said it was not implemented.
const SWIFTEE = require('../src/character/swiftee.js').states;
const INPUTS = ['tap-anywhere', 'vertex-pick', 'drag-endpoint', 'draw-diagonal', 'draw-diagonals',
                'drag-vertex', 'choice', 'multi-select', 'tap-each', 'sort', 'stepper', 'swipe'];
const KINDS = ['vista', 'polygon', 'choice-grid', 'compare', 'sort', 'builder', 'swipe-sort'];
const SFX = ['boing', 'correct', 'honk', 'levelUp', 'menuWhoosh', 'pop', 'select', 'slice',
             'slideWhistle', 'sparkle', 'tick', 'wrong', 'zip', 'drumroll'];
const JUICE = ['celebrate', 'collect', 'confetti', 'pop', 'refuse', 'wobble', 'flash', 'squash', 'tada'];

const used = { swiftee: new Set(), input: new Set(), kind: new Set(), sfx: new Set(), juice: new Set() };
S.forEach((s) => {
  const beats = allBeats(s).concat(
    Object.keys(s.perTap || {}).reduce((a, k) => a.concat(s.perTap[k] || []), [])
  );
  beats.forEach((b) => {
    if (b.swiftee) used.swiftee.add(b.swiftee);
    if (b.input && b.input.type) used.input.add(b.input.type);
    if (b.stage && b.stage.kind) used.kind.add(b.stage.kind);
    if (b.sfx) used.sfx.add(b.sfx);
    if (b.juice) used.juice.add(b.juice);
  });
  if (s.stage && s.stage.kind) used.kind.add(s.stage.kind);
});

const unknown = (set, allowed) => [...set].filter((v) => allowed.indexOf(v) < 0);
t('every Swiftee state referenced is implemented', unknown(used.swiftee, SWIFTEE).length === 0, unknown(used.swiftee, SWIFTEE));
t('every interaction type referenced is implemented', unknown(used.input, INPUTS).length === 0, unknown(used.input, INPUTS));
t('every stage kind referenced is implemented', unknown(used.kind, KINDS).length === 0, unknown(used.kind, KINDS));
t('every SFX cue referenced exists', unknown(used.sfx, SFX).length === 0, unknown(used.sfx, SFX));
t('every juice effect referenced exists', unknown(used.juice, JUICE).length === 0, unknown(used.juice, JUICE));

/* ------------------------------------------------------------------ *
 * The swipe practice teaches five different facts
 *
 * The eight shapes are the page's whole content: four regular, four not,
 * dealt turn about. The one that matters most is the rhombus — equal sides,
 * unequal angles — because equal sides alone do not make a polygon regular;
 * and at least one irregular shape has neither, so both ways of failing are
 * shown. That is invisible in a playthrough, because both answers
 * are IRREGULAR and the screen passes either way. It is only visible from
 * the geometry, which is why it is checked here.
 * ------------------------------------------------------------------ */
{
  const sw = S.filter((s) => s.stage && s.stage.kind === 'swipe-sort')[0];
  t('the swipe practice exists', !!sw);
  if (sw) {
    const items = sw.stage.items || [];
    t('it runs eight rounds: four regular, four not', items.length === 8, items.length);
    t('it asks the deck\x27s own question',
      sw.say === 'Where does this polygon belong?', sw.say);

    const verts = items.map((n) => Stage.shapeVerts(n, 74, 0, 0));
    const got = verts.map((v) => (Poly.isRegular(v) ? 'regular' : 'irregular'));
    t('the answers alternate, so no single answer rides the round',
      got.join(',') === 'regular,irregular,regular,irregular,regular,irregular,regular,irregular', got.join(','));

    // the properties the deck exists to separate
    t('every regular one is equilateral AND equiangular',
      [0, 2, 4, 6].every((i) => Poly.isEquilateral(verts[i]) && Poly.isEquiangular(verts[i])));
    t('the rhombus has EQUAL sides and unequal angles — the point of the page',
      Poly.isEquilateral(verts[1]) && !Poly.isEquiangular(verts[1]));
    t('at least one irregular shape is NEITHER equilateral nor equiangular',
      [1, 3, 5, 7].some((i) => !Poly.isEquilateral(verts[i]) && !Poly.isEquiangular(verts[i])));
    t('every shape is a simple polygon', verts.every((v) => Poly.isSimple(v)));
  }
}

t('all 12 interaction types are actually used somewhere', used.input.size === 12, [...used.input]);
t('all 7 stage kinds are actually used somewhere', used.kind.size === 7, [...used.kind]);

/* ------------------------------------------------------------------ *
 * Shape of every screen
 * ------------------------------------------------------------------ */

t('every screen has at least one beat', S.every((s) => Array.isArray(s.beats) && s.beats.length > 0));
t('every screen ends reachable — it has an input, or it is a pure transition',
  S.every((s, i) => i === S.length - 1 || allBeats(s).some((b) => b.input) || s.beats.length <= 6),
  S.filter((s, i) => i !== S.length - 1 && !allBeats(s).some((b) => b.input) && s.beats.length > 6).map((s) => s.id));

t('no beat is empty', S.every((s) => allBeats(s).every((b) => Object.keys(b).length > 0)));

t('every branch has at least one arm',
  S.every((s) => allBeats(s).every((b) => !b.branch || (b.on && Object.keys(b.on).length) || b.otherwise)));

t('every perTap bucket is a list of beats',
  S.every((s) => !s.perTap || Object.keys(s.perTap).every((k) => Array.isArray(s.perTap[k]))));

/* Kept in step with the map in game.js layout(). A position the screens use
   and the layout does not know silently falls back to left-low, which is how
   a screen can ask for a corner and get the middle of the left edge. */
const POSITIONS = ['left', 'left-low', 'right-low', 'top-left', 'left-mid', 'centre', 'peek', 'corner', 'off'];

t('Swiftee positions are ones the layout knows',
  S.every((s) => !s.swiftee || POSITIONS.indexOf(s.swiftee.pos) >= 0),
  S.filter((s) => s.swiftee && POSITIONS.indexOf(s.swiftee.pos) < 0).map((s) => s.id));

t('Swiftee sizes are ones the layout knows',
  S.every((s) => !s.swiftee || ['tiny', 'small', 'medium', 'large'].indexOf(s.swiftee.size) >= 0));

t('every move beat names a position the layout knows',
  S.every((s) => allBeats(s).every((b) =>
    b.swiftee !== 'move' || POSITIONS.indexOf(b.to) >= 0)));

console.log('\nscreens: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
