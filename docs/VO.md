# Voice-over script — Swiftee & the Polygons

_Generated from the storyboard by `node tools/vo-script.js`; do not edit by hand._

Every line Swiftee says, **in the order a child hears it**, with the file the game plays. Save each clip as `assets/vo/<id>.mp3`, then run `npm run build:vo`: the game plays it as the words appear and paces the bubbles by the recording. A clip that is not there yet is silent, so they can be added a few at a time.

**Voice:** Swiftee, a small, warm, playful teal bird talking to a seven-year-old. Clear, unhurried and smiling, never shouty. Lines end with a smile, not a drop.

**Files:** mono MP3, 44.1 kHz, 128 kbps or better, about −16 LUFS, no more than 0.2 s of silence at either end. Aim for about 0.4 s per word plus 0.4 s.

**Breaths:** record every line as ONE clip, read naturally, with a short breath at each `/` in the Breaths column. On screen each sentence is one bubble; the breaths are where the words pause inside it.

## Lesson lines (48), in timeline order

| # | Screen | Screen id | File | Type | Line | Breaths | When | Delivery | Recorded |
|---|--------|-----------|------|------|------|---------|------|----------|----------|
| 1 | 1 | intro-hi | `assets/vo/p01.mp3` | say | Hi! I am Swiftee. |  | screen 1 | arriving, friendly | yes |
| 2 | 2 | intro-remember | `assets/vo/p02.mp3` | say | Remember we learned about polygons before. |  | screen 2 | wondering aloud, a little slower | yes |
| 3 | 3 | intro-define | `assets/vo/p03.mp3` | say | Polygons are closed shapes made from straight lines. | Polygons are closed shapes / made from straight lines. | screen 3 | explaining, warm and clear | yes |
| 4 | 4 | which-polygons | `assets/vo/p04.mp3` | say | Which of these are polygons? |  | screen 4 | asking: curious, open | yes |
| 5 | 5 | lets-play | `assets/vo/p05.mp3` | say | Let’s play with this one. |  | screen 5 | playful, inviting | yes |
| 6 | 6 | pick-vertex | `assets/vo/p06.mp3` | say | Select any vertex. |  | screen 6 | explaining, warm and clear | yes |
| 7 | 7 | connect | `assets/vo/p07i.mp3` | instruction | Let’s connect it to another vertex. |  | screen 7, the instruction | an instruction: plain, steady, every word clear | yes |
| 8 | 7 | connect | `assets/vo/p09.mp3` | say | This is a side of the polygon. |  | screen 7 | explaining, warm and clear | yes |
| 9 | 7 | connect | `assets/vo/p10i.mp3` | instruction | Let’s connect it to a different vertex. |  | screen 7, the instruction | an instruction: plain, steady, every word clear | yes |
| 10 | 7 | connect | `assets/vo/p12.mp3` | say | Yay! You made a diagonal! |  | screen 7, after the right answer | a cheer, delighted | yes |
| 11 | 8 | define-diagonal | `assets/vo/p13.mp3` | say | A line segment joining two non-adjacent vertices is a diagonal. | A line segment joining / two non-adjacent vertices / is a diagonal. | screen 8 | explaining, warm and clear | yes |
| 12 | 9 | another-diagonal | `assets/vo/p14i.mp3` | instruction | Let’s draw another diagonal from the same vertex. |  | screen 9, the instruction | an instruction: plain, steady, every word clear | yes |
| 13 | 9 | another-diagonal | `assets/vo/p14b.mp3` | say | All diagonals are still inside. |  | screen 9, after the right answer | explaining, warm and clear | yes |
| 14 | 9 | another-diagonal | `assets/vo/p14r.mp3` | reminder | A diagonal connects non-adjacent vertices. |  | screens 9 and 10, from the second wrong answer on | a gentle reminder: warm, clear, never disappointed | yes |
| 15 | 10 | hexagon-your-turn | `assets/vo/p15.mp3` | say | Your turn! Let’s draw all the diagonals from this vertex. | Your turn! / Let’s draw all the diagonals / from this vertex. | screen 10 | playful, inviting | yes |
| 16 | 10 | hexagon-your-turn | `assets/vo/p15i.mp3` | instruction | Let’s draw all the diagonals from this vertex. |  | screen 10, the instruction | an instruction: plain, steady, every word clear | yes |
| 17 | 11 | look-diagonals | `assets/vo/p16.mp3` | say | Look at the diagonals of this pentagon. | Look at the diagonals / of this pentagon. | screen 11 | explaining, warm and clear | yes |
| 18 | 12 | inside-or-outside | `assets/vo/p17i.mp3` | instruction | Are the diagonals inside or outside? |  | screen 12, the instruction | an instruction: plain, steady, every word clear | yes |
| 19 | 13 | lets-change | `assets/vo/p18.mp3` | say | Let’s make a change. |  | screen 13 | playful, inviting | yes |
| 20 | 14 | drag-inward | `assets/vo/p19i.mp3` | instruction | Help me pull this vertex inside. |  | screen 14, the instruction | an instruction: plain, steady, every word clear | yes |
| 21 | 15 | whoa | `assets/vo/p20.mp3` | say | Whoa! One of the diagonals went outside. | Whoa! One of the diagonals / went outside. | screen 15 | surprised, amazed | yes |
| 22 | 16 | compare | `assets/vo/p21.mp3` | say | Let’s compare the diagonals in both the pentagons. |  | screen 16 | playful, inviting | yes |
| 23 | 17 | all-inside | `assets/vo/p22.mp3` | say | This one has all the diagonals inside. |  | screen 17 | explaining, warm and clear | yes |
| 24 | 18 | one-outside | `assets/vo/p23.mp3` | say | But this one has atleast one diagonal outside. |  | screen 18 | explaining, warm and clear | yes |
| 25 | 19 | convex | `assets/vo/p24.mp3` | say | All diagonals inside means convex polygon. |  | screen 19 | explaining, warm and clear | yes |
| 26 | 20 | concave | `assets/vo/p25.mp3` | say | Atleast one diagonal outside means concave polygon. | Atleast one diagonal outside / means concave polygon. | screen 20 | explaining, warm and clear | yes |
| 27 | 21 | make-concave | `assets/vo/p26i.mp3` | instruction | Drag any vertex to make this polygon concave. |  | screen 21, the instruction | an instruction: plain, steady, every word clear | yes |
| 28 | 22 | sort-convex-concave | `assets/vo/p27.mp3` | say | Can you sort these polygons as convex or concave? |  | screen 22 | playful, inviting | yes |
| 29 | 23 | suspicious | `assets/vo/p28.mp3` | say | Hmm… The sides look suspiciously alike. Let’s check! | Hmm… / The sides look suspiciously alike. / Let’s check! | screen 23 | wondering aloud, a little slower | yes |
| 30 | 24 | measure-sides | `assets/vo/p29i.mp3` | instruction | Tap the sides to measure them. |  | screen 24, the instruction | an instruction: plain, steady, every word clear | yes |
| 31 | 25 | sides-equal | `assets/vo/p30.mp3` | say | Every side is equal. But what about the angles? | Every side is equal. / But what about the angles? | screen 25 | asking: curious, open | yes |
| 32 | 26 | measure-angles | `assets/vo/p31i.mp3` | instruction | Tap the angles to measure them. |  | screen 26, the instruction | an instruction: plain, steady, every word clear | yes |
| 33 | 26 | measure-angles | `assets/vo/p31.mp3` | say | The angles match too! |  | screen 26 | explaining, warm and clear | yes |
| 34 | 27 | distort | `assets/vo/p32a.mp3` | say | Help me stretch this corner. Let’s see what happens to the sides and angles. | Help me stretch this corner. / Let’s see what happens / to the sides and angles. | screen 27 | playful, inviting | yes |
| 35 | 27 | distort | `assets/vo/p32ai.mp3` | instruction | Drag the highlighted vertex. |  | screen 27, the instruction | an instruction: plain, steady, every word clear | yes |
| 36 | 28 | stayed-changed | `assets/vo/p32b.mp3` | say | It’s still a pentagon. But are the sides and angles still equal? | It’s still a pentagon. / But are the sides / and angles still equal? | screen 28 | asking: curious, open | yes |
| 37 | 28 | stayed-changed | `assets/vo/p32bi.mp3` | instruction | Are the sides and angles still equal? |  | screen 28, the instruction | an instruction: plain, steady, every word clear | yes |
| 38 | 29 | regular-vs-irregular | `assets/vo/p32c.mp3` | say | All sides AND all angles same: regular. Otherwise, it’s irregular. | All sides AND all angles same: / regular. / Otherwise, it’s irregular. | screen 29 | explaining, warm and clear | yes |
| 39 | 30 | sort-regular | `assets/vo/p33.mp3` | say | Where does this polygon belong? |  | screen 30 | asking: curious, open | yes |
| 40 | 31 | summary | `assets/vo/p37a.mp3` | say | A vertex is a corner where two sides meet. |  | screen 31 | explaining, warm and clear | yes |
| 41 | 31 | summary | `assets/vo/p37b.mp3` | say | A side is a straight line joining two vertices. |  | screen 31 | explaining, warm and clear | yes |
| 42 | 31 | summary | `assets/vo/p37c.mp3` | say | An angle is formed where two sides meet. |  | screen 31 | explaining, warm and clear | yes |
| 43 | 31 | summary | `assets/vo/p37d.mp3` | say | A diagonal joins two non-adjacent vertices. |  | screen 31 | explaining, warm and clear | yes |
| 44 | 31 | summary | `assets/vo/p37e.mp3` | say | In a convex polygon, all diagonals stay inside. |  | screen 31 | explaining, warm and clear | yes |
| 45 | 31 | summary | `assets/vo/p37f.mp3` | say | In a concave polygon, atleast one diagonal goes outside. |  | screen 31 | explaining, warm and clear | yes |
| 46 | 31 | summary | `assets/vo/p37g.mp3` | say | A regular polygon has all sides and all angles equal. |  | screen 31 | explaining, warm and clear | yes |
| 47 | 31 | summary | `assets/vo/p37h.mp3` | say | If the sides or angles are not all equal, the polygon is irregular. |  | screen 31 | explaining, warm and clear | yes |
| 48 | 31 | summary | `assets/vo/p37i.mp3` | say | Amazing! You explored all these polygon ideas! |  | screen 31 | explaining, warm and clear | yes |

