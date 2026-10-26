'use strict';
// Dify-style chat drawer: answers from the page the user is on without navigating away.
// buildPageContext() turns the current page into a compact snapshot; answer() tries the rule-based
// FranchiseBot first, then facts visible on the page, then the server's Gemini answer route for a
// selected map area. mount() owns the floating launcher, glass drawer, history and accessibility.
(function (root) {
  const MAX_FACTS = 24, MAX_TEXT = 180, HISTORY_KEY = 'franchiseos-chat-widget-v1', HISTORY_LIMIT = 60;
  const PAGE_TITLES = { overview: 'Overview', ceo: 'CEO view', applications: 'Applications', review: 'Data review', territories: 'Territories', screening: 'Territory Screening', market: 'Market Intelligence', expansion: 'Expansion Intelligence', onboarding: 'Onboarding', assistant: 'Franchise bot', rules: 'Scoring & rules', upload: 'Upload' };
  const GENERIC_FALLBACK = /^I can explain the current workbook/;
  const clean = (value, max = MAX_TEXT) => { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text.length > max ? text.slice(0, max - 1) + '…' : text; };
  const textOf = (el, selector) => clean(selector ? el?.querySelector(selector)?.textContent : el?.textContent);
  const fact = (label, value, note) => { const item = { label: clean(label, 80), value: clean(value, 120) }; if (note) item.note = clean(note); return item; };
  const count = (results, status) => results.filter(a => a.status === status).length;

  function geographyFrom(location) {
    if (!location?.id) return null;
    const metrics = Object.entries(location.metrics || {}).filter(([, m]) => m && typeof m === 'object' && Number.isFinite(m.value)).slice(0, 12)
      .map(([key, m]) => fact(key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(), formatMetric(m), m.evidenceClass));
    return { id: String(location.id), name: clean(location.name || location.id, 80), level: location.level || null, metrics };
  }
  function formatMetric(metric) {
    const unit = String(metric.unit || '');
    if (/^(?:INR|₹)/i.test(unit)) return root.FranchiseDisplay ? root.FranchiseDisplay.money(metric.value, unit) : `₹${Number(metric.value).toLocaleString('en-IN', { maximumFractionDigits: 0 })} ${unit.replace(/^(?:INR|₹)\s*/i, '/') || ''}`.trim();
    return `${Number(metric.value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}${unit ? ' ' + unit : ''}`;
  }

  // Compact, size-capped snapshot of what the user is looking at. Pure apart from reading `doc`.
  function buildPageContext({ tab = 'overview', state = {}, results = [], stores = [], botContext = null, doc = root.document, location = null } = {}) {
    const page = PAGE_TITLES[tab] ? tab : 'overview';
    const ctx = { page, title: PAGE_TITLES[page], heading: '', facts: [], geography: null, applicant: null, suggestions: [] };
    const main = doc?.querySelector('#main') || doc?.body;
    ctx.heading = textOf(main, '.page-heading h1') || textOf(main, 'h1');
    const add = (...items) => { for (const item of items) if (item.value && ctx.facts.length < MAX_FACTS) ctx.facts.push(item); };
    const apps = state.apps || [];
    // The application open in the detail drawer, else the one the bot is already discussing.
    const drawerId = textOf(doc?.querySelector('#overlay:not([hidden]) .drawer'), '.eyebrow').split(' · ')[0];
    const inView = (drawerId && results.find(a => a.id === drawerId)) || results.find(a => a.key === botContext);
    if (inView) ctx.applicant = { id: inView.id, name: clean(inView.name || 'Name missing', 80), status: inView.status, score: inView.score, high: inView.high, grade: inView.grade, territory: inView.territory || null, reasons: (inView.reasons || []).slice(0, 4).map(r => clean(r)) };

    if (page === 'overview' || page === 'applications' || page === 'review' || page === 'onboarding') {
      add(fact('Total applications', results.length), fact('Recommended partners', count(results, 'Recommended')),
        fact('Clarification needed', count(results, 'Clarification needed')), fact('Site needed', count(results, 'Site needed')),
        fact('Waitlisted', count(results, 'Waitlisted')), fact('Territories uploaded', (state.territories || []).length),
        fact('Pending data corrections', apps.reduce((n, a) => n + (a.pending?.length || 0), 0)), fact('Data source', state.source));
      if (page === 'applications') {
        const visible = [...(main?.querySelectorAll('tr[data-detail]') || [])].slice(0, 6).map(row => clean(row.textContent, 90));
        if (visible.length) add(fact('Rows in view', visible.join(' | ')));
      }
    }
    if (page === 'ceo') {
      for (const card of main?.querySelectorAll('.ceo-card') || []) add(fact(textOf(card, '.ceo-title'), textOf(card, '.ceo-value'), [textOf(card, '.ceo-headline'), textOf(card, '.ceo-action')].filter(Boolean).join(' ')));
    }
    if (page === 'expansion' || page === 'market' || page === 'screening') {
      ctx.geography = geographyFrom(location);
      const place = textOf(main, '[data-map-place-title]');
      if (place) add(fact('Selected area', place, textOf(main, '[data-map-place-path]')));
      for (const card of main?.querySelectorAll('.market-kpi, .mi-card .metric, .ma-kpi') || []) add(fact(textOf(card, 'span'), textOf(card, 'strong'), textOf(card, 'small')));
      for (const row of main?.querySelectorAll('[data-analysis-metric], .ma-row') || []) add(fact(textOf(row, 'span, dt'), textOf(row, 'strong, dd')));
      // An open map popup (PIN or area) carries the potential revenue and TAM shown to the user.
      const popup = doc?.querySelector('.maplibregl-popup-content .expansion-popup');
      if (popup) add(fact('Map popup · ' + textOf(popup, 'header strong'), clean(popup.querySelector('.expansion-popup-grid')?.textContent, 320), textOf(popup, '.expansion-popup-status')));
      const narrative = textOf(main, '[data-map-narrative]');
      if (narrative) add(fact('Narrative', narrative));
      if (ctx.geography) for (const item of ctx.geography.metrics) add(item);
    }
    if (page === 'territories') {
      add(fact('Territories uploaded', (state.territories || []).length), fact('Existing stores', stores.length), fact('Recommended partners', count(results, 'Recommended')));
      for (const card of [...(main?.querySelectorAll('.te-card') || [])].slice(0, 8)) add(fact(textOf(card, '.te-city, .eyebrow') || 'Territory', clean(card.textContent, 160)));
      for (const pin of [...(main?.querySelectorAll('.te-pin') || [])].slice(0, 6)) add(fact(textOf(pin, '.te-pin-name') || 'PIN', clean(pin.querySelector('.te-pin-kpis')?.textContent || pin.textContent, 160)));
    }
    if (page === 'rules') {
      const s = state.settings || {};
      add(fact('Scoring model', s.model), fact('Sector', s.sectorName), fact('Minimum investment', s.minInvestment ? `₹${s.minInvestment} lakh` : ''),
        fact('Minimum area', s.minArea ? `${s.minArea} sq ft` : ''), fact('Launch window', s.minLaunch ? `${s.minLaunch}–${s.targetLaunch} months` : ''));
    }
    if (!ctx.facts.length) for (const stat of [...(main?.querySelectorAll('.stat') || [])].slice(0, 8)) add(fact(textOf(stat, '.stat-label'), textOf(stat, '.stat-value'), textOf(stat, '.stat-note')));
    ctx.suggestions = suggestionsFor(ctx, results);
    return ctx;
  }

  function suggestionsFor(ctx, results) {
    const held = results.find(a => a.status === 'Clarification needed') || results[0];
    const area = ctx.geography?.name;
    const byPage = {
      overview: ['Summarise this page', 'Who should move forward?', 'What needs my attention?'],
      ceo: ['Summarise this page', 'Where should we grow next?', 'What is the top insight?'],
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
  function summary(ctx) {
    const head = `${ctx.title}${ctx.heading && ctx.heading !== ctx.title ? ` · ${ctx.heading}` : ''}`;
    const who = ctx.applicant ? `\nIn view: ${ctx.applicant.id} (${ctx.applicant.name}) · ${ctx.applicant.status} · score ${ctx.applicant.score}${ctx.applicant.high !== ctx.applicant.score ? `–${ctx.applicant.high}` : ''}.` : '';
    return ctx.facts.length ? `Here is what this page shows — ${head.replace(/[.:]+$/, '')}:\n${factLines(ctx.facts.slice(0, 12))}${who}` : `This page (${head}) has no figures loaded yet.${who}`;
  }

  // Rule bot first (instant), then page facts, then Gemini for a selected map area.
  async function answer(question, { ctx, env, bot = root.FranchiseBot, fetch = root.fetch?.bind(root), segment = 'mass-market-family-apparel' } = {}) {
    const text = String(question || '').trim();
    if (!text) return null;
    if (/\bsummar|\boverview of (?:this|the) page\b|\bwhat am i (?:looking at|seeing)\b|\b(?:on|about) this page\b/i.test(text)) return { text: summary(ctx), source: 'page' };
    const mapPage = ['expansion', 'market', 'ceo', 'screening'].includes(ctx.page);
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
    const context = () => { const p = provider?.() || {}; return { ctx: buildPageContext({ ...p, doc, location: lastLocation }), env: p.state ? { state: p.state, results: p.results || [], stores: p.stores || [], contextKey: p.botContext || null } : null }; };

    function bubble(message) {
      const cites = (message.citations || []).map(c => `<a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(c.title || c.url)} ↗</a>`).join('');
      const tag = { rules: 'Workbook rules', page: 'From this page', gemini: 'Gemini · grounded', notice: 'Fallback' }[message.source] || '';
      return `<div class="fc-msg ${message.role === 'user' ? 'is-user' : ''}" data-fc-msg>${message.role === 'user' ? '' : `<span class="fc-tag">${esc(tag)}${message.page ? ` · ${esc(PAGE_TITLES[message.page] || message.page)}` : ''}</span>`}<div class="fc-text">${esc(message.text)}</div>${cites ? `<div class="fc-cites">${cites}</div>` : ''}${message.proposal ? `<div class="fc-actions"><button type="button" class="fc-chip is-primary" data-fc-confirm>Confirm & reassess</button><button type="button" class="fc-chip" data-fc-cancel>Cancel</button></div>` : ''}${message.navigation ? `<div class="fc-actions"><button type="button" class="fc-chip" data-fc-nav="${esc(message.navigation.route)}">Open ${esc(message.navigation.label || 'section')} ↗</button></div>` : ''}</div>`;
    }
    function renderLog() {
      const { ctx } = context();
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
      const { ctx, env } = context();
      history.push({ role: 'user', text, page: ctx.page }); renderLog();
      const log = $('[data-fc-log]'), thinking = doc.createElement('div');
      thinking.className = 'fc-msg fc-thinking'; thinking.innerHTML = '<span class="fc-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="fc-sr">Thinking…</span>'; log.append(thinking); scroll();
      let reply;
      try { reply = await answer(text, { ctx, env, fetch }); } catch (error) { reply = { text: `Something went wrong: ${error.message}`, source: 'notice' }; }
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

  const api = { buildPageContext, answer, mount, matchFacts, PAGE_TITLES };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FranchiseChat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
