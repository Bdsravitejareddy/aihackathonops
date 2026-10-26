'use strict';

// Sector registry: what a retail sector means for the map, competitor search and scoring.
// Apparel is the built-in default; researched sectors are added at runtime (POST /api/sectors/research, PUT /api/sectors/:id).
//
// Profile shape (every number carries evidence in `evidence` / `sources` or is listed in `assumptions`):
//   id, name, description, version
//   hcesCategories: HCES 2023-24 item groups whose per-capita spend makes up this sector's consumer spend
//   organisedShare, onlineShareOfOrganised: share of category spend through organised / online retail (0-1)
//   osmTags: OpenStreetMap tag filters for observed competitor stores, e.g. [['shop','clothes']]
//   majorBrands: brand names to look for when counting competitors
//   store: per-store format (areaSqFt, revenuePerSqFtYear, capexPerSqFt, rentPerSqFtMonthLow/High, grossMargin,
//          royaltyRate, sqFtPerEmployee); null fields fall back to the apparel cost catalog. null store = catalog.
//   scoringWeights: market viability weights (demand, purchasingPower, competition, accessibility, financial, growth; sum 1)
//   partnerRequirements: franchise partner thresholds (minInvestmentLakh, minAreaSqFt, minLaunchMonths, targetLaunchMonths)
//   evidence: { 'store.areaSqFt': { url, title, quote } }, sources: [{ title, publisher, url, retrievedAt }]
//   assumptions: field paths without a sourced value; rationale: { path: why }; rejected: [{ field, value, reason }]

const { ITEM_KEYS, matchItemGroup } = require('./market-sector-demand.cjs');

const WEIGHT_KEYS = ['demand', 'purchasingPower', 'competition', 'accessibility', 'financial', 'growth'];
const DEFAULT_WEIGHTS = Object.freeze({ demand: 0.25, purchasingPower: 0.20, competition: 0.20, accessibility: 0.15, financial: 0.15, growth: 0.05 });
// Plausible ranges; values outside are rejected, never clamped.
const RANGES = Object.freeze({
  organisedShare: [0.01, 0.95], onlineShareOfOrganised: [0, 0.9],
  'store.areaSqFt': [50, 100000], 'store.revenuePerSqFtYear': [300, 200000], 'store.capexPerSqFt': [200, 20000],
  'store.rentPerSqFtMonthLow': [5, 1500], 'store.rentPerSqFtMonthHigh': [5, 1500], 'store.grossMargin': [0.05, 0.9],
  'store.royaltyRate': [0, 0.25], 'store.sqFtPerEmployee': [20, 3000],
  'partnerRequirements.minInvestmentLakh': [1, 5000], 'partnerRequirements.minAreaSqFt': [50, 100000],
  'partnerRequirements.minLaunchMonths': [0.5, 24], 'partnerRequirements.targetLaunchMonths': [0.5, 36]
});
const FRACTIONS = new Set(['organisedShare', 'onlineShareOfOrganised', 'store.grossMargin', 'store.royaltyRate']);
const STORE_KEYS = ['areaSqFt', 'revenuePerSqFtYear', 'capexPerSqFt', 'rentPerSqFtMonthLow', 'rentPerSqFtMonthHigh', 'grossMargin', 'royaltyRate', 'sqFtPerEmployee'];
const REQUIREMENT_KEYS = ['minInvestmentLakh', 'minAreaSqFt', 'minLaunchMonths', 'targetLaunchMonths'];
const OSM_KEYS = new Set(['shop', 'amenity', 'craft', 'healthcare', 'leisure', 'office', 'tourism']);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const text = (value, max = 200) => typeof value === 'string' ? value.replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const slug = name => text(name, 80).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

