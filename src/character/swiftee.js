/*!
 * swiftee.js — the companion, driven by the real sprite sheets.
 *
 * The vector placeholder is gone. This plays the rendered Rive rig from
 * `assets/swiftee/` through `swiftee-frames.js`, which is generated from
 * `atlas/swiftee.manifest.json` — nothing here hardcodes a frame count, a
 * grid, a sheet path or a state name, and `tools/build-swiftee-frames.js` fails
 * the build if the manifest and the files on disk ever disagree.
 *
 * What makes the sheets work, and what this file must not break:
 *
 *   UNIFORM GRID   Frame i lives at (i % cols, i / cols), one cell each,
 *                  left-to-right then top-to-bottom. Slicing needs nothing
 *                  but the cell size.
 *   CENTRE PIVOT   Every frame of every animation registers on the exact
 *                  cell centre, so swapping expressions never makes the
 *                  character jump. We render one cell at a fixed 256 CSS px
 *                  and scale the wrapper, so the pivot survives every size.
 *   BASELINE       The standing character's feet are at 87.7% down the cell,
 *                  not the cell edge. That, not the bottom, is aligned to
 *                  the ground — which is why `translate(-50%, -87.7%)`.
 *   FULL TRIAD     Most expressions ship as start -> loop -> stop. Cutting
 *                  from one loop into another skips the transition the
 *                  animator drew. Every switch here plays the outgoing
 *                  `stop` before the incoming `start`.
 *
 * The game speaks sixteen semantic states (screens.js has never heard of
 * "puzzleing"). STATES below is the whole translation layer; the storyboard
 * did not change to accommodate the art.
 *
 *   Swiftee.mount(container, { layout })
 *   Swiftee.play('celebrate')            -> Promise (resolves when it settles)
 *   Swiftee.play('move', { to: 'left-low', size: 'medium' })
 *   Swiftee.speaking(true|false)          // rests on `talking` while narrating
 *   Swiftee.lookAt(elementOrPoint)        // lean, not pupils — it is a sprite
 */
