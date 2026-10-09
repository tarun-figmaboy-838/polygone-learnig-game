/*!
 * preload.js — the loading bar: every file the lesson and the story need, fetched before Start.
 *
 *   Preload.want(urls, { keep: /re/ })   put files on the list (duplicates are ignored)
 *   Preload.font(css, weight)            and a font face (document.fonts.load)
 *   Preload.seal()                       the list is complete: the bar may finish
 *   Preload.onProgress(fn)               fn(fraction 0..1) on every step — forward only
 *   Preload.done                         settles when every file is in (or has failed)
 *   Preload.url(u)                       the blob: URL for a kept file, else u itself
 *   Preload.pick(u)                      a picture's address as this browser should ask for it
 *
 * AVIF WHERE IT IS SHOWN. Some pictures have an AVIF twin beside the .webp: the same pixels
 * in fewer bytes (tools/build-avif.js; PreloadList.avif names each twin's address). Where
 * index.html's probe says this browser shows AVIF (ImgFormat.avif), pick() turns a .webp
 * address into its twin's, and want() fetches every picture through it — so the bar warms
 * exactly what the scripts then draw, as they draw through pick() too, and what the
 * stylesheet's image-set() asks for. Anywhere else, and for every picture without a twin,
 * pick() hands back the address it was given.
 *
 * STREAMED, SO THE BAR IS BYTES. Each response is read chunk by chunk. Every transfer is
 * weighed by its size on disk (PreloadList.sizes, from tools/build-preload.js) from the
 * start and corrected by Content-Length when it arrives, and the bar only moves forward.
 *
 * SMALLEST FIRST, FIVE AT A TIME. The list is sorted once it is in, so the cards, the buttons
 * and the voice clips land in the first seconds and the big sprite sheets fill the rest.
 *
 * LOADED MEANS LOCAL. A file on the `keep` list (the voice clips, the story's paintings) is
 * held as a Blob and handed out as a blob: URL (Preload.url), so its element plays or draws
 * from memory; every other file is read through to the end, which leaves it in the browser's
 * HTTP cache (vercel.json keeps assets fresh for an hour), so the element that asks for it
 * later is answered without the network. Nothing is downloaded twice.
 *
 * NEVER A WALL. A transfer that fails, stalls for 15 s or runs past 2 minutes counts as done,
 * and its element simply asks for the file itself. Off the disk (file://), or where there is no
 * fetch at all, everything counts as done at once and the lesson loads the way it always did.
 */
