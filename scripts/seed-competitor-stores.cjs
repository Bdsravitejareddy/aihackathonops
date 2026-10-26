'use strict';

// Loads an OpenStreetMap store snapshot (scripts/build-competitor-stores.cjs) into Neon with a spatial index.
// Usage: node --env-file=.env scripts/seed-competitor-stores.cjs [sector]

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { Pool } = require('pg');
const { normalizeDatabaseUrl } = require('../server/db-config.cjs');

const BATCH = 2000;

async function seedStores(pool, snapshot) {
  await pool.query(`CREATE TABLE IF NOT EXISTS market_competitor_stores (
    sector text NOT NULL, osm_id text NOT NULL, name text, brand text, category text, brand_wikidata text,
    retrieved_at date NOT NULL, geom geometry(Point, 4326) NOT NULL, PRIMARY KEY (sector, osm_id))`);
  await pool.query('CREATE INDEX IF NOT EXISTS market_competitor_stores_geom_gix ON market_competitor_stores USING GIST (geom)');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Replace the sector's snapshot as a whole so stores removed from OSM disappear too.
    await client.query('DELETE FROM market_competitor_stores WHERE sector=$1', [snapshot.sector]);
    for (let start = 0; start < snapshot.stores.length; start += BATCH) {
      await client.query(`INSERT INTO market_competitor_stores (sector, osm_id, name, brand, category, brand_wikidata, retrieved_at, geom)
        SELECT $1, x->>'id', x->>'name', x->>'brand', x->>'category', x->>'brandWikidata', $2::date, ST_SetSRID(ST_MakePoint((x->>'lon')::float8, (x->>'lat')::float8), 4326)
        FROM jsonb_array_elements($3::jsonb) x ON CONFLICT DO NOTHING`, [snapshot.sector, snapshot.retrievedAt, JSON.stringify(snapshot.stores.slice(start, start + BATCH))]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  return { sector: snapshot.sector, stores: snapshot.stores.length, statesMissing: snapshot.statesMissing };
}

if (require.main === module) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const sector = process.argv[2] || 'apparel';
  const snapshot = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.resolve(__dirname, '..', 'data', 'competitors', `osm-${sector}-stores.json.gz`))).toString('utf8'));
  const pool = new Pool({ connectionString: normalizeDatabaseUrl(process.env.DATABASE_URL), max: 1 });
  seedStores(pool, snapshot).then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(error => { process.stderr.write(`Competitor store seeding failed: ${error.message}\n`); process.exitCode = 1; })
    .finally(() => pool.end());
}
module.exports = { seedStores };
