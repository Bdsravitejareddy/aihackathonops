'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = () => new Promise(resolve => setTimeout(resolve, 10));
const polygon = { type: 'Polygon', coordinates: [[[75,20],[77,20],[77,22],[75,22],[75,20]]] };
// Deliberately synthetic test geographies; never loaded by production code.
const feature = (id, value, level = 'state', parentId = null) => ({
  id, name: `Test area ${id}`, level, parentId, geometry: polygon,
  metrics: { population: { value, unit: 'people', evidenceClass: 'derived_estimate', referenceYear: 2011 }, apparelExpenditure: { value, unit:'INR/year', evidenceClass:'derived_estimate' }, potentialRevenue: { value, unit:'INR/year', evidenceClass:'derived_estimate' } },
  confidence: 'low', evidence: [{ title: 'Test source', publisher: 'Fixture publisher', referenceYear: 2011,
    evidenceClass: 'derived_estimate', allocationMethod: 'areal_interpolation', uncertainty: 'high', url: 'https://example.org/source' }]
});
const levels = (features = [feature('a', 120), feature('b', null)], level = 'state') => ({
  level, sourceVersion: 'fixture-v1', features,
  legend: { metric: 'potentialRevenue', year: 2026, scope: 'national', thresholds: [100,200], colors: ['#d9eee1','#6ba688','#185a44'], unit: 'INR/year' }
});
function mapDouble() {
  class Map {
    constructor(options) { this.options = options; this.zoom = options.zoom; this.events = []; this.sources = {}; this.layers = {}; Map.instances.push(this); }
    on(name, layer, fn) { this.events.push({ name, layer: typeof layer === 'string' ? layer : null, fn: fn || layer }); return this; }
    fire(name, event = {}, layer = null) { for (const e of this.events) if (e.name === name && e.layer === layer) e.fn(event); }
    addSource(id, source) { this.sources[id] = { ...source, setData(data) { this.data = data; } }; }
    getSource(id) { return this.sources[id]; }
    addLayer(layer) { this.layers[layer.id] = layer; }
    getLayer(id) { return this.layers[id]; }
    setFilter(id, filter) { this.layers[id].filter = filter; }
    setPaintProperty(id,key,value) { this.layers[id].paint[key]=value; }
    setLayoutProperty(id,key,value) { this.layers[id].layout ||= {}; this.layers[id].layout[key]=value; }
    setTerrain(value) { this.terrain=value; } resize() { this.resizeCount=(this.resizeCount||0)+1; }
    addControl(control) { (this.controls ||= []).push(control); } getZoom() { return this.zoom; }
    setPitch(value) { this.pitch = value; } getPitch() { return this.pitch || 0; }
    setStyle(style) { this.options.style = style; }
    getBounds() { return { toArray: () => [[70,10],[90,30]] }; }
    getCanvas() { return { style: {} }; }
    fitBounds(bounds, options) { this.zoom = options.zoom || options.maxZoom; this.bounds = bounds; }
    flyTo(options) { this.zoom=options.zoom; this.center=options.center; }
    remove() { this.removed = true; }
  }
  Map.instances = [];
  class Popup {
    constructor(options) { this.options=options;Popup.instances.push(this); } setLngLat(value) { this.lngLat=value;return this; }
    setHTML(html) { this.html = html;if(this.element)this.element.innerHTML=html;return this; }
    addTo(map) { this.element=map.options.container.ownerDocument.createElement('div');this.element.innerHTML=this.html;map.options.container.append(this.element);return this; }
    remove() { this.removed = true;this.element?.remove(); }
  }
  Popup.instances = [];
  class Marker {
    constructor(options) { this.options = options; Marker.instances.push(this); }
    setLngLat(value) { this.lngLat = value; return this; }
    addTo(map) { map.options.container.append(this.options.element); return this; }
    remove() { this.removed = true; this.options.element?.remove(); return this; }
  }
  Marker.instances = [];
  return { Map, Popup, Marker, NavigationControl: class {} };
}

