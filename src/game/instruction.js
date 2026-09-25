/*!
 * instruction.js — the plank at the top of every screen.
 *
 * ONE COMPONENT, EVERY SCREEN. The instruction used to be a cream card pinned
 * to the top-left corner, capped to whatever width the lesson left beside it,
 * and refused that cap when the room fell below a readable column — at which
 * point it sat over the lesson instead. Three behaviours, all of them
 * negotiating with the screen for space that the screen had already given to
 * something else.
 *
 * It is the primary guidance now and it is given its own room: a plank across
 * the top, centred, and the lesson starts underneath it. The height is
 * measured and published as --instruction-h, so the stage moves down by
 * exactly as much as the plank actually needs — one line or three, phone or
 * desktop — rather than by a number typed in a stylesheet.
 *
 *   Instruction.show('Tap the vertex.')   by text
 *   Instruction.show(null)                clear it
 *
 * THE TEXT LIVES WHERE IT ALWAYS DID: every screen in screens.js carries its
 * own instruction and every caller has it in hand, so this takes a sentence
 * and nothing else. There was a second way in — a lookup keyed by screen id,
 * built from the whole deck at runtime — and nothing ever called it.
 *
 * Highlighting is DualCode's: the lesson's key terms are already tinted chips
 * everywhere else, and a second highlight style for the same words on the same
 * screen would be two languages for one idea.
 */
