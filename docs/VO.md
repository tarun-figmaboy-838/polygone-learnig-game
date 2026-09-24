# Voice-over script — Swiftee & the Polygons

_Generated from the storyboard by `node tools/vo-script.js`; do not edit by hand._

Every line Swiftee says, **in the order a child hears it**, with the file the game plays. Save each clip as `assets/vo/<id>.mp3`, then run `npm run build:vo`: the game plays it as the words appear and paces the bubbles by the recording. A clip that is not there yet is silent, so they can be added a few at a time.

**Voice:** Swiftee, a small, warm, playful teal bird talking to a seven-year-old. Clear, unhurried and smiling, never shouty. Lines end with a smile, not a drop.

**Files:** mono MP3, 44.1 kHz, 128 kbps or better, about −16 LUFS, no more than 0.2 s of silence at either end. Aim for about 0.4 s per word plus 0.4 s.

**Breaths:** record every line as ONE clip, read naturally, with a short breath at each `/` in the Breaths column. On screen each sentence is one bubble; the breaths are where the words pause inside it.

## Lesson lines (50), in timeline order

| # | Screen | Screen id | File | Type | Line | Breaths | When | Delivery | Recorded |
|---|--------|-----------|------|------|------|---------|------|----------|----------|
| 1 | 1 | intro-hi | `assets/vo/p01.mp3` | say | Hi! I am Swiftee. |  | screen 1 | arriving, friendly | — |
| 2 | 2 | intro-remember | `assets/vo/p02.mp3` | say | Remember we learned about polygons before. |  | screen 2 | wondering aloud, a little slower | — |
| 3 | 3 | intro-define | `assets/vo/p03.mp3` | say | Polygons are closed shapes made from straight lines. | Polygons are closed shapes / made from straight lines. | screen 3 | explaining, warm and clear | — |
| 4 | 4 | which-polygons | `assets/vo/p04.mp3` | say | Which of these are polygons? |  | screen 4 | asking: curious, open | — |
| 5 | 5 | lets-play | `assets/vo/p05.mp3` | say | Let’s play with this one. |  | screen 5 | playful, inviting | — |
| 6 | 6 | pick-vertex | `assets/vo/p06.mp3` | say | Select any vertex. |  | screen 6 | explaining, warm and clear | — |
| 7 | 7 | connect | `assets/vo/p07i.mp3` | instruction | Connect it to another vertex. |  | screen 7, the instruction | an instruction: plain, steady, every word clear | — |
| 8 | 7 | connect | `assets/vo/p09.mp3` | say | This is a side of the polygon. |  | screen 7 | explaining, warm and clear | — |
| 9 | 7 | connect | `assets/vo/p10i.mp3` | instruction | Connect it to a different vertex. |  | screen 7, the instruction | an instruction: plain, steady, every word clear | — |
| 10 | 7 | connect | `assets/vo/p12.mp3` | say | Yay! You made a diagonal! |  | screen 7, after the right answer | a cheer, delighted | — |
| 11 | 8 | define-diagonal | `assets/vo/p13.mp3` | say | A line segment joining two non-adjacent sides is a diagonal. | A line segment joining / two non-adjacent sides / is a diagonal. | screen 8 | explaining, warm and clear | — |
| 12 | 9 | another-diagonal | `assets/vo/p14i.mp3` | instruction | Draw another diagonal from the same vertex. |  | screen 9, the instruction | an instruction: plain, steady, every word clear | — |
| 13 | 9 | another-diagonal | `assets/vo/p14b.mp3` | say | All diagonals are still inside. |  | screen 9, after the right answer | explaining, warm and clear | — |
| 14 | 10 | hexagon-your-turn | `assets/vo/p15.mp3` | say | Your turn! Draw all the diagonals from this vertex. | Your turn! / Draw all the diagonals / from this vertex. | screen 10 | playful, inviting | — |
| 15 | 10 | hexagon-your-turn | `assets/vo/p15i.mp3` | instruction | Draw all the diagonals from this vertex. |  | screen 10, the instruction | an instruction: plain, steady, every word clear | — |
| 16 | 11 | look-diagonals | `assets/vo/p16.mp3` | say | Look at the diagonals of this pentagon. | Look at the diagonals / of this pentagon. | screen 11 | explaining, warm and clear | — |
| 17 | 12 | inside-or-outside | `assets/vo/p17i.mp3` | instruction | Are the diagonals inside or outside? |  | screen 12, the instruction | an instruction: plain, steady, every word clear | — |
| 18 | 13 | lets-change | `assets/vo/p18.mp3` | say | Let’s make a change. |  | screen 13 | playful, inviting | — |
| 19 | 14 | drag-inward | `assets/vo/p19i.mp3` | instruction | Drag the vertex inward. |  | screen 14, the instruction | an instruction: plain, steady, every word clear | — |
| 20 | 15 | whoa | `assets/vo/p20.mp3` | say | Whoa! One of the diagonals went outside. | Whoa! One of the diagonals / went outside. | screen 15 | surprised, amazed | — |
| 21 | 16 | compare | `assets/vo/p21.mp3` | say | Both are pentagons. |  | screen 16 | explaining, warm and clear | — |
| 22 | 16 | compare | `assets/vo/p21i.mp3` | instruction | Compare the diagonals in both pentagons. |  | screen 16, the instruction | an instruction: plain, steady, every word clear | — |
| 23 | 17 | all-inside | `assets/vo/p22.mp3` | say | This one has all diagonals inside. |  | screen 17 | explaining, warm and clear | — |
| 24 | 18 | convex | `assets/vo/p23.mp3` | say | That’s a convex polygon. |  | screen 18 | explaining, warm and clear | — |
| 25 | 18 | convex | `assets/vo/p23i.mp3` | instruction | All diagonals inside means convex polygon. |  | screen 18, the instruction | an instruction: plain, steady, every word clear | — |
| 26 | 19 | one-outside | `assets/vo/p24.mp3` | say | This one has at least one diagonal outside. | This one has at least / one diagonal outside. | screen 19 | explaining, warm and clear | — |
| 27 | 20 | concave | `assets/vo/p25.mp3` | say | So it is a concave polygon. |  | screen 20 | explaining, warm and clear | — |
| 28 | 20 | concave | `assets/vo/p25i.mp3` | instruction | At least one diagonal outside means concave polygon. |  | screen 20, the instruction | an instruction: plain, steady, every word clear | — |
| 29 | 21 | make-concave | `assets/vo/p26i.mp3` | instruction | Drag any vertex to make this polygon concave. |  | screen 21, the instruction | an instruction: plain, steady, every word clear | — |
| 30 | 22 | sort-convex-concave | `assets/vo/p27.mp3` | say | Can you sort these polygons as convex or concave? |  | screen 22 | playful, inviting | — |
| 31 | 23 | suspicious | `assets/vo/p28.mp3` | say | Hmm… The sides look suspiciously alike. Let’s check! | Hmm… / The sides look suspiciously alike. / Let’s check! | screen 23 | wondering aloud, a little slower | — |
| 32 | 24 | measure-sides | `assets/vo/p29i.mp3` | instruction | Tap the sides to measure them. |  | screen 24, the instruction | an instruction: plain, steady, every word clear | — |
| 33 | 25 | sides-equal | `assets/vo/p30.mp3` | say | Every side is equal. But what about the angles? | Every side is equal. / But what about the angles? | screen 25 | asking: curious, open | — |
| 34 | 26 | measure-angles | `assets/vo/p31i.mp3` | instruction | Tap the angles to measure them. |  | screen 26, the instruction | an instruction: plain, steady, every word clear | — |
| 35 | 26 | measure-angles | `assets/vo/p31.mp3` | say | The angles match too! |  | screen 26 | explaining, warm and clear | — |
| 36 | 27 | distort | `assets/vo/p32a.mp3` | say | Help me stretch this corner. Let’s see what happens to the sides and angles. | Help me stretch this corner. / Let’s see what happens / to the sides and angles. | screen 27 | playful, inviting | — |
| 37 | 27 | distort | `assets/vo/p32ai.mp3` | instruction | Drag the highlighted vertex. |  | screen 27, the instruction | an instruction: plain, steady, every word clear | — |
| 38 | 28 | stayed-changed | `assets/vo/p32b.mp3` | say | It’s still a pentagon. But are the sides and angles still equal? | It’s still a pentagon. / But are the sides / and angles still equal? | screen 28 | asking: curious, open | — |
| 39 | 28 | stayed-changed | `assets/vo/p32bi.mp3` | instruction | Are the sides and angles still equal? |  | screen 28, the instruction | an instruction: plain, steady, every word clear | — |
| 40 | 29 | regular-vs-irregular | `assets/vo/p32c.mp3` | say | All sides AND all angles same: regular. Otherwise, it’s irregular. | All sides AND all angles same: / regular. / Otherwise, it’s irregular. | screen 29 | explaining, warm and clear | — |
| 41 | 30 | sort-regular | `assets/vo/p33.mp3` | say | Where does this polygon belong? |  | screen 30 | asking: curious, open | — |
| 42 | 31 | summary | `assets/vo/p37a.mp3` | say | A vertex is a corner where two sides meet. |  | screen 31 | explaining, warm and clear | — |
| 43 | 31 | summary | `assets/vo/p37b.mp3` | say | A side is a straight line joining two vertices. |  | screen 31 | explaining, warm and clear | — |
| 44 | 31 | summary | `assets/vo/p37c.mp3` | say | An angle is formed where two sides meet. |  | screen 31 | explaining, warm and clear | — |
| 45 | 31 | summary | `assets/vo/p37d.mp3` | say | A diagonal joins two non-adjacent vertices. |  | screen 31 | explaining, warm and clear | — |
| 46 | 31 | summary | `assets/vo/p37e.mp3` | say | In a convex polygon, all diagonals stay inside. |  | screen 31 | explaining, warm and clear | — |
| 47 | 31 | summary | `assets/vo/p37f.mp3` | say | In a concave polygon, at least one diagonal goes outside. |  | screen 31 | explaining, warm and clear | — |
| 48 | 31 | summary | `assets/vo/p37g.mp3` | say | A regular polygon has all sides and all angles equal. |  | screen 31 | explaining, warm and clear | — |
| 49 | 31 | summary | `assets/vo/p37h.mp3` | say | If the sides or angles are not all equal, the polygon is irregular. |  | screen 31 | explaining, warm and clear | — |
| 50 | 31 | summary | `assets/vo/p37i.mp3` | say | Amazing! You explored all these polygon ideas! |  | screen 31 | explaining, warm and clear | — |

