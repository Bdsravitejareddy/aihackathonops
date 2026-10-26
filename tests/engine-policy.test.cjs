'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../dist/engine.js');

const base = { id: 'APP-001', name: 'Ravi', city: 'Mysuru', state: 'Karnataka', pin: '570001', investment: 25, experience: 4, business: 'Runs a footwear store', space: 'Rented', area: 450, floor: 'Ground', launch: 3, language: 'Kannada', notes: '' };
const norm = (x = {}, i = 0) => E.normalize({ ...base, ...x }, 'row-' + i);
const territories = [
  { id: 'TER-01', city: 'Mysuru', state: 'Karnataka', pins: ['570001', '570002'], slots: 2, priority: 'High' },
  { id: 'TER-02', city: 'Tumakuru', state: 'Karnataka', pins: ['572101'], slots: 1, priority: 'Low' }
];
const reference = { all: {}, tiers: {} };
const policy = (over = {}) => ({ ...E.defaultPolicy, ...over });
const run = (apps, settings = E.defaultPolicy) => E.assess(apps, territories, [], reference, settings);

test('default weights reproduce the published 35/15/15/20/5/10 scoring', () => {
  const r = run([norm()])[0];
  // 25/30 funds × 35 + premises 15 + area 15 + 3-<5 years 15 + business 5 + launch in window 10
  assert.equal(r.score, +(25 / 30 * 35 + 15 + 15 + 15 + 5 + 10).toFixed(1));
  assert.deepEqual(r.components.map(c => c.weight), [35, 15, 15, 20, 5, 10]);
  assert.equal(r.grade, 'A');
});

test('custom weights and grade bands change the score and grade', () => {
  const weights = { investment: 60, space: 10, area: 10, experience: 10, business: 5, launch: 5 };
  const r = run([norm()], policy({ weights, grades: { A: 95, B: 85, C: 70 } }))[0];
  assert.equal(r.score, +(25 / 30 * 60 + 10 + 10 + 7.5 + 5 + 5).toFixed(1));
  assert.equal(r.grade, 'B');
  assert.match(r.components.find(c => c.key === 'experience').detail, /3–under 5 years 7.5/);
});

test('a zero-weight criterion with unknown data does not make the grade unknown', () => {
  const blankBusiness = norm({ business: 'Friend helps' });
  assert.equal(run([blankBusiness])[0].grade, 'U');
  const zeroed = { investment: 40, space: 15, area: 15, experience: 20, business: 0, launch: 10 };
  assert.notEqual(run([blankBusiness], policy({ weights: zeroed }))[0].grade, 'U');
});

test('allowed city tiers and PIN prefixes are hard filters with a stated reason', () => {
  const apps = [norm({ investment: 40 }), norm({ id: 'APP-002', city: 'Tumakuru', pin: '572101', investment: 40 }, 1)];
  const tiers = run(apps, policy({ allowedTiers: ['Tier 1', 'Tier 2'] }));
  assert.equal(tiers[1].status, 'Requirements not met');
  assert.match(tiers[1].reasons.join(' '), /Tier 3; the screening policy only accepts Tier 1, Tier 2/);
  assert.equal(tiers[0].status, 'Recommended');
  const prefix = run(apps, policy({ pinPrefixes: ['572'] }));
  assert.equal(prefix[0].status, 'Requirements not met');
  assert.match(prefix[0].reasons.join(' '), /outside the targeted prefixes \(572\)/);
  assert.equal(prefix[1].status, 'Recommended');
  assert.deepEqual(E.resolvePolicy({ pinPrefixes: '570, 572;570' }).pinPrefixes, ['570', '572']);
});

test('policy validation rejects weights not totalling 100, inverted grades, no tiers and bad prefixes', () => {
  assert.deepEqual(E.policyErrors(E.defaultPolicy), []);
  assert.match(E.policyErrors(policy({ weights: { ...E.defaultPolicy.weights, investment: 40 } })).join(' '), /total 100/);
  assert.match(E.policyErrors(policy({ weights: { ...E.defaultPolicy.weights, investment: -5, launch: 50 } })).join(' '), /zero or more/);
  assert.match(E.policyErrors(policy({ grades: { A: 60, B: 65, C: 50 } })).join(' '), /decrease/);
  assert.match(E.policyErrors(policy({ allowedTiers: [] })).join(' '), /at least one city tier/);
  assert.match(E.policyErrors(policy({ pinPrefixes: ['57a'] })).join(' '), /1 to 6 digits/);
});

test('weight rebalancing keeps whole points that total 100', () => {
  let w = { ...E.defaultPolicy.weights };
  for (let i = 0; i < 120; i++) {
    const key = E.scoreKeys[i % E.scoreKeys.length], value = (i * 41) % 101;
    w = E.rebalanceWeights(w, key, value);
    assert.equal(Object.values(w).reduce((t, v) => t + v, 0), 100);
    assert.equal(w[key], value);
  }
  assert.deepEqual(E.policyErrors(policy({ weights: w })), []);
});

test('compareResults lists applicants whose status, grade or score changed', () => {
  const apps = [norm(), norm({ id: 'APP-002', investment: 40, pin: '570002' }, 1)];
  const before = run(apps), after = run(apps, policy({ minInvestment: 20 }));
  const changes = E.compareResults(before, after);
  assert.deepEqual(changes.map(c => c.id), ['APP-001']);
  assert.deepEqual(changes[0].status, ['Requirements not met', 'Recommended']);
});

test('workspace validation accepts policy and sector settings and rejects unknown shapes', () => {
  const a1 = norm();
  const state = settings => ({ apps: [a1], territories, reference: E.benchmarks([a1]), source: 'x.xlsx', settings, tasks: {}, taskDates: {}, audit: [], warnings: [] });
  assert.equal(E.validState(state({ ...E.defaultPolicy, sector: 'coffee-cafes', sectorName: 'Coffee cafés', sectorVersion: 2, pinPrefixes: ['560'] })), true);
  assert.equal(E.validState(state({ ...E.defaultPolicy, weights: { evil: 1 } })), false);
  assert.equal(E.validState(state({ ...E.defaultPolicy, sector: '<img src=x>' })), false);
  assert.equal(E.validState(state({ ...E.defaultPolicy, allowedTiers: ['Tier 9'] })), false);
  assert.equal(E.validState(state({ ...E.defaultPolicy, unexpected: 'x' })), false);
});

test('a plain rupee figure is proposed as lakh instead of being accepted as crore-sized capacity', () => {
  const r = norm({ investment: 2500000 });
  assert.equal(r.investment, null);
  assert.equal(r.pending[0].proposed, 25);
  assert.equal(E.parseNumber('investment', 1200).value, 1200, 'a plain lakh figure is accepted');
  assert.equal(E.parseNumber('investment', '₹25,00,000').proposed, 25);
  assert.equal(E.parseNumber('investment', '1.5 Cr').proposed, 150);
});

test('zero open slots says so instead of claiming provisional recommendations', () => {
  const r = E.assess([norm({ investment: 40 })], [{ ...territories[0], slots: 0 }], [], reference, E.defaultPolicy)[0];
  assert.equal(r.status, 'Waitlisted');
  assert.match(r.reasons.join(' '), /no open slots/);
});
