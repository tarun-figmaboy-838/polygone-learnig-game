#!/usr/bin/env node
/*!
 * build-buttons.js — cut the supplied button sheet into 3-slice buttons.
 *
 *   node tools/build-buttons.js
 *
 * assets/ui/buttons.png is twenty finished buttons in a 5x4 grid, each with
 * its role written underneath it.
 *
 * WHY SLICE RATHER THAN STRETCH. The buttons in this game are every width
 * from a 64-unit stepper key to a 184-unit answer, and the sheet is one
 * aspect ratio. Scaled to fit, a round end becomes an oval and the specular
 * highlight smears across the face. So each button is cut into three: a left
 * cap, a one-pixel-wide middle, and a right cap. The caps are drawn at their
 * true size at either end and the middle is stretched between them, which is
 * the only part of a pill that CAN stretch without deforming — it is a flat
 * vertical gradient.
 *
 * WHICH FOUR. The sheet offers twenty roles and this lesson needs four:
 *
 *   sun        Primary    the first of a pair of answers
 *   tangerine  Secondary  the second
 *   correct    Success    a right answer
 *   wrong      Danger     a wrong one
 *
 * It does NOT supply the four category colours — convex, concave, regular,
 * irregular — and it cannot, because two of its twenty are the green and the
 * red that mean right and wrong, and a category drawn in those tells a child
 * that half the shapes are mistakes. Categories are drawn as flat tags and
 * tinted drop zones instead, from the palette in stage.js, and never as
 * buttons. No option button in this lesson is labelled with a category word.
 *
 * EACH CELL IS A BUTTON AND A CAPTION. The caption is the grey role name
 * printed under the button and must not end up in the image, so the button is
 * taken as the topmost run of rows that spans most of the cell — a caption is
 * narrow and centred, a button is wide.
 *
 * Writes assets/ui/btn-*.webp and src/game/button-frame.js.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SRC = 'assets/ui/buttons.png';
const OUT_JS = path.join(ROOT, 'src/game/button-frame.js');

/* Row-major position on the 5x4 sheet, and what this game calls it. */
const WANT = [
  { cell: 0,  tone: 'sun',       role: 'Primary' },
  { cell: 1,  tone: 'tangerine', role: 'Secondary' },
  { cell: 3,  tone: 'correct',   role: 'Success' },
  { cell: 4,  tone: 'wrong',     role: 'Danger' }
];
const COLS = 5, ROWS = 4;

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

const CUT = function (opts) {
  const url = opts.url, cols = opts.cols, rows = opts.rows, want = opts.want;
  return new Promise(function (resolve, reject) {
    const img = new Image();
    img.onerror = reject;
    img.onload = function () {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;

      /* The sheet is on white, not on transparency: "ink" is any pixel that
         is not near-white. */
      const ink = function (px, py) {
        const i = (py * c.width + px) * 4;
        if (d[i + 3] < 40) return false;
        return d[i] < 236 || d[i + 1] < 236 || d[i + 2] < 236;
      };

      const cellW = c.width / cols, cellH = c.height / rows;
      const out = [];
      want.forEach(function (w) {
        const cx0 = Math.round((w.cell % cols) * cellW);
        const cy0 = Math.round(Math.floor(w.cell / cols) * cellH);
        const cx1 = Math.round(cx0 + cellW) - 1;
        const cy1 = Math.round(cy0 + cellH) - 1;

        /* How wide the ink is on each row of the cell. A button spans most of
           the cell; the role caption under it is narrow and centred. */
        const width = [];
        for (let py = cy0; py <= cy1; py++) {
          let a = -1, b = -1;
          for (let px = cx0; px <= cx1; px++) {
            if (ink(px, py)) { if (a < 0) a = px; b = px; }
          }
          width.push(a < 0 ? 0 : b - a + 1);
        }
        const WIDE = (cx1 - cx0) * 0.45;
        let t = 0;
        while (t < width.length && width[t] < WIDE) t++;
        let bt = t;
        while (bt < width.length && width[bt] >= WIDE) bt++;
        const top = cy0 + t, bot = cy0 + bt - 1;

        /* and the horizontal extent of just those rows */
        let L = cx1, R = cx0;
        for (let py = top; py <= bot; py++) {
          for (let px = cx0; px <= cx1; px++) {
            if (ink(px, py)) { if (px < L) L = px; if (px > R) R = px; }
          }
        }
        const box = { x: L, y: top, w: R - L + 1, h: bot - top + 1 };

        /* A pill's cap is its half-height: that is the part with curvature.
           A little more than half, so the slice carries the whole of the
           round end and a couple of pixels of the straight run after it. */
        const cap = Math.round(box.h * 0.56);

        const t2 = document.createElement('canvas');
        t2.width = box.w; t2.height = box.h;
        const g2 = t2.getContext('2d');
        g2.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
        /* white -> transparent, so the button sits on the snow */
        const dd = g2.getImageData(0, 0, box.w, box.h);
        const p = dd.data;
        for (let i = 0; i < p.length; i += 4) {
          if (p[i] > 243 && p[i + 1] > 243 && p[i + 2] > 243) p[i + 3] = 0;
        }
        g2.putImageData(dd, 0, 0);

        out.push({ tone: w.tone, role: w.role, w: box.w, h: box.h, cap: cap,
                   webp: t2.toDataURL('image/webp', 0.94) });
      });
      resolve({ sheet: { w: img.width, h: img.height }, buttons: out });
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
  const m = await page.evaluate(CUT, {
    url: `http://127.0.0.1:${port}/${SRC}`, cols: COLS, rows: ROWS, want: WANT
  });
  await browser.close();
  srv.close();

  console.log('  sheet ' + m.sheet.w + 'x' + m.sheet.h);
  const frames = {};
  m.buttons.forEach(function (b) {
    const file = 'assets/ui/btn-' + b.tone + '.webp';
    const bytes = Buffer.from(b.webp.split(',')[1], 'base64');
    fs.writeFileSync(path.join(ROOT, file), bytes);
    console.log('  ' + b.tone.padEnd(10) + b.role.padEnd(11) + b.w + 'x' + b.h +
                '  cap ' + b.cap + '  ' + (bytes.length / 1024).toFixed(0) + ' KB');
    frames[b.tone] = { src: file, w: b.w, h: b.h, cap: b.cap };
  });

  fs.writeFileSync(OUT_JS,
`/*!
 * button-frame.js — GENERATED by tools/build-buttons.js. Do not edit.
 *
 * The buttons cut from assets/ui/buttons.png, and where each one's round end
 * finishes. \`cap\` is that width in the image's own pixels: draw the left cap
 * at its true size, the right cap at its true size, and stretch the sliver
 * between them to whatever width the button needs. Stretching the whole
 * picture instead turns the round ends into ovals.
 */
(function (global) {
  'use strict';
  var F = ${JSON.stringify(frames, null, 2).split('\n').map(function (l, i) { return i ? '  ' + l : l; }).join('\n')};
  global.ButtonFrame = F;
  if (typeof module !== 'undefined' && module.exports) module.exports = F;
})(typeof window !== 'undefined' ? window : this);
`);
  console.log('\n  button-frame.js written');
})().catch((e) => { console.error(e); process.exit(1); });
