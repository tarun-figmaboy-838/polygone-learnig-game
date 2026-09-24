#!/usr/bin/env node
/*!
 * build-buttons.js — cut the supplied button sheets into 3-slice buttons.
 *
 *   node tools/build-buttons.js
 *
 * assets/source/image.png is twenty finished capsules on a black background;
 * assets/source/new plus-minus.png is the stepper's pair of keys.
 *
 * WHY SLICE RATHER THAN STRETCH. The buttons in this game are every width
 * from a 64-unit stepper key to a 184-unit answer, and the sheet is one
 * aspect ratio. Scaled to fit, a round end becomes an oval and the specular
 * highlight smears across the face. So each button is cut into three: a left
 * cap, a stretchable middle, and a right cap. The caps are drawn at their true
 * proportions at either end and the middle is stretched between them, which is
 * the only part of a pill that CAN stretch without deforming — it is a flat
 * vertical gradient.
 *
 * FIND THE BUTTONS, DO NOT ASSUME A GRID. The first sheet sat each button in
 * the middle of a 5x4 cell with room to spare. This one draws them wider and
 * closer, so they bleed over the cell boundaries — and cutting by cell took a
 * slice of the neighbour with every button: a green sliver down the side of
 * the orange one, a red edge on the green one. Every run of connected
 * non-black pixels is a component, the big ones are the buttons, and they are
 * sorted into reading order by where their centres fall.
 *
 * WHICH ONES. The lesson cuts only what it draws (the want lists in SHEETS
 * below): the stepper's two keys, and four capsules from the UI kit —
 * uiPrimary for an answer, uiNav for Next and Back, uiSuccess and uiDanger
 * for a verdict. A category is never a button at all: categories are flat
 * tags and tinted drop zones (build-card.js), because a category drawn in
 * the green or the red that mean right and wrong tells a child that half
 * the shapes are mistakes.
 *
 * Writes assets/ui/btn-*.webp and src/game/button-frame.js.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');   // a content hash on every src, so a rebuilt button is never an old cached one
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT_JS = path.join(ROOT, 'src/game/button-frame.js');

/* THE KIT, read in reading order. Only what the lesson draws is cut; a tone
   nothing drew is not cut, and adding its line back here brings it back.
   (The older matte-pill sheet, btn.png, went when its last pill stopped
   being drawn: the stepper keys are their own pictures and categories are
   never buttons.) */
