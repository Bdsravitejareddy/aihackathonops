'use strict';
(function (root) {
  const STATE_KEY = 'franchise-os-v1';
  const ID_KEY = 'franchise-os-workspace-id';
  // Set while the browser holds changes the server has not confirmed (e.g. an import whose save was rejected).
  const UNSYNCED_KEY = 'franchise-os-unsynced';

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
    const put = (state, expected) => fetchImpl(endpoint, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision: expected, state }) });
    // A 409 means the server copy moved on (another tab, a failed first load that left revision 0, an older app
    // version). This is the browser's own workspace, so the latest local action wins: adopt the server revision, retry once.
    async function putWithRecovery(state) {
      let response = await put(state, revision);
      if (response.status === 409) {
        const current = await fetchImpl(endpoint, { headers: { accept: 'application/json' } });
        const latest = current.ok ? (await current.json()).revision : current.status === 404 ? 0 : null;
        if (latest !== null) response = await put(state, latest);
      }
      return response;
    }
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
              revision = payload.revision;
              // Unconfirmed local work (an import whose save failed) must not be replaced by the older server copy.
              const pending = storage.getItem(UNSYNCED_KEY) && local();
              if (pending) { this.save(pending); return pending; }
              const state = payload.state;
              storage.setItem(STATE_KEY, JSON.stringify(state));
              mode = 'shared';
              return state;
            }
            if (response.status === 404 && changeVersion === versionAtStart) {
              revision = 0;
              const pending = storage.getItem(UNSYNCED_KEY) && local();
              if (pending) { this.save(pending); return pending; }
            }
          } catch { /* Keep the last local snapshot available offline. */ }
        }
        mode = 'browser';
        return local();
      },
      save(state) {
        changeVersion++;
        storage.setItem(STATE_KEY, JSON.stringify(state));
        storage.setItem(UNSYNCED_KEY, '1');
        const snapshot = JSON.stringify(state);
        if (fetchImpl) { pendingWrites++; mode = 'pending'; }
        else mode = 'browser';
        queue = queue.then(async () => {
          if (!fetchImpl) { mode = 'browser'; return; }
          try {
            const response = await putWithRecovery(JSON.parse(snapshot));
            if (response.ok) {
              const result = await response.json();
              revision = result.revision;
              mode = 'shared';
              if (storage.getItem(STATE_KEY) === snapshot) storage.setItem(UNSYNCED_KEY, '');
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
