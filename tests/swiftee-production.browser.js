// node tests/swiftee-production.browser.js [url] [--slow] [--nocache] [--seconds=90] [--story]
//
// SWIFTEE ON THE DEPLOYED BUILD, LOOKED AT. The glitch this guards against only shows on a real
// network: a state change pointing the sprite at a sheet that has not arrived (or not decoded)
// painted nothing, and he went blank between states (see src/character/swiftee.js, THE CELL IS
// DRAWN, NOT SWAPPED). The network log cannot see that — every sheet was already fetched by the
// loading bar — so this looks at the pixels: every 150 ms his box is captured and his teal body
// counted. A visible Swiftee with almost no teal is a blank frame.
//
// It fails on: a blank frame, his box collapsing to nothing, a failed Swiftee request, a page
// error. It is not in `npm test` (it needs the network); run it against the deployment:
//
//   node tests/swiftee-production.browser.js                                  (the live site)
//   node tests/swiftee-production.browser.js https://polygon-part-1.vercel.app --slow --nocache
//
// --slow is a 3 Mbps line with 150 ms latency; --nocache disables the browser cache (the worst
// case: every sheet fetched again on use); --story plays the Momo and Popo story first.
'use strict';
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const BASE = (args.find((a) => /^https?:/.test(a)) || 'https://polygon-part-1.vercel.app').replace(/\/$/, '');
const SLOW = args.includes('--slow'), NOCACHE = args.includes('--nocache'), STORY = args.includes('--story');
const SECS = +((args.find((a) => a.startsWith('--seconds=')) || '--seconds=90').split('=')[1]);

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [], failed = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('requestfailed', (r) => { if (/swiftee/.test(r.url())) failed.push((r.failure() || {}).errorText + ' ' + r.url()); });
  page.on('response', (r) => { if (/swiftee/.test(r.url()) && r.status() >= 400) failed.push(r.status() + ' ' + r.url()); });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  if (NOCACHE) await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (SLOW) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 3e6 / 8, uploadThroughput: 2e6 / 8 });

  let blanks = [], collapses = [], samples = 0, minTeal = 1, ok = true;
  try {
    await page.goto(BASE + '/part1-swiftee-lesson/index.html' + (STORY ? '' : '?story=0'), { waitUntil: 'domcontentloaded', timeout: 200000 });
    await page.waitForFunction(() => document.getElementById('loading').classList.contains('ready'), null, { timeout: 600000 });
    await page.click('#start');
    const teal = (b64) => page.evaluate(async (b64) => {
      const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode();
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      const x = c.getContext('2d'); x.drawImage(im, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data; let n = 0;
      for (let i = 0; i < d.length; i += 16) { const r = d[i], g = d[i + 1], b = d[i + 2]; if (g > 130 && b > 110 && r < 100 && g - r > 60 && b < g + 40) n++; }
      return n / (d.length / 16);
    }, b64);
    const t0 = Date.now();
    while (Date.now() - t0 < SECS * 1000) {
      const s = await page.evaluate(() => {
        const el = window.Swiftee && Swiftee.el; if (!el) return null;
        const cs = getComputedStyle(el), cell = el.lastChild;
        const b = Swiftee.bounds ? Swiftee.bounds() : null;
        return { vis: +cs.opacity > 0.6 && cs.visibility !== 'hidden' && cs.display !== 'none',
                 story: !!(window.Story && Story.active), pos: Swiftee.pos, state: Swiftee.state, screen: window.Game ? Game.screen : null,
                 measuring: !!document.querySelector('#stage .swiftee-measuring, #stage .swiftee-angle-measuring'),
                 sheet: cell && cell.getAttribute('data-sheet'),
                 box: b && b.width ? [b.left, b.top, b.width, b.height].map(Math.round) : null };
      });
      const t = ((Date.now() - t0) / 1000).toFixed(1);
      if (s && s.vis && s.box && !s.story && !s.measuring && s.pos !== 'off') {
        const [x, y, w, h] = s.box;
        if (w < 5 || h < 5) collapses.push(t + 's ' + JSON.stringify(s));
        else {
          const clip = { x: Math.max(0, x), y: Math.max(0, y), width: Math.min(w, 1280 - Math.max(0, x)), height: Math.min(h, 720 - Math.max(0, y)), scale: 0.5 };
          if (clip.width > 20 && clip.height > 20) {
            const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip });
            const f = await teal(shot.data); samples++;
            minTeal = Math.min(minTeal, f);
            if (f < 0.02) blanks.push(t + 's teal ' + f.toFixed(3) + ' ' + JSON.stringify({ screen: s.screen, state: s.state, pos: s.pos, sheet: s.sheet }));
          }
        }
      }
      await page.waitForTimeout(150);
    }
  } catch (e) { errors.push('run: ' + e.message); }

  const report = (name, pass, detail) => { if (!pass) ok = false; console.log((pass ? '  ok   ' : '  FAIL ') + name + (pass || !detail ? '' : '  ' + detail)); };
  console.log('Swiftee on ' + BASE + (SLOW ? ' · slow line' : '') + (NOCACHE ? ' · no cache' : '') + ' · ' + samples + ' samples, least teal ' + minTeal.toFixed(3));
  report('he was seen, many times', samples > 50, 'only ' + samples + ' samples');
  report('never a blank frame', blanks.length === 0, blanks.slice(0, 5).join(' | '));
  report('his box never collapses', collapses.length === 0, collapses.slice(0, 3).join(' | '));
  report('every Swiftee request succeeds', failed.length === 0, failed.slice(0, 3).join(' | '));
  report('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
