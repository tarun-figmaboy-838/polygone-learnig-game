# Swiftee — Polygons: build handoff

Read `REVIEW` first. It changes what you build.

## REVIEW — the deck, read as a senior designer and QA

Section 15 of the brief asks for this before implementation. The deck is
good; it also has one factual error, one answer leak, one sequence break,
seven stale or missing instruction cards, and an interaction inconsistency.
Every item below is encoded in `screens.js` with the original kept beside
the correction, so nothing is changed silently.

### Must fix before anyone records VO

| Page | Problem | Fix applied |
| --- | --- | --- |
| **13** | **Factual error.** "A line segment joining two non-adjacent **sides** is a diagonal." A diagonal joins two non-adjacent **vertices**. This is the one line in the game that defines the term, and the deck's own picture shows a vertex-to-vertex segment. | Text corrected; original kept under `original` |
| **15** | **Answer leak.** "Your turn! Draw all the diagonals" — with all three answers drawn as dashed ghosts. The exercise can be done by tracing. Section 2 of the brief forbids exactly this. | Ghosts removed; label "Hexagon" stays |
| **15** | **Sequence break.** Pentagon on pages 5–14, hexagon for one screen, pentagon again on 16–20. Reads as a mistake. | Encoded in place; **recommend moving it after page 17** or to the end of the diagonals unit. Client call |
| **16** | **Stale card.** Instruction still reads "Draw another diagonal from the same vertex." while the dialogue is "Look at the diagonals." Look-only screen. | Card cleared |
| **18, 20, 22, 24, 27, 32b** | **Same bug, six more times.** The deck drops the card on these pages, but a build that only *sets* cards would leave the previous one showing — "Drag the vertex inward" through "Whoa!" | Card explicitly cleared on each. A test simulates the card through all 34 screens and asserts it matches the deck on every one |

### Fix at leisure

| Page | Problem | Fix applied |
| --- | --- | --- |
| 23 | "That's convex polygon." | "That's **a** convex polygon." |
| 25 | "So it is Concave polygon." | "So it is **a concave** polygon." |
| 24 | Missing full stop | Added |
| 25 | Card has a double space ("At least  one") | Single space |
| 30 | Card already says "Tap the angles" while Swiftee is still concluding the sides check — two instructions at once | Card swaps *after* the line finishes |
| 33 | **Interaction inconsistency.** Page 27 sorts by drag-to-bin; page 33 introduces swipe-left/right for the same kind of task, with a direction the child must remember. | Drag-to-bin on both; swipe copy dropped |
| 34 | Reference card, not a screen. Item 5 is captioned "Irregular hexagon" but appears to have more than six vertices. | **Verify before it becomes an asset** |
| 36 | SplashLearn reference image, watermarked | **Must not ship** |

### A design decision the brief forces

Section 2 forbids inventing instructional text. Section 11 requires
encouraging retry feedback. The deck contains **no** wrong-answer dialogue
anywhere. These can't all hold with words, so wrong-answer feedback is
**non-verbal everywhere**: Swiftee reacts (confused, then encourage), the
object shakes, a comic cue plays, input re-opens. No new words. A test
asserts no wrong-path beat ever contains `say` or `instruction`.

If the client wants spoken wrong-answer lines, that is new copy for them to
write, not for the build to invent.

---

## Architecture

Three files carry the game. Everything else is presentation.

```
screens.js  ──  what happens, in what order, with what words   (data)
     │
     ▼
director.js ──  runs each screen as awaited beats               (timing)
     │
     ▼
handlers    ──  your engine: draw, animate, play, listen        (your code)
     │
     ▼
polygon-math.js ── every right/wrong judgement                  (truth)
```

**`screens.js` is the single source of the storyboard.** Dialogue, cards,
Swiftee state, stage setup, interaction spec and feedback branches for all
34 screens. If a line of copy needs to change, it changes here and nowhere
else. `Screens.flags()` lists every deviation from the deck.
`Screens.voScript()` emits the 36-line recording script with VO ids.

**`director.js` is section 3 and section 4 as code.** Every beat is awaited;
nothing starts early. Three properties are tested, not promised:

- *Cancellable.* Changing screen aborts the running sequence and every
  timer, VO and pending input inside it. Nothing from screen 6 can fire
  during screen 7. This is the stale-coroutine bug from the earlier
  conversions, closed structurally.
- *Never stuck.* A VO that fails to load, an animation whose promise never
  resolves, a handler that throws — each falls through to the next beat
  under a ceiling. Section 14.
