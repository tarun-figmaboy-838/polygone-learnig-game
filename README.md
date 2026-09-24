# Swiftee &amp; the Polygons

A 34-screen guided lesson: diagonals, convex and concave, regular and irregular.
Plain scripts, no build step, no framework. Open it and it runs.

```
npm install          # test tooling only; the game itself needs nothing
npm start            # http://localhost:8000
npm test             # logic, storyboard and a full headless playthrough
npm run test:browser # the same lesson played in a real Chrome
```

It works over `file://` too — there is nothing to fetch that a file page cannot
load.

---

## Layout

```
index.html                 the page: markup, styling, script order
serve.js                   local static server
vercel.json                static deploy: no build, cache rules

src/
  core/
    director.js            runs each screen as awaited beats — timing only
    input.js               one pointer stream, routed by mode
    polygon-math.js        every right/wrong judgement the game makes
  game/
    screens.js             the storyboard, page by page, as data
    stage.js               everything the learner sees and touches
    game.js                wiring, layout, HUD, the screen loop
    dual-coding.js         binds each spoken term to the thing it names
  character/
    swiftee.js             the companion, driven by the sprite sheets
    swiftee-frames.js      GENERATED from the manifest — do not edit
  audio/
    sfx.js                 fourteen cues, synthesised; no audio files
  fx/
    juice.js               pops, wobbles, confetti
    sleigh-intro.js        the arrival: three sprite sheets, one animation
    snowflake.js           the shape of a crystal — the ambient snow and the title
    titlefx.js             the title screen's weather and its sparkle
    transition.js          the snowfall between levels (chapters), from the flake art

assets/
  bg/ice-vista.png         the painted backdrop
  ui/banner.webp           the title art
  ui/play.webp             the play button, cut off its white square
  ui/*.webp                the card, button and flake kits, cut by the tools
                           below from the supplied *.png beside them
  swiftee/                 the character sprite sheets + the manifest

tools/
  build-swiftee-frames.js  manifest -> src/character/swiftee-frames.js
  build-sleigh-frames.js   measures the three intro sheets from their alpha
                           -> src/character/sleigh-frames.js
  build-card.js            the card kit (panel, measure, option, bins, zones,
                           compare, plank) -> src/game/card-frame.js
  build-buttons.js         the pill and coin kit -> src/game/button-frame.js
  build-measuring.js       the measuring walk sheet -> measuring-frames.js
  build-snowflake.js       the transition flake -> assets/ui/snowflake.webp
  list-sprites.js          which sheets the game actually plays
  export-used-sprites.js   copies those sheets into swiftee-in-use/,
                           one folder per state, for re-costuming

tests/                     see "Test gates"
docs/BUILD.md              the original build handoff and deck review
```

---

## How it fits together

```
screens.js  ──  what happens, in what order, with what words   (data)
     │
     ▼
director.js ──  runs each screen as awaited beats               (timing)
     │
     ▼
handlers    ──  stage, swiftee, say, input, sfx, juice          (game.js)
     │
     ▼
polygon-math.js ── every right/wrong judgement                  (truth)
```

**`screens.js` is the single source of the storyboard.** If a line of copy
changes, it changes there and nowhere else.

**`director.js` owns timing and nothing else.** Every beat is awaited. Three
properties are tested rather than promised: a screen change aborts everything
inside the previous one; no beat can hang the lesson; a tap fast-forwards
narration but can never skip an input or its feedback.

**`polygon-math.js` decides right and wrong.** Nothing is ever hard-coded —
"this pentagon is convex" is `Poly.classify(v).convex` on the live vertices, so
an art change or a child dragging further than expected cannot desync the shape
from its answer key.

---

## The character

`assets/swiftee/` is a rendered Rive rig: 82 animations, each a uniform grid of
512px cells (256 @1x), pivot at the exact cell centre, feet on a baseline 87.7%
down the cell, 20 fps. Those four facts are why swapping expressions never makes
him jump, and nothing in the code may break them.

Nothing hardcodes a frame count or a grid. `tools/build-swiftee-frames.js` reads
`assets/swiftee/swiftee.manifest.json`, checks it against the files on disk, and
generates `src/character/swiftee-frames.js`. Re-run it after replacing any sheet;
it fails the build if the art and the manifest disagree.

The lesson speaks sixteen semantic states (`wave`, `think`, `celebrate`…). The
translation to rig states lives in one table at the top of `swiftee.js`, and the
storyboard never had to change to accommodate the art. Most expressions ship as
`start → loop → stop` and all three are played — cutting between loops skips the
transition the animator drew.