const APPAREL = Object.freeze({
  id: 'apparel', name: 'Apparel & fashion', description: 'Clothing, bedding and footwear retail (built-in sector).', version: 0,
  hcesCategories: ['clothing & bedding', 'footwear'],
  organisedShare: 0.41, onlineShareOfOrganised: 0.22,
  osmTags: [['shop', 'clothes'], ['shop', 'shoes'], ['shop', 'fashion'], ['shop', 'boutique'], ['shop', 'department_store']],
  majorBrands: ['Zudio', 'Westside', 'Trends', 'Max', 'Pantaloons', 'V-Mart', 'Style Union', 'Lifestyle', 'Shoppers Stop', 'Bata', 'Allen Solly', 'Peter England', 'Van Heusen', 'Biba', 'W', 'FabIndia', 'Manyavar', 'Decathlon', 'H&M', 'Uniqlo'],
  store: null,
  scoringWeights: DEFAULT_WEIGHTS,
  partnerRequirements: { minInvestmentLakh: 30, minAreaSqFt: 400, minLaunchMonths: 3, targetLaunchMonths: 6 },
  evidence: {
    organisedShare: { url: 'https://www.ibef.org/news/india-s-apparel-retail-market-poised-to-reach-us-193-billion-by-fy30-careedge', title: 'CareEdge via IBEF', quote: 'Organised retail 41% of apparel retail, FY25' },
    onlineShareOfOrganised: { url: 'https://www.ibef.org/news/india-s-apparel-retail-market-poised-to-reach-us-193-billion-by-fy30-careedge', title: 'CareEdge via IBEF', quote: 'Online about 22% of organised apparel retail, FY25' }
  },
  sources: [{ title: "India's apparel retail market poised to reach US$ 193 billion by FY30: CareEdge", publisher: 'IBEF', url: 'https://www.ibef.org/news/india-s-apparel-retail-market-poised-to-reach-us-193-billion-by-fy30-careedge' }],
  assumptions: ['majorBrands', 'scoringWeights', 'partnerRequirements'],
  rationale: { scoringWeights: 'Proposed pilot weights; calibrate against observed store outcomes.', partnerRequirements: 'Demonstration brand policy, not an industry standard.' },
  rejected: [],
  builtIn: true
});

/** Non-negative weights over the six factors, rescaled to sum exactly 1 (4 decimals). Null when nothing usable. */
function normalizeWeights(input) {
  if (!input || typeof input !== 'object') return null;
  const raw = WEIGHT_KEYS.map(key => { const v = typeof input[key] === 'object' && input[key] ? input[key].value : input[key]; return finite(v) && v >= 0 ? v : 0; });
  const total = raw.reduce((sum, v) => sum + v, 0);
  if (!(total > 0)) return null;
  const rounded = raw.map(v => Math.round(v / total * 10000) / 10000);
  const largest = rounded.indexOf(Math.max(...rounded));
  rounded[largest] = Math.round((rounded[largest] + 1 - rounded.reduce((sum, v) => sum + v, 0)) * 10000) / 10000;
  return Object.fromEntries(WEIGHT_KEYS.map((key, index) => [key, rounded[index]]));
}

const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; } };

/** A citation counts when its URL, or its host, is among the pages Google Search grounding actually retrieved. */
function matchCitation(url, citations) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
  const exact = citations.find(item => item.url === url);
  if (exact) return { url, groundingUrl: exact.url, title: exact.title };
  const host = hostOf(url);
  if (!host) return null;
  const sameHost = citations.find(item => [hostOf(item.url), String(item.title || '').replace(/^www\./, '').toLowerCase()].some(h => h && (h === host || host.endsWith('.' + h) || h.endsWith('.' + host))));
  return sameHost ? { url, groundingUrl: sameHost.url, title: sameHost.title } : null;
}

/**
 * Validate a sector profile. mode 'research': numbers need a retrieved citation or an explicit assumption label.
 * mode 'edit': the user's own values; anything without a source is recorded as a user assumption.
 */
