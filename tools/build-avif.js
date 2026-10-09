#!/usr/bin/env node
/*!
 * build-avif.js — the AVIF twins: the same picture in fewer bytes, for the browsers that can show one.
 *
 *   node tools/build-avif.js                remake every twin whose .webp has changed
 *   node tools/build-avif.js --add <webp>…  give pictures a twin, where one pays for itself
 *   node tools/build-avif.js --check        exit 1 if a twin is missing, stale or unlisted
 *
 * Then `node tools/build-preload.js`, which writes each twin's address into PreloadList.avif.
 *
 * A TWIN, NOT A SWAP. The .webp stays exactly as it is, and every browser that cannot show
 * AVIF (or is not sure it can: index.html's ImgFormat probe) is given it as before. Where the
 * probe says yes, Preload.pick() turns a .webp address into its twin's — for every image the
 * scripts draw, and for the loading bar, so it fetches what will be drawn — and the stylesheet
 * does the same with image-set().
 *
 * THE SAME PICTURE. A twin is encoded from the .webp's own pixels, 4:4:4 (no colour smear on
 * the outlines), and kept at the lowest quality where it cannot be told apart from it: 45 dB
 * PSNR or better over the whole picture, for colour (premultiplied, so a transparent pixel's
 * colour does not count) and for alpha alike, AND 38 dB or better in its worst 16-pixel
 * square, so no corner of it is softer than the rest. A smooth sky can pass the first test
 * while one hard edge is visibly worse; the second is what catches it.
 *
 * AND SMALLER, OR NOT AT ALL. A twin is kept only when it is at most 80% of the .webp and
 * saves at least 2 KB. Swiftee's sheets are flat-coloured cartoon frames that lossless WebP
 * packs better than AVIF can at that quality; they have no twin, and a change that makes a
 * twin stop paying removes it.
 *
 * THE LIST is tools/avif-twins.json: each twin's quality and the hashes of the .webp it was
 * made from and of the .avif itself, so --check (which needs no sharp) can tell a twin made
 * from an older picture from a current one. npm test runs it (tests/avif.test.js).
 *
 * sharp is a dev dependency (npm install); a checkout that only has Part 2's installed borrows
 * that one.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const LIST = path.join(ROOT, 'tools', 'avif-twins.json');
const RULE = { psnr: 45, worst: 38, block: 16, maxShare: 0.8, minSaved: 2048, qMin: 40, qMax: 95, effort: 7 };

const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex').slice(0, 8);
const twinOf = (webp) => webp.replace(/\.webp$/, '.avif');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const readList = () => (fs.existsSync(LIST) ? JSON.parse(fs.readFileSync(LIST, 'utf8')) : {});
function writeList(list) {
  const sorted = {};
  Object.keys(list).sort().forEach((k) => { sorted[k] = list[k]; });
  fs.writeFileSync(LIST, JSON.stringify(sorted, null, 2) + '\n');
}
function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

/** Every problem with the twins on disk, as sentences; [] when all is well. */
function problems() {
  const list = readList(), bad = [];
  Object.keys(list).forEach((webp) => {
    const t = list[webp], w = path.join(ROOT, webp), a = path.join(ROOT, twinOf(webp));
    if (!fs.existsSync(w)) { bad.push(webp + ': listed, but the .webp is not there'); return; }
    if (!fs.existsSync(a)) { bad.push(twinOf(webp) + ': missing'); return; }
    if (md5(fs.readFileSync(w)) !== t.webp) bad.push(twinOf(webp) + ': made from an older ' + webp);
    if (md5(fs.readFileSync(a)) !== t.avif) bad.push(twinOf(webp) + ': not the file the list made');
  });
  // (not assets/source: the masters there are AVIF in their own right, not twins of a .webp)
  walk(path.join(ROOT, 'assets')).filter((p) => p.endsWith('.avif') && !/^assets\/source\//.test(rel(p))).forEach((p) => {
    if (!list[rel(p).replace(/\.avif$/, '.webp')]) bad.push(rel(p) + ': not in tools/avif-twins.json');
  });
  return bad;
}

/* ---- encoding (only these need sharp) ---- */

function loadSharp() {
  try { return require('sharp'); } catch (e) {
    try { return require(path.join(ROOT, '..', 'part2-frozen-rush', 'node_modules', 'sharp')); } catch (e2) {
      throw new Error('build-avif needs sharp: run npm install (in part1-swiftee-lesson, or the root npm run setup)');
    }
  }
}

