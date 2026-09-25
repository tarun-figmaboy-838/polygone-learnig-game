(function (global) {
  'use strict';
  var chapters = [
    // (the diagonal chapter's five demonstration screens became the child's
    // own connect-and-discover step, so every end after it is five earlier)
    { end: 3, name: 'Shape scout' },
    { end: 9, name: 'Diagonal detective' },
    { end: 21, name: 'Dent discoverer' },
    { end: 29, name: 'Pattern pro' },
    // the last level is the end-game summary now, one screen where the four
    // builder screens were
    { end: 30, name: 'Polygon champion' }
  ];
  function create() {
    var xp = 0, won = {}, badges = [];
    return {
      award: function (key) {
        if (won[key]) return 0;
        won[key] = true; xp += 25;
        return 25;
      },
      complete: function (i) {
        var c = chapters.find(function (c) { return c.end === i; });
        if (c && badges.indexOf(c.name) < 0) { badges.push(c.name); return c; }
        return null;
      },
      snapshot: function () { return { xp: xp, badges: badges.slice() }; }
    };
  }
  global.Quest = { create: create, chapters: chapters };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.Quest;
})(typeof window !== 'undefined' ? window : this);
