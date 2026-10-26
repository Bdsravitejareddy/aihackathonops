'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkGuardrails } = require('../dist/guardrails.js');

const stores = [{ pin: '560034' }, { pin: '570009' }];
const base = { id: 'APP-1', name: 'Asha Rao', city: 'Mysuru', state: 'Karnataka', pin: '570001', investment: 30, experience: 3, business: 'Runs a garment boutique', space: 'Rented', area: 450, floor: 'Ground', launch: 4, notes: null, pending: [] };
const app = (over, i = 1) => ({ ...base, key: `k${i}`, ...over });
const territory = over => ({ id: 'TER-01', city: 'Mysuru', pins: ['570001', '570002'], slots: 1, ...over });
const kinds = flags => flags.map(f => f.kind);

test('a clean application inside a territory raises no checks', () => {
  assert.deepEqual(checkGuardrails({ apps: [app({})], territories: [territory({})], stores }), []);
});

test('missing required fields are one high flag listing every field, ignoring fields awaiting a correction', () => {
  const [flag] = checkGuardrails({ apps: [app({ name: null, investment: null, experience: null, pending: [{ field: 'experience' }] })], territories: [territory({})], stores });
  assert.equal(flag.kind, 'missing'); assert.equal(flag.severity, 'high');
  assert.match(flag.message, /Applicant name, Investment capacity\./);
});

test('PIN checks: city prefix mismatch (also outside every territory), existing store, and no territory', () => {
  const flags = checkGuardrails({ apps: [app({ name: 'Asha Rao', pin: '560058' }, 1), app({ name: 'Bala Iyer', pin: '570009' }, 2), app({ name: 'Chitra Pai', pin: '570099' }, 3)], territories: [territory({})], stores });
  assert.deepEqual(flags.map(f => `${f.subject.key}:${f.kind}`).sort(), ['k1:city-pin', 'k1:no-territory', 'k2:existing-store', 'k3:no-territory']);
});

test('unusual values are flagged as outliers', () => {
  const flags = checkGuardrails({ apps: [app({ investment: 0 }, 1), app({ investment: 500 }, 2), app({ area: 60 }, 3), app({ launch: 36 }, 4), app({ launch: 0 }, 5)], territories: [territory({})], stores });
  assert.equal(flags.filter(f => f.kind === 'outlier').length, 5);
  assert.equal(flags.find(f => f.subject.id && f.message.includes('₹0 lakh')).severity, 'high');
});

test('contradictions between fields and with the notes', () => {
  const flags = checkGuardrails({ apps: [
    app({ space: 'Not yet identified', area: 500 }, 1),
    app({ space: 'Owned', area: null }, 2),
    app({ experience: 0, business: 'Ran an apparel store for 10 years' }, 3),
    app({ experience: 0, business: 'Runs a beauty parlour' }, 4),
    app({ investment: 20, notes: 'Can invest up to 50 lakh with family support' }, 5)
  ], territories: [territory({})], stores });
  const contradictions = flags.filter(f => f.kind === 'contradiction').map(f => f.subject.key).sort();
  assert.deepEqual(contradictions, ['k1', 'k2', 'k3', 'k5']);
});

test('possible duplicates, contested PINs, overlapping and zero-slot territories', () => {
  const apps = [app({ id: 'APP-1' }, 1), app({ id: 'APP-2', name: 'asha  rao' }, 2), app({ id: 'APP-3', name: 'Someone Else' }, 3)];
  const flags = checkGuardrails({ apps, territories: [territory({}), territory({ id: 'TER-02', pins: ['570002'], slots: 0 })], stores });
  assert.equal(flags.filter(f => f.kind === 'duplicate').length, 2);
  assert.ok(flags.some(f => f.kind === 'contested' && f.subject.pin === '570001'));
  assert.ok(flags.some(f => f.kind === 'overlap' && f.subject.pin === '570002'));
  assert.ok(flags.some(f => f.kind === 'no-slots' && f.subject.id === 'TER-02'));
});

test('flags are ordered high, medium, low', () => {
  const flags = checkGuardrails({ apps: [app({ space: 'Owned', area: null }, 1), app({ pin: '560058' }, 2), app({ launch: 30 }, 3)], territories: [territory({})], stores });
  const rank = { high: 0, medium: 1, low: 2 };
  assert.deepEqual(flags.map(f => rank[f.severity]), [...flags.map(f => rank[f.severity])].sort());
});
