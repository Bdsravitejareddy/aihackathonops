'use strict';

// Territory catchment, TAM, investment and payback. Per-PIN values are the same fields the map shows
// (metrics.population, metrics.apparelExpenditure) and the same analyzeLocation result as the Analysis panel.

const { analyzeLocation } = require('./market-analysis.cjs');

const finite = value => typeof value === 'number' && Number.isFinite(value);
const MAX_PINS = 30;

function parsePins(raw) {
  const pins = [...new Set(String(raw || '').split(',').map(pin => pin.trim()).filter(Boolean))];
  if (!pins.length || pins.length > MAX_PINS || pins.some(pin => !/^\d{6}$/.test(pin))) throw new RangeError(`pins must be 1–${MAX_PINS} comma-separated six-digit PIN codes`);
  return pins;
}

function pinRow(pin, geography) {
  if (!geography) return { pin, id: `pin:${pin}`, status: 'not_found', name: null, population: null, apparelExpenditure: null, potentialRevenue: null, analysis: null };
  const metric = key => {
    const m = geography.metrics?.[key];
    return finite(m?.value) ? { value: m.value, unit: m.unit || null, evidenceClass: m.evidenceClass || null, referenceYear: m.referenceYear || m.referencePeriod || null } : null;
  };
  const result = analyzeLocation({ geography });
  const s = result.scenarios, range = result.costRange.investmentTotal;
  return { pin, id: geography.id || `pin:${pin}`, status: 'available', name: geography.name || pin, district: geography.district || null,
    population: metric('population'), apparelExpenditure: metric('apparelExpenditure'), potentialRevenue: metric('potentialRevenue'),
    analysis: { tier: result.tier.tier, tierClass: result.tier.tierClass,
      investment: { low: range.low, mid: s.mid.investment, high: range.high },
      paybackMonths: { downside: s.low.paybackMonths, base: s.mid.paybackMonths, upside: s.high.paybackMonths },
      roi5YearPercent: s.mid.roi5YearPercent, annualRevenue: s.mid.annualRevenue, revenueConstraint: s.mid.revenueConstraint,
      revenueBasis: result.revenueBasis.basis, evidenceClass: result.costRange.evidenceClass } };
}

const byPayback = (a, b) => (a.analysis.paybackMonths.base ?? Infinity) - (b.analysis.paybackMonths.base ?? Infinity) || b.analysis.roi5YearPercent - a.analysis.roi5YearPercent || a.pin.localeCompare(b.pin);

/** Aggregate per-PIN rows into territory figures and state how each was combined. */
function aggregateTerritory(rows, slots) {
  const sum = key => {
    const withData = rows.filter(r => r[key]);
    return { value: withData.length ? withData.reduce((total, r) => total + r[key].value, 0) : null, pinsWithData: withData.length, pinsTotal: rows.length };
  };
  const analysed = rows.filter(r => r.analysis).sort(byPayback);
  // slots = open stores the territory can take; null means "not set", so every analysed PIN is a candidate.
  const stores = slots === null ? analysed.length : Math.min(slots, analysed.length);
  const chosen = analysed.slice(0, stores);
  const investment = chosen.length ? Object.fromEntries(['low', 'mid', 'high'].map(level => [level, chosen.reduce((total, r) => total + r.analysis.investment[level], 0)])) : null;
  const paybacks = chosen.map(r => r.analysis.paybackMonths.base);
  return {
    catchmentPopulation: sum('population'),
    tam: sum('apparelExpenditure'),
    investment: investment && { ...investment, stores, pins: chosen.map(r => r.pin) },
    openSlots: slots,
    payback: chosen.length ? { best: { pin: chosen[0].pin, ...chosen[0].analysis.paybackMonths }, slowestSelected: paybacks.some(v => v === null) ? null : Math.max(...paybacks), allWithin5Years: paybacks.every(v => v !== null) } : null,
    method: [
      'Catchment population and TAM are the sums over PINs that have a value; PINs without data are counted as missing, not as zero.',
      slots === 0 ? 'No open slots: no store investment is counted for this territory.'
        : `Investment assumes one store in each of the ${stores} PIN${stores === 1 ? '' : 's'} with the fastest base-case payback, up to the territory's ${slots === null ? 'unset' : slots} open slot${slots === 1 ? '' : 's'}; low–high is the sum of each store's cost range.`,
      'Payback is per store, not pooled: the headline is the fastest selected PIN (base case), with its downside–upside range.'
    ]
  };
}

async function territoryMetrics({ pins, slots, loadGeography }) {
  const rows = [];
  for (const pin of pins) rows.push(pinRow(pin, await loadGeography(`pin:${pin}`)));
  return { pins: rows, aggregate: aggregateTerritory(rows, slots) };
}

module.exports = { parsePins, pinRow, aggregateTerritory, territoryMetrics, MAX_PINS };
