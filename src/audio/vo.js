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
  var BASE = 'assets/vo/';
  // THE FORMAT THE BROWSER CAN ACTUALLY PLAY. Every clip is written twice —
  // Vorbis in an .ogg, which Chrome, Firefox and Android take and which is
  // about half the size, and an .mp3, which Safari and iOS are the only ones
  // that need. Asking canPlayType once means nobody downloads the format
  // they cannot use. Unknown answers fall back to mp3, which plays anywhere.
  var EXT = (function () {
    try {
      var a = document.createElement('audio');
      if (a.canPlayType && a.canPlayType('audio/ogg; codecs=\"vorbis\"')) return '.ogg';
    } catch (e) {}
    return '.mp3';
  }());
  var current = null, known = {};   // known[id] = false once a clip has failed to load
  // THE INDEX. assets/vo/index.json lists the clips that exist; only those
  // are ever requested. Asking the server for a clip that is not there logs
  // a 404 in the console for every line — noise a child never hears but a
  // test gate counts as an error. tools/build-vo-index.js writes the index
  // from the folder; until it is fetched, or if it is missing, nothing plays.
  var index = null, secs = {};
  /* OPENED STRAIGHT OFF THE DISK, THERE IS NO LIST TO READ. A file:// page
     may not fetch a sibling file — Chrome blocks it as a cross-origin read —
     so the index never arrives, nothing is ever allowed, and the game plays
     in silence for anyone who double-clicks index.html. The list exists to
     keep a 404 out of the console on a server; off the disk there is no
     server and no gate: the clip is asked for, and if it is not there the
     error handler forgets it exactly as it always did. */
  var offDisk = (function () {
    try { return (global.location && global.location.protocol) === 'file:'; } catch (e) { return false; }
  }());
  function loadIndex() {
    if (index || offDisk || typeof fetch !== 'function') return;
    index = {};
    // no-cache, not no-store: the list changes when clips are added, and a
    // browser that read it when it was empty must not keep that answer. The
    // clips themselves stay immutable; only this one file is revalidated.
    fetch(BASE + 'index.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      (j && j.clips || []).forEach(function (id) { index[id] = true; });
      secs = (j && j.seconds) || {};
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
    if (!id || typeof Audio === 'undefined' || known[id] === false || muted()) return null;
    if (!offDisk && (!index || !index[id])) return null;
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
      if (!id || known[id] != null) return;
      if (!offDisk && (!index || !index[id])) return;
      try { var a = new Audio(BASE + id + EXT); a.preload = 'auto'; known[id] = true; a.addEventListener('error', function () { known[id] = false; }); } catch (e) {}
    });
  }

  /** How long a clip runs, in seconds, or 0 if it is not known yet.
      The game paces a line's bubbles by this so the words keep step with the
      voice instead of with a count of their own letters. */
  function seconds(id) { return (id && secs[id]) || 0; }

  global.VO = { play: play, stop: stop, preload: preload, seconds: seconds, get playing() { return current; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.VO;
})(typeof window !== 'undefined' ? window : this);
