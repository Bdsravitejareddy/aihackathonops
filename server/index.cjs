'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { createHandler } = require('./app.cjs');
const { createStore } = require('./store.cjs');
const { createMarketStore } = require('./market-store.cjs');
const { createMarketMapStore } = require('./market-map-store.cjs');
const { createMarketResearchStore } = require('./market-research-store.cjs');
const { createMarketResearchService } = require('./market-research.cjs');
const { createStaticHandler } = require('./static.cjs');
const { normalizeDatabaseUrl } = require('./db-config.cjs');

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Copy .env.example and set the Neon connection string.');
const pool = new Pool({ connectionString: normalizeDatabaseUrl(process.env.DATABASE_URL), max: 5 });
const dataDirectory = path.resolve(__dirname, '..', 'data');
const marketSources = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'india-market-sources.json'), 'utf8'));
const marketBenchmarks = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'india-market-benchmarks.json'), 'utf8'));
const geographyManifest = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'india-geography', 'manifest.json'), 'utf8'));
const marketStore = createMarketStore(pool);
const marketMapStore = createMarketMapStore(pool);
marketMapStore.sourceVersion = `india-geography-${geographyManifest.version}`;
const marketResearchStore = createMarketResearchStore(pool);
const marketResearchService = createMarketResearchService({ logger: {
  info(message, metadata) { process.stdout.write(`${message} ${JSON.stringify(metadata)}\n`); },
  error(message, metadata) { process.stderr.write(`${message} ${JSON.stringify(metadata)}\n`); }
} });
const api = createHandler({ store: createStore(pool), marketStore, marketMapStore, marketResearchStore, marketResearchService, marketSources, marketBenchmarks });
const serveStatic = createStaticHandler({ directory: require('node:path').resolve(__dirname, '..', 'dist') });
const staticServer = http.createServer((req, res) => req.url.startsWith('/api/') ? api(req, res) : serveStatic(req, res));
const port = Number(process.env.PORT || 8080);
// Local development is intentionally restricted to this machine until authentication is added.
staticServer.listen(port, '127.0.0.1', () => process.stdout.write(`FranchiseOS listening at http://127.0.0.1:${port}\n`));
process.on('SIGINT', async () => { staticServer.close(); await pool.end(); process.exit(0); });
