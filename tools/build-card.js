#!/usr/bin/env node
/*!
 * build-card.js — measure the supplied option card, and re-encode it.
 *
 *   node tools/build-card.js
 *
 * assets/ui/CARD.png is the artwork for the block of ice every option sits
 * in. Two things have to be true before the game can use it, and neither is
 * visible from the file:
 *
 *   WHERE THE PANE IS. A shape is drawn ON this card, and it has to land
 *   inside the glass rather than over the frozen rim. The rim is a saturated
 *   blue and the pane is near-white, so the boundary can be measured rather
 *   than guessed — and it is measured on the alpha-trimmed box, because the
 *   file carries transparent margin that would otherwise shift everything.
 *
 *   WHAT IT WEIGHS. 1.7 MB of PNG for a card drawn six times on one screen,
 *   in a game that loads over file:// on a school tablet. The same artwork as
 *   WebP is a fraction of that and the project already serves .webp.
 *
 * Writes assets/ui/card.webp and src/game/card-frame.js, which is the only
 * thing the game reads. Re-run it after redrawing the card.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SRC = 'assets/ui/CARD.png';
const OUT_IMG = path.join(ROOT, 'assets/ui/card.webp');
const OUT_JS = path.join(ROOT, 'src/game/card-frame.js');

function serve() {
  const TY = { '.html': 'text/html', '.png': 'image/png' };
  const srv = http.createServer((q, r) => {
    let p = decodeURIComponent(q.url.split('?')[0]);
    if (p === '/') { r.writeHead(200, { 'Content-Type': 'text/html' }); return r.end('<!doctype html><title>x</title>'); }
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); return r.end('nf'); }
    r.writeHead(200, { 'Content-Type': TY[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  return new Promise((r) => srv.listen(0, () => r(srv)));
}

const MEASURE = function (url) {
  return new Promise(function (resolve, reject) {
    const img = new Image();
    img.onerror = reject;
    img.onload = function () {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      const at = (px, py) => {
        const i = (py * c.width + px) * 4;
        return { r: d[i], g: d[i + 1], b: d[i + 2], a: d[i + 3] };
      };

      /* 1. the opaque box: the file carries transparent margin */
      let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
      for (let py = 0; py < c.height; py++) {
        for (let px = 0; px < c.width; px++) {
          if (d[(py * c.width + px) * 4 + 3] > 40) {
            if (px < minX) minX = px; if (px > maxX) maxX = px;
            if (py < minY) minY = py; if (py > maxY) maxY = py;
          }
        }
      }
      const box = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };

      /* 2. the pane: the LONGEST RUN of glass across the middle.
            Walking in from the edge until the first pale pixel does not work
            — the frozen rim carries bright white highlights along its top and
            in its corners, so the walk stops on the rim itself and reports a
            pane almost as big as the card. The glass is the longest unbroken
            pale run through the centre line, which the highlights cannot beat
            because they are thin. */
      const pale = (p) => p.a > 200 && p.r > 200 && p.g > 225 && p.b > 225;
      const longestRun = (n, read) => {
        let bestA = 0, bestB = -1, a = -1;
        for (let i = 0; i <= n; i++) {
          const on = i < n && pale(read(i));
          if (on && a < 0) a = i;
          if (!on && a >= 0) {
            if (i - 1 - a > bestB - bestA) { bestA = a; bestB = i - 1; }
            a = -1;
          }
        }
        return [bestA, bestB];
      };
      const midY = Math.round(box.y + box.h / 2);
      const midX = Math.round(box.x + box.w / 2);
      const h = longestRun(box.w, (i) => at(box.x + i, midY));
      const v = longestRun(box.h, (i) => at(midX, box.y + i));
      const L = box.x + h[0], R = box.x + h[1];
      const T = box.y + v[0], B = box.y + v[1];

      /* as fractions of the opaque box, so the game can scale it to anything */
      const pane = {
        x: +((L - box.x) / box.w).toFixed(4),
        y: +((T - box.y) / box.h).toFixed(4),
        w: +((R - L + 1) / box.w).toFixed(4),
        h: +((B - T + 1) / box.h).toFixed(4)
      };

      /* 3. re-encode: trimmed to the opaque box, and no bigger than it is
            ever drawn. The card is 1190px wide in the file and at most about
            256 CSS px on screen, so shipping the original means decoding
            twenty times the pixels that will be shown — four times over on
            the grid screen — for no visible difference. 512 is double the
            largest on-screen size, which covers a 2x display. */
      const CAP = 512;
      const k = Math.min(1, CAP / box.w);
      const t = document.createElement('canvas');
      t.width = Math.round(box.w * k); t.height = Math.round(box.h * k);
      t.getContext('2d').drawImage(img, box.x, box.y, box.w, box.h, 0, 0, t.width, t.height);
      resolve({ full: { w: img.width, h: img.height }, box: box, pane: pane,
                out: { w: t.width, h: t.height },
                webp: t.toDataURL('image/webp', 0.92) });
    };
    img.src = url;
  });
};

(async () => {
  if (!fs.existsSync(path.join(ROOT, SRC))) {
    console.error('missing ' + SRC);
    process.exit(1);
  }
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  const m = await page.evaluate(MEASURE, `http://127.0.0.1:${port}/${SRC}`);
  await browser.close();
  srv.close();

  const bytes = Buffer.from(m.webp.split(',')[1], 'base64');
  fs.writeFileSync(OUT_IMG, bytes);

  const before = fs.statSync(path.join(ROOT, SRC)).size;
  console.log('  source   ' + m.full.w + 'x' + m.full.h + '   ' + (before / 1024).toFixed(0) + ' KB');
  console.log('  shipped  ' + m.out.w + 'x' + m.out.h + '   ' + (bytes.length / 1024).toFixed(0) + ' KB webp');
  console.log('  pane     x ' + m.pane.x + '  y ' + m.pane.y + '  w ' + m.pane.w + '  h ' + m.pane.h);

  fs.writeFileSync(OUT_JS,
`/*!
 * card-frame.js — GENERATED by tools/build-card.js. Do not edit.
 *
 * The option card artwork, and where its glass is.
 *
 * \`pane\` is the clear area INSIDE the frozen rim, as a fraction of the
 * card, so a shape can be placed in the glass at any size the card is drawn
 * at. Measured from the artwork rather than eyeballed, because the rim is
 * not the same thickness on every edge and a shape centred on the card is
 * not centred in the pane.
 */
(function (global) {
  'use strict';
  var F = {
    src: 'assets/ui/card.webp',
    w: ${m.out.w},
    h: ${m.out.h},
    pane: ${JSON.stringify(m.pane)}
  };
  global.CardFrame = F;
  if (typeof module !== 'undefined' && module.exports) module.exports = F;
})(typeof window !== 'undefined' ? window : this);
`);
  console.log('\n  assets/ui/card.webp + src/game/card-frame.js written');
})().catch((e) => { console.error(e); process.exit(1); });
