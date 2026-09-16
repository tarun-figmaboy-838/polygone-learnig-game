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
  var WRONG = [
    { swiftee: 'confused' },
    { juice: 'refuse', target: 'answer' },
    { sfx: 'wrong' },
    { wait: 500 },
    { swiftee: 'encourage' }
  ];

  function correct(extra) {
    return [
      { juice: 'collect', target: 'answer' },
      { swiftee: 'celebrate' }
    ].concat(extra || []);
  }

  var SCREENS = [

    /* ================================================================ *
     * INTRO — pages 1–3
     * ================================================================ */

    {
      id: 'intro-hi', page: 1,
      swiftee: { pos: 'left', size: 'large' },
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
      swiftee: { pos: 'left', size: 'large' },
      say: 'Remember we learned about polygons before.',
      beats: [
        { swiftee: 'think' },
        { say: 'Remember we learned about polygons before.', vo: 'p02' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'intro-define', page: 3,
      swiftee: { pos: 'left', size: 'large' },
      say: 'Polygons are closed shapes made from straight lines.',
      beats: [
        { swiftee: 'explain' },
        { say: 'Polygons are closed shapes made from straight lines.', vo: 'p03' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    /* ================================================================ *
     * WHICH ARE POLYGONS — page 4
     * ================================================================ */

    {
      id: 'which-polygons', page: 4,
      swiftee: { pos: 'left-low', size: 'medium' },
      say: 'Which of these are polygons?',
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
        { swiftee: 'move', to: 'left-low', size: 'medium' },
        { stage: { kind: 'choice-grid', enter: 'stagger' } },
        { wait: 300 },
        { say: 'Which of these are polygons?', vo: 'p04' },
        { swiftee: 'look', at: 'grid' },
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
        { swiftee: 'excited' },
        { say: 'Let\u2019s play with this one.', vo: 'p05' },
        { swiftee: 'look', at: 'polygon' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'pick-vertex', page: 6,
      swiftee: { pos: 'left-low', size: 'medium' },
      say: 'Pick any vertex.',
      beats: [
        { say: 'Pick any vertex.', vo: 'p06' },
        { swiftee: 'point', at: 'polygon' },
        { focus: 'polygon.vertices', style: 'pulse' },
        { input: { type: 'vertex-pick', accept: 'any' } },
        { feedback: [{ sfx: 'select' }, { juice: 'pop', target: 'vertex' }] }
      ]
    },

    {
      id: 'connect', page: 7,
      swiftee: { pos: 'left-low', size: 'medium' },
      say: 'I will connect it to another vertex.',
      stage: { highlight: { vertex: 'picked', color: 'yellow' } },
      beats: [
        { stage: { highlight: { vertex: 'picked', color: 'yellow' } } },
        { swiftee: 'explain' },
        { say: 'I will connect it to another vertex.', vo: 'p07' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      // Page 8 has no dialogue: Swiftee relocates to the polygon and draws
      // the side. The deck shows a teleport; this is an entrance.
      id: 'draw-side', page: 8,
      // He starts back and steps IN to draw. It used to say
      // polygon-top-right in both places, which is not a move at all — and
      // that corner is inside the right-hand slab, so he stood on the lesson
      // for the whole screen.
      swiftee: { pos: 'left-low', size: 'small' },
      say: null,
      beats: [
        { swiftee: 'move', to: 'left', size: 'medium' },
        { wait: 200 },
        { parallel: [
          { stage: { draw: { segment: ['picked', 'adjacent'], color: 'yellow', animate: 600 } } },
          { sfx: 'zip' }
        ] },
        { wait: 400 }
      ]
    },

    {
      id: 'this-is-side', page: 9,
      swiftee: { pos: 'left-low', size: 'medium' },
      say: 'This is a side of the polygon.',
      stage: { label: { text: 'Side', at: 'segment', arrow: true } },
      beats: [
        { swiftee: 'move', to: 'left-low', size: 'medium' },
        { stage: { label: { text: 'Side', at: 'segment', arrow: true, enter: 'pop' } } },
        { say: 'This is a side of the polygon.', vo: 'p09' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'what-if', page: 10,
      swiftee: { pos: 'left-low', size: 'medium' },
      say: 'What if we connect it to a different vertex.',
      stage: { highlight: { vertex: 'adjacent', color: 'red' } },
      beats: [
        { stage: { highlight: { vertex: 'adjacent', color: 'red', enter: 'pop' } } },
        { swiftee: 'think' },
        { say: 'What if we connect it to a different vertex.', vo: 'p10' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'drag-to-diagonal', page: 11,
      swiftee: { pos: 'left-low', size: 'medium' },
      instruction: 'Drag the line segment to a different vertex.',
      stage: { label: { text: 'Side' } },
      beats: [
        { instruction: 'Drag the line segment to a different vertex.' },
        { focus: 'segment.endpoint', style: 'pulse' },
        { swiftee: 'point', at: 'segment.endpoint' },
        // Dropping on the OTHER adjacent vertex makes another side, not a
        // diagonal: that is the wrong answer here and it is judged by
        // geometry (Poly.isAdjacent), never by a hard-coded vertex index.
        { input: { type: 'drag-endpoint', accept: 'non-adjacent', snap: 'vertices' } },
        { branch: true,
          on: { correct: correct([{ sfx: 'slice' }]) },
          otherwise: WRONG.concat([{ input: { type: 'drag-endpoint', accept: 'non-adjacent', snap: 'vertices', retry: true } }]) }
      ]
    },

    {
      id: 'made-diagonal', page: 12,
      swiftee: { pos: 'left-low', size: 'medium' },
      instruction: 'Drag the line segment to a different vertex.',
      say: 'Yay! You made a diagonal.',
      stage: { label: { text: 'Diagonal', at: 'below-polygon' } },
      beats: [
        { stage: { label: { text: 'Diagonal', at: 'below-polygon', enter: 'pop' } } },
        { swiftee: 'celebrate' },
        { say: 'Yay! You made a diagonal.', vo: 'p12' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'define-diagonal', page: 13,
      swiftee: { pos: 'left-low', size: 'medium' },
      instruction: 'Drag the line segment to a different vertex.',
      // FLAG: content error. The deck says "two non-adjacent SIDES". A
      // diagonal joins two non-adjacent VERTICES. The deck's own picture
      // shows a vertex-to-vertex segment, and "sides" would teach a wrong
      // definition in the one line that defines the term.
      say: 'A line segment joining two non-adjacent vertices is a diagonal.',
      original: 'A line segment joining two non-adjacent sides is a diagonal.',
      beats: [
        { swiftee: 'explain' },
        { focus: 'diagonal.endpoints', style: 'pulse' },
        { say: 'A line segment joining two non-adjacent vertices is a diagonal.', vo: 'p13' },
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
      say: 'Can you draw another diagonal from here?',
      // The deck shows a dashed ghost of the answer. As a scaffold on the
      // learner's FIRST unaided attempt it is acceptable; it is removed on
      // the hexagon screen where the brief's "your turn" makes it a leak.
      stage: { ghost: { from: 'picked', to: 'remaining-diagonal', style: 'dashed' } },
      beats: [
        { instruction: 'Draw another diagonal from the same vertex.' },
        { say: 'Can you draw another diagonal from here?', vo: 'p14' },
        { stage: { ghost: { from: 'picked', to: 'remaining-diagonal', style: 'dashed', enter: 'fade' } } },
        { swiftee: 'point', at: 'picked' },
        { input: { type: 'draw-diagonal', from: 'picked', accept: 'non-adjacent-unused' } },
        { branch: true,
          on: { correct: correct([{ sfx: 'slice' }]) },
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
        { instruction: 'Draw all the diagonals from this vertex.' },
        { swiftee: 'encourage' },
        { say: 'Your turn! Draw all the diagonals from this vertex.', vo: 'p15' },
        { focus: 'polygon.vertex.0', style: 'pulse' },
        { swiftee: 'step-back' },
        // Three diagonals from one hexagon vertex (n - 3). Each correct one
        // gets its own small reward; the screen completes on the third.
        { input: { type: 'draw-diagonals', from: 0, count: 3, accept: 'non-adjacent-unused' } },
        { feedback: correct([{ sfx: 'levelUp' }]) }
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
      stage: { kind: 'polygon', sides: 5, diagonals: 'all', style: 'dashed', label: { text: 'Diagonal' } },
      beats: [
        { instruction: null },
        { stage: { kind: 'polygon', sides: 5, enter: 'morph' } },
        { wait: 300 },
        { say: 'Look at the diagonals of this pentagon.', vo: 'p16' },
        // The five diagonals draw in one after another, not all at once —
        // a child can count them going in.
        { stage: { diagonals: 'all', style: 'dashed', animate: 'sequential', each: 220 } },
        { sfx: 'sparkle' },
        { swiftee: 'look', at: 'polygon' },
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
      say: 'Are they inside or outside?',
      stage: { kind: 'polygon', sides: 5, diagonals: 'all', choices: ['Inside', 'Outside'] },
      beats: [
        { instruction: 'Are the diagonals inside or outside?' },
        { say: 'Are they inside or outside?', vo: 'p17' },
        { stage: { choices: ['Inside', 'Outside'], enter: 'rise' } },
        { swiftee: 'think' },
        { input: { type: 'choice', correct: 'Inside' } },
        { branch: true,
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
      instruction: 'Drag the vertex inward',
      say: 'Help me pull this vertex inside.',
      stage: { highlight: { vertex: 0, color: 'yellow' } },
      beats: [
        { instruction: 'Drag the vertex inward' },
        { say: 'Help me pull this vertex inside.', vo: 'p19' },
        { focus: 'polygon.vertex.0', style: 'pulse' },
        { swiftee: 'point', at: 'polygon.vertex.0' },
        // Complete when the polygon becomes concave (Poly.classify), not
        // when the vertex crosses a pixel line. The drag is clamped with
        // Poly.clampSimple so it cannot become a bowtie.
        { input: { type: 'drag-vertex', vertex: 0, until: 'concave', clamp: 'simple', live: 'diagonals' } },
        { feedback: [{ sfx: 'boing' }, { juice: 'wobble', target: 'polygon' }] }
      ]
    },

    {
      id: 'whoa', page: 20,
      swiftee: { pos: 'left-low', size: 'medium' },
      say: 'Whoa! One of the diagonals went outside.',
      stage: { highlight: { diagonal: 'outside', color: 'red', style: 'dashed' } },
      beats: [
        { instruction: null },
        { swiftee: 'surprised' },
        { stage: { highlight: { diagonal: 'outside', color: 'red', style: 'dashed', enter: 'flash' } } },
        { sfx: 'honk' },
        { say: 'Whoa! One of the diagonals went outside.', vo: 'p20' },
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
      stage: { kind: 'compare', left: { sides: 5, diagonals: 'all' }, right: { sides: 5, dent: 0, diagonals: 'all', outsideColor: 'red' } },
      beats: [
        { instruction: 'Compare the diagonals in both pentagons.' },
        { stage: { kind: 'compare', enter: 'split' } },
        { sfx: 'menuWhoosh' },
        { wait: 400 },
        { swiftee: 'explain' },
        { say: 'Both are pentagons.', vo: 'p21' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'all-inside', page: 22,
      // ABOVE, because that is where the line can go. The pair fills the
      // middle and the Next button reserves the foot, leaving a 54px band
      // below — a one-row bubble is 74. Standing at the bottom put him four
      // hundred pixels from his own speech.
      swiftee: { pos: 'top-left', size: 'small' },
      say: 'This one has all diagonals inside.',
      beats: [
        { instruction: null },
        { focus: 'compare.left', style: 'dim-others' },
        { swiftee: 'point', at: 'compare.left' },
        { say: 'This one has all diagonals inside.', vo: 'p22' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'convex', page: 23,
      // Above, like the rest of this run of compare screens: the pair fills
      // the middle and Next reserves the foot, so a line placed near him at
      // the bottom had a 54px band to live in and came out four rows deep.
      swiftee: { pos: 'top-left', size: 'small' },
      instruction: 'All diagonals inside means convex polygon.',
      // FLAG: grammar. Deck: "That's convex polygon."
      say: 'That\u2019s a convex polygon.',
      original: 'That\u2019s convex polygon.',
      stage: { badge: { under: 'compare.left', text: 'Convex', tone: 'convex' } },
      beats: [
        { instruction: 'All diagonals inside means convex polygon.' },
        { stage: { badge: { under: 'compare.left', text: 'Convex', tone: 'convex', enter: 'pop' } } },
        { sfx: 'correct' },
        { swiftee: 'explain' },
        { say: 'That\u2019s a convex polygon.', vo: 'p23' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'one-outside', page: 24,
      // ABOVE, because that is where the line can go. The pair fills the
      // middle and the Next button reserves the foot, leaving a 54px band
      // below — a one-row bubble is 74. Standing at the bottom put him four
      // hundred pixels from his own speech.
      swiftee: { pos: 'top-left', size: 'small' },
      // FLAG: punctuation. Deck line has no full stop.
      say: 'This one has at least one diagonal outside.',
      original: 'This one has at least one diagonal outside',
      beats: [
        { instruction: null },
        { focus: 'compare.right', style: 'dim-others' },
        { swiftee: 'point', at: 'compare.right' },
        { say: 'This one has at least one diagonal outside.', vo: 'p24' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'concave', page: 25,
      // Above, like the rest of this run of compare screens: the pair fills
      // the middle and Next reserves the foot, so a line placed near him at
      // the bottom had a 54px band to live in and came out four rows deep.
      swiftee: { pos: 'top-left', size: 'small' },
      // FLAG: the deck card reads "At least  one" with a double space.
      instruction: 'At least one diagonal outside means concave polygon.',
      // FLAG: grammar and capitalisation. Deck: "So it is Concave polygon."
      say: 'So it is a concave polygon.',
      original: 'So it is Concave polygon.',
      stage: { badge: { under: 'compare.right', text: 'Concave', tone: 'concave' } },
      beats: [
        { instruction: 'At least one diagonal outside means concave polygon.' },
        { stage: { badge: { under: 'compare.right', text: 'Concave', tone: 'concave', enter: 'pop' } } },
        { sfx: 'correct' },
        { swiftee: 'explain' },
        { say: 'So it is a concave polygon.', vo: 'p25' },
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
        { instruction: 'Drag any vertex to make this polygon concave.' },
        { focus: 'polygon.vertices', style: 'pulse' },
        { input: { type: 'drag-vertex', vertex: 'any', until: 'concave', clamp: 'simple', live: 'badge' } },
        { feedback: [{ sfx: 'boing' }, { juice: 'celebrate', target: 'polygon' }] },
        { swiftee: 'enter', from: 'left' },
        { swiftee: 'celebrate' }
      ]
    },

    /* ================================================================ *
     * SORT: CONVEX / CONCAVE — page 27
     * ================================================================ */

    {
      id: 'sort-convex-concave', page: 27,
      // IN THE CORRIDOR, which is where his line goes. The tray runs across
      // the top and the bins across the bottom, so the only band tall enough
      // for a sentence is the gap between them — and standing above the tray
      // put him two hundred pixels from his own speech bubble.
      swiftee: { pos: 'left-mid', size: 'small' },
      say: 'Can you sort these polygons as convex or concave?',
      stage: {
        kind: 'sort',
        bins: [{ id: 'convex', label: 'Convex', tone: 'convex' }, { id: 'concave', label: 'Concave', tone: 'concave' }],
        // Judged by Poly.classify at runtime, never by a hard-coded answer
        // column — so an art change cannot desync the shape from its key.
        items: ['triangle', 'chevron', 'pentagon', 'l-shape', 'hexagon', 'star'],
        mechanic: 'drag-to-bin'
      },
      beats: [
        { instruction: null },
        { stage: { kind: 'sort', enter: 'stagger' } },
        { sfx: 'menuWhoosh' },
        { wait: 300 },
        { say: 'Can you sort these polygons as convex or concave?', vo: 'p27' },
        { swiftee: 'look', at: 'sort.tray' },
        { input: { type: 'sort', until: 'all-placed-correctly' } },
        { feedback: correct([{ sfx: 'levelUp' }, { juice: 'confetti', target: 'stage' }]) }
      ],
      perTap: { correct: [{ sfx: 'correct' }, { juice: 'pop', target: 'item' }],
                wrong:   [{ sfx: 'wrong' }, { juice: 'refuse', target: 'item' }, { stage: { returnItem: true } }, { swiftee: 'confused' }] }
    },

    /* ================================================================ *
     * REGULAR / IRREGULAR — pages 28–33
     * ================================================================ */

    {
      id: 'suspicious', page: 28,
      // NOT polygon-top-right: that corner is inside the right-hand slab, so
      // the position cannot avoid the panel it is defined against.
      swiftee: { pos: 'left-low', size: 'small' },
      say: 'Hmm\u2026 The sides look suspiciously alike.',
      stage: { kind: 'polygon', sides: 5, panel: 'right' },
      beats: [
        { stage: { kind: 'polygon', sides: 5, panel: 'right', enter: 'pop' } },
        { swiftee: 'move', to: 'left', size: 'medium' },
        { swiftee: 'inspect' },
        { say: 'Hmm\u2026 The sides look suspiciously alike.', vo: 'p28' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'measure-sides', page: 29,
      swiftee: { pos: 'left-low', size: 'medium' },
      instruction: 'Tap the sides to measure them.',
      say: 'Let\u2019s check!',
      beats: [
        { swiftee: 'move', to: 'left-low', size: 'medium' },
        { instruction: 'Tap the sides to measure them.' },
        { say: 'Let\u2019s check!', vo: 'p29' },
        { swiftee: 'inspect' },
        { focus: 'polygon.sides', style: 'pulse' },
        // Each tap reveals that side's length. Lengths come from
        // Poly.sideLengths on the live geometry. Completes when all five
        // have been tapped; there is no wrong tap on this screen.
        { input: { type: 'tap-each', targets: 'sides', reveal: 'length', count: 5 } },
        { feedback: [{ sfx: 'correct' }] }
      ],
      perTap: { correct: [{ sfx: 'tick' }, { juice: 'pop', target: 'side' }] }
    },

    {
      id: 'sides-equal', page: 30,
      swiftee: { pos: 'left-low', size: 'medium' },
      // FLAG: on this deck page the instruction card already reads "Tap the
      // angles..." while Swiftee is still concluding the SIDES check. The
      // card is held on the sides instruction until the line finishes, then
      // swapped — otherwise the child is told to do two things at once.
      instruction: 'Tap the angles to measure them.',
      say: 'Every side is equal. But what about the angles?',
      beats: [
        { swiftee: 'nod' },
        { say: 'Every side is equal. But what about the angles?', vo: 'p30' },
        { swiftee: 'think' },
        { instruction: 'Tap the angles to measure them.' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'measure-angles', page: 31,
      swiftee: { pos: 'left-low', size: 'medium' },
      instruction: 'Tap the angles to measure them.',
      say: 'The angles match too!',
      beats: [
        { focus: 'polygon.vertices', style: 'pulse' },
        { swiftee: 'point', at: 'polygon.vertices' },
        // Each tap fills a green arc at that corner (as page 31 shows) and
        // reveals the angle from Poly.interiorAngles. Completes on five.
        { input: { type: 'tap-each', targets: 'angles', reveal: 'arc', count: 5 } },
        { swiftee: 'celebrate' },
        { say: 'The angles match too!', vo: 'p31' },
        { input: { type: 'tap-anywhere' } }
      ],
      perTap: { correct: [{ sfx: 'tick' }, { juice: 'pop', target: 'angle' }] }
    },

    {
      id: 'distort', page: 32, panel: 1,
      swiftee: { pos: 'left-low', size: 'medium' },
      instruction: 'Drag the highlighted vertex.',
      say: 'Help me stretch this corner. Let\u2019s see what happens to the sides and angles!',
      stage: { highlight: { vertex: 0, color: 'yellow' }, measurements: 'live' },
      beats: [
        { instruction: 'Drag the highlighted vertex.' },
        { say: 'Help me stretch this corner. Let\u2019s see what happens to the sides and angles!', vo: 'p32a' },
        { focus: 'polygon.vertex.0', style: 'pulse' },
        { swiftee: 'point', at: 'polygon.vertex.0' },
        // Completes once the shape is no longer regular by measurement,
        // with a minimum displacement so a nudge does not end the screen.
        { input: { type: 'drag-vertex', vertex: 0, until: 'irregular', minMove: 24, clamp: 'simple', live: 'measurements' } },
        { feedback: [{ sfx: 'slideWhistle' }, { juice: 'wobble', target: 'polygon' }] }
      ]
    },

    {
      id: 'stayed-changed', page: 32, panel: 2,
      swiftee: { pos: 'left-low', size: 'medium' },
      say: 'It\u2019s still a pentagon. But are the sides and angles still equal?',
      stage: { choices: ['Still equal', 'Not equal'] },
      beats: [
        { instruction: null },
        { swiftee: 'think' },
        { say: 'It\u2019s still a pentagon. But are the sides and angles still equal?', vo: 'p32b' },
        { stage: { choices: ['Still equal', 'Not equal'], enter: 'rise' } },
        { input: { type: 'choice', correct: 'Not equal' } },
        { branch: true,
          on: { correct: correct() },
          otherwise: WRONG.concat([{ input: { type: 'choice', correct: 'Not equal', retry: true } }]) }
      ]
    },

    {
      id: 'regular-vs-irregular', page: 32, panel: 3,
      // NOT top-left on this one. The panels start at 178 of a 1000 stage, so the
      // band above them is the only full-width place the line can go — and he
      // was standing in it, carving it below the height a bubble needs and
      // pushing the sentence into a side column four rows deep. The checks sit
      // under the panels and start at 194, so the foot of the left margin is
      // ABOVE. The pair fills the middle and its checks fill the foot, so
      // the band above them is the only place a sentence fits.
      swiftee: { pos: 'top-left', size: 'small' },
      say: 'All sides AND all angles equal means regular. Otherwise, it\u2019s irregular.',
      stage: {
        kind: 'compare',
        left:  { sides: 5, caption: 'Regular pentagon',   checks: ['All sides equal', 'All angles equal'], tone: 'regular' },
        right: { sides: 5, stretch: 0, caption: 'Irregular pentagon', checks: ['Sides not all equal', 'Angles not all equal'], tone: 'irregular' }
      },
      beats: [
        { stage: { kind: 'compare', enter: 'split' } },
        { sfx: 'menuWhoosh' },
        { wait: 300 },
        { swiftee: 'explain' },
        { say: 'All sides AND all angles equal means regular. Otherwise, it\u2019s irregular.', vo: 'p32c' },
        { stage: { reveal: 'checks', animate: 'sequential' } },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'sort-regular', page: 33,
      // ABOVE THE ZONES. They reach both edges and the direction hint takes
      // the floor, so the top band is the only place a line fits — in the
      // near corner he was four hundred and sixty pixels from it.
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
        items: ['pentagon', 'irregular-quad', 'hexagon', 'stretched-hexagon', 'equilateral-concave-hexagon']
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
        { swiftee: 'look', at: 'sort.item' },
        { input: { type: 'swipe', until: 'all-classified' } },
        { feedback: correct([{ sfx: 'levelUp' }, { juice: 'confetti', target: 'stage' }]) }
      ],
      perTap: { correct: [{ sfx: 'correct' }, { juice: 'pop', target: 'item' }],
                wrong:   [{ sfx: 'wrong' }, { juice: 'refuse', target: 'item' }, { swiftee: 'confused' }] }
    },

    /* ================================================================ *
     * BUILD YOUR OWN — page 35 (page 34 is a design reference card)
     * ================================================================ */

    {
      id: 'build-sides', page: 35, panel: 1,
      swiftee: { pos: 'left-low', size: 'medium' },
      say: 'Let\u2019s start by making a pentagon. Adjust the number of sides.',
      stage: { kind: 'builder', sides: 3, stepper: { min: 3, max: 8, label: 'Number of sides' } },
      beats: [
        { stage: { kind: 'builder', sides: 3, enter: 'pop' } },
        { say: 'Let\u2019s start by making a pentagon. Adjust the number of sides.', vo: 'p35a' },
        { swiftee: 'point', at: 'builder' },
        { focus: 'builder.stepper', style: 'pulse' },
        // The polygon morphs live as the stepper changes. Completes at 5.
        { input: { type: 'stepper', target: 5 } },
        { feedback: [{ sfx: 'correct' }, { juice: 'pop', target: 'polygon' }] }
      ],
      perTap: { any: [{ sfx: 'select' }, { juice: 'pop', target: 'polygon', scale: 0.08 }] }
    },

    {
      id: 'build-pentagon', page: 35, panel: 2,
      swiftee: { pos: 'left-low', size: 'medium' },
      say: 'Great! Now you have a pentagon.',
      beats: [
        { swiftee: 'celebrate' },
        { say: 'Great! Now you have a pentagon.', vo: 'p35b' },
        { input: { type: 'tap-anywhere' } }
      ]
    },

    {
      id: 'build-concave', page: 35, panel: 3,
      swiftee: { pos: 'left-low', size: 'medium' },
      say: 'Now drag a vertex inward to make it a concave pentagon.',
      stage: { highlight: { vertex: 0, color: 'orange' }, stepper: 'locked' },
      beats: [
        { stage: { stepper: 'locked', highlight: { vertex: 0, color: 'orange' } } },
        { say: 'Now drag a vertex inward to make it a concave pentagon.', vo: 'p35c' },
        { focus: 'polygon.vertex.0', style: 'pulse' },
        { swiftee: 'point', at: 'polygon.vertex.0' },
        { input: { type: 'drag-vertex', vertex: 'any', until: 'concave', clamp: 'simple' } },
        { feedback: [{ sfx: 'boing' }, { juice: 'wobble', target: 'polygon' }] }
      ]
    },

    {
      id: 'build-done', page: 35, panel: 4,
      // Medium. This screen uses the CENTRED slab, which starts at x 230 — at
      // large he is 175 units across from x 62 and his wing is on the card.
      // The finale is carried by the celebrate clip and the confetti.
      swiftee: { pos: 'left-low', size: 'medium' },
      say: 'Nice! You built a concave and irregular pentagon.',
      stage: { checklist: ['5 sides', 'Concave', 'Irregular'] },
      beats: [
        // Ticks land one at a time, each verified by Poly.classify on the
        // learner's actual shape, so the checklist can never lie.
        { stage: { checklist: ['5 sides', 'Concave', 'Irregular'], animate: 'sequential', each: 350, verify: true } },
        { sfx: 'sparkle' },
        { swiftee: 'celebrate' },
        { say: 'Nice! You built a concave and irregular pentagon.', vo: 'p35d' },
        { feedback: [{ juice: 'confetti', target: 'stage' }, { sfx: 'levelUp' }] },
        { input: { type: 'tap-anywhere' } }
      ]
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

  /** Every line Swiftee says, in order, for the VO script. */
  function voScript() {
    return SCREENS.filter(function (s) { return s.say; }).map(function (s) {
      var vo = null;
      s.beats.forEach(function (b) { if (b.say === s.say && b.vo) vo = b.vo; });
      return { page: s.page, id: s.id, vo: vo, text: s.say };
    });
  }

  global.Screens = {
    list: SCREENS,
    byId: byId,
    notScreens: NOT_SCREENS,
    flags: flags,
    voScript: voScript,
    WRONG: WRONG
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.Screens;

})(typeof window !== 'undefined' ? window : this);
