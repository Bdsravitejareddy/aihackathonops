'use strict';
(function (root) {
  const STATE_KEY = 'franchise-os-v1';
  const ID_KEY = 'franchise-os-workspace-id';

  function createPersistence({ fetchImpl = root.fetch?.bind(root), storage = root.localStorage, baseUrl = '' } = {}) {
    let mode = 'browser';
    let queue = Promise.resolve();
    let revision = 0;
    let changeVersion = 0;
    let pendingWrites = 0;
    let id = storage.getItem(ID_KEY);
    if (!id) {
      id = root.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 3 | 8)).toString(16);
      });
      storage.setItem(ID_KEY, id);
    }
    const endpoint = `${baseUrl}/api/workspaces/${id}`;
    const local = () => {
      try { return JSON.parse(storage.getItem(STATE_KEY) || 'null'); }
      catch { return null; }
    };
    return {
      workspaceId: id,
      get mode() { return mode; },
      whenSynced() { return queue; },
      async load() {
        const versionAtStart = changeVersion;
        if (fetchImpl) {
          try {
            const response = await fetchImpl(endpoint, { headers: { accept: 'application/json' } });
            if (response.ok) {
              const payload = await response.json();
              if (changeVersion !== versionAtStart) return local();
              const state = payload.state;
              revision = payload.revision;
              storage.setItem(STATE_KEY, JSON.stringify(state));
              mode = 'shared';
              return state;
            }
            if (response.status === 404 && changeVersion === versionAtStart) revision = 0;
          } catch { /* Keep the last local snapshot available offline. */ }
        }
        mode = 'browser';
        return local();
      },
      save(state) {
        changeVersion++;
        storage.setItem(STATE_KEY, JSON.stringify(state));
        const snapshot = JSON.stringify(state);
        if (fetchImpl) { pendingWrites++; mode = 'pending'; }
        else mode = 'browser';
        queue = queue.then(async () => {
          if (!fetchImpl) { mode = 'browser'; return; }
          try {
            const response = await fetchImpl(endpoint, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision, state: JSON.parse(snapshot) }) });
            if (response.ok) {
              const result = await response.json();
              revision = result.revision;
              mode = 'shared';
            } else mode = response.status === 409 ? 'conflict' : 'browser';
          } catch { mode = 'browser'; }
          finally { pendingWrites--; if (pendingWrites > 0) mode = 'pending'; }
        });
        return queue;
      }
    };
  }

  const api = { createPersistence };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FranchisePersistence = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