(function (global) {
  'use strict';

  var LIMIT = 5, STALL_MS = 15000, CAP_MS = 120000, FONT_MS = 8000, FONT_BYTES = 30000;
  var jobs = {}, queue = [], listeners = [];
  var active = 0, total = 0, loaded = 0, shown = 0, planned = 0, settledN = 0, sealed = false, isDone = false;
  var finish;
  var done = new Promise(function (r) { finish = r; });
  var usable = (function () {
    try { return typeof global.fetch === 'function' && global.location && global.location.protocol !== 'file:'; }
    catch (e) { return false; }
  }());
  var sizes = (global.PreloadList && global.PreloadList.sizes) || {};
  function sizeOf(u) { return sizes[String(u).split('?')[0]] || 40000; }
  var twins = (global.PreloadList && global.PreloadList.avif) || {};
  function pick(u) {
    if (!u || !global.ImgFormat || !global.ImgFormat.avif) return u;
    return twins[String(u).split('?')[0]] || u;
  }

  function emit() {
    var f = total > 0 ? Math.min(1, loaded / total) : 1;
    if (f > shown) shown = f;                                    // forward only
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](shown); } catch (e) {} }
  }
  function check() {
    if (isDone || !sealed || settledN < planned) return;
    isDone = true; shown = 1; emit(); finish();
  }
  function settle(job, blob) {
    if (job.settled) return;
    job.settled = true;
    if (job.started) active = Math.max(0, active - 1);
    if (blob && job.keep) { try { job.blobUrl = URL.createObjectURL(blob); } catch (e) { job.blobUrl = null; } }
    loaded += Math.max(0, job.expect - job.got); job.got = job.expect;
    settledN++;
    emit(); check(); pump();
  }

  function run(job) {
    job.started = true;
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var stall = 0, cap = setTimeout(function () { if (ctl) ctl.abort(); }, CAP_MS);
    function arm() { clearTimeout(stall); stall = setTimeout(function () { if (ctl) ctl.abort(); }, STALL_MS); }
    function end(blob) { clearTimeout(stall); clearTimeout(cap); settle(job, blob); }
    arm();
    global.fetch(job.url, ctl ? { signal: ctl.signal } : undefined).then(function (res) {
      if (!res.ok) throw new Error(String(res.status));
      var cl = Number(res.headers.get('content-length')) || 0;
      if (cl && cl !== job.expect) { total += cl - job.expect; job.expect = cl; }
      var type = res.headers.get('content-type') || '';
      if (!res.body || !res.body.getReader) return res.blob().then(function (b) { end(job.keep ? b : null); });
      var reader = res.body.getReader(), parts = [];
      function pull() {
        return reader.read().then(function (r) {
          if (r.done) { end(job.keep ? new Blob(parts, type ? { type: type } : undefined) : null); return; }
          if (job.keep) parts.push(r.value);
          arm();
          var add = Math.min(r.value.byteLength, Math.max(0, job.expect - job.got));
          job.got += add; loaded += add; emit();
          return pull();
        });
      }
      return pull();
    }).catch(function () { end(null); });                       // failed, stalled or aborted: done
  }

  /* THE QUEUE IS SORTED ONCE THE LIST IS IN: the whole list is asked for in one go, and a
     file started the moment it was named would jump ahead of smaller ones named after it. */
  var pumpQueued = false;
  function later() {
    if (pumpQueued) return;
    pumpQueued = true;
    Promise.resolve().then(function () { pumpQueued = false; pump(); });
  }
  function pump() {
    while (active < LIMIT && queue.length) {
      queue.sort(function (a, b) { return a.expect - b.expect; });
      var job = queue.shift();
      if (job.settled) continue;
      active++;
      run(job);
    }
  }

  function add(url, keep) {
    if (!url || jobs[url]) { if (jobs[url] && keep) jobs[url].keep = true; return; }
    var job = { url: url, expect: sizeOf(url), got: 0, keep: !!keep, settled: false, started: false, blobUrl: null };
    jobs[url] = job;
    total += job.expect; planned++;
    if (!usable) settle(job, null);
    else { queue.push(job); later(); }
  }

  var api = {
    want: function (urls, opts) {
      var keep = opts && opts.keep;
      (urls || []).forEach(function (u) { u = pick(u); add(u, keep ? keep.test(u) : false); });
      emit();
    },
    /** A font face, loaded through document.fonts; counted as a small file on the bar.
        `text` names the letters wanted (a script's faces come in parts, one per alphabet), and
        `after` is a promise to wait for first — the stylesheet that says where the face is. */
    font: function (css, text, after) {
      var key = 'font:' + css + (text ? '|' + text : '');
      if (jobs[key]) return;
      // (not one of the five fetch slots: the browser loads the face itself)
      var job = { url: key, expect: FONT_BYTES, got: 0, keep: false, settled: false, started: false, blobUrl: null };
      jobs[key] = job; total += job.expect; planned++;
      var fonts = global.document && global.document.fonts;
      if (!fonts || !fonts.load || !usable) { settle(job, null); return; }
      var t = setTimeout(function () { settle(job, null); }, FONT_MS + (after ? FONT_MS : 0));
      var go = function () {
        (text ? fonts.load(css, text) : fonts.load(css)).then(function () { clearTimeout(t); settle(job, null); }, function () { clearTimeout(t); settle(job, null); });
      };
      if (after && after.then) after.then(go, go); else go();
    },
    seal: function () { sealed = true; check(); },
    onProgress: function (fn) { listeners.push(fn); try { fn(shown); } catch (e) {} },
    url: function (u) { var j = jobs[u]; return (j && j.blobUrl) || u; },
    pick: pick,
    done: done
  };
  global.Preload = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
