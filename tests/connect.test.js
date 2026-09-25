/*!
 * connect.test.js — the pick → connect step, from every corner.
 *
 *   node tests/connect.test.js
 *
 * Plays the lesson in jsdom up to the pentagon, picks corner k, and then does
 * what a child exploring would: joins it to one neighbour (a side), to the
 * other (a side again — for k = 0 and k = 4 that is the wrap-around), lets go
 * on no corner, tries to draw while he is still talking, taps his bubble
 * while the line is being spoken, and finally joins a corner that is not a
 * neighbour (the diagonal). For every k it checks:
 *
 *   - any corner can be picked, and only that corner's knob is left showing
 *     until the connecting starts — then the other corners come back as
 *     points to connect to (the user's call: "why points not added")
 *   - both neighbours are sides, by vertex order, wrapping at 0 and n-1
 *   - a side is never a wrong answer: no wrong cue, no "oops", no miss
 *   - the starting corner never changes, and the side is cleared between tries
 *   - a line let go on nothing gives no verdict and no answer away
 *   - nothing can be drawn while feedback is on (the stage state machine)
 *   - the lines come in the spec's order, each heard out:
 *       Select any vertex. / Let’s connect it to another vertex. /
 *       This is a side of the polygon. / Let’s connect it to a different vertex. /
 *       (again) / Yay! You made a diagonal!
 *   - one voice at a time, none cut off, no stock "Nice!" over the cheer
 *   - the diagonal glows only once it is made, and it stays
 *
 * The voice is a stub with real durations (VO has no clips on disk yet), so
 * the pacing below is the pacing the recordings will get.
 */
'use strict';
const { JSDOM } = require('jsdom'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<link[^>]+fonts[^>]*>/g, '');
const SCRIPTS = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const CLIP_MS = 700;

let pass = 0, fail = 0;
const t = (label, cond, extra) => {
  if (cond) pass++;
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
};

function world() {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const w = dom.window, d = w.document;
  const anim = () => ({ finished: Promise.resolve(), cancel() {}, playbackRate: 1, effect: { getKeyframes: () => [{ composite: 'add' }] } });
  w.Element.prototype.animate = function () { return anim(); };
  w.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 100, height: 100 });
  w.SVGSVGElement.prototype.createSVGPoint = function () { return { x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }; };
  w.SVGSVGElement.prototype.getScreenCTM = () => ({ inverse: () => ({}) });
  w.Element.prototype.setPointerCapture = () => {};
  w.Element.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, width: 1000, height: 562, right: 1000, bottom: 562 }; };
  w.HTMLElement.prototype.getBoundingClientRect = w.Element.prototype.getBoundingClientRect;
  w.ResizeObserver = class { observe() {} }; w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.requestAnimationFrame = (fn) => setTimeout(() => fn(w.performance.now()), 16);
  w.cancelAnimationFrame = (id) => clearTimeout(id);
  w.speechSynthesis = { getVoices: () => [], speak(u) { setTimeout(() => u.onend && u.onend(), 15); }, cancel() {} };
  w.SpeechSynthesisUtterance = function (x) { this.text = x; };
  const p = () => ({ value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }); const node = () => ({ connect() {}, disconnect() {} });
  w.AudioContext = class { constructor() { this.currentTime = 0; this.sampleRate = 44100; this.state = 'running'; this.destination = node(); } resume() {} createGain() { return Object.assign(node(), { gain: p() }); } createOscillator() { return Object.assign(node(), { type: '', frequency: p(), start() {}, stop() {} }); } createBufferSource() { return Object.assign(node(), { buffer: null, playbackRate: p(), start() {}, stop() {}, loop: false }); } createBiquadFilter() { return Object.assign(node(), { type: '', frequency: p(), Q: p() }); } createAnalyser() { return Object.assign(node(), { fftSize: 0, smoothingTimeConstant: 0 }); } createWaveShaper() { return Object.assign(node(), { curve: null, oversample: '' }); } createBuffer(c, l) { const a = new Float32Array(l); return { getChannelData: () => a }; } };
  w.fetch = () => Promise.reject(new Error('offline')); w.PointerEvent = w.MouseEvent;
  w.HTMLCanvasElement.prototype.getContext = () => ({ setTransform() {}, clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, beginPath() {}, arc() {}, fill() {}, fillRect() {}, fillText() {}, moveTo() {}, lineTo() {}, closePath() {}, globalAlpha: 1 });
  const errors = []; w.addEventListener('error', (e) => errors.push(e.message)); w.console.error = (...a) => errors.push(a.join(' ')); w.console.warn = () => {};
  SCRIPTS.forEach((f) => { try { w.eval(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch (e) { errors.push(f + ': ' + e.message); } });

  // THE VOICE, STUBBED WITH REAL LENGTHS: every clip "exists", runs CLIP_MS,
  // and a clip stopped before its end is recorded as cut off.
  const voice = { played: [], cut: [], current: null };
  const waiters = [];
  const release = () => waiters.splice(0).forEach((f) => f());
  const endCurrent = (cut) => {
    const c = voice.current; if (!c) return;
    clearTimeout(c.timer); voice.current = null;
    if (cut && w.performance.now() < c.ends - 5) voice.cut.push(c.id);
    release();
  };
  w.VO = {
    play(id) {
      if (!id) return null;
      endCurrent(true);
      const c = { id, started: w.performance.now(), ends: w.performance.now() + CLIP_MS };
      c.timer = setTimeout(() => { if (voice.current === c) endCurrent(false); }, CLIP_MS);
      voice.current = c; voice.played.push(id);
      return c;
    },
    stop() { endCurrent(true); },
    finished() { return voice.current ? new Promise((r) => waiters.push(r)) : Promise.resolve(); },
    preload() {}, seconds: () => CLIP_MS / 1000, words: () => null,
    at() { return voice.current ? w.performance.now() - voice.current.started : null; },
    ready: () => Promise.resolve(), get isReady() { return true; },
    get playing() { return voice.current; }, get id() { return voice.current ? voice.current.id : null; }
  };
  return { w, d, errors, voice };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (pred, ms) => { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > (ms || 10000)) return false; await sleep(15); } return true; };
