'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDatabaseUrl } = require('../server/db-config.cjs');

test('Neon connection URLs explicitly verify the server certificate and hostname', () => {
  assert.equal(normalizeDatabaseUrl('postgresql://user:pass@db.example/neondb?sslmode=require&channel_binding=require'), 'postgresql://user:pass@db.example/neondb?sslmode=verify-full&channel_binding=require');
});

test('database URLs without a legacy SSL mode are preserved', () => {
  assert.equal(normalizeDatabaseUrl('postgresql://user:pass@db.example/neondb?sslmode=verify-full'), 'postgresql://user:pass@db.example/neondb?sslmode=verify-full');
});