(function (global) {
  'use strict';

  var F = global.SwifteeFrames;

  /** One cell, always rendered at this CSS size; the wrapper scales. */
  var CELL_PX = 256;

  /* ------------------------------------------------------------------ *
   * The translation layer: storyboard state -> rig state.
   *
   * `loops` is how many times the loop clip repeats before the stop clip
   * plays. `hold: true` means stay in the loop until something else is
   * asked for — right for a thinking pose that has to last a whole line of
   * narration, wrong for a cheer.
   *
   * `cut: true` means DO NOT PAY OFF THE OUTGOING STOP CLIP FIRST.
   *
   * The full triad is right for a change of subject and wrong for an answer.
   * A child taps, the sound fires in that same frame — and the face did not
   * begin to change for another seven hundred milliseconds, because the rule
   * was "always play the outgoing stop before the incoming start": 350ms of
   * `listening_stop`, then 350ms of `happy_start`, and only then a happy
   * bird. Add the up-to-400ms grace period for a sheet that had not been
   * fetched and the reaction landed over a second after the tap, which at
   * seven years old is not a reaction at all — it is a delayed announcement,
   * and it is why the animation does not feel connected to the touch.
   *
   * So the states that ANSWER THE CHILD abandon the stop they owe and cut
   * straight to their own start. The stop clip exists to unwind a pose
   * politely; nobody misses it under a cheer. Narrative transitions — a
   * change of pose between lines, where there is time and no tap to answer —
   * keep the full triad exactly as before.
   * ------------------------------------------------------------------ */

  var STATES = {
    // resting
    // 'blinking' AND 'flapping' DID NOT EXIST.
    //
    // Twenty rigs are named in this table and the sheet set carries
    // twenty-six, but two of the names were not among them — so the
    // RESTING state, which is where he spends most of the lesson, pointed at
    // nothing. He animated while a line was being read, because speaking()
    // puts him on 'talking', and froze the moment it cleared. That is the
    // 'wings not moving' report: not a stuck animation, an absent one.
    //
    // 'listening' is the calm attentive loop the set does have, and it is
    // what an idle mascot waiting for a child should be doing.
    // NOT 'listening' ANY MORE. That loop turns him three-quarters away with a
    // wing up and his brows knitted — an anxious face, and the one he wore
    // between every line of the lesson. 'blinking' is the rig's own calm
    // idle: facing the child, pleased, blinking. (He still listens: 'watch'.)
    idle:        { rig: 'blinking',    hold: true, level: 1, tier: 'idle' },

    // narration and attention
    explain:     { rig: 'talking',     hold: true, level: 1, tier: 'present' },
    think:       { rig: 'thinking',    hold: true, level: 2, tier: 'present' },
    inspect:     { rig: 'focussed',    hold: true, level: 2, tier: 'present' },
    look:        { rig: 'curious',     loops: 2,  lean: true, level: 2, tier: 'present' },
    // NOT 'calling'. That rig is a phone call — he lies down and a handset
    // rings beside him — which is a charming animation and has nothing to do
    // with showing a child where to tap. It was mapped here on the name alone.
    //
    // This rig has no pointing animation; there are twenty-six states and not
    // one of them points. 'confident' is the nearest thing to "go on, it is
    // there": an open, assured pose rather than a gesture at a target.
    //
    // Which is fine, because the character was never carrying this job on its
    // own. What actually says WHERE is on the stage: focus() pulses the
    // target and Stage.alive() haloes everything touchable. The character
    // says "your turn"; the stage says "here".
    // NOT 'confident': that rig's face is a set jaw and a frown — a
    // determined adult look that reads as cross on a bird talking to a
    // seven-year-old, and it is the pose he holds for the whole of every
    // "your turn" screen. 'playful' is the same open, leaning-in energy
    // with a face that is pleased about it. One loop: 'excited' was tried
    // and its two loops run fifteen seconds, past the director's ceiling.
    point:       { rig: 'playful',     loops: 1,  lean: true, level: 2, tier: 'present' },

    // reactions
    wave:        { rig: 'waving',      loops: 2, cut: true },
    // `confident` is the closer match for a nod, but its loop is a 4.4s
    // pingpong — far too long for a beat that just means "yes, go on".
    // BRIEF (see CHARACTER DIRECTION): a nod is a second, not three.
    nod:         { rig: 'happy',       brief: 6, mood: 'glad', cut: true, react: true, body: 'notice', level: 2, tier: 'feedback' },
    // The director awaits this one, so it gates every correct answer. One
    // loop is 3.4s end to end; two made the reward outstay its welcome.
    // LEVEL 3: the milestones only — the first diagonal, a finished sort, a
    // shape made concave by the child's own hand, the end. A cheer that
    // follows every tap stops meaning anything by the third.
    celebrate:   { rig: 'celebrating', loops: 1, mood: 'glad', cut: true, react: true, body: 'cheer', level: 3, tier: 'feedback' },
    // A SMALL, LEGIBLE SET. Hearts for encouragement, a wiped brow for
    // stepping back, a puzzle for being stuck: each read as a character
    // from another story. He is glad, curious, confident, surprised or
    // puzzled — the faces a child meets while learning a shape — and no
    // more. A reaction does not colour the next line: 'confused' and
    // 'surprised' are moments, and he talks normally after them.
    // NOT CUT. Encouraging is a recovery — after 'oops', or the "Your turn!"
    // of a new task — and nobody is waiting on it, so the stop of whatever he
    // was doing is paid first, as the animator drew it.
    encourage:   { rig: 'happy',       brief: 6, mood: 'glad', level: 2, tier: 'present' },
    confused:    { rig: 'confused',    brief: 8, cut: true, react: true, level: 2, tier: 'feedback' },
    // "Whoa!": the gasp is a moment, and the line after it is SPOKEN amazed
    // (the mood holds the face), so the reaction itself need not run five seconds
    surprised:   { rig: 'surprised',   brief: 8, cut: true, react: true, mood: 'amazed', level: 2, tier: 'feedback' },
    mischief:    { rig: 'playful',     loops: 2, level: 2, tier: 'present' },
    'step-back': { rig: 'proud',       loops: 1, shift: -34, level: 1, tier: 'present' },

    // moments the game reaches outside screens.js
    // left as it was: the finale settles into it, and the side-measuring
    // screen ends on it (that screen's choreography is protected)
    proud:       { rig: 'proud',       loops: 2, mood: 'glad', cut: true, level: 2, tier: 'feedback' },
    /* MORE THAN ONE FACE FOR THE SAME FEELING.
     *
     * Twenty-six expressions were drawn and fifteen were ever played; a child
     * who answers eight questions right met the identical face eight times,
     * which is the difference between a character and an icon. These are the
     * ones worth having and short enough to be a reaction — nothing here runs
     * past two and a half seconds, which is what ruled 'excited' and 'love'
     * out as answers however charming they are.
     *
     * 'peeping' is the one that matters most: it is the rig drawn for a head
     * coming up over something, and he does that on every card screen while
     * wearing the calm attentive face of 'listening'. */
    // NOT 'peeping': that drawing brings its own red wall — he peers round
    // the edge of a door that is part of the art — and on every screen he
    // peeks over a card from, the wall stood over the card beside his head.
    // Over a card the card IS the thing he is peering round; what the head
    // needs is the calm attentive face this comment always asked for.
    peek:        { rig: 'blinking',    hold: true, level: 1, tier: 'idle' },
    // ('puzzled' was listed here as the puzzle rig AND below as a mood; the
    // second silently won, so the first was never reachable. It is the mood.)
    relieved:    { rig: 'relieved',    brief: 8, cut: true, react: true, level: 2, tier: 'feedback' },
    excited:     { rig: 'excited',     loops: 1, mood: 'glad', cut: true, react: true, body: 'cheer', level: 3, tier: 'feedback' },
    stuck:       { rig: 'thinking',    loops: 2 },
    happy:       { rig: 'happy',       brief: 6, mood: 'glad', cut: true, react: true, body: 'notice', level: 2, tier: 'feedback' },
    daydream:    { rig: 'curious',     hold: true },   // a look around, not a doze: the child is thinking, not gone
    // IN THE AIR: wings going, for as long as he is on a mark with no
    // ground under it (layout gives those marks `air`). The bob is CSS
    // (.swiftee.air), so it rides under every other move.
    hover:       { rig: 'flapping',    hold: true },
    // NOT 'sleeping'. Seventy-five seconds is a child reading a definition
    // and thinking about it, and a companion who lies down with a pillow and
    // Zs over its head at that point is telling them they have taken too
    // long. It also reads as a broken game — the screen looks finished.
    //
    // 'curious' instead: he looks about, as if wondering where they have got
    // to. Known-good, because it is the same rig the lesson already plays for
    // 'look' — which matters after 'calling', where a rig was chosen on the
    // strength of its name and turned out to be a phone ringing.
    sleep:       { rig: 'curious',     hold: true },

    // moods: what a line is spoken in when it follows a reaction
    glad:        { rig: 'happy',       hold: true },
    amazed:      { rig: 'surprised',   hold: true },
    puzzled:     { rig: 'confused',    hold: true },

    /* THE DIRECTION VOCABULARY — what the storyboard asks for now. Every one
     * is an intention ("he is asking", "he is watching the child work"), and
     * every one is a drawing that exists: tests/swiftee.test.js walks this
     * table against the manifest. See CHARACTER DIRECTION below for `brief`,
     * `then`, `seated`, `variants`, `level` and `tier`.
     *
     * LEVEL 1 — hardly moving. The child's hand is the animation now. */
    // 'blinking' is the calmest loop the rig has: standing, facing the work,
    // blinking. It was drawn as the idle and never played.
    watch:       { rig: 'blinking',    hold: true, level: 1, tier: 'act' },

    /* LEVEL 2 — a short, legible gesture, and then out of the way. */
    // "Ta-da — look." Both wings open and close again, leaning toward what he
    // is showing: celebrate_start straight into celebrate_stop.
    present:     { rig: 'celebrating', brief: 3, lean: true, level: 2, tier: 'present' },
    // looking at something with interest, head on one side
    observe:     { rig: 'curious',     brief: 10, lean: true, level: 2, tier: 'present' },
    // a question stands: the head stays tilted while it does
    question:    { rig: 'curious',     hold: true, level: 2, tier: 'present' },
    // "what will happen?" — before the child reshapes something
    curious:     { rig: 'curious',     brief: 6, lean: true, level: 2, tier: 'present' },
    // one card, then the other: `at` is the pair, and he leans to each in turn
    compare:     { rig: 'curious',     loops: 1, lean: true, level: 2, tier: 'present' },
    // THE PROPS. Four drawings nobody had used, each for the one moment it
    // was obviously drawn for: opening a book to remember, writing a rule
    // down, a magnifying glass for "let's check", puzzle pieces for building
    // a shape. `seated` is the standing pose to use instead in the air.
    // held for the whole line: he keeps the book open while it is read
    recall:      { rig: 'reading',     hold: true, seated: 'think', level: 2, tier: 'present' },
    note:        { rig: 'writing',     hold: true, seated: 'explain', level: 2, tier: 'present' },
    investigate: { rig: 'learning',    loops: 1, seated: 'inspect', level: 2, tier: 'present' },
    // held while the child measures the angles: the same glass, looking with them
    examine:     { rig: 'learning',    hold: true, seated: 'inspect', level: 2, tier: 'present' },
    build:       { rig: 'puzzleing',   loops: 1, seated: 'point', level: 2, tier: 'present' },
    // the idle nudge: one look toward whatever is waiting to be touched
    hint:        { rig: 'curious',     brief: 6, lean: true, level: 2, tier: 'hint' },
    // ANSWERING THE CHILD. A miss is "hmm?" for about half a second, then a
    // smile that says go on — never a frown, never a sulk, never long enough
    // to stand between the child and the next try. The second miss on the
    // same question gets his thinking face instead: working it out with them.
    oops:        { rig: 'confused',    brief: 4, cut: true, react: true, then: 'encourage', again: 'rethink', level: 2, tier: 'feedback' },
    rethink:     { rig: 'thinking',    brief: 6, cut: true, react: true, then: 'encourage', level: 2, tier: 'feedback' },
    // an ordinary right answer: a small pleased face, not a party
    happySmall:  { variants: ['nice', 'chuffed', 'wink'], recovered: 'phew', react: true, level: 2, tier: 'feedback' },
    nice:        { rig: 'happy',       brief: 6, mood: 'glad', cut: true, react: true, body: 'notice', level: 2, tier: 'feedback' },
    chuffed:     { rig: 'proud',       brief: 6, mood: 'glad', cut: true, react: true, body: 'notice', level: 2, tier: 'feedback' },
    wink:        { rig: 'playful',     brief: 6, mood: 'glad', cut: true, react: true, body: 'notice', level: 2, tier: 'feedback' },
    // right after a miss: relief, eyes shut — "phew, there it is"
    phew:        { rig: 'relieved',    brief: 8, mood: 'glad', cut: true, react: true, body: 'notice', level: 2, tier: 'feedback' },
    // the shape did something: a quick "oh!" — smaller than a celebration
    discover:    { rig: 'surprised',   brief: 6, mood: 'amazed', cut: true, react: true, level: 2, tier: 'feedback' },

    /* LEVEL 3 — the milestones. Heart eyes for a discovery he loves. */
    delight:     { rig: 'love',        loops: 1, mood: 'glad', cut: true, react: true, body: 'cheer', level: 3, tier: 'feedback' },

    // travel — a standalone loop under a WAAPI move
    enter:       { rig: 'driving',     hold: true },
    // No flight rig exists either. He waves as he goes, and travels on the
    // liveliest loop the set has.
    exit:        { rig: 'flapping',    hold: true },   // he flies off, wings going
    move:        { rig: 'flapping',    hold: true }
  };

  /**
   * Warmed before the start button is released: the resting loop, the
   * greeting and the narration loop — the only clips screen 1 can reach.
   * Everything else is fetched the first time it is asked for, which costs
   * one 400ms grace period per expression, once per session.
   */
  var PRELOAD = ['blinking',
                 'wave_start', 'waving', 'wave_stop',
                 'talk_start', 'talking', 'talk_stop', 'flapping'];

  /* THE SHEETS AN ANSWER NEEDS, warmed while the child is still deciding.
   *
   * These are the only clips a tap can reach, and fetching one costs the
   * reaction up to 400ms of grace period on top of everything else. There is
   * no reason to pay it after the tap: an input beat is dead air on the
   * character's side — he is resting in a pinned loop — so that is when the
   * reaction sheets are fetched. By the time the child commits, they are
   * decoded. warm() is called from game.js as each input arms. */
  var REACTIONS = ['happy_start', 'happy', 'happy_stop',
                   'confused_start', 'confused', 'confused_stop',
                   // and the face he watches the child work with
                   'blinking'];

  /**
   * How many sheet pages may stay decoded at once.
   *
   * This is the one number in the file with real teeth. A @2x sheet is a
   * uniform grid of 512px cells — `blinking` alone is 3584x3072, which is
   * 44 MB once the browser has decoded it to a bitmap. Holding all 50-odd
   * clips the state table can reach is several gigabytes, and it takes the
   * renderer out on a tablet (and, measurably, on a desktop Chrome too).
   *
   * So the cache is an LRU: past the cap, the least recently painted sheet
   * has its Image released and is re-fetched from the HTTP cache if it is
   * needed again. The resting and narration loops are pinned, because those
   * are the two that would otherwise be evicted and reloaded constantly.
   */
  var SHEET_BUDGET = 10;
  /* THE RESTING LOOP WAS NOT THE ONE BEING PINNED.
   *
   * `blinking` is pinned here and warmed above, and nothing plays it: the
   * state table's `idle` points at `listening`, and has since the "wings not
   * moving" fix. So the one loop he spends most of the lesson in held no slot
   * at all — it was evicted by the forty-odd other clips competing for ten,
   * and every return to rest paid a fetch and a grace period, over and over,
   * while a pinned slot sat on a sheet that is never drawn. */
  var PINNED = { blinking: 1, talking: 1, talk_start: 1, talk_stop: 1, flapping: 1 };

  var IDLE_DAYDREAM_MS = 30000;
  var IDLE_SLEEP_MS = 75000;

  /* ------------------------------------------------------------------ *
   * Module state
   * ------------------------------------------------------------------ */

  var el = null, cellEl = null, shadowEl = null;
  var layout = null;                  // function(pos, size) -> { x, y, scale }
  var pos = 'left', size = 'medium';
  var scale = '1x';                   // which sheet resolution is being sampled
  var reduced = false;
  var ready = false;

  var live = [];                      // WAAPI animations on the wrapper
  var shiftAnim = null;               // the one animation allowed to persist
  var active = null;                  // the clip currently on screen
  var gen = 0;                        // bumped by every play(); stale sequences bail
  var stateName = 'idle';             // the storyboard state we are resting in
  var rigLoop = null;                 // the rig loop clip that still owes a `stop`
  var speaking = false;
  /* THE FACE HE SAYS IT WITH. A one-shot reaction ends and he falls back to
     the resting loop, so "Yay! You made a diagonal." was delivered by the
     anxious attentive face of 'listening' two seconds after he had finished
     celebrating. A reaction now leaves a mood behind — glad, amazed,
     puzzled — and a line that starts soon after is spoken in that mood.
     The mood is dropped when the line ends, or if nothing is said for a
     while, so an old smile does not colour a line about something else. */
  var mood = null, moodAt = 0;
  var MOOD_MS = 3000;
  var idleTimer = null, idleLevel = 0;
  var rafId = null, lastT = 0, painted = null;   // url of the sheet currently bound
  var sheets = {};                    // url -> { img, promise, ok, used, pinned }
  var sheetClock = 0;                 // monotonic counter for LRU ordering
  // URLs that have completed a load at least once this session. Survives
  // eviction, because the bytes survive it too — they are in the browser's
  // HTTP cache. Without this, a clip that comes back after being evicted
  // would wait out the grace period again and issue a redundant request.
  var everLoaded = {};

  function nowMs() {
    return (global.performance && global.performance.now) ? global.performance.now() : Date.now();
  }

  /* ------------------------------------------------------------------ *
   * Sheet loading — one Image per page, decoded once, never per frame.
   * ------------------------------------------------------------------ */

  function url(rel) { return F.base + rel; }

  function sheet(rel, clipName) {
    var u = url(rel);
    if (sheets[u]) { sheets[u].used = ++sheetClock; return sheets[u]; }
    var rec = { ok: false, url: u, used: ++sheetClock, pinned: !!PINNED[clipName] };
    rec.promise = new Promise(function (resolve) {
      if (!global.Image) { resolve(false); return; }
      var img = new global.Image();
      img.onload = function () { rec.ok = true; everLoaded[u] = true; resolve(true); };
      img.onerror = function () {
        // Do not cache a failure. A sheet can fail for reasons that pass —
        // a device briefly out of resources, a flaky connection — and a
        // stuck `ok: false` record would leave the character on a broken
        // cell for the rest of the session, because every later request
        // would resolve instantly against the failed promise. Forgetting it
        // costs one retry and gets the expression back.
        delete sheets[u];
        resolve(false);
      };
      img.src = u;
      rec.img = img;
      if (img.complete && img.naturalWidth) { rec.ok = true; resolve(true); }
    });
    sheets[u] = rec;
    evict();
    return rec;
  }

  /** Drop the least recently painted unpinned sheets past the budget. */
  function evict() {
    var keys = Object.keys(sheets);
    if (keys.length <= SHEET_BUDGET) return;
    keys.filter(function (k) { return !sheets[k].pinned && sheets[k].url !== painted; })
        .sort(function (a, b) { return sheets[a].used - sheets[b].used; })
        .slice(0, keys.length - SHEET_BUDGET)
        .forEach(function (k) {
          var rec = sheets[k];
          // Detach and drop the reference only. Do NOT reassign `src`: an
          // empty string resolves against the document, so the browser
          // cancels the real request and fires a fresh one for the page
          // itself — dozens of those is how a run ends in
          // ERR_INSUFFICIENT_RESOURCES. Past this point the decoded bitmap
          // is the browser's own image cache to manage, which it does well;
          // all this map ever owned was the load-completion promise.
          if (rec.img) { rec.img.onload = rec.img.onerror = null; rec.img = null; }
          delete sheets[k];
        });
  }

  /** Every page of a clip at the current scale, with a 1x fallback. */
  function pagesOf(name) {
    var c = F.clips[name];
    if (!c) return null;
    return c.sheets[scale] || c.sheets['1x'];
  }

  function preload(names) {
    (names || []).forEach(function (n) {
      var ps = pagesOf(n);
      if (ps) ps.forEach(function (p) { sheet(p.image, n); });
    });
  }

  /**
   * Wait for a clip's first page, but never longer than `ms`. A sheet that
   * is slow (or, in a headless test, never loads at all) costs a moment of
   * the previous frame staying up — not a stalled lesson.
   */
  function awaitSheet(name, ms) {
    var ps = pagesOf(name);
    if (!ps || !ps.length) return Promise.resolve(false);
    var rec = sheet(ps[0].image, name);
    if (rec.ok || everLoaded[rec.url]) return Promise.resolve(true);
    return Promise.race([rec.promise, delay(ms == null ? 400 : ms)]);
  }

  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ------------------------------------------------------------------ *
   * Painting one frame
   * ------------------------------------------------------------------ */

  function paint(name, frame) {
    var ps = pagesOf(name);
    if (!ps || !cellEl) return;
    var page = ps[0], k;
    for (k = 0; k < ps.length; k++) {
      if (frame >= ps[k].first && frame < ps[k].first + ps[k].frames) { page = ps[k]; break; }
    }
    var local = frame - page.first;
    var col = local % page.cols, row = Math.floor(local / page.cols);

    // Only touch background-image when the page actually changes; the
    // position is the per-frame work and it is a single style write.
    var u = url(page.image);
    if (painted !== u) {
      cellEl.style.backgroundImage = 'url("' + u + '")';
      cellEl.style.backgroundSize = (page.cols * CELL_PX) + 'px ' + (page.rows * CELL_PX) + 'px';
      painted = u;
    }
    if (sheets[u]) sheets[u].used = ++sheetClock;   // keep what is on screen hot
    cellEl.style.backgroundPosition = (-col * CELL_PX) + 'px ' + (-row * CELL_PX) + 'px';
  }

  /* ------------------------------------------------------------------ *
   * The ticker. One rAF for the whole character, stepping at the rig's fps
   * from a wall clock rather than per-callback, so a 120 Hz display and a
   * struggling 30 Hz tablet play the animation at the same speed.
   * ------------------------------------------------------------------ */

  function tick() {
    rafId = global.requestAnimationFrame ? global.requestAnimationFrame(tick) : setTimeout(tick, 50);
    var t = nowMs();
    var dt = lastT ? Math.min(250, t - lastT) : 0;
    lastT = t;
    if (!active) return;
    active.acc += dt;
    var step = 1000 / F.fps;
    var guard = 0;
    while (active && active.acc >= step && guard++ < 8) {
      active.acc -= step;
      advance();
    }
  }

  function startTicker() {
    if (rafId != null) return;
    lastT = 0;
    rafId = global.requestAnimationFrame ? global.requestAnimationFrame(tick) : setTimeout(tick, 50);
  }

  /** Frame order for one pass: forward, or forward-then-back for pingpong. */
  function order(c) {
    var out = [], i;
    for (i = 0; i < c.frames; i++) out.push(i);
    if (c.pingpong) for (i = c.frames - 2; i > 0; i--) out.push(i);
    return out;
  }

  function advance() {
    var a = active;
    a.i++;
    if (a.i >= a.order.length) {
      a.passes++;
      if (a.repeats !== Infinity && a.passes >= a.repeats) { settle(); return; }
      a.i = 0;
    }
    paint(a.name, a.order[a.i]);
  }

  function settle() {
    var a = active; active = null;
    if (a && a.resolve) a.resolve({ done: true });
  }

  /**
   * Play one rig clip for `repeats` passes. Resolves when it finishes, or
   * as `{ interrupted: true }` if something else takes over first.
   */
  function clip(name, repeats, frames) {
    var c = F.clips[name];
    if (!c) {
      if (global.console) console.warn('Swiftee: no clip "' + name + '"');
      return Promise.resolve({ missing: true });
    }
    if (active && active.resolve) active.resolve({ interrupted: true });
    active = null;

    return awaitSheet(name).then(function () {
      return new Promise(function (resolve) {
        var a = {
          name: name, order: frames || order(c), i: 0, passes: 0,
          repeats: repeats == null ? 1 : repeats, acc: 0, resolve: resolve
        };
        active = a;
        paint(name, a.order[0]);
        // Reduced motion gets the pose, not the performance: the first frame
        // of every clip is a legible expression on its own. A finite clip
        // resolves at once so the sequence keeps moving; an endless loop
        // stays `active` (so a scale change can repaint it) but never ticks.
        if (reduced) { if (a.repeats !== Infinity) settle(); return; }
        startTicker();
      });
    });
  }

  function stopActive() {
    if (active && active.resolve) active.resolve({ interrupted: true });
    active = null;
  }

  /* ------------------------------------------------------------------ *
   * States: start -> loop -> stop, and the stop that is owed on the way out
   * ------------------------------------------------------------------ */

  function triad(rig) {
    var s = F.states[rig];
    if (s) return { start: s.start, loop: s.loop, stop: s.stop };
    return { start: null, loop: rig, stop: null };     // a standalone clip
  }

  function fresh() { return ++gen; }
  function stale(g) { return g !== gen; }

  /** Pay off the outgoing state's `stop` clip before anything new begins —
      unless the incoming state is answering a child, in which case the debt
      is written off and the reaction starts in this frame. See `cut` above. */
  function closeCurrent(g, cut) {
    var owed = rigLoop; rigLoop = null;
    if (!owed) return Promise.resolve();
    if (cut) return Promise.resolve();
    var t = triad(owed);
    if (!t.stop) return Promise.resolve();             // sleeping/driving leave by their own clip
    return clip(t.stop, 1).then(function () { return stale(g) ? 'stale' : null; });
  }

  /**
   * Run a storyboard state to completion. `hold` states park in their loop
   * and resolve immediately, so a thinking pose lasts the whole line without
   * the director waiting on it.
   */
  /* THE FIRST FEW FRAMES OF A LOOP, THERE AND BACK.
   *
   * A brief expression still plays all three of the animator's parts —
   * start, loop, stop — but only `n` frames into the loop and back out the
   * same way, so it ends on the loop's own first frame, which is exactly the
   * frame the stop clip was drawn from (measured: the seam is the one the full
   * triad already has). The expression lands in about a second instead of
   * three, and nothing is cut. */
  function briefOrder(loopName, n) {
    var c = F.clips[loopName];
    if (!c) return null;
    n = Math.max(1, Math.min(n, c.frames - 1));
    var out = [], i;
    for (i = 0; i <= n; i++) out.push(i);
    for (i = n - 1; i >= 0; i--) out.push(i);
    return out;
  }

  function runState(name, g) {
    var def = STATES[name] || STATES.idle;
    var t = triad(def.rig);
    var repeats = def.hold ? Infinity : (def.loops == null ? 1 : def.loops);

    return closeCurrent(g, def.cut).then(function () {
      if (stale(g)) return { cancelled: true };
      return t.start ? clip(t.start, 1) : null;
    }).then(function () {
      if (stale(g)) return { cancelled: true };
      rigLoop = def.rig;
      var loop = (def.brief && !def.hold) ? clip(t.loop, 1, briefOrder(t.loop, def.brief)) : clip(t.loop, repeats);
      if (def.hold) return { holding: true };          // do not await an endless loop
      return loop.then(function (r) {
        if (stale(g) || (r && r.interrupted)) return { cancelled: true };
        rigLoop = null;
        return t.stop ? clip(t.stop, 1) : null;
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * Resting behaviour — what he does when nobody asked for anything
   * ------------------------------------------------------------------ */

  function restingState() {
    if (speaking) return mood || 'explain';            // narrating -> the mood, else the talking loop
    if (airborne) return 'hover';                      // nothing to stand on: he flies
    // WHAT HE IS DOING WHILE THE CHILD WORKS — watching their hand, or still
    // holding the question he asked. The game sets it as an input arms and
    // clears it with the verdict (stance()); every reaction in between comes
    // back to it rather than to the resting loop.
    if (stance && STATES[stance]) return stance;
    // HIS CHIN IS ON A CARD: that is a peep, and there is a rig for it
    if (pos === 'peek') return 'peek';
    if (idleLevel === 2) return 'sleep';
    if (idleLevel === 1) return 'daydream';
    return 'idle';
  }

  /* Has the sled already been? The arrival is the opening of the lesson and
     happens once; every later 'enter' is him coming back to a screen he
     stepped off. */
  var arrived = false;

  /**
   * He walks back on from whichever side he left by.
   *
   * Placed first so the slide starts from beside his mark rather than from
   * wherever the exit animation abandoned him, and 'translate' rather than
   * 'transform' because the element is POSITIONED with a transform and
   * animating that property would throw his mark away.
   */
  function slideIn(o, g) {
    var from = (o && o.from === 'right') ? 1 : -1;
    place(pos, size);
    el.style.opacity = '1';
    stateName = 'enter';
    if (reduced || !el.animate) return rest();
    var a;
    if (o && o.from === 'below') {
      // UP FROM BEHIND THE CARD. He is clipped at the slab's rim, so rising
      // from below that line is rising from behind it: a peek-a-boo, with
      // the rig that was drawn for one.
      // Eyes first. He comes up far enough to look over the rim, holds
      // there a beat — that is the peek — and then pops up the rest of the
      // way with a small overshoot. One smooth rise read as a lift; the
      // pause is what makes it a character deciding to show himself.
      // 'curious', not 'peeping': the peeping rig is drawn peering round a
      // wall of its own, and the wall came with it.
      var rise = (o.rise || 200);
      /* A POP, THE WAY A STICKER CHARACTER POPS UP. One springy rise, not a
         slide: he stretches a little as he shoots up, overshoots, squashes
         as he lands on his mark and settles — squash and stretch about his
         feet, so he stays planted behind the rim. The user asked for it
         "smooth, seamless, like a Snapchat character pop". (The old peek-a-boo
         held half-way for a beat, which read as a stall.) */
      el.style.transformOrigin = '50% 88%';
      a = anim([
        { translate: '0 ' + rise + 'px', scale: '0.9 1.1', offset: 0 },
        { translate: '0 -18px', scale: '0.96 1.06', offset: o.quick ? 0.5 : 0.46, easing: 'cubic-bezier(.2,.8,.35,1)' },
        { translate: '0 5px', scale: '1.06 0.93', offset: o.quick ? 0.7 : 0.66, easing: 'cubic-bezier(.4,0,.6,1)' },
        { translate: '0 -3px', scale: '0.98 1.02', offset: 0.84, easing: 'ease-in-out' },
        { translate: '0 0', scale: '1 1', offset: 1 }
      ], { duration: o.ms || (o.quick ? 520 : 640), easing: 'linear' });   // o.ms: the summary's third-of-a-second rise
      clip('curious', 1);
    } else {
      // TWO HOPS IN, wings going: he comes on the way a small bird crosses
      // snow, not the way a panel slides on. The last hop lands on his mark
      // with a little settle.
      a = anim([
        { translate: (from * 380) + 'px 0', opacity: 0, offset: 0 },
        { translate: (from * 300) + 'px -54px', opacity: 1, offset: 0.22, easing: 'cubic-bezier(.3,.6,.5,1)' },
        { translate: (from * 190) + 'px 0', offset: 0.44, easing: 'cubic-bezier(.5,0,.7,.4)' },
        { translate: (from * 90) + 'px -42px', offset: 0.66, easing: 'cubic-bezier(.3,.6,.5,1)' },
        { translate: '0 0', offset: 0.9, easing: 'cubic-bezier(.5,0,.7,.4)' },
        { translate: '0 -6px', offset: 0.95 },
        { translate: '0 0', offset: 1 }
      ], { duration: 820, easing: 'linear' });
      clip('flapping', Infinity);
    }
    return a.finished.then(function () { return stale(g) ? null : rest(); },
                           function () { return stale(g) ? null : rest(); });
  }

  function rest() {
    // A DEDICATED SEQUENCE OWNS HIM (the measuring walk): nothing, not even
    // the resting loop, changes his drawing until it lets go. unlock() rests.
    if (lockedBy()) { restOwed = true; return Promise.resolve({ locked: true }); }
    // Whatever he stepped aside for is over.
    if (shiftAnim) { try { shiftAnim.cancel(); } catch (e) {} shiftAnim = null; }
    // A mood is measured from the END of the reaction that set it: a
    // celebration is three seconds long on its own, and dated from its start
    // the line that follows it always found the mood expired.
    if (STATES[stateName] && STATES[stateName].mood) moodAt = Date.now();
    var want = restingState();
    // Already resting in the right loop: re-running the triad here would
    // play a stop and a start for no visible reason, which reads as a hitch
    // every time narration begins on a screen that is already talking.
    if (want === stateName && rigLoop === STATES[want].rig) return Promise.resolve({ resting: true });
    var g = fresh();
    stateName = want;
    return runState(stateName, g);
  }

  function armIdle() {
    clearTimeout(idleTimer);
    if (reduced) return;
    idleTimer = setTimeout(function () {
      idleLevel = 1;
      if (isResting()) rest();
      idleTimer = setTimeout(function () {
        idleLevel = 2;
        if (isResting()) rest();
      }, IDLE_SLEEP_MS - IDLE_DAYDREAM_MS);
    }, IDLE_DAYDREAM_MS);
  }

  function isResting() {
    return stateName === 'idle' || stateName === 'daydream' || stateName === 'sleep' || stateName === 'explain'
        || stateName === 'glad' || stateName === 'amazed' || stateName === 'puzzled'
        || (stance != null && stateName === stance);
  }

  /**
   * Any real activity brings him back to attention.
   *
   * No `wake` clip any more. That existed to get him up off the floor, and
   * the deep idle no longer puts him on it — playing a getting-up animation
   * from a standing pose is a stumble, not a wake.
   */
  function stir() {
    idleLevel = 0;
    armIdle();
    return Promise.resolve();
  }

  /* ------------------------------------------------------------------ *
   * Placement and motion
   * ------------------------------------------------------------------ */

  /* BEHIND THE CARD. A layout may hand back a page-y below which he is not
     to be painted — the top rim of the slab he is peeking over. Everything
     under that line is clipped, so he reads as standing behind the card
     rather than in front of it. Percentages, because clip-path measures the
     element's own box and the box is scaled: a fraction survives the scale
     where a pixel count would not. */
  var clipY = null;
  var airborne = false;
  function applyClip() {
    if (!el) return;
    if (clipY == null) { el.style.clipPath = ''; return; }
    var r = el.getBoundingClientRect();
    if (!r.height) return;
    var frac = Math.max(0, Math.min(1, (clipY - r.top) / r.height));
    el.style.clipPath = 'inset(0 0 ' + ((1 - frac) * 100).toFixed(2) + '% 0)';
  }

  function place(p, s) {
    if (!layout || !el) return;
    var L = layout(p, s);
    el.style.left = L.x + 'px';
    el.style.top = L.y + 'px';
    el.style.transform = 'translate(-50%,-' + (F.baselineY * 100).toFixed(1) + '%) scale(' + L.scale + ')';
    chooseScale(L.scale);
    clipY = L.clip == null ? null : L.clip;
    applyClip();
    airborne = !!L.air;
    if (el.classList) el.classList.toggle('air', airborne);
    // A BIRD IN THE AIR CASTS NO CONTACT SHADOW. The ellipse under his feet
    // is what says "standing on the ice"; under a hovering bird it said he
    // was standing on nothing. It fades with the mark, and comes back the
    // moment he has ground again.
    if (shadowEl) shadowEl.style.opacity = airborne ? '0' : '';
  }

  /**
   * Pick the sheet resolution from the pixels actually being drawn. Below
   * one device pixel per source pixel the @1x sheet is indistinguishable and
   * a third of the bytes; above it, @2x is the difference between crisp and
   * soft on a retina tablet.
   */
  function chooseScale(k) {
    var dpr = global.devicePixelRatio || 1;
    // Deliberately generous toward @1x. A @2x sheet costs roughly four times
    // the decoded memory, and the art is flat-shaded vector, so it upscales
    // cleanly well past 1:1. Only a mascot drawn appreciably larger than the
    // @1x cell earns the bigger sheets.
    var want = (CELL_PX * k * dpr) > (F.cell['1x'] * 1.6) ? '2x' : '1x';
    if (want === scale) return;
    scale = want;
    painted = null;                                    // force a background-image swap
    sheets = {};                                       // the other scale's pages are dead weight
    if (active) paint(active.name, active.order[active.i]);
  }

  /** Shrink and soften the contact shadow while he is off the ground. */
  function liftShadow(ms) {
    if (!shadowEl || !shadowEl.animate || reduced) return;
    try {
      shadowEl.animate([
        { transform: 'translate(-50%,-35%) scale(1)', opacity: 1 },
        { transform: 'translate(-50%,-35%) scale(.62)', opacity: .45, offset: .5 },
        { transform: 'translate(-50%,-35%) scale(1)', opacity: 1 }
      ], { duration: ms, easing: 'ease-in-out' });
    } catch (e) {}
  }

  /* THE CUT BELONGS TO THE CARD, NOT TO HIM. clip-path is measured in his
     own box, so a clip set for where he rests travels with every translate:
     rising from behind the rim he came up already cut, a straight line
     across his eyes sliding up the card face. So each keyframe that moves
     him carries the clip that keeps the cut on the rim at that height —
     lower on his body as he rises, higher as he sinks — and the rim copy
     over the top of him does the rest. */
  function pinClip(keyframes) {
    if (clipY == null || !keyframes || !keyframes.some(function (f) { return f && f.translate != null; })) return null;
    var r = el.getBoundingClientRect();
    if (!r.height) return null;
    return keyframes.map(function (f) {
      var y = (f && f.translate != null) ? (parseFloat(String(f.translate).trim().split(/\s+/)[1] || '0') || 0) : 0;
      // not clamped at nothing-visible: an inset past 100% is legal, and
      // interpolating from the true value keeps the cut on the rim mid-flight
      var frac = Math.min(1, (clipY - r.top - y) / r.height);
      var k = { clipPath: 'inset(0 0 ' + ((1 - frac) * 100).toFixed(2) + '% 0)' };
      if (f && f.offset != null) k.offset = f.offset;
      if (f && f.easing) k.easing = f.easing;
      return k;
    });
  }

  function anim(keyframes, opts) {
    if (!el || !el.animate || reduced) return { finished: Promise.resolve(), cancel: function () {} };
    var a, c = null;
    var clipFrames = pinClip(keyframes);
    try {
      a = el.animate(keyframes, Object.assign({ composite: 'add', fill: 'none' }, opts));
      // The clip rides alongside as its own animation, REPLACING the resting
      // clip rather than adding to it: the movement is additive so hops can
      // stack on a walk, but an inset added to an inset cut him twice over.
      if (clipFrames) c = el.animate(clipFrames, Object.assign({}, opts, { composite: 'replace', fill: 'none' }));
    } catch (e) { return { finished: Promise.resolve(), cancel: function () {} }; }
    live.push(a);
    if (c) live.push(c);
    a.finished.then(drop, drop);
    function drop() {
      var i = live.indexOf(a); if (i >= 0) live.splice(i, 1);
      if (c) { try { c.cancel(); } catch (e) {} var j = live.indexOf(c); if (j >= 0) live.splice(j, 1); }
    }
    return a;
  }

  function cancelAll() {
    live.slice().forEach(function (a) { try { a.cancel(); } catch (e) {} });
    live.length = 0;
    shiftAnim = null;
  }

  function centre(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

  /**
   * A sprite has no pupils to aim, so "looking at" something is a lean and a
   * small step toward it. It reads, and it cannot desync from the art.
   */
  function lean(target, ms) {
    if (!el || !target || reduced) return null;
    var p = target.getBoundingClientRect ? centre(target.getBoundingClientRect()) : target;
    if (!p || p.x == null) return null;
    var me = centre(el.getBoundingClientRect());
    var dir = p.x >= me.x ? 1 : -1;
    var far = Math.min(1, Math.abs(p.x - me.x) / 500);
    return anim([
      { transform: 'translateX(0) rotate(0deg)' },
      { transform: 'translateX(' + (dir * 10 * far).toFixed(1) + 'px) rotate(' + (dir * 4 * far).toFixed(1) + 'deg)', offset: 0.4 },
      { transform: 'translateX(' + (dir * 8 * far).toFixed(1) + 'px) rotate(' + (dir * 3 * far).toFixed(1) + 'deg)', offset: 0.8 },
      { transform: 'translateX(0) rotate(0deg)' }
    ], { duration: ms || 1400, easing: 'ease-in-out' });
  }

  /* LOOK AT ONE, THEN THE OTHER — comparing is a head going between two
     things. The same lean, twice, each a little quicker; the second only if
     nothing else has been asked for in between. */
  function leanEach(targets, g) {
    var list = (targets || []).filter(Boolean);
    if (!list.length) return;
    var first = lean(list[0], 1100);
    if (list.length < 2 || !first || !first.finished) return;
    first.finished.then(function () { if (!stale(g)) lean(list[1], 1100); }, function () {});
  }

  /* ------------------------------------------------------------------ *
   * The state handlers the director drives
   * ------------------------------------------------------------------ */

  /**
   * Hop down onto the spot and settle.
   *
   * The cart intro calls this at the hand-off: the painted Swiftee leaves with
   * the cart, this one takes over from the seat and jumps clear. `from` is how
   * far left of the landing spot the seat was, `lift` how high the arc goes —
   * both in page pixels, so the caller can match them to the cart's own size
   * rather than guessing at this module's scale.
   *
   * Used on its own it is just a hop in place, which is why `enter` falls back
   * to it when the intro art is missing.
   */
  function land(o) {
    o = o || {};
    if (!el) return Promise.resolve();
    var from = o.from || 0, lift = o.lift || 56;
    var g = fresh(); stateName = 'enter'; rigLoop = null;
    el.style.opacity = '1';

    // Arms out on the way down reads as a jump; blinking would read as a
    // teleport. `flapping` is the rig's only airborne loop.
    clip('flapping', Infinity);
    liftShadow(HOP_MS);
    if (global.SFX) SFX.play('boing');

    var a = anim([
      { transform: 'translate(' + from + 'px, 0) scale(1,1)' },
      { transform: 'translate(' + (from * 0.55) + 'px, ' + (-lift) + 'px) scale(.94,1.08)', offset: 0.45 },
      { transform: 'translate(0, 0) scale(1.14,.86)', offset: 0.84 },
      { transform: 'translate(0, 0) scale(1,1)' }
    ], { duration: HOP_MS, easing: 'cubic-bezier(.3,.85,.4,1)' });

    return a.finished.then(function () {
      bounce('land');
      if (global.SFX) SFX.play('pop');
      if (stale(g)) return;
      return rest();
    });
  }

  /**
   * WHAT HIS BODY DOES, on top of what his face does.
   *
   * The rig carries the expression and nothing else: 'happy' changes a face
   * inside a cell that does not move, so a right answer read as a picture
   * being swapped rather than as a bird being pleased. Weight is what makes a
   * character feel alive — a cheer lifts off the ground, a "no" is a shake of
   * the head — and none of it was there.
   *
   * It goes through anim(), which matters for three reasons the element's own
   * style could not give: the keyframes composite ADD, so a hop lands on top
   * of his resting transform instead of throwing his mark away; the clip that
   * keeps him behind a card rides along pinned to the rim, so he can bounce
   * while peeking without the cut sliding across his eyes; and reduced motion
   * turns it off with everything else.
   *
   * It is deliberately a short vocabulary. Three moves, none longer than half
   * a second, nothing that moves him off his mark — a mascot that lurches
   * around after every tap is noise, and noise is what a child stops reading.
   */
  var BODY = {
    // up, and a stretch on the way — the whole body saying yes. A TINY hop
    // (the direction pass: "a tiny bounce after success", never a squash the
    // drawing does not have): fourteen pixels, and barely any stretch — the
    // celebrating frames carry the joy, this only lifts him off the ice.
    cheer: { ms: 420, easing: 'cubic-bezier(.3,1.4,.5,1)', frames: [
      { transform: 'translate(0,0) scale(1,1)' },
      { transform: 'translate(0,-3px) scale(.98,1.03)', offset: 0.22 },
      { transform: 'translate(0,-14px) scale(1,1)', offset: 0.52 },
      { transform: 'translate(0,0) scale(1.04,.97)', offset: 0.82 },
      { transform: 'translate(0,0) scale(1,1)' }
    ] },
    // a head-shake, not a wobble: small, level, and over quickly
    no: { ms: 380, easing: 'ease-in-out', frames: [
      { transform: 'translate(0,0) rotate(0deg)' },
      { transform: 'translate(-7px,0) rotate(-3deg)', offset: 0.25 },
      { transform: 'translate(7px,0) rotate(3deg)', offset: 0.55 },
      { transform: 'translate(-4px,0) rotate(-1.5deg)', offset: 0.8 },
      { transform: 'translate(0,0) rotate(0deg)' }
    ] },
    // the smallest thing that reads as 'I saw that': a dip and back,
    // fired on the press so the touch itself gets an answer
    notice: { ms: 210, easing: 'cubic-bezier(.3,1.2,.5,1)', frames: [
      { transform: 'translate(0,0) scale(1,1)' },
      { transform: 'translate(0,-8px) scale(.98,1.03)', offset: 0.45 },
      { transform: 'translate(0,0) scale(1,1)' }
    ] },
    // the weight arriving — what a landing owes the ground
    land: { ms: 300, easing: 'cubic-bezier(.2,.9,.3,1)', frames: [
      { transform: 'scale(1,1)' },
      { transform: 'scale(1.16,.84)', offset: 0.3 },
      { transform: 'scale(.96,1.05)', offset: 0.65 },
      { transform: 'scale(1,1)' }
    ] }
  };
  function bounce(kind) {
    var b = BODY[kind];
    if (!b || !el) return Promise.resolve();
    // NOT Juice.squash(). That effect sets transform-origin to the centre of
    // the box, and his origin is the baseline the sprite sheet registers
    // every frame against — one call moved him 22px down the screen for the
    // rest of the session, which is why it was deleted. The call here was
    // left behind, so every landing threw a TypeError inside the promise
    // chain and never reached rest(): he touched down and stayed on the
    // airborne loop.
    return anim(b.frames, { duration: b.ms, easing: b.easing }).finished || Promise.resolve();
  }

  var HOP_MS = 620;      // the hop in land()

  var MOVES = {

    /**
     * He flies in.
     *
     * One continuous move rather than a slide: in from off-stage and high up,
     * a dip and a rise across the middle so the path reads as flight and not
     * as a tween, then a flare and a drop onto the spot. The rig has exactly
     * one airborne loop — `flapping` — and it runs for the whole journey.
     *
     * Three details do most of the work. He banks into the direction of
     * travel and levels off before landing, because a bird that stays upright
     * looks like a sticker being dragged. He comes in slightly small and
     * grows to full size, which reads as distance closing. And the contact
     * shadow stays shrunk until the moment his feet arrive, which is what
     * makes the landing land.
     */
    /**
     * The arrival: he rides in on the sleigh, and the deer takes it away.
     *
     * Three clips the rig has always had and the game had never played.
     * Measured frame by frame before this was built, because `exitsCell`
     * says the art leaves frame during a clip but not which way or when, and
     * an arrival built on a clip that drives the character OUT would have
     * been fighting its own travel:
     *
     *   driving      51 frames, ZERO net drift — a run-in-place cycle. The
     *                legs and the sleigh work while the art stays centred,
     *                so the travel is the ELEMENT moving, not the clip.
     *   drive_away   20 frames, and it ends on opaque bounds of 0.164–0.853
     *                wide with the foot at 0.875 — which is the standing
     *                pose, to three decimal places. It puts him down on his
     *                mark by itself; nothing has to catch him.
     *
     * driving_start is skipped. It is twenty frames in which nothing moves —
     * the art is identical in all of them — so it would be a second of
     * stillness before the arrival began.
     *
     * The bells ride the approach: seven of them as he appears, rung again
     * softer as he pulls up. The hoofbeats are struck one at a time rather
     * than looped, so the gait can slow into the stop instead of cutting off
     * mid-stride.
     */
    /**
     * The arrival: he rides in on the reindeer sled.
     *
     * Three sprite sheets and about six seconds of it, all of which belongs
     * to SleighIntro — see src/fx/sleigh-intro.js for why three separately
     * drawn sheets need that much care to read as one animation.
     *
     * ONE BIRD. The departure sheet draws Swiftee itself, so this element
     * stays hidden for the whole intro and is revealed on the last frame,
     * standing where the drawn one was standing. The intro is scaled FROM
     * this element's own drawn height rather than to some chosen size, so the
     * bird the intro leaves behind and the bird the lesson takes over are the
     * same to the pixel.
     *
     * If anything at all goes wrong — a sheet missing, no canvas, the module
     * not loaded — it falls through to simply being here. An arrival is worth
     * six seconds; it is not worth a lesson that will not start.
     */
    enter: function (o) {
      var g = fresh(); stateName = 'enter'; rigLoop = null;
      var container = (el && el.parentNode) || null;

      /* THE SLED ARRIVES ONCE.
       *
       * 'enter' is not only the opening of the lesson: a screen that sends him
       * away so the child can work uninterrupted brings him back with the same
       * beat — make-concave does exactly that. Every one of those was
       * replaying the whole six-and-a-half second reindeer arrival, in the
       * middle of a task, for a bird who had stepped off the left edge four
       * seconds earlier.
       *
       * The journey is the opening. Coming back is a walk-on. */
      if (arrived) return slideIn(o, g);
      arrived = true;

      if (!global.SleighIntro || !container || !global.SleighFrames) {
        el.style.opacity = '1';
        return rest();
      }

      el.style.opacity = '0';
      var box = api.bounds();
      var cr = container.getBoundingClientRect();
      var mark = box ? {
        markX: (box.left + box.right) / 2 - cr.left,
        markY: box.bottom - cr.top,
        birdHeight: box.height
      } : {};

      if (global.SFX) {
        SFX.play('sleighBells', { n: 7, spread: 0.055, gain: 0.05 });
        var t = 0, stepMs = 0.16;
        for (var i = 0; i < 12; i++) {
          SFX.play('hoofbeat', { delay: t, gain: 0.085 - i * 0.004 });
          t += stepMs; stepMs *= 1.05;
        }
        // The rest of the cues are pinned to the animation's OWN beat times
        // rather than to numbers typed here. They used to be typed here, and
        // the first time a duration in sleigh-intro.js changed, the runners
        // bit while the sled was still cruising and the departure bells rang
        // over the landing. The touch-down pop belongs to the frame the feet
        // actually arrive on, so the intro plays that one itself.
        var B = SleighIntro.timeline();
        var cue = function (at, fn) { setTimeout(function () { if (!stale(g) && global.SFX) fn(); }, at); };
        cue(B.brake + 60, function () { SFX.play('slice', { gain: 0.05 }); });
        cue(B.land + 40, function () { SFX.play('zip', { gain: 0.06 }); });
        cue(B.exit + 60, function () {
          SFX.play('sleighBells', { n: 4, spread: 0.09, gain: 0.03 });
          for (var k = 0; k < 5; k++) SFX.play('hoofbeat', { delay: k * 0.2, gain: 0.05 - k * 0.008 });
        });
      }

      // THE REVEAL IS UNCONDITIONAL. Only this function ever hides him, so
      // only this function can be trusted to put him back — and it has to do
      // it even when it has been superseded, because the state that
      // superseded it did not hide him and will not think to show him. It
      // used to return early on a stale generation, which meant that losing
      // this race by a tenth of a second left Swiftee invisible for the
      // remaining thirty-eight screens.
      return SleighIntro.play(container, mark).then(function () {
        el.style.opacity = '1';
        if (stale(g)) return;
        return rest();
      }, function () {
        el.style.opacity = '1';
        if (stale(g)) return;
        return rest();
      });
    },

    exit: function (o) {
      var to = (o && o.to === 'right') ? 1 : -1;
      var g = fresh(); stateName = 'exit'; rigLoop = null;
      var a;
      if (o && o.to === 'below') {
        // DOWN BEHIND THE CARD, the way he popped up: a quick crouch-and-lift
        // (the anticipation), then a dive — a quarter of a second, so he is
        // gone before the card the child has taken hold of has gone anywhere.
        clip('happy', 1);
        el.style.transformOrigin = '50% 88%';
        a = anim([
          { translate: '0 0', scale: '1 1', offset: 0 },
          { translate: '0 3px', scale: '1.05 0.95', offset: 0.18, easing: 'ease-out' },
          { translate: '0 -10px', scale: '0.96 1.05', offset: 0.4, easing: 'cubic-bezier(.3,.6,.4,1)' },
          { translate: '0 ' + (o.rise || 200) + 'px', scale: '0.94 1.06', offset: 1, easing: 'cubic-bezier(.55,0,.85,.4)' }
        ], { duration: 280 });
      } else {
        // and two hops off, the same way, fading as he goes
        clip('flapping', Infinity);
        a = anim([
          { transform: 'translateX(0) translateY(0)', opacity: 1, offset: 0 },
          { transform: 'translateX(' + (to * 110) + 'px) translateY(-50px)', opacity: 1, offset: 0.3, easing: 'cubic-bezier(.3,.6,.5,1)' },
          { transform: 'translateX(' + (to * 220) + 'px) translateY(0)', opacity: 1, offset: 0.55, easing: 'cubic-bezier(.5,0,.7,.4)' },
          { transform: 'translateX(' + (to * 330) + 'px) translateY(-46px)', opacity: 0.6, offset: 0.8, easing: 'cubic-bezier(.3,.6,.5,1)' },
          { transform: 'translateX(' + (to * 440) + 'px) translateY(0)', opacity: 0, offset: 1 }
        ], { duration: 760, easing: 'linear' });
      }
      return a.finished.then(function () {
        el.style.opacity = '0';
        stopActive();
        void g;
      });
    },

    /**
     * Reposition. The element is moved first, then animated from where it
     * used to be — a FLIP, so the wrapper's final `left/top/scale` is always
     * the truth and the bubble can be placed against it the moment this
     * resolves.
     */
    move: function (o) {
      if (!layout) return Promise.resolve();
      var fromP = layout(pos, size);
      var toPos = o.to || pos, toSize = o.size || size;
      var toP = layout(toPos, toSize);
      pos = toPos; size = toSize;
      el.style.opacity = toPos === 'off' ? '0' : '1';

      var g = fresh(); stateName = 'move'; rigLoop = null;
      clip('flapping', Infinity);
      liftShadow(680);
      place(pos, size);
      // The clip belongs to where he lands, not to the flight: cut at the
      // rim while still in the air he would arrive in two pieces.
      var landingClip = clipY; clipY = null; applyClip();

      var dx = toP.x - fromP.x, dy = toP.y - fromP.y, ds = fromP.scale / toP.scale;
      var a = anim([
        { transform: 'translate(' + (-dx) + 'px,' + (-dy) + 'px) scale(' + ds + ')' },
        { transform: 'translate(0,0) scale(1)' }
      ], { duration: 680, easing: 'cubic-bezier(.22,1,.36,1)' });
      var land = function () { clipY = landingClip; applyClip(); };
      return a.finished.then(function () {
        land();
        if (stale(g)) return;
        return rest();
      }, land);
    }
  };

  /* ------------------------------------------------------------------ *
   * Public entry point
   * ------------------------------------------------------------------ */

  function play(state, opts, ctx) {
    if (!el) return Promise.resolve();
    opts = opts || {};

    /* THE MEASURING WALK OWNS HIM. See lock() below. Anything asked for
     * while it runs is done when it lets go — the latest request wins — and
     * he is NOT shown in the meantime: the walk hides him on purpose, and a
     * face played now would stand a second Swiftee on his mark while the
     * first is out on the side with the tape. Travel still goes through: a
     * screen change is not his to refuse. */
    var lock = lockedBy();
    if (lock && !MOVES[state]) {
      deferred = { state: state, opts: opts };
      return Promise.resolve({ deferred: lock });
    }

    // WHOEVER INTERRUPTS THE ARRIVAL ENDS IT. The intro is six and a half
    // seconds of canvas, and the director will move on without it if a beat
    // runs long — a slow machine, a low ceiling, a child who taps through.
    // Left alone the canvas kept painting a reindeer over the first screen of
    // the lesson, and the element underneath stayed hidden, so the lesson ran
    // with no mascot at all and a sled parked across it.
    if (state !== 'enter' && global.SleighIntro) SleighIntro.cancel();

    // AND HE COMES BACK. Two states hide him on purpose — 'enter', because
    // the intro draws its own bird on a canvas, and 'exit', because he flies
    // off. Every other state means he is in the scene, so every other state
    // makes sure he can be seen.
    //
    // Nothing used to say that. The hiding was owned by whichever animation
    // did it and the showing by whichever animation happened to come next,
    // and an 'exit' that was cut short — a jump between screens, Restart, the
    // director abandoning a long beat — simply never reached the line that
    // brings him back. He stayed at zero opacity, through every screen after
    // it, with his speech bubble still pointing at the empty patch of snow
    // where he should have been standing.
    if (state !== 'enter' && state !== 'exit' && el.style.opacity !== '1') {
      el.style.opacity = '1';
    }
    if (ctx && ctx.onCancel) ctx.onCancel(function () { cancelAll(); });

    if (MOVES[state]) { stir(); busy = null; return MOVES[state](opts); }

    if (!STATES[state]) {
      if (global.console) console.warn('Swiftee: no state "' + state + '"');
      return Promise.resolve();
    }
    // the one face for this feeling, on this screen, in this air
    state = resolve(state, opts);
    var def = STATES[state];
    // A reaction sets the mood the next line is spoken in; anything else
    // he is asked to do clears it.
    if (def.mood) { mood = def.mood; moodAt = Date.now(); }
    else if (!def.hold || state === 'explain') mood = null;

    if (def.lean && opts.at && !Array.isArray(opts.at)) lean(opts.at);
    if (def.shift) {
      // Held, not permanent. `fill: 'forwards'` with `composite: 'add'` means
      // this offset survives the state, the screen and the rest of the lesson:
      // one step-back on page 15 left him 34px to the left for the remaining
      // 24 screens, and on a phone that walked him off the edge. rest() drops
      // it when he settles, so he steps aside and then comes back.
      if (shiftAnim) { try { shiftAnim.cancel(); } catch (e) {} }
      shiftAnim = anim([{ transform: 'translateX(0)' }, { transform: 'translateX(' + def.shift + 'px)' }],
                       { duration: 520, easing: 'ease-out', fill: 'forwards' });
    }

    var g = fresh();
    stateName = state;
    // A one-shot is something he is in the middle of; a held pose is not.
    busy = def.hold ? null : { tier: def.tier || 'present', g: g, state: state };
    if (def.lean && Array.isArray(opts.at)) leanEach(opts.at, g);
    // HIS WHOLE BODY, in the same frame as the face: a tiny dip for an
    // ordinary yes, a hop for a milestone (BODY, above). Nothing for a miss —
    // the rig's own head-tilt says "hmm?", and a shake on top said "no".
    if (def.body) bounce(def.body);
    var seq = stir().then(function () {
      if (stale(g)) return { cancelled: true };
      return runState(state, g);
    });

    // A one-shot reaction returns to whatever he should be resting in —
    // `talking` if a line is still playing, the stance the child's task has
    // given him, otherwise the resting loop — or first to the recovery it
    // owes (`then`: after 'oops', the smile that says go on).
    if (!def.hold) {
      seq = seq.then(function (r) {
        if (stale(g) || (r && r.cancelled)) return r;
        busy = null;
        if (def.then && STATES[def.then]) return play(def.then, { key: opts.key });
        return rest().then(function () { return r; });
      });
    }
    return seq;
  }

  /* ------------------------------------------------------------------ *
   * CHARACTER DIRECTION
   *
   * The table at the top says which drawing a feeling is. This is the little
   * that is left for a companion rather than a sprite player: how big a
   * reaction is, which of several faces a moment gets, what may interrupt
   * what, and who owns him while something special is running. It is not a
   * second scheduler — every change still goes through play(), runState()
   * and the one ticker, and the director still decides WHEN.
   *
   *   level     1 micro (watching, reading, the child dragging) — barely moves
   *             2 response (a look, a question, a hint, a discovery, a miss)
   *             3 celebration — milestones only, so it keeps meaning something
   *   brief     start -> the first n loop frames there and back -> stop
   *             (briefOrder): the whole expression in about a second, with
   *             every one of the animator's parts played and none cut
   *   then      the recovery a reaction owes when it is over
   *   seated    a prop pose; in the air he takes this standing pose instead
   *   variants  several faces for one feeling, picked by the SCREEN (opts.key),
   *             never by chance: the same screen is the same every time, and
   *             a test can say which face it gets
   *   recovered the face for a right answer that comes after a miss
   *   tier      what may interrupt what, for the requests the game makes on
   *             its own (perform): the dedicated sequences first, then the
   *             child's own action, then an answer's reaction, then the
   *             lesson's gestures, then a hint, then idling
   * ------------------------------------------------------------------ */

  var TIER = { idle: 0, hint: 1, present: 2, feedback: 3, act: 4 };
  var busy = null;          // { tier, g, state } while a one-shot plays
  var stance = null;        // what he rests in while the child works
  var locks = {};           // name -> true: a dedicated sequence owns him
  var deferred = null;      // the latest request made while locked
  var restOwed = false;

  function lockedBy() { for (var k in locks) if (locks[k]) return k; return null; }

  function hashOf(key) {
    var s = String(key == null ? '' : key), h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }

  /** The concrete state an intention becomes: the context's face, then the
      screen's variant, then — in the air — the standing pose for a prop. */
  function resolve(state, opts) {
    var def = STATES[state];
    if (!def) return state;
    if (def.recovered && opts && opts.after === 'miss' && STATES[def.recovered]) state = def.recovered;
    else if (def.again && opts && opts.misses > 1 && STATES[def.again]) state = def.again;
    else if (def.variants && def.variants.length) state = def.variants[hashOf(opts && opts.key) % def.variants.length];
    def = STATES[state];
    if (def && def.seated && airborne && STATES[def.seated]) state = def.seated;
    return state;
  }

  /**
   * A REQUEST THE GAME MAKES ON ITS OWN — watching the child's hand, the idle
   * hint — as opposed to a beat the storyboard asked for. It yields:
   *
   *   1 to a dedicated sequence: the arrival, a walk on or off, a journey
   *     across the ice, the measuring walk (locked)
   *   2 to anything bigger still playing: a hint never cuts off a reaction,
   *     an idle gesture never cuts off anything. The child's own action is
   *     the top tier, so watching them may cut in over a reaction — their hand
   *     on the shape is the most important thing on the screen.
   *
   * Refusals are answered, never thrown, so a caller can fire and forget.
   */
  function perform(intent, opts) {
    opts = opts || {};
    if (!el || !STATES[intent]) return Promise.resolve({ refused: 'unknown' });
    if (lockedBy() || /^(enter|exit|move)$/.test(stateName)) return Promise.resolve({ refused: 'locked' });
    var want = TIER[STATES[intent].tier || 'present'] || 0;
    if (busy && !stale(busy.g) && (TIER[busy.tier] || 0) > want) return Promise.resolve({ refused: 'busy' });
    if (STATES[intent].hold && stateName === intent) return Promise.resolve({ already: true });
    return play(intent, opts);
  }

  /** What he rests in while the child works (restingState): 'watch' while
      their hand is on the shape, the question he asked while it stands, or
      nothing. A pose he is resting in changes now; a reaction still playing
      comes back to it when it is done. */
  function setStance(name) {
    var next = (name && STATES[name]) ? name : null;
    if (next === stance) return;
    var was = stance;
    stance = next;
    if (lockedBy()) { restOwed = true; return; }
    if (!busy && (stateName === was || isResting())) rest();
  }

  /**
   * THE CHILD HAS STARTED WORKING — a finger down on something to drag. He
   * drops whatever gesture he was making and watches, and keeps watching (the
   * stance) until the verdict clears it. The top tier: the only things it
   * yields to are the dedicated sequences. In the air he keeps flying, which
   * is what watching is up there.
   */
  function attend(on) {
    if (!on) { if (stance === 'watch') setStance(null); return null; }
    stance = 'watch';
    if (!el || lockedBy() || /^(enter|exit|move)$/.test(stateName)) return null;
    if (airborne || speaking || stateName === 'watch') return null;
    return play('watch');
  }

  /**
   * A SEQUENCE THAT OWNS HIM. The measuring walk (stage.js measureSide) is a
   * dedicated animation — its own sheet, its own path along the side, his own
   * element hidden while the drawn one walks and flown to and from the side —
   * and nothing generic may touch him while it runs: no face, no resting loop,
   * no idle, no hint, not even being shown. lock() takes him; unlock() gives
   * him back, doing the last thing anyone asked for in the meantime.
   *
   * GUARD FOR THE FUTURE: any new behaviour belongs behind this. play(),
   * rest(), perform(), setStance() and visible() all check it; add the check
   * to anything new that changes his drawing or shows him.
   */
  function lock(name) { locks[name || 'sequence'] = true; }
  function unlock(name) {
    delete locks[name || 'sequence'];
    if (lockedBy()) return null;
    var d = deferred, owed = restOwed;
    deferred = null; restOwed = false;
    if (d) return play(d.state, d.opts);
    if (owed || isResting()) return rest();
    return null;
  }

  /**
   * THE SCREEN HAS CHANGED. A reaction from the screen before does not carry
   * over into this one: it plays its stop and he rests. A pose the storyboard
   * held (thinking, explaining) is left for this screen's first beat to close
   * properly. `now` — a jump, Back, Restart — drops everything at once.
   */
  function settleScreen(o) {
    o = o || {};
    stance = null; deferred = null;
    if (!el || lockedBy() || /^(enter|exit|move)$/.test(stateName)) { busy = null; return Promise.resolve(); }
    var leftover = !!(busy && !stale(busy.g));
    busy = null;
    if (o.now) {
      rigLoop = null;                                   // the owed stop is written off
      fresh();
      stateName = '';                                   // so rest() moves whatever he is in
      return rest();
    }
    if (leftover || stateName === 'watch') return rest();
    return Promise.resolve();
  }

  /* ------------------------------------------------------------------ *
   * Mount
   * ------------------------------------------------------------------ */

  function mount(container, opts) {
    opts = opts || {};
    if (!F) { if (global.console) console.error('Swiftee: swiftee-frames.js must load first'); return api; }

    reduced = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);

    el = document.createElement('div');
    el.className = 'swiftee';
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText =
      'position:absolute;left:0;top:0;width:' + CELL_PX + 'px;height:' + CELL_PX + 'px;' +
      'pointer-events:none;will-change:transform;transform-origin:50% ' + (F.baselineY * 100).toFixed(1) + '%;';

    // A contact shadow at the baseline, not the cell edge, so he reads as
    // standing on the ice rather than floating above it. It squashes and
    // fades with him, which is most of what sells a hop as a hop.
    shadowEl = document.createElement('div');
    shadowEl.style.cssText =
      'position:absolute;left:50%;top:' + (F.baselineY * 100).toFixed(1) + '%;' +
      'width:50%;height:8%;transform:translate(-50%,-35%);border-radius:50%;transition:opacity 320ms ease;' +
      'background:radial-gradient(closest-side, rgba(24,52,96,.42), rgba(24,52,96,.14) 62%, rgba(24,52,96,0));';

    cellEl = document.createElement('div');
    // A SHADOW, NOT A GLOW. He used to carry a white rim — two white
    // drop-shadows tight around the silhouette — to cut him out of a
    // near-white snowfield. It did that, and it also made him look lit from
    // behind by something that is not in the scene, which is the one thing a
    // character standing on snow should not look like. The grounded shadow
    // does the separating on its own: it follows the sprite's alpha, so it
    // traces the bird rather than boxing the cell, and it reads as weight
    // rather than as an effect.
    cellEl.style.cssText =
      'position:absolute;inset:0;background-repeat:no-repeat;image-rendering:auto;' +
      'filter: drop-shadow(0 7px 11px rgba(24,52,96,.30));';

    el.appendChild(shadowEl);
    el.appendChild(cellEl);
    container.appendChild(el);

    if (opts.layout) layout = opts.layout;
    preload(PRELOAD);
    // Decode the one-off arrival art while the title screen is waiting. The
    // three large sheets used to start loading only after Start was pressed,
    // which presented an empty canvas as a visible pause before the sleigh.
    if (global.SleighIntro) SleighIntro.preload().catch(function () {});
    ready = true;

    // Park on the idle loop immediately so there is never an empty cell.
    rest();
    armIdle();

    return api;
  }

  /* ------------------------------------------------------------------ *
   * API
   * ------------------------------------------------------------------ */

  var api = {
    mount: mount,
    play: play,
    lookAt: lean,

    /* CHARACTER DIRECTION (see above). perform() is for the game's own
       requests and yields by priority; play() is the storyboard's. */
    perform: perform,
    stance: setStance,
    attend: attend,
    lock: lock,
    unlock: unlock,
    settle: settleScreen,
    /** Which concrete state an intention becomes, without playing it. */
    resolve: function (state, opts) { return resolve(state, opts || {}); },
    /** 1 micro, 2 response, 3 celebration. */
    levelOf: function (state) { var d = STATES[resolve(state, {})]; return d ? (d.level || 1) : 0; },
    /** Does this state answer the child (and so wait for the answer to land)? */
    isReaction: function (state) { var d = STATES[state]; return !!(d && d.react); },
    get locked() { return lockedBy(); },
    get busy() { return busy && !stale(busy.g) ? busy.state : null; },
    get stanceName() { return stance; },

    /**
     * Narration started or ended. While true, every settle returns to the
     * `talking` loop instead of `blinking`, so his mouth moves for exactly
     * as long as the line does — and reactions still cut in over the top.
     */
    speaking: function (v) {
      var was = speaking;
      speaking = !!v;
      // A mood only colours a line that follows its reaction closely; a
      // stale one is dropped, and any mood ends with the line.
      if (speaking && mood && Date.now() - moodAt > MOOD_MS) mood = null;
      if (!speaking) mood = null;
      if (was !== speaking) { stir(); if (isResting()) rest(); }
      return speaking;
    },

    place: function (p, s) {
      pos = p || pos; size = s || size;
      if (!el) return;
      // NOT BEFORE HE HAS ARRIVED. Every screen places him before its beats
      // run, and the first screen's first beat is the sleigh. Revealing him
      // here put him on the snow, centre stage, for the gap before that beat
      // hid him again — a blink on a fast machine and a full second on one
      // still fetching the sleigh sheet. The landing is what shows him.
      // (not while the measuring walk has him hidden — lock())
      if (!lockedBy()) el.style.opacity = (pos === 'off' || !arrived) ? '0' : '1';
      place(pos, size);
    },

    /**
     * Where the drawn bird actually is, in page pixels.
     *
     * getBoundingClientRect() on the element returns the whole 512-cell, which
     * is mostly transparent by design — the pivot is the cell centre and the
     * art floats inside it. Anything reasoning about what he covers (does the
     * bubble clear him? is he over the lesson? is he cropped?) has to use the
     * drawn extent or it will be wrong by roughly a fifth of the cell on every
     * side. These fractions are the manifest's own opaque bounds for the
     * standing pose, so they track the art.
     */
    bounds: function () {
      if (!el) return null;
      var r = el.getBoundingClientRect();
      var L = 84 / 512, R = 437 / 512, T = 58 / 512, B = F.baselineY;
      return {
        left: r.left + r.width * L, right: r.left + r.width * R,
        top: r.top + r.height * T, bottom: r.top + r.height * B,
        width: r.width * (R - L), height: r.height * (B - T)
      };
    },

    /** Show or hide without moving him. Safe before mount(). */
    visible: function (v) { if (el && !lockedBy()) el.style.opacity = v ? '1' : '0'; return !!v; },
    relayout: function () { place(pos, size); },
    setLayout: function (fn) { layout = fn; place(pos, size); },

    /** Stop every WAAPI move. The sprite keeps animating; only travel stops. */
    cancel: cancelAll,

    /** Hop down onto the spot. See land() above; the cart intro drives it. */
    land: land,

    /** A beat of body language: 'cheer', 'no' or 'land'. See BODY. */
    bounce: bounce,

    /** Fetch and decode the sheets a clip needs, ahead of needing them.
        No-op for a clip already held. `Swiftee.warm()` with no argument
        warms the reaction set — what a tap can reach. */
    warm: function (names) { preload(names || REACTIONS); },

    /** Hard reset to the rig's 3-frame neutral pose. */
    reset: function () { fresh(); rigLoop = null; stateName = 'idle'; return clip('reset', 1).then(rest); },

    get el() { return el; },
    get pos() { return pos; },
    /** Has the sleigh been? Read by the suites and probes. */
    get arrived() { return arrived; },
    /** The page-y below which he is clipped (peeking over a card), or null. */
    get clipY() { return clipY; },
    get size() { return size; },
    get state() { return stateName; },
    get scale() { return scale; },
    get ready() { return ready; },
    states: Object.keys(STATES),
    rig: STATES
  };

  global.Swiftee = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : this);