function validateSectorProfile(raw, { citations = [], mode = 'research', retrievedAt = null, base = null } = {}) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const name = text(input.name, 80) || text(base?.name, 80);
  const id = base?.id || slug(name);
  const rejected = [], warnings = [], evidence = {}, assumptions = [], rationale = {};
  if (!name || !id) return { ok: false, error: 'A sector name is required.', rejected, warnings };

  // A field is either a number or { value, sourceUrl, quote } / { value, assumption: true, rationale }.
  function numberField(path, field, previous) {
    if (field === undefined || field === null || field === '') return null;
    const wrapped = typeof field === 'object' && !Array.isArray(field);
    let value = wrapped ? field.value : field;
    if (typeof value === 'string' && value.trim() !== '') value = Number(value);
    if (value === null || value === undefined) return null;
    if (!finite(value)) { rejected.push({ field: path, value: wrapped ? field.value : field, reason: 'not a number' }); return null; }
    if (FRACTIONS.has(path) && value > 1 && value <= 100 && mode === 'research') { warnings.push(`${path} was given as ${value}; read as ${value}%.`); value /= 100; }
    const [min, max] = RANGES[path];
    if (value < min || value > max) { rejected.push({ field: path, value, reason: `outside the plausible range ${min}–${max}` }); return null; }
    const sourceUrl = wrapped ? field.sourceUrl || field.url : null;
    const cited = sourceUrl ? (mode === 'research' ? matchCitation(sourceUrl, citations) : /^https?:\/\//i.test(sourceUrl) ? { url: sourceUrl, title: text(field.title, 160) || hostOf(sourceUrl) } : null) : null;
    // In edit mode a changed value no longer matches its citation, so it becomes the user's assumption.
    const editedAwayFromSource = mode === 'edit' && cited && finite(previous?.value) && previous.value !== value && previous.evidence?.[path]?.url === cited.url;
    if (cited && !editedAwayFromSource) { evidence[path] = { ...cited, quote: text(field.quote, 300) || null }; return value; }
    const labelled = wrapped && field.assumption === true;
    if (mode === 'research' && !labelled) {
      rejected.push({ field: path, value, reason: sourceUrl ? 'cited page was not among the retrieved search results' : 'no citation and not labelled an assumption' });
      return null;
    }
    if (mode === 'edit' && !labelled && previous?.evidence?.[path] && previous.value === value) { evidence[path] = previous.evidence[path]; return value; }
    assumptions.push(path);
    rationale[path] = text(wrapped ? field.rationale : '', 300) || (mode === 'edit' ? 'Entered by the user.' : 'Labelled an assumption by the research model.');
    return value;
  }
  const prev = path => {
    const [head, key] = path.split('.');
    const value = key ? base?.[head]?.[key] : base?.[head];
    return base ? { value, evidence: base.evidence } : null;
  };

  const categories = [];
  for (const item of Array.isArray(input.hcesCategories) ? input.hcesCategories.slice(0, 12) : []) {
    const key = matchItemGroup(typeof item === 'object' ? item?.key || item?.name : item);
    if (key && !categories.includes(key)) categories.push(key);
    else if (!key) rejected.push({ field: 'hcesCategories', value: item, reason: 'not an HCES 2023-24 item group' });
  }
  if (!categories.length) warnings.push('No HCES item groups were mapped, so potential revenue is unavailable for this sector.');

  const organisedShare = numberField('organisedShare', input.organisedShare, prev('organisedShare'));
  const onlineShareOfOrganised = numberField('onlineShareOfOrganised', input.onlineShareOfOrganised, prev('onlineShareOfOrganised'));
  const store = {};
  for (const key of STORE_KEYS) store[key] = numberField(`store.${key}`, input.store?.[key], prev(`store.${key}`));
  if (finite(store.rentPerSqFtMonthLow) && finite(store.rentPerSqFtMonthHigh) && store.rentPerSqFtMonthLow > store.rentPerSqFtMonthHigh) {
    rejected.push({ field: 'store.rentPerSqFtMonth', value: [store.rentPerSqFtMonthLow, store.rentPerSqFtMonthHigh], reason: 'rent band low is above high' });
    store.rentPerSqFtMonthLow = store.rentPerSqFtMonthHigh = null;
  }
  const partnerRequirements = {};
  for (const key of REQUIREMENT_KEYS) partnerRequirements[key] = numberField(`partnerRequirements.${key}`, input.partnerRequirements?.[key], prev(`partnerRequirements.${key}`));
  if (finite(partnerRequirements.minLaunchMonths) && finite(partnerRequirements.targetLaunchMonths) && partnerRequirements.targetLaunchMonths < partnerRequirements.minLaunchMonths) {
    rejected.push({ field: 'partnerRequirements.targetLaunchMonths', value: partnerRequirements.targetLaunchMonths, reason: 'target launch is before the minimum launch' });
    partnerRequirements.targetLaunchMonths = null;
  }
  // Missing requirements fall back to the apparel demo policy, labelled as such.
  for (const key of REQUIREMENT_KEYS) if (partnerRequirements[key] === null) {
    partnerRequirements[key] = APPAREL.partnerRequirements[key];
    assumptions.push(`partnerRequirements.${key}`); rationale[`partnerRequirements.${key}`] = 'Not researched; copied from the apparel demonstration policy.';
  }

  let scoringWeights = normalizeWeights(input.scoringWeights);
  if (!scoringWeights) { scoringWeights = { ...DEFAULT_WEIGHTS }; rationale.scoringWeights = 'Not researched; default apparel pilot weights.'; }
  else rationale.scoringWeights = text(input.scoringWeights?.rationale || input.weightsRationale, 400) || (mode === 'edit' ? 'Set by the user.' : 'Research-model judgement for this sector; not a published standard.');
  assumptions.push('scoringWeights');

  const osmTags = (Array.isArray(input.osmTags) ? input.osmTags : []).map(tag => Array.isArray(tag) ? tag : typeof tag === 'string' ? tag.split('=') : [])
    .map(([key, value]) => [text(key, 20).toLowerCase(), text(value, 40).toLowerCase()])
    .filter(([key, value]) => OSM_KEYS.has(key) && /^[a-z0-9_;]+$/.test(value)).slice(0, 12);
  const majorBrands = [...new Set((Array.isArray(input.majorBrands) ? input.majorBrands : []).map(item => text(typeof item === 'object' ? item?.name : item, 60)).filter(Boolean))].slice(0, 30);
  if (majorBrands.length) assumptions.push('majorBrands');

  const sources = [];
  const addSource = item => { if (item?.url && !sources.some(s => s.url === item.url)) sources.push({ title: item.title || hostOf(item.url), publisher: item.publisher || hostOf(item.url), url: item.url, retrievedAt: item.retrievedAt || retrievedAt }); };
  for (const item of Object.values(evidence)) addSource(item);
  if (mode === 'edit') for (const item of base?.sources || []) if (Object.values(evidence).some(e => e.url === item.url)) addSource(item);

  const hasStore = STORE_KEYS.some(key => store[key] !== null);
  const profile = {
    id, name, description: text(input.description, 400) || text(base?.description, 400) || '', version: base?.version || 0,
    hcesCategories: categories, organisedShare, onlineShareOfOrganised, osmTags, majorBrands,
    store: hasStore ? store : null, scoringWeights, partnerRequirements,
    evidence, sources, assumptions: [...new Set(assumptions)], rationale, rejected, warnings, builtIn: false,
    ...(base?.research ? { research: base.research } : {})
  };
  return { ok: true, profile, rejected, warnings };
}