const SHEETS = [
  // THE STEPPER'S KEYS: the supplied pair of glossy gold keys, minus and plus,
  // on transparency (assets/source/new plus-minus.png). Cut whole, sign and all.
  { src: 'assets/source/new plus-minus.png', want: [
    { cell: 0,  tone: 'stepMinus', role: 'Stepper', glyph: true },
    { cell: 1,  tone: 'stepPlus',  role: 'Stepper', glyph: true }
  ] },

  /* THE SUPPLIED UI KIT — twenty glossy capsules, five across and four down,
     cut by what each colour is FOR rather than by what it is: an answer, the
     button that moves you on, and the two verdicts an answer turns into. The
     green and the red are kept for those verdicts alone. A child learning
     that green means "you were right" should not meet green as the colour of
     a Next button.

       row 1  gold  orange  amber   beige     brown
       row 2  cyan  blue    deep    lavender  purple
       row 3  pink  magenta red     coral     rose
       row 4  green lime    teal    turquoise slate
  */
  { src: 'assets/source/image.png', want: [
    { cell: 0,  tone: 'uiPrimary',   role: 'Primary action' },
    { cell: 6,  tone: 'uiNav',       role: 'Navigation' },
    { cell: 15, tone: 'uiSuccess',   role: 'Success feedback' },
    { cell: 12, tone: 'uiDanger',    role: 'Error feedback' }
  ] }
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

const CUT = function (opts) {
  const url = opts.url, want = opts.want;
  return new Promise(function (resolve, reject) {
    const img = new Image();
    img.onerror = reject;
    img.onload = function () {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      const W = c.width, H = c.height;

      /* The sheet is on opaque black: "ink" is anything that is not. */
      const ink = function (px, py) {
        const i = (py * W + px) * 4;
        if (d[i + 3] < 40) return false;
        return d[i] > 38 || d[i + 1] > 38 || d[i + 2] > 38;
      };

      /* every connected run of ink */
      const seen = new Uint8Array(W * H);
      const comps = [];
      for (let sy = 0; sy < H; sy++) {
        for (let sx = 0; sx < W; sx++) {
          const n0 = sy * W + sx;
          if (seen[n0] || !ink(sx, sy)) continue;
          let minx = sx, maxx = sx, miny = sy, maxy = sy, area = 0;
          const stack = [n0];
          seen[n0] = 1;
          while (stack.length) {
            const n = stack.pop();
            const px = n % W, py = (n - px) / W;
            area++;
            if (px < minx) minx = px;
            if (px > maxx) maxx = px;
            if (py < miny) miny = py;
            if (py > maxy) maxy = py;
            const nb = [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]];
            for (let k = 0; k < 4; k++) {
              const ax = nb[k][0], ay = nb[k][1];
              if (ax < 0 || ay < 0 || ax >= W || ay >= H) continue;
              const m = ay * W + ax;
              if (seen[m] || !ink(ax, ay)) continue;
              seen[m] = 1;
              stack.push(m);
            }
          }
          if (area > W * H * 0.002) {
            comps.push({ x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1,
                         cx: (minx + maxx) / 2, cy: (miny + maxy) / 2 });
          }
        }
      }

      /* reading order: cluster by centre-y into rows, then left to right */
      comps.sort(function (a, b) { return a.cy - b.cy; });
      const rows = [];
      comps.forEach(function (k) {
        const row = rows[rows.length - 1];
        if (row && Math.abs(k.cy - row[0].cy) < k.h * 0.6) row.push(k);
        else rows.push([k]);
      });
      rows.forEach(function (row) { row.sort(function (a, b) { return a.cx - b.cx; }); });
      const found = [].concat.apply([], rows);

      const out = [];
      want.forEach(function (w) {
        const box = found[w.cell];
        if (!box) return;

        /* A pill's cap is a little over its half-height: that is the part with
           curvature, plus a couple of pixels of the straight run after it. */
        const cap = Math.round(box.h * 0.56);

        const t2 = document.createElement('canvas');
        t2.width = box.w; t2.height = box.h;
        const g2 = t2.getContext('2d');
        g2.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);

        /* THE MATTE OUT OF THE CUT BUTTON. Flooded in from the edges of the
           slice and stopped at the first pixel that is not near-black, so the
           surround goes and the dark navy button further down the sheet —
           which is a button, not background — is never reached. The
           antialiased rim left behind is faded by luminance, so the button
           does not carry a pencil line around it. */
        const dd = g2.getImageData(0, 0, box.w, box.h);
        const p = dd.data;
        const BW = box.w, BH = box.h;
        const blk = function (i) {
          return p[i + 3] > 200 && p[i] < 38 && p[i + 1] < 38 && p[i + 2] < 38;
        };
        const seen2 = new Uint8Array(BW * BH);
        const st2 = [];
        const push2 = function (ax, ay) {
          if (ax < 0 || ay < 0 || ax >= BW || ay >= BH) return;
          const n = ay * BW + ax;
          if (seen2[n]) return;
          seen2[n] = 1;
          if (blk(n * 4)) st2.push(n);
        };
        for (let ax = 0; ax < BW; ax++) { push2(ax, 0); push2(ax, BH - 1); }
        for (let ay = 0; ay < BH; ay++) { push2(0, ay); push2(BW - 1, ay); }
        while (st2.length) {
          const n = st2.pop();
          p[n * 4 + 3] = 0;
          const ax = n % BW, ay = (n - ax) / BW;
          push2(ax - 1, ay); push2(ax + 1, ay); push2(ax, ay - 1); push2(ax, ay + 1);
        }
        const cp = new Uint8ClampedArray(p);
        for (let ay = 1; ay < BH - 1; ay++) {
          for (let ax = 1; ax < BW - 1; ax++) {
            const n = ay * BW + ax;
            if (cp[n * 4 + 3] === 0) continue;
            const open = !cp[(n - 1) * 4 + 3] || !cp[(n + 1) * 4 + 3] ||
                         !cp[(n - BW) * 4 + 3] || !cp[(n + BW) * 4 + 3];
            if (!open) continue;
            const lum = (cp[n * 4] + cp[n * 4 + 1] + cp[n * 4 + 2]) / 3;
            if (lum < 110) p[n * 4 + 3] = Math.round(cp[n * 4 + 3] * (lum / 110));
          }
        }
        /* ONLY THE BUTTON SURVIVES THE SLICE.
           A component bbox is a rectangle and the buttons are not, so the
           corners of the slice can still hold a piece of the neighbour that
           reaches into them. Whatever is left after keying is labelled again
           and everything but the biggest island is erased — the button is
           always the biggest thing in its own box. */
        const keep = new Uint8Array(BW * BH);
        let best = null;
        const lab = new Uint8Array(BW * BH);
        for (let ay = 0; ay < BH; ay++) {
          for (let ax = 0; ax < BW; ax++) {
            const n0 = ay * BW + ax;
            if (lab[n0] || p[n0 * 4 + 3] < 60) continue;
            const cell = [];
            const st3 = [n0];
            lab[n0] = 1;
            while (st3.length) {
              const n = st3.pop();
              cell.push(n);
              const px = n % BW, py = (n - px) / BW;
              const nb = [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]];
              for (let k = 0; k < 4; k++) {
                const bx = nb[k][0], by = nb[k][1];
                if (bx < 0 || by < 0 || bx >= BW || by >= BH) continue;
                const m = by * BW + bx;
                if (lab[m] || p[m * 4 + 3] < 60) continue;
                lab[m] = 1;
                st3.push(m);
              }
            }
            if (!best || cell.length > best.length) best = cell;
          }
        }
        if (best) {
          best.forEach(function (n) { keep[n] = 1; });
          for (let n = 0; n < BW * BH; n++) if (!keep[n]) p[n * 4 + 3] = 0;
        }
        g2.putImageData(dd, 0, 0);

        /* IS ANY OF THIS SOMEBODY ELSE'S BUTTON?
           Not "is the border opaque" — a button's own glow reaches the edge
           of its own box, and the gold one's reaches further than the rest,
           which failed the build for a picture that was perfectly clean. What
           would actually be wrong is a FOREIGN HUE on the border: a green
           sliver down the side of the orange one. Hue is compared against the
           middle of the button, which is the button by definition. */
        const hueOf = function (i) {
          const r0 = p[i] / 255, g0 = p[i + 1] / 255, b0 = p[i + 2] / 255;
          const mx = Math.max(r0, g0, b0), mn = Math.min(r0, g0, b0), c0 = mx - mn;
          if (c0 < 0.08) return -1;                       // grey: no hue to clash
          var h = mx === r0 ? ((g0 - b0) / c0 + 6) % 6 : mx === g0 ? (b0 - r0) / c0 + 2 : (r0 - g0) / c0 + 4;
          return h * 60;
        };
        const mid = hueOf(((BH >> 1) * BW + (BW >> 1)) * 4);
        const foreign = function (i) {
          if (p[i + 3] < 150) return false;
          const h = hueOf(i);
          if (h < 0 || mid < 0) return false;
          const dh = Math.abs(h - mid);
          return Math.min(dh, 360 - dh) > 45;
        };
        let edge = 0;
        for (let ax = 0; ax < BW; ax++) {
          if (foreign((0 * BW + ax) * 4)) edge++;
          if (foreign(((BH - 1) * BW + ax) * 4)) edge++;
        }
        for (let ay = 0; ay < BH; ay++) {
          if (foreign((ay * BW) * 4)) edge++;
          if (foreign((ay * BW + BW - 1) * 4)) edge++;
        }

        /* A GLYPH KEY IS DRAWN SMALL: the stepper's keys are about fifty units
           tall, so a 600px picture of one is weight with nothing to show for
           it. Scaled to at most GLYPH_CAP tall, its own proportions kept. */
        let outCanvas = t2, ow = box.w, oh = box.h;
        const GLYPH_CAP = 240;
        if (w.glyph && box.h > GLYPH_CAP) {
          const k = GLYPH_CAP / box.h;
          ow = Math.round(box.w * k); oh = GLYPH_CAP;
          const t3 = document.createElement('canvas');
          t3.width = ow; t3.height = oh;
          const g3 = t3.getContext('2d');
          g3.imageSmoothingQuality = 'high';
          g3.drawImage(t2, 0, 0, box.w, box.h, 0, 0, ow, oh);
          outCanvas = t3;
        }
        out.push({ tone: w.tone, role: w.role, glyph: !!w.glyph, w: ow, h: oh, cap: w.glyph ? 0 : cap, edge: w.trust ? 0 : edge,
                   webp: outCanvas.toDataURL('image/webp', 0.94) });
      });
      resolve({ sheet: { w: img.width, h: img.height }, found: found.length, buttons: out });
    };
    img.src = url;
  });
};

