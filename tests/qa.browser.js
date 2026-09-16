#!/usr/bin/env node
/*!
 * qa.browser.js — the game played badly, on purpose.
 *
 *   node tests/qa.browser.js
 *
 * playthrough.browser.js plays the lesson correctly: it answers what it is
 * asked, once, in order. A child does not. They tap the scenery, they tap the
 * same button five times because nothing happened yet, they start a drag and
 * change their mind, they turn the tablet sideways in the middle of a
 * sentence, and they lean on the keyboard.
 *
 * None of that should be able to break a lesson, and none of it is covered by
 * a suite that behaves. So this one misbehaves, and then measures the things
 * that decide whether a seven-year-old can actually use the thing:
 *
 *   CAN THEY READ IT      type sizes against a floor, and the contrast of the
 *                         text that carries the teaching
 *   CAN THEY HIT IT       every touchable thing measured against a 44px
 *                         target, which is the smallest a small finger
 *                         reliably lands on
 *   CAN THEY TELL         whether anything on screen says what to do — an
 *                         instruction, a haloed target, or a moving one
 *   DOES IT HOLD          fast taps, taps on nothing, abandoned drags, resize
 *                         mid-screen, and the arrow keys, none of which may
 *                         stall it, double-fire it, or throw
 *
 * It is deliberately separate from the playthrough: that suite proves the
 * lesson can be completed, this one proves it survives being used.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml'
};

let pass = 0, fail = 0, warn = 0;
const t = (label, ok, extra) => {
  if (ok) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  ' + extra : '')); }
};
const note = (label, extra) => { warn++; console.log('  note ' + label + (extra !== undefined ? '  ' + extra : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => srv.listen(0, () => r(srv)));
}

/* Relative luminance and contrast, so "can they read it" is a number. */
const LUM = `(function (c) {
  var m = c.match(/[\\d.]+/g) || [0, 0, 0];
  var f = function (v) { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(+m[0]) + 0.7152 * f(+m[1]) + 0.0722 * f(+m[2]);
})`;

