# QA — played as a child plays

`npm run test:qa`

The other browser suite plays the lesson **correctly**: it answers what it is
asked, once, in order. A seven-year-old does not. They tap the scenery. They
tap the same button five times because nothing happened yet. They start a drag
and change their mind. They turn the tablet sideways in the middle of a
sentence. They lean on the keyboard.

None of that may break a lesson, and none of it is covered by a suite that
behaves. So this one misbehaves on purpose, and then measures the four things
that decide whether a child can actually use the game.

---

## What it does to the game

| | |
| --- | --- |
| Five taps on **Play** in a quarter of a second | must start the game once, not five times |
| Taps on four corners of the **scenery** | must not advance the lesson |
| Three taps on **Next** in 150ms, every screen | must move exactly one screen |
| **Resize** to 1024×768 mid-lesson and back | must not throw or strand anything |
| **Arrow keys** pressed every few screens | must not steal input from the lesson |
| A **clumsy drag** — start, wander, release past the target | must be understood or safely ignored |

## What it measures

| check | threshold | why |
| --- | --- | --- |
| Play button size | ≥ 44px | the smallest target a small finger reliably lands on |
| Speech type size | ≥ 20px | below that a Grade-2 reader stops reading and starts guessing |
| Speech contrast | ≥ 4.5:1 | the text carrying the teaching has to be legible, not merely present |
| Every touchable thing | ≥ 30px | measured on every screen, not sampled |
| Every screen that **asks** something | has a cue | a Next button, an instruction card, a haloed target, or something moving |
| Page health at the end | < 1200 nodes, < 400 animations | nothing accumulated while it was being abused |
| Anything thrown | none | however it was treated |

**A screen that asks nothing needs no cue.** Page 8 draws its own side while
the child watches; demanding a prompt there is demanding a prompt for a
question nobody asked. The suite listens for the director's own `input` events
and only requires a cue on screens that raise one.

---

## What it found

Both of these were invisible to every other gate, because every other gate
plays properly.

**Vertex handles were 29px.** Nine viewBox units had already been grown to
fourteen when the handles were given their cream-and-amber treatment, and
fourteen measures 29px on a 1280 stage — under what a child's finger reliably
hits. Now nineteen, about 38px.

**The cue check caught its own false positive first.** Sampling the moment a
screen opens, nothing is saying anything yet: the line is still arriving a word
at a time and Next has not been offered. Measuring "did this screen *ever* say
anything before it was left behind" is the question worth asking; "is it saying
something right now" is not.

---

## The one thing it cannot do

It stops around screen 11. The driver taps and does a crude drag; it does not
know how to draw a diagonal between two specific vertices, sort six shapes into
bins, or swipe a card to a side. `npm run test:browser` does all of that and
plays to the end — this suite exists to be **rough**, not thorough, and the two
are meant to be read together.

```
npm test              logic, storyboard, sprites, a full jsdom playthrough
npm run test:browser  the lesson played properly in Chrome, all 31 screens
npm run test:qa       the lesson played badly in Chrome
npm run test:all      all three
VOICED=1 node tests/playthrough.browser.js
                      the same playthrough at the real pace with the voice on
                      (slow — the whole lesson, spoken): one voice at a time,
                      no line cut off, no input open while he speaks, no hint
                      over his voice, nothing on the page twice
```
