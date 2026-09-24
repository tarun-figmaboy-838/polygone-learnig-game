/*!
 * test-swiftee.js — the sprite-sheet contract.
 *
 *   node tests/swiftee.test.js
 *
 * The Swiftee assets ship with one promise: any frame of any animation is
 * interchangeable with any other, because every frame is one cell of a
 * uniform grid with the pivot at the exact cell centre. Everything the game
 * does with the character rests on that, and on `swiftee-frames.js` being a
 * faithful, current derivation of `atlas/swiftee.manifest.json`.
 *
 * So this suite checks the things that would silently rot:
 *
 *   - the generated frame table still matches the manifest it came from
 *   - every grid can actually address every frame it claims
 *   - every sheet the table names exists on disk
 *   - every rig state the game asks for resolves to a real start/loop/stop
 *   - the game's sixteen semantic states all map to something that exists
 *   - no reaction is long enough to hit the director's beat ceiling
 *
 * A failure here means `node tools/build-swiftee-frames.js` needs re-running, or
 * the assets and the code have genuinely diverged.
 */
'use strict';

global.window = global;

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const F = require('../src/character/swiftee-frames.js');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/swiftee/swiftee.manifest.json'), 'utf8'));

let pass = 0, fail = 0;
const t = (label, cond, extra) => {
  if (cond) pass++;
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
};

/* ------------------------------------------------------------------ *
 * The generated table is the manifest
 * ------------------------------------------------------------------ */

t('the frame table carries the manifest fps', F.fps === MANIFEST.fps, [F.fps, MANIFEST.fps]);
t('the frame table carries both cell sizes',
  F.cell['1x'] === MANIFEST.cell['1x'] && F.cell['2x'] === MANIFEST.cell['2x'], F.cell);
t('the pivot is the exact cell centre', F.pivot.x === 0.5 && F.pivot.y === 0.5, F.pivot);
t('the baseline is the manifest baseline, not the cell edge',
  Math.abs(F.baselineY - MANIFEST.baselineY.normalized) < 1e-9 && F.baselineY < 1, F.baselineY);

t('every animation in the manifest is in the table',
  Object.keys(MANIFEST.animations).every((n) => !!F.clips[n]),
  Object.keys(MANIFEST.animations).filter((n) => !F.clips[n]));
t('the table invents no animations',
  Object.keys(F.clips).every((n) => !!MANIFEST.animations[n]),
  Object.keys(F.clips).filter((n) => !MANIFEST.animations[n]));

t('frame counts match the manifest exactly',
  Object.keys(F.clips).every((n) => F.clips[n].frames === MANIFEST.animations[n].frames),
  Object.keys(F.clips).filter((n) => F.clips[n].frames !== MANIFEST.animations[n].frames));

t('pingpong flags match the manifest',
  Object.keys(F.clips).every((n) => F.clips[n].pingpong === !!MANIFEST.animations[n].pingpong));

t('all 26 states are carried over', Object.keys(F.states).length === Object.keys(MANIFEST.states).length);
t('all 6 standalone clips are carried over', F.standalone.length === MANIFEST.standalone.length);

/* ------------------------------------------------------------------ *
 * Every grid can address every frame it claims
 * ------------------------------------------------------------------ */

{
  const bad = [];
  Object.keys(F.clips).forEach((name) => {
    const c = F.clips[name];
    ['1x', '2x'].forEach((scale) => {
      const pages = c.sheets[scale];
      if (!pages) return;                         // 2x may legitimately be absent
      let covered = 0;
      pages.forEach((p) => {
        if (p.frames > p.cols * p.rows) bad.push(name + '@' + scale + ': ' + p.frames + ' frames in a ' + p.cols + 'x' + p.rows + ' grid');
        covered += p.frames;
      });
      if (covered !== c.frames) bad.push(name + '@' + scale + ': pages cover ' + covered + ' of ' + c.frames + ' frames');
      // Pages must tile the frame range with no gap and no overlap.
      const sorted = pages.slice().sort((a, b) => a.first - b.first);
      let next = 0;
      sorted.forEach((p) => { if (p.first !== next) bad.push(name + '@' + scale + ': page starts at ' + p.first + ', expected ' + next); next = p.first + p.frames; });
    });
  });
  t('every grid can address every frame, across every page', bad.length === 0, bad.slice(0, 5));
}

