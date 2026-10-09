// node tests/angles.browser.js
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
      const types = { '.js': 'text/javascript', '.html': 'text/html', '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png' };
      res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      res.end(bytes);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setContent('<base href="http://127.0.0.1:' + server.address().port + '/"><style>body{margin:0}#stage{width:1280px;height:720px}</style><div id="stage"></div><div class="swiftee"></div>');
    for (const file of ['src/core/polygon-math.js', 'src/fx/snowflake.js', 'src/character/swiftee-frames.js', 'src/character/measuring-frames.js', 'src/character/angle-measuring-frames.js', 'src/game/stage.js']) {
      await page.addScriptTag({ path: path.join(root, file) });
    }
    await page.evaluate(() => {
      window.Swiftee = { el: document.querySelector('.swiftee') };
      window.Juice = { reducedMotion: false };
      Stage.mount(document.querySelector('#stage'));
    });
    await page.clock.install();
    const prepare = () => page.evaluate(() => {
      Juice.reducedMotion = false;
      Stage.apply({ kind: 'polygon', sides: 5, room: 'measure' });
      window.measureDone = false;
      Stage.waitFor({ type: 'tap-each', targets: 'angles', count: 5, auto: true, lead: 0 })
        .then(() => { window.measureDone = true; });
    });
    await prepare();
    await page.clock.runFor(1800);
    assert.equal(await page.locator('.angle-protractor').count(), 1);
    assert.equal(await page.locator('.angle-todo').count(), 0);
    await page.evaluate(() => { window.originalInstrument = document.querySelector('.angle-protractor'); });
    const measured = new Set();
    for (let i = 0; i < 220; i++) {
      await page.clock.runFor(100);
      const data = await page.evaluate(() => {
        const rig = document.querySelector('.swiftee-angle-measuring');
        if (!rig) return null;
        const tool = rig.querySelector('.angle-protractor');
        const index = Number(rig.dataset.angle), vertex = Stage.state.verts[index];
        const transform = tool.transform.baseVal.consolidate().matrix;
        const body = transform.multiply(rig.querySelector('.angle-performer').transform.baseVal.consolidate().matrix);
        if(rig.querySelector('clipPath,mask'))throw Error('The full-body pose must never be sliced');
        const previous = Stage.state.verts[(index + 4) % 5];
        const next = Stage.state.verts[(index + 1) % 5];
        const rayError = p => Math.abs(transform.a * (p.y - vertex.y) - transform.b * (p.x - vertex.x)) / Math.hypot(p.x - vertex.x, p.y - vertex.y);
        return { state: rig.dataset.state, index, same: tool === window.originalInstrument,
          bodyRotation: Math.atan2(body.b, body.a) * 180 / Math.PI,
          positionError: Math.hypot(transform.e - vertex.x, transform.f - vertex.y),
          scale: Math.abs(transform.a * transform.d - transform.b * transform.c),
          rayError: Math.min(rayError(previous), rayError(next)) };
      });
      if (data) {
        assert.ok(data.same, 'one continuous instrument between vertices');
        assert.ok(Math.abs(data.bodyRotation) <= 30, 'Complete generated poses keep Swiftee near upright');
        assert.ok(Math.abs(data.scale - 1) < 0.001, 'direction changes never flatten or squash the complete sprite');
        if (data.state === 'HOLD') {
          assert.ok(data.positionError < 0.01, 'center coincides with actual vertex');
          assert.ok(data.rayError < 0.001, 'baseline coincides with an incident ray');
          measured.add(data.index);
          if (measured.size === 1) {
            await page.setViewportSize({ width: 960, height: 540 });
            await page.locator('#stage').evaluate(el => { el.style.width = '960px'; el.style.height = '540px'; });
          }
        }
      }
    }
    assert.equal(measured.size, 5, 'all five corners held for observation');
    assert.ok(await page.evaluate(() => window.measureDone));
    assert.equal(await page.locator('.angle-protractor').count(), 0);
    assert.equal(await page.evaluate(() => Stage.state.measure.angles.length), 5);
    await prepare();
    await page.clock.runFor(1900);
    fs.mkdirSync('artifacts', { recursive: true });
    await page.screenshot({ path: 'artifacts/angle-measuring-preview.png' });
    await page.evaluate(() => Stage.apply({ kind: 'polygon', sides: 3 }));
    await page.clock.runFor(5000);
    assert.equal(await page.locator('.angle-protractor').count(), 0);
    assert.notEqual(await page.locator('.swiftee').evaluate(el => el.style.opacity), '0');
    await page.evaluate(() => {
      Juice.reducedMotion = true;
      Stage.waitFor({ type: 'tap-each', targets: 'angles', count: 3, auto: true, lead: 0 });
    });
    await page.clock.runFor(2000);
    assert.equal(await page.evaluate(() => Stage.state.measure.angles.length), 3);
    assert.equal(await page.locator('.angle-protractor').count(), 0);
    assert.deepEqual(errors, []);
    console.log('Angles: continuous instrument, geometry, responsive sizing, cancellation and reduced motion passed.');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
