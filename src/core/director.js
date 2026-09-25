/*!
 * director.js — runs each screen as a paced sequence of awaitable beats.
 *
 * The brief's section 3:
 *   enter -> settle -> Swiftee reacts -> instruction -> VO -> object animates
 *   -> learner gets control -> interacts -> feedback -> Swiftee reacts -> next
 *
 * and section 4: nothing starts before the previous thing has been
 * understood. This module makes both structural instead of aspirational.
 * Every beat is awaited; the next one cannot start early.
 *
 * Three properties matter more than the beat vocabulary:
 *
 *   CANCELLABLE  Changing screen aborts the running sequence and every
 *                timer, VO and pending input inside it. Nothing from screen
 *                6 can fire during screen 7. This is the "stale coroutine
 *                across scenes" bug from earlier conversions, closed at the
 *                architecture level.
 *
 *   NEVER STUCK  A VO that fails to load, an animation whose `finished`
 *                never resolves, a handler that throws — none of them hang
 *                the game. Every wait has a ceiling and every failure falls
 *                through to the next beat. Section 14.
 *
 *   SKIP-SAFE    A tap during narration fast-forwards the *text*. It never
 *                skips an input beat, and it never skips feedback. Children
 *                tap constantly; the game must survive it without losing
 *                the lesson.
 *
 * ONE STATE AT A TIME. The director is also the lesson's state machine: at any
 * moment exactly one of
 *
 *   IDLE  ENTERING  DIALOGUE_REVEAL  DIALOGUE_READING  WAITING_FOR_USER
 *   USER_INTERACTING  CHECKING  FEEDBACK  EXITING  NEXT_STEP
 *
 * holds the screen, and every change is announced as a 'state' event. The
 * beats move it along; game.js reports the two things only it can see — the
 * finger coming down (USER_INTERACTING) and the screen being left (EXITING).
 *
 * AND ONE EVENT STREAM. The lesson's own events — dialogue:start,
 * dialogue:word, dialogue:complete, interaction:enabled, interaction:start,
 * interaction:complete, answer:correct, feedback:start, step:complete and the
 * rest — go through the same emitter, so the dialogue can react to what the
 * child did instead of guessing with a timer, and a test can listen to
 * exactly what happened, in order.
 *
 * The director owns timing only. It knows nothing about the DOM. You give
 * it handlers for the things it sequences:
 *
 *   var director = Director.create({
 *     swiftee:     function (state, opts, ctx) { ... return promise; },
 *     say:         function (text, opts, ctx)  { ... return promise; },   // shows text, plays VO
 *     instruction: function (text, opts, ctx)  { ... },
 *     focus:       function (target, opts, ctx){ ... },
 *     input:       function (spec, ctx)        { ... return promise<result>; },
 *     sfx:         function (name, opts)       { ... },
 *     juice:       function (name, target, opts) { ... },
 *     stage:       function (spec, ctx)        { ... }                    // set up the scene
 *   });
 *
 *   await director.run([
 *     { swiftee: 'enter', from: 'left' },
 *     { wait: 400 },
 *     { say: 'Hi! I am Swiftee.', vo: 'intro_01' },
 *     { swiftee: 'wave' },
 *     { instruction: 'Pick any vertex.' },
 *     { focus: 'polygon' },
 *     { input: { type: 'vertex-pick' } },
 *     { sfx: 'select' }
 *   ]);
 *
 * Every handler receives `ctx` with `ctx.signal.cancelled`, `ctx.onCancel(fn)`
 * and `ctx.phase(name)`, so it can stop a VO or an animation when the screen
 * changes and report where a line has got to. Handlers that ignore ctx still
 * work; they just cannot be interrupted mid-effect.
 */
