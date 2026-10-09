/*!
 * avif.test.js — the AVIF twins are current, and every place that draws a picture agrees on them.
 *
 *   node tests/avif.test.js
 *
 *   THE TWINS   Every .avif under assets/ was made by tools/build-avif.js from the .webp beside it
 *               as it is now, and is listed in tools/avif-twins.json (a rebuilt .webp, a hand-made
 *               .avif or a forgotten twin all fail here).
 *   THE LIST    src/core/preload-list.js is current, and PreloadList.avif names every twin.
 *   THE PAGE    Each address the stylesheet asks for a twin by is the one PreloadList.avif gives
 *               Preload.pick, so the loading bar warms what is drawn; and every stylesheet use of a
 *               twinned .webp offers its twin, or the scripts and the stylesheet would fetch both.
 *   THE CHOICE  Preload.pick hands back the twin only where the probe said AVIF, and only for a
 *               picture that has one; and the probe in index.html is the same code as Part 2's.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const LESSON = path.join(__dirname, '..');
const REPO = path.join(LESSON, '..');

let pass = 0, fail = 0;
const t = (label, cond, extra) => {
  if (cond) pass++;
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
};

/* ---- THE TWINS ---- */
const { problems } = require('../tools/build-avif.js');
const bad = problems();
t('every AVIF twin is current and listed (node tools/build-avif.js)', bad.length === 0, bad);
const list = JSON.parse(fs.readFileSync(path.join(LESSON, 'tools', 'avif-twins.json'), 'utf8'));
t('there are twins at all', Object.keys(list).length > 0);
t("Swiftee's sheets have none (lossless WebP is smaller there)", Object.keys(list).every((f) => !/\/spritesheets\//.test(f)));

/* ---- THE LIST ---- */
const check = spawnSync(process.execPath, [path.join(LESSON, 'tools', 'build-preload.js'), '--check'], { encoding: 'utf8' });
t('src/core/preload-list.js is up to date (node tools/build-preload.js)', check.status === 0, (check.stderr || '').trim());
global.window = global;
require('../src/core/preload-list.js');
const twins = global.PreloadList.avif || {};
Object.keys(list).forEach((webp) => {
  const avif = webp.replace(/\.webp$/, '.avif');
  t(webp + ': PreloadList.avif names its twin', twins[webp] && twins[webp].split('?')[0] === avif, twins[webp]);
});

/* ---- THE PAGE ---- */
const html = fs.readFileSync(path.join(LESSON, 'index.html'), 'utf8');
const literals = html.match(/assets\/[A-Za-z0-9_\-./@]+\.avif\?v=[0-9a-f]+/g) || [];
t('the page asks for some twins itself (the stylesheet and the backdrop preload)', literals.length > 0);
literals.forEach((u) => {
  const webp = u.split('?')[0].replace(/\.avif$/, '.webp');
  t(u + ' is the address Preload.pick gives ' + webp, twins[webp] === u, twins[webp]);
});
// every declaration that names a twinned .webp is followed by one offering the twin
const css = (html.match(/<style[^>]*>[\s\S]*?<\/style>/g) || []).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
const decls = css.split(/[;{}]/).map((d) => d.trim());
decls.forEach((d, i) => {
  const m = /^[\w-]+\s*:.*url\("(assets\/[^"?]+\.webp)(?:\?v=[0-9a-f]+)?"\)/.exec(d);
  if (!m || /image-set\(/.test(d) || !twins[m[1]]) return;
  const next = decls[i + 1] || '';
  t('the stylesheet offers ' + m[1] + "'s twin with image-set()", next.indexOf('image-set(') >= 0 && next.indexOf(twins[m[1]]) >= 0 &&
    next.split(':')[0].trim() === d.split(':')[0].trim(), next.slice(0, 80));
});

/* ---- THE CHOICE ---- */
const Preload = require('../src/core/preload.js');
const one = Object.keys(twins)[0];
global.ImgFormat = { avif: false, settled: true };
t('no AVIF: a twinned picture stays the .webp', Preload.pick(one + '?v=12345678') === one + '?v=12345678');
global.ImgFormat = { avif: true, settled: true };
t('AVIF: a twinned picture becomes its twin, whatever ?v= it was named with', Preload.pick(one + '?v=12345678') === twins[one]);
t('AVIF: a picture without a twin stays itself', Preload.pick('assets/ui/snowflake.webp') === 'assets/ui/snowflake.webp');
t('AVIF: a voice clip stays itself', Preload.pick('assets/vo/p01.mp3') === 'assets/vo/p01.mp3');
delete global.ImgFormat;
t('no probe at all: everything stays itself', Preload.pick(one) === one);

const probeOf = (s) => { const m = /<script>\s*\(function \(w\) \{\s*var F = w\.ImgFormat[\s\S]*?<\/script>/.exec(s); return m && m[0]; };
const p1 = probeOf(html);
const P2_PAGE = path.join(REPO, 'part2-frozen-rush', 'game', 'index.html');
t('the probe is in the page', !!p1);
if (fs.existsSync(P2_PAGE)) t('and it is the same code as Frozen Rush\'s (one answer for both halves)', p1 && p1 === probeOf(fs.readFileSync(P2_PAGE, 'utf8')));
else t('(no Frozen Rush beside this repository: the probe comparison does not apply)', true);

console.log((fail ? 'FAILED' : 'ok') + '  avif: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