- *Skip-safe.* A tap during narration fast-forwards the text. It never skips
  an input or feedback, and a reading-time floor means three rapid taps
  can't blow through a line. Children tap constantly.

**`polygon-math.js` decides right and wrong.** Convexity, diagonals,
inside/outside, side and angle equality, regularity, simplicity, and a drag
clamp. 46 tests cover the exact shapes in the deck — including the rhombus
(equal sides, unequal angles) and rectangle (equal angles, unequal sides)
traps on page 21, and "exactly one diagonal went outside" on page 20.

Never hard-code an answer. "Pentagon is convex" is `Poly.classify(v).convex`
on the live vertices. That way an art change, a tolerance change, or a child
dragging a vertex further than expected can't desync the shape from its key.

### Reuse

Already built and tested in this project — use them, don't rebuild:

| Module | Provides here |
| --- | --- |
| `sfx.js` | Every cue in `screens.js`, loudness-matched. Set `SFX.key('C pentatonic')` at boot |
| `juice.js` | Every effect in `screens.js`. Additive; cannot fight your animations |
| `input-mode.js` | Mode-gated pointer routing. Map: `tap-anywhere` → `dialogue`; drags and taps on the stage → `polygon`; transitions → `locked` |
| `pack.js` | `Pack.speak(voId)` for the 36 VO clips; ducks SFX automatically |

---

## What the handlers must implement

Extracted from `screens.js`. These are the complete vocabularies; nothing
outside them is referenced.

### Swiftee states (16)

`celebrate` `confused` `encourage` `enter` `exit` `explain` `inspect` `look`
`mischief` `move` `nod` `point` `step-back` `surprised` `think` `wave`

Plus `idle`, which the handler returns to between beats. `look` and `point`
take `at:` (a stage target). `enter`/`exit` take `from:`/`to:`. `move` takes
`to:` and `size:` — positions used are `left`, `left-low`,
`polygon-top-right`, `off`; sizes `small`, `medium`, `large`.

Only `enter`, `exit`, `move` and `celebrate` are awaited by the director.
The rest are fire-and-forget so a reaction never delays the lesson.

### Input types (11)

| Type | Resolves with `{result}` when |
| --- | --- |
| `tap-anywhere` | Any tap on the stage. `dialogue` mode |
| `vertex-pick` | A vertex is tapped. Store it as `picked` |
| `drag-endpoint` | Endpoint dropped on a vertex. `correct` if `!Poly.isAdjacent(picked, target, n)`, else `wrong` |
| `draw-diagonal` | Line drawn from `from` to a vertex. `correct` if non-adjacent and unused |
| `draw-diagonals` | `count` correct diagonals from `from`. Per-diagonal feedback via `perTap` |
| `drag-vertex` | `until: 'concave'` → `Poly.classify(v).concave`; `until: 'irregular'` → `!Poly.isRegular(v)` with `minMove` px. Apply `Poly.clampSimple` every move |
| `choice` | A button. `correct` if label matches |
| `multi-select` | Each tap judged via `perTap`; resolves when all correct options selected |
| `tap-each` | Each of `count` targets tapped once, revealing `length` or `arc` |
| `sort` | Each drop judged via `perTap` by `Poly.classify`; resolves when all placed correctly |
| `stepper` | Stepper reaches `target`. Polygon morphs live |

### Stage kinds (6)

`vista` `polygon` `choice-grid` `compare` `sort` `builder`

Stage beats also carry incremental ops: `highlight`, `label`, `badge`,
`ghost`, `draw`, `diagonals`, `choices`, `checklist`, `reveal`, `returnItem`.
A handler applies whichever keys are present.

### Cues and effects

SFX (14): `boing` `correct` `honk` `levelUp` `menuWhoosh` `pop` `select`
`slice` `slideWhistle` `sparkle` `tick` `wrong` `zip` — all exist in
`sfx.js`; verified.

Juice (6): `celebrate` `collect` `confetti` `pop` `refuse` `wobble` — all
exist in `juice.js`.

---

## Wiring

