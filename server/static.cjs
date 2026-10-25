'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

function createStaticHandler({ directory }) {
  const root = path.resolve(directory);
  return async (req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { res.writeHead(400); return res.end('Bad request'); }
    if (pathname === '/academy' || pathname === '/academy/') pathname = '/academy.html';
    if (pathname === '/academy/admin' || pathname === '/academy/admin/') pathname = '/academy-admin.html';
    const filename = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!filename.startsWith(`${root}${path.sep}`)) { res.writeHead(403); return res.end('Forbidden'); }
    let data;
    try { data = await fs.promises.readFile(filename); }
    catch { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {
        'content-type': TYPES[path.extname(filename).toLowerCase()] || 'application/octet-stream',
        'content-length': data.length,
        'x-content-type-options': 'nosniff'
    });
    return res.end(data);
  };
}

module.exports = { createStaticHandler };
