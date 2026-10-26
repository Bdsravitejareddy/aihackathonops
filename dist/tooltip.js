'use strict';
// Hover and focus explanations. Any element with data-tip="text" or data-tip-key="<glossary key>" shows a small
// card above it saying what the figure or label means. One shared glossary keeps the wording identical everywhere.
(function (root) {
  const GLOSSARY = {
    screened: 'Every application the app has checked against the brand’s requirements. Time saved assumes 10 minutes for a person to review one application by hand.',
    filteredOut: 'Applications not recommended right now: data required, future expansion or not accepted.',
    corrections: 'Values the app proposed to fix when the workbook was uploaded (for example an amount typed in rupees instead of lakh) and you then confirmed on Data review.',
    onboardTime: 'Average days from a partner starting training to finishing it, from the dates recorded on Onboarding.',
    lmsTime: 'Average hours recommended partners spent on the learning system (LMS), as recorded on Onboarding.',
    rampTime: 'How long a new store takes to reach its full sales rate. This is the store model’s planning assumption for the base case, not measured from real stores.',
    received: 'All applications in the workbook.',
    onboardingComplete: 'Recommended partners with a training finish date on Onboarding.',
    Recommended: 'Meets every requirement and has a territory slot. Funds and premises are as declared on the form.',
    'Data required': 'On hold: something is missing, conflicting or below a requirement. The applicant can still move forward once it is fixed.',
    'Future expansion': 'A good application, but the location does not fit right now: a higher-ranked applicant has the slot, or the brand is not opening in that pin code.',
    'Not accepted': 'A store already trades in this pin code, and the brand never opens two stores in one pin code.',
    tam: 'TAM (total addressable market): what everyone living in the area spends on clothing and footwear in a year, across all shops and online. Population × monthly spend per person × 12.',
    potentialRevenue: 'The part of the TAM that organised physical stores can win: TAM × 41% organised × 78% offline. It is demand for the whole area, not one store’s sales.',
    catchment: 'People living in the area (modelled 2020 population).',
    spend: 'Average monthly spend on clothing and footwear per person, from the government’s Household Consumption Expenditure Survey 2023–24.',
    investment: 'Cost to open one store of the brand’s format (400 sq ft): fit-out, rent deposit, opening stock, franchise fee, pre-opening costs and a cash reserve, priced for the city tier.',
    payback: 'Months until the store’s cash from sales, after running costs, adds up to the money invested. Over 5 years means it does not pay back within the model’s 5-year window.',
    applications: 'Applications whose pin code is in this territory.',
    slots: 'Recommended applicants out of the new stores the brand wants to open here.',
    score: 'Fit score out of 100 from the declared application: funding 35, premises 30, retail experience 20, prior business 5, launch timing 10.'
  };
  const doc = root.document;
  if (!doc) return;
  let tip = null, owner = null;
  const textFor = el => el.dataset.tip || GLOSSARY[el.dataset.tipKey] || '';
  function show(el) {
    const text = textFor(el); if (!text) return;
    owner = el;
    if (!tip) { tip = doc.createElement('div'); tip.className = 'hover-tip'; tip.setAttribute('role', 'tooltip'); tip.id = 'hover-tip'; doc.body.append(tip); }
    tip.textContent = text; tip.hidden = false; el.setAttribute('aria-describedby', 'hover-tip');
    const box = el.getBoundingClientRect(), width = Math.min(300, root.innerWidth - 24);
    tip.style.maxWidth = `${width}px`;
    const tipBox = tip.getBoundingClientRect();
    const left = Math.max(12, Math.min(box.left + box.width / 2 - tipBox.width / 2, root.innerWidth - tipBox.width - 12));
    const above = box.top - tipBox.height - 8;
    tip.style.left = `${left}px`; tip.style.top = `${above >= 8 ? above : box.bottom + 8}px`;
  }
  function hide() { if (tip) tip.hidden = true; owner?.removeAttribute('aria-describedby'); owner = null; }
  const target = event => event.target?.closest?.('[data-tip],[data-tip-key]');
  doc.addEventListener('mouseover', event => { const el = target(event); if (el && el !== owner) show(el); else if (!el && owner) hide(); });
  doc.addEventListener('focusin', event => { const el = target(event); if (el) show(el); });
  doc.addEventListener('focusout', hide);
  root.addEventListener('scroll', hide, true);
  doc.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
  root.FranchiseTips = { GLOSSARY, text: key => GLOSSARY[key] || '' };
})(typeof window !== 'undefined' ? window : globalThis);
