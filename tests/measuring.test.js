'use strict';
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const dom = new JSDOM('<div id="stage"></div><div id="bird"></div>', { runScripts: 'outside-only' });
const w = dom.window;
let callbacks = new Map(), id = 0, time = 0;
w.requestAnimationFrame = fn => { callbacks.set(++id, fn); return id; };
w.cancelAnimationFrame = key => callbacks.delete(key);
w.Swiftee = { el: w.document.querySelector('#bird') };
w.Juice = { reducedMotion: false };
for (const file of ['src/core/polygon-math.js', 'src/fx/snowflake.js', 'src/character/swiftee-frames.js', 'src/game/stage.js']) {
  w.eval(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
}
w.Stage.mount(w.document.querySelector('#stage'));
function tick(ms) {
  time += ms;
  const pending = [...callbacks.values()]; callbacks.clear();
  pending.forEach(fn => fn(time));
}
function tap(i) { w.Stage.state.edgeEls[i].dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true })); }
function prepare() {
  w.Stage.apply({ kind: 'polygon', sides: 5, panel: 'right' });
  return w.Stage.waitFor({ type: 'tap-each', targets: 'sides', count: 5 });
}
(async () => {
  const complete = prepare();
  tap(0); tap(0); tap(1); tap(2); tap(3); tap(4);
  assert.equal(w.Stage.state.measure.sides.length, 0);
  assert.equal(w.document.querySelectorAll('.swiftee-measuring').length, 1);
  for (let i = 0; i < 5; i++) { tick(16); tick(2000); }
  await complete;
  assert.equal(w.Stage.state.measure.sides.length, 5);
  assert.equal(w.document.querySelectorAll('.swiftee-measuring').length, 0);
  assert.equal(w.Swiftee.el.style.opacity, '');
  prepare(); tap(0); tick(16);
  w.Stage.apply({ kind: 'polygon', sides: 3 }); tick(3000);
  assert.equal(w.document.querySelectorAll('.meas').length, 0);
  assert.equal(w.document.querySelectorAll('.swiftee-measuring').length, 0);
  assert.equal(w.Swiftee.el.style.opacity, '');
  w.Juice.reducedMotion = true;
  const reduced = prepare();
  for (let i = 0; i < 5; i++) tap(i);
  await reduced;
  assert.equal(w.Stage.state.measure.sides.length, 5);
  assert.equal(w.document.querySelectorAll('.swiftee-measuring').length, 0);
  console.log('Measuring: queued taps, delayed reveal, cancellation and reduced motion passed.');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => dom.window.close());
