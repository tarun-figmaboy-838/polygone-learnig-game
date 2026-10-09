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
 *   CARD         The instruction card is simulated through all 31 screens.
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

// 31: the diagonal chapter's six demonstration screens (pages 7–12) are one
// screen now, where the child connects the corner and finds out; and the
// four builder screens that ended the lesson are one end-game summary.
t('there are 31 screens', S.length === 31, S.length);

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

// A screen declares its own line in `say` and any further ones in `lines`
// (the second-diagonal screen ends with "All diagonals are still inside.").
const declared = (s, text) => text === s.say || (s.lines || []).indexOf(text) >= 0;
t('no beat says a line the screen does not declare',
  S.every((s) => allBeats(s).every((b) => b.say == null || declared(s, b.say))),
  S.filter((s) => allBeats(s).some((b) => b.say != null && !declared(s, b.say))).map((s) => s.id));

t('every line a screen declares in `lines` is said in its beats',
  S.every((s) => (s.lines || []).every((l) => allBeats(s).some((b) => b.say === l))),
  S.filter((s) => (s.lines || []).some((l) => !allBeats(s).some((b) => b.say === l))).map((s) => s.id));

t('the VO script covers every speaking screen, and each reminder of its own once',
  Screens.voScript().length === S.filter((s) => s.say).length + S.reduce((n, s) => n + (s.lines || []).length, 0) +
    new Set(S.filter((s) => s.remind && !S.some((p) => allBeats(p).some((b) => b.vo === s.remind.vo))).map((s) => s.remind.vo)).size);
t('every line in the VO script has an id', Screens.voScript().every((l) => !!l.vo),
  Screens.voScript().filter((l) => !l.vo).map((l) => l.id));

/* --- the deck's own errors, as corrected ------------------------- */

const p13 = Screens.byId['define-diagonal'];
t('page 13 exists', !!p13);
/* THE DEFINITION LINE, AND WHY THIS GATE CHANGED SIDES.
 *
 * This used to assert the opposite: that the line says VERTICES, because a
 * diagonal joins two non-adjacent vertices and this screen draws one doing
 * exactly that. The author has since supplied "sides" twice in writing, with
 * "do not modify my dialogue wording", so the deck says sides and this guards
 * the supplied wording instead of the mathematics.
 *
 * The gate is kept rather than deleted so the line cannot drift again without
 * somebody choosing to, and the objection is kept in screens.js beside the
 * line itself. "vertices" remains the correct word. */
// 2026-09-25: the author asked for "vertices" — the correct word — in place of
// the "sides" they had supplied before. The gate now holds that wording.
t('the definition line says what a diagonal joins: two non-adjacent VERTICES (the author, 2026-09-25)',
  /non-adjacent vertices is a diagonal/i.test(p13.say) && !/non-adjacent sides/i.test(p13.say), p13.say);
t('the definition line is split where the script splits it',
  (p13.beats.filter((b) => b && b.parts)[0] || {}).parts + '' ===
  ['A line segment joining', 'two non-adjacent vertices', 'is a diagonal.'] + '',
  (p13.beats.filter((b) => b && b.parts)[0] || {}).parts);

const p15 = Screens.byId['hexagon-your-turn'];
t('page 15 exists', !!p15);
t('the "your turn" screen ships no ghost answers',
  !allBeats(p15).some((b) => b.stage && b.stage.ghost), allBeats(p15).filter((b) => b.stage && b.stage.ghost));
// (the user: "remove the Hexagon name tag … do not replace it with another shape-name tag")
t('the hexagon card carries no name tag', ![p15.stage].concat(allBeats(p15).map((b) => b.stage)).some((sg) => sg && sg.label && sg.label.text),
  [p15.stage].concat(allBeats(p15).map((b) => b.stage)).filter((sg) => sg && sg.label));
// (and a line to a neighbour there is a side, its end disabled — never a wrong answer: stage.js sidesOk)
t('the hexagon takes a side on the way to its diagonals', allBeats(p15).some((b) => b.input && b.input.type === 'draw-diagonals' && b.input.sidesOk === true));

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
 *   swipe         left or right; the wrong side keeps the same shape
 *
 * Splitting them is the point: a build that quietly dropped the wrong path
 * from `choice` would otherwise hide behind these.
 */
const JUDGING = ['draw-diagonal', 'draw-diagonals', 'choice', 'multi-select', 'sort', 'swipe'];
// (summary-review: the summary looked back at — tap a card to hear it again, Next to go on; nothing to get wrong)
const OPEN = ['vertex-pick', 'drag-vertex', 'tap-each', 'tap-anywhere', 'summary-review'];

