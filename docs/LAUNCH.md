# Launch checklist

State of the build at the final polish pass. Everything marked ✅ was verified
by a gate that fails the build, not by looking at it once.

---

## Content

| | |
| --- | --- |
| ✅ | All **39 screens** present, in storyboard order, each with a unique id |
| ✅ | All **36 script lines** match the recording script word for word — none rewritten, none paraphrased |
| ✅ | **11 interaction types** all reachable and all exercised: tap-count, drag-diagonal, tap-vertex, choose, sort, trace, compare, build, spot-the-odd, match, free-explore |
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

## Presentation

| | |
| --- | --- |
| ✅ | Painted vista backdrop with drifting snow and glints; **no vector clouds drawn over the painted sky** |
| ✅ | Fairy-snow wipe between screens — and only when the scene actually rebuilds, so a same-scene beat does not flash |
| ✅ | Dialogue arrives **a word at a time**, laid out at its final size from the first frame so it never jitters or re-places mid-line |
| ✅ | Dual coding: each key term is tinted, and the thing it names haloes on stage in the same colour as that word appears |
| ✅ | Dialogue box: one orange rim, one warm underside, cream paper, no stacked outlines and no decorative petals |
| ✅ | 14 synthesised cues, no audio files, muteable |
| ✅ | `prefers-reduced-motion` honoured throughout |

## Ship

| | |
| --- | --- |
| ✅ | No build step. The repo root **is** the site |
| ✅ | `vercel.json`: no install, no build, output `.`, assets immutable for a year, `index.html` and `src/` revalidating |
| ✅ | `.vercelignore` keeps tests, tools, docs and screenshots out of the deployment |
| ✅ | Deploy payload **9.8 MB** — 9.5 MB of it sprite sheets and the backdrop |
| ✅ | Runs over `file://` as well as over a server |
| ✅ | No runtime errors and no missing assets across a full playthrough |
| ✅ | Dead code and duplicates removed; nothing in `src/` is unreachable |

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
