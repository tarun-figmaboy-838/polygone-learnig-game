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
  var liveId = null;                // the id of the clip `current` is playing
  // THE INDEX. assets/vo/index.json lists the clips that exist; only those
  // are ever requested. Asking the server for a clip that is not there logs
  // a 404 in the console for every line — noise a child never hears but a
  // test gate counts as an error. tools/build-vo-index.js writes the index
  // from the folder; until it is fetched, or if it is missing, nothing plays.
  var index = null, secs = {}, revs = {}, wordMs = {};
  var indexWait = null, indexSettled = false;
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
    if (indexWait || indexSettled) return indexWait;
    if (offDisk || typeof fetch !== 'function') {
      indexSettled = true;
      return Promise.resolve();
    }
    index = {};
    // no-cache, not no-store: the list changes when clips are added, and a
    // browser that read it when it was empty must not keep that answer. The
    // clips themselves stay immutable; only this one file is revalidated.
    indexWait = fetch(BASE + 'index.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      (j && j.clips || []).forEach(function (id) { index[id] = true; });
      secs = (j && j.seconds) || {};
      revs = (j && j.rev) || {};
      wordMs = (j && j.words) || {};
    }).catch(function () {}).then(function () { indexSettled = true; });
    return indexWait;
  }
  loadIndex();

  function ready() { return indexSettled ? Promise.resolve() : (indexWait || loadIndex()); }

  /* WHERE A CLIP LIVES, revision and all.
   *
   * The clips are served immutable for a year (vercel.json), which is right
   * until one is re-cut — and re-cutting replaces the words inside a file
   * that keeps its name, so a returning child would hear the old line until
   * the cache aged out. The index carries a hash of each clip's bytes and is
   * itself revalidated, so asking for it by revision makes a corrected clip
   * arrive on the next load and leaves every unchanged clip in the cache. */
  function url(id) {
    var v = revs[id];
    return BASE + id + EXT + (v ? '?v=' + v : '');
  }

  function muted() { return !!(global.SFX && SFX.isMuted && SFX.isMuted()); }

  /* WAITING FOR THE VOICE.
   *
   * The lesson used to wait a computed number of milliseconds and hope the
   * clip fitted inside it. It usually did; when it did not — a slow decode, a
   * throttled tab, a clip a little longer than the estimate — the next thing
   * began over the end of the sentence. finished() is the real answer: it
   * settles when the clip ends, when it fails, or when something stops it,
   * and settles immediately when there is nothing playing. It can never be
   * the thing that hangs the game: the director's beat ceiling is above it,
   * and every path here resolves.
   */
  var settle = null;                 // resolves the promise finished() handed out
  var waiting = null;
  var guard = null;

  function done() {
    var f = settle; settle = null;
    if (guard) { clearTimeout(guard); guard = null; }
    if (f) { try { f(); } catch (e) {} }
  }

  /* HOW MUCH OF THE CLIP IS STILL TO COME, in milliseconds.
   *
   * `duration` is NaN until the browser has read the file's metadata, and it
   * has not read it in the tick play() was called in. Anything that asks the
   * ELEMENT how long a clip is, in the moment that clip starts, is asking a
   * question the element cannot answer yet.
   *
   * The index has the answer instead: tools/build-vo-index.js measures every
   * clip at build time and writes its length into assets/vo/index.json, so
   * the length is known before the file is even requested. The element's own
   * figure is preferred once it arrives, because that one is certainly right.
   */
  function leftMs(a, id) {
    var len = (a && isFinite(a.duration) && a.duration > 0) ? a.duration * 1000
            : (secs[id] ? secs[id] * 1000 : 0);
    if (!len) return 12000;                        // nothing measured it: the ceiling
    var at = (a && isFinite(a.currentTime)) ? a.currentTime * 1000 : 0;
    return Math.max(0, len - at);
  }

  function finished() {
    // NOTHING PLAYING, NOTHING TO WAIT FOR. A clip that never started — no
    // Audio in this environment, a play() the browser refused, a file that is
    // not there — has already cleared `current` through its own error path,
    // so this settles at once rather than holding the lesson up for the
    // length of a clip nobody is hearing.
    //
    // WHAT IT MUST NOT DO IS ASK `duration`.
    //
    // It used to: `!(current.duration > 0)` was read as "nothing is running".
    // duration is NaN for the first few hundred milliseconds of every clip's
    // life, so that test was true for EVERY line, every time, and the wait
    // resolved immediately in all of them. The beat then ended on the
    // director's word count — 3.2s for a sentence the voice takes 9.6s to
    // read — and the next line's clip called stop() on this one mid-word.
    // Twenty-five of the thirty-six recorded lines were cut off that way,
    // some by eight seconds. That is the whole of "the voice is not in step
    // and plays at random": not a wrong clip, the right clip truncated.
    if (!current) return Promise.resolve();
    if (settle) return waiting;
    var hold = current, id = liveId;
    waiting = new Promise(function (resolve) { settle = resolve; });
    // `ended` is the normal way out of this wait. The guard is the promise
    // that it ends even if no event ever arrives, and it can only ever be
    // late, never early.
    guard = setTimeout(done, leftMs(hold, id) + 1500);
    // A clip the index never measured is held by the ceiling above; the
    // moment the browser knows the real length, re-time the guard to it.
    if (!(hold.duration > 0) && hold.addEventListener) {
      var retimed = false;
      hold.addEventListener('loadedmetadata', function () {
        if (retimed || current !== hold || !settle) return;
        retimed = true;
        clearTimeout(guard);
        guard = setTimeout(done, leftMs(hold, id) + 1500);
      });
    }
    return waiting;
  }

  /** Where the voice has got to in the clip, in ms, or null if none is playing.
      The bubbles and the words are stepped against this rather than against a
      timer of their own, so a slow decode carries the text with the voice
      instead of leaving it behind. */
  function at() {
    if (!current) return null;
    var t = current.currentTime;
    return (typeof t === 'number' && isFinite(t)) ? t * 1000 : null;
  }

  function stop() {
    liveId = null;
    if (!current) { done(); return; }
    try { current.pause(); current.currentTime = 0; } catch (e) {}
    current = null;
    done();                          // anything waiting on it is released now
  }

  /** Play the clip for a line. Returns the Audio element, or null. */
  function play(id) {
    if (!id || typeof Audio === 'undefined' || known[id] === false || muted()) return null;
    if (!offDisk && (!index || !index[id])) return null;
    stop();
    var a;
    // THE ONE THAT WAS WARMED, if a screen asked for it ahead of time. Its
    // bytes are already here, so it starts in this frame instead of a
    // network round trip later. Taken out of `warm` because it is no longer
    // waiting to be used — and if it is asked for again the browser's cache
    // answers, which is the whole point of giving the file a revision.
    if (warm[id]) {
      a = warm[id];
      delete warm[id];
      var wi = warmOrder.indexOf(id); if (wi >= 0) warmOrder.splice(wi, 1);
      try { a.currentTime = 0; } catch (e) {}
    } else {
      try { a = new Audio(url(id)); } catch (e) { return null; }
    }
    a.preload = 'auto';
    a.volume = 0.95;
    a.addEventListener('error', function () {
      known[id] = false;
      if (global.console) console.warn('[VO] missing or failed: ' + url(id));
      if (current === a) { current = null; liveId = null; done(); }
    });
    a.addEventListener('ended', function () { if (current === a) { current = null; liveId = null; done(); } });
    current = a;
    liveId = id;
    var p = a.play();
    if (p && p.catch) p.catch(function () {
      // refused (autoplay policy) or failed: release anything waiting on it
      if (global.console) console.warn('[VO] could not play ' + id);
      if (current === a) { current = null; liveId = null; done(); }
    });
    return a;
  }

  /* WARM THE CLIPS A SCREEN IS ABOUT TO NEED.
   *
   * Nothing called this, so every clip was fetched at the instant it was
   * wanted. Over a real connection that is most of a second between the
   * bubble appearing and a sound coming out of it — and now that the words
   * are stepped against the voice's own clock, the line does not race ahead
   * to fill the gap: it shows its first word and stops dead until the audio
   * arrives. Measured at 700ms of added latency, every one of the thirty-odd
   * spoken screens sat on one word for three quarters of a second.
   *
   * THE ELEMENT HAS TO BE KEPT. This built an Audio, set preload and dropped
   * it on the floor; an element nothing references can be collected before
   * the fetch finishes, which makes the warming a coin toss. They are held
   * until played — at which point the fetch is done and the browser's own
   * cache has it, so the reference is no longer what is keeping it warm.
   * `warm` is small by construction: a screen asks for its own clips and the
   * next screen's, so it holds a handful at a time.
   */
  var warm = {}, warmOrder = [];
  var WARM_MAX = 8;
  function preload(ids) {
    (ids || []).forEach(function (id) {
      if (!id || warm[id] || known[id] === false) return;
      if (!offDisk && (!index || !index[id])) return;
      try {
        var a = new Audio(url(id));
        a.preload = 'auto';
        a.addEventListener('error', function () { known[id] = false; delete warm[id]; });
        warm[id] = a;
        warmOrder.push(id);
        while (warmOrder.length > WARM_MAX) { var old = warmOrder.shift(); if (old !== id) delete warm[old]; }
      } catch (e) {}
    });
  }

  /** How long a clip runs, in seconds, or 0 if it is not known yet.
      The game paces a line's bubbles by this so the words keep step with the
      voice instead of with a count of their own letters. */
  function seconds(id) { return (id && secs[id]) || 0; }

  /** Start of each spoken word, in milliseconds from the clip start. */
  function words(id) { return (id && wordMs[id]) || null; }

  global.VO = { play: play, stop: stop, finished: finished, preload: preload, seconds: seconds, words: words, at: at,
                ready: ready,
                get isReady() { return indexSettled; },
                get playing() { return current; },
                /* Which clip is on air. The bubbles check this before they
                   trust at(): a line must never be paced by another line's
                   voice. */
                get id() { return liveId; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.VO;
})(typeof window !== 'undefined' ? window : this);
