#!/usr/bin/env node
/*!
 * build-card.js â€” measure the supplied card artwork, and re-encode it.
 *
 *   node tools/build-card.js
 *
 * Four cards, three jobs:
 *
 *   OPTION  assets/source/cardskit.png (cell 0)  the block of ice something you can TOUCH
 *                                  sits in â€” the sorting tray, the swipe
 *                                  card, the icons stacked in a bin, the four
 *                                  in the choose-the-polygons grid.
 *   PANEL   assets/source/newcard.png    the slab a single shape is DISPLAYED on,
 *                                  where there is nothing to tap or drag.
 *
 * Which card a thing gets is the affordance. A child should be able to tell
 * whether something is for touching before they touch it, and two clearly
 * different cards say so at a glance â€” which one drawn slab used for both
 * never could.
 *
 * Neither file is usable as it is:
 *
 *   WHERE THE PANE IS. A shape is drawn ON a card and has to land inside the
 *   face rather than over the rim. The rim is not the same thickness on every
 *   edge â€” the option card's top carries snow caps â€” so the middle of the
 *   card is NOT the middle of the pane, and centring a shape on the card puts
 *   it low. The pane is found by walking OUT from the centre until the colour
 *   stops being the face. Walking IN from the edge does not work: both rims
 *   carry bright highlights, so the walk stops on the rim and reports a pane
 *   nearly as big as the card.
 *
 *   WHAT THEY WEIGH. 1.7 MB of PNG for a card drawn six times on one screen,
 *   in a game that loads over file:// on a school tablet, is 1.7 MB decoded
 *   six times. Each is capped at twice the size it is ever drawn and
 *   re-encoded as WebP, which the project already serves.
 *
 * Writes assets/ui/*.webp and src/game/card-frame.js, which is the only thing
 * the game reads. Re-run it after redrawing either card.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT_JS = path.join(ROOT, 'src/game/card-frame.js');

const CARDS = [
  // The option card is the first cell of the frosted-card kit: a soft ice
  // card with snow on its corners. `cell` crops one of a sheet's cells
  // before the usual keying and measuring.
  { key: 'option',    src: 'assets/source/cardskit.png',  cell: { cols: 3, rows: 2, i: 0 }, out: 'assets/ui/card.webp', cap: 512 },
  // The convex / concave bins on the sorting screen: aqua and lilac from
  // the same kit, so the two halves of the answer are two cards.
  { key: 'convexBin',  src: 'assets/source/cardskit.png', cell: { cols: 3, rows: 2, i: 3 }, out: 'assets/ui/bin-convex.webp',  cap: 640 },
  { key: 'concaveBin', src: 'assets/source/cardskit.png', cell: { cols: 3, rows: 2, i: 5 }, out: 'assets/ui/bin-concave.webp', cap: 640 },
  // THE NEW SLAB: frosted glass with a crystal in each corner
  // (assets/source/newcard.png, supplied to replace panel-card.png). Its face runs
  // to the rim at the middle of every edge â€” there is no thick frame to walk
  // out to â€” so the measured pane would be the whole card and the shape would
  // be fitted into the crystals. `pane` says where the clear glass is instead:
  // inside the corner crystals, about a tenth in from each edge, which also
  // puts the shape at the 70â€“80% of the card the polish pass asked for.
  { key: 'panel',     src: 'assets/source/newcard.png', out: 'assets/ui/panel.webp',   cap: 1024,
    pane: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } },
  // The two drop zones of the swipe practice. Their titles are drawn INTO the
  // artwork, so the game must not print a label over them â€” and the pane each
  // one reports is the shelf its catch is stacked on.
  // The instruction plank at the top of every screen. Drawn through CSS
  // border-image, so what matters is where the flat middle starts on each
  // edge â€” the snow caps live in the corner slices and must never stretch.
  { key: 'plank',     src: 'assets/source/pannel.png',   out: 'assets/ui/plank.webp',           cap: 1400 },
  // The zone frames are blank glass now â€” a cyan rim for regular, a violet
  // one for irregular â€” and stage.js letters the word on them. The earlier
  // the earlier zone art carried its own title plates.
  // The card a shape is COMPARED on: two of these side by side, lighter
  // and plainer than the display slab, so the pair reads as a pair.
  { key: 'compare',   src: 'assets/source/compare-card.png', out: 'assets/ui/compare.webp', cap: 640 },
  // The wide slab for the measuring screens: he waits inside its bottom-left
  // corner, small, and the shape has the whole width to be big in.
  { key: 'measure',   src: 'assets/source/measure-card.png', out: 'assets/ui/measure.webp', cap: 1024 },
  { key: 'regular',   src: 'assets/source/reg.png',  out: 'assets/ui/zone-regular.webp',   cap: 640 },
  { key: 'irregular', src: 'assets/source/irre.png', out: 'assets/ui/zone-irregular.webp', cap: 640 }
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
  const url = opts.url, cap = opts.cap, cell = opts.cell;
  return new Promise(function (resolve, reject) {
    const img = new Image();
    img.onerror = reject;
    img.onload = function () {
      const c = document.createElement('canvas');
      const x = c.getContext('2d');
      if (cell) {
        // one cell of a sheet, cut on the grid; the rest of the pipeline
        // sees it as if it were the whole file
        const cw = Math.floor(img.width / cell.cols), ch = Math.floor(img.height / cell.rows);
        c.width = cw; c.height = ch;
        x.drawImage(img, (cell.i % cell.cols) * cw, Math.floor(cell.i / cell.cols) * ch, cw, ch, 0, 0, cw, ch);
      } else {
        c.width = img.width; c.height = img.height;
        x.drawImage(img, 0, 0);
      }
      const d = x.getImageData(0, 0, c.width, c.height).data;
      const at = function (px, py) {
        const i = (py * c.width + px) * 4;
        return { r: d[i], g: d[i + 1], b: d[i + 2], a: d[i + 3] };
      };

      /* 0. THE BLACK MATTE.
            The slab was exported onto an opaque black background rather
            than onto transparency â€” every one of its border pixels is
            rgba(0,0,0,255) â€” so drawn as-is the display slab arrives inside a
            hard black rectangle. It is keyed out by flooding IN from the four
            corners and stopping at the first pixel that is not near-black, so
            only the surround is removed: any black inside the artwork is
            enclosed by lighter pixels and is never reached. Costs nothing on
            a file that is already transparent, because the flood stops on the
            first pixel it looks at. */
      const W = c.width, H = c.height;
      const near = (i) => d[i + 3] > 200 && d[i] < 42 && d[i + 1] < 42 && d[i + 2] < 42;
      const seen = new Uint8Array(W * H);
      const stack = [];
      const push = (px, py) => {
        if (px < 0 || py < 0 || px >= W || py >= H) return;
        const n = py * W + px;
        if (seen[n]) return;
        seen[n] = 1;
        if (near(n * 4)) stack.push(n);
      };
      for (let px = 0; px < W; px++) { push(px, 0); push(px, H - 1); }
      for (let py = 0; py < H; py++) { push(0, py); push(W - 1, py); }
      let cleared = 0;
      while (stack.length) {
        const n = stack.pop();
        d[n * 4 + 3] = 0;
        cleared++;
        const px = n % W, py = (n - px) / W;
        push(px - 1, py); push(px + 1, py); push(px, py - 1); push(px, py + 1);
      }
      if (cleared) {
        // The antialiased edge is a dark fringe now that what was behind it is
        // gone; fade the pixels that touch the hole so the rim does not carry
        // a pencil line around it.
        const copy = new Uint8ClampedArray(d);
        for (let py = 1; py < H - 1; py++) {
          for (let px = 1; px < W - 1; px++) {
            const n = py * W + px;
            if (copy[n * 4 + 3] === 0) continue;
            const open = !copy[(n - 1) * 4 + 3] || !copy[(n + 1) * 4 + 3] ||
                         !copy[(n - W) * 4 + 3] || !copy[(n + W) * 4 + 3];
            if (!open) continue;
            const lum = (copy[n * 4] + copy[n * 4 + 1] + copy[n * 4 + 2]) / 3;
            if (lum < 120) d[n * 4 + 3] = Math.round(copy[n * 4 + 3] * (lum / 120));
          }
        }
        x.putImageData(new ImageData(d, W, H), 0, 0);
      }

      /* 1. the opaque box: what is left of it */
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

      /* 2. the pane: out from the centre until the face ends */
      const midX = Math.round(box.x + box.w / 2);
      const midY = Math.round(box.y + box.h / 2);
      const face = at(midX, midY);
      const TOL = 42;
      const isFace = function (p) {
        return p.a > 200 &&
          Math.abs(p.r - face.r) < TOL && Math.abs(p.g - face.g) < TOL && Math.abs(p.b - face.b) < TOL;
      };
      let L = midX, R = midX, T = midY, B = midY;
      while (L > box.x && isFace(at(L - 1, midY))) L--;
      while (R < box.x + box.w - 1 && isFace(at(R + 1, midY))) R++;
      while (T > box.y && isFace(at(midX, T - 1))) T--;
      while (B < box.y + box.h - 1 && isFace(at(midX, B + 1))) B++;

      const pane = {
        x: +((L - box.x) / box.w).toFixed(4),
        y: +((T - box.y) / box.h).toFixed(4),
        w: +((R - L + 1) / box.w).toFixed(4),
        h: +((B - T + 1) / box.h).toFixed(4)
      };

      /* 3. re-encode: trimmed, and no bigger than it is ever drawn */
      const k = Math.min(1, cap / box.w);
      const t = document.createElement('canvas');
      t.width = Math.round(box.w * k); t.height = Math.round(box.h * k);
      // from the cleaned canvas, not the file: the matte has just been removed
      t.getContext('2d').drawImage(c, box.x, box.y, box.w, box.h, 0, 0, t.width, t.height);

      resolve({ full: { w: img.width, h: img.height }, box: box, pane: pane, cleared: cleared,
                out: { w: t.width, h: t.height },
                webp: t.toDataURL('image/webp', 0.92) });
    };
    img.src = url;
  });
};