{
  // The actual slicing the renderer does, for the first and last frame of
  // every clip at both scales. This is the arithmetic that puts a head where
  // a foot should be if a grid is ever wrong.
  const bad = [];
  Object.keys(F.clips).forEach((name) => {
    const c = F.clips[name];
    ['1x', '2x'].forEach((scale) => {
      const pages = c.sheets[scale];
      if (!pages) return;
      [0, c.frames - 1].forEach((frame) => {
        const page = pages.filter((p) => frame >= p.first && frame < p.first + p.frames)[0];
        if (!page) { bad.push(name + '@' + scale + ' frame ' + frame + ': no page'); return; }
        const local = frame - page.first;
        const col = local % page.cols, row = Math.floor(local / page.cols);
        if (col >= page.cols || row >= page.rows) bad.push(name + '@' + scale + ' frame ' + frame + ' -> ' + col + ',' + row + ' outside ' + page.cols + 'x' + page.rows);
      });
    });
  });
  t('the first and last frame of every clip land inside their grid', bad.length === 0, bad.slice(0, 5));
}

/* ------------------------------------------------------------------ *
 * Every sheet exists on disk
 * ------------------------------------------------------------------ */

{
  const missing = [];
  Object.keys(F.clips).forEach((name) => {
    const c = F.clips[name];
    ['1x', '2x'].forEach((scale) => {
      (c.sheets[scale] || []).forEach((p) => {
        if (!fs.existsSync(path.join(ROOT, F.base, p.image))) missing.push(p.image);
      });
    });
  });
  t('every sheet the table names is on disk', missing.length === 0, missing.slice(0, 5));
}

t('the asset base path is where index.html expects it',
  fs.existsSync(path.join(ROOT, F.base)), F.base);

/* ------------------------------------------------------------------ *
 * Every state resolves
 * ------------------------------------------------------------------ */

{
  const bad = [];
  Object.keys(F.states).forEach((state) => {
    const s = F.states[state];
    [s.start, s.loop, s.stop].forEach((clip) => {
      if (clip && !F.clips[clip]) bad.push(state + ' -> ' + clip);
    });
    if (!s.loop) bad.push(state + ': no loop clip');
  });
  t('every start/loop/stop in every state resolves to a real clip', bad.length === 0, bad);
}

t('the states without a stop clip are exactly the two documented ones',
  Object.keys(F.states).filter((k) => !F.states[k].stop).sort().join(',') === 'driving,sleeping',
  Object.keys(F.states).filter((k) => !F.states[k].stop));

t('the clips that leave the cell are flagged, not silently cropped',
  F.exitsCell.length > 0 && F.exitsCell.every((n) => !!F.clips[n]), F.exitsCell);

t('every standalone clip exists', F.standalone.every((n) => !!F.clips[n]),
  F.standalone.filter((n) => !F.clips[n]));
t('the escape hatches from the stop-less states exist',
  !!F.clips.wake && !!F.clips.drive_away && !!F.clips.reset);

/* ------------------------------------------------------------------ *
 * The game's own mapping
 * ------------------------------------------------------------------ */

// swiftee.js needs a DOM to mount, but its state table is readable without
// one: load it with a stub global and inspect what it exposes.
global.SwifteeFrames = F;
global.document = undefined;
const Swiftee = require('../src/character/swiftee.js');

const RIG = Swiftee.rig;
t('the game exposes its semantic state table', RIG && Object.keys(RIG).length >= 16, Object.keys(RIG || {}).length);

{
  const bad = [];
  Object.keys(RIG).forEach((name) => {
    const def = RIG[name];
    // a feeling with several faces is a list of states, each of which must be real
    if (def.variants) {
      def.variants.forEach((v) => { if (!RIG[v] || !RIG[v].rig) bad.push(name + ' variant -> ' + v); });
      if (def.recovered && !RIG[def.recovered]) bad.push(name + ' recovered -> ' + def.recovered);
      return;
    }
    const rig = def.rig;
    const isState = !!F.states[rig];
    const isClip = !!F.clips[rig];
    if (!isState && !isClip) bad.push(name + ' -> ' + rig);
    ['then', 'again', 'seated'].forEach((k) => { if (def[k] && !RIG[def[k]]) bad.push(name + ' ' + k + ' -> ' + def[k]); });
  });
  t('every semantic state maps to a real rig state or standalone clip', bad.length === 0, bad);
}

