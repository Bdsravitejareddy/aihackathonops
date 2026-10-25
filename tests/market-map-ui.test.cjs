'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const polygon = { type: 'Polygon', coordinates: [[[75,20],[77,20],[77,22],[75,22],[75,20]]] };
// Deliberately synthetic test geographies; never loaded by production code.
const feature = (id, value, level = 'state', parentId = null) => ({
  id, name: `Test area ${id}`, level, parentId, geometry: polygon,
  metrics: { population: { value, unit: 'people', evidenceClass: 'derived_estimate', referenceYear: 2011 } },
  confidence: 'low', evidence: [{ title: 'Test source', publisher: 'Fixture publisher', referenceYear: 2011,
    evidenceClass: 'derived_estimate', allocationMethod: 'areal_interpolation', uncertainty: 'high', url: 'https://example.org/source' }]
});
const levels = (features = [feature('a', 120), feature('b', null)], level = 'state') => ({
  level, sourceVersion: 'fixture-v1', features,
  legend: { metric: 'population', year: 2026, scope: 'national', thresholds: [100,200], colors: ['#d9eee1','#6ba688','#185a44'], unit: 'people' }
});
function mapDouble() {
  class Map {
    constructor(options) { this.options = options; this.zoom = options.zoom; this.events = []; this.sources = {}; this.layers = {}; Map.instances.push(this); }
    on(name, layer, fn) { this.events.push({ name, layer: typeof layer === 'string' ? layer : null, fn: fn || layer }); return this; }
    fire(name, event = {}, layer = null) { for (const e of this.events) if (e.name === name && e.layer === layer) e.fn(event); }
    addSource(id, source) { this.sources[id] = { ...source, setData(data) { this.data = data; } }; }
    getSource(id) { return this.sources[id]; }
    addLayer(layer) { this.layers[layer.id] = layer; }
    setFilter(id, filter) { this.layers[id].filter = filter; }
    addControl() {} getZoom() { return this.zoom; }
    getBounds() { return { toArray: () => [[70,10],[90,30]] }; }
    getCanvas() { return { style: {} }; }
    fitBounds(bounds, options) { this.zoom = options.zoom || options.maxZoom; this.bounds = bounds; }
    remove() { this.removed = true; }
  }
  Map.instances = [];
  class Popup {
    constructor() { Popup.instances.push(this); } setLngLat() { return this; }
    setHTML(html) { this.html = html; return this; } addTo() { return this; } remove() { this.removed = true; }
  }
  Popup.instances = [];
  return { Map, Popup, NavigationControl: class {} };
}
function setup(responder = url => url.includes('/geographies/') ? feature('a',120) : levels()) {
  const dom = new JSDOM('<main id="host"></main>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const { window } = dom;
  const requests = [];
  window.maplibregl = mapDouble();
  window.fetch = async (url, options = {}) => {
    const request = { url: String(url), ...options, body: options.body && JSON.parse(options.body) };
    requests.push(request);
    const data = await responder(request.url, request);
    return { ok: true, status: 200, json: async () => data };
  };
  assert.ok(fs.existsSync(path.join(root, 'dist/market-map.js')), 'Expansion map module must exist');
  window.eval(read('dist/market-map.js'));
  const host = window.document.getElementById('host');
  const controller = window.MarketMap.mountPage({ container: host, workspaceId: 'test-workspace' });
  const map = window.maplibregl.Map.instances[0];
  map.fire('load');
  return { dom, window, host, controller, map, requests, click: selector => host.querySelector(selector).click(), change(selector, value) {
    const el = host.querySelector(selector); el.value = value; el.dispatchEvent(new window.Event('change', { bubbles: true }));
  } };
}

test('national loading requests state aggregates and never requests PINs without a parent', async t => {
  const h = setup(); t.after(() => { h.controller.destroy(); h.dom.window.close(); }); await tick();
  assert.equal(h.requests.length, 1);
  const url = new URL(h.requests[0].url, 'http://localhost');
  assert.equal(url.pathname, '/api/market/map/levels');
  assert.ok(Number(url.searchParams.get('zoom')) < 6);
  assert.equal(url.searchParams.get('parentId'), null);
  h.map.zoom = 13; h.map.fire('moveend'); await tick();
  assert.ok(h.requests.every(r => Number(new URL(r.url,'http://localhost').searchParams.get('zoom')) < 6));
  assert.equal(h.map.options.style.sources && Object.keys(h.map.options.style.sources).length, 0, 'no remote tile dependency');
});

test('fixed national legend survives local extrema; null stays gray while zero is a measured value', async t => {
  const h = setup(); t.after(() => { h.controller.destroy(); h.dom.window.close(); }); await tick();
  const data = h.map.getSource('market-geographies').data;
  assert.equal(data.features.find(f => f.id === 'a').properties.color, '#6ba688');
  assert.equal(data.features.find(f => f.id === 'b').properties.color, '#b9c1c5');
  const legend = h.host.querySelector('[data-map-legend]').textContent;
  h.controller.setFeatures([feature('zero',0),feature('large',900),feature('missing',undefined)]);
  assert.equal(h.host.querySelector('[data-map-legend]').textContent, legend);
  const changed = h.map.getSource('market-geographies').data.features;
  assert.equal(changed[0].properties.color, '#d9eee1');
  assert.equal(changed[1].properties.color, '#185a44');
  assert.equal(changed[2].properties.color, '#b9c1c5');
  assert.match(legend, /100/); assert.match(legend, /200/); assert.match(legend, /national/i);
});

test('click loads workspace detail, evidence popup is escaped, and unsupported metrics remain unavailable', async t => {
  const f = feature('a',120); f.evidence[0].title = '<img src=x onerror=alert(1)>'; f.evidence.push({ title: 'Unsafe', url: 'javascript:alert(1)' });
  const h = setup(url => url.includes('/geographies/') ? f : levels([f]));
  t.after(() => { h.controller.destroy(); h.dom.window.close(); }); await tick();
  h.map.fire('click', { features: [{ id: 'a', properties: { id: 'a' } }], lngLat: { lng:76, lat:21 } }, 'market-fill'); await tick();
  const detailRequest = h.requests.find(r => r.url.includes('/geographies/a'));
  assert.ok(detailRequest.url.includes('workspaceId=test-workspace'));
  const detail = h.host.querySelector('[data-map-detail]');
  assert.match(detail.textContent, /Test area a/); assert.match(detail.textContent, /derived_estimate/);
  assert.match(detail.textContent, /2011/); assert.match(detail.textContent, /Unavailable/);
  assert.match(detail.textContent, /areal_interpolation/); assert.match(detail.textContent, /low/i);
  assert.equal(detail.querySelector('a[href="https://example.org/source"]').textContent.includes('<img'),true);
  assert.equal(detail.querySelector('img'),null); assert.equal(detail.querySelector('[href^="javascript:"]'),null);
  const popup = h.window.maplibregl.Popup.instances.at(-1);
  assert.match(popup.html, /derived_estimate/); assert.doesNotMatch(popup.html, /<img/);
});

test('explicit drill-down scopes district, city, PIN and catchment loads; national reset clears parent', async t => {
  const h = setup((url) => {
    if (url.includes('/geographies/')) return feature('a',120);
    const p = new URL(url,'http://localhost').searchParams.get('parentId');
    if (p === 'a') return levels([feature('d',120,'district','a')], 'district');
    if (p === 'd') return levels([feature('c',120,'city','d')], 'city');
    if (p === 'c') return levels([feature('p',120,'pin','c')], 'pin');
    if (p === 'p') return levels([], 'catchment');
    return levels();
  }); t.after(() => { h.controller.destroy(); h.dom.window.close(); }); await tick();
  for (const id of ['a','d','c','p']) {
    h.controller.selectGeography(id); await tick(); h.click('[data-map-drill]'); await tick();
    assert.equal(new URL(h.requests.filter(r => r.url.includes('/levels')).at(-1).url,'http://localhost').searchParams.get('parentId'),id);
  }
  assert.match(h.host.querySelector('[data-map-status]').textContent,/catchment/i);
  h.click('[data-map-national]'); await tick();
  assert.equal(new URL(h.requests.at(-1).url,'http://localhost').searchParams.get('parentId'),null);
});

test('comparison posts selected geography IDs and renders evidence alongside results', async t => {
  const h = setup((url,req) => url.endsWith('/compare') ? { geographies: req.body.geographyIds.map(id => feature(id,120)), warnings: ['Fixture overlap warning'] } : url.includes('/geographies/') ? feature(url.includes('/b?')?'b':'a',120) : levels());
  t.after(() => { h.controller.destroy(); h.dom.window.close(); }); await tick();
  for (const id of ['a','b']) { h.controller.selectGeography(id); await tick(); h.click('[data-map-add-compare]'); }
  h.click('[data-map-compare]'); await tick();
  const req = h.requests.find(r => r.url.endsWith('/compare'));
  assert.equal(req.method,'POST'); assert.deepEqual(req.body.geographyIds,['a','b']); assert.equal(req.body.workspaceId,'test-workspace');
  assert.match(h.host.querySelector('[data-map-comparison]').textContent,/Test area b/);
  assert.match(h.host.querySelector('[data-map-comparison]').textContent,/Fixture overlap warning/);
});

test('scenario controls post explicit assumptions, keep blanks missing and synchronize forecast and map', async t => {
  const h = setup((url) => url.endsWith('/scenario') ? { scenarioId: 'scenario-test', map: levels([feature('a',220)]), forecast: { evidenceClass:'forecast', revenueAnnual: { value: 500, unit:'INR/year' }, warnings:['Hypothetical test forecast'] } } : levels());
  t.after(() => { h.controller.destroy(); h.dom.window.close(); }); await tick();
  h.change('[name="elasticity"]','0.75'); h.change('[name="captureRate"]','0.02'); h.change('[name="aov"]','800');
  h.change('[name="areaSqFt"]','900'); h.change('[name="investment"]','10000'); h.change('[name="targetDemographics"]','Test audience');
  h.change('[name="travelTimeMinutes"]','15'); h.change('[name="horizonYears"]','3');
  h.host.querySelector('[data-map-scenario-form]').dispatchEvent(new h.window.Event('submit',{bubbles:true,cancelable:true})); await tick();
  const req = h.requests.find(r=>r.url.endsWith('/scenario'));
  assert.equal(req.method,'POST'); assert.equal(req.body.horizonYears,3); assert.equal(req.body.assumptions.elasticity,0.75);
  assert.equal(req.body.assumptions.captureRate,0.02); assert.equal(req.body.assumptions.aov,800);
  assert.equal(req.body.assumptions.areaSqFt,900); assert.equal(req.body.assumptions.investment,10000);
  assert.equal(req.body.assumptions.travelTimeMinutes,15); assert.equal(req.body.assumptions.targetDemographics,'Test audience');
  assert.equal(req.body.assumptions.evidenceClass,'user_assumption');
  assert.match(h.host.textContent,/routing|route source/i);
  assert.match(h.host.querySelector('[data-map-forecast]').textContent,/Hypothetical test forecast/);
  assert.equal(h.map.getSource('market-geographies').data.features[0].properties.color,'#185a44');
});

test('late map and detail responses cannot overwrite a new year or selected geography', async t => {
  let resolveOld, resolveDetail;
  const h = setup(url => {
    if (url.includes('/geographies/a')) return new Promise(r=>{resolveDetail=r;});
    if (url.includes('/geographies/b')) return feature('b',220);
    if (url.includes('year=2027')) return levels([feature('new',220)]);
    return new Promise(r=>{resolveOld=r;});
  }); t.after(() => { h.controller.destroy(); h.dom.window.close(); });
  await tick(); h.controller.setYear(2027); await tick(); resolveOld(levels([feature('old',10)])); await tick();
  assert.equal(h.map.getSource('market-geographies').data.features[0].id,'new');
  h.controller.selectGeography('a'); await tick(); h.controller.selectGeography('b'); await tick(); resolveDetail(feature('a',120)); await tick();
  assert.match(h.host.querySelector('[data-map-detail]').textContent,/Test area b/);
  assert.doesNotMatch(h.host.querySelector('[data-map-detail]').textContent,/Test area a/);
});

test('API failure clears old values and offers retry without fabricating features', async t => {
  let fail = false;
  const h = setup(() => { if(fail) throw Error('API offline'); return levels(); });
  t.after(() => { h.controller.destroy(); h.dom.window.close(); }); await tick(); fail = true;
  h.controller.setMetric('tam'); await tick();
  assert.equal(h.map.getSource('market-geographies').data.features.length,0);
  assert.match(h.host.querySelector('[data-map-status]').textContent,/API offline/);
  assert.ok(h.host.querySelector('[data-map-retry]'));
});

test('search filters only loaded areas, exposes keyboard selection and destroy ignores pending work', async t => {
  const h = setup(); await tick();
  const input = h.host.querySelector('[data-map-search]'); input.value='area a'; input.dispatchEvent(new h.window.Event('input'));
  assert.equal(h.host.querySelectorAll('[data-map-result]').length,1); h.click('[data-map-result]'); await tick();
  assert.match(h.host.querySelector('[data-map-detail]').textContent,/Test area a/);
  h.controller.destroy(); assert.equal(h.map.removed,true); h.dom.window.close();
});

test('Expansion Intelligence navigation preserves classic applicant flow and loads self-hosted assets', async t => {
  const dom = new JSDOM(read('dist/index.html'), { url:'http://localhost/#overview', runScripts:'outside-only' });
  t.after(()=>dom.window.close()); const w=dom.window;
  w.maplibregl=mapDouble();
  w.fetch=async url=>({ok:!String(url).startsWith('/api/workspaces'),status:String(url).startsWith('/api/workspaces')?404:200,json:async()=>String(url)==='demo.json'?JSON.parse(read('dist/demo.json')):levels()});
  for (const file of ['engine.js','bot.js','persistence.js','market-map.js','app.js']) {
    assert.ok(fs.existsSync(path.join(root,'dist',file)),`${file} exists`); w.eval(read('dist/'+file));
  }
  await tick(); await tick();
  const nav = w.document.querySelector('[data-tab="expansion"]'); assert.ok(nav,'dedicated Expansion Intelligence tab');
  assert.equal(nav.textContent.trim(),'Expansion Intelligence'); nav.click(); await tick();
  assert.ok(w.document.querySelector('[data-map-canvas]'));
  assert.equal(w.document.querySelector('.policy-banner'),null);
  const activeMap=w.maplibregl.Map.instances.at(-1);
  w.document.querySelector('[data-tab="applications"]').click(); await tick();
  assert.equal(activeMap.removed,true); assert.match(w.document.querySelector('main').textContent,/Applications|applications/);
  assert.ok(w.document.querySelector('link[rel="modulepreload"][href="vendor/maplibre-gl.js"]'));
  assert.ok(w.document.querySelector('link[href="vendor/maplibre-gl.css"]'));
  assert.ok(fs.existsSync(path.join(root,'dist/vendor/maplibre-LICENSE.txt')));
});

test('additional investment layers request their own metric and show missing evidence, vintage and resolution', async t => {
  const f = feature('a',120); f.metrics.incomeProxy = { value:null, evidenceClass:'unavailable', warnings:['No compatible income proxy evidence'] };
  f.evidence[0].geographicResolution = 'state survey';
  const h = setup(url => url.includes('/geographies/') ? f : levels([f]));
  t.after(() => { h.controller.destroy(); h.dom.window.close(); }); await tick();
  const expected = [
    ['incomeProxy', /purchasing power|income proxy/i], ['revenuePerKm2', /revenue.*km/i],
    ['saturation', /saturation/i], ['growthPotential3Year', /3.year growth/i], ['growthPotential5Year', /5.year growth/i]
  ];
  for (const [key, title] of expected) {
    const option = h.host.querySelector(`[name="metric"] option[value="${key}"]`);
    assert.ok(option,`Layer ${key} must be selectable`); assert.match(option.textContent,title);
    h.change('[name="metric"]',key); await tick();
    assert.equal(new URL(h.requests.at(-1).url,'http://localhost').searchParams.get('metric'),key);
    assert.equal(h.map.getSource('market-geographies').data.features[0].properties.color,'#b9c1c5');
  }
  h.controller.selectGeography('a'); await tick();
  const detail = h.host.querySelector('[data-map-detail]');
  assert.match(detail.textContent,/Source year.*2011/s); assert.match(detail.textContent,/Geographic resolution.*state survey/s);
  assert.match(detail.textContent,/No compatible income proxy evidence/);
  assert.match(detail.textContent,/Missing evidence/);
});

test('global city/PIN search uses the bounded API and opens an unloaded geography at its parent level', async t => {
  const city = feature('remote-city',null,'city','remote-district');
  const h = setup(url => {
    if (url.includes('/search?')) return { results:[city] };
    if (url.includes('/geographies/remote-city')) return city;
    if (url.includes('parentId=remote-district')) return levels([city],'city');
    return levels();
  }); t.after(() => { h.controller.destroy(); h.dom.window.close(); }); await tick();
  const input = h.host.querySelector('[data-map-global-query]'); assert.ok(input,'Global search field');
  input.value='570001';
  h.host.querySelector('[data-map-global-form]').dispatchEvent(new h.window.Event('submit',{bubbles:true,cancelable:true})); await tick();
  const search = new URL(h.requests.find(r=>r.url.includes('/search?')).url,'http://localhost');
  assert.equal(search.searchParams.get('q'),'570001'); assert.equal(search.searchParams.get('limit'),'20');
  h.click('[data-map-global-result]'); await tick();
  assert.match(h.host.querySelector('[data-map-detail]').textContent,/Test area remote-city/);
  const scoped = h.requests.find(r=>r.url.includes('/levels?')&&r.url.includes('parentId=remote-district'));
  assert.ok(scoped); assert.equal(new URL(scoped.url,'http://localhost').searchParams.get('zoom'),'9');
});

test('older global search results cannot overwrite the latest search or survive destruction', async t => {
  let resolveOld;
  const h=setup(url=> url.includes('q=old') ? new Promise(r=>{resolveOld=r;}) : url.includes('/search?') ? {results:[feature('new-result',null,'pin','city')]} : levels());
  t.after(()=>h.dom.window.close()); await tick();
  const query=h.host.querySelector('[data-map-global-query]'); assert.ok(query,'Global search field');
  const form=h.host.querySelector('[data-map-global-form]');
  query.value='old'; form.dispatchEvent(new h.window.Event('submit',{bubbles:true,cancelable:true})); await tick();
  query.value='new'; form.dispatchEvent(new h.window.Event('submit',{bubbles:true,cancelable:true})); await tick();
  resolveOld({results:[feature('old-result',null)]}); await tick();
  assert.match(h.host.querySelector('[data-map-global-results]').textContent,/new-result/);
  assert.doesNotMatch(h.host.querySelector('[data-map-global-results]').textContent,/old-result/);
  h.controller.destroy();
});

test('destroy aborts pending requests and remount never accepts the old map response', async t => {
  let complete;
  const h=setup(()=>new Promise(resolve=>{complete=resolve;})); t.after(()=>h.dom.window.close()); await tick();
  const signal=h.requests[0].signal; h.controller.destroy(); assert.equal(signal.aborted,true);
  const second=h.window.MarketMap.mountPage({container:h.host,workspaceId:'test-workspace',options:{fetch:async()=>({ok:true,json:async()=>levels([feature('remounted',220)])})}});
  const secondMap=h.window.maplibregl.Map.instances.at(-1); secondMap.fire('load'); await tick();
  complete(levels([feature('destroyed-response',1)])); await tick();
  assert.equal(secondMap.getSource('market-geographies').data.features[0].id,'remounted');
  assert.doesNotMatch(h.host.textContent,/destroyed-response/); second.destroy();
});

test('global result can drill after detail arrives before its sibling geometry load', async t => {
  let completeLevel;
  const city=feature('remote',null,'city','remote-parent');
  const h=setup(url=>url.includes('/search?')?{results:[city]}:url.includes('/geographies/')?city:url.includes('parentId=remote-parent')?new Promise(r=>{completeLevel=r;}):levels());
  t.after(()=>{h.controller.destroy();h.dom.window.close();}); await tick();
  h.host.querySelector('[data-map-global-query]').value='city'; h.host.querySelector('[data-map-global-form]').dispatchEvent(new h.window.Event('submit',{bubbles:true,cancelable:true})); await tick();
  h.click('[data-map-global-result]'); await tick(); completeLevel(levels([city],'city')); await tick();
  assert.equal(h.host.querySelector('[data-map-drill]').disabled,false);
});
