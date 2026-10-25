'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../server/store.cjs');

function database({ failAt = null } = {}) {
  const calls = [];
  const records = new Map();
  let snapshotAtBegin;
  return {
    calls,
    pool: {
      async query(sql, params) {
        calls.push(sql);
        if (sql.startsWith('SELECT state')) return { rows: records.has(params[0]) ? [records.get(params[0])] : [] };
        throw new Error('Unexpected pool query');
      },
      async connect() {
        return {
          async query(sql, params) {
            calls.push(sql);
            if (failAt && sql.includes(failAt)) throw new Error('simulated database failure');
            if (sql === 'BEGIN') snapshotAtBegin = new Map(records);
            if (sql.startsWith('INSERT INTO workspaces')) {
              if (records.has(params[0])) return { rows: [] };
              records.set(params[0], { state: JSON.parse(params[1]), revision: 1 });
              return { rows: [{ revision: 1 }] };
            }
            if (sql.startsWith('UPDATE workspaces')) {
              const current = records.get(params[0]);
              if (!current || current.revision !== params[2]) return { rows: [] };
              const updated = { state: JSON.parse(params[1]), revision: current.revision + 1 };
              records.set(params[0], updated);
              return { rows: [{ revision: updated.revision }] };
            }
            if (sql === 'ROLLBACK') { records.clear(); for (const [key, value] of snapshotAtBegin) records.set(key, value); }
            return { rows: [] };
          },
          release() { calls.push('RELEASE'); }
        };
      }
    }
  };
}

test('workspace save stores snapshot and normalized records in one transaction', async () => {
  const db = database();
  const store = createStore(db.pool);
  const state = { apps: [{ key: 'A-1' }], territories: [{ id: 'T-1' }], settings: { model: 'industry-v2' }, audit: [{ text: 'saved' }], messages: [{ text: 'why?' }] };
  await store.save('f28e574b-6f52-4f24-97c6-69e0c28bb54f', state, 0);
  assert.deepEqual(await store.load('f28e574b-6f52-4f24-97c6-69e0c28bb54f'), { state, revision: 1 });
  assert.equal(db.calls[0], 'BEGIN');
  assert.ok(db.calls.some(sql => sql.startsWith('INSERT INTO applications')));
  assert.ok(db.calls.some(sql => sql.startsWith('INSERT INTO territories')));
  assert.ok(db.calls.some(sql => sql.startsWith('INSERT INTO workspace_settings')));
  assert.ok(db.calls.some(sql => sql.startsWith('INSERT INTO audit_events')));
  assert.ok(db.calls.some(sql => sql.startsWith('INSERT INTO bot_messages')));
  const commitIndex = db.calls.indexOf('COMMIT');
  assert.ok(commitIndex > db.calls.findIndex(sql => sql.startsWith('INSERT INTO bot_messages')));
  assert.equal(db.calls[commitIndex + 1], 'RELEASE');
});

test('workspace save rolls back and releases the connection after a write failure', async () => {
  const db = database({ failAt: 'INSERT INTO applications' });
  const store = createStore(db.pool);
  await assert.rejects(store.save('f28e574b-6f52-4f24-97c6-69e0c28bb54f', { apps: [{}], territories: [], settings: {} }, 0), /simulated database failure/);
  assert.ok(db.calls.includes('ROLLBACK'));
  assert.equal(db.calls.at(-1), 'RELEASE');
  assert.equal(db.calls.includes('COMMIT'), false);
});

test('workspace save rejects a stale revision without changing the saved snapshot', async () => {
  const db = database();
  const store = createStore(db.pool);
  const id = 'f28e574b-6f52-4f24-97c6-69e0c28bb54f';
  const first = { apps: [{ key: 'original' }], territories: [], settings: {} };
  await store.save(id, first, 0);
  await assert.rejects(store.save(id, { ...first, apps: [{ key: 'stale' }] }, 0), { status: 409 });
  assert.deepEqual(await store.load(id), { state: first, revision: 1 });
});
