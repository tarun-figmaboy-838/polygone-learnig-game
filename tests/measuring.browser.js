// node tests/measuring.browser.js
'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const root = path.join(__dirname, '..');
  const server = http.createServer((req, res) => {
    const file = path.join(root, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
    fs.readFile(file, (err, bytes) => {
      if (err) { res.writeHead(404).end(); return; }
      const types = { '.js': 'text/javascript', '.html': 'text/html', '.webp': 'image/webp', '.png': 'image/png' };
      res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      res.end(bytes);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setContent('<base href="http://127.0.0.1:' + server.address().port + '/"><style>body{margin:0}#stage{width:1280px;height:720px}</style><div id="stage"></div><div class="swiftee"></div>');
    for (const file of ['src/core/polygon-math.js', 'src/fx/snowflake.js', 'src/character/swiftee-frames.js', 'src/game/stage.js']) {
      await page.addScriptTag({ path: path.join(root, file) });
    }
    await page.evaluate(() => {
      window.Swiftee = { el: document.querySelector('.swiftee') };
      window.Juice = { reducedMotion: false };
      Stage.mount(document.querySelector('#stage'));
    });
    const prepare = () => page.evaluate(() => {
      Stage.apply({ kind: 'polygon', sides: 5, panel: 'right' });
      window.measureDone = false;
      Stage.waitFor({ type: 'tap-each', targets: 'sides', count: 5 }).then(() => { window.measureDone = true; });
    });
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    await prepare();
    await page.evaluate(() => document.getAnimations().forEach(a => { if (a.effect.getTiming().iterations !== Infinity) a.finish(); }));
    await page.locator('.edge').nth(2).dispatchEvent('pointerdown');
    await page.waitForSelector('.swiftee-measuring');
    assert.equal(await page.locator('.meas').count(), 0, 'length is hidden during measuring');
    await page.clock.runFor(650);
    await page.screenshot({ path: 'measuring-preview.png' });
    await page.clock.resume();
    // Rapid taps, including a duplicate, must queue each side exactly once.
    for (const i of [0, 0, 1, 3, 4]) await page.locator('.edge').nth(i).dispatchEvent('pointerdown');
    await page.waitForFunction(() => window.measureDone, { timeout: 15000 });
    assert.equal(await page.locator('.meas').count(), 5);
    assert.equal(await page.locator('.swiftee-measuring').count(), 0);
    assert.notEqual(await page.locator('.swiftee').evaluate(el => el.style.opacity), '0');
    await prepare();
    await page.locator('.edge').first().dispatchEvent('pointerdown');
    await page.waitForSelector('.swiftee-measuring');
    await page.evaluate(() => Stage.apply({ kind: 'polygon', sides: 3 }));
    await page.waitForTimeout(2100);
    assert.equal(await page.locator('.swiftee-measuring').count(), 0);
    assert.equal(await page.locator('.meas').count(), 0, 'cancelled animation cannot reveal on the next scene');
    assert.notEqual(await page.locator('.swiftee').evaluate(el => el.style.opacity), '0');
    await page.evaluate(() => { Juice.reducedMotion = true; });
    await prepare();
    await page.locator('.edge').first().dispatchEvent('pointerdown');
    assert.equal(await page.locator('.swiftee-measuring').count(), 0);
    assert.equal(await page.locator('.meas').count(), 1, 'reduced motion reveals immediately');
    assert.deepEqual(errors, []);
    console.log('Measuring: delayed reveal, queued taps, cancellation, reduced motion passed.');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
