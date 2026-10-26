'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCompetitorService, overpassPolygon, overpassQuery, summarizeObserved, shapeResearched } = require('../server/market-competitors.cjs');
const { createSectorRegistry } = require('../server/market-sectors.cjs');

const square = [[77.5, 12.9], [77.6, 12.9], [77.6, 13.0], [77.5, 13.0], [77.5, 12.9]];
const citations = [{ title: 'a', url: 'https://a.example' }, { title: 'b', url: 'https://b.example' }];

test('overpassPolygon thins a 300-point ring to about 100 lat-lon pairs', () => {
  const ring = Array.from({ length: 300 }, (_, i) => [77 + i / 1000, 12 + i / 1000]);
  const poly = overpassPolygon({ type: 'Polygon', coordinates: [ring] });
  const tokens = poly.split(' ');
  assert.ok(tokens.length / 2 <= 121);
  assert.equal(tokens.length / 2, 100);
  assert.ok(tokens.every(token => /^-?\d+\.\d{5}$/.test(token)));
  assert.ok(poly.startsWith('12.00000 77.00000 '), 'latitude must come first');
});

test('overpassPolygon uses the largest ring of a MultiPolygon', () => {
  const small = [[10, 1], [11, 1], [11, 1.5], [10, 1]];
  const big = [[80, 2], [81, 2], [81, 3], [80, 3], [80.5, 2.5], [80.6, 2.6], [80.7, 2.7], [80.8, 2.8], [80.9, 2.9], [80, 2]];
  const poly = overpassPolygon({ type: 'MultiPolygon', coordinates: [[small], [big]] });
  assert.equal(poly.split(' ').length / 2, big.length);
  assert.ok(poly.startsWith('2.00000 80.00000 '));
});

test('overpassPolygon returns null for missing or degenerate geometry', () => {
  assert.equal(overpassPolygon(null), null);
  assert.equal(overpassPolygon({ type: 'Point', coordinates: [77, 12] }), null);
  assert.equal(overpassPolygon({ type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] }), null);
  assert.equal(overpassPolygon({ type: 'MultiPolygon', coordinates: [] }), null);
});

