'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createHandler } = require('../server/app.cjs');

test('forecast API performs deterministic market scenarios on the local server', async () => {
  const handler = createHandler({ store: { load: async () => null, save: async () => 1 } });
  const req = Readable.from([Buffer.from(JSON.stringify({
    store: { initialInvestment: 1000000, workingCapital: 100000, areaSqFt: 1000, monthlyFixedCosts: 100000, grossMargin: 0.5, royaltyRate: 0.05, aov: 1000, monthlyPassingPedestrianTraffic: 30000, entryRate: 1 / 3, trafficEvidenceClass: 'model_assumption', conversionRate: 0.1, salesRampMonths: 6, initialRampFraction: 0.5 },
    market: { samAnnual: 50000000 }, forecast: { years: 5, annualNominalGrowth: 0.05, annualInflation: 0.04, discountRate: 0.12 }
  }))]);
  req.method = 'POST'; req.url = '/api/market/forecast'; req.headers = { host: '127.0.0.1:8080', 'content-type': 'application/json' };
  let status, body;
  await handler(req, { writeHead(code) { status = code; }, setHeader() {}, end(value) { body = value; } });
  const result = JSON.parse(body);
  assert.equal(status, 200);
  assert.equal(result.economics.scenarios.base.months.length, 60);
  assert.equal(result.economics.footfall.evidenceClass, 'model_assumption');
});

test('forecast API rejects malformed economics and keeps localhost restriction', async () => {
  const handler = createHandler({ store: { load: async () => null, save: async () => 1 } });
  async function call(host, payload) {
    const req = Readable.from([Buffer.from(JSON.stringify(payload))]); req.method = 'POST'; req.url = '/api/market/forecast'; req.headers = { host, 'content-type': 'application/json' };
    let status; await handler(req, { writeHead(code) { status = code; }, setHeader() {}, end() {} }); return status;
  }
  assert.equal(await call('127.0.0.1:8080', { store: {} }), 400);
  assert.equal(await call('example.com', {}), 403);
});