(function (global) {
  'use strict';

  var DEFAULTS = {
    // Reading-time fallback for `say` when there is no handler to pace it:
    // roughly the pace a child needs to read along, plus a settle.
    msPerWord: 280,
    sayMinMs: 900,
    // the breath between the last word of a line and the moment the child
    // may touch anything, for a handler that does not pace its own lines;
    // a harness turns it down so a full run is not paced for reading
    readablePauseMs: 400,
    sayMaxMs: 9000,
    // Absolute ceiling on any single non-input beat. If an animation's
    // promise never resolves, this is what saves the game.
    beatCeilingMs: 12000,
    // A brief hold after feedback so it registers before anything moves.
    feedbackSettleMs: 500
  };

  /* The states, by name. Exposed so a caller never has to spell one. */
  var STATES = {
    IDLE: 'IDLE', ENTERING: 'ENTERING',
    DIALOGUE_REVEAL: 'DIALOGUE_REVEAL', DIALOGUE_READING: 'DIALOGUE_READING',
    WAITING_FOR_USER: 'WAITING_FOR_USER', USER_INTERACTING: 'USER_INTERACTING',
    CHECKING: 'CHECKING', FEEDBACK: 'FEEDBACK', EXITING: 'EXITING', NEXT_STEP: 'NEXT_STEP'
  };

  /* ------------------------------------------------------------------ *
   * Cancellation token
   * ------------------------------------------------------------------ */

  function Token() {
    this.cancelled = false;
    this._fns = [];
  }
  Token.prototype.onCancel = function (fn) {
    if (this.cancelled) { try { fn(); } catch (e) {} return; }
    this._fns.push(fn);
  };
  Token.prototype.cancel = function () {
    if (this.cancelled) return;
    this.cancelled = true;
    var fns = this._fns; this._fns = [];
    for (var i = 0; i < fns.length; i++) { try { fns[i](); } catch (e) {} }
  };

  var CANCELLED = { cancelled: true };

  /** Sleep that resolves early (as cancelled) when the token fires. */
  function sleep(ms, token) {
    return new Promise(function (resolve) {
      if (token.cancelled) return resolve(CANCELLED);
      var id = setTimeout(function () { resolve(); }, Math.max(0, ms));
      token.onCancel(function () { clearTimeout(id); resolve(CANCELLED); });
    });
  }

  /**
   * Wrap any promise so it (a) resolves as cancelled when the token fires,
   * (b) resolves after `ceiling` ms regardless, (c) never rejects. A handler
   * that throws or hangs cannot take the sequence down with it.
   */
  function guard(promiseLike, token, ceiling) {
    return new Promise(function (resolve) {
      var done = false;
      function finish(v) { if (done) return; done = true; clearTimeout(id); resolve(v); }
      var id = setTimeout(function () { finish({ timedOut: true }); }, ceiling);
      token.onCancel(function () { finish(CANCELLED); });
      Promise.resolve(promiseLike).then(finish, function (err) {
        if (global.console) console.warn('Director: beat failed, continuing —', err && err.message || err);
        finish({ failed: true });
      });
    });
  }

  function words(s) { return String(s || '').trim().split(/\s+/).filter(Boolean).length; }

  /* WHAT KIND OF LINE THIS IS — narration, an instruction to act, a question.
     dialogue-timing.js reads it off the beats that follow; without it every
     line is narration, which is the old behaviour exactly. */
  function lineTypeAt(beats, i) {
    var T = global.Timing;
    if (T && T.lineType) { try { return T.lineType(beats, i); } catch (e) {} }
    return 'narration';
  }

  /* THE INSTRUCTION THAT ONLY REPEATS THIS LINE, if the next line on the
     screen is one ("…Draw all the diagonals from this vertex." and then the
     card's "Draw all the diagonals from this vertex."). The line is shown so
     that its last bubble already IS that instruction, and the instruction
     then has nothing left to show: the words appear once. */
  function settledByAt(beats, i) {
    var T = global.Timing, own = beats[i] && beats[i].say;
    if (!T || !T.repeats || typeof own !== 'string') return null;
    for (var k = i + 1; k < beats.length; k++) {
      var b = beats[k];
      if (!b || typeof b !== 'object') continue;
      if (b.say != null) return null;
      if (typeof b.instruction === 'string') return T.repeats(b.instruction, own) ? b.instruction : null;
      if (b.input || b.branch != null) return null;
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * Director
   * ------------------------------------------------------------------ */

  function create(handlers, options) {
    handlers = handlers || {};
    var cfg = {};
    for (var k in DEFAULTS) cfg[k] = DEFAULTS[k];
    for (var o in (options || {})) if (o in cfg) cfg[o] = options[o];

    var current = null;      // token for the running sequence
    var skipRequested = null;// resolver for the current skippable beat
    var listeners = {};
    var state = STATES.IDLE;

    function emit(name, payload) {
      var list = (listeners[name] || []).slice();
      for (var i = 0; i < list.length; i++) { try { list[i](payload); } catch (e) {} }
    }

    /* ONE STATE AT A TIME, and every change said out loud. */
    function setState(to, info) {
      if (!to || to === state) return;
      var from = state; state = to;
      emit('state', { from: from, to: to, info: info || null });
    }

    function ctxFor(token) {
      return {
        signal: token,
        onCancel: function (fn) { token.onCancel(fn); },
        cfg: cfg,
        // Where a line has got to. A handler that reveals its words over time
        // says 'reading' once they are all in, and the screen is then in its
        // reading pause rather than still being told something.
        phase: function (name) {
          if (token !== current || token.cancelled) return;
          if (name === 'reading') setState(STATES.DIALOGUE_READING);
          else if (name === 'reveal') setState(STATES.DIALOGUE_REVEAL);
        }
      };
    }

    function call(name, args) {
      var fn = handlers[name];
      if (typeof fn !== 'function') return Promise.resolve();
      try { return Promise.resolve(fn.apply(null, args)); }
      catch (e) { return Promise.reject(e); }
    }

    /* --- individual beats ----------------------------------------- */

    function beatWait(beat, token) {
      return sleep(beat.wait, token);
    }

    /**
     * Narration. Shows text, plays VO if present, and holds for as long as
     * the line takes. Skippable: a skip() finishes the hold but leaves the
     * text on screen. Never shorter than sayMinMs, so a hyper-tapping child
     * cannot blow through the lesson.
     *
     * THE HANDLER PACES A LINE IT KNOWS HOW TO PACE. The say handler knows
     * when each word lands, how long the panel takes to come in, which kind
     * of line this is and so how long it must stay — and it resolves when the
     * line is done. A word count here, laid over the top of that as a second
     * floor, could only ever make a line wait longer than the line itself
     * says it needs: that is how "Pick any vertex." kept the child's hands off
     * the polygon for well over a second after the last word. So with a
     * handler, the only floor is the minimum; the word count is the fallback
     * for a build with no handler, or one whose handler failed.
     */
    function beatSay(beat, token, info) {
      var text = beat.say;
      var type = (info && info.type) || 'narration';
      var reading = Math.min(cfg.sayMaxMs, Math.max(cfg.sayMinMs, words(text) * cfg.msPerWord + 400));
      var ctx = ctxFor(token);
      var started = Date.now();
      var hasHandler = typeof handlers.say === 'function';

      setState(STATES.DIALOGUE_REVEAL, { text: text, type: type });
      emit('say', { text: text, vo: beat.vo, type: type });
      lastWasSpeech = true;
      var voDone = guard(call('say', [text, { vo: beat.vo, reading: reading, parts: beat.parts, type: type, settledBy: info && info.settledBy, faces: beat.faces }, ctx]), token, cfg.beatCeilingMs)
        .then(function (r) {
          // A handler that failed or hung paced nothing: fall back to the
          // reading time, so a broken voice never turns into a flash of text.
          if (r && (r.failed || r.timedOut)) return sleep(Math.max(0, reading - (Date.now() - started)), token);
          return r;
        });

      // The minimum runs in parallel; a skip short-circuits the remainder
      // past it.
      var floor = sleep(hasHandler ? cfg.sayMinMs : reading, token);
      var skip = new Promise(function (resolve) { skipRequested = resolve; });

      return Promise.race([
        Promise.all([voDone, floor]),
        skip.then(function () {
          // enforce the minimum even on skip
          var elapsed = Date.now() - started;
          return sleep(Math.max(0, cfg.sayMinMs - elapsed), token);
        })
      ]).then(function (r) {
        skipRequested = null;
        return r;
      });
    }

    function beatInstruction(beat, token, info) {
      var type = (info && info.type) || 'narration';
      if (beat.instruction) setState(STATES.DIALOGUE_REVEAL, { text: beat.instruction, type: type });
      emit('instruction', { text: beat.instruction, type: type });
      if (beat.instruction) lastWasSpeech = true;
      // The beat itself, with what kind of line it is: the handler may speak
      // it, and a spoken line is paced by its kind.
      var opts = {};
      for (var key in beat) opts[key] = beat[key];
      opts.type = type;
      return guard(call('instruction', [beat.instruction, opts, ctxFor(token)]), token, cfg.beatCeilingMs);
    }

    function beatSwiftee(beat, token) {
      emit('swiftee', { state: beat.swiftee, opts: beat });
      var p = call('swiftee', [beat.swiftee, beat, ctxFor(token)]);
      // Some states are fire-and-forget (idle, look-at); only await if the
      // beat asks for it or the state is inherently transitional.
      // A CELEBRATION IS NOT A WAIT. It was awaited, and the clip runs 3.4s,
      // so "Yay! You made a diagonal." sat unsaid for three and a half
      // seconds after the diagonal was made, and every right answer held the
      // lesson that long. He celebrates while the lesson goes on — into the
      // next line, which he then says glad (swiftee.js moods).
      var transitional = /^(enter|exit|move|hop)$/.test(beat.swiftee);
      if (beat.await === false || (!transitional && beat.await !== true)) return Promise.resolve();
      return guard(p, token, cfg.beatCeilingMs);
    }

    function beatFocus(beat, token) {
      emit('focus', { target: beat.focus, opts: beat });
      return guard(call('focus', [beat.focus, beat, ctxFor(token)]), token, cfg.beatCeilingMs);
    }

    function beatStage(beat, token) {
      emit('stage', beat.stage);
      return guard(call('stage', [beat.stage, ctxFor(token)]), token, cfg.beatCeilingMs);
    }

    function beatSfx(beat) {
      call('sfx', [beat.sfx, beat]).catch(function () {});
      return Promise.resolve();
    }

    function beatJuice(beat) {
      call('juice', [beat.juice, beat.target, beat]).catch(function () {});
      return Promise.resolve();
    }

    /**
     * Hand control to the learner. Not skippable, no ceiling — the game
     * waits as long as the child does. Cancellation (screen change) is the
     * only way out other than the learner acting.
     */
    /* A BREATH BEFORE THE CHILD MAY TOUCH ANYTHING.
     *
     * The sentence finishes and the input arms in the same tick, so a child
     * who is still reading the last word is already being judged — and a
     * finger already moving lands on a target that was not there a moment
     * ago. A handler that paces its own lines has already left that breath,
     * sized to the kind of line it was (dialogue-timing.js); for one that
     * does not, readablePauseMs is it. Only after speech: an input that
     * follows an animation or another input arms at once, as it always did.
     * Cancellable like every other wait.
     */
    var lastWasSpeech = false;

    function beatInput(beat, token) {
      // The event fires when the input is LIVE, not when its beat begins:
      // anything listening for it (the harness, an idle hint) would otherwise
      // act on a target that is still four hundred milliseconds away.
      var settle = lastWasSpeech ? sleep(cfg.readablePauseMs, token) : Promise.resolve();
      lastWasSpeech = false;
      return settle.then(function (r) {
        if (r === CANCELLED || token.cancelled) return CANCELLED;
        return armInput(beat, token);
      });
    }

    function armInput(beat, token) {
      setState(STATES.WAITING_FOR_USER, { spec: beat.input });
      emit('input', { spec: beat.input });
      emit('interaction:enabled', { spec: beat.input });
      return new Promise(function (resolve) {
        if (token.cancelled) return resolve(CANCELLED);
        token.onCancel(function () { resolve(CANCELLED); });
        call('input', [beat.input, ctxFor(token)]).then(resolve, function (err) {
          if (global.console) console.warn('Director: input handler failed —', err && err.message || err);
          resolve({ failed: true });
        });
      }).then(function (r) {
        if (r !== CANCELLED && token === current) {
          setState(STATES.CHECKING, { result: r && r.result });
          emit('interaction:complete', { spec: beat.input, result: r && r.result, detail: r });
        }
        return r;
      });
    }

    /**
     * Branch on the last input result. `beat.on` maps result keys to beat
     * lists; `otherwise` is the fallback. The chosen list runs inline, so
     * feedback is part of the sequence rather than a side effect.
     */
    /* A BRANCH CAN WAIT FOR THE RIGHT ANSWER. `until: 'correct'` runs the
       branch again on whatever the arm it took asked for last: a wrong answer
       runs `otherwise` — the nudge, then the question again — and the answer
       to THAT is branched on in turn. Without it the retry's result fell off
       the end of the list: a right second try got no praise and skipped what
       the right arm shows ("All diagonals are still inside."), and a wrong
       second try moved the lesson on. It only goes round when the arm asked
       again (a new input result); an arm with no input cannot loop. */
    function beatBranch(beat, token, state) {
      var key = state.last && state.last.result != null ? String(state.last.result) : 'otherwise';
      var list = beat.on && beat.on[key] || beat.otherwise || [];
      var asked = state.last;
      return inFeedback(list, token, state, key, function () { return runList(list, token, state); }).then(function (r) {
        if (r === CANCELLED || token.cancelled) return CANCELLED;
        if (beat.until != null && key !== String(beat.until) && state.last !== asked) return beatBranch(beat, token, state);
        return r;
      });
    }

    /* FEEDBACK IS A STATE, with a beginning and an end the rest of the game
       can hear: a line a wrong answer interrupted comes back on
       feedback:complete, not on a guessed timer. */
    function inFeedback(list, token, st, key, body) {
      setState(STATES.FEEDBACK, { result: key });
      emit('feedback:start', { result: key });
      return body().then(function (r) {
        if (r !== CANCELLED && token === current) emit('feedback:complete', { result: key });
        return r;
      });
    }

    /* --- the loop --------------------------------------------------- */

    function runBeat(beat, token, state, info) {
      if (token.cancelled) return Promise.resolve(CANCELLED);
      if (typeof beat === 'number') return sleep(beat, token);
      if (typeof beat === 'function') {
        return guard(beat(state, ctxFor(token)), token, cfg.beatCeilingMs);
      }
      if (beat.stage != null)       return beatStage(beat, token);
      if (beat.wait != null)        return beatWait(beat, token);
      if (beat.say != null)         return beatSay(beat, token, info);
      if (beat.instruction != null) return beatInstruction(beat, token, info);
      if (beat.swiftee != null)     return beatSwiftee(beat, token);
      if (beat.focus != null)       return beatFocus(beat, token);
      if (beat.sfx != null)         return beatSfx(beat);
      if (beat.juice != null)       return beatJuice(beat);
      if (beat.input != null) {
        return beatInput(beat, token).then(function (r) { state.last = r; return r; });
      }
      if (beat.branch != null)      return beatBranch(beat, token, state);
      if (beat.parallel != null) {
        return Promise.all(beat.parallel.map(function (b) { return runBeat(b, token, state, info); }));
      }
      if (beat.feedback != null) {
        // Sugar: a feedback beat is a list followed by the settle hold.
        var key = state.last && state.last.result != null ? String(state.last.result) : 'feedback';
        return inFeedback(beat.feedback, token, state, key, function () {
          return runList(beat.feedback, token, state).then(function (r) {
            if (r === CANCELLED) return r;
            return sleep(cfg.feedbackSettleMs, token);
          });
        });
      }
      return Promise.resolve();
    }

    function runList(beats, token, state) {
      var i = 0;
      function next() {
        if (token.cancelled) return Promise.resolve(CANCELLED);
        if (i >= beats.length) return Promise.resolve(state);
        var at = i++;
        var beat = beats[at];
        emit('beat', { index: at, beat: beat });
        var info = null;
        if (beat && typeof beat === 'object' && (beat.say != null || typeof beat.instruction === 'string')) {
          info = { type: lineTypeAt(beats, at), settledBy: beat.say != null ? settledByAt(beats, at) : null };
        }
        return runBeat(beat, token, state, info).then(function (r) {
          if (r === CANCELLED) return CANCELLED;
          return next();
        });
      }
      return next();
    }

    var api = {
      /**
       * Run a beat list. Starting a new run cancels the previous one first,
       * so two screens can never be live at once.
       */
      run: function (beats) {
        api.abort();
        var token = current = new Token();
        var state = { last: null, results: [] };
        lastWasSpeech = false;
        setState(STATES.ENTERING);
        emit('start', { count: beats.length });
        return runList(beats, token, state).then(function (r) {
          var mine = current === token;
          if (mine) current = null;
          emit('end', { cancelled: r === CANCELLED });
          if (r !== CANCELLED && mine) { setState(STATES.NEXT_STEP); emit('step:complete', {}); }
          return r === CANCELLED ? CANCELLED : state;
        });
      },

      /** Cancel whatever is running. Safe to call when nothing is. */
      abort: function () {
        if (current) { var t = current; current = null; t.cancel(); emit('abort', {}); }
        skipRequested = null;
        setState(STATES.IDLE);
      },

      /**
       * Fast-forward the current narration. Does nothing during an input
       * beat or feedback — those cannot be skipped.
       */
      skip: function () {
        if (skipRequested) { var r = skipRequested; skipRequested = null; r(); return true; }
        return false;
      },

      /* The two states only the game can see: a finger on the stage while an
         input is live, and the screen being left. Anything else is the
         beats' to say, so nothing else is accepted here. */
      mark: function (name) {
        if (name === STATES.USER_INTERACTING && (state === STATES.WAITING_FOR_USER)) setState(name);
        else if (name === STATES.WAITING_FOR_USER && state === STATES.USER_INTERACTING) setState(name);
        else if (name === STATES.EXITING) setState(name);
        return state;
      },

      /** Put one of the lesson's own events on the stream. */
      emit: function (name, payload) { emit(name, payload); return api; },

      get running() { return !!current; },
      get state() { return state; },

      on: function (name, fn) { (listeners[name] || (listeners[name] = [])).push(fn); return api; },
      off: function (name, fn) {
        var l = listeners[name]; if (!l) return api;
        var i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); return api;
      },

      configure: function (o) { for (var k in o) if (k in cfg) cfg[k] = o[k]; return cfg; }
    };
    return api;
  }

  global.Director = { create: create, CANCELLED: CANCELLED, STATES: STATES };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.Director;

})(typeof window !== 'undefined' ? window : this);