const inputsOf = (s) => allBeats(s).filter((b) => b.input).map((b) => b.input.type);
const judged = S.filter((s) => inputsOf(s).some((ty) => JUDGING.indexOf(ty) >= 0));

t('there are judged screens to check', judged.length >= 8, judged.length);
t('every interaction is either judging or open, with nothing unclassified',
  S.every((s) => inputsOf(s).every((ty) => JUDGING.indexOf(ty) >= 0 || OPEN.indexOf(ty) >= 0)),
  S.flatMap(inputsOf).filter((ty) => JUDGING.indexOf(ty) < 0 && OPEN.indexOf(ty) < 0));
// (a drag whose tries are counted — `attempts`, the user's two-attempt teach on screen 21 — DOES
// reach its wrong path: a corner let go short of the answer ends the try)
const counted = (s) => allBeats(s).some((b) => b.input && b.input.attempts);
t('no open interaction ships a wrong path it can never reach',
  S.filter((s) => inputsOf(s).length && inputsOf(s).every((ty) => OPEN.indexOf(ty) >= 0) && !counted(s))
   .every((s) => wrongBeats(s).length === 0),
  S.filter((s) => inputsOf(s).length && inputsOf(s).every((ty) => OPEN.indexOf(ty) >= 0) && !counted(s) && wrongBeats(s).length).map((s) => s.id));

t('every judged screen offers a wrong path',
  judged.every((s) => wrongBeats(s).length > 0 || (s.perTap && s.perTap.wrong)),
  judged.filter((s) => wrongBeats(s).length === 0 && !(s.perTap && s.perTap.wrong)).map((s) => s.id));

// (except the explanations the user asked for on a two-attempt screen, each declared in the
// screen's `lines`, and the task shown again after one)
const verbalWrong = [];
S.forEach((s) => {
  const declared = (s.lines || []).concat(s.instruction ? [s.instruction] : []);
  wrongBeats(s).forEach((b) => { if ((b.say != null && declared.indexOf(b.say) < 0) || (b.instruction != null && declared.indexOf(b.instruction) < 0)) verbalWrong.push(s.id); });
  if (s.perTap && s.perTap.wrong) {
    s.perTap.wrong.forEach((b) => { if (b.say != null || b.instruction != null) verbalWrong.push(s.id + ':perTap'); });
  }
});
t('no wrong path ever contains words — the deck has no wrong-answer copy and the build must not invent any',
  verbalWrong.length === 0, [...new Set(verbalWrong)]);

/* A REMINDER AFTER A MISS is the one place a wrong answer is followed by
   words. Either it is a line the lesson has already said on an earlier
   screen, in that line's own recording, or it is the author's own reminder
   copy with a clip id of its own that no other line uses — and then it is
   in the VO script, so it gets recorded. */
{
  const bad = [];
  const script = Screens.voScript();
  S.forEach((s, i) => {
    if (!s.remind) return;
    const earlier = S.slice(0, i).some((p) => allBeats(p).some((b) => b.say === s.remind.say && b.vo === s.remind.vo));
    const own = !!s.remind.vo && !S.some((p) => allBeats(p).some((b) => b.vo === s.remind.vo)) &&
                script.some((l) => l.vo === s.remind.vo && l.text === s.remind.say);
    if (!earlier && !own) bad.push(s.id);
  });
  t('a reminder is a line already taught in its own voice, or its own line in the VO script', bad.length === 0, bad);
  // (the user's Level 1 bug list: the FIRST miss on a card is met at once with "Not quite." and
  // what is true of that shape — game.js CLUES, by the card's `reason` — and the card is put
  // out after it; the child is not made to miss twice before the explanation comes)
  {
    const wp = Screens.byId['which-polygons'];
    const input = allBeats(wp).map((b) => b.input).filter((x) => x && x.type === 'multi-select')[0] || {};
    const wrongs = wp.stage.options.filter((o) => !o.correct);
    const gameSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'game', 'game.js'), 'utf8');
    const clueOf = (r) => (new RegExp(r + ":\\s*\\{ t: '([^']+)'")).exec(gameSrc);
    t('Level 1 explains a miss at once: "Not quite." and why that shape is not a polygon; the card is out after the second',
      !wp.remind && input.outAfter === 2 && wrongs.length > 0 &&
      wrongs.every((o) => o.reason && clueOf(o.reason) && /^Not quite\. /.test(clueOf(o.reason)[1])),
      wrongs.map((o) => o.reason + ': ' + ((clueOf(o.reason) || [])[1])));
    t('Level 1 cheers "Keep going!" on the way and "Great job!" only when the level is complete',
      !!input.cheer && input.cheer.more === 'keepGoing' && input.cheer.last === 'levelDone' &&
      /keepGoing:\s*\{ t: 'Keep going!'/.test(gameSrc) && /levelDone:\s*\{ t: 'Great job!'/.test(gameSrc));
  }
  const diag = ['another-diagonal', 'hexagon-your-turn'].map((id) => Screens.byId[id].remind || {});
  t('both screens where the child draws diagonals say what a diagonal is, from the first miss',
    diag.every((r) => r.say === 'A diagonal connects non-adjacent vertices.' && r.after === 1 && r.vo === 'p14r'), diag);
  // the wrong cards of the first question each carry their own clue
  const opts = (Screens.byId['which-polygons'].stage.options || []).filter((o) => !o.correct);
  t('each wrong card of the first question names its own clue', opts.length === 2 && opts.every((o) => !!o.reason), opts);
}

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
 * The instruction card, simulated through all 31 screens
 * ------------------------------------------------------------------ */

