/*!
 * connect.test.js — the pick → connect step, from every corner.
 *
 *   node tests/connect.test.js
 *
 * Plays the lesson in jsdom up to the pentagon, picks corner k, and then does
 * what a child exploring would: lets go on no corner,
 * joins it to one neighbour (a side), tries to draw while he is still talking,
 * taps his bubble while the line is being spoken, tries the used end again,
 * joins the other neighbour (the second side — for k = 0 and k = 4 that is
 * the wrap-around), and finally joins a corner that is not a neighbour (the
 * diagonal). Each corner's state (Stage.state.vstate) is checked at every step
 * against the Screen 7 vertex brief. For every k it checks:
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
 *   - the far corners are open from the start (the user: "why diagonal vertex disable? …
 *     revert it"): from k = 0 and k = 3 a second run goes straight to a far corner, and the
 *     diagonal is made with no side first
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
  // ?story=0: this is about the connect screen, not the Momo and Popo story before the
  // lesson (tests/playthrough.jsdom.js plays that), so Start goes straight to screen 1
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/?story=0' });
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

async function run(k, direct) {
  const W = world();
  try { await play(k, W, direct); } finally { W.w.close(); }
}

async function play(k, { w, d, errors, voice }, direct) {
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
    // (the end of a screen: the lesson goes on by itself — game.js autoAdvance — so this waits)
    if (sp.type === 'tap-anywhere') { await keep(() => {}); continue; }
    if (sp.type === 'multi-select') {
      await keep(() => { (w.Stage.state.cards || []).filter((c) => c._opt && c._opt.correct && !c._done).forEach(tapEl); });
      continue;
    }
    if (sp.type === 'vertex-pick') {
      picked = true;
      t('k=' + k + ': every corner is on offer to pick', [...St().knobEls].every((kn) => kn.getAttribute('opacity') === '1'));
      t('k=' + k + ': the stage is waiting for a pick', w.Stage.connectState() === 'IDLE_VERTEX', w.Stage.connectState());
      tapEl(svg().querySelectorAll('.vertex')[k]);
      await sleep(30);
      t('k=' + k + ': the corner picked is locked as the start', St().picked === k, St().picked);
      t('k=' + k + ': only the picked corner is left showing',
        [...St().knobEls].every((kn, i) => (i === k) === (kn.getAttribute('opacity') === '1')),
        [...St().knobEls].map((kn) => kn.getAttribute('opacity')));
      t('k=' + k + ': the polygon and its sides are still drawn', St().edgeEls.length === 5 && !!St().fill);
      t('k=' + k + ': [1] ANCHOR_SELECTED', w.Stage.connectState() === 'ANCHOR_SELECTED', w.Stage.connectState());
    }
  }
  if (!picked) { t('k=' + k + ': reached the pick', false, stalled()); return; }
  const n = 5, left = (k + n - 1) % n, right = (k + 1) % n, far = (k + 2) % n;
  const V = () => St().verts;
  const from = () => svg().querySelectorAll('.vertex')[k];
  const mistakesBefore = sfx.filter((s) => s === 'wrong').length;

  // THE SCREEN 7 VERTEX BRIEF, AS ITS REGRESSION LIST (the numbers are the brief's):
  //  1 select anchor · 2 first ghost is a side (tests/checkpoints.browser.js — it needs real
  //  time) · 3 drag to a neighbour · 4 the side is a normal dark edge · 5 its end disables ·
  //  6 the anchor stays · 7 drag to the other neighbour · 8 that side is normal · 9 its end
  //  disables · 10 the far corners are open throughout · 11 the diagonal · 12 it locks ·
  //  13 a drag during dialogue does nothing · 14 no false "Try again" · 15 disabled ends never react
  const vs = () => (St().vstate || []).slice();
  const want = (m) => { const o = []; for (let q = 0; q < n; q++) o.push(m[q]); return o.join(','); };
  // A SIDE'S FAR CORNER, DONE WITH (the user, screen 7: "do not change the dot style, just disable
  // and dim it"): the same white point as an open corner, dimmed, never breathing, never a target
  const spentKnob = (q) => { const kn = St().knobEls[q]; return kn.getAttribute('fill') === '#ffffff' && kn.getAttribute('r') === '9' && +kn.getAttribute('opacity') < 0.6 && !kn.classList.contains('breathe') && !kn.classList.contains('target'); };
  const whiteKnob = (q) => { const kn = St().knobEls[q]; return kn.getAttribute('fill') === '#ffffff' && kn.getAttribute('opacity') === '1'; };
  const discLive = (q) => St().vertEls[q].style.pointerEvents === 'all';
  // (the drag preview lives in the effects layer; the white diagonal is in the polygon's)
  const previewShown = () => [...svg().querySelectorAll('.layer-fx line')].some((l) => l.getAttribute('stroke') === '#eafcff' && l.getAttribute('opacity') !== '0' && !l.closest('.gesture-ghost'));
  const litSides = () => [...svg().querySelectorAll('line.segment, line.segment-done')].filter((l) => l.getAttribute('stroke') !== '#2f5fc4' || l.getAttribute('stroke-width') !== '3.5' || l.getAttribute('style')).length;
  const noWrong = () => sfx.filter((s) => s === 'wrong').length === mistakesBefore && !faces.includes('oops') && !lines.some((l) => /Try again/.test(l));
  const statesAre = (m) => vs().join(',') === want(m);
  const FAR = 'inactive', ADJ = 'adjacent-available', USED = 'side-used-disabled', DIAG = 'diagonal-available';

  // THE DIAGONAL STRAIGHT AWAY: a far corner is a place the line may go from the start
  if (direct) {
    const sp0 = await next();
    t('k=' + k + ' (direct): the far corners are open before any side', sp0 && sp0.sides === true &&
      statesAre({ [k]: 'anchor', [left]: ADJ, [right]: ADJ, [far]: DIAG, [(k + 3) % n]: DIAG }) && whiteKnob(far) && whiteKnob((k + 3) % n), vs());
    await drag(from(), lerp(V()[k], V()[far], 6));
    await sleep(30);
    const dg0 = St().diagonals || [];
    t('k=' + k + ' (direct): a far corner makes the DIAGONAL, with no side', dg0.length === 1 && dg0[0][0] === Math.min(k, far) && dg0[0][1] === Math.max(k, far) && !(St().sidesDone || []).length && !St().segment, { dg0 });
    await until(() => w.Stage.connectState() === 'EXPLANATION', 8000);
    const sp1 = await next();
    t('k=' + k + ' (direct): the screen ends as before', sp1 && sp1.type === 'tap-anywhere' && w.Game.screen === connectAt);
    const got0 = lines.slice(lines.indexOf('Select any vertex.'));
    t('k=' + k + ' (direct): his lines — no side named', JSON.stringify(got0) === JSON.stringify(['Select any vertex.', 'Let’s connect it to another vertex.', 'Yay! You made a diagonal!']), got0);
    t('k=' + k + ' (direct): no wrong cue, no runtime errors', noWrong() && errors.length === 0, errors.slice(0, 3));
    return;
  }

  // 1 — the first side
  let sp = await next();
  t('k=' + k + ': the connect input is the sides one', sp && sp.type === 'draw-diagonal' && sp.sides === true, sp);
  t('k=' + k + ': it is armed only after the instruction was heard out', !voice.current && lines[lines.length - 1] === 'Let’s connect it to another vertex.', { voice: voice.current && voice.current.id, last: lines[lines.length - 1] });
  t('k=' + k + ': [1] SIDE_HINT, ready for the first side', w.Stage.connectState() === 'SIDE_HINT', w.Stage.connectState());
  t('k=' + k + ': [1] the corners\' states: anchor, the two neighbours available, the far corners available too',
    statesAre({ [k]: 'anchor', [left]: ADJ, [right]: ADJ, [far]: DIAG, [(k + 3) % n]: DIAG }), vs());
  t('k=' + k + ': the neighbours and the far corners are white points, their own corner green',
    whiteKnob(left) && whiteKnob(right) && whiteKnob(far) && whiteKnob((k + 3) % n) && St().knobEls[k].getAttribute('fill') === '#34b4a4' && Object.keys(St().vcolor).length === 1);
  t('k=' + k + ': only the anchor takes a press', [...Array(n).keys()].every((q) => discLive(q) === (q === k)), [...Array(n).keys()].map(discLive));

  // [12 — the brief's INVALID DRAG] a line let go on no corner: only the preview resets
  const c = w.Poly.centroid(V());
  const before0 = vs().join(',');
  await drag(from(), lerp(V()[k], c, 5));
  await sleep(300);
  t('k=' + k + ': a line dropped on nothing has no verdict, and the states are unchanged', noWrong() && w.Stage.connectState() === 'SIDE_HINT' && !(St().diagonals || []).length && !St().segment && vs().join(',') === before0 && pending === null,
    { sfx: sfx.slice(-3), state: w.Stage.connectState(), vs: vs() });
  t('k=' + k + ': ...nothing lights up, and the preview line is gone', [...St().knobEls].every((kn) => !kn.classList.contains('target')) && !previewShown());

  // [3–6] the neighbour on one side
  await drag(from(), lerp(V()[k], V()[right], 6));
  await sleep(30);
  t('k=' + k + ': [3] neighbour ' + right + ' is a SIDE', w.Stage.connectState() === 'SIDE_COMPLETE' && St().segment && St().segment[0] === k && St().segment[1] === right, { st: w.Stage.connectState(), seg: St().segment });
  t('k=' + k + ': [4] the side is a normal edge — the outline\'s stroke and width, no glow — and the ice preview is gone',
    !!St().segLine && St().segLine.getAttribute('stroke') === '#2f5fc4' && St().segLine.getAttribute('stroke-width') === '3.5' && !St().segLine.getAttribute('style') && litSides() === 0 && !previewShown());
  t('k=' + k + ': [5] its end is disabled on the drop', vs()[right] === USED && spentKnob(right) && !discLive(right), vs());
  t('k=' + k + ': [6] the anchor stays the anchor', vs()[k] === 'anchor' && St().picked === k && St().knobEls[k].getAttribute('fill') === '#34b4a4');
  t('k=' + k + ': a side makes no diagonal', !(St().diagonals || []).length);

  // [13] trying to draw during the feedback does nothing
  await sleep(100);
  await drag(from(), lerp(V()[k], V()[left], 6));
  await sleep(30);
  t('k=' + k + ': [13] nothing can be drawn while the side is being named', !(St().diagonals || []).length && w.Stage.connectState() === 'SIDE_COMPLETE' && St().segment && St().segment[1] === right && vs()[left] === ADJ);
  // and a tap on his bubble while he is saying it does not cut him off
  await until(() => voice.current && voice.current.id === 'p09', 4000);
  const bubble = d.getElementById('bubble');
  for (let i = 0; bubble && i < 3; i++) { ev(bubble, 'pointerdown', 10, 10); await sleep(20); }

  // 2 — the second side
  sp = await next();
  t('k=' + k + ': asked again with the same corner', sp && sp.retry && St().picked === k, { retry: sp && sp.retry, picked: St().picked });
  t('k=' + k + ': NEXT_SIDE_READY', w.Stage.connectState() === 'NEXT_SIDE_READY', w.Stage.connectState());
  t('k=' + k + ': the tag is gone before the next try, and the side stays a plain edge', !St().segment && !St().labelEl && (St().sidesDone || []).length === 1 && litSides() === 0);
  t('k=' + k + ': the retry waits for "Let’s connect it to a different vertex." to be heard', !voice.current && lines[lines.length - 1] === 'Let’s connect it to a different vertex.', { last: lines.slice(-3) });
  t('k=' + k + ': [6] the anchor, one end used, the other neighbour still available, the far corners still open',
    statesAre({ [k]: 'anchor', [right]: USED, [left]: ADJ, [far]: DIAG, [(k + 3) % n]: DIAG }), vs());
  // [15] the used end never reacts: a line let go on it goes home, quietly
  const before1 = vs().join(',');
  await drag(from(), lerp(V()[k], V()[right], 6));
  await sleep(300);
  t('k=' + k + ': [15] a line let go on the used end: nothing — no side, no verdict, no flash',
    w.Stage.connectState() === 'NEXT_SIDE_READY' && !St().segment && (St().sidesDone || []).length === 1 && pending === null && noWrong() && vs().join(',') === before1 && [...St().knobEls].every((kn) => !kn.classList.contains('target')),
    { st: w.Stage.connectState(), seg: St().segment, sides: St().sidesDone });
  // a press on the used end itself starts nothing
  ev(St().vertEls[right], 'pointerdown', V()[right].x, V()[right].y); ev(svg(), 'pointermove', c.x, c.y); ev(svg(), 'pointerup', c.x, c.y);
  await sleep(300);
  t('k=' + k + ': [15] a drag from the used end starts nothing', w.Stage.connectState() === 'NEXT_SIDE_READY' && !previewShown() && vs().join(',') === before1);
  // [7–9] the other neighbour: the second side
  await drag(from(), lerp(V()[k], V()[left], 6));
  await sleep(30);
  t('k=' + k + ': [7] neighbour ' + left + ' is the second SIDE' + (k === 0 || k === 4 ? ' (the wrap-around)' : ''),
    w.Stage.connectState() === 'SECOND_SIDE_COMPLETE' && St().segment && St().segment[0] === k && St().segment[1] === left, { st: w.Stage.connectState(), seg: St().segment });
  t('k=' + k + ': [8] it is a normal edge too', !!St().segLine && St().segLine.getAttribute('stroke') === '#2f5fc4' && !St().segLine.getAttribute('style') && litSides() === 0 && !previewShown());
  t('k=' + k + ': [9] its end is disabled, the anchor stays, and the far corners stay open',
    statesAre({ [k]: 'anchor', [right]: USED, [left]: USED, [far]: DIAG, [(k + 3) % n]: DIAG }) && spentKnob(left), vs());

  // 3 — the diagonal
  sp = await next();
  t('k=' + k + ': DIAGONAL_READY after "Let’s connect it to a different vertex."', w.Stage.connectState() === 'DIAGONAL_READY' && lines[lines.length - 1] === 'Let’s connect it to a different vertex.', { st: w.Stage.connectState(), last: lines.slice(-2) });
  const nonAdj = w.Poly.diagonalsFrom(k, n);
  t('k=' + k + ': the far corners are ' + nonAdj.join(','), nonAdj.length === 2 && nonAdj.indexOf(left) < 0 && nonAdj.indexOf(right) < 0);
  t('k=' + k + ': [10] the far corners are diagonal-available; both used ends stay disabled',
    statesAre({ [k]: 'anchor', [right]: USED, [left]: USED, [nonAdj[0]]: DIAG, [nonAdj[1]]: DIAG }) && whiteKnob(nonAdj[0]) && whiteKnob(nonAdj[1]) && spentKnob(left) && spentKnob(right), vs());
  const before2 = vs().join(',');
  await drag(from(), lerp(V()[k], V()[left], 6));
  await sleep(300);
  t('k=' + k + ': [15] the used ends still never react', w.Stage.connectState() === 'DIAGONAL_READY' && !(St().diagonals || []).length && !St().segment && pending === null && noWrong() && vs().join(',') === before2);
  const target = nonAdj[k % 2];
  await drag(from(), lerp(V()[k], V()[target], 6));
  await sleep(30);
  const dg = St().diagonals || [];
  t('k=' + k + ': [11] corner ' + target + ' makes the DIAGONAL', dg.length === 1 && dg[0][0] === Math.min(k, target) && dg[0][1] === Math.max(k, target), { dg });
  const flow = (St().connectLog || []).join(',');
  t('k=' + k + ': [12] and it locks: DIAGONAL_CREATED then INTERACTION_LOCKED, the input locked, no corner takes a press',
    /DIAGONAL_DRAG,DIAGONAL_CREATED,INTERACTION_LOCKED/.test(flow) && /^(INTERACTION_LOCKED|EXPLANATION)$/.test(w.Stage.connectState()) && w.Input.mode() === 'locked' && [...Array(n).keys()].every((q) => St().vertEls[q].style.pointerEvents === 'none'), { st: w.Stage.connectState(), mode: w.Input.mode(), flow });
  t('k=' + k + ': the used ends stay disabled; every other corner but the anchor is inactive',
    statesAre({ [k]: 'anchor', [right]: USED, [left]: USED, [nonAdj[0]]: FAR, [nonAdj[1]]: FAR }), vs());
  // [13] nothing more can be drawn over the cheer — from the anchor, or from the diagonal itself
  await drag(from(), lerp(V()[k], V()[nonAdj[(k + 1) % 2]], 6));
  const dl = St().diagLines || svg().querySelectorAll('.layer-poly line');
  const aLine = [...svg().querySelectorAll('line')].find((l) => !l.closest('.gesture-ghost') && +l.getAttribute('x1') === V()[Math.min(k, target)].x);
  if (aLine) { ev(aLine, 'pointerdown', V()[target].x, V()[target].y); ev(svg(), 'pointermove', c.x, c.y); ev(svg(), 'pointerup', c.x, c.y); }
  await sleep(30);
  t('k=' + k + ': [13] no second line while the diagonal is cheered, and the diagonal cannot be dragged', (St().diagonals || []).length === 1 && !previewShown());
  await until(() => w.Stage.connectState() === 'EXPLANATION', 8000);
  t('k=' + k + ': EXPLANATION while "Yay! You made a diagonal!" is said', w.Stage.connectState() === 'EXPLANATION', w.Stage.connectState());
  // THE BRIEF'S STATE FLOW, in order (the drags that went nowhere in between are READY again)
  const seen = (St().connectLog || []).filter((x, i, a) => a[i - 1] !== x);
  const order = ['ANCHOR_SELECTED', 'SIDE_HINT', 'SIDE_DRAG', 'SIDE_COMPLETE', 'ENDPOINT_DISABLED', 'NEXT_SIDE_READY', 'SIDE_DRAG', 'SECOND_SIDE_COMPLETE',
                 'ENDPOINT_DISABLED', 'DIAGONAL_INSTRUCTION', 'DIAGONAL_READY', 'DIAGONAL_DRAG', 'DIAGONAL_CREATED', 'INTERACTION_LOCKED', 'EXPLANATION'];
  let at = 0; seen.forEach((x) => { if (x === order[at]) at++; });
  t('k=' + k + ': [16] the flow runs in the brief\'s order, anchor to explanation', at === order.length, { reached: order[at], seen });

  sp = await next();
  t('k=' + k + ': then the screen comes to its end, and goes on by itself', sp && sp.type === 'tap-anywhere' && w.Game.screen === connectAt);
  t('k=' + k + ': the diagonal stays', (St().diagonals || []).length === 1);
  t('k=' + k + ': the right-answer sound played for the diagonal', sfx.includes('correct'));
  t('k=' + k + ': [14] a side was never a wrong answer — no wrong sound, no "oops", no "Try again"', noWrong(), { wrong: sfx.filter((s) => s === 'wrong').length, faces });
  void dl;

  // the words, in the spec's order
  const wantLines = ['Select any vertex.', 'Let’s connect it to another vertex.',
                'This is a side of the polygon.', 'Let’s connect it to a different vertex.',
                'This is a side of the polygon.', 'Let’s connect it to a different vertex.',
                'Yay! You made a diagonal!'];
  const got = lines.slice(lines.indexOf('Select any vertex.'));
  t('k=' + k + ': the lines come in the order the spec gives — a side, the other side, the diagonal', JSON.stringify(got) === JSON.stringify(wantLines), got);
  const clips = voice.played.slice(voice.played.indexOf('p06'));
  t('k=' + k + ': and so do the voices — one per line, no stock praise between', JSON.stringify(clips) === JSON.stringify(['p06', 'p07i', 'p09', 'p10i', 'p09', 'p10i', 'p12']), clips);
  t('k=' + k + ': no voice was ever cut off', voice.cut.length === 0, voice.cut);
  t('k=' + k + ': no runtime errors', errors.length === 0, errors.slice(0, 3));
}

(async () => {
  for (let k = 0; k < 5; k++) { await run(k); }
  for (const k of [0, 3]) { await run(k, true); }
  console.log('connect: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