test('overpassQuery emits one nwr filter per tag pair, each bound to the polygon', () => {
  const query = overpassQuery('12.0 77.0 12.1 77.1', [['shop', 'clothes'], ['shop', 'shoes'], ['shop', 'fashion']]);
  assert.equal(query.match(/nwr\[/g).length, 3);
  assert.ok(query.includes('nwr["shop"="clothes"](poly:"12.0 77.0 12.1 77.1");'));
  assert.ok(query.startsWith('[out:json][timeout:25];('));
  assert.ok(query.endsWith('out tags center 400;'));
});

test('overpassQuery strips double quotes from tag keys and values', () => {
  const query = overpassQuery('1 2 3 4', [['na"me', 'a"b']]);
  assert.ok(query.includes('nwr["name"="ab"](poly:"1 2 3 4");'));
});

test('summarizeObserved counts stores and brands, with name fallback and unbranded stores kept out of brands', () => {
  const elements = [
    { tags: { brand: 'Zudio', shop: 'clothes' } },
    { tags: { name: 'Zudio Rajajinagar', shop: 'clothes' } },
    { tags: { name: 'Zudio Koramangala', shop: 'clothes' } },
    { tags: { brand: 'Bata', shop: 'shoes' } },
    { tags: { name: 'Local Tailor', amenity: 'tailor' } }
  ];
  const summary = summarizeObserved(elements, ['Zudio', 'Bata', 'Allen Solly']);
  assert.equal(summary.totalStores, 5);
  assert.equal(summary.brandedStores, 4);
  assert.deepEqual(summary.categories, { clothes: 3, shoes: 1, tailor: 1 });
  assert.deepEqual(summary.brands.map(b => [b.name, b.count]), [['Zudio', 3], ['Bata', 1]]);
});

test('summarizeObserved sorts brands by count descending, then by name', () => {
  const elements = [
    { tags: { brand: 'Zudio' } },
    { tags: { brand: 'Bata' } }, { tags: { brand: 'Bata' } },
    { tags: { brand: 'Allen Solly' } }, { tags: { brand: 'Allen Solly' } }
  ];
  const summary = summarizeObserved(elements, []);
  assert.deepEqual(summary.brands.map(b => [b.name, b.count]), [['Allen Solly', 2], ['Bata', 2], ['Zudio', 1]]);
});

test('shapeResearched drops rows without a valid 1-based sourceIndex and attaches the citation', () => {
  const rows = shapeResearched({ competitors: [
    { name: 'Zudio', sourceIndex: 2 },
    { name: 'NoSource' },
    { name: 'OutOfRange', sourceIndex: 3 },
    { name: 'Zero', sourceIndex: 0 },
    { name: 'Fraction', sourceIndex: 1.5 },
    { name: '   ', sourceIndex: 1 }
  ] }, citations);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Zudio');
  assert.deepEqual(rows[0].citation, citations[1]);
});

test('shapeResearched whitelists priceTier and presence values and nulls anything else', () => {
  const [bad] = shapeResearched({ competitors: [{ name: 'Max', sourceIndex: 1, priceTier: 'cheap', presence: 'everywhere', parent: '  ', format: 'mall store' }] }, citations);
  assert.equal(bad.priceTier, null);
  assert.equal(bad.presence, null);
  assert.equal(bad.parent, null);
  assert.equal(bad.format, 'mall store');
  const [good] = shapeResearched({ competitors: [{ name: 'Bata', sourceIndex: 1, priceTier: 'mid', presence: 'city' }] }, citations);
  assert.equal(good.priceTier, 'mid');
  assert.equal(good.presence, 'city');
});

test('shapeResearched caps the result at 10 competitors and tolerates a missing payload', () => {
  const competitors = Array.from({ length: 12 }, (_, i) => ({ name: `Brand ${i}`, sourceIndex: 1 }));
  assert.equal(shapeResearched({ competitors }, citations).length, 10);
  assert.deepEqual(shapeResearched(null, citations), []);
});

// Fake pool: routes on SQL text and returns canned rows.
const GEO = { kind: 'district', external_id: 'IN-KA-BLR-U', name: 'Bengaluru Urban', properties: { district: 'Bengaluru Urban', state: 'Karnataka' }, geometry: { type: 'Polygon', coordinates: [square] } };
const STORES = [{ name: 'Zudio Rajajinagar', brand: null, category: 'clothes' }, { name: 'Bata Malleswaram', brand: 'Bata', category: 'shoes' }];
const RESEARCH_TEXT = '{"competitors":[{"name":"Zudio","presence":"in area","priceTier":"value","sourceIndex":1}]}';

function fakePool({ geo = [GEO], cached = [], snapshot = true, stores = STORES } = {}) {
  const sqls = [];
  return {
    sqls,
    async query(sql) {
      sqls.push(sql);
      if (sql.includes('CREATE TABLE')) return { rows: [] };
      if (sql.includes('SELECT result, computed_at')) return { rows: cached };
      if (sql.includes('ST_AsGeoJSON')) return { rows: geo };
      if (sql.includes('to_regclass')) return { rows: [{ ok: snapshot }] };
      if (sql.includes('max(retrieved_at)')) return { rows: [{ retrieved_at: '2026-10-01T00:00:00Z', n: stores.length }] };
      if (sql.includes('ST_Intersects')) return { rows: stores };
      return { rows: [] };
    }
  };
}

const noFetch = async () => { throw new Error('fetch should not be called'); };
const quiet = { error() {} };
const research = (overrides = {}) => ({ generate: async () => ({ ok: true, text: RESEARCH_TEXT, citations: [{ title: 't', url: 'https://example.com' }], retrievedAt: '2026-10-26T00:00:00Z' }), parseJson: JSON.parse, ...overrides });
function service(pool, options = {}) {
  return createCompetitorService({ pool, sectors: createSectorRegistry(), fetchImpl: noFetch, now: () => new Date('2026-10-26T00:00:00Z'), logger: quiet, ...options });
}
const request = { geographyId: GEO.external_id, sectorId: 'apparel' };

test('getCompetitors rejects an unknown geography with status 404', async () => {
  await assert.rejects(service(fakePool({ geo: [] })).getCompetitors(request), { status: 404, message: 'Unknown geography' });
});

test('getCompetitors takes observed stores from the snapshot without calling Overpass', async () => {
  const result = await service(fakePool(), { research: null }).getCompetitors(request);
  assert.equal(result.observed.source, 'OpenStreetMap snapshot (Overpass API)');
  assert.equal(result.observed.totalStores, 2);
  assert.deepEqual(result.observed.brands.map(b => b.name), ['Bata', 'Zudio']);
  assert.equal(result.cached, false);
});

test('getCompetitors attaches researched competitors and flags those seen in the snapshot', async () => {
  const result = await service(fakePool(), { research: research() }).getCompetitors(request);
  assert.equal(result.majorCompetitors[0].name, 'Zudio');
  assert.equal(result.majorCompetitors[0].observedInArea, true);
  assert.equal(result.majorCompetitors[0].evidenceClass, 'derived_estimate');
  assert.equal(result.citations.length, 1);
});

test('getCompetitors warns when research is not configured and does not cache the answer', async () => {
  const pool = fakePool();
  const result = await service(pool, { research: {} }).getCompetitors(request);
  assert.deepEqual(result.warnings, ['Competitor research is not configured on the server.']);
  assert.equal(pool.sqls.some(sql => sql.includes('INSERT INTO market_area_competitors')), false);
});

test('concurrent requests for the same geography and sector share one computation', async () => {
  let calls = 0;
  const slow = research({ generate: async () => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 20));
    return { ok: true, text: RESEARCH_TEXT, citations: [{ title: 't', url: 'https://example.com' }] };
  } });
  const svc = service(fakePool(), { research: slow });
  const [first, second] = await Promise.all([svc.getCompetitors(request), svc.getCompetitors(request)]);
  assert.equal(calls, 1);
  assert.equal(first.majorCompetitors[0].name, 'Zudio');
  assert.equal(second.majorCompetitors[0].name, 'Zudio');
});

