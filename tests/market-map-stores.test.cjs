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
    addSource(id, source) { this.sources[id] = { ...source, setData(data) { this.data = data; this.setDataCount=(this.setDataCount||0)+1; } }; }
    getSource(id) { return this.sources[id]; }
    addLayer(layer) { this.layers[layer.id] = layer; }
    getLayer(id) { return this.layers[id]; }
    setFilter(id, filter) { this.layers[id].filter = filter; }
    setPaintProperty(id,key,value) { this.layers[id].paint[key]=value; }
    setLayoutProperty(id,key,value) { this.layers[id].layout ||= {}; this.layers[id].layout[key]=value; }
    setTerrain(value) { this.terrain=value; } resize() { this.resizeCount=(this.resizeCount||0)+1; }
    addControl() {} getZoom() { return this.zoom; }
    setPitch(value) { this.pitch = value; } getPitch() { return this.pitch || 0; }
    setLayoutProperty() {} setStyle(style) { this.options.style = style; }
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
  return { Map, Popup, NavigationControl: class {} };
}

// Direct map-adapter harness (copied from market-map-ui.test.cjs, which does not export it).
function mountAdapter({ responder = () => levels([], 'state'), reducedMotion = false } = {}) {
  const dom = new JSDOM('<main id="host"></main>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const { window } = dom;
  const lib = mapDouble(), requests = [];
  Object.assign(lib.Map.prototype, {
    setLayoutProperty(id,key,value) { this.layers[id].layout ||= {}; this.layers[id].layout[key]=value; },
    addControl(control) { (this.controls ||= []).push(control); },
    getBounds() { return { toArray: () => this.boundsArray || [[77.51,12.88],[77.72,13.04]] }; },
    flyTo(options) { this.flights=(this.flights||0)+1; this.zoom=options.zoom; this.center=options.center; this.pitch=options.pitch; }
  });
  window.maplibregl = lib;
  window.matchMedia = query => ({ matches: reducedMotion && /reduce/.test(query) });
  window.fetch = async url => { requests.push(String(url)); const data = await responder(String(url)); return { ok: !data?.status, status: data?.status || 200, json: async () => data }; };
  window.eval(read('dist/market-color-scale.js'));
  window.eval(read('dist/market-map.js'));
  const container = window.document.getElementById('host');
  const adapter = window.MarketMap.mount({ container, options: { pinDebounceMs: 0 } });
  const map = lib.Map.instances[0];
  map.fire('load');
  const moveTo = async zoom => { map.zoom = zoom; map.fire('moveend'); await new Promise(resolve => setTimeout(resolve, 5)); await tick(); };
  return { dom, window, container, adapter, map, requests, moveTo, visible: id => map.layers[id]?.layout?.visibility !== 'none' };
}
const pinFeature = (id, revenue) => ({ ...feature(id, 50, 'pin'), metrics: { potentialRevenue: { value: revenue, unit: 'INR/year', evidenceClass: 'derived_estimate' }, apparelExpenditure: { value: revenue / 2, unit: 'INR/year', evidenceClass: 'derived_estimate' } } });
const pinLegend = { metric: 'potentialRevenue', level: 'pin', year: 2026, scope: 'national', thresholds: [2.5e7, 4.5e7, 7e7, 1.2e8], colors: ['#8dbdd2','#f1da5b','#f28e2b','#b4232b','#7a0019'], unit: 'INR/year' };
const pinResponse = (features = [pinFeature('560058', 6e7), pinFeature('560059', 9e7)]) => ({ ...levels(features, 'pin'), legend: pinLegend });
const competitorsPayload = {
  geographyId: '560058', sector: 'apparel', sectorName: 'Apparel & fashion',
  observed: { source: 'OpenStreetMap', totalStores: 12, brandedStores: 5, brands: [{ name: 'Zudio', count: 3 }], categories: { clothes: 12 }, retrievedAt: '2026-10-26', license: 'ODbL' },
  majorCompetitors: [{ name: 'Trends', parent: 'Reliance Retail', format: 'Value fashion', priceTier: 'value', presence: 'city', citation: { title: 'Src', url: 'https://example.org/a' } }],
  warnings: [], cached: false
};
const isCompetitorUrl = url => url.includes('/api/market/competitors');
const competitorRequests = h => h.requests.filter(isCompetitorUrl);

test('store-aware colours use the opportunity ramp without stores and the green ramp for store areas', () => {
  const colorLib = require('../dist/market-color-scale.js');
  const { OPPORTUNITY_COLORS, STORE_COLORS, MISSING_COLOR, storeAwareColor, createColorScale } = colorLib;
  const scale = createColorScale({ mode: 'linear', scope: 'national', domain: [0, 100], colors: OPPORTUNITY_COLORS });
  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  assert.ok(same(storeAwareColor(0, scale, false), OPPORTUNITY_COLORS[0]), 'opportunity low end');
  assert.ok(same(storeAwareColor(100, scale, false), OPPORTUNITY_COLORS.at(-1)), 'opportunity high end');
  assert.ok(same(storeAwareColor(0, scale, true), STORE_COLORS[0]), 'store low end');
  assert.ok(same(storeAwareColor(100, scale, true), STORE_COLORS.at(-1)), 'store high end');
  const midOpportunity = storeAwareColor(50, scale, false);
  const midStore = storeAwareColor(50, scale, true);
  for (const endpoint of [OPPORTUNITY_COLORS[0], OPPORTUNITY_COLORS.at(-1)]) assert.notEqual(midOpportunity.toLowerCase(), endpoint.toLowerCase(), 'opportunity mid is a continuous blend');
  for (const endpoint of [STORE_COLORS[0], STORE_COLORS.at(-1)]) assert.notEqual(midStore.toLowerCase(), endpoint.toLowerCase(), 'store mid is a continuous blend');
  for (const value of [0, 25, 50, 75, 100]) assert.notEqual(storeAwareColor(value, scale, false).toLowerCase(), storeAwareColor(value, scale, true).toLowerCase(), `store and non-store colours differ at ${value}`);
  assert.equal(storeAwareColor(null, scale, true), MISSING_COLOR);
  assert.equal(storeAwareColor(null, scale, false), MISSING_COLOR);
});

test('PIN fill and extrusion expressions colour store PINs with the store ramp and expose s_store', async t => {
  const h = mountAdapter({ responder: () => pinResponse() });
  t.after(() => { h.adapter.destroy(); h.dom.window.close(); });
  h.adapter.setStoreAreas(['560058']);
  await h.moveTo(10);
  const { STORE_COLORS, OPPORTUNITY_COLORS } = require('../dist/market-color-scale.js');
  const color = JSON.stringify(h.map.layers['market-pin-extrusion'].paint['fill-extrusion-color']).toLowerCase();
  assert.ok(color.includes('"s_store"'), 'expression branches on s_store');
  for (const hex of [STORE_COLORS[0], STORE_COLORS.at(-1), OPPORTUNITY_COLORS[0], OPPORTUNITY_COLORS.at(-1)]) {
    assert.ok(color.includes(hex.toLowerCase()), `expression contains ${hex}`);
  }
  const features = h.map.sources['market-pins'].data.features;
  assert.equal(features.find(f => f.id === '560058').properties.s_store, 1);
  assert.equal(features.find(f => f.id === '560059').properties.s_store, 0);
  assert.equal(h.adapter.hasStore('560058'), true);
  assert.equal(h.adapter.hasStore('560059'), false);
});

test('PIN popup loads competitors once on click and shows the store note and KPIs', async t => {
  const h = mountAdapter({ responder: url => isCompetitorUrl(url) ? competitorsPayload : pinResponse([pinFeature('560058', 6e7)]) });
  t.after(() => { h.adapter.destroy(); h.dom.window.close(); });
  h.adapter.setStoreAreas(['560058']);
  await h.moveTo(10);
  h.map.fire('mouseenter', { features: [{ properties: { id: '560058' } }], lngLat: { lng: 77.6, lat: 12.9 } }, 'market-pin-extrusion');
  const popup = h.container.querySelector('.expansion-popup');
  assert.ok(popup, 'popup is rendered');
  for (const text of ['Potential TAM', 'Potential revenue', 'Consumer spend', 'You have a store here']) assert.match(popup.textContent, new RegExp(text));
  assert.equal(competitorRequests(h).length, 0, 'no competitor request on hover before click');

  h.map.fire('click', { features: [{ id: '560058', properties: { id: '560058' } }], lngLat: { lng: 77.6, lat: 12.9 } });
  await settle(); await tick();
  let requests = competitorRequests(h);
  assert.equal(requests.length, 1, 'exactly one competitor request after click');
  const query = new URL(requests[0], 'http://localhost').searchParams;
  assert.equal(query.get('geographyId'), '560058');
  assert.equal(query.get('sector'), 'apparel');
  assert.match(h.window.maplibregl.Popup.instances.at(-1).html, /Trends/);

  h.map.fire('click', { features: [{ id: '560058', properties: { id: '560058' } }], lngLat: { lng: 77.6, lat: 12.9 } });
  await settle(); await tick();
  assert.equal(competitorRequests(h).length, 1, 'repeat click uses the client cache');
});

test('competitor failure shows a graceful unavailable message in the PIN popup', async t => {
  const h = mountAdapter({ responder: url => isCompetitorUrl(url) ? { status: 503, error: 'down' } : pinResponse([pinFeature('560058', 6e7)]) });
  t.after(() => { h.adapter.destroy(); h.dom.window.close(); });
  h.adapter.setStoreAreas(['560058']);
  await h.moveTo(10);
  h.map.fire('click', { features: [{ id: '560058', properties: { id: '560058' } }], lngLat: { lng: 77.6, lat: 12.9 } });
  await settle(); await tick();
  assert.equal(competitorRequests(h).length, 1);
  assert.match(h.window.maplibregl.Popup.instances.at(-1).html, /Competitor research unavailable/);
});

test('a PIN without a store area shows no store note on hover', async t => {
  const h = mountAdapter({ responder: () => pinResponse() });
  t.after(() => { h.adapter.destroy(); h.dom.window.close(); });
  await h.moveTo(10);
  h.map.fire('mouseenter', { features: [{ properties: { id: '560059' } }], lngLat: { lng: 77.6, lat: 12.9 } }, 'market-pin-extrusion');
  const popup = h.container.querySelector('.expansion-popup');
  assert.ok(popup, 'popup is rendered');
  assert.match(popup.textContent, /Potential revenue/);
  assert.doesNotMatch(popup.textContent, /You have a store here/);
  assert.equal(h.adapter.hasStore('560059'), false);
});