{
  // Every state screens.js can ask for must be in the mapping. This is the
  // check that catches a storyboard edit adding a reaction the art cannot do.
  require('../src/core/polygon-math.js');
  const Screens = require('../src/game/screens.js');
  const asked = new Set();
  Screens.list.forEach((s) => {
    (function walk(list) {
      (list || []).forEach((b) => {
        if (!b || typeof b !== 'object') return;
        if (b.swiftee) asked.add(b.swiftee);
        ['feedback', 'parallel', 'otherwise'].forEach((k) => { if (b[k]) walk(b[k]); });
        if (b.on) Object.keys(b.on).forEach((k) => walk(b.on[k]));
      });
    })(s.beats);
    Object.keys(s.perTap || {}).forEach((k) => (s.perTap[k] || []).forEach((b) => { if (b.swiftee) asked.add(b.swiftee); }));
  });
  const unmapped = [...asked].filter((a) => !RIG[a]);
  t('every Swiftee state the storyboard asks for is mapped to the art',
    unmapped.length === 0, unmapped);
  t('the storyboard exercises a real range of the rig', asked.size >= 14, asked.size);
}

{
  // A reaction that outruns the director's 12s beat ceiling would be cut off
  // mid-animation, and `celebrate` is awaited on every correct answer.
  const dur = (n) => {
    const c = F.clips[n];
    if (!c) return 0;
    return (c.pingpong ? c.frames * 2 - 2 : c.frames) / F.fps * 1000;
  };
  const slow = [];
  // a brief expression plays n loop frames there and back (swiftee.js briefOrder)
  const oneShot = (name) => {
    const def = RIG[name];
    if (!def || def.hold || !def.rig) return 0;
    const s = F.states[def.rig] || { loop: def.rig };
    const loop = def.brief ? (Math.min(def.brief, F.clips[s.loop].frames - 1) * 2 + 1) / F.fps * 1000
                           : dur(s.loop) * (def.loops == null ? 1 : def.loops);
    return (s.start ? dur(s.start) : 0) + loop + (s.stop ? dur(s.stop) : 0);
  };
  Object.keys(RIG).forEach((name) => {
    const def = RIG[name];
    if (def.hold || def.variants) return;          // held loops never finish by design
    // and a reaction's recovery (`then`) is part of it
    const total = oneShot(name) + (def.then ? oneShot(def.then) : 0);
    if (total > 12000) slow.push(name + ' ' + Math.round(total) + 'ms');
  });
  t('no one-shot reaction outruns the director beat ceiling', slow.length === 0, slow);

  /* THE THREE SIZES. A micro state barely moves; a response is a second or
     two, and so short enough not to stand between a child and the next try;
     a celebration may be longer, and is a milestone's. */
  const tooLong = [];
  Object.keys(RIG).forEach((name) => {
    const def = RIG[name];
    if (def.hold || def.variants || !def.level) return;
    const ms = oneShot(name);
    if (def.level === 2 && def.react && ms > 1800) tooLong.push(name + ' ' + Math.round(ms) + 'ms');
  });
  t('every answer reaction (level 2) is over in under 1.8s', tooLong.length === 0, tooLong);
  const miss = oneShot('oops');
  t('a miss is "hmm?" for about a second, not a sulk', miss > 400 && miss <= 1200, Math.round(miss) + 'ms');
  t('every state that answers a child has an intensity level',
    Object.keys(RIG).filter((n) => RIG[n].react && !RIG[n].level).length === 0,
    Object.keys(RIG).filter((n) => RIG[n].react && !RIG[n].level));
  t('the celebrations are level 3 and nothing smaller is',
    ['celebrate', 'excited', 'delight'].every((n) => RIG[n].level === 3) &&
    ['happySmall', 'nice', 'chuffed', 'wink', 'phew', 'oops', 'rethink', 'discover', 'nod'].every((n) => (RIG[n].level || 0) < 3));
  t('the watching state is level 1 and holds', RIG.watch.level === 1 && RIG.watch.hold === true);

  const s = F.states.celebrating;
  const celebrate = dur(s.start) + dur(s.loop) * RIG.celebrate.loops + dur(s.stop);
  t('celebrate stays short enough to gate every correct answer', celebrate <= 4000, Math.round(celebrate) + 'ms');
  t('the narration loop is short enough to track speech', dur('talking') <= 600, Math.round(dur('talking')) + 'ms');
}

/* EVERY RIG A STATE NAMES MUST EXIST.
 *
 * Two of them did not. `idle` pointed at 'blinking' and `exit`/`move` at
 * 'flapping', and neither is among the twenty-six the sheets carry — so the
 * state Swiftee spends most of the lesson in had no animation at all. It
 * threw nothing and logged nothing: he simply held whichever frame was last
 * painted, which looks like a character who has stopped moving rather than
 * like a bug. A name is cheap to check and impossible to notice.
 */
