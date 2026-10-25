# India Apparel & Fashion Market Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add a separately versioned India fashion location and investment assessment to FranchiseOS with source provenance, transparent estimates, Neon persistence, and comparison UI.

**Architecture:** Keep eligibility in `dist/engine.js` untouched. Put deterministic calculations in a Node module shared by API and browser, persist source catalog/observations/assessments in additive Postgres tables, and add a Market Intelligence UI backed by dedicated API routes. Ship verified official source metadata and only real official aggregate values; do not create fake PIN estimates.

**Tech Stack:** Existing vanilla JS SPA, Node.js HTTP API, PostgreSQL/Neon (`pg`), built-in `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-25-india-fashion-market-intelligence-design.md`

## Global Constraints

- Applicant scoring and allocation remain unchanged.
- PIN-level income, apparel spend, and footfall are not treated as official observed values.
- Each market output records source vintage, geography, unit, evidence class, and assumptions.
- Apparel spend uses `C_pin = C_region × (I_pin / I_region)^e`; default `e=1`, sensitivities `0.5, 0.75, 1, 1.25`.
- TAM/SAM/SOM factors are applied once; visit-based revenue and spend-share revenue remain separate estimates.
- No new paid service or browser-exposed API key.

## Review Focus

- Zero or missing income benchmark: calculation is unavailable with a reason, not infinite or fabricated — Task 1.
- Household/per-capita and nominal/real unit mismatch — Task 1 and 2.
- Invalid PINs and overlapping catchments — Task 2 and 3.
- Negative cash flow or missing financial inputs despite a high market score — Task 1.
- Workspace backups/imports and existing applicant score remain compatible — Task 3 and 4.

---

### Task 1: Deterministic market calculations

**Files:** Create `server/market-engine.cjs`, `tests/market-engine.test.cjs`.

**Interfaces:** Export `validatePin(pin)`, `estimatePerCapitaSpend({regionalSpend, pinIncomeProxy, regionalIncomeProxy, elasticity=1})`, `calculateMarketAssessment(input)`. Return structured values with `status`, `value`, `unit`, `evidenceClass`, `assumptions`, and warnings; never silently coerce missing inputs to zero.

- [ ] Write tests for PIN syntax, elasticity values, missing/zero proxies, per-capita vs household conversion, TAM/SAM/SOM, break-even/payback, and risk gates.
- [ ] Run `node --test tests/market-engine.test.cjs` and observe expected missing-module failures.
- [ ] Implement calculation functions and default sensitivities.
- [ ] Run the focused tests, then the full suite.

### Task 2: Official data manifest and geographic estimate primitives

**Files:** Create `data/india-market-sources.json`, `data/india-market-benchmarks.json`, `server/market-data.cjs`, `scripts/validate-market-data.cjs`, `tests/market-data.test.cjs`; modify `README.md`.

**Interfaces:** Versioned source records include `id`, `publisher`, `title`, `url`, optional `downloadUrl`, `referencePeriod`, `geography`, `updateFrequency`, `licenseNote`, `variables`, `limitations`, and `evidenceClass`. Benchmark observation rows include `sourceId`, `metric`, `value`, `unit`, `referencePeriod`, `geography`, `evidenceClass`, and `imputation`. `server/market-data.cjs` exports `allocateParentTotal(total, children)` where children are `{id, weight}` and weights must sum to one within 1e-9; results preserve order and return `{id,value}`. Include only values independently validated from official published tables.

- [ ] Write tests for source metadata, allowed evidence classes, source vintage, allocation-weight conservation, and absence of fabricated PIN values.
- [ ] Run focused tests and observe failures.
- [ ] Add source inventory and manually validated aggregate benchmarks; no PIN-level fabricated observations.
- [ ] Implement validators and run focused/full tests.

### Task 3: Versioned market persistence and API

**Files:** Modify `server/db.sql`, `server/app.cjs`, `server/index.cjs`, `scripts/init-neon.cjs`; create `server/market-store.cjs`, `tests/market-api.test.cjs`, `tests/market-store.test.cjs`.

**Interfaces:** Additive tables `market_source_versions`, `market_geographies`, `market_geo_relationships`, `market_observations`, `market_competitors`, `market_assessments`, and append-only `market_assessment_versions`; no `DROP`, `TRUNCATE`, or rewrite of workspace tables. `server/market-store.cjs` exports `createMarketStore(pool)` with `listSources()`, `listBenchmarks()`, idempotent append-only `seedCatalog(sources,benchmarks)`, `listAssessments(workspaceId)`, `getAssessment(workspaceId,id)`, `saveAssessment(workspaceId,id,expectedVersion,snapshot)`, `listCompetitors(workspaceId,assessmentId)`, and `replaceCompetitors(workspaceId,assessmentId,competitors)`. Assessment save returns the new version; stale versions throw 409. `scripts/init-neon.cjs` executes additive DDL then seeds the versioned source manifest and verified observations with idempotent inserts; it never deletes or overwrites historical source versions. API catalog endpoints read the Neon catalog, with static JSON fallback for local calculation/testing. `createHandler({store,marketStore,marketSources,marketBenchmarks})` serves `GET /api/market/sources`, `GET /api/market/benchmarks`, `POST /api/market/pins/validate`, `GET /api/market/assessments?workspaceId=...`, `GET /api/market/assessments/:id?workspaceId=...`, `PUT /api/market/assessments/:id` with `{workspaceId,expectedVersion,snapshot}`, `POST /api/market/assessments/:id/recalculate` with `{workspaceId,expectedVersion}`, and `POST /api/market/assessments/compare` with `{workspaceId,ids}`. Add `GET /api/market/assessments/:id/competitors?workspaceId=...` and `PUT` at that path with `{workspaceId,competitors}`. Source manifest and observations are loaded from local versioned JSON by `server/index.cjs` and seeded into Neon; assessments and competitors persist through Neon. PIN format validation must return `directoryStatus:'not_verified'` until the official postal directory is ingested. Keep body-size, UUID, loopback-host and origin checks. The market module does not write into workspace applicant records.

