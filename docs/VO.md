# Voice-over script — Swiftee & the Polygons

_Generated from the storyboard by `node tools/vo-script.js`; do not edit by hand._

Every line the game says — the story’s three voices first, then Swiftee’s — **in the order a child hears it**, with the file the game plays. Save each clip as `assets/vo/<id>.mp3`, then run `npm run build:vo`: the game plays it as the words appear and paces the bubbles by the recording. A clip that is not there yet is silent, so they can be added a few at a time.

**Voice:** Swiftee, a small, warm, playful teal bird talking to a seven-year-old. Clear, unhurried and smiling, never shouty. Lines end with a smile, not a drop.

**Files:** mono MP3, 44.1 kHz, 128 kbps or better, about −16 LUFS, no more than 0.2 s of silence at either end. Aim for about 0.4 s per word plus 0.4 s.

**Breaths:** record every line as ONE clip, read naturally, with a short breath at each `/` in the Breaths column. On screen each sentence is one bubble; the breaths are where the words pause inside it.

## The story (0), before the lesson — in its own voices

Five painted scenes of Momo and Popo play between Start and Swiftee’s first screen. None of these lines is Swiftee’s; each speaker has a voice of their own:

- **narrator** — the storyteller: warm, clear and unhurried, a grown-up reading a picture book aloud
- **momo** — Momo the mammoth: a cute cartoon kid, big-hearted and eager
- **popo** — Popo the polar bear: a cute cartoon kid, bright and bouncy, plainly not the same child as Momo

| # | Scene | Speaker | File | Line | Recorded |
|---|-------|---------|------|------|----------|

