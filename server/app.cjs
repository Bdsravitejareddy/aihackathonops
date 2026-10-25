'use strict';

const http = require('node:http');
const { createHash } = require('node:crypto');
const { validateWorkspacePayload } = require('./validation.cjs');
const { validatePin, calculateMarketAssessment } = require('./market-engine.cjs');
const { projectStoreEconomics, scoreMarketViability } = require('./market-forecast.cjs');

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

function createHandler({ store, marketStore, marketMapStore, marketResearchStore, marketResearchService, marketSources, marketBenchmarks, maxBodyBytes = 10 * 1024 * 1024 }) {
  if (!store || typeof store.load !== 'function' || typeof store.save !== 'function') throw new TypeError('A workspace store is required');
  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const host = req.headers.host || '';
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) return reply(res, 403, { error: 'Local requests only' });
    if (req.headers.origin) {
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

    if (url.pathname.startsWith('/api/market/')) {
      if (url.pathname.startsWith('/api/market/map/')) {
        if (!marketMapStore) return reply(res, 503, { error: 'Map geography catalog is unavailable' });
        const allowedMetrics = new Set(['population','populationDensity','households','monthlyPerCapitaSpend','incomeProxy','apparelExpenditure','tam','sam','som','competitorCount','saturation','revenue','revenuePerKm2','growthPotential3Year','growthPotential5Year','breakEvenRevenue','paybackMonths','viability']);
        const legendFor = (metric, year) => {
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
        const buildResearchContext = async (geographyId, payload) => {
          const scenario = payload.assumptions && typeof payload.assumptions === 'object' && !Array.isArray(payload.assumptions) ? payload.assumptions : {};
          const geography = await marketMapStore.getMapGeography(geographyId, 'apparelExpenditure', scenario);
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
          const extra = await marketMapStore.getMapEvidence?.(geographyId);
          const snapshot = assessment?.snapshot || {};
          const context = {
            location:{ id:geography.id, name:geography.name, level:geography.level, sourceVersion:marketMapStore.sourceVersion || 'india-geography-1.1.2' },
            targetApparelSegment:segmentOf(payload.segment),
            deterministicAssessment:{ modelVersion:'india-fashion-market-v1', ...(assessment ? { id:assessment.id, version:assessment.version } : {}), metrics:geography.metrics, demographics:geography.demographics, financialForecast:deterministicFinancialForecast, storedAssessmentResults:snapshot.results || null, storedForecast:snapshot.forecast || null },
            assumptions:scenario,
            sourceEvidence:(extra?.evidence || geography.evidence || []).slice(0,20),
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
            const modelVersion = marketResearchService.modelVersion || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
            const clientId = req.socket?.remoteAddress || 'local-client';
            if (researchMatch[2] === 'research') {
              if (payload.refresh === true) await marketResearchStore.markStale({ geographyId, segment:built.segment });
              else {
                const cached = await marketResearchStore.getCached({ geographyId, segment:built.segment, assessmentKey:built.assessmentKey, modelVersion, contextHash });
                if (cached) return reply(res, 200, { ...cached.result, citations:cached.citations, retrievedAt:cached.retrievedAt, modelVersion, cached:true, assessmentVersion:built.assessmentVersion });
              }
              const result = await marketResearchService.researchLocation(built.context, { clientId });
              if (!result.ok) return reply(res, researchError(result), { error:result.error.message, code:result.error.code });
              await marketResearchStore.save({ geographyId, segment:built.segment, assessmentId:built.assessmentId, assessmentVersion:built.assessmentVersion, assessmentKey:built.assessmentKey, modelVersion, contextHash, recordType:'cards', result, citations:result.citations });
              return reply(res, 200, { ...result, modelVersion, cached:false, assessmentVersion:built.assessmentVersion });
            }
            const question = typeof payload.question === 'string' ? payload.question.trim() : '';
            if (!question || question.length > 2000) return reply(res, 400, { error:'Question must contain 1–2,000 characters.' });
            const promptHash = createHash('sha256').update(question).digest('hex');
            const cached = await marketResearchStore.getCached({ geographyId, segment:built.segment, assessmentKey:built.assessmentKey, modelVersion, contextHash, recordType:'answer', promptHash });
            if (cached) return reply(res, 200, { ...cached.result, citations:cached.citations, retrievedAt:cached.retrievedAt, modelVersion, cached:true, assessmentVersion:built.assessmentVersion });
            const result = await marketResearchService.answerQuestion({ context:built.context, question, clientId });
            if (!result.ok) return reply(res, researchError(result), { error:result.error.message, code:result.error.code });
            await marketResearchStore.save({ geographyId, segment:built.segment, assessmentId:built.assessmentId, assessmentVersion:built.assessmentVersion, assessmentKey:built.assessmentKey, modelVersion, contextHash, recordType:'answer', promptHash, result, citations:result.citations });
            return reply(res, 200, { ...result, modelVersion, cached:false, assessmentVersion:built.assessmentVersion });
          }
          if (req.method === 'GET' && url.pathname === '/api/market/map/levels') {
            const metric = url.searchParams.get('metric') || 'apparelExpenditure';
            if (!allowedMetrics.has(metric)) return reply(res, 400, { error: 'Unsupported map metric' });
            const parentId = url.searchParams.get('parentId') || null;
            const rawBbox = url.searchParams.get('bbox');
            const bbox = rawBbox ? rawBbox.split(',').map(Number) : null;
            if (bbox && (bbox.length !== 4 || !bbox.every(Number.isFinite) || bbox[0] < -180 || bbox[2] > 180 || bbox[1] < -90 || bbox[3] > 90 || bbox[0] >= bbox[2] || bbox[1] >= bbox[3])) return reply(res, 400, { error: 'Invalid map bounding box' });
            const validBbox = bbox;
            const level = await marketMapStore.getMapLevel(parentId);
            if (!level) return reply(res, 400, { error: 'Unknown map parent geography' });
            const scenario = { captureRate: null };
            const includeGeometry=url.searchParams.get('geometry') !== 'none';
            const features = await marketMapStore.listMapGeographies({ parentId, level, bbox: validBbox, metric, scenario, includeGeometry });
            const missingExpenditure = metric === 'apparelExpenditure' ? features.filter(feature => feature.metrics.apparelExpenditure.value === null).length : 0;
            const warnings = features.length ? [] : ['No verified child boundaries are available at this level.'];
            if (missingExpenditure) warnings.push(`${missingExpenditure} of ${features.length} state/UTs have no annual expenditure value because the 2011 Census population cannot be defensibly crosswalked to those later boundaries.`);
            if (features.some(feature => feature.evidence.some(item => item.sourceId === 'census-of-india-2011-state-sector'))) warnings.push('Annual market expenditure combines Census 2011 population with HCES 2023-24 spending. It is a high-uncertainty market estimate, not actual franchise sales.');
            const version=marketMapStore.sourceVersion || 'india-geography-1.1.2';
            const values={ level, features:includeGeometry?features:features.map(feature=>({...feature,geometry:null})), sourceVersion:version, legend: legendFor(metric, Number(url.searchParams.get('year')) || 2026), warnings };
            return replyPublic(req,res,values,version,includeGeometry?3600:300);
          }
          if (req.method === 'GET' && url.pathname === '/api/market/map/search') {
            const q = (url.searchParams.get('q') || '').trim();
            if (q.length < 2 || q.length > 100) return reply(res, 400, { error: 'Search must contain 2–100 characters' });
            const results = await marketMapStore.searchMapGeographies(q, Math.min(Number(url.searchParams.get('limit')) || 20, 20));
            return reply(res, 200, { results: results.map(({ id,name,level,parentId,geometry,metrics,evidence,confidence,state,city,pin,ancestors }) => ({ id,name,level,parentId,geometry,metrics,evidence,confidence,state,city,pin,ancestors })),
              queryType:/^\d{6}$/.test(q)?'pin':'place', coverage:results.length?'sourced':/^\d{6}$/.test(q)?'not_verified':'unavailable' });
          }
          const detailMatch = url.pathname.match(/^\/api\/market\/map\/geographies\/([^/]+)$/);
          if (req.method === 'GET' && detailMatch) {
            const id = decodeURIComponent(detailMatch[1]);
            const geography = await marketMapStore.getMapGeography(id, 'apparelExpenditure', { captureRate: null });
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
          return reply(res, 200, { formatValid: validatePin(payload?.pin), directoryStatus: 'not_verified' });
        } catch (error) {
          return reply(res, error.status || 400, { error: error.status === 413 ? 'Payload too large' : 'Invalid JSON' });
        }
      }
      if (url.pathname === '/api/market/forecast' && req.method === 'POST') {
        if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) return reply(res, 415, { error: 'Content-Type must be application/json' });
        try {
          const payload = await readBody(req, maxBodyBytes);
          const economics = projectStoreEconomics(payload);
          const viability = payload.scoreMetrics ? scoreMarketViability(payload.scoreMetrics, payload.scoreWeights, payload.scoreGates) : null;
          return reply(res, 200, { modelVersion: 'india-fashion-market-v1', economics, viability });
        } catch (error) {
          return reply(res, error.status || 400, { error: error.status === 413 ? 'Payload too large' : error.status === 400 ? 'Invalid JSON' : error.message });
        }
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
