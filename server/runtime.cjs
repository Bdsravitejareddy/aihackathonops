'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { createHandler } = require('./app.cjs');
const { createStore } = require('./store.cjs');
const { createMarketStore } = require('./market-store.cjs');
const { createMarketMapStore } = require('./market-map-store.cjs');
const { createMarketResearchStore } = require('./market-research-store.cjs');
const { createMarketResearchService } = require('./market-research.cjs');
const { normalizeDatabaseUrl } = require('./db-config.cjs');

function createApplicationRuntime({ allowRemote = false, logger = console } = {}) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Set it in the server environment.');
  const pool = new Pool({ connectionString: normalizeDatabaseUrl(process.env.DATABASE_URL), max: 5 });
  pool.on('error', error => {
    logger.error?.(`Neon idle connection dropped (${error.code || 'connection error'}); a later query will reconnect.`);
  });

  const dataDirectory = path.resolve(__dirname, '..', 'data');
  const marketSources = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'india-market-sources.json'), 'utf8'));
  const marketBenchmarks = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'india-market-benchmarks.json'), 'utf8'));
  const geographyManifest = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'india-geography', 'manifest.json'), 'utf8'));
  const priorityPlacesVersion = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'india-geography', 'karnataka-priority-places.json'), 'utf8')).version;
  const marketMapStore = createMarketMapStore(pool);
  marketMapStore.sourceVersion = `india-geography-${geographyManifest.version}+${priorityPlacesVersion}`;
  const marketResearchService = createMarketResearchService({ logger });
  const api = createHandler({
    store: createStore(pool),
    marketStore: createMarketStore(pool),
    marketMapStore,
    marketResearchStore: createMarketResearchStore(pool),
    marketResearchService,
    marketSources,
    marketBenchmarks,
    allowRemote
  });
  return { api, pool };
}

module.exports = { createApplicationRuntime };
