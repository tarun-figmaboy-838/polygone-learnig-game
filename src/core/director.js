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
 * Every handler receives `ctx` with `ctx.signal.cancelled` and
 * `ctx.onCancel(fn)`, so it can stop a VO or an animation when the screen
 * changes. Handlers that ignore ctx still work; they just cannot be
 * interrupted mid-effect.
 */
(function (global) {
  'use strict';

  var DEFAULTS = {
    // Reading-time fallback for `say` when there is no VO or it fails:
    // roughly the pace a child needs to read along, plus a settle.
    msPerWord: 280,
    sayMinMs: 900,
    sayMaxMs: 9000,
    // Absolute ceiling on any single non-input beat. If an animation's
    // promise never resolves, this is what saves the game.
    beatCeilingMs: 12000,
    // A brief hold after feedback so it registers before anything moves.
    feedbackSettleMs: 500
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

    function emit(name, payload) {
      var list = listeners[name] || [];
      for (var i = 0; i < list.length; i++) { try { list[i](payload); } catch (e) {} }
    }

    function ctxFor(token) {
      return {
        signal: token,
        onCancel: function (fn) { token.onCancel(fn); },
        cfg: cfg
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
     * Narration. Shows text, plays VO if present, and holds for whichever is
     * longer: the VO, or reading time. Skippable: a skip() finishes the hold
     * but leaves the text on screen. Never shorter than sayMinMs, so a
     * hyper-tapping child cannot blow through the lesson.
     */
    function beatSay(beat, token) {
      var text = beat.say;
      var reading = Math.min(cfg.sayMaxMs, Math.max(cfg.sayMinMs, words(text) * cfg.msPerWord + 400));
      var ctx = ctxFor(token);
      var started = Date.now();

      emit('say', { text: text, vo: beat.vo });
      var voDone = guard(call('say', [text, { vo: beat.vo, reading: reading }, ctx]), token, cfg.beatCeilingMs);

      // Reading-time floor runs in parallel with VO; we wait for both, but a
      // skip short-circuits the remainder past the minimum.
      var floor = sleep(reading, token);
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

    function beatInstruction(beat, token) {
      emit('instruction', { text: beat.instruction });
      return guard(call('instruction', [beat.instruction, beat, ctxFor(token)]), token, cfg.beatCeilingMs);
    }

    function beatSwiftee(beat, token) {
      emit('swiftee', { state: beat.swiftee, opts: beat });
      var p = call('swiftee', [beat.swiftee, beat, ctxFor(token)]);
      // Some states are fire-and-forget (idle, look-at); only await if the
      // beat asks for it or the state is inherently transitional.
      var transitional = /^(enter|exit|move|celebrate|hop)$/.test(beat.swiftee);
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
    function beatInput(beat, token) {
      emit('input', { spec: beat.input });
      return new Promise(function (resolve) {
        if (token.cancelled) return resolve(CANCELLED);
        token.onCancel(function () { resolve(CANCELLED); });
        call('input', [beat.input, ctxFor(token)]).then(resolve, function (err) {
          if (global.console) console.warn('Director: input handler failed —', err && err.message || err);
          resolve({ failed: true });
        });
      });
    }

    /**
     * Branch on the last input result. `beat.on` maps result keys to beat
     * lists; `otherwise` is the fallback. The chosen list runs inline, so
     * feedback is part of the sequence rather than a side effect.
     */
    function beatBranch(beat, token, state) {
      var key = state.last && state.last.result != null ? String(state.last.result) : 'otherwise';
      var list = beat.on && beat.on[key] || beat.otherwise || [];
      return runList(list, token, state);
    }

    /* --- the loop --------------------------------------------------- */

    function runBeat(beat, token, state) {
      if (token.cancelled) return Promise.resolve(CANCELLED);
      if (typeof beat === 'number') return sleep(beat, token);
      if (typeof beat === 'function') {
        return guard(beat(state, ctxFor(token)), token, cfg.beatCeilingMs);
      }
      if (beat.stage != null)       return beatStage(beat, token);
      if (beat.wait != null)        return beatWait(beat, token);
      if (beat.say != null)         return beatSay(beat, token);
      if (beat.instruction != null) return beatInstruction(beat, token);
      if (beat.swiftee != null)     return beatSwiftee(beat, token);
      if (beat.focus != null)       return beatFocus(beat, token);
      if (beat.sfx != null)         return beatSfx(beat);
      if (beat.juice != null)       return beatJuice(beat);
      if (beat.input != null) {
        return beatInput(beat, token).then(function (r) { state.last = r; return r; });
      }
      if (beat.branch != null)      return beatBranch(beat, token, state);
      if (beat.parallel != null) {
        return Promise.all(beat.parallel.map(function (b) { return runBeat(b, token, state); }));
      }
      if (beat.feedback != null) {
        // Sugar: a feedback beat is a list followed by the settle hold.
        return runList(beat.feedback, token, state).then(function () {
          return sleep(cfg.feedbackSettleMs, token);
        });
      }
      return Promise.resolve();
    }

    function runList(beats, token, state) {
      var i = 0;
      function next() {
        if (token.cancelled) return Promise.resolve(CANCELLED);
        if (i >= beats.length) return Promise.resolve(state);
        var beat = beats[i++];
        emit('beat', { index: i - 1, beat: beat });
        return runBeat(beat, token, state).then(function (r) {
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
        emit('start', { count: beats.length });
        return runList(beats, token, state).then(function (r) {
          if (current === token) current = null;
          emit('end', { cancelled: r === CANCELLED });
          return r === CANCELLED ? CANCELLED : state;
        });
      },

      /** Cancel whatever is running. Safe to call when nothing is. */
      abort: function () {
        if (current) { var t = current; current = null; t.cancel(); emit('abort', {}); }
        skipRequested = null;
      },

      /**
       * Fast-forward the current narration. Does nothing during an input
       * beat or feedback — those cannot be skipped.
       */
      skip: function () {
        if (skipRequested) { var r = skipRequested; skipRequested = null; r(); return true; }
        return false;
      },

      get running() { return !!current; },
      get skippable() { return !!skipRequested; },

      on: function (name, fn) { (listeners[name] || (listeners[name] = [])).push(fn); return api; },
      off: function (name, fn) {
        var l = listeners[name]; if (!l) return api;
        var i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); return api;
      },

      configure: function (o) { for (var k in o) if (k in cfg) cfg[k] = o[k]; return cfg; },
      CANCELLED: CANCELLED
    };
    return api;
  }

  global.Director = { create: create, CANCELLED: CANCELLED, DEFAULTS: DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.Director;

})(typeof window !== 'undefined' ? window : this);
