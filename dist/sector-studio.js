(function (root) {
  'use strict';

  // Sector studio (Scoring & rules page): research a sector, review every value with its source or an
  // assumption badge, edit values, reweight the market score (sliders always total 100%) and activate it.
  // The server validates and stores profiles (/api/sectors); app.js applies the active sector everywhere else.

  const WEIGHTS = [['demand', 'Demand'], ['purchasingPower', 'Purchasing power'], ['competition', 'Competition'], ['accessibility', 'Accessibility'], ['financial', 'Financial'], ['growth', 'Growth']];
  const FIELDS = [
    ['Market', 'organisedShare', 'Organised retail share', '%', true],
    ['Market', 'onlineShareOfOrganised', 'Online share of organised sales', '%', true],
    ['Store format', 'store.areaSqFt', 'Store area', 'sq ft'],
    ['Store format', 'store.revenuePerSqFtYear', 'Sales density', '₹ / sq ft / year'],
    ['Store format', 'store.capexPerSqFt', 'Fit-out capex', '₹ / sq ft'],
    ['Store format', 'store.rentPerSqFtMonthLow', 'Rent band — low', '₹ / sq ft / month'],
    ['Store format', 'store.rentPerSqFtMonthHigh', 'Rent band — high', '₹ / sq ft / month'],
    ['Store format', 'store.grossMargin', 'Gross margin', '%', true],
    ['Store format', 'store.royaltyRate', 'Royalty', '%', true],
    ['Store format', 'store.sqFtPerEmployee', 'Area per employee', 'sq ft'],
    ['Partner requirements', 'partnerRequirements.minInvestmentLakh', 'Minimum investment', '₹ lakh'],
    ['Partner requirements', 'partnerRequirements.minAreaSqFt', 'Minimum area', 'sq ft'],
    ['Partner requirements', 'partnerRequirements.minLaunchMonths', 'Minimum launch', 'months'],
    ['Partner requirements', 'partnerRequirements.targetLaunchMonths', 'Target launch', 'months']
  ];
  const UNAVAILABLE = new Set(['missing_api_key', 'unavailable', 'upstream_error', 'timeout', 'rate_limited', 'invalid_response']);

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const clone = value => JSON.parse(JSON.stringify(value));
  const get = (profile, path) => path.split('.').reduce((value, key) => value?.[key], profile);
  function set(profile, path, value) {
    const [head, key] = path.split('.');
    if (!key) profile[head] = value;
    else { profile[head] = profile[head] || {}; profile[head][key] = value; }
  }
  const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'source'; } };
  const lakh = value => `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 1 })} L`;

  /** Fractions → whole percents that total exactly 100 (largest remainder). */
  function toPercents(weights) {
    const raw = WEIGHTS.map(([key]) => Math.max(0, Number(weights?.[key]) || 0));
    const total = raw.reduce((sum, v) => sum + v, 0) || 1;
    const exact = raw.map(v => v / total * 100), floors = exact.map(Math.floor);
    let left = 100 - floors.reduce((sum, v) => sum + v, 0);
    exact.map((v, i) => [v - floors[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { floors[i]++; left--; } });
    return Object.fromEntries(WEIGHTS.map(([key], i) => [key, floors[i]]));
  }

  /** Set one weight to `percent` and spread the remainder over the others in proportion; the total stays 100. */
  function rebalanceWeights(percents, key, percent) {
    const target = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    const others = WEIGHTS.map(([k]) => k).filter(k => k !== key);
    const rest = others.reduce((sum, k) => sum + (percents[k] || 0), 0), remaining = 100 - target;
    const share = others.map(k => rest > 0 ? (percents[k] || 0) / rest * remaining : remaining / others.length);
    const floors = share.map(Math.floor);
    let left = remaining - floors.reduce((sum, v) => sum + v, 0);
    share.map((v, i) => [v - floors[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { floors[i]++; left--; } });
    return { ...Object.fromEntries(others.map((k, i) => [k, floors[i]])), [key]: target };
  }
  const toFractions = percents => Object.fromEntries(WEIGHTS.map(([key]) => [key, (percents[key] || 0) / 100]));

  /** Plain-language differences between two sector profiles. */
  function describeChanges(previous, next) {
    if (!previous || !next) return [];
    const lines = [], pr = previous.partnerRequirements || {}, nr = next.partnerRequirements || {};
    if (previous.id !== next.id) lines.push(`sector ${previous.name} → ${next.name}`);
    if (pr.minInvestmentLakh !== nr.minInvestmentLakh) lines.push(`minimum investment ${lakh(pr.minInvestmentLakh)} → ${lakh(nr.minInvestmentLakh)}`);
    if (pr.minAreaSqFt !== nr.minAreaSqFt) lines.push(`minimum area ${pr.minAreaSqFt} → ${nr.minAreaSqFt} sq ft`);
    if (pr.minLaunchMonths !== nr.minLaunchMonths || pr.targetLaunchMonths !== nr.targetLaunchMonths) lines.push(`launch window ${pr.minLaunchMonths}–${pr.targetLaunchMonths} → ${nr.minLaunchMonths}–${nr.targetLaunchMonths} months`);
    const pw = toPercents(previous.scoringWeights), nw = toPercents(next.scoringWeights);
    for (const [key, label] of WEIGHTS) if (pw[key] !== nw[key]) lines.push(`${label.toLowerCase()} weight ${pw[key]}% → ${nw[key]}%`);
    const share = p => Number.isFinite(p.organisedShare) && Number.isFinite(p.onlineShareOfOrganised) ? Math.round(p.organisedShare * (1 - p.onlineShareOfOrganised) * 1000) / 10 : null;
    if (share(previous) !== share(next)) lines.push(`organised in-store share ${share(previous) ?? 'n/a'}% → ${share(next) ?? 'n/a'}%`);
    if ((previous.hcesCategories || []).join() !== (next.hcesCategories || []).join()) lines.push(`consumer spend ${(previous.hcesCategories || []).join(' + ') || 'none'} → ${(next.hcesCategories || []).join(' + ') || 'none'}`);
    return lines;
  }

  function blankProfile(name, base) {
    const assumptions = ['scoringWeights', ...FIELDS.filter(f => f[1].startsWith('partnerRequirements.')).map(f => f[1])];
    return { id: null, name, description: '', hcesCategories: [], organisedShare: null, onlineShareOfOrganised: null, osmTags: [], majorBrands: [], store: null,
      scoringWeights: { ...base.scoringWeights }, partnerRequirements: { ...base.partnerRequirements }, evidence: {}, sources: [], assumptions,
      rationale: Object.fromEntries(assumptions.map(path => [path, 'Starting value copied from the apparel defaults; edit it.'])), rejected: [], warnings: [], builtIn: false };
  }

  function mount({ container, fetch = root.fetch?.bind(root), activeId = 'apparel', activeName = null, onActivate = async () => null, onActivated = () => {}, changes: initialChanges = null } = {}) {
    let sectors = [], itemGroups = [], hcesSource = null, view = 'list', draft = null, pristine = null, percents = null;
    let error = null, changes = initialChanges, busySince = 0, ticker = null, destroyed = false, requestId = 0;
    const active = () => sectors.find(s => s.id === activeId) || sectors[0] || null;

    async function call(path, options = {}) {
      const response = await fetch(path, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}) } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(data.error || `Sector API returned ${response.status}`), { code: data.code || null, status: response.status });
      return data;
    }
    async function load() {
      try { const data = await call('/api/sectors'); sectors = data.sectors || []; itemGroups = data.hcesItemGroups || []; hcesSource = data.hcesSource || null; }
      catch (e) { error = { message: `Sectors are unavailable: ${e.message}`, manual: false }; }
      render();
    }

    function badge(path) {
      const cited = draft.evidence?.[path];
      if (cited?.url && !draft.assumptions.includes(path)) return `<a class="sector-src" href="${esc(cited.url)}" target="_blank" rel="noopener" title="${esc(cited.quote || cited.title || '')}">${esc(hostOf(cited.url))} ↗</a>`;
      if (get(draft, path) === null || get(draft, path) === undefined) return '<span class="tag gray">unavailable</span>';
      return `<span class="tag amber" title="${esc(draft.rationale?.[path] || 'Assumption')}">assumption</span>`;
    }
    function fieldRow([, path, label, unit, fraction]) {
      const value = get(draft, path), shown = value === null || value === undefined ? '' : fraction ? +(value * 100).toFixed(2) : value;
      return `<div class="sector-field"><label for="sf-${esc(path)}">${esc(label)}</label><div class="sector-field-input"><input class="input" id="sf-${esc(path)}" type="number" step="any" min="0" data-sector-field="${esc(path)}" data-fraction="${fraction ? 1 : 0}" value="${esc(shown)}" placeholder="unavailable"><span>${esc(unit)}</span></div>${badge(path)}</div>`;
    }

    function listHTML() {
      return `<div class="sector-chips" role="list">${sectors.map(s => `<button class="sector-chip ${s.id === activeId ? 'is-active' : ''}" data-sector-open="${esc(s.id)}" role="listitem">${esc(s.name)}${s.id === activeId ? ' <span class="tag green">active</span>' : ''}${s.builtIn ? '' : ` <small>v${esc(s.version ?? 1)}</small>`}</button>`).join('')}</div>
        <form class="sector-add" data-sector-research><label for="sector-name">Add a sector</label><div class="sector-add-row"><input class="input" id="sector-name" name="name" maxlength="80" required placeholder="e.g. Coffee cafés, Salons, Eyewear, Quick-service restaurants"><button class="button primary">Research</button><button class="button" type="button" data-sector-manual>Enter manually</button></div>
        <p class="hint">Research uses Google Search grounding. Every number needs a retrieved source or is labelled an assumption; anything else is rejected.</p></form>`;
    }
    function busyHTML() {
      const seconds = Math.round((Date.now() - busySince) / 1000);
      const steps = [['Searching sources', 0], ['Reading industry and company pages', 6], ['Validating every number against its source and range', 14]];
      return `<div class="sector-busy" aria-live="polite"><div class="sector-spinner" aria-hidden="true"></div><div><strong>Researching ${esc(draft?.name || '')}…</strong>
        <ol>${steps.map(([label, at]) => `<li class="${seconds >= at ? 'is-on' : ''}">${esc(label)}</li>`).join('')}</ol><p class="hint">${seconds}s · usually 15–40 seconds</p></div></div>`;
    }
    function draftHTML() {
      const groups = [...new Set(FIELDS.map(f => f[0]))];
      const total = Object.values(percents).reduce((sum, v) => sum + v, 0);
      const dirty = JSON.stringify(draft) !== JSON.stringify(pristine);
      const isActive = draft.id === activeId && !dirty;
      return `<div class="sector-profile">
        <div class="sector-profile-head"><div><div class="eyebrow">Sector profile${draft.builtIn ? ' · built-in' : draft.version ? ` · v${esc(draft.version)}` : ' · not saved'}</div>
          <input class="input sector-name-input" data-sector-name value="${esc(draft.name)}" maxlength="80" aria-label="Sector name"></div>
          <div class="actions"><button class="button" data-sector-cancel>Close</button><button class="button primary" data-sector-save ${isActive ? 'disabled' : ''}>${isActive ? 'Active' : dirty || !draft.version && !draft.builtIn ? 'Save & activate' : 'Activate'}</button></div></div>
        ${draft.description ? `<p class="small-text muted">${esc(draft.description)}</p>` : ''}
        ${(draft.warnings || []).map(w => `<div class="info-row warning">${esc(w)}</div>`).join('')}
        <h3>Consumer spend (HCES 2023-24 item groups)</h3>
        <div class="sector-hces">${itemGroups.map(g => `<label class="sector-hces-item ${draft.hcesCategories.includes(g.key) ? 'is-on' : ''}"><input type="checkbox" aria-label="${esc(g.key)}" data-sector-hces="${esc(g.key)}"${draft.hcesCategories.includes(g.key) ? 'checked' : ''}><span>${esc(g.key)}</span><small>₹${esc(Math.round(g.allIndiaRural))} / ₹${esc(Math.round(g.allIndiaUrban))}</small></label>`).join('')}</div>
        <p class="hint">All-India rural / urban spend per person per month. Potential revenue = Σ selected groups (state rural/urban rates) × modelled 2020 population × 12 × organised share × (1 − online share). ${hcesSource ? `<a href="${esc(hcesSource.url)}" target="_blank" rel="noopener">NSS Report 592, Statements 3R/3U ↗</a>` : ''}</p>
        ${groups.map(group => `<h3>${esc(group)}</h3><div class="sector-fields">${FIELDS.filter(f => f[0] === group).map(fieldRow).join('')}</div>`).join('')}
        <h3>Market score weights <span class="tag ${total === 100 ? 'green' : 'red'}">${total}%</span> <span class="tag amber" title="${esc(draft.rationale?.scoringWeights || '')}">assumption</span></h3>
        <div class="sector-weights">${WEIGHTS.map(([key, label]) => `<label class="sector-weight"><span>${esc(label)}</span><input type="range" min="0" max="100" step="1" data-sector-weight="${key}" value="${percents[key]}" aria-label="${esc(label)} weight"><strong>${percents[key]}%</strong></label>`).join('')}</div>
        ${draft.rationale?.scoringWeights ? `<p class="hint">${esc(draft.rationale.scoringWeights)}</p>` : ''}
        <h3>Competitor search</h3>
        <div class="form-grid"><label class="full">OpenStreetMap tags<input class="input" data-sector-osm value="${esc((draft.osmTags || []).map(t => t.join('=')).join(', '))}" placeholder="amenity=cafe, shop=coffee"></label>
          <label class="full">Major brands <span class="tag amber">assumption</span><input class="input" data-sector-brands value="${esc((draft.majorBrands || []).join(', '))}" placeholder="Brand A, Brand B"></label></div>
        ${draft.rejected?.length ? `<details class="sector-rejected"><summary>${draft.rejected.length} value${draft.rejected.length === 1 ? '' : 's'} rejected by validation</summary><ul>${draft.rejected.map(r => `<li><code>${esc(r.field)}</code> ${esc(JSON.stringify(r.value))} — ${esc(r.reason)}</li>`).join('')}</ul></details>` : ''}
        ${draft.sources?.length ? `<h3>Sources</h3><ul class="help-list">${draft.sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || hostOf(s.url))}</a>${s.retrievedAt ? ` <span class="hint">retrieved ${esc(String(s.retrievedAt).slice(0, 10))}</span>` : ''}</li>`).join('')}</ul>` : '<p class="hint">No sourced values yet; every number above is an assumption until you add evidence.</p>'}
      </div>`;
    }
    function render() {
      if (destroyed) return;
      const body = view === 'busy' ? busyHTML() : view === 'draft' && draft ? draftHTML() : listHTML();
      container.innerHTML = `<section class="panel sector-studio"><div class="panel-top"><div><h2>Sector</h2><div class="panel-subtitle">Active: <strong>${esc(sectors.find(s => s.id === activeId)?.name || activeName || 'Apparel & fashion')}</strong>. The sector drives potential revenue, the store-cost analysis, the market score weights and partner requirements.</div></div></div><div class="panel-body">
        ${changes ? `<div class="sector-changes" role="status"><strong>${esc(changes.title)}</strong><ul>${changes.lines.map(line => `<li>${esc(line)}</li>`).join('')}</ul></div>` : ''}
        ${error ? `<div class="info-row warning" role="alert"><strong>${esc(error.title || 'Something went wrong')}</strong><br>${esc(error.message)}${error.manual ? '<div class="actions compact"><button class="button small" data-sector-retry>Retry research</button><button class="button small primary" data-sector-manual>Enter values manually</button></div>' : ''}</div>` : ''}
        ${body}</div></section>`;
    }

    function openDraft(profile) {
      draft = clone(profile); draft.assumptions = draft.assumptions || []; draft.evidence = draft.evidence || {}; draft.rationale = draft.rationale || {};
      draft.hcesCategories = draft.hcesCategories || [];
      pristine = clone(draft); percents = toPercents(draft.scoringWeights); view = 'draft'; error = null; render();
    }
    async function research(name) {
      const id = ++requestId;
      draft = { name }; view = 'busy'; error = null; changes = null; busySince = Date.now(); render();
      clearInterval(ticker); ticker = setInterval(() => { if (view === 'busy') render(); }, 1000);
      try {
        const data = await call('/api/sectors/research', { method: 'POST', body: JSON.stringify({ name }) });
        if (id !== requestId) return;
        openDraft({ ...data.profile, version: data.existing?.version || 0 });
        if (data.existing) draft.warnings = [...(draft.warnings || []), `A saved sector "${data.existing.name}" (v${data.existing.version}) exists; saving replaces it with this research as a new version.`];
        pristine = null; render();
      } catch (e) {
        if (id !== requestId) return;
        view = 'list'; draft = { name };
        error = UNAVAILABLE.has(e.code) || e.status >= 500
          ? { title: 'Research is unavailable — enter values manually or retry later.', message: e.message, manual: true, name }
          : { title: 'Research failed', message: e.message, manual: true, name };
        render();
      } finally { if (id === requestId) clearInterval(ticker); }
    }
    function markEdited(path) {
      if (!draft.assumptions.includes(path)) draft.assumptions.push(path);
      delete draft.evidence[path];
      draft.rationale[path] = 'Edited by the user.';
    }
    async function save() {
      const previous = active();
      const dirty = JSON.stringify(draft) !== JSON.stringify(pristine);
      try {
        let sector = draft;
        if (dirty || (!draft.version && !draft.builtIn)) {
          if (!draft.name?.trim()) throw new Error('Enter a sector name.');
          const id = draft.id || draft.name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
          const data = await call(`/api/sectors/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ profile: { ...draft, scoringWeights: toFractions(percents) } }) });
          sector = data.sector;
          sectors = [...sectors.filter(s => s.id !== sector.id), sector];
        }
        const impact = await onActivate(sector, previous);
        activeId = sector.id; activeName = sector.name;
        changes = { title: `${sector.name} is now the active sector`, lines: [...describeChanges(previous, sector), ...(impact?.lines || [])] };
        if (!changes.lines.length) changes.lines.push('No requirement, weight or demand inputs changed.');
        view = 'list'; draft = null; render(); onActivated(changes, sector);
      } catch (e) { error = { title: 'Could not save the sector', message: e.message, manual: false }; render(); }
    }

    function onClick(event) {
      const el = event.target.closest('button,[data-sector-open]');
      if (!el || !container.contains(el)) return;
      if (el.dataset.sectorOpen) { const s = sectors.find(item => item.id === el.dataset.sectorOpen); if (s) { changes = null; openDraft(s); } }
      else if ('sectorManual' in el.dataset) { const name = error?.name || container.querySelector('#sector-name')?.value?.trim() || ''; openDraft(blankProfile(name, sectors.find(s => s.builtIn) || active())); pristine = null; render(); }
      else if ('sectorRetry' in el.dataset && error?.name) research(error.name);
      else if ('sectorCancel' in el.dataset) { view = 'list'; draft = null; error = null; render(); }
      else if ('sectorSave' in el.dataset) save();
    }
    function onSubmit(event) {
      if (!event.target.matches('[data-sector-research]')) return;
      event.preventDefault();
      const name = new FormData(event.target).get('name')?.toString().trim();
      if (name) research(name);
    }
    function onInput(event) {
      const el = event.target;
      if (!draft) return;
      if (el.dataset.sectorWeight) {
        percents = rebalanceWeights(percents, el.dataset.sectorWeight, Number(el.value));
        for (const input of container.querySelectorAll('[data-sector-weight]')) { input.value = percents[input.dataset.sectorWeight]; input.nextElementSibling.textContent = `${percents[input.dataset.sectorWeight]}%`; }
        draft.scoringWeights = toFractions(percents); draft.rationale.scoringWeights = 'Set by the user.';
      }
    }
    function onChange(event) {
      const el = event.target;
      if (!draft) return;
      if (el.dataset.sectorField) {
        const raw = el.value.trim(), number = raw === '' ? null : Number(raw);
        if (number !== null && !Number.isFinite(number)) return;
        set(draft, el.dataset.sectorField, number === null ? null : el.dataset.fraction === '1' ? number / 100 : number);
        markEdited(el.dataset.sectorField); render();
      } else if (el.dataset.sectorHces) {
        draft.hcesCategories = el.checked ? [...new Set([...draft.hcesCategories, el.dataset.sectorHces])] : draft.hcesCategories.filter(key => key !== el.dataset.sectorHces);
        render();
      } else if ('sectorName' in el.dataset) draft.name = el.value.trim();
      else if ('sectorOsm' in el.dataset) draft.osmTags = el.value.split(',').map(item => item.trim().split('=').map(part => part.trim())).filter(tag => tag.length === 2 && tag[0] && tag[1]);
      else if ('sectorBrands' in el.dataset) draft.majorBrands = el.value.split(',').map(item => item.trim()).filter(Boolean);
      else if (el.dataset.sectorWeight) render();
    }

    container.addEventListener('click', onClick);
    container.addEventListener('submit', onSubmit);
    container.addEventListener('input', onInput);
    container.addEventListener('change', onChange);
    render(); load();
    return {
      destroy() { destroyed = true; requestId++; clearInterval(ticker); container.removeEventListener('click', onClick); container.removeEventListener('submit', onSubmit); container.removeEventListener('input', onInput); container.removeEventListener('change', onChange); },
      showChanges(title, lines) { changes = { title, lines }; render(); }
    };
  }

  const api = { mount, rebalanceWeights, toPercents, toFractions, describeChanges, FIELDS, WEIGHTS };
  if (typeof module !== 'undefined') module.exports = api;
  root.SectorStudio = api;
})(typeof window !== 'undefined' ? window : globalThis);
