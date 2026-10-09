/*!
 * vo-masters.js — the recorded master takes, and which lines each one reads, in its order.
 *
 *   node tools/align-vo.js --master <name> --modules <dir>   → docs/vo-masters/<name>.json
 *   node tools/split-vo.js --master <name>                   → assets/vo/<id>.mp3 + .ogg
 *
 * Each master is one recording of several lines (assets/source/vo-masters). The ids are the
 * game's own (tools/vo-lines.js); the TEXT aligned against the take is the game's text for that
 * id, so what is on screen and what is cut are the same line. A line the take reads twice is
 * listed twice, the second time as `<id>~2`: the aligner needs it to keep its place in the
 * take, and the cutter uses the first reading only. A reading the game does not use at all is
 * an `{ id: '<x>~…', text }` entry: aligned so its neighbours stay in step, and never cut.
 *
 * `tempo` 1: these takes are cut as recorded — no stretch (the old take was slowed to 0.88).
 */
'use strict';
module.exports = [
  // (narrator and popo voice the story, kept outside the repository in POLYGON-1/story-draft, with its clips: cut again from here
  // only when it comes back — split-vo writes into assets/vo)
  { name: 'narrator', source: 'assets/source/vo-masters/narrator.mp3', tempo: 1,
    lines: ['st1-narrator', 'st3-narrator', 'st5-narrator',
            // (read, and no longer used: Swiftee says the hand-over now — p01b)
            { id: 'st5-narrator~rest', text: 'But first, you’ll need to learn a little more about polygons.' }] },
  { name: 'popo', source: 'assets/source/vo-masters/popo.mp3', tempo: 1,
    lines: ['st1-popo', 'st2-popo'] },
  { name: 'swiftee-feedback', source: 'assets/source/vo-masters/swiftee-feedback.mp3', tempo: 1,
    lines: ['fb46', 'fb47', 'fb03', 'fb32'] },
  // the recap's opener and the lesson's last line (p39, the game-lesson kit's); the hand-over
  // reading and the names line are not used (the user) — Swiftee's lines over Frozen Rush are
  // their own take now (swiftee-visit, below)
  { name: 'swiftee-extra', source: 'assets/source/vo-masters/swiftee-extra.mp3', tempo: 1,
    lines: [{ id: 'p01b~unused', text: 'But for that, first you need to learn about polygons.' }, 'p37o',
            { id: 'unused~names', text: 'Polygons have different names based on their number of sides.' },
            'p39'] },
  // Swiftee over Frozen Rush (src/opening/runner-stage.js): at the broken path before the lesson,
  // and at the ditch after it — the user's recording of the three lines, in this order
  { name: 'swiftee-visit', source: 'assets/source/vo-masters/swiftee-visit.mp3', tempo: 1,
    lines: ['sw1', 'sw2', 'sw3'] },
  { name: 'swiftee-lesson', source: 'assets/source/vo-masters/swiftee-lesson.mp3', tempo: 1,
    lines: [
      'p01', 'p02', 'p03', 'p04', 'fb44', 'fb45', 'p05', 'p06',
      'p07i', 'p09', 'p10i', 'p12', 'p13',
      'p14i', 'fb15', 'p14r', 'p15', 'fb15~2', 'p14r~2', 'p16b',
      'p17i', 'fb54', 'p18', 'p19i', 'fb11', 'p20', 'fb52',
      'p21', 'p22', 'p23', 'p24', 'p25',
      'p26i', 'p26r1', 'fb53', 'p26r2', 'fb03~2',            // ("Great job!" — the feedback take's is used)
      'p27', 'fb42', 'fb43', 'p27c', 'p25~2', 'p27v', 'p24~2',
      'p28', 'p29s', 'p30', 'p31m', 'p31',
      'p32a', 'p32ai', 'fb40', 'p32b', 'fb41', 'p32r',
      'fb55', 'fb56', 'fb57', 'fb58',
      'p33', 'fb35', 'fb48', 'fb36', 'fb49', 'fb37', 'fb50', 'fb38', 'fb51'
    ] }
];
