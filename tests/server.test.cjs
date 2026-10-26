'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createHandler } = require('../server/app.cjs');

async function withHandler(run) {
  const records = new Map();
  const store = {
    async load(id) { return records.get(id) ?? null; },
    async save(id, snapshot, expectedRevision) {
      const current = records.get(id);
      if ((current?.revision ?? 0) !== expectedRevision) throw Object.assign(new Error('Revision conflict'), { status: 409 });
      const revision = expectedRevision + 1;
      records.set(id, { state: structuredClone(snapshot), revision });
      return revision;
    }
  };
  const handle = createHandler({ store });
  const call = async (method, path, body) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    req.method = method;
    req.url = path;
    req.headers = { host: '127.0.0.1:8080', ...(body === undefined ? {} : { 'content-type': 'application/json' }) };
    let status;
    let responseBody;
    const res = { writeHead(code) { status = code; }, setHeader() {}, end(value) { responseBody = value; } };
    await handle(req, res);
    return { status, json: () => JSON.parse(responseBody) };
  };
  await run(call);
}

test('health route reports an available local API', async () => {
  await withHandler(async call => {
    const response = await call('GET', '/api/health');
    assert.equal(response.status, 200);
    assert.deepEqual(response.json(), { ok: true });
  });
});

test('workspace save and load round-trip the complete app state', async () => {
  const id = 'f28e574b-6f52-4f24-97c6-69e0c28bb54f';
  const state = { apps: [{ key: 'A-1', name: 'Example' }], territories: [], settings: { model: 'industry-v2' }, audit: [] };
  await withHandler(async call => {
    const saved = await call('PUT', `/api/workspaces/${id}`, { revision: 0, state });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.json(), { ok: true, revision: 1 });
    const loaded = await call('GET', `/api/workspaces/${id}`);
    assert.equal(loaded.status, 200);
    assert.deepEqual(loaded.json(), { state, revision: 1 });
  });
});

test('workspace reads are isolated by workspace identifier', async () => {
  const one = 'f28e574b-6f52-4f24-97c6-69e0c28bb54f';
  const two = '2de330f2-e48e-4df2-90a3-59a8549d0a7f';
  await withHandler(async call => {
    await call('PUT', `/api/workspaces/${one}`, { revision: 0, state: { apps: [{ id: 'one' }], territories: [] } });
    const response = await call('GET', `/api/workspaces/${two}`);
    assert.equal(response.status, 404);
    assert.deepEqual(response.json(), { error: 'Workspace not found' });
  });
});

test('invalid workspace payload is rejected without saving', async () => {
  const id = 'f28e574b-6f52-4f24-97c6-69e0c28bb54f';
  await withHandler(async call => {
    const response = await call('PUT', `/api/workspaces/${id}`, { revision: 0, state: { apps: 'not-an-array', territories: [] } });
    assert.equal(response.status, 400);
    assert.deepEqual(response.json(), { error: 'Invalid workspace payload' });
  });
});

test('oversized workspace payload is rejected with a size error', async () => {
  const id = 'f28e574b-6f52-4f24-97c6-69e0c28bb54f';
  await withHandler(async call => {
    const req = Readable.from([Buffer.from(JSON.stringify({ apps: [], territories: [], value: '12345' }))]);
    req.method = 'PUT';
    req.url = `/api/workspaces/${id}`;
    req.headers = { host: '127.0.0.1:8080', 'content-type': 'application/json' };
    let status;
    let body;
    const res = { writeHead(code) { status = code; }, setHeader() {}, end(value) { body = value; } };
    await createHandler({ store: { load: async () => null, save: async () => {} }, maxBodyBytes: 20 })(req, res);
    assert.equal(status, 413);
    assert.deepEqual(JSON.parse(body), { error: 'Payload too large' });
  });
});

test('API rejects a hostile host or cross-origin browser request', async () => {
  const handle = createHandler({ store: { load: async () => null, save: async () => {} } });
  const req = Readable.from([]);
  req.method = 'GET';
  req.url = '/api/health';
  req.headers = { host: '127.0.0.1:8080', origin: 'http://attacker.example' };
  let status;
  let body;
  await handle(req, { writeHead(code) { status = code; }, setHeader() {}, end(value) { body = value; } });
  assert.equal(status, 403);
  assert.deepEqual(JSON.parse(body), { error: 'Local requests only' });
});

test('Vercel serverless handler accepts the platform host and HTTPS origin while local handler stays restricted', async () => {
  const handle = createHandler({ store: { load: async () => null, save: async () => {} }, allowRemote: true });
  const req = Readable.from([]);
  req.method = 'GET';
  req.url = '/api/health';
  req.headers = { host: 'franchiseos.vercel.app', origin: 'https://franchiseos.vercel.app' };
  let status;
  let body;
  await handle(req, { writeHead(code) { status = code; }, setHeader() {}, end(value) { body = value; } });
  assert.equal(status, 200);
  assert.deepEqual(JSON.parse(body), { ok: true });
});

test('stale workspace save gets a conflict and leaves the latest revision intact', async () => {
  const id = 'f28e574b-6f52-4f24-97c6-69e0c28bb54f';
  await withHandler(async call => {
    const latest = { apps: [{ id: 'latest' }], territories: [], settings: {} };
    const stale = { apps: [{ id: 'stale' }], territories: [], settings: {} };
    assert.equal((await call('PUT', `/api/workspaces/${id}`, { revision: 0, state: latest })).status, 200);
    const conflict = await call('PUT', `/api/workspaces/${id}`, { revision: 0, state: stale });
    assert.equal(conflict.status, 409);
    assert.deepEqual(conflict.json(), { error: 'Workspace changed elsewhere. Reload before saving.' });
    assert.deepEqual((await call('GET', `/api/workspaces/${id}`)).json(), { state: latest, revision: 1 });
  });
});