/** Turn a stored or edited profile (plain numbers + evidence + assumptions) back into validator fields. */
function profileFields(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return {};
  const evidence = profile.evidence && typeof profile.evidence === 'object' ? profile.evidence : {};
  const assumed = new Set(Array.isArray(profile.assumptions) ? profile.assumptions : []);
  const wrap = (path, value) => {
    if (value === null || value === undefined || value === '') return null;
    const cited = evidence[path];
    if (cited?.url && !assumed.has(path)) return { value, sourceUrl: cited.url, title: cited.title, quote: cited.quote };
    return { value, assumption: true, rationale: profile.rationale?.[path] || 'Entered by the user.' };
  };
  return {
    name: profile.name, description: profile.description, hcesCategories: profile.hcesCategories, osmTags: profile.osmTags, majorBrands: profile.majorBrands,
    organisedShare: wrap('organisedShare', profile.organisedShare), onlineShareOfOrganised: wrap('onlineShareOfOrganised', profile.onlineShareOfOrganised),
    store: Object.fromEntries(STORE_KEYS.map(key => [key, wrap(`store.${key}`, profile.store?.[key])])),
    partnerRequirements: Object.fromEntries(REQUIREMENT_KEYS.map(key => [key, wrap(`partnerRequirements.${key}`, profile.partnerRequirements?.[key])])),
    scoringWeights: profile.scoringWeights ? { ...profile.scoringWeights, rationale: profile.rationale?.scoringWeights } : null
  };
}

const RESEARCH_PROMPT = name => `Research the Indian franchise retail sector "${name}" for a franchise expansion tool. Use Google Search. Prefer official statistics, industry reports, listed-company investor presentations and franchise disclosure pages.
Return ONLY JSON:
{"name":"short sector name","description":"one sentence",
 "hcesCategories":["HCES 2023-24 item groups whose household spend this sector captures, chosen ONLY from: ${ITEM_KEYS.join('; ')}"],
 "organisedShare":FIELD, "onlineShareOfOrganised":FIELD,
 "osmTags":[["shop|amenity|craft|healthcare|leisure|office","value"]], "majorBrands":["brand names operating stores in India"],
 "store":{"areaSqFt":FIELD,"revenuePerSqFtYear":FIELD,"capexPerSqFt":FIELD,"rentPerSqFtMonthLow":FIELD,"rentPerSqFtMonthHigh":FIELD,"grossMargin":FIELD,"royaltyRate":FIELD,"sqFtPerEmployee":FIELD},
 "scoringWeights":{"demand":n,"purchasingPower":n,"competition":n,"accessibility":n,"financial":n,"growth":n,"rationale":"why these weights suit this sector"},
 "partnerRequirements":{"minInvestmentLakh":FIELD,"minAreaSqFt":FIELD,"minLaunchMonths":FIELD,"targetLaunchMonths":FIELD}}
FIELD is {"value":number,"sourceUrl":"URL of a page you retrieved","quote":"short supporting passage"} or, when no source states it, {"value":number,"assumption":true,"rationale":"why"}; use null when you cannot estimate it.
Units: shares and margins as fractions 0-1 (organisedShare = organised share of the category's retail sales; onlineShareOfOrganised = online share within organised); money in INR; investment in lakh; rent per sq ft per month; sales per sq ft per year; durations in months. Never invent a citation or a number; label every unsourced estimate as an assumption.`;

