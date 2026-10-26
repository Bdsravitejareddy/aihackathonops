'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const Chat = require('../dist/chat-widget.js');
const tick = () => new Promise(resolve => setImmediate(resolve));

const results = [
  { key: 'a', id: 'APP-001', name: 'Asha', status: 'Recommended', category: 'Recommended', score: 81, high: 84, grade: 'A', territory: 'T1', reasons: ['Strong capital'] },
  { key: 'b', id: 'APP-002', name: 'Ben', status: 'Clarification needed', category: 'Data required', score: 52, high: 70, grade: 'C', territory: 'T1', reasons: ['Missing area'] },
  { key: 'c', id: 'APP-003', name: 'Chen', status: 'Site needed', category: 'Data required', score: 66, high: 66, grade: 'B', territory: 'T2', reasons: [] }
];
const state = { apps: [{ key: 'a', pending: [] }, { key: 'b', pending: [{ field: 'area' }] }], territories: [{ id: 'T1' }, { id: 'T2' }], settings: { model: 'industry-v2', minInvestment: 50, minArea: 800, minLaunch: 6, targetLaunch: 12, sectorName: 'Apparel' }, source: 'Synthetic demo · 3 applicants' };
const location = { id: 'pin:560058', name: '560058', level: 'pin', metrics: { potentialRevenue: { value: 176172949, unit: 'INR/year', evidenceClass: 'derived_estimate' }, population: { value: 120000, unit: 'people' } } };

function dom(html) {
  const window = new JSDOM(`<!doctype html><body><div id="main">${html}</div></body>`, { url: 'http://localhost/' }).window;
  return window.document;
}

test('overview snapshot carries pipeline counts and the workbook source, not the whole page', () => {
  const ctx = Chat.buildPageContext({ tab: 'overview', state, results, stores: [], doc: dom('<h1>Overview</h1>') });
  const byLabel = Object.fromEntries(ctx.facts.map(f => [f.label, f.value]));
  assert.equal(ctx.page, 'overview');
  assert.equal(byLabel['Total applications'], '3');
  assert.equal(byLabel['Recommended partners'], '1');
  assert.equal(byLabel['Data required'], '2');
  assert.equal(byLabel['Pending data corrections'], '1');
  assert.equal(byLabel['Data source'], 'Synthetic demo · 3 applicants');
  assert.ok(ctx.facts.length <= 24, 'snapshot stays compact');
});

test('an application open in the drawer becomes the applicant in view with its reasons', () => {
  const doc = dom('<h1>Applications</h1><div id="overlay"><section class="drawer"><span class="eyebrow">APP-002 · Pune</span></section></div>');
  doc.querySelector('#overlay').hidden = false;
  const ctx = Chat.buildPageContext({ tab: 'applications', state, results, doc });
  assert.equal(ctx.applicant.id, 'APP-002');
  assert.equal(ctx.applicant.status, 'Clarification needed');
  assert.deepEqual(ctx.applicant.reasons, ['Missing area']);
  assert.ok(ctx.suggestions.some(q => /APP-002/.test(q)), 'suggested questions change with the applicant in view');
});




test('rule answer is used first when it is specific', async () => {
  const ctx = Chat.buildPageContext({ tab: 'overview', state, results, doc: dom('') });
  const bot = { answer: () => ({ text: 'APP-001 is recommended because capital is strong.', contextKey: 'a' }) };
  const fetched = [];
  const reply = await Chat.answer('Why is APP-001 recommended?', { ctx, env: { state, results, stores: [] }, bot, fetch: async (...args) => { fetched.push(args); } });
  assert.equal(reply.source, 'rules'); assert.match(reply.text, /capital is strong/); assert.equal(fetched.length, 0);
});

test('a generic rule fallback falls through to what the page shows', async () => {
  const ctx = Chat.buildPageContext({ tab: 'overview', state, results, doc: dom('') });
  const bot = { answer: () => ({ text: 'I can explain the current workbook, scoring rules and more.' }) };
  const reply = await Chat.answer('How many applications are there?', { ctx, env: { state, results, stores: [] }, bot, fetch: async () => { throw new Error('should not call'); } });
  assert.equal(reply.source, 'page'); assert.match(reply.text, /Total applications: 3/);
});


