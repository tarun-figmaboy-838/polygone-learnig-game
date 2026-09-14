(function (global) {
  'use strict';
  var chapters = [
    { end: 3, name: 'Shape scout', icon: '◆' },
    { end: 14, name: 'Diagonal detective', icon: '✦' },
    { end: 26, name: 'Dent discoverer', icon: '⌁' },
    { end: 34, name: 'Pattern pro', icon: '★' },
    { end: 38, name: 'Polygon builder', icon: '⬟' }
  ];
  function create() {
    var xp = 0, won = {}, badges = [], streak = 0;
    return {
      chapter: function (i) { return chapters.find(function (c) { return i <= c.end; }) || chapters[4]; },
      award: function (key) {
        if (won[key]) return 0;
        won[key] = true; xp += 25; streak++;
        return 25;
      },
      mistake: function () { streak = 0; },
      complete: function (i) {
        var c = chapters.find(function (c) { return c.end === i; });
        if (c && badges.indexOf(c.name) < 0) { badges.push(c.name); return c; }
        return null;
      },
      snapshot: function () { return { xp: xp, streak: streak, badges: badges.slice() }; }
    };
  }
  global.Quest = { create: create, chapters: chapters };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.Quest;
})(typeof window !== 'undefined' ? window : this);
