'use strict';

const { createApplicationRuntime } = require('../server/runtime.cjs');

let runtime;

function originalApiUrl(requestUrl) {
  const url = new URL(requestUrl || '/api/index', 'http://vercel.internal');
  const route = url.searchParams.get('__franchise_path');
  if (route === null) return requestUrl;
  url.searchParams.delete('__franchise_path');
  const safePath = route.replace(/^\/+/, '');
  if (safePath.split('/').some(part => part === '..')) return requestUrl;
  const query = url.searchParams.toString();
  return `/api/${safePath}${query ? `?${query}` : ''}`;
}

function createVercelRequestHandler(getApi) {
  return async function franchiseOsApi(req, res) {
    let api;
    try { api = getApi(); }
    catch {
      if (!res.headersSent) {
        const body = JSON.stringify({ error: 'Server configuration unavailable. Check server-side environment variables.' });
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
        return res.end(body);
      }
      return;
    }
    const previousUrl = req.url;
    req.url = originalApiUrl(req.url);
    try { return await api(req, res); }
    finally { req.url = previousUrl; }
  };
}

module.exports = createVercelRequestHandler(() => {
  runtime ||= createApplicationRuntime({ allowRemote: true, logger: {
    info(message, metadata) { console.info(message, metadata || {}); },
    error(message, metadata) { console.error(message, metadata || {}); }
  } });
  return runtime.api;
});

module.exports.originalApiUrl = originalApiUrl;
module.exports.createVercelRequestHandler = createVercelRequestHandler;
