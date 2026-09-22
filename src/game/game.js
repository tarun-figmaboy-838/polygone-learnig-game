/*!
 * game.js — wires everything and runs the screens.
 *
 * screens.js  →  director.js  →  { Stage, Swiftee, Input, SFX, Juice }
 *
 * Also owns the things no module should: the layout (semantic positions to
 * pixels per aspect ratio), the HUD, loading, persistence of the audio
 * settings, resize, and replay. Everything here is thin; the behaviour
 * lives in the modules.
 */
(function (global) {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var root, stageEl, hud, bubble, instruction, progress, loadEl, nextBtn;
  var director, current = -1, playing = false, settleTimer = null, mouthTimer = null, bubbleTimer = null;
  /* Whether Swiftee is on this screen at all. Set per screen from its
     `purpose`; when false, his lines go to the plank and his beats are
     no-ops. See screens.js for which eleven screens earn him. */
  var buddyOn = true;
  /* How long one of his beats takes when he is not there to perform it. A
     screen's rhythm was partly his — "he walks over, then the side is
     drawn" — so the beat still takes a beat; only the animation is skipped.
     Page 8 is the case: no dialogue, no input, just his entrance and a line
     being drawn, and without this it was over before the child had looked. */
  var BEAT_WITHOUT_HIM_MS = 600;
  /* Whether he is actually on the stage, as opposed to buddyOn, which is
     whether this screen wants him. They differ for the length of an
     entrance or an exit — and those two animations are what keep him from
     popping into a corner or vanishing out of one. */
  var present = false, entering = null;
  /* Bumped by every play(); a loop that wakes from an await and finds a
     newer one has started steps aside instead of running a screen over it. */
  var playGen = 0;
  var refitTimer = null, refitRaf = 0;
  var SAVE_KEY = 'swiftee.audio';
  var quest = Quest.create(), rewardTimer;

  /**
   * Say "well done" without saying it.
   *
   * This used to raise a yellow toast reading "+25 XP · Challenge complete!".
   * A caption on a joke: the child had already seen the shape go right, heard
   * the cue and watched Swiftee react, and then had to read a label telling
   * them so. It also competed with the speech bubble for the same corner of
   * attention at the same moment.
   *
   * So the screen celebrates instead. Confetti comes down over everything,
   * Swiftee celebrates, and the sound carries the size of it — a finished
   * task is a shower, a badge is a downpour with a fanfare. The words stay in
   * the DOM for a screen reader, which cannot see any of it.
   */
  function reward(text, big) {
    clearTimeout(rewardTimer);
    var el = $('#reward');
    if (el) el.textContent = text || '';
    rewardTimer = setTimeout(function () { if (el) el.textContent = ''; }, 4000);

    // A BURST FROM THE OBJECT, not a shower over the whole screen: the
    // reward belongs to the shape the child just finished measuring, or
    // sorting, or building, and the paper should come from there.
    // NO CONFETTI HERE. The XP and the badge arrive in the same instant as
    // the answer that earned them, and that answer has its own burst — from
    // the card's edge, or the deck's own feedback beat — so a second burst
    // from the middle of the stage read as the same celebration twice. The
    // reward is the chime, his cheer and the line of text.
    if (global.SFX) SFX.play(big ? 'levelUp' : 'sparkle');
    // He joins the celebration only if he is on this screen. Off, the
    // confetti, the level-up sound and the reward line carry it; a bird
    // popping into a layout that was set without him is not a reward.
    if (buddyOn && present && global.Swiftee && Swiftee.play) {
      try {
        Swiftee.play('celebrate');
        if (global.Juice && Swiftee.el) Juice.tada(Swiftee.el);
      } catch (e) {}
    }
  }
  /**
   * Record the attempt. Deliberately says nothing.
   *
   * This used to put its own copy in the speech bubble — hints on a wrong
   * answer, praise on a right one — and then restore the lesson line a couple
   * of seconds later. Two problems with that. The deck contains no
   * wrong-answer dialogue at all, and the brief forbids inventing any, so
   * every one of those lines was copy nobody approved. And the bubble is
   * where the lesson speaks: borrowing it for feedback means the child reads
   * a sentence, loses it, and gets it back.
   *
   * The feedback is still there, and it is the feedback the storyboard
   * actually specifies: Swiftee reacts, the object refuses, a cue plays,
   * the input re-opens. All of it non-verbal, all of it from screens.js.
   */
  /**
   * Swiftee answers the child with his face, having nothing to say.
   *
   * This used to record the attempt and do nothing else, and it was the
   * loudest thing out of sync in the game: a child could get an answer wrong
   * three times running while the bird stood beside the shape smiling at
   * them. Sound said "no" and the character said nothing, so the two halves
   * of the feedback disagreed.
   *
   * It still says nothing, and that part was right — the deck contains no
   * wrong-answer dialogue and the brief forbids inventing any, and the bubble
   * belongs to the lesson. But an expression is not a line. He is puzzled
   * WITH them on a wrong answer, never disappointed in them: 'confused' is
   * the rig's own "hmm, that's odd" and it reads as company rather than as a
   * verdict. On a right one he is simply pleased, which is a smaller thing
   * than the full celebration a first-time award gets.
   */
  /**
   * He comes in before his first line on a screen he joins: a slide in from
   * the wing, never a pop. One entrance per appearance, however many beats
   * ask for it while it is still running.
   */
  function entrance(quick) {
    if (!buddyOn || present || !global.Swiftee || !Swiftee.play) return Promise.resolve(false);
    if (entering) return entering;
    leaveGen++; leaving = false;   // any leave still running is overtaken (see leave())
    var done = function () { present = true; entering = null; syncPeekRim(); return true; };
    // Capped. The walk-on is under half a second; if the rig cannot finish
    // it — no animation support, a sheet that will not load — the lesson
    // must not wait on him. He is simply there.
    var wing = wingFor('from'); if (quick) wing.quick = true;
    entering = Promise.race([Swiftee.play('enter', wing), pause(1500)]).then(done, done);
    syncPeekRim();   // the rim is up before he rises behind it
    return entering;
  }

  /** And he leaves before a screen that does not need him: a wave, and off to the wing. */
  var leaving = false, leaveGen = 0;
  function leave() {
    if (!present || !global.Swiftee || !Swiftee.play) return Promise.resolve();
    present = false;
    // THE RIM STAYS OVER HIM UNTIL HE IS GONE. With present already false,
    // any re-sync during the sink dropped the rim copy, and for half a
    // second he was sinking in front of the card, cut off at the pane.
    leaving = true;
    // AN ENTRANCE OVERTAKES A LEAVE. If his next line calls him back while
    // he is still going, the new entrance cancels the exit — and the exit's
    // own ending then parked him off-stage, under the entrance, so he came
    // up nowhere and spoke from the wing. A leave that has been overtaken
    // ends without touching him.
    var gen = ++leaveGen;
    var off = function () {
      if (gen !== leaveGen || present || entering) return;
      leaving = false; if (Swiftee.place) Swiftee.place('off', Swiftee.size); syncPeekRim();
    };
    return Promise.race([Swiftee.play('exit', wingFor('to')), pause(1200)]).then(off, off);
  }

  function pause(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var SCENE_ENTER_MS = 520;   // a card's rise or pop (stage.js enter(): 460ms) plus a breath

  /**
   * A long line becomes two short ones, split where the sentence already
   * breaks: "Whoa!" then "One of the diagonals went outside." Each fits
   * beside his head on one or two rows where the whole was three and
   * leaning on the card. A sentence with no break in it stays whole.
   */
  function splitLine(text) {
    // ONLY BETWEEN WHOLE SENTENCES. "Whoa!" then "One of the diagonals went
    // outside." are two things he says; "All diagonals inside" then "means
    // convex polygon." is one thing cut in half, and a child reads the first
    // half as a bubble that broke. A line with one sentence in it stays
    // whole, however long, and the bubble grows or steps its type down.
    //
    // AND AS MANY BUBBLES AS IT TAKES. This used to cut once and leave the
    // rest together, so "Hmm… The sides look suspiciously alike. Let's
    // check!" came out as "Hmm…" and then a bubble with two sentences in it
    // — and the second of them, the one that says what happens next, went
    // past in the same breath as the observation. Sentences are packed into
    // bubbles up to about a line's worth of words, so a short opener rides
    // with the sentence after it and a closing "Let's check!" gets its own.
    if (!text || text.length <= 32) return [text];
    var sentences = [], rest = text, m;
    while ((m = /^(.{3,}?[.!?\u2026])\s+(\S.*)$/.exec(rest))) { sentences.push(m[1]); rest = m[2]; }
    sentences.push(rest);
    if (sentences.length < 2) return [text];
    var BUDGET = 44;
    var parts = [];
    sentences.forEach(function (s0) {
      var last = parts[parts.length - 1];
      if (last && (last.length + 1 + s0.length) <= BUDGET) parts[parts.length - 1] = last + ' ' + s0;
      else parts.push(s0);
    });
    return parts;
  }

  /**
   * SAY A LINE THAT HAS MORE THAN ONE THOUGHT IN IT.
   *
   * The director splits a screen's line into bubbles and paces them; a line
   * said from anywhere else — the finale, a badge — went straight to say()
   * as one long box. "Honk-tastic! 150 XP and 2 badges. You are a polygon
   * adventurer!" arrived as a paragraph the child was expected to take in at
   * a glance. Same split, same pacing, one thought at a time.
   *
   * Returns how long the whole thing takes to read, for callers that have to
   * wait for it.
   */
  /**
   * EVERY LINE STILL WAITING TO BE SAID.
   *
   * A line of two or three thoughts is one bubble now and the next in a
   * moment, and those moments are timers. When the screen changed, the
   * timers did not: the second half of page 34's sentence arrived over page
   * 35, measured against a bird who had already walked to his new mark, four
   * hundred pixels away. Every pending part is held here and dropped the
   * instant a screen starts.
   */
  var lineTimers = [];
  function clearLineTimers() { lineTimers.splice(0).forEach(clearTimeout); }

  /* THE INSTRUCTION THE BUBBLE BORROWED THE SPACE FROM.
   *
   * His bubble and the plank want the same band across the top, so a spoken
   * line puts the plank away and gives it back when the line is done. Giving
   * it back was hung on the say handler's own bubbleTimer — and `bubbleTimer`
   * is ONE variable shared with the timer react() sets for a cheer. A child
   * who answers while the line is still up (the input arms about a second
   * before that timer is due) makes react() clearTimeout it, and the plank is
   * never given back: the screen's only instruction is blank from then on,
   * over a live input.
   *
   * Two responsibilities were riding on one timer. Taking the bubble DOWN can
   * stay shared — whoever owns the bubble owns that. Giving the plank back is
   * now owned by the bubble going away, whatever took it away, so no timer
   * can lose it. */
  var heldCard = null, restoringCard = false;
  function restoreHeldCard() {
    if (heldCard == null || restoringCard) return;
    var t = heldCard; heldCard = null;
    restoringCard = true;
    try { setCard(t); } finally { restoringCard = false; }
  }

  /* A LINE ON THE PLANK IS STILL A LINE HE SAYS.
   *
   * Two paths put words on the plank instead of in his bubble: a screen he is
   * not on, and an instruction beat on a screen where he does not speak the
   * instructions. Both showed the words and returned — so the clip for that
   * line was never asked for. Every `*i` id in docs/VO.md is written, listed
   * and unreachable that way, and there are ten of them: a third of the
   * lesson's narration, which the deck believes is voiced, silent.
   *
   * The plank is a different SPEAKER, not a different rule. The clip plays,
   * and the beat lasts as long as the voice does — the same contract the
   * bubble has. With no clip on disk VO.play returns null and this resolves
   * at once, so a line that has no recording is paced exactly as before.
   */
  function plankVoice(opts, ctx) {
    var id = (global.VO && opts && opts.vo) ? opts.vo : null;
    if (id && VO.ready && !VO.isReady) {
      return VO.ready().then(function () {
        if (ctx && ctx.signal && ctx.signal.cancelled) return;
        return plankVoice(opts, ctx);
      });
    }
    var started = id ? VO.play(id) : null;
    if (!started) return Promise.resolve();
    if (ctx && ctx.onCancel) ctx.onCancel(function () { if (VO.id === id) VO.stop(); });
    return VO.finished ? VO.finished() : Promise.resolve();
  }

  /* A CANCELLABLE HANDLE FOR A LINE SAID OUTSIDE THE BEATS.
   *
   * The screen-level instruction below is not a beat: it is spoken while the
   * screen is being built, so the director has no token for it and it was
   * handed `null` as its context. Everything a line registers for
   * cancellation — the timers between its bubbles, the mouth loop, the clip
   * still playing — was therefore registered with nobody, and the only reason
   * it did not outlive its screen is that runScreen clears the same globals by
   * hand afterwards. The clip was not one of them, so the voice did carry on
   * into the next screen. This is the token the next screen cancels. */
  var screenLine = null;
  function screenCtx() {
    var sig = { cancelled: false }, fns = [];
    screenLine = { sig: sig, fns: fns };
    return {
      signal: sig,
      onCancel: function (fn) {
        if (sig.cancelled) { try { fn(); } catch (e) {} return; }
        fns.push(fn);
      }
    };
  }
  function cancelScreenLine() {
    // The plank a line borrowed the space from belongs to that line. If the
    // line is over, so is the borrow: the screen arriving decides its own
    // card, and restoring the old one first would flash it.
    heldCard = null;
    var s = screenLine; screenLine = null;
    if (!s) return;
    s.sig.cancelled = true;
    s.fns.splice(0).forEach(function (f) { try { f(); } catch (e) {} });
  }

  var longTimers = [];
  function sayLong(text, mood, reading) {
    longTimers.forEach(clearTimeout); longTimers = [];
    var parts = splitLine(text);
    var words = function (t) { return String(t).split(/\s+/).length; };
    var total = parts.reduce(function (n, p) { return n + words(p); }, 0) || 1;
    var shares = parts.map(function (p) { return Math.max(900, (reading || 2600) * words(p) / total); });
    say(parts[0], mood, shares[0]);
    var at = 0;
    for (var i = 1; i < parts.length; i++) {
      at += shares[i - 1];
      (function (t, s) { var h = setTimeout(function () { say(t, mood, s); }, at); longTimers.push(h); lineTimers.push(h); }(parts[i], shares[i]));
    }
    return shares.reduce(function (a, b) { return a + b; }, 0);
  }

  /**
   * THE CARD IN FRONT OF HIM.
   *
   * He is an HTML sprite over an SVG stage, so nothing the stage draws can
   * be in front of him. When he peeks over a card, a copy of that card's top
   * band — the ice rim, caps and all, from the same artwork at the same
   * place — is laid over him instead. His body is cut at the glass line
   * underneath that band, so what shows is a bird whose body disappears
   * into the frame of the card: behind it, as far as the eye can tell.
   */
  var rimEl = null;
  function syncPeekRim() {
    var want = global.Swiftee && Swiftee.pos === 'peek' && (present || entering || leaving) &&
               global.Stage && Stage.peekAnchor && Stage.peekAnchor() &&
               global.CardFrame && CardFrame.panel && Stage.svg && Stage.svg.getScreenCTM;
    if (!want) { if (rimEl) rimEl.style.display = 'none'; return; }
    var a = Stage.peekAnchor(), m = Stage.svg.getScreenCTM();
    if (!m) { if (rimEl) rimEl.style.display = 'none'; return; }
    if (!rimEl) {
      rimEl = document.createElement('img');
      rimEl.className = 'peek-rim';
      rimEl.alt = '';
      rimEl.setAttribute('aria-hidden', 'true');
      rimEl.src = CardFrame.panel.src;
      rimEl.style.cssText = 'position:absolute;z-index:4;pointer-events:none;';
      var host = (Swiftee.el && Swiftee.el.parentNode) || document.body;
      if (Swiftee.el && Swiftee.el.nextSibling) host.insertBefore(rimEl, Swiftee.el.nextSibling); else host.appendChild(rimEl);
    }
    var hostBox = rimEl.parentNode.getBoundingClientRect();
    var x = m.a * a.x + m.e - hostBox.left, y = m.d * a.y + m.f - hostBox.top;
    var w = m.a * a.w, h = m.d * a.h;
    var PF = CardFrame[a.frame || 'panel'] || CardFrame.panel;
    if (rimEl.getAttribute('src') !== PF.src) rimEl.src = PF.src;
    var paneY = PF.pane ? PF.pane.y : 0.082;
    rimEl.style.display = '';
    rimEl.style.left = x + 'px'; rimEl.style.top = y + 'px';
    rimEl.style.width = w + 'px'; rimEl.style.height = h + 'px';
    // only the band above the glass line — the rest of the card stays where
    // the stage drew it, under the shape
    // Feathered, not cut: a hard edge on the copy showed as a hairline
    // across the glass. The band fades out over the first sliver of glass.
    var to = ((paneY + 0.004) * 100).toFixed(2), gone = ((paneY + 0.04) * 100).toFixed(2);
    var mask = 'linear-gradient(to bottom, #000 0%, #000 ' + to + '%, transparent ' + gone + '%)';
    rimEl.style.webkitMaskImage = mask; rimEl.style.maskImage = mask;
  }

  /** Which wing he uses: behind the card when he is peeking over it, the left edge otherwise. */
  function wingFor(key) {
    var o = {};
    if (Swiftee.pos === 'peek') {
      o[key] = 'below';
      o.rise = Math.round(frame().h * (BIRD_H[Swiftee.size] || BIRD_H.small) * 0.8);
    } else {
      o[key] = 'left';
    }
    return o;
  }

  function wantsBuddy(i) {
    var s = Screens.list[i];
    if (!s) return false;
    if (Screens.wantsBuddyAt) return !!Screens.wantsBuddyAt(i);
    return !!(Screens.wantsBuddy && Screens.wantsBuddy(s));
  }
  /** On a one- or two-card screen he says the instructions too (Screens.speaksAll). */
  function speaksAll(i) { return !!(Screens.speaksAll && Screens.speaksAll(i)); }

  /* WHAT THE STAGE SHOWS BY THE END OF SCREEN i. Most screens carry the
     scene over from the one before and only some rebuild it, so the kind of
     scene a screen is about is the last one declared at or before it —
     at screen level or in a beat. */
  function sceneKindAt(i) { return Screens.sceneKindAt ? Screens.sceneKindAt(i) : null; }

  /* WHERE HE CAN HIDE. Popping up from behind a card is a trick for a
     screen with two or more cards on it — the comparison — where one card
     is his to be behind and the child's eye is on the other. A screen with
     one card has nothing for him to hide behind: there he stands on the
     ground at the left and the card sits on the right. */
  function peeksBehind(i) {
    // Only the swipe practice: its zones fill the floor, so he comes up
    // from behind the Regular zone's rim. Beside one card or two he STANDS
    // on the ice at the left and instructs from there.
    return sceneKindAt(i) === 'swipe-sort';
  }

  /* HIS MARK ON SCREEN i, or null if the screen is not his.
     TWO OR MORE CARDS: he pops up from behind one for his line and drops
     back. ONE CARD: he stands on the ground at the left, the card takes
     the right, and he stays for the screen — a screen that is his only
     because a line on it talks to the child keeps its own left-hand mark
     if it has one, and a screen written for the peek stands down to the
     ground when there is nothing to peek from behind. The same answer for
     the play loop and for the debug picker, so a jump builds the scene the
     way play would. */
  function markFor(i, curPos, curSize) {
    var s = Screens.list[i];
    if (!s || !s.swiftee || !wantsBuddy(i)) return null;
    var pos = s.swiftee.pos || curPos || 'left', size = s.swiftee.size || curSize || 'medium';
    var behind = peeksBehind(i);
    if (!s.swiftee.purpose) {
      if (behind) { pos = 'peek'; size = 'small'; }
      else if (!/^(left|top-left)/.test(pos)) { pos = 'left-low'; size = 'medium'; }
    } else if (pos === 'peek' && !behind) { pos = 'left-low'; size = 'medium'; }
    return { pos: pos, size: size };
  }

  /* What he says when the child gets it, and when they do not. Short, so
     they fit in one bubble beside his head, and varied, so the tenth right
     answer is not met with the same word as the first. */
  // Each carries the id of its voice clip (assets/vo/<id>.mp3), listed in
  // docs/VO.md with everything else he says.
  var PRAISE = [
    { t: 'Nice!', vo: 'fb01' }, { t: 'That\u2019s it!', vo: 'fb02' }, { t: 'Great job!', vo: 'fb03' },
    { t: 'You got it!', vo: 'fb04' }, { t: 'Yes!', vo: 'fb05' }, { t: 'Well done!', vo: 'fb06' }
  ];
  var NUDGE = [
    { t: 'Hmm, not quite.', vo: 'fb07' }, { t: 'Try again!', vo: 'fb08' },
    { t: 'Almost! Have another go.', vo: 'fb09' }, { t: 'Not that one.', vo: 'fb10' }
  ];
  var praiseN = 0, nudgeN = 0, lastFeedbackAt = 0, feedbackScreen = -1, praisedHere = false;
  var cheerUntil = 0;   // the lesson does not move on while he is still saying it

  // `said` — an optional { t, vo } from the stage: the reason this try
  // fell short ("Pull it in more!"), spoken in place of the generic nudge.
  function react(kind, said) {
    if (kind === 'wrong') quest.mistake();
    if (!buddyOn) return;   // the sound and the confetti carry the verdict
    if (!global.Swiftee || !Swiftee.play) return;
    // A WORD FROM HIM, NOT A COMMENTARY. One cheer per screen for a right
    // answer — the first — and a nudge for a wrong one no oftener than every
    // three seconds, so a screen of five taps is not five "Nice!"s. If he
    // has dropped behind the card he pops up for it, and drops back after.
    var now = Date.now();
    if (current !== feedbackScreen) { feedbackScreen = current; praisedHere = false; }
    var line = null, mood = null;
    var pick = null;
    if (kind === 'correct' && !praisedHere) { praisedHere = true; pick = PRAISE[praiseN++ % PRAISE.length]; mood = 'win'; }
    else if (kind === 'wrong' && now - lastFeedbackAt > 3000) { pick = (said && said.t) ? said : NUDGE[nudgeN++ % NUDGE.length]; mood = 'hint'; }
    if (pick) line = pick.t;
    if (!line) {
      if (present) { try { Swiftee.play(kind === 'wrong' ? 'confused' : 'happy'); } catch (e) {} }
      return;
    }
    lastFeedbackAt = now;
    // AND FOR AS LONG AS THE RECORDING RUNS. These were flat numbers chosen
    // when nothing was spoken here; a clip longer than them let the lesson
    // move on over the end of his own answer.
    var cheerSecs = (global.VO && VO.seconds && pick && pick.vo) ? VO.seconds(pick.vo) : 0;
    cheerUntil = now + Math.max(kind === 'wrong' ? 2100 : 1900, Math.round(cheerSecs * 1000) + 700)
                     + (present ? 0 : 420);
    var wasUp = present;
    var speak = function () {
      try { Swiftee.play(kind === 'wrong' ? 'confused' : 'happy'); } catch (e) {}
      // AND HIS WHOLE BODY, in the same frame as the face and the sound. The
      // expression alone is a picture changing; the hop is the bird being
      // pleased about it, and that is the difference a child reads.
      try { if (Swiftee.bounce) Swiftee.bounce(kind === 'wrong' ? 'no' : 'cheer'); } catch (e) {}
      /* WHAT HE SAYS BACK IS SPOKEN TOO, so it keeps step like every other line.
       *
       * The narration was put on the voice's clock and this was not. A cheer
       * played its clip and revealed its words on a timer of its own, held for
       * a flat 900ms whatever the recording actually ran to — so the shortest,
       * brightest lines in the game, the ones a child hears after every single
       * answer, were the only ones whose words did not match the voice, and a
       * clip longer than the hold was cut off by its own bubble coming down.
       *
       * Same two arguments the narration uses: where the voice is now, and
       * when each word is spoken in the recording. With no clip for the line
       * both are null and this is exactly what it was.
       */
      var vid = (global.VO && pick && pick.vo) ? pick.vo : null;
      if (vid && !VO.play(vid)) vid = null;
      var clock = vid ? function () {
        if (!global.VO || !VO.at || VO.id !== vid) return null;
        return VO.at();
      } : null;
      var cues = null, hold = 900;
      if (vid) {
        var rec = VO.words ? VO.words(vid) : null;
        if (rec && rec.length === String(line).trim().split(/\s+/).length) cues = rec;
        var len = VO.seconds ? VO.seconds(vid) : 0;
        if (len) hold = Math.round(len * 1000) + 200;
      }
      say(line, mood, hold, clock, cues);
      clearTimeout(bubbleTimer);
      bubbleTimer = setTimeout(function () {
        say(null);
        // he only came up to say it
        if (!wasUp && present && Swiftee.pos === 'peek') leave();
        // and the lesson does not move on over the end of it
      }, Math.max(kind === 'wrong' ? 1900 : 1600, hold + 500));
    };
    if (present) speak(); else entrance(true).then(speak);
  }

  /* ------------------------------------------------------------------ *
   * Layout — semantic Swiftee positions → pixels, per aspect ratio.
   * The stage SVG scales itself; only Swiftee needs mapping because he is
   * an HTML overlay, not part of the SVG.
   * ------------------------------------------------------------------ */

  /**
   * KEEP THE FURNITURE ON THE ICE.
   *
   * The HUD, the Next button and the progress bar are pinned to the corners
   * of the WINDOW by the stylesheet, and the lesson is a 16:9 box fitted
   * inside it — so on a 4:3 screen Next sat ninety pixels below the bottom
   * of the painting, on the band, looking like a browser control rather than
   * part of the game. They are pushed in by however much the fit left over.
   */
  function seatFurniture() {
    var r = stageEl && stageEl.getBoundingClientRect();
    if (!r || !r.width) return;
    var s = Math.min(r.width / 1000, r.height / 562);
    var padX = Math.max(0, Math.round((r.width - 1000 * s) / 2));
    var padY = Math.max(0, Math.round((r.height - 562 * s) / 2));
    var g0 = document.getElementById('game');
    if (g0) { g0.style.setProperty('--band-x', padX + 'px'); g0.style.setProperty('--band-y', padY + 'px'); }
  }

  function frame() {
    // The visible 1000×562 stage box inside the container (meet-fit).
    var r = stageEl.getBoundingClientRect();
    var s = Math.min(r.width / 1000, r.height / 562);
    var w = 1000 * s, h = 562 * s;
    return { x: (r.width - w) / 2, y: (r.height - h) / 2, w: w, h: h, s: s, portrait: r.height > r.width };
  }

  /**
   * Swiftee's size, as a fraction of the stage height he should occupy.
   *
   * Expressed as the height of the DRAWN BIRD, not of the sprite cell. The
   * cell is 256px with the character filling 76% of it vertically (top of
   * the head at 58/512, feet on the baseline at 449/512), so sizing by the
   * cell overstates him by a third — which is how he ended up towering over
   * the lesson. These are the numbers to change if he looks wrong.
   */
  // SMALL IS SMALL. All three were 0.28; a bird waiting inside the card's
  // corner, or peeking over a rim, is a smaller thing than one standing on
  // the ice beside it.
  var BIRD_H = { tiny: 0.16, small: 0.22, medium: 0.28, large: 0.28 };   // tiny: inside the card's corner, the shape is the big thing
  var CONTENT_FRAC = 0.764;      // (449 - 58) / 512, from the manifest bounds
  var EDGE = 8;                  // px of breathing room at the viewport edge

  /**
   * Whether anything on this screen is drawn beneath the shape.
   *
   * A caption, a Convex/Concave badge, a checklist, a row of options or a
   * stepper. Beats included, because most screens add theirs a beat or two
   * after the stage is built.
   */
  /** Does this screen put a row of options up at any point? */
  function screenAsksChoices(scr) {
    var beats = (scr.beats || []).concat(
      Object.keys(scr.perTap || {}).reduce(function (a, k) { return a.concat(scr.perTap[k] || []); }, []));
    var has = function (o) { return !!(o && o.choices); };
    if (has(scr.stage)) return true;
    return beats.some(function (b) {
      return has(b.stage) ||
        (b.on && Object.keys(b.on).some(function (k) { return (b.on[k] || []).some(function (x) { return has(x.stage); }); })) ||
        (b.otherwise || []).some(function (x) { return has(x.stage); });
    });
  }

  function wantsRoomBelow(scr) {
    var beats = (scr.beats || []).concat(
      Object.keys(scr.perTap || {}).reduce(function (a, k) { return a.concat(scr.perTap[k] || []); }, []));
    // Readings, a checklist, a stepper: things drawn INSIDE the face that
    // want the shape a little higher. A label, a badge or an answer row
    // goes UNDER the card instead (wantsBand), and takes no room inside.
    var has = function (o) {
      return !!(o && (o.checklist || o.stepper || o.measurements));
    };
    if (has(scr.stage)) return true;
    return beats.some(function (b) {
      return has(b.stage) ||
        (b.on && Object.keys(b.on).some(function (k) { return (b.on[k] || []).some(function (x) { return has(x.stage); }); })) ||
        (b.otherwise || []).some(function (x) { return has(x.stage); });
    });
  }

  /* Is anything going UNDER the card on this screen — a name tag, a badge,
     a row of answers? Then the card is built short, to the control line,
     and the thing sits in the band below it. */
  function wantsBand(scr) {
    var beats = (scr.beats || []).concat(
      Object.keys(scr.perTap || {}).reduce(function (a, k) { return a.concat(scr.perTap[k] || []); }, []));
    var has = function (o) { return !!(o && (o.label || o.badge || (o.choices && o.choices.length))); };
    if (has(scr.stage)) return true;
    return beats.some(function (b) {
      return has(b.stage) ||
        (b.on && Object.keys(b.on).some(function (k) { return (b.on[k] || []).some(function (x) { return has(x.stage); }); })) ||
        (b.otherwise || []).some(function (x) { return has(x.stage); });
    });
  }

  function layout(pos, size) {
    var f = frame();

    // stageH * wanted fraction = cell * scale * CONTENT_FRAC
    var want = BIRD_H[size] || BIRD_H.medium;
    var scale = (f.h * want) / (256 * CONTENT_FRAC);

    var map = {
      'left':               { x: 0.20, y: 0.88 },
      'left-low':           { x: 0.15, y: 0.97 },
      // 'polygon-top-right' is gone. The lesson slab occupies the right of
      // the stage and the HUD the corner above it, so there is no point at the
      // polygon's top-right that is not already something else. Two screens
      // used it, and on both he simply stood on the card.
      // For screens whose lesson reaches all the way across — the swipe
      // practice puts a drop zone against each edge — the only clear ground
      // left is the near corner, and he has to be small enough to stand in
      // it without leaning on either zone.
      'right-low':          { x: 0.90, y: 1.00 },
      // Mid-height, at the left edge. The sorting screens put a tray across
      // the top and bins across the bottom, and the only band a line can live
      // in is the corridor between them — so he stands in it too.
      // 0.075, not 0.115: the bins grew to 340 wide, and at 0.115 his wing
      // reached into the first one.
      'left-mid':           { x: 0.075, y: 0.66, air: true },
      // Up in the corner, off the ground — for screens where the lesson needs
      // the whole floor and he should be a narrator rather than a bystander
      // standing in it.
      // 0.075, not 0.11: at 0.11 his wing reached four pixels into the first
      // card of the sorting tray.
      // IN THE AIR. There is no ground at either of these marks — the
      // sorting screens put their tray and bins where the floor would be —
      // so he flies here: a hover, wings going, bobbing (swiftee.js 'air').
      'top-left':           { x: 0.075, y: 0.30, air: true },
      'centre':             { x: 0.50, y: 0.93 },
      'off':                { x: -0.3, y: 0.9 }
    };

    // TWO MARKS THAT BELONG TO THE CARD, NOT THE SCREEN. 'peek' is behind
    // the slab's top-left rim, head and shoulders showing; 'corner' is on
    // the snow at its bottom-left. Both are read off the panel the stage
    // actually drew, so they follow it when it moves. With no slab to hold
    // on to they fall back to the fixed corner marks.
    var clipPage = null;
    var anchor = global.Stage && Stage.peekAnchor && Stage.peekAnchor();
    if (anchor && !f.portrait) {
      var ax = function (x) { return (x / 1000); }, ay = function (y) { return (y / 562); };
      // THE CUT IS THE RIM'S OWN EDGE. The slab's box begins at the tips of
      // its snow caps; cut there he ended in a straight line hanging above
      // the card. Five percent down is where the ice frame actually starts,
      // so his body goes into the frame and the frame is what hides it.
      // The cut is at the top of the GLASS, not the rim: a copy of the rim
      // is drawn over him (peekRim below), so the cut itself is never seen —
      // his body goes into the frame and the frame is what hides it.
      var PF = global.CardFrame && (CardFrame[anchor.frame || 'panel'] || CardFrame.panel);
      var paneY = (PF && PF.pane) ? PF.pane.y : 0.082;
      // The cut sits a little ABOVE the glass line, well under the opaque
      // part of the rim copy, so no edge of his ever shows through the fade.
      var rim = anchor.y + anchor.h * (paneY - 0.012);
      var birdH = f.h * (BIRD_H[size] || BIRD_H.small);     // his drawn height on this screen
      // His feet are 42% of his height below the card's TOP, so head and
      // shoulders stand above the rim whatever the card's height; the rim
      // copy hides the rest and the cut hides the feet.
      map['peek'] = { x: ax(anchor.x + anchor.w * 0.24), y: ay(anchor.y) + (0.47 * birdH) / f.h };   // in from the corner cap
      // INSIDE THE CARD, on the glass at its bottom-left: the measurer waits
      // on the sheet he measures, and flies from there to each side.
      var paneH = (global.CardFrame && CardFrame.panel && CardFrame.panel.pane) ? CardFrame.panel.pane.h : 0.85;
      // ON THE SNOW, not on the glass line: the card's bottom rim carries a
      // ledge of snow inside the pane's edge, and his feet belong on that —
      // 3.5% of the card below the pane's foot. At the pane's foot he hung
      // in the air over it.
      map['corner'] = { x: ax(anchor.x + anchor.w * 0.13), y: ay(anchor.y + anchor.h * (paneY + paneH + 0.035)) };
      if (pos === 'peek') clipPage = f.y + ay(rim) * f.h;
    } else {
      map['peek'] = map['top-left'];
      map['corner'] = map['left-low'];
    }
    if (f.portrait) {
      // Stage letterboxes; put Swiftee below the box so he never covers it.
      map['left'] = { x: 0.18, y: 1.02 }; map['left-low'] = { x: 0.16, y: 1.02 };
      map['right-low'] = { x: 0.84, y: 1.02 };
      map['left-mid'] = { x: 0.14, y: 0.62 };
      map['top-left'] = { x: 0.13, y: 0.26 };
      map['polygon-top-right'] = { x: 0.86, y: 0.22 }; map['centre'] = { x: 0.5, y: 1.02 };
      // ...which means the stage height is the wrong yardstick down here. A
      // portrait stage letterboxes to a short band, so sizing against it left
      // him a thumbnail in a tall empty strip. Size against the strip he is
      // actually standing in instead.
      var below = Math.max(120, (window.innerHeight || 800) - (f.y + f.h));
      scale = (below * 0.56) / (256 * CONTENT_FRAC);
    }

    // When the stage is nothing but scenery, standing off to one side leaves
    // a hole where the lesson would be and makes him look parked. The screens
    // do not need to know this — they still say "left"; the layout decides
    // that "left of nothing" means the middle, with a little more presence.
    var m = map[pos] || map['left-low'];
    if (pos !== 'off' && soloed()) { m = map['centre']; }

    var y = f.y + m.y * f.h;

    // In portrait he stands in the strip below the letterboxed stage. "1.02 of
    // the stage height" was a guess at where that begins, and on a tall phone
    // it put the top of his head back inside the stage, over the shape. Place
    // him from the stage's actual bottom edge and his own drawn height, so he
    // clears it whatever the aspect ratio.
    if (f.portrait && pos !== 'off' && m.y >= 1) {
      y = Math.max(y, f.y + f.h + 8 + 256 * CONTENT_FRAC * scale);
    }

    var L = fit({ x: f.x + m.x * f.w, y: y, scale: scale }, pos);
    if (clipPage != null) L.clip = clipPage;
    if (m.air) L.air = true;
    return L;
  }

  /**
   * Nudge the anchor so the whole sprite cell stays on screen.
   *
   * The anchor is his feet (the sheet's baseline), and positions like
   * 'left-low' deliberately sit him low, so on a short window the top of his
   * head could fall outside the viewport and he would render decapitated.
   * Clamping here rather than at each call site means the bubble, which is
   * placed from the same numbers, follows him automatically.
   *
   * Off-stage is exempt: being outside the viewport is the entire point.
   */
  function fit(L, pos) {
    if (pos === 'off') return L;
    var vw = window.innerWidth || document.documentElement.clientWidth;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var cell = 256 * L.scale;
    var top = L.y - 0.877 * cell, bottom = L.y + 0.123 * cell;
    var left = L.x - cell / 2, right = L.x + cell / 2;

    // Head first: if he cannot fit whole, the top of the cell is the edge to
    // keep, because everything below the baseline is empty anyway.
    if (bottom > vh - EDGE) L.y -= (bottom - (vh - EDGE));
    if (L.y - 0.877 * cell < EDGE) L.y = EDGE + 0.877 * cell;
    if (left < EDGE) L.x += EDGE - left;
    if (right > vw - EDGE) L.x -= right - (vw - EDGE);
    return L;
  }

  /** True while Swiftee is holding the middle of an otherwise empty stage. */
  function soloed() { return !!(global.Stage && Stage.isEmpty && Stage.isEmpty()); }

  /* ------------------------------------------------------------------ *
   * HUD
   * ------------------------------------------------------------------ */

  /**
   * Reveal a line one word at a time.
   *
   * Every word — and every dual-coding chip, which counts as one word — is
   * wrapped in its own span and faded in on a timer. Two things make this
   * safe rather than fiddly:
   *
   * The words are hidden with `opacity`, never `display`. The bubble is
   * therefore laid out at its full final size before the first word appears,
   * so it cannot grow as the line arrives — no jitter, and placeBubble's work
   * keeping it off the lesson holds for the whole line instead of being
   * invalidated on every tick.
   *
   * And a term's halo fires as its own word lands, rather than on a fixed
   * stagger guessed in advance. The word and the thing it names now light up
   * in the same frame, which is the binding dual coding is actually after.
   */
  var revealTimer = null, revealUnits = null;

  function revealAll() {
    clearInterval(revealTimer); revealTimer = null;
    if (!revealUnits) return false;
    var pending = revealUnits.filter(function (u) { return !u.el.classList.contains('in'); });
    pending.forEach(function (u) { u.el.classList.add('in'); if (u.term) DualCode.cueTerm(u.term); });
    revealUnits = null;
    return pending.length > 0;
  }

  /** Split a rendered line into word-sized units, chips counting as one. */
  function unitsOf(line) {
    var out = [];
    (function split(node) {
      [].slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 1) {
          if (n.classList && n.classList.contains('dc-term')) {
            out.push({ el: n, term: n.getAttribute('data-term') });
            return;
          }
          split(n);
          return;
        }
        if (n.nodeType !== 3) return;
        var frag = document.createDocumentFragment();
        n.nodeValue.split(/(\s+)/).forEach(function (p) {
          if (!p) return;
          if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(p)); return; }
          var w = document.createElement('span');
          w.className = 'w'; w.textContent = p;
          frag.appendChild(w); out.push({ el: w, term: null });
        });
        node.replaceChild(frag, n);
      });
    })(line);
    return out;
  }

  function reveal(line, ms, units, clock, cues) {
    clearInterval(revealTimer); revealTimer = null;
    // Split already, if the caller did it. unitsOf mutates the line — running
    // it twice would wrap every word span in another word span.
    units = units || unitsOf(line);
    if (!units.length) return;

    var reduced = !!(global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (reduced) { units.forEach(function (u) { u.el.classList.add('in'); if (u.term) DualCode.cueTerm(u.term); }); return; }

    line.classList.add('revealing');
    revealUnits = units;

    /* THE WORDS KEEP STEP WITH THE VOICE.
     *
     * They used to run on a timer of their own, capped at 120ms apart — so a
     * sentence the voice reads in eleven seconds had all nine of its words on
     * screen inside a second, and the child sat watching a finished line
     * being read aloud to them. Nothing about the text followed the audio.
     *
     * Speech runs nearer 300ms a word, and the clip's real length is known
     * before it is even requested (assets/vo/index.json), so the words are
     * spread across the part they belong to — and stepped against the VOICE's
     * own clock, not against a count of intervals. A slow decode or a
     * throttled tab now carries the words with it instead of leaving them
     * behind, and the ceiling is gone, because the pace is the speaker's.
     *
     * No clip: the wall clock and the reading time, as before, minus that
     * ceiling — so the words still fill the line rather than being finished
     * in the first fifth of it.
     */
    var span = Math.max(240, (ms || 1400) - 160);   // a breath left at the end
    var per = span / units.length;
    var t0 = Date.now();
    var i = 0;
    var show = function (u) {
      u.el.classList.add('in');
      if (u.term && global.DualCode) DualCode.cueTerm(u.term);
    };
    show(units[i++]);                               // the first word lands with the bubble
    if (i >= units.length) { revealUnits = null; return; }
    revealTimer = setInterval(function () {
      // Where the speaker is. The clock returns null the moment this line's
      // clip is no longer the one playing, and then the wall clock takes over
      // rather than the words stopping dead.
      var t = clock ? clock() : null;
      if (t == null) t = Date.now() - t0;
      // Every word whose moment has passed, so a late tick catches up in one
      // go instead of dribbling the rest out one interval at a time.
      while (i < units.length && t >= (cues && cues[i] != null ? cues[i] : i * per)) show(units[i++]);
      if (i >= units.length) { clearInterval(revealTimer); revealTimer = null; revealUnits = null; }
    }, Math.max(16, Math.min(70, per / 2)));
  }

  function say(text, mood, ms, clock, cues) {
    clearInterval(revealTimer); revealTimer = null; revealUnits = null;
    if (!text) {
      // THE VOICE GOES WITH THE WORDS. A clip left running when its bubble
      // came down carried on into the next screen, which is what "the voice
      // plays at random" was: not a wrong clip, the right clip outliving the
      // line it belongs to.
      if (global.VO && VO.stop) VO.stop();
      bubble.classList.add('out'); bubble.classList.remove('show');
      // and the plank it stood aside for comes back. See heldCard.
      restoreHeldCard();
      return;
    }
    // A SPEAKER IS SEEN. A jump or a restart can cut an exit short and leave
    // him at opacity 0 on his mark; the moment he has a line, he is shown.
    if (present && !entering && global.Swiftee && Swiftee.visible && Swiftee.pos !== 'off') Swiftee.visible(true);
    mood = mood || (/\?|Hmm|What if/.test(text) ? 'think' : /Yay|Great|Nice|Whoa/.test(text) ? 'win' : 'talk');
    bubble.dataset.mood = mood;
    // Only the line is replaced. The frame, the panel, the highlight and the
    // accent marks are permanent markup: rebuilding them for every sentence
    // would restart their own transitions, and the bubble carries the line
    // and nothing else anyway. `mood` stays as a data attribute for styling
    // and is never rendered as text.
    var line = bubble.querySelector('.bubble-line');
    if (global.DualCode) {
      // Dual coding: each key term is drawn as a chip carrying a miniature of
      // itself. The halo that lights up the matching thing on stage is NOT
      // fired here — reveal() fires each one as its own word appears, which
      // is tighter than any stagger set in advance. Calling cue() as well
      // would halo everything twice. DualCode.markup escapes what it is given.
      line.innerHTML = DualCode.markup(text);
    } else {
      line.textContent = text;
    }
    bubble.classList.remove('out');
    bubble.classList.add('show');
    // SPLIT INTO WORDS FIRST, then measure, then reveal.
    //
    // fitLine counts rows by where the words sit, and until unitsOf has run
    // the words are bare text nodes — which have no bounding box. It saw only
    // the tinted chips, counted one row, and never shrank anything: "Which of
    // these are polygons?" stayed on two rows with the fit silently doing
    // nothing. Splitting first gives every word a box to be measured by, and
    // costs nothing, since reveal needed the same split a moment later.
    var units = unitsOf(line);
    // The first placement of a new line is a jump cut, not a glide: it has
    // nowhere to travel from. The refits that follow are glides (see #bubble
    // .snap in the stylesheet).
    bubble.classList.add('snap');
    fitLine();
    reveal(line, ms, units, clock, cues);
    requestAnimationFrame(function () { bubble.classList.remove('snap'); });

    // AND AGAIN ONCE THE SCENE HAS STOPPED MOVING.
    //
    // fitLine measures the room the line has at the instant the line is set,
    // and on several screens that instant is too early: the sort tray arrives
    // on staggered timers, Swiftee is still travelling to his mark, the panel
    // is mid-entrance. The line gets placed against a scene that is not
    // finished, and nothing ever asks again — which is how a sentence that
    // fits on one row across the top of the screen ended up on three, in a
    // half-width slot, over the cards it was asking about.
    //
    // Two more passes: the next frame, for anything that had not been laid
    // out yet, and after the entrances are over. Both cancelled by the next
    // line or the next screen, and both are measure-and-place with no side
    // effects, so running them when nothing has changed costs a layout read.
    clearTimeout(refitTimer);
    if (refitRaf) cancelAnimationFrame(refitRaf);
    var again = function () { if (bubble.classList.contains('show')) fitLine(); };
    refitRaf = requestAnimationFrame(again);
    refitTimer = setTimeout(again, 700);
  }

  /**
   * Keep the line on one row, and the box no wider than the line.
   *
   * Two faults with one cause. The bubble's width is capped by the free space
   * beside the lesson, so a sentence longer than that cap wraps — and once it
   * wraps, `text-wrap: balance` evens the rows out, which leaves every row
   * shorter than the box and a band of empty paper down both sides. A short
   * sentence in a wide frame reads as a mistake.
   *
   * So: shrink the TYPE until the sentence fits on one row, down to two
   * thirds of its size and no further — past that it is a genuinely long
   * sentence and wrapping is the right answer, not six-point text. Then snap
   * the cap to the widest row that actually rendered, which takes the empty
   * band away whether it wrapped or not.
   *
   * Only the type shrinks, never #bubble's own font-size: padding, radius and
   * the horn are all em of that, and shrinking it would shrink the frame and
   * the horn along with the words.
   */
  /**
   * Lay the line out and place the bubble.
   *
   * THE TYPE IS ONE SIZE. The stylesheet gives it two — the full size on a
   * screen where Swiftee speaks alone, a smaller one where he is sharing the
   * screen with a shape — and this does not touch either of them.
   *
   * It used to. It shrank the type, sentence by sentence, until the line fit
   * on a single row: three per cent at a time, down to half. It worked, and
   * it was wrong. A child reading this game saw the words change size every
   * time Swiftee spoke — forty pixels on one screen, thirty-five on the next,
   * twenty-nine on the one after — because the size was being decided by how
   * long that particular sentence happened to be. Text that changes size is
   * text that looks like it is being squeezed in, and it is the single
   * loudest way for a game to read as unfinished.
   *
   * A long sentence wraps to two rows instead. Two rows at a size the child
   * already knows is easier than one row at a size they have never seen, and
   * it is the same answer a book would give.
   */
  function fitLine() {
    bubble.style.maxWidth = '';
    var inner = bubble.querySelector('.dialogue-inner');
    if (inner) inner.style.fontSize = '';    // nothing is sized from JS any more
    bubble.classList.remove('tight');
    bubble.classList.remove('tighter');
    placeBubble();

    // Step down ONCE if the sentence still runs past two rows in the space it
    // was given. Not a scale — a second size, declared in the stylesheet, the
    // same on every screen that needs it. Three rows of a speech bubble is a
    // paragraph, and that is the only thing worth spending a size change on.
    if (rowsOfLine() > 2) {
      bubble.classList.add('tight');
      placeBubble();
    }
    // AND ONE MORE, ONLY IF IT IS STILL A PARAGRAPH.
    //
    // One step down is enough on thirty-eight screens. On the crowded ones —
    // where the card, the plank and the bird between them leave the bubble a
    // column — it was not, and the line came out on four rows, which is the
    // exact thing this function exists to prevent. Reaching for a second size
    // costs a re-place on the handful of lines that need it and nothing at
    // all on the rest, because this only runs once three rows have already
    // been passed.
    if (rowsOfLine() > 3) {
      bubble.classList.add('tighter');
      placeBubble();
    }
    paintSkin();
  }

  /** How many rows the line actually rendered on. */
  /**
   * NO EMPTY PAPER BESIDE THE WORDS. A box whose sentence wraps keeps the
   * whole width it was allowed, so a two-row line sat in a box a third
   * wider than its longest row. Measure the widest row the words actually
   * make and close the box down to it; the rows do not re-wrap, because the
   * box is still as wide as the widest of them.
   */
  function snugWidth() {
    var line = bubble.querySelector('.bubble-line');
    if (!line) return;
    var kids = line.childNodes, rows = {}, k, r, key;
    for (k = 0; k < kids.length; k++) {
      if (kids[k].nodeType !== 1 || !kids[k].offsetWidth) continue;
      // layout boxes, for the same reason as rowsOfLine: a word still on its
      // way in sits seven pixels low, and grouping by a moving top split one
      // row into two — which closed the box to half a row and poured the
      // sentence down a column.
      r = { top: kids[k].offsetTop, left: kids[k].offsetLeft, right: kids[k].offsetLeft + kids[k].offsetWidth };
      key = Math.round(r.top / 2) * 2;
      if (!rows[key]) rows[key] = { l: r.left, r: r.right };
      else { rows[key].l = Math.min(rows[key].l, r.left); rows[key].r = Math.max(rows[key].r, r.right); }
    }
    var widest = 0;
    Object.keys(rows).forEach(function (t) { widest = Math.max(widest, rows[t].r - rows[t].l); });
    if (!widest) return;
    var cs = getComputedStyle(bubble);
    var chrome = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
    var want = Math.ceil(widest + chrome + 3);
    if (want >= bubble.offsetWidth - 4) return;
    // CLOSING THE BOX MUST NOT STAND THE SENTENCE ON END.
    //
    // This measures the widest row the words have made and closes the box to
    // it. Measured at the wrong instant — while the line is being swapped,
    // or in a slot that was already too narrow — the widest row is one word,
    // and the box locks to a column that the whole sentence then pours down.
    // Eight rows, in a 147px box, was this. Empty paper beside the words is
    // a blemish; a sentence standing on end is not readable, so if closing
    // the box costs more than three rows the box keeps the width it had.
    var before = bubble.style.maxWidth;
    bubble.style.maxWidth = want + 'px';
    if (rowsOfLine() > 3) bubble.style.maxWidth = before;
  }

  function rowsOfLine() {
    var line = bubble.querySelector('.bubble-line');
    if (!line) return 1;
    var kids = line.childNodes, tops = {}, k, r;
    for (k = 0; k < kids.length; k++) {
      if (kids[k].nodeType !== 1) continue;
      // offsetTop, not a client rect: each word is translated a few pixels
      // while it arrives, and a client rect includes that travel — so a line
      // half way through its reveal counted as twice as many rows as it has.
      if (!kids[k].offsetWidth) continue;
      tops[Math.round(kids[k].offsetTop / 2) * 2] = 1;
    }
    return Object.keys(tops).length || 1;
  }

  /**
   * Place the speech bubble somewhere it does not cover the lesson.
   *
   * The old version anchored it beside Swiftee and capped its width against
   * whatever was to his right. That works until it does not: on the builder
   * screen the panel runs through the middle and there is no "beside", and a
   * cap measured while the scene was still animating in came out too generous.
   * Each fix moved the collision somewhere else.
   *
   * So it does not guess a spot and then try to make it fit. It works out the
   * free space around the lesson — left of it, right of it, above it, below it
   * — discards anything too small to hold a sentence, and puts the bubble in
   * the best of what remains, preferring the side Swiftee is on so the tail
   * still points at the speaker. The last step measures what was actually laid
   * out and nudges it back inside its own rectangle, because a long word can
   * push past a max-width and that is exactly the case that used to escape.
   */
  function placeBubble() {
    var L = layout(Swiftee.pos, Swiftee.size || 'medium');
    var f = frame();
    var solo = soloed();
    var vw = window.innerWidth || document.documentElement.clientWidth;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    // MIN_W is the narrowest the bubble can actually render: min-width 170,
    // plus 22px padding and a 3px border on each side. Asking for less than
    // that does not produce a narrower bubble, it produces one that hangs out
    // of the space it was promised — which is how it kept clipping the
    // polygon by a few pixels on a phone.
    // GAP is the margin the bubble keeps from every edge it can reach. At 14
    // it sat hard against the side of the screen and read as something that
    // had slid off rather than been placed.
    var GAP = 26, MIN_W = 240, MIN_H = 64;
    // THE TAIL'S REACH. Its tip lands 42px beyond the border, so the box
    // keeps this much clear of him on every side and the tip stops just
    // short of his head — near, never on it.
    var TAIL_GAP = 48;

    // Type size is the stylesheet's job; it only needs to know whether this
    // is a screen with room to breathe.
    bubble.style.marginLeft = '0px';
    bubble.style.minWidth = '';
    bubble.classList.toggle('solo', solo);
    bubble.style.right = 'auto';

    // Everything the bubble must stay out of.
    var content = Stage.contentBox && Stage.contentBox();
    var cardBox = instruction && instruction.classList.contains('show')
      ? instruction.getBoundingClientRect() : null;
    var hudBox = hud.getBoundingClientRect();
    var nextBox = nextBtn && nextBtn.classList.contains('show') ? nextBtn.getBoundingClientRect() : null;

    // With nothing on stage he simply speaks over the middle of the screen.
    if (solo || !content) {
      // No floor here. The stylesheet carries a minimum in em, which scales
      // with the type; a floor in pixels is dead space the moment the line is
      // shorter than it, and most of the thirty-six lines are.
      // A screen with nothing on it but Swiftee has no lesson to keep clear
      // of, so the only reason to cap the width at all is the reading line —
      // and 620px forced most of the thirty-six sentences onto two rows for
      // no benefit. Wide enough now that short and middling lines stay on one.
      bubble.style.maxWidth = Math.min(f.w * 0.86, 1040) + 'px';
      snugWidth();
      bubble.style.left = '50%';
      bubble.style.marginLeft = -(bubble.offsetWidth / 2) + 'px';
      var birdTop = L.y - 256 * layout(Swiftee.pos, 'large').scale * CONTENT_FRAC;
      bubble.style.top = Math.max(hudBox.bottom + GAP, birdTop - bubble.offsetHeight - TAIL_GAP) + 'px';
      // He stands directly below on these screens, but aim it properly all the
      // same — "below" is only true once he has landed.
      paintSkin();
      return;
    }

    // the bands live inside the FRAME — the letterboxed stage — not the window
    var FL = f.x + GAP, FR = f.x + f.w - GAP;
    var top = Math.max(f.y + GAP, (cardBox ? cardBox.bottom + 10 : f.y + GAP));
    var bottom = f.y + f.h - GAP - (nextBox ? nextBox.height + 16 : 0);
    void vw; void vh;

    // The bands around the lesson, and the bands through it. Each is a place
    // a bubble could live.
    // SWIFTEE IS SOMETHING TO AVOID TOO.
    //
    // The placement checked the bubble against the lesson — the polygon, the
    // panels, the trays — and against nothing else, so the one thing on the
    // screen it was most likely to land on was the one thing it never looked
    // at.
    //
    // His DRAWN bounds, not his element's: the sprite cell is mostly empty by
    // design, and treating the whole cell as solid would push the bubble a
    // fifth of the screen further away than it needs to go.
    var birdBox = null;
    if (global.Swiftee && Swiftee.bounds) {
      var bb = birdRect();
      if (bb && bb.width) {
        birdBox = {
          left: bb.left - TAIL_GAP, right: bb.right + TAIL_GAP,
          top: bb.top - TAIL_GAP, bottom: bb.bottom + TAIL_GAP
        };
      }
    }

    var slots = [
      { id: 'left',  x: FL,                   y: top, w: content.left - GAP - FL,  h: bottom - top },
      { id: 'right', x: content.right + GAP,  y: top, w: FR - content.right - GAP, h: bottom - top },
      { id: 'above', x: FL, y: top, w: FR - FL, h: content.top - top - GAP },
      { id: 'below', x: FL, y: content.bottom + GAP, w: FR - FL, h: bottom - content.bottom - GAP }
    ];

    // Full-width bands between the lesson's own pieces. The sorting screen
    // puts the tray at the top and the bins at the bottom; the strip between
    // them is the most comfortable place on that screen for a line of
    // dialogue, and a single union box cannot see it.
    // IN THE CORNER OF THE CARD, HIS WORDS GO ON THE GLASS. The slab does not
    // count as an obstacle then; the shape on it does.
    var cornered = !!(global.Swiftee && Swiftee.pos === 'corner');
    var rows = (Stage.contentParts ? Stage.contentParts({ glass: cornered }) : [])
      .map(function (r) { return [r.top, r.bottom]; })
      .sort(function (a, b) { return a[0] - b[0]; });
    var merged = [];
    rows.forEach(function (r) {
      var last = merged[merged.length - 1];
      if (last && r[0] <= last[1] + 2) last[1] = Math.max(last[1], r[1]);
      else merged.push([r[0], r[1]]);
    });
    for (var i = 0; i + 1 < merged.length; i++) {
      slots.push({ id: 'gap', x: FL, y: merged[i][1] + GAP,
                   w: FR - FL, h: merged[i + 1][0] - merged[i][1] - GAP * 2 });
    }

    // CARVE SWIFTEE OUT OF THE SLOTS.
    //
    // Scoring slots by whether they contain him does not work, because on a
    // screen where he stands beside the lesson EVERY vertical band contains
    // him — the left band runs the full height of the play area and he is
    // somewhere in it. So they all score the same and the bubble lands on his
    // face anyway, which is what page 10 was doing: covering the character
    // supposedly speaking, by 156 by 103 pixels.
    //
    // A slot that contains him is replaced by the largest part of itself that
    // does not. Four candidates — the strip above him, below him, left of him,
    // right of him — and the biggest wins. That turns "the left band" into
    // "the left band above his head", which is a real place to put a sentence.
    // EVERYTHING FIXED ON TOP OF THE LESSON IS AN OBSTACLE, not just him.
    //
    // Only Swiftee was carved out, so the sound and restart buttons in the
    // top-right corner were invisible to this: on the screens whose lesson
    // reaches both edges the only band left is the strip along the top, and
    // the line was published straight across the HUD — the two controls a
    // child needs to turn the sound off, behind a speech bubble.
    //
    // The same is true of the Next button and of the screen picker. They are
    // all fixed boxes over the play area, they are all off limits, and there
    // is no reason for the rule to name one of them.
    // The screen picker is NOT in this list. It is a temporary review tool
    // sitting across the top of the window, and treating it as an obstacle
    // split the full-width band above the lesson into two short ones — so a
    // sentence that fits on one row across the top came out on three, in a
    // half-width slot, over the corner of the panel. A debug control must not
    // be able to change how the game lays itself out.
    var blocks = [birdBox];
    [hudBox, nextBox].forEach(function (b) {
      if (!b || !b.width) return;
      // A wide margin: the bubble bounces in at 103% and carries a shadow,
      // and eight pixels from the HUD read as touching it.
      blocks.push({ left: b.left - 28, right: b.right + 28,
                    top: b.top - 28, bottom: b.bottom + 28 });
    });

    blocks.forEach(function (box) {
      if (!box) return;
      slots = slots.map(function (r) {
        var ov = r.x < box.right && r.x + r.w > box.left &&
                 r.y < box.bottom && r.y + r.h > box.top;
        if (!ov) return r;
        var cands = [
          { id: r.id, x: r.x, y: r.y, w: r.w, h: box.top - r.y, over: true },
          { id: r.id, x: r.x, y: box.bottom, w: r.w, h: r.y + r.h - box.bottom },
          { id: r.id, x: r.x, y: r.y, w: box.left - r.x, h: r.h },
          { id: r.id, x: box.right, y: r.y, w: r.x + r.w - box.right, h: r.h }
        ].filter(function (c) { return c.w >= MIN_W && c.h >= MIN_H; });
        if (!cands.length) return r;          // nowhere clear: leave it and let hits() fight
        // Peeking over a card, the strip straight above his head is where his
        // words belong if a line fits there at all; otherwise the roomiest.
        var overHim = box === birdBox && Swiftee.pos === 'peek';
        cands.sort(function (a, b) { return ((overHim && b.over) - (overHim && a.over)) || ((b.w * b.h) - (a.w * a.h)); });
        return cands[0];
      });
    });

    // THE NOOK. Waiting inside the card, bottom-left, the place for his
    // line is the glass above his head and left of the shape — a comic
    // panel's own bubble. If that nook can hold a line, it is the only slot.
    if (cornered && Stage.nook) {
      var nk = Stage.nook();
      if (nk && birdBox) {
        var cs = { id: 'corner',
                   x: nk.face.left + 8, y: nk.face.top + 8,
                   w: (nk.poly.left - 16) - (nk.face.left + 8),
                   h: birdBox.top - (nk.face.top + 8) };
        // WHATEVER HANGS IN THE NOOK'S COLUMN — a reading tag beside the
        // shape — caps the nook above it, so the bubble sits over the tag
        // and its tail still points down to him.
        var gp = Stage.contentParts ? Stage.contentParts({ glass: true }) : [];
        var capY = cs.y + cs.h, rightEdge = cs.x + cs.w;
        gp.forEach(function (p) {
          if (!(p.right > cs.x + 4 && p.left < rightEdge - 4 && p.top < capY && p.bottom > cs.y)) return;
          if (p.left - 12 - cs.x >= 200) rightEdge = Math.min(rightEdge, p.left - 12);   // step in beside it
          else capY = Math.min(capY, p.top - 10);                                        // or stop above it
        });
        cs.w = rightEdge - cs.x;
        cs.h = capY - cs.y;
        // 200, not MIN_W: the nook beside him on the wide slab is a little
        // under 240 wide, and his lines there are short by design
        if (cs.w >= 200 && cs.h >= MIN_H) slots = [cs];
      }
    }
    slots = slots.filter(function (r) { return r.id === 'corner' || (r.w >= MIN_W && r.h >= MIN_H); });

    if (!slots.length) {
      // Nowhere is genuinely clear. Sit above the lesson and be as small as
      // possible: covering the top of a panel is better than covering the
      // shape, and better than not speaking at all.
      slots = [{ id: 'above', x: FL, y: top, w: FR - FL, h: Math.max(MIN_H, content.top - top) }];
    }

    // Prefer the side he is standing on, then the roomiest.
    var onLeft = L.x < vw / 2;
    // Peeking over a card, the place for his words is straight above his
    // head — the band over the card is his, the plank is not up while he
    // speaks — so the band above is preferred and the bubble is centred on
    // him inside it.
    var peeking = Swiftee.pos === 'peek';
    slots.sort(function (a, b) {
      var pref = function (r) {
        if (peeking) return r.id === 'above' ? 2 : 0;
        return (r.id === (onLeft ? 'left' : 'right')) ? 1 : 0;
      };
      return (pref(b) - pref(a)) || (b.w * b.h - a.w * a.h);
    });
    // Height depends on width, and width depends on the slot, so the only
    // way to know whether a line of dialogue fits a band is to lay it out
    // there and look. Take the first slot it actually fits; if it fits none,
    // take the one it overflows least.
    // Beside him a bubble wants to be book-width so it reads as speech. In a
    // horizontal band it should use the band: the sorting screen leaves a
    // 128px strip between the tray and the bins, and the same sentence is two
    // lines at 520px and one line across the width — which is the difference
    // between not fitting and fitting comfortably.
    // SAFE keeps the cap just inside the slot. The bubble is tilted, so the
    // box it actually paints is a couple of pixels wider than the width it
    // was given, and a cap set to exactly the slot width produced a bubble
    // that was exactly too big for it.
    var SAFE = 10;
    var capFor = function (r) {
      var room = (r.id === 'left' || r.id === 'right')
        ? Math.min(r.w - SAFE, 640)
        : Math.min(r.w - SAFE, f.w * 0.8);
      return room;
    };

    // Measure the LAYOUT box. The bubble now plays a bouncy entrance that
    // scales it from 82% to 103% and back, so the painted box is whatever
    // frame the animation happens to be on when we look — useless for
    // deciding whether a sentence fits beside a polygon. offsetWidth and
    // offsetHeight ignore transforms and report where the box actually is.
    // The settle pass re-runs this once the animation is over anyway.
    var size = function () { return { w: bubble.offsetWidth, h: bubble.offsetHeight }; };

    // PICK THE SLOT THE SENTENCE READS BEST IN, not the first one it fits.
    //
    // This used to take the first slot tall enough to hold the bubble and
    // stop. A slot beside the lesson is narrow and tall, so it always
    // qualified — and the sentence was then squeezed into three rows in a
    // 250px column while a full-width band above or below the lesson sat
    // empty. Measuring every slot and keeping the one where the bubble comes
    // out SHORTEST is the same thing as keeping the one where it wraps least,
    // and costs three more layout reads on a path that now runs twice a line.
    // Where a bubble of a given size ends up in a given slot. Used twice —
    // once per slot while choosing, and once on the slot that wins — so the
    // thing that is scored is the thing that is placed.
    var headX = L.x, headY = L.y - 256 * L.scale * CONTENT_FRAC;
    var placeIn = function (r, ww, hh) {
      var wx = (r.id === 'left' || r.id === 'right')
        ? L.x - ww / 2
        : (peeking ? L.x - ww / 2
           : (onLeft ? Math.max(r.x, L.x - ww * 0.35) : Math.min(r.x + r.w - ww, L.x - ww * 0.65)));
      // IN A BAND, THE EDGE NEAREST HIS HEAD — never the middle of the band.
      // A tall band above the lesson used to centre the bubble in itself,
      // which put his words a hundred pixels over his head; the carve-out
      // already keeps the band TAIL_GAP clear of him, so the band's edge on
      // his side is exactly where the bubble belongs.
      var wy = (r.id === 'left' || r.id === 'right')
        ? L.y - 256 * L.scale * CONTENT_FRAC - hh - TAIL_GAP
        : (r.id === 'corner' ? r.y + r.h - hh              // just over his head
           : (headY >= r.y + r.h / 2 ? r.y + r.h - hh : r.y));
      return {
        x: Math.max(r.x, Math.min(wx, r.x + r.w - ww)),
        y: Math.max(r.y, Math.min(wy, r.y + r.h - hh))
      };
    };

    // How many rows a given height is. A row is one line-height; everything
    // else in the box is padding and border, and that is paid once.
    var lineH = parseFloat(getComputedStyle(bubble).lineHeight) || 30;
    bubble.style.maxWidth = '100000px';
    var chrome = bubble.offsetHeight - lineH;
    var rowsOf = function (hh) { return Math.max(1, Math.round((hh - chrome) / lineH)); };

    // The top of his head, which is what the pointer has to reach.
    var reach = function (p, ww, hh) {
      var dx = Math.max(p.x - headX, 0, headX - (p.x + ww));
      var dy = Math.max(p.y - headY, 0, headY - (p.y + hh));
      return Math.sqrt(dx * dx + dy * dy);
    };

    // PICK THE SLOT NEAREST HIS HEAD, not the one the sentence is shortest in.
    //
    // Shortest-first sounds right and is wrong: the shortest layout is always
    // the widest band, and the widest band is the full-width strip along the
    // top of the screen. So every long line was published up there, six
    // hundred pixels from the character supposedly saying it, with a pointer
    // aimed at empty sky. A speech bubble that is not attached to a speaker
    // is a caption.
    //
    // Distance from his head decides it. Wrapping still matters — a line that
    // fits on one row reads better than the same line on two — but it is a
    // nudge, not the rule, because "near him on two rows" beats "across the
    // top on one" every time. Three rows is the thing actually worth
    // avoiding: that is where a bubble starts to be a paragraph.
    var slot = null, w = 0, h = 0, best = Infinity;
    for (var si = 0; si < slots.length; si++) {
      var r = slots[si];
      bubble.style.maxWidth = capFor(r) + 'px';
      var m = size();
      var fits = m.h <= r.h && m.w <= r.w;
      var rows = rowsOf(m.h);
      var near = reach(placeIn(r, m.w, m.h), m.w, m.h);
      var score = Math.max(0, near - TAIL_GAP * 2) * 6     // every pixel past the tail's reach costs six
                + (rows - 1) * 40                          // one row is nicer
                + (rows > 2 ? 200 : 0)                     // three rows beside him beats one row far from him
                // and four is not a speech bubble at all. Weighted past any
                // distance on this stage, so a wider slot further from his
                // head always wins over a narrow one beside it.
                + (rows > 3 ? 20000 : 0)
                + (fits ? 0 : 2400 + Math.max(0, m.h - r.h));
      if (score < best) { best = score; slot = r; }
    }
    bubble.style.maxWidth = capFor(slot) + 'px';
    var m2 = size(); w = m2.w; h = m2.h;

    /* FOUR ROWS IS NOT A SPEECH BUBBLE, so it is not a matter of scoring.
     *
     * The score prefers the slot nearest his head and penalises wrapping, but
     * a penalty is a preference: on one screen the nearest slot came out four
     * rows and beat everything else by distance on some runs and not on
     * others, so the same sentence was three rows or four depending on which
     * refit pass measured it. Widest-that-fits is a floor, not a preference,
     * and it takes proximity off the table only when proximity has produced
     * something unreadable. */
    if (rowsOf(h) > 3) {
      var widest = null;
      slots.forEach(function (r) { if (!widest || capFor(r) > capFor(widest)) widest = r; });
      if (widest && widest !== slot) {
        slot = widest;
        bubble.style.maxWidth = capFor(slot) + 'px';
        var m3 = size(); w = m3.w; h = m3.h;
      }
    }

    snugWidth();
    var m4 = size(); w = m4.w; h = m4.h;
    var at = placeIn(slot, w, h);
    var x = at.x, y = at.y;

    bubble.style.left = x + 'px';
    bubble.style.top = y + 'px';

    // One correction pass. Everything above reasons in layout coordinates,
    // but the bubble is rotated about a corner, so where it actually lands is
    // a few pixels off where it was told to go — enough to clip the stepper
    // on the builder screen. Rather than model the rotation, put it down,
    // look at where it ended up, and shift by the difference.
    // Against the layout box for the same reason: mid-animation the painted
    // box is meaningless, and the bubble is no longer rotated, so layout and
    // painted position agree once the entrance has finished.
    var got = { left: x, right: x + w, top: y, bottom: y + h };
    var dx = 0, dy = 0;
    if (got.left < slot.x) dx = slot.x - got.left;
    else if (got.right > slot.x + slot.w) dx = (slot.x + slot.w) - got.right;
    if (got.top < slot.y) dy = slot.y - got.top;
    else if (got.bottom > slot.y + slot.h) dy = (slot.y + slot.h) - got.bottom;
    if (dx || dy) {
      bubble.style.left = (x + dx) + 'px';
      bubble.style.top = (y + dy) + 'px';
    }
    // Then check. Everything above is a model of where the bubble will land —
    // slot arithmetic, a rotation, a font that may not have loaded yet — and
    // each of those has been wrong at least once. This asks the only question
    // that matters, of the real geometry: is any part of the lesson underneath
    // it? If so, shrink and try again, and failing that put it in the band
    // with the most room. Cheap, and it cannot be fooled by a cause nobody
    // thought of.
    var parts = Stage.contentParts ? Stage.contentParts({ glass: !!(global.Swiftee && Swiftee.pos === 'corner') }) : [];
    var hits = function () {
      var l = parseFloat(bubble.style.left) || 0, t = parseFloat(bubble.style.top) || 0;
      var r = { left: l, right: l + bubble.offsetWidth, top: t, bottom: t + bubble.offsetHeight };
      // A SHARED EDGE IS NOT AN OVERLAP. The slot beside him starts exactly
      // where his box ends, so the bubble's left edge equals his right edge
      // to within a fraction of a pixel — and that fraction counted as a hit,
      // narrowed the bubble three times, and turned one row into three.
      var over = function (p) {
        return r.left < p.right - 1 && r.right > p.left + 1 && r.top < p.bottom - 1 && r.bottom > p.top + 1;
      };
      for (var i = 0; i < parts.length; i++) if (over(parts[i])) return true;
      return !!(birdBox && over(birdBox));
    };

    for (var attempt = 0; attempt < 3 && hits(); attempt++) {
      var cur = { width: bubble.offsetWidth, height: bubble.offsetHeight };
      var narrower = Math.max(MIN_W, cur.width * 0.78);
      var wasWide = bubble.style.maxWidth;
      bubble.style.maxWidth = narrower + 'px';
      // AND NOT PAST THREE ROWS, for the same reason the box is not closed
      // past three rows a few hundred lines above. Each pass here takes away
      // a fifth of the width, and three of them take away more than half, so
      // a sentence that started on two rows can finish on four — a paragraph
      // in a speech bubble, which is the thing the fit exists to prevent. It
      // was invisible because it needs both a line long enough to wrap and a
      // scene crowded enough to move the bubble, and a line only got measured
      // if it stayed up long enough to be seen. Moving the bubble off the
      // shape is worth some width; it is not worth the sentence.
      if (rowsOfLine() > 3) { bubble.style.maxWidth = wasWide; break; }
      var now = { width: bubble.offsetWidth, height: bubble.offsetHeight };
      // Re-seat it in the slot at the new size.
      bubble.style.left = Math.max(slot.x, Math.min(parseFloat(bubble.style.left),
                                                    slot.x + slot.w - now.width)) + 'px';
      bubble.style.top = Math.max(slot.y, Math.min(parseFloat(bubble.style.top),
                                                   slot.y + slot.h - now.height)) + 'px';
      var afterL = parseFloat(bubble.style.left) || 0;
      bubble.style.left = (afterL + (slot.x - afterL > 0 ? slot.x - afterL : 0)) + 'px';
    }

    /* THE LAST GUARD: A COLUMN OFF THE TOP OF THE SCREEN IS NOT A BUBBLE.
     *
     * Everything above reasons in slots, and a slot can be shorter than the
     * box it has to hold — a long line and a shallow band — so the seat
     * arithmetic and the three narrowing passes can between them produce a
     * box narrower than the bubble can actually render, a dozen rows tall,
     * with its first word above the window. The sorting screen did exactly
     * that: eight rows, 147px wide, top at -135.
     *
     * This does not second-guess the choice of slot. It asks two questions of
     * the finished box — is it readable, and is it on the screen — and fixes
     * it in the widest band the screen has if it is not.
     */
    var fin = { w: bubble.offsetWidth, h: bubble.offsetHeight };
    // ASK THE WORDS, NOT THE BOX.
    //
    // rowsOf() divides the finished height by a line height, which is the
    // third time this file has been caught counting a block instead of what
    // is in it. The box carries padding, a frame and a tail, so the estimate
    // rounds down: a four-row line in a tall-enough box came back as three
    // and this guard — the one whose whole job is to rescue a line that has
    // been squeezed into a column — did not fire. rowsOfLine() reads the row
    // each word actually laid out on, and it is already what the fit uses.
    if (fin.w < MIN_W - 1 || Math.max(rowsOf(fin.h), rowsOfLine()) > 3) {
      var widest2 = null;
      slots.forEach(function (r) { if (!widest2 || capFor(r) > capFor(widest2)) widest2 = r; });
      if (widest2) {
        bubble.style.maxWidth = capFor(widest2) + 'px';
        snugWidth();
        fin = { w: bubble.offsetWidth, h: bubble.offsetHeight };
        var p2 = placeIn(widest2, fin.w, fin.h);
        bubble.style.left = p2.x + 'px';
        bubble.style.top = p2.y + 'px';
      }
    }
    var lx = parseFloat(bubble.style.left) || 0, ly = parseFloat(bubble.style.top) || 0;
    bubble.style.left = Math.max(GAP, Math.min(lx, vw - fin.w - GAP)) + 'px';
    bubble.style.top = Math.max(GAP, Math.min(ly, vh - fin.h - GAP)) + 'px';

    paintSkin();
  }

  /**
   * Point the tail at Swiftee's head, from whichever edge of the bubble faces
   * him.
   *
   * It used to be two CSS classes that slid the tail to 18% or 82% along the
   * bottom edge. That is only ever right when he is below the bubble; placed
   * beside the lesson, with him standing off to one side at the same height,
   * a tail hanging off the bottom points at the floor. And it is the one part
   * of a speech bubble that carries meaning — it is what says who is talking.
   *
   * So the edge is chosen by where his head actually is, the tail slides to
   * the point on that edge nearest to it, and the square turns so its
   * bordered corner is the one facing out. The lip has to turn with it: the
   * body's shadow falls 9px straight down, and for a square rotated by t that
   * is (9·sin t, 9·cos t) in the square's own axes, or the underside would
   * end up running along the wrong two sides.
   */
  /* ------------------------------------------------------------------ *
   * The tail
   *
   * THE TAIL IS ONE SILHOUETTE WITH THE BUBBLE — a 60px SVG whose fill
   * covers the border across its mouth and whose free edges alone are
   * stroked (see the CSS). All this has to do is put it on the edge that
   * faces Swiftee, slide it along that edge to his head, and mirror its
   * sweep so the tip leans his way, like a comic.
   *
   * In the SVG's own frame the mouth spans x 14..46 and the tip is at
   * (12, 54): eighteen units to the LEFT of the mouth's centre. Rotated for
   * each edge, that puts the unmirrored tip at these positions along the
   * edge, and the mirrored one at 60 minus them.
   * ------------------------------------------------------------------ */
  var TIP = { bottom: 12, top: 48, right: 48, left: 12 };   // unmirrored tip, along the edge
  var MOUTH_LO = 14, MOUTH_HI = 46, TAIL_SIZE = 60;

  function paintSkin() {
    var tail = bubble.querySelector('.bubble-tail');
    if (!tail) return;
    var r = layoutRect(bubble);
    if (!r.width || !r.height) return;
    var head = headPoint();
    if (!head) { bubble.removeAttribute('data-tail'); return; }

    // the edge that faces his head: below, above, or beside
    var edge = head.y > r.top + r.height ? 'bottom'
             : head.y < r.top ? 'top'
             : head.x > r.left + r.width ? 'right' : 'left';
    var vertical = edge === 'bottom' || edge === 'top';
    var len = vertical ? r.width : r.height;
    var aim = vertical ? head.x - r.left : head.y - r.top;   // where his head is, along the edge

    // the sweep leans toward the bubble's middle: the mouth sits nearer the
    // centre than the tip does, and the tip points out to him
    var unflippedLeansLow = TIP[edge] < 30;                  // the unmirrored tip is toward the edge's start
    var wantLow = aim < len / 2;
    var flip = unflippedLeansLow !== wantLow;
    var tipAt = flip ? TAIL_SIZE - TIP[edge] : TIP[edge];

    // the mouth stays on the straight run of the edge, clear of the corners
    var radius = parseFloat(getComputedStyle(bubble).borderRadius) || 26;
    var lo = radius - MOUTH_LO + 2, hi = len - radius - MOUTH_HI - 2;
    if (hi < lo) { lo = hi = (len - TAIL_SIZE) / 2; }
    var offset = Math.max(lo, Math.min(hi, aim - tipAt));

    bubble.setAttribute('data-tail', edge);
    if (flip) bubble.setAttribute('data-tail-flip', ''); else bubble.removeAttribute('data-tail-flip');
    bubble.style.setProperty(vertical ? '--tail-x' : '--tail-y', offset.toFixed(1) + 'px');

    // the bubble springs out of its mouth
    var mx = vertical ? offset + TAIL_SIZE / 2 : (edge === 'right' ? r.width : 0);
    var my = vertical ? (edge === 'bottom' ? r.height : 0) : offset + TAIL_SIZE / 2;
    bubble.style.transformOrigin = (mx / r.width * 100).toFixed(1) + '% ' + (my / r.height * 100).toFixed(1) + '%';
  }

  function layoutRect(el) {
    var p = el.offsetParent || el.ownerDocument.body;
    var pr = p.getBoundingClientRect();
    return {
      left: pr.left + el.offsetLeft, top: pr.top + el.offsetTop,
      width: el.offsetWidth, height: el.offsetHeight
    };
  }


  /**
   * Swiftee's head in page pixels.
   *
   * bounds() is the drawn bird, not the mostly-empty sprite cell; the head is
   * the top fifth of it. Pointing at his centre puts the tail at his chest,
   * which looks like the sledge is talking.
   */
  /**
   * HIS BOX — the one he is walking to, if he is walking.
   *
   * Swiftee.bounds() is where the sprite is painted this frame. A line is set
   * the instant the screen opens, and on the screens that move him he is
   * still crossing the ice at that instant: the bubble was placed against the
   * mark he had LEFT, which is how a sentence ended up four hundred pixels
   * from the bird on the builder and the measuring screens, jumping to his
   * head half a second later when the settle pass ran.
   *
   * While he is travelling, his mark is the truth: the same layout the walk
   * is heading for, drawn at the size he will be. Once he is standing, the
   * painted box is the truth again, because that is what the child sees.
   */
  function birdRect() {
    if (!global.Swiftee) return null;
    var painted = Swiftee.bounds ? Swiftee.bounds() : null;
    var moving = !Swiftee.arrived || Swiftee.state === 'move' || Swiftee.state === 'enter';
    if (!moving && painted && painted.width) return painted;
    var L = layout(Swiftee.pos, Swiftee.size || 'medium');
    if (!L) return painted && painted.width ? painted : null;
    // the drawn bird, not the sprite cell: the same fraction seat() uses
    var h = 256 * L.scale * CONTENT_FRAC, w = h * 0.86;
    return { left: L.x - w / 2, right: L.x + w / 2, top: L.y - h, bottom: L.y, width: w, height: h };
  }

  function headPoint() {
    var b = birdRect();
    if (!b || !b.width) return null;
    return { x: b.left + b.width / 2, y: b.top + b.height * 0.18 };
  }

  /**
   * The instruction for this moment.
   *
   * All of it belongs to the plank at the top now — see instruction.js. What
   * used to be here was the corner card's own width negotiation: measure the
   * lesson, cap the card to whatever was left beside it, refuse the cap if
   * that came out too narrow to read, and nudge the card's top if the lesson
   * started high. Four rules trying to fit guidance into space the screen had
   * already given away.
   */
  function setCard(text) {
    // THE PLANK REPLACES THE BUBBLE. By the time an instruction follows his
    // line, the line has had its reading time; left up, the plank's arrival
    // re-laid the bubble and pushed it down onto the card.
    if (text && bubble && bubble.classList.contains('show')) say(null);
    // AND SENDS A PEEKING BIRD BACK DOWN. His head over the card's rim and
    // the plank want the same band; he has said his piece, so he drops
    // behind the card as the instruction comes up. A cheer brings him back.
    if (text && present && !entering && global.Swiftee && Swiftee.pos === 'peek') leave();
    if (global.Instruction) Instruction.show(text || null);
    // The plank's height moves the lesson, so anything measured against the
    // lesson is measured again once it has settled.
    placeBubble();
  }


  /**
   * Re-place everything that is positioned from the layout.
   *
   * Swiftee's position depends on the window, and the bubble's on Swiftee's,
   * so the two have to move together or the tail ends up pointing at empty
   * snow. One function, called from the resize handler and from anything that
   * changes the scene.
   */
  function relayout() {
    seatFurniture();
    Swiftee.relayout();
    syncPeekRim();
    // placeBubble, not fitLine: the fit was worked out when the line was set
    // and the settle pass only needs to re-place it. Re-running the whole
    // whole fit here measured a box the previous run had already narrowed.
    placeBubble();
    paintSkin();
  }

  function showNext(on) {
    if (!nextBtn) return;
    nextBtn.classList.toggle('show', !!on);
    nextBtn.disabled = !on;
  }

  function setProgress(i) {
    progress.style.width = ((i + 1) / Screens.list.length * 100).toFixed(1) + '%';
  }

  /* ------------------------------------------------------------------ *
   * Persistence — audio only, kept with the game's own key. sfx.js does
   * no storage of its own; this is the one place that does.
   * ------------------------------------------------------------------ */

  function loadAudio() {
    try { var s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (s && global.SFX) SFX.restore(s); } catch (e) {}
  }
  function saveAudio() {
    try { if (global.SFX) localStorage.setItem(SAVE_KEY, JSON.stringify(SFX.state())); } catch (e) {}
  }

  /* ------------------------------------------------------------------ *
   * Per-tap feedback — fire-and-forget beats, no awaiting.
   * ------------------------------------------------------------------ */

  function fire(beats) {
    (beats || []).forEach(function (b) {
      if (b.sfx && global.SFX) SFX.play(b.sfx, b);
      if (b.juice && global.Juice && Juice[b.juice]) Juice[b.juice](Stage.element(b.target), b);
      if (b.swiftee && buddyOn && present) Swiftee.play(b.swiftee, b);
      if (b.stage) Stage.apply(b.stage);
    });
  }

  /* ------------------------------------------------------------------ *
   * Director handlers
   * ------------------------------------------------------------------ */

  var H = null;   // the live handler table, so one handler can hand off to another
  function handlers() {
    H = {
      stage: function (spec) {
        // AFTER THE SNOW. A beat marked afterReveal waits for the veil to
        // melt before it draws, so what it draws — diagonals arriving one
        // by one — is seen arriving, not found already there when the snow
        // clears. On a screen entered without snow it draws at once.
        if (spec && spec.afterReveal) {
          var s2 = Object.assign({}, spec); delete s2.afterReveal;
          if (revealing) return revealing.then(function () { return H.stage(s2); });
          spec = s2;
        }
        // A beat that (re)builds a scene names the kind; the scene's full
        // configuration — options, bins, items, compare panels — lives on
        // the screen's `stage`. Merge so the beat stays short and the data
        // has one home.
        var scr = Screens.list[current];
        if (spec && spec.kind && scr && scr.stage && scr.stage.kind === spec.kind) {
          spec = Object.assign({}, scr.stage, spec);
        }
        // DOES ANYTHING GO UNDER THE SHAPE ON THIS SCREEN?
        //
        // The shape sits a little above the middle of its panel to leave room
        // for its name, its badge or a row of options. On a screen that has
        // none of those the room is not room, it is a gap: the shape reads as
        // having drifted upward and the bottom third of the panel is empty.
        //
        // The stage cannot know — the label and the badge arrive later, in
        // beats — so it is worked out here, where the whole screen is
        // visible, and passed in.
        // controls is only ever SET, never cleared: a scene that asks for a
        // control band of its own (the builder's stepper) keeps it
        if (spec && spec.kind && scr) spec = Object.assign({}, spec, { below: wantsRoomBelow(scr) }, wantsBand(scr) ? { controls: true } : {});
        var wasSolo = soloed();
        Stage.apply(spec);
        // Building or clearing a scene changes whether Swiftee is alone, and
        // "alone" is what decides between centre stage and off to one side.
        // Without this he stays centred over the cards the beat just dealt,
        // until the next move beat happens to fix it.
        // The panel's size and position change what the overlays have room
        // for, so re-place them on every scene build, not only when his side
        // of the screen changes. Twice: once now, and once after the scene's
        // entrance animations have settled, because cards and sort items
        // arrive on staggered timers and the layout they imply is not final
        // until they have.
        relayout();
        clearTimeout(settleTimer);
        settleTimer = setTimeout(relayout, 620);
        void wasSolo;
        // THE SCENE ARRIVES, THEN HE SPEAKS OF IT. A beat that builds a scene
        // holds the director for the length of the entrance — the card rises,
        // the shape pops — so the line that follows is about something the
        // child has already seen, not something arriving under his words.
        // 'vista' is the empty backdrop — there is nothing arriving to watch,
        // and holding for it pushed his sleigh half a second later into every
        // opening, which is long enough for the arrival to miss its cue.
        if (spec && spec.kind && spec.kind !== 'vista' && !(global.Juice && Juice.reducedMotion)) return pause(SCENE_ENTER_MS);
      },
      swiftee: function handlerSwiftee(state, opts, ctx) {
        // No bird, but still a beat: the screen paces as it did, and only
        // the animation is skipped. Cancellable, so a jump or Restart does
        // not leave the old screen waiting on a bird that is not there.
        if (!buddyOn) {
          return new Promise(function (resolve) {
            var t = setTimeout(resolve, BEAT_WITHOUT_HIM_MS);
            if (ctx && ctx.onCancel) ctx.onCancel(function () { clearTimeout(t); resolve(); });
          });
        }
        // Not on yet? He comes in first, then does what the beat asked.
        if (state !== 'enter' && !present) {
          return entrance().then(function () { return handlerSwiftee(state, opts, ctx); });
        }
        var o = Object.assign({}, opts);
        if (o.at) o.at = Stage.element(o.at);

        var p = Swiftee.play(state, o, ctx);
        if (state === 'enter') {
          // THIS IS THE ENTRANCE. Anything that asks for him before it is
          // over — a line the director reaches because the ride outran its
          // beat ceiling — waits on it rather than starting a second one,
          // which was a walk-on bird sliding in beside the one still landing.
          var landed = function (r) { present = true; entering = null; return r; };
          p = Promise.resolve(p).then(landed, landed);
          entering = Promise.race([p, pause(9000)]).then(function (r) { landed(r); return r; });
        }
        if (state === 'move' || state === 'enter') p.then(placeBubble);
        return p;
      },
      say: function handlerSay(text, opts, ctx) {
        // The index is fetched asynchronously. Without this gate the first
        // line can reach play() while the list is still empty and become the
        // only line on a run that is silently skipped.
        if (global.VO && opts && opts.vo && VO.ready && !VO.isReady) {
          return VO.ready().then(function () {
            if (ctx && ctx.signal && ctx.signal.cancelled) return;
            return handlerSay(text, opts, ctx);
          });
        }
        if (!buddyOn) {
          // THE SAME WORDS, ON THE PLANK. The line is still read for its
          // reading time, so the screen's pacing is what it was; it is only
          // the speaker that has changed. An instruction beat after it
          // replaces it, exactly as it replaced the bubble.
          // AND IT IS STILL SPOKEN. The words moving to the plank was never a
          // reason for the voice to stop — see plankVoice.
          if (global.Instruction) Instruction.show(text || null);
          return plankVoice(opts, ctx);
        }
        if (!present) {
          // He comes in, then says it. The line still gets its whole reading
          // time after it appears, not whatever the entrance left of it.
          return entrance().then(function () { return handlerSay(text, opts, ctx); }).then(function () {
            return new Promise(function (res) {
              var t = setTimeout(res, opts.reading || 1200);
              if (ctx && ctx.onCancel) ctx.onCancel(function () { clearTimeout(t); res(); });
            });
          });
        }
        // TWO SHORT BUBBLES RATHER THAN ONE LONG ONE. The reading time is
        // shared between the parts by their word counts, and the beat lasts
        // as long as both need.
        // THE PLANK STEPS ASIDE WHILE HE SPEAKS. Two boxes of words in the top
        // band fought for it; his bubble and the instruction now take turns,
        // and the instruction comes back the moment the line has been read.
        var held = (global.Instruction && Instruction.current) ? Instruction.current() : null;
        if (held) { heldCard = held; setCard(null); }
        // THE VOICE. If a clip exists for this line it plays now, as the
        // words begin to arrive; a missing clip is silently nothing.
        var voId = (global.VO && opts && opts.vo) ? opts.vo : null;
        if (voId && !VO.play(voId)) voId = null;    // no clip: the wall clock paces it
        /* THE SPEAKER'S CLOCK, offset to the bubble that is up.
         *
         * One recording carries the whole line; a line of two sentences is
         * two bubbles in turn. `offset` is where this bubble's sentence
         * starts inside the clip, so the words in it are stepped from the
         * voice's position less that offset. It returns null — meaning "use
         * the wall clock" — whenever this line's clip is not the one on air,
         * so a bubble can never be paced by another line's voice. */
        var clockFor = function (offset) {
          if (!voId) return null;
          return function () {
            if (!global.VO || !VO.at || VO.id !== voId) return null;
            var at = VO.at();
            return at == null ? null : Math.max(0, at - offset);
          };
        };
        var parts = splitLine(text);
        var words = function (t) { return t.split(/\s+/).length; };
        var counts = parts.map(words);
        var total = counts.reduce(function (n, count) { return n + count; }, 0) || 1;
        var recorded = (global.VO && VO.words && voId) ? VO.words(voId) : null;
        if (!recorded || recorded.length !== total) recorded = null;

        /* THE VOICE SETS THE PACE, NOT A COUNT OF LETTERS.
         *
         * A line of two or three sentences is shown as two or three bubbles in
         * turn, and the whole line is ONE recording. The turns were timed by
         * counting words — an estimate that is wrong by a second on a slow
         * reading — so the second bubble arrived while the voice was still on
         * the first sentence, or waited after it had finished. With the clip's
         * real length in hand (assets/vo/index.json, written by
         * tools/build-vo-index.js) the bubbles are spread across exactly that
         * length, in proportion to their words: the sentence on the screen is
         * the sentence being spoken.
         *
         * No clip, or a length nobody measured: the director's own reading
         * time, as before. A little tail is left after the voice so the last
         * bubble is not snatched away on the final syllable.
         */
        var t0Line = Date.now();
        var clipSecs = (global.VO && VO.seconds && voId) ? VO.seconds(voId) : 0;
        var reading = clipSecs ? Math.round(clipSecs * 1000) + 280 : (opts.reading || 1200);
        var wordAt = 0;
        var offsets = parts.map(function (p, partIndex) {
          var offset = recorded ? recorded[wordAt] : reading * wordAt / total;
          wordAt += counts[partIndex];
          return offset;
        });
        var shares = parts.map(function (p, partIndex) {
          var share = recorded
            ? ((partIndex + 1 < parts.length ? offsets[partIndex + 1] : reading) - offsets[partIndex])
            : reading * counts[partIndex] / total;
          // A clip's own share may be short; only a guessed one needs a floor,
          // and never a floor above the reading time it is a share of — that
          // inflated every multi-part line in a harness that turns the
          // reading time down.
          return clipSecs ? Math.max(420, share) : Math.max(Math.min(700, reading), share);
        });
        var spoken = shares.reduce(function (a, b) { return a + b; }, 0);
        var cuesFor = function (partIndex) {
          if (!recorded) return null;
          var first = 0;
          for (var ci = 0; ci < partIndex; ci++) first += counts[ci];
          return recorded.slice(first, first + counts[partIndex]).map(function (t) { return t - offsets[partIndex]; });
        };
        say(parts[0], null, shares[0], clockFor(offsets[0]), cuesFor(0));
        // the rest follow, each when the voice reaches it
        var partTimers = [];
        for (var pi = 1; pi < parts.length; pi++) {
          var at = offsets[pi];
          /* ANCHORED TO THE VOICE, NOT TO A SUM.
           *
           * The share is the clip's measured length split by word count,
           * which is close but not exact — a recording pauses where a word
           * count does not — and a clip that starts late is late for every
           * sentence after the first. So when the timer comes round, ask the
           * voice where it is: if it has not reached this sentence yet, come
           * back when it has. It can only ever wait longer, never cut in
           * early, and the deadline stops it waiting on a clip that stalled. */
          (function (t, share, when, partIndex) {
            var deadline = t0Line + when + 2000;
            var fire = function () {
              var clock = clockFor(0);
              var pos = clock ? clock() : null;
              if (pos != null && pos < when - 90 && Date.now() < deadline) {
                var again = setTimeout(fire, Math.min(320, when - pos));
                partTimers.push(again); lineTimers.push(again);
                return;
              }
              say(t, null, share, clockFor(when), cuesFor(partIndex));
            };
            var h = setTimeout(fire, when);
            partTimers.push(h); lineTimers.push(h);
          }(parts[pi], shares[pi], at, pi));
        }
        if (partTimers.length && ctx && ctx.onCancel) {
          ctx.onCancel(function () { partTimers.forEach(clearTimeout); });
        }
        // The lesson is read, not spoken. Swiftee still rests on the
        // `talking` loop while a line is up — his mouth moving is what makes
        // the bubble read as him saying it rather than as a caption — and it
        // runs for the director's reading time, which is now what paces the
        // line. Cleared on every exit path, cancellation included.
        Swiftee.speaking(true);
        var stop = function () { clearTimeout(mouthTimer); Swiftee.speaking(false); };
        clearTimeout(mouthTimer);
        mouthTimer = setTimeout(stop, spoken);

        // THE LINE CLEARS ITSELF once it has been read.
        //
        // A spoken line used to stay up until something else replaced it, so
        // narration from the top of a screen was still sitting over the
        // polygon while the child tried to drag it. It comes down a beat after
        // the reading time — long enough to finish the sentence, short enough
        // that the play area is clear while they play in it.
        //
        // NOT when it is the only thing telling them what to do. Screens that
        // carry an instruction card can lose the bubble safely; screens
        // without one would be left saying nothing at all, so those keep it.
        clearTimeout(bubbleTimer);
        bubbleTimer = setTimeout(function () {
          if (held) { say(null); return; }        // say(null) gives the plank back
          if (instruction && instruction.classList.contains('show')) say(null);
        }, spoken + 1100);
        if (ctx && ctx.onCancel) ctx.onCancel(function () { if (!(instruction && instruction.classList.contains('show'))) restoreHeldCard(); });
        if (ctx && ctx.onCancel) ctx.onCancel(function () { clearTimeout(bubbleTimer); });
        if (ctx && ctx.onCancel) ctx.onCancel(stop);
        /* THE BEAT ENDS WHEN THE VOICE DOES, not when a sum says it should.
         *
         * The paced sum is the clip's measured length shared out between the
         * bubbles, which is right to within a frame — but only if the clip
         * starts when it is asked to. A slow decode or a throttled tab makes
         * it late, and then the next beat begins over the end of the
         * sentence. Waiting on the audio itself removes the estimate from
         * the critical path; the timings above still pace the BUBBLES.
         *
         * Nothing here can hang: VO.finished() resolves on ended, on error,
         * on stop and on its own length, and the director's beat ceiling sits
         * above all of it. With no clip it resolves at once and the sum is
         * the pacing, exactly as before.
         */
        // A ONE-SENTENCE LINE IS STILL A LINE THAT TAKES TIME TO SAY. This
        // used to resolve at once unless the line had been split, which left
        // every single-sentence screen paced by the director's word count
        // alone — and that count is short of the recording on twenty-five of
        // the thirty-six lines that have one.
        var paced = new Promise(function (res) {
          var t = setTimeout(res, spoken);
          if (ctx && ctx.onCancel) ctx.onCancel(function () { clearTimeout(t); res(); });
        });
        var heard = (global.VO && VO.finished) ? VO.finished() : Promise.resolve();
        return Promise.all([paced, heard]);
      },
      instruction: function (text, opts, ctx) {
        // ON A CARD SCREEN HE SAYS IT. The plank would sit over a card that
        // has room beside it for him, so the instruction goes through his
        // bubble, with a line's reading time, and the plank stays down.
        if (text && buddyOn && speaksAll(current) && H && H.say) return H.say(text, opts || {}, ctx);
        setCard(text);
        // The plank says it; the voice still says it too, and the beat holds
        // until it has. An instruction beat had no wait of its own at all, so
        // without this the next thing began over the first syllable.
        return plankVoice(opts, ctx);
      },
      focus: function (target, opts) {
        Stage.focus(target, opts.style);
        // the card in focus is the one he peeks from: if he is waiting in
        // the wing for his cue, his mark moves with it
        if (opts.style === 'dim-others' && global.Swiftee && Swiftee.pos === 'peek' && !present && !entering && Swiftee.place) {
          Swiftee.place('peek', Swiftee.size); syncPeekRim(); placeBubble();
        }
      },
      input: function (spec, ctx) {
        // Next is shown only while the game is actually waiting to be told to
        // move on. Every other interaction wants the child looking at the
        // stage, not at a button in the corner.
        // The line is complete and still before the child is asked to do
        // anything. Narration and interaction could otherwise overlap by a
        // few hundred milliseconds — words still fading in while the polygon
        // had already become draggable — which is the worst possible moment
        // to split a seven-year-old's attention.
        revealAll();

        // THE REACTION'S SHEETS, FETCHED WHILE THEY ARE STILL DECIDING.
        // An input beat is dead air on his side — he is resting in a pinned
        // loop — and a tap can only reach two expressions. Warming them now
        // means the answer does not spend up to 400ms of its own grace
        // period waiting for a sheet to arrive.
        if (global.Swiftee && Swiftee.warm) Swiftee.warm();

        var waiting = spec.type === 'tap-anywhere';
        showNext(waiting);
        if (ctx && ctx.onCancel) ctx.onCancel(function () { showNext(false); });
        return Stage.waitFor(spec, ctx).then(function (r) {
          showNext(false);
          if (waiting) say(null);
          else if (r && r.result === 'correct') {
            var earned = quest.award(current + ':' + spec.type);
            // The award only fires the first time a screen is solved. Without
            // the else, replaying a screen — or solving one whose XP was
            // already banked — got no reaction at all, which is the same
            // desync as a wrong answer getting none.
            if (earned) reward('+' + earned + ' XP. Challenge complete.', false);
            // and he says so, whether or not there was XP in it: react() is
            // the one place his word on an answer comes from
            react('correct');
          } else if (r && r.result === 'wrong') react('wrong');
          return r;
        }, function (e) { showNext(false); throw e; });
      },
      sfx: function (name, opts) { if (global.SFX) SFX.play(name, opts); },
      juice: function (name, target, opts) { if (global.Juice && Juice[name]) Juice[name](Stage.element(target), opts); }
    };
    return H;
  }

  /* ------------------------------------------------------------------ *
   * Screen loop
   * ------------------------------------------------------------------ */

  /** Does any beat put text on the plank before the screen's first input? */
  /* IS A PLANK UP ON SCREEN i? An instruction at screen level or in any
     beat, or — on a screen that is not his — a spoken line, which the plank
     shows instead. Decides whether the card is seated under the plank's
     band or lifted to the centre (Stage.seat). */
  function hasPlank(i) {
    var s = Screens.list[i]; if (!s) return false;
    if (speaksAll(i)) return false;   // he says the instructions on a card screen
    if (typeof s.instruction === 'string' && s.instruction) return true;
    var beats = (s.beats || []);
    var has = function (b) {
      if (!b) return false;
      if (typeof b.instruction === 'string' && b.instruction) return true;
      if (!wantsBuddy(i) && typeof b.say === 'string' && b.say) return true;
      if (b.on && Object.keys(b.on).some(function (k) { return (b.on[k] || []).some(has); })) return true;
      return (b.otherwise || []).some(has);
    };
    if (!wantsBuddy(i) && typeof s.say === 'string' && s.say) return true;
    return beats.some(has);
  }

  function textBeforeInput(s) {
    var beats = s.beats || [];
    for (var i = 0; i < beats.length; i++) {
      var b = beats[i];
      if (b.input) return false;
      if (b.instruction || b.say) return true;
    }
    return false;   // no input at all, or one with nothing said before it
  }

  /* EVERY CLIP A SCREEN CAN ASK FOR, including the ones inside a branch: a
     wrong answer's nudge is as much this screen's voice as its narration. */
  function voIdsOf(i) {
    var s = Screens.list[i];
    if (!s) return [];
    var out = [];
    (function walk(beats) {
      (beats || []).forEach(function (b) {
        if (!b || typeof b !== 'object') return;
        if (b.vo) out.push(b.vo);
        if (b.on) Object.keys(b.on).forEach(function (k) { walk(b.on[k]); });
        if (b.otherwise) walk(b.otherwise);
        if (b.feedback) walk(b.feedback);
        if (b.parallel) walk(b.parallel);
      });
    }(s.beats));
    return out;
  }

  /* WARM THIS SCREEN'S VOICE, AND THE NEXT SCREEN'S.
   *
   * A clip fetched at the moment it is wanted costs a network round trip, and
   * the words are stepped against the voice now — so instead of racing ahead
   * to fill the gap, the line puts up its first word and waits. Over a
   * connection with 700ms of latency that was three quarters of a second of a
   * frozen bubble on every spoken screen. Asking one screen early costs
   * nothing: the child is still reading this one. */
  var warmedCues = false;
  function warmVoice(i) {
    if (!(global.VO && VO.preload)) return;
    var ids = voIdsOf(i).concat(voIdsOf(i + 1));
    // WHAT HE SAYS BACK TOO. The cheers and the nudges are not in the deck —
    // they are picked when the child answers — so nothing would ever ask for
    // them early, and the first "Nice!" of the lesson is the one that pays
    // for the whole round trip.
    if (!warmedCues) {
      warmedCues = true;
      ids = ids.concat(PRAISE.concat(NUDGE).map(function (p) { return p.vo; }));
    }
    try { VO.preload(ids); } catch (e) {}
  }

  function runScreen(i) {
    var s = Screens.list[i];
    warmVoice(i);
    // whatever the screen before was still going to say, it is not saying it
    cancelScreenLine();
    clearLineTimers();
    clearTimeout(bubbleTimer);
    say(null);
    // THE CARD IS CLEARED, NOT INHERITED.
    //
    // It was only ever replaced — set by a screen that has an instruction,
    // and left alone by one that does not. So the card from the screen before
    // stayed up: "Drag the highlighted vertex." over a screen that asks the
    // child to swipe, and again over the builder. Every screen that wants a
    // card sets one in its beats, so clearing here costs nothing and the
    // failure mode it removes is an instruction telling a child to do
    // something the screen cannot do.
    setCard(null);
    clearTimeout(bubbleTimer);

    // AND THE OPTIONS ARE CLEARED, NOT INHERITED.
    //
    // Only a screen that rebuilds the stage replaces them, so a screen that
    // merely highlights something — 'Whoa! One of the diagonals went outside'
    // — kept the previous screen's answer buttons sitting across the bottom.
    // They are inert by then: the interaction that bound them has ended. So a
    // child is shown two buttons, taps one, and nothing happens, which is a
    // worse lesson than no buttons at all.
    if (!screenAsksChoices(s) && global.Stage && Stage.apply) Stage.apply({ choices: null });

    // WHERE HE STANDS ON THIS SCREEN.
    //
    // Every screen in screens.js carries a `swiftee: { pos, size }` block and
    // NOTHING READ IT. He was placed once at boot — left, large — and moved
    // only where a beat explicitly told him to, so thirty-nine screens of
    // carefully chosen positions were dead configuration and he stood in the
    // same spot for the whole lesson, including on the screens whose lesson
    // reaches into that spot.
    //
    // Applied here, before the beats run, so it lands underneath the
    // transition on every screen that wipes rather than as a jump.
    // ONLY A PURPOSE PUTS HIM ON SCREEN. Every screen has a position for him;
    // eleven have a reason. The rest get the plank.
    buddyOn = wantsBuddy(i);

    // THE PLANK IS NOT BLANK WHILE THE CHILD IS ASKED TO ACT.
    //
    // A few screens carry their instruction only as a screen-level field and
    // never set it in a beat — Swiftee's pointing used to be the guidance.
    // With him off on those screens the plank would be empty over a live
    // input. So: if nothing puts text on the plank before the first input,
    // the screen-level instruction is shown at the start. Screens that do
    // speak or instruct before their input are left exactly as they were,
    // because seeding them would flash the deck's stale instruction first.
    if (s.instruction && !textBeforeInput(s)) {
      var ib = (s.beats || []).filter(function (b) { return b && b.instruction === s.instruction; })[0];
      if (buddyOn && speaksAll(i) && H && H.say) H.say(s.instruction, { vo: ib && ib.vo }, screenCtx());
      // The plank gets the words AND the clip: this is the only thing telling
      // the child what to do on these screens, so it is the last place that
      // should be the silent one.
      else { setCard(s.instruction); plankVoice({ vo: ib && ib.vo }, screenCtx()); }
    }
    if (!buddyOn && Swiftee.place) {
      // Normally he has already left: the loop plays his exit before a
      // screen that does not need him. This is the jump and the restart.
      Swiftee.place('off', Swiftee.size);
      present = false;
      syncPeekRim();
      say(null);
    }
    if (buddyOn && s.swiftee && Swiftee.place) {
      var mark = markFor(i, Swiftee.pos, Swiftee.size);
      var wantPos = mark.pos, wantSize = mark.size;
      // ALWAYS, not only when it differs. place() puts him on his mark AND
      // makes him visible, and the state he arrives in may have left him
      // neither: 'exit' flies him off the left edge and sets opacity 0, and a
      // screen entered while that was still running — a jump, a Restart, the
      // director abandoning a long beat — inherited a character four hundred
      // pixels off-stage with nothing left to bring him back. Placing him is
      // cheap and saying it twice costs a layout read.
      if (present && (wantPos !== Swiftee.pos || wantSize !== Swiftee.size) && Swiftee.play) {
        // ALREADY ON, ON A DIFFERENT MARK: he goes there, he does not jump
        // there. The move is a FLIP and lands on place(), so the bubble and
        // the clip are right the moment it resolves.
        Swiftee.play('move', { to: wantPos, size: wantSize });
      } else {
        Swiftee.place(wantPos, wantSize);
      }
      // On his mark but in the wing: his first beat brings him in.
      if (!present && Swiftee.visible) Swiftee.visible(false);
      syncPeekRim();
      placeBubble();
    }

    current = i; setProgress(i);
    // A carried card rides up when this screen has no plank, and eases back
    // under the band when it has; a scene built by this screen's beats is
    // seated as it is built.
    if (Stage.seat) Stage.seat(!hasPlank(i));
    Stage.onTap(function (kind, said) { if (s.perTap) fire(s.perTap[kind] || s.perTap.any); react(kind, said); });
    if (global.Input) Input.mode('locked');
    return director.run(s.beats);
  }

  /**
   * Reveal once the new screen has actually drawn itself.
   *
   * The snow covers the screen before the scene changes, so the rebuild is
   * never seen. What we cannot know in advance is when the rebuild happens:
   * most screens open with a stage beat, some only carry dialogue over from
   * the screen before. So wait for the director's first stage beat, with a
   * short deadline for the screens that never emit one — a transition that
   * hangs waiting for a scene that is not coming would be far worse than one
   * that clears a moment early.
   */
  var revealing = null;   // the melt in progress, for beats that wait for it
  function revealWhenReady() {
    if (!global.Transition || !Transition.covered || !Transition.covered()) return;
    var done = false;
    var go = function () {
      if (done) return; done = true;
      director.off('stage', go);
      var p = Transition.reveal();
      revealing = p;
      var clear = function () { if (revealing === p) revealing = null; };
      p.then(clear, clear);
    };
    director.on('stage', go);
    setTimeout(go, 420);
  }

  /**
   * Does this screen build a new scene, or carry on with the one already up?
   *
   * Only twelve of the thirty-nine rebuild the stage. The rest add to what is
   * already there — a label, a diagonal, a badge on the same pentagon.
   */
  /* ------------------------------------------------------------------ *
   * When the snow comes
   *
   * The wipe marks one thing: that there is something new to do. It fires
   * when a screen builds a new scene, or when it asks for a kind of doing
   * the child has not been asked for yet — the first time they have to
   * choose, the first time they have to drag, the first time they have to
   * sort. It never fires for a screen that only says another sentence.
   *
   * Interaction types are grouped into families on purpose. Going from
   * drag-endpoint to drag-vertex is the same hand doing the same thing; it
   * does not deserve a storm. Going from dragging to sorting does.
   *
   * tap-anywhere maps to nothing. It is not an interaction, it is reading —
   * counting it would put a wipe between every second screen and bury the
   * lesson in weather.
   * ------------------------------------------------------------------ */


  // Worked out once from the storyboard rather than from runtime state, so
  // it is the same on a replay, the same when a screen is entered out of
  // order, and answerable by a test without playing the game.
  function wipesAt(i) {
    // THE SNOW FALLS BETWEEN LEVELS, NOT BETWEEN SCREENS. A level is a
    // chapter of the quest (quest.js): Shape scout, Diagonal detective,
    // Dent discoverer, Pattern pro, Polygon builder. The screens inside one
    // step from each other with their own small entrances — a card pops, a
    // pair rises — and a full-screen snowfall between every one of them was
    // a wall where a step was wanted. Entering a new chapter is the moment
    // the story turns a page, and that is when the snow comes down.
    var scr = Screens.list[i];
    if (!scr || i <= 0) return false;
    if (scr.transition === false) return false;
    var chapters = (global.Quest && Quest.chapters) || [];
    return chapters.some(function (c) { return c.end === i - 1; });
  }

  /**
   * The wipe between screens — and, more importantly, when NOT to wipe.
   *
   * A snow wipe hides a scene change, which is exactly what you want when the
   * scene changes. Running it between every screen did two bad things. It
   * spent about fifteen seconds of the lesson on white-outs nobody asked for.
   * And on the twenty-seven screens that keep the same shape it destroyed the
   * continuity the teaching depends on: the child picks a vertex, the screen
   * whites out, and the next line says "I will connect it to another vertex"
   * about a vertex they can no longer see they chose.
   *
   * So the wipe marks new work: a new scene, or a new kind of doing. Screens
   * that only carry the lesson forward a sentence flow into each other, which
   * is what makes them read as one continuous demonstration rather than a
   * slideshow. See wipesAt() above for the rule.
   *
   * The first screen is exempt too: the arrival is the opening, and burying
   * it under snow would waste it.
   */
  function changeScreen(i, first) {
    // THE LAST LINE GOES BEFORE THE NEXT SCREEN BEGINS, not once it has been
    // built. runScreen clears it, and runScreen runs AFTER the snow has
    // covered the stage and after he has walked to his new mark — so for a
    // second the sentence from the screen before was still on the ice, with
    // nobody standing under it. It goes now, at the first instant the lesson
    // decides to move on.
    clearLineTimers();
    clearTimeout(bubbleTimer);
    say(null);
    if (first || !global.Transition || !wipesAt(i)) {
      var r = runScreen(i);
      revealWhenReady();
      return r;
    }
    return Transition.cover().then(function () {
      var p = runScreen(i);
      revealWhenReady();
      return p;
    });
  }

  async function play(from) {
    if (playing) return; playing = true;
    var gen = ++playGen;
    var start = from || 0;
    for (var i = start; i < Screens.list.length; i++) {
      // HE LEAVES BEFORE A SCREEN THAT DOES NOT NEED HIM: a wave and off to
      // the wing, and only then the ice cracks, rather than being switched
      // off underneath the transition.
      var nextMark = wantsBuddy(i) ? markFor(i, Swiftee.pos, Swiftee.size) : null;
      var hidden = /^(peek|corner)$/;
      var switchesHiding = !!(nextMark && present && nextMark.pos !== Swiftee.pos &&
                              (hidden.test(nextMark.pos) || hidden.test(Swiftee.pos || '')));
      // ...and before a screen where he pops from behind a card, or comes
      // out from inside one: those marks are not walked to. He goes off, the
      // ice cracks, and his first line brings him up behind the new card.
      // AND THE LINE GOES BEFORE HE DOES. leave() walks him off over most of
      // a second, and the sentence he had just said stayed on the ice while he
      // went — four hundred pixels from a bird who was no longer there.
      cancelScreenLine(); clearLineTimers(); clearTimeout(bubbleTimer); say(null);
      if (i > start && present && (!wantsBuddy(i) || switchesHiding)) { await leave(); if (gen !== playGen) return; }
      var r = await changeScreen(i, i === start);
      if (gen !== playGen) return;                 // a restart took over while this waited
      if (r === Director.CANCELLED) { playing = false; return; }
      // A CHEER IS HEARD OUT. A right answer ends a screen at once, and his
      // "Nice!" was being cut off by the ice; the lesson waits for it.
      var owed = cheerUntil - Date.now();
      if (owed > 0) { await pause(owed); if (gen !== playGen) return; }
      var badge = quest.complete(i);
      if (badge) { reward('Badge unlocked: ' + badge.name + '.', true); }
    }
    playing = false;
    finish();
  }

  function finish() {
    say(null); setCard(null); showNext(false);
    if (global.Music) Music.mood('win');   // the tune lifts for the last screen
    sayLong('Honk-tastic! ' + quest.snapshot().xp + ' XP and ' + quest.snapshot().badges.length + ' badges. You are a polygon adventurer!', 'win', 3400);
    // one burst, wide, for the finale — two from different points read as a stutter
    if (global.Juice) Juice.confetti(Stage.svg, { count: 72, spread: 2.6 });
    if (global.SFX) SFX.sequence(['drumroll', 1.2, 'levelUp', 0.3, 'sparkle']);
    // The end of the whole lesson earns the biggest clip in the rig, then
    // settles into `proud`. Everywhere else `celebrate` is the ceiling.
    Swiftee.play('excited').then(function () { return Swiftee.play('proud'); });
    hud.querySelector('.replay').classList.add('show');
  }

  function restart() {
    director.abort(); playing = false; showNext(false);
    clearTimeout(rewardTimer);
    quest = Quest.create(); say(null);
    $('#reward').classList.remove('show');
    hud.querySelector('.replay').classList.remove('show');
    Stage.apply({ kind: 'vista' });
    Swiftee.place('left', 'large');
    setTimeout(function () { play(0); }, 200);
  }

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */

  function boot() {
    root = $('#game'); stageEl = $('#stage'); hud = $('#hud'); bubble = $('#bubble');
    instruction = $('#instruction'); progress = $('#progress'); loadEl = $('#loading'); nextBtn = $('#next');

    Stage.mount(stageEl);
    Swiftee.mount(root, { layout: layout });
    Swiftee.place('left', 'large'); Swiftee.visible(false);   // he flies in on screen 1

    if (global.Juice) Juice.stage(stageEl);
    if (global.Transition) Transition.mount(root);
    if (global.Input) {
      Input.attach(stageEl);
      Input.mode('locked');
      // A tap on the stage fast-forwards the narration text. It does NOT
      // advance the screen — that is the Next button's job, and keeping the
      // two separate is what stopped an impatient tap from also poking the
      // vertex underneath it.
      // A tap finishes the line first. Only once it is all there does the
      // same gesture shorten the hold — otherwise an impatient child skips
      // past words they never saw.
      Input.on('tap', function () {
        if (revealAll()) return;
        director.skip();
      });

      /* HE NOTICES THE FINGER, not just the verdict.
       *
       * Everything he does was tied to being right or wrong, so between the
       * touch and the judgement — which on a drag is the whole of the
       * interaction — he stood perfectly still while the child worked. The
       * game was watching; he was not. A small bob on the press is the
       * anticipation the cheer after it resolves, and the pair read as one
       * movement rather than two.
       *
       * KEPT SMALL AND RARE ON PURPOSE. Eight pixels, a fifth of a second,
       * never twice inside four hundred milliseconds and never while he is
       * already doing something — a drag fires pointerdown the moment it
       * starts, and a mascot that flinches at every touch is the mess this
       * is meant to avoid.
       */
      var lastNoticed = 0;
      Input.on('down', function () {
        var t = Date.now();
        if (t - lastNoticed < 400) return;
        if (!buddyOn || !present || entering) return;
        if (!global.Swiftee || !Swiftee.bounce) return;
        if (Date.now() < cheerUntil) return;       // he is already saying something
        lastNoticed = t;
        try { Swiftee.bounce('notice'); } catch (e) {}
      });
    }
    if (global.SFX) SFX.key('C pentatonic');
    loadAudio();

    director = Director.create(handlers(), { msPerWord: 300, sayMinMs: 1100 });


    // HUD wiring. Audio is optional at every call site: a build without
    // sfx.js should still teach the lesson silently rather than die on boot.
    var muteBtn = hud.querySelector('.mute');
    muteBtn.addEventListener('click', function () {
      var m = global.SFX ? SFX.mute() : true;
      this.classList.toggle('on', m); this.setAttribute('aria-pressed', String(m)); saveAudio();
    });
    nextBtn.addEventListener('click', function () {
      if (global.SFX) SFX.play('select');
      if (global.Input) Input.advance();
    });
    // Keyboard parity: a child on a laptop should not have to find the mouse.
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'ArrowRight') return;
      if (!nextBtn.classList.contains('show')) return;
      e.preventDefault();
      if (global.SFX) SFX.play('select');
      if (global.Input) Input.advance();
    });

    hud.querySelector('.restart').addEventListener('click', restart);
    hud.querySelector('.replay').addEventListener('click', restart);
    muteBtn.classList.toggle('on', !!(global.SFX && SFX.isMuted()));

    // Tap anywhere on the bubble skips narration too.
    bubble.addEventListener('pointerdown', function () { director.skip(); });

    window.addEventListener('resize', relayout);

    // Everything positioned from a measurement has to be measured again once
    // the real font is in. Until Nunito loads, the bubble is laid out in the
    // fallback face, comes out narrower, and is placed on that basis — then
    // the webfont arrives, it reflows wider, and the right-hand edge ends up
    // over the panel it was carefully kept clear of.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(relayout, function () {});
    }

    loadEl.classList.add('ready');
    if (global.TitleFx) TitleFx.mount(loadEl);

    // Audio needs a real gesture. The start button is that gesture, so
    // nothing plays before the learner is ready.
    wireJump();

    // POINTERDOWN, NOT CLICK, for everything the child is meant to feel.
    // click does not fire until the finger lifts, and by then this handler is
    // also dropping the curtain — so the pop and the squash were being played
    // behind the thing that covers them. The gesture that unlocks audio is
    // the press, so the cue can land on the press too.
    var startEl = $('#start');
    var armed = false;
    startEl.addEventListener('pointerdown', function () {
      if (armed) return;
      armed = true;
      if (global.SFX) { SFX.unlock(); SFX.play('pop'); }
      if (global.TitleFx) TitleFx.pressDown();
    });
    // Released without completing the tap: undo the squash, keep the screen.
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
      startEl.addEventListener(ev, function () {
        if (!armed) return;
        armed = false;
        if (global.TitleFx) TitleFx.pressUp();
      });
    });

    startEl.addEventListener('click', function () {
      // The gesture that unlocks audio is also the first thing that should
      // make a sound. Unlock, then play on the same tick — the context is
      // resumed by the gesture, so the cue lands with the press rather than
      // a screen later.
      // sequence(), not two play() calls with a delay option: a cue only
      // honours the options it reads, and sparkle reads none — so the delay
      // was ignored and both landed on the same instant as one thicker pop.
      // The pop already rang on the press; this is the release on top of it.
      if (global.SFX) { SFX.unlock(); SFX.play('sparkle'); }
      // THE TUNE COMES IN WITH THE GAME, not with the page: audio may only
      // start on a gesture, and this is the gesture. It is quiet and it is on
      // the music bus, so the mute button and every duck already reach it.
      if (global.Music) Music.start();
      if (global.TitleFx) { TitleFx.pressUp(); TitleFx.press(); }
      // A beat before the curtain, so the burst is something the child sees
      // rather than something the transition eats.
      setTimeout(function () { loadEl.classList.add('gone'); }, 120);
      // The title screen's weather is thirty infinite animations. Nothing can
      // see them once the curtain is down, so they are cancelled rather than
      // left running behind the lesson for the rest of the session.
      setTimeout(function () { if (global.TitleFx) TitleFx.stop(); }, 640);
      setTimeout(function () { play(0); }, 430);
    });
  }

  /**
   * THE SCREEN PICKER — a review tool, off unless the address asks for it.
   *
   * Reviewing a layout means looking at one screen, not at the thirty-eight
   * in front of it. This lists every screen by number and id and jumps
   * straight there.
   *
   * Delete this function, its call in boot(), the #jump element and the
   * #jump rules in the stylesheet, and nothing else changes — it reads the
   * screen list and calls the same play() the lesson does, and owns no state
   * of its own. It also keeps itself in step: jumping by any other route
   * still moves the selection, so the box never claims you are somewhere you
   * are not.
   */
  function wireJump() {
    var box = $('#jump-sel');
    if (!box || !global.Screens) return;
    // A CHILD NEVER SEES IT. It is a dropdown listing every screen by number
    // over the top-left of the lesson, which is a hole in the game: one tap
    // and they are somewhere they did not choose to be. ?dev=1 turns it on
    // for a review or a test run and nothing else does.
    // On this machine it is always there — a review is what it is for — and
    // on the deployed site it is there only if the address asks for it.
    var dev = false;
    try {
      var loc = global.location || {};
      var local = /^(localhost|127\.0\.0\.1|\[::1\]|)$/.test(loc.hostname || '') || loc.protocol === 'file:';
      dev = local || /[?&]dev=1\b/.test(loc.search || '');
    } catch (e) { dev = false; }
    if (!dev) { var host = $('#jump'); if (host) host.remove(); return; }
    var host2 = $('#jump'); if (host2) host2.removeAttribute('hidden');
    Screens.list.forEach(function (s, i) {
      var o = document.createElement('option');
      o.value = i;
      o.textContent = (i + 1) + '. ' + s.id;
      box.appendChild(o);
    });
    box.addEventListener('change', function () {
      var n = +box.value;
      if (!(n >= 0 && n < Screens.list.length)) return;
      // play() is a loop over the remaining screens and refuses to start a
      // second one while the first is running, so jumping is not 'call play'
      // — it is 'end the loop that is running, then start one at n'. abort()
      // makes the awaited screen resolve CANCELLED, which is that loop's own
      // way out; the beat after it is so the old loop has unwound before the
      // new one claims the flag.
      director.abort();
      playing = false;
      showNext(false);
      cancelScreenLine(); clearLineTimers(); clearTimeout(bubbleTimer); say(null);

      // Some screens never build a stage — they add a question to whatever
      // the screen before them put up. Played in order that is exactly
      // right; jumped to, it means you inherit whichever stage happened to
      // be on screen, which for a picker is every stage but the correct one.
      // So walk back to the nearest screen that does declare one and build
      // that first.
      // THE LAYOUT READS WHERE HE STANDS, so he goes to the target screen's
      // mark before its stage is built — otherwise a jump from the intro
      // built every slab to the right of a bird who was about to leave.
      var built = -1;
      for (var b = n; b >= 0; b--) {
        var sp = Screens.list[b].stage;
        if (sp && sp.kind) { built = b; break; }
      }
      if (global.Swiftee && Swiftee.place) {
        // the scene was laid out for wherever he stood when it was built
        var mb = built >= 0 ? markFor(built, Swiftee.pos, Swiftee.size) : null;
        Swiftee.place(mb ? mb.pos : 'off', mb ? mb.size : Swiftee.size);
      }
      if (Stage.seat) Stage.seat(!hasPlank(n));
      if (built >= 0) Stage.apply(Screens.list[built].stage);
      if (global.Swiftee && Swiftee.place) {
        var m = markFor(n, Swiftee.pos, Swiftee.size);
        Swiftee.place(m ? m.pos : 'off', m ? m.size : Swiftee.size);
      }
      box.blur();                       // so the arrow keys go back to the lesson
      setTimeout(function () { play(n); }, 80);
    });
    if (director && director.on) {
      director.on('start', function () {
        if (current >= 0 && +box.value !== current) box.value = current;
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  global.Game = {
    restart: restart, play: play, relayout: relayout,
    get screen() { return current; },
    /* Read by the suites: whether this screen wants him, and whether he is actually on. */
    get buddy() { return { on: buddyOn, present: present, entering: !!entering }; },
    get director() { return director; }
  };

})(typeof window !== 'undefined' ? window : this);
