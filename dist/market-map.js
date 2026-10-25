'use strict';
(function (root) {
  const MISSING = '#b9c1c5';
  const LEVELS = ['state', 'district', 'city', 'pin', 'catchment'];
  const ZOOMS = [3.5, 6, 9, 12, 14];
  const METRICS = {
    population: 'Population', populationDensity: 'Population density', households: 'Households',
    monthlyPerCapitaSpend: 'Monthly per-capita clothing & footwear spend', incomeProxy: 'Purchasing power / income proxy · modeled', apparelExpenditure: 'Annual clothing & footwear expenditure · estimated', tam: 'Annual TAM · modeled',
    sam: 'Annual SAM · modeled', som: 'Annual SOM · modeled', competitorCount: 'Competition · supply indicator', saturation: 'Competition / saturation',
    revenue: 'Store revenue · scenario', revenuePerKm2: 'Expected franchise revenue per km² · scenario',
    growthPotential3Year: '3-year growth potential · scenario', growthPotential5Year: '5-year growth potential · scenario',
    breakEvenRevenue: 'Break-even revenue', paybackMonths: 'Payback · months',
    viability: 'Market viability score'
  };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const numeric = value => typeof value === 'number' && Number.isFinite(value);
  const metricValue = metric => numeric(metric) ? metric : numeric(metric?.value) && metric.status !== 'unavailable' ? metric.value : null;
  const display = metric => {
    const value = metricValue(metric);
    return value === null ? 'Unavailable' : value.toLocaleString('en-IN', { maximumFractionDigits: 2 }) + (metric?.unit ? ' ' + metric.unit : '');
  };
  const label = key => METRICS[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  const safeUrl = value => {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
    catch { return null; }
  };
  const list = value => Array.isArray(value) ? value : value ? [value] : [];
  function boundedCache(limit) {
    const entries=new Map();
    return {
      get(key) { const value=entries.get(key); if (!value) return null; entries.delete(key); entries.set(key,value); return value; },
      set(key,value) { entries.delete(key); entries.set(key,value); while(entries.size>limit) entries.delete(entries.keys().next().value); },
      clear() { entries.clear(); }
    };
  }
  const levelCache=boundedCache(32), detailCache=boundedCache(24);
  let latestSourceVersion=null, dbPromise;
  function openGeometryDb() {
    if (!root.indexedDB) return Promise.resolve(null);
    if (!dbPromise) dbPromise=new Promise(resolve=>{
      try {
        const request=root.indexedDB.open('franchiseos-public-geography-v1',1);
        request.onupgradeneeded=()=>request.result.createObjectStore('geometry',{keyPath:'key'});
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>resolve(null);
        request.onblocked=()=>resolve(null);
      } catch { resolve(null); }
    });
    return dbPromise;
  }
  async function geometryRecord(key) {
    const db=await openGeometryDb(); if (!db) return null;
    return new Promise(resolve=>{
      try { const request=db.transaction('geometry','readonly').objectStore('geometry').get(key); request.onsuccess=()=>resolve(request.result||null); request.onerror=()=>resolve(null); }
      catch { resolve(null); }
    });
  }
  async function saveGeometry(key,sourceVersion,features) {
    const db=await openGeometryDb(); if (!db) return;
    const geometries=Object.fromEntries(features.filter(f=>f.geometry).map(f=>[f.id,f.geometry]));
    try { db.transaction('geometry','readwrite').objectStore('geometry').put({key,sourceVersion,geometries,savedAt:Date.now()}); } catch { /* Private browsing can disable IndexedDB writes. */ }
  }
  async function clearGeometry() {
    const db=await openGeometryDb(); if (!db) return;
    try { db.transaction('geometry','readwrite').objectStore('geometry').clear(); } catch { /* Memory and API remain available. */ }
  }
  function evidenceHTML(value) {
    const rows = list(value);
    return rows.length ? `<ul class="expansion-sources">${rows.map(e => {
      if (typeof e === 'string') return `<li>${escape(e)}</li>`;
      const url = safeUrl(e.url || e.sourceUrl), title = escape(e.title || e.dataset || e.sourceId || 'Source');
      return `<li>${url ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${title} ↗</a>` : title}
        <small>${[e.publisher, e.evidenceClass, e.referenceYear || e.referenceDate || e.referencePeriod || e.vintage, e.geographicResolution || e.geography?.level, e.sourceVersion, e.allocationMethod, e.uncertainty].filter(v => v !== undefined && v !== null).map(escape).join(' · ')}</small>
        ${e.caveats || e.warnings ? `<small>${list(e.caveats || e.warnings).map(escape).join(' · ')}</small>` : ''}</li>`;
    }).join('')}</ul>` : '<p class="hint">Source evidence unavailable.</p>';
  }
  function metricHTML(key, metric) {
    return `<div class="expansion-metric"><span>${escape(label(key))}</span><strong>${escape(display(metric))}</strong>
      <small>${escape(metric?.evidenceClass || (metricValue(metric) === null ? 'unavailable' : 'Evidence class unavailable'))}${metric?.referenceYear || metric?.referencePeriod ? ' · ' + escape(metric.referenceYear || metric.referencePeriod) : ''}</small>
      ${metricValue(metric) === null ? '<small>Missing evidence: no compatible source or complete model inputs at this resolution.</small>' : ''}
      ${metric?.warnings ? `<small>${list(metric.warnings).map(escape).join(' · ')}</small>` : ''}
      ${metric?.evidence ? evidenceHTML(metric.evidence) : ''}</div>`;
  }
  function geographyHTML(raw) {
    const geo = raw?.geography || raw || {}, metrics = raw?.metrics || geo.metrics || {};
    const evidence = list(raw?.evidence || geo.evidence), years = [...new Set([...evidence.map(e => e.referenceYear || e.referencePeriod || e.vintage), ...Object.values(metrics).map(m => m?.referenceYear || m?.referencePeriod)].filter(Boolean))];
    const resolutions = [...new Set(evidence.map(e => e.geographicResolution || e.geography?.level).filter(Boolean))];
    const groups = [
      ['Demographics', ['population','populationDensity','households','malePopulation','femalePopulation','ageGroups']],
      ['Spend and modeled demand', ['monthlyPerCapitaSpend','incomeProxy','apparelExpenditure','tam','sam','som']],
      ['Competition and store economics', ['competitorCount','saturation','revenue','revenuePerKm2','breakEvenRevenue','paybackMonths','viability']],
      ['Growth scenarios', ['growthPotential3Year','growthPotential5Year']]
    ];
    return `<h3>${escape(geo.name || geo.id || 'Selected geography')}</h3><p class="hint">${escape(geo.level || '')} · Confidence: ${escape(raw?.confidence || geo.confidence || 'unavailable')} · ${escape(raw?.sourceVersion || geo.sourceVersion || 'Source version unavailable')}</p>
      <p class="hint">Source year: ${escape(years.join(', ') || 'Unavailable')}<br>Geographic resolution: ${escape(resolutions.join(', ') || 'Source resolution unavailable')} · Selected area: ${escape(geo.level || 'unavailable')}</p>
      ${groups.map(([title, keys]) => `<h4>${title}</h4><div class="expansion-metrics">${keys.map(key => metricHTML(key, metrics[key])).join('')}</div>`).join('')}
      ${(raw?.demographics || geo.demographics) ? `<h4>Detailed demographic distribution</h4>${reportHTML(raw?.demographics || geo.demographics)}` : '<p class="hint">Detailed age, gender and household distributions are unavailable at this geographic resolution.</p>'}
      <details><summary>Evidence, vintage and allocation</summary>${evidenceHTML(raw?.evidence || geo.evidence)}${raw?.warnings ? `<p>${list(raw.warnings).map(escape).join(' · ')}</p>` : ''}</details>`;
  }
  function reportHTML(value) {
    if (value === null || value === undefined) return '<span class="muted">Unavailable</span>';
    if (typeof value !== 'object') return escape(value);
    if ('value' in value) return `<strong>${escape(display(value))}</strong><small>${escape(value.evidenceClass || '')}</small>`;
    if (Array.isArray(value)) return `<ul>${value.map(row => `<li>${reportHTML(row)}</li>`).join('')}</ul>`;
    return `<dl class="expansion-report">${Object.entries(value).filter(([key]) => !['geometry','coordinates'].includes(key)).map(([key,item]) => `<div><dt>${escape(label(key))}</dt><dd>${reportHTML(item)}</dd></div>`).join('')}</dl>`;
  }
  function normalizeLegend(legend) {
    if (!legend || !Array.isArray(legend.thresholds) || !Array.isArray(legend.colors)) return null;
    if (legend.scope && legend.scope !== 'national') return null;
    const { thresholds, colors } = legend;
    if (!thresholds.every((v,i) => numeric(v) && (i === 0 || v > thresholds[i-1])) || colors.length !== thresholds.length + 1) return null;
    if (!colors.every(c => /^#[0-9a-f]{6}$/i.test(c))) return null;
    return { ...legend, thresholds: [...thresholds], colors: [...colors] };
  }
  function colorFor(value, legend) {
    if (value === null || !legend) return MISSING;
    let i = 0; while (i < legend.thresholds.length && value >= legend.thresholds[i]) i++;
    return legend.colors[i];
  }
  function boundsFor(geometry) {
    const points = [];
    function walk(coords) {
      if (!Array.isArray(coords)) return;
      if (numeric(coords[0]) && numeric(coords[1])) points.push(coords);
      else coords.forEach(walk);
    }
    walk(geometry?.coordinates);
    if (!points.length) return null;
    return [[Math.min(...points.map(p=>p[0])), Math.min(...points.map(p=>p[1]))], [Math.max(...points.map(p=>p[0])), Math.max(...points.map(p=>p[1]))]];
  }

  // Map adapter: owns WebGL and popups; API loading and market assumptions live in mountPage.
  function mount({ container, onSelect = () => {}, onViewport = () => {}, options = {} }) {
    const lib = options.maplibre || root.maplibregl;
    if (!lib) throw Error('Self-hosted MapLibre is unavailable. Reload to retry.');
    let features = [], metric = options.metric || 'apparelExpenditure', legend = normalizeLegend(options.legend), selected = null, ready = false, destroyed = false, popup, dataSignature=null;
    const map = new lib.Map({ container, center: [79,22], zoom: ZOOMS[0], minZoom: 2, maxZoom: 17,
      style: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#edf2f1' } }] },
      attributionControl: true });
    map.addControl(new lib.NavigationControl(), 'top-right');
    const data = () => ({ type: 'FeatureCollection', features: features.filter(f => f.geometry).map(f => ({ type: 'Feature', id: String(f.id), geometry: f.geometry,
      properties: { id: String(f.id), name: f.name, level: f.level, color: colorFor(metricValue(f.metrics?.[metric]), legend),
        ...Object.fromEntries(Object.entries(f.metrics||{}).filter(([,value])=>metricValue(value)!==null).map(([key,value])=>['v_'+key,metricValue(value)])) } })) });
    const highlight = () => { if (ready && !destroyed) map.setFilter('market-selected', ['==', ['get','id'], selected === null ? '' : String(selected)]); };
    const update = () => { if (ready && !destroyed) { map.getSource('market-geographies').setData(data()); highlight(); } };
    const paint = () => {
      if (!ready || destroyed) return;
      const expression=legend ? ['case',['has','v_'+metric],['step',['get','v_'+metric],legend.colors[0],...legend.thresholds.flatMap((threshold,index)=>[threshold,legend.colors[index+1]])],MISSING] : MISSING;
      map.setPaintProperty('market-fill','fill-color',expression);
      map.setPaintProperty('market-points','circle-color',expression);
    };
    function showPopup(event) {
      const id = event.features?.[0]?.properties?.id ?? event.features?.[0]?.id, geo = features.find(f => String(f.id) === String(id));
      if (!geo) return;
      popup?.remove(); popup = new lib.Popup({ closeButton: true, maxWidth: '310px' }).setLngLat(event.lngLat)
        .setHTML(`<div class="expansion-popup"><strong>${escape(geo.name)}</strong><p>${escape(label(metric))}: ${escape(display(geo.metrics?.[metric]))}</p><small>Confidence: ${escape(geo.confidence || 'unavailable')}</small>${evidenceHTML(geo.evidence)}</div>`).addTo(map);
    }
    map.on('load', () => {
      if (destroyed) return;
      map.addSource('market-geographies', { type: 'geojson', data: data() });
      map.addLayer({ id: 'market-fill', type: 'fill', source: 'market-geographies', paint: { 'fill-color': ['get','color'], 'fill-opacity': 0.82 } });
      map.addLayer({ id: 'market-outline', type: 'line', source: 'market-geographies', paint: { 'line-color': '#ffffff', 'line-width': 1 } });
      map.addLayer({ id: 'market-points', type: 'circle', source: 'market-geographies', filter: ['==',['geometry-type'],'Point'], paint: { 'circle-color': ['get','color'], 'circle-radius': 7, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
      map.addLayer({ id: 'market-selected', type: 'line', source: 'market-geographies', paint: { 'line-color': '#143f35', 'line-width': 3 }, filter: ['==',['get','id'],''] });
      ready = true; update(); paint();
    });
    for (const layer of ['market-fill','market-points']) {
      map.on('click', layer, event => { const id = event.features?.[0]?.properties?.id ?? event.features?.[0]?.id; if (id !== undefined) { selected = id; highlight(); showPopup(event); onSelect(String(id)); } });
      map.on('mouseenter', layer, event => { map.getCanvas().style.cursor = 'pointer'; showPopup(event); });
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
    }
    map.on('moveend', () => { if (!destroyed) onViewport({ zoom: map.getZoom(), bounds: map.getBounds().toArray() }); });
    map.on('error', event => options.onError?.(event.error || Error('Map rendering failed.')));
    return {
      setMetric(value) { metric = value; popup?.remove(); paint(); },
      setYear() { popup?.remove(); }, setScenario() { popup?.remove(); },
      setLegend(value) { legend = normalizeLegend(value); paint(); },
      setFeatures(value,meta) {
        features = Array.isArray(value) ? value : []; popup?.remove();
        const signature=meta ? JSON.stringify([meta.sourceVersion,meta.group,features.map(f=>[f.id,Object.entries(f.metrics||{}).map(([key,item])=>[key,metricValue(item)])])]) : null;
        if (!signature || signature!==dataSignature) { dataSignature=signature; update(); }
        paint();
      },
      selectGeography(id) { selected = id; highlight(); },
      focusGeography(geo, zoom) {
        if (geo?.geometry?.type==='Point') { map.flyTo({center:geo.geometry.coordinates,zoom:Math.max(zoom,ZOOMS[2]),duration:600}); return; }
        const bounds = boundsFor(geo?.geometry); if (bounds) map.fitBounds(bounds, { padding: 48, maxZoom: zoom, zoom, duration: 600 });
      },
      reset() { map.fitBounds([[67,6],[98,37]], { padding: 20, zoom: ZOOMS[0], maxZoom: ZOOMS[0], duration: 0 }); },
      destroy() { destroyed = true; popup?.remove(); map.remove(); }
    };
  }

  function pageHTML(year) {
    return `<div class="page-heading"><div><div class="eyebrow">INDIA · APPAREL & FASHION</div><h1>Expansion Intelligence</h1><p>Explore market evidence, test assumptions and compare places.</p></div><span class="tag green">Separate from applicant eligibility</span></div>
      <div class="expansion-layout"><section class="expansion-workspace" aria-label="Expansion map">
        <div class="expansion-toolbar panel"><label>Map layer<select class="input" name="metric">${Object.entries(METRICS).map(([key,title]) => `<option value="${key}">${title}</option>`).join('')}</select></label>
          <label>Analysis year<input class="input" name="year" type="number" min="2011" max="2100" step="1" value="${year}"></label>
          <button class="button small" type="button" data-map-national>India · reset</button></div>
        <section class="panel expansion-place-search"><form data-map-global-form><label>Find a place across India<input class="input" data-map-global-query type="search" minlength="2" maxlength="100" required placeholder="State, district, city or PIN"></label><button class="button small" type="submit">Search India ↗</button></form><div data-map-global-results aria-live="polite"></div></section>
        <div class="expansion-map-frame panel"><div class="expansion-map" data-map-canvas aria-label="India market map. Use the area list for keyboard selection."></div>
          <div class="expansion-map-caption">Boundaries: geoBoundaries simplified ADM1 · CC BY 2.5 India · underlying source: DataMeet India / Election Commission of India. Values: Census 2011 and MoSPI HCES 2023-24. Annual expenditure is a market estimate, not store sales.</div></div>
        <div class="expansion-legend panel" data-map-legend aria-label="Fixed national scale"></div>
        <div class="expansion-status" role="status" aria-live="polite" data-map-status>Loading sourced state aggregates…</div>
        <div class="expansion-breadcrumbs" data-map-path></div>
        <div class="panel expansion-area-list"><label>Search loaded areas<input class="input" type="search" data-map-search placeholder="Name or source ID"></label><p class="hint">Select a state, then drill into districts, cities, PINs and available catchments. Search covers the loaded level only.</p><div data-map-results class="expansion-results"></div></div>
        <details class="panel expansion-assumptions" open><summary>Scenario assumptions</summary>
          <p class="hint">Every editable input is a user assumption. Blank inputs stay missing. Market totals are modeled spend, and store revenue is a scenario projection.</p>
          <form data-map-scenario-form><div class="market-grid">
            <label>Horizon · assumption<select class="input" name="horizonYears"><option value="0">Baseline</option><option value="3">3 years</option><option value="5">5 years</option></select></label>
            <label>Scenario case · assumption<select class="input" name="scenario"><option value="base">Base</option><option value="conservative">Conservative</option><option value="optimistic">Optimistic</option></select></label>
            <label>Elasticity · assumption<select class="input" name="elasticity">${[0.5,0.75,1,1.25].map(v => `<option value="${v}" ${v===1?'selected':''}>${v.toFixed(2)}</option>`).join('')}</select></label>
            <label>Apparel segment · assumption<select class="input" name="apparelSegment"><option value="value-fashion">Value fashion</option><option value="mass-market-family-apparel" selected>Mass-market family apparel</option><option value="mid-market-casualwear">Mid-market casualwear</option><option value="premium-fashion">Premium fashion</option><option value="ethnic-occasion-wear">Ethnic and occasion wear</option><option value="childrens-apparel">Children's apparel</option><option value="footwear-accessories">Footwear and accessories</option></select></label>
            <label>Target demographics · assumption<input class="input" name="targetDemographics" placeholder="Describe audience; no unsupported splits"></label>
            <label>Capture rate · fraction, assumption<input class="input" type="number" name="captureRate" min="0" max="1" step="any" placeholder="0–1"></label>
            <label>AOV · ₹/transaction, assumption<input class="input" type="number" name="aov" min="0.01" step="any" placeholder="Missing"></label>
            <label>Store size · sq ft, assumption<input class="input" type="number" name="areaSqFt" min="0.01" step="any" placeholder="Missing"></label>
            <label>Investment · ₹, assumption<input class="input" type="number" name="investment" min="0" step="any" placeholder="Missing"></label>
            <label>Working capital · ₹, assumption<input class="input" type="number" name="workingCapital" min="0" step="any" placeholder="Missing"></label>
            <label>Monthly fixed costs · ₹, assumption<input class="input" type="number" name="monthlyFixedCosts" min="0" step="any" placeholder="Missing"></label>
            <label>Gross margin · 0–1, assumption<input class="input" type="number" name="grossMargin" min="0" max="1" step="any" placeholder="Missing"></label>
            <label>Royalty rate · 0–1, assumption<input class="input" type="number" name="royaltyRate" min="0" max="1" step="any" placeholder="Missing"></label>
            <label>Store conversion · 0–1, assumption<input class="input" type="number" name="conversionRate" min="0" max="1" step="any" placeholder="Missing"></label>
            <label>Passing pedestrian traffic · people/month, assumption<input class="input" type="number" name="monthlyPassingPedestrianTraffic" min="0" step="any" placeholder="Missing"></label>
            <label>Entry rate · 0–1, assumption<input class="input" type="number" name="entryRate" min="0" max="1" step="any" placeholder="Missing"></label>
            <label>Sales ramp · months, assumption<input class="input" type="number" name="salesRampMonths" min="1" max="120" step="1" value="6"></label>
            <label>Opening month run-rate · 0–1, assumption<input class="input" type="number" name="initialRampFraction" min="0" max="1" step="any" value="0.4"></label>
            <label>Annual nominal growth · fraction, assumption<input class="input" type="number" name="annualNominalGrowth" min="-0.99" step="any" placeholder="Missing"></label>
            <label>Annual inflation · fraction, assumption<input class="input" type="number" name="annualInflation" min="-0.99" step="any" placeholder="Missing"></label>
            <label>Discount rate · fraction, assumption<input class="input" type="number" name="discountRate" min="-0.99" step="any" placeholder="Missing"></label>
            <label>Travel time · minutes, assumption<input class="input" type="number" name="travelTimeMinutes" min="1" max="120" step="1" placeholder="Requires routing source"></label>
          </div><p class="hint">Travel-time input is an assumption, not a computed drive-time catchment. A routing source is required to draw travel-time boundaries. Radius bands, if supplied, are distance proxies.</p>
          <div class="market-actions"><button class="button primary" data-map-apply>Apply scenario</button><span class="hint" data-map-scenario-status>Default elasticity 1.00 · other inputs missing</span></div></form>
          <div data-map-forecast class="expansion-forecast" aria-live="polite"></div></details>
      </section><aside class="expansion-side" aria-label="Geography details and comparison">
        <section class="panel expansion-detail"><div data-map-detail aria-live="polite"><h2>Select an area</h2><p class="hint">Inspect the evidence before drawing an investment conclusion. Missing metrics stay unavailable.</p></div>
          <div class="market-actions"><button class="button small" data-map-drill disabled>Explore next level ↘</button><button class="button small" data-map-add-compare disabled>Add to comparison</button></div></section>
        <section class="panel expansion-compare"><h2>Compare places</h2><p class="hint">Select 2–4 areas. Overlap and missing evidence must be reviewed.</p><div data-map-compare-list></div><button class="button small" data-map-compare disabled>Compare selected</button><div data-map-comparison aria-live="polite"></div></section>
        <section class="panel expansion-research"><h2>Market research</h2><p class="hint">Gemini search-grounded context supplements sourced statistics and does not change calculations.</p><div data-map-research aria-live="polite"><p>Select a location to load research.</p></div><button class="button small" type="button" data-map-refresh-research disabled>Refresh research</button>
          <form data-map-ask-form><label>Ask Market Intelligence<textarea class="input" name="question" rows="3" maxlength="2000" required placeholder="What evidence supports this opportunity? What additional evidence is needed?"></textarea></label><button class="button small" type="submit" data-map-ask disabled>Ask</button></form><div data-map-answer aria-live="polite"></div></section>
      </aside></div>`;
  }

  function mountPage({ container, workspaceId, options = {} }) {
    let year = options.year || new Date().getFullYear(), metric = 'apparelExpenditure', scenario = 'base', appliedScenario = 'base';
    let features = [], selected = null, selectedDetail = null, path = [], zoom = ZOOMS[0], bounds;
    let destroyed = false, contextRevision = 0, levelRevision = 0, detailRevision = 0, compareRevision = 0, scenarioRevision = 0, searchRevision = 0, researchRevision = 0, searchResults = [];
    let level = 'state', sourceVersion=latestSourceVersion, currentLegend, map, geometryGroup=null, loadedRequestKey=null;
    const legends = new Map(), compared = new Map(), aborters = new Map();
    container.innerHTML = pageHTML(year);
    const $ = selector => container.querySelector(selector);
    const status = text => { $('[data-map-status]').textContent = text; };
    const clearResults = () => { $('[data-map-comparison]').innerHTML = ''; $('[data-map-forecast]').innerHTML = ''; };
    const childIndex = () => path.length ? Math.min(LEVELS.indexOf(path.at(-1).level) + 1, LEVELS.length-1) : 0;
    async function request(kind, endpoint, body) {
      aborters.get(kind)?.abort();
      const controller = new AbortController(); aborters.set(kind, controller);
      const response = await (options.fetch || root.fetch.bind(root))(endpoint, { signal: controller.signal,
        ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(result.error || `Market map API returned ${response.status}`);
      return result;
    }
    function currentAssumptions() {
      const values = new FormData($('[data-map-scenario-form]')), assumptions = { evidenceClass:'user_assumption' };
      for (const key of ['elasticity','captureRate','aov','areaSqFt','investment','workingCapital','monthlyFixedCosts','grossMargin','royaltyRate','conversionRate','monthlyPassingPedestrianTraffic','entryRate','salesRampMonths','initialRampFraction','annualNominalGrowth','annualInflation','discountRate','travelTimeMinutes']) { const value = values.get(key); if (value !== '') assumptions[key] = Number(value); }
      const targetDemographics = String(values.get('targetDemographics') || '').trim(); if (targetDemographics) assumptions.targetDemographics = targetDemographics;
      return assumptions;
    }
    function citationsHTML(citations) {
      return list(citations).map(c => { const url = safeUrl(c?.url); return url ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(c.title || url)} ↗</a>` : ''; }).filter(Boolean).join(' · ');
    }
    function researchHTML(result) {
      const cards = list(result.cards);
      return `${result.cached ? '<p class="hint">Cached research</p>' : ''}${cards.map(card => `<article class="expansion-insight"><h3>${escape(card.headline)}</h3><p>${escape(card.insight)}</p><p><strong>Action:</strong> ${escape(card.implication)}</p><small>Evidence strength: ${escape(card.confidence)} · ${escape(card.referenceDate || result.retrievedAt || 'date unavailable')}</small><div>${citationsHTML(list(card.evidenceUrls).map(url => (result.citations || []).find(c => c.url === url)).filter(Boolean))}</div></article>`).join('') || '<p class="hint">No cited research cards were returned.</p>'}<small>Retrieved ${escape(result.retrievedAt || 'date unavailable')} · model ${escape(result.modelVersion || 'unavailable')}</small>`;
    }
    async function loadResearch(geographyId, refresh = false) {
      const revision = ++researchRevision;
      $('[data-map-research]').innerHTML = '<p>Searching public sources and checking evidence…</p>';
      $('[data-map-refresh-research]').disabled = false; $('[data-map-ask]').disabled = false;
      try {
        const result = await request('research', `/api/market/map/geographies/${encodeURIComponent(geographyId)}/research`, { segment:$('[name="apparelSegment"]').value, assumptions:currentAssumptions(), refresh });
        if (destroyed || revision !== researchRevision || selected !== String(geographyId)) return;
        $('[data-map-research]').innerHTML = researchHTML(result);
      } catch (error) {
        if (destroyed || revision !== researchRevision || selected !== String(geographyId) || error.name === 'AbortError') return;
        $('[data-map-research]').innerHTML = `<p class="hint">${escape(error.message)} Research is optional; sourced metrics and forecasts remain available.</p>`;
      }
    }
    async function askMarket(question) {
      if (!selected) return;
      $('[data-map-answer]').textContent = 'Checking assessment evidence…';
      try {
        const result = await request('ask', `/api/market/map/geographies/${encodeURIComponent(selected)}/ask`, { question, segment:$('[name="apparelSegment"]').value, assumptions:currentAssumptions() });
        $('[data-map-answer]').innerHTML = `<p>${escape(result.answer || 'No answer returned.')}</p><div>${citationsHTML(result.citations)}</div><small>${escape(result.cached ? 'Cached' : 'Retrieved')} ${escape(result.retrievedAt || '')} · ${escape(result.modelVersion || '')}</small>`;
      } catch (error) { if (error.name !== 'AbortError') $('[data-map-answer]').innerHTML = `<p class="hint">${escape(error.message)} Check the research configuration and selected location.</p>`; }
    }
    function renderLegend() {
      $('[data-map-legend]').innerHTML = `<strong>Fixed national scale · ${escape(label(metric))} · ${escape(year)}</strong><div class="expansion-legend-items">${currentLegend ? currentLegend.colors.map((color,i) => {
        const low = i ? currentLegend.thresholds[i-1].toLocaleString('en-IN') : null, high = currentLegend.thresholds[i]?.toLocaleString('en-IN');
        return `<span><i style="background:${color}"></i>${escape(low === null ? '< ' + high : high === undefined ? '≥ ' + low : low + ' – < ' + high)}</span>`;
      }).join('') : '<span>National thresholds unavailable; values remain gray.</span>'}<span><i style="background:${MISSING}"></i>Missing / unavailable</span></div><small>${escape(currentLegend?.unit || '')} · Vintage is shown in evidence, not implied by the analysis year.</small>`;
    }
    function renderAreas() {
      const term = $('[data-map-search]').value.trim().toLowerCase();
      $('[data-map-results]').innerHTML = features.filter(f => `${f.name} ${f.id}`.toLowerCase().includes(term)).map(f => `<button class="expansion-area" type="button" data-map-result="${escape(f.id)}" aria-pressed="${String(f.id)===String(selected)}"><span>${escape(f.name)}</span><small>${escape(display(f.metrics?.[metric]))}</small></button>`).join('') || '<p class="hint">No matching sourced areas at this level.</p>';
      $('[data-map-path]').textContent = ['India', ...path.map(f => f.name)].join(' › ');
    }
    function renderCompared() {
      $('[data-map-compare-list]').innerHTML = [...compared.values()].map(f => `<div class="expansion-compare-item"><span>${escape(f.name)}</span><button class="text-button" type="button" data-map-remove="${escape(f.id)}" aria-label="Remove ${escape(f.name)}">Remove</button></div>`).join('');
      $('[data-map-compare]').disabled = compared.size < 2;
    }
    function updateSelectionActions() {
      const loaded = features.find(f => String(f.id) === selected);
      $('[data-map-drill]').disabled = !selectedDetail || !loaded || LEVELS.indexOf(loaded.level) >= LEVELS.length-1;
      $('[data-map-add-compare]').disabled = !selectedDetail || compared.has(selected) || compared.size >= 4;
    }
    function acceptLevels(data) {
      if (!Array.isArray(data?.features) || !LEVELS.includes(data.level)) throw Error('Map API returned an invalid geography level.');
      // Defend the national view even if a backend accidentally returns all PINs.
      const expected = LEVELS[childIndex()];
      if (data.level !== expected || data.features.some(f => f.level !== expected)) throw Error(`Expected ${expected} aggregates; refusing unexpected geography level.`);
      if (sourceVersion && data.sourceVersion && data.sourceVersion !== sourceVersion) {
        levelCache.clear(); detailCache.clear(); void clearGeometry();
      }
      sourceVersion = data.sourceVersion; latestSourceVersion=sourceVersion; level = data.level;
      const key = metric + ':' + year, legend = normalizeLegend(data.legend);
      if (!legends.has(key) && legend && (!legend.metric || legend.metric === metric) && (!legend.year || Number(legend.year) === Number(year))) legends.set(key, legend);
      currentLegend = legends.get(key) || null; map?.setLegend(currentLegend);
      features = data.features;
      if (features.some(feature=>feature.geometry)) map?.setFeatures(features,{sourceVersion:data.sourceVersion,group:geometryGroup});
      renderLegend(); renderAreas(); updateSelectionActions();
      status(features.length ? `${features.length} ${level} areas · source ${sourceVersion || 'version unavailable'}. Missing values are gray.` : `No sourced ${level} features available for this selection. Missing evidence is not zero.`);
    }
    async function loadLevels() {
      const revision = ++levelRevision, context = contextRevision;
      const parent = path.at(-1);
      // Only one child level per selected parent. Zooming into India cannot fetch PINs.
      const requestZoom = ZOOMS[childIndex()];
      const query = new URLSearchParams({ zoom: String(requestZoom), metric, year: String(year), scenario: appliedScenario });
      if (parent) query.set('parentId', parent.id);
      const requestedLevel=LEVELS[childIndex()];
      if (bounds && ['pin','catchment'].includes(requestedLevel)) query.set('bbox', bounds.flat().join(','));
      const endpoint='/api/market/map/levels?' + query;
      const group=JSON.stringify([parent?.id||null,requestedLevel,query.get('bbox')||null]);
      const cacheKey=(sourceVersion||'unknown')+'|'+endpoint;
      aborters.get('levels')?.abort();
      if (loadedRequestKey===cacheKey) return;
      const cached=levelCache.get(cacheKey);
      if (cached && Date.now()-cached.at<300000) {
        geometryGroup=group; acceptLevels(cached.data); loadedRequestKey=cacheKey; return;
      }
      status(`Updating ${parent ? 'children of ' + parent.name : 'state aggregates'}… Existing geography remains visible.`);
      try {
        let geometry=geometryGroup===group && features.some(f=>f.geometry)
          ? {sourceVersion,geometries:Object.fromEntries(features.filter(f=>f.geometry).map(f=>[f.id,f.geometry]))}
          : await geometryRecord(group);
        if (destroyed || revision!==levelRevision || context!==contextRevision) return;
        let result=await request('levels',endpoint+(geometry?'&geometry=none':''));
        if (destroyed || revision!==levelRevision || context!==contextRevision) return;
        if (geometry && result.sourceVersion===geometry.sourceVersion) result={...result,features:result.features.map(f=>({...f,geometry:f.geometry||geometry.geometries[f.id]||null}))};
        else if (geometry && result.features.some(f=>!f.geometry)) result=await request('levels',endpoint);
        if (destroyed || revision!==levelRevision || context!==contextRevision) return;
        geometryGroup=group; acceptLevels(result);
        const actualKey=(sourceVersion||'unknown')+'|'+endpoint;
        levelCache.set(actualKey,{at:Date.now(),data:result}); loadedRequestKey=actualKey;
        if (result.features.some(f=>f.geometry)) void saveGeometry(group,sourceVersion,result.features);
      } catch (error) {
        if (destroyed || revision !== levelRevision || context !== contextRevision || error.name === 'AbortError') return;
        $('[data-map-status]').innerHTML = `${escape(error.message)} Existing geography remains visible. <button class="text-button" type="button" data-map-retry>Retry map</button>`;
      }
    }
    async function selectGeography(id) {
      selected = String(id); selectedDetail = null; const revision = ++detailRevision, context = contextRevision;
      map?.selectGeography(selected); renderAreas();
      $('[data-map-drill]').disabled = true; $('[data-map-add-compare]').disabled = true;
      $('[data-map-detail]').innerHTML = '<p>Loading geography evidence…</p>';
      $('[data-map-research]').innerHTML = '<p>Loading location context…</p>'; $('[data-map-answer]').innerHTML = '';
      const query = new URLSearchParams({ workspaceId: workspaceId || '', year: String(year), scenario: appliedScenario });
      try {
        const endpoint=`/api/market/map/geographies/${encodeURIComponent(id)}?${query}`;
        const cacheKey=(sourceVersion||'unknown')+'|'+endpoint;
        const cached=detailCache.get(cacheKey);
        const result=cached && Date.now()-cached.at<300000 ? cached.data : await request('detail',endpoint);
        if (destroyed || revision !== detailRevision || context !== contextRevision) return;
        if (!cached) detailCache.set(cacheKey,{at:Date.now(),data:result});
        selectedDetail = result.geography || result;
        const loaded = features.find(f => String(f.id) === selected);
        selectedDetail = { ...loaded, ...selectedDetail, id: selected };
        $('[data-map-detail]').innerHTML = geographyHTML({ ...result, geography: selectedDetail });
        updateSelectionActions();
        root.dispatchEvent(new root.CustomEvent('franchiseos:location-selected',{detail:{
          id:selectedDetail.id,name:selectedDetail.name,level:selectedDetail.level,
          state:selectedDetail.state || (selectedDetail.level==='state'?selectedDetail.name:null),
          city:selectedDetail.city || (selectedDetail.level==='city'?selectedDetail.name:null),
          pin:selectedDetail.pin || (selectedDetail.level==='pin'?selectedDetail.name:null),
          sourceVersion:result.sourceVersion || sourceVersion || null,
          metrics:selectedDetail.metrics || {},evidence:result.evidence || selectedDetail.evidence || []
        }}));
        loadResearch(selected);
      } catch (error) {
        if (!destroyed && revision === detailRevision && context === contextRevision && error.name !== 'AbortError') $('[data-map-detail]').innerHTML = `<p>${escape(error.message)}</p><button class="text-button" type="button" data-map-retry-detail>Retry detail</button>`;
      }
    }
    function invalidate() {
      contextRevision++; detailRevision++; compareRevision++; scenarioRevision++;
      for (const controller of aborters.values()) controller.abort();
      selectedDetail = null; currentLegend = legends.get(metric + ':' + year) || null;
      appliedScenario = scenario; map?.setScenario(scenario); map?.setMetric(metric); map?.setYear(year); map?.setLegend(currentLegend);
      renderLegend(); clearResults(); $('[data-map-apply]').disabled = false;
      if (selected !== null) selectGeography(selected);
    }
    function setMetric(value) { if (!Object.hasOwn(METRICS,value) || value===metric) return; metric = value; $('[name="metric"]').value = value; invalidate(); loadLevels(); }
    function setYear(value) { if (!Number.isInteger(Number(value)) || value < 2011 || value > 2100) return; year = Number(value); $('[name="year"]').value = year; invalidate(); loadLevels(); }
    function setScenario(value) { scenario = String(value); $('[name="scenario"]').value = value; invalidate(); loadLevels(); }
    async function compare() {
      if (compared.size < 2) return;
      const revision = ++compareRevision, context = contextRevision;
      $('[data-map-comparison]').textContent = 'Comparing sourced areas…';
      try {
        const result = await request('compare', '/api/market/map/compare', { workspaceId, geographyIds: [...compared.keys()], year, metric, scenario: appliedScenario });
        if (destroyed || revision !== compareRevision || context !== contextRevision) return;
        $('[data-map-comparison]').innerHTML = list(result.geographies || result.features).map(geographyHTML).join('') + reportHTML(Object.fromEntries(Object.entries(result).filter(([k])=>!['geographies','features'].includes(k))));
      } catch (error) { if (!destroyed && revision === compareRevision && context === contextRevision && error.name !== 'AbortError') $('[data-map-comparison]').textContent = error.message; }
    }
    async function applyScenario(event) {
      event.preventDefault(); const form = $('[data-map-scenario-form]');
      if (!form.reportValidity()) return;
      const values = new FormData(form), assumptions = { evidenceClass: 'user_assumption' };
      for (const key of ['elasticity','captureRate','aov','areaSqFt','investment','workingCapital','monthlyFixedCosts','grossMargin','royaltyRate','conversionRate','monthlyPassingPedestrianTraffic','entryRate','salesRampMonths','initialRampFraction','annualNominalGrowth','annualInflation','discountRate','travelTimeMinutes']) { const value = values.get(key); if (value !== '') assumptions[key] = Number(value); }
      if (String(values.get('targetDemographics') || '').trim()) assumptions.targetDemographics = String(values.get('targetDemographics')).trim();
      assumptions.apparelSegment = String(values.get('apparelSegment') || 'mass-market-family-apparel');
      const revision = ++scenarioRevision, context = ++contextRevision;
      levelRevision++; detailRevision++; compareRevision++; for (const c of aborters.values()) c.abort();
      clearResults(); status('Calculating scenario… Existing geography remains visible.');
      $('[data-map-apply]').disabled = true; $('[data-map-scenario-status]').textContent = 'Calculating on the server…';
      try {
        const result = await request('scenario', '/api/market/map/scenario', { workspaceId, geographyIds: selected ? [selected] : [], parentId: path.at(-1)?.id, zoom: ZOOMS[childIndex()], metric, year,
          scenario: values.get('scenario'), horizonYears: Number(values.get('horizonYears')), assumptions });
        if (destroyed || revision !== scenarioRevision || context !== contextRevision) return;
        appliedScenario = result.scenarioId || result.scenario?.id || String(values.get('scenario')); map?.setScenario(appliedScenario);
        if (result.map) acceptLevels(result.map); else await loadLevels();
        if (destroyed || revision !== scenarioRevision || context !== contextRevision) return;
        $('[data-map-forecast]').innerHTML = `<h3>Server scenario · projection</h3>${result.forecast ? reportHTML(result.forecast) : '<p>Forecast unavailable: required evidence or inputs may be missing.</p>'}${result.warnings ? reportHTML(result.warnings) : ''}`;
        $('[data-map-scenario-status]').textContent = 'Applied user assumptions · server results';
        if (selected) selectGeography(selected);
      } catch (error) {
        if (!destroyed && revision === scenarioRevision && context === contextRevision && error.name !== 'AbortError') { $('[data-map-scenario-status]').textContent = error.message; status('Scenario unavailable. Apply again or reload a map layer.'); }
      } finally { if (!destroyed && revision === scenarioRevision) $('[data-map-apply]').disabled = false; }
    }
    try {
      map = mount({ container: $('[data-map-canvas]'), onSelect: selectGeography, onViewport(view) {
        zoom = view.zoom; bounds = view.bounds;
        // Coarsen when zooming out; zooming in still requires explicit parent selection.
        let changed = false;
        while (path.length && zoom < ZOOMS[childIndex()] - 0.5) { path.pop(); changed = true; }
        if (changed) { selected = null; invalidate(); }
        loadLevels(); options.onViewport?.(view);
      }, options: { ...options, onError(error) { status(`Map rendering unavailable: ${error.message}. Use the loaded area list to inspect evidence.`); } } });
    } catch (error) { $('[data-map-canvas]').innerHTML = `<div class="expansion-map-unavailable">${escape(error.message)} Use the area list below to inspect sourced data.</div>`; }
    container.addEventListener('click', onClick);
    function onClick(event) {
      const button = event.target.closest('button'); if (!button) return;
      const d = button.dataset;
      if ('mapGlobalResult' in d) {
        const geo = searchResults.find(f => String(f.id) === d.mapGlobalResult); if (!geo) return;
        const index = LEVELS.indexOf(geo.level);
        if (index >= 0 && (index === 0 || geo.parentId)) {
          path = index === 0 ? [] : Array.isArray(geo.ancestors) && geo.ancestors.length ? geo.ancestors : [{ id: geo.parentId, name: `Parent of ${geo.name}`, level: LEVELS[index-1] }];
          selected = null; invalidate(); zoom = ZOOMS[index]; bounds = undefined;
          if (geo.geometry) map?.focusGeography(geo, zoom);
          loadLevels();
        }
        selectGeography(geo.id);
      }
      if ('mapResult' in d) { selectGeography(d.mapResult); const geo=features.find(f=>String(f.id)===d.mapResult); if(geo) map?.focusGeography(geo, ZOOMS[Math.max(0,LEVELS.indexOf(geo.level))]); }
      if ('mapRetry' in d) loadLevels();
      if ('mapRetryDetail' in d && selected) selectGeography(selected);
      if ('mapDrill' in d && selectedDetail) {
        const geo = features.find(f => String(f.id) === selected); if (!geo || LEVELS.indexOf(geo.level) >= 4) return;
        path.push(geo); selected = null; invalidate(); map?.selectGeography(null);
        $('[data-map-detail]').innerHTML = '<h2>Select an area</h2><p class="hint">Inspect a child geography.</p>';
        $('[data-map-drill]').disabled = true; $('[data-map-add-compare]').disabled = true;
        zoom = ZOOMS[childIndex()]; map?.focusGeography(geo,zoom); loadLevels();
      }
      if ('mapNational' in d) { path = []; selected = null; zoom = ZOOMS[0]; bounds = undefined; invalidate(); map?.selectGeography(null); map?.reset(); $('[data-map-detail]').innerHTML = '<h2>Select an area</h2>'; $('[data-map-drill]').disabled = true; $('[data-map-add-compare]').disabled = true; loadLevels(); }
      if ('mapAddCompare' in d && selectedDetail && compared.size < 4) { compared.set(selected,selectedDetail); compareRevision++; $('[data-map-comparison]').innerHTML = ''; renderCompared(); button.disabled = true; }
      if ('mapRemove' in d) { compared.delete(d.mapRemove); compareRevision++; $('[data-map-comparison]').innerHTML = ''; renderCompared(); $('[data-map-add-compare]').disabled = !selectedDetail || compared.has(selected) || compared.size>=4; }
      if ('mapCompare' in d) compare();
      if ('mapRefreshResearch' in d && selected) loadResearch(selected, true);
    }
    function submitQuestion(event) { event.preventDefault(); const question = $('[name="question"]').value.trim(); if (question) askMarket(question); }
    $('[data-map-search]').addEventListener('input', renderAreas);
    $('[data-map-global-form]').addEventListener('submit', searchPlaces);
    $('[data-map-ask-form]').addEventListener('submit', submitQuestion);
    async function searchPlaces(event) {
      event.preventDefault();
      const query = $('[data-map-global-query]').value.trim(); if (query.length < 2) return;
      const revision = ++searchRevision; searchResults = [];
      $('[data-map-global-results]').textContent = 'Searching sourced places…';
      try {
        const result = await request('search', '/api/market/map/search?' + new URLSearchParams({ q: query, limit: '20' }));
        if (destroyed || revision !== searchRevision) return;
        searchResults = list(result.results || result.features || result.geographies || (Array.isArray(result) ? result : [])).slice(0,20);
        $('[data-map-global-results]').innerHTML = searchResults.length ? searchResults.map(f => {
          const hierarchy=[...list(f.ancestors).map(item=>item.name),f.name || f.id].join(' › ');
          const coverage=f.geometry?.type==='Point' ? 'verified reference point; local market statistics unavailable' : f.geometry ? 'mapped boundary' : 'boundary unavailable';
          return `<button type="button" class="expansion-area" data-map-global-result="${escape(f.id)}"><span>${escape(f.name || f.id)}</span><small>${escape(f.level || 'Resolution unavailable')} · ${escape(hierarchy)} · ${escape(coverage)}</small></button>`;
        }).join('') : result.queryType==='pin'&&result.coverage==='not_verified'
          ? '<p class="hint">Valid PIN format, but no verified postal directory mapping or boundary is available here. Search a city or state to inspect sourced geography.</p>'
          : '<p class="hint">No sourced places match this search. Try another city or PIN.</p>';
      } catch (error) { if (!destroyed && revision === searchRevision && error.name !== 'AbortError') $('[data-map-global-results]').textContent = `Place search unavailable: ${error.message}`; }
    }
    container.addEventListener('change', onChange);
    function onChange(event) {
      const { name, value } = event.target;
      if (name === 'metric') setMetric(value);
      else if (name === 'year') setYear(Number(value));
      else if (event.target.closest('[data-map-scenario-form]')) {
        scenarioRevision++; aborters.get('scenario')?.abort(); $('[data-map-apply]').disabled = false;
        $('[data-map-scenario-status]').textContent = 'Inputs edited · apply scenario to recalculate';
        $('[data-map-forecast]').innerHTML = '';
      }
    }
    $('[data-map-scenario-form]').addEventListener('submit', applyScenario);
    renderLegend(); renderCompared(); loadLevels();
    return { setMetric, setYear, setScenario, selectGeography,
      setFeatures(value) { features = Array.isArray(value) ? value : []; map?.setFeatures(features); renderAreas(); },
      destroy() { destroyed = true; contextRevision++; searchRevision++; researchRevision++; for (const c of aborters.values()) c.abort(); map?.destroy(); container.removeEventListener('click',onClick); container.removeEventListener('change',onChange); $('[data-map-search]')?.removeEventListener('input',renderAreas); $('[data-map-global-form]')?.removeEventListener('submit',searchPlaces); $('[data-map-ask-form]')?.removeEventListener('submit',submitQuestion); $('[data-map-scenario-form]')?.removeEventListener('submit',applyScenario); }
    };
  }
  root.MarketMap = { mount, mountPage };
})(typeof globalThis === 'undefined' ? this : globalThis);