```js
var director = Director.create({
  stage:       function (spec, ctx)         { return Stage.apply(spec); },
  swiftee:     function (state, opts, ctx)  { return Swiftee.play(state, opts, ctx); },
  say:         function (text, opts, ctx)   { Bubble.show(text); return Pack.speak(opts.vo); },
  instruction: function (text)              { Card.set(text); },              // null clears
  focus:       function (target, opts)      { Focus.on(target, opts.style); },
  input:       function (spec, ctx)         { return Interact.wait(spec, ctx); },
  sfx:         function (name, opts)        { SFX.play(name, opts); },
  juice:       function (name, target, o)   { Juice[name](Stage.el(target), o); }
});

async function play(fromIndex) {
  for (var i = fromIndex || 0; i < Screens.list.length; i++) {
    var r = await director.run(Screens.list[i].beats);
    if (r === Director.CANCELLED) return;   // someone navigated away
  }
}

Input.on('advance', function () { director.skip(); });   // tap during narration
```

Give `say` the `ctx` and stop the VO in `ctx.onCancel`. Give `swiftee` the
`ctx` and cancel WAAPI animations in `ctx.onCancel`. That is what makes a
scene change clean.

---

## Test gates for the harness

Already written and passing; wire them into the Playwright run.

| Test | Guards |
| --- | --- |
| `polygon-math` (46 checks) | Every judgement the game makes |
| `director` (14 checks) | Ordering, cancellation, never-stuck, skip safety, branching |
| `screens` structural | Unique ids and VO ids; every line said in its beats; wrong paths present and non-verbal; no answer ghosts on "your turn"; the definition says *vertices* |
| `screens` card simulation | Instruction card matches the deck on all 34 screens |
| `screens` end-to-end | Every screen completes through the director; wrong answers re-open input |

Add one in-page test: instrument `SFX.play` and `Juice.*` and assert that
for every judged interaction, a correct answer fires exactly one correct cue
and a wrong answer fires exactly one wrong cue. That is the sync check the
brief asks for in section 6.

---

## Running it

```
cd swiftee
python3 -m http.server 8000      # or Live Server, or npx serve
open http://localhost:8000
```

`index.html` loads eleven scripts in order and needs nothing else. It works
over `file://` too, except that `pack.js` can't fetch recorded clips that
way — the browser voice takes over automatically.

### Voice

The game speaks on first run with the browser's Indian-English voice:
Neerja or Prabhat on Windows/Edge, Heera or Ravi on older Windows, Rishi on
iOS. The start screen shows which one it found. If the device has no en-IN
voice, it falls back to en-GB, then any English.

For the real voice-over:

```
node make-vo.js --voices                 # lists your voices, Indian-accent first
node make-vo.js --voice <id>             # writes assets/vo/*.mp3 + manifest
node make-vo.js --voice <id> --only p20  # redo one line
```

`ELEVENLABS_API_KEY` goes in `.env`. Default model is `eleven_v3`, which
reads mood from the tags `voice.js` supplies per line; if a line wobbles,
pass `--model eleven_multilingual_v2` for that id. On next load the game
finds the manifest and switches from browser speech to the clips. Nothing
else changes.

One delivery table in `voice.js` drives both backends: change a line's mood
there and the browser voice and the ElevenLabs render both follow.

### Tests

| Suite | Runs |
| --- | --- |
| `node smoke.js` | Boots the real page in jsdom, plays screens 1–11 with pointer events, checks skip vs advance, restarts |
| `node playthrough.js` | A scripted child plays all 34 screens, tries a wrong answer first on every judged one, asserts one wrong cue per wrong attempt |
| `polygon-math`, `director`, `screens` | Unit suites described above |

Both browser suites polyfill WAAPI, canvas and speech, so they prove
sequencing and logic, not rendering.

## Not built, and why

**Final art.** Swiftee is a vector placeholder with the full behaviour —
sixteen states, gaze, gestures, entrances. Swap `BODY` in `swiftee.js` for
the real rig; no state changes. The background is a simple vector vista for
the same reason.

**Responsive layout beyond letterboxing.** The stage scales; Swiftee, the
bubble and the card reposition per aspect ratio. Portrait puts him below the
stage box. That is layout, not just scaling, but it has been tuned only
against numbers, not a phone.

**Music.** `SFX.musicBus()` exists and ducks under voice. No loop is wired.

**On-device.** Every claim above is from jsdom and Node. Nothing has been
heard through a tablet speaker, touched by a child, or timed on a low-end
device. The playthrough proves the game cannot get stuck and every screen
completes; it says nothing about whether it feels good.

## Order of work now

1. Client sign-off on pages 13 and 15. Record VO with `make-vo.js`.
2. Play it on the target tablet. Fix what feels wrong before what looks wrong.
3. Final Swiftee art into `swiftee.js`.
4. Background art.
5. Music loop on `musicBus`.
