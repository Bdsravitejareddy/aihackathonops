(function (root) {
  'use strict';

  // Expansion Intelligence "Analysis" section: automatic cost range, ROI/payback scenarios and
  // the state income trend for the selected geography, with editable assumptions.
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const safeUrl = value => { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; } };
  const LEVELS = ['low', 'mid', 'high'];
  const EDITABLE = [
    ['captureRate', 'Store capture of area potential · fraction'], ['annualRevenue', 'Annual revenue · ₹'], ['areaSqFt', 'Store area · sq ft'], ['rentPerSqFtMonth', 'Rent · ₹/sq ft/month'],
    ['fitOutPerSqFt', 'Fit-out · ₹/sq ft'], ['staffMonthlyWage', 'Staff wage · ₹/month'], ['sqFtPerEmployee', 'Sq ft per employee'],
    ['grossMargin', 'Gross margin · fraction'], ['royaltyRate', 'Royalty · fraction'], ['marketingRate', 'Marketing · fraction'],
    ['franchiseFee', 'Franchise fee · ₹'], ['depositMonthsOfRent', 'Deposit · months of rent'], ['inventoryTurnsPerYear', 'Inventory turns / year'],
    ['utilitiesPerSqFtMonth', 'Utilities · ₹/sq ft/month'], ['revenueGrowth', 'Sales growth · annual rate'], ['costInflation', 'Cost escalation · annual rate'], ['discountRate', 'Discount rate · annual']
  ];
  const CLASS_LABEL = { official_observed: 'Official', official_survey_estimate: 'Official survey', derived_estimate: 'Derived estimate', model_assumption: 'Model assumption', user_assumption: 'Your input' };

  function money(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    if (root.FranchiseDisplay?.money) return root.FranchiseDisplay.money(value, 'INR');
    const abs = Math.abs(value), sign = value < 0 ? '−' : '';
    return abs >= 1e7 ? `${sign}₹${(abs / 1e7).toFixed(2)} Cr` : abs >= 1e5 ? `${sign}₹${(abs / 1e5).toFixed(1)} L` : `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
  }
  const pct = (value, digits = 1) => value === null || value === undefined || !Number.isFinite(value) ? '—' : `${value.toFixed(digits)}%`;
  const months = value => value === null || value === undefined ? 'over 5 years' : value < 24 ? `${value} months` : `${(value / 12).toFixed(1).replace(/\.0$/, '')} years`;
  const numeric = value => typeof value === 'number' && Number.isFinite(value);
  const moneyRounded = value => money(typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : value);
  const chip = cls => `<span class="analysis-chip analysis-chip--${escape(cls || 'unknown')}">${escape(CLASS_LABEL[cls] || cls || 'Unclassified')}</span>`;

  function sparkline(trend) {
    const history = trend.series || [], projection = trend.projection || [];
    const all = [...history, ...projection];
    if (all.length < 2) return '';
    const width = 300, height = 70, pad = 4, max = Math.max(...all.map(p => p.value)), min = Math.min(...all.map(p => p.value));
    const x = i => pad + i * (width - pad * 2) / (all.length - 1), y = v => height - pad - (v - min) / Math.max(1, max - min) * (height - pad * 2);
    const line = points => points.map(([i, v], n) => `${n ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const hist = history.map((p, i) => [i, p.value]), proj = [[history.length - 1, history.at(-1).value], ...projection.map((p, i) => [history.length + i, p.value])];
    return `<svg class="analysis-spark" viewBox="0 0 ${width} ${height}" role="img" aria-label="Per-capita income ${escape(history[0].year)} to ${escape(projection.at(-1)?.year || history.at(-1).year)}; dashed segment is an extrapolated estimate">
      <path d="${line(hist)}" class="analysis-spark-hist"/><path d="${line(proj)}" class="analysis-spark-proj"/>
      <circle cx="${x(history.length - 1).toFixed(1)}" cy="${y(history.at(-1).value).toFixed(1)}" r="2.6" class="analysis-spark-dot"/></svg>
      <div class="analysis-spark-axis"><span>${escape(history[0].year)}</span><span>${escape(history.at(-1).year)} · reported</span><span>${escape(projection.at(-1)?.year || '')} · estimate</span></div>`;
  }

  function incomeHTML(trend) {
    if (!trend || trend.status !== 'available') return `<p class="hint">${escape(trend?.warnings?.[0] || 'Income trend unavailable.')}</p>`;
    const { longRun, recent5Year } = trend.cagr, source = trend.source || {}, url = safeUrl(source.url);
    return `<div class="analysis-income"><div class="analysis-income-head"><strong>${pct(longRun.rate * 100)} / yr</strong><span>Estimated growth in per-capita income · ${escape(trend.state)} ${trend.appliedAs === 'inherited_from_state' ? '(state figure applied to this area)' : ''}</span></div>
      ${sparkline(trend)}
      <p class="hint">Per-capita NSDP, current prices: ${money(trend.series[0].value)} (${escape(trend.series[0].year)}) → ${money(trend.latest.value)} (${escape(trend.latest.year)}). CAGR ${escape(longRun.from)}–${escape(longRun.to)} ${pct(longRun.rate * 100)}${recent5Year ? `; last 5 years ${pct(recent5Year.rate * 100)}` : ''}. ${chip(trend.evidenceClass)} Projection: ${chip('derived_estimate')}</p>
      <p class="hint">${url ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(source.title || 'Source')} ↗</a>` : escape(source.title || '')} · ${escape(source.vintage || '')}</p></div>`;
  }

  function rangeHTML(result) {
    const s = result.scenarios, rows = [
      ['Investment', k => money(s[k].investment)], ['Annual sales (full rate, after ramp-up)', k => money(s[k].annualRevenue)],
      ['Revenue limited by', k => ({ demand_limited: 'Area demand', store_capacity_limited: 'Store size', no_demand_data: 'Store size*', user_input: 'Your input' }[s[k].revenueConstraint] || '—')],
      ['ROI · 5-year cumulative', k => pct(s[k].roi5YearPercent)], ['ROI · annual (year 2)', k => pct(s[k].annualRoiPercent)],
      ['Payback', k => months(s[k].paybackMonths)], ['Break-even sales / yr', k => money(s[k].breakEvenRevenueAnnual)], ['NPV · 5 years', k => money(s[k].npv)]
    ];
    return `<table class="analysis-range"><thead><tr><th scope="col"></th>${LEVELS.map(k => `<th scope="col" title="${escape(s[k].pairing)}">${escape(s[k].label)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(([label, fn]) => `<tr><th scope="row">${escape(label)}</th>${LEVELS.map(k => `<td class="${k === 'mid' ? 'is-base' : ''}">${fn(k)}</td>`).join('')}</tr>`).join('')}</tbody></table>
      <p class="hint">Downside pairs low revenue with high costs; upside pairs high revenue with low costs. Revenue basis: ${escape(result.revenueBasis.label)} ${chip(result.revenueBasis.evidenceClass)}${result.revenueBasis.areaPotential ? ` Area potential ${money(result.revenueBasis.areaPotential)} a year; store capacity ${money(s.mid.capacityRevenue)} (base).` : ''}${result.revenueBasis.basis === 'store_capacity_benchmark' ? ' *No area demand data: revenue is the store-capacity benchmark.' : ''}</p>`;
  }

  // Plain-language breakdown, one step per line: demand, store sales, running costs, margin, break-even, payback.
  function paybackHTML(result) {
    const money = value => moneyRounded(value);
    const mid = result.scenarios?.mid, a = result.assumptions || {}, basis = result.revenueBasis || {};
    if (!mid) return '';
    const area = a.areaSqFt?.value?.mid, density = a.revenuePerSqFtYear?.value?.mid, capture = a.captureRate?.value?.mid;
    const gm = a.grossMargin?.value?.mid, royalty = a.royaltyRate?.value?.mid, marketing = a.marketingRate?.value?.mid;
    const monthly = Object.fromEntries((result.costRange?.monthlyFixedCosts || []).map(row => [row.item, row.mid]));
    const staff = result.costRange?.headcount?.mid, c = basis.catchment;
    const steps = [];
    if (numeric(basis.areaPotential)) steps.push(`<strong>Area demand:</strong> ${c ? `${c.pins} PIN${c.pins === 1 ? '' : 's'} within ${c.radiusKm} km (${Number(c.population).toLocaleString('en-IN')} people)` : 'this area'} could spend ${money(basis.areaPotential)} a year in organised apparel stores${numeric(capture) ? `; one store might win ${Math.round(capture * 100)}% of that, ${money(mid.demandRevenue)}` : ''}.`);
    if (numeric(area) && numeric(density)) steps.push(`<strong>Store sales:</strong> a ${Math.round(area).toLocaleString('en-IN')} sq ft store can sell up to ${money(mid.capacityRevenue)} a year (${Math.round(area).toLocaleString('en-IN')} sq ft × ₹${Math.round(density).toLocaleString('en-IN')} per sq ft, a value-retail benchmark). Expected sales are the smaller of the two: <strong>${money(mid.annualRevenue)}</strong>${mid.revenueConstraint === 'store_capacity_limited' ? ', limited by the store’s size' : mid.revenueConstraint === 'demand_limited' ? ', limited by local demand' : ''}.`);
    if (numeric(monthly.fixedMonthly)) steps.push(`<strong>Running costs:</strong> rent ${money(monthly.rentMonthly * 12)}, ${numeric(staff) ? `${staff} staff ` : 'staff '}${money(monthly.staffMonthly * 12)} and utilities ${money(monthly.utilitiesMonthly * 12)}: <strong>${money(monthly.fixedMonthly * 12)} a year</strong>.`);
    if (numeric(mid.contributionMargin)) steps.push(`<strong>What each sale leaves:</strong> ${numeric(gm) ? `${Math.round(gm * 1000) / 10}% gross margin − ${Math.round(royalty * 1000) / 10}% royalty − ${Math.round(marketing * 1000) / 10}% marketing = ` : ''}₹${(mid.contributionMargin * 100).toFixed(1)} of every ₹100 sold.`);
    if (numeric(mid.breakEvenRevenueAnnual)) steps.push(`<strong>Break-even:</strong> the store must sell ${money(mid.breakEvenRevenueAnnual)} a year just to cover running costs (running costs ÷ what each sale leaves). This is a sales target, not a cost, so it can be larger than the investment.`);
    const verdict = numeric(mid.paybackMonths) ? `Selling ${money(mid.annualRevenue)} leaves cash each year that recovers the ${money(mid.investment)} investment in <strong>${months(mid.paybackMonths)}</strong>.`
      : mid.annualRevenue < (mid.breakEvenRevenueAnnual ?? Infinity) ? `Expected sales of ${money(mid.annualRevenue)} are below break-even, so the store loses money each year and <strong>never recovers</strong> the ${money(mid.investment)} investment.`
      : `Expected sales are only ${money(mid.annualRevenue - mid.breakEvenRevenueAnnual)} above break-even, leaving about ${money((mid.annualRevenue - mid.breakEvenRevenueAnnual) * mid.contributionMargin)} of cash a year: <strong>not enough to recover</strong> the ${money(mid.investment)} investment within 5 years.`;
    steps.push(`<strong>Payback:</strong> ${verdict}${numeric(result.scenarios.high?.paybackMonths) ? ` In the upside case (higher sales per sq ft and margin, lower costs) it pays back in ${months(result.scenarios.high.paybackMonths)}.` : ''}`);
    return `<div class="analysis-why"><strong class="analysis-why-title">How the payback is worked out</strong><ol>${steps.map(step => `<li>${step}</li>`).join('')}</ol></div>`;
  }

  function projectionHTML(result) {
    const base = result.scenarios.mid.projection;
    return `<table class="analysis-range analysis-projection"><thead><tr><th scope="col">Base case</th>${base.map(r => `<th scope="col">Y${r.year}</th>`).join('')}</tr></thead><tbody>
      <tr><th scope="row">Revenue</th>${base.map(r => `<td>${money(r.revenue)}</td>`).join('')}</tr>
      <tr><th scope="row">Operating cash flow</th>${base.map(r => `<td>${money(r.operatingCashFlow)}</td>`).join('')}</tr>
      <tr><th scope="row">Cumulative</th>${base.map(r => `<td class="${r.cumulativeCashFlow < 0 ? 'is-negative' : ''}">${money(r.cumulativeCashFlow)}</td>`).join('')}</tr></tbody></table>`;
  }

  function costsHTML(result) {
    const c = result.costRange;
    return `<table class="analysis-range"><thead><tr><th scope="col">Investment item</th><th scope="col">Low</th><th scope="col">Mid</th><th scope="col">High</th></tr></thead><tbody>
      ${c.components.map(r => `<tr><th scope="row">${escape(r.label)}<small>${escape(r.formula)} ${chip(r.evidenceClass)}</small></th>${LEVELS.map(k => `<td>${money(r[k])}</td>`).join('')}</tr>`).join('')}
      <tr class="is-total"><th scope="row">Total investment</th>${LEVELS.map(k => `<td>${money(c.investmentTotal[k])}</td>`).join('')}</tr>
      ${c.monthlyFixedCosts.map(r => `<tr><th scope="row">${escape({ rentMonthly: 'Rent / month', staffMonthly: 'Staff / month', utilitiesMonthly: 'Utilities / month', fixedMonthly: 'Fixed costs / month' }[r.item])}</th>${LEVELS.map(k => `<td>${money(r[k])}</td>`).join('')}</tr>`).join('')}
      </tbody></table><p class="hint">Staff: ${LEVELS.map(k => c.headcount[k]).join(' / ')} employees. Costs follow ${escape(result.tier.tier)} (HRA class ${escape(result.tier.tierClass)}): ${escape(result.tier.basis)}</p>`;
  }

  function formHTML(result, overrides) {
    const a = result.assumptions;
    const current = key => key === 'annualRevenue' ? result.revenueBasis.annualValue : a[key]?.value?.mid;
    return `<form class="analysis-form" data-analysis-form><div class="analysis-form-grid">
      ${EDITABLE.map(([key, label]) => { const assumption = a[key]; const value = overrides[key];
        return `<label>${escape(label)}<input class="input" type="number" step="any" min="0" ${/fraction|rate/.test(label) ? 'max="1"' : ''} name="${escape(key)}" value="${value ?? ''}" placeholder="${escape(current(key) ?? '')}">
          <small>${assumption ? `${chip(assumption.evidenceClass)} ${escape(LEVELS.map(k => assumption.value[k]).join(' / '))}` : chip(result.revenueBasis.evidenceClass)}</small></label>`; }).join('')}
      </div><p class="hint">Blank fields use the automatic low / mid / high values shown. An entered value replaces all three levels.</p>
      <div class="market-actions"><button class="button primary small" type="submit">Recalculate</button><button class="button small" type="button" data-analysis-reset>Reset to automatic</button><span class="hint" data-analysis-form-status></span></div></form>`;
  }

  function caveatsHTML(result) {
    const sources = result.evidence.map(s => { const url = safeUrl(s.url); return url ? `<li><a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(s.title || url)} ↗</a>${s.publisher ? ` · ${escape(s.publisher)}` : ''}${s.referencePeriod ? ` · ${escape(s.referencePeriod)}` : ''}${s.usage ? `<small>${escape(s.usage)}</small>` : ''}</li>` : ''; }).join('');
    const caveats = Object.values(result.assumptions).filter(item => item.caveat).map(item => `<li><strong>${escape(item.label)}</strong> ${chip(item.evidenceClass)} ${escape(item.caveat)}</li>`).join('');
    return `<ul class="analysis-warnings">${result.warnings.map(w => `<li>${escape(w)}</li>`).join('')}</ul>
      <details class="analysis-sub"><summary>Assumption caveats</summary><ul class="analysis-list">${caveats}</ul></details>
      <details class="analysis-sub"><summary>Sources (${result.evidence.length})</summary><ul class="analysis-list">${sources}</ul></details>`;
  }

  function resultHTML(result, overrides) {
    const edited = Object.keys(overrides).length;
    return `<div class="analysis-head"><span class="analysis-tier">${result.tier.tierClass === 'mixed' ? `Mixed city tiers · ${escape(result.tier.classesPresent.join('/'))}` : `${escape(result.tier.tier)} · HRA ${escape(result.tier.tierClass)}`}</span>${edited ? `<span class="analysis-chip analysis-chip--user_assumption">${edited} assumption${edited > 1 ? 's' : ''} edited</span>` : '<span class="hint">Automatic estimate · no inputs required</span>'}</div>
      ${rangeHTML(result)}${paybackHTML(result)}
      <h3 class="analysis-h">Household income trend <span class="hint">estimate</span></h3>${incomeHTML(result.incomeTrend)}
      <details class="analysis-sub"><summary>5-year projection (base case)</summary>${projectionHTML(result)}</details>
      <details class="analysis-sub"><summary>Cost range breakdown</summary>${costsHTML(result)}</details>
      <details class="analysis-sub" data-analysis-edit><summary>Edit assumptions</summary>${formHTML(result, overrides)}</details>
      <details class="analysis-sub"><summary>Caveats & evidence (${result.warnings.length})</summary>${caveatsHTML(result)}</details>`;
  }

  function create({ container, fetch = root.fetch?.bind(root) } = {}) {
    let geographyId = null, overrides = {}, revision = 0, controller = null, last = null;
    container.innerHTML = '<p class="hint">Select a state, district, city or PIN to estimate store costs, ROI and payback.</p>';
    async function run() {
      const current = ++revision; controller?.abort(); controller = new AbortController();
      const editOpen = container.querySelector('[data-analysis-edit]')?.open;
      if (!last) container.innerHTML = '<p class="hint" role="status">Estimating store costs, ROI and payback…</p>';
      else container.querySelector('[data-analysis-form-status]')?.replaceChildren('Recalculating…');
      try {
        const response = await fetch('/api/market/analysis', { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ geographyId, overrides }) });
        const result = await response.json().catch(() => ({}));
        if (current !== revision) return;
        if (!response.ok) throw Error(result.error || `Analysis API returned ${response.status}`);
        const entering = !last; last = result; container.innerHTML = resultHTML(result, overrides);
        if (entering) enter();
        if (editOpen) container.querySelector('[data-analysis-edit]').open = true;
      } catch (error) {
        if (error.name === 'AbortError' || current !== revision) return;
        const status = container.querySelector('[data-analysis-form-status]');
        if (status && last) status.textContent = error.message;
        else container.innerHTML = `<p class="hint">${escape(error.message)} Store analysis is optional; market evidence remains available.</p>`;
      }
    }
    // Liquid glass motion: a new area's result blurs into focus and its income growth counts up.
    function enter() {
      if (root.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      container.classList.remove('is-entering'); void container.offsetWidth; container.classList.add('is-entering');
      const growth = container.querySelector('.analysis-income-head strong');
      if (growth) root.LiquidMotion?.countUp?.(growth);
    }
    function onSubmit(event) {
      if (!event.target.matches('[data-analysis-form]')) return;
      event.preventDefault();
      const next = {};
      for (const [key, raw] of new FormData(event.target)) {
        if (String(raw).trim() === '') continue;
        const value = Number(raw);
        if (!Number.isFinite(value) || value < 0) { event.target.querySelector('[data-analysis-form-status]').textContent = `Enter a non-negative number for ${key}.`; return; }
        next[key] = value;
      }
      overrides = next; run();
    }
    function onClick(event) { if (event.target.closest('[data-analysis-reset]')) { overrides = {}; run(); } }
    container.addEventListener('submit', onSubmit); container.addEventListener('click', onClick);
    return {
      load(id) { if (!id) return; if (String(id) !== geographyId) { last = null; delete overrides.annualRevenue; } geographyId = String(id); run(); },
      clear() { revision++; controller?.abort(); geographyId = null; last = null; container.innerHTML = '<p class="hint">Select a state, district, city or PIN to estimate store costs, ROI and payback.</p>'; },
      refresh() { if (geographyId && last) container.innerHTML = resultHTML(last, overrides); },
      destroy() { revision++; controller?.abort(); container.removeEventListener('submit', onSubmit); container.removeEventListener('click', onClick); }
    };
  }

  root.MarketAnalysisPanel = { create, resultHTML };
})(typeof window !== 'undefined' ? window : globalThis);
