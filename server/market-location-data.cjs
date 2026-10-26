'use strict';

const postalSnapshot = require('../data/india-pin-postal-snapshot.json');
const benchmarkCatalog = require('../data/india-market-benchmarks.json');
const { missingEvidence } = require('./market-evidence.cjs');

function createMarketLocationData({ pins = postalSnapshot.pins, benchmarks = benchmarkCatalog.observations } = {}) {
  const byPin = new Map(pins.map(item => [item.pin, item]));
  const gap = missingEvidence;
  function resolvePin(pin) {
    if (!/^\d{6}$/.test(String(pin || ''))) return null;
    const record = byPin.get(String(pin));
    if (!record) return null;
    const observations = benchmarks.filter(item => item.metric === 'clothing_bedding_footwear_mpce'
      && item.geography?.state === record.state && ['urban', 'rural'].includes(item.geography?.sector)
      && item.evidenceClass === 'official_survey_estimate' && item.imputation === 'without_imputation');
    const urban = observations.find(item => item.geography.sector === 'urban') || null;
    const rural = observations.find(item => item.geography.sector === 'rural') || null;
    const hcesSource = item => item && ({
      sourceId: item.sourceId,
      title: 'HCES 2023-24 Report No. 592, Statement ' + item.statement,
      publisher: 'Ministry of Statistics and Programme Implementation (MoSPI)',
      url: item.sourceUrl,
      referencePeriod: item.referencePeriod,
      referenceYear: 2024,
      geographicResolution: 'state_sector',
      geography: item.geography,
      evidenceClass: item.evidenceClass,
      table: item.statement,
      page: item.page,
      imputation: item.imputation
    });
    const postalEvidence = {
      sourceId: 'india-post-karnataka-pin-directory-2020',
      title: postalSnapshot.source.title,
      publisher: postalSnapshot.source.publisher,
      url: postalSnapshot.source.url,
      catalogUrl: postalSnapshot.source.catalogUrl,
      referenceDate: postalSnapshot.source.referenceDate,
      retrievedAt: postalSnapshot.source.retrievedAt,
      geographicResolution: 'postal_office_and_PIN',
      evidenceClass: 'official_observed',
      license: postalSnapshot.source.license
    };
    const spend = urban ? {
      value: urban.value,
      unit: 'INR/person/month',
      status: 'available',
      evidenceClass: 'official_survey_estimate',
      geographicResolution: 'state_sector',
      referencePeriod: urban.referencePeriod,
      geography: urban.geography,
      evidence: [hcesSource(urban)],
      warnings: ['Karnataka urban HCES benchmark; regional survey estimate, not observed spend for this PIN. PIN-specific rural/urban household shares and income adjustment are unavailable.']
    } : null;
    const annualSpend = urban ? {
      value: urban.value * 12,
      unit: 'INR/person/year',
      status: 'derived',
      evidenceClass: 'derived_estimate',
      geographicResolution: 'state_sector',
      referencePeriod: urban.referencePeriod,
      geography: urban.geography,
      evidence: [hcesSource(urban)],
      formula: 'monthly state-sector HCES clothing, bedding and footwear MPCE × 12',
      warnings: ['Annualized regional benchmark; it is not PIN market expenditure or franchise revenue.']
    } : null;
    return {
      id: `pin:${record.pin}`,
      sourceCode: record.pin,
      name: `${record.offices[0]?.name || 'PIN'} · ${record.displayCity}`,
      level: 'pin',
      parentId: null,
      pin: record.pin,
      city: record.displayCity,
      state: record.state,
      postalCity: record.postalCity,
      postalRegion: record.region,
      postalDivision: record.division,
      postOffices: record.offices,
      geometry: record.geometry,
      areaKm2: null,
      sourceVersion: postalSnapshot.version,
      metrics: {
        population: { value: null, unit: 'people', evidenceClass: 'unavailable', evidence: [], missing: gap('geography_mismatch', 'Use a supported census geography or add a validated PIN-to-population crosswalk.'), warnings: ['No defensible population-to-PIN crosswalk or PIN boundary is available.'] },
        populationDensity: { value: null, unit: 'people/km²', evidenceClass: 'unavailable', evidence: [], missing: gap('missing_calculation_dependency', 'Add a compatible population observation and PIN-area geometry before calculating density.'), warnings: ['PIN geometry and compatible population are unavailable.'] },
        households: { value: null, unit: 'households', evidenceClass: 'unavailable', evidence: [], missing: gap('geography_mismatch', 'Use a supported census geography or add a validated PIN-to-household crosswalk.'), warnings: ['No PIN-level household count is available.'] },
        incomeProxy: { value: null, unit: 'INR/person/month', evidenceClass: 'unavailable', evidence: [], missing: gap('source_unavailable', 'Use a compatible, cited local income source when one is available; leave the income adjustment blank meanwhile.'), warnings: ['No compatible local income proxy is available; no income adjustment is applied.'] },
        monthlyPerCapitaSpend: spend || { value: null, unit: 'INR/person/month', evidenceClass: 'unavailable', evidence: [], missing: gap('source_unavailable', 'Check for a published HCES benchmark matching this state and sector; keep the value blank if none is available.'), warnings: ['No state-sector HCES benchmark is present for this location.'] },
        annualPerCapitaSpend: annualSpend || { value: null, unit: 'INR/person/year', evidenceClass: 'unavailable', evidence: [], missing: gap('missing_calculation_dependency', 'Provide a compatible monthly HCES benchmark before annualizing per-person spend.'), warnings: ['No compatible HCES benchmark is available.'] },
        apparelExpenditure: { value: null, unit: 'INR/year', evidenceClass: 'unavailable', evidence: [], missing: gap('missing_calculation_dependency', 'Provide a supported catchment population and compatible spending benchmark; no market total is inferred.'), warnings: ['Total market expenditure requires a defensible PIN catchment population.'] },
        tam: { value: null, unit: 'INR/year', evidenceClass: 'unavailable', evidence: [], missing: gap('missing_calculation_dependency', 'Provide supported catchment population and compatible annual per-person spend before calculating TAM.'), warnings: ['TAM requires a supported catchment population; no city total is substituted for this PIN.'] },
        sam: { value: null, unit: 'INR/year', evidenceClass: 'unavailable', evidence: [], missing: gap('missing_calculation_dependency', 'Resolve TAM evidence, then document target-category, brand-fit, and accessibility factors.'), warnings: ['SAM requires TAM and documented target-category, brand-fit, and accessibility factors.'] },
        som: { value: null, unit: 'INR/year', evidenceClass: 'unavailable', evidence: [], missing: gap('missing_calculation_dependency', 'Resolve SAM evidence, then enter an explicit market-capture assumption.'), warnings: ['SOM requires a supported SAM and an explicit market-capture assumption.'] },
        competitorCount: { value: null, unit: 'stores', evidenceClass: 'unavailable', evidence: [], missing: gap('not_integrated', 'Build a verified competitor inventory for this PIN or record a dated local store survey.'), warnings: ['No verified competitor inventory is available for this PIN.'] },
        revenue: { value: null, unit: 'INR/year', evidenceClass: 'unavailable', evidence: [], missing: gap('missing_calculation_dependency', 'Provide store-specific demand assumptions or observed footfall and conversion evidence before projecting revenue.'), warnings: ['Store revenue requires a store-specific demand or observed footfall model.'] }
      },
      evidence: [postalEvidence, ...(urban ? [hcesSource(urban)] : []), ...(rural ? [hcesSource(rural)] : [])],
      confidence: urban ? 'postal location verified; spend is state-sector benchmark; PIN demand unsupported' : 'postal location verified; economic evidence missing',
      warnings: [...record.limitations, 'A postal PIN is not a Census boundary or store catchment. No PIN population, income, competitor coverage, footfall, or revenue is inferred.'],
      benchmarkComparison: {
        urban: urban ? { value: urban.value, unit: 'INR/person/month', referencePeriod: urban.referencePeriod, evidence: hcesSource(urban) } : null,
        rural: rural ? { value: rural.value, unit: 'INR/person/month', referencePeriod: rural.referencePeriod, evidence: hcesSource(rural) } : null
      }
    };
  }
  return { resolvePin, sourceVersion: postalSnapshot.version };
}

module.exports = { createMarketLocationData };
