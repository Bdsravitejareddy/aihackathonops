(function (root) {
  'use strict';

  // Shared territory KPIs (catchment, TAM, investment, payback) for the Territory Screener and the
  // Territories page. All numbers come from /api/territories/metrics; this file only formats them.
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const display = () => root.FranchiseDisplay;
  const money = value => Number.isFinite(value) ? (display()?.money ? display().money(value, 'INR') : `₹${Math.round(value).toLocaleString('en-IN')}`) : '—';
  const people = value => Number.isFinite(value) ? (display()?.count ? display().count(value) : Math.round(value).toLocaleString('en-IN')) : '—';
  const months = value => value === null || value === undefined ? '> 60 mo' : `${value} mo`;
  const coverage = part => part && part.pinsTotal > 1 ? `${part.pinsWithData} of ${part.pinsTotal} PINs with data` : part?.pinsWithData ? 'Modelled' : 'No data for this PIN';
  const LIMIT = { demand_limited: 'revenue limited by area demand', store_capacity_limited: 'revenue limited by store size', no_demand_data: 'no area demand data' };

  async function load(pins, { slots = null, fetch = root.fetch?.bind(root), signal } = {}) {
    if (typeof fetch !== 'function') throw new Error('Territory metrics need a network connection');
    const query = new URLSearchParams({ pins: pins.join(',') });
    if (Number.isInteger(slots) && slots >= 0) query.set('slots', String(slots));
    const response = await fetch(`/api/territories/metrics?${query}`, { signal });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Territory metrics returned ${response.status}`);
    return result;
  }

  function kpi(label, value, note, extra = '') {
    const tipKey={'Catchment population':'catchment','TAM · category spend':'tam','Investment required':'investment','Payback · base case':'payback'}[label]||'';
    return `<div class="te-kpi"><span class="te-label"${tipKey?` data-tip-key="${tipKey}" tabindex="0"`:''}>${escape(label)}</span><strong class="te-value">${value}</strong><small class="te-note">${note}</small>${extra}</div>`;
  }

  /** Four equal KPI cards for a territory aggregate (or a single-PIN territory). */
  function kpisHTML(aggregate, { compact = false } = {}) {
    const a = aggregate || {}, inv = a.investment, pay = a.payback, noSlots = a.openSlots === 0;
    const investNote = noSlots ? 'No open slots'
      : inv ? `${money(inv.low)} – ${money(inv.high)} · ${inv.stores} store${inv.stores === 1 ? '' : 's'}` : 'No PIN with data';
    const paybackNote = noSlots ? 'No open slots'
      : pay ? `Range ${months(pay.best.downside)} – ${months(pay.best.upside)} · PIN ${escape(pay.best.pin)}` : 'No PIN with data';
    return `<div class="te-kpis${compact ? ' te-kpis--compact' : ''}">
      ${kpi('Catchment population', people(a.catchmentPopulation?.value), escape(coverage(a.catchmentPopulation)))}
      ${kpi('TAM · category spend', `${money(a.tam?.value)}<span class="te-unit">/yr</span>`, escape(coverage(a.tam)))}
      ${kpi('Investment required', noSlots ? '—' : money(inv?.mid), investNote)}
      ${kpi('Payback · base case', noSlots || !pay ? '—' : months(pay.best.base), paybackNote)}
    </div>`;
  }

  function pinSummary(row) {
    if (row.status !== 'available') return { population: '—', tam: '—', investment: '—', payback: '—', note: 'Not in the PIN dataset' };
    const an = row.analysis;
    return { population: people(row.population?.value), tam: money(row.apparelExpenditure?.value), investment: money(an.investment.mid), payback: months(an.paybackMonths.base),
      note: `${an.tier} · ${LIMIT[an.revenueConstraint] || ''}` };
  }

  function methodHTML(aggregate) {
    return `<details class="te-method"><summary>How these are combined</summary><ul>${(aggregate?.method || []).map(item => `<li>${escape(item)}</li>`).join('')}</ul></details>`;
  }

  root.TerritoryEconomics = { load, kpisHTML, pinSummary, methodHTML, money, people, months };
})(typeof window !== 'undefined' ? window : globalThis);
