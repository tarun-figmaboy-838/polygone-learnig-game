#!/usr/bin/env node
/*!
 * build-snowflake.js — the transition's flake, from the supplied artwork.
 *
 *   assets/source/snowflake-src.png  (1254×1254, transparent)  →  assets/ui/snowflake.webp (320×320)
 *
 * The transition drops sixty to a hundred of these at once, so it wants a
 * small file: the flake is cropped to its own bounds, centred, and written
 * as a 320px webp with alpha. Run once after replacing the source:
 *   node tools/build-snowflake.js
 */
'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const SRC = 'assets/source/snowflake-src.png', OUT = 'assets/ui/snowflake.webp', SIZE = 320;
function serve() { const srv = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url)); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' }); fs.createReadStream(f).pipe(r); }); return new Promise((res) => srv.listen(0, () => res(srv))); }
(async () => {
  const srv = await serve(); const port = srv.address().port;
  const b = await chromium.launch({ channel: 'chrome' });
  const pg = await b.newPage();
  await pg.setContent('<canvas id="c"></canvas>');
  const out = await pg.evaluate(async ({ url, size }) => {
    const img = new Image(); img.crossOrigin = 'anonymous'; img.src = url; await img.decode();   // CORS, so the canvas can be read back
    // the flake's own bounds (alpha > 40), then a centred square round them
    const c0 = document.createElement('canvas'); c0.width = img.width; c0.height = img.height;
    const x0 = c0.getContext('2d'); x0.drawImage(img, 0, 0);
    const d = x0.getImageData(0, 0, c0.width, c0.height).data;
    let minX = c0.width, maxX = 0, minY = c0.height, maxY = 0;
    for (let y = 0; y < c0.height; y += 2) for (let x = 0; x < c0.width; x += 2) { if (d[(y * c0.width + x) * 4 + 3] > 40) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); } }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, half = Math.max(maxX - minX, maxY - minY) / 2 * 1.04;
    const c = document.getElementById('c'); c.width = size; c.height = size;
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
    x.drawImage(img, cx - half, cy - half, half * 2, half * 2, 0, 0, size, size);
    return { bounds: [minX, maxX, minY, maxY], webp: c.toDataURL('image/webp', 0.9) };
  }, { url: `http://127.0.0.1:${port}/${SRC}`, size: SIZE });
  const buf = Buffer.from(out.webp.split(',')[1], 'base64');
  fs.writeFileSync(path.join(ROOT, OUT), buf);
  console.log(SRC + '  bounds x ' + out.bounds[0] + '..' + out.bounds[1] + ' y ' + out.bounds[2] + '..' + out.bounds[3] + '  ->  ' + OUT + '  ' + SIZE + 'x' + SIZE + '  ' + Math.round(buf.length / 1024) + ' KB');
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