/** Grounded research for a sector, validated before anything is returned. */
async function researchSector({ name, generate, parseJson, clientId }) {
  const clean = text(name, 80);
  if (!clean || !slug(clean)) return { ok: false, error: { code: 'invalid_name', message: 'Enter a sector name of up to 80 characters.' } };
  if (typeof generate !== 'function') return { ok: false, error: { code: 'unavailable', message: 'Research is unavailable — enter values manually or retry later.' } };
  const result = await generate({ prompt: RESEARCH_PROMPT(clean.replace(/"/g, "'")), clientId });
  if (!result?.ok) return { ok: false, error: result?.error || { code: 'upstream_error', message: 'Research provider request failed.' } };
  const parsed = parseJson(result.text);
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: { code: 'invalid_response', message: 'Research response was not valid JSON.' } };
  const checked = validateSectorProfile({ ...parsed, name: clean }, { citations: result.citations || [], mode: 'research', retrievedAt: result.retrievedAt });
  if (!checked.ok) return { ok: false, error: { code: 'invalid_response', message: checked.error } };
  checked.profile.research = { retrievedAt: result.retrievedAt || null, citations: (result.citations || []).slice(0, 20), requestedName: clean };
  return { ok: true, profile: checked.profile, rejected: checked.rejected, warnings: checked.warnings };
}

function createSectorRegistry({ store = null, cacheMs = 30000 } = {}) {
  const cache = new Map();
  const fresh = id => { const hit = cache.get(id); return hit && Date.now() - hit.at < cacheMs ? hit.profile : undefined; };
  async function getSector(id) {
    const key = id || APPAREL.id;
    const hit = fresh(key);
    if (hit !== undefined) return hit;
    const saved = store ? await store.getSector(key) : null;
    const profile = saved || (key === APPAREL.id ? APPAREL : null);
    if (profile) cache.set(key, { at: Date.now(), profile });
    return profile;
  }
  async function listSectors() {
    const saved = store ? await store.listSectors() : [...cache.values()].map(hit => hit.profile).filter(p => !p.builtIn);
    return [saved.find(p => p.id === APPAREL.id) || APPAREL, ...saved.filter(p => p.id !== APPAREL.id)];
  }
  async function saveSector(profile) {
    if (!store) throw new Error('Sector storage is unavailable');
    const saved = await store.saveSector(profile);
    cache.set(saved.id, { at: Date.now(), profile: saved });
    return saved;
  }
  return { defaultId: APPAREL.id, get: getSector, getSector, list: listSectors, listSectors, saveSector, remember(profile) { cache.set(profile.id, { at: Date.now(), profile }); } };
}

/** Lazily created Neon table; no db:init needed. */
function createSectorStore(pool) {
  let ready = null;
  const ensure = () => ready ||= pool.query(`CREATE TABLE IF NOT EXISTS market_sectors (
    id text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{1,60}$'), name text NOT NULL, profile jsonb NOT NULL,
    version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`).catch(error => { ready = null; throw error; });
  const row = r => r ? { ...r.profile, id: r.id, name: r.name, version: r.version, updatedAt: r.updated_at, builtIn: false } : null;
  return {
    async getSector(id) { await ensure(); return row((await pool.query('SELECT id,name,profile,version,updated_at FROM market_sectors WHERE id=$1', [id])).rows[0]); },
    async listSectors() { await ensure(); return (await pool.query('SELECT id,name,profile,version,updated_at FROM market_sectors ORDER BY name LIMIT 100')).rows.map(row); },
    async saveSector(profile) {
      await ensure();
      const { version, updatedAt, builtIn, ...body } = profile;
      const result = await pool.query(`INSERT INTO market_sectors (id,name,profile) VALUES ($1,$2,$3::jsonb)
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, profile=EXCLUDED.profile, version=market_sectors.version+1, updated_at=now()
        RETURNING id,name,profile,version,updated_at`, [profile.id, profile.name, JSON.stringify(body)]);
      return row(result.rows[0]);
    }
  };
}

module.exports = { APPAREL, DEFAULT_WEIGHTS, WEIGHT_KEYS, RANGES, STORE_KEYS, REQUIREMENT_KEYS, normalizeWeights, matchCitation, validateSectorProfile, profileFields, researchSector, createSectorRegistry, createSectorStore, slug };
