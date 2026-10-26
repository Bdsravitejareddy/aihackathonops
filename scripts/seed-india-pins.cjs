'use strict';

// Loads the approximate PIN areas into Neon in batches and links each PIN to its district.
// Run after `npm run db:init` (which seeds states and districts): node --env-file=.env scripts/seed-india-pins.cjs

const { Pool } = require('pg');
const { normalizeDatabaseUrl } = require('../server/db-config.cjs');
const { readPinArtifact, expandPinFeature } = require('./build-india-pins.cjs');

const BATCH = 500;

async function seedPins(pool, collection = readPinArtifact(), { log = () => {} } = {}) {
  const features = collection.features.map(feature => expandPinFeature(collection, feature));
  const parents = [...new Set(features.map(f => f.properties.parentId))];
  const known = await pool.query(`SELECT external_id FROM market_geographies WHERE kind='district' AND external_id = ANY($1::text[])`, [parents]);
  const missing = parents.filter(id => !known.rows.some(row => row.external_id === id));
  if (missing.length) throw new Error(`${missing.length} parent districts are not in the database (e.g. ${missing[0]}). Run npm run db:init first.`);
  let geographies = 0, relationships = 0;
  for (let start = 0; start < features.length; start += BATCH) {
    const rows = features.slice(start, start + BATCH).map(f => ({ id: f.id, name: f.properties.name, parent: f.properties.parentId, properties: { ...f.properties, sourceCode: f.properties.sourceCode || f.id }, geometry: f.geometry }));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(`INSERT INTO market_geographies (kind, external_id, name, properties, geom)
        SELECT 'pin', x->>'id', x->>'name', x->'properties', ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON((x->'geometry')::text), 4326)), 3) FROM jsonb_array_elements($1::jsonb) x
        ON CONFLICT (kind, external_id) DO UPDATE SET name=EXCLUDED.name, properties=EXCLUDED.properties, geom=EXCLUDED.geom`, [JSON.stringify(rows)]);
      await client.query(`DELETE FROM market_geo_relationships r USING market_geographies c WHERE r.child_id=c.id AND c.kind='pin' AND r.relationship='contains' AND c.external_id = ANY($1::text[])`, [rows.map(r => r.id)]);
      const linked = await client.query(`INSERT INTO market_geo_relationships (parent_id, child_id, relationship, properties)
        SELECT p.id, c.id, 'contains', jsonb_build_object('sourceId','india-post-pin-directory','method',x->'properties'->>'mappingMethod')
        FROM jsonb_array_elements($1::jsonb) x JOIN market_geographies c ON c.kind='pin' AND c.external_id=x->>'id' JOIN market_geographies p ON p.kind='district' AND p.external_id=x->>'parent'
        ON CONFLICT DO NOTHING`, [JSON.stringify(rows.map(r => ({ id: r.id, parent: r.parent, properties: { mappingMethod: r.properties.mappingMethod } })))]);
      await client.query('COMMIT');
      geographies += inserted.rowCount; relationships += linked.rowCount;
      log(`${Math.min(start + BATCH, features.length)} / ${features.length}`);
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  return { geographies, relationships };
}

if (require.main === module) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const pool = new Pool({ connectionString: normalizeDatabaseUrl(process.env.DATABASE_URL), max: 2 });
  seedPins(pool, undefined, { log: line => process.stdout.write(`\r${line} PINs`) })
    .then(result => process.stdout.write(`\nSeeded ${result.geographies} PIN areas and ${result.relationships} district links.\n`))
    .catch(error => { process.stderr.write(`\nPIN seeding failed: ${error.message}\n`); process.exitCode = 1; })
    .finally(() => pool.end());
}
module.exports = { seedPins };
