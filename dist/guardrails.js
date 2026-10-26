'use strict';
// Content guard rails for imported workbooks. Format problems (₹25,00,000, "7 years") are proposed corrections;
// these are values that are well-formed but suspicious, contradictory or impossible to act on, so a reviewer
// sees them before trusting a score. Pure: takes normalized applications, parsed territories and the fixed stores.
(function (root) {
  const CITY_PREFIX = { 'Bengaluru': '560', 'Mysuru': '570', 'Mangaluru': '575', 'Hubballi-Dharwad': '580', 'Belagavi': '590', 'Tumakuru': '572', 'Davanagere': '577' };
  const REQUIRED = { id: 'Application ID', name: 'Applicant name', city: 'City', state: 'State', pin: 'Pin code', investment: 'Investment capacity', experience: 'Retail experience', space: 'Space available' };
  const LIMITS = { investment: [5, 300], area: [100, 5000], launch: [1, 24], experience: [0, 40] };
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const blank = value => value === null || value === undefined || String(value).trim() === '';
  const nameKey = value => String(value || '').toLowerCase().replace(/[^a-z]/g, '');
  const lakh = value => `₹${Number(value).toLocaleString('en-IN')} lakh`;

  function checkGuardrails({ apps = [], territories = [], stores = [] } = {}) {
    const flags = [];
    const flag = (subject, kind, severity, message, action, field = null) => flags.push({ subject, kind, severity, message, action, field });
    const storePins = new Set(stores.map(s => String(s.pin)));
    const territoryByPin = new Map();
    for (const t of territories) for (const pin of t.pins || []) territoryByPin.set(pin, [...(territoryByPin.get(pin) || []), t]);

    for (const a of apps) {
      const subject = { type: 'application', key: a.key, id: a.id || null, name: a.name || null };
      const missing = Object.entries(REQUIRED).filter(([field]) => blank(a[field]) && !a.pending?.some(p => p.field === field)).map(([, label]) => label);
      if (missing.length) flag(subject, 'missing', 'high', `Missing required ${missing.length === 1 ? 'field' : 'fields'}: ${missing.join(', ')}.`, 'Ask the applicant for the missing details before scoring.');

      const pin = blank(a.pin) ? null : String(a.pin);
      if (pin && CITY_PREFIX[a.city] && !pin.startsWith(CITY_PREFIX[a.city])) flag(subject, 'city-pin', 'high', `${a.city} PINs start with ${CITY_PREFIX[a.city]}, but the PIN is ${pin}.`, 'Confirm which city and PIN the applicant means.', 'pin');
      if (pin && storePins.has(pin)) flag(subject, 'existing-store', 'high', `PIN ${pin} already has a brand store.`, 'Offer a nearby open PIN; one store per PIN code.', 'pin');
      else if (pin && /^\d{6}$/.test(pin) && territories.length && !territoryByPin.has(pin)) flag(subject, 'no-territory', 'medium', `PIN ${pin} is not in any territory the brand has opened.`, 'Check whether the brand wants this area, or suggest a PIN inside a territory.', 'pin');

      if (finite(a.investment) && (a.investment < LIMITS.investment[0] || a.investment > LIMITS.investment[1])) flag(subject, 'outlier', a.investment === 0 ? 'high' : 'medium', `Investment of ${lakh(a.investment)} is outside the usual ${LIMITS.investment[0]}–${LIMITS.investment[1]} lakh range.`, 'Confirm the amount and that it is in lakh.', 'investment');
      if (finite(a.area) && (a.area < LIMITS.area[0] || a.area > LIMITS.area[1])) flag(subject, 'outlier', 'medium', `Space of ${a.area.toLocaleString('en-IN')} sq ft is outside the usual ${LIMITS.area[0]}–${LIMITS.area[1].toLocaleString('en-IN')} sq ft range.`, 'Confirm the size; it may be a typo or a whole building.', 'area');
      if (finite(a.launch) && (a.launch < LIMITS.launch[0] || a.launch > LIMITS.launch[1])) flag(subject, 'outlier', 'medium', a.launch < LIMITS.launch[0] ? `Launch in ${a.launch} months is not realistic for fit-out and training.` : `Launch in ${a.launch} months is beyond the planning horizon.`, 'Confirm the launch timeline.', 'launch');
      if (finite(a.experience) && a.experience > LIMITS.experience[1]) flag(subject, 'outlier', 'medium', `${a.experience} years of retail experience looks too high.`, 'Confirm the number of years.', 'experience');

      const space = String(a.space || '').toLowerCase();
      if (space.startsWith('not yet') && finite(a.area)) flag(subject, 'contradiction', 'medium', `Space is "Not yet identified" but a size of ${a.area} sq ft is given.`, 'Ask whether a site has been found.', 'space');
      if ((space === 'owned' || space === 'rented') && !finite(a.area) && !a.pending?.some(p => p.field === 'area')) flag(subject, 'contradiction', 'low', `Space is ${a.space} but no size is given.`, 'Ask for the space size.', 'area');
      const years = String(a.business || '').match(/(\d{1,2})\s*(?:\+\s*)?years?/i);
      const retail = /\b(ran|runs|owns|owned|managed|manager)\b/i.test(String(a.business || '')) && /\b(store|stores|shop|shops|boutique|showroom|outlet|mart|retail)\b/i.test(String(a.business || ''));
      if (a.experience === 0 && (years || retail)) flag(subject, 'contradiction', 'medium', `Retail experience is 0, but the business says "${a.business}".`, 'Confirm the retail experience in years.', 'experience');
      const noted = String(a.notes || '').match(/(\d{1,4})\s*(?:lakh|lakhs|l)\b/i);
      if (noted && finite(a.investment) && Number(noted[1]) !== a.investment) flag(subject, 'contradiction', 'low', `Notes mention ${lakh(noted[1])}, but investment capacity is ${lakh(a.investment)}.`, 'Confirm which amount to assess.', 'investment');
    }

    // Possible duplicate applicants: same normalized name with the same PIN or city, under different IDs.
    const byName = new Map();
    for (const a of apps) { const k = nameKey(a.name); if (k.length >= 4) byName.set(k, [...(byName.get(k) || []), a]); }
    for (const group of byName.values()) {
      if (group.length < 2) continue;
      for (const a of group) {
        const others = group.filter(o => o !== a && (String(o.pin) === String(a.pin) || o.city === a.city));
        if (others.length) flag({ type: 'application', key: a.key, id: a.id || null, name: a.name || null }, 'duplicate', 'medium', `Possible duplicate of ${others.map(o => o.id || o.key).join(', ')} (same name, same ${String(others[0].pin) === String(a.pin) ? 'PIN' : 'city'}).`, 'Merge or keep one application.');
      }
    }

    // Contested PINs: more applicants than the PIN can take (one store per PIN code).
    const byPin = new Map();
    for (const a of apps) if (/^\d{6}$/.test(String(a.pin || ''))) byPin.set(String(a.pin), [...(byPin.get(String(a.pin)) || []), a]);
    for (const [pin, group] of byPin) if (group.length >= 3 && !storePins.has(pin)) flag({ type: 'pin', pin }, 'contested', 'low', `${group.length} applicants want PIN ${pin}; only one store can open there.`, 'Compare them side by side and offer the others nearby PINs.');

    for (const t of territories) {
      const subject = { type: 'territory', id: t.id, city: t.city };
      if (t.slots === 0) flag(subject, 'no-slots', 'medium', `${t.id} (${t.city}) has 0 open slots, so none of its applicants can be recommended.`, 'Confirm whether the brand still wants stores here.');
      const onStore = (t.pins || []).filter(pin => storePins.has(pin));
      if (onStore.length) flag(subject, 'existing-store', 'low', `${t.id} covers PIN ${onStore.join(', ')}, which already has a store.`, 'Remove it from the territory or plan a second store deliberately.');
      for (const pin of t.pins || []) {
        const owners = territoryByPin.get(pin) || [];
        if (owners.length > 1 && owners[0] === t) flag({ type: 'pin', pin }, 'overlap', 'medium', `PIN ${pin} is in more than one territory: ${owners.map(o => o.id).join(', ')}.`, 'Assign the PIN to a single territory.');
      }
    }
    const order = { high: 0, medium: 1, low: 2 };
    return flags.sort((a, b) => order[a.severity] - order[b.severity]);
  }

  const api = { checkGuardrails, CITY_PREFIX, LIMITS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Guardrails = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