(async () => {
  // `node tools/build-buttons.js stepMinus stepPlus` re-cuts only the named
  // buttons and keeps every other one exactly as button-frame.js has it, so
  // swapping one piece of art does not re-encode the whole kit.
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const tones = [].concat.apply([], SHEETS.map((s) => s.want.map((w) => w.tone)));
  const unknown = only.filter((k) => tones.indexOf(k) < 0);
  if (unknown.length) { console.error('no such button: ' + unknown.join(', ')); process.exit(1); }
  const sheets = only.length
    ? SHEETS.map((s) => ({ src: s.src, want: s.want.filter((w) => only.indexOf(w.tone) >= 0) })).filter((s) => s.want.length)
    : SHEETS;
  let kept = {};
  if (only.length) {
    try { delete require.cache[require.resolve(OUT_JS)]; kept = require(OUT_JS) || {}; }
    catch (e) { console.error('cannot read ' + OUT_JS + ' to keep the other buttons: ' + e.message); process.exit(1); }
  }
  for (const sheet of sheets) {
    if (!fs.existsSync(path.join(ROOT, sheet.src))) { console.error('missing ' + sheet.src); process.exit(1); }
  }
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  const m = { buttons: [] };
  for (const sheet of sheets) {
    // (the whole sheet is read, so a cell number means the same thing either way)
    const full = SHEETS.filter((s) => s.src === sheet.src)[0];
    const part = await page.evaluate(CUT, { url: `http://127.0.0.1:${port}/${encodeURI(sheet.src)}`, want: sheet.want });
    console.log('  ' + sheet.src + '  ' + part.sheet.w + 'x' + part.sheet.h + '   buttons found: ' + part.found + (full && full.want.length !== sheet.want.length ? '  (re-cutting ' + sheet.want.length + ')' : ''));
    m.buttons = m.buttons.concat(part.buttons);
  }
  await browser.close();
  srv.close();

  const frames = {};
  if (only.length) {
    // every button that is not being re-cut, as it was, in the kit's own order
    tones.forEach(function (t) { if (only.indexOf(t) < 0 && kept[t]) frames[t] = kept[t]; });
  }
  let dirty = 0;
  m.buttons.forEach(function (b) {
    const file = 'assets/ui/btn-' + b.tone + '.webp';
    const bytes = Buffer.from(b.webp.split(',')[1], 'base64');
    fs.writeFileSync(path.join(ROOT, file), bytes);
    if (b.edge > (b.w + b.h) * 0.02) dirty++;
    console.log('  ' + b.tone.padEnd(10) + b.role.padEnd(11) + b.w + 'x' + b.h +
                '  cap ' + b.cap + '  ' + (bytes.length / 1024).toFixed(0) + ' KB' +
                (b.edge > (b.w + b.h) * 0.02 ? '   A NEIGHBOUR IS IN THIS CUT (' + b.edge + ' px)' : ''));
    frames[b.tone] = { src: file + '?v=' + crypto.createHash('md5').update(bytes).digest('hex').slice(0, 8), w: b.w, h: b.h, cap: b.cap, glyph: b.glyph || undefined };
  });
  if (dirty) {
    console.error('\n  ' + dirty + ' button(s) carry a foreign colour on the border — the cut is ' +
                  'taking part of a neighbour.');
    process.exit(1);
  }
  // in the kit's own order, however many were re-cut
  const ordered = {};
  tones.forEach(function (t) { if (frames[t]) ordered[t] = frames[t]; });
  Object.keys(frames).forEach(function (t) { if (!ordered[t]) ordered[t] = frames[t]; });
  Object.keys(frames).forEach(function (t) { delete frames[t]; });
  Object.keys(ordered).forEach(function (t) { frames[t] = ordered[t]; });

  fs.writeFileSync(OUT_JS,
`/*!
 * button-frame.js — GENERATED by tools/build-buttons.js. Do not edit.
 *
 * The buttons cut from ${SHEETS.map(function (s) { return s.src; }).join(' and ')}, and where each one's round end finishes.
 * \`cap\` is that width in the image's own pixels: draw the left cap at its
 * true proportions, the right cap at its true proportions, and stretch the
 * sliver between them to whatever width the button needs. Stretching the
 * whole picture instead turns the round ends into ovals.
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