const lerp = (a, b, n) => { const o = []; for (let i = 1; i <= n; i++) o.push({ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n }); return o; };

async function run(k) {
  const W = world();
  try { await play(k, W); } finally { W.w.close(); }
}

async function play(k, { w, d, errors, voice }) {
  const svg = () => d.getElementById('stage').querySelector('svg');
  const St = () => w.Stage.state;
  const ev = (el, type, x, y) => el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
  const tapEl = (el) => ev(el, 'pointerdown', 500, 300);
  const drag = async (fromEl, pts) => { ev(fromEl, 'pointerdown', pts[0].x, pts[0].y); for (const q of pts) { ev(svg(), 'pointermove', q.x, q.y); await sleep(6); } ev(svg(), 'pointerup', pts[pts.length - 1].x, pts[pts.length - 1].y); };
  const sfx = []; const origSfx = w.SFX.play.bind(w.SFX); w.SFX.play = (n, o) => { sfx.push(n); return origSfx(n, o); };
  const faces = []; const origPlay = w.Swiftee.play.bind(w.Swiftee); w.Swiftee.play = (s, o, c) => { faces.push(s); return origPlay(s, o, c); };
  const states = []; const lines = [];
  await until(() => w.Game && w.Game.director);
  const dir = w.Game.director;
  dir.configure({ feedbackSettleMs: 20, readablePauseMs: 40 });
  dir.on('say', (e) => lines.push(e.text));
  dir.on('instruction', (e) => { if (e.text) lines.push(e.text); });
  let pending = null; dir.on('input', ({ spec }) => { pending = spec; });
  d.getElementById('loading').classList.add('ready');
  // the start button, until the lesson is actually running
  for (let i = 0; i < 30 && !dir.running; i++) { d.getElementById('start').click(); await sleep(200); }

  const connectAt = w.Screens.list.findIndex((s) => s.id === 'connect');
  const next = async () => { await until(() => !!pending, 30000); const sp = pending; pending = null; await until(() => !w.Input.guarded); return sp; };
  // KEEP AT IT UNTIL THE LESSON MOVES ON. A tap can land in the moment
  // before an answer is live (the cards are still being dealt, Next is still
  // coming up); a child taps again, and so does this.
  const keep = async (act) => {
    const scr = w.Game.screen;
    for (let i = 0; i < 40 && pending === null && w.Game.screen === scr; i++) { act(); await until(() => pending !== null || w.Game.screen !== scr, 400); }
  };
  const stalled = () => JSON.stringify({ screen: w.Game.screen, id: (w.Screens.list[w.Game.screen] || {}).id, state: dir.state, running: dir.running, guarded: w.Input.guarded, mode: w.Input.mode(), next: !!d.querySelector('#next.show'), errors: errors.slice(0, 2) });
  // the screens before the pentagon, answered plainly
  let picked = false;
  for (let guard = 0; guard < 20 && !picked; guard++) {
    const sp = await next();
    if (!sp) { t('k=' + k + ': reached the pick', false, stalled()); return; }
    if (sp.type === 'tap-anywhere') { await keep(() => { const b = d.querySelector('#next.show'); if (b) b.click(); }); continue; }
    if (sp.type === 'multi-select') {
      await keep(() => { (w.Stage.state.cards || []).filter((c) => c._opt && c._opt.correct && !c._done).forEach(tapEl); });
      continue;
    }
    if (sp.type === 'vertex-pick') {
      picked = true;
      t('k=' + k + ': every corner is on offer to pick', [...St().knobEls].every((kn) => kn.getAttribute('opacity') === '1'));
      t('k=' + k + ': the stage is waiting for a pick', w.Stage.connectState() === 'SELECT_VERTEX', w.Stage.connectState());
      tapEl(svg().querySelectorAll('.vertex')[k]);
      await sleep(30);
      t('k=' + k + ': the corner picked is locked as the start', St().picked === k, St().picked);
      t('k=' + k + ': only the picked corner is left showing',
        [...St().knobEls].every((kn, i) => (i === k) === (kn.getAttribute('opacity') === '1')),
        [...St().knobEls].map((kn) => kn.getAttribute('opacity')));
      t('k=' + k + ': the polygon and its sides are still drawn', St().edgeEls.length === 5 && !!St().fill);
    }
  }
  if (!picked) { t('k=' + k + ': reached the pick', false, stalled()); return; }
  const n = 5, left = (k + n - 1) % n, right = (k + 1) % n, far = (k + 2) % n;
  const V = () => St().verts;
  const from = () => svg().querySelectorAll('.vertex')[k];
  const mistakesBefore = sfx.filter((s) => s === 'wrong').length;

  // 1 — the first try: a neighbour
  let sp = await next();
  t('k=' + k + ': the connect input is the sides one', sp && sp.type === 'draw-diagonal' && sp.sides === true, sp);
  t('k=' + k + ': it is armed only after the instruction was heard out', !voice.current && lines[lines.length - 1] === 'Let’s connect it to another vertex.', { voice: voice.current && voice.current.id, last: lines[lines.length - 1] });
  t('k=' + k + ': ready to connect', w.Stage.connectState() === 'READY_TO_CONNECT', w.Stage.connectState());
  t('k=' + k + ': the other corners are back as points to connect to',
    [...St().knobEls].every((kn) => kn.getAttribute('opacity') === '1'), [...St().knobEls].map((kn) => kn.getAttribute('opacity')));
  t('k=' + k + ': and their own corner is still the one that stands out', !!St().vcolor[k] && Object.keys(St().vcolor).length === 1);

  // a line let go on no corner: home, no verdict
  const c = w.Poly.centroid(V());
  await drag(from(), lerp(V()[k], c, 5));
  await sleep(40);
  t('k=' + k + ': a line dropped on nothing has no verdict', !sfx.slice(-3).includes('wrong') && w.Stage.connectState() === 'READY_TO_CONNECT' && !(St().diagonals || []).length && !St().segment,
    { sfx: sfx.slice(-3), state: w.Stage.connectState() });
  t('k=' + k + ': ...and lights every corner for a moment, not just the answers', [...St().knobEls].filter((kn, i) => i !== k && kn.classList.contains('target')).length === 4);
  await sleep(1500);
  t('k=' + k + ': ...then they settle back to plain points', [...St().knobEls].filter((kn) => kn.classList.contains('target')).length === 0 && [...St().knobEls].every((kn) => kn.getAttribute('opacity') === '1'));
  t('k=' + k + ': still ready after the miss', w.Stage.connectState() === 'READY_TO_CONNECT' && pending === null);

  // the neighbour on one side
  await drag(from(), lerp(V()[k], V()[right], 6));
  await sleep(30);
  t('k=' + k + ': neighbour ' + right + ' is a SIDE', w.Stage.connectState() === 'SIDE_FEEDBACK' && St().segment && St().segment[0] === k && St().segment[1] === right, { st: w.Stage.connectState(), seg: St().segment });
  t('k=' + k + ': a side makes no diagonal', !(St().diagonals || []).length);

  // trying to draw during the feedback does nothing
  await sleep(100);
  await drag(from(), lerp(V()[k], V()[far], 6));
  await sleep(30);
  t('k=' + k + ': nothing can be drawn while the side is being named', !(St().diagonals || []).length && w.Stage.connectState() === 'SIDE_FEEDBACK');
  // and a tap on his bubble while he is saying it does not cut him off
  await until(() => voice.current && voice.current.id === 'p09', 4000);
  const bubble = d.getElementById('bubble');
  for (let i = 0; bubble && i < 3; i++) { ev(bubble, 'pointerdown', 10, 10); await sleep(20); }

  // 2 — the retry: the other neighbour
  sp = await next();
  t('k=' + k + ': asked again with the same corner', sp && sp.retry && St().picked === k, { retry: sp && sp.retry, picked: St().picked });
  t('k=' + k + ': the side and its tag are gone before the next try', !St().segment && !St().labelEl);
  t('k=' + k + ': the retry waits for "Let’s connect it to a different vertex." to be heard', !voice.current && lines[lines.length - 1] === 'Let’s connect it to a different vertex.', { last: lines.slice(-3) });
  await drag(from(), lerp(V()[k], V()[left], 6));
  await sleep(30);
  t('k=' + k + ': neighbour ' + left + ' is a SIDE too' + (k === 0 || k === 4 ? ' (the wrap-around)' : ''), w.Stage.connectState() === 'SIDE_FEEDBACK' && St().segment && St().segment[1] === left, St().segment);

  // 3 — a corner that is not a neighbour
  sp = await next();
  t('k=' + k + ': asked a third time, same corner', sp && sp.retry && St().picked === k);
  const nonAdj = w.Poly.diagonalsFrom(k, n);
  t('k=' + k + ': the far corners are ' + nonAdj.join(','), nonAdj.length === 2 && nonAdj.indexOf(left) < 0 && nonAdj.indexOf(right) < 0);
  const target = nonAdj[k % 2];
  await drag(from(), lerp(V()[k], V()[target], 6));
  await sleep(30);
  const dg = St().diagonals || [];
  t('k=' + k + ': corner ' + target + ' makes the DIAGONAL', w.Stage.connectState() === 'DIAGONAL_SUCCESS' && dg.length === 1 && dg[0][0] === Math.min(k, target) && dg[0][1] === Math.max(k, target), { st: w.Stage.connectState(), dg });
  // nothing more can be drawn over the cheer
  await drag(from(), lerp(V()[k], V()[nonAdj[(k + 1) % 2]], 6));
  await sleep(30);
  t('k=' + k + ': no second line while the diagonal is cheered', (St().diagonals || []).length === 1);

  sp = await next();
  t('k=' + k + ': then the screen waits for Next', sp && sp.type === 'tap-anywhere' && w.Game.screen === connectAt);
  t('k=' + k + ': the diagonal stays', (St().diagonals || []).length === 1);
  t('k=' + k + ': the right-answer sound played for the diagonal', sfx.includes('correct'));
  t('k=' + k + ': a side was never a wrong answer', sfx.filter((s) => s === 'wrong').length === mistakesBefore && !faces.includes('oops'), { wrong: sfx.filter((s) => s === 'wrong').length, faces });

  // the words, in the spec's order
  const want = ['Select any vertex.', 'Let’s connect it to another vertex.',
                'This is a side of the polygon.', 'Let’s connect it to a different vertex.',
                'This is a side of the polygon.', 'Let’s connect it to a different vertex.',
                'Yay! You made a diagonal!'];
  const got = lines.slice(lines.indexOf('Select any vertex.'));
  t('k=' + k + ': the lines come in the order the spec gives', JSON.stringify(got) === JSON.stringify(want), got);
  const clips = voice.played.slice(voice.played.indexOf('p06'));
  t('k=' + k + ': and so do the voices — one per line, no stock praise between', JSON.stringify(clips) === JSON.stringify(['p06', 'p07i', 'p09', 'p10i', 'p09', 'p10i', 'p12']), clips);
  t('k=' + k + ': no voice was ever cut off', voice.cut.length === 0, voice.cut);
  t('k=' + k + ': no runtime errors', errors.length === 0, errors.slice(0, 3));
}

(async () => {
  for (let k = 0; k < 5; k++) { await run(k); }
  console.log('connect: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
