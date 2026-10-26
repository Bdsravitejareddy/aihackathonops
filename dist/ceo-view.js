(function (root) {
  'use strict';

  // CEO view: concise cue cards. Market numbers come from /api/insights/ceo (same server functions as the
  // map and the Analysis panel); the pipeline card uses the same assessed applications as Overview.
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const BADGES = { official: 'Official data', estimate: 'Estimate', assumption: 'Assumption', workbook: 'Your workbook' };

  function money(value) {
    if (!Number.isFinite(value)) return '—';
    if (root.FranchiseDisplay?.money) return root.FranchiseDisplay.money(value, 'INR');
    return value >= 1e7 ? `₹${(value / 1e7).toFixed(1)} Cr` : `₹${(value / 1e5).toFixed(1)} L`;
  }
  function formatValue(v) {
    if (!v || !Number.isFinite(v.value)) return { big: '—', unit: 'insufficient data' };
    if (v.kind === 'money') return { big: money(v.value), unit: v.unit === 'INR/year' ? 'a year' : '' };
    if (v.kind === 'percent') return { big: `${v.value.toFixed(1)}%`, unit: v.unit.replace(/^%\s*/, '') };
    return { big: Math.round(v.value).toLocaleString('en-IN'), unit: v.unit };
  }

  function cardHTML(card) {
    const value = formatValue(card.value);
    const range = card.range ? `<span class="ceo-range">Range ${money(card.range.low)} – ${money(card.range.high)}</span>` : '';
    const link = card.geographyId ? `<button class="text-button ceo-link" type="button" data-ceo-open="${escape(card.geographyId)}">Open ${escape(card.geographyName || 'area')} on the map →</button>`
      : card.tab ? `<button class="text-button ceo-link" type="button" data-tab="${escape(card.tab)}">${escape(card.tabLabel)} →</button>` : '';
    return `<article class="ceo-card" data-ceo-card="${escape(card.id)}">
      <div class="ceo-card-top"><span class="ceo-title">${escape(card.title)}</span><span class="ceo-badge ceo-badge--${escape(card.badge)}">${escape(BADGES[card.badge] || card.badge)}</span></div>
      <div class="ceo-value"><strong data-ceo-value>${escape(value.big)}</strong><span>${escape(value.unit)}</span></div>
      <p class="ceo-headline">${escape(card.headline)}</p>
      ${card.detail || range ? `<p class="ceo-detail">${escape(card.detail || '')} ${range}</p>` : ''}
      <p class="ceo-action"><span aria-hidden="true">→</span> ${escape(card.action)}</p>
      ${link}</article>`;
  }

  function pipelineCard(p) {
    if (!p || !p.total) return { id: 'pipeline', title: 'Partner pipeline', badge: 'workbook', value: null, headline: 'No applications loaded yet.', action: 'Upload the applications workbook to see who is ready.', tab: 'upload', tabLabel: 'Upload workbook' };
    return { id: 'pipeline', title: 'Partner pipeline', badge: 'workbook', value: { value: p.recommended, unit: `of ${p.total} applications ready`, kind: 'count' },
      headline: `${p.recommended} partner${p.recommended === 1 ? ' is' : 's are'} recommended; ${p.siteNeeded} still need${p.siteNeeded === 1 ? 's' : ''} a confirmed site.`,
      detail: `${p.clarification} application${p.clarification === 1 ? '' : 's'} need missing information.`,
      action: p.siteNeeded ? `Help ${p.siteNeeded} partner${p.siteNeeded === 1 ? '' : 's'} secure a site in the top markets.` : 'Move recommended partners to onboarding.',
      tab: p.siteNeeded ? 'applications' : 'onboarding', tabLabel: p.siteNeeded ? 'See applications' : 'Open onboarding' };
  }

  function pageHTML() {
    return `<div class="ceo-view"><div class="page-heading"><div><div class="eyebrow">CEO VIEW</div><h1>Where to grow next.</h1><p>The key insights, each with the number behind it and the next step.</p></div></div>
      <div class="ceo-grid" data-ceo-grid aria-live="polite"><p class="hint">Loading insights…</p></div>
      <p class="ceo-foot" data-ceo-foot></p></div>`;
  }

  function mount({ container, pipeline, fetch = root.fetch?.bind(root), onOpenArea } = {}) {
    let destroyed = false;
    const controller = new AbortController();
    container.innerHTML = pageHTML();
    const grid = container.querySelector('[data-ceo-grid]'), foot = container.querySelector('[data-ceo-foot]');
    const stores = Math.max(1, pipeline?.recommended || 0);
    let last = null;
    const render = result => {
      const cards = [...(result?.cards || []), pipelineCard(pipeline)];
      grid.innerHTML = cards.map(cardHTML).join('');
      foot.textContent = result ? `Markets ranked by ${result.rankingMetric === 'potentialRevenue' ? 'potential revenue' : 'annual clothing & footwear spend'} across ${result.rankedCount} states with data; ${result.insufficientData.length} left out for missing data. ${result.warnings.join(' ')}` : '';
    };
    (async () => {
      try {
        const response = await fetch(`/api/insights/ceo?stores=${stores}`, { signal: controller.signal });
        const result = await response.json().catch(() => ({}));
        if (destroyed) return;
        if (!response.ok) throw Error(result.error || `Insights API returned ${response.status}`);
        last = result; render(result);
      } catch (error) {
        if (destroyed || error.name === 'AbortError') return;
        render(null);
        grid.insertAdjacentHTML('afterbegin', `<p class="hint ceo-error">${escape(error.message)} Market cards are unavailable; pipeline figures are still shown.</p>`);
      }
    })();
    const onClick = event => { const button = event.target.closest('[data-ceo-open]'); if (button) onOpenArea?.(button.dataset.ceoOpen); };
    container.addEventListener('click', onClick);
    return {
      refreshDisplay() { if (last) render(last); },
      destroy() { destroyed = true; controller.abort(); container.removeEventListener('click', onClick); }
    };
  }

  root.CeoView = { mount, cardHTML, pipelineCard };
})(typeof window !== 'undefined' ? window : globalThis);
