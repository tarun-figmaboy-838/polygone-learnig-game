/*!
 * screens.js — the storyboard, page by page, as data.
 *
 * Lesson definitions follow the source deck. Adventure dialogue adds
 * Swiftee's comic personality; game.js supplies contextual retry hints
 * and celebrations, while quest.js tracks challenge rewards.
 * Original deck corrections remain recorded under `original` and FLAG.
 *
 * `instruction` on a screen is what the card SHOWS during that screen. Beats
 * set it only when it changes; a screen whose `instruction` equals the
 * previous screen's is carrying the card over, exactly as the deck does on
 * pages 12–13 and 31. `instruction: null` clears it.
 *
 * Beats use the director vocabulary. `input` yields to the learner;
 * `branch` runs the feedback that matches the result. Sequences follow the
 * brief's section 3 shape: enter -> settle -> Swiftee -> instruction -> VO
 * -> object -> control -> interact -> feedback -> Swiftee -> next.
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Shared fragments
   * ------------------------------------------------------------------ */

  // Wrong answer: comic, non-verbal, retry. Used everywhere.
  // IN THE ORDER A CHILD FEELS IT: the thing they touched shakes and the cue
  // sounds at once, and he reacts a beat later (game.js holds a reaction for
  // REACT_MS after the answer) — the wobble is the verdict, his face is the
  // friend who noticed.
  //
  // 'oops' IS THE WHOLE REACTION: "hmm?" for about half a second, then the
  // smile that says go on, then back to watching (swiftee.js: brief, then).
  // It used to be confused, a wait and a separate encourage — and outside a
  // branch (a per-tap list, where waits are not waited on) the encourage
  // fired in the same instant, so a wrong tap was met with a happy face. The
  // second miss on one question gets his thinking face instead (misses > 1).
  // The question is asked again after 400ms; he does not hold it up.
  var WRONG = [
    { juice: 'refuse', target: 'answer' },
    { sfx: 'wrong' },
    { swiftee: 'oops' },
    { wait: 400 }
  ];

  /* A RIGHT ANSWER: THE CONFIRMATION FIRST, THEN HIM, THEN ON.
   *
   * The celebrate clip was awaited and came first — so everything a screen
   * added after it, the slice of a new diagonal, the level-up of a finished
   * sort, the confetti, arrived a second and a half after the answer that
   * earned it, and the lesson stood still for the length of his clip. The
   * lift and the cue now land on the answer; he celebrates while the lesson
   * goes on; and the moment is held for FEEDBACK_MS — long enough for his
   * "Nice!", short enough that nobody waits.
   *
   * ONE success sound. A screen that brings its own (the slice of a
   * diagonal, the level-up of a sort) uses that; one that brings none gets
   * the ordinary correct chime, so no right answer is silent and none plays
   * two. */
  var FEEDBACK_MS = 900;
  /* THREE SIZES OF "YES". An ordinary right answer gets 'happySmall' — a
   * small pleased face, picked per screen from three so the tenth is not the
   * first again, or relief if it came after a miss (swiftee.js). A MILESTONE —
   * the first diagonal, every diagonal from a corner, a finished sort, a shape
   * the child made concave, the angles matching, the pentagon built — gets
   * the full celebration, or another face as big (`face`). Every answer
   * celebrating the same way is how a celebration stops meaning anything. */
  function correct(extra, face) {
    extra = extra || [];
    var sounds = extra.some(function (b) { return b && b.sfx; });
    var bursts = extra.some(function (b) { return b && b.juice === 'confetti'; });
    // A BURST FROM THE ANSWER. The audit's child got a chime and a face for a
    // right answer and nothing that said so on the screen; now the answer
    // throws a small burst from its own edges — one, from the thing that
    // earned it (a milestone that brings its own bigger one keeps that).
    return [{ juice: 'collect', target: 'answer' }]
      .concat(sounds ? [] : [{ sfx: 'correct' }])
      .concat(bursts ? [] : [{ juice: 'confetti', target: 'answer', count: 16, fromEdge: true }])
      .concat(extra)
      .concat([{ swiftee: face || 'happySmall' }, { wait: FEEDBACK_MS }]);
  }
  function milestone(extra, face) { return correct(extra, face || 'celebrate'); }

  /* ------------------------------------------------------------------ *
   * THE END-GAME SUMMARY, as data
   *
   * Every idea the lesson taught, in the order it taught them, each with its
   * name, its one recap line, and the animation that shows it (stage.js
   * SUMMARY_VISUALS). summaryBeats() turns the list into the screen's beats,
   * so every card runs the same sequence and none is written out by hand:
   *
   *   CARD_ENTER → CONCEPT_REVEAL   the card comes in and its idea is shown
   *   SWIFTEE_ENTER                 he rises from behind it, presenting it
   *   EXPLANATION → READING_PAUSE   one short line, and a breath after it
   *   SWIFTEE_EXIT                  he sinks back behind it
   *   CARD_COLLECT → NEXT_CONCEPT   it shrinks into the collection
   *
   * and, after the last, FINAL_SUMMARY. Each beat waits for the one before
   * it — the voice, the words, the animation — so no two states overlap.
   * ------------------------------------------------------------------ */
  var SUMMARY = [
    { id: 'vertex',    label: 'Vertex',    text: 'A vertex is a corner where two sides meet.',                          animation: 'vertex',    vo: 'p37a' },
    { id: 'side',      label: 'Side',      text: 'A side is a straight line joining two vertices.',                     animation: 'side',      vo: 'p37b' },
    { id: 'angle',     label: 'Angle',     text: 'An angle is formed where two sides meet.',                            animation: 'angle',     vo: 'p37c' },
    { id: 'diagonal',  label: 'Diagonal',  text: 'A diagonal joins two non-adjacent vertices.',                         animation: 'diagonal',  vo: 'p37d' },
    { id: 'convex',    label: 'Convex',    text: 'In a convex polygon, all diagonals stay inside.',                     animation: 'convex',    vo: 'p37e' },
    { id: 'concave',   label: 'Concave',   text: 'In a concave polygon, at least one diagonal goes outside.',           animation: 'concave',   vo: 'p37f' },
    { id: 'regular',   label: 'Regular',   text: 'A regular polygon has all sides and all angles equal.',               animation: 'regular',   vo: 'p37g' },
    { id: 'irregular', label: 'Irregular', text: 'If the sides or angles are not all equal, the polygon is irregular.', animation: 'irregular', vo: 'p37h' }
  ];
  var SUMMARY_DONE = { text: 'Amazing! You explored all these polygon ideas!', vo: 'p37i' };

  function summaryBeats(list) {
    var out = [{ instruction: null }, { stage: { kind: 'summary' } }];
    list.forEach(function (c) {
      out.push(
        { stage: { summary: { card: c.id } } },            // in, and its idea shown (the beat waits for it)
        { swiftee: 'enter', from: 'below', ms: 320 },      // up from behind the card...
        { swiftee: 'present', at: 'summary.card' },        // ...presenting it
        { say: c.text, vo: c.vo, pace: 'recap' },          // the line, then a short reading pause
        { swiftee: 'exit', to: 'below' },                  // back down behind it
        { stage: { summary: { collect: c.id } } }          // into the collection; the next waits for it to land
      );
    });
    out.push(
      { wait: 400 },
      { stage: { summary: { final: true } } },             // the collection gathers in
      // up into the open middle, between the two columns, one last time
      { swiftee: 'enter', from: 'below', quick: true, to: 'middle', size: 'medium' },
      { swiftee: 'celebrate' },
      { say: SUMMARY_DONE.text, vo: SUMMARY_DONE.vo },
      // and the game's own ending follows on Next (game.js finish())
      { input: { type: 'tap-anywhere' } }
    );
    return out;
  }

  var SCREENS = [

    /* ================================================================ *
     * INTRO — pages 1–3
     * ================================================================ */

    {
      id: 'intro-hi', page: 1,
      swiftee: { pos: 'left', size: 'large', purpose: 'introduce'},
      say: 'Hi! I am Swiftee.',
      stage: { kind: 'vista' },
      beats: [
        { stage: { kind: 'vista' } },
        { wait: 500 },
        { swiftee: 'enter', from: 'left' },
        { wait: 300 },
        { say: 'Hi! I am Swiftee.', vo: 'p01' },
        { parallel: [{ swiftee: 'wave' }, { sfx: 'pop' }] },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'intro-remember', page: 2,
      swiftee: { pos: 'left', size: 'large', purpose: 'introduce'},
      say: 'Remember we learned about polygons before.',
      beats: [
        // REMEMBERING: he opens his book (the rig's own 'reading' pose, never
        // played before), then settles while the child reads.
        { swiftee: 'recall' },
        { say: 'Remember we learned about polygons before.', vo: 'p02' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'intro-define', page: 3,
      swiftee: { pos: 'left', size: 'large', purpose: 'concept'},
      say: 'Polygons are closed shapes made from straight lines.',
      beats: [
        // "Ta-da — here is the idea": one open-winged flourish, then talking
        { swiftee: 'present' },
        { say: 'Polygons are closed shapes made from straight lines.', parts: ['Polygons are closed shapes', 'made from straight lines.'], vo: 'p03' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    /* ================================================================ *
     * WHICH ARE POLYGONS — page 4
     * ================================================================ */

    {
      id: 'which-polygons', page: 4,
      transition: false,   // straight on from the intro: no ice between the definition and the first question
      // The same mark as the three screens before: no wipe, no walk — the
      // options simply appear on his right and he asks about them.
      swiftee: { pos: 'left', size: 'large', purpose: 'ask' },
      say: 'Which of these are polygons?',
      // A MISS IS ANSWERED WITH THE DEFINITION. After "Try again!" he reminds
      // the child what a polygon is — the line from the screen before, in its
      // own voice, not new words — and the question comes back (game.js
      // sayReminder). The user asked for it on this screen.
      remind: { say: 'Polygons are closed shapes made from straight lines.', vo: 'p03' },
      stage: {
        kind: 'choice-grid',
        options: [
          { id: 'pentagon', shape: 'pentagon', correct: true },
          { id: 'circle',   shape: 'circle',   correct: false },
          { id: 'open',     shape: 'open-path', correct: false },
          { id: 'octagon',  shape: 'octagon',  correct: true }
        ],
        multi: true
      },
      beats: [
        { stage: { kind: 'choice-grid', enter: 'stagger' } },
        { wait: 300 },
        { say: 'Which of these are polygons?', vo: 'p04' },
        // he looks the options over with the child, head on one side
        { swiftee: 'observe', at: 'grid' },
        // Multi-select: each tap is judged on its own so a child learns per
        // shape, and the screen completes when both polygons are selected.
        { input: { type: 'multi-select', until: 'all-correct-selected' } },
        { feedback: correct() }
      ],
      perTap: { correct: [{ juice: 'pop', target: 'option' }, { sfx: 'correct' }],
                wrong:   WRONG }
    },

    /* ================================================================ *
     * SIDE → DIAGONAL — pages 5–13
     * ================================================================ */

    {
      id: 'lets-play', page: 5,
      swiftee: { pos: 'left-low', size: 'medium' },
      say: 'Let\u2019s play with this one.',
      stage: { kind: 'polygon', sides: 5, panel: 'right' },
      beats: [
        { stage: { kind: 'polygon', sides: 5, panel: 'right', enter: 'pop' } },
        { sfx: 'pop' },
        { wait: 300 },
        // "THIS one": he presents the pentagon \u2014 a flourish toward it \u2014 and
        // lets the child look. It was the biggest clip in the rig (seven
        // seconds of jumping) under a line that only introduces a shape.
        { swiftee: 'present', at: 'polygon' },
        { say: 'Let\u2019s play with this one.', vo: 'p05' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'pick-vertex', page: 6,
      swiftee: { pos: 'left-low', size: 'medium' },
      say: 'Select any vertex.',
      beats: [
        { say: 'Select any vertex.', vo: 'p06' },
        { swiftee: 'point', at: 'polygon' },
        { focus: 'polygon.vertices', style: 'pulse' },
        // any corner is right, so it is not praised as an answer: the pop,
        // the nod, and straight on to "Connect it to another vertex."
        { input: { type: 'vertex-pick', accept: 'any', praise: false } },
        // HE ANSWERS A RIGHT ANSWER. Six screens judged the child and then
        // said nothing with their face: the sound played, the shape moved,
        // and the friend who asked for it stood there.
        { feedback: [{ sfx: 'select' }, { juice: 'pop', target: 'vertex' }, { swiftee: 'nod' }] }
      ]
    },

    {
      /* THE CHILD CONNECTS IT, AND FINDS OUT WHAT THEY MADE (pages 7–12).
       *
       * This was six screens of being shown: he said he would connect it, he
       * drew a side himself, named it, asked "what if…", the child dragged
       * the side's loose end across, and a new screen cheered it. Now the
       * child does it. Their corner is the only one showing; they draw from
       * it to any other corner (stage.js drawDiagonals, `sides`), and what
       * they made is decided by vertex ORDER, never by where it is on the
       * screen: a neighbour, i±1 wrapping round, is a SIDE; any other corner
       * is a DIAGONAL.
       *
       *   SIDE      the side lights, its tag pops on the word "side", and he
       *             says so in full; a readable pause; the side and the tag
       *             fade; "Connect it to a different vertex." — and the same
       *             corner is theirs to try again. As often as they like: the
       *             other neighbour is a side too. It is not a wrong answer —
       *             it is the first thing there is to learn — so no wrong
       *             sound, no "oops", and it does not count as a miss.
       *   DIAGONAL  the line stays and glows, the right-answer sound, the
       *             instruction goes, and he cheers it: "Yay! You made a
       *             diagonal!", its tag on the word. No stock "Nice!" before
       *             it (praise: false) — one cheer, one voice.
       *
       * Nothing can be drawn while a line is being said: the input is only
       * armed after each instruction has been heard out (the say/instruction
       * handlers wait for the voice, and a tap cannot cut it), and the stage
       * refuses a line outside READY_TO_CONNECT. until: 'correct' keeps asking
       * until the diagonal is made. */
      id: 'connect', page: 7,
      swiftee: { pos: 'left-low', size: 'medium' },
      instruction: 'Connect it to another vertex.',
      lines: ['This is a side of the polygon.', 'Yay! You made a diagonal!'],
      stage: { highlight: { vertex: 'picked', color: 'yellow' } },
      beats: [
        { stage: { highlight: { vertex: 'picked', color: 'yellow' } } },
        { instruction: 'Connect it to another vertex.', vo: 'p07i' },
        // "what will you make?" — he leans to their corner, curious (the
        // pointing your-turn was the screen before's, and the same gesture
        // twice running is a loop, not a reaction)
        { swiftee: 'curious', at: 'picked' },
        { input: { type: 'draw-diagonal', from: 'picked', sides: true, praise: false, accept: 'non-adjacent-unused' } },
        { branch: true, until: 'correct',
          on: {
            // SIDE_FEEDBACK: kept a moment, named, and another try
            side: [
              { sfx: 'pop' },
              // the tag arrives on the word "side"
              { stage: { label: { text: 'Side', at: 'segment', arrow: true, enter: 'pop', cue: 'side' } } },
              { swiftee: 'discover' },
              { say: 'This is a side of the polygon.', vo: 'p09' },
              { wait: 1200 },
              { stage: { side: null } },
              { instruction: 'Connect it to a different vertex.', vo: 'p10i' },
              { swiftee: 'point', at: 'picked' },
              { input: { type: 'draw-diagonal', from: 'picked', sides: true, praise: false, accept: 'non-adjacent-unused', retry: true } }
            ],
            // DIAGONAL_SUCCESS: the line is in and glowing (stage.js shimmer)
            correct: [
              { sfx: 'correct' },
              { juice: 'collect', target: 'answer' },
              { instruction: null },
              // on the word "diagonal", the tag that names it
              { stage: { label: { text: 'Diagonal', at: 'below-polygon', inside: true, enter: 'pop', cue: 'diagonal' } } },
              { swiftee: 'celebrate' },
              { say: 'Yay! You made a diagonal!', vo: 'p12' }
            ]
          },
          // (nothing else can come back from this input — a line let go on no
          // corner goes home without a verdict — but if it did, it is asked
          // again, gently)
          otherwise: [{ swiftee: 'hint' }, { input: { type: 'draw-diagonal', from: 'picked', sides: true, praise: false, accept: 'non-adjacent-unused', retry: true } }] },
        // (the success arm already took it down; said again so the card the
        // next screen inherits is plain from the storyboard)
        { instruction: null },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'define-diagonal', page: 13,
      swiftee: { pos: 'peek', size: 'small', purpose: 'concept'},
      instruction: null,
      // THE SUPPLIED WORDING, AND A STANDING OBJECTION TO IT.
      //
      // A diagonal joins two non-adjacent VERTICES. It does not join sides —
      // the segment this very screen draws runs corner to corner, and the
      // child is watching it do so while the sentence says otherwise. This
      // was corrected to "vertices" once and the author has since supplied
      // "sides" twice, in writing, with "do not modify my dialogue wording".
      // So it says sides.
      //
      // It is left here rather than quietly fixed again because it is the one
      // line in the lesson that DEFINES the term, and a wrong definition is
      // the most expensive kind of error in a teaching script: everything
      // after it is built on it. If this is ever revisited, "vertices" is the
      // correct word and screens.test.js is where the decision is recorded.
      say: 'A line segment joining two non-adjacent sides is a diagonal.',
      beats: [
        // A DEFINITION IS WRITTEN DOWN: book and quill, the rig's 'writing'
        { swiftee: 'note' },
        { focus: 'diagonal.endpoints', style: 'pulse' },
        { say: 'A line segment joining two non-adjacent sides is a diagonal.', parts: ['A line segment joining', 'two non-adjacent sides', 'is a diagonal.'], vo: 'p13' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    /* ================================================================ *
     * MORE DIAGONALS — pages 14–16
     * ================================================================ */

    {
      id: 'another-diagonal', page: 14,
      swiftee: { pos: 'left-low', size: 'medium' },
      instruction: 'Draw another diagonal from the same vertex.',
      // THE SAME CORNER, A SECOND DIAGONAL, AND WHAT THEY SHOW.
      //
      // The child draws from the vertex they picked on page 6 — it is still
      // ringed — to a corner that is neither beside it nor already used; the
      // first diagonal stays where they made it. When the second is in, both
      // are brightened one after the other and the inside of the shape glows:
      // "All diagonals are still inside." (the diagonal pass asked for exactly
      // that line and that picture, and it is declared in `lines`).
      //
      // No standing ghost of the answer any more: the dashed line that slid
      // to the remaining corner the whole time was a hint shown before anyone
      // needed it. The hint ladder in stage.js shows the move only once the
      // child has been still for a while.
      lines: ['All diagonals are still inside.'],
      beats: [
        // HE ASKS, THEN THE INSTRUCTION STAYS. The instruction is the last
        // thing said before the child is let in, so the words in view while
        // they draw are what to do, not a question with half of it gone.
        // SAID ONCE: the line that echoed the instruction ("Can you draw another diagonal from here?") went —
        // the same request twice in a row read as a stutter, not a lesson.
        { instruction: 'Draw another diagonal from the same vertex.', vo: 'p14i' },
        { swiftee: 'point', at: 'picked' },
        { input: { type: 'draw-diagonal', from: 'picked', accept: 'non-adjacent-unused' } },
        // until: the retry is branched on, so a right second try still gets
        // the observation below — it used to skip straight to the next screen
        { branch: true, until: 'correct',
          on: { correct: correct([{ sfx: 'slice' }]).concat([
            { parallel: [
              { stage: { observe: 'diagonals' } },
              // he watches them light up, one and then the other
              { swiftee: 'observe', at: 'polygon' },
              { say: 'All diagonals are still inside.', vo: 'p14b' }
            ] }
          ]) },
          otherwise: WRONG.concat([{ input: { type: 'draw-diagonal', from: 'picked', accept: 'non-adjacent-unused', retry: true } }]) }
      ]
    },

    {
      id: 'hexagon-your-turn', page: 15,
      swiftee: { pos: 'left-low', size: 'medium' },
      instruction: 'Draw all the diagonals from this vertex.',
      say: 'Your turn! Draw all the diagonals from this vertex.',
      // FLAG: two problems on this page.
      //  (1) Sequence: the lesson is on a pentagon on pages 5–14 and 16–20,
      //      and this page cuts to a hexagon for one screen, then back. It
      //      reads as a mistake. Recommended: move this screen to AFTER
      //      page 17 (once the pentagon's diagonals are fully explored) or
      //      to the end of the diagonals unit.
      //  (2) Answer leak: the deck draws all three diagonals as dashed
      //      ghosts on the "your turn" screen, so the exercise can be done
      //      by tracing. Section 2 of the brief forbids exactly this. The
      //      ghosts are removed here; the label "Hexagon" stays.
      stage: { kind: 'polygon', sides: 6, label: { text: 'Hexagon', at: 'below-polygon' }, ghost: null },
      beats: [
        { stage: { kind: 'polygon', sides: 6, enter: 'morph', label: { text: 'Hexagon', at: 'below-polygon' } } },
        { sfx: 'pop' },
        { wait: 400 },
        { swiftee: 'encourage' },
        { say: 'Your turn! Draw all the diagonals from this vertex.', parts: ['Your turn!', 'Draw all the diagonals', 'from this vertex.'], vo: 'p15' },
        // The instruction is the script's own last two bubbles, so it is not
        // said again: the line settles into the one sentence the child keeps
        // in view while they draw (game.js — an instruction that only repeats
        // what was just said is shown, not spoken).
        { instruction: 'Draw all the diagonals from this vertex.', vo: 'p15i' },
        { focus: 'polygon.vertex.0', style: 'pulse' },
        { swiftee: 'step-back' },
        // Three diagonals from one hexagon vertex (n - 3). Each correct one
        // gets its own small reward; the screen completes on the third.
        { input: { type: 'draw-diagonals', from: 0, count: 3, accept: 'non-adjacent-unused' } },
        // EVERY DIAGONAL FROM ONE CORNER: a milestone, and the one place his
        // jumping-for-joy clip belongs
        { feedback: milestone([{ sfx: 'levelUp' }], 'excited') }
      ],
      perTap: { correct: [{ sfx: 'slice' }, { juice: 'pop', target: 'diagonal' }], wrong: WRONG }
    },

    {
      id: 'look-diagonals', page: 16,
      swiftee: { pos: 'left-low', size: 'medium' },
      // FLAG: the deck's instruction card on this page still reads "Draw
      // another diagonal from the same vertex." while the dialogue is "Look
      // at the diagonals of this pentagon." — a stale card from page 14.
      // This is a look-only screen, so the card is cleared.
      instruction: null,
      originalInstruction: 'Draw another diagonal from the same vertex.',
      say: 'Look at the diagonals of this pentagon.',
      // The diagonals are NOT on the screen-level stage: they arrive by
      // their own beat, one after another, once the chapter's snow has
      // cleared — a shape that comes up already starred shows nothing.
      stage: { kind: 'polygon', sides: 5, label: { text: 'Diagonal' } },
      beats: [
        { instruction: null },
        { stage: { kind: 'polygon', sides: 5, enter: 'morph' } },
        // THE FIVE DRAW IN ONCE, one after another, after the chapter's snow
        // has melted — a shape that arrives already starred shows nothing.
        // There were two of these beats for a while, one before the line and
        // one after it, so the whole star drew itself, paused, and drew
        // itself again.
        // ONE AT A TIME, SLOWLY ENOUGH TO FOLLOW: each drawn from its corner to
        // the other, the next starting only when it has landed
        { stage: { diagonals: 'all', style: 'dashed', animate: 'sequential', each: 1150, afterReveal: true } },
        { sfx: 'sparkle' },
        { wait: 700 },
        { say: 'Look at the diagonals of this pentagon.', parts: ['Look at the diagonals', 'of this pentagon.'], vo: 'p16' },
        { swiftee: 'observe', at: 'polygon' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    /* ================================================================ *
     * INSIDE OR OUTSIDE → CONVEX / CONCAVE — pages 17–26
     * ================================================================ */

    {
      id: 'inside-or-outside', page: 17,
      swiftee: { pos: 'left-low', size: 'medium' },
      instruction: 'Are the diagonals inside or outside?',
      stage: { kind: 'polygon', sides: 5, diagonals: 'all', choices: ['Inside', 'Outside'] },
      beats: [
        // THE ANSWERS COME IN WITH THEIR WORDS: built first, held, and each
        // one arrives as the question reaches it — "Inside" on "inside",
        // "Outside" on "outside" (stage.js holdForWord). The name tag from the
        // screen before comes down: the question is about where the
        // diagonals are, not what they are called.
        { stage: { choices: ['Inside', 'Outside'], cue: true, label: null } },
        { instruction: 'Are the diagonals inside or outside?', vo: 'p17i' },
        // SAID ONCE: the line that echoed the instruction ("Are they inside or outside?") went —
        // the same request twice in a row read as a stutter, not a lesson.
        { swiftee: 'think' },
        { input: { type: 'choice', correct: 'Inside' } },
        { branch: true, until: 'correct',
          on: { correct: correct() },
          otherwise: WRONG.concat([{ input: { type: 'choice', correct: 'Inside', retry: true } }]) }
      ]
    },

    {
      id: 'lets-change', page: 18,
      swiftee: { pos: 'left-low', size: 'medium' },
      say: 'Let\u2019s make a change.',
      beats: [
        { instruction: null },
        { stage: { choices: null } },
        { swiftee: 'mischief' },
        { say: 'Let\u2019s make a change.', vo: 'p18' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'drag-inward', page: 19,
      swiftee: { pos: 'left-low', size: 'medium' },
      instruction: 'Drag the vertex inward.',
      stage: { highlight: { vertex: 0, color: 'yellow' } },
      beats: [
        // SAID ONCE: the line that echoed the instruction ("Help me pull this vertex inside.") went —
        // the same request twice in a row read as a stutter, not a lesson.
        { instruction: 'Drag the vertex inward.', vo: 'p19i' },
        { focus: 'polygon.vertex.0', style: 'pulse' },
        // "what will happen?" — curious, leaning toward the corner, not the
        // winking your-turn he gave the screen before
        { swiftee: 'curious', at: 'polygon.vertex.0' },
        // Complete when the polygon becomes concave (Poly.classify), not
        // when the vertex crosses a pixel line. The drag is clamped with
        // Poly.clampSimple so it cannot become a bowtie.
        { input: { type: 'drag-vertex', vertex: 0, until: 'concave', clamp: 'simple', live: 'diagonals' } },
        // A RIGHT ANSWER, AND IT SOUNDS LIKE ONE: the chime, the shape jiggles
        // into its dent, a burst from the corner that made it. The big "Whoa!"
        // is still the next screen's.
        { feedback: [{ sfx: 'correct' }, { juice: 'wobble', target: 'polygon' }, { juice: 'confetti', target: 'vertex', count: 18 }, { swiftee: 'happySmall' }] }
      ]
    },

    {
      id: 'whoa', page: 20,
      swiftee: { pos: 'peek', size: 'small', purpose: 'surprise'},
      say: 'Whoa! One of the diagonals went outside.',
      stage: { highlight: { diagonal: 'outside', color: 'red', style: 'dashed' } },
      beats: [
        { instruction: null },
        { swiftee: 'surprised' },
        { stage: { highlight: { diagonal: 'outside', color: 'red', style: 'dashed', enter: 'flash' } } },
        { sfx: 'honk' },
        { say: 'Whoa! One of the diagonals went outside.', parts: ['Whoa! One of the diagonals', 'went outside.'], vo: 'p20' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'compare', page: 21,
      // Both panels sit across the middle and nothing is drawn under them on
      // this screen, so the whole foot of the stage is his — centre stage,
      // with the line directly over his head in the band he leaves.
      // Small: at medium his head reaches 46 units up into the compare panels.
      swiftee: { pos: 'centre', size: 'small' },
      instruction: 'Compare the diagonals in both pentagons.',
      say: 'Both are pentagons.',
      // the concave one is the pentagon the child dented (made: stage.js
      // keeps it); the stock dent stands in when the screen is reached without it
      stage: { kind: 'compare', left: { sides: 5, diagonals: 'all' }, right: { sides: 5, dent: 0, made: 'concave', diagonals: 'all', outsideColor: 'red' } },
      beats: [
        // THE PAIR ARRIVES, THEN HE SPEAKS OF IT: an instruction to compare
        // two pentagons was being read over an empty stage.
        { stage: { kind: 'compare', enter: 'split' } },
        { sfx: 'menuWhoosh' },
        { wait: 400 },
        // COMPARING: he looks at one, then the other
        { swiftee: 'compare', at: ['compare.left', 'compare.right'] },
        { say: 'Both are pentagons.', vo: 'p21' },
        { instruction: 'Compare the diagonals in both pentagons.', vo: 'p21i' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'all-inside', page: 22,
      // ON THE ICE AT THE LEFT. The pair begins at x 270, so the ground to
      // its left is his, and the bubble sits by his head wherever he stands
      // (game.js placeBubble). Hovering him in the corner read as floating.
      swiftee: { pos: 'left-low', size: 'medium' },
      say: 'This one has all diagonals inside.',
      beats: [
        { instruction: null },
        { focus: 'compare.left', style: 'dim-others' },
        // He SHOWS this one rather than asking for it: 'point' is the
        // leaning, winking 'your turn' pose, and a wink under a sentence that
        // explains a card reads as a joke nobody made. 'look' is the same
        // lean with his eyes on the card.
        { swiftee: 'observe', at: 'compare.left' },
        { say: 'This one has all diagonals inside.', vo: 'p22' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'convex', page: 23,
      // Above, like the rest of this run of compare screens: the pair fills
      // the middle and Next reserves the foot, so a line placed near him at
      // the bottom had a 54px band to live in and came out four rows deep.
      swiftee: { pos: 'peek', size: 'small', purpose: 'concept'},
      instruction: 'All diagonals inside means convex polygon.',
      // FLAG: grammar. Deck: "That's convex polygon."
      say: 'That\u2019s a convex polygon.',
      original: 'That\u2019s convex polygon.',
      stage: { badge: { under: 'compare.left', text: 'Convex', tone: 'convex' } },
      beats: [
        // THE NAME APPEARS, THEN HE SAYS IT. The badge under the card is the
        // picture of the word he is about to speak, and it arrived two beats
        // later — so the child heard "that is a convex polygon" with nothing
        // new on the screen, and the label turned up after the sentence had
        // gone. The scene arrives, then he speaks of it, as everywhere else.
        { stage: { badge: { under: 'compare.left', text: 'Convex', tone: 'convex', enter: 'pop', cue: 'convex' } } },
        { sfx: 'correct' },
        // and he presents it: "ta-da — convex"
        { swiftee: 'present', at: 'compare.left' },
        { say: 'That\u2019s a convex polygon.', vo: 'p23' },
        // then the rule, on the plank, once his line has been read
        { instruction: 'All diagonals inside means convex polygon.', vo: 'p23i' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'one-outside', page: 24,
      // On the ice at the left, like the screen before it.
      swiftee: { pos: 'left-low', size: 'medium' },
      // FLAG: punctuation. Deck line has no full stop.
      say: 'This one has at least one diagonal outside.',
      original: 'This one has at least one diagonal outside',
      beats: [
        { instruction: null },
        { focus: 'compare.right', style: 'dim-others' },
        { swiftee: 'observe', at: 'compare.right' },
        { say: 'This one has at least one diagonal outside.', parts: ['This one has at least', 'one diagonal outside.'], vo: 'p24' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'concave', page: 25,
      // Above, like the rest of this run of compare screens: the pair fills
      // the middle and Next reserves the foot, so a line placed near him at
      // the bottom had a 54px band to live in and came out four rows deep.
      swiftee: { pos: 'peek', size: 'small', purpose: 'concept'},
      // FLAG: the deck card reads "At least  one" with a double space.
      instruction: 'At least one diagonal outside means concave polygon.',
      // FLAG: grammar and capitalisation. Deck: "So it is Concave polygon."
      say: 'So it is a concave polygon.',
      original: 'So it is Concave polygon.',
      stage: { badge: { under: 'compare.right', text: 'Concave', tone: 'concave' } },
      beats: [
        // THE NAME APPEARS, THEN HE SAYS IT. The badge under the card is the
        // picture of the word he is about to speak, and it arrived two beats
        // later — so the child heard "that is a convex polygon" with nothing
        // new on the screen, and the label turned up after the sentence had
        // gone. The scene arrives, then he speaks of it, as everywhere else.
        { stage: { badge: { under: 'compare.right', text: 'Concave', tone: 'concave', enter: 'pop', cue: 'concave' } } },
        { sfx: 'correct' },
        // the same flourish as "convex": the two names are a pair
        { swiftee: 'present', at: 'compare.right' },
        { say: 'So it is a concave polygon.', vo: 'p25' },
        // then the rule, on the plank, once his line has been read
        { instruction: 'At least one diagonal outside means concave polygon.', vo: 'p25i' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'make-concave', page: 26,
      swiftee: { pos: 'off', size: 'medium' },
      instruction: 'Drag any vertex to make this polygon concave.',
      // The deck shows the badge reading "Convex" during the task. It is a
      // live readout: it flips to "Concave" the moment the shape does.
      stage: { kind: 'polygon', sides: 6, panel: 'center', badge: { text: 'Convex', live: true } },
      beats: [
        { swiftee: 'exit', to: 'left' },
        { stage: { kind: 'polygon', sides: 6, panel: 'center', enter: 'pop', badge: { text: 'Convex', live: true } } },
        { sfx: 'pop' },
        { instruction: 'Drag any vertex to make this polygon concave.', vo: 'p26i' },
        { focus: 'polygon.vertices', style: 'pulse' },
        { input: { type: 'drag-vertex', vertex: 'any', until: 'concave', clamp: 'simple', live: 'badge' } },
        { feedback: [{ sfx: 'correct' }, { juice: 'celebrate', target: 'polygon' }] },
        { swiftee: 'enter', from: 'left' },
        { swiftee: 'celebrate' }
      ]
    },

    /* ================================================================ *
     * SORT: CONVEX / CONCAVE — page 27
     * ================================================================ */

    {
      id: 'sort-convex-concave', page: 27,
      // IN THE AIR, over the corridor between the tray and the bins. This is
      // the one place on the sorting screens where flying is right and not a
      // dodge: there is no floor here — the tray takes the top of the stage
      // and the bins the bottom — and a bird hovering over the sorting table
      // saying "can you sort these?" is the scene. He casts no contact
      // shadow while he is up (swiftee.js), so nothing says he is standing.
      swiftee: { pos: 'top-left', size: 'small' },
      say: 'Can you sort these polygons as convex or concave?',
      stage: {
        kind: 'sort',
        bins: [{ id: 'convex', label: 'Convex', tone: 'convex' }, { id: 'concave', label: 'Concave', tone: 'concave' }],
        // Judged by Poly.classify at runtime, never by a hard-coded answer
        // column — so an art change cannot desync the shape from its key.
        // a square, not a triangle: a triangle can never be concave, so it shows
        // the child nothing about the difference; a square is a shape they know
        // and it sits in the Convex bin for a reason they can see
        items: ['square', 'chevron', 'pentagon', 'l-shape', 'hexagon', 'star'],
        mechanic: 'drag-to-bin',
        // "...as convex or concave?": each bin comes in on its word
        binsCue: true
      },
      beats: [
        { instruction: null },
        { stage: { kind: 'sort', enter: 'stagger' } },
        { sfx: 'menuWhoosh' },
        { wait: 300 },
        { say: 'Can you sort these polygons as convex or concave?', vo: 'p27' },
        { swiftee: 'observe', at: 'sort.tray' },
        { input: { type: 'sort', until: 'all-placed-correctly' } },
        // a finished sort is a milestone
        { feedback: milestone([{ sfx: 'levelUp' }, { juice: 'confetti', target: 'stage' }]) }
      ],
      perTap: { correct: [{ sfx: 'correct' }, { juice: 'pop', target: 'item' }],
                wrong:   [{ sfx: 'wrong' }, { juice: 'refuse', target: 'item' }, { stage: { returnItem: true } }, { swiftee: 'oops' }] }
    },

    /* ================================================================ *
     * REGULAR / IRREGULAR — pages 28–33
     * ================================================================ */

    {
      id: 'suspicious', page: 28,
      // NOT polygon-top-right: that corner is inside the right-hand slab, so
      // the position cannot avoid the panel it is defined against.
      swiftee: { pos: 'peek', size: 'small', purpose: 'hint'},
      // This wording follows the recorded master exactly. Extra copy here
      // makes the bubble reveal words that Swiftee never says.
      say: 'Hmm\u2026 The sides look suspiciously alike. Let\u2019s check!',
      stage: { kind: 'polygon', sides: 5, room: 'measure' },
      beats: [
        { stage: { kind: 'polygon', sides: 5, room: 'measure', enter: 'pop' } },
        // THREE BEATS, THE WAY A COMEDIAN WOULD SAY IT: "Hmm…" on its own,
        // squinting at the shape; then the suspicion, whole ("The sides look
        // suspiciously alike."); then "Let's check!" — and the magnifying
        // glass comes out ON those words (faces), not after the line.
        { swiftee: 'inspect' },
        { say: 'Hmm\u2026 The sides look suspiciously alike. Let\u2019s check!', parts: ['Hmm\u2026', 'The sides look suspiciously alike.', 'Let\u2019s check!'], faces: [null, 'question', 'investigate'], vo: 'p28' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'measure-sides', page: 29,
      swiftee: { pos: 'corner', size: 'tiny', purpose: 'demo' },
      // THE DECK'S INSTRUCTION, WORD FOR WORD. This screen said "Tap a side.
      // I'll measure it!", which is in neither the script nor the list of
      // instructions — a line the build wrote for itself.
      instruction: 'Tap the sides to measure them.',
      // The same pentagon as the screen before, built again under the
      // wipe: he waits inside this card, so it sits in the middle, where
      // the one he stood beside sat to the right.
      stage: { kind: 'polygon', sides: 5, room: 'measure' },
      beats: [
        { stage: { kind: 'polygon' } },
        { instruction: 'Tap the sides to measure them.', vo: 'p29i' },
        { swiftee: 'inspect' },
        { focus: 'polygon.sides', style: 'pulse' },
        // Each tap reveals that side's length. Lengths come from
        // Poly.sideLengths on the live geometry. Completes when all five
        // have been tapped; there is no wrong tap on this screen.
        { input: { type: 'tap-each', targets: 'sides', reveal: 'length', count: 5 } },
        { feedback: [{ sfx: 'correct' }, { swiftee: 'proud' }] }
      ],
      perTap: { correct: [{ sfx: 'tick' }, { juice: 'pop', target: 'side' }] }
    },

    {
      id: 'sides-equal', page: 30,
      swiftee: { pos: 'corner', size: 'tiny', purpose: 'celebrate' },
      instruction: null,
      // FLAG: on this deck page the instruction card already reads "Tap the
      // angles..." while Swiftee is still concluding the SIDES check. The
      // card is held on the sides instruction until the line finishes, then
      // swapped — otherwise the child is told to do two things at once.
      // This wording follows the recorded master exactly. The more expansive
      // deck copy cannot be highlighted word-for-word against this take.
      say: 'Every side is equal. But what about the angles?',
      original: 'Equal sides! Now tap the angles.',
      beats: [
        { instruction: null },
        { swiftee: 'nod' },
        { say: 'Every side is equal. But what about the angles?', parts: ['Every side is equal.', 'But what about the angles?'], vo: 'p30' },
        { swiftee: 'think' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'measure-angles', page: 31,
      swiftee: { pos: 'corner', size: 'tiny', purpose: 'celebrate' },
      say: 'The angles match too!',
      beats: [
        // THE INSTRUCTION BELONGS TO THE SCREEN THAT TAKES IT. It was on the
        // screen before, which only offers a Next button: the child was told
        // to tap the angles on a screen where tapping an angle does nothing.
        { instruction: 'Tap the angles to measure them.', vo: 'p31i' },
        { focus: 'polygon.vertices', style: 'pulse' },
        // NOT the side-measuring walk (that is the sides' own, and protected):
        // for the angles he takes out the magnifying glass and examines them
        // with the child, and holds it while they tap
        { swiftee: 'examine' },
        // Each tap fills a green arc at that corner (as page 31 shows) and
        // reveals the angle from Poly.interiorAngles. Completes on five.
        { input: { type: 'tap-each', targets: 'angles', reveal: 'arc', count: 5 } },
        // the measuring is done and it all matches: heart eyes
        { swiftee: 'delight' },
        { say: 'The angles match too!', vo: 'p31' },
        { input: { type: 'tap-anywhere' } }
      ],
      perTap: { correct: [{ sfx: 'tick' }, { juice: 'pop', target: 'angle' }] }
    },

    {
      id: 'distort', page: 32, panel: 1,
      // ON THE MEASURING SLAB, where the sides and angles were just measured:
      // he waits in its corner, small, and the readings have the width of the
      // slab to change in. Beside one card they crowded the shape.
      swiftee: { pos: 'corner', size: 'tiny', purpose: 'demo' },
      instruction: 'Drag the highlighted vertex.',
      say: 'Help me stretch this corner. Let’s see what happens to the sides and angles.',
      // Built again under the wipe: he is back on the ground at the left,
      // so the card goes back to the right.
      stage: { kind: 'polygon', sides: 5, room: 'measure', highlight: { vertex: 0, color: 'yellow' }, measurements: 'live' },
      beats: [
        { stage: { kind: 'polygon' } },
        { say: 'Help me stretch this corner. Let’s see what happens to the sides and angles.', parts: ['Help me stretch this corner.', 'Let\u2019s see what happens', 'to the sides and angles.'], vo: 'p32a' },
        { instruction: 'Drag the highlighted vertex.', vo: 'p32ai' },
        { focus: 'polygon.vertex.0', style: 'pulse' },
        // "let's see what happens" — curious, before the child pulls
        { swiftee: 'curious', at: 'polygon.vertex.0' },
        // Completes once the shape is no longer regular by measurement,
        // with a minimum displacement so a nudge does not end the screen.
        { input: { type: 'drag-vertex', vertex: 0, until: 'irregular', minMove: 24, clamp: 'simple', live: 'measurements' } },
        // the numbers changed: a quick "oh!" of discovery
        { feedback: [{ sfx: 'slideWhistle' }, { juice: 'wobble', target: 'polygon' }, { swiftee: 'discover' }] }
      ]
    },

    {
      id: 'stayed-changed', page: 32, panel: 2,
      swiftee: { pos: 'corner', size: 'tiny', purpose: 'ask' },
      instruction: 'Are the sides and angles still equal?',
      say: 'It’s still a pentagon. But are the sides and angles still equal?',
      stage: { choices: ['Still equal', 'Not equal'] },
      beats: [
        { instruction: null },
        // the answers are held until the question reaches "equal", its last word
        { stage: { choices: ['Still equal', 'Not equal'], cue: { 'Still equal': 'equal', 'Not equal': 'equal' } } },
        { swiftee: 'think' },
        { say: 'It’s still a pentagon. But are the sides and angles still equal?', parts: ['It\u2019s still a pentagon.', 'But are the sides', 'and angles still equal?'], vo: 'p32b' },
        // the script's last two bubbles are the instruction: it settles into
        // one question over the answers, and is not said a second time
        { instruction: 'Are the sides and angles still equal?', vo: 'p32bi' },
        { input: { type: 'choice', correct: 'Not equal' } },
        { branch: true, until: 'correct',
          on: { correct: correct() },
          otherwise: WRONG.concat([{ input: { type: 'choice', correct: 'Not equal', retry: true } }]) }
      ]
    },

    {
      id: 'regular-vs-irregular', page: 32, panel: 3,
      instruction: null,
      // NOT top-left on this one. The panels start at 178 of a 1000 stage, so the
      // band above them is the only full-width place the line can go — and he
      // was standing in it, carving it below the height a bubble needs and
      // pushing the sentence into a side column four rows deep. The checks sit
      // under the panels and start at 194, so the foot of the left margin is
      // ABOVE. The pair fills the middle and its checks fill the foot, so
      // the band above them is the only place a sentence fits.
      swiftee: { pos: 'peek', size: 'small', purpose: 'concept'},
      say: 'All sides AND all angles same: regular. Otherwise, it\u2019s irregular.',
      stage: {
        kind: 'compare',
        // each name tag on its word; the irregular one is the pentagon the
        // child stretched a screen ago (made), the stock stretch without it
        left:  { sides: 5, caption: 'Regular pentagon',   tone: 'regular', captionCue: 'regular' },
        right: { sides: 5, stretch: 0, made: 'irregular', caption: 'Irregular pentagon', tone: 'irregular', captionCue: 'irregular' }
      },
      beats: [
        { instruction: null },
        { stage: { kind: 'compare', enter: 'split' } },
        { sfx: 'menuWhoosh' },
        { wait: 300 },
        // a rule goes in the book
        { swiftee: 'note' },
        { say: 'All sides AND all angles same: regular. Otherwise, it\u2019s irregular.', parts: ['All sides AND all angles same:', 'regular.', 'Otherwise, it\u2019s irregular.'], vo: 'p32c' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'sort-regular', page: 33,
      // ABOVE THE ZONES. They reach both edges and the direction hint takes
      // the floor, so the top band is the only place a line fits — in the
      // near corner he was four hundred and sixty pixels from it. (With no
      // purpose, game.js markFor sends him behind the card in hand: 'peek'.)
      swiftee: { pos: 'top-left', size: 'small' },
      say: 'Where does this polygon belong?',
      // The deck's own mechanic for this page. It was swapped for drag-to-bin
      // once, on the argument that one sorting gesture across the game is
      // easier to learn than two — see originalMechanic below, which has
      // recorded the swipe all along — and has now been asked back.
      //
      // The argument for the swap was not wrong about consistency and was
      // wrong about the question. Page 27 asks "which pile does each of these
      // belong in", and drag-to-bin fits it: several shapes, two destinations,
      // a journey for each. This page asks "this one — left or right?" of one
      // shape at a time, and a binary property is better answered by a binary
      // gesture than by a journey. The two mechanics now mark two different
      // kinds of question rather than two ways of doing the same one.
      //
      // FIVE ROUNDS, ONE SHAPE AT A TIME, in this order. They are chosen so
      // that between them they cover what "regular" actually requires:
      //
      //   1 pentagon                      all equal      -> REGULAR
      //   2 irregular-quad                neither equal  -> IRREGULAR
      //   3 hexagon                       all equal      -> REGULAR
      //   4 stretched-hexagon             sides unequal  -> IRREGULAR
      //   5 equilateral-concave-hexagon   SIDES EQUAL,
      //                                   angles unequal -> IRREGULAR
      //
      // The fifth is the one the whole page exists for: equal sides alone do
      // not make a polygon regular. The second used to be a rhombus, which
      // has equal sides and unequal angles — the fifth's property, taught
      // twice, leaving "neither equal" never shown at all.
      //
      // Nothing here declares the answers. Poly.isRegular runs on each card's
      // live vertices, so the colours mean nothing and redrawing a shape moves
      // its answer with it.
      stage: {
        kind: 'swipe-sort',
        zones: [{ id: 'regular', label: 'Regular' }, { id: 'irregular', label: 'Irregular' }],
        // Four regular and four irregular, dealt turn about, so the child
        // cannot ride one answer: every second card changes the rule.
        // A RECTANGLE, NOT THE STAR. Each card carries its own measurements,
        // and a star is ten sides and ten corners — five of them 247°, all
        // crowding the middle — which is clutter, not evidence. The rectangle
        // makes the same point more plainly: all four angles match and the
        // sides do not, so it is irregular (the rhombus is the other way round).
        items: ['pentagon', 'rhombus', 'triangle', 'stretched-hexagon', 'square', 'rectangle', 'hexagon', 'l-shape']
      },
      originalMechanic: 'swipe',
      beats: [
        // Clear the card first. Without this the instruction from the screen
        // before stays up — "Drag the highlighted vertex." over a screen that
        // asks the child to swipe — because the card is only ever replaced,
        // never emptied, by a screen that does not set one.
        { instruction: null },
        { stage: { kind: 'swipe-sort', enter: 'stagger' } },
        { say: 'Where does this polygon belong?', vo: 'p33' },
        { swiftee: 'observe', at: 'sort.item' },
        // (praise: false — the finale below is his cheer; a "Well done!" first
        // would bring him up behind a card that is no longer there)
        { input: { type: 'swipe', until: 'all-classified', praise: false } },
        // ALL SORTED. The card he peeked from has gone; he jumps up into the
        // empty middle, whole, between the two piles, and cheers there.
        { swiftee: 'enter', from: 'below', quick: true, to: 'middle', size: 'medium' },
        { feedback: milestone([{ sfx: 'levelUp' }, { juice: 'confetti', target: 'stage' }]) }
      ],
      perTap: { correct: [{ sfx: 'correct' }, { juice: 'pop', target: 'item' }],
                wrong:   [{ sfx: 'wrong' }, { juice: 'refuse', target: 'item' }, { swiftee: 'oops' }] }
    },

    /* ================================================================ *
     * THE END-GAME SUMMARY — everything the lesson taught, collected
     *
     * Not a page of the deck: the deck ends by having the child build a
     * pentagon, and the lesson now ends on a recap instead, at the author's
     * request. One large card at a time: the idea animates on it, he rises
     * from behind it to say it in one short line, sinks back, and the card
     * shrinks into the collection at the edge of the screen. After the
     * eighth, the collection gathers in, he jumps into the open middle, and
     * the lesson ends the way it always has (game.js finish()). The ideas
     * are data (SUMMARY, above); summaryBeats() makes the beats.
     * ================================================================ */

    {
      id: 'summary', page: 37,
      // BEHIND THE CARD, AT THE MIDDLE OF ITS TOP EDGE — the same place for
      // every card (game.js peeksBehind, Stage.peekAnchor), clear of what it shows
      // small, as behind the swipe card: head and shoulders over the rim,
      // and the band above him free for his line
      swiftee: { pos: 'peek', size: 'small', purpose: 'celebrate' },
      instruction: null,
      say: SUMMARY[0].text,
      lines: SUMMARY.slice(1).map(function (c) { return c.text; }).concat([SUMMARY_DONE.text]),
      stage: { kind: 'summary', concepts: SUMMARY.map(function (c) { return { id: c.id, label: c.label, animation: c.animation }; }) },
      beats: summaryBeats(SUMMARY)
    }
  ];

  /* ------------------------------------------------------------------ *
   * Pages that are NOT screens
   * ------------------------------------------------------------------ */

  var NOT_SCREENS = {
    34: 'Design reference card (five labelled shapes). Not a game screen. ' +
        'FLAG: verify item 5 — it is captioned "Irregular hexagon" but the ' +
        'drawn shape appears to have more than six vertices.',
    36: 'Third-party reference image (SplashLearn watermark). Reference ' +
        'only. Must not ship in the build.'
  };

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */

  var byId = {};
  SCREENS.forEach(function (s, i) { byId[s.id] = s; s.index = i; });

  function flags() {
    var out = [];
    SCREENS.forEach(function (s) {
      if (s.original) out.push({ page: s.page, id: s.id, kind: 'dialogue', from: s.original, to: s.say });
      if (s.originalInstruction !== undefined) out.push({ page: s.page, id: s.id, kind: 'instruction', from: s.originalInstruction, to: s.instruction });
      if (s.originalMechanic) out.push({ page: s.page, id: s.id, kind: 'mechanic', from: s.originalMechanic, to: s.stage.mechanic });
    });
    out.push({ page: 15, id: 'hexagon-your-turn', kind: 'sequence', note: 'pentagon -> hexagon -> pentagon; move or remove' });
    out.push({ page: 15, id: 'hexagon-your-turn', kind: 'answer-leak', note: 'dashed ghosts of all three answers removed' });
    out.push({ page: 34, kind: 'verify', note: NOT_SCREENS[34] });
    out.push({ page: 36, kind: 'do-not-ship', note: NOT_SCREENS[36] });
    return out;
  }

  /** Every line Swiftee says, in order, for the VO script — a screen's own
   *  line and any further ones it declares in `lines` (said in a branch). */
  function voScript() {
    var out = [];
    var find = function (list, text) {
      var vo = null;
      (function walk(bs) {
        (bs || []).forEach(function (b) {
          if (!b || typeof b !== 'object') return;
          if (b.say === text && b.vo) vo = b.vo;
          if (b.on) Object.keys(b.on).forEach(function (k) { walk(b.on[k]); });
          if (b.otherwise) walk(b.otherwise);
          if (b.feedback) walk(b.feedback);
          if (b.parallel) walk(b.parallel);
        });
      }(list));
      return vo;
    };
    SCREENS.forEach(function (s) {
      if (s.say) out.push({ page: s.page, id: s.id, vo: find(s.beats, s.say), text: s.say });
      (s.lines || []).forEach(function (t) { out.push({ page: s.page, id: s.id, vo: find(s.beats, t), text: t }); });
    });
    return out;
  }

  /* SWIFTEE IS A LEARNING BUDDY, NOT A CAST MEMBER.
 *
 * A screen's `swiftee` block places him; only a block with a `purpose`
 * SHOWS him. Eleven screens have one — his introduction, the five moments a
 * concept is defined, the "whoa", the "suspicious" hint, the first success
 * and the finale. On the other twenty-eight he stays off and the line he
 * used to say is delivered by the instruction plank instead: same words,
 * same order, no bird. He was on every screen and had stopped meaning
 * anything by the fourth.
 *
 *   purpose: 'introduce' | 'concept' | 'hint' | 'surprise' | 'celebrate' | 'demo'
 *
 * Where he stands when he is on: 'peek' is behind the top-left rim of the
 * slab, head and shoulders over it — the mark for every line spoken beside
 * a card while the plank is empty. 'corner' is on the snow at the slab's
 * bottom-left: for the measuring run, where he flies off it to each side, and
 * for the two screens after it, where the plank stays up with an instruction
 * and a head over the rim would sit under it. The intro, with no slab, keeps
 * 'left'. On the two definition screens he speaks FIRST, over the compared
 * pair, and the plank carries the rule only once his line has been read, so
 * the bubble and the plank never want the same band.
 */
/* WHO SAYS A LINE.
 *
 * A line that addresses the child — "I", "we", "you", "let's", "help me",
 * "see", "look", "they" — is a person talking, and the person is Swiftee:
 * he pops up from behind the card, says it, and drops back. A line that
 * merely states or instructs — "Pick any vertex." "Both are pentagons." —
 * is the plank's. A screen is his if it has a purpose, or if any line on it
 * talks to the child. */
var SPEAKS = /\b(i|i'll|i'm|i\u2019ll|i\u2019m|we|we'll|we\u2019ll|let's|let\u2019s|you|your|me|us|they|see|look|help)\b/i;
function speaks(screen) {
  if (!screen) return false;
  var lines = [];
  if (typeof screen.say === 'string') lines.push(screen.say);
  (screen.beats || []).forEach(function (b) { if (b && typeof b.say === 'string') lines.push(b.say); });
  return lines.some(function (t) { return SPEAKS.test(t); });
}
/* Does the screen have a line to SAY at all? "This is a side of the
   polygon." addresses nobody, but it is still said, not ordered: the plank
   is for instructions ("Pick any vertex."), and a statement read off a
   plank is a caption. So any screen with a say line is his to speak. */
/* An ORDER is the plank's even when the deck writes it as a say line:
   "Pick any vertex." is an instruction, and read from his beak and then
   again from the plank it is said twice. */
var IMPERATIVE = /^(pick|drag|tap|draw|sort|choose|swipe|count|connect|move|pull|press|select|find|put|match|build|drop|place|touch|click|measure|compare|turn)\b/i;
function isOrder(text, screen) {
  var t = String(text || '').trim();
  if (!t) return true;
  if (screen && screen.instruction && t === String(screen.instruction).trim()) return true;
  return IMPERATIVE.test(t);
}
function saysAnything(screen) {
  if (!screen) return false;
  if (typeof screen.say === 'string' && screen.say && !isOrder(screen.say, screen)) return true;
  return (screen.beats || []).some(function (b) { return b && typeof b.say === 'string' && b.say && !isOrder(b.say, screen); });
}
function wantsBuddy(screen) {
  return !!(screen && screen.swiftee && screen.swiftee.purpose) || speaks(screen) || saysAnything(screen);
}

/* WHAT THE STAGE SHOWS BY THE END OF SCREEN i. Most screens carry the scene
   over from the one before and only some rebuild it, so the kind of scene a
   screen is about is the last one declared at or before it. */
function sceneKindAt(i) {
  var kind = null;
  for (var k = 0; k <= i && k < SCREENS.length; k++) {
    var s = SCREENS[k];
    if (s.stage && s.stage.kind) kind = s.stage.kind;
    (s.beats || []).forEach(function (b) { if (b && b.stage && b.stage.kind) kind = b.stage.kind; });
  }
  return kind;
}

/* HE INSTRUCTS FROM THE ICE — OR FROM THE AIR OVER IT. On a screen with one
   card, or two, there is empty ice at the left for him to stand on; on the
   sorting screens there is no floor at all and he hovers in the corridor
   between the tray and the bins. Either way he is beside the lesson and
   looking at it, so every line on such a screen, instructions included, is
   his and no plank is shown. The plank is for the layouts where he is not
   there to say it: the option grid and the swipe zones. */
function speaksAll(i) {
  // NOT WHEN HE IS NOT THERE. Page 26 sends him off the screen so the child
  // has the whole shape to drag, and the rule still handed him the line: a
  // speech bubble with no speaker, placed against the last mark he stood on,
  // which on that screen is eight hundred pixels from the words. The plank
  // carries the line on a screen he has left.
  var s = SCREENS[i];
  if (s && s.swiftee && s.swiftee.pos === 'off') return false;
  var kind = sceneKindAt(i);
  return kind === 'polygon' || kind === 'compare' || kind === 'builder' || kind === 'sort' || kind === 'summary';
}
function wantsBuddyAt(i) {
  return wantsBuddy(SCREENS[i]) || speaksAll(i);
}

global.Screens = {
  speaks: speaks,
  wantsBuddy: wantsBuddy,
  sceneKindAt: sceneKindAt,
  speaksAll: speaksAll,
  wantsBuddyAt: wantsBuddyAt,
    list: SCREENS,
    byId: byId,
    notScreens: NOT_SCREENS,
    flags: flags,
    voScript: voScript,
    WRONG: WRONG
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.Screens;

})(typeof window !== 'undefined' ? window : this);
