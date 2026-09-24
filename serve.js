#!/usr/bin/env node
/*!
 * serve.js — run the game locally.
 *
 *   npm start            then open the URL it prints
 *   node serve.js 8000   to choose the port
 *
 * The game is plain scripts and works over file:// too, with one exception:
 * pack.js cannot fetch the recorded voice clips from a file:// page, so the
 * browser voice takes over. Over http you get whichever is actually present.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.argv[2]) || 8000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.riv': 'application/octet-stream'
};

http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html'; }
  catch (e) { res.writeHead(400).end('bad request'); return; }
  const file = path.resolve(ROOT, rel);
  // inside this folder — not a sibling whose name merely starts the same —
  // and never the repository's own history
  if ((file !== ROOT && !file.startsWith(ROOT + path.sep)) || /(^|[\\/])\.git([\\/]|$)/.test(rel)) { res.writeHead(403).end('forbidden'); return; }

  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found: /' + rel); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      // Sprite sheets are large and immutable; the source files are not.
      'Cache-Control': rel.indexOf('assets/') === 0 ? 'public, max-age=3600' : 'no-cache'
    });
    res.end(buf);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log('  Swiftee & the Polygons  ->  http://localhost:' + PORT + '/');
});
