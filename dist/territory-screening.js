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
  const fmt = (value, unit = '', display = null) => {
    if (!numeric(value)) return 'Unavailable';
    if (/^(?:INR|₹)/i.test(String(unit)) && display?.money) return display.money(value, unit);
    const amount=value.toLocaleString('en-IN',{maximumFractionDigits:2});
    return unit.startsWith('₹') ? `₹${amount}${unit.slice(1)}` : `${amount}${unit ? ` ${unit}` : ''}`;
  };
  const metricValue = value => numeric(value) ? value : value && value.status !== 'unavailable' && numeric(value.value) ? value.value : null;
  const money = (value, display) => numeric(value) ? display?.money?.(value, 'INR') || `₹${value.toLocaleString('en-IN',{maximumFractionDigits:0})}` : 'Not estimable';
  function renderScenarioResult(result, context, doc, values = {}) {
    const display=doc.defaultView?.FranchiseDisplay;
    const forecast=result?.economics, summary=forecast?.economics||forecast, scenarios=forecast?.scenarios||summary?.scenarios;
    if (!scenarios) return '<p class="ts-scenario-empty">Run the illustrative calculator to see five-year financial scenarios. Local investment and return evidence is not available for this PIN.</p>';
    const economics={...summary,scenarios};
    const names=[['conservative','Conservative'],['base','Base'],['optimistic','Optimistic']];
    const scenario=name=>economics.scenarios[name]||{};
    const yearRows=name=>scenario(name).months?.filter(row=>row.month<=12)||[];
    const yearOneCashFlow=name=>yearRows(name).reduce((sum,row)=>sum+(numeric(row.operatingCashFlow)?row.operatingCashFlow:0),0);
    const annualRevenue=name=>scenario(name).years?.[0]?.nominalRevenue;
    const yearOneOperatingCosts=name=>{const rows=yearRows(name);return numeric(values.monthlyFixedCosts)&&rows.length===12&&rows.every(row=>numeric(row.revenue)&&numeric(row.grossProfit)&&numeric(row.royalty))?rows.reduce((sum,row)=>sum+row.revenue-row.grossProfit+row.royalty+values.monthlyFixedCosts,0):null;};
    const pct=value=>numeric(value)?`${value.toFixed(1)}%`:'Not estimable';
    const rows=[
      ['User-entered budget range',`${money(values.budgetMin,display)} – ${money(values.initialInvestment,display)} – ${money(values.budgetMax,display)}`,'Low · modelled investment · high'],
      ['Projected sales · year 1',...names.map(([key])=>money(annualRevenue(key),display))],
      ['Operating costs · year 1',...names.map(([key])=>money(yearOneOperatingCosts(key),display))],
      ['Operating cash flow · year 1',...names.map(([key])=>money(yearOneCashFlow(key),display))],
      ['Break-even sales · monthly',...names.map(()=>money(economics.breakEvenRevenueMonthly,display))],
      ['Break-even transactions · monthly',...names.map(()=>numeric(economics.breakEvenTransactionsMonthly)?Math.ceil(economics.breakEvenTransactionsMonthly).toLocaleString('en-IN'):'Not estimable')],
      ['Five-year ROI',...names.map(([key])=>pct(scenario(key).roiPercent))],
      ['Payback period',...names.map(([key])=>numeric(scenario(key).paybackMonths)?`${scenario(key).paybackMonths} months`:'Not reached in forecast')],
      ['Five-year NPV',...names.map(([key])=>money(scenario(key).npv,display))],
      ['Annualized IRR',...names.map(([key])=>pct(scenario(key).irrAnnual))]
    ];
    const table=`<div class="ts-financial-table-wrap"><table class="ts-financial-table"><thead><tr><th>Measure</th>${names.map(([,label])=>`<th>${label}</th>`).join('')}</tr></thead><tbody>${rows.map((row,index)=>`<tr><th>${esc(row[0])}</th>${index===0?`<td colspan="3">${esc(row[1])} <small>(${esc(row[2])})</small></td>`:row.slice(1).map(value=>`<td>${esc(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    const footfall=forecast?.footfall?.passingPedestrianTraffic||result?.footfall?.passingPedestrianTraffic;
    const note=`<p class="ts-financial-footnote">Model ${esc(result.modelVersion||'version not supplied')}. Sales use the store-traffic method only. ${numeric(footfall?.value)?`The forecast assumes ${esc(footfall.value.toLocaleString('en-IN'))} passing pedestrians/month; this is a scenario input, not observed footfall.`:'Passing-footfall scenario unavailable.'} ${context?.metrics?.tam?.value==null?'No supported PIN TAM was supplied, so the forecast is not reconciled to local market demand.':'Market TAM is shown separately and is not added to store sales.'} Cash flow excludes taxes, debt service, depreciation, lease accounting and terminal value.</p>`;
    return table+note;
  }
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
  function mount({root, location = null, marketContext = null, applicants = [], territories = [], onOpenApplicant = () => {}, onLocationChange = () => {}, onFilterChange = () => {}, onRunScenario = async () => { throw new Error('Forecast API is not connected'); }, tieBreakFields = [], storeAnalysis = null} = {}) {
    if (!root) throw new Error('Territory Screening root is required');
    const doc = root.ownerDocument, win = doc.defaultView;
    let selected = location, market = marketContext, records = list(applicants), workspaceTerritories=list(territories), filter = 'all', scenarioResult = null, scenarioBusy = false;
    const shell = doc.createElement('section'); shell.className = 'territory-screening'; shell.setAttribute('aria-label','Simulator');
    shell.innerHTML = `<header class="ts-heading"><div><p class="ts-eyebrow">SIMULATOR</p><h1>One territory. A clear next step.</h1><p>Review supported market evidence and compare applicants for the selected postal area.</p></div><span class="ts-separation">Eligibility is not franchise approval</span></header>
      <form class="ts-pin-form" data-pin-form><label for="ts-pin">Six-digit PIN code</label><div class="ts-pin-controls"><input id="ts-pin" name="pin" inputmode="numeric" autocomplete="postal-code" maxlength="6" pattern="[0-9]{6}" placeholder="Enter PIN code" aria-describedby="ts-pin-message"><button type="submit">View territory</button></div><p class="ts-message" id="ts-pin-message" data-pin-message aria-live="polite"></p></form>
      <details class="ts-cascade"><summary>Browse uploaded territories · State → City → PIN</summary><div class="ts-cascade-grid"><label>State<select data-cascade-state><option value="">Select state</option></select></label><label>City<select data-cascade-city disabled><option value="">Select city</option></select></label><label>PIN code<select data-cascade-pin disabled><option value="">Select PIN</option></select></label></div><p class="ts-message">Options come from the workspace territory list. This identifies an uploaded territory; it does not supply population or economic data.</p></details>
      <div class="ts-location" data-location aria-live="polite"></div><div class="ts-market" data-market></div>
      <section class="ts-financial panel" aria-labelledby="ts-financial-title"><div class="ts-financial-head"><div><p class="ts-eyebrow">ILLUSTRATIVE STORE ECONOMICS</p><h2 id="ts-financial-title">Model an investment and return</h2><p>Editable demo assumptions only. They are not observed PIN footfall, brand quotes, local rent or a validated comparable-store benchmark.</p></div><span class="ts-assumption-badge">Scenario · not a recommendation</span></div>
      <form data-financial-scenario><div class="ts-financial-grid">
      <label>Low budget · ₹<input name="budgetMin" type="number" min="0" step="10000" value="800000"></label><label>Modelled investment · ₹<input name="initialInvestment" type="number" min="0" step="10000" value="1000000"></label><label>High budget · ₹<input name="budgetMax" type="number" min="0" step="10000" value="1200000"></label>
      <label>Working capital · ₹<input name="workingCapital" type="number" min="0" step="10000" value="200000"></label><label>Store area · sq ft<input name="areaSqFt" type="number" min="1" step="1" value="400"></label><label>Monthly fixed operating costs · ₹<input name="monthlyFixedCosts" type="number" min="0" step="10000" value="150000"></label>
      <label>Gross margin · %<input name="grossMargin" type="number" min="0" max="100" step="1" value="50"></label><label>Royalty · %<input name="royaltyRate" type="number" min="0" max="100" step="0.5" value="5"></label><label>Average order value · ₹<input name="aov" type="number" min="50" step="50" value="1500"></label>
      <label>Purchase conversion · %<input name="conversionRate" type="number" min="0" max="100" step="0.5" value="12"></label><label>Passing pedestrians / month<input name="monthlyPassingPedestrianTraffic" type="number" min="0" step="1000" value="30000"></label><label>Store entry rate · %<input name="entryRate" type="number" min="0" max="100" step="1" value="20"></label>
      <label>Sales ramp · months<input name="salesRampMonths" type="number" min="1" max="60" step="1" value="6"></label><label>Initial ramp · % of steady sales<input name="initialRampFraction" type="number" min="0" max="100" step="1" value="50"></label><label>Annual nominal sales growth · %<input name="annualNominalGrowth" type="number" min="-99" step="1" value="5"></label>
      <label>Annual inflation · %<input name="annualInflation" type="number" min="-99" step="1" value="4"></label><label>Discount rate · %<input name="discountRate" type="number" min="-99" step="1" value="12"></label>
      <div class="ts-financial-cell-note" role="note">Every input here is an editable scenario, not an observed value.</div>
      </div><p class="ts-scenario-warning">Passing footfall is an editable scenario input, not a measurement. This deterministic five-year model excludes taxes, debt service, depreciation, lease accounting and terminal value.</p><button class="ts-run" type="submit" ${scenarioBusy?'disabled':''}>${scenarioBusy?'Calculating…':'Calculate conservative / base / optimistic'}</button><span data-scenario-message role="status" aria-live="polite"></span></form><div data-financial-results>${renderScenarioResult(scenarioResult, market, doc)}</div></section>
      <details class="ts-details"><summary>Spend and footfall evidence</summary><div data-evidence></div></details>
      <section class="ts-applicants"><div class="ts-applicants-heading"><div><p class="ts-eyebrow">PARTNER PIPELINE</p><h2>Applicants for this territory</h2><p class="ts-subtitle">Rank is a screening order only. Confirmed funds, premises and due diligence remain separate checks.</p></div><div class="ts-filters" role="group" aria-label="Applicant filter"><button type="button" data-filter="all" aria-pressed="true">All Ranked</button><button type="button" data-filter="actionable" aria-pressed="false">Actionable</button></div></div><div class="ts-applicant-list" data-applicants></div></section>`;
    root.replaceChildren(shell);
    const q = selector => shell.querySelector(selector);
    // With storeAnalysis (the Expansion Intelligence Analysis panel), the Simulator uses the same store model as the
    // map instead of the illustrative calculator, and reloads it for each PIN.
    let analysis = null;
    if (typeof storeAnalysis === 'function') {
      q('.ts-financial').innerHTML = '<div class="ts-financial-head"><div><p class="ts-eyebrow">STORE ECONOMICS</p><h2 id="ts-financial-title">One store at this PIN</h2><p>The same model as Expansion Intelligence: the brand’s 400 sq ft format, the 3 km catchment and city-tier costs. Use Edit assumptions to simulate changes.</p></div></div><div data-store-analysis><p class="ts-scenario-empty">Select a PIN code to see store costs, sales, break-even and payback.</p></div>';
      analysis = storeAnalysis(q('[data-store-analysis]'));
    }
    const loadAnalysis = () => { const pin = selected?.pin || selected?.id?.match(/\b\d{6}\b/)?.[0]; if (analysis && pin) analysis.load(`pin:${pin}`); };
    function renderFinancial(){if(!q('[data-financial-results]'))return;const form=q('[data-financial-scenario]');const values=form?Object.fromEntries(['budgetMin','initialInvestment','budgetMax','monthlyFixedCosts'].map(name=>[name,Number(form.elements[name].value)])):{};q('[data-financial-results]').innerHTML=renderScenarioResult(scenarioResult,market,doc,values);}
    q('[data-financial-scenario]')?.addEventListener('submit',async event=>{
      event.preventDefault();if(scenarioBusy)return;
      const form=event.currentTarget, number=name=>{const value=form.elements[name]?.value;return value===''||value===undefined?NaN:Number(value);};
      const names=['budgetMin','initialInvestment','budgetMax','workingCapital','areaSqFt','monthlyFixedCosts','grossMargin','royaltyRate','aov','conversionRate','monthlyPassingPedestrianTraffic','entryRate','salesRampMonths','initialRampFraction','annualNominalGrowth','annualInflation','discountRate'];
      const values=Object.fromEntries(names.map(name=>[name,number(name)]));
      const message=q('[data-scenario-message]');
      if(names.some(name=>!Number.isFinite(values[name]))||values.budgetMin>values.initialInvestment||values.initialInvestment>values.budgetMax||values.grossMargin>100||values.royaltyRate>100||values.conversionRate>100||values.entryRate>100||values.initialRampFraction>100){message.textContent='Check required values, percentages (0–100), and ensure low budget ≤ modelled investment ≤ high budget.';return;}
      const store={initialInvestment:values.initialInvestment,workingCapital:values.workingCapital,areaSqFt:values.areaSqFt,monthlyFixedCosts:values.monthlyFixedCosts,grossMargin:values.grossMargin/100,royaltyRate:values.royaltyRate/100,aov:values.aov,conversionRate:values.conversionRate/100,monthlyPassingPedestrianTraffic:values.monthlyPassingPedestrianTraffic,entryRate:values.entryRate/100,salesRampMonths:values.salesRampMonths,initialRampFraction:values.initialRampFraction/100,trafficEvidenceClass:'model_assumption'};
      const payload={store,market:{samAnnual:metricValue((market?.metrics||{}).sam)},forecast:{years:5,annualNominalGrowth:values.annualNominalGrowth/100,annualInflation:values.annualInflation/100,discountRate:values.discountRate/100},scenarioFactors:{conservative:0.75,base:1,optimistic:1.25}};
      scenarioBusy=true;q('.ts-run').disabled=true;q('.ts-run').textContent='Calculating…';message.textContent='Running the deterministic five-year forecast…';
      try{scenarioResult=await onRunScenario(payload);const rendered=renderScenarioResult(scenarioResult,market,doc,values);if(!rendered.includes('ts-financial-table'))throw new Error('Forecast API response did not include renderable scenario results');q('[data-financial-results]').innerHTML=rendered;message.textContent='Scenario recalculated. Inputs remain editable and are not saved to applicant records.';}
      catch(error){message.textContent=`Forecast unavailable: ${error?.message||'request failed'}`;}
      finally{scenarioBusy=false;q('[data-financial-scenario] .ts-run').disabled=false;q('[data-financial-scenario] .ts-run').textContent='Calculate conservative / base / optimistic';}
    });
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
      const h=doc.createElement('span'); h.textContent=conf[0]; const tipKey={population:'residents',tam:'tam',apparelExpenditure:'tam',monthlyPerCapitaSpend:'spend'}[key]; if(tipKey){h.dataset.tipKey=tipKey;h.tabIndex=0;} const strong=doc.createElement('strong'); strong.textContent=fmt(val,raw?.unit || conf[1],doc.defaultView?.FranchiseDisplay);
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
      // Only derived figures are shown; a metric with no value at this geography is left out, and TAM appears once.
      const shown=order.filter(key=>metricValue(metrics[key])!==null&&!(key==='apparelExpenditure'&&metricValue(metrics.tam)!==null));
      for(const key of shown) cards.append(metricCard(key,metrics[key]));
      if(metricValue(metrics.population)===null){const empty=doc.createElement('p');empty.className='ts-empty';empty.textContent='PIN-level population is unavailable. No substitute city or regional population has been applied.';section.append(empty);}
      section.append(cards);
      const explanation=doc.createElement('p'); explanation.className='ts-explanation';
      explanation.textContent=context.explanation || 'Market expenditure estimates describe category demand, not actual store sales. PIN population is not pedestrian footfall.';
      section.append(explanation); target.append(section);
      const evidence=q('[data-evidence]'); evidence.replaceChildren();
      const spend=context.spend || context.spending || {};
      if(spend.rural || spend.urban){const h=doc.createElement('h3');h.textContent='Regional spend benchmarks';evidence.append(h);for(const type of ['rural','urban']) if(spend[type]){const line=doc.createElement('p');const val=metricValue(spend[type]);line.textContent=`${type[0].toUpperCase()+type.slice(1)}: ${fmt(val,spend[type].unit || '₹/person/month',doc.defaultView?.FranchiseDisplay)} · ${spend[type].evidenceClass || 'evidence class unavailable'} · ${spend[type].referenceYear || 'year unavailable'}`;evidence.append(line);}}
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
    // Declared funds against the brand's investment requirement. Funds are as declared; they are not verified.
    function fundingText(applicant) {
      const display=doc.defaultView?.FranchiseDisplay, declared=applicant.declaredInvestment, required=applicant.requiredInvestment;
      if(!numeric(declared))return 'Not stated on the application';
      if(!numeric(required))return `${fmt(declared,'₹',display)} declared`;
      return `${fmt(declared,'₹',display)} declared · the brand needs ${fmt(required,'₹',display)}${declared>=required?' · enough':' · short by '+fmt(required-declared,'₹',display)}`;
    }
    function renderApplicants() {
      const target=q('[data-applicants]'), rows=applicantsForPin(); target.replaceChildren();
      if(!selected){const empty=doc.createElement('p');empty.className='ts-empty';empty.textContent='Select a PIN code to view its applicants.';target.append(empty);return;}
      if(!rows.length){const store=market?.existingStore ?? market?.storePresence ?? selected?.existingStore;const occupied=typeof store==='boolean'?store:!!(store?.present ?? store?.exists ?? store?.occupied);const empty=doc.createElement('p');empty.className='ts-empty';empty.textContent=filter==='actionable'&&occupied?'An existing franchise store is reported for this PIN; no new applicant is actionable for allocation.':filter==='actionable'?'No applicants meet the supplied actionable filter.':'No applicants were supplied for this territory.';target.append(empty);return;}
      rows.forEach((a,index)=>{
        const row=doc.createElement('article');row.className='ts-applicant';row.dataset.applicantId=idOf(a);
        const head=doc.createElement('div');head.className='ts-applicant-main';const rank=doc.createElement('span');rank.className='ts-rank';rank.textContent=`${index+1}`;
        const identity=doc.createElement('div');identity.className='ts-identity';const name=doc.createElement('h3');name.textContent=a.name||idOf(a)||'Applicant';const meta=doc.createElement('p');meta.textContent=`Application ${idOf(a)||'ID unavailable'}${a.city?` · ${a.city}`:''}`;identity.append(name,meta);
        const score=doc.createElement('div');score.className='ts-score';const confirmed=confirmedScore(a);const scoreLabel=doc.createElement('strong');scoreLabel.textContent=scoreRange(a);const scoreKind=doc.createElement('small');scoreKind.textContent=confirmed===undefined?'No fit score yet':'Fit score';scoreKind.dataset.tipKey='score';scoreKind.tabIndex=0;score.append(scoreLabel,scoreKind);head.append(rank,identity,score);row.append(head);
        const status=doc.createElement('div');status.className='ts-applicant-meta';for(const [label,value] of [['Category',a.category?`${a.category}${a.status&&a.status!==a.category?` (${a.status})`:''}`:a.status||'Not screened'],['Territory',a.territory||'Not in a territory the brand is expanding into'],['Funding',fundingText(a)]]){const item=doc.createElement('p');const b=doc.createElement('b');b.textContent=`${label}: `;item.append(b,doc.createTextNode(value));status.append(item);}row.append(status);
        const blockers=list(a.blockingConditions||a.blockers);if(blockers.length){const ul=doc.createElement('ul');ul.className='ts-blockers';for(const blocker of blockers){const li=doc.createElement('li');li.textContent=typeof blocker==='string'?blocker:blocker.description||blocker.label||'Verification required';ul.append(li);}row.append(ul);}
        const action=doc.createElement('p');action.className='ts-next-action';action.textContent=`Next action: ${a.nextAction||a.nextActionLabel|| (blockers.length?String(blockers[0]):'Review the application')}`;row.append(action);
        const open=doc.createElement('button');open.type='button';open.className='ts-open';open.dataset.openApplicant=idOf(a);open.textContent='Open detailed assessment ↗';open.addEventListener('click',()=>onOpenApplicant(a,{location:selected,marketContext:market}));row.append(open);
        const caution=doc.createElement('small');caution.className='ts-caution';caution.textContent='This ranking is not an approval; recommended status is not final approval.';row.append(caution);target.append(row);
      });
    }
    function updateLocation(value, notify=false) { const previousPin=selected?.pin || selected?.id?.match(/\b\d{6}\b/)?.[0]; selected=value||null; const pin=selected?.pin || selected?.id?.match(/\b\d{6}\b/)?.[0] || ''; if(previousPin!==pin){market=selected?.marketContext || null;scenarioResult=null;} q('[data-location]').textContent=locationLabel(selected); q('[name="pin"]').value=pin; renderMarket();renderApplicants();renderFinancial();if(previousPin!==pin)loadAnalysis();if(notify)onLocationChange(selected); }
    q('[data-pin-form]').addEventListener('submit',event=>{event.preventDefault();const pin=q('[name="pin"]').value.trim();if(!/^\d{6}$/.test(pin)){q('[data-pin-message]').textContent='Enter a valid six-digit PIN code.';return;}q('[data-pin-message]').textContent='PIN selected. Geographic and market evidence will appear only when supplied.';const detail={id:`pin:${pin}`,name:pin,level:'pin',pin};updateLocation(detail,true);win?.dispatchEvent(new win.CustomEvent('franchiseos:location-selected',{detail}));});
    q('[data-cascade-state]').addEventListener('change',()=>{const state=q('[data-cascade-state]').value;const cities=[...new Set(workspaceTerritories.filter(row=>row.state===state).map(row=>row.city).filter(Boolean))].sort((a,b)=>a.localeCompare(b));fillSelect(q('[data-cascade-city]'),'Select city',cities);fillSelect(q('[data-cascade-pin]'),'Select PIN',[]);q('[data-cascade-city]').disabled=!cities.length;q('[data-cascade-pin]').disabled=true;});
    q('[data-cascade-city]').addEventListener('change',()=>{const state=q('[data-cascade-state]').value,city=q('[data-cascade-city]').value;const pins=[...new Set(workspaceTerritories.filter(row=>row.state===state&&row.city===city).flatMap(row=>list(row.pins).map(String)).filter(pin=>/^\d{6}$/.test(pin)))].sort();fillSelect(q('[data-cascade-pin]'),'Select PIN',pins);q('[data-cascade-pin]').disabled=!pins.length;});
    q('[data-cascade-pin]').addEventListener('change',()=>{const pin=q('[data-cascade-pin]').value;if(!pin)return;const state=q('[data-cascade-state]').value,city=q('[data-cascade-city]').value;const detail={id:`pin:${pin}`,name:pin,level:'pin',pin,state,city,sourceVersion:'workspace-territories',confidence:'user supplied territory list',evidence:[]};q('[name="pin"]').value=pin;q('[data-pin-message]').textContent='Selected from the uploaded workspace territory list. Economic coverage remains separate.';updateLocation(detail,true);win?.dispatchEvent(new win.CustomEvent('franchiseos:location-selected',{detail}));});
    shell.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{filter=button.dataset.filter; shell.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));onFilterChange(filter);renderApplicants();}));
    const sharedLocation=event=>{const detail=event.detail;if(detail && typeof detail==='object')updateLocation(detail);};
    win?.addEventListener('franchiseos:location-selected',sharedLocation);
    updateLocation(location);renderMarket();renderApplicants();loadAnalysis();
    return { updateLocation(value){updateLocation(value);}, updateMarketContext(value){market=value||null;renderMarket();renderApplicants();renderFinancial();}, updateApplicants(value){records=list(value);renderApplicants();}, refreshDisplay(){renderMarket();renderFinancial();}, setFilter(value){if(!['all','actionable'].includes(value))throw new Error('Unknown applicant filter');filter=value;shell.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===filter)));onFilterChange(filter);renderApplicants();}, getLocation(){return selected;}, destroy(){win?.removeEventListener('franchiseos:location-selected',sharedLocation);analysis?.destroy?.();shell.remove();} };
  }
  return {mount,sortApplicants};
});