(function () {
  var src = require('fs').readFileSync(__dirname + '/../src/character/swiftee.js', 'utf8');
  var Frames = require('../src/character/swiftee-frames.js');
  // (this pattern read `rig:s*` and so matched nothing at all — a check that
  // could not fail. It reads the table's own `rig: 'name'` entries now, and a
  // standalone clip such as 'blinking' or 'flapping' is a real rig too.)
  var named = (src.match(/rig:\s*'[a-z_-]+'/g) || []).map(function (x) { return x.split('\x27')[1]; });
  var uniq = named.filter(function (v, i) { return named.indexOf(v) === i; });
  var missing = uniq.filter(function (r) { return !Frames.states[r] && !Frames.clips[r]; });
  t('every rig a state names exists in the sheet set', uniq.length >= 20 && missing.length === 0, missing.join(', ') || uniq.length);
})();

/* ------------------------------------------------------------------ *
 * Character direction: intentions, variety, the generated table
 * ------------------------------------------------------------------ */

{
  // THE FRAME TABLE IS GENERATED AND NEVER EDITED BY HAND. The generator's
  // --check rebuilds it in memory and compares; a patched coordinate fails.
  const out = require('child_process').spawnSync(process.execPath, [path.join(ROOT, 'tools/build-swiftee-frames.js'), '--check'], { encoding: 'utf8' });
  t('swiftee-frames.js is exactly what the manifest generates (no hand edits)', out.status === 0, (out.stderr || out.stdout || '').trim());
}

{
  // EVERY INTENTION THE STORYBOARD ASKS FOR, ON EVERY SCREEN THAT ASKS FOR
  // IT, IN EVERY CONTEXT (first try, after a miss, a second miss), becomes a
  // state with a drawing — and the same one every time (no Math.random).
  const Screens = require('../src/game/screens.js');
  const bad = [], unstable = [];
  Screens.list.forEach((s) => {
    const asked = [];
    (function walk(list) {
      (list || []).forEach((b) => {
        if (!b || typeof b !== 'object') return;
        if (b.swiftee) asked.push(b.swiftee);
        ['feedback', 'parallel', 'otherwise'].forEach((k) => { if (b[k]) walk(b[k]); });
        if (b.on) Object.keys(b.on).forEach((k) => walk(b.on[k]));
      });
    })(s.beats);
    Object.keys(s.perTap || {}).forEach((k) => (s.perTap[k] || []).forEach((b) => { if (b.swiftee) asked.push(b.swiftee); }));
    asked.filter((a) => !/^(enter|exit|move)$/.test(a)).forEach((a) => {
      [{ key: s.id }, { key: s.id, misses: 1, after: 'miss' }, { key: s.id, misses: 2, after: 'miss' }].forEach((ctx) => {
        const st = Swiftee.resolve(a, ctx);
        const def = RIG[st];
        if (!def || !def.rig || !(F.states[def.rig] || F.clips[def.rig])) bad.push(s.id + ':' + a + '->' + st);
        if (Swiftee.resolve(a, ctx) !== st) unstable.push(s.id + ':' + a);
      });
    });
  });
  t('every storyboard intention resolves to a drawn state in every context', bad.length === 0, bad);
  t('the same screen always gets the same face (deterministic variety)', unstable.length === 0, unstable);
  const faces = new Set(['which-polygons', 'drag-to-diagonal', 'another-diagonal', 'inside-or-outside', 'drag-inward', 'stayed-changed', 'build-sides', 'build-concave']
    .map((k) => Swiftee.resolve('happySmall', { key: k })));
  t('an ordinary right answer is not the same face on every screen', faces.size >= 2, [...faces]);
  t('a right answer after a miss is relief', Swiftee.resolve('happySmall', { key: 'x', after: 'miss' }) === 'phew');
  t('the second miss on one question is his thinking face', Swiftee.resolve('oops', { key: 'x', misses: 2 }) === 'rethink' && Swiftee.resolve('oops', { key: 'x', misses: 1 }) === 'oops');
  // THE RIG, WIDER: drawings the lesson had never played are used where they belong
  const used = new Set();
  Screens.list.forEach((s) => (function walk(list) {
    (list || []).forEach((b) => {
      if (!b || typeof b !== 'object') return;
      if (b.swiftee && RIG[b.swiftee]) {
        const d = RIG[b.swiftee];
        (d.variants || [b.swiftee]).forEach((v) => { if (RIG[v] && RIG[v].rig) used.add(RIG[v].rig); });
        if (d.then && RIG[d.then]) used.add(RIG[d.then].rig);
        if (d.recovered && RIG[d.recovered]) used.add(RIG[d.recovered].rig);
      }
      ['feedback', 'parallel', 'otherwise'].forEach((k) => { if (b[k]) walk(b[k]); });
      if (b.on) Object.keys(b.on).forEach((k) => walk(b.on[k]));
    });
  })(s.beats));
  const fresh = ['reading', 'writing', 'learning', 'puzzleing', 'love', 'relieved', 'blinking'].filter((r) => !used.has(r));
  t('the storyboard reaches the rig\'s unused drawings where they fit', fresh.length <= 1, fresh);   // blinking is reached by the game (watch), not a beat
}

