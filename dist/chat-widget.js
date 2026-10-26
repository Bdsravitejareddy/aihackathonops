'use strict';
// Dify-style chat drawer: answers from the page the user is on without navigating away.
// buildPageContext() turns the current page into a compact snapshot; answer() tries the rule-based
// FranchiseBot first, then facts visible on the page, then the server's Gemini answer route for a
// selected map area. mount() owns the floating launcher, glass drawer, history and accessibility.
(function (root) {
  const MAX_FACTS = 24, MAX_TEXT = 180, HISTORY_KEY = 'franchiseos-chat-widget-v1', HISTORY_LIMIT = 60;
  const PAGE_TITLES = { overview: 'Overview', applications: 'Applications', review: 'Data review', territories: 'Territories', screening: 'Simulator', market: 'Market Intelligence', expansion: 'Expansion Intelligence', onboarding: 'Onboarding', assistant: 'Franchise bot', rules: 'Scoring & rules', upload: 'Upload' };
  const GENERIC_FALLBACK = /^I can explain the current workbook/;
  const clean = (value, max = MAX_TEXT) => { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text.length > max ? text.slice(0, max - 1) + '…' : text; };
  const textOf = (el, selector) => clean(selector ? el?.querySelector(selector)?.textContent : el?.textContent);
  const fact = (label, value, note) => { const item = { label: clean(label, 80), value: clean(value, 120) }; if (note) item.note = clean(note); return item; };
  const count = (results, status) => results.filter(a => a.status === status).length;

  // Gaps are values the page could not supply. They never become text in a summary; they are reported once.
  const GAP = /^(?:—|–|-|n\/a|not estimated|unavailable|not available|no data|not in the pin dataset|missing|none|undefined|null|nan|)$/i;
  const isGap = value => value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value)) || GAP.test(String(value).trim());
  const money = value => isGap(value) ? null : formatMetric({ value: Number(value), unit: 'INR' });
  const people = value => isGap(value) ? null : `${Math.round(Number(value)).toLocaleString('en-IN')} people`;
  const months = value => isGap(value) ? null : `${value} months`;
  const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  const fieldOf = (label, value, note) => isGap(value) ? null : { label: clean(label, 80), value: clean(value, 120), ...(isGap(note) ? {} : { note: clean(note, 140) }) };
  const gapsOf = (...pairs) => pairs.filter(([, value]) => isGap(value)).map(([label]) => label);

  // Overview and applications read the workbook state and the cards the page already computed.
  function overviewData({ state = {}, results = [] }) {
    const count = status => results.filter(a => a.status === status).length, inCategory = name => results.filter(a => a.category === name).length;
    const slotsTotal = (state.territories || []).reduce((n, t) => n + (Number.isInteger(t.slots) ? t.slots : 0), 0);
    const data = { applications: results.length, recommended: count('Recommended'), clarification: count('Clarification needed'), siteNeeded: count('Site needed'), waitlisted: count('Waitlisted'), dataRequired: inCategory('Data required'), futureExpansion: inCategory('Future expansion'), notAccepted: inCategory('Not accepted'),
      territories: (state.territories || []).length, pendingCorrections: (state.apps || []).reduce((n, a) => n + (a.pending?.length || 0), 0), source: state.source || null, slotsTotal, slotsRecommended: count('Recommended') };
    return { data, facts: [fieldOf('Total applications', data.applications), fieldOf('Recommended partners', data.recommended), fieldOf('Data required', data.dataRequired),
      fieldOf('Future expansion', data.futureExpansion), fieldOf('Not accepted', data.notAccepted), fieldOf('Territories uploaded', data.territories),
      fieldOf('Pending data corrections', data.pendingCorrections), fieldOf('Data source', data.source)].filter(Boolean), gaps: [] };
  }
  function applicationsData({ results = [] }) {
    const byStatus = {};
    for (const a of results) byStatus[a.category || a.status || 'Unscreened'] = (byStatus[a.category || a.status || 'Unscreened'] || 0) + 1;
    const top = [...results].filter(a => Number.isFinite(a.score)).sort((a, b) => b.score - a.score)[0] || null;
    const held = byStatus['Clarification needed'] || 0;
    const data = { total: results.length, byStatus, held, top: top ? { id: top.id, name: clean(top.name || top.id, 60), score: Math.round(top.score), grade: top.grade || null } : null };
    return { data, facts: [fieldOf('Total applications', data.total), ...Object.entries(byStatus).map(([s, n]) => fieldOf(s, n)), top && fieldOf('Highest score', `${top.name || top.id} · ${Math.round(top.score)}`)].filter(Boolean), gaps: [] };
  }

  function territoriesData({ state = {}, results = [], economics = null }) {
    const rows = (state.territories || []).map(t => {
      const apps = results.filter(a => a.territory === t.id), econ = economics?.[t.id] || null, agg = econ?.aggregate || null;
      const pins = econ?.pins || [];
      return { id: t.id, city: clean(t.city || '', 60) || null, tier: t.tier || null, priority: t.priority || null,
        applications: apps.length, recommended: apps.filter(a => a.status === 'Recommended').length, slots: Number.isInteger(t.slots) ? t.slots : null,
        catchment: Number.isFinite(agg?.catchmentPopulation?.value) ? agg.catchmentPopulation.value : null,
        tam: Number.isFinite(agg?.tam?.value) ? agg.tam.value : null,
        investment: Number.isFinite(agg?.investment?.mid) ? agg.investment.mid : null,
        payback: Number.isFinite(agg?.payback?.best?.base) ? agg.payback.best.base : null,
        pinsWithData: agg?.catchmentPopulation?.pinsWithData ?? null, pinsTotal: agg?.catchmentPopulation?.pinsTotal ?? (Array.isArray(t.pins) ? t.pins.length : null),
        pinsMissing: econ ? pins.filter(r => r.status !== 'available').length : null, economicsLoaded: !!econ };
    });
    const slotsTotal = rows.reduce((n, r) => n + (r.slots || 0), 0);
    const data = { territories: rows, total: rows.length, applications: results.length, recommended: results.filter(a => a.status === 'Recommended').length, slotsTotal, economicsLoaded: !!economics };
    const facts = rows.flatMap(r => [fieldOf(`${r.id}${r.city ? ' · ' + r.city : ''}`, `${plural(r.applications, 'applicant')}, ${r.recommended} recommended${r.slots !== null ? `, ${plural(r.slots, 'slot')}` : ''}`),
      fieldOf(`${r.id} catchment`, people(r.catchment), r.pinsTotal ? `${r.pinsWithData} of ${r.pinsTotal} PINs with data` : null), fieldOf(`${r.id} payback`, months(r.payback))]);
    const gaps = economics ? [] : ['PIN economics are still loading'];
    return { data, facts: facts.filter(Boolean), gaps };
  }
  function expansionData({ location, main, doc }) {
    const popupEl = doc?.querySelector?.('.maplibregl-popup-content [data-popup-geography]');
    const popupId = popupEl?.dataset?.popupGeography;
    if (popupId && popupId !== String(location?.id || '')) location = { id: popupId, name: clean(popupEl.querySelector('header strong')?.textContent || popupId, 80), level: /^pin:/.test(popupId) ? 'pin' : null, metrics: {} };
    const area = location?.id ? { id: String(location.id), name: clean(location.name || location.id, 80), level: location.level || null,
      metrics: Object.entries(location.metrics || {}).filter(([, m]) => Number.isFinite(m?.value)).slice(0, 12).map(([key, m]) => ({ label: key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(), value: formatMetric(m) })) } : null;
    const popupKpis = [...(doc?.querySelectorAll('.maplibregl-popup-content .expansion-popup-kpi') || [])].map(kpi => ({
      title: clean(kpi.querySelector('span')?.textContent, 60), value: clean(kpi.querySelector('strong')?.textContent, 60), note: clean(kpi.querySelector('small')?.textContent, 100) }));
    const status = clean(doc?.querySelector('.maplibregl-popup-content .expansion-popup-status span')?.textContent, 60) || null;
    const popup = popupKpis.length ? { kpis: popupKpis.filter(k => !isGap(k.value)), missing: popupKpis.filter(k => isGap(k.value)).map(k => k.title), status } : null;
    const place = clean(main?.querySelector('[data-map-place-title]')?.textContent, 80) || null;
    return { data: { area, popup, place }, facts: [area && fieldOf('Selected area', area.name), ...(area?.metrics || []).map(m => fieldOf(m.label, m.value)),
      ...(popup?.kpis || []).map(k => fieldOf(k.title, k.value, k.note))].filter(Boolean), gaps: popup?.missing?.length ? [`${popup.missing.join(', ')} not estimated for this area`] : [] };
  }
  function rulesData({ state = {} }) {
    const s = state.settings || {};
    const data = { model: s.model || null, sector: s.sectorName || null, minInvestment: s.minInvestment ?? null, minArea: s.minArea ?? null, minLaunch: s.minLaunch ?? null, targetLaunch: s.targetLaunch ?? null };
    return { data, facts: [fieldOf('Scoring model', data.model), fieldOf('Sector', data.sector), fieldOf('Minimum investment', data.minInvestment && `₹${data.minInvestment} lakh`),
      fieldOf('Minimum area', data.minArea && `${data.minArea} sq ft`), fieldOf('Launch window', data.minLaunch && `${data.minLaunch}–${data.targetLaunch} months`)].filter(Boolean), gaps: [] };
  }
  // The open application drawer names its applicant; that applicant is the context for follow-up questions.
  function applicantInView({ results = [], doc, botContext }) {
    const drawerId = clean(doc?.querySelector('#overlay:not([hidden]) .drawer .eyebrow')?.textContent, 80).split(' · ')[0];
    const a = (drawerId && results.find(item => item.id === drawerId)) || results.find(item => item.key === botContext);
    return a ? { id: a.id, name: clean(a.name || 'Name missing', 80), status: a.status, score: a.score, high: a.high, grade: a.grade, territory: a.territory || null, reasons: (a.reasons || []).slice(0, 4).map(r => clean(r)) } : null;
  }

  // Builds the snapshot for the page the user is on: structured data, labelled facts and gaps.
  function buildPageContext({ tab = 'overview', state = {}, results = [], stores = [], botContext = null, doc = root.document, location = null, economics = null } = {}) {
    const page = PAGE_TITLES[tab] ? tab : 'overview';
    const main = doc?.querySelector?.('#main') || doc?.body || null;
    const base = { state, results, stores, doc, location, main, economics };
    const built = page === 'overview' ? overviewData(base) : page === 'applications' || page === 'review' || page === 'onboarding' ? applicationsData(base)
      : page === 'territories' ? territoriesData(base) : page === 'expansion' || page === 'market' || page === 'screening' ? expansionData(base)
      : page === 'rules' ? rulesData(base) : { data: {}, facts: [], gaps: [] };
    const applicant = applicantInView({ results, doc, botContext });
    if (applicant) built.facts.unshift(fieldOf('Applicant in view', `${applicant.id} · ${applicant.status}`));
    const ctx = { page, title: PAGE_TITLES[page], heading: clean(main?.querySelector?.('.page-heading h1, h1')?.textContent, 80), data: built.data, facts: built.facts.slice(0, MAX_FACTS),
      gaps: built.gaps, geography: built.data.area || null, applicant };
    ctx.suggestions = suggestionsFor(ctx, results);
    return ctx;
  }

  function suggestionsFor(ctx, results) {
    const held = results.find(a => a.status === 'Clarification needed') || results[0];
    const area = ctx.geography?.name;
    const byPage = {
      overview: ['Summarise this page', 'Who should move forward?', 'What needs my attention?'],
      applications: ['Who should move forward?', held && `Why is ${held.id} on hold?`, 'Summarise this page'],
      review: ['What needs my attention?', 'How are scores calculated?', 'Summarise this page'],
      territories: ['Summarise this page', 'Who should move forward?', 'How are territories allocated?'],
      expansion: area ? [`What is the potential revenue in ${area}?`, `Is ${area} a good market for a store?`, 'Summarise this page'] : ['Summarise this page', 'How do I read this map?', 'Where should we grow next?'],
      market: area ? [`What is the market size in ${area}?`, 'Summarise this page'] : ['Summarise this page', 'How do I read this map?'],
      rules: ['How are scores calculated?', 'What are the minimum requirements?', 'Summarise this page'],
      onboarding: ['Who should move forward?', 'Summarise this page']
    };
    const list = [...(ctx.applicant ? [`Why is ${ctx.applicant.id} ${ctx.applicant.status}?`] : []), ...(byPage[ctx.page] || ['Summarise this page'])].filter(Boolean);
    return [...new Set(list)].slice(0, 4);
  }

  const words = text => new Set(String(text).toLowerCase().match(/[a-z₹]{3,}/g) || []);
  const STOP = new Set(['what', 'the', 'this', 'that', 'is', 'are', 'how', 'for', 'and', 'with', 'here', 'page', 'there', 'about', 'many', 'much', 'does', 'show', 'tell', 'area', 'selected', 'good', 'store', 'market', 'mass', 'should', 'open', 'place', 'location']);
  // Lookup-style questions ('what is…', 'how many…') can be answered straight from the page; open ones go to research.
  const LOOKUP = /^(?:what(?:'s| is| are)?|how (?:much|many)|which|show|list|tell me the)\b/i;
  function matchFacts(question, ctx) {
    const asked = [...words(question)].filter(w => !STOP.has(w));
    if (!asked.length) return [];
    return ctx.facts.filter(item => { const label = words(item.label); return asked.some(w => label.has(w) || label.has(w.replace(/s$/, ''))); });
  }
  const factLines = facts => facts.map(f => `• ${f.label}: ${f.value}${f.note ? ` (${f.note})` : ''}`).join('\n');
  // Three to five short bullets from the structured data. Gaps are one line, not repeated per field.
  function bulletsFor(ctx) {
    const d = ctx.data || {}, out = [];
    if (ctx.page === 'overview') {
      out.push(`${plural(d.applications, 'application')}: ${d.recommended} recommended, ${d.dataRequired} data required, ${d.futureExpansion} future expansion`);
      if (d.slotsTotal) out.push(`${d.slotsRecommended} of ${d.slotsTotal} territory slots recommended`);
      if (d.pendingCorrections) out.push(`${plural(d.pendingCorrections, 'data correction')} waiting for review`);
      if (d.territories) out.push(`${plural(d.territories, 'territory', 'territories')} loaded${d.source ? ` from ${d.source}` : ''}`);
    } else if (ctx.page === 'applications' || ctx.page === 'review' || ctx.page === 'onboarding') {
      const statuses = Object.entries(d.byStatus || {}).filter(([, n]) => n).map(([s, n]) => `${n} ${s.toLowerCase()}`);
      out.push(`${plural(d.total, 'application')}${statuses.length ? `: ${statuses.join(', ')}` : ''}`);
      if (d.top) out.push(`Highest score: ${d.top.name} (${d.top.id}, ${d.top.score}${d.top.grade ? `, grade ${d.top.grade}` : ''})`);
      if (d.held) out.push(`${plural(d.held, 'application')} missing details before scoring can finish`);
    } else if (ctx.page === 'territories') {
      const rows = d.territories || [];
      if (rows.length) {
        const headline = `${plural(d.total, 'territory', 'territories')}, ${plural(d.applications, 'application')}`;
        out.push(d.slotsTotal ? `${headline}, ${d.recommended} of ${d.slotsTotal} slots recommended` : `${headline}, ${d.recommended} recommended`);
        const byCity = {};
        for (const r of rows) if (r.city) { byCity[r.city] = byCity[r.city] || { applications: 0, recommended: 0 }; byCity[r.city].applications += r.applications; byCity[r.city].recommended += r.recommended; }
        const top = Object.entries(byCity).sort((a, b) => b[1].applications - a[1].applications)[0];
        if (top && top[1].applications) out.push(`${top[0]} has the most applicants (${top[1].applications})${top[1].recommended ? `, with ${top[1].recommended} recommended` : ' but no recommendation yet'}`);
        const largest = rows.filter(r => r.catchment !== null).sort((a, b) => b.catchment - a.catchment)[0];
        if (largest) out.push(`Largest catchment: ${largest.id}${largest.city ? ` (${largest.city})` : ''} with ${people(largest.catchment)}${largest.pinsTotal ? `, ${largest.pinsWithData} of ${largest.pinsTotal} PINs with data` : ''}`);
        const missing = rows.filter(r => r.economicsLoaded && r.pinsMissing > 0).length;
        if (missing) out.push(`${plural(missing, 'territory', 'territories')} use PINs that are not in the PIN dataset, so ${missing === 1 ? 'its economics are' : 'their economics are'} unavailable`);
      }
    } else if (ctx.page === 'expansion' || ctx.page === 'market' || ctx.page === 'screening') {
      if (d.area) {
        const m = d.area.metrics.find(x => /potential revenue/.test(x.label)) || d.area.metrics[0];
        out.push(m ? `${d.area.name}: ${m.label} ${m.value}` : `${d.area.name} is selected`);
        for (const k of (d.popup?.kpis || []).slice(0, 2)) out.push(`${k.title}: ${k.value}`);
        if (d.popup?.status) out.push(`Estimate status: ${d.popup.status}`);
      } else out.push('No area is selected. Select an area on the map to see its potential revenue, TAM and population.');
    } else if (ctx.page === 'rules') {
      out.push(`Scoring model: ${d.model || 'not set'}${d.sector ? ` · sector ${d.sector}` : ''}`);
      if (d.minInvestment) out.push(`Minimum investment ₹${d.minInvestment} lakh, minimum area ${d.minArea || '?'} sq ft`);
      if (d.minLaunch) out.push(`Launch window ${d.minLaunch}–${d.targetLaunch} months`);
    }
    if (!out.length) out.push(`${ctx.title} has no figures loaded yet.`);
    if (ctx.gaps?.length && out.length < 5) out.push(`Not available: ${ctx.gaps.join('; ')}`);
    return out.slice(0, 5);
  }
  function summary(ctx) {
    return `${ctx.title}${ctx.heading && ctx.heading !== ctx.title ? ` · ${ctx.heading}` : ''}\n${bulletsFor(ctx).map(b => `• ${b}`).join('\n')}`;
  }
  const formatMetric = metric => {
    const unit = String(metric.unit || '');
    if (/^(?:INR|₹)/i.test(unit)) return root.FranchiseDisplay ? root.FranchiseDisplay.money(metric.value, unit) : `₹${Number(metric.value).toLocaleString('en-IN', { maximumFractionDigits: 0 })} ${unit.replace(/^(?:INR|₹)\s*/i, '/') || ''}`.trim();
    return `${Number(metric.value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}${unit ? ' ' + unit : ''}`;
  };

  const GREETING = /^(?:hi|hello|hey|hiya|namaste|good (?:morning|afternoon|evening)|thanks|thank you|ok(?:ay)?|cool)[\s!.?]*$/i;
  const HOW = /\b(how|why|what|criteria|method|methodology|calculat|formula|explain|mean|means|work out|derived?)\b/i;
  // How the app calculates each figure, in plain words. These follow the deterministic models, not web research.
  const METHODS = [
    { topic: /\b(pay ?back|break[- ]?even|roi|return on investment)\b/i, text: [
      'Payback is how many months it takes a store\'s cash flow to cover its opening investment.',
      '• Sales: one store sells the area\'s potential revenue × a capture rate (10% in the base case), capped at what its floor space can sell.',
      '• Monthly cash: sales × (gross margin − royalty − marketing), minus rent, staff and utilities.',
      '• Investment: fit-out, rent deposit, opening stock, franchise fee, pre-opening costs and a cash reserve, priced for the city tier.',
      '• Payback is the first month the running total turns positive. If that does not happen within 5 years, the app shows "> 5 yrs".'] },
    { topic: /\b(potential revenue|organi[sz]ed (?:store )?demand)\b/i, text: [
      'Potential revenue is the yearly apparel spend that organised physical stores can win in an area.',
      '• Population (modelled 2020) × monthly clothing and footwear spend per person (HCES 2023–24, rural and urban) × 12.',
      '• × the organised physical-store share: 41% organised × 78% offline (CareEdge FY25).',
      '• It is demand for the whole area, not one store\'s sales.'] },
    { topic: /\b(tam|total addressable|market size|category spend)\b/i, text: [
      'TAM is everything residents spend on clothing and footwear in a year.',
      '• Population × monthly spend per person (HCES 2023–24, rural and urban weighted) × 12.',
      '• It covers every channel, online included, so it is larger than potential revenue.'] },
    { topic: /\b(investment|capex|set ?up cost|cost to open)\b/i, text: [
      'Investment required is the cost to open one store in the base case:',
      '• fit-out per sq ft, a rent deposit, opening stock, the franchise fee, pre-opening costs and a few months of fixed costs as a reserve.',
      '• Rent and wages follow the city tier (HRA class X, Y or Z). The range runs from the cheapest to the most expensive end of each cost.'] },
    { topic: /\b(categor(?:y|ies)|classif\w*|data required|future expansion|not accepted)\b/i, text: [
      'Every application falls into one of three categories:',
      '• Recommended: meets the requirements and has a territory slot.',
      '• Data required: something is missing, conflicting or below a requirement (funding, area, site, floor, launch timing).',
      '• Future expansion: a good application where the location does not fit right now (a higher-ranked applicant has the slot, or the brand is not opening in that pin code).',
      '• Not accepted: a store already trades in that pin code, and the brand never opens two stores in one pin code.'] }
  ];
  function methodAnswer(text, ctx, doc) {
    // A question about a named application belongs to the rule bot, which knows that applicant's reasons.
    if (!HOW.test(text) || /\b[A-Z]{2,}-\d{2,}\b/i.test(text)) return null;
    const method = METHODS.find(item => item.topic.test(text));
    if (!method) return null;
    const steps = /\b(pay ?back|break[- ]?even|roi)\b/i.test(text) ? [...(doc?.querySelectorAll?.('.analysis-why li') || [])].map(li => `• ${clean(li.textContent, 400)}`) : [];
    return method.text.join('\n') + (steps.length ? `\n\nFor ${ctx.geography?.name || 'this area'}:\n${steps.join('\n')}` : '');
  }

  // Greetings and method questions first (instant), then the rule bot, page facts, and Gemini for a selected map area.
  async function answer(question, { ctx, env, bot = root.FranchiseBot, fetch = root.fetch?.bind(root), segment = 'mass-market-family-apparel', doc = root.document } = {}) {
    const text = String(question || '').trim();
    if (!text) return null;
    if (GREETING.test(text)) return { text: `Hi! I answer from the page you are on.${ctx.suggestions?.length ? ` Try: ${ctx.suggestions.slice(0, 2).map(item => `"${item}"`).join(' or ')}.` : ''}`, source: 'page' };
    if (/\bsummar|\boverview of (?:this|the) page\b|\bwhat am i (?:looking at|seeing)\b|\b(?:on|about) this page\b/i.test(text)) return { text: summary(ctx), source: 'page' };
    const method = methodAnswer(text, ctx, doc);
    if (method) return { text: method, source: 'page' };
    const mapPage = ['expansion', 'market', 'screening'].includes(ctx.page);
    const facts = matchFacts(text, ctx);
    if (mapPage && facts.length && LOOKUP.test(text) && !/\b(why|should|good|best|compare|risk)\b/i.test(text)) return { text: `From this page:\n${factLines(facts)}`, source: 'page' };
    let ruled = null;
    if (bot && env) { try { ruled = bot.answer(text, env); } catch { ruled = null; } }
    if (ruled && !GENERIC_FALLBACK.test(ruled.text || '')) return { text: ruled.text, source: 'rules', contextKey: ruled.contextKey || null, proposal: ruled.proposal || null, navigation: ruled.navigation || null };
    if (facts.length) return { text: `From this page:\n${factLines(facts)}`, source: 'page' };
    if (ctx.geography?.id && fetch) {
      try {
        const response = await fetch(`/api/market/map/geographies/${encodeURIComponent(ctx.geography.id)}/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: text.slice(0, 2000), segment }) });
        const result = await response.json().catch(() => ({}));
        if (response.ok && result.answer) return { text: result.answer, source: 'gemini', citations: (result.citations || []).filter(c => /^https?:\/\//.test(c?.url || '')).slice(0, 5), model: result.modelVersion || null };
        return { text: `Gemini research isn't available for ${ctx.geography.name} right now (${clean(result.error || `status ${response.status}`, 120)}). Here is what the page shows instead:\n${factLines(ctx.facts.slice(0, 8)) || 'No figures loaded.'}`, source: 'notice' };
      } catch (error) {
        return { text: `Gemini research couldn't be reached (${clean(error.message, 100)}). ${ruled?.text || summary(ctx)}`, source: 'notice' };
      }
    }
    const hint = ['expansion', 'market'].includes(ctx.page) ? '\n\nSelect an area on the map to ask open research questions about it (answered by Gemini with sources).' : '';
    return { text: (ruled?.text || summary(ctx)) + hint, source: ruled ? 'rules' : 'page' };
  }

  function loadHistory(storage) { try { const rows = JSON.parse(storage?.getItem(HISTORY_KEY) || '[]'); return Array.isArray(rows) ? rows.slice(-HISTORY_LIMIT) : []; } catch { return []; } }
  function saveHistory(storage, rows) { try { storage?.setItem(HISTORY_KEY, JSON.stringify(rows.slice(-HISTORY_LIMIT))); } catch { /* storage may be unavailable */ } }

  // Floating launcher + glass drawer. `provider()` returns {tab,state,results,stores,botContext};
  // app hooks: setBotContext(key), confirmProposal(proposal) -> {text}|{error}, navigate(action).
  function mount({ launcher, provider, app = {}, doc = root.document, storage = root.sessionStorage, fetch = root.fetch?.bind(root), reducedMotion = !!root.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches } = {}) {
    let history = loadHistory(storage), open = false, busy = false, pending = null, lastLocation = null, typing = null;
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const drawer = doc.createElement('section');
    drawer.className = 'fc-drawer'; drawer.hidden = true; drawer.id = 'franchise-chat';
    drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-modal', 'true'); drawer.setAttribute('aria-labelledby', 'fc-title');
    drawer.innerHTML = `<header class="fc-head"><div><h2 id="fc-title">Franchise bot</h2><p class="fc-context" data-fc-context></p></div><button type="button" class="fc-icon" data-fc-clear aria-label="Start a new conversation" title="New conversation">↺</button><button type="button" class="fc-icon" data-fc-close aria-label="Close chat">×</button></header>
      <div class="fc-log" data-fc-log role="log" aria-live="polite" aria-relevant="additions"></div>
      <div class="fc-suggestions" data-fc-suggestions aria-label="Suggested questions"></div>
      <form class="fc-form" data-fc-form><label class="fc-sr" for="fc-input">Ask about this page</label><textarea id="fc-input" rows="1" maxlength="2000" placeholder="Ask about this page…" required></textarea><button type="submit" class="fc-send" aria-label="Send">↑</button></form>`;
    doc.body.append(drawer);
    const $ = selector => drawer.querySelector(selector);
    if (launcher) { launcher.setAttribute('aria-haspopup', 'dialog'); launcher.setAttribute('aria-controls', drawer.id); launcher.setAttribute('aria-expanded', 'false'); }
    // PIN economics for the territories snapshot come from the same endpoint the page uses, cached per territory.
    const economicsCache = new Map();
    async function economicsFor(p) {
      if (!root.TerritoryEconomics || !p.state?.territories) return null;
      const rows = await Promise.all(p.state.territories.map(async t => {
        const pins = (t.pins || []).map(String), key = [t.id, pins.join(','), t.slots ?? ''].join('|');
        if (!economicsCache.has(key)) economicsCache.set(key, root.TerritoryEconomics.load(pins, { slots: Number.isInteger(t.slots) ? t.slots : null, fetch }).catch(() => null));
        return [t.id, await economicsCache.get(key)];
      }));
      return Object.fromEntries(rows.filter(([, value]) => value));
    }
    const context = async () => {
      const p = provider?.() || {};
      const economics = p.tab === 'territories' ? await economicsFor(p) : null;
      return { ctx: buildPageContext({ ...p, doc, location: lastLocation, economics }), env: p.state ? { state: p.state, results: p.results || [], stores: p.stores || [], contextKey: p.botContext || null } : null };
    };

    function bubble(message) {
      const cites = (message.citations || []).map(c => `<a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(c.title || c.url)} ↗</a>`).join('');
      const tag = { rules: 'Workbook rules', page: 'From this page', gemini: 'Gemini · grounded', notice: 'Fallback' }[message.source] || '';
      return `<div class="fc-msg ${message.role === 'user' ? 'is-user' : ''}" data-fc-msg>${message.role === 'user' ? '' : `<span class="fc-tag">${esc(tag)}${message.page ? ` · ${esc(PAGE_TITLES[message.page] || message.page)}` : ''}</span>`}<div class="fc-text">${esc(message.text)}</div>${cites ? `<div class="fc-cites">${cites}</div>` : ''}${message.proposal ? `<div class="fc-actions"><button type="button" class="fc-chip is-primary" data-fc-confirm>Confirm & reassess</button><button type="button" class="fc-chip" data-fc-cancel>Cancel</button></div>` : ''}${message.navigation ? `<div class="fc-actions"><button type="button" class="fc-chip" data-fc-nav="${esc(message.navigation.route)}">Open ${esc(message.navigation.label || 'section')} ↗</button></div>` : ''}</div>`;
    }
    // Header and suggestions do not need PIN economics, so they render from the synchronous snapshot.
    const quickContext = () => buildPageContext({ ...(provider?.() || {}), doc, location: lastLocation });
    function renderLog() {
      const ctx = quickContext();
      $('[data-fc-context]').textContent = `Answering from ${ctx.title}${ctx.geography ? ` · ${ctx.geography.name}` : ctx.applicant ? ` · ${ctx.applicant.id}` : ''}`;
      const intro = { role: 'bot', source: 'page', text: 'Ask about what you are looking at. I answer from this page and your workbook; open questions about a selected map area use Gemini research with sources.' };
      $('[data-fc-log]').innerHTML = [intro, ...history].map(bubble).join('');
      $('[data-fc-suggestions]').innerHTML = ctx.suggestions.map(q => `<button type="button" class="fc-chip" data-fc-ask="${esc(q)}">${esc(q)}</button>`).join('');
      scroll();
    }
    const scroll = () => { const log = $('[data-fc-log]'); log.scrollTop = log.scrollHeight; };
    // Streaming feel: reveal the answer a few words at a time; instant with reduced motion.
    function reveal(node, text) {
      return new Promise(resolve => {
        if (reducedMotion) { node.textContent = text; resolve(); return; }
        const parts = text.split(/(\s+)/); let index = 0;
        typing = root.setInterval(() => { index = Math.min(parts.length, index + 6); node.textContent = parts.slice(0, index).join(''); scroll(); if (index >= parts.length) { root.clearInterval(typing); typing = null; resolve(); } }, 24);
      });
    }
    async function ask(question) {
      const text = String(question || '').trim();
      if (!text || busy) return;
      busy = true; drawer.setAttribute('aria-busy', 'true');
      const { ctx, env } = await context();
      history.push({ role: 'user', text, page: ctx.page }); renderLog();
      const log = $('[data-fc-log]'), thinking = doc.createElement('div');
      thinking.className = 'fc-msg fc-thinking'; thinking.innerHTML = '<span class="fc-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="fc-sr">Thinking…</span>'; log.append(thinking); scroll();
      let reply;
      try { reply = await answer(text, { ctx, env, fetch, doc }); } catch (error) { reply = { text: `Something went wrong: ${error.message}`, source: 'notice' }; }
      if (reply?.contextKey !== undefined) app.setBotContext?.(reply.contextKey);
      pending = reply?.proposal || null;
      const message = { role: 'bot', page: ctx.page, ...reply };
      thinking.remove(); log.insertAdjacentHTML('beforeend', bubble({ ...message, text: '' }));
      await reveal(log.lastElementChild.querySelector('.fc-text'), message.text);
      history.push(message); saveHistory(storage, history);
      busy = false; drawer.removeAttribute('aria-busy'); renderLog();
    }
    function focusables() { return [...drawer.querySelectorAll('button:not([disabled]),textarea,a[href]')].filter(el => !el.closest('[hidden]')); }
    function onKey(event) {
      if (!open) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key === 'Tab') {
        const items = focusables(); if (!items.length) return;
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
        else if (!drawer.contains(doc.activeElement)) { event.preventDefault(); first.focus(); }
      }
    }
    function show() { if (open) return; open = true; drawer.hidden = false; doc.body.classList.add('fc-open'); launcher?.setAttribute('aria-expanded', 'true'); renderLog(); $('#fc-input').focus(); }
    function close() { if (!open) return; open = false; drawer.hidden = true; doc.body.classList.remove('fc-open'); if (typing) { root.clearInterval(typing); typing = null; } launcher?.setAttribute('aria-expanded', 'false'); launcher?.focus(); }
    function onDrawerClick(event) {
      const el = event.target.closest('button'); if (!el) return;
      const d = el.dataset;
      if ('fcClose' in d) close();
      else if ('fcClear' in d) { history = []; pending = null; saveHistory(storage, history); renderLog(); $('#fc-input').focus(); }
      else if (d.fcAsk) ask(d.fcAsk);
      else if ('fcConfirm' in d && pending) { const result = app.confirmProposal?.(pending) || { error: 'Confirm this update from the Franchise bot page.' }; pending = null; history.push({ role: 'bot', source: 'rules', text: result.error || result.text }); saveHistory(storage, history); renderLog(); }
      else if ('fcCancel' in d) { pending = null; history.push({ role: 'bot', source: 'rules', text: 'Update cancelled. Application retained as it was.' }); saveHistory(storage, history); renderLog(); }
      else if (d.fcNav) app.navigate?.({ type: 'navigate', route: d.fcNav, execute: false, permission: 'read' });
    }
    const onLauncher = event => { event.preventDefault(); event.stopPropagation(); open ? close() : show(); };
    const onSubmit = event => { event.preventDefault(); const input = $('#fc-input'); const value = input.value; input.value = ''; ask(value); };
    const onEnter = event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); const form = $('[data-fc-form]'); if (form.requestSubmit) form.requestSubmit(); else onSubmit(event); } };
    const onLocation = event => { lastLocation = event.detail || null; if (open) renderLog(); };
    const onHash = () => { if (open) renderLog(); };
    launcher?.addEventListener('click', onLauncher);
    drawer.addEventListener('click', onDrawerClick);
    $('[data-fc-form]').addEventListener('submit', onSubmit);
    $('#fc-input').addEventListener('keydown', onEnter);
    doc.addEventListener('keydown', onKey);
    root.addEventListener?.('franchiseos:location-selected', onLocation);
    root.addEventListener?.('hashchange', onHash);
    return { open: show, close, ask, isOpen: () => open, history: () => history.slice(),
      destroy() { close(); launcher?.removeEventListener('click', onLauncher); doc.removeEventListener('keydown', onKey); root.removeEventListener?.('franchiseos:location-selected', onLocation); root.removeEventListener?.('hashchange', onHash); drawer.remove(); } };
  }

  const api = { buildPageContext, answer, mount, matchFacts, bulletsFor, summarise: summary, PAGE_TITLES };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FranchiseChat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