## Answers (16), said when the child answers

| File | Line | When | Delivery | Recorded |
|------|------|------|----------|----------|
| `assets/vo/fb01.mp3` | Nice! | the first right answer on a screen (rotates) | a cheer, delighted | yes |
| `assets/vo/fb02.mp3` | That’s it! | the first right answer on a screen (rotates) | a cheer, delighted | yes |
| `assets/vo/fb03.mp3` | Great job! | the first right answer on a screen (rotates) | a cheer, delighted | yes |
| `assets/vo/fb04.mp3` | You got it! | the first right answer on a screen (rotates) | a cheer, delighted | yes |
| `assets/vo/fb05.mp3` | Yes! | the first right answer on a screen (rotates) | a cheer, delighted | yes |
| `assets/vo/fb06.mp3` | Well done! | the first right answer on a screen (rotates) | a cheer, delighted | yes |
| `assets/vo/fb07.mp3` | Hmm, not quite. | a wrong answer (rotates, at most every 3 s) | gentle and encouraging, never disappointed | yes |
| `assets/vo/fb08.mp3` | Try again! | a wrong answer (rotates, at most every 3 s) | gentle and encouraging, never disappointed | yes |
| `assets/vo/fb09.mp3` | Almost! Have another go. | a wrong answer (rotates, at most every 3 s) | gentle and encouraging, never disappointed | yes |
| `assets/vo/fb10.mp3` | Not that one. | a wrong answer (rotates, at most every 3 s) | gentle and encouraging, never disappointed | yes |
| `assets/vo/fb15.mp3` | Drop it on a corner! | a try that falls short, with the reason | gentle and encouraging, never disappointed | yes |
| `assets/vo/fb11.mp3` | Pull it in more! | a try that falls short, with the reason | gentle and encouraging, never disappointed | yes |
| `assets/vo/fb12.mp3` | Every side AND every angle matches! | a try that falls short, with the reason | gentle and encouraging, never disappointed | yes |
| `assets/vo/fb13.mp3` | Look — the sides are different lengths. | a try that falls short, with the reason | gentle and encouraging, never disappointed | yes |
| `assets/vo/fb14.mp3` | Equal sides, but look at the corners! | a try that falls short, with the reason | gentle and encouraging, never disappointed | yes |
| `assets/vo/fb16.mp3` | Look — the sides and the angles are different. | a try that falls short, with the reason | gentle and encouraging, never disappointed | yes |

## Not recorded

The finale line, "Honk-tastic! <XP> XP and <badges> badges. You are a polygon adventurer!", carries the child’s own score, so it is shown and not voiced.
