/*!
 * vo-hindi.js — the Hindi recordings, and which line each one is.
 *
 *   node tools/build-vo-hindi.js --align   → docs/vo-hindi.json  (each word's time in each recording)
 *   node tools/build-vo-hindi.js           → assets/vo/hi/<id>.mp3 + .ogg and their index (Part 1)
 *                                            ../part2-frozen-rush/game/assets/audio/vo-lines-hi.mp3 + .ogg
 *                                            ../part2-frozen-rush/game/js/vo-hi.js (Part 2's windows)
 *
 * The user's recordings are one line per file, numbered in the order the lines stand in
 * polygon-locales.json, in two folders: the lesson's (Part 1) and Frozen Rush's (Part 2). The
 * ids are the game's own; the TEXT each recording is aligned against is the Hindi text the game
 * shows for that id (polygon-locales.json "hi"), so the words on screen and the words timed are
 * the same words. Matched by listening — each file transcribed and compared with its line.
 *
 * `plays` is the half of the game that speaks the line: Swiftee's three lines over Frozen Rush
 * (sw1-3) were recorded with Part 2's, but the lesson's page says them (src/opening/runner-stage.js).
 *
 * `derived` lines are cut from a recording made for another line: the ending's cheer ('win-yay',
 * which the English take says as "Yay!") is the "वाह!" that opens p12. Its words are shown nowhere,
 * so it is the word alone, cut at the pause after it.
 */
'use strict';

const PART1 = ['p01', 'p02', 'p03', 'p04', 'p05', 'p06', 'p07i', 'p09', 'p10i', 'p12',
  'p13', 'p14i', 'p14r', 'p15', 'p15i', 'p16b', 'p17i', 'fb54', 'p18', 'p19i',
  'p20', 'fb52', 'p21', 'p22', 'p23', 'p24', 'p25', 'p26i', 'fb32', 'p26r1',
  'fb53', 'p26r2', 'fb03', 'p27', 'p27c', 'p27v', 'p28', 'p29s', 'p30', 'p31m',
  'p31', 'p32a', 'p32ai', 'p32b', 'p32bi', 'p32r', 'fb55', 'fb56', 'fb57', 'fb58',
  /* 51-79: THE SECOND TAKE — the lines the first left out, recorded as one file (audio_1.wav,
     2026-10-05) in this order and cut into one file per line at the silence between them (each
     cut checked by transcribing it). It is quieter than the first, so it is levelled on its own
     (`take`, tools/build-vo-hindi.js). */
  'p33', 'fb48', 'fb49', 'fb50', 'fb51', 'p37o', 'p37a', 'p37b', 'p37c', 'p37d',
  'p37e', 'p37f', 'p37g', 'p37h', 'p37i', 'p39', 'fb46', 'fb47', 'fb44', 'fb45',
  'fb41', 'p38b', 'fb15', 'fb11', 'fb40', 'fb35', 'fb36', 'fb37', 'fb38'];
const FIRST_TAKE = 50;     // Part 1's recordings 1-50 (and all of Part 2's) are the first take

const PART2 = ['tut-1-meet', 'tut-2-goal', 'tut-3-watch', 'tut-4-jump', 'tut-5-broken', 'tut-6-use',
  'tut-6b-piece', 'tut-7-fit', 'p2-1-diagonal', 'p2-2-diagonals', 'p2-3-samevertex', 'p2-4-concave',
  'p2-5-convex', 'p2-6-concave-pentagon', 'p2-7-convex-hexagon', 'p2-8-all-concave', 'p2-9-all-convex',
  'hint-corners', 'hint-side', 'hint-short', 'hint-already', 'hint-samevertex', 'sw1', 'sw2', 'sw3'];

const recordings = [].concat(
  PART1.map((id, i) => ({ id, file: 'assets/vo-part-1-hindi/' + (i + 1) + '.opus', plays: 1, take: i < FIRST_TAKE ? 1 : 2 })),
  PART2.map((id, i) => ({ id, file: '../part2-frozen-rush/game/assets/vo-part-2-hindi/' + (i + 1) + '.opus', plays: /^sw\d$/.test(id) ? 1 : 2, take: 1 }))
);

/* cut from another line's recording: its first `words` words, up to the pause after them */
const derived = [
  { id: 'win-yay', from: 'p12', words: 1, plays: 2 }
];

module.exports = { recordings, derived };
