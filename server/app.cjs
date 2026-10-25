'use strict';

const http = require('node:http');
const { validateWorkspacePayload } = require('./validation.cjs');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reply(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
}

async function readBody(req, maxBytes) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Payload too large'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

function createHandler({ store, maxBodyBytes = 10 * 1024 * 1024 }) {
  if (!store || typeof store.load !== 'function' || typeof store.save !== 'function') throw new TypeError('A workspace store is required');
  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const host = req.headers.host || '';
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) return reply(res, 403, { error: 'Local requests only' });
    if (req.headers.origin) {
      try {
        const origin = new URL(req.headers.origin);
        if (origin.protocol !== 'http:' || origin.host !== host || !/^(localhost|127\.0\.0\.1)$/i.test(origin.hostname)) return reply(res, 403, { error: 'Local requests only' });
      } catch { return reply(res, 403, { error: 'Local requests only' }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/health') return reply(res, 200, { ok: true });
    const match = url.pathname.match(/^\/api\/workspaces\/([^/]+)$/);
    if (!match) return reply(res, 404, { error: 'Not found' });
    const id = match[1];
    if (!UUID.test(id)) return reply(res, 400, { error: 'Invalid workspace identifier' });
    if (req.method === 'GET') {
      try {
        const workspace = await store.load(id);
        return workspace === null ? reply(res, 404, { error: 'Workspace not found' }) : reply(res, 200, workspace);
      } catch { return reply(res, 503, { error: 'Workspace storage unavailable' }); }
    }
    if (req.method === 'PUT') {
      if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) return reply(res, 415, { error: 'Content-Type must be application/json' });
      try {
        const payload = await readBody(req, maxBodyBytes);
        if (!payload || !Number.isInteger(payload.revision) || payload.revision < 0 || !validateWorkspacePayload(payload.state).ok) return reply(res, 400, { error: 'Invalid workspace payload' });
        const revision = await store.save(id, payload.state, payload.revision);
        return reply(res, 200, { ok: true, revision });
      } catch (error) {
        if (error.status === 409) return reply(res, 409, { error: 'Workspace changed elsewhere. Reload before saving.' });
        return reply(res, error.status || 503, { error: error.status === 400 ? 'Invalid JSON' : error.status === 413 ? 'Payload too large' : 'Workspace storage unavailable' });
      }
    }
    res.setHeader('allow', 'GET, PUT');
    return reply(res, 405, { error: 'Method not allowed' });
  };
}

function createServer(options) { return http.createServer(createHandler(options)); }

module.exports = { createHandler, createServer };
