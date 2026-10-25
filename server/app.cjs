'use strict';

const http = require('node:http');
const { validateWorkspacePayload } = require('./validation.cjs');
const { validatePin, calculateMarketAssessment } = require('./market-engine.cjs');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reply(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
}

function assessmentView(row) {
  if (!row) return row;
  if (row.snapshot) return row;
  const { id, workspaceId, version, ...snapshot } = row;
  return { id, workspaceId, version, snapshot };
}

function savedVersion(value) {
  return typeof value === 'number' ? value : value?.version;
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

function createHandler({ store, marketStore, marketSources, marketBenchmarks, maxBodyBytes = 10 * 1024 * 1024 }) {
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

    if (url.pathname.startsWith('/api/market/')) {
      if (req.method === 'GET' && url.pathname === '/api/market/sources') {
        if (typeof marketStore?.listSources === 'function') {
          try {
            const catalog = await marketStore.listSources();
            if (catalog.sources?.length) return reply(res, 200, catalog);
          } catch { /* Use the checked-in catalog when Neon is unavailable. */ }
        }
        return reply(res, 200, marketSources || { version: null, sources: [] });
      }
      if (req.method === 'GET' && url.pathname === '/api/market/benchmarks') {
        if (typeof marketStore?.listBenchmarks === 'function') {
          try {
            const catalog = await marketStore.listBenchmarks();
            if (catalog.observations?.length) return reply(res, 200, catalog);
          } catch { /* Use the checked-in catalog when Neon is unavailable. */ }
        }
        return reply(res, 200, marketBenchmarks || { version: null, observations: [] });
      }
      if (url.pathname === '/api/market/pins/validate' && req.method === 'POST') {
        if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) return reply(res, 415, { error: 'Content-Type must be application/json' });
        try {
          const payload = await readBody(req, maxBodyBytes);
          return reply(res, 200, { formatValid: validatePin(payload?.pin), directoryStatus: 'not_verified' });
        } catch (error) {
          return reply(res, error.status || 400, { error: error.status === 413 ? 'Payload too large' : 'Invalid JSON' });
        }
      }
      if (!marketStore) return reply(res, 503, { error: 'Market storage unavailable' });

      const workspaceId = url.searchParams.get('workspaceId');
      const assessmentPath = url.pathname.match(/^\/api\/market\/assessments\/([^/]+)(?:\/(competitors|recalculate))?$/);
      if (url.pathname === '/api/market/assessments' && req.method === 'GET') {
        if (!UUID.test(workspaceId || '')) return reply(res, 400, { error: 'Invalid workspace identifier' });
        try { return reply(res, 200, { assessments: await marketStore.listAssessments(workspaceId) }); }
        catch { return reply(res, 503, { error: 'Market storage unavailable' }); }
      }
      if (url.pathname === '/api/market/assessments/compare' && req.method === 'POST') {
        if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) return reply(res, 415, { error: 'Content-Type must be application/json' });
        try {
          const payload = await readBody(req, maxBodyBytes);
          if (!UUID.test(payload?.workspaceId || '') || !Array.isArray(payload.ids) || payload.ids.length < 1 || payload.ids.length > 50 || payload.ids.some(id => !UUID.test(id))) return reply(res, 400, { error: 'Invalid comparison request' });
          const rows = await Promise.all(payload.ids.map(id => marketStore.getAssessment(payload.workspaceId, id)));
          return reply(res, 200, { assessments: rows.filter(Boolean).map(assessmentView) });
        } catch (error) { return reply(res, error.status || 503, { error: error.status === 413 ? 'Payload too large' : error.status === 400 ? 'Invalid JSON' : 'Market storage unavailable' }); }
      }
      if (assessmentPath) {
        const id = assessmentPath[1];
        const action = assessmentPath[2];
        if (!UUID.test(id)) return reply(res, 400, { error: 'Invalid assessment identifier' });
        const isWrite = req.method === 'PUT' || req.method === 'POST';
        if (isWrite && !req.headers['content-type']?.toLowerCase().startsWith('application/json')) return reply(res, 415, { error: 'Content-Type must be application/json' });
        try {
          if (action === 'competitors') {
            if (req.method === 'GET') {
              if (!UUID.test(workspaceId || '')) return reply(res, 400, { error: 'Invalid workspace identifier' });
              const assessment = await marketStore.getAssessment(workspaceId, id);
              if (!assessment) return reply(res, 404, { error: 'Market assessment not found' });
              return reply(res, 200, { competitors: await marketStore.listCompetitors(workspaceId, id) });
            }
            if (req.method === 'PUT') {
              const payload = await readBody(req, maxBodyBytes);
              if (!UUID.test(payload?.workspaceId || '') || !Array.isArray(payload.competitors) || payload.competitors.length > 500 || payload.competitors.some(item => !item || typeof item !== 'object' || Array.isArray(item))) return reply(res, 400, { error: 'Invalid competitor request' });
              if (!await marketStore.getAssessment(payload.workspaceId, id)) return reply(res, 404, { error: 'Market assessment not found' });
              const competitors = await marketStore.replaceCompetitors(payload.workspaceId, id, payload.competitors);
              return reply(res, 200, { competitors });
            }
          } else if (action === 'recalculate' && req.method === 'POST') {
            const payload = await readBody(req, maxBodyBytes);
            if (!UUID.test(payload?.workspaceId || '') || !Number.isInteger(payload.expectedVersion) || payload.expectedVersion < 0) return reply(res, 400, { error: 'Invalid recalculation request' });
            const current = await marketStore.getAssessment(payload.workspaceId, id);
            if (!current) return reply(res, 404, { error: 'Market assessment not found' });
            if (current.version !== payload.expectedVersion) return reply(res, 409, { error: 'Market assessment changed elsewhere. Reload before recalculating.' });
            const snapshot = assessmentView(current).snapshot;
            const results = calculateMarketAssessment({ ...(snapshot.inputs || {}), sourceVintage: snapshot.sourceVintage, geography: snapshot.geography });
            const nextSnapshot = { ...snapshot, results };
            const version = savedVersion(await marketStore.saveAssessment(payload.workspaceId, id, payload.expectedVersion, nextSnapshot));
            return reply(res, 200, { id, workspaceId: payload.workspaceId, version, snapshot: nextSnapshot });
          } else if (!action && req.method === 'GET') {
            if (!UUID.test(workspaceId || '')) return reply(res, 400, { error: 'Invalid workspace identifier' });
            const assessment = await marketStore.getAssessment(workspaceId, id);
            return assessment ? reply(res, 200, assessmentView(assessment)) : reply(res, 404, { error: 'Market assessment not found' });
          } else if (!action && req.method === 'PUT') {
            const payload = await readBody(req, maxBodyBytes);
            if (!UUID.test(payload?.workspaceId || '') || !Number.isInteger(payload.expectedVersion) || payload.expectedVersion < 0 || !payload.snapshot || typeof payload.snapshot !== 'object' || Array.isArray(payload.snapshot)) return reply(res, 400, { error: 'Invalid market assessment payload' });
            const version = savedVersion(await marketStore.saveAssessment(payload.workspaceId, id, payload.expectedVersion, payload.snapshot));
            return reply(res, 200, { id, workspaceId: payload.workspaceId, version, snapshot: payload.snapshot });
          } else {
            res.setHeader('allow', action === 'competitors' ? 'GET, PUT' : action === 'recalculate' ? 'POST' : 'GET, PUT');
            return reply(res, 405, { error: 'Method not allowed' });
          }
        } catch (error) {
          if (error.status === 409) return reply(res, 409, { error: 'Market assessment changed elsewhere. Reload before saving.' });
          return reply(res, error.status || 503, { error: error.status === 400 ? 'Invalid JSON' : error.status === 413 ? 'Payload too large' : 'Market storage unavailable' });
        }
      }
      return reply(res, 404, { error: 'Not found' });
    }

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