test('getCompetitors returns a cached row with cached:true and skips research', async () => {
  const stored = { geographyId: GEO.external_id, name: 'Bengaluru Urban', majorCompetitors: [{ name: 'Bata' }], warnings: [] };
  let calls = 0;
  const svc = service(fakePool({ cached: [{ result: stored, computed_at: '2026-10-20T00:00:00Z' }] }), { research: research({ generate: async () => { calls++; } }) });
  const result = await svc.getCompetitors(request);
  assert.equal(result.cached, true);
  assert.equal(result.majorCompetitors[0].name, 'Bata');
  assert.equal(calls, 0);
});

test('brand names in shop names match whole words only', () => {
  const { summarizeObserved } = require('../server/market-competitors.cjs');
  const result = summarizeObserved([{ tags: { shop: 'clothes', name: 'Maxim Fashions' } }, { tags: { shop: 'clothes', name: 'Max Fashion Jayanagar' } }, { tags: { shop: 'clothes', name: 'H&M Phoenix' } }], ['Max', 'H&M']);
  assert.deepEqual(result.brands.map(b => [b.name, b.count]), [['H&M', 1], ['Max', 1]]);
  assert.equal(result.brandCounts.max, 1);
});

test('researched competitors are matched to citations through grounding supports', () => {
  const { shapeResearched } = require('../server/market-competitors.cjs');
  const citations = [{ url: 'https://a.example/stores', title: 'a.example' }, { url: 'https://b.example/zudio-bengaluru', title: 'b.example' }];
  const rows = shapeResearched({ competitors: [{ name: 'Westside' }, { name: 'Zudio' }, { name: 'Unbacked Brand' }] }, citations,
    [{ text: 'Westside operates a store on Rajajinagar main road.', urls: ['https://a.example/stores'] }]);
  assert.deepEqual(rows.map(r => [r.name, r.citation.url]), [['Westside', 'https://a.example/stores'], ['Zudio', 'https://b.example/zudio-bengaluru']]);
});

test('without any citations only known sector brands are shown, labelled unverified', async () => {
  const { createCompetitorService } = require('../server/market-competitors.cjs');
  const { createSectorRegistry } = require('../server/market-sectors.cjs');
  const pool = { async query(sql) {
    if (/CREATE TABLE/.test(sql)) return { rows: [] };
    if (/FROM market_area_competitors/.test(sql)) return { rows: [] };
    if (/FROM market_geographies WHERE external_id/.test(sql)) return { rows: [{ kind: 'pin', external_id: 'pin:560058', name: '560058', properties: { state: 'Karnataka' }, geometry: null }] };
    if (/to_regclass/.test(sql)) return { rows: [{ ok: false }] };
    return { rows: [] };
  } };
  const research = { generate: async () => ({ ok: true, text: '{"competitors":[{"name":"Zudio"},{"name":"Made Up Mart"}]}', citations: [], supports: [] }), parseJson: JSON.parse };
  const service = createCompetitorService({ pool, research, sectors: createSectorRegistry(), fetchImpl: async () => { throw new Error('no network'); }, logger: { error() {} } });
  const result = await service.getCompetitors({ geographyId: 'pin:560058', sectorId: 'apparel' });
  assert.deepEqual(result.majorCompetitors.map(c => [c.name, c.evidenceClass]), [['Zudio', 'model_assumption']]);
  assert.ok(result.warnings.some(w => /not verified/.test(w)));
});