## Lesson lines (65), in timeline order

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
| 13 | 9 | another-diagonal | `assets/vo/p14r.mp3` | reminder | A diagonal connects non-adjacent vertices. |  | screens 9 and 10, from the first wrong answer on | a gentle reminder: warm, clear, never disappointed | yes |
| 14 | 10 | hexagon-your-turn | `assets/vo/p15.mp3` | say | Your turn! Let’s draw all the diagonals from this vertex. | Your turn! / Let’s draw all the diagonals / from this vertex. | screen 10 | playful, inviting | yes |
| 15 | 10 | hexagon-your-turn | `assets/vo/p15i.mp3` | instruction | Let’s draw all the diagonals from this vertex. |  | screen 10, the instruction | an instruction: plain, steady, every word clear | yes |
| 16 | 11 | look-diagonals | `assets/vo/p16b.mp3` | say | Let’s look at the diagonals of this pentagon. | Let’s look at the diagonals / of this pentagon. | screen 11 | playful, inviting | yes |
| 17 | 12 | inside-or-outside | `assets/vo/p17i.mp3` | instruction | Are the diagonals inside or outside? |  | screen 12, the instruction | an instruction: plain, steady, every word clear | yes |
| 18 | 12 | inside-or-outside | `assets/vo/fb54.mp3` | say | The diagonals are inside. |  | screen 12, after a wrong answer | explaining, warm and clear | yes |
| 19 | 13 | lets-change | `assets/vo/p18.mp3` | say | Let’s make a change. |  | screen 13 | playful, inviting | yes |
| 20 | 14 | drag-inward | `assets/vo/p19i.mp3` | instruction | Help me pull this vertex inside. |  | screen 14, the instruction | an instruction: plain, steady, every word clear | yes |
| 21 | 15 | whoa | `assets/vo/p20.mp3` | say | Whoa! One of the diagonals went outside. | Whoa! One of the diagonals / went outside. | screen 15 | surprised, amazed | yes |
| 22 |  |  | `assets/vo/fb52.mp3` | say | Whoa! Some of the diagonals went outside. |  | screen undefined | surprised, amazed | yes |
| 23 | 16 | compare | `assets/vo/p21.mp3` | say | Let’s compare the diagonals in both the pentagons. |  | screen 16 | playful, inviting | yes |
| 24 | 17 | all-inside | `assets/vo/p22.mp3` | say | This one has all the diagonals inside. |  | screen 17 | explaining, warm and clear | yes |
| 25 | 18 | one-outside | `assets/vo/p23.mp3` | say | But this one has atleast one diagonal outside. |  | screen 18 | explaining, warm and clear | yes |
| 26 | 19 | convex | `assets/vo/p24.mp3` | say | All diagonals inside means convex polygon. |  | screen 19 | explaining, warm and clear | yes |
| 27 | 20 | concave | `assets/vo/p25.mp3` | say | Atleast one diagonal outside means concave polygon. | Atleast one diagonal outside / means concave polygon. | screen 20 | explaining, warm and clear | yes |
| 28 | 21 | make-concave | `assets/vo/p26i.mp3` | instruction | Drag any vertex to make this polygon concave. |  | screen 21, the instruction | an instruction: plain, steady, every word clear | yes |
| 29 | 21 | make-concave | `assets/vo/fb32.mp3` | say | Try again! |  | screen 21, after a wrong answer | explaining, warm and clear | yes |
| 30 | 21 | make-concave | `assets/vo/p26r1.mp3` | say | The diagonals are still inside the shape, so it is still convex. |  | screen 21, after a wrong answer | explaining, warm and clear | yes |
| 31 | 21 | make-concave | `assets/vo/fb53.mp3` | say | Let me show you. Watch this corner. |  | screen 21, after a wrong answer | explaining, warm and clear | yes |
| 32 | 21 | make-concave | `assets/vo/p26r2.mp3` | say | Now one diagonal goes outside, so the polygon is concave. |  | screen 21, after a wrong answer | explaining, warm and clear | yes |
| 33 | 21 | make-concave | `assets/vo/fb03.mp3` | say | Great job! |  | screen 21, after the right answer | a cheer, delighted | yes |
| 34 | 22 | sort-convex-concave | `assets/vo/p27.mp3` | say | Can you sort these polygons as convex or concave? |  | screen 22 | playful, inviting | yes |
| 35 |  |  | `assets/vo/p27c.mp3` | say | Look! This corner goes inward. |  | screen undefined | explaining, warm and clear | yes |
| 36 |  |  | `assets/vo/p27v.mp3` | say | Look! No corner goes inward. |  | screen undefined | explaining, warm and clear | yes |
| 37 | 23 | suspicious | `assets/vo/p28.mp3` | say | Hmm… The sides look suspiciously alike. | Hmm… / The sides look suspiciously alike. | screen 23 | wondering aloud, a little slower | yes |
| 38 | 24 | measure-sides | `assets/vo/p29s.mp3` | say | Let’s measure the sides. |  | screen 24 | playful, inviting | yes |
| 39 | 25 | sides-equal | `assets/vo/p30.mp3` | say | Every side is equal. But what about the angles? | Every side is equal. / But what about the angles? | screen 25 | asking: curious, open | yes |
| 40 | 26 | measure-angles | `assets/vo/p31m.mp3` | say | Let’s measure the angles. |  | screen 26 | playful, inviting | yes |
| 41 | 26 | measure-angles | `assets/vo/p31.mp3` | say | The angles match too! |  | screen 26 | explaining, warm and clear | yes |
| 42 | 27 | distort | `assets/vo/p32a.mp3` | say | Help me stretch this corner. Let’s see what happens to the sides and angles. | Help me stretch this corner. / Let’s see what happens / to the sides and angles. | screen 27 | playful, inviting | yes |
| 43 | 27 | distort | `assets/vo/p32ai.mp3` | instruction | Drag the highlighted vertex. |  | screen 27, the instruction | an instruction: plain, steady, every word clear | yes |
| 44 | 28 | stayed-changed | `assets/vo/p32b.mp3` | say | It’s still a pentagon. But are the sides and angles still equal? | It’s still a pentagon. / But are the sides / and angles still equal? | screen 28 | asking: curious, open | yes |
| 45 | 28 | stayed-changed | `assets/vo/p32bi.mp3` | instruction | Are the sides and angles still equal? |  | screen 28, the instruction | an instruction: plain, steady, every word clear | yes |
| 46 | 28 | stayed-changed | `assets/vo/p32r.mp3` | say | The sides and angles changed, so they are not equal. |  | screen 28, after a wrong answer | explaining, warm and clear | yes |
| 47 | 29 | regular-vs-irregular | `assets/vo/fb55.mp3` | say | Let’s compare these two pentagons. |  | screen 29 | playful, inviting | yes |
| 48 | 29 | regular-vs-irregular | `assets/vo/fb56.mp3` | say | All the sides and angles are equal in this pentagon. |  | screen 29 | explaining, warm and clear | yes |
| 49 | 29 | regular-vs-irregular | `assets/vo/fb57.mp3` | say | But this pentagon has unequal sides and unequal angles. |  | screen 29 | explaining, warm and clear | yes |
| 50 | 29 | regular-vs-irregular | `assets/vo/fb58.mp3` | say | All sides and angles equal means a regular polygon. Sides and angles unequal means an irregular polygon. | All sides and angles equal / means a regular polygon. / Sides and angles unequal / means an irregular polygon. | screen 29 | explaining, warm and clear | yes |
| 51 | 30 | sort-regular | `assets/vo/p33.mp3` | say | Where does this polygon belong? |  | screen 30 | asking: curious, open | yes |
| 52 |  |  | `assets/vo/fb48.mp3` | say | This one is regular. Every side is equal, and every angle is equal too. |  | screen undefined | explaining, warm and clear | yes |
| 53 |  |  | `assets/vo/fb49.mp3` | say | This one is irregular. Its sides are not all the same length. |  | screen undefined | explaining, warm and clear | yes |
| 54 |  |  | `assets/vo/fb50.mp3` | say | This one is irregular. Its sides match, but its angles are not all equal. |  | screen undefined | explaining, warm and clear | yes |
| 55 |  |  | `assets/vo/fb51.mp3` | say | This one is irregular. Its sides are not equal, and its angles are not equal either. |  | screen undefined | explaining, warm and clear | yes |
| 56 | 31 | summary | `assets/vo/p37o.mp3` | say | Let’s recall what we learned today. |  | screen 31 | playful, inviting | yes |
| 57 | 31 | summary | `assets/vo/p37a.mp3` | say | A vertex is a corner where two sides meet. |  | screen 31 | explaining, warm and clear | yes |
| 58 | 31 | summary | `assets/vo/p37b.mp3` | say | A side is a straight line joining two vertices. |  | screen 31 | explaining, warm and clear | yes |
| 59 | 31 | summary | `assets/vo/p37c.mp3` | say | An angle is formed where two sides meet. |  | screen 31 | explaining, warm and clear | yes |
| 60 | 31 | summary | `assets/vo/p37d.mp3` | say | A diagonal joins two non-adjacent vertices. |  | screen 31 | explaining, warm and clear | yes |
| 61 | 31 | summary | `assets/vo/p37e.mp3` | say | In a convex polygon, all diagonals stay inside. |  | screen 31 | explaining, warm and clear | yes |
| 62 | 31 | summary | `assets/vo/p37f.mp3` | say | In a concave polygon, atleast one diagonal goes outside. |  | screen 31 | explaining, warm and clear | yes |
| 63 | 31 | summary | `assets/vo/p37g.mp3` | say | A regular polygon has all sides and all angles equal. |  | screen 31 | explaining, warm and clear | yes |
| 64 | 31 | summary | `assets/vo/p37h.mp3` | say | If the sides or angles are not all equal, the polygon is irregular. |  | screen 31 | explaining, warm and clear | yes |
| 65 | 31 | summary | `assets/vo/p37i.mp3` | say | Amazing! You explored all these polygon ideas! |  | screen 31 | explaining, warm and clear | yes |

