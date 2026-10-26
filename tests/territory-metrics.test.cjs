'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { parsePins, aggregateTerritory, pinRow, territoryMetrics } = require('../server/territory-metrics.cjs');
const { createHandler } = require('../server/app.cjs');
const { analyzeLocation } = require('../server/market-analysis.cjs');

const pinGeography = (pin, district, population, spend) => ({ id: `pin:${pin}`, name: `PIN ${pin}`, level: 'pin', state: 'Karnataka', district, parentId: `district:IN-KA-${district.toLowerCase()}`,
  demographics: { urbanShare: 1 }, metrics: { population: { value: population, unit: 'people', evidenceClass: 'derived_estimate' }, apparelExpenditure: { value: spend, unit: 'INR/year', evidenceClass: 'derived_estimate' } } });
const geographies = {
  'pin:560101': pinGeography('560101', 'Bangalore', 40000, 2.4e9),
  'pin:560102': pinGeography('560102', 'Bangalore', 60000, 3.6e9),
  'pin:560103': { ...pinGeography('560103', 'Bangalore', null, null), metrics: {} }
};
const loadGeography = async id => geographies[id] ?? null;

test('PIN lists are validated: six digits, unique, at most 30', () => {
  assert.deepEqual(parsePins('560101,560101, 560102'), ['560101', '560102']);
  assert.throws(() => parsePins(''), /six-digit/);
  assert.throws(() => parsePins('56010'), /six-digit/);
  assert.throws(() => parsePins(Array.from({ length: 31 }, (_, i) => String(560000 + i)).join(',')), /1–30/);
});

test('a PIN row carries the same population, spend and analysis values as the map and the Analysis panel', async () => {
  const row = pinRow('560101', geographies['pin:560101']);
  assert.equal(row.population.value, 40000);
  assert.equal(row.apparelExpenditure.value, 2.4e9);
  const analysis = analyzeLocation({ geography: geographies['pin:560101'] });
  assert.equal(row.analysis.investment.mid, analysis.scenarios.mid.investment);
  assert.equal(row.analysis.paybackMonths.base, analysis.scenarios.mid.paybackMonths);
  assert.equal(row.analysis.tierClass, 'X');
  assert.equal(pinRow('999999', null).status, 'not_found');
});

test('catchment and TAM sum only PINs with data; missing PINs are counted, not zero', async () => {
  const { pins, aggregate } = await territoryMetrics({ pins: ['560101', '560102', '560103'], slots: 2, loadGeography });
  assert.equal(pins.length, 3);
  assert.equal(aggregate.catchmentPopulation.value, 100000);
  assert.equal(aggregate.catchmentPopulation.pinsWithData, 2);
  assert.equal(aggregate.catchmentPopulation.pinsTotal, 3);
  assert.equal(aggregate.tam.value, 6e9);
  assert.match(aggregate.method[0], /without data are counted as missing/);
});

test('investment counts one store per PIN up to the open slots, fastest base-case payback first', async () => {
  const { aggregate } = await territoryMetrics({ pins: ['560101', '560102'], slots: 1, loadGeography });
  const payback = pin => analyzeLocation({ geography: geographies[`pin:${pin}`] }).scenarios.mid.paybackMonths ?? Infinity;
  const fastest = payback('560101') <= payback('560102') ? '560101' : '560102';
  assert.equal(aggregate.investment.stores, 1);
  assert.deepEqual(aggregate.investment.pins, [fastest]);
  assert.equal(aggregate.payback.best.pin, fastest);
  assert.equal(aggregate.investment.mid, analyzeLocation({ geography: geographies[`pin:${fastest}`] }).scenarios.mid.investment);
});

test('a territory with zero open slots counts no investment and says so', async () => {
  const { aggregate } = await territoryMetrics({ pins: ['560101', '560102'], slots: 0, loadGeography });
  assert.equal(aggregate.openSlots, 0);
  assert.equal(aggregate.investment, null);
  assert.equal(aggregate.payback, null);
  assert.equal(aggregate.catchmentPopulation.value, 100000, 'catchment is still shown for the territory');
  assert.match(aggregate.method[1], /No open slots/);
});

test('aggregate of no analysable PIN has no investment or payback', () => {
  const agg = aggregateTerritory([{ pin: '1', status: 'not_found', population: null, apparelExpenditure: null, analysis: null }], 2);
  assert.equal(agg.investment, null);
  assert.equal(agg.payback, null);
});

test('the territory metrics endpoint validates pins and slots, and accepts zero slots', async () => {
  const handler = createHandler({ store: { load: async () => null, save: async () => 1 }, marketMapStore: { getMapGeography: async id => geographies[id] ?? null, listMapGeographies: async () => [] }, marketLocationData: { resolvePin: () => null } });
  async function call(url) {
    const req = Readable.from([]); req.method = 'GET'; req.url = url; req.headers = { host: '127.0.0.1:8080' };
    let status, body; await handler(req, { writeHead(code) { status = code; }, setHeader() {}, end(value) { body = value; } });
    return { status, body: body ? JSON.parse(body) : null };
  }
  assert.equal((await call('/api/territories/metrics?pins=560101,560102&slots=0')).status, 200);
  assert.equal((await call('/api/territories/metrics?pins=560101&slots=-1')).status, 400);
  assert.equal((await call('/api/territories/metrics?pins=560101&slots=1.5')).status, 400);
  assert.equal((await call('/api/territories/metrics?pins=abc')).status, 400);
  assert.equal((await call('/api/territories/metrics')).status, 400);
  const ok = await call('/api/territories/metrics?pins=560101&slots=2');
  assert.equal(ok.body.aggregate.investment.stores, 1);
});