// Direct map-adapter harness: the adapter returned by MarketMap.mount, which owns PIN markers and popups.
function mountAdapter({ responder = () => levels([], 'state'), storePins = [] } = {}) {
  const dom = new JSDOM('<main id="host"></main>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const { window } = dom;
  const lib = mapDouble(), requests = [];
  Object.assign(lib.Map.prototype, {
    getBounds() { return { toArray: () => [[77.51,12.88],[77.72,13.04]] }; },
    flyTo(options) { this.zoom=options.zoom; this.center=options.center; this.pitch=options.pitch; }
  });
  window.maplibregl = lib;
  window.matchMedia = () => ({ matches: false });
  window.fetch = async url => { requests.push(String(url)); const data = await responder(String(url)); return { ok: true, status: 200, json: async () => data }; };
  window.eval(read('dist/market-color-scale.js'));
  window.eval(read('dist/market-map.js'));
  const container = window.document.getElementById('host');
  const adapter = window.MarketMap.mount({ container, options: { opportunityDebounceMs: 0, storePins } });
  const map = lib.Map.instances[0];
  map.fire('load');
  return { dom, window, lib, container, adapter, map, requests };
}

// Fixtures: one existing store and two ranked next-best PINs, as the opportunity API returns them.
const storePin = { pin: '560058', anchor: [77.6, 12.9], tam: 6e7, potentialRevenue: 6e7, population: 120000, spendPerPersonMonthly: 450, district: 'Bengaluru Urban', state: 'Karnataka' };
const nextPin = (rank, pin, revenue) => ({ pin, rank, anchor: [77.6 + rank / 100, 12.9 + rank / 100], tam: revenue / 2, potentialRevenue: revenue, population: 200000, spendPerPersonMonthly: 520, district: 'Bengaluru Urban', state: 'Karnataka' });
const opportunityFixture = { stores: [storePin], opportunities: [nextPin(1, '560059', 9e7), nextPin(2, '560060', 7e7)] };
const economics = paybackMonths => ({ scenarios: { low: { investment: 1e7, paybackMonths: 20 }, mid: { investment: 1.5e7, paybackMonths }, high: { investment: 2e7, paybackMonths: 40 } } });
const competitorsPayload = {
  geographyId: 'pin:560058', sector: 'apparel', sectorName: 'Apparel & fashion',
  observed: { source: 'OpenStreetMap', totalStores: 12, brandedStores: 5, brands: [{ name: 'Zudio', count: 3 }], categories: { clothes: 12 }, retrievedAt: '2026-10-26', license: 'ODbL' },
  majorCompetitors: [{ name: 'Trends', parent: 'Reliance Retail', format: 'Value fashion', priceTier: 'value', presence: 'city', citation: { title: 'Src', url: 'https://example.org/a' } }],
  warnings: [], cached: false
};
// Routes the PIN APIs; a value may be a function so a test can make the request fail.
function pinApi({ analysis = economics(30), competitors = competitorsPayload } = {}) {
  return url => {
    if (url.includes('/api/market/map/opportunities')) return opportunityFixture;
    if (url.includes('/api/market/analysis')) return analysis;
    if (url.includes('/api/market/competitors')) return typeof competitors === 'function' ? competitors() : competitors;
    return levels([], 'state');
  };
}
const competitorRequests = h => h.requests.filter(url => url.includes('/api/market/competitors'));
const popupOf = h => h.container.querySelector('.expansion-popup');
async function loadPins() { await settle(); await tick(); }
async function clickPin(h, id) { h.container.querySelector(`[data-map-pin="${id}"]`).click(); await settle(); await tick(); }

test('PIN popup loads competitors once on click and shows the store note and KPIs', async t => {
  const h = mountAdapter({ storePins: ['560058'], responder: pinApi() });
  t.after(() => { h.adapter.destroy(); h.dom.window.close(); });
  await loadPins();
  h.container.querySelector('[data-map-pin="pin:560058"]').dispatchEvent(new h.window.Event('mouseenter'));
  const hover = h.container.querySelector('.expansion-hover');
  assert.ok(hover, 'a small hover card is rendered on hover');
  assert.match(hover.textContent, /You have a store here/); assert.match(hover.textContent, /Click for full details/);
  assert.equal(popupOf(h), null, 'the full popup waits for a click');
  assert.equal(competitorRequests(h).length, 0, 'no competitor request on hover before click');

  await clickPin(h, 'pin:560058');
  const requests = competitorRequests(h);
  assert.equal(requests.length, 1, 'exactly one competitor request after click');
  const query = new URL(requests[0], 'http://localhost').searchParams;
  assert.equal(query.get('geographyId'), 'pin:560058');
  assert.equal(query.get('sector'), 'apparel');
  assert.match(h.window.maplibregl.Popup.instances.at(-1).html, /Trends/);

  await clickPin(h, 'pin:560058');
  assert.equal(competitorRequests(h).length, 1, 'repeat click uses the client cache');
});

test('competitor failure leaves the PIN popup without a competitor block and keeps its figures', async t => {
  const h = mountAdapter({ responder: pinApi({ competitors: () => { throw Error('down'); } }) });
  t.after(() => { h.adapter.destroy(); h.dom.window.close(); });
  await loadPins();
  await clickPin(h, 'pin:560058');
  assert.equal(competitorRequests(h).length, 1);
  assert.doesNotMatch(popupOf(h).textContent, /Major competitors/);
  assert.match(popupOf(h).textContent, /Annual category spend/);
});

test('an empty competitor list leaves the PIN popup without a competitor block', async t => {
  const h = mountAdapter({ responder: pinApi({ competitors: { ...competitorsPayload, majorCompetitors: [], observed: { ...competitorsPayload.observed, brands: [] } } }) });
  t.after(() => { h.adapter.destroy(); h.dom.window.close(); });
  await loadPins();
  await clickPin(h, 'pin:560059');
  assert.equal(competitorRequests(h).length, 1);
  assert.doesNotMatch(popupOf(h).textContent, /Major competitors/);
  assert.match(popupOf(h).textContent, /Potential revenue/);
});

test('a next-best PIN shows no store note on hover and is not a store', async t => {
  const h = mountAdapter({ responder: pinApi() });
  t.after(() => { h.adapter.destroy(); h.dom.window.close(); });
  await loadPins();
  h.container.querySelector('[data-map-pin="pin:560059"]').dispatchEvent(new h.window.Event('mouseenter'));
  const card = h.container.querySelector('.expansion-hover');
  assert.ok(card, 'hover card is rendered');
  assert.match(card.textContent, /Potential revenue/);
  assert.match(card.textContent, /#1 next-best PIN to open/);
  assert.doesNotMatch(card.textContent, /You have a store here/);
  assert.equal(h.adapter.hasStore('560059'), false);
});

test('store PINs render green markers and next-best PINs numbered grey markers from the opportunity API', async t => {
  const h = mountAdapter({ responder: pinApi() });
  t.after(() => { h.adapter.destroy(); h.dom.window.close(); });
  await loadPins();
  const stores = h.container.querySelectorAll('.expansion-pin--store');
  const next = h.container.querySelectorAll('.expansion-pin--next');
  assert.equal(stores.length, 1); assert.equal(stores[0].dataset.mapPin, 'pin:560058');
  assert.deepEqual([...next].map(el => el.textContent.trim()), ['1', '2']);
  assert.deepEqual([...next].map(el => el.dataset.mapPin), ['pin:560059', 'pin:560060']);
  const anchors = h.lib.Marker.instances.filter(marker => !marker.removed).map(marker => JSON.stringify(marker.lngLat)).sort();
  const expected = [storePin, ...opportunityFixture.opportunities].map(item => JSON.stringify(item.anchor)).sort();
  assert.deepEqual(anchors, expected);
});

test('clicking a PIN marker opens a popup with reliable figures only', async t => {
  const h = mountAdapter({ responder: pinApi() });
  t.after(() => { h.adapter.destroy(); h.dom.window.close(); });
  await loadPins();
  await clickPin(h, 'pin:560059');
  const popup = popupOf(h);
  for (const text of ['Annual category spend', 'Potential revenue', 'Residents', 'Consumer spend']) assert.match(popup.textContent, new RegExp(text));
  for (const text of ['Serviceable', 'Competitor intensity', 'Relevant customers', 'Market opportunity', 'Unavailable']) assert.doesNotMatch(popup.textContent, new RegExp(text));
  assert.match(popup.textContent, /#1 next-best PIN to open/);
});

test('PIN popup shows investment and payback from the cost model, and "over 5 years" when payback is unknown', async t => {
  const known = mountAdapter({ responder: pinApi({ analysis: economics(30) }) });
  t.after(() => { known.adapter.destroy(); known.dom.window.close(); });
  await loadPins();
  await clickPin(known, 'pin:560059');
  assert.match(popupOf(known).textContent, /Investment required/);
  assert.match(popupOf(known).textContent, /Payback/);
  assert.match(popupOf(known).textContent, /2\.5 years/);

  const unknown = mountAdapter({ responder: pinApi({ analysis: economics(null) }) });
  t.after(() => { unknown.adapter.destroy(); unknown.dom.window.close(); });
  await loadPins();
  await clickPin(unknown, 'pin:560059');
  assert.match(popupOf(unknown).textContent, /Payback/);
  assert.match(popupOf(unknown).textContent, /over 5 years/);
});

test('storePins option marks listed PINs as stores and is sent with the opportunity request', async t => {
  const h = mountAdapter({ storePins: ['560058'], responder: pinApi() });
  t.after(() => { h.adapter.destroy(); h.dom.window.close(); });
  await loadPins();
  assert.equal(h.adapter.hasStore('pin:560058'), true);
  assert.equal(h.adapter.hasStore('560058'), true);
  assert.equal(h.adapter.hasStore('560059'), false);
  const sent = h.requests.find(url => url.includes('/api/market/map/opportunities'));
  assert.equal(new URL(sent, 'http://localhost').searchParams.get('storePins'), '560058');
  h.adapter.setStorePins(['560059']);
  assert.equal(h.adapter.hasStore('560059'), true);
  assert.equal(h.adapter.hasStore('560058'), false);
});

test('pins sit inside a wrapper MapLibre positions, so pin styles cannot move them', async t => {
  const h = mountAdapter({ responder: pinApi() });
  t.after(() => { h.adapter.destroy(); h.dom.window.close(); });
  await loadPins();
  const elements = h.lib.Marker.instances.filter(marker => !marker.removed).map(marker => marker.options.element);
  assert.ok(elements.length > 0);
  for (const el of elements) { assert.equal(el.className, 'expansion-pin-anchor'); assert.ok(el.querySelector('.expansion-pin')); }
});

test('next-best PINs are ranked once across India and stay fixed when the map moves', async t => {
  const h = mountAdapter({ responder: pinApi() });
  t.after(() => { h.adapter.destroy(); h.dom.window.close(); });
  await loadPins();
  const ranking = () => h.requests.filter(url => url.includes('/api/market/map/opportunities'));
  assert.equal(ranking().length, 1);
  assert.equal(new URL(ranking()[0], 'http://localhost').searchParams.get('bbox'), '60,5,100,38');
  h.map.fire('moveend'); await loadPins();
  assert.equal(ranking().length, 1);
  assert.deepEqual([...h.container.querySelectorAll('.expansion-pin--next')].map(el => el.dataset.mapPin), ['pin:560059', 'pin:560060']);
});