function score(ref, dec, w, h) {
  const B = RULE.block;
  let se = 0, sa = 0, worst = Infinity;
  for (let i = 0; i < ref.length; i += 4) {
    const ra = ref[i + 3] / 255, da = dec[i + 3] / 255;
    for (let c = 0; c < 3; c++) { const d = ref[i + c] * ra - dec[i + c] * da; se += d * d; }
    const d = ref[i + 3] - dec[i + 3]; sa += d * d;
  }
  for (let by = 0; by < h; by += B) for (let bx = 0; bx < w; bx += B) {
    let s = 0, k = 0, seen = false;
    for (let y = by; y < Math.min(h, by + B); y++) for (let x = bx; x < Math.min(w, bx + B); x++) {
      const i = (y * w + x) * 4;
      if (ref[i + 3] || dec[i + 3]) seen = true;
      const ra = ref[i + 3] / 255, da = dec[i + 3] / 255;
      for (let c = 0; c < 3; c++) { const d = ref[i + c] * ra - dec[i + c] * da; s += d * d; }
      const d = ref[i + 3] - dec[i + 3]; s += d * d; k += 4;
    }
    if (seen && s > 0) worst = Math.min(worst, 10 * Math.log10(255 * 255 / (s / k)));
  }
  const db = (s, n) => (s === 0 ? Infinity : 10 * Math.log10(255 * 255 / (s / n)));
  return { rgb: db(se, (ref.length / 4) * 3), a: db(sa, ref.length / 4), worst: worst };
}

/** The smallest twin of `file` that passes RULE, or null if none is worth keeping. */
async function encode(file) {
  const sharp = loadSharp();
  const webp = fs.readFileSync(file);
  const { data: ref, info } = await sharp(webp).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const cache = new Map();
  const at = async (q) => {
    if (!cache.has(q)) {
      const buf = await sharp(webp).avif({ quality: q, effort: RULE.effort, chromaSubsampling: '4:4:4' }).toBuffer();
      const dec = await sharp(buf).ensureAlpha().raw().toBuffer();
      const s = score(ref, dec, info.width, info.height);
      cache.set(q, Object.assign({ q: q, buf: buf, ok: s.rgb >= RULE.psnr && s.a >= RULE.psnr && s.worst >= RULE.worst }, s));
    }
    return cache.get(q);
  };
  const cap = webp.length * RULE.maxShare;
  // the lowest quality that passes: a binary search, then a walk down from it, because the
  // worst-square test is not quite monotonic in q and a pass must be a real pass
  let lo = RULE.qMin, hi = RULE.qMax, best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, t = await at(mid);
    if (t.ok) { best = t; hi = mid - 1; } else { lo = mid + 1; if (t.buf.length > cap) break; }
  }
  if (!best) return null;
  for (let q = best.q - 1; q >= Math.max(RULE.qMin, best.q - 3); q--) { const t = await at(q); if (t.ok) best = t; else break; }
  if (best.buf.length > cap || webp.length - best.buf.length < RULE.minSaved) return null;
  return best;
}

async function make(list, webp) {
  const w = path.join(ROOT, webp), a = path.join(ROOT, twinOf(webp));
  const t = await encode(w);
  const before = fs.statSync(w).size;
  if (!t) {
    if (fs.existsSync(a)) fs.unlinkSync(a);
    delete list[webp];
    console.log('  ' + webp + ': no twin (AVIF is not smaller at the same quality)');
    return;
  }
  fs.writeFileSync(a, t.buf);
  list[webp] = { q: t.q, webp: md5(fs.readFileSync(w)), avif: md5(t.buf) };
  console.log('  ' + twinOf(webp) + '  q' + t.q + '  ' + (before / 1024).toFixed(0) + ' KB -> ' + (t.buf.length / 1024).toFixed(0) + ' KB' +
    '  (' + t.rgb.toFixed(1) + ' dB, worst square ' + t.worst.toFixed(1) + ' dB)');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--check')) {
    const bad = problems();
    if (bad.length) { console.error('the AVIF twins are out of date — run: node tools/build-avif.js\n  ' + bad.join('\n  ')); process.exit(1); }
    console.log('the AVIF twins are up to date (' + Object.keys(readList()).length + ')');
    return;
  }
  const list = readList();
  const add = args.includes('--add') ? args.filter((a) => !a.startsWith('--')).map((a) => rel(path.resolve(process.cwd(), a))) : [];
  for (const webp of add) {
    if (!/^assets\/.+\.webp$/.test(webp) || !fs.existsSync(path.join(ROOT, webp))) throw new Error('not a .webp under assets/: ' + webp);
    await make(list, webp);
  }
  for (const webp of Object.keys(list)) {
    if (add.includes(webp)) continue;
    const t = list[webp], w = path.join(ROOT, webp), a = path.join(ROOT, twinOf(webp));
    if (!fs.existsSync(w)) { delete list[webp]; if (fs.existsSync(a)) fs.unlinkSync(a); console.log('  ' + webp + ': gone, and its twin with it'); continue; }
    if (fs.existsSync(a) && md5(fs.readFileSync(w)) === t.webp && md5(fs.readFileSync(a)) === t.avif) continue;
    await make(list, webp);
  }
  writeList(list);
  console.log(Object.keys(list).length + ' twins. Now run: node tools/build-preload.js');
}

module.exports = { problems: problems, encode: encode, RULE: RULE };
if (require.main === module) main().catch((e) => { console.error(e.message || e); process.exit(1); });
