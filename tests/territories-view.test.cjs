'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const dist = file => fs.readFileSync(path.join(__dirname, '..', 'dist', file), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 10));

function setup(metricsFor) {
  const dom = new JSDOM('<div id="root"></div>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.eval(dist('display-format.js'));
  window.eval(dist('territory-economics.js'));
  window.eval(dist('territories-view.js'));
  const territories = [
    { id: 'TER-01', city: 'Bengaluru', state: 'Karnataka', tier: 'Tier 1', pins: ['560101', '560102'], slots: 2, priority: 'High', issues: [] },
    { id: 'TER-02', city: 'Mysuru', state: 'Karnataka', tier: 'Tier 2', pins: ['570101'], slots: 0, priority: 'Medium', issues: [] }
  ];
  const applications = [
    { key: 'a1', id: 'APP-1', name: 'Low scorer', territory: 'TER-01', pin: '560101', score: 52, grade: 'C', status: 'Clarification needed' },
    { key: 'a2', id: 'APP-2', name: 'Top scorer', territory: 'TER-01', pin: '560101', score: 91, grade: 'A', status: 'Recommended' },
    { key: 'a3', id: 'APP-3', name: 'Other PIN', territory: 'TER-01', pin: '560102', score: 70, grade: 'B', status: 'Waitlisted' }
  ];
  const fetch = async url => ({ ok: true, json: async () => metricsFor(url) });
  const view = window.TerritoriesView.mount({ container: window.document.getElementById('root'), territories, applications, stores: [['ST-01', 'Bengaluru', '560001', 2019]], fetch });
  return { window, doc: window.document, view };
}

const metricsBody = url => {
  const pins = new URL(url, 'http://x').searchParams.get('pins').split(',');
  const slots = new URL(url, 'http://x').searchParams.get('slots');
  const rows = pins.map((pin, i) => ({ pin, id: `pin:${pin}`, status: 'available', name: `PIN ${pin}`, population: { value: 40000 * (i + 1) }, apparelExpenditure: { value: 2.4e9 }, potentialRevenue: null,
    analysis: { tier: 'Tier 1 (HRA X)', tierClass: 'X', investment: { low: 6e6, mid: 8e6, high: 12e6 }, paybackMonths: { downside: 40, base: 30, upside: 18 }, roi5YearPercent: 40, annualRevenue: 1e7, revenueConstraint: 'demand_limited', revenueBasis: 'potentialRevenue', evidenceClass: 'derived_estimate' } }));
  const openSlots = slots === null ? null : Number(slots);
  const aggregate = { openSlots, catchmentPopulation: { value: rows.reduce((t, r) => t + r.population.value, 0), pinsWithData: rows.length, pinsTotal: rows.length },
    tam: { value: 2.4e9 * rows.length, pinsWithData: rows.length, pinsTotal: rows.length },
    investment: openSlots === 0 ? null : { low: 6e6, mid: 8e6, high: 12e6, stores: openSlots ?? rows.length, pins: rows.map(r => r.pin) },
    payback: openSlots === 0 ? null : { best: { pin: rows[0].pin, downside: 40, base: 30, upside: 18 } }, method: [] };
  return { pins: rows, aggregate };
};

test('territory cards render with an even layout, a summary cell and the No open slots state', async () => {
  const { doc, view } = setup(metricsBody);
  await tick();
  const cards = doc.querySelectorAll('.te-grid > section');
  assert.equal(cards.length, 3, 'two territories and the summary cell');
  assert.ok(doc.querySelector('.te-summary'));
  const full = doc.querySelector('[data-territory="TER-02"]');
  assert.match(full.textContent, /No open slots/);
  assert.match(full.textContent, /no store investment is counted/);
  assert.doesNotMatch(doc.querySelector('[data-territory="TER-01"]').textContent, /No open slots/);
  view.destroy();
});

test('KPI cards fill from the endpoint: catchment, TAM, investment and payback per territory', async () => {
  const { doc, view } = setup(metricsBody);
  await tick();
  const kpis = doc.querySelector('[data-te-kpis="TER-01"]');
  assert.match(kpis.textContent, /Residents/);
  assert.match(kpis.textContent, /120K|1\.2 ?L|120,000/);
  assert.match(kpis.textContent, /Investment required/);
  assert.match(kpis.textContent, /₹8M/);
  assert.match(kpis.textContent, /Range/);
  const zero = doc.querySelector('[data-te-kpis="TER-02"]');
  assert.match(zero.textContent, /No open slots/);
  view.destroy();
});

test('city expands to PINs, and each PIN expands to its applications ranked by score', async () => {
  const { doc, view } = setup(metricsBody);
  await tick();
  const cityBody = doc.querySelector('[data-te-body="t:TER-01"]');
  const cityToggle = doc.querySelector('[data-te-toggle="t:TER-01"]');
  assert.equal(cityBody.dataset.open, 'false');
  assert.equal(cityToggle.getAttribute('aria-expanded'), 'false');
  cityToggle.click();
  assert.equal(cityBody.dataset.open, 'true');
  assert.equal(cityToggle.getAttribute('aria-expanded'), 'true');
  const pinBody = doc.querySelector('[data-te-body="p:TER-01:560101"]');
  doc.querySelector('[data-te-toggle="p:TER-01:560101"]').click();
  assert.equal(pinBody.dataset.open, 'true');
  const names = [...pinBody.querySelectorAll('.te-app-name')].map(el => el.textContent.trim());
  assert.deepEqual(names, ['Top scorer ↗', 'Low scorer ↗'], 'ranked by score, not by input order');
  assert.match(pinBody.textContent, /Score\s*91/);
  assert.match(pinBody.textContent, /Grade A/);
  assert.match(pinBody.textContent, /Recommended/);
  assert.equal(pinBody.querySelector('[data-detail]').dataset.detail, 'a2');
  // Collapsing the city keeps the PIN state, so re-opening shows the PIN still open.
  cityToggle.click();
  assert.equal(cityBody.dataset.open, 'false');
  cityToggle.click();
  assert.equal(pinBody.dataset.open, 'true');
  view.destroy();
});

test('a failed metrics request shows a message and leaves the applications usable', async () => {
  const { doc, view } = setup(() => { throw new Error('boom'); });
  await tick();
  assert.match(doc.querySelector('[data-te-kpis="TER-01"]').textContent, /Market figures are unavailable/);
  doc.querySelector('[data-te-toggle="t:TER-01"]').click();
  assert.ok(doc.querySelector('[data-te-body="p:TER-01:560101"] .te-app-name'));
  view.destroy();
});
