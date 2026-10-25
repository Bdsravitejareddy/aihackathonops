'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TerritoryScreening = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  /**
   * Mount the additive Territory Screening panel into an existing element.
   *
   * API: mount({root, location, marketContext, applicants, onOpenApplicant,
   * onLocationChange, onFilterChange, tieBreakFields}) returns a controller with
   * updateLocation, updateMarketContext, updateApplicants, setFilter,
   * getLocation and destroy methods. It also listens for
   * `franchiseos:location-selected` on the root document's window.
   * Load dist/territory-screening.css separately; the module does not alter
   * the host page or its navigation. PIN form selections emit the same event.
   *
   * location is the shared geography object (id/name/level/pin/state/city,
   * metrics, evidence). marketContext carries supplied metrics, rural/urban
   * spend, footfall, investment reference values, store presence, sources and
   * assumptions. applicants must be the records already linked to the active
   * territory. confirmedEligibilityScore (or score) is used as the primary
   * descending rank. tieBreakFields are field names (ascending) or
   * {field,direction:'desc'} objects; application ID is always the final key.
   * No market metric or applicant score is calculated by this presentation
   * module. Missing values remain unavailable. Funding compatibility is a
   * comparison of supplied values, not an approval or funding decision.
   */
  const TEXT = {
    population: ['Population', 'people'], populationDensity: ['Population density', 'people/km²'],
    targetPopulation: ['Target demographic', 'people'], monthlyPerCapitaSpend: ['Monthly clothing & footwear spend / person', '₹/person/month'],
    annualPerCapitaSpend: ['Annual clothing & footwear spend / person', '₹/person/year'],
    apparelExpenditure: ['Annual apparel market expenditure · TAM', '₹/year'], tam: ['Annual TAM', '₹/year'],
    sam: ['Serviceable market · SAM', '₹/year'], som: ['Capturable market · SOM', '₹/year'],
    incomeProxy: ['Purchasing-power proxy', ''], competitorCount: ['Nearby retail listings', 'listings'],
    saturation: ['Market saturation', ''], storeRevenueLow: ['Estimated store revenue · low', '₹/year'],
    storeRevenueBase: ['Estimated store revenue · base', '₹/year'], storeRevenueHigh: ['Estimated store revenue · high', '₹/year']
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const list = value => Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
  const numeric = value => typeof value === 'number' && Number.isFinite(value);
  const fmt = (value, unit = '') => {
    if (!numeric(value)) return 'Unavailable';
    const amount=value.toLocaleString('en-IN',{maximumFractionDigits:2});
    return unit.startsWith('₹') ? `₹${amount}${unit.slice(1)}` : `${amount}${unit ? ` ${unit}` : ''}`;
  };
  const metricValue = value => numeric(value) ? value : value && value.status !== 'unavailable' && numeric(value.value) ? value.value : null;
  const confirmedScore = applicant => [applicant.confirmedEligibilityScore, applicant.confirmedScore, applicant.score].find(numeric);
  const idOf = applicant => String(applicant.applicationId ?? applicant.id ?? applicant.key ?? '');
  const scoreRange = applicant => {
    const range = applicant.scoreRange;
    const low = numeric(range?.low) ? range.low : numeric(applicant.scoreLow) ? applicant.scoreLow : confirmedScore(applicant);
    const high = numeric(range?.high) ? range.high : numeric(applicant.scoreHigh) ? applicant.scoreHigh : numeric(applicant.possibleEligibilityScore) ? applicant.possibleEligibilityScore : numeric(applicant.high) ? applicant.high : low;
    if (low === null || low === undefined) return 'Unscored';
    return low === high ? `${fmt(low)}` : `${fmt(low)}–${fmt(high)} (incomplete range)`;
  };
  const sortApplicants = (applicants, tieBreakFields = []) => [...list(applicants)].sort((a,b) => {
    const as = confirmedScore(a), bs = confirmedScore(b);
    if (as !== bs) { if (as === undefined) return 1; if (bs === undefined) return -1; return bs - as; }
    for (const field of tieBreakFields) {
      const key = typeof field === 'string' ? field : field?.field || field?.key;
      if (!key) continue;
      const direction = typeof field === 'object' && field.direction === 'desc' ? -1 : 1;
      const av = a[key], bv = b[key];
      if (av == null && bv != null) return 1;
      if (bv == null && av != null) return -1;
      if (av == null && bv == null) continue;
      const delta = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv),undefined,{numeric:true,sensitivity:'base'});
      if (delta) return delta * direction;
    }
    return idOf(a).localeCompare(idOf(b),undefined,{numeric:true,sensitivity:'base'});
  });
  function mount({root, location = null, marketContext = null, applicants = [], territories = [], onOpenApplicant = () => {}, onLocationChange = () => {}, onFilterChange = () => {}, tieBreakFields = []} = {}) {
    if (!root) throw new Error('Territory Screening root is required');
    const doc = root.ownerDocument, win = doc.defaultView;
    let selected = location, market = marketContext, records = list(applicants), workspaceTerritories=list(territories), filter = 'all';
    const shell = doc.createElement('section'); shell.className = 'territory-screening'; shell.setAttribute('aria-label','Territory screening');
    shell.innerHTML = `<header class="ts-heading"><div><p class="ts-eyebrow">TERRITORY SCREENING</p><h1>One territory. A clear next step.</h1><p>Review supported market evidence and compare applicants for the selected postal area.</p></div><span class="ts-separation">Eligibility is not franchise approval</span></header>
      <form class="ts-pin-form" data-pin-form><label for="ts-pin">Six-digit PIN code</label><div class="ts-pin-controls"><input id="ts-pin" name="pin" inputmode="numeric" autocomplete="postal-code" maxlength="6" pattern="[0-9]{6}" placeholder="Enter PIN code" aria-describedby="ts-pin-message"><button type="submit">View territory</button></div><p class="ts-message" id="ts-pin-message" data-pin-message aria-live="polite"></p></form>
      <details class="ts-cascade"><summary>Browse uploaded territories · State → City → PIN</summary><div class="ts-cascade-grid"><label>State<select data-cascade-state><option value="">Select state</option></select></label><label>City<select data-cascade-city disabled><option value="">Select city</option></select></label><label>PIN code<select data-cascade-pin disabled><option value="">Select PIN</option></select></label></div><p class="ts-message">Options come from the workspace territory list. This identifies an uploaded territory; it does not supply population or economic data.</p></details>
      <div class="ts-location" data-location aria-live="polite"></div><div class="ts-market" data-market></div>
      <details class="ts-details"><summary>Spend and footfall evidence</summary><div data-evidence></div></details>
      <section class="ts-applicants"><div class="ts-applicants-heading"><div><p class="ts-eyebrow">PARTNER PIPELINE</p><h2>Applicants for this territory</h2><p class="ts-subtitle">Rank is a screening order only. Confirmed funds, premises and due diligence remain separate checks.</p></div><div class="ts-filters" role="group" aria-label="Applicant filter"><button type="button" data-filter="all" aria-pressed="true">All Ranked</button><button type="button" data-filter="actionable" aria-pressed="false">Actionable</button></div></div><div class="ts-applicant-list" data-applicants></div></section>`;
    root.replaceChildren(shell);
    const q = selector => shell.querySelector(selector);
    const territoryStates=[...new Set(workspaceTerritories.map(row=>row.state).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    q('[data-cascade-state]').insertAdjacentHTML('beforeend',territoryStates.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join(''));
    function fillSelect(select,placeholder,values){const first=doc.createElement('option');first.value='';first.textContent=placeholder;const options=values.map(value=>{const option=doc.createElement('option');option.value=value;option.textContent=value;return option;});select.replaceChildren(first,...options);}
    const locationLabel = value => value ? [value.name || value.city || value.pin || value.id, value.level, value.city && value.city !== value.name ? value.city : null, value.state].filter(Boolean).join(' · ') : 'Select a PIN code to begin';
    function evidenceLine(value) {
      const row = doc.createElement('div'); row.className = 'ts-evidence-row';
      const title = value?.title || value?.dataset || value?.sourceId || 'Evidence';
      const link = doc.createElement('a');
      try { const url = new URL(value?.url || value?.sourceUrl, win.location.href); if (!['http:','https:'].includes(url.protocol)) throw Error(); link.href=url.href; link.target='_blank'; link.rel='noopener noreferrer'; link.textContent=title; row.append(link); }
      catch { const span=doc.createElement('span'); span.textContent=title; row.append(span); }
      const meta=[value?.evidenceClass,value?.referenceYear || value?.referencePeriod,value?.geographicResolution || value?.geography?.level].filter(Boolean);
      if(meta.length){const small=doc.createElement('small');small.textContent=meta.join(' · ');row.append(small);}
      return row;
    }
    function metricCard(key, raw) {
      const conf=TEXT[key]||[key.replace(/([a-z])([A-Z])/g,'$1 $2'), ''];
      const val=metricValue(raw), card=doc.createElement('article'); card.className='ts-metric';
      const h=doc.createElement('span'); h.textContent=conf[0]; const strong=doc.createElement('strong'); strong.textContent=fmt(val,raw?.unit || conf[1]);
      const evidence=doc.createElement('small'); evidence.textContent=(raw?.evidenceClass || (val===null?'Missing evidence':'Evidence class not supplied')).replace(/_/g,' ').replace(/\bmodeled\b/gi,'modelled');
      card.append(h,strong,evidence);
      if(raw?.referenceYear || raw?.referencePeriod){const year=doc.createElement('small');year.textContent=`Reference: ${raw.referenceYear || raw.referencePeriod}`;card.append(year);}
      if(raw?.confidence || raw?.uncertainty){const confidence=doc.createElement('small');confidence.textContent=[raw.confidence,raw.uncertainty].filter(Boolean).join(' · ');card.append(confidence);}
      if(val===null){const missing=doc.createElement('small');missing.className='ts-missing';missing.textContent=raw?.missingReason || 'No value supplied at this geography.';card.append(missing);}
      return card;
    }
    function renderMarket() {
      const target=q('[data-market]'), context=market||{}, metrics=context.metrics||context.geography?.metrics||selected?.metrics||{};
      target.replaceChildren();
      const section=doc.createElement('section'); section.className='ts-market-summary';
      const title=doc.createElement('div'); title.className='ts-section-title'; title.innerHTML='<div><p class="ts-eyebrow">LOCAL OPPORTUNITY</p><h2>What the evidence supports</h2></div>';
      const store=context.existingStore ?? context.storePresence ?? selected?.existingStore;
      if(store !== undefined && store !== null){const present=typeof store==='boolean'?store:!!(store.present ?? store.exists ?? store.occupied);const status=doc.createElement('p');status.className='ts-store-status';status.textContent=present ? `Existing franchise store · ${store.description || store.name || 'reported for this PIN'}` : 'No existing franchise store is reported in the supplied data';title.append(status);}
      section.append(title);
      const cards=doc.createElement('div');cards.className='ts-market-grid';
      const order=['population','targetPopulation','monthlyPerCapitaSpend','annualPerCapitaSpend','tam','apparelExpenditure','sam','som','incomeProxy','competitorCount','saturation','storeRevenueLow','storeRevenueBase','storeRevenueHigh'];
      for(const key of order) cards.append(metricCard(key,metrics[key]));
      if(metricValue(metrics.population)===null){const empty=doc.createElement('p');empty.className='ts-empty';empty.textContent='PIN-level population is unavailable. No substitute city or regional population has been applied.';section.append(empty);}
      section.append(cards);
      const explanation=doc.createElement('p'); explanation.className='ts-explanation';
      explanation.textContent=context.explanation || 'Market expenditure estimates describe category demand, not actual store sales. PIN population is not pedestrian footfall.';
      section.append(explanation); target.append(section);
      const evidence=q('[data-evidence]'); evidence.replaceChildren();
      const spend=context.spend || context.spending || {};
      if(spend.rural || spend.urban){const h=doc.createElement('h3');h.textContent='Regional spend benchmarks';evidence.append(h);for(const type of ['rural','urban']) if(spend[type]){const line=doc.createElement('p');const val=metricValue(spend[type]);line.textContent=`${type[0].toUpperCase()+type.slice(1)}: ${fmt(val,spend[type].unit || '₹/person/month')} · ${spend[type].evidenceClass || 'evidence class unavailable'} · ${spend[type].referenceYear || 'year unavailable'}`;evidence.append(line);}}
      if(spend.incomeAdjustment){const line=doc.createElement('p');line.textContent=`Income-adjusted spend: ${spend.incomeAdjustment.formula || spend.incomeAdjustment.method || 'Adjustment method not supplied'} · ${spend.incomeAdjustment.evidenceClass || 'evidence class unavailable'}${spend.incomeAdjustment.uncertainty ? ` · ${spend.incomeAdjustment.uncertainty}` : ''}`;evidence.append(line);}
      const footfall=context.footfall;
      const fh=doc.createElement('h3');fh.textContent='Footfall distinctions';evidence.append(fh);
      const distinctions=[['Catchment population',footfall?.catchmentPopulation],['Area visitor/activity indicator',footfall?.areaActivity],['Passing pedestrian footfall at site',footfall?.sitePassing],['Store entries',footfall?.storeEntries],['Purchasing customers',footfall?.purchasingCustomers]];
      for(const [label,value] of distinctions) if(value!==undefined){const p=doc.createElement('p');p.textContent=`${label}: ${fmt(metricValue(value),value?.unit||'')}${value?.evidenceClass?` · ${value.evidenceClass}`:''}`;evidence.append(p);}
      if(footfall?.status==='scenario' || footfall?.scenario){const p=doc.createElement('p');p.className='ts-scenario';p.textContent=`Modelled footfall scenarios: low ${fmt(metricValue(footfall.low),footfall.unit||'visits/month')} · base ${fmt(metricValue(footfall.base),footfall.unit||'visits/month')} · high ${fmt(metricValue(footfall.high),footfall.unit||'visits/month')}. These are scenarios, not observed counts.`;evidence.append(p);}
      const sources=list(context.evidence||selected?.evidence);const sh=doc.createElement('h3');sh.textContent='Sources and methods';evidence.append(sh);
      if(sources.length) for(const source of sources)evidence.append(evidenceLine(source)); else {const p=doc.createElement('p');p.textContent='No supporting source records were supplied.';evidence.append(p);}
      const assumptions=list(context.assumptions);if(assumptions.length){const ah=doc.createElement('h3');ah.textContent='Assumptions';evidence.append(ah);for(const item of assumptions){const p=doc.createElement('p');p.textContent=typeof item==='string'?item:item.description||item.label||'Assumption supplied';evidence.append(p);}}
    }
    function applicantsForPin() {
      const pin=selected?.pin || selected?.id?.match(/\b\d{6}\b/)?.[0];
      const scoped=pin?records.filter(a=>String(a.pin ?? a.postalCode ?? a.location?.pin ?? '')===String(pin)):records;
      const sorted=sortApplicants(scoped,tieBreakFields);
      if(filter==='actionable'){
        const store=market?.existingStore ?? market?.storePresence ?? selected?.existingStore;
        const occupied=typeof store==='boolean'?store:!!(store?.present ?? store?.exists ?? store?.occupied);
        if(occupied)return [];
        return sorted.filter(a=>!list(a.blockingConditions || a.blockers).length && !['Clarification needed','Location unavailable','Requirements not met','Policy needed','Territory review','Waitlisted','Rejected'].includes(a.status));
      }
      return sorted;
    }
    function fundingText(applicant) {
      const requirement=market?.investment || market?.investmentRange;
      const target=numeric(requirement?.recommended)?requirement.recommended:numeric(requirement?.minimum)?requirement.minimum:null;
      const supplied=[applicant.declaredInvestment,applicant.verifiedFunds,applicant.availableFunds,applicant.conditionalLoan].filter(numeric);
      if(target===null || !supplied.length)return 'Funding compatibility unavailable · no comparable supplied figures';
      const secured=Math.max(numeric(applicant.verifiedFunds)?applicant.verifiedFunds:0,numeric(applicant.availableFunds)?applicant.availableFunds:0);
      const declared=numeric(applicant.declaredInvestment)?applicant.declaredInvestment:0;
      const conditional=numeric(applicant.conditionalLoan)?applicant.conditionalLoan:0;
      const basis=secured+conditional;
      const hasVerified=numeric(applicant.verifiedFunds)||numeric(applicant.availableFunds), hasLoan=numeric(applicant.conditionalLoan);
      const gap=hasVerified&&hasLoan?Math.max(0,target-basis):null;
      const declaredFit=numeric(applicant.declaredInvestment)?(declared>=target?'declared capacity is above the supplied recommended investment':'declared capacity is below the supplied recommended investment'):'declared capacity comparison unavailable';
      return `Market reference ${fmt(target,'₹')} · declared capacity ${numeric(applicant.declaredInvestment)?fmt(declared,'₹'):'unavailable'} · verified funds ${hasVerified?fmt(secured,'₹'):'unavailable'} · conditional loan ${hasLoan?fmt(conditional,'₹'):'unavailable'} · estimated funding gap ${gap===null?'unavailable':fmt(gap,'₹')} · ${declaredFit}; verify funds and loan conditions`;
    }
    function renderApplicants() {
      const target=q('[data-applicants]'), rows=applicantsForPin(); target.replaceChildren();
      if(!selected){const empty=doc.createElement('p');empty.className='ts-empty';empty.textContent='Select a PIN code to view its applicants.';target.append(empty);return;}
      if(!rows.length){const store=market?.existingStore ?? market?.storePresence ?? selected?.existingStore;const occupied=typeof store==='boolean'?store:!!(store?.present ?? store?.exists ?? store?.occupied);const empty=doc.createElement('p');empty.className='ts-empty';empty.textContent=filter==='actionable'&&occupied?'An existing franchise store is reported for this PIN; no new applicant is actionable for allocation.':filter==='actionable'?'No applicants meet the supplied actionable filter.':'No applicants were supplied for this territory.';target.append(empty);return;}
      rows.forEach((a,index)=>{
        const row=doc.createElement('article');row.className='ts-applicant';row.dataset.applicantId=idOf(a);
        const head=doc.createElement('div');head.className='ts-applicant-main';const rank=doc.createElement('span');rank.className='ts-rank';rank.textContent=`${index+1}`;
        const identity=doc.createElement('div');identity.className='ts-identity';const name=doc.createElement('h3');name.textContent=a.name||idOf(a)||'Applicant';const meta=doc.createElement('p');meta.textContent=`Application ${idOf(a)||'ID unavailable'} · ${a.verificationStatus || a.verification?.status || 'Verification status unavailable'}`;identity.append(name,meta);
        const score=doc.createElement('div');score.className='ts-score';const confirmed=confirmedScore(a);const scoreLabel=doc.createElement('strong');scoreLabel.textContent=scoreRange(a);const scoreKind=doc.createElement('small');scoreKind.textContent=confirmed===undefined?'No confirmed eligibility score':'Confirmed eligibility';score.append(scoreLabel,scoreKind);head.append(rank,identity,score);row.append(head);
        const status=doc.createElement('div');status.className='ts-applicant-meta';for(const [label,value] of [['Screening status',a.status||'Unavailable'],['Territory allocation',a.allocationStatus||a.territoryAllocationStatus||'Unavailable'],['Funding fit',fundingText(a)]]){const item=doc.createElement('p');const b=doc.createElement('b');b.textContent=`${label}: `;item.append(b,doc.createTextNode(value));status.append(item);}row.append(status);
        const blockers=list(a.blockingConditions||a.blockers);if(blockers.length){const ul=doc.createElement('ul');ul.className='ts-blockers';for(const blocker of blockers){const li=doc.createElement('li');li.textContent=typeof blocker==='string'?blocker:blocker.description||blocker.label||'Verification required';ul.append(li);}row.append(ul);}
        const action=doc.createElement('p');action.className='ts-next-action';action.textContent=`Next action: ${a.nextAction||a.nextActionLabel|| (blockers.length?String(blockers[0]):'Continue verification and site review')}`;row.append(action);
        const open=doc.createElement('button');open.type='button';open.className='ts-open';open.dataset.openApplicant=idOf(a);open.textContent='Open detailed assessment ↗';open.addEventListener('click',()=>onOpenApplicant(a,{location:selected,marketContext:market}));row.append(open);
        const caution=doc.createElement('small');caution.className='ts-caution';caution.textContent='This ranking is not an approval; recommended status is not final approval.';row.append(caution);target.append(row);
      });
    }
    function updateLocation(value, notify=false) { const previousPin=selected?.pin || selected?.id?.match(/\b\d{6}\b/)?.[0]; selected=value||null; const pin=selected?.pin || selected?.id?.match(/\b\d{6}\b/)?.[0] || ''; if(previousPin!==pin)market=selected?.marketContext || null; q('[data-location]').textContent=locationLabel(selected); q('[name="pin"]').value=pin; renderMarket();renderApplicants();if(notify)onLocationChange(selected); }
    q('[data-pin-form]').addEventListener('submit',event=>{event.preventDefault();const pin=q('[name="pin"]').value.trim();if(!/^\d{6}$/.test(pin)){q('[data-pin-message]').textContent='Enter a valid six-digit PIN code.';return;}q('[data-pin-message]').textContent='PIN selected. Geographic and market evidence will appear only when supplied.';const detail={id:`pin:${pin}`,name:pin,level:'pin',pin};updateLocation(detail,true);win?.dispatchEvent(new win.CustomEvent('franchiseos:location-selected',{detail}));});
    q('[data-cascade-state]').addEventListener('change',()=>{const state=q('[data-cascade-state]').value;const cities=[...new Set(workspaceTerritories.filter(row=>row.state===state).map(row=>row.city).filter(Boolean))].sort((a,b)=>a.localeCompare(b));fillSelect(q('[data-cascade-city]'),'Select city',cities);fillSelect(q('[data-cascade-pin]'),'Select PIN',[]);q('[data-cascade-city]').disabled=!cities.length;q('[data-cascade-pin]').disabled=true;});
    q('[data-cascade-city]').addEventListener('change',()=>{const state=q('[data-cascade-state]').value,city=q('[data-cascade-city]').value;const pins=[...new Set(workspaceTerritories.filter(row=>row.state===state&&row.city===city).flatMap(row=>list(row.pins).map(String)).filter(pin=>/^\d{6}$/.test(pin)))].sort();fillSelect(q('[data-cascade-pin]'),'Select PIN',pins);q('[data-cascade-pin]').disabled=!pins.length;});
    q('[data-cascade-pin]').addEventListener('change',()=>{const pin=q('[data-cascade-pin]').value;if(!pin)return;const state=q('[data-cascade-state]').value,city=q('[data-cascade-city]').value;const detail={id:`pin:${pin}`,name:pin,level:'pin',pin,state,city,sourceVersion:'workspace-territories',confidence:'user supplied territory list',evidence:[]};q('[name="pin"]').value=pin;q('[data-pin-message]').textContent='Selected from the uploaded workspace territory list. Economic coverage remains separate.';updateLocation(detail,true);win?.dispatchEvent(new win.CustomEvent('franchiseos:location-selected',{detail}));});
    shell.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{filter=button.dataset.filter; shell.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));onFilterChange(filter);renderApplicants();}));
    const sharedLocation=event=>{const detail=event.detail;if(detail && typeof detail==='object')updateLocation(detail);};
    win?.addEventListener('franchiseos:location-selected',sharedLocation);
    updateLocation(location);renderMarket();renderApplicants();
    return { updateLocation(value){updateLocation(value);}, updateMarketContext(value){market=value||null;renderMarket();renderApplicants();}, updateApplicants(value){records=list(value);renderApplicants();}, setFilter(value){if(!['all','actionable'].includes(value))throw new Error('Unknown applicant filter');filter=value;shell.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===filter)));onFilterChange(filter);renderApplicants();}, getLocation(){return selected;}, destroy(){win?.removeEventListener('franchiseos:location-selected',sharedLocation);shell.remove();} };
  }
  return {mount,sortApplicants};
});