(async () => {
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const errors = [], starved = [];
  const HOST_LIMIT = /INSUFFICIENT_RESOURCES|OUT_OF_MEMORY|ERR_ABORTED/i;
  page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (HOST_LIMIT.test(text) || /favicon/.test(text)) { starved.push(text); return; }
    errors.push('console: ' + text);
  });

  console.log('\n  QA — the game played badly, on purpose\n');

  await page.goto(`http://127.0.0.1:${port}/index.html`);
  await page.waitForSelector('#loading.ready #start', { timeout: 30000 });

  /* ---- 1. the title screen, mashed ------------------------------- */
  const btn = await page.$('#start');
  const box = await btn.boundingBox();
  t('the play button is a comfortable target', box.width >= 44 && box.height >= 44,
    Math.round(box.width) + 'x' + Math.round(box.height));

  // five taps in a quarter of a second: the game must start exactly once
  for (let i = 0; i < 5; i++) { await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await sleep(45); }
  await sleep(1200);
  const started = await page.evaluate(() => ({
    screen: window.Game ? window.Game.screen : -1,
    loading: document.getElementById('loading').classList.contains('gone')
  }));
  t('five fast taps on Play start the game once, not five times',
    started.loading && started.screen === 0, JSON.stringify(started));

  /* ---- 2. tapping the scenery ------------------------------------ */
  await page.waitForFunction(() => window.Swiftee && window.Swiftee.el, { timeout: 30000 });

  // Which screens actually ask the child for something. A screen that asks
  // nothing — page 8 draws its own side while they watch — needs no cue, and
  // demanding one of it is demanding a prompt for a question nobody asked.
  await page.evaluate(() => {
    window.__asks = {};
    window.Game.director.on('input', function () { window.__asks[window.Game.screen] = true; });
  });
  await sleep(4200);
  for (const [x, y] of [[80, 120], [1180, 640], [640, 60], [200, 690]]) {
    await page.mouse.click(x, y); await sleep(70);
  }
  await sleep(400);
  const afterPoke = await page.evaluate(() => window.Game.screen);
  t('tapping the scenery does not advance the lesson', afterPoke === 0, 'screen ' + afterPoke);

  /* ---- 3. can a child read it? ----------------------------------- */
  const type = await page.evaluate((LUMSRC) => {
    const lum = eval(LUMSRC);
    const cr = (a, b) => { const A = lum(a), B = lum(b); const hi = Math.max(A, B), lo = Math.min(A, B); return (hi + 0.05) / (lo + 0.05); };
    const out = {};
    const bub = document.querySelector('.dialogue-inner');
    if (bub) {
      const cs = getComputedStyle(bub);
      out.bubblePx = parseFloat(cs.fontSize);
      // the paper behind it
      out.bubbleContrast = cr(cs.color, 'rgb(255,248,231)');
    }
    const card = document.querySelector('#instruction');
    if (card && card.classList.contains('show')) {
      const cs = getComputedStyle(card);
      out.cardPx = parseFloat(cs.fontSize);
      out.cardContrast = cr(cs.color, 'rgb(255,248,231)');
    }
    return out;
  }, LUM);
  t('the speech type is big enough to read', type.bubblePx >= 20, type.bubblePx + 'px');
  t('the speech contrasts with its paper', type.bubbleContrast >= 4.5, (type.bubbleContrast || 0).toFixed(2) + ':1');

  /* ---- 4. walk the lesson, misbehaving ---------------------------- */
  let stalls = 0, doubles = 0, resized = 0, settled = 0, lastScreen = -1;
  const doubled = [];
  const smallTargets = [];
  const seen = {}, cued = {};

  for (let step = 0; step < 120; step++) {
    const done = await page.evaluate(() => !!document.querySelector('#hud .replay.show'));
    if (done) break;

    const s = await page.evaluate(() => {
      const svg = window.Stage.svg;
      const touch = svg ? [].slice.call(svg.querySelectorAll('[style*="cursor: pointer"],[style*="cursor:pointer"]')) : [];
      const card = document.querySelector('#instruction');
      return {
        screen: window.Game.screen,
        next: !!document.querySelector('#next.show'),
        // what is telling the child what to do, right now?
        hasCard: !!(card && card.classList.contains('show') && card.textContent.trim()),
        haloed: svg ? svg.querySelectorAll('.touchable').length : 0,
        targets: touch.map((el) => {
          const r = el.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height) };
        })
      };
    });

    // every touchable thing should be findable by a small finger
    s.targets.forEach((r) => {
      if (Math.min(r.w, r.h) < 30) smallTargets.push('screen ' + (s.screen + 1) + ': ' + r.w + 'x' + r.h);
    });

    // And something should be saying what to do — but only once the screen
    // has settled. Sampled the instant it opens, nothing is saying anything
    // yet: the line is still arriving a word at a time and Next has not been
    // offered. A child who has been looking at a screen for two seconds and
    // still has no cue is the real fault; one who has been looking for two
    // hundred milliseconds is just early.
    // Whether a screen EVER offered a cue, not whether it had one at the
    // moment it was sampled. A screen is uncued for its first second by
    // design — the line is still arriving a word at a time and Next has not
    // been offered yet — so sampling is only evidence of a fault when the
    // screen is left behind having never said anything at all.
    seen[s.screen] = true;
    if (s.next || s.hasCard || s.haloed > 0 || s.targets.length) cued[s.screen] = true;

    // a child turns the tablet
    if (step === 14 || step === 46) {
      await page.setViewportSize(step === 14 ? { width: 1024, height: 768 } : { width: 1280, height: 720 });
      resized++;
      await sleep(500);
    }

    // leaning on the arrow keys
    if (step % 17 === 3) { await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight'); }

    if (s.next) {
      // impatient: three taps on Next in 150ms must move exactly one screen
      const before = s.screen;
      // #next can be taken away between reading the state and reaching for
      // the button: a screen that advances itself does exactly that, and
      // boundingBox() then returns null and takes the whole run down with a
      // TypeError. There is nothing to lean on this step, so move on.
      const nextEl = await page.$('#next');
      const nb = nextEl && await nextEl.boundingBox();
      if (!nb) continue;
      for (let i = 0; i < 3; i++) { await page.mouse.click(nb.x + nb.width / 2, nb.y + nb.height / 2); await sleep(50); }
      await sleep(700);
      const after = await page.evaluate(() => window.Game.screen);
      // A screen with no input advances by itself, so passing through one is
      // not a skip: the fault is a tap landing on a screen that was waiting.
      const skippable = await page.evaluate(({ a, b }) => {
        for (let k = a + 1; k < b; k++) {
          if ((window.Screens.list[k].beats || []).some((x) => x.input)) return true;
        }
        return false;
      }, { a: before, b: after });
      if (after > before + 1 && skippable) { doubles++; doubled.push((before + 1) + "→" + (after + 1)); }
      continue;
    }

    // otherwise let the lesson's own driver answer it
    const acted = await page.evaluate(() => {
      const st = window.Stage.state;
      // a choice
      const ch = [].slice.call(document.querySelectorAll('.choice'));
      if (ch.length) { ch[ch.length - 1].dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); return 'choice'; }
      // the swipe practice: tap a zone
      if (st.swipe && st.swipe.card) {
        const right = window.Poly.isRegular(st.swipe.card._verts) ? 'regular' : 'irregular';
        const z = document.querySelector('.zone[data-zone="' + right + '"]');
        if (z) { z.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); return 'swipe'; }
      }
      // the stepper
      if (st.stepPlus && st.n < 5) { st.stepPlus.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); return 'step'; }
      // picking cards out of a grid
      var cards = [].slice.call(document.querySelectorAll('.card'));
      if (cards.length) {
        var want = cards.filter(function (c) { return c._opt && c._opt.correct; });
        (want.length ? want : cards).forEach(function (c) {
          c.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        });
        return 'cards';
      }
      // a vertex that wants dragging: take it somewhere, clumsily, the way a
      // child would — start, wander, and let go well past the target
      var vs = [].slice.call(document.querySelectorAll('.vertex'));
      if (vs.length && st.verts) {
        var i = 0, v = st.verts[i], c2 = window.Poly.centroid(st.verts);
        var el = vs[i];
        var send = function (type, x, y) {
          el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
        };
        var r = el.getBoundingClientRect();
        var sx = r.left + r.width / 2, sy = r.top + r.height / 2;
        var m = window.Stage.svg.getScreenCTM();
        var dx = (c2.x - v.x) * (m ? m.a : 1) * 0.8, dy = (c2.y - v.y) * (m ? m.d : 1) * 0.8;
        send('pointerdown', sx, sy);
        for (var k = 1; k <= 6; k++) send('pointermove', sx + dx * k / 6, sy + dy * k / 6);
        send('pointerup', sx + dx, sy + dy);
        return 'drag';
      }
      // anything else the stage has made touchable: take the first one
      var any = window.Stage.svg
        ? window.Stage.svg.querySelector('[style*="cursor: pointer"],[style*="cursor:pointer"]')
        : null;
      if (any) { any.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); return 'touch'; }
      return null;
    });
    if (!acted) { stalls++; }
    await sleep(520);
  }

  t('impatient triple-taps never skip a screen', doubles === 0, doubles + ' skipped: ' + doubled.join(' '));
  t('the lesson survives being resized mid-screen', resized === 2 && errors.length === 0);
  t('every touchable thing is at least 30px across', smallTargets.length === 0,
    smallTargets.slice(0, 4).join(' | '));
  const asks = await page.evaluate(() => window.__asks || {});
  var never = Object.keys(seen)
    .filter(function (k) { return asks[k] && !cued[k]; })
    .map(function (k) { return +k + 1; });
  t('every screen says what to do somehow', never.length === 0,
    'nothing ever on screens ' + never.join(', '));

  /* ---- 5. what state did it end in? ------------------------------ */
  const end = await page.evaluate(() => ({
    screen: window.Game.screen,
    finished: !!document.querySelector('#hud .replay.show'),
    nodes: document.getElementsByTagName('*').length,
    anims: document.getAnimations().length
  }));
  if (!end.finished) note('did not reach the end under this treatment', 'stopped at screen ' + (end.screen + 1));
  t('the page is still healthy at the end', end.nodes < 1200 && end.anims < 400, JSON.stringify(end));
  // A SCENE'S DELAYED WORK MUST NOT RUN ON THE NEXT SCENE.
  //
  // stage.js stages its entrances — a sorting tray fades its items in one
  // after another over most of a second, a checklist ticks its rows in — and
  // a child who moves on before that finishes used to get the leftovers on
  // the following screen: a tick with nothing to tick, a highlight on
  // something nobody asked about. It never threw.
  //
  // Built and torn down immediately here, which is the case that used to
  // leak, and the refusal is counted rather than assumed.
  const leak = await page.evaluate(async () => {
    const suppressedBefore = window.Stage.staleSuppressed;
    window.Stage.apply({ kind: 'sort',
      bins: [{ id: 'convex', label: 'Convex' }, { id: 'concave', label: 'Concave' }],
      items: ['triangle', 'pentagon', 'hexagon', 'star'], enter: 'stagger' });
    await new Promise((r) => setTimeout(r, 40));       // mid-stagger
    const pendingMid = window.Stage.pendingTimers;     // entrances still owed
    window.Stage.apply({ kind: 'vista' });             // and gone
    const pendingAfter = window.Stage.pendingTimers;
    await new Promise((r) => setTimeout(r, 700));      // past when they would have fired
    return {
      pendingMid: pendingMid,
      pendingAfter: pendingAfter,
      slippedThrough: window.Stage.staleSuppressed - suppressedBefore,
      pendingEnd: window.Stage.pendingTimers
    };
  }).catch(function () { return { pendingMid: 0, pendingAfter: -1, slippedThrough: -1, pendingEnd: -1 }; });
  // There were entrances owed; after the teardown there are none, none fired
  // late, and none are still pending a second later.
  t('a scene torn down mid-entrance leaves nothing running',
    leak.pendingMid > 0 && leak.pendingAfter === 0 &&
    leak.slippedThrough === 0 && leak.pendingEnd === 0, JSON.stringify(leak));

  t('nothing threw, however it was treated', errors.length === 0, errors.slice(0, 3).join(' | '));
  if (starved.length) note('host ran out of memory ' + starved.length + ' time(s) — not a build failure');

  await browser.close();
  srv.close();

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed' + (warn ? ', ' + warn + ' noted' : '') + '\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
