'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
const vercelHandler = require('../api/index.js');

test('Vercel sends /api requests to the Node handler before the SPA fallback', () => {
  const apiRewrite = config.rewrites.findIndex(rule => rule.source === '/api/(.*)');
  const spaRewrite = config.rewrites.findIndex(rule => rule.destination === '/index.html');
  assert.ok(apiRewrite >= 0 && apiRewrite < spaRewrite);
  assert.equal(config.rewrites[apiRewrite].destination, '/api/index?__franchise_path=$1');
  assert.equal(config.outputDirectory, 'dist');
  assert.equal(config.framework, null);
  assert.equal(require('../package.json').type, 'commonjs');
  assert.equal(config.functions['api/index.js'].maxDuration, 60);
  assert.ok(config.functions['api/index.js'].includeFiles.includes('data/**'));
});

test('rewritten API calls restore their original path and preserve user query parameters', () => {
  const restored = vercelHandler.originalApiUrl('/api/index?__franchise_path=market%2Fmap%2Fsearch&q=Bengaluru&limit=8');
  assert.equal(restored, '/api/market/map/search?q=Bengaluru&limit=8');
  assert.equal(vercelHandler.originalApiUrl('/api/health?check=1'), '/api/health?check=1');
});

test('serverless dispatcher passes the restored request to the backend and restores req.url afterward', async () => {
  let calledWith;
  const handler = vercelHandler.createVercelRequestHandler(() => async req => { calledWith = req.url; });
  const originalUrl = '/api/index?__franchise_path=market%2Fmap%2Fsearch&q=Mysuru';
  const req = { url: originalUrl };
  await handler(req, { headersSent: false });
  assert.equal(calledWith, '/api/market/map/search?q=Mysuru');
  assert.equal(req.url, originalUrl);
});

test('serverless dispatcher fails safely when required server environment is missing', async () => {
  const handler = vercelHandler.createVercelRequestHandler(() => { throw new Error('DATABASE_URL missing'); });
  let status;
  let body;
  await handler({ url: '/api/index', headers: {} }, { headersSent: false, writeHead(code) { status = code; }, end(value) { body = value; } });
  assert.equal(status, 500);
  assert.doesNotMatch(body, /DATABASE_URL missing/);
  assert.match(body, /server-side environment variables/);
});

test('Vercel config keeps database and Gemini secrets out of frontend build files', () => {
  const dist = path.join(__dirname, '..', 'dist');
  const files = fs.readdirSync(dist).filter(file => /\.(?:js|html)$/.test(file));
  for (const file of files) assert.doesNotMatch(fs.readFileSync(path.join(dist, file), 'utf8'), /process\.env\.(?:DATABASE_URL|GEMINI_API_KEY)/);
});
