'use strict';

const http = require('node:http');
const { createHash } = require('node:crypto');
const { validateWorkspacePayload } = require('./validation.cjs');
const { validatePin, calculateMarketAssessment } = require('./market-engine.cjs');
const { projectStoreEconomics, scoreMarketViability } = require('./market-forecast.cjs');
const { createMarketLocationData } = require('./market-location-data.cjs');
const { calculateCustomerMarket } = require('./customer-market-model.cjs');
const { analyzeLocation, validateOverrides } = require('./market-analysis.cjs');
const { buildCeoInsights } = require('./ceo-insights.cjs');
const { parsePins, territoryMetrics } = require('./territory-metrics.cjs');
const { APPAREL, researchSector, validateSectorProfile, profileFields } = require('./market-sectors.cjs');
const { applySectorDemand, legendScale, itemCatalog } = require('./market-sector-demand.cjs');
const HCES_ITEM_GROUPS = itemCatalog.itemGroups.map(group => ({ ...group, allIndiaRural: itemCatalog.allIndia.rural[group.key], allIndiaUrban: itemCatalog.allIndia.urban[group.key] }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reply(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
}

function replyPublic(req, res, value, sourceVersion, lifetimeSeconds = 300) {
  const etag = '"' + createHash('sha256').update(sourceVersion + ':' + req.url).digest('hex').slice(0,32) + '"';
  const headers = { 'etag':etag, 'cache-control':`public, max-age=${lifetimeSeconds}, stale-while-revalidate=60`, 'x-content-type-options':'nosniff' };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304,headers); return res.end(); }
  const body=JSON.stringify(value);
  res.writeHead(200,{...headers,'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(body)});
  res.end(body);
}

function assessmentView(row) {
  if (!row) return row;
  if (row.snapshot) return row;
  const { id, workspaceId, version, ...snapshot } = row;
  return { id, workspaceId, version, snapshot };
}

function savedVersion(value) {
  return typeof value === 'number' ? value : value?.version;
}

async function readBody(req, maxBytes) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Payload too large'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

// Research prompts only need each metric's value and provenance class; full source records travel separately in
// sourceEvidence, and repeating them per metric pushes the context past its size limit.
function compactMetrics(metrics = {}) {
  return Object.fromEntries(Object.entries(metrics || {}).map(([key, metric]) => [key, metric && typeof metric === 'object'
    ? { value: metric.value ?? null, unit: metric.unit || null, evidenceClass: metric.evidenceClass || null, ...(metric.warnings?.length ? { note: String(metric.warnings[0]).slice(0, 240) } : {}) }
    : metric]));
}

function createHandler({ store, marketStore, marketMapStore, marketLocationData = createMarketLocationData(), marketResearchStore, marketResearchService, sectorRegistry = null, competitorService = null, marketSources, marketBenchmarks, maxBodyBytes = 10 * 1024 * 1024, allowRemote = false }) {
  if (!store || typeof store.load !== 'function' || typeof store.save !== 'function') throw new TypeError('A workspace store is required');
  // One geography loader for the Analysis panel and the CEO cards so both see identical inputs.
  async function loadAnalysisGeography(geographyId, sector = null) {
    // Prefer the Neon row (the same metrics the map pins show); the postal snapshot adds names, or stands in when Neon has no row.
    const pinPlace = /^pin:\d{6}$/.test(geographyId) ? marketLocationData?.resolvePin(geographyId.slice(4)) : null;
    if (!marketMapStore) { if (pinPlace) return withSector(pinPlace, sector); throw new Error('Map geography catalog is unavailable'); }
    let geography;
    try { geography = await marketMapStore.getMapGeography(geographyId, 'apparelExpenditure', { captureRate: null }); }
    catch { if (pinPlace) return withSector(pinPlace, sector); throw new Error('Map geography service unavailable'); }
    if (geography && pinPlace) geography = { ...geography, city: geography.city || pinPlace.city || null, postalCity: pinPlace.postalCity || null, postOffices: pinPlace.postOffices };
    return withSector(geography || pinPlace || null, sector);
  }
  // ?sector= (default apparel). A researched sector re-derives potential revenue from its HCES item groups.
  async function sectorFor(id) {
    const key = id || 'apparel';
    if (typeof key !== 'string' || !/^[a-z0-9-]{1,60}$/.test(key)) throw Object.assign(new Error('Invalid sector'), { status: 400 });
    let sector;
    try { sector = sectorRegistry ? await sectorRegistry.get(key) : key === 'apparel' ? APPAREL : null; }
    catch { throw Object.assign(new Error('Sector registry is unavailable'), { status: 503 }); }
    if (!sector) throw Object.assign(new Error(`Unknown sector: ${key}`), { status: 404 });
    return sector;
  }
  const withSector = (feature, sector) => feature && sector && !sector.builtIn ? applySectorDemand(feature, sector) : feature;
  const sectorTag = sector => sector.builtIn ? '' : `|sector:${sector.id}@${sector.version}`;
  const sectorSummary = sector => ({ id: sector.id, name: sector.name, version: sector.version ?? 0 });
  const researchStatus = code => ({ invalid_name: 400, rate_limited: 429, timeout: 504, missing_api_key: 503, unavailable: 503 })[code] || 502;
  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const host = req.headers.host || '';
    if (!allowRemote && !/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) return reply(res, 403, { error: 'Local requests only' });
    if (!allowRemote && req.headers.origin) {
      try {
        const origin = new URL(req.headers.origin);
        if (origin.protocol !== 'http:' || origin.host !== host || !/^(localhost|127\.0\.0\.1)$/i.test(origin.hostname)) return reply(res, 403, { error: 'Local requests only' });
      } catch { return reply(res, 403, { error: 'Local requests only' }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/health') return reply(res, 200, { ok: true });
    if (req.method === 'GET' && url.pathname === '/api/screening/applications') {
      const workspaceId=url.searchParams.get('workspaceId'), pin=url.searchParams.get('pin');
      if (!UUID.test(workspaceId || '') || !/^\d{6}$/.test(pin || '')) return reply(res,400,{error:'Valid workspace identifier and six digit PIN are required'});
      if (typeof store.listApplicationsByPin !== 'function') return reply(res,503,{error:'Screening lookup unavailable'});
      try { return reply(res,200,{applications:await store.listApplicationsByPin(workspaceId,pin)}); }
      catch { return reply(res,503,{error:'Screening lookup unavailable'}); }
    }

    if (url.pathname === '/api/sectors' || url.pathname.startsWith('/api/sectors/')) {
      if (!sectorRegistry) return reply(res, 503, { error: 'Sector registry is unavailable' });
      const idMatch = url.pathname.match(/^\/api\/sectors\/([a-z0-9-]{1,60})$/);
      const json = () => req.headers['content-type']?.toLowerCase().startsWith('application/json');
      try {
        if (req.method === 'GET' && url.pathname === '/api/sectors') return reply(res, 200, { sectors: await sectorRegistry.listSectors(), defaultId: 'apparel', hcesItemGroups: HCES_ITEM_GROUPS, hcesSource: { title: itemCatalog.source.title, url: itemCatalog.source.url, unit: itemCatalog.source.unit } });
        if (url.pathname === '/api/sectors/research') {
          if (req.method !== 'POST') { res.setHeader('allow', 'POST'); return reply(res, 405, { error: 'Method not allowed' }); }
          if (!json()) return reply(res, 415, { error: 'Content-Type must be application/json' });
          const payload = await readBody(req, 10_000);
          const result = await researchSector({ name: payload?.name, generate: marketResearchService?.generate, parseJson: marketResearchService?.parseJson, clientId: req.socket?.remoteAddress || 'local-client' });
          if (!result.ok) return reply(res, researchStatus(result.error.code), { error: result.error.message, code: result.error.code, manualEntry: true });
          const existing = await sectorRegistry.get(result.profile.id);
          return reply(res, 200, { profile: result.profile, rejected: result.rejected, warnings: result.warnings, saved: false, existing: existing ? sectorSummary(existing) : null });
        }
        if (req.method === 'GET' && idMatch) {
          const sector = await sectorRegistry.get(idMatch[1]);
          return sector ? reply(res, 200, { sector }) : reply(res, 404, { error: 'Sector not found' });
        }
        if (req.method === 'PUT' && idMatch) {
          if (!json()) return reply(res, 415, { error: 'Content-Type must be application/json' });
          const payload = await readBody(req, 100_000), previous = await sectorRegistry.get(idMatch[1]);
          const checked = validateSectorProfile(profileFields(payload?.profile), { mode: 'edit', base: { ...(previous || {}), id: idMatch[1], research: payload?.profile?.research || previous?.research }, retrievedAt: payload?.profile?.research?.retrievedAt || null });
          if (!checked.ok) return reply(res, 400, { error: checked.error });
          const sector = await sectorRegistry.saveSector(checked.profile);
          return reply(res, 200, { sector, previous: previous ? sectorSummary(previous) : null, rejected: checked.rejected, warnings: checked.warnings });
        }
        res.setHeader('allow', idMatch ? 'GET, PUT' : 'GET');
        return reply(res, idMatch || url.pathname === '/api/sectors' ? 405 : 404, { error: idMatch || url.pathname === '/api/sectors' ? 'Method not allowed' : 'Not found' });
      } catch (error) {
        if (error.status === 400 || error.status === 413) return reply(res, error.status, { error: error.status === 413 ? 'Payload too large' : 'Invalid JSON' });
        return reply(res, 503, { error: 'Sector storage is unavailable' });
      }
    }

    if (url.pathname === '/api/market/competitors') {
      if (req.method !== 'GET') { res.setHeader('allow', 'GET'); return reply(res, 405, { error: 'Method not allowed' }); }
      if (!competitorService) return reply(res, 503, { error: 'Competitor research is unavailable' });
      const geographyId = url.searchParams.get('geographyId') || '', sector = url.searchParams.get('sector') || 'apparel';
      if (!/^(state|district|city|pin):[A-Za-z0-9._-]{1,80}$/.test(geographyId)) return reply(res, 400, { error: 'A valid geographyId is required' });
      if (!/^[a-z0-9-]{1,60}$/.test(sector)) return reply(res, 400, { error: 'Invalid sector' });
      try { return reply(res, 200, await competitorService.getCompetitors({ geographyId, sectorId: sector, clientId: req.socket?.remoteAddress || 'local-client', refresh: url.searchParams.get('refresh') === '1' })); }
      catch (error) { return reply(res, error.status === 404 ? 404 : 503, { error: error.status === 404 ? error.message : 'Competitor research is unavailable' }); }
    }

    if (url.pathname === '/api/territories/metrics') {
      if (req.method !== 'GET') { res.setHeader('allow', 'GET'); return reply(res, 405, { error: 'Method not allowed' }); }
      let pins;
      try { pins = parsePins(url.searchParams.get('pins')); } catch (error) { return reply(res, 400, { error: error.message }); }
      const slots = url.searchParams.has('slots') ? Number(url.searchParams.get('slots')) : null;
      if (slots !== null && (!Number.isInteger(slots) || slots < 0 || slots > 100)) return reply(res, 400, { error: 'slots must be an integer from 0 to 100' });
      try { return reply(res, 200, await territoryMetrics({ pins, slots, loadGeography: id => loadAnalysisGeography(id) })); }
      catch { return reply(res, 503, { error: 'Territory metrics are unavailable; the map geography service did not respond.' }); }
    }

    if (url.pathname === '/api/insights/ceo') {
      if (req.method !== 'GET') { res.setHeader('allow', 'GET'); return reply(res, 405, { error: 'Method not allowed' }); }
      const stores = url.searchParams.has('stores') ? Number(url.searchParams.get('stores')) : 5;
      if (!Number.isInteger(stores) || stores < 1 || stores > 100) return reply(res, 400, { error: 'stores must be an integer from 1 to 100' });
      if (!marketMapStore) return reply(res, 503, { error: 'Map geography catalog is unavailable' });
      let sector;
      try { sector = await sectorFor(url.searchParams.get('sector')); } catch (error) { return reply(res, error.status, { error: error.message }); }
      try {
        // Same feature call as the national map layer (/api/market/map/levels).
        const features = (await marketMapStore.listMapGeographies({ parentId: null, level: 'state', metric: 'apparelExpenditure', scenario: { captureRate: null }, includeGeometry: false })).map(feature => withSector(feature, sector));
        const insights = await buildCeoInsights({ features, loadGeography: id => loadAnalysisGeography(id, sector), stores, sector });
        return reply(res, 200, { ...insights, sector: sectorSummary(sector), sourceVersion: marketMapStore.sourceVersion || null });
      } catch { return reply(res, 503, { error: 'Insights are unavailable; the map geography service did not respond.' }); }
    }

    if (url.pathname.startsWith('/api/market/')) {
      if (url.pathname.startsWith('/api/market/map/')) {
        if (!marketMapStore) return reply(res, 503, { error: 'Map geography catalog is unavailable' });
        const allowedMetrics = new Set(['potentialRevenue','population','populationDensity','households','monthlyPerCapitaSpend','incomeProxy','apparelExpenditure','tam','sam','som','competitorCount','saturation','revenue','revenuePerKm2','growthPotential3Year','growthPotential5Year','breakEvenRevenue','paybackMonths','viability']);
        // Revenue legends follow the map level: a PIN is ~1/1000 of a state, so one national scale would wash out.
        const LEVEL_LEGENDS = {
          potentialRevenue: { state: [2.5e9, 1.3e10, 4.5e10, 9e10], district: [7.5e8, 1.4e9, 2.1e9, 3.4e9], pin: [2.5e7, 4.5e7, 7e7, 1.2e8] },
          apparelExpenditure: { state: [2.5e10, 1e11, 3e11, 7.5e11], district: [2.4e9, 4.5e9, 6.5e9, 1.05e10], pin: [8e7, 1.4e8, 2.2e8, 3.8e8] }
        };
        const legendFor = (metric, year, level = 'state') => {
          const byLevel = LEVEL_LEGENDS[metric]?.[level === 'city' ? 'district' : level === 'catchment' ? 'pin' : level];
          if (byLevel) return { scope: 'national', level, metric, year, unit: 'INR/year', thresholds: byLevel, colors: ['#8dbdd2','#f1da5b','#f28e2b','#b4232b','#7a0019'] };
          const defs = {
            population: ['people', [10000, 50000, 200000, 1000000]], populationDensity: ['people/km²', [100, 500, 1500, 5000]], households: ['households', [2000, 10000, 40000, 200000]],
            monthlyPerCapitaSpend: ['INR/person/month', [100, 250, 500, 1000]], incomeProxy: ['INR/person/month', [10000, 20000, 40000, 80000]],
            apparelExpenditure: ['INR/year', [25000000000, 100000000000, 300000000000, 750000000000]], tam: ['INR/year', [10000000, 100000000, 1000000000, 10000000000]], sam: ['INR/year', [5000000, 50000000, 500000000, 5000000000]], som: ['INR/year', [1000000, 10000000, 100000000, 1000000000]],
            competitorCount: ['stores', [1, 5, 20, 100]], saturation: ['index', [0.2, 0.4, 0.6, 0.8]], revenue: ['INR/year', [1000000, 10000000, 100000000, 1000000000]], revenuePerKm2: ['INR/year/km²', [1000000, 10000000, 100000000, 1000000000]],
            growthPotential3Year: ['% nominal / 3 years', [5, 10, 20, 35]], growthPotential5Year: ['% nominal / 5 years', [10, 20, 40, 70]], breakEvenRevenue: ['INR/year', [1000000, 5000000, 25000000, 100000000]], paybackMonths: ['months', [12, 24, 36, 60]], viability: ['score / 100', [25, 45, 65, 80]]
          };
          if (!allowedMetrics.has(metric)) return null;
          const [unit, thresholds] = defs[metric];
          return { scope: 'national', metric, year, unit, thresholds, colors: ['#8dbdd2','#f1da5b','#f28e2b','#b4232b','#7a0019'] };
        };
        const segmentOf = value => typeof value === 'string' && value.trim().length <= 100 ? value.trim() : 'mass-market-family-apparel';
        const marketEstimateMatch=url.pathname.match(/^\/api\/market\/map\/geographies\/([^/]+)\/market-estimate$/);
        if(req.method==='GET'&&marketEstimateMatch){
          const geographyId=decodeURIComponent(marketEstimateMatch[1]);
          const analysisYear=Number(url.searchParams.get('year')||new Date().getFullYear());
          if(!Number.isInteger(analysisYear)||analysisYear<2011||analysisYear>2100)return reply(res,400,{error:'Analysis year must be between 2011 and 2100'});
          const retailCategory='apparel-fashion',modelVersion='customer-market-tam-v1',sourceVersion=marketMapStore.sourceVersion||'india-geography-1.1.2';
          try{
            const cached=await marketMapStore.getCustomerMarketEstimate?.({geographyId,retailCategory,analysisYear,modelVersion,sourceVersion});
            if(cached)return replyPublic(req,res,cached,`${sourceVersion}:${modelVersion}`,900);
          }catch{/* A missing estimate table should not block deterministic market detail. */}
          const pinPlace=/^pin:\d{6}$/.test(geographyId)?marketLocationData?.resolvePin(geographyId.slice(4)):null;
          const geography=pinPlace||await marketMapStore.getMapGeography(geographyId,'tam');
          if(!geography)return reply(res,404,{error:'Geography not found'});
          const properties=geography.customerMarketInputs||{},population=geography.metrics?.population;
          const input={relevantPopulation:typeof population?.value==='number'?population.value:null,
            customerPenetration:properties.customerPenetration??null,
            baselineAnnualSpend:properties.baselineAnnualSpend??null,
            incomeSegments:properties.incomeSegments??null,
            serviceablePercentage:properties.serviceablePercentage??null,
            capturePercentage:properties.capturePercentage??null,
            evidence:properties.evidence||{status:'estimated',sourceCount:(geography.evidence||[]).length},
            provenance:{geographyId:geography.id,level:geography.level,analysisYear,sourceVersion,sources:geography.evidence||[]}};
          let customerModel;
          try{customerModel=calculateCustomerMarket(input);}catch(error){return reply(res,422,{error:'Stored customer-market evidence is invalid.',detail:error.message});}
          const categoryTAM=geography.metrics?.apparelExpenditure?.value??geography.metrics?.tam?.value??null;
          const result={geography:{id:geography.id,name:geography.name,level:geography.level},retailCategory,analysisYear,modelVersion,sourceVersion,
            metrics:{categoryExpenditureTAM:{value:categoryTAM,unit:'INR/year',evidenceClass:geography.metrics?.apparelExpenditure?.evidenceClass||'unavailable',evidence:geography.metrics?.apparelExpenditure?.evidence||[],method:'Population × monthly HCES clothing/footwear MPCE × 12; market expenditure, not customer purchases or store sales.'},
              relevantPopulation:population||{value:null,unit:'people',evidenceClass:'unavailable'},potentialCustomers:{value:customerModel.metrics.tam?.customers??null,unit:'people',evidenceClass:customerModel.complete?'derived_estimate':'unavailable'},
              customerTAM:{value:customerModel.metrics.tam?.annualRevenue??null,unit:'INR/year',evidenceClass:customerModel.complete?'derived_estimate':'unavailable'},
              customerSAM:{value:customerModel.metrics.sam?.annualRevenue??null,unit:'INR/year',evidenceClass:customerModel.complete?'derived_estimate':'unavailable'},
              customerSOM:{value:customerModel.metrics.som?.annualRevenue??null,unit:'INR/year',evidenceClass:customerModel.complete?'derived_estimate':'unavailable'}},
            customerModel,confidence:customerModel.complete?'method-dependent':'insufficient customer participation and spend evidence',evidence:geography.evidence||[],cached:false,
            explanation:customerModel.complete?'Customer-based estimate uses stored, versioned market assumptions and source evidence.':'The available category-expenditure benchmark can estimate aggregate market spend, but does not identify unique fashion customers, their annual spend distribution, brand-serviceable share or store capture. Customer TAM/SAM/SOM remain unestimated until those inputs have defensible sources.'};
          try{await marketMapStore.saveCustomerMarketEstimate?.({geographyId,retailCategory,analysisYear,modelVersion,sourceVersion,result});result.persisted=true;}catch{result.persisted=false;}
          return replyPublic(req,res,result,`${sourceVersion}:${modelVersion}`,900);
        }
        const buildResearchContext = async (geographyId, payload) => {
          const scenario = payload.assumptions && typeof payload.assumptions === 'object' && !Array.isArray(payload.assumptions) ? payload.assumptions : {};
          const pinGeography = /^pin:\d{6}$/.test(geographyId) ? marketLocationData?.resolvePin(geographyId.slice(4)) : null;
          let geography = pinGeography;
          if (!geography) geography = await marketMapStore.getMapGeography(geographyId, 'apparelExpenditure', scenario);
          if (!geography) return { error: { status:404, message:'Geography not found' } };
          let assessment = null;
          if (payload.assessmentId !== undefined || payload.workspaceId !== undefined) {
            if (!UUID.test(payload.assessmentId || '') || !UUID.test(payload.workspaceId || '') || !marketStore?.getAssessment) return { error:{ status:400, message:'A valid workspace and assessment are required together.' } };
            assessment = await marketStore.getAssessment(payload.workspaceId, payload.assessmentId);
            if (!assessment) return { error:{ status:404, message:'Market assessment not found in this workspace.' } };
          }
          let deterministicFinancialForecast = null;
          const financialKeys = ['aov','areaSqFt','investment','workingCapital','monthlyFixedCosts','grossMargin','royaltyRate','conversionRate','salesRampMonths','initialRampFraction','annualNominalGrowth','annualInflation','discountRate'];
          if (financialKeys.every(key => Number.isFinite(scenario[key]))) {
            try {
              const forecast = projectStoreEconomics({ store:{ aov:scenario.aov, areaSqFt:scenario.areaSqFt, initialInvestment:scenario.investment, workingCapital:scenario.workingCapital,
                monthlyFixedCosts:scenario.monthlyFixedCosts, grossMargin:scenario.grossMargin, royaltyRate:scenario.royaltyRate, conversionRate:scenario.conversionRate,
                monthlyPassingPedestrianTraffic:scenario.monthlyPassingPedestrianTraffic, entryRate:scenario.entryRate, salesRampMonths:scenario.salesRampMonths, initialRampFraction:scenario.initialRampFraction },
              market:{ samAnnual:geography.metrics?.sam?.value, captureBenchmark:scenario.captureRate },
              forecast:{ years:5, annualNominalGrowth:scenario.annualNominalGrowth, annualInflation:scenario.annualInflation, discountRate:scenario.discountRate } });
              deterministicFinancialForecast = { breakEvenRevenueMonthly:forecast.economics?.breakEvenRevenueMonthly ?? null, requiredAnnualCaptureRate:forecast.economics?.requiredAnnualCaptureRate ?? null,
                scenarios:Object.fromEntries(Object.entries(forecast.scenarios || {}).map(([key,value])=>[key,{roiPercent:value.roiPercent,paybackMonths:value.paybackMonths,annualRevenue:value.years?.[0]?.nominalRevenue ?? null,year5Revenue:value.years?.at(-1)?.nominalRevenue ?? null,npv:value.npv}])) };
            } catch { return { error:{ status:400, message:'Financial assumptions are invalid.' } }; }
          }
          // The store cost model's base case (what the Analysis panel shows), so answers about payback use the same figures.
          let storeEconomics = null;
          try {
            const analysisGeography = await loadAnalysisGeography(geographyId);
            if (analysisGeography) {
              const analysis = analyzeLocation({ geography: analysisGeography }), mid = analysis.scenarios.mid, high = analysis.scenarios.high;
              storeEconomics = { model: 'base case, one store', storeArea: { value: analysis.assumptions.areaSqFt.value.mid, unit: 'sq ft' },
                investment: { value: mid.investment, unit: 'INR' }, storeSales: { value: mid.annualRevenue, unit: 'INR/year' }, breakEvenSales: { value: mid.breakEvenRevenueAnnual, unit: 'INR/year' },
                fixedCosts: { value: mid.monthlyFixedCosts * 12, unit: 'INR/year' }, payback: mid.paybackMonths === null ? 'does not pay back within 5 years' : { value: mid.paybackMonths, unit: 'months' },
                upsidePayback: high.paybackMonths === null ? 'does not pay back within 5 years' : { value: high.paybackMonths, unit: 'months' } };
            }
          } catch { /* Answers fall back to market metrics when the cost model cannot run for this area. */ }
          let extra = null;
          try { extra = await marketMapStore.getMapEvidence?.(geographyId); }
          catch { /* The location catalog's own evidence remains valid when supplemental PostGIS evidence is unavailable. */ }
          const snapshot = assessment?.snapshot || {};
          const context = {
            location:{ id:geography.id, name:geography.name, level:geography.level, pin:geography.pin || null, city:geography.city || null, state:geography.state || null, sourceVersion:geography.sourceVersion || marketMapStore.sourceVersion || 'india-geography-1.1.2' },
            targetApparelSegment:segmentOf(payload.segment),
            deterministicAssessment:{ modelVersion:'india-fashion-market-v1', ...(assessment ? { id:assessment.id, version:assessment.version } : {}), metrics:compactMetrics(geography.metrics), demographics:geography.demographics, financialForecast:deterministicFinancialForecast, storeEconomics, storedAssessmentResults:snapshot.results || null, storedForecast:snapshot.forecast || null },
            assumptions:scenario,
            sourceEvidence:[...(geography.evidence || []), ...(extra?.evidence || [])].filter((item, index, all) => all.findIndex(candidate => candidate.sourceId === item.sourceId && candidate.url === item.url) === index).slice(0,20),
            dataWarnings:[...(geography.warnings || []), ...(extra?.warnings || [])]
          };
          return { context, segment:segmentOf(payload.segment), assessmentId:assessment?.id || null, assessmentVersion:assessment?.version || null,
            assessmentKey:assessment ? `${assessment.id}:${assessment.version}` : 'none' };
        };
        const researchError = result => result.error?.code === 'rate_limited' ? 429 : result.error?.code === 'invalid_context' || result.error?.code === 'invalid_question' ? 400 : 503;
        try {
          const researchMatch = url.pathname.match(/^\/api\/market\/map\/geographies\/([^/]+)\/(research|ask)$/);
          if (researchMatch && req.method === 'POST') {
            if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) return reply(res, 415, { error:'Content-Type must be application/json' });
            if (!marketResearchService || !marketResearchStore) return reply(res, 503, { error:'Market research is unavailable; configure Gemini credentials and initialize the research tables.' });
            const payload = await readBody(req, Math.min(maxBodyBytes, 100_000));
            const geographyId = decodeURIComponent(researchMatch[1]);
            const built = await buildResearchContext(geographyId, payload);
            if (built.error) return reply(res, built.error.status, { error:built.error.message });
            const contextHash = createHash('sha256').update(JSON.stringify(built.context)).digest('hex');
            const modelVersion = marketResearchService.modelVersion || process.env.GEMINI_MODEL || 'gemini-3.8-flash';
            const clientId = req.socket?.remoteAddress || 'local-client';
            const persistResearch = async record => {
              try { await marketResearchStore.save(record); return null; }
              catch (error) {
                if (!/^pin:\d{6}$/.test(geographyId)) throw error;
                return 'This answer was generated from the current verified context but could not be cached because PIN research records are not yet linked to a Neon geography row.';
              }
            };
            if (researchMatch[2] === 'research') {
              if (payload.refresh === true) await marketResearchStore.markStale({ geographyId, segment:built.segment });
              else {
                const cached = await marketResearchStore.getCached({ geographyId, segment:built.segment, assessmentKey:built.assessmentKey, modelVersion, contextHash });
                if (cached) return reply(res, 200, { ...cached.result, citations:cached.citations, retrievedAt:cached.retrievedAt, modelVersion, cached:true, assessmentVersion:built.assessmentVersion });
              }
              const result = await marketResearchService.researchLocation(built.context, { clientId });
              if (!result.ok) return reply(res, researchError(result), { error:result.error.message, code:result.error.code });
              const persistenceWarning = await persistResearch({ geographyId, segment:built.segment, assessmentId:built.assessmentId, assessmentVersion:built.assessmentVersion, assessmentKey:built.assessmentKey, modelVersion, contextHash, recordType:'cards', result, citations:result.citations });
              return reply(res, 200, { ...result, modelVersion, cached:false, assessmentVersion:built.assessmentVersion, ...(persistenceWarning ? { persistenceWarning } : {}) });
            }
            const question = typeof payload.question === 'string' ? payload.question.trim() : '';
            if (!question || question.length > 2000) return reply(res, 400, { error:'Question must contain 1–2,000 characters.' });
            const promptHash = createHash('sha256').update(question).digest('hex');
            const cached = await marketResearchStore.getCached({ geographyId, segment:built.segment, assessmentKey:built.assessmentKey, modelVersion, contextHash, recordType:'answer', promptHash });
            if (cached) return reply(res, 200, { ...cached.result, citations:cached.citations, retrievedAt:cached.retrievedAt, modelVersion, cached:true, assessmentVersion:built.assessmentVersion });
            const result = await marketResearchService.answerQuestion({ context:built.context, question, clientId });
            if (!result.ok) return reply(res, researchError(result), { error:result.error.message, code:result.error.code });
            const persistenceWarning = await persistResearch({ geographyId, segment:built.segment, assessmentId:built.assessmentId, assessmentVersion:built.assessmentVersion, assessmentKey:built.assessmentKey, modelVersion, contextHash, recordType:'answer', promptHash, result, citations:result.citations });
            return reply(res, 200, { ...result, modelVersion, cached:false, assessmentVersion:built.assessmentVersion, ...(persistenceWarning ? { persistenceWarning } : {}) });
          }
          // Next-best PINs to expand into: highest potential revenue in the view, skipping PINs with a store and PINs
          // whose centre is within `spacingKm` of one (cannibalisation), and keeping chosen PINs apart from each other.
          if (req.method === 'GET' && url.pathname === '/api/market/map/opportunities') {
            const bbox = (url.searchParams.get('bbox') || '').split(',').map(Number);
            if (bbox.length !== 4 || !bbox.every(Number.isFinite) || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) return reply(res, 400, { error: 'A valid bbox is required' });
            const limit = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '10', 10) || 10));
            const spacingKm = Math.min(25, Math.max(0, Number(url.searchParams.get('spacingKm') ?? 3) || 0));
            const storePins = new Set((url.searchParams.get('storePins') || '').split(',').map(pin => pin.trim()).filter(pin => /^[1-9]\d{5}$/.test(pin)));
            let sector;
            try { sector = await sectorFor(url.searchParams.get('sector')); } catch (error) { return reply(res, error.status, { error: error.message }); }
            const features = (await marketMapStore.listMapGeographies({ level: 'pin', bbox, metric: 'potentialRevenue', scenario: { captureRate: null }, includeGeometry: false, maxRows: 6000, largestFirst: true })).map(feature => withSector(feature, sector));
            const km = (a, b) => { const r = Math.PI / 180, x = (b[0] - a[0]) * r * Math.cos((a[1] + b[1]) / 2 * r), y = (b[1] - a[1]) * r; return 6371 * Math.hypot(x, y); };
            const stores = features.filter(f => storePins.has(String(f.pin)) && f.anchor).map(f => f.anchor);
            const ranked = features.filter(f => f.anchor && Number.isFinite(f.metrics.potentialRevenue?.value) && !storePins.has(String(f.pin)) && !stores.some(s => km(s, f.anchor) < spacingKm))
              .sort((a, b) => b.metrics.potentialRevenue.value - a.metrics.potentialRevenue.value);
            const chosen = [];
            for (const f of ranked) { if (chosen.length >= limit) break; if (!chosen.some(c => km(c.anchor, f.anchor) < spacingKm)) chosen.push(f); }
            const value = key => f => f.metrics[key]?.value ?? null;
            return reply(res, 200, { sector: sectorSummary(sector), spacingKm, considered: features.length, truncated: features.length >= 6000,
              stores: features.filter(f => storePins.has(String(f.pin))).map(f => ({ pin: f.pin, id: f.id, anchor: f.anchor, district: f.district, state: f.state })),
              opportunities: chosen.map((f, index) => ({ rank: index + 1, id: f.id, pin: f.pin, anchor: f.anchor, district: f.district, state: f.state,
                potentialRevenue: value('potentialRevenue')(f), tam: value('apparelExpenditure')(f), population: value('population')(f), spendPerPersonMonthly: value('monthlyPerCapitaSpend')(f) })),
              method: `Top PINs by potential revenue in the view, excluding PINs with a store and anything within ${spacingKm} km of a store or of a higher-ranked pick.` });
          }
          if (req.method === 'GET' && url.pathname === '/api/market/map/levels') {
            const metric = url.searchParams.get('metric') || 'apparelExpenditure';
            if (!allowedMetrics.has(metric)) return reply(res, 400, { error: 'Unsupported map metric' });
            const parentId = url.searchParams.get('parentId') || null;
            const rawBbox = url.searchParams.get('bbox');
            const bbox = rawBbox ? rawBbox.split(',').map(Number) : null;
            if (bbox && (bbox.length !== 4 || !bbox.every(Number.isFinite) || bbox[0] < -180 || bbox[2] > 180 || bbox[1] < -90 || bbox[3] > 90 || bbox[0] >= bbox[2] || bbox[1] >= bbox[3])) return reply(res, 400, { error: 'Invalid map bounding box' });
            const validBbox = bbox;
            const requestedLevel = url.searchParams.get('level');
            if (requestedLevel !== null && (parentId || !['state','district','pin'].includes(requestedLevel))) return reply(res, 400, { error: 'level must be state, district or pin, without parentId' });
            if (['district','pin'].includes(requestedLevel) && !validBbox) return reply(res, 400, { error: 'A bbox is required for district and PIN levels' });
            const level = requestedLevel || await marketMapStore.getMapLevel(parentId);
            if (!level) return reply(res, 400, { error: 'Unknown map parent geography' });
            const scenario = { captureRate: null };
            const includeGeometry=url.searchParams.get('geometry') !== 'none';
            let sector;
            try { sector = await sectorFor(url.searchParams.get('sector')); } catch (error) { return reply(res, error.status, { error: error.message }); }
            const features = (await marketMapStore.listMapGeographies({ parentId, level, bbox: validBbox, metric, scenario, includeGeometry })).map(feature => withSector(feature, sector));
            const missing = features.filter(feature => feature.metrics[metric]?.value === null).length;
            const warnings = features.length ? [] : ['No verified boundaries are available for this area at this level.'];
            if (missing) warnings.push(`${missing} of ${features.length} areas have no ${metric} value; they are shown as unavailable.`);
            if (features.some(feature => feature.level === 'pin')) warnings.push('PIN areas are approximate (built from India Post office locations) and their populations are modelled 2020 estimates constrained to district totals.');
            const version=marketMapStore.sourceVersion || 'india-geography-1.1.2';
            let legend = legendFor(metric, Number(url.searchParams.get('year')) || 2026, level);
            // Revenue legends are tuned to apparel; rescale them by the sector's national potential.
            const scale = metric === 'potentialRevenue' && !sector.builtIn ? legendScale(sector, APPAREL) : null;
            if (legend && scale) legend = { ...legend, thresholds: legend.thresholds.map(value => Number(value * scale).toPrecision(2) * 1), sector: sector.id };
            const values={ level, features:includeGeometry?features:features.map(feature=>({...feature,geometry:null})), sourceVersion:version, sector: sectorSummary(sector), legend, warnings };
            return replyPublic(req,res,values,version+sectorTag(sector),includeGeometry?3600:300);
          }
          if (req.method === 'GET' && url.pathname === '/api/market/map/search') {
            const q = (url.searchParams.get('q') || '').trim();
            if (q.length < 2 || q.length > 100) return reply(res, 400, { error: 'Search must contain 2–100 characters' });
            const pinPlace = /^\d{6}$/.test(q) ? marketLocationData?.resolvePin(q) : null;
            // A known postal directory record is served from the versioned local catalog and
            // must remain searchable even when Neon/PostGIS is temporarily unavailable.
            const results = pinPlace ? [pinPlace] : await marketMapStore.searchMapGeographies(q, Math.min(Number(url.searchParams.get('limit')) || 20, 20));
            if (pinPlace && !results.some(item => item.id === pinPlace.id)) results.unshift(pinPlace);
            return reply(res, 200, { results: results.map(({ id,name,level,parentId,geometry,metrics,evidence,confidence,state,city,pin,ancestors,postOffices,postalRegion,postalDivision,postalCity,sourceVersion,warnings,benchmarkComparison }) => ({ id,name,level,parentId,geometry,metrics,evidence,confidence,state,city,pin,ancestors,postOffices,postalRegion,postalDivision,postalCity,sourceVersion,warnings,benchmarkComparison })),
              queryType:/^\d{6}$/.test(q)?'pin':'place', coverage:results.length?'sourced':/^\d{6}$/.test(q)?'not_verified':'unavailable' });
          }
          const detailMatch = url.pathname.match(/^\/api\/market\/map\/geographies\/([^/]+)$/);
          if (req.method === 'GET' && detailMatch) {
            const id = decodeURIComponent(detailMatch[1]);
            const pinPlace = /^pin:\d{6}$/.test(id) ? marketLocationData?.resolvePin(id.slice(4)) : null;
            let sector;
            try { sector = await sectorFor(url.searchParams.get('sector')); } catch (error) { return reply(res, error.status, { error: error.message }); }
            if (pinPlace) return reply(res,200,{geography:withSector(pinPlace,sector),evidence:pinPlace.evidence,confidence:pinPlace.confidence,sourceVersion:pinPlace.sourceVersion});
            const geography = withSector(await marketMapStore.getMapGeography(id, 'apparelExpenditure', { captureRate: null }), sector);
            if (!geography) return reply(res, 404, { error: 'Geography not found' });
            const extra = await marketMapStore.getMapEvidence(id);
            return reply(res, 200, { geography: { ...geography, ...(extra || {}) }, evidence: extra?.evidence || geography.evidence, confidence: geography.confidence, sourceVersion: marketMapStore.sourceVersion || 'india-geography-1.1.2' });
          }
          if (req.method === 'POST' && url.pathname === '/api/market/map/compare') {
            const payload = await readBody(req, maxBodyBytes);
            if (!Array.isArray(payload.geographyIds) || payload.geographyIds.length < 2 || payload.geographyIds.length > 4 || payload.geographyIds.some(id => typeof id !== 'string' || id.length > 160)) return reply(res, 400, { error: 'Choose 2–4 valid geography IDs' });
            const geographies = await Promise.all(payload.geographyIds.map(id => marketMapStore.getMapGeography(id, payload.metric, { captureRate: null })));
            return reply(res, 200, { geographies: geographies.filter(Boolean), warnings: ['Comparisons reflect source vintages and uncertainty shown for each geography; overlapping catchments may double-count residents.'] });
          }
          if (req.method === 'POST' && url.pathname === '/api/market/map/scenario') {
            const payload = await readBody(req, maxBodyBytes), a = payload.assumptions || {};
            if (!Number.isInteger(payload.horizonYears) || ![0,3,5].includes(payload.horizonYears)) return reply(res, 400, { error: 'Horizon must be baseline, 3 or 5 years' });
            const scenarioFactors = { conservative:0.75, base:1, optimistic:1.25 }, scenarioName = payload.scenario || 'base';
            if (!Object.hasOwn(scenarioFactors,scenarioName)) return reply(res,400,{error:'Unsupported scenario case'});
            for (const key of ['elasticity','captureRate','aov','areaSqFt','investment','workingCapital','monthlyFixedCosts','grossMargin','royaltyRate','conversionRate','monthlyPassingPedestrianTraffic','entryRate','salesRampMonths','initialRampFraction','annualNominalGrowth','annualInflation','discountRate','travelTimeMinutes']) {
              const value=a[key], permitsNegative=['annualNominalGrowth','annualInflation','discountRate'].includes(key);
              if (value !== undefined && (!Number.isFinite(value) || (value < 0 && !permitsNegative) || (permitsNegative && value <= -1) || (key === 'captureRate' && value > 1) || (key === 'elasticity' && value === 0))) return reply(res, 400, { error: `Invalid assumption: ${key}` });
            }
            const effectiveCaptureRate = Number.isFinite(a.captureRate) ? Math.min(1,a.captureRate*scenarioFactors[scenarioName]) : null;
            const parentId = payload.parentId || null, level = await marketMapStore.getMapLevel(parentId);
            const mapRows = await marketMapStore.listMapGeographies({ parentId, level, metric: payload.metric, scenario: { captureRate: effectiveCaptureRate, elasticity: a.elasticity ?? 1 } });
            const selected = await Promise.all((payload.geographyIds || []).slice(0,4).map(id => marketMapStore.getMapGeography(id, payload.metric, { captureRate: effectiveCaptureRate, elasticity: a.elasticity ?? 1 })));
            const scenarioId = `scenario-${payload.scenario || 'base'}-e${a.elasticity ?? 1}-c${a.captureRate ?? 'missing'}-h${payload.horizonYears}`;
            const financeKeys = ['aov','areaSqFt','investment','workingCapital','monthlyFixedCosts','grossMargin','royaltyRate','conversionRate','monthlyPassingPedestrianTraffic','entryRate','salesRampMonths','initialRampFraction','annualNominalGrowth','annualInflation','discountRate'];
            const financeInputsComplete = financeKeys.every(key => Number.isFinite(a[key]));
            let financial = null;
            if (financeInputsComplete && selected[0]) {
              try {
                financial = projectStoreEconomics({
                  store: { aov:a.aov, areaSqFt:a.areaSqFt, initialInvestment:a.investment, workingCapital:a.workingCapital, monthlyFixedCosts:a.monthlyFixedCosts,
                    grossMargin:a.grossMargin, royaltyRate:a.royaltyRate, conversionRate:a.conversionRate, monthlyPassingPedestrianTraffic:a.monthlyPassingPedestrianTraffic,
                    entryRate:a.entryRate, salesRampMonths:a.salesRampMonths, initialRampFraction:a.initialRampFraction, trafficEvidenceClass:'model_assumption' },
                  market: { samAnnual:selected[0].metrics?.sam?.value, captureBenchmark:effectiveCaptureRate },
                  forecast: { years:Math.max(1,payload.horizonYears), annualNominalGrowth:a.annualNominalGrowth, annualInflation:a.annualInflation, discountRate:a.discountRate }
                });
              } catch (error) { return reply(res, 400, { error: `Invalid financial assumptions: ${error.message}` }); }
            }
            const chosenFinancial = financial?.scenarios?.[scenarioName];
            const forecast = { evidenceClass:'model_assumption', scenario:scenarioName, effectiveCaptureRate, horizonYears:payload.horizonYears,
              annualRevenue:chosenFinancial?.years?.[0]?.nominalRevenue ?? selected[0]?.metrics?.som?.value ?? null,
              roi:chosenFinancial?.roiPercent ?? null, paybackMonths:chosenFinancial?.paybackMonths ?? null,
              breakEvenRevenueMonthly:financial?.economics?.breakEvenRevenueMonthly ?? null, footfall:financial?.footfall || null, financial,
              demand:selected.map(item=>({id:item?.id,tam:item?.metrics?.tam||null,sam:item?.metrics?.sam||null,som:item?.metrics?.som||null})),
              warnings:[...(!financeInputsComplete?['Store costs, margins, conversion, passing traffic and discount assumptions are required for ROI and payback; those values remain unavailable.']:[]),
                ...(!selected[0]?.metrics?.sam?.value?['A compatible serviceable market estimate is unavailable; revenue-to-market capture comparison is incomplete.']:[]),
                'Revenue is a scenario projection and must not be interpreted as observed sales.'] };
            return reply(res, 200, { scenarioId, map: { level, features: mapRows, sourceVersion: marketMapStore.sourceVersion || 'india-geography-1.1.2', legend: legendFor(payload.metric || 'apparelExpenditure', Number(payload.year) || 2026), warnings: [] }, forecast, warnings: forecast.warnings });
          }
          res.setHeader('allow', 'GET, POST');
          return reply(res, 405, { error: 'Method not allowed' });
        } catch (error) { return reply(res, error.status || 503, { error: error.status === 400 ? 'Invalid JSON' : 'Map geography service unavailable' }); }
      }
      if (req.method === 'GET' && url.pathname === '/api/market/sources') {
        if (typeof marketStore?.listSources === 'function') {
          try {
            const catalog = await marketStore.listSources();
            if (catalog.sources?.length) return reply(res, 200, catalog);
          } catch { /* Use the checked-in catalog when Neon is unavailable. */ }
        }
        return reply(res, 200, marketSources || { version: null, sources: [] });
      }
      if (req.method === 'GET' && url.pathname === '/api/market/benchmarks') {
        if (typeof marketStore?.listBenchmarks === 'function') {
          try {
            const catalog = await marketStore.listBenchmarks();
            if (catalog.observations?.length) return reply(res, 200, catalog);
          } catch { /* Use the checked-in catalog when Neon is unavailable. */ }
        }
        return reply(res, 200, marketBenchmarks || { version: null, observations: [] });
      }
      if (url.pathname === '/api/market/pins/validate' && req.method === 'POST') {
        if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) return reply(res, 415, { error: 'Content-Type must be application/json' });
        try {
          const payload = await readBody(req, maxBodyBytes);
          const resolved = marketLocationData?.resolvePin(String(payload?.pin || ''));
          return reply(res, 200, { formatValid: validatePin(payload?.pin), directoryStatus: resolved ? 'verified' : 'not_verified', ...(resolved ? { geography: resolved } : {}) });
        } catch (error) {
          return reply(res, error.status || 400, { error: error.status === 413 ? 'Payload too large' : 'Invalid JSON' });
        }
      }
      if (url.pathname === '/api/market/analysis') {
        if (req.method !== 'GET' && req.method !== 'POST') { res.setHeader('allow', 'GET, POST'); return reply(res, 405, { error: 'Method not allowed' }); }
        if (req.method === 'POST' && !req.headers['content-type']?.toLowerCase().startsWith('application/json')) return reply(res, 415, { error: 'Content-Type must be application/json' });
        let payload;
        try {
          payload = req.method === 'POST' ? await readBody(req, Math.min(maxBodyBytes, 50_000))
            : { geographyId: url.searchParams.get('geographyId'), overrides: url.searchParams.has('overrides') ? JSON.parse(url.searchParams.get('overrides')) : undefined };
        } catch (error) { return reply(res, error.status || 400, { error: error.status === 413 ? 'Payload too large' : 'Invalid JSON' }); }
        const geographyId = payload?.geographyId;
        if (typeof geographyId !== 'string' || !/^[\w:.\- ]{1,160}$/.test(geographyId)) return reply(res, 400, { error: 'A valid geographyId is required' });
        try { validateOverrides(payload.overrides); } catch (error) { return reply(res, 400, { error: error.message }); }
        let geography, sector;
        try { sector = await sectorFor(url.searchParams.get('sector') || payload.sector); } catch (error) { return reply(res, error.status, { error: error.message }); }
        try { geography = await loadAnalysisGeography(geographyId, sector); }
        catch (error) { return reply(res, 503, { error: error.message }); }
        if (!geography) return reply(res, 404, { error: 'Geography not found' });
        return reply(res, 200, analyzeLocation({ geography, overrides: payload.overrides, sector }));
      }
      if (url.pathname === '/api/market/forecast' && req.method === 'POST') {
        if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) return reply(res, 415, { error: 'Content-Type must be application/json' });
        try {
          const payload = await readBody(req, maxBodyBytes);
          const economics = projectStoreEconomics(payload);
          const sector = payload.scoreWeights ? null : await sectorFor(url.searchParams.get('sector') || payload.sector);
          const viability = payload.scoreMetrics ? scoreMarketViability(payload.scoreMetrics, payload.scoreWeights || sector.scoringWeights, payload.scoreGates) : null;
          return reply(res, 200, { modelVersion: 'india-fashion-market-v1', economics, viability, ...(sector ? { sector: sectorSummary(sector) } : {}) });
        } catch (error) {
          return reply(res, error.status || 400, { error: error.status === 413 ? 'Payload too large' : error.status === 400 ? 'Invalid JSON' : error.message });
        }
      }
      if (url.pathname === '/api/market/assessments/preview' && req.method === 'POST') {
        if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) return reply(res, 415, { error: 'Content-Type must be application/json' });
        try {
          const payload = await readBody(req, maxBodyBytes);
          if (!payload?.snapshot || typeof payload.snapshot !== 'object' || Array.isArray(payload.snapshot)) return reply(res,400,{error:'A market snapshot is required'});
          const snapshot = payload.snapshot;
          const results = calculateMarketAssessment({ ...(snapshot.inputs || {}), sourceVintage:snapshot.sourceVintage, geography:snapshot.geography });
          return reply(res,200,{ persisted:false, modelVersion:results.modelVersion, results, warning:'Preview only: this result is not saved to Neon.' });
        } catch (error) { return reply(res,error.status || 400,{error:error.status===413?'Payload too large':error.status===400?'Invalid JSON':'Invalid market snapshot'}); }
      }
      if (!marketStore) return reply(res, 503, { error: 'Market storage unavailable' });

      const workspaceId = url.searchParams.get('workspaceId');
      const assessmentPath = url.pathname.match(/^\/api\/market\/assessments\/([^/]+)(?:\/(competitors|recalculate))?$/);
      if (url.pathname === '/api/market/assessments' && req.method === 'GET') {
        if (!UUID.test(workspaceId || '')) return reply(res, 400, { error: 'Invalid workspace identifier' });
        try { return reply(res, 200, { assessments: await marketStore.listAssessments(workspaceId) }); }
        catch { return reply(res, 503, { error: 'Market storage unavailable' }); }
      }
      if (url.pathname === '/api/market/assessments/compare' && req.method === 'POST') {
        if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) return reply(res, 415, { error: 'Content-Type must be application/json' });
        try {
          const payload = await readBody(req, maxBodyBytes);
          if (!UUID.test(payload?.workspaceId || '') || !Array.isArray(payload.ids) || payload.ids.length < 1 || payload.ids.length > 50 || payload.ids.some(id => !UUID.test(id))) return reply(res, 400, { error: 'Invalid comparison request' });
          const rows = await Promise.all(payload.ids.map(id => marketStore.getAssessment(payload.workspaceId, id)));
          return reply(res, 200, { assessments: rows.filter(Boolean).map(assessmentView) });
        } catch (error) { return reply(res, error.status || 503, { error: error.status === 413 ? 'Payload too large' : error.status === 400 ? 'Invalid JSON' : 'Market storage unavailable' }); }
      }
      if (assessmentPath) {
        const id = assessmentPath[1];
        const action = assessmentPath[2];
        if (!UUID.test(id)) return reply(res, 400, { error: 'Invalid assessment identifier' });
        const isWrite = req.method === 'PUT' || req.method === 'POST';
        if (isWrite && !req.headers['content-type']?.toLowerCase().startsWith('application/json')) return reply(res, 415, { error: 'Content-Type must be application/json' });
        try {
          if (action === 'competitors') {
            if (req.method === 'GET') {
              if (!UUID.test(workspaceId || '')) return reply(res, 400, { error: 'Invalid workspace identifier' });
              const assessment = await marketStore.getAssessment(workspaceId, id);
              if (!assessment) return reply(res, 404, { error: 'Market assessment not found' });
              return reply(res, 200, { competitors: await marketStore.listCompetitors(workspaceId, id) });
            }
            if (req.method === 'PUT') {
              const payload = await readBody(req, maxBodyBytes);
              if (!UUID.test(payload?.workspaceId || '') || !Array.isArray(payload.competitors) || payload.competitors.length > 500 || payload.competitors.some(item => !item || typeof item !== 'object' || Array.isArray(item))) return reply(res, 400, { error: 'Invalid competitor request' });
              if (!await marketStore.getAssessment(payload.workspaceId, id)) return reply(res, 404, { error: 'Market assessment not found' });
              const competitors = await marketStore.replaceCompetitors(payload.workspaceId, id, payload.competitors);
              return reply(res, 200, { competitors });
            }
          } else if (action === 'recalculate' && req.method === 'POST') {
            const payload = await readBody(req, maxBodyBytes);
            if (!UUID.test(payload?.workspaceId || '') || !Number.isInteger(payload.expectedVersion) || payload.expectedVersion < 0) return reply(res, 400, { error: 'Invalid recalculation request' });
            const current = await marketStore.getAssessment(payload.workspaceId, id);
            if (!current) return reply(res, 404, { error: 'Market assessment not found' });
            if (current.version !== payload.expectedVersion) return reply(res, 409, { error: 'Market assessment changed elsewhere. Reload before recalculating.' });
            const snapshot = assessmentView(current).snapshot;
            const results = calculateMarketAssessment({ ...(snapshot.inputs || {}), sourceVintage: snapshot.sourceVintage, geography: snapshot.geography });
            const nextSnapshot = { ...snapshot, results };
            const version = savedVersion(await marketStore.saveAssessment(payload.workspaceId, id, payload.expectedVersion, nextSnapshot));
            return reply(res, 200, { id, workspaceId: payload.workspaceId, version, snapshot: nextSnapshot });
          } else if (!action && req.method === 'GET') {
            if (!UUID.test(workspaceId || '')) return reply(res, 400, { error: 'Invalid workspace identifier' });
            const assessment = await marketStore.getAssessment(workspaceId, id);
            return assessment ? reply(res, 200, assessmentView(assessment)) : reply(res, 404, { error: 'Market assessment not found' });
          } else if (!action && req.method === 'PUT') {
            const payload = await readBody(req, maxBodyBytes);
            if (!UUID.test(payload?.workspaceId || '') || !Number.isInteger(payload.expectedVersion) || payload.expectedVersion < 0 || !payload.snapshot || typeof payload.snapshot !== 'object' || Array.isArray(payload.snapshot)) return reply(res, 400, { error: 'Invalid market assessment payload' });
            const version = savedVersion(await marketStore.saveAssessment(payload.workspaceId, id, payload.expectedVersion, payload.snapshot));
            return reply(res, 200, { id, workspaceId: payload.workspaceId, version, snapshot: payload.snapshot });
          } else {
            res.setHeader('allow', action === 'competitors' ? 'GET, PUT' : action === 'recalculate' ? 'POST' : 'GET, PUT');
            return reply(res, 405, { error: 'Method not allowed' });
          }
        } catch (error) {
          if (error.status === 409) return reply(res, 409, { error: 'Market assessment changed elsewhere. Reload before saving.' });
          return reply(res, error.status || 503, { error: error.status === 400 ? 'Invalid JSON' : error.status === 413 ? 'Payload too large' : 'Market storage unavailable' });
        }
      }
      return reply(res, 404, { error: 'Not found' });
    }

    const match = url.pathname.match(/^\/api\/workspaces\/([^/]+)$/);
    if (!match) return reply(res, 404, { error: 'Not found' });
    const id = match[1];
    if (!UUID.test(id)) return reply(res, 400, { error: 'Invalid workspace identifier' });
    if (req.method === 'GET') {
      try {
        const workspace = await store.load(id);
        return workspace === null ? reply(res, 404, { error: 'Workspace not found' }) : reply(res, 200, workspace);
      } catch { return reply(res, 503, { error: 'Workspace storage unavailable' }); }
    }
    if (req.method === 'PUT') {
      if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) return reply(res, 415, { error: 'Content-Type must be application/json' });
      try {
        const payload = await readBody(req, maxBodyBytes);
        if (!payload || !Number.isInteger(payload.revision) || payload.revision < 0 || !validateWorkspacePayload(payload.state).ok) return reply(res, 400, { error: 'Invalid workspace payload' });
        const revision = await store.save(id, payload.state, payload.revision);
        return reply(res, 200, { ok: true, revision });
      } catch (error) {
        if (error.status === 409) return reply(res, 409, { error: 'Workspace changed elsewhere. Reload before saving.' });
        return reply(res, error.status || 503, { error: error.status === 400 ? 'Invalid JSON' : error.status === 413 ? 'Payload too large' : 'Workspace storage unavailable' });
      }
    }
    res.setHeader('allow', 'GET, PUT');
    return reply(res, 405, { error: 'Method not allowed' });
  };
}

function createServer(options) { return http.createServer(createHandler(options)); }

module.exports = { createHandler, createServer };
