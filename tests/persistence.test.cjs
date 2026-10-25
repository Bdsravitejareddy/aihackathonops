'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPersistence } = require('../dist/persistence.js');

function memoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
}

test('shared persistence loads server state and sends saves to that workspace', async () => {
  const storage = memoryStorage();
  const calls = [];
  const serverState = { apps: [{ id: 'server' }], territories: [], settings: {} };
  const persistence = createPersistence({ storage, fetchImpl: async (url, options = {}) => {
    calls.push({ url, options });
    return options.method === 'PUT' ? { ok: true, json: async () => ({ ok: true, revision: 5 }) } : { ok: true, json: async () => ({ state: serverState, revision: 4 }) };
  } });
  assert.deepEqual(await persistence.load(), serverState);
  const next = { apps: [], territories: [], settings: {}, audit: [] };
  await persistence.save(next);
  assert.equal(persistence.mode, 'shared');
  assert.match(calls[0].url, /\/api\/workspaces\/[0-9a-f-]{36}$/);
  assert.deepEqual(JSON.parse(calls[1].options.body), { revision: 4, state: next });
  assert.equal(storage.getItem('franchise-os-v1'), JSON.stringify(next));
});

test('unavailable API falls back to the browser copy and keeps local writes', async () => {
  const original = { apps: [{ id: 'local' }], territories: [], settings: {} };
  const storage = memoryStorage({ 'franchise-os-v1': JSON.stringify(original) });
  const persistence = createPersistence({ storage, fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepEqual(await persistence.load(), original);
  const next = { apps: [], territories: [], settings: {} };
  await persistence.save(next);
  assert.equal(persistence.mode, 'browser');
  assert.equal(storage.getItem('franchise-os-v1'), JSON.stringify(next));
});

test('missing server workspace uses local data without deleting the local backup', async () => {
  const original = { apps: [{ id: 'local' }], territories: [], settings: {} };
  const storage = memoryStorage({ 'franchise-os-v1': JSON.stringify(original) });
  const persistence = createPersistence({ storage, fetchImpl: async () => ({ status: 404, ok: false }) });
  assert.deepEqual(await persistence.load(), original);
  assert.equal(storage.getItem('franchise-os-v1'), JSON.stringify(original));
});

test('a local save made during server loading wins over the stale server response', async () => {
  const storage = memoryStorage();
  let resolveLoad;
  const persisted = createPersistence({ storage, fetchImpl: async (_url, options = {}) => {
    if (options.method === 'PUT') return { ok: true };
    return new Promise(resolve => { resolveLoad = resolve; });
  } });
  const loading = persisted.load();
  const localEdit = { apps: [{ id: 'new-edit' }], territories: [], settings: {} };
  await persisted.save(localEdit);
  resolveLoad({ ok: true, json: async () => ({ revision: 1, state: { apps: [{ id: 'stale-server' }], territories: [], settings: {} } }) });
  assert.deepEqual(await loading, localEdit);
});

test('a revision conflict preserves the local copy and exposes conflict mode', async () => {
  const serverState = { apps: [{ id: 'server' }], territories: [], settings: {} };
  const localState = { apps: [{ id: 'local' }], territories: [], settings: {} };
  const storage = memoryStorage();
  const persisted = createPersistence({ storage, fetchImpl: async (_url, options = {}) => options.method === 'PUT'
    ? { ok: false, status: 409 }
    : { ok: true, json: async () => ({ state: serverState, revision: 7 }) } });
  await persisted.load();
  await persisted.save(localState);
  assert.equal(persisted.mode, 'conflict');
  assert.equal(storage.getItem('franchise-os-v1'), JSON.stringify(localState));
});

test('a confirmed shared save shows pending while the request is in flight', async () => {
  let finishSave;
  let signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const persisted = createPersistence({ storage: memoryStorage(), fetchImpl: async (_url, options = {}) => options.method === 'PUT'
    ? new Promise(resolve => { finishSave = resolve; signalStarted(); })
    : { ok: true, json: async () => ({ state: { apps: [], territories: [], settings: {} }, revision: 1 }) } });
  await persisted.load();
  const saving = persisted.save({ apps: [], territories: [], settings: {}, audit: [{ text: 'update' }] });
  await started;
  assert.equal(persisted.mode, 'pending');
  finishSave({ ok: true, json: async () => ({ ok: true, revision: 2 }) });
  await saving;
  assert.equal(persisted.mode, 'shared');
});