- [ ] Write API tests proving new routes, input/UUID validation, version conflicts, provenance round-trip, PIN uncertainty, and no impact to workspace score data; write store tests for parameterized SQL and transaction-safe versioned saves/competitor replacement.
- [ ] Run focused tests red.
- [ ] Add additive schema/store/API implementation.
- [ ] Run focused tests, full suite, and local schema init against a disposable database only if available; never drop existing tables/data.

### Task 4: Market Intelligence user interface

**Files:** Modify `dist/index.html`, `dist/app.js`, `dist/style.css`; create `tests/market-ui.test.cjs` if UI functions can be rendered under node test harness.

**Interfaces:** Add a Market Intelligence navigation view for location/PIN comparison, assumptions, demographics, apparel demand, competitors, economics, scenarios, score breakdown, evidence and caveats. Save via dedicated market API; browser-only mode may calculate an unsaved scenario and clearly label it.

- [ ] Write tests for rendering evidence labels, calculation warnings, and separation from eligibility controls.
- [ ] Verify red.
- [ ] Implement responsive forms, tables/charts, comparison and explanation content using the existing visual system.
- [ ] Verify focused tests and manually inspect local browser if available.

### Task 5: Three evidence-backed catchment validations and methodology docs

**Files:** Create `data/case-studies/india-fashion-catchments.json`, `docs/india-fashion-market-methodology.md`, `server/market-forecast.cjs`, `tests/market-case-studies.test.cjs`; modify `README.md`.

**Interfaces:** `server/market-forecast.cjs` exports `scoreMarketViability(metrics, weights)` and `projectStoreEconomics(input)`. Score input keys are `demand`, `purchasingPower`, `competition`, `accessibility`, `financial`, `growth`; default weights are 25/20/20/15/15/5. Scores are 0–100, missing dimensions make the aggregate incomplete without redistributing weights, and negative cash flow/critical missing evidence gates recommendation. `projectStoreEconomics` input is `{store:{initialInvestment,workingCapital,areaSqFt,monthlyFixedCosts,grossMargin,royaltyRate,aov,monthlyStoreVisits,conversionRate,salesRampMonths,initialRampFraction},market:{samAnnual,captureBenchmark},forecast:{years,annualNominalGrowth,annualInflation,discountRate},scenarioFactors:{conservative,base,optimistic}}`. Return separate scenario objects with 60 monthly rows, store visits and transactions, revenue, operating cash flow, cumulative cash flow, nominal/real yearly market projections, break-even revenue and capture rate, ROI and payback, NPV and IRR when the series supports them. Use explicit ramp, inflation and discount assumptions. Case study locations use verified Census town geographies, not PIN catchments unless there is an official validated crosswalk and local population allocation. Store economics and income proxy inputs in fixtures are clearly labeled assumptions; never claim they are observed statistics.

- [ ] Choose three contrasting Indian locations for which official source vintages and geography are verifiable; represent PIN resolution only to the level supported by source data.
- [ ] Write assertions for three cases: no fabricated inputs, total vs per-capita clarity, elasticity response direction, and risk warning correctness.
- [ ] Run tests red, then add documented sourced input fixtures and executable case calculations.
- [ ] Report unsupported indicators and whether the cases support a decision or remain exploratory.

### Task 6: Final validation and handoff

**Files:** All implemented files.

- [ ] Run `npm test` and `node scripts/validate-market-data.cjs`.
- [ ] Confirm git diff for `dist/engine.js` and eligibility logic is empty.
- [ ] Run local server/API and exercise create/list/compare assessment flow; exercise Neon schema additively if credentials are present.
- [ ] Document functionality, limitations, tested case results and Mesa readiness.

### Execution status

- Tasks 1–4 are implemented and committed in this feature branch.
- Task 5 is implemented for scenario calculations and three official Census town-geography coverage checks. It does not claim complete PIN catchments because current PIN population/income/footfall and Raichur's official numeric town count were not verified.
- Task 6 passed automated tests, catalog validation, additive Neon initialization, read-only seed-count verification, and localhost HTTP checks. Browser visual review could not be run in this session.
- The resulting model is appropriate for exploratory Mesa analysis only until missing local market and unit-economic evidence is supplied.
