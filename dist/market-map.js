'use strict';
(function (root) {
  const MISSING = root.MarketColorScale?.MISSING_COLOR || '#b9c1c5';
  const LEVELS = ['state', 'district', 'city', 'pin', 'catchment'];
  const ZOOMS = [3.5, 6, 9, 12, 14];
  const METRICS = {
    potentialRevenue: 'Potential revenue · modeled', population: 'Population', populationDensity: 'Population density', households: 'Households',
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
    if (value === null) return 'Unavailable';
    const unit=String(metric?.unit||'');
    if (/^(?:INR|₹)/i.test(unit) && root.FranchiseDisplay) return root.FranchiseDisplay.money(value,unit);
    if (/^(?:people|households)$/i.test(unit) && root.FranchiseDisplay) return `${root.FranchiseDisplay.count(value)} ${unit}`;
    return value.toLocaleString('en-IN', { maximumFractionDigits: 2 }) + (unit ? ' ' + unit : '');
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
    const causeLabels = { source_unavailable:'Source unavailable', not_integrated:'Source not integrated', geography_mismatch:'Geography mismatch', missing_calculation_dependency:'Missing calculation dependency', api_database_failure:'API/database failure', user_input_required:'User input required' };
    const gap = metricValue(metric) === null ? `${causeLabels[metric?.missing?.cause] || 'Evidence unavailable'}: ${metric?.missing?.nextAction || 'Use a compatible source or provide required inputs, then recalculate.'}` : '';
    return `<div class="expansion-metric"><span>${escape(label(key))}</span><strong>${escape(display(metric))}</strong>
      <small>${escape(metric?.evidenceClass || (metricValue(metric) === null ? 'unavailable' : 'Evidence class unavailable'))}${metric?.referenceYear || metric?.referencePeriod ? ' · ' + escape(metric.referenceYear || metric.referencePeriod) : ''}</small>
      ${gap ? `<small>${escape(gap)}</small>` : ''}
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
  function reportHTML(value, key = '') {
    if (value === null || value === undefined) return '<span class="muted">Unavailable</span>';
    if (typeof value !== 'object') {
      if (numeric(value) && /(?:revenue|investment|cash.?flow|profit|cost|income|expenditure|market|tam|sam|som|npv|budget|working.?capital|sales)/i.test(key) && root.FranchiseDisplay) return escape(root.FranchiseDisplay.money(value, 'INR'));
      return escape(value);
    }
    if ('value' in value) return `<strong>${escape(display(value))}</strong><small>${escape(value.evidenceClass || '')}</small>`;
    if (Array.isArray(value)) return `<ul>${value.map(row => `<li>${reportHTML(row,key)}</li>`).join('')}</ul>`;
    return `<dl class="expansion-report">${Object.entries(value).filter(([key]) => !['geometry','coordinates'].includes(key)).map(([child,item]) => `<div><dt>${escape(label(child))}</dt><dd>${reportHTML(item,child)}</dd></div>`).join('')}</dl>`;
  }
  function normalizeLegend(legend) {
    if (!legend || !Array.isArray(legend.thresholds) || !Array.isArray(legend.colors)) return null;
    if (legend.scope && legend.scope !== 'national') return null;
    const { thresholds, colors } = legend;
    if (!thresholds.every((v,i) => numeric(v) && (i === 0 || v > thresholds[i-1])) || colors.length !== thresholds.length + 1) return null;
    if (!colors.every(c => /^#[0-9a-f]{6}$/i.test(c))) return null;
    return { ...legend, thresholds: [...thresholds], colors: [...colors] };
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
  // Globe + satellite + terrain view; PIN polygons for the viewport are loaded here at PIN_MIN_ZOOM.
  const PIN_MIN_ZOOM = 8;
  const EXTRUSION_HEIGHT = { state: 320000, district: 120000, city: 30000, pin: 3500, catchment: 1500 };
  const COLUMN_ZOOM_SCALE = { area: [[3,1],[6,0.3],[8,0.03],[10,0]], pin: [[8,1],[12,0.45],[15,0.2]] };
  const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  const TERRARIUM_ATTRIBUTION = 'Terrain: Mapzen / AWS Terrain Tiles (SRTM, GMTED, ETOPO1)';
  // Snap the viewport outward to a 0.05° grid so small pans reuse the cached PIN request.
  function pinBbox(bounds) {
    const [[w,s],[e,n]] = bounds, snap = 20, clamp = (v,min,max) => Math.min(max,Math.max(min,v));
    const box = [clamp(Math.floor(w*snap)/snap,-180,180), clamp(Math.floor(s*snap)/snap,-85,85), clamp(Math.ceil(e*snap)/snap,-180,180), clamp(Math.ceil(n*snap)/snap,-85,85)];
    return box[0] < box[2] && box[1] < box[3] ? box.map(v => Number(v.toFixed(2))) : null;
  }
  function mount({ container, onSelect = () => {}, onViewport = () => {}, options = {} }) {
    const lib = options.maplibre || root.maplibregl;
    if (!lib) throw Error('Self-hosted MapLibre is unavailable. Reload to retry.');
    const basemap=options.basemap||root.FRANCHISEOS_BASEMAP_CONFIG||{};
    const tileUrl=typeof basemap.tileUrl==='string'&&/^https:\/\//i.test(basemap.tileUrl)&&/\{z\}.*\{x\}.*\{y\}/.test(basemap.tileUrl)?basemap.tileUrl:'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    const attribution=typeof basemap.attribution==='string'&&basemap.attribution.trim()?basemap.attribution:'© OpenStreetMap contributors';
    const reducedMotion=!!root.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const motion=duration=>reducedMotion?0:duration;
    const fetcher=options.fetch||root.fetch?.bind(root);
    const pinDebounce=Number.isFinite(options.pinDebounceMs)?options.pinDebounceMs:250;
    let features = [], pinFeatures = [], metric = options.metric || 'potentialRevenue', popupYear=Number(options.year)||2026, popupSegment=options.segment||'Apparel & fashion', legend = normalizeLegend(options.legend), colorMode='linear', scaleScope='national', selected = null, ready = false, destroyed = false, popup, lastPopup=null, dataSignature=null, scaleMeta=null, basemapMode='satellite', extruded=options.extruded!==false, pinState='idle', pinKey=null, pinTimer=null, pinAbort=null, pinRevision=0;
    const popupContexts=new Map(), pinCache=boundedCache(24);
    const demSource=basemap.terrainSource&&typeof basemap.terrainSource==='object'?basemap.terrainSource:{type:'raster-dem',tiles:[TERRARIUM_URL],encoding:'terrarium',tileSize:256,maxzoom:15,attribution:TERRARIUM_ATTRIBUTION};
    const map = new lib.Map({ container, center: [80,21], zoom: reducedMotion ? ZOOMS[0] : 1.6, minZoom: 1, maxZoom: 17, pitch: reducedMotion ? 30 : 0, bearing: 0, maxPitch: 75,
      style: { version: 8, projection: { type: 'globe' },
        sky: { 'sky-color': '#0b2a4a', 'horizon-color': '#9cc6ec', 'fog-color': '#cfe3f5', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.5, 'fog-ground-blend': 0.85, 'atmosphere-blend': ['interpolate',['linear'],['zoom'],0,1,7,1,11,0] },
        terrain: { source: 'terrain-dem', exaggeration: 1.3 },
        sources: {
          satelliteImagery:{type:'raster',tiles:[basemap.satelliteTileUrl||'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,maxzoom:19,attribution:basemap.satelliteAttribution||'Sources: Esri, DigitalGlobe, GeoEye, i-cubed, USDA FSA, USGS, AEX, Getmapping, Aerogrid, IGN, IGP, swisstopo, and the GIS User Community'},
          openStreetMap:{type:'raster',tiles:[tileUrl],tileSize:256,attribution},
          terrainBasemap:{type:'raster',tiles:[basemap.terrainTileUrl||'https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'],tileSize:256,attribution:basemap.terrainAttribution||'Sources: Esri, DeLorme, HERE, TomTom, Intermap, GEBCO, USGS, FAO, NPS, NRCAN, IGN, Kadaster NL, Ordnance Survey, Esri Japan, METI, swisstopo, MapmyIndia, GIS User Community'},
          // Separate DEM sources for terrain mesh and hillshade, as MapLibre recommends.
          'terrain-dem': { ...demSource },
          'hillshade-dem': { ...demSource }
        },
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#0d1b26' } },
          { id:'satellite-basemap',type:'raster',source:'satelliteImagery',paint:{'raster-opacity':1} },
          { id:'street-basemap',type:'raster',source:'openStreetMap',layout:{visibility:'none'},paint:{'raster-opacity':0.92} },
          { id:'terrain-basemap',type:'raster',source:'terrainBasemap',layout:{visibility:'none'},paint:{'raster-opacity':1} },
          { id:'terrain-hillshade',type:'hillshade',source:'hillshade-dem',paint:{'hillshade-exaggeration':0.25,'hillshade-shadow-color':'#0b1620','hillshade-highlight-color':'#ffffff'} }
        ] },
      attributionControl: true });
    map.addControl(new lib.NavigationControl({ visualizePitch: true }), 'top-right');
    if (lib.GlobeControl) map.addControl(new lib.GlobeControl(), 'top-right');
    if (lib.TerrainControl) map.addControl(new lib.TerrainControl({ source: 'terrain-dem', exaggeration: 1.3 }), 'top-right');
    const doc = container.ownerDocument || root.document;
    const extrusionButton = doc.createElement('button');
    extrusionButton.type='button'; extrusionButton.className='expansion-map-extrusion-toggle'; extrusionButton.dataset.mapExtrusion='';
    const syncExtrusionButton=()=>{ extrusionButton.textContent=extruded?'3D':'2D'; extrusionButton.setAttribute('aria-pressed',String(extruded)); extrusionButton.setAttribute('aria-label',extruded?'Show heatmap as flat 2D fill':'Show heatmap as 3D columns'); extrusionButton.title=extrusionButton.getAttribute('aria-label'); };
    syncExtrusionButton();
    extrusionButton.addEventListener('click',()=>setExtruded(!extruded));
    const extrusionControl={ onAdd(){ const group=doc.createElement('div'); group.className='maplibregl-ctrl maplibregl-ctrl-group'; group.append(extrusionButton); return group; }, onRemove(){ extrusionButton.parentNode?.remove(); } };
    map.addControl(extrusionControl, 'top-right');
    const pinStatus = doc.createElement('div');
    pinStatus.className='expansion-pin-status'; pinStatus.setAttribute('role','status'); pinStatus.setAttribute('aria-live','polite'); pinStatus.dataset.mapPinStatus=''; pinStatus.hidden=true;
    container.append(pinStatus);
    const setPinStatus=(state,text='')=>{ pinState=state; pinStatus.dataset.state=state; pinStatus.textContent=text; pinStatus.hidden=!text; };

    const collection = list => ({ type: 'FeatureCollection', features: list.filter(f => f.geometry).map(f => ({ type: 'Feature', id: String(f.id), geometry: f.geometry,
      properties: { id: String(f.id), name: f.name, level: f.level,
        ...Object.fromEntries(Object.entries(f.metrics||{}).filter(([,value])=>metricValue(value)!==null).map(([key,value])=>['v_'+key,metricValue(value)])) } })) });
    const hasMetric = (list,key) => list.some(f => metricValue(f.metrics?.[key]) !== null);
    // potentialRevenue is the default heatmap; until the API supplies it, fall back to category expenditure.
    const activeMetric = () => metric==='potentialRevenue' && !hasMetric(features,metric) && !hasMetric(pinFeatures,metric) ? 'apparelExpenditure' : metric;
    const pinsVisible = () => pinFeatures.length > 0 && map.getZoom() >= PIN_MIN_ZOOM;
    const layerSets = { state: { fill:'market-fill', extrusion:'market-extrusion', outline:'market-outline', points:'market-points', selected:'market-selected' },
      pin: { fill:'market-pin-fill', extrusion:'market-pin-extrusion', outline:'market-pin-outline', selected:'market-pin-selected' } };
    const interactiveLayers = () => ['market-extrusion','market-fill','market-points','market-pin-extrusion','market-pin-fill'].filter(id => map.getLayer(id));
    const setVisibility = (id, visible) => { if (map.getLayer(id)) map.setLayoutProperty(id,'visibility',visible?'visible':'none'); };
    const applyVisibility = () => {
      if (!ready || destroyed) return;
      const pins = pinsVisible();
      setVisibility('market-fill', !extruded); setVisibility('market-extrusion', extruded);
      setVisibility('market-pin-fill', pins && !extruded); setVisibility('market-pin-extrusion', pins && extruded);
      setVisibility('market-pin-outline', pins); setVisibility('market-pin-selected', pins);
      // PINs take over the heatmap; parent areas stay as faint context underneath.
      if (map.getLayer('market-fill')) map.setPaintProperty('market-fill','fill-opacity',pins?0.18:0.78);
      if (map.getLayer('market-extrusion')) map.setPaintProperty('market-extrusion','fill-extrusion-opacity',pins?0.15:0.82);
    };
    const highlight = () => {
      if (!ready || destroyed) return;
      const filter=['==', ['get','id'], selected === null ? '' : String(selected)];
      map.setFilter('market-selected', filter); if (map.getLayer('market-pin-selected')) map.setFilter('market-pin-selected', filter);
    };
    const update = () => { if (ready && !destroyed) { map.getSource('market-geographies').setData(collection(features)); highlight(); } };
    const updatePins = () => { if (ready && !destroyed) { map.getSource('market-pins')?.setData(collection(pinFeatures)); highlight(); applyVisibility(); } };
    // Builds colour and column-height expressions from one MarketColorScale so both always agree.
    function ramp(values, scope, nationalDomain, maxHeight, zoomScale) {
      const colorLib=root.MarketColorScale, key=activeMetric();
      const scale=colorLib.createColorScale({mode:colorMode,scope,values,domain:scope==='national'?nationalDomain:undefined,nationalDomain,colors:colorLib.DEFAULT_COLORS});
      const stops=colorLib.legendLabels(scale,scale.colors.length,{unit:''}).map((item,index)=>({value:item.value,color:scale.colors[index]}));
      const increasing=stops.filter((stop,index)=>index===0||stop.value>stops[index-1].value);
      let input=['get','v_'+key];
      if(colorMode==='log')input=['log10',['max',Math.max(Number.MIN_VALUE,scale.domain[0]),input]];
      const positioned=colorMode==='log'?increasing.map(stop=>({value:Math.log10(Math.max(scale.domain[0],stop.value)),color:stop.color})):increasing;
      const unique=positioned.filter((stop,index)=>index===0||stop.value>positioned[index-1].value);
      const guard=['all',['has','v_'+key],...(colorMode==='log'?[['>', ['get','v_'+key],0]]:[])];
      const color=['case',guard,unique.length>=2?['interpolate',['linear'],input,...unique.flatMap(stop=>[stop.value,stop.color])]:unique[0]?.color||MISSING,MISSING];
      const floor=maxHeight*0.03, last=Math.max(1,unique.length-1);
      const byValue=['case',guard,unique.length>=2?['interpolate',['linear'],input,...unique.flatMap((stop,index)=>[stop.value,floor+(maxHeight-floor)*index/last])]:floor,0];
      // Columns shrink as the camera nears the ground so parent areas never wall off the view.
      const height=['interpolate',['linear'],['zoom'],...zoomScale.flatMap(([zoom,factor])=>[zoom,['*',factor,byValue]])];
      return { color, height, metadata: scale.metadata };
    }
    const flat = (layers, color, height) => {
      if (map.getLayer(layers.fill)) map.setPaintProperty(layers.fill,'fill-color',color);
      if (map.getLayer(layers.extrusion)) { map.setPaintProperty(layers.extrusion,'fill-extrusion-color',color); map.setPaintProperty(layers.extrusion,'fill-extrusion-height',height); }
      if (layers.points && map.getLayer(layers.points)) map.setPaintProperty(layers.points,'circle-color',color);
    };
    const paint = () => {
      if (!ready || destroyed) return;
      const colorLib=root.MarketColorScale, key=activeMetric();
      const values=features.map(f=>metricValue(f.metrics?.[key])).filter(numeric);
      const legendMatches=!legend?.metric||legend.metric===key;
      const extent=values.length?[Math.min(...values),Math.max(...values)]:null;
      const nationalDomain=!legendMatches?(extent&&extent[0]<extent[1]?extent:colorLib?.DEFAULT_NATIONAL_DOMAIN):Array.isArray(legend?.domain)?legend.domain:(legend?.thresholds?.length?[legend.thresholds[0],legend.thresholds.at(-1)]:colorLib?.DEFAULT_NATIONAL_DOMAIN);
      const level=features.find(f=>f.level)?.level||'state';
      if(!colorLib||!nationalDomain){scaleMeta=null;flat(layerSets.state,MISSING,0);flat(layerSets.pin,MISSING,0);return;}
      try {
        const states=ramp(values,scaleScope,nationalDomain,EXTRUSION_HEIGHT[level]||EXTRUSION_HEIGHT.state,COLUMN_ZOOM_SCALE.area);
        scaleMeta=states.metadata; flat(layerSets.state,states.color,states.height);
      } catch { scaleMeta=null; flat(layerSets.state,MISSING,0); }
      // PIN values are orders of magnitude below state totals, so they rescale to the PINs in view.
      const pinValues=pinFeatures.map(f=>metricValue(f.metrics?.[key])).filter(numeric);
      try { const pins=ramp(pinValues,'local',undefined,EXTRUSION_HEIGHT.pin,COLUMN_ZOOM_SCALE.pin); flat(layerSets.pin,pins.color,pins.height); }
      catch { flat(layerSets.pin,MISSING,0); }
    };
    const findGeo = id => features.find(f=>String(f.id)===String(id)) || pinFeatures.find(f=>String(f.id)===String(id));
    const popupLevel=level=>({state:'State',district:'District',city:'City',pin:'PIN code',catchment:'Catchment',national:'National'})[level]||'Geography';
    const popupValue=item=>metricValue(item)===null?'Not estimated':display(item);
    function popupHtml(geo) {
      const context=popupContexts.get(String(geo.id))||{}, selectedGeo=context.geography||geo, metrics=selectedGeo.metrics||geo.metrics||{}, estimate=context.estimate;
      const customerValue=estimate?.metrics?.potentialCustomers;
      const tamValue=estimate?.metrics?.customerTAM;
      const somValue=estimate?.metrics?.customerSOM;
      const tam=metricValue(tamValue)!==null?{...tamValue,unit:tamValue.unit||'INR/year'}:metrics.tam||metrics.apparelExpenditure;
      const som=metricValue(somValue)!==null?{...somValue,unit:somValue.unit||'INR/year'}:metrics.som;
      const customers=metricValue(customerValue)!==null?{...customerValue,unit:customerValue.unit||'people'}:metrics.potentialCustomers;
      const population=metrics.population;
      const catchment=metricValue(customers)!==null?{label:'Estimated customers',metric:customers}:
        metricValue(population)!==null?{label:selectedGeo.level==='catchment'?'Catchment population':'Area population',metric:population}:
        {label:'Customers / population',metric:null};
      const investment=metrics.idealInvestmentPerStore;
      const scope=String(investment?.scope||investment?.investmentScope||selectedGeo.investmentScope||'').toLowerCase();
      const validScope=['brand/store-format-specific','brand_store_format','category-level','category_level'].includes(scope);
      const investmentLabel=scope.startsWith('category')||scope==='category_level'?'Category-level estimate':'Per-store estimate';
      const investmentDisplay=validScope&&metricValue(investment)!==null?popupValue({...investment,unit:investment.unit||'INR/store'}):'Not estimated';
      const componentNames={fitOut:'fit-out',fitout:'fit-out',openingInventory:'opening inventory',inventory:'opening inventory',workingCapital:'working capital',deposit:'deposit',franchiseFee:'franchise fee'};
      const componentSource=investment?.components||selectedGeo.investmentComponents||{};
      const componentSummary=validScope&&componentSource&&typeof componentSource==='object'?Object.entries(componentNames).filter(([key])=>metricValue(componentSource[key])!==null||Number.isFinite(componentSource[key])).map(([key,name])=>`${name} ${display(typeof componentSource[key]==='number'?{value:componentSource[key],unit:'INR'}:componentSource[key])}`):[];
      const growth=metricValue(metrics.growthPotential3Year)!==null?{label:'3-year projected revenue growth',metric:metrics.growthPotential3Year}:
        metricValue(metrics.growthPotential5Year)!==null?{label:'5-year projected revenue growth',metric:metrics.growthPotential5Year}:
        {label:'Revenue growth · forecast',metric:null};
      const classifications=[tam?.evidenceClass,som?.evidenceClass,catchment.metric?.evidenceClass,investment?.evidenceClass,growth.metric?.evidenceClass].filter(Boolean);
      const modelled=classifications.some(value=>['derived_estimate','model_assumption','forecast','estimated'].includes(String(value).toLowerCase()));
      const confidence=String(selectedGeo.confidence||'confidence unavailable');
      const shortConfidence=confidence.length>42?`${confidence.slice(0,39)}…`:confidence;
      const segmentLabel=String(popupSegment).replace(/-/g,' ').replace(/\b[a-z]/g,char=>char.toUpperCase());
      const growthDisplay=metricValue(growth.metric)===null?'Not estimated':`${Number(metricValue(growth.metric)).toLocaleString('en-IN',{maximumFractionDigits:2})}% ${String(growth.metric.unit||'growth').replace(/^%\s*/,'')}`;
      const kpi=(title,value,sub='',prominent=false)=>`<div class="expansion-popup-kpi${prominent?' is-prominent':''}"><span>${escape(title)}</span><strong>${escape(value)}</strong>${sub?`<small>${escape(sub)}</small>`:''}</div>`;
      const status=modelled?'Modelled estimate':classifications.length?'Source-backed estimate':'Evidence unavailable';
      const investmentSub=validScope?[investmentLabel,...componentSummary].join(' · '):'Store-format cost evidence unavailable';
      const layerKey=activeMetric();
      return `<div class="expansion-popup" data-popup-geography="${escape(geo.id)}"><header><strong>${escape(selectedGeo.name||geo.name)}</strong><small>${escape(popupLevel(selectedGeo.level||geo.level))} · ${escape(segmentLabel)} · ${escape(popupYear)} view</small></header><div class="expansion-popup-grid">${kpi('Annual TAM',popupValue(tam),'Apparel category market',true)}${kpi('Annual SOM',popupValue(som),'Territory capture estimate',true)}${kpi(catchment.label,popupValue(catchment.metric),metricValue(customerValue)!==null?'Estimated unique customers · not footfall':'People in selected geography')}${kpi('Ideal investment',investmentDisplay,investmentSub)}${kpi(growth.label,growthDisplay,growth.metric?'Modelled forecast · horizon shown':'No supported growth forecast')}${kpi('Current map layer',popupValue(metrics[layerKey]),label(layerKey))}</div><div class="expansion-popup-status"><span>${status}</span><small>${escape(shortConfidence)}</small></div><button type="button" class="button small primary" data-map-popup-detail="${escape(geo.id)}">View detailed analysis</button></div>`;
    }
    function refreshPopup() {
      if(!lastPopup)return;
      const geo=findGeo(lastPopup.id);if(!geo)return;
      popup?.remove();popup=new lib.Popup({closeButton:true,maxWidth:'380px'}).setLngLat(lastPopup.lngLat).setHTML(popupHtml(geo)).addTo(map);
    }
    function showPopup(event) {
      const id=event.features?.[0]?.properties?.id??event.features?.[0]?.id,geo=findGeo(id);
      if(!geo)return;lastPopup={id:String(id),lngLat:event.lngLat};refreshPopup();
    }
    function addGeographyLayers(source, layers, before) {
      map.addLayer({ id: layers.fill, type: 'fill', source, layout:{visibility:'none'}, paint: { 'fill-color': MISSING, 'fill-opacity': 0.78 } }, before);
      map.addLayer({ id: layers.extrusion, type: 'fill-extrusion', source, layout:{visibility:'none'}, filter: ['!=',['geometry-type'],'Point'],
        paint: { 'fill-extrusion-color': MISSING, 'fill-extrusion-height': 0, 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.82, 'fill-extrusion-vertical-gradient': true } }, before);
      map.addLayer({ id: layers.outline, type: 'line', source, paint: { 'line-color': '#ffffff', 'line-width': ['interpolate',['linear'],['zoom'],3,0.6,10,1.4], 'line-opacity': 0.7 } }, before);
    }
    // Viewport PIN loading: only PINs intersecting the (snapped) view are requested and rendered.
    function requestPins() {
      clearTimeout(pinTimer); pinTimer=null;
      if (!ready || destroyed) return;
      if (map.getZoom() < PIN_MIN_ZOOM) { pinAbort?.abort(); pinRevision++; pinKey=null; setPinStatus('idle'); applyVisibility(); return; }
      pinTimer=setTimeout(loadPins, pinDebounce);
    }
    async function fetchPins(bbox, key) {
      const query=new URLSearchParams({ level:'pin', bbox:bbox.join(','), metric:key, year:String(popupYear) });
      const response=await fetcher('/api/market/map/levels?'+query, { signal: pinAbort.signal });
      const result=await response.json().catch(()=>({}));
      if (!response.ok) { const error=Error(result.error||`Market map API returned ${response.status}`); error.status=response.status; throw error; }
      return result;
    }
    async function loadPins() {
      pinTimer=null;
      if (!ready || destroyed || !fetcher || map.getZoom() < PIN_MIN_ZOOM) return;
      const bbox=pinBbox(map.getBounds().toArray()); if (!bbox) return;
      const key=metric==='potentialRevenue'?'potentialRevenue':activeMetric();
      const cacheKey=JSON.stringify([bbox,key,popupYear]);
      if (cacheKey===pinKey) return;
      pinAbort?.abort(); pinAbort=new AbortController(); const revision=++pinRevision;
      const accept=data=>{
        const valid=data?.level==='pin'&&Array.isArray(data.features)&&data.features.every(f=>f.level==='pin');
        pinFeatures=valid?data.features.filter(f=>f.geometry):[];
        pinKey=cacheKey; updatePins(); paint(); refreshPopup();
        if (pinFeatures.length) setPinStatus('loaded',`${pinFeatures.length.toLocaleString('en-IN')} postcode (PIN) areas in view · colours rescaled to this view`);
        else setPinStatus('unavailable','Postcode (PIN) data unavailable for this view · showing state boundaries. No PIN values are estimated.');
      };
      const cached=pinCache.get(cacheKey);
      if (cached) { accept(cached); return; }
      setPinStatus('loading','Loading postcode (PIN) potential for this view…');
      try {
        let data;
        try { data=await fetchPins(bbox,key); }
        catch (error) { if (error.status===400&&key!=='apparelExpenditure') data=await fetchPins(bbox,'apparelExpenditure'); else throw error; }
        if (destroyed || revision!==pinRevision) return;
        pinCache.set(cacheKey,data); accept(data);
      } catch (error) {
        if (destroyed || revision!==pinRevision || error.name==='AbortError') return;
        pinFeatures=[]; pinKey=null; updatePins();
        setPinStatus('unavailable',`Postcode (PIN) data unavailable: ${error.message} · showing state boundaries.`);
      }
    }
    function setExtruded(value) { extruded=!!value; syncExtrusionButton(); applyVisibility(); }
    map.on('load', () => {
      if (destroyed) return;
      map.addSource('market-geographies', { type: 'geojson', data: collection(features) });
      map.addSource('market-pins', { type: 'geojson', data: collection(pinFeatures), tolerance: 0.6 });
      addGeographyLayers('market-geographies', layerSets.state);
      addGeographyLayers('market-pins', layerSets.pin);
      map.addLayer({ id: 'market-points', type: 'circle', source: 'market-geographies', filter: ['==',['geometry-type'],'Point'], paint: { 'circle-color': MISSING, 'circle-radius': 7, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
      map.addLayer({ id: 'market-selected', type: 'line', source: 'market-geographies', paint: { 'line-color': '#ffd166', 'line-width': 3 }, filter: ['==',['get','id'],''] });
      map.addLayer({ id: 'market-pin-selected', type: 'line', source: 'market-pins', layout:{visibility:'none'}, paint: { 'line-color': '#ffd166', 'line-width': 3 }, filter: ['==',['get','id'],''] });
      ready = true;
      update(); paint(); applyVisibility();
      // Fly in from the globe to India unless the view already moved; reduced motion starts there instead.
      if (!reducedMotion && map.getZoom() < 2) map.flyTo({ center: [79,22], zoom: ZOOMS[0], pitch: 35, bearing: -6, duration: 2600, essential: false });
      requestPins();
    });
    map.on('click', event => {
      const hit=event.features?.[0]||map.queryRenderedFeatures?.(event.point,{layers:interactiveLayers()})?.[0];
      const id=hit?.properties?.id??hit?.id;
      if(id!==undefined){selected=id;highlight();showPopup({...event,features:[hit]});onSelect(String(id));}
    });
    for (const layer of ['market-fill','market-extrusion','market-points','market-pin-fill','market-pin-extrusion']) {
      map.on('mouseenter', layer, event => { map.getCanvas().style.cursor = 'pointer'; showPopup(event); });
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
    }
    map.on('moveend', () => { if (destroyed) return; requestPins(); onViewport({ zoom: map.getZoom(), bounds: map.getBounds().toArray() }); });
    map.on('error', event => options.onError?.(event.error || Error('Map rendering failed.')));
    return {
      setMetric(value) { metric = value; paint(); refreshPopup(); requestPins(); },
      getMetric() { return activeMetric(); },
      setColorMode(value){if(!['linear','log','percentile'].includes(value))return; colorMode=value; paint(); refreshPopup();},
      setScaleScope(value){if(!['national','local'].includes(value))return; scaleScope=value; paint(); refreshPopup();},
      setYear(value) { if(Number.isInteger(Number(value)))popupYear=Number(value);refreshPopup();requestPins(); }, setScenario() { refreshPopup(); },
      setSegment(value){if(typeof value==='string'&&value.trim())popupSegment=value.trim();refreshPopup();},
      setLegend(value) { legend = normalizeLegend(value); paint(); refreshPopup(); },
      refreshDisplay() { paint(); refreshPopup(); },
      setPopupContext(id,value){popupContexts.set(String(id),value||{});refreshPopup();},
      setBasemap(value){
        if(!['street','satellite','terrain'].includes(value))return;
        basemapMode=value;
        setVisibility('street-basemap',value==='street');
        setVisibility('satellite-basemap',value==='satellite');
        setVisibility('terrain-basemap',value==='terrain');
        if(map.getLayer('terrain-hillshade'))map.setPaintProperty('terrain-hillshade','hillshade-exaggeration',value==='terrain'?0.55:value==='satellite'?0.25:0.15);
      },
      getBasemap(){return basemapMode;},
      setTerrain(active){ if(typeof map.setTerrain==='function')map.setTerrain(active?{source:'terrain-dem',exaggeration:1.3}:null); },
      setExtruded, isExtruded(){return extruded;},
      getPinState(){return pinState;},
      setTilt(active){const pitch=active?58:0; if(typeof map.easeTo==='function')map.easeTo({pitch,duration:motion(500)}); else map.setPitch(pitch);},
      resize(){map.resize?.();},
      getScaleMetadata(){return scaleMeta;},
      setFeatures(value,meta) {
        features = Array.isArray(value) ? value : [];
        const signature=meta ? JSON.stringify([meta.sourceVersion,meta.group,features.map(f=>[f.id,Object.entries(f.metrics||{}).map(([key,item])=>[key,metricValue(item)])])]) : null;
        if (!signature || signature!==dataSignature) { dataSignature=signature; update(); }
        paint();refreshPopup();
      },
      selectGeography(id) { selected = id; highlight(); },
      focusGeography(geo, zoom) {
        if (geo?.geometry?.type==='Point') { map.flyTo({center:geo.geometry.coordinates,zoom:Math.max(zoom,ZOOMS[2]),duration:motion(600)}); return; }
        const bounds = boundsFor(geo?.geometry); if (bounds) map.fitBounds(bounds, { padding: 48, maxZoom: zoom, zoom, duration: motion(600) });
      },
      reset() { map.fitBounds([[67,6],[98,37]], { padding: 20, zoom: ZOOMS[0], maxZoom: ZOOMS[0], duration: motion(800) }); },
      destroy() { destroyed = true; clearTimeout(pinTimer); pinAbort?.abort(); pinStatus.remove(); popup?.remove();popupContexts.clear();lastPopup=null; map.remove(); }
    };
  }

  function scenarioFormHTML() {
    return `<form data-map-scenario-form><div class="market-grid">
      <label>Horizon<select class="input" name="horizonYears"><option value="0">Baseline</option><option value="3">3 years</option><option value="5">5 years</option></select></label>
      <label>Scenario<select class="input" name="scenario"><option value="base">Base</option><option value="conservative">Conservative</option><option value="optimistic">Optimistic</option></select></label>
      <label>Income elasticity<select class="input" name="elasticity">${[0.5,0.75,1,1.25].map(v => `<option value="${v}" ${v===1?'selected':''}>${v.toFixed(2)}</option>`).join('')}</select></label>
      <label>Apparel segment<select class="input" name="apparelSegment"><option value="value-fashion">Value fashion</option><option value="mass-market-family-apparel" selected>Mass-market family apparel</option><option value="mid-market-casualwear">Mid-market casualwear</option><option value="premium-fashion">Premium fashion</option><option value="ethnic-occasion-wear">Ethnic and occasion wear</option><option value="childrens-apparel">Children's apparel</option><option value="footwear-accessories">Footwear and accessories</option></select></label>
      ${[['targetDemographics','Target demographics','text'],['captureRate','Market capture · fraction','number'],['aov','Average order value · ₹','number'],['areaSqFt','Store area · sq ft','number'],['investment','Initial investment · ₹','number'],['workingCapital','Working capital · ₹','number'],['monthlyFixedCosts','Monthly fixed costs · ₹','number'],['grossMargin','Gross margin · fraction','number'],['royaltyRate','Royalty · fraction','number'],['conversionRate','Purchase conversion · fraction','number'],['monthlyPassingPedestrianTraffic','Passing visits/month · assumption','number'],['entryRate','Store entry rate · fraction','number'],['salesRampMonths','Ramp-up · months','number'],['initialRampFraction','Initial run-rate · fraction','number'],['annualNominalGrowth','Nominal growth · fraction','number'],['annualInflation','Inflation · fraction','number'],['discountRate','Discount rate · fraction','number'],['travelTimeMinutes','Travel time · requires routing source','number']].map(([name,label,type])=>`<label>${label}<input class="input" type="${type}" name="${name}" ${type==='number'?'step="any" min="0"':''} placeholder="Not sourced"></label>`).join('')}
    </div><p class="hint">These are editable scenario assumptions. PIN population is never treated as passing footfall. Travel-time boundaries require a routing source.</p>
    <div class="market-actions"><button class="button primary" data-map-apply>Calculate financial scenario</button><span class="hint" data-map-scenario-status>Optional · no inputs required for the market snapshot</span></div></form>
    <div data-map-forecast class="expansion-forecast" aria-live="polite"></div>`;
  }
  function pageHTML(year) {
    return `<div class="expansion-screen">
      <div class="expansion-topbar">
        <button class="button small" type="button" data-map-exit>‹ Workspace</button>
        <button class="button small" type="button" data-map-currency-toggle aria-label="Change currency display units">${root.FranchiseDisplay?.toggleLabel?.()||'₹ Millions'}</button>
        <form data-map-global-form class="expansion-search"><label class="sr-only" for="map-place-query">Search states, cities or PIN</label><input id="map-place-query" class="input" data-map-global-query type="search" minlength="2" maxlength="100" required placeholder="Search state, district, city, locality or PIN"><button class="button small" type="submit">Search</button><div data-map-global-results aria-live="polite"></div></form>
        <button class="button small" type="button" data-map-sidebar-toggle aria-expanded="true" aria-label="Collapse market insights">Hide insights</button>
      </div>
      <div class="expansion-map-shell">
        <div class="expansion-map-tools" aria-label="Map controls">
          <label>Metric<select class="input" name="metric">${[['apparelExpenditure','Annual clothing & footwear expenditure'],['tam','TAM'],['sam','SAM'],['som','SOM'],['population','Population'],['populationDensity','Population density'],['monthlyPerCapitaSpend','Per-person spend'],['incomeProxy','Purchasing power'],['competitorCount','Competitor supply'],['saturation','Market saturation'],['revenue','Store revenue scenario'],['revenuePerKm2','Revenue per km²'],['growthPotential3Year','3-year growth'],['growthPotential5Year','5-year growth']].map(([key,title])=>`<option value="${key}" ${key==='apparelExpenditure'?'selected':''}>${title}</option>`).join('')}</select></label>
          <label>Scale<select class="input" data-map-color-mode aria-label="Colour scaling"><option value="linear">Linear</option><option value="log">Logarithmic</option><option value="percentile">Percentile</option></select></label>
          <label>Extent<select class="input" data-map-scale-scope aria-label="Scale geography"><option value="national">Fixed national</option><option value="local">Local rescale</option></select></label>
          <label>Basemap<select class="input" data-map-basemap><option value="satellite" selected>Satellite imagery</option><option value="street">Street</option><option value="terrain">Terrain</option></select></label>
          <button class="button small" type="button" data-map-tilt aria-pressed="false">3D tilt</button><button class="button small" type="button" data-map-national>India</button>
          <label class="map-year">Year<input class="input" name="year" type="number" min="2011" max="2100" value="${year}"></label>
        </div>
        <div class="expansion-map-frame"><div class="expansion-map" data-map-canvas aria-label="Interactive India market map"></div>
          <div class="expansion-map-caption">Boundaries: geoBoundaries simplified ADM1 · CC BY 2.5 India. Market expenditure combines Census 2011 with MoSPI HCES 2023–24 where crosswalks are supported; it is not observed store revenue.</div>
          <div class="expansion-legend" data-map-legend aria-label="Continuous national scale"></div>
          <div class="expansion-status" role="status" aria-live="polite" data-map-status>Loading cached India market metrics…</div>
          <div class="expansion-breadcrumbs" data-map-path>India</div>
        </div>
        <aside class="expansion-side" aria-label="Selected geography market intelligence">
          <div class="expansion-side-head"><div><div class="eyebrow">MARKET INTELLIGENCE</div><h1 data-map-place-title>India</h1><p data-map-place-path>National overview · Apparel & fashion</p></div><button type="button" class="button small" data-map-sidebar-close aria-label="Hide insights">×</button></div>
          <div class="expansion-action-row"><button class="button primary small" type="button" data-map-open-market>Open Market Intelligence</button><button class="button small" type="button" data-map-screen-pin disabled>Screen PIN</button></div>
          <div class="expansion-market-overview" data-map-overview aria-live="polite">
            ${[['tam','Annual category-spend TAM'],['sam','Serviceable market · SAM'],['som','Capturable market · SOM'],['customers','Relevant customers'],['population','Population'],['spending','Annual spend / person'],['competition','Competitor intensity'],['opportunity','Market opportunity']].map(([key,title])=>`<article class="market-kpi" data-market-metric="${key}"><span>${title}</span><strong data-value>${key==='tam'?'Loading…':'—'}</strong><small data-note>${key==='customers'?'Not estimated without category participation evidence':key==='sam'||key==='som'?'Requires a supported serviceable share and capture benchmark':'Selecting sourced geography…'}</small></article>`).join('')}
          </div>
          <p class="expansion-narrative" data-map-narrative>Select an area to review available market evidence. Customer participation, store visits and sales are distinct and will remain unestimated without supporting evidence.</p>
          <div class="market-actions"><button class="button small" data-map-drill disabled>Explore next level ↘</button><button class="button small" data-map-add-compare disabled>Add comparison</button></div>
          <details class="expansion-drawer"><summary>Detailed evidence & methodology</summary><div data-map-detail aria-live="polite"><p class="hint">Select a state or city.</p></div></details>
          <details class="expansion-drawer"><summary>Compare locations <span data-map-compare-count></span></summary><p class="hint">Compare 2–4 places. Overlapping catchments can double-count residents.</p><div data-map-compare-list></div><button class="button small" data-map-compare disabled>Compare selected</button><div data-map-comparison aria-live="polite"></div></details>
          <details class="expansion-drawer"><summary>Grounded local research</summary><div data-map-research aria-live="polite"><p>Select a location to load public research.</p></div><button class="button small" type="button" data-map-refresh-research disabled>Refresh research</button><form data-map-ask-form><label>Ask Market Intelligence<textarea class="input" name="question" rows="2" maxlength="2000" required placeholder="What evidence supports this estimate?"></textarea></label><button class="button small" type="submit" data-map-ask disabled>Ask</button></form><div data-map-answer aria-live="polite"></div></details>
          <details class="expansion-drawer"><summary>Advanced financial scenario</summary><p class="hint">Optional store-level forecast inputs. This does not alter verified market observations.</p>${scenarioFormHTML()}</details>
          <details class="expansion-drawer"><summary>Search areas at this level</summary><label>Filter loaded places<input class="input" type="search" data-map-search placeholder="Name or source ID"></label><div data-map-results class="expansion-results"></div></details>
        </aside>
      </div>
    </div>`;
  }

  function mountPage({ container, workspaceId, options = {} }) {
    let year = options.year || new Date().getFullYear(), metric = 'apparelExpenditure', scenario = 'base', appliedScenario = 'base';
    let features = [], selected = null, selectedDetail = null, path = [], zoom = ZOOMS[0], bounds;
    let destroyed = false, contextRevision = 0, levelRevision = 0, detailRevision = 0, compareRevision = 0, scenarioRevision = 0, searchRevision = 0, researchRevision = 0, searchResults = [], selectedEstimate=null;
    let level = 'state', sourceVersion=latestSourceVersion, currentLegend, map, geometryGroup=null, loadedRequestKey=null;
    const legends = new Map(), compared = new Map(), aborters = new Map();
    let selectedRecord=null, comparisonResult=null, scenarioResult=null;
    container.innerHTML = pageHTML(year);
    const $ = selector => container.querySelector(selector);
    const status = text => { $('[data-map-status]').textContent = text; };
    const clearResults = () => { comparisonResult=null; scenarioResult=null; $('[data-map-comparison]').innerHTML = ''; $('[data-map-forecast]').innerHTML = ''; };
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
      const scale=root.MarketColorScale, mode=$('[data-map-color-mode]')?.value||'linear',scope=$('[data-map-scale-scope]')?.value||'national';
      const domain=map?.getScaleMetadata?.()?.domain||(currentLegend?.thresholds?.length?[currentLegend.thresholds[0],currentLegend.thresholds.at(-1)]:null);
      const gradient=scale?.DEFAULT_COLORS?.map((color,index)=>`${color} ${Math.round(index/(scale.DEFAULT_COLORS.length-1)*100)}%`).join(',')||'#440154,#3b528b,#21918c,#5ec962,#fde725';
      const fmt=value=>/^(?:INR|₹)/i.test(String(currentLegend?.unit||''))&&root.FranchiseDisplay?root.FranchiseDisplay.money(value,currentLegend.unit):`${Number(value).toLocaleString('en-IN',{maximumFractionDigits:2})}${currentLegend?.unit?' '+currentLegend.unit:''}`;
      let ends=domain?`${fmt(domain[0])} <span>to</span> ${fmt(domain[1])}`:'No comparable metric range available';
      if(mode==='percentile')ends='Lower relative rank <span>to</span> higher relative rank among loaded areas';
      const labelText=mode==='percentile'?'Percentile rank within loaded geography level':`${scope==='national'?'Fixed national':'Local rescale'} · ${mode==='log'?'logarithmic':'linear'} scale`;
      $('[data-map-legend]').innerHTML=`<strong>${escape(label(metric))} · ${escape(labelText)}</strong><div class="expansion-gradient" style="background:linear-gradient(90deg,${gradient})" aria-hidden="true"></div><div class="expansion-legend-labels"><span>${ends.split('<span>to</span>')[0]}</span><span>${ends.split('<span>to</span>')[1]||''}</span></div><small>${escape(currentLegend?.unit||'Unit unavailable')} · ${escape(year)} view · Grey means no evidence. Colours show modelled values where marked.</small>`;
    }
    function metricNote(metric, fallback) {
      if(!metric||metricValue(metric)===null)return metric?.missing?.nextAction||fallback;
      const source=list(metric.evidence)[0]||{};
      return [metric.evidenceClass||'classification unavailable',metric.referenceYear||metric.referencePeriod||source.referenceYear||source.referencePeriod||source.vintage].filter(Boolean).join(' · ');
    }
    function renderOverview(raw=null,estimate=null) {
      const geo=raw?.geography||raw||{}, metrics=raw?.metrics||geo.metrics||{};
      $('[data-map-place-title]').textContent=geo.name||'India';
      const geographyLevel=geo.level||'national';
      const hierarchy=[...path.map(item=>item.name),geo.name||'India'].filter((item,index,array)=>index===0||item!==array[index-1]);
      const sourceYears=[...new Set(list(raw?.evidence||geo.evidence).map(item=>item.referenceYear||item.referencePeriod||item.vintage).filter(Boolean))].join(', ');
      $('[data-map-place-path]').textContent=`${hierarchy.join(' · ')} · ${geographyLevel} · ${sourceYears?`evidence ${sourceYears} · `:''}${estimate?.confidence||geo.confidence||'awaiting selected area'}`;
      const categoryTAM=estimate?.metrics?.categoryExpenditureTAM||metrics.apparelExpenditure||metrics.tam;
      const model=estimate?.customerModel, customerTam=estimate?.metrics?.customerTAM;
      const data={
        tam:{metric:categoryTAM,note:categoryTAM?.value===null?'Needs compatible population and clothing/footwear spend evidence':metricNote(categoryTAM,'No compatible market expenditure estimate at this level.')},
        sam:{metric:model?.metrics?.sam?.annualRevenue!==undefined?{value:model.metrics.sam.annualRevenue,unit:'INR/year',evidenceClass:'derived_estimate'}:metrics.sam,note:model?.complete?'Customer-based serviceable share applied':model?.missingInputs?.includes('serviceablePercentage')?'No supported serviceable share is available; category TAM is not store-accessible demand.':metricNote(metrics.sam,'Requires sourced serviceability evidence.')},
        som:{metric:model?.metrics?.som?.annualRevenue!==undefined?{value:model.metrics.som.annualRevenue,unit:'INR/year',evidenceClass:'derived_estimate'}:metrics.som,note:model?.complete?'Customer-based capture share applied':model?.missingInputs?.includes('capturePercentage')?'No comparable capture benchmark is available; regional SOM is not one-store sales.':metricNote(metrics.som,'Requires a sourced capture benchmark.')},
        customers:{metric:estimate?.metrics?.potentialCustomers||null,note:model?.complete?'Population × supported apparel participation rate':'Not estimated: no verified category participation rate or unique-customer evidence.'},
        population:{metric:metrics.population,note:metricNote(metrics.population,'Population is unavailable at this exact geography; no parent population was substituted.')},
        spending:{metric:metrics.monthlyPerCapitaSpend,note:metricNote(metrics.monthlyPerCapitaSpend,'No matching clothing and footwear benchmark at this geography.')},
        competition:{metric:metrics.competitorCount||metrics.saturation,note:metricNote(metrics.competitorCount||metrics.saturation,'Competitor coverage is not integrated for this geography.')},
        opportunity:{metric:metrics.viability,note:metricNote(metrics.viability,'Not scored: comparable demand, competition and feasibility evidence is incomplete.')}
      };
      for(const [key,item] of Object.entries(data)){
        const card=$(`[data-market-metric="${key}"]`);if(!card)continue;
        const metric=item.metric;card.querySelector('[data-value]').textContent=key==='customers'&&metric?.value!==null&&metric?.value!==undefined?`${root.FranchiseDisplay?.count(metric.value)||metric.value} people`:display(metric);
        card.querySelector('[data-note]').textContent=item.note;
      }
      const pop=metrics.population,spend=metrics.monthlyPerCapitaSpend,dam=categoryTAM;
      let narrative;
      if(!geo.name&&!features.length)narrative='India market aggregates are loading. Values will appear only where population and expenditure can be matched to the same defensible geography.';
      else if(metricValue(dam)===null)narrative=`${geo.name||'This selection'} has no defensible category market-size estimate at this level. ${data.tam.note}`;
      else {
        const amount=display(dam),populationText=metricValue(pop)!==null?` The sourced population figure is ${display(pop)}.`:'';
        const spendText=metricValue(spend)!==null?` Regional per-person apparel spend is ${display(spend)}.`:'';
        narrative=`${geo.name||'Covered state areas'} have an estimated annual clothing and footwear expenditure base of ${amount}.${populationText}${spendText} This is category market spend, not unique customer demand or one store's revenue. Customer-based SAM/SOM stay unestimated until participation, segment spend and realistic capture evidence are available.`;
      }
      $('[data-map-narrative]').textContent=narrative;
      const pinButton=$('[data-map-screen-pin]');if(pinButton)pinButton.disabled=!(geographyLevel==='pin'&&geo.pin);
    }
    function renderNationalOverview(){
      const unique=new Map(features.map(item=>[String(item.id),item])),rows=[...unique.values()];
      const aggregate=key=>{
        const available=rows.map(item=>item.metrics?.[key]).filter(item=>metricValue(item)!==null);
        if(!available.length)return null;
        const value=available.reduce((sum,item)=>sum+metricValue(item),0);
        if(!Number.isFinite(value))return null;
        return {value,unit:available[0].unit,evidenceClass:'derived_estimate',referenceYear:available.map(item=>item.referenceYear||item.referencePeriod).filter(Boolean).sort().join(', '),warnings:[`Sum across ${available.length} of ${rows.length} distinct state/UT features; uncovered geographies are excluded and shown as a coverage gap.`]};
      };
      const coverage=`Covered state/UT areas: ${rows.filter(item=>metricValue(item.metrics?.apparelExpenditure)!==null).length}/${rows.length}`;
      const national={name:'India · covered state aggregates',level:'national',confidence:'partial; state coverage and vintages vary',sourceVersion,metrics:{apparelExpenditure:aggregate('apparelExpenditure'),tam:aggregate('tam'),population:aggregate('population'),sam:null,som:null,monthlyPerCapitaSpend:null,incomeProxy:null,competitorCount:null,saturation:null,viability:null}};
      renderOverview(national,null);
      const tam=$('[data-market-metric="tam"] [data-note]');if(tam&&tam.textContent)tam.textContent+=` · ${coverage}`;
      $('[data-map-place-path]').textContent=`India · ${coverage} · ${sourceVersion||'source version unavailable'}`;
    }
    function renderAreas() {
      const term = $('[data-map-search]').value.trim().toLowerCase();
      $('[data-map-results]').innerHTML = features.filter(f => `${f.name} ${f.id}`.toLowerCase().includes(term)).map(f => `<button class="expansion-area" type="button" data-map-result="${escape(f.id)}" aria-pressed="${String(f.id)===String(selected)}"><span>${escape(f.name)}</span><small>${escape(display(f.metrics?.[metric]))}</small></button>`).join('') || '<p class="hint">No matching sourced areas at this level.</p>';
      $('[data-map-path]').textContent = ['India', ...path.map(f => f.name)].join(' › ');
    }
    function renderCompared() {
      const count=$('[data-map-compare-count]');if(count)count.textContent=compared.size?`· ${compared.size}/4`:'';
      $('[data-map-compare-list]').innerHTML = [...compared.values()].map(f => `<div class="expansion-compare-item"><span>${escape(f.name)}</span><button class="text-button" type="button" data-map-remove="${escape(f.id)}" aria-label="Remove ${escape(f.name)}">Remove</button></div>`).join('');
      $('[data-map-compare]').disabled = compared.size < 2;
    }
    function renderComparison() {
      if(!comparisonResult){$('[data-map-comparison]').innerHTML='';return;}
      const result=comparisonResult;
      $('[data-map-comparison]').innerHTML=list(result.geographies||result.features).map(geographyHTML).join('')+reportHTML(Object.fromEntries(Object.entries(result).filter(([key])=>!['geographies','features'].includes(key))));
    }
    function renderForecast() {
      if(!scenarioResult){$('[data-map-forecast]').innerHTML='';return;}
      const result=scenarioResult;
      $('[data-map-forecast]').innerHTML=`<h3>Server scenario · projection</h3>${result.forecast?reportHTML(result.forecast):'<p>Forecast unavailable: required evidence or inputs may be missing.</p>'}${result.warnings?reportHTML(result.warnings):''}`;
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
      if(!path.length&&!selected)renderNationalOverview();
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
      selected = String(id); selectedDetail = null; selectedRecord=null; selectedEstimate=null; const revision = ++detailRevision, context = contextRevision;
      map?.setPopupContext(selected,{geography:features.find(feature=>String(feature.id)===selected)||null});
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
        selectedRecord=result; selectedDetail = result.geography || result;
        const loaded = features.find(f => String(f.id) === selected);
        selectedDetail = { ...loaded, ...selectedDetail, id: selected };
        map?.setPopupContext(selected,{geography:selectedDetail});
        $('[data-map-detail]').innerHTML = geographyHTML({ ...result, geography: selectedDetail });
        renderOverview(selectedDetail,null);
        updateSelectionActions();
        root.dispatchEvent(new root.CustomEvent('franchiseos:location-selected',{detail:{
          id:selectedDetail.id,name:selectedDetail.name,level:selectedDetail.level,
          state:selectedDetail.state || (selectedDetail.level==='state'?selectedDetail.name:null),
          city:selectedDetail.city || (selectedDetail.level==='city'?selectedDetail.name:null),
          pin:selectedDetail.pin || (selectedDetail.level==='pin'?selectedDetail.name:null),
          sourceVersion:result.sourceVersion || sourceVersion || null,source:'expansion',
          metrics:selectedDetail.metrics || {},evidence:result.evidence || selectedDetail.evidence || []
        }}));
        try{
          const estimate=await request('estimate',`/api/market/map/geographies/${encodeURIComponent(id)}/market-estimate?year=${year}`);
          if(destroyed||revision!==detailRevision||context!==contextRevision||selected!==String(id))return;
          selectedEstimate=estimate;map?.setPopupContext(selected,{geography:selectedDetail,estimate:selectedEstimate});renderOverview(selectedDetail,selectedEstimate);
        }catch(error){if(error.name!=='AbortError'&&!destroyed&&revision===detailRevision){selectedEstimate={confidence:'estimate cache unavailable',explanation:`Customer estimate service unavailable: ${error.message}`};map?.setPopupContext(selected,{geography:selectedDetail,estimate:selectedEstimate});renderOverview(selectedDetail,selectedEstimate);}}
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
        comparisonResult=result; renderComparison();
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
        scenarioResult=result; renderForecast();
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
      }, options: { ...options, year, segment:$('[name="apparelSegment"]').value, onError(error) { status(`Map rendering unavailable: ${error.message}. Use the loaded area list to inspect evidence.`); } } });
    } catch (error) { $('[data-map-canvas]').innerHTML = `<div class="expansion-map-unavailable">${escape(error.message)} Use the area list below to inspect sourced data.</div>`; }
    container.addEventListener('click', onClick);
    function onClick(event) {
      const button = event.target.closest('button'); if (!button) return;
      const d = button.dataset;
      if('mapPopupDetail'in d){const id=String(d.mapPopupDetail);if(selected!==id)void selectGeography(id);const side=container.querySelector('.expansion-side'),toggle=container.querySelector('[data-map-sidebar-toggle]');if(side?.classList.contains('is-collapsed')){side.classList.remove('is-collapsed');if(toggle){toggle.textContent='Hide insights';toggle.setAttribute('aria-expanded','true');toggle.setAttribute('aria-label','Collapse market insights');}setTimeout(()=>map?.resize(),180);}const details=container.querySelector('[data-map-detail]')?.closest('details');if(details){details.open=true;setTimeout(()=>details.scrollIntoView?.({behavior:'smooth',block:'nearest'}),0);}return;}
      if('mapExit'in d){root.dispatchEvent(new root.CustomEvent('franchiseos:navigate',{detail:{type:'navigate',route:'overview',label:'Workspace overview',execute:false,permission:'read'}}));return;}
      if('mapOpenMarket'in d){root.dispatchEvent(new root.CustomEvent('franchiseos:navigate',{detail:{type:'navigate',route:'market',sectionId:'market-form',label:'Market Intelligence',execute:false,permission:'read'}}));return;}
      if('mapScreenPin'in d&&selectedDetail?.level==='pin'){root.dispatchEvent(new root.CustomEvent('franchiseos:navigate',{detail:{type:'navigate',route:'screening',sectionId:'territory-screening-root',label:'Territory Screening',execute:false,permission:'read'}}));return;}
      if('mapSidebarToggle'in d||'mapSidebarClose'in d){const side=$('.expansion-side'),hide=!side.classList.contains('is-collapsed');side.classList.toggle('is-collapsed',hide);const toggle=$('[data-map-sidebar-toggle]');if(toggle){toggle.textContent=hide?'Show insights':'Hide insights';toggle.setAttribute('aria-expanded',String(!hide));toggle.setAttribute('aria-label',hide?'Show market insights':'Collapse market insights');}setTimeout(()=>map?.resize(),180);return;}
      if('mapTilt'in d){const active=button.getAttribute('aria-pressed')!=='true';button.setAttribute('aria-pressed',String(active));button.textContent=active?'2D view':'3D tilt';map?.setTilt(active);return;}
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
      else if(name==='apparelSegment')map?.setSegment(value);
      else if(event.target.matches('[data-map-color-mode]')){map?.setColorMode(value);renderLegend();}
      else if(event.target.matches('[data-map-scale-scope]')){map?.setScaleScope(value);renderLegend();}
      else if(event.target.matches('[data-map-basemap]'))map?.setBasemap(value);
      else if (event.target.closest('[data-map-scenario-form]')) {
        scenarioRevision++; aborters.get('scenario')?.abort(); $('[data-map-apply]').disabled = false;
        $('[data-map-scenario-status]').textContent = 'Inputs edited · apply scenario to recalculate';
        $('[data-map-forecast]').innerHTML = '';
      }
    }
    $('[data-map-scenario-form]').addEventListener('submit', applyScenario);
    renderLegend(); renderCompared(); loadLevels();
    function refreshDisplay(){
      renderLegend(); renderAreas(); renderCompared(); renderComparison(); renderForecast(); map?.refreshDisplay();
      if(selectedDetail)renderOverview(selectedDetail,selectedEstimate);
      else if(!path.length&&!selected)renderNationalOverview();
      if(selectedDetail&&selectedRecord)$('[data-map-detail]').innerHTML=geographyHTML({...selectedRecord,geography:selectedDetail});
    }
    root.addEventListener?.('franchiseos:currency-display-changed',refreshDisplay);
    const onExpansionResize=()=>setTimeout(()=>map?.resize(),0);
    root.addEventListener?.('franchiseos:expansion-resize',onExpansionResize);
    return { setMetric, setYear, setScenario, selectGeography, resize(){map?.resize();},
      refreshDisplay,
      setFeatures(value) { features = Array.isArray(value) ? value : []; map?.setFeatures(features); renderAreas(); },
      destroy() { destroyed = true; contextRevision++; searchRevision++; researchRevision++; root.removeEventListener?.('franchiseos:currency-display-changed',refreshDisplay); root.removeEventListener?.('franchiseos:expansion-resize',onExpansionResize); for (const c of aborters.values()) c.abort(); map?.destroy(); container.removeEventListener('click',onClick); container.removeEventListener('change',onChange); $('[data-map-search]')?.removeEventListener('input',renderAreas); $('[data-map-global-form]')?.removeEventListener('submit',searchPlaces); $('[data-map-ask-form]')?.removeEventListener('submit',submitQuestion); $('[data-map-scenario-form]')?.removeEventListener('submit',applyScenario); }
    };
  }
  root.MarketMap = { mount, mountPage };
})(typeof globalThis === 'undefined' ? this : globalThis);
