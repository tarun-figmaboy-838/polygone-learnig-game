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
  // A WRONG CARD BUZZES (Level 1 — the user: "brief red glow, short buzz/shake"): a quick small
  // shiver of the card itself, clearer than the nudge but never a telling-off, under its red
  // glow, with the miss sound — and then the explanation (game.js CLUES)
  var BUZZ = [
    { juice: 'buzz', target: 'answer' },
    { sfx: 'wrong' },
    { swiftee: 'oops' },
    { wait: 400 }
  ];

  // What a diagonal is, said after "Try again!" on EVERY wrong line where the
  // child draws them (`after`: the miss it starts on — the first, since the
  // Part 1 review: the rule is the clue, not a reward for failing twice). It
  // says "vertices" where page 13's definition says "sides" — see the note there.
  var DIAGONAL_RULE = { say: 'A diagonal connects non-adjacent vertices.', vo: 'p14r', after: 1 };

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
  function correct(extra, face, o) {
    extra = extra || [];
    var sounds = extra.some(function (b) { return b && b.sfx; });
    // CONFETTI ONLY AT A MILESTONE (o.burst — the animation review: "confetti only when
    // appropriate, especially major completion"). An ordinary right answer is the glow, the
    // chime and his face; a level's last answer (milestone) throws the burst.
    var bursts = !!(o && o.burst === true) && !extra.some(function (b) { return b && b.juice === 'confetti'; });
    return [{ juice: 'collect', target: 'answer' }]
      .concat(sounds ? [] : [{ sfx: 'correct' }])
      .concat(bursts ? [{ juice: 'confetti', target: 'answer', count: 20, fromEdge: true }] : [])
      .concat(extra)
      .concat([{ swiftee: face || 'happySmall' }, { wait: FEEDBACK_MS }]);
  }
  function milestone(extra, face) { return correct(extra, face || 'celebrate', { burst: true }); }

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
    { id: 'vertex',    label: 'Vertex',    text: 'A vertex is a corner where two sides meet.',                          vo: 'p37a' },
    { id: 'side',      label: 'Side',      text: 'A side is a straight line joining two vertices.',                     vo: 'p37b' },
    { id: 'angle',     label: 'Angle',     text: 'An angle is formed where two sides meet.',                            vo: 'p37c' },
    { id: 'diagonal',  label: 'Diagonal',  text: 'A diagonal joins two non-adjacent vertices.',                         vo: 'p37d' },
    { id: 'convex',    label: 'Convex',    text: 'In a convex polygon, all diagonals stay inside.',                     vo: 'p37e' },
    { id: 'concave',   label: 'Concave',   text: 'In a concave polygon, atleast one diagonal goes outside.',           vo: 'p37f' },
    { id: 'regular',   label: 'Regular',   text: 'A regular polygon has all sides and all angles equal.',               vo: 'p37g' },
    { id: 'irregular', label: 'Irregular', text: 'If the sides or angles are not all equal, the polygon is irregular.', vo: 'p37h' }
  ];
  var SUMMARY_DONE = { text: 'Amazing! You explored all these polygon ideas!', vo: 'p37i' };
  var SUMMARY_OPEN = { text: 'Let’s recall what we learned today.', vo: 'p37o' };

  function summaryBeats(list) {
    var out = [{ instruction: null }, { stage: { kind: 'summary' } }];
    /* THE RECAP OPENS IN HIS VOICE (the user's recording: "Let's recall what we learned today."):
       up into the open middle before the first card comes in, and back down — at his summary
       size, small, so the first card brings him up behind it exactly as before */
    out.push(
      { swiftee: 'enter', from: 'below', quick: true, to: 'middle', size: 'small' },
      { say: SUMMARY_OPEN.text, vo: SUMMARY_OPEN.vo },
      { swiftee: 'exit', to: 'below' }
    );
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
      /* THEN IT IS THEIRS TO LOOK BACK AT (the final pass): once every explanation has been
         given, Next appears, and a tap on any card replays that card's idea and its line — one at
         a time, the others resting — until Next goes on to the game's own ending (game.js
         reviewSummary, then finish()). Each card's line is carried here so the replay says
         exactly what the card first said. */
      { input: { type: 'summary-review', cards: list.map(function (c) { return { id: c.id, say: c.text, vo: c.vo }; }) } }
    );
    return out;
  }

  var SCREENS = [

    /* ================================================================ *
     * INTRO — pages 1–3
     * ================================================================ */

    {
      id: 'intro-hi', page: 1,
      // THE CLOSE SHOT (the MASTER brief §1): the opening lines are filmed close on him, the
      // painting soft behind him (game.js setCam). The log is already on the ground at his left
      // (the user: "it should already exist naturally") — mostly outside the close shot, until
      // the camera draws back to it
      camera: 'close',
      log: true,
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
        // ("But for that, first you need to learn about polygons." is gone from here: Swiftee says
        // it in Frozen Rush now, flying in at the broken path just before this screen — the same
        // recording, sw-help in that game's voice track; the user)
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'intro-remember', page: 2,
      // THE CLOSE SHOT (the MASTER brief §1): the opening lines are filmed close on him, the
      // painting soft behind him (game.js setCam). The log is already on the ground at his left
      // (the user: "it should already exist naturally") — mostly outside the close shot, until
      // the camera draws back to it
      camera: 'close',
      log: true,
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
      camera: 'close',   // still close; it draws back at the end of this screen (below)
      log: true,
      swiftee: { pos: 'left', size: 'large', purpose: 'concept'},
      say: 'Polygons are closed shapes made from straight lines.',
      beats: [
        // "Ta-da — here is the idea": one open-winged flourish, then talking
        { swiftee: 'present' },
        { say: 'Polygons are closed shapes made from straight lines.', parts: ['Polygons are closed shapes', 'made from straight lines.'], vo: 'p03' },
        // ONTO THE LOG (the user's spec, and the MASTER brief §2): the third line said to its
        // end, a breath, then the camera draws back to the whole scene in one move — the log
        // coming into view on the ground at his left, where it has been all along — a beat to
        // see it, then a real flight onto it (wings going, one curve, easing down), a small
        // squash, and a moment perched there before the first question comes
        { wait: 600 },
        { stage: { camera: 'wide', ms: 1000 } },
        { wait: 250 },
        { swiftee: 'perch' },
        { input: { type: 'tap-anywhere', pause: 650 } }
      ]
    },

    /* ================================================================ *
     * WHICH ARE POLYGONS — page 4
     * ================================================================ */

    {
      id: 'which-polygons', page: 4,
      transition: false,   // straight on from the intro: no ice between the definition and the first question
      log: true,
      // ON THE LOG, where the intro left him: no wipe, no walk — the options
      // simply appear on his right and he asks about them from his perch.
      swiftee: { pos: 'log', size: 'large', purpose: 'ask' },
      say: 'Which of these are polygons?',
      // A MISS IS ANSWERED WITH THE LESSON, THE FIRST TIME (the user's bug list: "do not make
      // the student fail twice before receiving the useful explanation"). The card glows red
      // and buzzes, and he says "Not quite." and what is true of THAT shape — the circle is
      // curved, the path is open (game.js CLUES, by the card's `reason`). The card stays in
      // play; a SECOND miss on the same card says it again and puts the card out, dimmed and
      // still readable, for the rest of the question (the user: "disable after the 2nd wrong
      // attempt" — outAfter: 2).
      stage: {
        kind: 'choice-grid',
        options: [
          { id: 'pentagon', shape: 'pentagon', correct: true },
          // (each wrong card's own clue on its first miss — game.js CLUES)
          { id: 'circle',   shape: 'circle',   correct: false, reason: 'curved' },
          { id: 'open',     shape: 'open-path', correct: false, reason: 'open' },
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
        // "Keep going!" for the first polygon found, "Great job!" for the one that completes
        // the level (game.js PRAISE_FOR) — not a "Great job!" for every card
        { input: { type: 'multi-select', until: 'all-correct-selected', outAfter: 2, cheer: { more: 'keepGoing', last: 'levelDone' } } },
        // no second burst when the last polygon is found: its own press already threw one — and
        // no lift of the card either (the user: "the second correct tap pops the card"): the
        // halo is the verdict; his face and a breath end the level
        { feedback: [{ swiftee: 'happySmall' }, { wait: FEEDBACK_MS }] }
      ],
      /* EVERY RIGHT CARD CELEBRATES ITSELF, as it is pressed: it glows green, pops, rings and
         throws a burst of confetti from behind its own edges — one burst per card, only from
         the card that was pressed (a found card cannot be pressed again). A wrong card glows
         red and shrinks back. */
      // (no pop on the card — the user: the verdict is the glow, stage.js optionCard _mark)
      // A SHORT THROW, FROM THIS CARD ONLY (the user: "when I tap a card, only that card should
      // burst confetti, not the others too"): at full speed the pieces flew three or four cards
      // away and fell across the ones below, so the burst read as coming from all of them.
      perTap: { correct: [{ sfx: 'correct' },
                          { juice: 'confetti', target: 'option', count: 26, fromEdge: true, speed: 0.3 }],
                wrong:   BUZZ }
    },

    /* ================================================================ *
     * SIDE → DIAGONAL — pages 5–13
     * ================================================================ */

    {
      id: 'lets-play', page: 5,
      // LEVEL 2 LAYOUT (the user): he stays on the log at the left, with his line; the card is
      // on the right, and stays there, the same size, for the whole level
      log: true,
      swiftee: { pos: 'log', size: 'medium' },
      say: 'Let\u2019s play with this one.',
      // ONE PLACE FOR THE CARD FOR THE WHOLE LEVEL (the user: "keep the card at the same scale
      // and the same X/Y"): the right-hand slab, built here and never moved or resized after it
      stage: { kind: 'polygon', sides: 5, panel: 'right' },
      beats: [
        { stage: { kind: 'polygon', sides: 5, panel: 'right', enter: 'fade' } },   // (no card pop — the user)
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
      // LEVEL 2 LAYOUT (the user): he stays on the log at the left, with his line; the card is
      // on the right, and stays there, the same size, for the whole level
      log: true,
      swiftee: { pos: 'log', size: 'medium' },
      say: 'Select any vertex.',
      beats: [
        // THE CORNERS ARE UP BEFORE THE LINE, and its word "vertex" swells them one after
        // another (the user); the input after it makes them touchable (stage.js vertex-pick)
        { stage: { dots: true } },
        { say: 'Select any vertex.', vo: 'p06' },
        { swiftee: 'point', at: 'polygon' },
        // any corner is right, so it is not praised as an answer: the pop,
        // the nod, and straight on to "Let’s connect it to another vertex."
        { input: { type: 'vertex-pick', praise: false } },
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
       *   SIDE      (the Screen 7 vertex brief) the preview line goes and the
       *             side is the polygon's own edge, looking like every other;
       *             its end is disabled on the drop; its tag pops on the word
       *             "side", and he says so in full; a readable pause; the tag
       *             fades; "Let’s connect it to a different vertex." — and the
       *             same corner, still the anchor, draws again. BOTH neighbours
       *             are sides, one after the other; only then are the far
       *             corners places a line may go. A side is not a wrong answer
       *             — it is the first thing there is to learn — so no wrong
       *             sound, no "oops", and it does not count as a miss.
       *   DIAGONAL  the line stays and glows, the right-answer sound, the
       *             instruction goes, and he cheers it: "Yay! You made a
       *             diagonal!", its tag on the word. No stock "Nice!" before
       *             it (praise: false) — one cheer, one voice.
       *
       * Nothing can be drawn while a line is being said: the input is only
       * armed after each instruction has been heard out (the say/instruction
       * handlers wait for the voice, and a tap cannot cut it), and the stage
       * refuses a line outside its READY states (stage.js setConnect; each
       * corner's own state, setVertexStates). until: 'correct' keeps asking
       * until the diagonal is made. */
      id: 'connect', page: 7,
      // LEVEL 2 LAYOUT (the user): he stays on the log at the left, with his line; the card is
      // on the right, and stays there, the same size, for the whole level
      log: true,
      swiftee: { pos: 'log', size: 'medium' },
      instruction: 'Let’s connect it to another vertex.',
      lines: ['This is a side of the polygon.', 'Yay! You made a diagonal!'],
      stage: { highlight: { vertex: 'picked', color: 'yellow' } },
      beats: [
        { stage: { highlight: { vertex: 'picked', color: 'yellow' } } },
        { instruction: 'Let’s connect it to another vertex.', vo: 'p07i' },
        // "what will you make?" — he leans to their corner, curious (the
        // pointing your-turn was the screen before's, and the same gesture
        // twice running is a loop, not a reaction)
        { swiftee: 'curious', at: 'picked' },
        { input: { type: 'draw-diagonal', from: 'picked', sides: true, praise: false } },
        { branch: true, until: 'correct',
          on: {
            // SIDE_COMPLETE / SECOND_SIDE_COMPLETE: named, its end disabled, and another try
            side: [
              { sfx: 'pop' },
              // the tag arrives on the word "side"
              { stage: { label: { text: 'Side', at: 'segment', arrow: true, enter: 'pop', cue: 'side' } } },
              { swiftee: 'discover' },
              { say: 'This is a side of the polygon.', vo: 'p09' },
              { wait: 1200 },
              // THE SIDE STAYS, ITS CORNER IS DONE WITH (stage.js freezeSide): only its tag goes;
              // the next try is any corner still open — the other neighbour (another side, named
              // the same way) or a far corner (the diagonal)
              { stage: { side: 'done' } },
              { instruction: 'Let’s connect it to a different vertex.', vo: 'p10i' },
              { swiftee: 'point', at: 'picked' },
              { input: { type: 'draw-diagonal', from: 'picked', sides: true, praise: false, retry: true } }
            ],
            // DIAGONAL_CREATED: the line is in, locked, and glowing (stage.js shimmer)
            correct: [
              { sfx: 'correct' },
              { juice: 'collect', target: 'answer' },
              { instruction: null },
              // on the word "diagonal", the tag that names it: beside the diagonal on the
              // figure, an arrow to it (the user: "label → arrow → the actual diagonal") — not a
              // tag under the card, which also made the card shrink to fit it
              { stage: { label: { text: 'Diagonal', at: 'diagonal', arrow: true, enter: 'pop', cue: 'diagonal' } } },
              { swiftee: 'celebrate' },
              // (the connecting step's last state: the diagonal is locked, and now explained)
              { stage: { connectState: 'EXPLANATION' } },
              { say: 'Yay! You made a diagonal!', vo: 'p12' }
            ]
          },
          // (nothing else can come back from this input — a line let go on no
          // corner goes home without a verdict — but if it did, it is asked
          // again, gently)
          otherwise: [{ swiftee: 'hint' }, { input: { type: 'draw-diagonal', from: 'picked', sides: true, praise: false, retry: true } }] },
        // (the success arm already took it down; said again so the card the
        // next screen inherits is plain from the storyboard)
        { instruction: null },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'define-diagonal', page: 13,
      // LEVEL 2 LAYOUT (the user): he stays on the log at the left, with his line; the card is
      // on the right, and stays there, the same size, for the whole level
      log: true,
      swiftee: { pos: 'log', size: 'medium', purpose: 'concept' },
      instruction: null,
      // THE SUPPLIED WORDING, AND A STANDING OBJECTION TO IT.
      //
      // A diagonal joins two non-adjacent VERTICES. It does not join sides —
      // the segment this very screen draws runs corner to corner, and the
      // child is watching it do so while the sentence says otherwise. This
      // was corrected to "vertices" once and the author then supplied "sides"
      // twice, in writing, with "do not modify my dialogue wording" — so it
      // said sides. On 2026-09-25 the author asked for "vertices" ("instead of
      // side, add vertices"), the word that is right: a diagonal joins two
      // corners. screens.test.js records the decision.
      say: 'A line segment joining two non-adjacent vertices is a diagonal.',
      beats: [
        // A DEFINITION IS WRITTEN DOWN: book and quill, the rig's 'writing'
        { swiftee: 'note' },
        { focus: 'diagonal.endpoints', style: 'pulse' },
        { say: 'A line segment joining two non-adjacent vertices is a diagonal.', parts: ['A line segment joining', 'two non-adjacent vertices', 'is a diagonal.'], vo: 'p13' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    /* ================================================================ *
     * MORE DIAGONALS — pages 14–16
     * ================================================================ */

    {
      id: 'another-diagonal', page: 14,
      // LEVEL 2 LAYOUT (the user): he stays on the log at the left, with his line; the card is
      // on the right, and stays there, the same size, for the whole level
      log: true,
      swiftee: { pos: 'log', size: 'medium' },
      instruction: 'Let’s draw another diagonal from the same vertex.',
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
      // (no "All diagonals are still inside." after it any more — the user: removed)
      // THE SECOND MISS IS ANSWERED WITH WHAT A DIAGONAL IS. The first wrong
      // line gets "Hmm, not quite." like any other; from the second on he
      // adds the rule the line broke — then the instruction comes back.
      remind: DIAGONAL_RULE,
      beats: [
        // HE ASKS, THEN THE INSTRUCTION STAYS. The instruction is the last
        // thing said before the child is let in, so the words in view while
        // they draw are what to do, not a question with half of it gone.
        // SAID ONCE: the line that echoed the instruction ("Can you draw another diagonal from here?") went —
        // the same request twice in a row read as a stutter, not a lesson.
        // (the first diagonal's name has been said and shown twice; it comes down before the
        // second is drawn, which could otherwise run across it)
        { stage: { label: null } },
        { instruction: 'Let’s draw another diagonal from the same vertex.', vo: 'p14i' },
        { swiftee: 'point', at: 'picked' },
        { input: { type: 'draw-diagonal', from: 'picked' } },
        // until: the retry is branched on, so a right second try still gets
        // the observation below — it used to skip straight to the next screen
        { branch: true, until: 'correct',
          on: { correct: correct([{ sfx: 'slice' }]) },
          otherwise: WRONG.concat([{ input: { type: 'draw-diagonal', from: 'picked', retry: true } }]) }
      ]
    },

    {
      id: 'hexagon-your-turn', page: 15,
      // LEVEL 2 LAYOUT (the user): he stays on the log at the left, with his line; the card is
      // on the right, and stays there, the same size, for the whole level
      log: true,
      swiftee: { pos: 'log', size: 'medium' },
      instruction: 'Let’s draw all the diagonals from this vertex.',
      say: 'Your turn! Let’s draw all the diagonals from this vertex.',
      // FLAG: two problems on this page.
      //  (1) Sequence: the lesson is on a pentagon on pages 5–14 and 16–20,
      //      and this page cuts to a hexagon for one screen, then back. It
      //      reads as a mistake. Recommended: move this screen to AFTER
      //      page 17 (once the pentagon's diagonals are fully explored) or
      //      to the end of the diagonals unit.
      //  (2) Answer leak: the deck draws all three diagonals as dashed
      //      ghosts on the "your turn" screen, so the exercise can be done
      //      by tracing. Section 2 of the brief forbids exactly this. The
      //      ghosts are removed here.
      // NO NAME TAG (the user: "remove the Hexagon name tag … do not replace it with another
      // shape-name tag; keep the polygon as the main visual focus"). The same slab, in the same
      // place, at the same size as the pentagon's.
      stage: { kind: 'polygon', sides: 6, panel: 'right', label: null, ghost: null },
      beats: [
        { stage: { kind: 'polygon', sides: 6, panel: 'right', enter: 'morph', label: null } },
        { sfx: 'pop' },
        // THE CORNERS ARE THERE BEFORE HE SPEAKS (the user, screen 10: "all vertex dots present
        // before the dialogue"), white, every one — and on "this VERTEX" the one he means changes
        // from white to the corner colour and starts to breathe, as the word is said (onWord
        // `knob`); the dots used to arrive only once the line was over and the drawing armed
        { stage: { dots: true } },
        { wait: 400 },
        { swiftee: 'encourage' },
        { stage: { onWord: [{ word: 'vertex', knob: 0, breathe: true }] } },
        { say: 'Your turn! Let’s draw all the diagonals from this vertex.', parts: ['Your turn!', 'Let’s draw all the diagonals', 'from this vertex.'], vo: 'p15' },
        // The instruction is the script's own last two bubbles, so it is not
        // said again: the line settles into the one sentence the child keeps
        // in view while they draw (game.js — an instruction that only repeats
        // what was just said is shown, not spoken).
        { instruction: 'Let’s draw all the diagonals from this vertex.', vo: 'p15i' },
        { focus: 'polygon.vertex.0', style: 'pulse' },
        { swiftee: 'step-back' },
        // Three diagonals from one hexagon vertex (n - 3). Each correct one
        // gets its own small reward; the screen completes on the third.
        // (sidesOk — a line to a NEIGHBOUR makes a side: it becomes the polygon's own edge, that
        // neighbour is disabled for good, the anchor stays — and, the task here being diagonals, it
        // is answered as a miss: the red glow on that corner, "Try again!" and the rule (the user:
        // "if user drag to the side vertex why do not add wrong glow and feedback?"; stage.js)
        { input: { type: 'draw-diagonals', from: 0, count: 3, sidesOk: true } },
        // EVERY DIAGONAL FROM ONE CORNER: a milestone, and the one place his
        // jumping-for-joy clip belongs
        { feedback: milestone([{ sfx: 'levelUp' }], 'excited') }
      ],
      perTap: { correct: [{ sfx: 'slice' }, { juice: 'pop', target: 'diagonal' }], wrong: WRONG },
      remind: DIAGONAL_RULE
    },

    {
      id: 'look-diagonals', page: 16,
      log: true,   // on the log arc at the left of the ground, as since the intro (the user: "after level-1, the log sit too")
      swiftee: { pos: 'log', size: 'medium' },
      // FLAG: the deck's instruction card on this page still reads "Draw
      // another diagonal from the same vertex." while the dialogue is "Look
      // at the diagonals of this pentagon." — a stale card from page 14.
      // This is a look-only screen, so the card is cleared.
      instruction: null,
      originalInstruction: 'Draw another diagonal from the same vertex.',
      // ONE LINE, NOT "Let's look." AND THEN "Look at…" (the user): the invitation and what to
      // look at are one sentence, said first; a breath; then the diagonals draw
      say: 'Let\u2019s look at the diagonals of this pentagon.',
      // The diagonals are NOT on the screen-level stage: they arrive by
      // their own beat, one after another, once the chapter's snow has
      // cleared — a shape that comes up already starred shows nothing.
      // AND NO "Diagonal" TAG UNDER THE CARD (the user: "I told you, no diagonal name tag
      // outside, below the card"): the screen-level stage carried one with no place to point
      // to, so a rebuild — a jump, a replay, a resize — printed it under the shape. The name
      // was taught on the connect screen, beside the line it names, and is not repeated here.
      stage: { kind: 'polygon', sides: 5 },
      beats: [
        { instruction: null },
        { stage: { kind: 'polygon', sides: 5, enter: 'morph' } },
        // the line first, a breath, and only then do the diagonals start to draw
        { say: 'Let\u2019s look at the diagonals of this pentagon.', parts: ['Let\u2019s look at the diagonals', 'of this pentagon.'], vo: 'p16b' },
        { wait: 450 },
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
        { swiftee: 'observe', at: 'polygon' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    /* ================================================================ *
     * INSIDE OR OUTSIDE → CONVEX / CONCAVE — pages 17–26
     * ================================================================ */

    {
      id: 'inside-or-outside', page: 17,
      // (THE QUESTION IS BACK — the user: "revert the activity of screen 11 inside and outside": the
      // two-button Inside / Outside question and its two tries, as it was before the one-button line)
      log: true,   // on the log arc at the left of the ground, as since the intro (the user: "after level-1, the log sit too")
      swiftee: { pos: 'log', size: 'medium' },
      instruction: 'Are the diagonals inside or outside?',
      lines: ['The diagonals are inside.'],
      // (no choices on the screen-level stage: the beats deal them on the question's words, and
      // a rebuild — a jump, a resize — must not put them up before the question)
      stage: { kind: 'polygon', sides: 5, diagonals: 'all' },
      beats: [
        // THE QUESTION FIRST, THEN THE ANSWERS (the user: never a button before the learner has
        // been introduced to it). The name tag from the screen before comes down; he asks — on
        // "inside" the shape's inside glows with its diagonals, on "outside" the band round it
        // (dual coding) — a beat to take it in, and only then are the two answers dealt.
        { stage: { label: null } },
        // THE ANSWERS ARRIVE ON THEIR WORDS (the user: "the buttons are delayed — when the VO says
        // 'are the diagonals inside or outside?'"): "Inside" is dealt as he says inside, "Outside"
        // as he says outside — introduced by the question itself, not after a pause behind it.
        // The question is still asked before either can be pressed (the input comes after).
        { parallel: [
          { instruction: 'Are the diagonals inside or outside?', vo: 'p17i' },
          { stage: { choices: ['Inside', 'Outside'], cue: true } }
        ] },
        // SAID ONCE: the line that echoed the instruction ("Are they inside or outside?") went —
        // the same request twice in a row read as a stutter, not a lesson.
        { swiftee: 'think' },
        /* TWO TRIES (the user, the inside/outside question). The first miss is "Try again!" and
           nothing more — the answer is not given away, both buttons stay. The second is taught:
           the diagonals light inside the shape, "The diagonals are inside.", and the two
           buttons merge into one "Inside" to tap on (below). */
        { input: { type: 'choice', correct: 'Inside' } },
        { branch: true,
          on: { correct: correct() },
          otherwise: WRONG.concat([
            { input: { type: 'choice', correct: 'Inside', retry: true, quietMiss: true } },
            { branch: true,
              on: { correct: correct() },
              /* THE SECOND MISS IS TAUGHT, AND THEN THE LESSON GOES ON BY ITSELF (the user, screen
                 12: "when VO says inside give the Inside option green and the other option gone …
                 why tap after giving the answer … make it auto"): the answers are locked (the
                 input is over — game.js), a short beat; "The diagonals are inside." — the
                 diagonals light gold on "diagonals" and stay lit, still dashed, inside the shape;
                 ON "inside" the two buttons become ONE centred green Inside (stage `merge` on its
                 word); a moment to see it, and on to the next screen. No tap, no third attempt,
                 no "Try again!" here. */
              otherwise: [
                { sfx: 'wrong' },
                { wait: 500 },
                { swiftee: 'explain', at: 'polygon' },
                // (ON THE WORD — the user: "not sync with vo?": the diagonals light gold as he says
                // "diagonals", a quick sweep; the inside of the shape glows on "inside" — dual coding)
                { stage: { onWord: [{ word: 'diagonals', lit: 'diagonals', each: 90 }] } },
                { stage: { merge: 'Inside', cue: 'inside' } },
                // (the beat ends on "inside.", not on the clip's silent tail)
                { say: 'The diagonals are inside.', vo: 'fb54', endsAt: 'words' },
                // (no chime: the answer is shown to them, not given by them — no verdict for it)
                { wait: 1400 }
              ] }
          ]) }
      ]
    },

    {
      id: 'lets-change', page: 18,
      log: true,   // on the log arc at the left of the ground, as since the intro (the user: "after level-1, the log sit too")
      swiftee: { pos: 'log', size: 'medium' },
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
      log: true,   // on the log arc at the left of the ground, as since the intro (the user: "after level-1, the log sit too")
      swiftee: { pos: 'log', size: 'medium' },
      instruction: 'Help me pull this vertex inside.',
      stage: { highlight: { vertex: 0, color: 'yellow' } },
      beats: [
        // THE ASK IS HIS: "Help me pull this vertex inside." — the deck's own
        // line, now the instruction itself (it replaced "Drag the vertex inward.")
        // (the point to pull comes up ON the word "vertex", not when the drag arms after the line)
        { stage: { onWord: [{ word: 'vertex', knob: 0 }] } },
        { instruction: 'Help me pull this vertex inside.', vo: 'p19i' },
        { focus: 'polygon.vertex.0', style: 'pulse' },
        // "what will happen?" — curious, leaning toward the corner, not the
        // winking your-turn he gave the screen before
        { swiftee: 'curious', at: 'polygon.vertex.0' },
        // Complete when the polygon becomes concave (Poly.classify), not
        // when the vertex crosses a pixel line. The drag is clamped with
        // Poly.clampSimple so it cannot become a bowtie.
        { input: { type: 'drag-vertex', vertex: 0, until: 'concave', live: 'diagonals' } },
        // A RIGHT ANSWER, AND IT SOUNDS LIKE ONE: the chime, the shape jiggles
        // into its dent, a burst from the corner that made it. The big "Whoa!"
        // is still the next screen's.
        { feedback: [{ sfx: 'correct' }, { juice: 'wobble', target: 'polygon' }, { juice: 'confetti', target: 'vertex', count: 18 }, { swiftee: 'happySmall' }] }
      ]
    },

    {
      id: 'whoa', page: 20,
      // (on the log, like the screens either side: this card has no rim to peek over)
      log: true,
      swiftee: { pos: 'log', size: 'medium', purpose: 'surprise' },
      say: 'Whoa! One of the diagonals went outside.',
      stage: { highlight: { diagonal: 'outside', color: 'red', style: 'dashed' } },
      beats: [
        { instruction: null },
        { swiftee: 'surprised' },
        { stage: { highlight: { diagonal: 'outside', color: 'red', style: 'dashed', enter: 'flash' } } },
        { sfx: 'honk' },
        // THE WORDS MATCH THE SHAPE (the final pass): the child's dent can send more than one
        // diagonal outside, and then it is "some", not "one" (director alt / game.js test)
        { say: 'Whoa! One of the diagonals went outside.', parts: ['Whoa! One of the diagonals', 'went outside.'], vo: 'p20',
          alt: { if: 'manyOutside', say: 'Whoa! Some of the diagonals went outside.', parts: ['Whoa! Some of the diagonals', 'went outside.'], vo: 'fb52' } },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    /* ================================================================ *
     * COMPARE THE DIAGONALS — pages 21–25, told as it is seen
     *
     * SEE → COMPARE → NOTICE → DISCOVER → NAME. Five lines, the author's
     * own, one per screen, each said while the thing it is about happens:
     *   1  "Let’s compare the diagonals in both the pentagons."  two bare
     *      pentagons; both answer "pentagons"
     *   2  "This one has all the diagonals inside."  the convex one's grow
     *      one at a time; its inside glows on "inside"
     *   3  "But this one has at least one diagonal outside."  the concave
     *      one's grow, and the one that leaves the shape is drawn on
     *      "outside" — lit, the part outside washed violet, a ring where it
     *      leaves, a whoop, and he is surprised. Then both side by side with
     *      a small INSIDE / OUTSIDE under each.
     *   4  "All diagonals inside means convex polygon."  CONVEX on "convex",
     *      in the INSIDE mark's place
     *   5  "At least one diagonal outside means concave polygon."  CONCAVE
     *      on "concave"; then the pair evenly, both names showing.
     * No name is shown before its discovery. Every diagonal is a real
     * vertex-to-non-adjacent-vertex segment, judged by polygon-math
     * (stage.js op.grow). Each screen first draws whatever an earlier one
     * would have (`instant`), so a jump or Back lands on the right picture.
     * ================================================================ */

    {
      id: 'compare', page: 21,
      log: true,   // (the log stays in the scene while he is elsewhere in it: it does not blink out between screens that share it)
      // Both panels sit across the middle and nothing is drawn under them on
      // this screen, so the whole foot of the stage is his — centre stage,
      // with the line directly over his head in the band he leaves.
      // Small: at medium his head reaches 46 units up into the compare panels.
      swiftee: { pos: 'log', size: 'medium' },
      instruction: null,
      say: 'Let\u2019s compare the diagonals in both the pentagons.',
      original: 'Both are pentagons.',
      // the concave one is the pentagon the child dented (made: stage.js
      // keeps it); the stock dent stands in when the screen is reached without it.
      // NO DIAGONALS YET: they are drawn as each card is talked about.
      // NO NAME TABS ON THE CARDS (the final pass: "remove the text tags … Concave Pentagon, Convex
      // Pentagon"): the shapes are the focus; which one he means is shown by the warm glow behind
      // the card he is talking about (focus) and by his pointing, and the concept is named under
      // it on its word (the Convex / Concave badges)
      stage: { kind: 'compare', left: { sides: 5 }, right: { sides: 5, dent: 0, made: 'concave' } },
      beats: [
        { instruction: null },
        // THE PAIR ARRIVES, THEN HE SPEAKS OF IT
        { stage: { kind: 'compare', enter: 'split' } },
        { sfx: 'menuWhoosh' },
        { wait: 400 },
        // "both the pentagons": the two shapes answer the word
        { stage: { onWord: { word: 'pentagons', pulse: 'both' } } },
        { parallel: [
          // COMPARING: he looks at one, then the other
          { swiftee: 'compare', at: ['compare.left', 'compare.right'] },
          { say: 'Let\u2019s compare the diagonals in both the pentagons.', vo: 'p21' }
        ] },
        { wait: 300 },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'all-inside', page: 22,
      log: true,   // on the log arc at the left of the ground, as since the intro (the user: "after level-1, the log sit too")
      // ON THE ICE AT THE LEFT. The pair begins at x 270, so the ground to
      // its left is his, and the bubble sits by his head wherever he stands
      // (game.js placeBubble). Hovering him in the corner read as floating.
      swiftee: { pos: 'log', size: 'medium' },
      say: 'This one has all the diagonals inside.',
      original: 'This one has all diagonals inside.',
      beats: [
        { instruction: null },
        // the other card steps back a little — still easy to see
        { focus: 'compare.left', style: 'lean' },
        // on "inside" its inside glows with its diagonals (emphasize), and a
        // small bright chime says so
        { stage: { onWord: { word: 'inside', sfx: 'sparkle', gain: 0.4 } } },
        // ...and its mark, INSIDE, comes up under it on the same word (not a screen later)
        { stage: { marks: { left: 'Inside', cue: true } } },
        { parallel: [
          // its diagonals grow one after another as he says it
          { stage: { grow: { card: 'left', each: 430, ms: 540 } } },
          { swiftee: 'observe', at: 'compare.left' },
          { say: 'This one has all the diagonals inside.', vo: 'p22' }
        ] },
        { wait: 300 },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      // page 24 in the deck, where it followed "convex"; the author moved it
      // ahead of the names, so the pages are numbered in the order they are met
      id: 'one-outside', page: 23,
      log: true,   // on the log arc at the left of the ground, as since the intro (the user: "after level-1, the log sit too")
      // On the ice at the left, like the screen before it.
      swiftee: { pos: 'log', size: 'medium' },
      // FLAG: punctuation. Deck line has no full stop.
      say: 'But this one has atleast one diagonal outside.',
      original: 'This one has at least one diagonal outside',
      beats: [
        { instruction: null },
        { stage: { grow: { card: 'left', instant: true } } },
        // (the left card's INSIDE mark, from the screen before — put back quietly on a jump)
        { stage: { marks: { left: 'Inside', enter: false } } },
        // the convex one back to normal, only less important
        { focus: 'compare.right', style: 'lean' },
        // OUTSIDE comes up under this one on the word "outside", with the diagonal that leaves
        { stage: { marks: { right: 'Outside', cue: true } } },
        { parallel: [
          // the ones that stay inside grow first; the one that leaves the
          // shape waits for its word (and he is surprised when it does)
          { stage: { grow: { card: 'right', each: 430, ms: 540, outsideOn: 'outside' } } },
          { swiftee: 'look', at: 'compare.right' },
          { say: 'But this one has atleast one diagonal outside.', vo: 'p23' }
        ] },
        // BOTH, SIDE BY SIDE: every diagonal still showing, a small mark
        // under each, and a moment to look
        { stage: { grow: { card: 'right', instant: true } } },
        { focus: 'compare', style: 'even' },
        { swiftee: 'compare', at: ['compare.left', 'compare.right'] },
        { wait: 1000 },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'convex', page: 24,
      log: true,   // (the log stays in the scene while he is elsewhere in it: it does not blink out between screens that share it)
      // On the ice at the left like the rest of the run (markFor): the pair
      // fills the middle and his line sits by his head.
      swiftee: { pos: 'log', size: 'medium', purpose: 'concept' },
      instruction: null,
      // FLAG: grammar. Deck: "That's convex polygon." The author's line
      // for this step is the rule itself.
      say: 'All diagonals inside means convex polygon.',
      original: 'That\u2019s convex polygon.',
      beats: [
        { instruction: null },
        { stage: { grow: { card: 'both', instant: true } } },
        { focus: 'compare.left', style: 'lean' },
        // THE NAME ARRIVES ON ITS WORD, in the INSIDE mark's place: a soft
        // chime, a few sparkles, and his nod
        // (no tab renamed to "Convex pentagon" any more: the cards carry no name tags — final pass)
        { stage: { badge: { under: 'compare.left', text: 'Convex', tone: 'convex', enter: 'pop', cue: 'convex', sfx: 'correct', sparkle: true, react: 'nod' } } },
        { parallel: [
          // stating the rule
          { swiftee: 'explain', at: 'compare.left' },
          { say: 'All diagonals inside means convex polygon.', vo: 'p24' }
        ] },
        { wait: 300 },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'concave', page: 25,
      log: true,   // (the log stays in the scene while he is elsewhere in it: it does not blink out between screens that share it)
      swiftee: { pos: 'log', size: 'medium', purpose: 'concept' },
      instruction: null,
      // FLAG: grammar and capitalisation. Deck: "So it is Concave polygon."
      say: 'Atleast one diagonal outside means concave polygon.',
      original: 'So it is Concave polygon.',
      beats: [
        { instruction: null },
        { stage: { grow: { card: 'both', instant: true } } },
        { focus: 'compare.right', style: 'lean' },
        // on "outside" the diagonal that leaves lights again (emphasize);
        // on "concave" the name, in the OUTSIDE mark's place, and his "got it!"
        { stage: { badge: { under: 'compare.right', text: 'Concave', tone: 'concave', enter: 'pop', cue: 'concave', sfx: 'correct', sparkle: true, react: 'happySmall' } } },
        { parallel: [
          // he points at it
          { swiftee: 'point', at: 'compare.right' },
          { say: 'Atleast one diagonal outside means concave polygon.', parts: ['Atleast one diagonal outside', 'means concave polygon.'], vo: 'p25' }
        ] },
        // THE PAIR, EVENLY: both names showing, nothing more to read
        { focus: 'compare', style: 'even' },
        { wait: 700 },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'make-concave', page: 26,
      // OFF FOR THE TASK, HIS FOR THE EXPLANATIONS (`purpose`): every line on this screen is in a
      // branch, so it did not count as one he speaks on (screens wantsBuddy looks at the top
      // level) — his entrances were skipped and the explanations came as a voice with no one
      // saying them. The purpose makes the screen his; he still starts off-stage.
      swiftee: { pos: 'off', size: 'medium', purpose: 'concept' },
      instruction: 'Drag any vertex to make this polygon concave.',
      // ("Try again!" is his, on the first miss, once he is on the screen — the user, screen 21)
      lines: ['Try again!', 'The diagonals are still inside the shape, so it is still convex.', 'Let me show you. Watch this corner.', 'Now one diagonal goes outside, so the polygon is concave.', 'Great job!'],
      // A QUADRILATERAL (the user, screen 21), and the badge reading "Convex" during the task — a
      // live readout that flips to "Concave" the moment the shape does. TWO TRIES: a corner let
      // go short of a dent is answered with the diagonals drawn on the shape as it stands, kept,
      // and why it is still convex; a second short try, and the dent is made for them — the
      // corner pulled in, the diagonal that goes outside lit — and explained. No third attempt.
      stage: { kind: 'polygon', sides: 4, panel: 'center', badge: { text: 'Convex', live: true } },
      beats: [
        { swiftee: 'exit', to: 'left' },
        { stage: { kind: 'polygon', sides: 4, panel: 'center', enter: 'fade', badge: { text: 'Convex', live: true } } },
        { sfx: 'pop' },
        { instruction: 'Drag any vertex to make this polygon concave.', vo: 'p26i' },
        // (the suggested corner — the top one — is the one dot that breathes: stage.js drag-vertex)
        // (praise: false — the dent is cheered by the screen's own "Great job!" below; a stock
        // "Amazing!" in front of it was two cheers for one answer, and the second cut the first off)
        // (quietMiss: the first miss is answered below, by him — the stock "Try again!" came up in a
        // box while he was still off the screen: the user, screen 21)
        { input: { type: 'drag-vertex', vertex: 'any', until: 'concave', live: 'badge', attempts: true, praise: false, quietMiss: true } },
        { branch: true,
          on: { correct: [] },
          otherwise: [
            /* HE COMES IN FIRST, THEN HE SAYS IT (the user, screen 21: the "Try again!" box came
               before Swiftee was on the screen): the miss is heard, he comes in beside the card's
               lower-left corner, small, clear of the shape (he started off-stage, so the entrance
               names its mark), and only then "Try again!" — in his own box — and the clue, with the
               diagonals drawn on the shape as it stands. */
            { sfx: 'wrong' },
            { swiftee: 'enter', from: 'left', to: 'left', size: 'small' },
            { say: 'Try again!', vo: 'fb32' },
            { stage: { diagonals: 'all', style: 'dashed', animate: 'sequential', each: 420 } },
            { say: 'The diagonals are still inside the shape, so it is still convex.', vo: 'p26r1' },
            // (a breath to look at the clue before the task comes back — the final pass)
            { wait: 600 },
            // (the task, shown again — not said again)
            { instruction: 'Drag any vertex to make this polygon concave.' },
            // (the diagonals stay, and the one that leaves lights as the corner goes in: live 'both')
            // (quietMiss: this is the last try — a miss here is answered by the demonstration below,
            // not by "Try again!" for a try that is not coming)
            { input: { type: 'drag-vertex', vertex: 'any', until: 'concave', live: 'both', attempts: true, retry: true, quietMiss: true, praise: false } },
            { branch: true,
              on: { correct: [] },
              /* THE SECOND MISS IS TAUGHT, NOT GIVEN AWAY (the final pass): the input is locked
                 (game.js), a breath to register the miss; he comes in and says what to watch;
                 the corner goes in slowly (1 s), the shape settles, a breath, the diagonal that
                 now leaves the shape lights and is held; then why — and a reading pause before
                 the lesson goes on. No third try. (A quadrilateral's dent sends exactly one
                 diagonal outside, so the recorded "one" is right here.) */
              otherwise: [
                { wait: 500 },
                { swiftee: 'enter', from: 'left', to: 'left', size: 'small' },
                { focus: 'polygon.vertex.0', style: 'pulse' },
                { say: 'Let me show you. Watch this corner.', vo: 'fb53' },
                { stage: { autoConcave: { vertex: 0, ms: 1000, settle: 400, hold: 1000 } } },
                { say: 'Now one diagonal goes outside, so the polygon is concave.', vo: 'p26r2' },
                { wait: 1000 }
              ] }
          ] },
        // the child's own dent, either time: the cheer, and he is back for it (a dent made for
        // them is explained above, and not cheered)
        { branch: true,
          on: { correct: [
            { feedback: [{ sfx: 'correct' }, { juice: 'celebrate', target: 'polygon' }] },
            // (in first, so "Great job!" is his — on the same mark as the explanations)
            { swiftee: 'enter', from: 'left', to: 'left', size: 'small' },
            { say: 'Great job!', vo: 'fb03' },
            { swiftee: 'celebrate' }
          ] },
          otherwise: [] }
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
      // THE FIRST MISS IS TAUGHT, AND THEN ANSWERED (the Part 1 review, section
      // 5). A wrong drop lifts that card out of the tray under a dim sheet,
      // large, and he says what it shows while each part lights on it on its
      // word (`show`, on word `on`): stage.js teachShape, game.js teachHooks.
      // Then the card goes into the bin it belongs in and is locked there
      // (autoPlace) — a child is not made to fail the same shape twice before
      // it is explained — and the sort goes on with the rest. The rule is the
      // lesson's own two lines, in their own voices; the "Look!" line points
      // at the shape.
      teach: {
        // (each visual on the word that names it, and only that concept at a time — the explanation
        // brief: "corner" the corner, "diagonal" the dashed diagonal alone, "outside" / "inside" its
        // emphasis; stage.js teach show)
        concave: [{ say: 'Look! This corner goes inward.', vo: 'p27c', show: 'notch', on: 2 },
                  { say: 'Atleast one diagonal outside means concave polygon.', vo: 'p25', shows: [{ what: 'outside', on: 2 }, { what: 'outsideGlow', on: 3 }] }],
        convex:  [{ say: 'Look! No corner goes inward.', vo: 'p27v', show: 'corners', on: 2 },
                  { say: 'All diagonals inside means convex polygon.', vo: 'p24', shows: [{ what: 'inside', on: 1 }, { what: 'insideGlow', on: 2 }] }]
      },
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
        // (the FIRST wrong drop is brief feedback and the card goes home for another try; the
        // second wrong drop of the SAME card is taught up close and put in its bin — the user,
        // screen 22)
        { input: { type: 'sort', until: 'all-placed-correctly', teach: 2, autoPlace: true } },
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
      // arrive 'fly': he is not standing there when the screen begins; he
      // flies in once the card has (game.js flyIn)
      swiftee: { pos: 'corner', size: 'small', purpose: 'hint', arrive: 'fly' },
      // This wording follows the recorded master exactly. Extra copy here
      // makes the bubble reveal words that Swiftee never says.
      // ("Let's check!" came off the end of the take: the next screen says what happens next,
      // "Let's measure.", and measures — the review's section 3)
      say: 'Hmm\u2026 The sides look suspiciously alike.',
      stage: { kind: 'polygon', sides: 5, room: 'measure' },
      beats: [
        /* THE THINKING COMES FROM WHAT HE DOES, THEN THE WORDS.
         *   cardIntro          the card and its pentagon grow in (after the
         *                      snow has melted off an empty stage, so it is seen)
         *   swifteeEnter       a breath, then he flies in from the upper left
         *   swifteeInspect     beside the shape, over its top corner, on its
         *                      other side, under it — hovering to look each time
         *   swifteeLand        down onto his own mark, a squash as he lands
         *   swifteeIdleThink   he turns to the shape and thinks about it
         *   showHmmDialogue    a small pause, and only then "Hmm…"
         * Each waits for the one before (every beat is awaited). */
        { stage: { kind: 'vista' } },
        { stage: { kind: 'polygon', sides: 5, room: 'measure', enter: 'intro', afterReveal: true } },
        { wait: 200 },
        { swiftee: 'enter', from: 'air' },
        { swiftee: 'curious', at: 'polygon' },
        // TWO BEATS, THE WAY A COMEDIAN WOULD SAY IT: "Hmm…" on its own,
        // squinting at the shape; then the suspicion, whole ("The sides look
        // suspiciously alike."), with the question on his face.
        { swiftee: 'inspect' },
        { wait: 400 },
        { say: 'Hmm\u2026 The sides look suspiciously alike.', parts: ['Hmm\u2026', 'The sides look suspiciously alike.'], faces: [null, 'question'], vo: 'p28' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'measure-sides', page: 29,
      swiftee: { pos: 'corner', size: 'tiny', purpose: 'demo' },
      // HE MEASURES, THE CHILD WATCHES (the Part 1 review, section 3). This was a tap on each
      // side — "Tap the sides to measure them." — five taps that taught nothing the walk did
      // not. Now he says "Let's measure.", a breath, and walks each side in turn with the tape,
      // its length arriving as he reaches its end; the equal-side ticks are dealt once all
      // five are in, and the screen after says what they show.
      instruction: null,
      say: 'Let\u2019s measure the sides.',
      // The same pentagon as the screen before, built again under the
      // wipe: he waits inside this card, so it sits in the middle, where
      // the one he stood beside sat to the right.
      stage: { kind: 'polygon', sides: 5, room: 'measure' },
      beats: [
        { stage: { kind: 'polygon' } },
        { instruction: null },
        { swiftee: 'inspect' },
        { say: 'Let\u2019s measure the sides.', vo: 'p29s' },
        // Each side in turn, lengths from Poly.sideLengths on the live geometry; no taps are
        // taken (auto), and the measuring is his, so there is no cheer at the end (praise).
        { input: { type: 'tap-each', targets: 'sides', reveal: 'length', count: 5, auto: true, praise: false } },
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
      instruction: null,
      say: 'The angles match too!',
      lines: ['Let\u2019s measure the angles.'],
      beats: [
        // HE MEASURES THE ANGLES HIMSELF (the user, screen 26): "Let's measure the angles.", and
        // the same walk as the sides' — round the shape corner to corner, each angle's arc
        // filled as he reaches it, no taps, and home from the last (stage.js tap-each, auto)
        { instruction: null },
        // (out comes the magnifying glass — the rig's 'learning' — before he sets off)
        { swiftee: 'examine' },
        { say: 'Let\u2019s measure the angles.', vo: 'p31m' },
        { input: { type: 'tap-each', targets: 'angles', reveal: 'arc', count: 5, auto: true, praise: false } },
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
        { input: { type: 'drag-vertex', vertex: 0, until: 'irregular', minMove: 24, live: 'measurements' } },
        // the numbers changed: a quick "oh!" of discovery
        { feedback: [{ sfx: 'slideWhistle' }, { juice: 'wobble', target: 'polygon' }, { swiftee: 'discover' }] }
      ]
    },

    {
      id: 'stayed-changed', page: 32, panel: 2,
      swiftee: { pos: 'corner', size: 'tiny', purpose: 'ask' },
      instruction: 'Are the sides and angles still equal?',
      say: 'It’s still a pentagon. But are the sides and angles still equal?',
      lines: ['The sides and angles changed, so they are not equal.'],
      // (the answers are dealt by the beats, on the question's words — not by a rebuild)
      stage: {},
      beats: [
        { instruction: null },
        // THE QUESTION FIRST, THEN THE ANSWERS (the user): he asks, the question settles on the
        // plank, a beat, and only then are the two answers dealt
        { swiftee: 'think' },
        { say: 'It’s still a pentagon. But are the sides and angles still equal?', parts: ['It\u2019s still a pentagon.', 'But are the sides', 'and angles still equal?'], vo: 'p32b' },
        // the script's last two bubbles are the instruction: it settles into
        // one question over the answers, and is not said a second time
        // (the two answers dealt on the question's own words — "still", "equal" — as on the
        // inside/outside question: no pause behind the question before they can be seen)
        { parallel: [
          { instruction: 'Are the sides and angles still equal?', vo: 'p32bi' },
          { stage: { choices: ['Still equal', 'Not equal'], cue: { 'Still equal': ['still'], 'Not equal': ['equal'] } } }
        ] },
        /* TWO TRIES (the user, screen 28): the first miss is the clue and a retry; the second is
           explained — the readings light as he says why — the Not equal button shows green on
           the word, a moment, and the lesson goes on. No third attempt. */
        { input: { type: 'choice', correct: 'Not equal', reason: 'compare' } },
        { branch: true,
          on: { correct: correct() },
          otherwise: WRONG.concat([
            { input: { type: 'choice', correct: 'Not equal', retry: true, quietMiss: true } },
            { branch: true,
              on: { correct: correct() },
              otherwise: [
                { juice: 'refuse', target: 'answer' }, { sfx: 'wrong' },
                // (ON "equal" the answer is shown, and only it: Not equal green, Still equal gone —
                // the user, screen 28 — the same one green answer as the inside/outside question)
                { parallel: [
                  { stage: { merge: 'Not equal', cue: 'equal' } },
                  { swiftee: 'explain', at: 'polygon' },
                  { say: 'The sides and angles changed, so they are not equal.', vo: 'p32r' }
                ] },
                { sfx: 'correct' },
                { wait: 1200 }
              ] }
          ]) }
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
      /* THE USER'S TEXT (screen 29, three lines, word for word): the pair is introduced; the regular
         one is shown equal — its side ticks on "sides", its angle arcs on "angles" — while the other
         steps back; then the irregular one, the other way round, its unequal marks on the same
         words; then the rule, each half on its words ("equal" / "unequal" light that card's marks),
         and each name tag on its word ("regular" / "irregular", captionCue). One card at a time. */
      say: 'Let\u2019s compare these two pentagons.',
      lines: ['All the sides and angles are equal in this pentagon.',
              'But this pentagon has unequal sides and unequal angles.',
              'All sides and angles equal means a regular polygon. Sides and angles unequal means an irregular polygon.'],
      stage: {
        kind: 'compare',
        // MEASURED CARDS (the user, screen 29): the shapes as big as the glass allows, and on their
        // words each side's length in cm and each corner's degrees — the swipe card's own readings
        // (stage.js compareReadings) — instead of ticks and arcs
        measured: true,
        // each name tag on its word; the irregular one is the pentagon the
        // child stretched a screen ago (made), the stock stretch without it
        // the PROPERTY compared, not the shape's name (the user, screen 29: "Regular" and "Irregular", not "Pentagon")
        left:  { sides: 5, caption: 'Regular',   tone: 'regular', captionCue: 'regular' },
        right: { sides: 5, stretch: 0, made: 'irregular', caption: 'Irregular', tone: 'irregular', captionCue: 'irregular' }
      },
      /* THE USER'S SYNC BRIEF ("sides + angles → regular / irregular", one card at a time): both
         pentagons, still, no marks, while he looks at them; then the first forward — its ticks on
         "sides", its arcs on "angles"; then the turn on "But this pentagon…" — the second's
         unequal ticks and arcs on the same words; then the rule, the first refocused on "All
         sides…", "Regular" on its word, the second on the second "Sides…" with its unequal marks
         emphasised, "Irregular" on its word. Nothing else lights (quietWords): no dots, no
         diagonals, no pulse of both cards at once, no bounce. */
      beats: [
        { instruction: null },
        { stage: { kind: 'compare', enter: 'split' } },
        { stage: { quietWords: true } },
        { sfx: 'menuWhoosh' },
        { wait: 300 },
        // he looks at the pair
        { swiftee: 'present', at: 'compare' },
        { say: 'Let\u2019s compare these two pentagons.', vo: 'fb55' },
        { wait: 500 },
        // THE REGULAR ONE: forward, the other back; its evidence on its words
        { focus: 'compare.left', style: 'lean' },
        { stage: { onWord: [{ word: 'sides', evidence: { card: 'left', what: 'sides' } }, { word: 'angles', evidence: { card: 'left', what: 'angles' } }] } },
        { say: 'All the sides and angles are equal in this pentagon.', vo: 'fb56' },
        { wait: 500 },
        // THE IRREGULAR ONE: the turn to it on "But this pentagon…", its unequal marks on the same words
        { focus: 'compare.right', style: 'lean' },
        { stage: { onWord: [{ word: 'sides', evidence: { card: 'right', what: 'sides' } }, { word: 'angles', evidence: { card: 'right', what: 'angles' } }] } },
        { say: 'But this pentagon has unequal sides and unequal angles.', vo: 'fb57' },
        { wait: 700 },
        // THE RULE (a rule goes in the book): the first again for "All sides and angles equal…", the
        // second on its own "Sides and angles unequal…" — the SECOND "sides" of the line — its
        // unequal marks catching the light; the names arrive on their words (captionCue)
        { swiftee: 'note' },
        { focus: 'compare.left', style: 'lean' },
        { stage: { onWord: [{ word: 'sides', nth: 2, focus: 'right', glow: 'right' }] } },
        { say: 'All sides and angles equal means a regular polygon. Sides and angles unequal means an irregular polygon.',
          parts: ['All sides and angles equal', 'means a regular polygon.', 'Sides and angles unequal', 'means an irregular polygon.'], vo: 'fb58' },
        // (the pair, evenly, both named: the final Regular / Irregular state)
        { focus: 'compare', style: 'even' },
        { wait: 700 },
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
      /* THE CARD TAUGHT UP CLOSE — the same card wrong twice (the user's swipe briefs: no
         third try; "a short teaching spotlight": the play blurs and dims under the sheet, the
         card comes forward, and he names which pile it belongs in and WHY, with the reason
         lit on the card as he says it — the sides on "side(s)", the corners on "angle(s)" —
         then the card goes into its own pile). Keyed by what the card's measurements show
         (stage.js whyShape): every side and angle equal; the sides unequal; the angles
         unequal though the sides match; both unequal. */
      teach: {
        regular: [{ say: 'This one is regular. Every side is equal, and every angle is equal too.', vo: 'fb48', shows: [{ what: 'sides', on: 5 }, { what: 'angles', on: 10 }] }],
        sides:   [{ say: 'This one is irregular. Its sides are not all the same length.', vo: 'fb49', shows: [{ what: 'sides', on: 5 }] }],
        angles:  [{ say: 'This one is irregular. Its sides match, but its angles are not all equal.', vo: 'fb50', shows: [{ what: 'sides', on: 5 }, { what: 'angles', on: 9 }] }],
        both:    [{ say: 'This one is irregular. Its sides are not equal, and its angles are not equal either.', vo: 'fb51', shows: [{ what: 'sides', on: 5 }, { what: 'angles', on: 11 }] }]
      },
      beats: [
        // Clear the card first. Without this the instruction from the screen
        // before stays up — "Drag the highlighted vertex." over a screen that
        // asks the child to swipe — because the card is only ever replaced,
        // never emptied, by a screen that does not set one.
        { instruction: null },
        { stage: { kind: 'swipe-sort', enter: 'stagger' } },
        { say: 'Where does this polygon belong?', vo: 'p33' },
        // AND DOWN AGAIN BEFORE THE CARD CAN BE TAKEN: pop up, ask, pop
        // down, and only then the input (game.js pop() does the same for
        // every card after this one, and for every wrong answer's reason)
        { swiftee: 'exit', to: 'below' },
        // (praise: false — the finale below is his cheer; a "Well done!" first
        // would bring him up behind a card that is no longer there)
        { input: { type: 'swipe', until: 'all-classified', praise: false } },
        // ALL SORTED. The card he peeked from has gone; he jumps up into the
        // empty middle, whole, between the two piles, and cheers there.
        { swiftee: 'enter', from: 'below', quick: true, to: 'middle', size: 'medium' },
        { feedback: milestone([{ sfx: 'levelUp' }, { juice: 'confetti', target: 'stage' }]) }
      ],
      perTap: { correct: [{ sfx: 'correct' }, { juice: 'pop', target: 'item' }],
                // (his 'oops' comes when he is up, in the pop that answers it)
                wrong:   [{ sfx: 'wrong' }, { juice: 'refuse', target: 'item' }] }
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
      lines: [SUMMARY_OPEN.text].concat(SUMMARY.slice(1).map(function (c) { return c.text; }), [SUMMARY_DONE.text]),
      stage: { kind: 'summary', concepts: SUMMARY.map(function (c) { return { id: c.id, label: c.label }; }) },
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
      // a reminder after a miss that is not a line said elsewhere (the
      // diagonal rule) is a line of its own, recorded once
      var r = s.remind;
      if (r && r.vo && !out.some(function (l) { return l.vo === r.vo; })) {
        out.push({ page: s.page, id: s.id, vo: r.vo, text: r.say, remind: true });
      }
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
  return kind === 'polygon' || kind === 'compare' || kind === 'sort' || kind === 'summary';
}
function wantsBuddyAt(i) {
  return wantsBuddy(SCREENS[i]) || speaksAll(i);
}

global.Screens = {
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
