(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MarketIntelligence = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const commercial = new Set(['fixedCosts','grossMargin','monthlyRevenue','investment','workingCapital','areaSqFt','aov','conversionRate']);
  const internal = new Set(['name','country','state','city','pin','catchment']);
  const money = (value, display = null) => Number.isFinite(Number(value)) && value !== null ? display?.money?.(Number(value),'INR') || '₹' + Number(value).toLocaleString('en-IN', { maximumFractionDigits:0 }) : 'Unavailable';
  const count = value => Number.isFinite(Number(value)) && value !== null ? Number(value).toLocaleString('en-IN') : 'Unavailable';
  const valueOf = metric => metric && metric.status !== 'unavailable' && Number.isFinite(Number(metric.value)) && metric.value !== null ? metric.value : null;
  const causeLabels = { source_unavailable:'Source unavailable', not_integrated:'Source not integrated', geography_mismatch:'Geography mismatch', missing_calculation_dependency:'Missing calculation dependency', api_database_failure:'API/database failure', user_input_required:'User input required' };
  const fallbackAction = { population:'Use a supported census geography or add a validated population crosswalk.', monthlyPerCapitaSpend:'Check for a compatible cited spending benchmark at this geography.', incomeProxy:'Add a compatible, cited local income source before applying an income adjustment.', tam:'Supply supported population and annual per-person spend inputs.', sam:'Resolve TAM evidence, then document category, audience, price and accessibility factors.', som:'Resolve SAM evidence, then enter an explicit capture assumption.', competitorCount:'Add verified competitor coverage or record a dated local store survey.', breakEvenRevenue:'Enter monthly fixed costs and a gross margin above royalties.', paybackMonths:'Enter investment, revenue, fixed costs and a valid contribution margin.' };
  const gapDescription = (key, item) => {
    if (!item || item.value !== null && item.value !== undefined) return null;
    const cause = item.missing?.cause || 'user_input_required';
    return `${causeLabels[cause] || 'Evidence gap'}: ${item.missing?.nextAction || fallbackAction[key] || 'Provide a supported source or required input, then recalculate.'}`;
  };
  const cleanUrl = url => { try { const parsed = new URL(url); return ['https:','http:'].includes(parsed.protocol) ? parsed.href : null; } catch { return null; } };
  const element = (doc, tag, className, text) => { const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const metricLine = (doc, label, metric, formatter = null) => {
    const row = element(doc, 'div', 'mi-metric');
    const amount=valueOf(metric),format=formatter|| (value=>money(value,doc.defaultView?.FranchiseDisplay));
    row.append(element(doc,'span','',label), element(doc,'strong','',format(amount)));
    if(metric?.unit)row.append(element(doc,'small','mi-unit',metric.unit));
    return row;
  };
  const uniqueEvidence = (location, snapshot, sources) => {
    const wanted = new Set((snapshot?.sourceVersions || []).map(item => item.sourceId));
    const rows = [...(location?.evidence || []), ...sources.filter(item => wanted.has(item.id))];
    const seen = new Set();
    return rows.filter(item => { const key = item.sourceId || item.id || item.url || item.sourceUrl || item.title; if (!key || seen.has(key)) return false; seen.add(key); return true; });
  };
  function describe(doc, target, {location, snapshot, result, sources}) {
    target.replaceChildren();
    const metrics = result?.metrics || snapshot?.results?.metrics || {};
    const geographic = location?.metrics || {};
    const display=doc.defaultView?.FranchiseDisplay, cash=value=>money(value,display);
    const name = location?.level==='pin' && (location?.city||location?.postalCity) ? `${location.city||location.postalCity} · PIN ${location.pin||location.name}` : location?.name || snapshot?.location?.city || snapshot?.location?.state || snapshot?.location?.pin || 'Selected location';
    const lead = element(doc,'div','mi-lead');
    lead.append(element(doc,'div','mi-kicker','MARKET SNAPSHOT'), element(doc,'h2','',name));
    const annual = valueOf(geographic.apparelExpenditure);
    const monthlyBenchmark = valueOf(geographic.monthlyPerCapitaSpend);
    lead.append(element(doc,'p','',annual === null && monthlyBenchmark !== null
      ? `${cash(monthlyBenchmark)} per person per month is available as a regional HCES benchmark. Total PIN expenditure is unestimated because this PIN has no defensible population crosswalk.`
      : annual === null ? 'No supported annual clothing and footwear market expenditure is available for this geography.' : `${cash(annual)} estimated annual clothing and footwear market expenditure. This is market expenditure, not store revenue.`));
    if (location?.postOffices?.length) {
      const postal=element(doc,'details','mi-postal');postal.append(element(doc,'summary','','Postal directory metadata'),element(doc,'p','mi-note',`${location.postalRegion||location.postalCity||location.city||'Postal region unavailable'} · ${location.postalDivision||'postal division unavailable'}. Post offices: ${location.postOffices.map(item=>`${item.name} (${item.delivery})`).join('; ')}. This directory does not define a PIN boundary or population.`));lead.append(postal);
    }
    target.append(lead);
    const grid = element(doc,'div','mi-snapshot-grid');
    const demand = element(doc,'article','mi-card'); demand.append(element(doc,'h3','','Demand and purchasing capacity'));
    demand.append(metricLine(doc,'Geographic population',geographic.population,count), metricLine(doc,'Monthly clothing & footwear spend/person',geographic.monthlyPerCapitaSpend,cash), metricLine(doc,'Annual market expenditure',geographic.apparelExpenditure,cash));
    if (location?.benchmarkComparison) {
      demand.append(metricLine(doc,'Karnataka rural HCES benchmark',location.benchmarkComparison.rural,cash));
      demand.append(metricLine(doc,'Karnataka urban HCES benchmark',location.benchmarkComparison.urban,cash));
      demand.append(element(doc,'p','mi-note','Regional state-sector survey benchmarks (2023–24), not PIN observations. PIN income, rural/urban population mix and total population are not available, so no PIN-level spend adjustment or TAM is calculated.'));
    }
    demand.append(metricLine(doc,'Store catchment TAM',metrics.tam,cash), metricLine(doc,'Serviceable market',metrics.sam,cash), metricLine(doc,'Capturable market',metrics.som,cash));
    const catchment = valueOf(metrics.tam);
    demand.append(element(doc,'p','mi-note',catchment === null ? 'Store catchment TAM needs a supported catchment population and comparable spending assumptions.' : 'TAM, SAM and SOM are deterministic model outputs from saved inputs.'));
    const competition = element(doc,'article','mi-card'); competition.append(element(doc,'h3','','Competition and audience'));
    const competitors = snapshot?.competitors || [];
    competition.append(element(doc,'p','',competitors.length ? `${competitors.length} user-entered competitor ${competitors.length === 1 ? 'listing' : 'listings'}. Store counts indicate supply, not sales or market share.` : 'Local competitor coverage and brand positioning have not been verified.'));
    competition.append(element(doc,'p','mi-note','Age profile, catchment purchasing power and consumer preferences remain unavailable unless separately evidenced.'));
    const feasibility = element(doc,'article','mi-card'); feasibility.append(element(doc,'h3','','Store economics'));
    const forecast = snapshot?.forecast;
    const base = forecast?.economics?.scenarios?.base;
    if (base) {
      feasibility.append(metricLine(doc,'Projected year-one revenue',{value:base.years?.[0]?.nominalRevenue,unit:'INR/year'},cash),metricLine(doc,'Break-even revenue / month',{value:forecast.economics?.breakEvenRevenueMonthly,unit:'INR/month'},cash));
      feasibility.append(element(doc,'p','mi-note',`${base.paybackMonths === null || base.paybackMonths === undefined ? 'Payback unavailable' : `${count(base.paybackMonths)} months payback`} · ${base.roiPercent === null || base.roiPercent === undefined ? 'ROI unavailable' : `${Number(base.roiPercent).toFixed(1)}% ROI`}. Revenue is a scenario projection, not observed sales.`));
    } else feasibility.append(metricLine(doc,'Break-even revenue / month',metrics.breakEvenRevenue),metricLine(doc,'Simple payback / months',metrics.paybackMonths,count));
    if (forecast?.viability?.score !== null && forecast?.viability?.score !== undefined && forecast.viability.status !== 'unscored') feasibility.append(element(doc,'p','mi-note',`Market viability ${forecast.viability.score}/100 · ${forecast.viability.status}. Provisional evidence-based weights.`));
    else feasibility.append(element(doc,'p','mi-note','Market viability dimensions are unscored until sufficient evidence and explicit assumptions are available.'));
    grid.append(demand,competition,feasibility); target.append(grid);
    const insights = element(doc,'div','mi-insights');
    const opportunity = element(doc,'article','mi-insight'); opportunity.append(element(doc,'h3','','Key opportunities'));
    opportunity.append(element(doc,'p','',valueOf(metrics.som) !== null ? `The saved assumptions yield ${cash(valueOf(metrics.som))} in capturable annual market expenditure; compare that with store operating costs.` : annual !== null ? `The geography has ${cash(annual)} in estimated annual category expenditure, providing a broad demand benchmark for catchment research.` : monthlyBenchmark !== null ? `A regional apparel benchmark of ${cash(monthlyBenchmark)} per person per month is available; the PIN market total remains unquantified until population and catchment evidence is supplied.` : 'No defensible local market expenditure estimate is available yet.'));
    const risk = element(doc,'article','mi-insight'); risk.append(element(doc,'h3','','Key risks'));
    risk.append(element(doc,'p','',valueOf(metrics.breakEvenRevenue) === null && forecast?.economics?.breakEvenRevenueMonthly == null ? 'Store costs and gross margin are missing, so break-even and payback cannot support an investment decision.' : !competitors.length ? 'Competitor coverage is missing; capture assumptions need local validation.' : 'Check whether the saved capture and conversion assumptions hold at the proposed site.'));
    insights.append(opportunity,risk); target.append(insights);
    const uniqueGaps = [...new Set([...Object.entries(geographic), ...Object.entries(metrics)].map(([key,item])=>gapDescription(key,item)).filter(Boolean))];
    const next = element(doc,'div','mi-next'); next.append(element(doc,'h3','','What to check next'));
    next.append(element(doc,'p','',uniqueGaps.length ? `${uniqueGaps.length} evidence gaps remain. Start with the highest-impact item below.` : 'Review comparable store sales and local access before making an investment decision.'));
    if (uniqueGaps.length) { const list=element(doc,'ul','mi-gap-actions'); for (const action of uniqueGaps.slice(0,4)) list.append(element(doc,'li','',action)); next.append(list); if(uniqueGaps.length>4){const details=element(doc,'details','mi-more-gaps');details.append(element(doc,'summary','',`Show ${uniqueGaps.length-4} more evidence gaps`));const rest=element(doc,'ul','mi-gap-actions');for(const action of uniqueGaps.slice(4))rest.append(element(doc,'li','',action));details.append(rest);next.append(details);} }
    target.append(next);
    const drawer = element(doc,'details','mi-evidence'); drawer.append(element(doc,'summary','','Evidence & Methodology'));
    const list = element(doc,'ul',''); list.dataset.miEvidence = '';
    const evidence = uniqueEvidence(location,snapshot,sources || []);
    for (const item of evidence) {
      const li = element(doc,'li',''); const url = cleanUrl(item.url || item.sourceUrl);
      const title = item.title || item.dataset || item.publisher || item.sourceId || item.id || 'Source';
      if (url) { const a = element(doc,'a','',title); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; li.append(a); }
      else li.append(element(doc,'span','',title));
      const context = [item.referenceYear || item.referencePeriod, item.evidenceClass, item.geography?.level].filter(Boolean).join(' · ');
      if (context) li.append(element(doc,'small','',` · ${context}`));
      list.append(li);
    }
    if (!evidence.length) list.append(element(doc,'li','','No linked source records for this selection.'));
    drawer.append(list,element(doc,'p','mi-note','Postal areas are not census catchments. Census population and HCES expenditure may have different reference years. User assumptions and modelled estimates are separate from official observations.'));
    target.append(drawer);
  }

  function mount({root, selectedLocation = null, snapshot = {}, result = null, analyzed = false, sources = [], benchmarks = [], assessments = [], busy = false, search, onSelect, onManual, research, loadApplicants, query = ''} = {}) {
    if (!root) throw Error('Market Intelligence root is required');
    const doc = root.ownerDocument, win = doc.defaultView;
    loadApplicants = loadApplicants || win.fetchMarketApplicants;
    const form = root.querySelector('#market-form');
    if (!form) throw Error('Market assessment form is required');
    const labels = [...form.querySelectorAll('label')].filter(label => label.querySelector('[name]'));
    const comparison = root.querySelector('#market-comparison')?.closest('.panel');
    const shell = element(doc,'div','mi-shell');
    const intro = element(doc,'div','mi-intro'); intro.append(element(doc,'p','mi-kicker','LOCATION INTELLIGENCE'),element(doc,'h1','','Market Intelligence'),element(doc,'p','','Start with a place. Add commercial assumptions only when you need a store forecast. Market assessment is separate from franchisee eligibility.'));
    const setup = element(doc,'section','mi-setup'); setup.append(element(doc,'h2','','Start an assessment'));
    const primary = element(doc,'div','mi-primary');
    const locationLabel = element(doc,'label','','Location');
    const locationInput = element(doc,'input','input'); locationInput.name = 'locationQuery'; locationInput.placeholder = 'Search state, city or six-digit PIN'; locationInput.autocomplete = 'off'; locationInput.required = true;
    locationLabel.append(locationInput);
    const suggestions = element(doc,'div','mi-suggestions'); suggestions.setAttribute('role','listbox'); locationLabel.append(suggestions);
    const categoryLabel = element(doc,'label','','Retail category / segment'); const category = element(doc,'select','input'); category.name = 'category';
    const apparel = element(doc,'option','','Apparel & fashion'); apparel.value = 'apparel'; category.append(apparel); category.value = snapshot.category || 'apparel'; categoryLabel.append(category);
    const formatLabel = element(doc,'label','','Brand / store format · optional'); const format = element(doc,'input','input'); format.name = 'storeFormat'; format.placeholder = 'e.g. value fashion'; format.value = snapshot.storeFormat || ''; formatLabel.append(format);
    primary.append(locationLabel,categoryLabel,formatLabel); setup.append(primary);
    const actions = element(doc,'div','mi-actions'); const submit = element(doc,'button','button primary',busy ? 'Analysing…' : 'Analyse Market'); submit.type = 'submit'; submit.disabled = busy; actions.append(submit);
    const newButton = element(doc,'button','button','New location'); newButton.type = 'button'; newButton.id = 'market-new'; actions.append(newButton); setup.append(actions);
    const preview = element(doc,'div','mi-location-context'); setup.append(preview);
    const hidden = element(doc,'div',''); hidden.hidden = true;
    const commercialDetails = element(doc,'details','mi-level'); commercialDetails.dataset.miCommercial = ''; commercialDetails.append(element(doc,'summary','','Level 2 · Commercial feasibility'));
    const commercialBody = element(doc,'div','mi-level-body'); commercialBody.append(element(doc,'p','mi-note','Add store costs and conversion assumptions to calculate break-even, payback and scenarios.'));
    const commercialGrid = element(doc,'div','mi-field-grid'); commercialBody.append(commercialGrid);
    const advancedDetails = element(doc,'details','mi-level'); advancedDetails.dataset.miAdvanced = ''; advancedDetails.append(element(doc,'summary','','Level 3 · Advanced modelling'));
    const advancedBody = element(doc,'div','mi-level-body'); advancedBody.append(element(doc,'p','mi-note','These are expert assumptions. Leave unsupported values empty; no market score is inferred from a blank field.'));
    const advancedGrid = element(doc,'div','mi-field-grid'); advancedBody.append(advancedGrid);
    for (const label of labels) {
      const name = label.querySelector('[name]').name;
      (internal.has(name) ? hidden : commercial.has(name) ? commercialGrid : advancedGrid).append(label);
    }
    const oldBenchmarkButtons = [...root.querySelectorAll('[data-market-benchmark]')];
    if (oldBenchmarkButtons.length) { const benchmarkBox = element(doc,'div','mi-benchmarks'); benchmarkBox.append(element(doc,'h3','','Available regional benchmarks')); for (const button of oldBenchmarkButtons) benchmarkBox.append(button); advancedBody.append(benchmarkBox); }
    else if (benchmarks.length) advancedBody.append(element(doc,'p','mi-note','Regional benchmarks are available; select one only when its geography and rural/urban sector match your catchment.'));
    const forecastButton = root.querySelector('#market-forecast'); if (forecastButton) commercialBody.append(forecastButton);
    const pinStatus = root.querySelector('#market-pin-status'); if (pinStatus) advancedBody.append(pinStatus);
    commercialDetails.append(commercialBody); advancedDetails.append(advancedBody);
    const results = element(doc,'section','mi-results'); results.dataset.miResults = ''; results.hidden = !analyzed;
    let researchPanel=null;
    if (analyzed) describe(doc,results,{location:selectedLocation,snapshot,result,sources});
    if (analyzed) {
      researchPanel = element(doc,'section','mi-research'); researchPanel.dataset.miResearch = '';
      researchPanel.append(element(doc,'h3','','Grounded market context'));
      const researchBody = element(doc,'div','mi-research-body','Research loads separately from the market calculation.'); researchPanel.append(researchBody);
      const refresh = element(doc,'button','button small','Refresh research'); refresh.type='button'; researchPanel.append(refresh);
      results.append(researchPanel);
      let researchRevision=0;
      async function loadResearch(force=false) {
        const location=selectedLocation, revision=++researchRevision;
        if (!location?.id || !research) { researchBody.textContent='Research requires a sourced geography and an available research service.'; refresh.hidden=true; return; }
        researchBody.textContent='Loading cited context…'; refresh.disabled=true;
        try {
          const response=await research(location,{refresh:force});
          if (revision!==researchRevision || !researchPanel.isConnected) return;
          researchBody.replaceChildren();
          const citations=new Map((response.citations||[]).map(item=>[item.url,item]));
          let shown=0;
          for (const card of response.cards||[]) {
            const supported=(card.evidenceUrls||[]).map(url=>({url:cleanUrl(url),citation:citations.get(url)})).filter(item=>item.url&&item.citation);
            if (!supported.length) continue;
            const article=element(doc,'article','mi-research-card'); article.append(element(doc,'h4','',card.headline||'Market context'),element(doc,'p','',card.insight||''));
            if(card.implication)article.append(element(doc,'p','mi-note',`Next step: ${card.implication}`));
            article.append(element(doc,'small','',`${card.confidence||'Evidence strength unavailable'} · ${card.referenceDate||response.retrievedAt||'Date unavailable'}`));
            const links=element(doc,'div','mi-research-links');
            for(const {url,citation} of supported){const link=element(doc,'a','',citation.title||url);link.href=url;link.target='_blank';link.rel='noopener noreferrer';links.append(link);}
            article.append(links);researchBody.append(article);shown++;
          }
          if(!shown)researchBody.textContent='No cited context cards were returned.';
        } catch(error) { if(revision===researchRevision&&researchPanel.isConnected) researchBody.textContent=`API/database failure: ${error.message||'service could not respond'}. Retry the research service; the market snapshot remains available.`; }
        finally { if(revision===researchRevision&&researchPanel.isConnected) refresh.disabled=false; }
      }
      refresh.addEventListener('click',()=>loadResearch(true));
      loadResearch();
      const applicantPanel=element(doc,'section','mi-applicants');applicantPanel.dataset.miApplicants='';
      applicantPanel.append(element(doc,'h3','','Applicants linked to this PIN'));
      const applicantBody=element(doc,'div','mi-applicants-body','Applicant records load from the active workspace database.');
      applicantPanel.append(applicantBody);results.append(applicantPanel);
      let applicantRevision=0;
      (async function loadPinApplicants(){
        const current=++applicantRevision;
        const pin=selectedLocation?.pin||selectedLocation?.id?.match(/\b\d{6}\b/)?.[0];
        if(!pin||!loadApplicants){applicantBody.textContent='Applicant lookup requires a selected PIN and an available workspace connection.';return;}
        applicantBody.textContent='Loading applicants…';
        try{
          const rows=await loadApplicants(selectedLocation);
          if(current!==applicantRevision||!applicantPanel.isConnected)return;
          const ordered=[...(rows||[])].sort((a,b)=>{
            const as=Number.isFinite(a.confirmedEligibilityScore)?a.confirmedEligibilityScore:Number.isFinite(a.score)?a.score:-Infinity;
            const bs=Number.isFinite(b.confirmedEligibilityScore)?b.confirmedEligibilityScore:Number.isFinite(b.score)?b.score:-Infinity;
            return bs-as||String(a.launch||'').localeCompare(String(b.launch||''))||String(a.id||a.key||'').localeCompare(String(b.id||b.key||''),undefined,{numeric:true,sensitivity:'base'});
          });
          applicantBody.replaceChildren();
          if(!ordered.length){applicantBody.textContent='No applicants are linked to this PIN in the active Neon workspace.';return;}
          for(const [index,item] of ordered.entries()){
            const row=element(doc,'article','mi-applicant');
            const low=item.scoreRange?.low??item.scoreLow??item.confirmedEligibilityScore??item.score;
            const high=item.scoreRange?.high??item.scoreHigh??item.possibleEligibilityScore??item.high??low;
            const score=Number.isFinite(low)?low===high?String(low):`${low}–${high} (incomplete)`: 'Unscored';
            const button=element(doc,'button','text-button',`${index+1}. ${item.name||item.id||item.key||'Applicant'} · ${score}`);
            button.type='button';if(item.key)button.dataset.detail=item.key;row.append(button);
            row.append(element(doc,'small','',`${item.status||item.verificationStatus||'Status not assessed'} · ${item.allocationStatus||'Allocation status not checked'}${item.nextAction?` · Next: ${item.nextAction}`:''}`));
            applicantBody.append(row);
          }
        }catch(error){if(current===applicantRevision&&applicantPanel.isConnected)applicantBody.textContent=`Applicant records unavailable: ${error.message||'workspace lookup failed'}.`;}
      })();
    }
    const latestAssessments=new Map();
    for(const item of assessments){const key=String(item.id||item.snapshot?.id||`${item.snapshot?.name||'assessment'}:${item.snapshot?.location?.pin||item.snapshot?.location?.city||''}`),previous=latestAssessments.get(key);if(!previous||Number(item.version||0)>=Number(previous.version||0))latestAssessments.set(key,item);}
    const savedRows=[...latestAssessments.values()].sort((a,b)=>String(a.snapshot?.name||a.id).localeCompare(String(b.snapshot?.name||b.id)));
    const saved = element(doc,'section','mi-saved'); saved.append(element(doc,'h2','','Saved assessments'));
    if (savedRows.length) for (const item of savedRows) {
      const button = element(doc,'button','mi-saved-item',`${item.snapshot?.name || item.id} · v${item.version}`);
      button.type = 'button'; button.dataset.miSaved = item.id; saved.append(button);
    } else saved.append(element(doc,'p','mi-note','No saved assessments yet.'));
    form.replaceChildren(setup,hidden,results,commercialDetails,advancedDetails);
    if (comparison) saved.append(comparison);
    shell.append(intro,form,saved); root.replaceChildren(shell);
    if (selectedLocation) setLocation(selectedLocation);
    else if (snapshot.location) { const label = snapshot.location.city || snapshot.location.state || snapshot.location.pin || ''; locationInput.value = label; }
    let revision = 0;
    locationInput.addEventListener('input', async () => {
      const query = locationInput.value.trim(); const current = ++revision; suggestions.replaceChildren();
      selectedLocation = null;
      form.elements.state.value = '';
      form.elements.city.value = /^\d{6}$/.test(query) ? '' : query;
      form.elements.pin.value = /^\d{6}$/.test(query) ? query : '';
      form.elements.name.value = query ? `${query} apparel assessment` : '';
      preview.replaceChildren(element(doc,'small','','Manually entered location · geographic and economic evidence unverified until a sourced suggestion is selected.'));
      results.hidden = true;
      onManual?.();
      if (!search || query.length < 2) return;
      try {
        const rows = await search(query);
        if (current !== revision || !locationInput.isConnected) return;
        for (const item of (rows || []).slice(0,8)) {
          const button = element(doc,'button','mi-suggestion',`${item.name} · ${[item.city,item.state,item.level].filter(Boolean).join(' / ')}`);
          button.type = 'button'; button.setAttribute('role','option');
          button.addEventListener('click',() => { revision++; suggestions.replaceChildren(); setLocation(item); onSelect?.(item); });
          suggestions.append(button);
        }
        if (!rows?.length) suggestions.append(element(doc,'p','mi-note','No sourced match yet. You can analyse a manually entered place with missing evidence shown.'));
      } catch { if (current === revision) suggestions.append(element(doc,'p','mi-note','API/database failure: location search is temporarily unavailable. Retry the search service or select a manually entered location and review its evidence gaps.')); }
    });
    if (query && !selectedLocation) { locationInput.value=query; locationInput.dispatchEvent(new win.Event('input',{bubbles:true})); }
    function setLocation(location) {
      if (!location || typeof location !== 'object') return;
      selectedLocation = location;
      locationInput.value = location.name || location.city || location.state || location.pin || '';
      form.elements.name.value = snapshot.name || `${locationInput.value} apparel assessment`;
      form.elements.country.value = 'India';
      form.elements.state.value = location.state || (location.level === 'state' ? location.name : '') || '';
      form.elements.city.value = location.city || (location.level === 'city' ? location.name : '') || '';
      form.elements.pin.value = location.pin || (location.level === 'pin' ? location.name : '') || '';
      if (location.metrics?.monthlyPerCapitaSpend?.value != null && !form.elements.regionalSpend.value) {
        form.elements.regionalSpend.value = String(location.metrics.monthlyPerCapitaSpend.value);
        form.elements.regionalSpend.dataset.evidence = 'sourced-regional-benchmark';
        const state=location.state||location.metrics.monthlyPerCapitaSpend.geography?.state;
        const sector=location.metrics.monthlyPerCapitaSpend.geography?.sector||'urban';
        const benchmarkIndex=benchmarks.findIndex(item=>item.metric==='clothing_bedding_footwear_mpce'
          &&item.geography?.state===state&&item.geography?.sector===sector
          &&item.value===location.metrics.monthlyPerCapitaSpend.value&&item.referencePeriod===location.metrics.monthlyPerCapitaSpend.referencePeriod);
        if(benchmarkIndex>=0)form.dataset.benchmark=String(benchmarkIndex);
      }
      // A state or city population is not a store catchment, and an HCES blend is not a PIN income observation.
      preview.replaceChildren();
      const population = valueOf(location.metrics?.population);
      const spend = valueOf(location.metrics?.monthlyPerCapitaSpend);
      preview.append(element(doc,'strong','',location.name || 'Selected place'),element(doc,'span','',`${location.level || 'Location'} · ${population === null ? 'Population unavailable' : `${count(population)} people at ${location.level || 'this geographic'} level`}${spend === null ? '' : ` · regional spend benchmark ₹${count(spend)}/person/month`} · ${location.sourceVersion || 'Source version unavailable'}`));
      if (location.evidence?.length) preview.append(element(doc,'small','','Source: ' + (location.evidence[0].title || location.evidence[0].sourceId || 'linked evidence') + (location.evidence[0].referenceYear ? ` · ${location.evidence[0].referenceYear}` : '')));
    }
    function refreshDisplay(){if(!analyzed)return;researchPanel?.remove();describe(doc,results,{location:selectedLocation,snapshot,result,sources});if(researchPanel)results.append(researchPanel);}
    return { setLocation, getLocation:() => selectedLocation, refreshDisplay };
  }
  return { mount };
});
