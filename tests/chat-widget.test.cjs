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
  { key: 'a', id: 'APP-001', name: 'Asha', status: 'Recommended', score: 81, high: 84, grade: 'A', territory: 'T1', reasons: ['Strong capital'] },
  { key: 'b', id: 'APP-002', name: 'Ben', status: 'Clarification needed', score: 52, high: 70, grade: 'C', territory: 'T1', reasons: ['Missing area'] },
  { key: 'c', id: 'APP-003', name: 'Chen', status: 'Site needed', score: 66, high: 66, grade: 'B', territory: 'T2', reasons: [] }
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
  assert.equal(byLabel['Clarification needed'], '1');
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

test('territories page snapshot lists PIN economics shown on the page', () => {
  const doc = dom('<div class="te-card"><span class="te-city">Bengaluru</span><div class="te-card-top">T1</div></div><div class="te-pin"><span class="te-pin-name">560058</span><div class="te-pin-kpis">Potential revenue ₹17.6Cr</div></div>');
  const ctx = Chat.buildPageContext({ tab: 'territories', state, results, stores: [{}], doc });
  assert.ok(ctx.facts.some(f => f.label === '560058' && /₹17\.6Cr/.test(f.value)));
  assert.ok(ctx.facts.some(f => f.label === 'Bengaluru'));
});

test('expansion snapshot includes the selected area and an open map popup, and suggests area questions', () => {
  const doc = dom(`<div data-map-place-title>Karnataka</div><p data-map-place-path>state · evidence 2011</p><div class="market-kpi"><span>Population</span><strong>111.3Cr people</strong><small>derived</small></div>
    <div class="maplibregl-popup-content"><div class="expansion-popup"><header><strong>560058</strong></header><div class="expansion-popup-grid">Potential revenue ₹17.6Cr /year</div><div class="expansion-popup-status"><span>Modelled estimate</span></div></div></div>`);
  const ctx = Chat.buildPageContext({ tab: 'expansion', state, results, doc, location });
  assert.equal(ctx.geography.id, 'pin:560058');
  assert.ok(ctx.geography.metrics.some(m => m.label === 'potential revenue' && /₹/.test(m.value)));
  assert.ok(ctx.facts.some(f => /Map popup/.test(f.label) && /Potential revenue/.test(f.value)));
  assert.ok(ctx.facts.some(f => f.label === 'Selected area' && f.value === 'Karnataka'));
  assert.ok(ctx.suggestions.some(q => /560058/.test(q)));
});

test('snapshot text is trimmed to a fixed length and never leaks raw HTML', () => {
  const long = 'x'.repeat(400);
  const doc = dom(`<div class="stat"><span class="stat-label">${long}</span><span class="stat-value"><b>5</b></span></div>`);
  const ctx = Chat.buildPageContext({ tab: 'review', state, results, doc });
  for (const f of ctx.facts) { assert.ok(f.label.length <= 80); assert.ok(!/[<>]/.test(f.label + f.value)); }
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

test('"summarise this page" is answered from the page snapshot', async () => {
  const ctx = Chat.buildPageContext({ tab: 'overview', state, results, doc: dom('<h1>Overview</h1>') });
  const reply = await Chat.answer('Summarise this page', { ctx, env: null, bot: null });
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
