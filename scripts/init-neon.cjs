'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { normalizeDatabaseUrl } = require('../server/db-config.cjs');
const { createMarketStore } = require('../server/market-store.cjs');
const { createMarketMapStore } = require('../server/market-map-store.cjs');
const { ingest } = require('./ingest-india-geography.cjs');

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Set it in your environment before initializing Neon.');
const pool = new Pool({ connectionString: normalizeDatabaseUrl(process.env.DATABASE_URL), max: 1 });
const sources = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'india-market-sources.json'), 'utf8'));
const benchmarks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'india-market-benchmarks.json'), 'utf8'));
const ingestion = ingest({ rootDir: path.join(__dirname, '..') });
const geography = JSON.parse(fs.readFileSync(ingestion.path, 'utf8'));
pool.query(fs.readFileSync(path.join(__dirname, '..', 'server', 'db.sql'), 'utf8'))
  .then(() => createMarketStore(pool).seedCatalog(sources, benchmarks))
  .then(async result => {
    const maps = await createMarketMapStore(pool).seedMapCatalog(geography.geographies || [], geography.relationships || []);
    process.stdout.write(`FranchiseOS additive tables are ready; seeded ${result.sourceVersions} source versions, ${result.observationsInserted} new market observations, ${maps.geographiesInserted} geographies and ${maps.relationshipsInserted} relationships.\n`);
  })
  .catch(error => { process.stderr.write(`Neon schema setup failed: ${error.message}\n`); process.exitCode = 1; })
  .finally(() => pool.end());
