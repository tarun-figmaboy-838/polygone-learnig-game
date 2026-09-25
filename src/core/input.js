/*!
 * input-mode.js — one pointer stream, routed by mode.
 *
 * The game asks for two very different things from the same finger: "move on
 * from this screen" and "drag this vertex". Those used to be the same
 * gesture, which meant the tap that dismissed a line of narration also landed
 * on the vertex underneath it and started a drag the child never meant.
 *
 * Advancing is now a button, not a tap: `Input.advance()` is the only thing
 * that emits 'advance', and only the Next button calls it. A tap on the
 * stage emits 'tap', which fast-forwards the narration text and nothing
 * else. One deliberate control for "I am ready", one forgiving one for "get
 * on with it".
 *
 * So there is exactly one authority on what a pointer event currently means:
 *
 *   locked     nothing is listening (transitions, animations)
 *   dialogue   a tap emits 'advance'; stage interactions ignore pointers
 *   polygon    stage interactions own the pointer; taps do not advance
 *
 * And one guard window. Every mode change arms `guarded` for a few frames,
 * during which stage.js's drag handlers bail out. That is what stops the
 * advancing tap from bleeding into the screen it just revealed. stage.js
 * checks `Input.guarded`; it does not need to know why.
 *
 *   Input.attach(el)
 *   Input.mode()            -> current mode
 *   Input.mode('dialogue')  -> set
 *   Input.mode('polygon', { unguarded: true })  -> set, without the guard
 *                           (the input handed back after he has replied: the
 *                           child's next touch is meant for the screen)
 *   Input.on('advance', fn) / Input.off('advance', fn)
 *   Input.guarded           -> boolean
 */
(function (global) {
  'use strict';

  var MODES = ['locked', 'dialogue', 'polygon'];
  var GUARD_MS = 220;          // long enough to outlast one tap's pointerup
  var TAP_SLOP = 14;           // px of travel still counted as a tap

  var el = null;
  var mode = 'locked';
  var listeners = {};
  var guardUntil = 0;
  var down = null;
  var attached = false;

  function emit(name, payload) {
    var list = (listeners[name] || []).slice();
    for (var i = 0; i < list.length; i++) {
      try { list[i](payload); } catch (e) { if (global.console) console.warn('Input: listener for "' + name + '" threw', e); }
    }
  }

  function now() { return Date.now(); }

  function onDown(e) {
    down = { x: e.clientX, y: e.clientY, t: now(), id: e.pointerId };
    emit('down', e);
  }

  function onUp(e) {
    var d = down; down = null;
    if (!d) return;
    var moved = Math.hypot((e.clientX || 0) - d.x, (e.clientY || 0) - d.y);
    if (moved <= TAP_SLOP) emit('tap', e);        // a tap; anything further is a drag
  }

  function onCancel() { down = null; }

  function guarded() { return now() < guardUntil; }
  function arm(ms) { guardUntil = now() + (ms == null ? GUARD_MS : ms); }

  var Input = {

    attach: function (target) {
      if (attached && el === target) return Input;
      Input.detach();
      el = target;
      if (!el) return Input;
      el.addEventListener('pointerdown', onDown);
      // Listen for the release on the window: a finger that slides off the
      // stage still ends the gesture, and a tap that started on the stage
      // should not be lost because it lifted a pixel outside it.
      (el.ownerDocument.defaultView || global).addEventListener('pointerup', onUp);
      (el.ownerDocument.defaultView || global).addEventListener('pointercancel', onCancel);
      attached = true;
      return Input;
    },

    detach: function () {
      if (!el || !attached) { attached = false; return Input; }
      var win = (el.ownerDocument && el.ownerDocument.defaultView) || global;
      el.removeEventListener('pointerdown', onDown);
      win.removeEventListener('pointerup', onUp);
      win.removeEventListener('pointercancel', onCancel);
      attached = false;
      return Input;
    },

    /**
     * Get or set the mode. Setting always re-arms the guard, including when
     * the mode does not actually change — two consecutive dialogue screens
     * each deserve their own protected window.
     */
    mode: function (m, o) {
      if (m == null) return mode;
      if (MODES.indexOf(m) < 0) { if (global.console) console.warn('Input: unknown mode "' + m + '"'); return mode; }
      mode = m;
      down = null;
      if (!(o && o.unguarded)) arm();
      emit('mode', m);
      return mode;
    },

    /**
     * Move on. The Next button is the only caller — advancing is a decision
     * the child makes on purpose, not something a stray tap can trigger.
     * Ignored outside dialogue mode, so it can never cut short an exercise.
     */
    advance: function () {
      if (mode !== 'dialogue' || guarded()) return false;
      arm();
      emit('advance', null);
      return true;
    },

    /** True while stage drag handlers should ignore pointers. */
    get guarded() { return guarded(); },

    /** Hold the guard open longer — used around scene transitions. */
    guard: function (ms) { arm(ms); return true; },
    release: function () { guardUntil = 0; return true; },

    on: function (name, fn) { (listeners[name] || (listeners[name] = [])).push(fn); return Input; },
    off: function (name, fn) {
      var l = listeners[name];
      if (!l) return Input;
      if (!fn) { listeners[name] = []; return Input; }
      var i = l.indexOf(fn); if (i >= 0) l.splice(i, 1);
      return Input;
    },

    MODES: MODES,
    get element() { return el; }
  };

  global.Input = Input;
  if (typeof module !== 'undefined' && module.exports) module.exports = Input;

})(typeof window !== 'undefined' ? window : this);
