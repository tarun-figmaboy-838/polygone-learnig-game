/* THE GAME IN ANOTHER LANGUAGE — ?lan=hi (or mr, te, gu, od; en is the default).
 *
 * WHAT IT IS. The words come from polygon-locales.json at the repository's root, which
 * tools/build-locales.js copies into a script (locales.js, beside this file) so they are in
 * hand before the first word is drawn and the page still opens straight off the disk. This
 * file reads ?lan= once, picks that language's block and answers every question the game asks
 * about words. Part 2 loads a copy of this same file (part2-frozen-rush/game/js/i18n.js, written
 * by the same tool), so both halves pick the language the same way.
 *
 * ENGLISH IS UNTOUCHED. With no ?lan= (or ?lan=en) `on` is false and every function hands its
 * input straight back, so the English game is the English game byte for byte. The code that
 * calls in here only changes what it shows when `on` is true.
 *
 * THE GAME STILL THINKS IN ENGLISH. Its lines, labels and answers are written in English
 * (screens.js, stage.js), its logic compares English ("Inside" is the right answer, a name tag
 * arrives on the word "side"), and that stays as it is. A line is turned into the chosen
 * language as it is shown — tr() looks the English up and hands back the translation — and
 * the scenes that wait for a word are told the ENGLISH word a translated word stands for
 * (cues), so "अंदर" brings the Inside button in exactly as "inside" did.
 *
 * A VOICE ONLY WHERE ONE WAS RECORDED. English has its recordings, and Hindi has its own
 * (VOICED below): Part 1 plays them from assets/vo/hi/ and Part 2 from its Hindi take, each
 * word timed off the Hindi recording (tools/build-vo-hindi.js), so the voice says what the
 * screen says. Any other language has none — an English voice over its words would say one
 * thing while the screen says another — so `voice` is false there and the lines are timed by
 * their own words, the path a run with no clip has always taken.
 *
 *   I18N.lang / on / voice     'hi', true, true   ('mr', true, false; 'en', false, true)
 *   I18N.t(key, vars)          a text of this language by its key, {name}s filled in
 *   I18N.tr(text)              an English line, label or "6 cm" in this language (else unchanged)
 *   I18N.trParts(text, parts)  the script's bubble breaks of a line, in this language (or null)
 *   I18N.html(text)            tr(), keeping a line's <strong> key word (Part 2's plank)
 *   I18N.english(text)         the English a shown line came from ('' if it is not a known line)
 *   I18N.termOf(word)          the lesson's key word a shown word is (dual-coding.js), or null
 *   I18N.cues(word)            the English words a shown word stands for (stage.js holdForWord)
 *   I18N.isWord(word, key)     whether a shown word is one of a list (nameMomo, tutKeyWords, term*)
 *   I18N.wordIndex(en, tr, i)  which word of the translation says what word i of the English says
 *   I18N.keep(url)             a link with ?lan= carried on, so the next page speaks the same
 *   I18N.applyDom(root)        the page's own words: [data-i18n], [data-i18n-aria], [data-i18n-title]
 *   I18N.misses                English that reached tr() and had no translation (for the tests)
 */
