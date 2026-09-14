#!/usr/bin/env node
/*!
 * playthrough.browser.js — the whole lesson, in a real browser, via Playwright.
 *
 *   node tests/playthrough.browser.js            full 39-screen play
 *   node tests/playthrough.browser.js --checks   render and layout only (fast)
 *   node tests/playthrough.browser.js --headed   watch it
 *   node tests/playthrough.browser.js --shots <dir>
 *
 * playthrough.jsdom.js proves sequencing and logic. It cannot prove that a tap
 * lands on the thing under the finger, because jsdom has no hit testing — and
 * that is exactly how a faded-out Start button sat over the middle of the
 * screen swallowing every tap while the headless suite stayed green, and how
 * an invisible ghost line sat over the vertex a child had to grab. Those are
 * the bugs this file exists for.
 *
 * It serves the game itself on an ephemeral port, so there is nothing to start
 * first and no port to collide with. It uses the system Chrome rather than a
 * downloaded browser build.
 */
'use strict';

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CHECKS_ONLY = process.argv.includes('--checks');
const HEADED = process.argv.includes('--headed');
const SHOT_DIR = (() => { const i = process.argv.indexOf('--shots'); return i > 0 ? process.argv[i + 1] : null; })();

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg'
};

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      // The sprite-sheet cache deliberately drops its Image references and
      // leans on the browser's own cache when a clip comes back. 'no-store'
      // turns each of those into a fresh fetch, which is how a long run ends
      // in ERR_INSUFFICIENT_RESOURCES.
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': rel.startsWith('assets/') ? 'public, max-age=3600' : 'no-store'
      });
      res.end(buf);
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let fails = 0;
  const t = (label, ok, extra) => {
    if (ok) console.log('  ok   ' + label);
    else { fails++; console.log('  FAIL ' + label + (extra ? '  ' + extra : '')); }
  };

  const { server, port } = await serve();
  const URL = `http://127.0.0.1:${port}/index.html`;

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: !HEADED,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio',
           '--autoplay-policy=no-user-gesture-required',
           // Headless Chrome's out-of-process audio service is unstable over a
           // long run with this many short-lived oscillator nodes.
           '--disable-features=AudioServiceOutOfProcess,AudioServiceSandbox']
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await context.newPage();

  const errors = [], missing = [];
  let crashed = null;
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('crash', () => { crashed = 'page crashed'; });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const from = (m.location() && m.location().url) || '';
    if (from.includes('favicon')) return;
    errors.push('console: ' + m.text());
  });
  page.on('response', (r) => {
    if (r.status() === 404) missing.push(r.url());
  });
  page.on('requestfailed', (r) => {
    if (!r.url().includes('fonts.g')) missing.push(r.url() + ' (' + (r.failure() || {}).errorText + ')');
  });

  const safe = async (fn, fallback) => {
    try { return await fn(); }
    catch (e) { crashed = crashed || String(e.message).split('\n')[0]; return fallback; }
  };

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.Game && window.Game.director, null, { timeout: 20000 });

  await page.evaluate(() => {
    window.__seen = new Set();
    window.__asked = [];
    window.__cues = { correct: 0, wrong: 0 };
    // Count the cue, then swallow it: the assertion is that the right cue
    // fires for the right verdict, not that a headless box makes a noise.
    window.SFX.play = (n) => { if (n === 'correct') window.__cues.correct++; if (n === 'wrong') window.__cues.wrong++; return true; };
    window.SFX.sequence = () => 0;
    window.Game.director.configure({ sayMinMs: 120, msPerWord: 8, feedbackSettleMs: 40, beatCeilingMs: 6000 });
    window.Game.director.on('start', () => window.__seen.add(window.Game.screen));
    window.Game.director.on('input', ({ spec }) => { window.__pending = spec; window.__asked.push(spec.type); });
  });

  const shot = SHOT_DIR
    ? async (n) => { await safe(() => page.screenshot({ path: path.join(SHOT_DIR, n) })); }
    : async () => {};
  if (SHOT_DIR) fs.mkdirSync(SHOT_DIR, { recursive: true });

  await shot('01-start.png');
  await page.click('#start');

  /* ---- the arrival ------------------------------------------------
     He flies in. Mid-flight he should be above the spot he will land on and
     playing the airborne loop; a second later he should be standing on it. */
  await sleep(1100);
  const inFlight = await safe(() => page.evaluate(() => {
    const r = window.Swiftee.bounds();
    const el = window.Swiftee.el;
    const settled = el.getBoundingClientRect();
    return {
      visible: getComputedStyle(el).opacity !== '0',
      state: window.Swiftee.state,
      airborne: window.Swiftee.el.querySelectorAll('*').length > 0 &&
                getComputedStyle(el.lastChild).backgroundImage.includes('flapping'),
      y: Math.round(r.bottom), settledY: Math.round(settled.bottom)
    };
  }), {});
  await shot('02-arrival.png');
  t('he flies in on the airborne loop', inFlight.visible && inFlight.airborne, JSON.stringify(inFlight));

  // Wait for the landing rather than guessing how long it takes. A fixed
  // sleep passes on a fast machine and fails on a busy one, which says
  // nothing about the game and everything about the box it ran on.
  await safe(() => page.waitForFunction(
    () => window.Swiftee.state !== 'enter' &&
          !getComputedStyle(window.Swiftee.el.lastChild).backgroundImage.includes('flapping'),
    null, { timeout: 20000 }));
  const landed = await safe(() => page.evaluate(() => ({
    visible: getComputedStyle(window.Swiftee.el).opacity !== '0',
    state: window.Swiftee.state,
    grounded: !getComputedStyle(window.Swiftee.el.lastChild).backgroundImage.includes('flapping')
  })), {});
  t('he lands and settles into talking', landed.visible && landed.grounded, JSON.stringify(landed));
  await shot('03-landed.png');

  /* ---- the child ------------------------------------------------- */

  const toScreen = (pts) => page.evaluate((qs) => {
    const svg = window.Stage.svg, m = svg.getScreenCTM(), pt = svg.createSVGPoint();
    return qs.map((q) => { pt.x = q.x; pt.y = q.y; const r = pt.matrixTransform(m); return { x: r.x, y: r.y }; });
  }, pts);

  const dragPath = async (from, to, steps = 8) => {
    const [a, b] = await toScreen([from, to]);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps);
    }
    // Chrome coalesces rapid moves, and stage.js drops an item at the last
    // position its own handler saw. Land the final move, let it be delivered,
    // then release.
    await sleep(50);
    await page.mouse.move(b.x, b.y);
    await sleep(50);
    await page.mouse.up();
  };

  const tapNth = async (sel, n = 0) => {
    const box = await page.evaluate(({ s, i }) => {
      const el = window.Stage.svg.querySelectorAll(s)[i];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, { s: sel, i: n });
    if (!box) return false;
    await page.mouse.click(box.x, box.y);
    return true;
  };

  const st = () => page.evaluate(() => {
    const s = window.Stage.state;
    return { verts: s.verts, n: s.n, picked: s.picked, segment: s.segment,
             diagonals: (s.diagonals || []).map((d) => [d[0], d[1]]) };
  });

  async function act(spec) {
    // Every mode change arms a short guard so the gesture that ended the last
    // screen cannot start something on this one. A child takes longer than
    // that to reach; a script does not.
    await page.waitForFunction(() => !window.Input.guarded, null, { timeout: 6000 }).catch(() => {});

    switch (spec.type) {
      case 'tap-anywhere':
        await page.waitForSelector('#next.show', { timeout: 8000 });
        await page.click('#next');
        return;

      case 'vertex-pick':
        await page.waitForFunction(() => window.Stage.svg.querySelectorAll('.vertex').length > 0, null, { timeout: 8000 });
        await tapNth('.vertex', 0);
        return;

      case 'drag-endpoint': {
        const s = await st();
        await dragPath(s.verts[s.segment[1]], s.verts[(s.segment[0] + 2) % s.n]);
        return;
      }

      case 'draw-diagonal':
      case 'draw-diagonals': {
        const s = await st();
        const from = spec.from === 'picked' ? s.picked : spec.from;
        const used = new Set(s.diagonals.map((d) => d.slice().sort((a, b) => a - b).join('-')));
        const adj = (i, j) => Math.abs(i - j) === 1 || Math.abs(i - j) === s.n - 1;
        const targets = [];
        for (let j = 0; j < s.n; j++) {
          if (j === from || adj(from, j)) continue;
          if (used.has([Math.min(from, j), Math.max(from, j)].join('-'))) continue;
          targets.push(j);
        }
        for (let k = 0; k < (spec.count || 1) && k < targets.length; k++) {
          const cur = await st();
          await dragPath(cur.verts[from], cur.verts[targets[k]]);
          await sleep(140);
        }
        return;
      }

      case 'drag-vertex': {
        const s = await st();
        const i = spec.vertex === 'any' ? 0 : spec.vertex;
        const c = s.verts.reduce((a, p) => ({ x: a.x + p.x / s.verts.length, y: a.y + p.y / s.verts.length }), { x: 0, y: 0 });
        const to = spec.until === 'concave'
          ? { x: s.verts[i].x + (c.x - s.verts[i].x) * 0.9, y: s.verts[i].y + (c.y - s.verts[i].y) * 0.9 }
          : { x: s.verts[i].x + 30, y: s.verts[i].y - 80 };
        await dragPath(s.verts[i], to, 16);
        return;
      }

      case 'choice': {
        await page.waitForFunction(() => window.Stage.svg.querySelectorAll('.choice').length > 0, null, { timeout: 8000 });
        const idx = await page.evaluate((want) =>
          [...window.Stage.svg.querySelectorAll('.choice')].findIndex((e) => e.getAttribute('data-label') === want), spec.correct);
        await tapNth('.choice', Math.max(0, idx));
        return;
      }

      case 'multi-select': {
        await page.waitForFunction(() => window.Stage.svg.querySelectorAll('.card').length > 0, null, { timeout: 8000 });
        const flags = await page.evaluate(() => [...window.Stage.svg.querySelectorAll('.card')].map((c) => !!(c._opt && c._opt.correct)));
        for (let i = 0; i < flags.length; i++) if (flags[i]) { await tapNth('.card', i); await sleep(150); }
        return;
      }

      case 'tap-each': {
        const sel = spec.targets === 'sides' ? '.edge' : '.vertex';
        for (let k = 0; k < (spec.count || 5); k++) { await tapNth(sel, k); await sleep(140); }
        return;
      }

      case 'sort': {
        for (let guard = 0; guard < 26; guard++) {
          const move = await page.evaluate(() => {
            const S = window.Stage.state.sort;
            if (!S || S.placed >= S.total) return null;
            const item = S.items.find((it) => !it._placed);
            if (!item) return 'wait';
            const c = window.Poly.classify(item._verts);
            const bin = S.bins.find((b) => ({ convex: c.convex, concave: c.concave, regular: c.regular, irregular: c.irregular })[b._bin.id]);
            if (!bin) return 'wait';
            return { from: item._pos || item._home,
                     to: { x: bin._rect.x + bin._rect.w / 2, y: bin._rect.y + bin._rect.h / 2 } };
          });
          if (move === null) return;
          if (move === 'wait') { await sleep(150); continue; }
          await dragPath(move.from, move.to, 8);
          await sleep(180);
        }
        return;
      }

      case 'stepper': {
        for (let k = 0; k < 12; k++) {
          const n = await page.evaluate(() => window.Stage.state.n);
          if (n >= spec.target) return;
          const box = await page.evaluate(() => {
            const r = window.Stage.state.stepPlus.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          });
          await page.mouse.click(box.x, box.y);
          await sleep(180);
        }
        return;
      }
    }
  }

  const N = await page.evaluate(() => window.Screens.list.length);
  const t0 = Date.now();
  let stalls = 0, lastScreen = -1, lastChange = Date.now(), stalled = null;

  while (!CHECKS_ONLY && Date.now() - t0 < 360000 && !crashed) {
    const done = await safe(() => page.evaluate(() => !!document.querySelector('#hud .replay.show')), true);
    if (done || crashed) break;

    const screen = await safe(() => page.evaluate(() => window.Game.screen), lastScreen);
    if (screen !== lastScreen) { lastScreen = screen; lastChange = Date.now(); }
    else if (Date.now() - lastChange > 60000) {
      // Say what the game was waiting for; "stopped at screen 26" alone sends
      // you back to the browser to find out why.
      stalled = await safe(() => page.evaluate(() => {
        const s = window.Stage.state, S = s.sort;
        return { screen: window.Game.screen, id: (window.Screens.list[window.Game.screen] || {}).id,
                 mode: window.Input.mode(), guarded: window.Input.guarded, kind: s.kind,
                 next: !!document.querySelector('#next.show'),
                 sort: S ? { placed: S.placed, total: S.total } : null };
      }), null);
      stalls++; break;
    }

    const spec = await safe(() => page.evaluate(() => { const s = window.__pending; window.__pending = null; return s; }), null);
    if (spec) {
      try { await act(spec); }
      catch (e) {
        const msg = String(e.message).split('\n')[0];
        if (/Target closed|crash|Session closed|closed/i.test(msg)) { crashed = crashed || msg; break; }
        errors.push('act ' + spec.type + ' on screen ' + screen + ': ' + msg);
      }
    }
    await sleep(50);
  }

  const finished = await safe(() => page.evaluate(() => !!document.querySelector('#hud .replay.show')), false);
  const seen = await safe(() => page.evaluate(() => window.__seen.size), 0);
  const asked = await safe(() => page.evaluate(() => window.__asked), []);
  const cues = await safe(() => page.evaluate(() => window.__cues), { correct: 0, wrong: 0 });
  const screen = await safe(() => page.evaluate(() => window.Game.screen), -1);
  await shot('04-finish.png');

  /* ---- the checks only a browser can make ------------------------ */

  const hit = await safe(() => page.evaluate(() => {
    const r = window.Stage.svg.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height * 0.8);
    let node = el, chain = [];
    while (node && chain.length < 6) {
      const cls = node.className;
      chain.push(node.id || (cls && (typeof cls === 'string' ? cls : cls.baseVal)) || node.tagName || node.nodeName);
      node = node.parentNode;
    }
    return { id: el && el.id, chain: chain.join(' < ') };
  }), { id: null, chain: '' });
  t('a tap in the play area reaches the stage, not an overlay',
    hit.id !== 'start' && !/loading/.test(hit.chain), JSON.stringify(hit));

  const pivot = await safe(() => page.evaluate(async () => {
    const rect = () => { const r = window.Swiftee.el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width)]; };
    const out = [];
    for (const s of ['idle', 'wave', 'think', 'celebrate', 'confused', 'surprised', 'point', 'idle']) {
      window.Swiftee.play(s);
      await new Promise((r) => setTimeout(r, 450));
      out.push([s, rect()]);
    }
    return out;
  }), [['none', [0, 0, 0]]]);
  const first = JSON.stringify(pivot[0][1]);
  const drift = pivot.filter((p) => JSON.stringify(p[1]) !== first);
  t('Swiftee does not shift when the expression changes', drift.length === 0,
    drift.map((d) => d[0] + '=' + d[1].join(',')).join(' '));

  const sprite = await safe(() => page.evaluate(async () => {
    const cell = window.Swiftee.el.lastChild, seen = new Set();
    for (let i = 0; i < 12; i++) { seen.add(getComputedStyle(cell).backgroundPosition); await new Promise((r) => setTimeout(r, 60)); }
    return { frames: seen.size, image: getComputedStyle(cell).backgroundImage, scale: window.Swiftee.scale };
  }), { frames: 0, image: '' });
  t('the sprite sheet is loaded and advancing frames',
    sprite.frames > 2 && /swiftee_/.test(sprite.image), JSON.stringify(sprite).slice(0, 120));

  /* Nothing cropped, nothing oversized, nothing overlapping. */
  const fitCheck = await safe(() => page.evaluate(() => {
    const r = window.Swiftee.el.getBoundingClientRect();
    const vw = innerWidth, vh = innerHeight;
    return {
      offLeft: Math.round(0 - r.left), offTop: Math.round(0 - r.top),
      offRight: Math.round(r.right - vw), offBottom: Math.round(r.bottom - vh),
      heightPct: Math.round(r.height / vh * 100)
    };
  }), {});
  t('Swiftee is fully on screen, not cropped at any edge',
    fitCheck.offLeft <= 1 && fitCheck.offTop <= 1 && fitCheck.offRight <= 1 && fitCheck.offBottom <= 1,
    JSON.stringify(fitCheck));
  // The cell is 76% character; 46% of the window for the whole cell is about a
  // third of the window for the bird, which is presence without dominance.
  t('Swiftee is not oversized', fitCheck.heightPct > 0 && fitCheck.heightPct <= 46, fitCheck.heightPct + '% of window height');

  const overlap = await safe(() => page.evaluate(() => {
    const box = (s) => { const e = document.querySelector(s); if (!e || !e.classList.contains('show')) return null; const r = e.getBoundingClientRect(); return r.width ? r : null; };
    const over = (a, b) => a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    // Element by element, not against one union box. The union of a tray and
    // the bins below it spans the gap between them, and something sitting in
    // that gap is not covering anything.
    const parts = window.Stage.contentParts ? window.Stage.contentParts() : [];
    const hits = [];
    const bubble = box('#bubble'), card = box('#card');
    const hud = document.querySelector('#hud').getBoundingClientRect();
    const bird = window.Swiftee.bounds && window.Swiftee.bounds();
    const against = (r, label) => { if (r && parts.some((p) => over(r, p))) hits.push(label); };
    against(bubble, 'bubble/stage');
    against(card, 'card/stage');
    against(bird, 'swiftee/stage');
    if (over(bubble, card)) hits.push('bubble/card');
    if (over(card, hud)) hits.push('card/hud');
    if (over(bubble, hud)) hits.push('bubble/hud');
    return hits;
  }), []);
  t('no overlay covers the lesson, the character or another overlay',
    overlap.length === 0, overlap.join(', '));

  const bg = await safe(() => page.evaluate(() => {
    const img = document.querySelector('image.vista');
    return { src: img && (img.getAttribute('href') || img.getAttribute('xlink:href')),
             flakes: document.querySelectorAll('.weather circle').length,
             clouds: document.querySelectorAll('.weather .cloud').length };
  }), { src: null, flakes: 0, clouds: 0 });
  t('the painted vista is present with its weather', !!bg.src && bg.flakes > 10, JSON.stringify(bg));
  t('no vector clouds are drawn over the painted sky', bg.clouds === 0, String(bg.clouds));

  await safe(() => page.setViewportSize({ width: 400, height: 820 }));
  await sleep(900);
  await shot('05-portrait.png');
  const portrait = await safe(() => page.evaluate(() => {
    const r = window.Swiftee.el.getBoundingClientRect();
    return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
             cropped: r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1 };
  }), { overflow: 0, cropped: false });
  t('no horizontal overflow at phone width', portrait.overflow <= 0, JSON.stringify(portrait));
  t('Swiftee is not cropped at phone width', !portrait.cropped, JSON.stringify(portrait));

  if (!CHECKS_ONLY) {
    t('played to the end and the replay button appeared', finished, 'stopped at screen ' + screen);
    t('all ' + N + ' screens were visited', seen === N, seen + '/' + N);
    t('all 11 interaction types were exercised', new Set(asked).size === 11, [...new Set(asked)].join(','));
    t('correct cues fired', cues.correct > 0, JSON.stringify(cues));
    t('never stalled on a screen', stalls === 0, stalled ? JSON.stringify(stalled) : '');
  }
  t('no runtime errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  t('no missing assets', missing.length === 0, missing.slice(0, 3).join(' | '));
  t('the browser survived the run', !crashed, crashed || '');

  console.log('  ' + (CHECKS_ONLY ? 'render checks only' : `screens: ${N}, inputs answered: ${asked.length}`) +
              `, elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(fails ? `\n${fails} FAILED` : '\nbrowser playthrough clean');

  await browser.close().catch(() => {});
  server.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error('\nbrowser playthrough could not complete: ' + String(e.message).split('\n')[0]);
  console.error('(if this box is short of memory for a headless Chrome, try --checks)');
  process.exit(1);
});
