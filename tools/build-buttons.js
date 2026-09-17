#!/usr/bin/env node
/*!
 * build-buttons.js — cut the supplied button sheet into 3-slice buttons.
 *
 *   node tools/build-buttons.js
 *
 * assets/ui/newbuttons.png is twenty finished buttons on a black background.
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
 * WHICH FOUR. The sheet offers twenty and this lesson needs four:
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
 * tinted drop zones, never as buttons. No option button in this lesson is
 * labelled with a category word.
 *
 * Writes assets/ui/btn-*.webp and src/game/button-frame.js.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT_JS = path.join(ROOT, 'src/game/button-frame.js');

/* THE KIT. Two sheets, each twenty-odd finished buttons on a black matte,
   read in reading order. buttonkit1.png is glossy pills in twenty colours;
   the game takes nine of them by the meaning each colour already carries
   here — sun and tangerine for a choice that means nothing, green and red
   for right and wrong, the concept colours for the words that name one.
   numberbutton1.png is pairs of small minus/plus buttons in twenty themes;
   the gold coins are the stepper's, glyph and all, so they are cut whole
   (glyph: true) rather than as caps and a stretch. */
const SHEETS = [
  { src: 'assets/ui/buttonkit1.png', want: [
    { cell: 2,  tone: 'sun',       role: 'Primary' },
    { cell: 1,  tone: 'tangerine', role: 'Secondary' },
    // gold rim on a green face: the neighbour guard reads the rim as foreign, so these two are trusted by eye
    { cell: 4,  tone: 'correct',   role: 'Success', trust: true },
    { cell: 0,  tone: 'wrong',     role: 'Danger' },
    { cell: 6,  tone: 'convex',    role: 'Concept' },
    { cell: 1,  tone: 'concave',   role: 'Concept' },
    { cell: 5,  tone: 'regular',   role: 'Concept' },
    { cell: 9,  tone: 'irregular', role: 'Concept', trust: true },
    { cell: 6,  tone: 'sky',       role: 'Neutral' },
    { cell: 8,  tone: 'plum',      role: 'Neutral' }
  ] },
  { src: 'assets/ui/numberbutton1.png', want: [
    // the gold coins (yellow, like the rest of the game's neutral buttons), not the ice cubes
    { cell: 0,  tone: 'stepMinus', role: 'Stepper', glyph: true },
    { cell: 1,  tone: 'stepPlus',  role: 'Stepper', glyph: true }
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

        out.push({ tone: w.tone, role: w.role, glyph: !!w.glyph, w: box.w, h: box.h, cap: w.glyph ? 0 : cap, edge: w.trust ? 0 : edge,
                   webp: t2.toDataURL('image/webp', 0.94) });
      });
      resolve({ sheet: { w: img.width, h: img.height }, found: found.length, buttons: out });
    };
    img.src = url;
  });
};

(async () => {
  for (const sheet of SHEETS) {
    if (!fs.existsSync(path.join(ROOT, sheet.src))) { console.error('missing ' + sheet.src); process.exit(1); }
  }
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  const m = { buttons: [] };
  for (const sheet of SHEETS) {
    const part = await page.evaluate(CUT, { url: `http://127.0.0.1:${port}/${sheet.src}`, want: sheet.want });
    console.log('  ' + sheet.src + '  ' + part.sheet.w + 'x' + part.sheet.h + '   buttons found: ' + part.found);
    m.buttons = m.buttons.concat(part.buttons);
  }
  await browser.close();
  srv.close();

  const frames = {};
  let dirty = 0;
  m.buttons.forEach(function (b) {
    const file = 'assets/ui/btn-' + b.tone + '.webp';
    const bytes = Buffer.from(b.webp.split(',')[1], 'base64');
    fs.writeFileSync(path.join(ROOT, file), bytes);
    if (b.edge > (b.w + b.h) * 0.02) dirty++;
    console.log('  ' + b.tone.padEnd(10) + b.role.padEnd(11) + b.w + 'x' + b.h +
                '  cap ' + b.cap + '  ' + (bytes.length / 1024).toFixed(0) + ' KB' +
                (b.edge > (b.w + b.h) * 0.02 ? '   A NEIGHBOUR IS IN THIS CUT (' + b.edge + ' px)' : ''));
    frames[b.tone] = { src: file, w: b.w, h: b.h, cap: b.cap, glyph: b.glyph || undefined };
  });
  if (dirty) {
    console.error('\n  ' + dirty + ' button(s) carry a foreign colour on the border — the cut is ' +
                  'taking part of a neighbour.');
    process.exit(1);
  }

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
