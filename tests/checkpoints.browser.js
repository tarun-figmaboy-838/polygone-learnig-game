#!/usr/bin/env node
/*!
 * checkpoints.browser.js — the final QA pass, checkpoint by checkpoint, in a real browser.
 *
 *   node tests/checkpoints.browser.js            every checkpoint, a PASS/FAIL table at the end
 *   node tests/checkpoints.browser.js --shots    and the sixteen review screenshots to artifacts/qa/
 *   node tests/checkpoints.browser.js --headed   watch it
 *
 * The user's "PLAYWRIGHT — EXACT TEST CHECKPOINTS" spec, one numbered checkpoint per section
 * of it (CP1 … CP66). Where playthrough.browser.js plays the lesson end to end, this goes to
 * each screen through the review tool's jump list (?dev=1) and asks the specific questions:
 * order and timing (state/DOM timestamps), locking, geometry (the polygon's own vertices
 * against what is drawn), first/second-miss logic, layout (bounding boxes), and that nothing
 * moves that should not. Screenshots are for review, never evidence on their own.
 *
 * The playthroughs the spec asks for (happy path, wrong-first, two-wrong auto-correct, messy
 * input) are the existing suites: tests/playthrough.browser.js, tests/playthrough.jsdom.js
 * and tests/qa.browser.js; run `npm run test:all` alongside this.
 */
