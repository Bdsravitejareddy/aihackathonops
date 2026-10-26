(function (root) {
  'use strict';

  // Territories page: city cards with catchment, TAM, investment and payback (from /api/territories/metrics),
  // expanding to PINs and then to the applications for each PIN, ranked by score.
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const TE = () => root.TerritoryEconomics;
  // Quotes and backslashes are the only characters that break a quoted attribute selector here.
  const attrValue = value => String(value).replace(/["\\]/g, '\\$&');
  const STATUS_TONE = { Recommended: 'green', Waitlisted: 'blue', 'Location unavailable': 'red', 'Requirements not met': 'red', 'Clarification needed': 'amber', 'Site needed': 'amber' };
  const GRADE_TONE = { A: 'green', B: 'green', C: 'amber', D: 'red', U: 'gray' };
  const priorityTone = p => p === 'High' ? 'green' : p === 'Medium' ? 'amber' : 'gray';

  // Open/closed state survives re-renders of the page.
  const openKeys = new Set();
  const cache = new Map();

  function metricsFor(territory, fetch) {
    const key = `${territory.id}|${territory.slots ?? ''}|${territory.pins.join(',')}`;
    if (!cache.has(key)) {
      const request = TE().load(territory.pins.map(String), { slots: Number.isInteger(territory.slots) ? territory.slots : null, fetch });
      request.catch(() => cache.delete(key));
      cache.set(key, request);
    }
    return cache.get(key);
  }

  function slotChip(territory) {
    if (territory.slots === 0) return '<span class="tag gray te-noslots">No open slots</span>';
    return `<span class="hint">Recommended ${'{{rec}}'} / ${escape(territory.slots ?? '?')}</span>`;
  }

  function applicationsFor(applications, territory, pin) {
    return applications
      .filter(a => a.territory === territory.id && (pin === null || String(a.pin) === String(pin)))
      .sort((a, b) => (Number(b.score) || -1) - (Number(a.score) || -1) || String(a.name).localeCompare(String(b.name)));
  }

  function applicationRow(a) {
    const score = Number.isFinite(a.score) ? Math.round(a.score) : '—';
    return `<li class="te-app"><div class="te-app-main"><button type="button" class="text-button te-app-name" data-detail="${escape(a.key)}">${escape(a.name || a.id || a.key)} ↗</button>
      <small class="te-app-id">${escape(a.id || '')}</small></div>
      <div class="te-app-chips"><span class="te-score" title="Screening score">Score <strong>${score}</strong></span>
      <span class="tag ${GRADE_TONE[a.grade] || 'gray'}">Grade ${escape(a.grade || '—')}</span>
      <span class="tag ${STATUS_TONE[a.status] || 'gray'}">${escape(a.status || 'Unscreened')}</span></div></li>`;
  }

  function collapse(key, body) {
    const open = openKeys.has(key);
    return `<div class="te-collapse" data-open="${open}" data-te-body="${escape(key)}"><div class="te-collapse-inner">${body}</div></div>`;
  }

  function toggleButton(key, label, count) {
    const open = openKeys.has(key);
    return `<button type="button" class="te-toggle" data-te-toggle="${escape(key)}" aria-expanded="${open}"><span class="te-chevron" aria-hidden="true">▸</span>${escape(label)}${count === undefined ? '' : ` <span class="te-count">${count}</span>`}</button>`;
  }

  function pinBlock(territory, pin, applications) {
    const key = `p:${territory.id}:${pin}`, apps = applicationsFor(applications, territory, pin);
    const body = apps.length ? `<ul class="te-apps">${apps.map(applicationRow).join('')}</ul>` : '<p class="hint te-empty">No applications for this PIN yet.</p>';
    return `<li class="te-pin" data-pin="${escape(pin)}">
      <div class="te-pin-head"><div><strong>${escape(pin)}</strong><small class="te-pin-name" data-te-pin-name>Loading PIN data…</small></div>
        <button type="button" class="text-button te-open-screener" data-screen-pin="${escape(pin)}">Open in screener ↗</button></div>
      <dl class="te-pin-kpis" data-te-pin-kpis="${escape(pin)}"><div><dt>Population</dt><dd>—</dd></div><div><dt>TAM</dt><dd>—</dd></div><div><dt>Investment</dt><dd>—</dd></div><div><dt>Payback</dt><dd>—</dd></div></dl>
      ${toggleButton(key, 'Applications by score', apps.length)}
      ${collapse(key, body)}</li>`;
  }

  function territoryCard(territory, applications) {
    const apps = applicationsFor(applications, territory, null);
    const recommended = apps.filter(a => a.status === 'Recommended').length;
    const orphan = apps.filter(a => !territory.pins.map(String).includes(String(a.pin))).length;
    const noSlots = territory.slots === 0;
    const slots = noSlots ? '<span class="te-meta-label">Recommended</span><span class="tag gray te-noslots">No open slots</span>' : `<span class="te-meta-label">Recommended</span><span class="te-meta-value">${recommended}<span class="te-of"> / ${escape(territory.slots ?? '?')}</span></span>`;
    const key = `t:${territory.id}`;
    const pins = territory.pins.map(pin => pinBlock(territory, pin, applications)).join('');
    return `<section class="panel territory-card te-card${noSlots ? ' is-full' : ''}" data-territory="${escape(territory.id)}">
      <div class="te-card-top"><span class="eyebrow">${escape(territory.id)}</span><span class="tag ${priorityTone(territory.priority)}">${escape(territory.priority || 'Unknown')} priority</span></div>
      <div class="te-city">${escape(territory.city)}</div>
      <div class="small-text muted te-place">${escape(territory.tier)} · ${escape(territory.state)}</div>
      ${territory.issues?.length ? `<div class="info-row warning">${territory.issues.map(escape).join('<br>')}</div>` : ''}
      <div class="te-meta"><div><span class="te-meta-label">Applications</span><span class="te-meta-value">${apps.length}</span></div><div>${slots}</div></div>
      <div class="te-kpi-holder" data-te-kpis="${escape(territory.id)}"><div class="te-kpis te-kpis--loading" aria-busy="true">${['Catchment population', 'TAM · category spend', 'Investment required', 'Payback · base case'].map(label => `<div class="te-kpi"><span class="te-label">${label}</span><strong class="te-value">…</strong></div>`).join('')}</div></div>
      ${noSlots ? '<p class="te-note-line">This territory has no open slots, so no store investment is counted.</p>' : ''}
      ${orphan ? `<p class="te-note-line">${orphan} application${orphan === 1 ? '' : 's'} list a PIN outside this territory.</p>` : ''}
      ${toggleButton(key, 'PINs in this city', territory.pins.length)}
      ${collapse(key, `<ul class="te-pins">${pins}</ul>`)}
    </section>`;
  }

  // Totals fill the last grid cell so the grid stays even at every width.
  function territorySummary(model) {
    const recommended = model.applications.filter(a => a.status === 'Recommended').length;
    const slots = model.territories.reduce((total, t) => total + (Number.isInteger(t.slots) ? t.slots : 0), 0);
    const item = (label, value, note) => `<div><span class="te-meta-label">${label}</span><span class="te-meta-value">${value}</span><small class="te-note-line">${note}</small></div>`;
    return `<section class="panel te-card te-summary" aria-label="All territories"><div class="te-card-top"><span class="eyebrow">ALL TERRITORIES</span></div>
      <div class="te-city">${model.territories.length} territories</div><div class="te-meta te-meta--summary">${item('Applications', model.applications.length, 'across all territories')}${item('Recommended', recommended, `of ${slots} open slots`)}</div></section>`;
  }

  function pageHTML(model) {
    const cards = model.territories.map(t => territoryCard(t, model.applications)).join('');
    const stores = model.stores.map(s => `<tr><td>${escape(s[0])}</td><td>${escape(s[1])}</td><td>${escape(s[2])}</td><td>${escape(s[3])}</td></tr>`).join('');
    const summary = territorySummary(model);
    return `<div class="page-heading"><div><div class="eyebrow">GEO-SELECTION</div><h1>Make room for the right partner.</h1><p>One store per pin code. Recommendations always respect territory capacity.</p></div></div>
      <div class="te-grid">${cards ? cards + summary : '<div class="empty">Upload territories to map your expansion.</div>'}</div>
      <section class="panel section-gap"><div class="panel-top"><div><h2>Existing store footprint</h2><div class="panel-subtitle">Fixed brand list from the case · these 10 pin codes are unavailable.</div></div></div><div class="table-wrap"><table><thead><tr><th>Store</th><th>City</th><th>Pin code</th><th>Opened</th></tr></thead><tbody>${stores}</tbody></table></div></section>`;
  }

  function setCollapse(el, open) {
    el.dataset.open = String(open);
    const toggle = el.closest('.te-card, .te-pin')?.querySelector(`[data-te-toggle="${attrValue(el.dataset.teBody)}"]`);
    toggle?.setAttribute('aria-expanded', String(open));
  }

  function fillTerritory(container, territory, result) {
    const holder = container.querySelector(`[data-te-kpis="${attrValue(territory.id)}"]`);
    if (holder) holder.innerHTML = TE().kpisHTML(result.aggregate);
    for (const row of result.pins) {
      const dl = container.querySelector(`[data-te-pin-kpis="${attrValue(row.pin)}"]`);
      const pinEl = dl?.closest('.te-pin');
      if (!dl) continue;
      const summary = TE().pinSummary(row);
      pinEl.querySelector('[data-te-pin-name]').textContent = row.status === 'available' ? `${summary.note}` : 'Not in the PIN dataset';
      dl.innerHTML = `<div><dt>Population</dt><dd>${summary.population}</dd></div><div><dt>TAM</dt><dd>${summary.tam}</dd></div><div><dt>Investment</dt><dd>${summary.investment}</dd></div><div><dt>Payback</dt><dd>${summary.payback}</dd></div>`;
    }
  }

  function mount({ container, territories = [], applications = [], stores = [], fetch } = {}) {
    if (!container) throw new Error('Territories container is required');
    if (!TE()) throw new Error('Territory economics are not loaded');
    let destroyed = false;
    const model = { territories, applications, stores };
    container.innerHTML = pageHTML(model);
    const onClick = event => {
      const toggle = event.target.closest('[data-te-toggle]');
      if (!toggle) return;
      const key = toggle.dataset.teToggle;
      const open = !openKeys.has(key);
      open ? openKeys.add(key) : openKeys.delete(key);
      const body = container.querySelector(`[data-te-body="${attrValue(key)}"]`);
      if (body) setCollapse(body, open);
      toggle.setAttribute('aria-expanded', String(open));
    };
    container.addEventListener('click', onClick);
    for (const territory of territories) {
      if (!territory.pins?.length) continue;
      metricsFor(territory, fetch).then(result => { if (!destroyed) fillTerritory(container, territory, result); })
        .catch(error => {
          if (destroyed) return;
          const holder = container.querySelector(`[data-te-kpis="${attrValue(territory.id)}"]`);
          if (holder) holder.innerHTML = `<p class="hint te-error">${escape(error.message)} Market figures are unavailable for this territory.</p>`;
        });
    }
    return { destroy() { destroyed = true; container.removeEventListener('click', onClick); } };
  }

  root.TerritoriesView = { mount, applicationsFor, territoryCard };
})(typeof window !== 'undefined' ? window : globalThis);