(function (global) {
  'use strict';

  var LANGS = ['en', 'hi', 'mr', 'te', 'gu', 'od'];
  var ALIAS = { or: 'od', ory: 'od', odia: 'od', oriya: 'od', hin: 'hi', mar: 'mr', tel: 'te', guj: 'gu', eng: 'en' };
  /* the BCP 47 tag for <html lang> — Odia's is "or", whatever the address calls it */
  var HTML_LANG = { en: 'en', hi: 'hi', mr: 'mr', te: 'te', gu: 'gu', od: 'or' };
  /* THE SAME ROUNDED LETTERS IN EVERY SCRIPT: Baloo 2 is the face the game's stacks already name,
     and it has a sister for each script (index.html / style.css: html[data-font]) */
  var FONT = { hi: 'Baloo 2', mr: 'Baloo 2', te: 'Baloo Tammudu 2', gu: 'Baloo Bhai 2', od: 'Baloo Bhaina 2' };
  var SCRIPT = { hi: 'deva', mr: 'deva', te: 'telu', gu: 'gujr', od: 'orya' };
  /* THE LANGUAGES WITH A RECORDED VOICE besides English (the folder Part 1 plays them from is
     named after the language: assets/vo/hi/) */
  var VOICED = { hi: true };
  /* the lesson's key words (dual-coding.js TERMS) and the list that says each in this language */
  var TERM_KEYS = [
    ['irregular', 'termIrregular'], ['polygon', 'termPolygon'], ['vertex', 'termVertex'],
    ['diagonal', 'termDiagonal'], ['side', 'termSide'], ['angle', 'termAngle'],
    ['convex', 'termConvex'], ['concave', 'termConcave'], ['regular', 'termRegular'],
    ['line segment', 'termLineSegment'], ['drag', 'termDrag'], ['draw', 'termDraw'],
    ['outside', 'termOutside'], ['inside', 'termInside'], ['inward', 'termInward'], ['equal', 'termEqual']
  ];
  /* what a word may carry either side of it: quotes, brackets, and every script's full stops */
  var LEAD = /^[(\[{"'“‘«]+/;
  var TAIL = /[.,!?;:%)\]}"'”’»…।॥—–-]+$/;

  function asked(loc) {
    var q = '';
    try { q = String((loc && loc.search) || ''); } catch (e) { q = ''; }
    var m = /[?&](?:lan|lang)=([^&#]*)/i.exec(q);
    if (!m) return 'en';
    var v = '';
    try { v = decodeURIComponent(m[1]); } catch (e) { v = m[1]; }
    v = v.trim().toLowerCase();
    return ALIAS[v] || v;
  }

  function make(lang, data) {
    data = data || {};
    var EN = data.en || {};
    if (LANGS.indexOf(lang) < 0 || !data[lang]) lang = 'en';
    var LOC = data[lang] || EN;
    var on = lang !== 'en';
    var misses = [];

    var plain = function (s) { return String(s == null ? '' : s).replace(/<\/?strong>/g, ''); };
    var norm = function (s) {
      return plain(s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
    };
    var bare = function (w) { return String(w == null ? '' : w).replace(LEAD, '').replace(TAIL, '').toLowerCase(); };
    var words = function (s) { return plain(s).trim().split(/\s+/).filter(Boolean); };

    /* EVERY ENGLISH TEXT, BY WHAT IT SAYS — and every translation, by the same key, the other way */
    var REV = {}, BACK = {}, PART = {};
    Object.keys(EN).forEach(function (k) {
      var v = EN[k];
      if (typeof v === 'string') {
        if (!(norm(v) in REV)) REV[norm(v)] = k;
        if (typeof LOC[k] === 'string' && !(norm(LOC[k]) in BACK)) BACK[norm(LOC[k])] = k;
      } else if (/Parts$/.test(k) && Array.isArray(v)) {
        v.forEach(function (p, i) { if (!(norm(p) in PART)) PART[norm(p)] = [k, i]; });
      }
    });

    function fill(s, vars) {
      if (!vars) return s;
      return String(s).replace(/\{(\w+)\}/g, function (m, n) { return vars[n] != null ? String(vars[n]) : m; });
    }
    function t(key, vars) {
      var v = LOC[key];
      if (v == null) v = EN[key];
      if (v == null) return '';
      return fill(v, vars);
    }
    function miss(s) {
      if (misses.indexOf(s) < 0 && misses.length < 200) misses.push(s);
    }
    /* English is told apart by its letters: a translated line has none of ours (a number, a
       degree, "XP" inside a sentence of another script is not English waiting to be turned) */
    var looksEnglish = function (s) { return /[A-Za-z]{2,}/.test(s) && !/[ऀ-෿]/.test(s); };

    function find(s) {
      var k = REV[norm(s)];
      if (k && LOC[k] != null) return LOC[k];
      var p = PART[norm(s)];
      if (p && LOC[p[0]] && LOC[p[0]][p[1]] != null) return LOC[p[0]][p[1]];
      var cm = /^(\d+(?:\.\d+)?)\s*cm$/.exec(String(s).trim());
      if (cm) return cm[1] + ' ' + t('unitCm');
      return null;
    }
    /* AN ENGLISH TEXT IN THIS LANGUAGE — a whole line, a bubble's part of one, a label, a reading.
       Anything else (a number, a letter, words already translated) comes back as it went in. */
    function tr(text) {
      if (!on || text == null) return text;
      var s = String(text);
      if (!s || !looksEnglish(s)) return text;
      var hit = find(s);
      if (hit == null) { miss(s); return text; }
      return plain(hit);
    }
    /* Part 2's plank keeps its key word: "Cut the concave <strong>polygon</strong>." */
    function html(text) {
      if (!on || text == null) return text;
      var s = String(text);
      if (!s || !looksEnglish(s)) return text;
      var hit = find(s);
      if (hit == null) { miss(s); return text; }
      return hit;
    }
    /* THE SCRIPT'S OWN BREAKS ("A line segment joining" / "two non-adjacent vertices" / "is a
       diagonal."), as the translation breaks the same line. null: the line has none. */
    function trParts(text, parts) {
      if (!on || !parts || !parts.length) return parts || null;
      var k = REV[norm(text)] || REV[norm([].concat(parts).join(' '))];
      var tp = k ? LOC[k + 'Parts'] : null;
      if (tp && tp.length) return tp.slice();
      return null;
    }
    function english(text) {
      if (!on) return text == null ? '' : String(text);
      var k = BACK[norm(text)];
      return k && typeof EN[k] === 'string' ? plain(EN[k]) : '';
    }

    /* A WORD AND A LIST. An entry matches the word exactly, or — ending in "*" — any word that
       starts with it (a stem, for the endings a word takes: "बहुभुज*" is बहुभुज and बहुभुजों). */
    function inList(word, list) {
      if (!list || !list.length) return false;
      var w = bare(word);
      if (!w) return false;
      for (var i = 0; i < list.length; i++) {
        var e = String(list[i]).toLowerCase();
        if (e.charAt(e.length - 1) === '*') { if (w.indexOf(e.slice(0, -1)) === 0) return true; }
        else if (w === e) return true;
      }
      return false;
    }
    function isWord(word, key) { return inList(word, LOC[key]); }
    function termOf(word) {
      for (var i = 0; i < TERM_KEYS.length; i++) if (inList(word, LOC[TERM_KEYS[i][1]])) return TERM_KEYS[i][0];
      return null;
    }
    /* THE ENGLISH WORDS A SHOWN WORD STANDS FOR: every list it is on gives its English forms
       ("भुजाएँ" → side, sides). In English a word is just itself. */
    var CUE_KEYS = Object.keys(EN).filter(function (k) { return /^term/.test(k) && Array.isArray(EN[k]); });
    function cues(word) {
      if (!on) return word == null ? [] : [String(word)];
      var out = [];
      CUE_KEYS.forEach(function (k) {
        if (inList(word, LOC[k])) (EN[k] || []).forEach(function (e) { if (out.indexOf(e) < 0) out.push(e); });
      });
      return out;
    }
    function enKeyOf(word) {
      var w = bare(word);
      for (var i = 0; i < CUE_KEYS.length; i++) if ((EN[CUE_KEYS[i]] || []).indexOf(w) >= 0) return CUE_KEYS[i];
      return null;
    }
    /* "on its word" in a translated line. The English names a word by its place ("sides" is word
       5); the translation puts it somewhere else. The same key word is found again — the same one
       of them, if the line says it twice — and failing that, the same share of the way along. */
    function wordIndex(en, trText, i) {
      var ew = words(en), tw = words(trText);
      if (!on) return i;
      if (!tw.length) return 0;
      var key = ew[i] != null ? enKeyOf(ew[i]) : null;
      if (key) {
        var n = 0, j, seen = 0, last = -1;
        for (j = 0; j <= i && j < ew.length; j++) if (enKeyOf(ew[j]) === key) n++;
        for (j = 0; j < tw.length; j++) {
          if (inList(tw[j], LOC[key])) { seen++; last = j; if (seen === n) return j; }
        }
        if (last >= 0) return last;
      }
      if (ew.length <= 1) return 0;
      return Math.min(tw.length - 1, Math.round(i * (tw.length - 1) / (ew.length - 1)));
    }

    /* THE NEXT PAGE IN THE SAME LANGUAGE: every link the game builds goes through here */
    function keep(url) {
      if (!on || url == null) return url;
      var s = String(url);
      if (/[?&]lan=/.test(s)) return s;
      var hash = '', h = s.indexOf('#');
      if (h >= 0) { hash = s.slice(h); s = s.slice(0, h); }
      return s + (s.indexOf('?') >= 0 ? '&' : '?') + 'lan=' + lang + hash;
    }

    /* THE PAGE'S OWN WORDS. data-i18n="key" is the text, data-i18n-aria its aria-label,
       data-i18n-title its title (and <title data-i18n> the tab). */
    function applyDom(root) {
      var doc = root && (root.ownerDocument || root);
      if (!on || !root || !root.querySelectorAll) return 0;
      var n = 0;
      [].slice.call(root.querySelectorAll('[data-i18n]')).forEach(function (el) {
        var v = t(el.getAttribute('data-i18n'));
        if (!v) return;
        if (el.hasAttribute('data-i18n-html')) el.innerHTML = v; else el.textContent = v;
        n++;
      });
      [].slice.call(root.querySelectorAll('[data-i18n-aria]')).forEach(function (el) {
        var v = t(el.getAttribute('data-i18n-aria'));
        if (v) { el.setAttribute('aria-label', v); n++; }
      });
      [].slice.call(root.querySelectorAll('[data-i18n-title]')).forEach(function (el) {
        var v = t(el.getAttribute('data-i18n-title'));
        if (v) { el.setAttribute('title', v); n++; }
      });
      if (doc && doc.documentElement && doc.documentElement.classList) doc.documentElement.classList.remove('i18n-wait');
      return n;
    }

    return {
      lang: lang, on: on, voice: !on || !!VOICED[lang],
      htmlLang: HTML_LANG[lang] || 'en',
      font: on ? FONT[lang] || null : null,
      script: on ? SCRIPT[lang] || null : null,
      labels: data.languageLabels || null,
      t: t, tr: tr, html: html, trParts: trParts, english: english,
      termOf: termOf, cues: cues, isWord: isWord, wordIndex: wordIndex,
      keep: keep, applyDom: applyDom,
      misses: misses,
      make: function (l) { return make(ALIAS[l] || l, data); }
    };
  }

  var I = make(asked(global.location), global.POLYGON_LOCALES || null);

  /* AND THE PAGE IS TOLD: its language, the letters it is drawn in, and the face for them */
  var doc = global.document;
  if (doc && doc.documentElement) {
    var html = doc.documentElement;
    if (I.on) {
      html.setAttribute('lang', I.htmlLang);
      if (I.script) html.setAttribute('data-font', I.script);
    }
    var fontWait = Promise.resolve();
    if (I.font && doc.createElement && doc.head) {
      fontWait = new Promise(function (res) {
        var link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=' + I.font.replace(/ /g, '+') + ':wght@500;600;700;800&display=swap';
        link.onload = link.onerror = function () { res(); };
        setTimeout(res, 3000);                 // a font that will not come does not hold the game
        doc.head.appendChild(link);
      });
    }
    /** the faces of this language's letters, once their stylesheet is in (game.js: the loading bar) */
    I.fontReady = function () { return fontWait; };
    /* the words already on the page are put into this language as soon as it is all there; a
       script that runs before the body has been parsed waits for it */
    if (I.on) {
      if (doc.readyState === 'loading' && doc.addEventListener) doc.addEventListener('DOMContentLoaded', function () { I.applyDom(doc); });
      else I.applyDom(doc);
    } else if (html.classList) html.classList.remove('i18n-wait');
  }

  global.I18N = I;
  if (typeof module !== 'undefined' && module.exports) module.exports = I;
})(typeof window !== 'undefined' ? window : this);