test('open questions about a selected map area call the grounded /ask route with the area id and sources', async () => {
  const doc = dom('<div data-map-place-title>560058</div>');
  const ctx = Chat.buildPageContext({ tab: 'expansion', state, results, doc, location });
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body), method: init.method }); return { ok: true, status: 200, json: async () => ({ answer: 'Demand is strong for mass-market apparel.', citations: [{ title: 'Census', url: 'https://censusindia.gov.in/x' }, { title: 'bad', url: 'javascript:alert(1)' }], modelVersion: 'gemini-x' }) }; };
  const reply = await Chat.answer('Is this area good for a mass-market store?', { ctx, env: null, bot: { answer: () => ({ text: 'I can explain the current workbook.' }) }, fetch });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, '/api/market/map/geographies/pin%3A560058/ask');
  assert.match(calls[0].body.question, /mass-market/);
  assert.equal(reply.source, 'gemini'); assert.equal(reply.citations.length, 1, 'non-http citations are dropped');
});

test('when Gemini is unavailable the drawer says so and falls back to page facts, not invented text', async () => {
  const doc = dom('<div data-map-place-title>560058</div>');
  const ctx = Chat.buildPageContext({ tab: 'expansion', state, results, doc, location });
  const fetch = async () => ({ ok: false, status: 503, json: async () => ({ error: 'Research is not configured' }) });
  const reply = await Chat.answer('Who are the competitors nearby?', { ctx, env: null, bot: null, fetch });
  assert.equal(reply.source, 'notice'); assert.match(reply.text, /isn't available/); assert.match(reply.text, /Research is not configured/);
});

test('a network failure during Gemini answers with a notice rather than throwing', async () => {
  const doc = dom('<div data-map-place-title>560058</div>');
  const ctx = Chat.buildPageContext({ tab: 'expansion', state, results, doc, location });
  const reply = await Chat.answer('Should we open here?', { ctx, env: null, bot: null, fetch: async () => { throw new Error('offline'); } });
  assert.equal(reply.source, 'notice'); assert.match(reply.text, /offline/);
});

test('mount: launcher opens the drawer in place (no navigation), Esc closes and returns focus, history survives reload', async () => {
  const dom2 = new JSDOM(`<!doctype html><body><button class="bot-launcher">Ask</button><div id="main"><h1>Overview</h1></div></body>`, { url: 'http://localhost/#overview' });
  const { window } = dom2; const doc = window.document;
  global.window = window;
  const storage = { data: {}, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = v; } };
  const launcher = doc.querySelector('.bot-launcher');
  const replies = [];
  const bot = { answer: text => { replies.push(text); return { text: 'Rule reply for: ' + text }; } };
  const chat = Chat.mount({ launcher, provider: () => ({ tab: 'overview', state, results, stores: [], botContext: null }), doc, storage, fetch: async () => { throw new Error('none'); }, reducedMotion: true, bot });
  const hash = window.location.hash;
  launcher.click();
  assert.equal(chat.isOpen(), true); assert.equal(window.location.hash, hash, 'opening the drawer never navigates');
  assert.equal(launcher.getAttribute('aria-expanded'), 'true');
  assert.equal(doc.activeElement.id, 'fc-input', 'focus moves into the drawer');
  const drawer = doc.querySelector('#franchise-chat');
  assert.equal(drawer.getAttribute('role'), 'dialog');
  // Suggested chips come from the page and ask the bot.
  const chip = drawer.querySelector('[data-fc-ask]');
  assert.ok(chip, 'suggested questions render');
  await chat.ask('How many applications?');
  await tick(); await new Promise(r => setTimeout(r, 10)); await tick();
  assert.equal(chat.history().filter(m => m.role === 'user').length, 1);
  assert.ok(JSON.parse(storage.data['franchiseos-chat-widget-v1']).length >= 2, 'history is saved for the session');
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(chat.isOpen(), false); assert.equal(doc.activeElement, launcher, 'closing returns focus to the launcher');
  assert.equal(window.location.hash, hash);
  chat.destroy(); delete global.window;
});