`node tools/list-sprites.js` prints exactly which sheets the game plays, what
each is for, and which animations it never touches. Those stay in the rig: a
sheet is only fetched when he plays it, so they cost a player nothing.

---

## The weather

One generator, `fx/snowflake.js`, makes every snowflake in the game: the
crystals drifting past the lesson, the thirty falling over the title art in
three depths, the nine enormous ones that cover the screen between screens,
and the few mixed into the confetti. They are all the same six-armed lattice
at different sizes, which is what makes the transition read as the weather
closing in rather than as an effect switching on.

The wipe marks **a new level**, not a new page: it fires on the first screen
of each quest chapter — Shape scout, Diagonal detective, Dent discoverer,
Pattern pro, Polygon builder — and nowhere else. The screens inside a level
step from each other with their own small entrances, which is what keeps a
demonstration reading as one continuous thing.

Before the crystals arrive, `Stage.flurry()` raises the scene's own snowfall:
a reserve of bigger, faster flakes joins the calm ones and the calm ones speed
up. The storm builds, then covers.

---

## The speech bubble

The shape is a supplied comic design — a catch-light in the corner, two short
strokes either side, and a curved horn — drawn in the game's own cream and
orange. The whole thing is sized in `em` off one clamped `font-size` on
`#bubble`, so padding, radius, horn, sheen and marks scale together and a
breakpoint only has to change one number.

The horn is filled before it is stroked, so its fill covers the body's own
border where the two meet and one unbroken outline runs round both. `aimTail()`
puts it on whichever edge faces Swiftee, slides it to the point nearest his
head, rotates it, and then sets the bubble's `transform-origin` to that same
point — so the bubble pops out of the horn, which is to say out of Swiftee.

Three things from the source design were deliberately left out, each with the
reason written where it would have gone: the hidden duplicate of the line that
reserved its width (needed for a character-by-character typewriter, useless
once every word is laid out from the first frame), a 10px left margin that
pushed the text off centre at every size, and the glide between two lines of
one speech — no screen here says more than one line, so it could never have run.

---

## Test gates

| Suite | What it guards |
| --- | --- |
| `tests/polygon-math.test.js` | 77 checks. Every geometric judgement, including page 21's rhombus and rectangle traps |
| `tests/director.test.js` | 38 checks. Ordering, cancellation, never-stuck, skip safety, branching |
| `tests/screens.test.js` | 55 checks. Unique ids and VO ids, the instruction card simulated across all 34 screens, no wrong path containing words, no answer ghosts |
| `tests/swiftee.test.js` | 26 checks. The frame table still matches the manifest, every grid can address every frame, every sheet exists, no reaction outruns the beat ceiling |
| `tests/playthrough.jsdom.js` | A scripted child plays all 34 screens, trying a wrong answer first on every judged one |
| `tests/playthrough.browser.js` | The same lesson in a real Chrome, via Playwright — including a real pointer drag on the swipe practice, a twitch that must not classify, and a wrong swipe that must not advance |
| `tests/qa.browser.js` | The same lesson played BADLY in Chrome — mashed buttons, taps on the scenery, resizes mid-screen — plus type size, contrast and touch-target measurements. See docs/QA.md |

The browser suite exists because jsdom has no hit testing, and that is a whole
class of bug it cannot see: a faded-out Start button sitting over the middle of
the screen swallowing every tap, an invisible ghost line covering the vertex a
child has to grab, answer buttons drawn below the bottom edge of the stage. All
three shipped green through the headless suite.

`--checks` runs only the rendering and layout assertions (about six seconds);
the full play needs real memory headroom for a software-rendered headless Chrome.

## Deploying

There is nothing to build. The repo root **is** the site: `index.html` plus
`src/` and `assets/`.

```
vercel            # preview
vercel --prod     # production
```

`vercel.json` pins that: no install step, no build step, output directory `.`.
The two cache rules matter — `assets/` is immutable for a year (the sprite
sheets and the backdrop are 9.5 MB and never change without a filename change),
while `index.html` and `src/` must revalidate, or a child gets yesterday's
lesson against today's storyboard.

`.vercelignore` keeps the tests, the tools and the screenshot artifacts out of
the deployment; they are development gates, not part of the game.

Any static host works the same way — GitHub Pages, Netlify, an S3 bucket.
Serve the root, open `/`.

---

## Not done

- **No narration.** The lesson is read, not spoken: the bubble shows the line and
  the director's reading time paces it.
- **No music.** `SFX.musicBus()` exists and `SFX.duck()` can pull it down; no loop is wired.
- **Not tested on a real tablet.** Everything here is from Chrome and jsdom on a
  desktop. The playthroughs prove the lesson cannot get stuck and that every
  screen completes; they say nothing about how it feels in a child's hands.
