#!/usr/bin/env node
/*!
 * build-sleigh-frames.js — measure the three intro sheets, emit the frame table.
 *
 *   node tools/build-sleigh-frames.js
 *
 * The intro is three separately drawn sprite sheets, and they agree about
 * almost nothing: the ride sheet is a tidy 4x2 grid, the dismount sheet is
 * not a grid at all, and the three are drawn at three different scales — the
 * same reindeer measures 314px on the ride sheet, 263 on the dismount and 195
 * on the departure. Nothing about that is visible from the filenames, and all
 * of it would show up as the character changing size mid-animation.
 *
 * So nothing here is assumed. Rows come from empty scanlines, figures within a
 * row from empty columns, and every frame's source rectangle, ground line and
 * separate islands are measured from the alpha channel. The generated table is
 * the only thing the renderer reads, and re-running this after redrawing a
 * sheet updates it.
 *
 * Writes src/character/sleigh-frames.js.
 *
 * Needs a browser for its canvas, which the project already has for the test
 * suites; it is a build tool, not something the game loads.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'src/character/sleigh-frames.js');

/* The cell counts are the only hint given, and they are used ONLY to split the
   sheet into search regions — every box inside them is measured. */
const SHEETS = [
  { key: 'ride',      file: 'assets/swiftee/intro/sheet1.png', cols: 4, rows: 2 },
  { key: 'dismount',  file: 'assets/swiftee/intro/sheet2.png', cols: 5, rows: 2 },
  { key: 'departure', file: 'assets/swiftee/intro/sheet3.png', cols: 4, rows: 2 }
];

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

const MEASURE = function (opts) {
  const { url, cols, rows } = opts;
  return new Promise(function (resolve, reject) {
    const img = new Image();
    img.onerror = reject;
    img.onload = function () {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      const A = (px, py) => d[(py * c.width + px) * 4 + 3];

      const cellW = c.width / cols, cellH = c.height / rows;
      const out = [];
      for (let r = 0; r < rows; r++) {
        for (let k = 0; k < cols; k++) {
          const x0 = Math.round(k * cellW), x1 = Math.round((k + 1) * cellW) - 1;
          const y0 = Math.round(r * cellH), y1 = Math.round((r + 1) * cellH) - 1;
          let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
          for (let py = y0; py <= y1; py++) {
            for (let px = x0; px <= x1; px++) {
              if (A(px, py) > 24) {
                if (px < minX) minX = px; if (px > maxX) maxX = px;
                if (py < minY) minY = py; if (py > maxY) maxY = py;
              }
            }
          }
          if (maxX < 0) { out.push(null); continue; }

          // Islands: the bird becomes its own shape once it leaves the sled,
          // and the departure sheet draws it standing beside a reindeer that
          // is walking away. Which island owns the bird decides where the
          // frame is anchored, so they are measured separately.
          const colHas = [];
          for (let px = minX; px <= maxX; px++) {
            let any = false;
            for (let py = minY; py <= maxY; py += 2) { if (A(px, py) > 24) { any = true; break; } }
            colHas.push(any);
          }
          const islands = [];
          let st = null;
          for (let i = 0; i < colHas.length; i++) {
            if (colHas[i] && st === null) st = i;
            if ((!colHas[i] || i === colHas.length - 1) && st !== null) {
              const a = minX + st, bx = minX + (colHas[i] ? i : i - 1);
              let top = maxY, bot = minY;
              for (let py = minY; py <= maxY; py++) {
                let any = false;
                for (let px = a; px <= bx; px += 2) { if (A(px, py) > 24) { any = true; break; } }
                if (any) { if (py < top) top = py; if (py > bot) bot = py; }
              }
              if (bx - a + 1 > 8 && bot - top + 1 > 8) {
                islands.push({ x: a, y: top, w: bx - a + 1, h: bot - top + 1 });
              }
              st = null;
            }
          }
          const solid = islands.filter((i) => i.w > 40 && i.h > 40);
          const ground = solid.length ? Math.max.apply(null, solid.map((i) => i.y + i.h)) : maxY + 1;

          out.push({ sx: minX, sy: minY, sw: maxX - minX + 1, sh: maxY - minY + 1, ground, islands });
        }
      }
      resolve({ w: img.width, h: img.height, frames: out });
    };
    img.src = url;
  });
};

(async () => {
  const missing = SHEETS.filter((s) => !fs.existsSync(path.join(ROOT, s.file)));
  if (missing.length) {
    console.error('missing sheets:\n  ' + missing.map((s) => s.file).join('\n  '));
    process.exit(1);
  }

  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);

  const data = {};
  for (const s of SHEETS) {
    data[s.key] = await page.evaluate(MEASURE, {
      url: `http://127.0.0.1:${port}/${s.file.split(path.sep).join('/')}`,
      cols: s.cols, rows: s.rows
    });
    data[s.key].file = s.file;
    const n = data[s.key].frames.filter(Boolean).length;
    console.log('  ' + s.key.padEnd(10) + n + ' frames   ' + data[s.key].w + 'x' + data[s.key].h);
  }

  await browser.close();
  srv.close();

  /* Each sheet is drawn at its own scale. Normalise on the reindeer, which is
     in all three: the tallest solid island of the first frame that has one. */
  const deerHeight = (sheet) => {
    for (const f of sheet.frames) {
      if (!f) continue;
      const solid = f.islands.filter((i) => i.w > 60 && i.h > 60);
      if (solid.length) return Math.max.apply(null, solid.map((i) => i.h));
    }
    return 1;
  };
  const base = deerHeight(data.ride);
  const norm = {};
  Object.keys(data).forEach((k) => { norm[k] = +(base / deerHeight(data[k])).toFixed(4); });
  console.log('\n  scale normalisation (ride = 1):');
  Object.keys(norm).forEach((k) => console.log('    ' + k.padEnd(10) + norm[k]));

  const body =
`/*!
 * sleigh-frames.js — GENERATED by tools/build-sleigh-frames.js. Do not edit.
 *
 * The three intro sheets measured from their alpha: every frame's source
 * rectangle, its ground line, and the separate islands inside it.
 *
 * \`norm\` is the per-sheet scale correction. The three sheets were drawn at
 * three different sizes — the same reindeer measures ${deerHeight(data.ride)}px on the ride
 * sheet, ${deerHeight(data.dismount)} on the dismount and ${deerHeight(data.departure)} on the departure — and without this the
 * character would change size twice during a single continuous animation.
 */
(function (global) {
  'use strict';
  var F = ${JSON.stringify({ base: 'assets/swiftee/intro/', norm, sheets: data }, null, 1)};
  global.SleighFrames = F;
  if (typeof module !== 'undefined' && module.exports) module.exports = F;
})(typeof window !== 'undefined' ? window : this);
`;
  fs.writeFileSync(OUT, body);
  console.log('\n  sleigh-frames.js written — ' + (body.length / 1024).toFixed(1) + ' KB');
})().catch((e) => { console.error(e); process.exit(1); });