(async () => {
  // `node tools/build-card.js panel` rebuilds only the named cards and keeps
  // every other card exactly as card-frame.js already has it, so swapping one
  // piece of art does not re-encode the rest.
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const unknown = only.filter((k) => !CARDS.some((c) => c.key === k));
  if (unknown.length) { console.error('no such card: ' + unknown.join(', ')); process.exit(1); }
  const building = only.length ? CARDS.filter((c) => only.includes(c.key)) : CARDS;
  const missing = building.filter((c) => !fs.existsSync(path.join(ROOT, c.src)));
  if (missing.length) {
    console.error('missing:\n  ' + missing.map((c) => c.src).join('\n  '));
    process.exit(1);
  }
  let kept = {};
  if (only.length) {
    try { delete require.cache[require.resolve(OUT_JS)]; kept = require(OUT_JS) || {}; }
    catch (e) { console.error('cannot read ' + OUT_JS + ' to keep the other cards: ' + e.message); process.exit(1); }
  }

  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);

  const frames = {};
  for (const card of CARDS) {
    if (!building.includes(card)) {
      if (!kept[card.key]) { console.error('card-frame.js has no ' + card.key + '; rebuild it with no arguments'); process.exit(1); }
      frames[card.key] = kept[card.key];
      continue;
    }
    const m = await page.evaluate(MEASURE, { url: `http://127.0.0.1:${port}/${card.src}`, cap: card.cap, cell: card.cell || null });
    const bytes = Buffer.from(m.webp.split(',')[1], 'base64');
    fs.writeFileSync(path.join(ROOT, card.out), bytes);
    const before = fs.statSync(path.join(ROOT, card.src)).size;
    // a card whose face runs to its rim says where its clear glass is
    const pane = card.pane || m.pane;
    console.log('  ' + card.key.padEnd(7) + m.full.w + 'x' + m.full.h + '  ' +
      (before / 1024).toFixed(0) + ' KB  ->  ' + m.out.w + 'x' + m.out.h + '  ' +
      (bytes.length / 1024).toFixed(0) + ' KB');
    console.log('          pane  x ' + pane.x + '  y ' + pane.y +
                '  w ' + pane.w + '  h ' + pane.h + (card.pane ? '  (declared; measured ' + JSON.stringify(m.pane) + ')' : ''));
    if (m.cleared) console.log('          keyed out a black matte (' + (m.cleared / 1000).toFixed(0) + 'k px)');
    frames[card.key] = { src: card.out, w: m.out.w, h: m.out.h, pane: pane };
  }

  await browser.close();
  srv.close();

  fs.writeFileSync(OUT_JS,
`/*!
 * card-frame.js â€” GENERATED by tools/build-card.js. Do not edit.
 *
 * The two cards, and where each one's face is.
 *
 *   option  the block of ice something TOUCHABLE sits in
 *   panel   the slab a single shape is DISPLAYED on, with nothing to do
 *
 * \`pane\` is the clear area inside the rim, as a fraction of the card, so a
 * shape can be placed in it at any size the card is drawn at. Measured from
 * the artwork rather than eyeballed, because the rim is not the same
 * thickness on every edge and a shape centred on the card is not centred in
 * the pane.
 */
(function (global) {
  'use strict';
  var F = ${JSON.stringify(frames, null, 2).split('\n').map(function (l, i) { return i ? '  ' + l : l; }).join('\n')};
  global.CardFrame = F;
  if (typeof module !== 'undefined' && module.exports) module.exports = F;
})(typeof window !== 'undefined' ? window : this);
`);
  console.log('\n  card-frame.js written');
})().catch((e) => { console.error(e); process.exit(1); });