## Answers (15), said when the child answers

| File | Line | When | Delivery | Recorded |
|------|------|------|----------|----------|
| `assets/vo/fb01.mp3` | Nice! | the first right answer on a screen (rotates) | a cheer, delighted | — |
| `assets/vo/fb02.mp3` | That’s it! | the first right answer on a screen (rotates) | a cheer, delighted | — |
| `assets/vo/fb03.mp3` | Great job! | the first right answer on a screen (rotates) | a cheer, delighted | — |
| `assets/vo/fb04.mp3` | You got it! | the first right answer on a screen (rotates) | a cheer, delighted | — |
| `assets/vo/fb05.mp3` | Yes! | the first right answer on a screen (rotates) | a cheer, delighted | — |
| `assets/vo/fb06.mp3` | Well done! | the first right answer on a screen (rotates) | a cheer, delighted | — |
| `assets/vo/fb07.mp3` | Hmm, not quite. | a wrong answer (rotates, at most every 3 s) | gentle and encouraging, never disappointed | — |
| `assets/vo/fb08.mp3` | Try again! | a wrong answer (rotates, at most every 3 s) | gentle and encouraging, never disappointed | — |
| `assets/vo/fb09.mp3` | Almost! Have another go. | a wrong answer (rotates, at most every 3 s) | gentle and encouraging, never disappointed | — |
| `assets/vo/fb10.mp3` | Not that one. | a wrong answer (rotates, at most every 3 s) | gentle and encouraging, never disappointed | — |
| `assets/vo/fb15.mp3` | Drop it on a corner! | a try that falls short, with the reason | gentle and encouraging, never disappointed | — |
| `assets/vo/fb11.mp3` | Pull it in more! | a try that falls short, with the reason | gentle and encouraging, never disappointed | — |
| `assets/vo/fb12.mp3` | Every side AND every angle matches — regular! | a try that falls short, with the reason | gentle and encouraging, never disappointed | — |
| `assets/vo/fb13.mp3` | Look — the sides are different lengths. | a try that falls short, with the reason | gentle and encouraging, never disappointed | — |
| `assets/vo/fb14.mp3` | Equal sides, but look at the corners! | a try that falls short, with the reason | gentle and encouraging, never disappointed | — |

## Not recorded

The finale line, "Honk-tastic! <XP> XP and <badges> badges. You are a polygon adventurer!", carries the child’s own score, so it is shown and not voiced.
