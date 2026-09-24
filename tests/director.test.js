/*!
 * test-director.js — the three properties the director promises.
 *
 *   node tests/director.test.js
 *
 * CANCELLABLE  changing screen aborts the running sequence and everything
 *              inside it. Nothing from screen 6 fires during screen 7.
 * NEVER STUCK  a handler that hangs, throws, or never resolves falls
 *              through to the next beat under a ceiling.
 * SKIP-SAFE    a tap fast-forwards narration; it never skips an input or
 *              feedback, and a reading-time floor survives rapid tapping.
 *
 * These are asserted, not described, because each one is a bug this codebase
 * has actually shipped before: the stale coroutine across scenes, the VO that
 * never loads, and the child who taps through the lesson.
 */
'use strict';

global.window = global;
const Director = require('../src/core/director.js');

let pass = 0, fail = 0;
const t = (label, cond, extra) => {
  if (cond) pass++;
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A recording handler set. Every call appends to `log`. */
function rig(overrides) {
  const log = [];
  const base = {
    stage: (s) => { log.push('stage:' + (s && s.kind || 'op')); },
    swiftee: (s) => { log.push('swiftee:' + s); },
    say: (text) => { log.push('say:' + text); },
    instruction: (text) => { log.push('instruction:' + text); },
    focus: (target) => { log.push('focus:' + target); },
    input: () => { log.push('input'); return Promise.resolve({ result: 'correct' }); },
    sfx: (n) => { log.push('sfx:' + n); },
    juice: (n) => { log.push('juice:' + n); }
  };
  return { log, handlers: Object.assign(base, overrides || {}) };
}

(async () => {

  /* -------------------------------------------------------------- *
   * Ordering — every beat awaited, nothing starts early
   * -------------------------------------------------------------- */

  {
    const { log, handlers } = rig({
      swiftee: (s) => { log.push('swiftee:' + s + ':start'); return sleep(60).then(() => log.push('swiftee:' + s + ':end')); }
    });
    const d = Director.create(handlers, { sayMinMs: 10, msPerWord: 1 });
    await d.run([
      { swiftee: 'enter', from: 'left' },
      { say: 'one' },
      { instruction: 'do it' },
      { input: { type: 'tap-anywhere' } },
      { sfx: 'correct' }
    ]);
    t('an awaited state finishes before the next beat starts',
      log.indexOf('swiftee:enter:end') < log.indexOf('say:one'), log);
    t('beats run in the order they are written',
      log.join('|').indexOf('say:one') < log.join('|').indexOf('instruction:do it'), log);
    t('input runs before the cue that follows it',
      log.indexOf('input') < log.indexOf('sfx:correct'), log);
  }

  {
    // A fire-and-forget reaction must NOT delay the lesson.
    const { log, handlers } = rig({
      swiftee: (s) => { log.push('swiftee:' + s); return sleep(400).then(() => log.push('swiftee:' + s + ':end')); }
    });
    const d = Director.create(handlers, { sayMinMs: 10, msPerWord: 1 });
    await d.run([{ swiftee: 'wave' }, { say: 'hi' }]);
    t('a non-transitional reaction does not block the next beat',
      log.indexOf('say:hi') < (log.indexOf('swiftee:wave:end') < 0 ? Infinity : log.indexOf('swiftee:wave:end')), log);
  }

  {
    const { log, handlers } = rig({
      swiftee: (s) => { log.push('swiftee:' + s); return sleep(80).then(() => log.push('swiftee:' + s + ':end')); }
    });
    const d = Director.create(handlers, { sayMinMs: 10, msPerWord: 1 });
    await d.run([{ swiftee: 'wave', await: true }, { say: 'hi' }]);
    t('await:true makes any state blocking',
      log.indexOf('swiftee:wave:end') < log.indexOf('say:hi'), log);
  }

  /* -------------------------------------------------------------- *
   * Cancellation — the stale-coroutine bug, closed structurally
   * -------------------------------------------------------------- */

  {
    const { log, handlers } = rig();
    const d = Director.create(handlers, { sayMinMs: 10, msPerWord: 1 });
    const first = d.run([{ wait: 400 }, { say: 'SHOULD NOT HAPPEN' }, { sfx: 'ghost' }]);
    await sleep(40);
    d.abort();
    const r = await first;
    await sleep(500);
    t('an aborted run reports CANCELLED', r === Director.CANCELLED, r);
    t('nothing after the abort point runs', log.indexOf('say:SHOULD NOT HAPPEN') < 0, log);
    t('timers inside an aborted run are cleared', log.indexOf('sfx:ghost') < 0, log);
  }

  {
    const { log, handlers } = rig();
    const d = Director.create(handlers, { sayMinMs: 10, msPerWord: 1 });
    const screen6 = d.run([{ wait: 300 }, { say: 'screen 6 line' }]);
    await sleep(30);
    const screen7 = d.run([{ say: 'screen 7 line' }]);
    await Promise.all([screen6, screen7]);
    await sleep(400);
    t('starting a new run cancels the previous one', log.indexOf('say:screen 6 line') < 0, log);
    t('the new run still plays', log.indexOf('say:screen 7 line') >= 0, log);
  }

  {
    // Handlers get a ctx and must be told when the screen goes away.
    let cancelled = false;
    const d = Director.create({
      say: (text, opts, ctx) => { ctx.onCancel(() => { cancelled = true; }); return new Promise(() => {}); }
    }, { sayMinMs: 10, msPerWord: 1, beatCeilingMs: 5000 });
    const run = d.run([{ say: 'a line with a VO that never ends' }]);
    await sleep(50);
    d.abort();
    await run;
    t('a handler is notified through ctx.onCancel', cancelled);
  }

  {
    // Cancelling during an input must release the child, not hang.
    const d = Director.create({ input: () => new Promise(() => {}) }, { sayMinMs: 10 });
    const run = d.run([{ input: { type: 'tap-anywhere' } }, { say: 'after' }]);
    await sleep(40);
    d.abort();
    const r = await Promise.race([run, sleep(1000).then(() => 'HUNG')]);
    t('aborting during an input resolves the run', r !== 'HUNG', r);
  }

  /* -------------------------------------------------------------- *
   * Never stuck — section 14
   * -------------------------------------------------------------- */

  {
    const { log, handlers } = rig({ swiftee: () => new Promise(() => {}) });   // never resolves
    const d = Director.create(handlers, { sayMinMs: 10, msPerWord: 1, beatCeilingMs: 250 });
    const t0 = Date.now();
    await d.run([{ swiftee: 'celebrate' }, { say: 'next' }]);
    t('an animation whose promise never resolves hits the ceiling and moves on',
      log.indexOf('say:next') >= 0 && Date.now() - t0 < 1500, { log, ms: Date.now() - t0 });
  }

  {
    const { log, handlers } = rig({ say: () => { throw new Error('vo blew up'); } });
    const d = Director.create(handlers, { sayMinMs: 10, msPerWord: 1, beatCeilingMs: 300 });
    await d.run([{ say: 'a line' }, { sfx: 'after' }]);
    t('a handler that throws does not take the sequence down', log.indexOf('sfx:after') >= 0, log);
  }

  {
    const { log, handlers } = rig({ say: () => Promise.reject(new Error('clip 404')) });
    const d = Director.create(handlers, { sayMinMs: 10, msPerWord: 1 });
    await d.run([{ say: 'a line' }, { sfx: 'after' }]);
    t('a rejected VO promise falls through to the next beat', log.indexOf('sfx:after') >= 0, log);
  }

  {
    const { log, handlers } = rig();
    const d = Director.create(handlers, { sayMinMs: 10 });
    await d.run([{ swiftee: 'no-such-state' }, { sfx: 'after' }]);
    t('an unknown beat key is skipped rather than fatal', log.indexOf('sfx:after') >= 0, log);
  }

  {
    // A missing handler must be a no-op, not a crash.
    const d = Director.create({}, { sayMinMs: 10, msPerWord: 1 });
    const r = await d.run([{ say: 'nobody is listening' }, { input: { type: 'tap-anywhere' } }]);
    t('a director with no handlers at all still completes', r !== Director.CANCELLED);
  }

  /* -------------------------------------------------------------- *
   * Skip safety — children tap constantly
   * -------------------------------------------------------------- */

  {
    const { log, handlers } = rig({ say: () => sleep(3000) });
    const d = Director.create(handlers, { sayMinMs: 100, msPerWord: 400 });
    const t0 = Date.now();
    const run = d.run([{ say: 'a fairly long line of narration here' }, { sfx: 'after' }]);
    await sleep(150);
    const skipped = d.skip();
    await run;
    const ms = Date.now() - t0;
    t('skip() reports that it fast-forwarded something', skipped === true);
    t('a tap fast-forwards narration', ms < 1200, ms);
    t('the beat after the skipped line still runs', log.indexOf('sfx:after') >= 0, log);
  }

  {
    const { handlers } = rig({ say: () => Promise.resolve() });
    const d = Director.create(handlers, { sayMinMs: 400, msPerWord: 400 });
    const t0 = Date.now();
    const run = d.run([{ say: 'short line' }]);
    for (let i = 0; i < 6; i++) { d.skip(); await sleep(5); }     // hyper-tapping child
    await run;
    t('the reading-time floor survives rapid tapping', Date.now() - t0 >= 380, Date.now() - t0);
  }

  {
    const { log, handlers } = rig({ input: () => sleep(250).then(() => ({ result: 'correct' })) });
    const d = Director.create(handlers, { sayMinMs: 10 });
    const run = d.run([{ input: { type: 'vertex-pick' } }, { sfx: 'graded' }]);
    await sleep(30);
    const skipped = d.skip();
    await run;
    t('skip() does nothing during an input beat', skipped === false);
    t('the input still has to be answered', log.indexOf('sfx:graded') >= 0, log);
  }

  {
    const { log, handlers } = rig({ input: () => Promise.resolve({ result: 'wrong' }) });
    const d = Director.create(handlers, { sayMinMs: 10, feedbackSettleMs: 120 });
    const run = d.run([
      { input: { type: 'choice' } },
      { branch: true, on: { wrong: [{ feedback: [{ sfx: 'wrong' }] }] } }
    ]);
    await sleep(10);
    d.skip();
    await run;
    t('feedback cannot be skipped', log.indexOf('sfx:wrong') >= 0, log);
  }

  /* -------------------------------------------------------------- *
   * Branching and composition
   * -------------------------------------------------------------- */

  {
    const { log, handlers } = rig({ input: () => Promise.resolve({ result: 'wrong' }) });
    const d = Director.create(handlers, { sayMinMs: 10, feedbackSettleMs: 10 });
    await d.run([
      { input: { type: 'choice' } },
      { branch: true, on: { correct: [{ sfx: 'correct' }], wrong: [{ sfx: 'wrong' }] } }
    ]);
    t('branch follows the wrong path when the answer is wrong',
      log.indexOf('sfx:wrong') >= 0 && log.indexOf('sfx:correct') < 0, log);
  }

  {
    const { log, handlers } = rig({ input: () => Promise.resolve({ result: 'correct' }) });
    const d = Director.create(handlers, { sayMinMs: 10, feedbackSettleMs: 10 });
    await d.run([
      { input: { type: 'choice' } },
      { branch: true, on: { correct: [{ sfx: 'correct' }], wrong: [{ sfx: 'wrong' }] } }
    ]);
    t('branch follows the correct path when the answer is right',
      log.indexOf('sfx:correct') >= 0 && log.indexOf('sfx:wrong') < 0, log);
  }

  {
    const { log, handlers } = rig({ input: () => Promise.resolve({ result: 'partial' }) });
    const d = Director.create(handlers, { sayMinMs: 10 });
    await d.run([
      { input: { type: 'choice' } },
      { branch: true, on: { correct: [{ sfx: 'correct' }] }, otherwise: [{ sfx: 'fallback' }] }
    ]);
    t('an unmatched result takes the otherwise path', log.indexOf('sfx:fallback') >= 0, log);
  }

  /* A RETRY IS BRANCHED ON TOO. `until: 'correct'`: wrong, wrong, right —
     the nudge plays twice, the right arm plays once, after the last try, and
     nothing after the branch runs until then. */
  {
    const answers = ['wrong', 'wrong', 'correct'];
    const { log, handlers } = rig({ input: () => { log.push('input'); return Promise.resolve({ result: answers.shift() || 'correct' }); } });
    const d = Director.create(handlers, { sayMinMs: 10, feedbackSettleMs: 10 });
    await d.run([
      { input: { type: 'choice' } },
      { branch: true, until: 'correct',
        on: { correct: [{ sfx: 'praise' }, { say: 'All diagonals are still inside.' }] },
        otherwise: [{ sfx: 'nudge' }, { input: { type: 'choice', retry: true } }] },
      { sfx: 'after' }
    ]);
    t('a wrong retry is branched on again, not waved through', log.filter((x) => x === 'sfx:nudge').length === 2, log);
    t('a right retry runs the right arm', log.filter((x) => x === 'sfx:praise').length === 1 && log.indexOf('say:All diagonals are still inside.') >= 0, log);
    t('nothing after the branch runs until the answer is right', log.indexOf('sfx:after') > log.indexOf('sfx:praise'), log);
    t('the child was asked three times', log.filter((x) => x === 'input').length === 3, log);
  }
  {
    const { log, handlers } = rig({ input: () => Promise.resolve({ result: 'wrong' }) });
    const d = Director.create(handlers, { sayMinMs: 10, feedbackSettleMs: 10 });
    const r = await Promise.race([
      d.run([{ input: { type: 'choice' } }, { branch: true, until: 'correct', otherwise: [{ sfx: 'nudge' }] }, { sfx: 'after' }]),
      sleep(1500).then(() => 'HUNG')
    ]);
    t('an arm that asks nothing again cannot loop', r !== 'HUNG' && log.filter((x) => x === 'sfx:nudge').length === 1, log);
  }

  {
    const { log, handlers } = rig();
    const d = Director.create(handlers, { sayMinMs: 10, msPerWord: 1 });
    await d.run([{ parallel: [{ sfx: 'a' }, { sfx: 'b' }, { juice: 'pop' }] }]);
    t('a parallel beat runs everything in it', log.length === 3, log);
  }

  {
    const { log, handlers } = rig();
    const d = Director.create(handlers, { sayMinMs: 10 });
    const t0 = Date.now();
    await d.run([{ feedback: [{ sfx: 'correct' }] }, { sfx: 'next' }]);
    t('feedback holds for the settle before the next beat', Date.now() - t0 >= 450, Date.now() - t0);
    t('feedback runs its contents', log.indexOf('sfx:correct') >= 0 && log.indexOf('sfx:next') >= 0, log);
  }

  {
    const { log, handlers } = rig();
    const d = Director.create(handlers, { sayMinMs: 10 });
    let got = null;
    await d.run([
      { input: { type: 'vertex-pick' } },
      (state) => { got = state.last; }
    ]);
    t('a function beat receives the last input result', got && got.result === 'correct', got);
  }

  {
    const { log, handlers } = rig();
    const d = Director.create(handlers, { sayMinMs: 10 });
    const t0 = Date.now();
    await d.run([220]);
    t('a bare number is a wait', Date.now() - t0 >= 200, Date.now() - t0);
    void log;
  }

  /* -------------------------------------------------------------- *
   * Events
   * -------------------------------------------------------------- */

  {
    const { handlers } = rig();
    const d = Director.create(handlers, { sayMinMs: 10, msPerWord: 1 });
    const seen = [];
    d.on('start', () => seen.push('start'));
    d.on('beat', () => seen.push('beat'));
    d.on('end', (p) => seen.push('end:' + p.cancelled));
    await d.run([{ sfx: 'a' }, { sfx: 'b' }]);
    t('start, beat and end are emitted', seen[0] === 'start' && seen.indexOf('end:false') === seen.length - 1, seen);
    t('one beat event per beat', seen.filter((s) => s === 'beat').length === 2, seen);
  }

  {
    const d = Director.create({}, {});
    t('configure only accepts known keys', (() => {
      const cfg = d.configure({ sayMinMs: 77, nonsense: 1 });
      return cfg.sayMinMs === 77 && !('nonsense' in cfg);
    })());
  }

  {
    const d = Director.create({ input: () => new Promise(() => {}) }, {});
    t('running is false before a run', !d.running);
    const run = d.run([{ input: {} }]);
    await sleep(20);
    t('running is true during a run', d.running);
    d.abort();
    await run;
    t('abort is safe to call when nothing is running', (d.abort(), true));
  }

  console.log('\ndirector: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