test('drawer and launcher stay wired to the bot route in the app shell', () => {
  const html = read('dist/index.html'), app = read('dist/app.js');
  assert.match(html, /<button class="bot-launcher"[^>]*data-chat-open/);
  assert.match(html, /chat-widget\.js/);
  assert.match(app, /FranchiseChat\.mount\(\{launcher:\$\('\.bot-launcher'\)/);
  assert.doesNotMatch(app, /bot-launcher[^\n]{0,80}data-tab/);
});

// Structured snapshots: summaries are short bullets built from fields, never from page text.
const terrState = { apps: [], territories: [
  { id: 'TER-04', city: 'Hubballi-Dharwad', tier: 'Tier 2', priority: 'High', pins: ['580020', '580021'], slots: 2 },
  { id: 'TER-02', city: 'Bengaluru', tier: 'Tier 1', priority: 'High', pins: ['560058'], slots: 0 },
  { id: 'TER-03', city: 'Bengaluru', tier: 'Tier 1', priority: 'Medium', pins: ['560066'], slots: 1 }], settings: {}, source: 'Synthetic demo' };
const terrResults = [
  { key: 'x1', id: 'APP-101', name: 'Ravi', status: 'Recommended', score: 90, grade: 'A', territory: 'TER-04', pin: '580020' },
  { key: 'x2', id: 'APP-102', name: 'Meena', status: 'Waitlisted', score: 70, grade: 'B', territory: 'TER-02', pin: '560058' },
  { key: 'x3', id: 'APP-103', name: 'Kiran', status: 'Waitlisted', score: 60, grade: 'C', territory: 'TER-02', pin: '560058' },
  { key: 'x4', id: 'APP-104', name: 'Sara', status: 'Site needed', score: 55, grade: 'C', territory: 'TER-02', pin: '560058' },
  { key: 'x5', id: 'APP-105', name: 'Dev', status: 'Waitlisted', score: 50, grade: 'C', territory: 'TER-03', pin: '560066' }];
const terrEconomics = {
  'TER-04': { pins: [{ status: 'available' }, { status: 'missing' }], aggregate: { catchmentPopulation: { value: 300000, pinsWithData: 1, pinsTotal: 2 }, tam: { value: 5e8, pinsWithData: 1, pinsTotal: 2 }, investment: { mid: 2e7 }, payback: { best: { base: 24 } } } },
  'TER-02': { pins: [{ status: 'available' }], aggregate: { catchmentPopulation: { value: 900000, pinsWithData: 1, pinsTotal: 1 }, tam: { value: 9e8, pinsWithData: 1, pinsTotal: 1 }, investment: { mid: 3e7 }, payback: { best: { base: 30 } } } },
  'TER-03': { pins: [{ status: 'missing' }], aggregate: { catchmentPopulation: { value: null, pinsWithData: 0, pinsTotal: 1 }, tam: { value: null, pinsWithData: 0, pinsTotal: 1 }, investment: null, payback: null } }
};
const BAD = [/—/, /undefined|NaN|null/, /[a-z]\d[A-Za-z]/, /\d[A-Z][a-z]/, /[a-z][A-Z][a-z]/];
const expectClean = lines => { for (const line of lines) for (const re of BAD) assert.doesNotMatch(line, re, `"${line}" should be clean text`); };
const bulletsOf = text => text.split('\n').filter(l => l.startsWith('• ')).map(l => l.slice(2));

test('territories summary: short bullets from fields, with the PIN data gap stated once', () => {
  const ctx = Chat.buildPageContext({ tab: 'territories', state: terrState, results: terrResults, economics: terrEconomics, doc: dom('<h1>Territories</h1>') });
  assert.equal(ctx.data.territories.length, 3);
  assert.equal(ctx.data.territories.find(t => t.id === 'TER-02').applications, 3);
  assert.equal(ctx.data.territories.find(t => t.id === 'TER-03').catchment, null, 'a missing catchment is null, not a dash');
  const out = bulletsOf(Chat.summarise(ctx));
  assert.ok(out.length >= 3 && out.length <= 5, `3–5 bullets, got ${out.length}`);
  assert.ok(out.includes('3 territories, 5 applications, 1 of 3 slots recommended'), out.join(' | '));
  assert.ok(out.includes('Bengaluru has the most applicants (4) but no recommendation yet'), out.join(' | '));
  assert.equal(out.filter(l => /PIN dataset/.test(l)).length, 1, 'the PIN data gap appears once');
  expectClean(out);
});

test('territories summary says economics are loading once, without placeholders', () => {
  const ctx = Chat.buildPageContext({ tab: 'territories', state: terrState, results: terrResults, doc: dom('') });
  const text = Chat.summarise(ctx);
  assert.match(text, /• Not available: PIN economics are still loading/);
  assert.equal((text.match(/Not available:/g) || []).length, 1);
  assert.doesNotMatch(text, /—/);
});

test('overview, applications, rules and map summaries are clean bullets with no placeholders', () => {
  const cases = [
    Chat.buildPageContext({ tab: 'overview', state: { apps: [], territories: [{ id: 'T1', slots: 4 }], settings: {}, source: 'Workbook' }, results: terrResults, doc: dom('<h1>Overview</h1>') }),
    Chat.buildPageContext({ tab: 'applications', state: terrState, results: terrResults, doc: dom('') }),
    Chat.buildPageContext({ tab: 'expansion', state: terrState, results: terrResults, doc: dom('<div data-map-place-title>Karnataka</div>') }),
    Chat.buildPageContext({ tab: 'rules', state: { ...terrState, settings: { minInvestment: 50, minArea: 800, minLaunch: 6, targetLaunch: 12, model: 'industry-v2' } }, results: [], doc: dom('') })
  ];
  for (const ctx of cases) {
    const out = bulletsOf(Chat.summarise(ctx));
    assert.ok(out.length >= 1 && out.length <= 5, `${ctx.page}: ${out.length} bullets`);
    expectClean(out);
  }
});

test('map summary lists popup KPIs as title and value and reports missing KPIs once', () => {
  const doc = dom(`<div data-map-place-title>560058</div><div class="maplibregl-popup-content"><div class="expansion-popup"><header><strong>560058</strong></header>
    <div class="expansion-popup-grid"><div class="expansion-popup-kpi"><span>Annual TAM</span><strong>₹55Cr /year</strong><small>x</small></div><div class="expansion-popup-kpi"><span>Ideal investment</span><strong>Not estimated</strong><small>y</small></div><div class="expansion-popup-kpi"><span>Revenue growth</span><strong>—</strong><small>z</small></div></div>
    <div class="expansion-popup-status"><span>Modelled estimate</span></div></div></div>`);
  const text = Chat.summarise(Chat.buildPageContext({ tab: 'expansion', state: terrState, results: [], doc, location }));
  assert.match(text, /• Annual TAM: ₹55Cr \/year/);
  assert.match(text, /Not available: Ideal investment, Revenue growth not estimated for this area/);
  assert.equal((text.match(/Not available/g) || []).length, 1);
  assert.doesNotMatch(text, /—|Not estimated/);
});

test('greetings and method questions are answered instantly without Gemini', async () => {
  const fetched = [];
  const fetch = async (...args) => { fetched.push(args); return { ok: true, json: async () => ({ answer: 'remote' }) }; };
  const doc = dom('<div class="analysis-why"><strong>How the payback is worked out</strong><ol><li>Store sales are below break-even.</li></ol></div>');
  const ctx = { ...Chat.buildPageContext({ tab: 'expansion', state: terrState, results: [], doc, location }), geography: { id: 'pin:524003', name: 'PIN 524003' } };
  const hi = await Chat.answer('hi', { ctx, fetch, doc });
  assert.equal(hi.source, 'page'); assert.match(hi.text, /^Hi!/);
  const payback = await Chat.answer("What's the criteria and methodology to calculate payback period", { ctx, fetch, doc });
  assert.equal(payback.source, 'page');
  assert.match(payback.text, /capture rate/); assert.match(payback.text, /For PIN 524003:\n• Store sales are below break-even/);
  assert.equal(fetched.length, 0);
});

test('the open PIN popup is the area in context, not an older map selection', () => {
  const doc = dom('<div class="maplibregl-popup-content"><div class="expansion-popup is-pin" data-popup-geography="pin:524003"><header><strong>PIN 524003</strong></header></div></div>');
  const ctx = Chat.buildPageContext({ tab: 'expansion', state: terrState, results: [], doc, location: { id: 'state:IN-TN', name: 'Tamil Nadu', level: 'state', metrics: {} } });
  assert.equal(ctx.geography.id, 'pin:524003'); assert.equal(ctx.geography.name, 'PIN 524003');
});