/* ------------------------------------------------------------------ *
 * Behaviour, in a DOM: priority, the measuring lock, cancellation
 * ------------------------------------------------------------------ */

(async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
  const w = dom.window;
  global.document = w.document;
  global.Image = w.Image;
  global.requestAnimationFrame = w.requestAnimationFrame.bind(w);
  global.cancelAnimationFrame = w.cancelAnimationFrame.bind(w);
  global.matchMedia = () => ({ matches: false });
  global.getComputedStyle = w.getComputedStyle.bind(w);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let air = false;
  Swiftee.mount(w.document.getElementById('root'), { layout: () => ({ x: 100, y: 300, scale: 1, air: air }) });
  Swiftee.place('left', 'medium');
  await sleep(50);

  // 1 THE MEASURING WALK OWNS HIM: nothing generic touches him while it runs
  Swiftee.lock('measuring');
  const before = Swiftee.state;
  const op = Swiftee.el.style.opacity;
  const r1 = await Swiftee.play('celebrate');
  t('a storyboard face asked for during the measuring walk waits for it', r1 && r1.deferred === 'measuring' && Swiftee.state === before, [r1, Swiftee.state]);
  const r2 = await Swiftee.perform('hint');
  t('an idle hint cannot interrupt the measuring walk', r2 && r2.refused === 'locked', r2);
  const r3 = await Swiftee.perform('watch');
  t('not even watching the child interrupts the measuring walk', r3 && r3.refused === 'locked', r3);
  Swiftee.visible(op === '1' ? false : true);
  t('he is not shown or hidden by anyone else while the walk has him', Swiftee.el.style.opacity === op, [op, Swiftee.el.style.opacity]);
  Swiftee.unlock('measuring');
  await sleep(30);
  t('when the walk lets go, the last thing asked for plays', Swiftee.state === 'celebrate', Swiftee.state);

  // 2 PRIORITY: a hint never cuts off a reaction; the child's hand does
  const r4 = await Swiftee.perform('hint');
  t('a hint does not interrupt a reaction that is still playing', r4 && r4.refused === 'busy', [r4, Swiftee.busy]);
  Swiftee.attend(true);
  await sleep(30);
  t('the child starting to drag gets his watching face at once', Swiftee.state === 'watch' && Swiftee.stanceName === 'watch', [Swiftee.state, Swiftee.stanceName]);
  Swiftee.attend(false);
  t('the verdict ends the watching stance', Swiftee.stanceName === null);

  // 3 A SCREEN CHANGE: the reaction from the screen before does not carry on
  Swiftee.play('happySmall', { key: 'which-polygons' });
  await sleep(30);
  const was = Swiftee.state;
  Swiftee.settle();
  await sleep(30);
  t('a reaction is replaced by rest when the screen changes', /^(nice|chuffed|wink)$/.test(was) && Swiftee.state === 'idle' && Swiftee.busy === null, [was, Swiftee.state, Swiftee.busy]);
  Swiftee.play('celebrate'); await sleep(20);
  Swiftee.settle({ now: true }); await sleep(20);
  t('a jump drops a celebration at once', Swiftee.state === 'idle', Swiftee.state);

  // 4 A MISS RECOVERS BY ITSELF: oops -> encourage -> the stance
  Swiftee.stance('think');
  const t0 = Date.now();
  await Swiftee.play('oops', { key: 'inside-or-outside', misses: 1 });
  t('a miss recovers into encouragement and back to the question pose', Swiftee.state === 'think', Swiftee.state);
  t('...without holding anyone up for long', Date.now() - t0 < 6000, (Date.now() - t0) + 'ms');
  Swiftee.stance(null);

  // 5 IN THE AIR a prop pose becomes its standing twin
  air = true; Swiftee.place('top-left', 'small');
  t('no sitting with a book in mid-air', Swiftee.resolve('recall', {}) === 'think' && Swiftee.resolve('build', {}) === 'point');
  air = false; Swiftee.place('left', 'medium');
  t('on the ground the prop pose is his', Swiftee.resolve('recall', {}) === 'recall');

  console.log('\nswiftee: ' + pass + ' passed, ' + fail + ' failed');
  dom.window.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
