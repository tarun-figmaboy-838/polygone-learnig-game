/*!
 * juice.js — the feel. Every effect screens.js can ask for.
 *
 * Two rules, both structural rather than remembered:
 *
 *   ADDITIVE     Every transform runs with `composite: 'add'`, so an effect
 *                layers on top of whatever stage.js or swiftee.js is already
 *                animating instead of overwriting it. A wobble during a
 *                drag does not snap the shape back to its untransformed
 *                place when it ends.
 *
 *   HARMLESS     Every entry point tolerates a null target, a missing
 *                Element.animate, and reduced motion. Nothing here is load
 *                bearing; if it all no-ops the game still teaches.
 *
 *   Juice.stage(container)                  // one-time: where confetti lands
 *   Juice.pop(el, { scale })
 *   Juice.wobble(el) / refuse(el)           // "not that one"
 *   Juice.collect(el) / celebrate(el)       // "yes"
 *   Juice.flash(el)
 *   Juice.confetti(near, { count, offsetX })   // a burst, from a place
 *   Juice.sparkle(el)                          // a small glint, for an ordinary right answer
 */
(function (global) {
  'use strict';

  var host = null;                 // absolutely-positioned layer for particles
  var reduced = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (global.matchMedia) {
    try {
      var mq = global.matchMedia('(prefers-reduced-motion: reduce)');
      if (mq.addEventListener) mq.addEventListener('change', function (e) { reduced = e.matches; });
    } catch (e) {}
  }

  // Saturated party paper, plus white: pale pastels vanished against the ice.
  var CONFETTI = ['#ff5f8a', '#ffc933', '#38d98a', '#39b6ff', '#a970ff', '#ff9a3c', '#ffffff', '#ffe066'];
  var STAR = 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)';

  /** The pop at the heart of a burst: a soft flash that swells and is gone. */
  function flash(doc, cx, cy) {
    var el = doc.createElement('div');
    el.style.cssText = 'position:absolute;left:' + cx + 'px;top:' + cy + 'px;width:120px;height:120px;margin:-60px;' +
      'border-radius:50%;pointer-events:none;will-change:transform,opacity;opacity:0;' +
      'background:radial-gradient(circle,rgba(255,255,255,.95) 0%,rgba(255,240,180,.7) 30%,rgba(255,220,120,0) 70%);';
    host.appendChild(el);
    if (!el.animate) { el.remove(); return; }
    el.animate([
      { transform: 'scale(.2)', opacity: 0 }, { transform: 'scale(1)', opacity: 1, offset: 0.25 }, { transform: 'scale(1.9)', opacity: 0 }
    ], { duration: 520, easing: 'ease-out', fill: 'forwards' }).finished.then(function () { el.remove(); }, function () { el.remove(); });
  }

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */

  function can(el) { return !!(el && el.animate && !reduced); }

  /**
   * SVG elements have no useful default transform origin, and a percentage
   * origin resolves against the user-space viewBox rather than the shape.
   * `fill-box` + `center` makes a scale mean the same thing on a <g> as on
   * a <div>, which is the only way one effect can serve both.
   *
   * But it must not be forced on an element that has already chosen its own
   * pivot. Swiftee's is `50% 87.7%` — the baseline the sprite sheet registers
   * every frame against — and a single Juice.squash() on him rewrote it to
   * `center`, which silently moved him 22px down the screen and left his feet
   * hanging off the bottom of the window for the rest of the session. An
   * effect is allowed to be ignored; it is not allowed to relocate its target.
   */
  function centred(el) {
    try {
      if (el.style.transformOrigin) return el;     // it has a pivot of its own
      el.style.transformBox = 'fill-box';
      el.style.transformOrigin = 'center';
    } catch (e) {}
    return el;
  }

  function run(el, frames, opts) {
    if (!can(el)) return { finished: Promise.resolve(), cancel: function () {} };
    centred(el);
    var a;
    try {
      a = el.animate(frames, Object.assign({ composite: 'add', fill: 'none', easing: 'ease-out' }, opts || {}));
    } catch (e) {
      return { finished: Promise.resolve(), cancel: function () {} };
    }
    return a;
  }

  function rectOf(el) {
    if (!el) return null;
    try {
      var r = el.getBoundingClientRect();
      if (r && (r.width || r.height)) return r;
    } catch (e) {}
    return null;
  }

  /* ------------------------------------------------------------------ *
   * Effects
   * ------------------------------------------------------------------ */

  var Juice = {

    /** Where particles are drawn. Safe to call more than once. */
    stage: function (container) {
      if (!container || !container.ownerDocument) return host;
      if (host && host.parentNode === container) return host;
      var doc = container.ownerDocument;
      host = doc.createElement('div');
      host.className = 'juice-layer';
      host.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:6';
      // The container must establish a containing block for inset:0 to work.
      var cs = doc.defaultView && doc.defaultView.getComputedStyle ? doc.defaultView.getComputedStyle(container) : null;
      if (cs && cs.position === 'static') container.style.position = 'relative';
      container.appendChild(host);
      return host;
    },

    /** A quick scale bump. The default acknowledgement for anything tapped. */
    pop: function (el, o) {
      o = o || {};
      var s = o.scale == null ? 0.18 : o.scale;
      return run(el, [
        { transform: 'scale(1)' },
        { transform: 'scale(' + (1 + s) + ')', offset: 0.4 },
        { transform: 'scale(' + (1 - s * 0.25) + ')', offset: 0.72 },
        { transform: 'scale(1)' }
      ], { duration: o.duration || 340, easing: 'cubic-bezier(.34,1.56,.64,1)' }).finished;
    },

    /** Side-to-side shake. "That is not the one," without words. */
    // A NUDGE, NOT A SHAKE: four pixels and barely a turn. Nine pixels and
    // two and a half degrees read as the thing being told off.
    wobble: function (el, o) {
      o = o || {};
      var d = o.distance == null ? 4 : o.distance;
      return run(el, [
        { transform: 'translateX(0) rotate(0deg)' },
        { transform: 'translateX(' + -d + 'px) rotate(-1deg)', offset: 0.18 },
        { transform: 'translateX(' + d + 'px) rotate(1deg)', offset: 0.42 },
        { transform: 'translateX(' + -d * 0.5 + 'px) rotate(-.5deg)', offset: 0.66 },
        { transform: 'translateX(0) rotate(0deg)' }
      ], { duration: o.duration || 380, easing: 'ease-in-out' }).finished;
    },

    /** A refused drop: wobble plus a small recoil. */
    refuse: function (el, o) {
      o = o || {};
      Juice.wobble(el, o);
      return run(el, [
        { transform: 'scale(1)' },
        { transform: 'scale(0.97)', offset: 0.3 },
        { transform: 'scale(1)' }
      ], { duration: o.duration || 360 }).finished;
    },

    /* THE VERDICT, ON THE THING ITSELF. A wrong answer glows red for a moment
       and recoils; a right one glows green. A drop-shadow on the element, so
       it follows any shape — a card, a knob, a whole polygon — and fades
       back to nothing: the colour is the answer, it is not left on. */
    bad: function (el, o) {
      o = o || {};
      if (!can(el)) return Promise.resolve();
      try {
        el.animate([
          { filter: 'drop-shadow(0 0 0 rgba(255, 70, 70, 0))' },
          { filter: 'drop-shadow(0 0 7px rgba(255, 60, 60, .95)) drop-shadow(0 0 2px rgba(255, 40, 40, .9))', offset: 0.25 },
          { filter: 'drop-shadow(0 0 7px rgba(255, 60, 60, .9)) drop-shadow(0 0 2px rgba(255, 40, 40, .85))', offset: 0.6 },
          { filter: 'drop-shadow(0 0 0 rgba(255, 70, 70, 0))' }
        ], { duration: o.duration || 760, easing: 'ease-out' });
      } catch (e) {}
      return Juice.refuse(el, o);
    },
    good: function (el, o) {
      o = o || {};
      if (!can(el)) return Promise.resolve();
      var a;
      try {
        a = el.animate([
          { filter: 'drop-shadow(0 0 0 rgba(60, 220, 120, 0))' },
          { filter: 'drop-shadow(0 0 8px rgba(60, 220, 120, .95)) drop-shadow(0 0 2px rgba(40, 200, 100, .9))', offset: 0.3 },
          { filter: 'drop-shadow(0 0 0 rgba(60, 220, 120, 0))' }
        ], { duration: o.duration || 820, easing: 'ease-out' });
      } catch (e) { return Promise.resolve(); }
      return a.finished;
    },
    /* A NUDGE OF THE WHOLE SCENE on a wrong answer: five pixels, a third of a
       second, on `translate` so it never throws away a transform the scene
       already has. Felt more than seen. */
    shake: function (el, o) {
      o = o || {};
      if (!can(el)) return Promise.resolve();
      var d = o.distance == null ? 5 : o.distance, a;
      try {
        a = el.animate([
          { translate: '0 0' }, { translate: -d + 'px 0', offset: 0.2 }, { translate: d + 'px 0', offset: 0.45 },
          { translate: (-d * 0.5) + 'px 0', offset: 0.7 }, { translate: '0 0' }
        ], { duration: o.duration || 320, easing: 'ease-in-out' });
      } catch (e) { return Promise.resolve(); }
      return a.finished;
    },

    /** Accepted: a lift, a squeeze and a settle. */
    collect: function (el, o) {
      o = o || {};
      return run(el, [
        { transform: 'translateY(0) scale(1)' },
        { transform: 'translateY(-14px) scale(1.12)', offset: 0.35 },
        { transform: 'translateY(2px) scale(0.96)', offset: 0.7 },
        { transform: 'translateY(0) scale(1)' }
      ], { duration: o.duration || 520, easing: 'cubic-bezier(.22,1,.36,1)' }).finished;
    },

    /** Bigger yes: a hop with a wiggle, plus a burst of particles. */
    celebrate: function (el, o) {
      o = o || {};
      Juice.confetti(el, { count: o.count == null ? 22 : o.count });
      return run(el, [
        { transform: 'translateY(0) rotate(0deg) scale(1)' },
        { transform: 'translateY(-20px) rotate(-4deg) scale(1.08)', offset: 0.3 },
        { transform: 'translateY(-6px) rotate(4deg) scale(1.02)', offset: 0.6 },
        { transform: 'translateY(0) rotate(0deg) scale(1)' }
      ], { duration: o.duration || 700, easing: 'cubic-bezier(.22,1,.36,1)' }).finished;
    },

    /**
     * A brightness pulse. Opacity rather than a filter, because SVG strokes
     * inside a <g> pick up opacity consistently across engines and `filter`
     * on an SVG group is expensive on low-end tablets.
     */
    flash: function (el, o) {
      o = o || {};
      if (!can(el)) return Promise.resolve();
      var a;
      try {
        a = el.animate([{ opacity: 1 }, { opacity: 0.25 }, { opacity: 1 }, { opacity: 0.4 }, { opacity: 1 }],
                       { duration: o.duration || 620, easing: 'ease-in-out' });
      } catch (e) { return Promise.resolve(); }
      return a.finished;
    },

    /**
     * Paper confetti over the whole play area. `near` only decides where the
     * burst is centred; the particles live in the overlay layer so they can
     * fall past the edges of an SVG viewBox.
     */
    confetti: function (near, o) {
      o = o || {};
      if (reduced || !host || !host.ownerDocument) return Promise.resolve();
      var doc = host.ownerDocument;
      var hostRect = rectOf(host);
      if (!hostRect) return Promise.resolve();

      var r = rectOf(near);
      var cx = (r ? (r.left + r.width / 2) : (hostRect.left + hostRect.width / 2)) - hostRect.left + (o.offsetX || 0);
      var cy = (r ? (r.top + r.height * 0.35) : (hostRect.top + hostRect.height * 0.3)) - hostRect.top + (o.offsetY || 0);

      var n = Math.min(120, o.count == null ? 36 : o.count);
      var done = [];
      flash(doc, cx, cy);
      if (o.fromEdge && r) {
        // FROM BEHIND. Each piece starts on the edge of the thing and flies
        // away from its centre, so the burst reads as coming out from under
        // the card rather than being sprayed on top of it.
        var L = r.left - hostRect.left, T = r.top - hostRect.top, Wd = r.width, Ht = r.height;
        var mx = L + Wd / 2, my = T + Ht / 2;
        for (var q = 0; q < n; q++) {
          var t = Math.random() * 2 * (Wd + Ht), px, py;
          if (t < Wd) { px = L + t; py = T; }
          else if (t < Wd + Ht) { px = L + Wd; py = T + (t - Wd); }
          else if (t < 2 * Wd + Ht) { px = L + (t - Wd - Ht); py = T + Ht; }
          else { px = L; py = T + (t - 2 * Wd - Ht); }
          done.push(piece(doc, px, py, Object.assign({}, o, { angle: Math.atan2(py - my, px - mx) })));
        }
        return Promise.all(done);
      }
      for (var i = 0; i < n; i++) done.push(piece(doc, cx, cy, o));
      return Promise.all(done);
    },

    /**
     * A SMALL GLINT FOR AN ORDINARY RIGHT ANSWER.
     *
     * Confetti is a milestone: a sort finished, a shape built, the lesson
     * over. A correct card on a question is not one, and a party-sized burst
     * off every right tap made the big moments read the same as the small
     * ones. This is a handful of tiny ice-and-gold stars thrown a short way
     * from the thing that was right, gone in under a second.
     */
    sparkle: function (el, o) {
      o = o || {};
      if (reduced || !host || !host.ownerDocument) return Promise.resolve();
      var doc = host.ownerDocument;
      var hostRect = rectOf(host), r = rectOf(el);
      if (!hostRect || !r) return Promise.resolve();
      var cx = r.left + r.width / 2 - hostRect.left, cy = r.top + r.height / 2 - hostRect.top;
      var reach = Math.max(40, Math.min(110, Math.max(r.width, r.height) * 0.55));
      var n = o.count == null ? 10 : o.count, done = [];
      for (var i = 0; i < n; i++) done.push(glint(doc, cx, cy, reach, i / n));
      return Promise.all(done);
    },

    get reducedMotion() { return reduced; },
    set reducedMotion(v) { reduced = !!v; }
  };


  /**
   * One piece of confetti. BIG ENOUGH TO SEE, and it tumbles: it pops out
   * with a little swell, arcs up and over, flutters as it falls (a paper
   * scrap turning edge-on and back) and fades near the ground. Three kinds
   * — a strip, a dot, a star — in bright party colours with a white glint.
   */
  function piece(doc, cx, cy, o) {
    var el = doc.createElement('div');
    var kind = Math.random();
    var size = 11 + Math.random() * 11;
    var w = size, h = kind < 0.4 ? size * (0.45 + Math.random() * 0.4) : size;
    var col = CONFETTI[(Math.random() * CONFETTI.length) | 0];
    var shape = kind < 0.4 ? 'border-radius:3px;' : kind < 0.72 ? 'border-radius:50%;' : 'clip-path:' + STAR + ';';
    el.style.cssText = 'position:absolute;will-change:transform,opacity;left:' + cx + 'px;top:' + cy + 'px;' +
      'width:' + w.toFixed(1) + 'px;height:' + h.toFixed(1) + 'px;margin:' + (-h / 2).toFixed(1) + 'px 0 0 ' + (-w / 2).toFixed(1) + 'px;' +
      'background:' + col + ';' + shape + (kind < 0.72 ? 'box-shadow:0 0 6px rgba(255,255,255,.55);' : '') + 'opacity:0';
    host.appendChild(el);

    var angle = o.angle != null ? o.angle + (Math.random() - 0.5) * 0.5
              : (-Math.PI / 2) + (Math.random() - 0.5) * (o.spread == null ? 2.1 : o.spread);
    var speed = (180 + Math.random() * 300) * (o.speed || 1);   // o.speed: shorter throws keep a burst close to its card
    var dx = Math.cos(angle) * speed;
    var rise = Math.sin(angle) * speed;
    var fall = 300 + Math.random() * 360;
    var spin = (Math.random() - 0.5) * 1400;
    var dur = 1500 + Math.random() * 900;
    var flutter = 0.25 + Math.random() * 0.35;   // how edge-on it turns mid-fall

    if (!el.animate) { el.remove(); return Promise.resolve(); }
    var a = el.animate([
      { transform: 'translate(0,0) rotate(0deg) scale(.3)', opacity: 1, offset: 0 },
      { transform: 'translate(' + (dx * 0.22).toFixed(1) + 'px,' + (rise * 0.5).toFixed(1) + 'px) rotate(' + (spin * 0.12).toFixed(0) + 'deg) scale(1.25)', opacity: 1, offset: 0.12 },
      { transform: 'translate(' + (dx * 0.7).toFixed(1) + 'px,' + rise.toFixed(1) + 'px) rotate(' + (spin * 0.45).toFixed(0) + 'deg) scale(1)', opacity: 1, offset: 0.42 },
      { transform: 'translate(' + (dx * 0.92).toFixed(1) + 'px,' + (fall * 0.5).toFixed(1) + 'px) rotate(' + (spin * 0.78).toFixed(0) + 'deg) scale(' + flutter.toFixed(2) + ',1)', opacity: 1, offset: 0.74 },
      { transform: 'translate(' + dx.toFixed(1) + 'px,' + fall.toFixed(1) + 'px) rotate(' + spin.toFixed(0) + 'deg) scale(1)', opacity: 0, offset: 1 }
    ], { duration: dur, easing: 'cubic-bezier(.25,.6,.35,1)', fill: 'forwards' });

    return a.finished.then(cleanup, cleanup);
    function cleanup() { if (el.parentNode) el.parentNode.removeChild(el); }
  }

  /** One glint of a sparkle: a small star that pops out, turns, and fades. */
  var GLINT = ['#ffffff', '#fff1a8', '#ffd84a', '#bdf3ff'];
  function glint(doc, cx, cy, reach, turn) {
    var el = doc.createElement('div');
    var size = 7 + Math.random() * 6;
    var col = GLINT[(Math.random() * GLINT.length) | 0];
    el.style.cssText = 'position:absolute;pointer-events:none;will-change:transform,opacity;left:' + cx + 'px;top:' + cy + 'px;' +
      'width:' + size.toFixed(1) + 'px;height:' + size.toFixed(1) + 'px;margin:' + (-size / 2).toFixed(1) + 'px;' +
      'background:' + col + ';clip-path:' + STAR + ';filter:drop-shadow(0 0 3px rgba(255,255,255,.9));opacity:0';
    host.appendChild(el);
    if (!el.animate) { el.remove(); return Promise.resolve(); }
    var a = (turn + Math.random() * 0.08) * Math.PI * 2;
    var d = reach * (0.75 + Math.random() * 0.35);
    var dx = Math.cos(a) * d, dy = Math.sin(a) * d;
    var an = el.animate([
      { transform: 'translate(0,0) scale(.2) rotate(0deg)', opacity: 0 },
      { transform: 'translate(' + (dx * 0.55).toFixed(1) + 'px,' + (dy * 0.55).toFixed(1) + 'px) scale(1.15) rotate(70deg)', opacity: 1, offset: 0.35 },
      { transform: 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px) scale(.4) rotate(160deg)', opacity: 0 }
    ], { duration: 620 + Math.random() * 220, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' });
    return an.finished.then(function () { el.remove(); }, function () { el.remove(); });
  }

  global.Juice = Juice;
  if (typeof module !== 'undefined' && module.exports) module.exports = Juice;

})(typeof window !== 'undefined' ? window : this);