## Answers (17), said when the child answers

| File | Line | When | Delivery | Recorded |
|------|------|------|----------|----------|
| `assets/vo/fb46.mp3` | Keep going! | a try that falls short, with the reason | explaining, warm and clear | yes |
| `assets/vo/fb47.mp3` | Amazing! | a try that falls short, with the reason | explaining, warm and clear | yes |
| `assets/vo/fb44.mp3` | Not quite. A circle is curved. A polygon has only straight sides. | a try that falls short, with the reason | explaining, warm and clear | yes |
| `assets/vo/fb45.mp3` | Not quite. This shape is open. A polygon must be closed. | a try that falls short, with the reason | explaining, warm and clear | yes |
| `assets/vo/fb41.mp3` | Try again! Compare the sides and angles now. | a try that falls short, with the reason | explaining, warm and clear | yes |
| `assets/vo/p38b.mp3` | You are a polygon adventurer! | a try that falls short, with the reason | explaining, warm and clear | yes |
| `assets/vo/p39.mp3` | Now you know everything about polygons. You are ready to help Momo. | a try that falls short, with the reason | explaining, warm and clear | yes |
| `assets/vo/fb15.mp3` | Drop it on a corner! | a try that falls short, with the reason | gentle and encouraging, never disappointed | yes |
| `assets/vo/fb11.mp3` | Pull it in more! | a try that falls short, with the reason | gentle and encouraging, never disappointed | yes |
| `assets/vo/fb40.mp3` | Try again! Stretch the corner a little further. | a try that falls short, with the reason | explaining, warm and clear | yes |
| `assets/vo/fb35.mp3` | Try again! Every side and every angle is equal. | a try that falls short, with the reason | explaining, warm and clear | yes |
| `assets/vo/fb36.mp3` | Try again! The sides are not all equal. | a try that falls short, with the reason | explaining, warm and clear | yes |
| `assets/vo/fb37.mp3` | Try again! The angles are not all equal. | a try that falls short, with the reason | explaining, warm and clear | yes |
| `assets/vo/fb38.mp3` | Try again! The sides and the angles are not all equal. | a try that falls short, with the reason | explaining, warm and clear | yes |
| `assets/vo/sw1.mp3` | Momo needs your help. | a try that falls short, with the reason | explaining, warm and clear | yes |
| `assets/vo/sw2.mp3` | But to help Momo, you need to learn about polygons. | a try that falls short, with the reason | explaining, warm and clear | yes |
| `assets/vo/sw3.mp3` | Now let’s help Momo. | a try that falls short, with the reason | explaining, warm and clear | yes |

## Not recorded

The score between the two finale lines ("<XP> XP and <badges> badges.") is the child’s own, so it is shown and not voiced.