{
  let card = null;                       // what a real build would be showing
  const mismatches = [];
  S.forEach((s) => {
    // THE CARD THE CHILD IS WORKING TO is the one up when they are first
    // handed control; after the last beat it is what the next screen
    // inherits. (The connect screen takes its card down for the cheer at the
    // end — the deck's "Let’s connect it to another vertex." is what it asks.)
    let asked;
    allBeats(s).forEach((b) => {
      if ('instruction' in b) card = b.instruction;
      if (b.input && asked === undefined) asked = card;
    });
    const shown = asked === undefined ? card : asked;
    const want = s.instruction === undefined ? shown : s.instruction;
    if (shown !== want) mismatches.push({ page: s.page, id: s.id, showing: shown, deck: want });
  });
  t('the instruction card matches the deck on every one of the 31 screens',
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
// (summary-review is the game's own, not the stage's: game.js reviewSummary)
const INPUTS = ['tap-anywhere', 'vertex-pick', 'draw-diagonal', 'draw-diagonals',
                'drag-vertex', 'choice', 'multi-select', 'tap-each', 'sort', 'swipe', 'summary-review'];
const KINDS = ['vista', 'polygon', 'choice-grid', 'compare', 'sort', 'swipe-sort', 'summary'];
const SFX = ['boing', 'correct', 'honk', 'levelUp', 'menuWhoosh', 'pop', 'select', 'slice',
             'slideWhistle', 'sparkle', 'tick', 'wrong', 'zip', 'drumroll'];
const JUICE = ['celebrate', 'collect', 'confetti', 'pop', 'refuse', 'wobble', 'buzz', 'flash'];

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

// 11: the drag-a-side's-end interaction (the old page 11) is gone — the child
// now draws the diagonal from their own corner
// 10: and the builder's stepper went with the builder
// 11: the summary's review (tap a card to replay it, Next to go on) — the final pass
t('all 11 interaction types are actually used somewhere', used.input.size === INPUTS.length, [...used.input]);
t('all 7 stage kinds are actually used somewhere', used.kind.size === 7, [...used.kind]);

/* ------------------------------------------------------------------ *
 * The end-game summary: every idea, in order, shown truly
 *
 * The last screen recaps the lesson one card at a time. What each card shows
 * is the evidence for its word, and that is invisible in a playthrough — a
 * card animates whatever it is given — so it is checked from the geometry.
 * ------------------------------------------------------------------ */
{
  const sm = Screens.byId.summary;
  t('the summary ends the lesson', !!sm && S[S.length - 1] === sm);
  if (sm) {
    const want = ['vertex', 'side', 'angle', 'diagonal', 'convex', 'concave', 'regular', 'irregular'];
    const cs = (sm.stage && sm.stage.concepts) || [];
    t('it recaps the eight ideas in the order they were taught', cs.map((c) => c.id).join(',') === want.join(','), cs.map((c) => c.id));
    const lines = {
      vertex: 'A vertex is a corner where two sides meet.', side: 'A side is a straight line joining two vertices.',
      angle: 'An angle is formed where two sides meet.', diagonal: 'A diagonal joins two non-adjacent vertices.',
      convex: 'In a convex polygon, all diagonals stay inside.', concave: 'In a concave polygon, atleast one diagonal goes outside.',
      regular: 'A regular polygon has all sides and all angles equal.', irregular: 'If the sides or angles are not all equal, the polygon is irregular.'
    };
    const beats = sm.beats;
    const at = (pred) => beats.findIndex(pred);
    const orderOk = want.every((id) => {
      const card = at((b) => b.stage && b.stage.summary && b.stage.summary.card === id);
      const up = beats.findIndex((b, i) => i > card && b.swiftee === 'enter' && b.from === 'below');
      const line = at((b) => b.say === lines[id]);
      const down = beats.findIndex((b, i) => i > line && b.swiftee === 'exit' && b.to === 'below');
      const collect = at((b) => b.stage && b.stage.summary && b.stage.summary.collect === id);
      return card >= 0 && card < up && up < line && line < down && down < collect;
    });
    t('every card: in and shown, he rises, says it, sinks, and it is collected — in that order', orderOk);
    t('every recap line is the supplied wording', want.every((id) => beats.some((b) => b.say === lines[id] && b.pace === 'recap')));
    const nextStarts = want.slice(1).every((id, k) => at((b) => b.stage && b.stage.summary && b.stage.summary.collect === want[k]) <
                                                       at((b) => b.stage && b.stage.summary && b.stage.summary.card === id));
    t('a card only comes in once the one before it has been collected', nextStarts);
    const fin = at((b) => b.stage && b.stage.summary && b.stage.summary.final);
    const last = at((b) => b.stage && b.stage.summary && b.stage.summary.collect === 'irregular');
    // (ends on the review: Next, and a tap on any card to hear it again — the final pass)
    const endIn = beats[beats.length - 1].input;
    t('the finale comes after the last card is collected, and ends on Next', fin > last && endIn && endIn.type === 'summary-review' && (endIn.cards || []).length === want.length && endIn.cards.every((c) => c.say === lines[c.id] && !!c.vo));
    t('the completion line is said at the finale', beats.some((b, i) => i > fin && b.say === 'Amazing! You explored all these polygon ideas!'));

    const G = (id) => Stage.summaryGeometry(id);
    const n = 5, adj = (i, j) => Math.abs(i - j) === 1 || Math.abs(i - j) === n - 1;
    t('the side card draws a SIDE: two neighbouring corners', !!G('side').line && adj(G('side').line[0], G('side').line[1]));
    t('the diagonal card draws a DIAGONAL: two corners that are not neighbours', !!G('diagonal').line && !adj(G('diagonal').line[0], G('diagonal').line[1]));
    t('the angle card lights the two sides that meet at its corner', G('angle').sides.every((q) => q[0] === G('angle').wedge && adj(q[0], q[1])));
    t('the vertex card lights one corner', G('vertex').hi.length === 1);
    const cv = G('convex').end;
    t('the convex card is convex, and every diagonal it draws is inside', Poly.classify(cv).convex && Poly.allDiagonals(n).every((d) => Poly.isDiagonalInside(cv, d[0], d[1])));
    const cc = G('concave');
    t('the concave card starts convex and its corner moves in until it is concave', Poly.classify(cc.start).convex && Poly.classify(cc.end).concave);
    t('...and the diagonal it draws is OUTSIDE the dented shape', !Poly.isDiagonalInside(cc.end, cc.line[0], cc.line[1]));
    t('...and INSIDE the shape before the dent (so it is drawn only after)', Poly.isDiagonalInside(cc.start, cc.line[0], cc.line[1]));
    t('the regular card is regular', Poly.isRegular(G('regular').end));
    const ir = G('irregular');
    t('the irregular card starts regular and ends irregular, sides unequal, still not concave',
      Poly.isRegular(ir.start) && !Poly.isRegular(ir.end) && !Poly.isEquilateral(ir.end) && Poly.classify(ir.end).convex);
    const L = Poly.sideLengths(ir.end).sort((p, q) => p - q);
    t('...and its changed sides differ by more than a tick can blur (6 units)', L[L.length - 1] - L[L.length - 2] > 6 && L[L.length - 2] - L[0] > 6, L.map(Math.round));
  }
}

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
const POSITIONS = ['left', 'left-low', 'top-left', 'centre', 'middle', 'peek', 'corner', 'log', 'off'];

t('Swiftee positions are ones the layout knows',
  S.every((s) => !s.swiftee || POSITIONS.indexOf(s.swiftee.pos) >= 0),
  S.filter((s) => s.swiftee && POSITIONS.indexOf(s.swiftee.pos) < 0).map((s) => s.id));

t('Swiftee sizes are ones the layout knows',
  S.every((s) => !s.swiftee || ['tiny', 'small', 'medium', 'large'].indexOf(s.swiftee.size) >= 0));

t('every move beat names a position the layout knows',
  S.every((s) => allBeats(s).every((b) =>
    b.swiftee !== 'move' || POSITIONS.indexOf(b.to) >= 0)));

/* ------------------------------------------------------------------ *
 * Character direction
 * ------------------------------------------------------------------ */

const RIG = require('../src/character/swiftee.js').rig;
const intentsIn = (list) => {
  const out = [];
  (function walk(bs) {
    (bs || []).forEach((b) => {
      if (!b || typeof b !== 'object') return;
      if (b.swiftee) out.push(b.swiftee);
      ['feedback', 'parallel', 'otherwise'].forEach((k) => { if (b[k]) walk(b[k]); });
      if (b.on) Object.keys(b.on).forEach((k) => walk(b.on[k]));
    });
  })(list);
  return out;
};
const levelOf = (st) => { const d = RIG[st]; return d ? (d.level || 1) : 0; };

/* A WRONG ANSWER CANNOT MOVE THE LESSON ON UNANSWERED. Every branch whose wrong
   arm asks again has its retry's own answer branched on: either `until:
   'correct'` (asked until right), or — a TWO-TRY question (the user's rule: the
   first miss is "Try again!", the second is explained and the answer shown) — a
   branch after the retry with a right arm and a last wrong arm that asks nothing
   more and SHOWS the answer (a reveal or a teaching line). */
{
  const loose = [];
  const lastTry = (arm) => {
    const i = (arm || []).findIndex((x) => x && x.input);
    const nb = (arm || []).slice(i + 1).find((x) => x && x.branch);
    if (!nb || !(nb.on && nb.on.correct)) return false;
    const last = nb.otherwise || [];
    const shows = JSON.stringify(last);
    // (a `continue` input is not a third attempt: the answer is shown and the tap goes on — the
    // inside / outside question's merged "Inside")
    return !last.some((x) => x && x.input && !x.input['continue']) && /"reveal"|"say"|"autoConcave"|"teach"/.test(shows);
  };
  S.forEach((s) => (s.beats || []).forEach((b) => {
    if (!b || !b.branch) return;
    const asksAgain = (b.otherwise || []).some((x) => x && x.input);
    if (asksAgain && b.until !== 'correct' && !lastTry(b.otherwise)) loose.push(s.id);
  }));
  t('every retry is branched on: until the answer is right, or shown on the last try', loose.length === 0, loose);
}

/* THE REACTION MATCHES THE VERDICT. No right-answer face in a wrong arm,
   no miss in a right one — a wrong answer met with a smile was a real bug. */
{
  const crossed = [];
  const GLAD = /^(happySmall|nice|chuffed|wink|phew|celebrate|excited|delight|nod|proud|happy)$/;
  S.forEach((s) => {
    // (a wrong arm's own intents — not those of a right arm nested in it, a retry's)
    const missIntents = (list) => { const out = []; (function walk(bs) { (bs || []).forEach((x) => {
      if (!x || typeof x !== 'object') return; if (x.swiftee) out.push(x.swiftee);
      ['feedback', 'parallel', 'otherwise'].forEach((k) => { if (x[k]) walk(x[k]); });
      if (x.on) Object.keys(x.on).forEach((k) => { if (k !== 'correct') walk(x.on[k]); }); }); })(list); return out; };
    (s.beats || []).forEach((b) => {
      if (!b || !b.branch) return;
      missIntents(b.otherwise).forEach((i) => { if (GLAD.test(i)) crossed.push(s.id + ' wrong arm: ' + i); });
      intentsIn((b.on || {}).correct).forEach((i) => { if (/^(oops|rethink|confused)$/.test(i)) crossed.push(s.id + ' right arm: ' + i); });
    });
    ((s.perTap || {}).wrong || []).forEach((x) => { if (x.swiftee && GLAD.test(x.swiftee)) crossed.push(s.id + ' per-tap wrong: ' + x.swiftee); });
  });
  t('a wrong answer never gets a happy face and a right one never a miss', crossed.length === 0, crossed);
  t('a wrong answer is one reaction, not a list of faces to race each other',
    Screens.WRONG.filter((b) => b.swiftee).length === 1 && Screens.WRONG.some((b) => b.swiftee === 'oops'),
    Screens.WRONG);
}

/* THE ARRIVAL IS PROTECTED. The first screen is the sleigh, its landing, and
   the greeting — exactly as it was, beat for beat. */
{
  const intro = S[0];
  t('the arrival screen is unchanged', intro.id === 'intro-hi' && JSON.stringify(intro.beats) === JSON.stringify([
    { stage: { kind: 'vista' } },
    { wait: 500 },
    { swiftee: 'enter', from: 'left' },
    { wait: 300 },
    { say: 'Hi! I am Swiftee.', vo: 'p01' },
    { parallel: [{ swiftee: 'wave' }, { sfx: 'pop' }] },
    { input: { type: 'tap-anywhere' } }
  ]), intro.beats);
  t('the arrival is still the move that plays the sleigh', !RIG.enter || RIG.enter.rig === 'driving');
}

/* THE SIDE-MEASURING SCREEN IS PROTECTED. Its choreography is the dedicated
   measuring walk (stage.js measureSide, its own sheet); nothing generic was
   given to it. Beat for beat as it is — since the Part 1 review he measures
   the sides himself ("Let's measure.", then the walk round all five, no taps
   taken: auto) — and no per-tap face. */
{
  const m = Screens.byId['measure-sides'];
  t('the side-measuring screen is unchanged', !!m && JSON.stringify(m.beats) === JSON.stringify([
    { stage: { kind: 'polygon' } },
    { instruction: null },
    { swiftee: 'inspect' },
    { say: 'Let\u2019s measure the sides.', vo: 'p29s' },
    { input: { type: 'tap-each', targets: 'sides', reveal: 'length', count: 5, auto: true, praise: false } },
    { feedback: [{ sfx: 'correct' }, { swiftee: 'proud' }] }
  ]), m && m.beats);
  t('no generic face is asked for per measured side',
    !!m && !Object.keys(m.perTap || {}).some((k) => (m.perTap[k] || []).some((b) => b.swiftee)));
  require('../src/character/measuring-frames.js');
  const MF = global.MeasuringFrames;
  const spec = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../assets/swiftee/swiftee-measuring.json'), 'utf8'));
  t('the measuring sprite table is still the one its build tool wrote', JSON.stringify(MF) === JSON.stringify(spec), [MF && MF.frames, spec.frames]);
}

/* THE BIG ONE IS FOR MILESTONES. A full celebration (level 3) only where the
   lesson has earned it, never per tap, and not twice on screens in a row. */
{
  const L3 = [];
  S.forEach((s, i) => {
    intentsIn(s.beats).forEach((st) => { if (levelOf(st) === 3) L3.push(i); });
  });
  const perTapBig = S.filter((s) => Object.keys(s.perTap || {}).some((k) => (s.perTap[k] || []).some((b) => b.swiftee && levelOf(b.swiftee) === 3))).map((s) => s.id);
  t('no celebration is played per tap', perTapBig.length === 0, perTapBig);
  const uniq = [...new Set(L3)];
  t('celebrations are rare: a handful of milestones, not every answer', uniq.length <= 9, uniq);
  // back to back: a screen that ENDS celebrating, and the next one OPENING with
  // another (a whole task between two milestones is two moments, not one)
  const seq = S.map((x) => intentsIn(x.beats).filter((y) => !/^(enter|exit|move)$/.test(y)));
  const back2back = [];
  for (let i = 1; i < S.length; i++) {
    const endBig = seq[i - 1].length && levelOf(seq[i - 1][seq[i - 1].length - 1]) === 3;
    const openBig = seq[i].length && levelOf(seq[i][0]) === 3;
    if (endBig && openBig) back2back.push(S[i - 1].id + '+' + S[i].id);
  }
  t('no celebration follows straight on from another', back2back.length === 0, back2back);
  // (five: the builder's two answers went with the builder)
  t('ordinary right answers get the small face',
    S.filter((s) => intentsIn(s.beats).indexOf('happySmall') >= 0).length >= 5);
}

/* HE DOES NOT DO THE SAME THING SCREEN AFTER SCREEN. The gesture each screen
   opens with (travel aside, and the protected measuring screen aside) is
   never the one the screen before opened with. */
{
  const first = S.map((s) => intentsIn(s.beats).filter((x) => !/^(enter|exit|move)$/.test(x))[0] || null);
  const repeats = [];
  for (let i = 1; i < S.length; i++) {
    if (S[i].id === 'measure-sides' || !first[i] || !first[i - 1]) continue;
    if (first[i] === first[i - 1]) repeats.push(S[i - 1].id + '+' + S[i].id + ':' + first[i]);
  }
  t('no two screens in a row open with the same gesture', repeats.length === 0, repeats);
  const distinct = new Set(first.filter(Boolean));
  t('the lesson uses a real range of his direction', distinct.size >= 14, [...distinct]);
}

/* ------------------------------------------------------------------ *
 * The word and the thing arrive together
 * ------------------------------------------------------------------ */

/* EVERY PIECE OF UI THAT WAITS FOR A WORD HEARS IT. An answer, a tag, a bin
   or the stepper held back for its word (stage.js holdForWord) only arrives
   in step if that word is in a line said on the same screen; otherwise it
   falls back to appearing when the child is handed control — late, and out
   of step. So the word must be in the screen's own lines. */
{
  const key = (w) => String(w).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const spokenWords = (s) => {
    const out = new Set();
    allBeats(s).forEach((b) => {
      const text = b.say != null ? b.say : (typeof b.instruction === 'string' ? b.instruction : null);
      if (text) text.split(/\s+/).forEach((w) => out.add(key(w)));
    });
    return out;
  };
  const deaf = [];
  let held = 0;
  S.forEach((s) => {
    const words = spokenWords(s);
    const need = (w, what) => { held++; if (!words.has(key(w))) deaf.push(s.id + ': ' + what + ' waits for "' + w + '"'); };
    const specs = allBeats(s).filter((b) => b.stage).map((b) => b.stage);
    if (s.stage && s.stage.kind) specs.push(s.stage);
    specs.forEach((sp) => {
      if (sp.choices && sp.cue) sp.choices.forEach((c) => {
        const ws = sp.cue === true ? String(c).split(/\s+/) : [].concat(sp.cue[c] || []);
        if (!ws.some((w) => words.has(key(w)))) deaf.push(s.id + ': the "' + c + '" answer waits for ' + JSON.stringify(ws));
        held++;
      });
      if (sp.label && sp.label.cue) need(sp.label.cue, 'the tag');
      if (sp.badge && sp.badge.cue) need(sp.badge.cue, 'the badge');
      if (sp.binsCue) (sp.bins || []).forEach((b) => need(b.cueWord || b.id, 'the ' + b.id + ' bin'));
      ['left', 'right'].forEach((k) => { if (sp[k] && sp[k].captionCue) need(sp[k].captionCue, 'the ' + k + ' name tag'); });
    });
  });
  t('every answer, tag, bin and control that waits for a word hears it on its own screen', deaf.length === 0, deaf);
  t('the word-and-thing sync is used across the lesson, not on one screen', held >= 8, held);
  /* THE QUESTION INTRODUCES ITS ANSWERS (the user: "never expose an interaction before the
     learner has been introduced to it" — and then: "the buttons are delayed; deal them when the
     VO says 'inside or outside'"). On both answer screens the two buttons arrive on the
     question's own words — the instruction and the choices in one `parallel`, each answer
     waiting for its word (`cue`) — and never from a beat before the question, nor from the
     screen-level stage (a rebuild would put them up ahead of it). */
  // THE INSIDE / OUTSIDE SECOND MISS (the user's 2-wrong brief, and screen 12's fix): "The diagonals
  // are inside.", and ON "inside" the two answers merge into one green "Inside" — then on by itself,
  // no tap, no third attempt, no "Try again!"
  {
    const s = Screens.byId['inside-or-outside'];
    const last = JSON.stringify(s.beats);
    const arm = (function find(list) { for (const b of list || []) { if (b && b.branch && b.otherwise && b.otherwise.some((x) => x && x.stage && x.stage.merge)) return b.otherwise; const r = b && (find(b.otherwise) || (b.on && find(b.on.correct))); if (r) return r; } return null; })(s.beats);
    const iLine = arm ? arm.findIndex((x) => x.say === 'The diagonals are inside.') : -1;
    // (lit ON its word: an onWord cue set before the line)
    const iLit = arm ? arm.findIndex((x) => x.stage && [].concat(x.stage.onWord || []).some((w) => w.word === 'diagonals' && w.lit === 'diagonals')) : -1;
    // (the merge waits for its word — `cue: 'inside'` — so it is set before the line, like the lighting)
    const iMerge = arm ? arm.findIndex((x) => x.stage && x.stage.merge === 'Inside' && x.stage.cue === 'inside') : -1;
    const iTap = arm ? arm.findIndex((x) => x.input) : -1;
    t('inside-or-outside second miss: diagonals lit, "The diagonals are inside.", ONE merged Inside on "inside", then on by itself (no tap)',
      !!arm && iLit >= 0 && iLit < iLine && iMerge >= 0 && iMerge < iLine && iTap < 0 && !arm.some((x) => x.say && /Try again/.test(x.say)) && /fb54/.test(last),
      { iLit, iLine, iMerge, iTap });
  }
  // THE SORT'S EXPLANATIONS SHOW EACH CONCEPT ON ITS OWN WORD (the explanation brief): the corner on
  // "corner", the diagonal on "diagonal(s)", its inside / outside emphasis on "inside" / "outside"
  {
    const teach = Screens.byId['sort-convex-concave'].teach, bad = [];
    const WORD = { notch: /^corner/, corners: /^corner/, outside: /^diagonal/, inside: /^diagonal/, outsideGlow: /^outside/, insideGlow: /^inside/ };
    Object.keys(teach).forEach((k) => teach[k].forEach((ln) => {
      const shows = ln.shows || (ln.show ? [{ what: ln.show, on: ln.on || 0 }] : []);
      const words = ln.say.split(/\s+/).map((w) => w.replace(/[^a-z]/gi, '').toLowerCase());
      shows.forEach((sh) => { if (!WORD[sh.what] || !WORD[sh.what].test(words[sh.on || 0] || '')) bad.push(k + ':' + sh.what + '@' + (words[sh.on || 0] || '?')); });
    }));
    t('the convex / concave explanations light each concept on the word that names it', bad.length === 0, bad);
  }
  ['inside-or-outside', 'stayed-changed'].forEach((id) => {
    const s = Screens.byId[id], bs = s.beats;
    const par = bs.find((b) => b.parallel && b.parallel.some((x) => typeof x.instruction === 'string') &&
                               b.parallel.some((x) => x.stage && x.stage.choices && x.stage.cue));
    const early = par ? bs.slice(0, bs.indexOf(par)).some((b) => b.stage && b.stage.choices) : true;
    const onStage = !!(s.stage && s.stage.choices);
    t(id + ': the answers are dealt on the question’s own words — with it, never before it', !!par && !early && !onStage, { par: !!par, early, onStage });
  });
}

/* EVERY WORD THE BUBBLE LETTERS HAS A MEANING ON THE BOARD. The vocabulary's
   own ids (dual-coding.js) are what the stage's concept mapping answers; a
   noun the mapping does not know would be lettered orange and do nothing. */
{
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/game/stage.js'), 'utf8');
  const DC = require('../src/game/dual-coding.js');
  const nouns = ['polygon', 'vertex', 'side', 'line segment', 'diagonal', 'angle', 'inside', 'outside', 'equal', 'convex', 'concave', 'regular', 'irregular'];
  const unmapped = nouns.filter((n) => src.indexOf("case '" + n + "'") < 0);
  t('every vocabulary noun has a reaction on the board', unmapped.length === 0, unmapped);
  t('the bubble letters every one of those nouns', nouns.every((n) => /dc-term/.test(DC.markup('the ' + n + ' here'))), nouns.filter((n) => !/dc-term/.test(DC.markup('the ' + n + ' here'))));
  // (the user: "remove the pulse animation from the answer cards — they remain stable until
  // the user interacts": the word lights nothing on the grid, and no idle hint swells them)
  t('the answer cards do not pulse — not for the word "polygons", not while the child decides',
    /case 'polygon':[\s\S]{0,300}kind === 'grid'\) return 0;/.test(src) &&
    !/'multi-select'[\s\S]{0,1200}hintLadder\(/.test(src));
}

/* THE VOICE SCRIPT IS THE STORYBOARD. docs/VO.md is generated from the
   beats, so a line added or reworded here and not in the script is a clip
   nobody will record. */
{
  const fs = require('fs'), path = require('path');
  const doc = fs.readFileSync(path.join(__dirname, '../docs/VO.md'), 'utf8');
  const ids = [];
  S.forEach((s) => allBeats(s).forEach((b) => { if (b.vo) ids.push(b.vo); }));
  const missing = [...new Set(ids)].filter((id) => doc.indexOf('assets/vo/' + id + '.mp3') < 0);
  t('the voice script lists every clip the storyboard asks for (npm run vo:script)', missing.length === 0, missing);
}

console.log('\nscreens: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
