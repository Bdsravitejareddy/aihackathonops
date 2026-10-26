'use strict';

// Downloads a sector's stores for all of India from OpenStreetMap (Overpass), one state at a time, into a
// gzipped snapshot that seed-competitor-stores.cjs loads into Neon. Public Overpass servers are often busy,
// so requests are sequential with backoff across mirrors, and finished states are kept between runs.
// Usage: node scripts/build-competitor-stores.cjs [sector]   (default: apparel)

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { APPAREL } = require('../server/market-sectors.cjs');

const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const OUT_DIR = path.resolve(__dirname, '..', 'data', 'competitors');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const brandKey = value => String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

function stateQuery(iso, osmTags) {
  const filters = osmTags.map(([key, value]) => `nwr["${key}"="${value}"](area.s);`).join('');
  return `[out:json][timeout:240];area["ISO3166-2"="${iso}"]["admin_level"="4"]->.s;(${filters});out tags center;`;
}

async function fetchState(iso, osmTags, log) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const url = MIRRORS[attempt % MIRRORS.length];
    try {
      const response = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: stateQuery(iso, osmTags) }),
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'FranchiseOS/1.0 competitor snapshot' }, signal: AbortSignal.timeout(300000) });
      if (response.ok) return await response.json();
      log(`${iso}: ${url} answered ${response.status}`);
    } catch (error) { log(`${iso}: ${url} ${error.name}`); }
    await wait(Math.min(120000, 15000 * 2 ** Math.min(attempt, 3)));
  }
  return null;
}

function toStores(payload, profile) {
  const known = profile.majorBrands.map(name => ({ name, key: brandKey(name) })).filter(b => b.key.length >= 3);
  return (payload.elements || []).map(element => {
    const tags = element.tags || {}, lon = element.lon ?? element.center?.lon, lat = element.lat ?? element.center?.lat;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    const name = (tags.name || tags['name:en'] || '').slice(0, 120);
    const brand = (tags.brand || tags['brand:en'] || known.find(b => brandKey(name).includes(b.key))?.name || '').slice(0, 80);
    return { id: `${element.type}/${element.id}`, lon: Math.round(lon * 1e6) / 1e6, lat: Math.round(lat * 1e6) / 1e6,
      category: tags.shop || tags.amenity || 'other', name, brand: brand || null, brandWikidata: tags['brand:wikidata'] || null };
  }).filter(Boolean);
}

async function build(sectorId = 'apparel', { log = line => process.stdout.write(`${line}\n`) } = {}) {
  if (sectorId !== APPAREL.id) throw new Error('Only the built-in apparel sector has a snapshot definition; researched sectors use live lookups.');
  const profile = APPAREL;
  const states = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'data/india-geography/india-state-features.geojson'), 'utf8')).features.map(f => f.properties.code);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const partialPath = path.join(OUT_DIR, `.osm-${sectorId}-partial.json`);
  const partial = fs.existsSync(partialPath) ? JSON.parse(fs.readFileSync(partialPath, 'utf8')) : { states: {}, osmBase: {} };
  for (const iso of states) {
    if (partial.states[iso]) continue;
    const payload = await fetchState(iso, profile.osmTags, log);
    if (!payload) { log(`${iso}: gave up for now; rerun to resume`); continue; }
    partial.states[iso] = toStores(payload, profile);
    partial.osmBase[iso] = payload.osm3s?.timestamp_osm_base || null;
    fs.writeFileSync(partialPath, JSON.stringify(partial));
    log(`${iso}: ${partial.states[iso].length} stores`);
    await wait(5000);
  }
  const missing = states.filter(iso => !partial.states[iso]);
  const stores = [...new Map(Object.values(partial.states).flat().map(s => [s.id, s])).values()];
  const snapshot = { sector: sectorId, osmTags: profile.osmTags, license: 'Data © OpenStreetMap contributors, ODbL 1.0', source: 'OpenStreetMap via Overpass API',
    retrievedAt: new Date().toISOString().slice(0, 10), osmBase: partial.osmBase, statesMissing: missing, storeCount: stores.length, stores };
  const bytes = zlib.gzipSync(JSON.stringify(snapshot), { level: 9 });
  const out = path.join(OUT_DIR, `osm-${sectorId}-stores.json.gz`);
  fs.writeFileSync(out, bytes);
  if (!missing.length) fs.rmSync(partialPath, { force: true });
  return { path: out, storeCount: stores.length, statesMissing: missing, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

if (require.main === module) build(process.argv[2]).then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
module.exports = { build, toStores, stateQuery };