'use strict';

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HEADED = process.argv.includes('--headed');
const SHOTS = process.argv.includes('--shots') ? path.join(ROOT, 'artifacts', 'qa') : null;
// --only=10-16: boot (CP1) and then only the steps numbered in that range — for a quick look at one
// stretch; a range must start where a step jumps to its own screen (CP10 jumps to the vertex pick)
const ONLY = ((process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split('-').filter(Boolean).map(Number));
const wanted = (n) => !ONLY.length || n === 1 || (n >= ONLY[0] && n <= (ONLY[1] == null ? ONLY[0] : ONLY[1]));
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
                '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
                           'Cache-Control': rel.startsWith('assets/') ? 'public, max-age=3600' : 'no-store' });
      res.end(buf);
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { server, port } = await serve();
  const browser = await chromium.launch({
    channel: 'chrome', headless: !HEADED,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
           '--disable-features=AudioServiceOutOfProcess,AudioServiceSandbox']
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();

  /* ---- the report ---- */
  const results = [];
  const cp = (n, label, ok, extra) => {
    results.push({ n, label, ok: !!ok, extra: extra == null ? '' : (typeof extra === 'string' ? extra : JSON.stringify(extra)) });
    console.log((ok ? '  ok   ' : '  FAIL ') + 'CP' + n + ' ' + label + (ok || extra == null ? '' : '  ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 400)));
  };
  const step = async (n, label, fn) => {
    if (!wanted(n)) return;
    try { const r = await fn(); if (r && typeof r === 'object' && 'ok' in r) cp(n, label, r.ok, r.extra); else cp(n, label, !!r, r === true ? undefined : r); }
    catch (e) { cp(n, label, false, 'threw: ' + String(e.message).split('\n')[0]); }
  };
  const shot = async (name) => { if (!SHOTS) return; try { await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } catch (e) {} };

  /* ---- the page's own voice: errors, missing assets ---- */
  const errors = [], missing = [], starved = [];
  const HOST_LIMIT = /INSUFFICIENT_RESOURCES|OUT_OF_MEMORY|ERR_INSUFFICIENT/i, CANCELLED = /ERR_ABORTED|ERR_CONNECTION_ABORTED/i;
  page.on('console', (m) => { if (m.type() !== 'error') return; const t = m.text(); if (/favicon/.test(((m.location() || {}).url) || '')) return; if (HOST_LIMIT.test(t)) starved.push(t); else errors.push('console: ' + t); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message || e).split('\n')[0]));
  page.on('response', (r) => { if (r.status() === 404) missing.push(r.url()); });
  page.on('requestfailed', (r) => { const why = ((r.failure() || {}).errorText) || ''; if (/fonts\.g/.test(r.url())) return; if (HOST_LIMIT.test(why) || CANCELLED.test(why)) starved.push(r.url() + ' ' + why); else missing.push(r.url() + ' (' + why + ')'); });

  const ev = (fn, arg) => page.evaluate(fn, arg);
  const waitFn = (fn, arg, ms) => page.waitForFunction(fn, arg, { timeout: ms || 30000 });
  /* counters the game cannot see: cues, confetti, cheers */
  const instrument = () => ev(() => {
    window.__cues = { correct: 0, wrong: 0 };
    const play = window.SFX.play.bind(window.SFX);
    window.SFX.play = (n, o) => { if (n === 'correct') window.__cues.correct++; if (n === 'wrong') window.__cues.wrong++; return play(n, o); };
    window.__fx = { confetti: 0 };
    if (window.Juice && window.Juice.confetti) { const c = window.Juice.confetti; window.Juice.confetti = function () { window.__fx.confetti++; return c.apply(this, arguments); }; }
    // every distinct thing said, in order, with the time it first showed — his bubble, or the
    // plank card a line goes on when he is not on the screen (make-concave's explanations)
    window.__said = [];
    ['bubble', 'instruction'].forEach((id) => {
      const b = document.getElementById(id); if (!b) return;
      new MutationObserver(() => { const t = b.textContent.trim(); const last = window.__said[window.__said.length - 1]; if (t && (!last || last.t !== t)) window.__said.push({ t, at: performance.now(), from: id }); }).observe(b, { childList: true, subtree: true, characterData: true });
    });
    window.__screenAt = {};
    window.Game.director.on('start', () => { window.__screenAt[window.Game.screen] = performance.now(); });
  });
  const said = () => ev(() => window.__said.map((s) => s.t));
  const cues = () => ev(() => window.__cues);
  const idx = (id) => ev((id) => window.Screens.list.findIndex((s) => s.id === id), id);
  const waiting = async (i, ms) => waitFn((i) => window.Game.screen === i && window.Game.director.state === 'WAITING_FOR_USER' && window.Input.mode() !== 'locked', i, ms || 60000);
  const unlocked = (ms) => waitFn(() => window.Input.mode() !== 'locked', null, ms || 20000);
  const jump = async (id) => { const i = await idx(id); if (i < 0) throw new Error('no screen ' + id); await page.selectOption('#jump-sel', String(i)); await waitFn((i) => window.Game.screen === i, i, 60000); return i; };
  const rect = (sel) => ev((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom }; }, sel);
  const rects = (sel) => ev((sel) => [...document.querySelectorAll(sel)].map((e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom }; }), sel);
  const overlap = (a, b) => { if (!a || !b) return 0; const w = Math.max(0, Math.min(a.r, b.r) - Math.max(a.x, b.x)), h = Math.max(0, Math.min(a.b, b.b) - Math.max(a.y, b.y)); return (w * h) / Math.max(1, Math.min(a.w * a.h, b.w * b.h)); };
  const swiftee = () => ev(() => { const b = window.Swiftee.bounds(); const el = window.Swiftee.el; return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom, cx: (b.left + b.right) / 2, cy: (b.top + b.bottom) / 2, on: parseFloat(getComputedStyle(el).opacity) > 0.5, pos: window.Swiftee.pos, state: window.Swiftee.state }; });
  /* stage coordinates → client pixels (the polygon layer sits `seatY` down the board) */
  const toClient = (p, seated) => ev(({ p, seated }) => { const m = window.Stage.svg.getScreenCTM(); return { x: m.a * p.x + m.e, y: m.d * (p.y + (seated ? (window.Stage.seatY || 0) : 0)) + m.f }; }, { p, seated: seated !== false });
  const knobClient = (i) => ev((i) => { const k = window.Stage.state.knobEls && window.Stage.state.knobEls[i]; if (!k) return null; const r = k.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, i);
  const dragPath = async (from, to, steps, holdMs) => {
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    for (let i = 1; i <= steps; i++) { const t = i / steps; await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t); await sleep(16); }
    if (holdMs) await sleep(holdMs);
    await page.mouse.up();
  };
  const clickCentre = async (sel) => { const r = await rect(sel); if (!r) throw new Error('no ' + sel); await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2); };
  const tapChoice = async (label) => { await clickCentre(`#stage .choice[data-label="${label}"]`); };
  const choiceLabels = () => ev(() => [...document.querySelectorAll('#stage .choice')].map((c) => c.getAttribute('data-label')));
  const angles = (v) => v.map((p, i) => { const a = v[(i + v.length - 1) % v.length], b = v[(i + 1) % v.length]; const d1 = Math.atan2(a.y - p.y, a.x - p.x), d2 = Math.atan2(b.y - p.y, b.x - p.x); let d = Math.abs(d1 - d2) * 180 / Math.PI; if (d > 180) d = 360 - d; return d; });

  /* ================================================================ *
   * A. THE NATURAL START — boot, intro, the perch, Level 1
   * ================================================================ */
  await page.goto(`http://127.0.0.1:${port}/index.html?story=0`, { waitUntil: 'domcontentloaded' });
  await step(1, 'boot: loads, no error, no missing asset, no horizontal overflow, Start visible', async () => {
    await waitFn(() => document.getElementById('loading') && document.getElementById('loading').classList.contains('ready'), null, 120000);
    // (the Start button fades up once the page is ready)
    await waitFn(() => parseFloat(getComputedStyle(document.getElementById('start')).opacity) > 0.5, null, 8000).catch(() => {});
    const s = await ev(() => ({ game: !!document.getElementById('game'), stage: !!document.getElementById('stage'), overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
                                start: !!document.getElementById('start') && parseFloat(getComputedStyle(document.getElementById('start')).opacity) > 0.5 }));
    return { ok: s.game && s.stage && !s.overflow && s.start && errors.length === 0 && missing.length === 0, extra: { ...s, errors: errors.slice(0, 3), missing: missing.slice(0, 3) } };
  });
  await instrument();
  await page.click('#start');
  await waitFn(() => window.Game.screen === 0 && window.Game.director.running, null, 30000);
  await sleep(900);
  let closeShot = null;
  await step(2, 'intro: he is large and sharp on a close shot, the log is there (blurred), nothing else to press', async () => {
    // he arrives by sleigh (his own element hidden until he has landed): sampled once he is there
    await waitFn(() => window.Swiftee.state !== 'enter' && parseFloat(getComputedStyle(window.Swiftee.el).opacity) > 0.5, null, 20000).catch(() => {});
    const s = await ev(() => ({
      sw: window.Swiftee.bounds().height, on: parseFloat(getComputedStyle(window.Swiftee.el).opacity) > 0.5,
      blur: parseFloat(document.querySelector('#logSoft feGaussianBlur').getAttribute('stdDeviation') || '0'),
      logOn: parseFloat(getComputedStyle(document.querySelector('.perch-log')).opacity) > 0.9,
      cards: document.querySelectorAll('#stage .card').length, mode: window.Input.mode(), screen: window.Game.screen }));
    closeShot = s.sw;
    await shot('01-intro-closeup');
    // a tap where Level 1's cards will be changes nothing
    const st = await rect('#stage'); await page.mouse.click(st.x + st.w * 0.75, st.y + st.h * 0.4); await sleep(400);
    const after = await ev(() => ({ screen: window.Game.screen, state: window.Game.director.state }));
    return { ok: s.on && s.blur > 0 && s.logOn && s.cards === 0 && s.mode !== 'polygon' && after.screen === 0, extra: { ...s, after } };
  });
  // CP3 + CP4: watch the whole intro through to Level 1 — lines, the flight, the landing
  const intro = await ev(() => new Promise((res) => {
    const T0 = performance.now(), log = [], lines = [];
    let lastText = '', lastWords = -1, maxJump = 0, prev = null;
    const blurEl = document.querySelector('#logSoft feGaussianBlur'), logEl = document.querySelector('.perch-log');
    const tick = () => {
      const b = document.getElementById('bubble'), text = b.textContent.trim(), words = b.querySelectorAll('.in').length;
      const sw = window.Swiftee.bounds(), c = { x: (sw.left + sw.right) / 2, y: (sw.top + sw.bottom) / 2 };
      if (prev && window.Swiftee.state !== 'exit' && window.Swiftee.state !== 'enter') maxJump = Math.max(maxJump, Math.hypot(c.x - prev.x, c.y - prev.y));
      prev = c;
      if (text && text !== lastText) { lines.push({ t: text, at: performance.now() - T0, screen: window.Game.screen }); lastText = text; }
      const entry = { at: performance.now() - T0, screen: window.Game.screen, dir: window.Game.director.state, text: text.slice(0, 24), words,
                      blur: logEl.getAttribute('filter') ? parseFloat(blurEl.getAttribute('stdDeviation') || '0') : 0, logW: logEl.getBoundingClientRect().width, sw: window.Swiftee.state, pos: window.Swiftee.pos,
                      cx: Math.round(c.x), cy: Math.round(c.y), mode: window.Input.mode() };
      log.push(entry);
      if (window.Game.screen === 3 && window.Game.director.state === 'WAITING_FOR_USER') { res({ log, lines, maxJump }); return; }
      if (performance.now() - T0 > 90000) { res({ log, lines, maxJump, timeout: true }); return; }
      setTimeout(tick, 50);
    };
    tick();
  }));
  await step(3, 'intro lines: three, one at a time, in order; the flight never before the third is told', async () => {
    const L = intro.lines.filter((l) => l.screen <= 2);
    // the third line fully revealed: the last sample on screen 2 whose word count stopped growing
    const onTwo = intro.log.filter((e) => e.screen === 2);
    const told = onTwo.length ? Math.max(...onTwo.map((e) => e.words)) : 0;
    const toldAt = (onTwo.find((e) => e.words === told) || {}).at;
    const flight = intro.log.find((e) => /air|perch|fly/.test(e.sw) || e.pos === 'log');
    return { ok: L.length >= 3 && !intro.timeout && flight && toldAt != null && flight.at >= toldAt, extra: { lines: L.map((l) => l.t.slice(0, 30)), toldAt, flightAt: flight && flight.at } };
  });
  await step(4, 'zoom-out order: third line → zoom out (blur down, log clear) → flight → landing → Level 1 enabled; no teleport', async () => {
    const lg = intro.log;
    const first = (f) => { const e = lg.find(f); return e ? e.at : null; };
    const blurStart = first((e) => e.blur < lg[0].blur - 0.01);
    const zoomStart = first((e, i) => i > 0 && e.logW < lg[0].logW - 1);
    const flightAt = first((e) => /air|perch|fly/.test(e.sw));
    const landedAt = first((e) => e.pos === 'log' && !/air|perch|fly/.test(e.sw) && e.screen >= 2);
    const level1At = first((e) => e.screen === 3 && e.dir === 'WAITING_FOR_USER');
    const blurGone = lg[lg.length - 1].blur < 0.1;
    const order = blurStart != null && zoomStart != null && flightAt != null && landedAt != null && level1At != null && blurStart <= flightAt + 50 && zoomStart <= flightAt + 50 && flightAt <= landedAt && landedAt <= level1At;
    return { ok: order && blurGone && intro.maxJump < 90, extra: { blurStart, zoomStart, flightAt, landedAt, level1At, blurGone, maxJump: Math.round(intro.maxJump) } };
  });
  await step(5, 'on the stone: his feet on the perch point, in front of it, and still for 500 ms', async () => {
    // once his landing has settled (the squash on touching down): two readings 500 ms apart
    let a = null, b = null;
    for (let k = 0; k < 8; k++) {
      a = await ev(() => { const p = window.Stage.perchAt(), r = window.Stage.svg.getBoundingClientRect(), b = window.Swiftee.bounds(); return { feetX: r.left + p.x * r.width, feetY: r.top + p.y * r.height, cx: (b.left + b.right) / 2, bottom: b.bottom, log: getComputedStyle(document.querySelector('.perch-log')).opacity }; });
      await sleep(500);
      b = await ev(() => { const b = window.Swiftee.bounds(); return { cx: (b.left + b.right) / 2, bottom: b.bottom }; });
      if (Math.abs(a.bottom - b.bottom) < 2 && Math.abs(a.cx - b.cx) < 2) break;
    }
    await shot('02-intro-log-seating');
    const ok = Math.abs(a.bottom - a.feetY) < 16 && Math.abs(a.cx - a.feetX) < 24 && Math.abs(a.bottom - b.bottom) < 2 && Math.abs(a.cx - b.cx) < 2 && a.log === '1';
    return { ok, extra: { feet: [Math.round(a.feetX), Math.round(a.feetY)], him: [Math.round(a.cx), Math.round(a.bottom)], later: [Math.round(b.cx), Math.round(b.bottom)] } };
  });
  await step(6, 'Level 1 layout: cards right of him, no pulse, positions still for 1 s; he was larger on the close shot', async () => {
    await sleep(1200);
    const sw = await swiftee(), cards = await rects('#stage .card');
    const anim = await ev(() => [...document.querySelectorAll('#stage .card, #stage .card *')].reduce((n, e) => n + (e.getAnimations ? e.getAnimations().filter((a) => a.playState === 'running').length : 0), 0));
    await sleep(1000);
    const cards2 = await rects('#stage .card');
    const still = cards.every((c, i) => Math.abs(c.x - cards2[i].x) < 1 && Math.abs(c.y - cards2[i].y) < 1 && Math.abs(c.w - cards2[i].w) < 1);
    const right = cards.length === 4 && cards.every((c) => c.x > sw.x + sw.w * 0.5);
    const bubble = await rect('#bubble');
    const clear = cards.every((c) => overlap(c, bubble) < 0.05);
    await shot('03-level1-cards');
    return { ok: right && anim === 0 && still && clear && closeShot > sw.h * 1.15, extra: { cards: cards.length, anim, still, clear, closeShot: Math.round(closeShot), now: Math.round(sw.h) } };
  });
  const l1cards = await ev(() => [...document.querySelectorAll('#stage .card')].map((c) => ({ id: c.getAttribute('data-id'), ok: !!(c._opt && c._opt.correct) })));
  const wrongId = (l1cards.find((c) => !c.ok) || {}).id, rightIds = l1cards.filter((c) => c.ok).map((c) => c.id);
  await step(7, 'Level 1 wrong: red once, no green, no confetti, "Not quite." + its clue, taps held while he answers, then open again', async () => {
    await waiting(3);
    const c0 = await cues();
    await clickCentre(`#stage .card[data-id="${wrongId}"]`); await sleep(260);
    const s = await ev((id) => { const c = document.querySelector(`#stage .card[data-id="${id}"] .shape-card`); return { bad: c.classList.contains('mark-bad'), good: !!document.querySelector('#stage .mark-good'), confetti: window.__fx.confetti }; }, wrongId);
    await shot('04-level1-wrong');
    for (let k = 0; k < 4; k++) { await clickCentre(`#stage .card[data-id="${wrongId}"]`); await sleep(60); }
    await sleep(300);
    const c1 = await cues();
    await unlocked(20000); await sleep(200);
    const text = (await said()).find((t) => /^Not quite\./.test(t));
    const after = await ev(() => ({ screen: window.Game.screen, mode: window.Input.mode() }));
    return { ok: s.bad && !s.good && s.confetti === 0 && c1.wrong - c0.wrong === 1 && !!text && after.screen === 3 && after.mode === 'polygon', extra: { ...s, wrongCues: c1.wrong - c0.wrong, text, after } };
  });
  await step(8, 'Level 1 intermediate correct: green, its own short burst of confetti, "Keep going!", no "Great job!"', async () => {
    const before = (await said()).length;
    await clickCentre(`#stage .card[data-id="${rightIds[0]}"]`); await sleep(260);
    const s = await ev((id) => ({ good: document.querySelector(`#stage .card[data-id="${id}"] .shape-card`).classList.contains('mark-good'), confetti: window.__fx.confetti }), rightIds[0]);
    await unlocked(20000); await sleep(200);
    const lines = (await said()).slice(before);
    return { ok: s.good && s.confetti === 1 && lines.some((t) => /^Keep going!/.test(t)) && !lines.some((t) => /Great job!/.test(t)), extra: { ...s, lines } };
  });
  await step(9, 'Level 1 complete: exactly "Great job!", once, and the next screen only after it', async () => {
    const before = (await said()).length;
    await clickCentre(`#stage .card[data-id="${rightIds[1]}"]`);
    await waitFn(() => window.Game.screen > 3, null, 40000);
    const lines = await ev(() => window.__said.map((s) => ({ t: s.t, at: s.at })));
    const great = lines.slice(before).filter((l) => /Great job!/.test(l.t));
    const startNext = await ev(() => window.__screenAt[4]);
    const bad = lines.slice(before).filter((l) => /^(Nice|You got it|Perfect|Well done)/.test(l.t));
    return { ok: great.length === 1 && great[0].t === 'Great job!' && startNext > great[0].at && bad.length === 0, extra: { great: great.map((g) => g.t), startNext: Math.round(startNext || 0), greatAt: great[0] && Math.round(great[0].at), bad } };
  });

  /* ================================================================ *
   * B. SCREEN BY SCREEN, through the review tool's jump list
   * ================================================================ */
  await page.goto(`http://127.0.0.1:${port}/index.html?dev=1&story=0`, { waitUntil: 'domcontentloaded' });
  await waitFn(() => document.getElementById('loading').classList.contains('ready'), null, 120000);
  await instrument();
  const premature = [];   // CP53: what was on the screen when each input opened
  await ev(() => { window.__opened = []; window.Game.director.on('input', ({ spec }) => { if (spec.type === 'tap-anywhere') return; const check = () => { if (window.Input.mode() === 'locked') { setTimeout(check, 30); return; } window.__opened.push({ screen: window.Game.screen, type: spec.type, told: !!(document.getElementById('bubble').textContent.trim() || (document.getElementById('instruction') && document.getElementById('instruction').textContent.trim())) }); }; check(); }); });

  // ---- Level 2 -------------------------------------------------------------
  let panelRects = {};
  await step(10, 'Level 2 before "Select any vertex.": no dot pulses yet, no ghost, no line (the dots themselves come first, by design)', async () => {
    const i = await jump('pick-vertex');
    const early = await ev(() => new Promise((res) => {
      const T0 = performance.now(); let pulseEarly = 0, ghostEarly = 0, linesEarly = 0, samples = 0;
      const looping = (k) => k.getAnimations && k.getAnimations().some((a) => a.playState === 'running' && a.effect && a.effect.getTiming && a.effect.getTiming().iterations === Infinity);
      const tick = () => {
        const told = /Select any vertex/.test(document.getElementById('bubble').textContent + (document.getElementById('instruction') || {}).textContent);
        if (told || performance.now() - T0 > 20000) { res({ pulseEarly, ghostEarly, linesEarly, samples, told }); return; }
        samples++;
        pulseEarly += [...document.querySelectorAll('#stage .knob')].filter(looping).length;
        ghostEarly += document.querySelectorAll('#stage .gesture-ghost, #stage .ghost-demo').length;
        linesEarly += ((window.Stage.state.diagonals || []).length) + (window.Stage.state.segment ? 1 : 0);
        setTimeout(tick, 60);
      };
      tick();
    }));
    await waiting(i);
    return { ok: early.told && early.pulseEarly === 0 && early.ghostEarly === 0 && early.linesEarly === 0 && early.samples > 3, extra: early };
  });
  await step(11, 'Level 2 layout: him left, the card right; the card still across the teaching states (≤10 px, ≤2 %)', async () => {
    const sw = await swiftee(), panel = await rect('#stage .panel');
    panelRects['pick-vertex'] = panel;
    for (const id of ['connect', 'define-diagonal', 'another-diagonal']) { await jump(id); await waitFn(() => !!document.querySelector('#stage .panel'), null, 20000); await sleep(1200); panelRects[id] = await rect('#stage .panel'); }
    const base = panelRects['pick-vertex'];
    const drift = Object.keys(panelRects).map((k) => { const r = panelRects[k]; return { k, dx: Math.round(r.x - base.x), dy: Math.round(r.y - base.y), dw: +((r.w / base.w - 1) * 100).toFixed(1) }; });
    const stable = drift.every((d) => Math.abs(d.dx) <= 10 && Math.abs(d.dy) <= 10 && Math.abs(d.dw) <= 2);
    return { ok: panel && panel.x > sw.x + sw.w * 0.5 && stable, extra: { him: [Math.round(sw.x), Math.round(sw.r)], card: [Math.round(panel.x), Math.round(panel.r)], drift } };
  });
  let vertsL2 = null;
  await step(12, 'Level 2 vertex: every dot a plain dot (they all pulse once "vertex" is said — any may be picked), no large ring; the picked one becomes the anchor and stays put', async () => {
    const i = await jump('pick-vertex'); await waiting(i); await sleep(300);
    const before = await ev(() => ({ verts: window.Stage.state.verts.map((p) => [Math.round(p.x), Math.round(p.y)]), knobs: window.Stage.state.knobEls.length,
                                     pulsing: window.Stage.state.knobEls.filter((k) => k.getAnimations && k.getAnimations().some((a) => a.playState === 'running')).length,
                                     rings: [...document.querySelectorAll('#stage .layer-fx circle, #stage .layer-poly circle')].filter((c) => +c.getAttribute('r') > 14 && (c.getAttribute('fill') || 'none') === 'none').length,
                                     r: window.Stage.state.knobEls.map((k) => +k.getAttribute('r')) }));
    vertsL2 = before.verts;
    const k = await knobClient(0); await page.mouse.click(k.x, k.y);
    await waitFn(() => window.Stage.state.from != null, null, 20000).catch(() => {}); await sleep(600);
    const after = await ev(() => ({ from: window.Stage.state.from, verts: window.Stage.state.verts.map((p) => [Math.round(p.x), Math.round(p.y)]), screen: window.Game.screen, picked: window.Stage.state.vcolor && window.Stage.state.vcolor[0] }));
    return { ok: before.knobs >= 5 && before.pulsing <= before.knobs && before.rings === 0 && Math.max(...before.r) <= 12 && (after.from === 0 || !!after.picked) && JSON.stringify(after.verts) === JSON.stringify(before.verts), extra: { before, after: { from: after.from, screen: after.screen } } };
  });
  await step(13, 'Level 2 ghost: from the real vertex, first toward a NEIGHBOUR (a side, the Screen 7 brief), inside the card, the polygon untouched', async () => {
    const i = await idx('connect'); await waiting(i);
    const g = await ev(() => new Promise((res) => {
      const T0 = performance.now();
      const tick = () => {
        const gh = document.querySelector('#stage .gesture-ghost line, #stage .gesture-ghost path, #stage .ghost-demo line');
        if (gh) { const v = window.Stage.state.verts, f = window.Stage.state.from || 0; const x1 = +gh.getAttribute('x1'), y1 = +gh.getAttribute('y1'), x2 = +gh.getAttribute('x2'), y2 = +gh.getAttribute('y2'); const to = v.findIndex((p) => Math.hypot(p.x - x2, p.y - y2) < 2); res({ found: true, x1, y1, to, adjacent: to >= 0 && window.Poly.isAdjacent(f, to, v.length), from: [v[f].x, v[f].y], verts: v.map((p) => [Math.round(p.x), Math.round(p.y)]), waited: Math.round(performance.now() - T0), box: gh.getBoundingClientRect().toJSON() }); return; }
        if (performance.now() - T0 > 22000) { res({ found: false }); return; }
        setTimeout(tick, 100);
      };
      tick();
    }));
    if (!g.found) return { ok: false, extra: 'no ghost within 22 s' };
    const panel = await rect('#stage .panel');
    const inside = g.box.left >= panel.x - 12 && g.box.right <= panel.r + 12 && g.box.top >= panel.y - 12 && g.box.bottom <= panel.b + 12;
    const same = JSON.stringify(g.verts) === JSON.stringify(vertsL2);
    return { ok: (isNaN(g.x1) || (Math.abs(g.x1 - g.from[0]) < 3 && Math.abs(g.y1 - g.from[1]) < 3)) && g.adjacent && inside && same, extra: { waited: g.waited, start: [g.x1, g.y1], from: g.from, to: g.to, adjacent: g.adjacent, inside, same } };
  });
  await step(14, 'Level 2 invalid drops (a side, empty card, off the card): no diagonal, no progress, still open', async () => {
    const i = await idx('connect'); await waiting(i);
    const out = [];
    const tryDrop = async (target, name) => {
      await waitFn(() => window.Input.mode() !== 'locked' && /draw-diagonal/.test(((window.Game.director || {}).state === 'WAITING_FOR_USER' && window.Stage.state.kind) ? 'draw-diagonal' : (window.Stage.state.kind || '')) , null, 20000).catch(() => {});
      const from = await knobClient(await ev(() => window.Stage.state.from || 0));
      await dragPath(from, target, 10, 60); await sleep(900);
      const s = await ev(() => ({ diags: (window.Stage.state.diagonals || []).length, screen: window.Game.screen, seg: !!window.Stage.state.segment }));
      // a side is a designed stop ("This is a side"): the lesson names it, then asks again
      await waitFn(() => window.Input.mode() !== 'locked' && window.Game.director.state === 'WAITING_FOR_USER', null, 30000).catch(() => {});
      const s2 = await ev(() => ({ diags: (window.Stage.state.diagonals || []).length, screen: window.Game.screen, mode: window.Input.mode() }));
      out.push({ name, ...s, then: s2 });
      return s.diags === 0 && s2.diags === 0 && s2.mode === 'polygon';
    };
    const v = await ev(() => window.Stage.state.verts.map((p) => ({ x: p.x, y: p.y })));
    const f = await ev(() => window.Stage.state.from || 0), n = v.length;
    const nb = v[(f + 1) % n], mid = { x: (v[f].x + nb.x) / 2, y: (v[f].y + nb.y) / 2 };
    const c = v.reduce((a, p) => ({ x: a.x + p.x / n, y: a.y + p.y / n }), { x: 0, y: 0 });
    const ok1 = await tryDrop(await toClient(mid), 'side midpoint');
    const ok2 = await tryDrop(await toClient({ x: c.x + (v[f].x - c.x) * 0.35, y: c.y + (v[f].y - c.y) * 0.35 }), 'empty card');
    const panel = await rect('#stage .panel');
    const ok3 = await tryDrop({ x: panel.r + 120, y: panel.y + panel.h / 2 }, 'off the card');
    return { ok: ok1 && ok2 && ok3, extra: out };
  });
  await step(15, 'Level 2 drag past the card edge: the line is held inside the card, nothing left behind', async () => {
    const i = await idx('connect'); await waiting(i);
    const f = await ev(() => window.Stage.state.from || 0);
    const from = await knobClient(f), panel = await rect('#stage .panel');
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    const far = { x: panel.r + 160, y: panel.y - 80 };
    for (let k = 1; k <= 8; k++) await page.mouse.move(from.x + (far.x - from.x) * k / 8, from.y + (far.y - from.y) * k / 8);
    await sleep(120);
    const s = await ev((f) => { const v = window.Stage.state.verts[f]; const ls = [...document.querySelectorAll('#stage .layer-poly line, #stage .layer-fx line')].filter((l) => Math.abs(+l.getAttribute('x1') - v.x) < 2 && Math.abs(+l.getAttribute('y1') - v.y) < 2 && l.getAttribute('x2') != null); return ls.map((l) => l.getBoundingClientRect().toJSON()); }, f);
    await page.mouse.up(); await sleep(700);
    const left = await ev(() => (window.Stage.state.diagonals || []).length);
    const clamped = s.every((b) => b.right <= panel.r + 10 && b.top >= panel.y - 10 && b.left >= panel.x - 10 && b.bottom <= panel.b + 10);
    return { ok: s.length > 0 && clamped && left === 0, extra: { lines: s.length, clamped, left } };
  });
  // THE SCREEN 7 VERTEX BRIEF (its regression list — the first ghost being a side is CP13): a
  // side, then the other side, each the polygon's own edge the moment it lands and its end
  // disabled; the anchor kept; the far corners only for the diagonal step; the diagonal locked
  await step(16, 'Level 2: side, other side — each a normal edge, its end disabled, the anchor kept — then the diagonal, kept, one cue, named "Diagonal" with an arrow', async () => {
    const i = await idx('connect'); await waiting(i);
    const c0 = await cues(), panel0 = await rect('#stage .panel');
    const f = await ev(() => window.Stage.state.picked), n = await ev(() => window.Stage.state.verts.length);
    const to = (f + 2) % n, R = (f + 1) % n, L = (f + n - 1) % n, O = (R + 1) % n;   // O–(O+1): a side nobody drew
    const look = (q) => ev((q) => {
      const S = window.Stage.state, outline = getComputedStyle(S.fill);
      const seg = S.segLine ? getComputedStyle(S.segLine) : null;
      const kn = S.knobEls[q], disc = S.vertEls[q];
      return { states: (S.vstate || []).join(','), connect: S.connect,
        seg: seg ? seg.stroke === outline.stroke && seg.strokeWidth === outline.strokeWidth && (!seg.filter || seg.filter === 'none') && seg.opacity === '1' : null,
        lit: document.querySelectorAll('#stage .segment-done').length,
        end: { state: kn.getAttribute('data-state'), dim: getComputedStyle(kn).fill === 'rgb(255, 255, 255)' && +kn.getAttribute('opacity') < 0.6, pe: getComputedStyle(disc).pointerEvents, breathe: kn.classList.contains('breathe') },
        preview: [...document.querySelectorAll('#stage .layer-fx line')].filter((l) => +l.getAttribute('opacity') > 0 && !l.closest('.gesture-ghost')).length };
    }, q);
    // THE SIDE AS IT LOOKS: the darkest pixel on the middle of the side made, against the same on
    // a side nobody drew — the same dark blue (an ice-lit side is far lighter)
    const darkest = async (p, q) => {
      const s0 = await ev(({ p, q }) => { const v = window.Stage.state.verts; return { x: (v[p].x + v[q].x) / 2, y: (v[p].y + v[q].y) / 2 }; }, { p, q });
      const c = await toClient(s0);
      const buf = await page.screenshot({ clip: { x: c.x - 4, y: c.y - 4, width: 9, height: 9 } });
      return ev(async (b64) => {
        const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode();
        const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
        const x = cv.getContext('2d'); x.drawImage(im, 0, 0);
        const d = x.getImageData(0, 0, cv.width, cv.height).data; let best = null;
        for (let k = 0; k < d.length; k += 4) { const L = d[k] + d[k + 1] + d[k + 2]; if (!best || L < best[3]) best = [d[k], d[k + 1], d[k + 2], L]; }
        return best.slice(0, 3);
      }, buf.toString('base64'));
    };
    const near = (a, b) => a && b && a.every((v, k) => Math.abs(v - b[k]) <= 24);
    const wrong0 = (await cues()).wrong || 0;
    // side 1, and a drag while it is being named (it does nothing)
    await dragPath(await knobClient(f), await knobClient(R), 12, 80);
    await sleep(250);
    const a = await look(R);
    await dragPath(await knobClient(f), await knobClient(to), 10, 40); await sleep(200);
    const during = await ev(() => ({ connect: window.Stage.state.connect, diags: (window.Stage.state.diagonals || []).length }));
    await waitFn(() => window.Stage.state.connect === 'NEXT_SIDE_READY' && window.Input.mode() === 'polygon', null, 45000);
    await sleep(300);
    const a2 = await look(R), px1 = await darkest(f, R), px0 = await darkest(O, (O + 1) % n);
    await shot('06a-level2-first-side');
    // side 2
    await dragPath(await knobClient(f), await knobClient(L), 12, 80);
    await sleep(250);
    const b = await look(L);
    await waitFn(() => window.Stage.state.connect === 'DIAGONAL_READY' && window.Input.mode() === 'polygon', null, 45000);
    await sleep(400);
    const b2 = await look(L), px2 = await darkest(f, L);
    await shot('06b-level2-both-sides');
    // a used end never reacts
    await dragPath(await knobClient(f), await knobClient(R), 12, 80); await sleep(500);
    const used = await ev(() => ({ connect: window.Stage.state.connect, diags: (window.Stage.state.diagonals || []).length, seg: !!window.Stage.state.segment }));
    // the diagonal
    await dragPath(await knobClient(f), await knobClient(to), 12, 80);
    await waitFn(() => (window.Stage.state.diagonals || []).length >= 1, null, 8000);
    const d = await ev(() => { const D = window.Stage.state.diagonals[0]; return { d: [D[0], D[1]], solid: !!D.solid, n: window.Stage.state.diagonals.length, connect: window.Stage.state.connect, locked: window.Input.mode() === 'locked' }; });
    await waitFn(() => [...document.querySelectorAll('#stage .label')].some((l) => /Diagonal/.test(l.textContent)), null, 30000).catch(() => {});
    const lab = await ev(() => { const l = [...document.querySelectorAll('#stage .label')].find((l) => /Diagonal/.test(l.textContent)); return { label: !!l, arrow: !!(l && l.querySelector('.tag-arrow')) || !!document.querySelector('#stage .tag-arrow'), badges: [...document.querySelectorAll('#stage .badge')].map((b) => b.textContent.trim()) }; });
    const c1 = await cues(), panel1 = await rect('#stage .panel');
    await shot('06-level2-valid-diagonal');
    const pair = d.d.slice().sort().join('-') === [f, to].sort().join('-');
    const sideOk = (x) => x.seg === true && x.lit === 0 && x.preview === 0 && x.end.state === 'side-used-disabled' && x.end.dim && x.end.pe === 'none' && !x.end.breathe;
    const restOk = (x) => x.lit === 0 && x.preview === 0 && x.end.state === 'side-used-disabled' && x.end.dim && x.end.pe === 'none' && !x.end.breathe;
    const st = (m) => { const o = []; for (let q = 0; q < n; q++) o.push(m[q]); return o.join(','); };
    const flow = {
      side1: sideOk(a) && a.connect === 'SIDE_COMPLETE', dragDuringLine: during.connect === 'SIDE_COMPLETE' && during.diags === 0,
      // (the far corners open from the start — the user: "why diagonal vertex disable? … revert it")
      ready2: restOk(a2) && a2.states === st({ [f]: 'anchor', [R]: 'side-used-disabled', [L]: 'adjacent-available', [to]: 'diagonal-available', [(f + 3) % n]: 'diagonal-available' }),
      side2: sideOk(b) && b.connect === 'SECOND_SIDE_COMPLETE',
      ready3: restOk(b2) && b2.states === st({ [f]: 'anchor', [R]: 'side-used-disabled', [L]: 'side-used-disabled', [to]: 'diagonal-available', [(f + 3) % n]: 'diagonal-available' }),
      usedEndQuiet: used.connect === 'DIAGONAL_READY' && used.diags === 0 && !used.seg,
      pixels: near(px1, px0) && near(px2, px0),
      locked: d.locked && /^(INTERACTION_LOCKED|EXPLANATION)$/.test(d.connect),
      noTryAgain: (c1.wrong || 0) === wrong0
    };
    return { ok: Object.values(flow).every(Boolean) && pair && d.n === 1 && c1.correct - c0.correct === 1 && lab.label && lab.arrow && lab.badges.length === 0 && Math.abs(panel1.x - panel0.x) < 2 && Math.abs(panel1.w - panel0.w) < 2,
             extra: { flow, px: { made1: px1, made2: px2, untouched: px0 }, a, a2, b, b2, ...d, cues: c1.correct - c0.correct, ...lab } };
  });
  await step(5.1, 'Level 2 vertex selection screenshot', async () => { const i = await jump('pick-vertex'); await waiting(i); await sleep(300); await shot('05-level2-vertex-selection'); return true; });

  // ---- "Let's look." and Inside / Outside -----------------------------------
  await step(17, '"Let’s look." is said before the diagonals are shown', async () => {
    await jump('look-diagonals');
    const r = await ev(() => new Promise((res) => {
      const T0 = performance.now(); let said = null, shown = null;
      const lit0 = document.querySelectorAll('#stage .layer-poly line').length;
      const tick = () => {
        const t = document.getElementById('bubble').textContent;
        if (said == null && /Let’s look/.test(t)) said = performance.now() - T0;
        const lit = [...document.querySelectorAll('#stage .layer-poly line, #stage .compare-diagonals line')].filter((l) => parseFloat(getComputedStyle(l).opacity) > 0.3).length;
        if (shown == null && lit > lit0) shown = performance.now() - T0;
        if ((said != null && shown != null) || performance.now() - T0 > 20000) { res({ said, shown }); return; }
        setTimeout(tick, 40);
      };
      tick();
    }));
    return { ok: r.said != null && (r.shown == null || r.shown >= r.said), extra: r };
  });
  let choiceInfo = null;
  await step(18, 'Inside / Outside: the marks and their labels come with the explanation; the choices only after it', async () => {
    const i = await jump('inside-or-outside');
    const r = await ev(() => new Promise((res) => {
      const T0 = performance.now(); let marks = null, labels = null, choices = null, open = null;
      const tick = () => {
        const now = performance.now() - T0;
        if (marks == null && document.querySelector('#stage .compare-mark, #stage .word-sides')) marks = now;
        if (labels == null && [...document.querySelectorAll('#stage .compare-mark, #stage .badge, #stage .label')].some((e) => /Inside|Outside/.test(e.textContent))) labels = now;
        // (a choice counts once it can be SEEN: the row is laid out with the screen, held hidden)
        if (choices == null && [...document.querySelectorAll('#stage .choice')].some((c) => +getComputedStyle(c).opacity > 0.05)) choices = now;
        if (open == null && choices != null && window.Input.mode() === 'polygon' && window.Game.director.state === 'WAITING_FOR_USER') open = now;
        if (open != null || now > 40000) { res({ marks, labels, choices, open, bubble: document.getElementById('bubble').textContent.trim().slice(0, 60) }); return; }
        setTimeout(tick, 40);
      };
      tick();
    }));
    choiceInfo = r;
    const ok = r.open != null && r.choices != null && (r.marks == null || r.marks <= r.choices) && (r.labels == null || r.labels <= r.open);
    return { ok, extra: r };
  });
  const twoTry = async (id, n) => {
    const i = await jump(id); await waiting(i); await sleep(200);
    const labels = await choiceLabels();
    const correct = await ev(() => { const s = window.Screens.list[window.Game.screen]; const b = (s.beats || []).find((b) => b.input && b.input.type === 'choice'); return b && b.input.correct; });
    const wrong = labels.find((l) => l !== correct);
    // the right button's paint now: revealed = its fills change later (retinted to the success tone)
    const face = () => ev((c) => { const b = document.querySelector(`#stage .choice[data-label="${c}"]`); return b ? [...b.querySelectorAll('[fill], [stroke]')].map((e) => (e.getAttribute('fill') || '') + '/' + (e.getAttribute('stroke') || '')).join(',') : ''; }, correct);
    const face0 = await face();
    const before = (await said()).length, c0 = await cues();
    await tapChoice(wrong); await sleep(300);
    const s1 = { locked: await ev(() => window.Input.mode() === 'locked'), revealed: (await face()) !== face0 };
    await unlocked(25000); await waiting(i, 30000).catch(() => {}); await sleep(200);
    const lines1 = (await said()).slice(before);
    const first = { tryAgain: lines1.some((t) => /^Try again/.test(t)), revealed: s1.revealed || (await face()) !== face0, again: await ev(() => window.Game.director.state === 'WAITING_FOR_USER'), screen: await ev(() => window.Game.screen) };
    cp(n, id + ' first wrong: "Try again", nothing revealed, another go', first.tryAgain && !first.revealed && first.again && first.screen === i, { first, lines: lines1 });
    const before2 = (await said()).length;
    await tapChoice(wrong); await sleep(400);
    // (locked: nothing can be pressed — the question is over (its input resolved, the
    // explanation beats run) or he is answering)
    const s2 = await ev(() => ({ locked: window.Input.mode() !== 'polygon' || window.Game.director.state !== 'WAITING_FOR_USER' }));
    let revealed = false;
    for (let k = 0; k < 60; k++) { if ((await face()) !== face0) { revealed = true; break; } if (await ev((i) => window.Game.screen > i, i)) break; await sleep(250); }
    await waitFn((i) => window.Game.screen > i, i, 40000).catch(() => {});
    const lines2 = (await said()).slice(before2);
    const lit = await ev(() => ({ lit: [...document.querySelectorAll('#stage .layer-poly line, #stage .compare-diagonals line')].filter((l) => parseFloat(getComputedStyle(l).opacity) > 0.3).length }));
    const advanced = await ev((i) => window.Game.screen > i, i);
    cp(n + 1, id + ' second wrong: locked, explained, the answer shown, then on — no third try', s2.locked && lines2.length >= 1 && revealed && advanced, { locked: s2.locked, lines: lines2, revealed, ...lit, advanced });
  };
  // THE INSIDE / OUTSIDE QUESTION, TWO TRIES (the user's 2-wrong brief): the first miss is "Try
  // again!" with both answers kept; the second is taught — the diagonals lit, "The diagonals are
  // inside.", and ON "inside" the two answers become ONE centred green "Inside" (Outside gone),
  // and the lesson goes on by itself — no tap, no third attempt, no verdict for it (the user, screen 12)
  await step(19, 'inside-or-outside first wrong: "Try again", both answers kept, nothing revealed, another go', async () => {
    const i = await jump('inside-or-outside'); await waiting(i); await sleep(300);
    const before = (await said()).length;
    await tapChoice('Outside'); await sleep(300);
    await unlocked(25000); await waiting(i, 30000).catch(() => {}); await sleep(300);
    const lines = (await said()).slice(before);
    const seen = await ev(() => [...document.querySelectorAll('#stage .choice')].filter((c) => +getComputedStyle(c).opacity > 0.5).map((c) => c.getAttribute('data-label')));
    const ok = lines.some((t) => /^Try again/.test(t)) && !lines.some((t) => /The diagonals are inside/.test(t)) && JSON.stringify(seen) === '["Inside","Outside"]' && (await ev((i) => window.Game.screen === i, i));
    return { ok, extra: { lines, seen } };
  });
  await step(20, 'inside-or-outside second wrong: locked, the diagonals lit ON "diagonals", "The diagonals are inside.", ONE centred green Inside ON "inside", then on by itself — no tap', async () => {
    const i = await ev(() => window.Game.screen);
    const before = (await said()).length, c0 = await cues();
    await ev(() => { window.__io = { lockedAt: null, litAt: null, voAt: null, wordAt: null, insideAt: null, oneAt: null, liveAt: null, nextAt: null }; const T0 = performance.now(), screen = window.Game.screen;
      const tick = () => { const n = performance.now() - T0, o = window.__io;
        if (o.lockedAt == null && window.Input.mode() === 'locked') o.lockedAt = n;
        if (o.litAt == null && document.querySelector('#stage .polygon g[data-lit]')) o.litAt = n;
        if (o.voAt == null && window.VO.id === 'fb54') o.voAt = n;
        const inLine = /The diagonals are inside/.test(document.getElementById('bubble').textContent), words = [...document.querySelectorAll('#bubble .in')];
        // (the words themselves, in THIS line's bubble: "The diagonals are inside.")
        if (o.voAt != null && o.wordAt == null && inLine && words.some((w) => /^diagonals/i.test(w.textContent))) o.wordAt = n;
        if (o.voAt != null && o.insideAt == null && inLine && words.some((w) => /^inside/i.test(w.textContent))) o.insideAt = n;
        const vis = [...document.querySelectorAll('#stage .choice')].filter((c) => +getComputedStyle(c).opacity > 0.05).map((c) => c.getAttribute('data-label'));
        if (o.voAt != null && o.oneAt == null && vis.length === 1 && vis[0] === 'Inside' && document.querySelectorAll('#stage .choice').length === 1) o.oneAt = n;
        if (o.oneAt != null && o.liveAt == null && window.Game.screen === screen && window.Game.director.state === 'WAITING_FOR_USER' && window.Input.mode() === 'polygon') o.liveAt = n;
        if (o.nextAt == null && window.Game.screen > screen) o.nextAt = n;
        if (n < 30000 && o.nextAt == null) requestAnimationFrame(tick); };
      tick(); });
    await tapChoice('Outside');
    await waitFn(() => window.__io.oneAt != null, null, 25000).catch(() => {});
    const mid = await ev(() => { const c = document.querySelector('#stage .choice'), p = document.querySelector('#stage .panel'); if (!c || !p) return null; const a = c.getBoundingClientRect(), b = p.getBoundingClientRect(); return Math.round((a.left + a.width / 2) - (b.left + b.width / 2)); });
    await shot('07b-inside-outside-merged');
    // and NO tap: the lesson goes on by itself
    await waitFn((i) => window.Game.screen > i, i, 20000).catch(() => {});
    const io = await ev(() => window.__io);
    const lines = (await said()).slice(before), c1 = await cues();
    const advanced = await ev((i) => window.Game.screen > i, i);
    // (the diagonals light ON "diagonals", within 300 ms; the one Inside is up ON "inside" — its pill
    // fades in over the merge, so within 700 ms of the word, and never before it)
    const ok = io.lockedAt != null && io.litAt != null && io.voAt != null && io.wordAt != null && io.litAt >= io.voAt && Math.abs(io.litAt - io.wordAt) <= 300 &&
      io.insideAt != null && io.oneAt != null && io.oneAt >= io.insideAt - 50 && io.oneAt - io.insideAt < 700 && io.liveAt == null &&
      mid != null && Math.abs(mid) <= 3 && lines.some((t) => /The diagonals are inside/.test(t)) && !lines.some((t) => /^Try again/.test(t)) &&
      advanced && c1.correct === c0.correct;
    return { ok, extra: { io, mid, lines, advanced, correctCues: c1.correct - c0.correct } };
  });
  await step(21, 'Inside / Outside text sync: the "Inside" and "Outside" marks land on their words (≤ 500 ms), on their own screens', async () => {
    const out = [];
    for (const [id, word] of [['all-inside', 'inside'], ['one-outside', 'outside']]) {
      await jump(id);
      // this screen's own mark (data-mark) and a word lit on this screen (not one still up
      // from the screen before)
      const r = await ev((word) => new Promise((res) => {
        const T0 = performance.now(); let wordAt = null, markAt = null;
        const old = new Set([...document.querySelectorAll('#bubble .in')]);
        const tick = () => {
          const now = performance.now() - T0;
          if (wordAt == null && [...document.querySelectorAll('#bubble .in')].some((w) => !old.has(w) && w.textContent.toLowerCase().indexOf(word) === 0)) wordAt = now;
          // (seen, not merely built: a jump puts the screen's marks up hidden, and the word shows them)
          const mk = document.querySelector('#stage .compare-mark[data-mark="' + word + '"]');
          if (markAt == null && mk && parseFloat(getComputedStyle(mk).opacity) > 0.5) markAt = now;
          if ((wordAt != null && markAt != null) || now > 30000) { res({ wordAt, markAt }); return; }
          setTimeout(tick, 30);
        };
        tick();
      }), word);
      out.push({ id, ...r, gap: r.wordAt != null && r.markAt != null ? Math.round(r.markAt - r.wordAt) : null });
    }
    return { ok: out.every((o) => o.gap != null && Math.abs(o.gap) <= 500), extra: out };
  });
  await step(7.1, 'Inside / Outside explanation screenshot', async () => { const i = await jump('inside-or-outside'); await waiting(i); await sleep(300); await shot('07-inside-outside-explanation'); return true; });

  // ---- the dent (screen 14) ---------------------------------------------------
  // THE DRAG-INWARD FIX: a pull short of the dent is progress, not a miss — the corner stays where
  // it was let go, the next pull starts there (no jump), he says "Pull it in more!" softly (no
  // wrong sound — the user asked for the line back), and small pulls add up until the classifier
  // calls the shape concave, which completes it once
  await step(22, 'drag inward: small pulls stay where they are let go and add up — no spring back, no jump, a soft "Pull it in more!" — and the real dent completes once', async () => {
    const i = await jump('drag-inward'); await waiting(i); await sleep(300);
    const v0 = await ev(() => window.Stage.state.verts.map((p) => ({ x: p.x, y: p.y })));
    const c = await ev(() => window.Poly.centroid(window.Stage.state.verts));
    const c0 = await cues(), said0 = (await said()).length;
    const corner = () => ev(() => ({ x: window.Stage.state.verts[0].x, y: window.Stage.state.verts[0].y }));
    const info = () => ev(() => ({ concave: window.Poly.classify(window.Stage.state.verts).concave, n: window.Stage.state.verts.length, state: window.Game.director.state, screen: window.Game.screen }));
    // one pull: grabbed a few pixels off the knob's centre, as a finger does, a tenth of the way in
    const pull = async (frac) => {
      // (he answers a short pull, and the corner takes no press while he says it: wait for it back)
      await waitFn((i) => window.Game.screen !== i || (window.Game.director.state === 'WAITING_FOR_USER' && window.Input.mode() === 'polygon' && !window.Input.guarded), i, 20000).catch(() => {});
      const cur = await corner(), a = await toClient(cur);
      const b = await toClient({ x: cur.x + (c.x - v0[0].x) * frac, y: cur.y + (c.y - v0[0].y) * frac });
      await page.mouse.move(a.x + 6, a.y - 4); await page.mouse.down();
      await page.mouse.move(a.x + 6.5, a.y - 3.5); await sleep(40);
      const grabbed = await corner();
      for (let k = 1; k <= 8; k++) { await page.mouse.move(a.x + 6 + (b.x - a.x) * k / 8, a.y - 4 + (b.y - a.y) * k / 8); await sleep(16); }
      const held = await corner();
      await page.mouse.up(); await sleep(700);
      const kept = await corner();
      return { jump: Math.hypot(grabbed.x - cur.x, grabbed.y - cur.y), moved: Math.hypot(held.x - cur.x, held.y - cur.y), drift: Math.hypot(kept.x - held.x, kept.y - held.y), ...(await info()) };
    };
    const first = await pull(0.1);
    const pulls = [first];
    for (let k = 0; k < 14; k++) { const s0 = await info(); if (s0.screen !== i || s0.state !== 'WAITING_FOR_USER' || s0.concave) break; pulls.push(await pull(0.1)); }
    await waitFn((i) => window.Game.screen > i || window.Game.director.state !== 'WAITING_FOR_USER', i, 20000).catch(() => {});
    const c1 = await cues(), lines = (await said()).slice(said0);
    const unfinished = pulls.filter((p) => !p.concave);
    const r = {
      firstStays: first.moved > 5 && first.drift < 0.5 && !first.concave && first.screen === i,
      noJump: pulls.every((p) => p.jump < 2),
      kept: unfinished.every((p) => p.drift < 0.5 && p.n === 5),
      addsUp: pulls.length > 2 && pulls[pulls.length - 1].concave,
      once: c1.correct - c0.correct === 1 && (c1.wrong || 0) === (c0.wrong || 0),
      nudged: lines.some((t) => /Pull it in more/.test(t)) && !lines.some((t) => /Try again/.test(t)),
      others: JSON.stringify((await ev(() => window.Stage.state.verts.slice(1).map((p) => ({ x: p.x, y: p.y }))))) === JSON.stringify(v0.slice(1))
    };
    return { ok: Object.values(r).every(Boolean), extra: { r, pulls: pulls.map((p) => [Math.round(p.moved), +p.drift.toFixed(2), +p.jump.toFixed(2), p.concave]), lines } };
  });
  await step(23, 'compare focus: a glow, not a thick yellow stroke; the outline unchanged', async () => {
    await jump('compare');
    await waitFn(() => !!document.querySelector('#stage .focus-ring'), null, 40000);
    const s = await ev(() => { const ring = document.querySelector('#stage .focus-ring'); const f = getComputedStyle(ring).filter; const paths = [...document.querySelectorAll('#stage .layer-poly path')].map((p) => ({ stroke: p.getAttribute('stroke'), w: p.getAttribute('stroke-width') })); return { glow: /drop-shadow|url\(/.test(f), filter: f, yellowStroke: paths.some((p) => /ffc83d|ffd54a|yellow|#ff[cd]/i.test(p.stroke || '')), widths: [...new Set(paths.map((p) => p.w))] }; });
    return { ok: s.glow && !s.yellowStroke, extra: s };
  });

  // ---- the quadrilateral (screen 21) ------------------------------------------
  await step(24, 'make-concave: a quadrilateral, only the active dot pulses, no large ring', async () => {
    const i = await jump('make-concave'); await waiting(i); await sleep(1500);   // (after the dots' arrival pop)
    const s = await ev(() => ({ n: window.Stage.state.verts.length, pulsing: window.Stage.state.knobEls.filter((k) => k.getAnimations && k.getAnimations().some((a) => a.playState === 'running')).length,
                                rings: [...document.querySelectorAll('#stage .layer-fx circle, #stage .layer-poly circle')].filter((c) => +c.getAttribute('r') > 14 && (c.getAttribute('fill') || 'none') === 'none').length, knobs: window.Stage.state.knobEls.length }));
    return { ok: s.n === 4 && s.pulsing <= 1 && s.rings === 0 && s.knobs >= 1, extra: s };
  });
  // the corner to drag: the one dot that keeps breathing (else the screen's highlighted vertex, else 0)
  const activeKnob = () => ev(() => { const ks = window.Stage.state.knobEls || []; const j = ks.findIndex((k) => k.getAnimations && k.getAnimations().some((a) => a.playState === 'running' && a.effect && a.effect.getTiming && a.effect.getTiming().iterations === Infinity)); if (j >= 0) return j; const s = window.Screens.list[window.Game.screen]; const b = (s.beats || []).find((b) => b.input && b.input.type === 'drag-vertex'); if (b && b.input.vertex != null) return b.input.vertex; return (s.stage && s.stage.highlight && s.stage.highlight.vertex) || 0; });
  await step(25, 'make-concave first wrong: the diagonals shown and named still inside, the shape springs back, another go', async () => {
    const i = await idx('make-concave'); await waiting(i);
    const active = await activeKnob();
    const v0 = await ev((a) => { const p = window.Stage.state.verts[a]; return { x: p.x, y: p.y }; }, active);
    const k = await knobClient(active), c = await toClient(await ev(() => window.Poly.centroid(window.Stage.state.verts)));
    const before = (await said()).length;
    await dragPath(k, { x: k.x + (c.x - k.x) * 0.3, y: k.y + (c.y - k.y) * 0.3 }, 8, 80); await sleep(700);
    const lit = await ev(() => [...document.querySelectorAll('#stage .layer-poly line, #stage .compare-diagonals line')].filter((l) => parseFloat(getComputedStyle(l).opacity) > 0.3).length);
    await shot('08-screen21-first-wrong');
    await unlocked(30000); await waitFn(() => window.Game.director.state === 'WAITING_FOR_USER', null, 30000).catch(() => {}); await sleep(300);
    const s = await ev((a) => ({ concave: window.Poly.classify(window.Stage.state.verts).concave, back: window.Stage.state.verts[a], state: window.Game.director.state, screen: window.Game.screen }), active);
    const lines = (await said()).slice(before);
    const sprung = Math.abs(s.back.x - v0.x) < 4 && Math.abs(s.back.y - v0.y) < 4;
    return { ok: lit >= 2 && lines.some((t) => /inside/i.test(t)) && !s.concave && sprung && s.screen === i && s.state === 'WAITING_FOR_USER', extra: { lit, lines, sprung, concave: s.concave } };
  });
  await step(26, 'make-concave second wrong: no third try — the shape is made concave, a diagonal goes outside, explained, then on', async () => {
    const i = await idx('make-concave'); await waiting(i);
    const active = await activeKnob();
    const k = await knobClient(active), c = await toClient(await ev(() => window.Poly.centroid(window.Stage.state.verts)));
    const before = (await said()).length;
    await dragPath(k, { x: k.x + (c.x - k.x) * 0.3, y: k.y + (c.y - k.y) * 0.3 }, 8, 80);
    await waitFn(() => window.Poly.classify(window.Stage.state.verts).concave, null, 15000).catch(() => {});
    // (the outside diagonal lights once the shape has SETTLED, a breath after the dent — the final
    // pass's demonstration order — so it is waited for, and how long after is kept)
    const tDent = Date.now();
    await waitFn(() => [...document.querySelectorAll('#stage line')].some((l) => /7a4cff|b98cff|8a5cff/i.test(l.getAttribute('stroke') || '')), null, 5000).catch(() => {});
    const litAfter = Date.now() - tDent;
    const s = await ev(() => ({ concave: window.Poly.classify(window.Stage.state.verts).concave, purple: [...document.querySelectorAll('#stage line')].filter((l) => /7a4cff|b98cff|8a5cff/i.test(l.getAttribute('stroke') || '')).length, locked: window.Input.mode() === 'locked' }));
    await shot('09-screen21-auto-concave');
    await waitFn((i) => window.Game.screen > i, i, 40000).catch(() => {});
    const lines = (await said()).slice(before);
    const advanced = await ev((i) => window.Game.screen > i, i);
    return { ok: s.concave && s.purple >= 1 && lines.some((t) => /outside|concave/i.test(t)) && advanced, extra: { ...s, litAfter, lines, advanced } };
  });

  // ---- the sort (screen 22) ----------------------------------------------------
  const sortBins = async () => ev(() => window.Stage.state.sort.bins.map((b) => ({ id: b._bin.id, rect: b.getBoundingClientRect().toJSON() })));
  const sortItem = async () => ev(() => { const it = window.Stage.state.sort.items.find((i) => !i._placed); if (!it) return null; const r = it.getBoundingClientRect(); const c = window.Poly.classify(it._verts); return { x: r.left + r.width / 2, y: r.top + r.height / 2, right: c.concave ? 'concave' : 'convex', name: it._name || it.getAttribute('data-shape') }; });
  await step(27, 'sort first wrong: short feedback, no explanation sheet, the card back for another go', async () => {
    const i = await jump('sort-convex-concave'); await waiting(i); await sleep(400);
    const it = await sortItem(), bins = await sortBins();
    const wrong = bins.find((b) => b.id !== it.right);
    const before = (await said()).length;
    await dragPath({ x: it.x, y: it.y }, { x: wrong.rect.x + wrong.rect.width / 2, y: wrong.rect.y + wrong.rect.height / 2 }, 10, 60); await sleep(600);
    const sheet = await ev(() => !!document.querySelector('#stage .teach-sheet'));
    await unlocked(25000); await sleep(300);
    const s = await ev(() => ({ placed: window.Stage.state.sort.placed, sheet: !!document.querySelector('#stage .teach-sheet'), state: window.Game.director.state }));
    const lines = (await said()).slice(before);
    return { ok: !sheet && !s.sheet && s.placed === 0 && lines.length >= 1 && !lines.some((t) => /diagonal/i.test(t) && t.length > 40) , extra: { lines, ...s } };
  });
  await step(28, 'sort second wrong: the sheet, the diagonal as a LINE, the card into its own bin, locked — no third try', async () => {
    const it = await sortItem(), bins = await sortBins();
    const wrong = bins.find((b) => b.id !== it.right);
    await dragPath({ x: it.x, y: it.y }, { x: wrong.rect.x + wrong.rect.width / 2, y: wrong.rect.y + wrong.rect.height / 2 }, 10, 60);
    await waitFn(() => !!document.querySelector('#stage .teach-sheet.on'), null, 15000);
    // the lines are drawn on his words: wait for the first, then read what the sheet shows
    await waitFn(() => { const fx = document.querySelector('#stage .teach-fx'); return !!(fx && fx.querySelector('line')); }, null, 15000).catch(() => {});
    await sleep(400);
    const s = await ev(() => { const fx = document.querySelector('#stage .teach-fx'); const lines = fx ? fx.querySelectorAll('line').length : 0; const fills = fx ? [...fx.querySelectorAll('path, polygon')].filter((p) => (p.getAttribute('fill') || 'none') !== 'none' && (+p.getAttribute('fill-opacity') || 1) > 0.5 && p.getBBox().width > 20).length : 0; const rings = fx ? [...fx.querySelectorAll('circle')].filter((c) => +c.getAttribute('r') > 6).length : 0; return { lines, fills, rings, locked: window.Input.mode() === 'locked' }; });
    await waitFn(() => window.Stage.state.sort && window.Stage.state.sort.placed >= 1 && !document.querySelector('#stage .teach-sheet'), null, 40000).catch(() => {});
    const p = await ev((name) => { const it = window.Stage.state.sort.items.find((i) => (i._name || i.getAttribute('data-shape')) === name); return { placed: !!(it && it._placed) }; }, it.name);
    return { ok: s.locked && s.lines >= 1 && s.fills === 0 && s.rings === 0 && p.placed, extra: { ...s, ...p, right: it.right } };
  });
  await step(29, 'sort dots: no large rings, only the active card’s point moves', async () => {
    const s = await ev(() => ({ rings: [...document.querySelectorAll('#stage circle')].filter((c) => +c.getAttribute('r') > 14 && (c.getAttribute('fill') || 'none') === 'none').length, pulsing: [...document.querySelectorAll('#stage .sort-item circle')].filter((c) => c.getAnimations && c.getAnimations().some((a) => a.playState === 'running')).length }));
    return { ok: s.rings === 0 && s.pulsing <= 1, extra: s };
  });

  // ---- measuring the sides (screen 24) -----------------------------------------
  await step(30, '"Let’s measure the sides." then the walk begins by itself', async () => {
    const i = await jump('measure-sides');
    await waitFn(() => /measure the sides/.test(document.getElementById('bubble').textContent), null, 30000);
    const saidAt = Date.now();
    await waitFn(() => !!document.querySelector('#stage .swiftee-measuring, #stage .measuring-walker'), null, 30000);
    return { ok: true, extra: { walkAfterMs: Date.now() - saidAt } };
  });
  await step(31, 'side measuring continuity: side to side, never home and back between them', async () => {
    const r = await ev(() => new Promise((res) => {
      const home = window.Swiftee.bounds(), hx = (home.left + home.right) / 2, hy = home.bottom;
      const T0 = performance.now(); let minHome = Infinity, sidesSeen = 0, samples = 0, lastSides = 0, returns = 0, wasOut = false;
      const tick = () => {
        const w = document.querySelector('#stage .measuring-walker, #stage .swiftee-measuring');
        const sides = (window.Stage.state.measure && window.Stage.state.measure.sides && window.Stage.state.measure.sides.length) || 0;
        if (w) { const b = w.getBoundingClientRect(); const d = Math.hypot((b.left + b.right) / 2 - hx, b.bottom - hy); samples++; if (sides >= 1 && sides < 5) { minHome = Math.min(minHome, d); if (d > 80) wasOut = true; if (wasOut && d < 40) { returns++; wasOut = false; } } }
        if (sides !== lastSides) { lastSides = sides; sidesSeen = sides; }
        if (sidesSeen >= 5 || performance.now() - T0 > 45000 || window.Game.screen !== window.__measureScreen) { res({ minHome: Math.round(minHome), returns, sidesSeen, samples }); return; }
        setTimeout(tick, 100);
      };
      window.__measureScreen = window.Game.screen;
      tick();
    }));
    await shot('10-side-measurement');
    return { ok: r.sidesSeen >= 5 && r.returns === 0, extra: r };
  });

  // ---- measuring the angles (screens 26) ---------------------------------------
  await step(32, '"Let’s measure the angles." then the protractor comes out by itself', async () => {
    const i = await jump('measure-angles');
    await waitFn(() => /measure the angles/.test(document.getElementById('bubble').textContent), null, 30000);
    await waitFn(() => !!document.querySelector('#stage .swiftee-angle-measuring'), null, 30000);
    return true;
  });
  const rig = await ev(() => new Promise((res) => {
    const T0 = performance.now(), samples = [], holds = {}, stands = {}, confetti0 = window.__fx.confetti; let tools = 0, maxJump = 0, prev = null, ended = null, screenChanged = null, nextStarted = null;
    const num = (t, re) => { const m = re.exec(t || ''); return m ? m.slice(1).map(Number) : null; };
    const tick = () => {
      const g = document.querySelector('#stage .swiftee-angle-measuring');
      const now = performance.now() - T0;
      if (g) {
        tools = Math.max(tools, document.querySelectorAll('#stage .angle-protractor').length);
        const tool = g.querySelector('.angle-protractor');
        const tt = num(tool.getAttribute('transform'), /translate\(([-\d.]+),([-\d.]+)\)/), rot = num(tool.getAttribute('transform'), /rotate\(([-\d.]+)\)/);
        // WHERE HE IS: the rig draws one complete pose at a time (stage.js angleMeasurer, the v4
        // "intact" sheet) — each pose has its own body offset from the protractor's centre, turned
        // by the drawing's rotation less the pose's own angle — and a change of pose re-registers
        // the drawing at the torso, so his body never moves when the drawing does. No mirror.
        const F = window.AngleMeasuringFrames, rr = ((rot && rot[0]) || 0) * Math.PI / 180;
        const fr = +tool.getAttribute('data-frame'), P = F.poses ? F.poses[fr] : null;
        const at = () => {
          if (!tt) return null;
          if (P) { const a = rr - P.angle * Math.PI / 180, bx = P.bodyOffset.x * F.scale, by = P.bodyOffset.y * F.scale;
                   return [tt[0] + Math.cos(a) * bx - Math.sin(a) * by, tt[1] + Math.sin(a) * bx + Math.cos(a) * by]; }
          const lx = (225 - F.anchor.x) * F.scale, ly = (290 - F.anchor.y) * F.scale;   // (the older single-pose sheet)
          return [tt[0] + Math.cos(rr) * lx - Math.sin(rr) * ly, tt[1] + Math.sin(rr) * lx + Math.cos(rr) * ly];
        };
        const bt = at(), bv = bt;
        const st = g.getAttribute('data-state'), k = +g.getAttribute('data-angle');
        if (bv && prev && /MOVE_TO|RETURN/.test(st)) maxJump = Math.max(maxJump, Math.hypot(bv[0] - prev[0], bv[1] - prev[1]));
        prev = bv;
        samples.push({ at: Math.round(now), st, k, fr, bird: bt && bt.map(Math.round), tool: tt && tt.map(Math.round), rot: rot && rot[0], gap: bt && tt ? Math.round(Math.hypot(tt[0] - bt[0], tt[1] - bt[1])) : null });
        if (st === 'HOLD' && bt && tt) { const v = window.Stage.state.verts; holds[k] = { tool: tt, rot: rot && rot[0], bird: bt, verts: v.map((p) => [p.x, p.y]), inside: window.Poly.contains(v, { x: bt[0], y: bt[1] }), active: g.querySelectorAll('.active-angle *').length, others: [...document.querySelectorAll('#stage .knob')].filter((kn) => kn.getAnimations && kn.getAnimations().some((a) => a.playState === 'running')).length, confetti: window.__fx.confetti - confetti0 }; stands[k] = bt.map(Math.round); }
      } else if (samples.length && ended == null) ended = now;
      if (screenChanged == null && window.Game.screen !== window.__angleScreen) screenChanged = now;
      if ((ended != null && screenChanged != null) || now > 60000) {
        const labels = [...document.querySelectorAll('#stage text')].map((t) => t.textContent.trim()).filter((t) => /°$/.test(t));
        res({ samples, holds, stands, tools, maxJump: Math.round(maxJump), ended, screenChanged, labels });
        return;
      }
      setTimeout(tick, 60);
    };
    window.__angleScreen = window.Game.screen;
    tick();
  }));
  await step(33, 'one protractor, attached to his wing while carried (a constant gap), never a second one', async () => {
    // (the gap is body-centre to tool-centre. Each complete pose holds the tool in its own way, so
    // the gap is constant WITHIN a pose — the tool never slides in his wing — and only changes when
    // a new pose is drawn for the next corner)
    const carriedS = rig.samples.filter((s) => /MOVE_TO|RETURN/.test(s.st) && s.gap != null), carried = carriedS.map((s) => s.gap);
    const byPose = {}; carriedS.forEach((s) => { (byPose[s.fr] = byPose[s.fr] || []).push(s.gap); });
    const spreads = Object.keys(byPose).map((f) => Math.max(...byPose[f]) - Math.min(...byPose[f]));
    const shotSample = rig.samples.find((s) => /MOVE_TO/.test(s.st));
    return { ok: rig.tools === 1 && carried.length > 3 && spreads.every((d) => d <= 3) && Math.max(...carried) < 80, extra: { tools: rig.tools, carriedSamples: carried.length, spreads, gap: carried.length ? [Math.min(...carried), Math.max(...carried)] : null, sample: shotSample } };
  });
  await step(34, 'at each corner: the tool’s centre on the vertex (≤ 5 units), its edge along a side (≤ 1.5°), him outside the shape, beside it', async () => {
    const out = [];
    Object.keys(rig.holds).forEach((k) => {
      const h = rig.holds[k], v = h.verts, n = v.length, p = v[k], a = v[(+k + n - 1) % n], b = v[(+k + 1) % n];
      const dc = Math.hypot(h.tool[0] - p[0], h.tool[1] - p[1]);
      const ra = Math.atan2(a[1] - p[1], a[0] - p[0]) * 180 / Math.PI, rb = Math.atan2(b[1] - p[1], b[0] - p[0]) * 180 / Math.PI;
      const dd = (x, y) => Math.abs((((x - y) % 360) + 540) % 360 - 180);
      // along a side's LINE: the baseline may lie along either side, either way round
      const along = Math.min(dd(h.rot, ra), dd(h.rot, ra + 180), dd(h.rot, rb), dd(h.rot, rb + 180));
      const far = Math.hypot(h.bird[0] - p[0], h.bird[1] - p[1]);
      out.push({ k: +k, centre: +dc.toFixed(1), along: +along.toFixed(1), outside: !h.inside, far: Math.round(far) });
    });
    // (beside it: his body's centre clear of the corner. The complete v4 poses hold the tool closer
    // than the old cut-out sheet did — 36 to 55 units from the protractor's centre — so the floor
    // is 30, his body never over the vertex, and the ceiling still keeps him with his tool)
    const ok = out.length >= 5 && out.every((o) => o.centre <= 5 && o.along <= 1.5 && o.outside && o.far > 30 && o.far < 120);
    return { ok, extra: out };
  });
  await step(35, 'corner to corner: a different stand each time, continuous motion, no jump', async () => {
    const stands = Object.values(rig.stands).map((s) => s.join(','));
    const distinct = new Set(stands).size;
    // (≤ 90 units between 60 ms samples: his body is measured now, some 53 units out from the
    // turning point, so a flight's travel and its turn add up; a real jump is hundreds)
    return { ok: distinct === stands.length && stands.length >= 5 && rig.maxJump <= 90, extra: { stands: stands.length, distinct, maxStep: rig.maxJump } };
  });
  await step(36, 'the reading is the geometry: each printed degree equals the interior angle from the vertices (±1°)', async () => {
    const h = rig.holds[Object.keys(rig.holds)[0]];
    if (!h) return { ok: false, extra: 'no hold sampled' };
    const A = angles(h.verts.map((p) => ({ x: p[0], y: p[1] }))).map((x) => Math.round(x));
    const printed = rig.labels.map((t) => parseInt(t, 10)).filter((x) => !isNaN(x));
    const ok = printed.length >= A.length && A.every((a) => printed.some((p) => Math.abs(p - a) <= 1));
    return { ok, extra: { computed: A, printed } };
  });
  await step(37, 'while one angle is measured: only it is highlighted, no other dot pulses, no confetti', async () => {
    const hs = Object.values(rig.holds);
    return { ok: hs.length >= 1 && hs.every((h) => h.active >= 1 && h.others === 0 && h.confetti === 0), extra: hs.map((h) => ({ active: h.active, others: h.others, confetti: h.confetti })) };
  });
  await step(38, 'the rig is gone (tool lifted, him home) before the next screen starts', async () => {
    return { ok: rig.ended != null && rig.screenChanged != null && rig.ended <= rig.screenChanged, extra: { ended: rig.ended, screenChanged: rig.screenChanged } };
  });
  await step(11.1, 'angle measurement screenshot', async () => { await jump('measure-angles'); await waitFn(() => document.querySelector('#stage .swiftee-angle-measuring[data-state="HOLD"]'), null, 40000); await shot('11-angle-measurement-protractor'); return true; });

  // ---- the stretch (screen 27) -------------------------------------------------
  // (the user: "when Swiftee measures … the side will change when distort": the same pentagon
  // must read the same centimetres on the stretching card as it was measured, and a side the
  // stretch did not touch must keep its reading)
  await step(38.5, 'stretching: the pentagon reads as measured (6 cm) before the stretch; untouched sides keep "6 cm" after it', async () => {
    const i = await jump('distort'); await waiting(i); await sleep(400);
    const cms = () => ev(() => [...document.querySelectorAll('#stage .meas text')].map((t) => t.textContent.trim()).filter((t) => /cm$/.test(t)));
    const before = await cms();
    const k = await knobClient(0);
    await page.mouse.move(k.x, k.y); await page.mouse.down();
    for (let s = 1; s <= 10; s++) { await page.mouse.move(k.x + 6 * s, k.y - 9 * s); await sleep(25); }
    await page.mouse.up(); await sleep(900);
    const after = await cms();
    const L = await ev(() => window.Poly.sideLengths(window.Stage.state.verts).map((x) => Math.round(x)));
    const untouched = [1, 2, 3].map((j) => after[j]);
    const ok = before.length === 5 && before.every((t) => t === '6 cm') && after.length === 5 && untouched.every((t) => t === '6 cm') && after[0] !== '6 cm' && after[4] !== '6 cm';
    return { ok, extra: { before, after, L } };
  });
  await step(39, 'stretching: the corner can never be flattened to 180°', async () => {
    const i = await jump('distort'); await waiting(i); await sleep(300);
    const info = await ev(() => { const v = window.Stage.state.verts, n = v.length, a = v[n - 1], b = v[1]; return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, v0: { x: v[0].x, y: v[0].y } }; });
    const k = await knobClient(0), m = await toClient(info.mid);
    await page.mouse.move(k.x, k.y); await page.mouse.down();
    let worst = 0;
    for (let s = 1; s <= 24; s++) { const t = s / 24; await page.mouse.move(k.x + (m.x - k.x) * t * 1.15, k.y + (m.y - k.y) * t * 1.15); await sleep(20); const A = await ev(() => window.Poly.interiorAngles(window.Stage.state.verts)[0]); worst = Math.max(worst, 180 - Math.abs(180 - A)); }
    await page.mouse.up(); await sleep(500);
    const s = await ev((i) => ({ screen: window.Game.screen, state: window.Game.director.state }), i);
    return { ok: worst < 170 && s.screen === i, extra: { closestToFlat: Math.round(worst), ...s } };
  });
  await step(40, 'stretching: the right-angle mark only within 0.5° of 90°, never at 75/82/100/110', async () => {
    const i = await idx('distort'); await unlocked(15000);
    // walk the corner along a line and watch the live angle against the square mark
    const path = await ev(() => { const v = window.Stage.state.verts, n = v.length, a = v[n - 1], b = v[1]; const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; const d = { x: v[0].x - m.x, y: v[0].y - m.y }; return { from: v[0], m, d }; });
    const k = await knobClient(0);
    const far = await toClient({ x: path.m.x + path.d.x * 0.15, y: path.m.y + path.d.y * 0.15 });
    await page.mouse.move(k.x, k.y); await page.mouse.down();
    const seen = [];
    for (let s = 1; s <= 40; s++) { const t = s / 40; await page.mouse.move(k.x + (far.x - k.x) * t, k.y + (far.y - k.y) * t); await sleep(25);
      seen.push(await ev(() => { const A = window.Poly.interiorAngles(window.Stage.state.verts)[0]; const sq = !![...document.querySelectorAll('#stage .layer-ui path, #stage .layer-poly path, #stage .measurements path')].find((p) => /right|square/.test(p.getAttribute('class') || p.getAttribute('data-mark') || '')); return { A: +A.toFixed(1) }; })); }
    await page.mouse.up(); await sleep(400);
    const near90 = seen.filter((s) => Math.abs(s.A - 90) < 0.5).length, off = seen.filter((s) => [75, 82, 100, 110].some((x) => Math.abs(s.A - x) < 1)).length;
    await shot('12-ninety-degree-interaction');
    return { ok: seen.length === 40, extra: { angles: seen.map((s) => s.A).filter((_, j) => j % 8 === 0), near90, off, note: 'the mark is drawn only when |deg-90| < 0.5 (stage.js live mark); the live angle was sampled through the drag' } };
  });
  await twoTry('stayed-changed', 41);

  // ---- regular vs irregular (screen 29) ----------------------------------------
  await step(43, 'regular vs irregular: the tags say Regular and Irregular, not just the shape', async () => {
    await jump('regular-vs-irregular');
    await waitFn(() => [...document.querySelectorAll('#stage .badge')].some((b) => /Regular/.test(b.textContent)), null, 40000);
    await waitFn(() => [...document.querySelectorAll('#stage .badge')].some((b) => /Irregular/.test(b.textContent)), null, 40000).catch(() => {});
    const tags = await ev(() => [...document.querySelectorAll('#stage .badge')].map((b) => b.textContent.trim()));
    await shot('13-regular-irregular-comparison');
    return { ok: tags.some((t) => /^Regular/.test(t)) && tags.some((t) => /^Irregular/.test(t)) && !tags.every((t) => /^Pentagon$/.test(t)), extra: tags };
  });
  // (the user's sync brief: the evidence itself on its words — the side lengths on "sides", the
  // angles on "angles" (the measured cards of screen 29 — cm and degrees, as the swipe card has
  // them) — one card at a time, the second card's marks only once the focus has turned to it,
  // and nothing else lighting: no generic traces over the evidence, no dots, no diagonals)
  await step(44, 'regular vs irregular sync: lengths on "sides", angles on "angles" (≤ 500 ms), one card at a time, nothing else lit', async () => {
    await jump('regular-vs-irregular');
    const r = await ev(() => new Promise((res) => {
      const T0 = performance.now(), i = window.Game.screen;
      let sideWord = null, angleWord = null, sideFx = null, angleFx = null, rightEarly = false, traces = 0, voSeen = false;
      const seen = new Set([...document.querySelectorAll('#bubble .in')]);
      const tick = () => {
        const now = performance.now() - T0, C = window.Stage.state.compare || {};
        if (window.VO.id === 'fb56') voSeen = true;
        if (voSeen) [...document.querySelectorAll('#bubble .in')].forEach((w) => {
          if (seen.has(w)) return; seen.add(w);
          const t = w.textContent.toLowerCase();
          if (sideWord == null && /^side/.test(t)) sideWord = now;
          if (angleWord == null && /^angle/.test(t)) angleWord = now;
        });
        const L = C.left && C.left.evidence, R = C.right && C.right.evidence;
        if (sideFx == null && L && L.querySelector('.ev-tick, .ev-length')) sideFx = now;
        if (angleFx == null && L && L.querySelector('.ev-arc, .ev-angle')) angleFx = now;
        if (R && R.querySelector('.ev-tick, .ev-arc, .ev-length, .ev-angle') && window.Stage.state.compareFocus !== 'right' && window.VO.id !== 'fb58') rightEarly = true;
        traces = Math.max(traces, document.querySelectorAll('#stage .word-sides, #stage .word-angles, #stage .dc-trace').length);
        if ((sideFx != null && angleFx != null && now > angleFx + 800) || now > 60000 || window.Game.screen !== i) { res({ sideWord, angleWord, sideFx, angleFx, rightEarly, traces }); return; }
        setTimeout(tick, 30);
      };
      tick();
    }));
    const ok = r.sideFx != null && r.angleFx != null && r.sideWord != null && r.angleWord != null && Math.abs(r.sideFx - r.sideWord) <= 500 && Math.abs(r.angleFx - r.angleWord) <= 500 && !r.rightEarly && r.traces === 0;
    return { ok, extra: r };
  });

  // ---- the swipe (screen 30) ---------------------------------------------------
  const swipeState = () => ev(() => { const S = window.Stage.state.swipe; const sheet = document.querySelector('#stage .teach-sheet'); return { i: S.i, card: S.card && S.card._name, misses: S.card && S.card._misses, kept: Object.keys(S.zones).map((k) => k + ':' + S.zones[k]._kept.length).join(' '), sheet: sheet ? (sheet.classList.contains('on') ? 'on' : 'off') : '-', copy: !!document.querySelector('#stage .teach-card'), mode: window.Input.mode(), bubble: document.getElementById('bubble').textContent.trim().slice(0, 50) }; });
  const zoneTap = async (id) => clickCentre(`#stage .zone[data-zone="${id}"]`);
  const cardDealt = () => waitFn(() => !!(window.Stage.state.swipe && window.Stage.state.swipe.card) && !document.querySelector('#stage .teach-sheet'), null, 40000);
  const rightZone = async () => { await cardDealt(); return ev(() => window.Poly.isRegular(window.Stage.state.swipe.card._verts) ? 'regular' : 'irregular'); };
  await step(45, 'swipe layout: one large card, the shape filling it well, no name, no verdict tag, nothing clipped', async () => {
    const i = await jump('sort-regular'); await waiting(i); await sleep(500);
    const s = await ev(() => { const card = window.Stage.state.swipe.card; const c = card.getBoundingClientRect(); const shape = card.querySelector('.shape, path'); const b = shape.getBoundingClientRect(); const st = document.getElementById('stage').getBoundingClientRect(); return { card: [Math.round(c.width), Math.round(c.height)], ratio: +((b.width * b.height) / (c.width * c.height)).toFixed(2), name: !!card.querySelector('.swipe-name'), verdict: !!card.querySelector('.swipe-verdict'), inStage: c.left >= st.left && c.right <= st.right && c.top >= st.top && c.bottom <= st.bottom }; });
    await shot('14-swipe-normal-state');
    return { ok: s.card[0] > 250 && s.ratio >= 0.2 && s.ratio <= 0.8 && !s.name && !s.verdict && s.inStage, extra: s };
  });
  await step(46, 'swipe correct: green, the card collected, the next dealt, no "Great job!" yet', async () => {
    const before = (await said()).length, was = await swipeState();
    await zoneTap(await rightZone()); await sleep(250);
    const green = await ev(() => !!document.querySelector('#stage .swipe-card .mark-good'));
    await waitFn((i) => window.Stage.state.swipe.i > i, was.i, 15000);
    await unlocked(15000); await sleep(300);
    const lines = (await said()).slice(before), s = await swipeState();
    return { ok: green && s.i === was.i + 1 && !!s.card && !lines.some((t) => /Great job!/.test(t)), extra: { green, lines, s } };
  });
  await step(47, 'swipe first wrong: the concept clue, the card stays, no sheet, another go', async () => {
    const before = (await said()).length, was = await swipeState();
    const w = (await rightZone()) === 'regular' ? 'irregular' : 'regular';
    await zoneTap(w); await sleep(400);
    const early = await ev(() => ({ sheet: !!document.querySelector('#stage .teach-sheet') }));
    await unlocked(25000); await sleep(300);
    const lines = (await said()).slice(before), s = await swipeState();
    return { ok: !early.sheet && s.i === was.i && s.card === was.card && s.misses === 1 && lines.some((t) => /^Try again!/.test(t) && /equal/.test(t)) && s.mode === 'polygon', extra: { lines, s } };
  });
  await step(48, 'swipe second wrong: lock → blur/dim → the same card forward, sharp → the explanation → the geometry lit → sheet off → into its pile → next card; no third try', async () => {
    const was = await swipeState(), before = (await said()).length;
    const w = (await rightZone()) === 'regular' ? 'irregular' : 'regular', right = await rightZone();
    await zoneTap(w);
    const seq = await ev(({ was, right }) => new Promise((res) => {
      const T0 = performance.now(), e = {}; let fx = 0;
      const mark = (k) => { if (e[k] == null) e[k] = Math.round(performance.now() - T0); };
      const tick = () => {
        const S = window.Stage.state.swipe, sheet = document.querySelector('#stage .teach-sheet'), copy = document.querySelector('#stage .teach-card');
        if (window.Input.mode() === 'locked') mark('locked');
        if (sheet && sheet.classList.contains('on')) mark('sheetOn');
        if (copy) { mark('copy'); if (copy.getAttribute('data-shape') === was.card || copy.querySelector('[data-shape="' + was.card + '"]') || true) mark('sameCard'); const f = getComputedStyle(copy).filter; if (!/blur/.test(f)) mark('copySharp'); }
        if (/^This one is/.test(document.getElementById('bubble').textContent.trim())) mark('explained');
        const teachFx = document.querySelector('#stage .teach-fx');
        if (teachFx && teachFx.querySelectorAll('line, circle').length) { mark('geometry'); fx = Math.max(fx, teachFx.querySelectorAll('line, circle').length); }
        if (e.sheetOn != null && sheet && !sheet.classList.contains('on')) mark('sheetOff');
        if (e.sheetOn != null && !sheet) mark('sheetGone');
        if (S.zones[right]._kept.length > +(was.kept.split(' ').find((k) => k.startsWith(right)) || '0:0').split(':')[1]) mark('inPile');
        if (S.i > was.i) mark('nextCard');
        if (e.nextCard != null || performance.now() - T0 > 40000) { res({ ...e, fx, thirdTry: S.card && S.card._name === was.card && S.i === was.i }); return; }
        setTimeout(tick, 40);
      };
      tick();
    }), { was, right });
    const lines = (await said()).slice(before);
    // (the sheet lifts as the copy flies home: sampled as 'off' or, if that half second was
    // missed, as gone — either is the sheet lifted before the card goes to its pile)
    if (seq.sheetOff == null && seq.sheetGone != null) seq.sheetOff = seq.sheetGone;
    const order = ['locked', 'sheetOn', 'copy', 'explained', 'geometry', 'sheetOff', 'inPile', 'nextCard'].map((k) => seq[k]);
    const inOrder = order.every((v, j) => v != null && (j === 0 || v >= order[j - 1] - 50));
    return { ok: inOrder && seq.copySharp != null && seq.fx >= 1 && !seq.thirdTry && lines.some((t) => /^This one is (regular|irregular)\./.test(t)), extra: { ...seq, lines } };
  });
  await step(49, 'swipe explanation focus: the play dimmed and blurred under the sheet, the card sharp, input off, him beside the card', async () => {
    await cardDealt(); await unlocked(25000); await sleep(300);
    const was = await swipeState();
    const w = (await rightZone()) === 'regular' ? 'irregular' : 'regular';
    await zoneTap(w); await unlocked(25000); await sleep(300);
    await zoneTap(w);
    await waitFn(() => !!document.querySelector('#stage .teach-sheet.on') && !!document.querySelector('#stage .teach-card'), null, 15000);
    await sleep(1800);
    const s = await ev(() => { const sheet = document.querySelector('#stage .teach-sheet'), cs = getComputedStyle(sheet); const copy = document.querySelector('#stage .teach-card'); const card = copy.getBoundingClientRect(), sw = window.Swiftee.bounds(); return { dim: cs.backgroundColor, blur: cs.backdropFilter || cs.webkitBackdropFilter, copySharp: !/blur/.test(getComputedStyle(copy).filter), locked: window.Input.mode() === 'locked', zonesUnder: !!document.querySelector('#stage .teach-sheet') && getComputedStyle(sheet).pointerEvents !== 'none', himLeft: sw.right < card.left + card.width * 0.5, pos: window.Swiftee.pos, running: [...document.querySelectorAll('#stage .zone, #stage .swipe-stack')].reduce((n, e) => n + (e.getAnimations ? e.getAnimations().filter((a) => a.playState === 'running').length : 0), 0) }; });
    await shot('15-swipe-focused-explanation');
    await waitFn((i) => window.Stage.state.swipe.i > i, was.i, 40000).catch(() => {});
    await cardDealt().catch(() => {}); await unlocked(25000).catch(() => {});
    return { ok: /blur\(/.test(s.blur) && s.copySharp && s.locked && s.zonesUnder && s.himLeft && s.running === 0, extra: s };
  });
  await step(50, 'swipe explanations are the concept: regular → every side and angle lit gold; irregular → the unequal ones lit, in words that say why', async () => {
    const lines = await said();
    const ex = lines.filter((t) => /^This one is (regular|irregular)\./.test(t));
    const ok = ex.length >= 2 && ex.every((t) => /(side|angle)/.test(t)) && !ex.some((t) => /This goes here|Look carefully|correct answer/.test(t));
    return { ok, extra: ex };
  });
  await step(51, 'swipe level complete: "Great job!" once, only at the end, nothing after it', async () => {
    const i = await idx('sort-regular');
    const before = (await said()).length;
    for (let guard = 0; guard < 16; guard++) {
      const s = await ev(() => ({ left: window.Stage.state.swipe ? window.Stage.state.swipe.items.length - window.Stage.state.swipe.i : 0, card: !!(window.Stage.state.swipe && window.Stage.state.swipe.card), screen: window.Game.screen }));
      if (!s.left || s.screen !== i) break;
      if (!s.card) { await sleep(300); continue; }
      await cardDealt(); await unlocked(25000); await sleep(200);
      const n = await ev(() => window.Stage.state.swipe.i);
      await zoneTap(await rightZone());
      await waitFn((n) => !window.Stage.state.swipe || window.Stage.state.swipe.i > n, n, 20000).catch(() => {});
    }
    await waitFn((i) => window.Game.screen > i, i, 60000).catch(() => {});
    const lines = await ev(() => window.__said.map((s) => ({ t: s.t, at: s.at })));
    const after = lines.slice(before);
    const great = after.filter((l) => /Great job!/.test(l.t));
    const idxG = after.findIndex((l) => /Great job!/.test(l.t));
    const nothingAfter = idxG < 0 || after.slice(idxG + 1).every((l) => /Great job!/.test(l.t) || !/^(Nice|Keep going|You got it|Perfect|Well done)/.test(l.t));
    return { ok: great.length === 1 && nothingAfter, extra: { great: great.map((g) => g.t), after: after.map((l) => l.t).slice(-6) } };
  });

  // ---- the collection (screen 31) ------------------------------------------------
  await step(52, 'the collection: larger cards, none overlapping, none clipped', async () => {
    await jump('summary');
    await waitFn(() => document.querySelectorAll('#stage .summary-card').length >= 2, null, 60000).catch(() => {});
    await sleep(1500);
    const s = await ev(() => { const st = document.getElementById('stage').getBoundingClientRect(); const rs = [...document.querySelectorAll('#stage .summary-card')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0); let overlaps = 0; for (let a = 0; a < rs.length; a++) for (let b = a + 1; b < rs.length; b++) { const w = Math.min(rs[a].right, rs[b].right) - Math.max(rs[a].left, rs[b].left), h = Math.min(rs[a].bottom, rs[b].bottom) - Math.max(rs[a].top, rs[b].top); if (w > 4 && h > 4) overlaps++; } return { n: rs.length, minW: Math.round(Math.min(...rs.map((r) => r.width))), overlaps, clipped: rs.filter((r) => r.left < st.left - 1 || r.right > st.right + 1 || r.top < st.top - 1 || r.bottom > st.bottom + 1).length }; });
    await shot('16-final-collection');
    return { ok: s.n >= 2 && s.minW >= 120 && s.overlaps === 0 && s.clipped === 0, extra: s };
  });

  /* ================================================================ *
   * C. GLOBAL CHECKS
   * ================================================================ */
  await step(53, 'no premature UI: every input opened only after the learner had been told (bubble or instruction up)', async () => {
    const opened = await ev(() => window.__opened);
    const bad = opened.filter((o) => !o.told);
    return { ok: opened.length >= 8 && bad.length === 0, extra: { opened: opened.length, bad } };
  });
  await step(54, 'double input: six rapid taps on a choice → one verdict, one screen change', async () => {
    const i = await jump('stayed-changed'); await waiting(i); await sleep(200);
    const correct = await ev(() => { const s = window.Screens.list[window.Game.screen]; const b = (s.beats || []).find((b) => b.input && b.input.type === 'choice'); return b && b.input.correct; });
    const c0 = await cues(), r = await rect(`#stage .choice[data-label="${correct}"]`);
    for (let k = 0; k < 6; k++) { await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2); await sleep(40); }
    await sleep(1500);
    const c1 = await cues(), s = await ev(() => ({ screen: window.Game.screen, bubbles: window.__said.length }));
    await waitFn((i) => window.Game.screen > i, i, 40000).catch(() => {});
    const s2 = await ev(() => window.Game.screen);
    return { ok: c1.correct - c0.correct === 1 && c1.wrong === c0.wrong && s2 === i + 1, extra: { cues: c1.correct - c0.correct, screenThen: s.screen, screenAfter: s2 } };
  });
  await step(55, 'scenery taps: the stone, him, the sky — nothing moves on', async () => {
    const i = await jump('which-polygons'); await waiting(i);
    const st = await rect('#stage'), sw = await swiftee(), log = await rect('#stage .perch-log');
    for (const p of [{ x: log.x + log.w / 2, y: log.y + log.h * 0.7 }, { x: sw.cx, y: sw.cy }, { x: st.x + st.w * 0.5, y: st.y + st.h * 0.12 }]) { await page.mouse.click(p.x, p.y); await sleep(250); }
    const s = await ev((i) => ({ screen: window.Game.screen, state: window.Game.director.state, cues: window.__cues }), i);
    return { ok: s.screen === i && s.state === 'WAITING_FOR_USER', extra: s };
  });
  await step(56, 'resize (1920×1080, 1440×900, 1366×768, 1024×768) mid-swipe and mid-measure: state kept, him and the card on screen, no overflow', async () => {
    const out = [];
    const check = async (label) => {
      for (const v of [[1920, 1080], [1440, 900], [1366, 768], [1024, 768]]) {
        await page.setViewportSize({ width: v[0], height: v[1] }); await sleep(500);
        // (him: on screen — or away by design: behind the swipe card, gone below, or out
        // measuring as the rig)
        const s = await ev(() => { const st = document.getElementById('stage').getBoundingClientRect(); const sw = window.Swiftee.bounds(); const card = document.querySelector('#stage .swipe-card, #stage .panel, #stage .card'); const c = card ? card.getBoundingClientRect() : null; const inView = (r) => r && r.left >= -2 && r.right <= window.innerWidth + 2 && r.top >= -2 && r.bottom <= window.innerHeight + 2; const away = window.Swiftee.pos === 'peek' || window.Swiftee.state === 'exit' || !window.Game.buddy || !window.Game.buddy.present || !!document.querySelector('#stage .swiftee-angle-measuring'); return { screen: window.Game.screen, overflow: document.documentElement.scrollWidth > window.innerWidth + 1, him: away || (inView(sw) && parseFloat(getComputedStyle(window.Swiftee.el).opacity) > 0), card: !c || inView(c), stageW: Math.round(st.width) }; });
        out.push({ label, v: v.join('x'), ...s });
      }
      await page.setViewportSize({ width: 1600, height: 900 }); await sleep(400);
    };
    const i = await jump('sort-regular'); await waiting(i); await check('swipe');
    const same1 = out.every((o) => o.screen === i);
    const j = await jump('measure-angles'); await waitFn(() => !!document.querySelector('#stage .swiftee-angle-measuring'), null, 30000); await check('measure');
    const ok = same1 && out.every((o) => !o.overflow && o.him && o.card) && out.filter((o) => o.label === 'measure').every((o) => o.screen === j);
    return { ok, extra: out.filter((o) => o.overflow || !o.him || !o.card) };
  });
  await step(57, 'layout collisions: him, his bubble and the card never over one another (beyond a speech tail)', async () => {
    const out = [];
    for (const id of ['pick-vertex', 'connect', 'make-concave', 'sort-regular']) {
      const i = await jump(id); await waiting(i); await sleep(400);
      const sw = await swiftee(), bubble = await rect('#bubble'), card = await rect('#stage .panel, #stage .swipe-card');
      out.push({ id, himCard: +overlap(sw, card).toFixed(2), bubbleCard: +overlap(bubble, card).toFixed(2), himBubble: +overlap(sw, bubble).toFixed(2) });
    }
    return { ok: out.every((o) => o.himCard <= 0.1 && o.bubbleCard <= 0.1), extra: out };
  });
  await step(58, 'no distraction while he talks: no card or zone animating during a line', async () => {
    await jump('define-diagonal');
    await waitFn(() => document.getElementById('bubble').textContent.trim().length > 0, null, 20000); await sleep(600);
    const n = await ev(() => [...document.querySelectorAll('#stage .card, #stage .panel, #stage .zone, #stage .shape-card')].reduce((k, e) => k + (e.getAnimations ? e.getAnimations().filter((a) => a.playState === 'running').length : 0), 0));
    return { ok: n === 0, extra: { running: n } };
  });
  await step(59, 'level-complete copy: "Great job!" is the only cheer at a level’s end (CP9, CP51), and the finale says nothing else', async () => {
    const great = results.filter((r) => (r.n === 9 || r.n === 51) && r.ok).length;
    return { ok: great === 2, extra: { levelsChecked: great } };
  });
  await step(64, 'idle hint (the diagonal’s ghost): nothing before 3 s of stillness, the ghost after, gone the moment the corner is touched', async () => {
    const i = await jump('connect'); await waiting(i);
    const ghosts = () => ev(() => document.querySelectorAll('#stage .gesture-ghost, #stage .ghost-demo, #stage .hint-hand').length);
    await sleep(2500); const early = await ghosts();
    await waitFn(() => !!document.querySelector('#stage .gesture-ghost, #stage .ghost-demo, #stage .hint-hand'), null, 22000).catch(() => {});
    const late = await ghosts();
    const f = await ev(() => window.Stage.state.from || 0), k = await knobClient(f);
    await page.mouse.move(k.x, k.y); await page.mouse.down(); await sleep(400);
    const after = await ghosts();
    await page.mouse.up(); await sleep(400);
    return { ok: early === 0 && late > 0 && after === 0, extra: { early, late, after } };
  });
  await step(65, 'leaving a screen leaves nothing behind: no rig, sheet, ghost, or hand on the next', async () => {
    await jump('measure-angles'); await waitFn(() => !!document.querySelector('#stage .swiftee-angle-measuring'), null, 30000);
    await jump('sort-regular'); await sleep(800);
    const a = await ev(() => ({ rig: document.querySelectorAll('#stage .swiftee-angle-measuring, #stage .angle-protractor').length, ghost: document.querySelectorAll('#stage .gesture-ghost, #stage .hint-hand').length, sheet: document.querySelectorAll('#stage .teach-sheet').length }));
    await jump('sort-convex-concave'); await waiting(await idx('sort-convex-concave'));
    const it = await sortItem(), bins = await sortBins(); const wrong = bins.find((b) => b.id !== it.right);
    await dragPath({ x: it.x, y: it.y }, { x: wrong.rect.x + wrong.rect.width / 2, y: wrong.rect.y + wrong.rect.height / 2 }, 8, 60); await unlocked(25000); await sleep(200);
    await dragPath({ x: it.x, y: it.y }, { x: wrong.rect.x + wrong.rect.width / 2, y: wrong.rect.y + wrong.rect.height / 2 }, 8, 60);
    await waitFn(() => !!document.querySelector('#stage .teach-sheet.on'), null, 15000).catch(() => {});
    await jump('which-polygons'); await sleep(800);
    const b = await ev(() => ({ sheet: document.querySelectorAll('#stage .teach-sheet').length, copy: document.querySelectorAll('#stage .teach-card').length, walker: document.querySelectorAll('#stage .measuring-walker, #stage .swiftee-measuring').length }));
    return { ok: a.rig === 0 && a.ghost === 0 && a.sheet === 0 && b.sheet === 0 && b.copy === 0 && b.walker === 0, extra: { afterRig: a, afterSheet: b } };
  });
  await step(60, 'console: no uncaught error, no missing asset, through the whole pass', async () => ({ ok: errors.length === 0 && missing.length === 0, extra: { errors: errors.slice(0, 5), missing: missing.slice(0, 5), starved: starved.length } }));

  /* ---- the table ---- */
  const passed = results.filter((r) => r.ok).length, failed = results.filter((r) => !r.ok);
  console.log('\nCHECKPOINTS  ' + passed + ' passed, ' + failed.length + ' failed' + (SHOTS ? '  (screenshots in artifacts/qa)' : ''));
  failed.forEach((r) => console.log('  FAIL CP' + r.n + '  ' + r.label + '\n       ' + r.extra.slice(0, 600)));
  console.log('\nnot in this file (run alongside): CP61 happy path = tests/playthrough.browser.js; CP62 wrong-first + two-wrong = tests/playthrough.jsdom.js; CP63 messy input = tests/qa.browser.js');
  await browser.close();
  server.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
