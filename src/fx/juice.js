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
 *   Juice.squash(el, { amount })
 *   Juice.tada(el, { angle })
 *   Juice.flash(el)
 *   Juice.confetti(near, { count, offsetX })
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

  var CONFETTI = ['#ff8fa3', '#ffd166', '#63e0a4', '#5ec8ff', '#b98cff', '#ffb27a'];

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
    wobble: function (el, o) {
      o = o || {};
      var d = o.distance == null ? 9 : o.distance;
      return run(el, [
        { transform: 'translateX(0) rotate(0deg)' },
        { transform: 'translateX(' + -d + 'px) rotate(-2.5deg)', offset: 0.15 },
        { transform: 'translateX(' + d + 'px) rotate(2.5deg)', offset: 0.35 },
        { transform: 'translateX(' + -d * 0.6 + 'px) rotate(-1.5deg)', offset: 0.55 },
        { transform: 'translateX(' + d * 0.4 + 'px) rotate(1deg)', offset: 0.75 },
        { transform: 'translateX(0) rotate(0deg)' }
      ], { duration: o.duration || 480, easing: 'ease-in-out' }).finished;
    },

    /** A refused drop: wobble plus a small recoil. */
    refuse: function (el, o) {
      o = o || {};
      Juice.wobble(el, o);
      return run(el, [
        { transform: 'scale(1)' },
        { transform: 'scale(0.93)', offset: 0.3 },
        { transform: 'scale(1)' }
      ], { duration: o.duration || 420 }).finished;
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

    /** Landing weight. Used after an entrance. */
    squash: function (el, o) {
      o = o || {};
      var a = o.amount == null ? 0.14 : o.amount;
      return run(el, [
        { transform: 'scale(1,1)' },
        { transform: 'scale(' + (1 + a) + ',' + (1 - a) + ')', offset: 0.25 },
        { transform: 'scale(' + (1 - a * 0.5) + ',' + (1 + a * 0.5) + ')', offset: 0.6 },
        { transform: 'scale(1,1)' }
      ], { duration: o.duration || 420, easing: 'cubic-bezier(.34,1.56,.64,1)' }).finished;
    },

    /** Attention, with rotation. */
    tada: function (el, o) {
      o = o || {};
      var deg = o.angle == null ? 5 : o.angle;
      return run(el, [
        { transform: 'scale(1) rotate(0deg)' },
        { transform: 'scale(0.94) rotate(' + -deg + 'deg)', offset: 0.15 },
        { transform: 'scale(1.1) rotate(' + deg + 'deg)', offset: 0.35 },
        { transform: 'scale(1.1) rotate(' + -deg + 'deg)', offset: 0.55 },
        { transform: 'scale(1.06) rotate(' + deg + 'deg)', offset: 0.75 },
        { transform: 'scale(1) rotate(0deg)' }
      ], { duration: o.duration || 820, easing: 'ease-in-out' }).finished;
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

      var n = Math.min(120, o.count == null ? 30 : o.count);
      var done = [];
      for (var i = 0; i < n; i++) done.push(piece(doc, cx, cy, o));
      return Promise.all(done);
    },

    get reducedMotion() { return reduced; },
    set reducedMotion(v) { reduced = !!v; },

    /** Test seam: makes every effect a no-op without touching the OS setting. */
    disable: function (v) { reduced = v !== false; return reduced; }
  };

  function piece(doc, cx, cy, o) {
    var el = doc.createElement('div');
    var w = 7 + Math.random() * 7;
    var h = w * (0.45 + Math.random() * 0.7);
    var col = CONFETTI[(Math.random() * CONFETTI.length) | 0];
    el.style.cssText = 'position:absolute;will-change:transform,opacity;left:' + cx + 'px;top:' + cy + 'px;' +
      'width:' + w.toFixed(1) + 'px;height:' + h.toFixed(1) + 'px;background:' + col + ';' +
      'border-radius:' + (Math.random() < 0.4 ? '50%' : '2px') + ';opacity:0';
    host.appendChild(el);

    var angle = (-Math.PI / 2) + (Math.random() - 0.5) * (o.spread == null ? 1.9 : o.spread);
    var speed = 120 + Math.random() * 260;
    var dx = Math.cos(angle) * speed;
    var rise = Math.sin(angle) * speed;
    var fall = 260 + Math.random() * 320;
    var spin = (Math.random() - 0.5) * 900;
    var dur = 1100 + Math.random() * 900;

    if (!el.animate) { el.remove(); return Promise.resolve(); }
    var a = el.animate([
      { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
      { transform: 'translate(' + (dx * 0.6).toFixed(1) + 'px,' + rise.toFixed(1) + 'px) rotate(' + (spin * 0.4).toFixed(0) + 'deg)', opacity: 1, offset: 0.35 },
      { transform: 'translate(' + dx.toFixed(1) + 'px,' + fall.toFixed(1) + 'px) rotate(' + spin.toFixed(0) + 'deg)', opacity: 0 }
    ], { duration: dur, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'forwards' });

    return a.finished.then(cleanup, cleanup);
    function cleanup() { if (el.parentNode) el.parentNode.removeChild(el); }
  }

  global.Juice = Juice;
  if (typeof module !== 'undefined' && module.exports) module.exports = Juice;

})(typeof window !== 'undefined' ? window : this);
