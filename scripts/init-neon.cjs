'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { normalizeDatabaseUrl } = require('../server/db-config.cjs');

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Set it in your environment before initializing Neon.');
const pool = new Pool({ connectionString: normalizeDatabaseUrl(process.env.DATABASE_URL), max: 1 });
pool.query(fs.readFileSync(path.join(__dirname, '..', 'server', 'db.sql'), 'utf8'))
  .then(() => process.stdout.write('FranchiseOS tables are ready in Neon.\n'))
  .catch(error => { process.stderr.write(`Neon schema setup failed: ${error.message}\n`); process.exitCode = 1; })
  .finally(() => pool.end());
