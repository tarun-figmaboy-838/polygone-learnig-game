/*!
 * vo.js — Swiftee's voice.
 *
 * One clip per line, named by the VO id the deck gives the line:
 *
 *   assets/vo/<id>.mp3          e.g. assets/vo/p04.mp3, assets/vo/fb01.mp3
 *
 * docs/VO.md lists every id with its words and how it is delivered. The
 * game asks for a clip whenever a line with an id is spoken (game.js, the
 * say handler and the feedback in react()). A clip that is not there is
 * simply not heard — the words and the reading time carry the line — so the
 * clips can be added a few at a time. One clip plays at a time: a new line
 * stops the last. Muting the game mutes him.
 */
(function (global) {
  'use strict';
  var BASE = 'assets/vo/', EXT = '.mp3';
  var current = null, known = {};   // known[id] = false once a clip has failed to load
  // THE INDEX. assets/vo/index.json lists the clips that exist; only those
  // are ever requested. Asking the server for a clip that is not there logs
  // a 404 in the console for every line — noise a child never hears but a
  // test gate counts as an error. tools/build-vo-index.js writes the index
  // from the folder; until it is fetched, or if it is missing, nothing plays.
  var index = null;
  function loadIndex() {
    if (index || typeof fetch !== 'function') return;
    index = {};
    fetch(BASE + 'index.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      (j && j.clips || []).forEach(function (id) { index[id] = true; });
    }).catch(function () {});
  }
  loadIndex();

  function muted() { return !!(global.SFX && SFX.isMuted && SFX.isMuted()); }

  function stop() {
    if (!current) return;
    try { current.pause(); current.currentTime = 0; } catch (e) {}
    current = null;
  }

  /** Play the clip for a line. Returns the Audio element, or null. */
  function play(id) {
    if (!id || typeof Audio === 'undefined' || known[id] === false || muted() || !index || !index[id]) return null;
    stop();
    var a;
    try { a = new Audio(BASE + id + EXT); } catch (e) { return null; }
    a.preload = 'auto';
    a.volume = 0.95;
    a.addEventListener('error', function () { known[id] = false; if (current === a) current = null; });
    a.addEventListener('ended', function () { if (current === a) current = null; });
    current = a;
    var p = a.play();
    if (p && p.catch) p.catch(function () { if (current === a) current = null; });
    return a;
  }

  /** Warm the clips a screen is about to need. */
  function preload(ids) {
    (ids || []).forEach(function (id) {
      if (!id || known[id] != null || !index || !index[id]) return;
      try { var a = new Audio(BASE + id + EXT); a.preload = 'auto'; known[id] = true; a.addEventListener('error', function () { known[id] = false; }); } catch (e) {}
    });
  }

  global.VO = { play: play, stop: stop, preload: preload, get playing() { return current; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.VO;
})(typeof window !== 'undefined' ? window : this);
