# Comparable-store benchmarks and investment estimator

Standalone CommonJS API. It performs no network access and is not wired to the API or UI. The module exports one immutable, source-backed ABFRL network-context record; it is not a single-store comparable. No investment costs or scenario assumptions are seeded. Callers provide other benchmarks and every calculation input. Missing inputs remain unavailable.

## Source-backed ABFRL FY26 context

ABFRL's [Q4 and FY26 investor presentation](https://www.abfrl.com/wp-content/uploads/2026/05/SE_Investor-Presentation.pdf), filed 25 May 2026, reports Pantaloons FY26 segment revenue ₹4,560 crore and EBITDA margin 16.2% (PDF extraction page P11). It reports the network area as 5,781 thousand sq ft across 399 stores as of March 2026 (PDF extraction page P15). The derived mean area is approximately 14,489 sq ft/store (`5,781,000 / 399`). It is a network average, not a disclosed individual-store size.

The presentation does not attribute segment revenue to individual stores or a single format. Accordingly the record does not derive store revenue/store or revenue/sq ft, and leaves individual-store revenue, size and investment costs null. Ownership mix and format comparability are not established. It is unsuitable for a 400 sq ft franchise comparison; comparability rejects it for missing unit size/revenue and the ownership/price-segment mismatch. The roughly four-year Pantaloons payback claim is excluded because its exact first-party passage was not verified.

The record keeps the exact source locator and passage: “FY26 Update: segment revenue Rs. 4560 Cr; segment EBITDA margin 16.2%. Area (000s sq. ft.) / stores, Mar 2026: 5,781 / 399.” Source URL, publisher, publication date, reference period and PDF page references are in `ABFRL_FY26_PANTALOONS_CONTEXT.source`.

## API

```js
const {
  EVIDENCE_CLASSES,
  ABFRL_FY26_PANTALOONS_CONTEXT,
  validateBenchmark,
  normalizeComparableBenchmark,
  selectComparableBenchmarks,
  estimateInvestmentRange,
  estimateRevenueScenarios,
  calculateFinancialMetrics
} = require('../server/market-benchmarks.cjs');
```

Functions throw `TypeError` for missing/invalid structure and `RangeError` for invalid numeric ranges. Use evidence classes `observed`, `derived`, and `model_assumption`. Inputs with missing prerequisites produce null values and an unavailable status; no defaults are inserted.

### Benchmark schema

Required record fields:

- `id`, `retailer`, `format`, `ownershipModel`, `category`, `priceSegment`
- `geography: { country?, tier, name? }`
- `storeSizeSqFt`: positive finite number or null when not disclosed
- `annualRevenueINR`: non-negative finite number or null when not disclosed
- `initialInvestmentINR`: optional non-negative finite number or null
- `evidenceClass`: `observed | derived | model_assumption`
- `source: { title, publisher, url, publicationDate, referencePeriod, geography, supportingPassage, retrievedAt? }`

`source.url` must be HTTPS; dates must be valid ISO calendar dates. `supportingPassage` should identify the exact statement/table/page that supports the record. `validateBenchmark(record)` checks and returns a detached record. For an observed value, cite the first-party disclosure. For a derived value, preserve the arithmetic and its source inputs. Assumptions must state their rationale in the calculation input.

`ABFRL_FY26_PANTALOONS_CONTEXT` stores reported FY26 segment revenue, margin, network area and store count separately under `networkContext`, with per-field evidence classes. The mean network area (`area / count`) is marked `derived`. Its store-level `storeSizeSqFt`, `annualRevenueINR`, and `initialInvestmentINR` are null.

`normalizeComparableBenchmark(record)` adds `revenuePerSqFtPerYearINR = annualRevenueINR / storeSizeSqFt` only when both store-level inputs exist; otherwise it returns null. A calculated ratio is marked `derived` with unit `INR/sq_ft/year`. This normalization does not adjust ownership, store format, geography, online sales, accounting period or network changes.

`selectComparableBenchmarks(records, target)` returns `{ accepted, rejected }`. Target supports `category`, `priceSegment`, `ownershipModel`, exact `format`, `geographyTier`, and `storeSizeSqFt`. The default benchmark/target area ratio range is 0.5–2. Set `minSizeRatio` and `maxSizeRatio` only when an analyst can justify different bounds. Rejected items include their reasons. Passing the filter is an applicability screen, not proof of statistical equivalence.

### Investment range

`estimateInvestmentRange({ expectedComponents, components })` sums only supplied components. Each `components[name]` must contain ordered non-negative `min`, `recommended`, and `max` values, `unit: 'INR'`, and evidence:

- `observed`: `sourceUrl` and `reference`
- `derived`: `sourceUrl`, `reference` and `method`
- `model_assumption`: a written `rationale`

`expectedComponents` is optional; when supplied, omitted items appear in `missingComponents`. Totals are partial whenever expected items are missing. Costs are not extrapolated from a revenue or area benchmark.

### Independent revenue scenarios

`estimateRevenueScenarios({ evidenceClass, tam, footfall })` returns three scenarios for each independent method. `tam` needs `annualMarketINR`, `serviceableShare`, and `captureRates: { conservative, base, optimistic }`. Annual TAM-method revenue is market expenditure × serviceable share × capture rate.

`footfall` needs `monthlyPassingPeople`, `entryRate`, `conversionRate`, `averageOrderValueINR`, and explicit `scenarioFactors: { conservative, base, optimistic }`. Annual footfall-method revenue is monthly passing people × scenario factor × entry rate × purchase conversion × order value × 12. `monthlyPassingPeople` is site-level passing traffic; catchment population is not a substitute. Rates are bounded 0–1. The calculation inputs must be classified using `evidenceClass`. Returned methods remain separate; never add or average them automatically.

### Financial metrics

`calculateFinancialMetrics({ initialInvestmentINR, monthlyRevenueINR, grossMargin, operatingCostRate, monthlyFixedCostsINR, annualDiscountRate, months, evidenceClass })` calculates break-even, operating cash flow, payback, ROI, NPV and annualized IRR from explicitly supplied inputs. Missing inputs return `status: 'unavailable'` and `missingInputs`.

The model assumes constant monthly revenue and cost rates. Contribution margin is gross margin less operating cost rate. Break-even revenue is fixed costs divided by positive contribution margin. Operating cash flow is revenue × contribution margin − fixed costs. Simple payback is the ceiling of investment divided by positive monthly operating cash flow; `paybackStatus` identifies whether it falls within the forecast horizon. ROI is cumulative operating cash flow less initial investment, divided by investment. NPV includes investment at month zero and monthly flows discounted at the annual effective rate converted to a monthly rate. IRR is solved monthly and annualized. Tax, financing/debt, depreciation, lease principal, changing costs, inventory timing and terminal value are excluded.

## Limitations

- This module does not persist records or connect to Neon, the market API, Gemini or the dashboard. Provenance validation checks supplied metadata; it does not fetch or independently authenticate sources.
- Review reuse rights and publication versions before persistence or redistribution.
- Applicability bounds are screening parameters, not industry standards. Reliable small-format franchise comparables and local sourced costs are still needed for a defensible investment range.
- Scenario outputs are not validated forecasts. Back-test with comparable outlet performance before using ROI, NPV, IRR or payback for an investment decision.
