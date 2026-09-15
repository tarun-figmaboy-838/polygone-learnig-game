# Launch checklist

State of the build at the final polish pass. Everything marked ✅ was verified
by a gate that fails the build, not by looking at it once.

---

## Content

| | |
| --- | --- |
| ✅ | All **39 screens** present, in storyboard order, each with a unique id |
| ✅ | All **36 script lines** match the recording script word for word — none rewritten, none paraphrased |
| ✅ | **12 interaction types** all reachable and all exercised, including the swipe classification |
| ✅ | Swipe practice: five shapes one at a time, left for Regular, right for Irregular — judged from live geometry, never from a table |
| ✅ | A wrong swipe keeps the same shape; a twitch under the threshold classifies nothing. Both gated in the browser run |
| ✅ | Every judged screen answers correctly to a **wrong** attempt first — 8 of them, tested that way on every run |
| ✅ | No answer ghosts: no wrong path contains the words of the right one |
| ✅ | Instruction card simulated on all 39 screens; every screen says what to do |

## Truth

| | |
| --- | --- |
| ✅ | Every right/wrong judgement is computed from the **live vertices**, never hardcoded — 77 checks, including page 21's rhombus and rectangle traps |
| ✅ | Art can change without desyncing a shape from its answer key |
| ✅ | Frame table **generated** from the manifest; the build fails if art and manifest disagree |

## Timing and flow

| | |
| --- | --- |
| ✅ | Every beat awaited; a screen change cancels everything inside the previous one |
| ✅ | **No beat can hang the lesson** — every wait has a ceiling |
| ✅ | A tap fast-forwards narration but can never skip an input or its feedback |
| ✅ | Advance is the **Next button only**. Stage taps reach the lesson; they never advance it |
| ✅ | 220 ms guard after each advance, so a double-tap cannot skip a screen |
| ✅ | Never stalled on a screen across a full real-browser playthrough (39/39, 104 s) |

## Layout

| | |
| --- | --- |
| ✅ | **No overlay covers the lesson, the character, or another overlay** — checked against real geometry, not assumed |
| ✅ | Bubble placement measures the free space beside the shape, then verifies and shrinks up to three times if it still collides |
| ✅ | Re-measured after the webfont loads, so the first line is not sized against a fallback |
| ✅ | Swiftee **never cropped** at any edge, at desktop or phone width |
| ✅ | Swiftee **not oversized** — sized as a fraction of the drawn bird, not of the mostly-empty sprite cell |
| ✅ | Centred when he is alone on screen, with a ground shadow so he reads against the vista |
| ✅ | No horizontal overflow at phone width |
| ✅ | Answer buttons and the sort tray clamped inside the viewBox at every width |

## Character

| | |
| --- | --- |
| ✅ | Real sprite sheets, 20 fps, pivot at the cell centre, feet on the 87.7% baseline |
| ✅ | **Does not shift when the expression changes** — the single most visible bug class, gated |
| ✅ | start → loop → stop triads all played; no cutting between loops |
| ✅ | Flies in for the entrance, banks, dips, lands, settles into talking |
| ✅ | 10-sheet LRU so a long session does not exhaust image memory |
| ✅ | A sheet that fails to load is forgotten, not cached as broken — the last good frame stays up and the next request retries |
| ✅ | **Every speaking screen carries an expression.** Eleven screens said something with a feeling in it and wore none |
| ✅ | **He answers the child.** A wrong answer used to leave him smiling; he is now puzzled *with* them, and pleased on a right one |
| ✅ | The storyboard's allowed states are read off the renderer, so the vocabulary cannot drift from what is implemented |

## Presentation

| | |
| --- | --- |
| ✅ | Painted title screen, with fairy snow falling over it in three depths and the art drifting slowly behind |
| ✅ | Play button placed on a point in the **painting**, not in the window, so the crop cannot move it off the ice — and clamped so it can never leave the screen |
| ✅ | The button holds still; its **glow** breathes. A target that never stops moving is a target a child has to chase |
| ✅ | Title art 2.3 MB → 159 KB, play button 1.1 MB → 19 KB, cut off its white square with a clean alpha edge |
| ✅ | Painted vista backdrop with **six-armed crystals**, not dots, plus glints and a light band; **no vector clouds drawn over the painted sky** |
| ✅ | Fairy-snow wipe: the snowfall thickens, then nine big crystals fly in and their frost patches fuse into a sheet of ice |
| ✅ | The wipe fires on **new UI or a new kind of doing** — never on a screen that only says another sentence |
| ✅ | Dialogue arrives **a word at a time**, laid out at its final size from the first frame so it never jitters or re-places mid-line |
| ✅ | Dual coding: each key term is tinted, and the thing it names haloes on stage in the same colour as that word appears |
| ✅ | Dialogue box: the supplied comic design — catch-light, two emphasis strokes, a curved horn — in the game's own cream and orange |
| ✅ | The horn points at Swiftee from whichever edge faces him, and the bubble **pops out of the horn**, so every line springs from the speaker |
| ✅ | The whole component is sized in `em` off one clamped font-size, so padding, radius, horn, sheen and marks scale together |
| ✅ | Text is centred (the source design pushed it 10px right of centre at every size) and the vestigial hidden-duplicate copy is gone |
| ✅ | A finished task shows **confetti**, not a caption. The XP toast is gone; the words remain for a screen reader |
| ✅ | 14 synthesised cues, no audio files, muteable |
| ✅ | `prefers-reduced-motion` honoured throughout |

## Ship

| | |
| --- | --- |
| ✅ | No build step. The repo root **is** the site |
| ✅ | `vercel.json`: no install, no build, output `.`, assets immutable for a year, `index.html` and `src/` revalidating |
| ✅ | `.vercelignore` keeps tests, tools, docs and screenshots out of the deployment |
| ✅ | Deploy payload **10.1 MB** — 9.5 MB of it sprite sheets and the backdrop; the supplied title PNGs stay out of it |
| ✅ | Runs over `file://` as well as over a server |
| ✅ | No runtime errors and no missing assets across a full playthrough |
| ✅ | Dead code and duplicates removed; nothing in `src/` is unreachable |
| ✅ | One source of truth for reduced motion — `Juice.disable()` now stops the transition and the title screen too |
| ✅ | **Nothing leaks across a full lesson**: node count and live animation count are asserted at the end of every browser run |
| ✅ | The browser suite tells a broken reference apart from a full machine: a 404 fails, an allocation failure or a cancelled fetch is reported as what it is |

---

## Gates

```
npm test              77 + 38 + 45 + 26 checks, quest, and a full jsdom playthrough
npm run test:browser  the same 39 screens in a real Chrome, ~105 s
```

Both green at the commit this file ships in.

---

## Known, and deliberate

- **No narration.** The lesson is read, not spoken. The bubble shows the line
  and the director's reading time paces it.
- **No music.** `SFX.musicBus()` and `SFX.duck()` exist; no loop is wired.
- **Not tested on a real tablet.** Everything here is Chrome and jsdom on a
  desktop. The playthroughs prove the lesson cannot get stuck and that every
  screen completes. They say nothing about how it feels in a child's hands —
  that is the one thing left that only a child can tell you.