(function (global) {
  'use strict';

  var el = null, textEl = null, current = null, swapTimer = null, ro = null;

  /**
   * ONE LINE, ALWAYS.
   *
   * The plank is as wide as its sentence and no wider, so there is no empty
   * wood either side of the words; and the sentence is never allowed to wrap,
   * because a plank that grows a second line pushes the whole lesson down and
   * reads as a different piece of furniture. When the sentence would not fit
   * the room the HUD leaves it, the type steps down a pixel at a time until
   * it does. Only a sentence no readable size can hold is allowed to wrap.
   */
  var MIN_PX = 15;
  function fit() {
    if (!el || !textEl) return;
    textEl.style.whiteSpace = 'nowrap';
    el.style.fontSize = '';
    var size = parseFloat(global.getComputedStyle(el).fontSize) || 24;
    var guard = 0;
    while (textEl.scrollWidth > textEl.clientWidth + 1 && size > MIN_PX && guard++ < 40) {
      size -= 1;
      el.style.fontSize = size + 'px';
    }
    if (textEl.scrollWidth > textEl.clientWidth + 1) textEl.style.whiteSpace = 'normal';
  }

  function mount() {
    if (el) return el;
    el = global.document.getElementById('instruction');
    if (!el) return null;
    textEl = el.querySelector('.instruction-text');

    /* PUBLISH THE HEIGHT. The lesson's top inset is this, so a plank that
       grows to two lines pushes the lesson down by two lines' worth and no
       stylesheet has to know how tall a line is. */
    var publish = function () {
      var h = el.classList.contains('show') ? Math.ceil(el.getBoundingClientRect().height) : 0;
      if (global.Game && Game.relayout) Game.relayout();
    };
    if (global.ResizeObserver) {
      ro = new ResizeObserver(publish);
      ro.observe(el);
    } else {
      global.addEventListener('resize', publish);
    }
    el.__publish = publish;
    global.addEventListener('resize', function () { if (current) fit(); publish(); });
    return el;
  }

  /**
   * Put a sentence on the plank.
   *
   * The old line fades out, the new one fades in, and the plank keeps its
   * place: nothing here animates position or scale, because the lesson below
   * is sized from this element's height and a bouncing panel would drag the
   * whole screen with it.
   */
  function show(text) {
    if (!mount()) return;
    clearTimeout(swapTimer);
    // A swap cut short by the next call is finished, not abandoned: the old
    // text is not left faded out, and the sentence it was fading to is the
    // one that counts from here.
    el.classList.remove('fading');

    if (!text) {
      stopVoice();
      current = null;
      el.classList.remove('show');
      swapTimer = setTimeout(function () {
        if (!current && textEl) textEl.innerHTML = '';
        el.__publish();
      }, 180);
      return;
    }
    if (text === current) return;
    stopVoice();

    var write = function () {
      if (global.DualCode && DualCode.markup) textEl.innerHTML = DualCode.markup(text);
      else textEl.textContent = text;
      el.classList.add('show');
      fit();
      el.__publish();
      writing = false;
      if (pendingVoice) applyVoice();
    };

    if (current) {
      // out, then in — so the two sentences are never on the plank together
      el.classList.add('fading');
      current = text;
      writing = true;
      swapTimer = setTimeout(function () {
        el.classList.remove('fading');
        write();
      }, 160);
    } else {
      current = text;
      write();
    }
  }

  /* ITS WORDS ARRIVE WITH THE VOICE (game.js plankVoice), as his bubble's
     do: hidden as the sentence is written, each shown as the recording says
     it — a chip ("line segment") waits for its own first word — and all of
     them at once if the voice is not there to follow. */
  var pendingVoice = null, writing = false, voiceRaf = 0, voiceUnits = null;
  function stopVoice() {
    pendingVoice = null;
    if (voiceRaf) { (global.cancelAnimationFrame || clearTimeout)(voiceRaf); voiceRaf = 0; }
    if (voiceUnits) { voiceUnits.forEach(function (u) { u.classList.add('in'); }); voiceUnits = null; }
  }
  function voice(clock, cues) {
    mount();
    pendingVoice = { clock: clock, cues: cues };
    if (!writing) applyVoice();
  }
  function applyVoice() {
    var v = pendingVoice; pendingVoice = null;
    if (!v || !textEl || !current) return;
    // (reduced motion: the sentence stays whole, as his bubble's does)
    if (global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var doc = textEl.ownerDocument, units = [];
    [].slice.call(textEl.childNodes).forEach(function (n) {
      if (n.nodeType === 3) {
        var frag = doc.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach(function (p) {
          if (!p) return;
          if (/^\s+$/.test(p)) { frag.appendChild(doc.createTextNode(p)); return; }
          var s = doc.createElement('span'); s.className = 'pw'; s.textContent = p; frag.appendChild(s); units.push(s);
        });
        textEl.replaceChild(frag, n);
      } else if (n.nodeType === 1) { n.classList.add('pw'); units.push(n); }
    });
    if (!units.length) return;
    voiceUnits = units;
    var first = [], nw = 0;
    units.forEach(function (u) { first.push(nw); nw += Math.max(1, String(u.textContent).trim().split(/\s+/).length); });
    var byCue = !!(v.cues && v.cues.length === nw);
    var i = 0, t0 = Date.now();
    // a clip that stalls on the air without ever failing must not keep the
    // sentence hidden: after the last word's moment and a margin, it all shows
    var ceil = (byCue && v.cues.length ? v.cues[v.cues.length - 1] : units.length * 320) + 2500;
    var raf = global.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
    var tick = function () {
      voiceRaf = 0;
      var t = v.clock ? v.clock() : null;
      if ((t == null && Date.now() - t0 > 600) || Date.now() - t0 > ceil) { stopVoice(); return; }
      while (i < units.length && t != null && t >= (byCue ? v.cues[first[i]] : i * 320)) { units[i].classList.add('in'); i++; }
      if (i >= units.length) { voiceUnits = null; return; }
      voiceRaf = raf(tick);
    };
    tick();
  }

  /* THE PLANK TAKES A SENTENCE, NOT A KEY. There was a second way in — a
     lookup table built from the whole deck at runtime, a set(screenId) that
     read it, a refresh() that threw it away and a global setInstruction —
     and the game never used any of it: every caller has the sentence in its
     hand and says show(it). A second entrance to one room is a thing to keep
     in step for nothing. */
  global.Instruction = {
    show: show,
    voice: voice,
    /** The sentence on the plank right now, or null. */
    current: function () { return current; }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.Instruction;
})(typeof window !== 'undefined' ? window : this);
