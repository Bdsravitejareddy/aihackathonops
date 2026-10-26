# India Apparel & Fashion Market Intelligence Engine

**Status:** Design for review  
**Date:** 2026-10-25

## Goal

Add market and site investment analysis to the existing FranchiseOS workspace. The current franchisee eligibility score and its decision flow remain independent. A location assessment answers whether the market and proposed store economics can support an investment; it must not alter an applicant's eligibility score.

The first configured sector is apparel and fashion in India. Sector categories, benchmarks, and assumptions are versioned configuration so a team can change sectors without rewriting the calculation engine. Outputs are reproducible from a saved input snapshot, source versions, and model version.

## Existing application and integration points

- The UI is a static, single-page app (`dist/index.html`, `dist/app.js`, `dist/style.css`) with browser-side rendering and local data import/export.
- A small Node HTTP API (`server/app.cjs`) currently reads/writes workspace snapshots. Neon/Postgres stores a JSONB workspace and normalized workspace child tables (`server/db.sql`).
- `dist/engine.js` holds applicant scoring logic; do not extend or repurpose it for market scores.
- The API is local-only today. Gemini credentials must be read by the server, never placed in browser code. Remote deployment requires authentication and a separately reviewed security change.

## Product shape

Add a **Market Intelligence** area inside the existing application with the following views:

1. **Locations** — create a location assessment with country/state/city/PIN, coordinates, store concept, target audience, and proposed catchment method.
2. **Demand** — demographics, purchasing-power proxy, apparel expenditure, target-addressable spend, TAM/SAM/SOM, assumptions and uncertainty.
3. **Competition & evidence** — imported/entered competing locations, distance/density indicators, dated public sources, and optional cited qualitative commentary.
4. **Store economics** — editable capital, rent, payroll, margin, AOV, conversion, footfall and ramp inputs; conservative/base/optimistic scenarios; break-even and payback.
5. **Expansion** — compare locations and 3-/5-year scenarios, with nominal and real values separated and overlap/cannibalisation warnings.
6. **Methodology** — data inventory, source vintages, transformations, missingness, evidence class, model version, and saved assumptions.

The interface should distinguish observed counts, official survey estimates, derived estimates, user assumptions, qualitative AI summaries and forecasts. A missing value stays missing until a user or an explicitly configured method supplies a defensible estimate.

## Data and evidence design

Store a source registry containing publisher, dataset/title, source and download URLs, release/reference dates, geography, update cadence, license/terms note, definitions, coverage, caveats, ingestion timestamp, checksum and version. Store normalized imported data with a source-version reference. Save per-assessment input and result snapshots so a later refresh cannot silently change a prior decision.

Initial source adapters should prioritize:

- Census 2011 Population Finder/PCA for population, households, age, sex, literacy, workers, and administrative geography. This is a dated baseline, not a current population count.
- MoSPI HCES 2023–24 (August 2023–July 2024), including the clothing, bedding and footwear group. National published MPCE is ₹4,122 rural and ₹6,996 urban; the corresponding group is ₹273 and ₹396 respectively. These are broad survey estimates, not brand-specific or PIN-level observations. Microdata use must apply survey weights and sample-adequacy checks.
- MoSPI PLFS 2023–24 for labor-market context, with geography and sample limits visible.
- RBI DBIE/Handbook series for properly identified state and (where an explicit series permits) district context. Deposits and credit are not household income.
- State DES domestic-product series only after documenting state-specific geography, base year, current/constant price and comparability.
- India Post PIN directory for postal lookup. Optional OGD PIN-boundary GeoJSON can support spatial overlays after geometry and coverage validation. A PIN is not a census unit or a guaranteed trade area.
- State/monthly CPI for inflation adjustments only at the geography and category actually published. Do not splice CPI bases without a documented linking method.
- MoHUA and Udyam indicators only as clearly scoped context (scheme coverage and registered MSMEs), not complete housing or retail counts.

No official PIN-level household income, apparel spend or retail footfall is assumed. An estimate allocated from a coarser unit is labeled `derived_estimate`, names its allocation basis and uncertainty, and is never described as observed PIN data. Do not use fictional market statistics in seed/production data. The three contrasting case studies should use verified locations and source-backed inputs; where adequate evidence is missing, the report should show an incomplete illustrative calculation with explicit hypothetical user assumptions, not pass it off as observed evidence.

## Geography and catchments

Represent administrative units with stable source-specific identifiers and parent links (India → state → district → subdistrict → town/ward/village), postal PINs separately, and store catchments as assessment-specific geometries/methods. Preserve crosswalk provenance and allocation weights. Validate that allocation weights sum to one for a parent total and expose unmatched area/population.

For the initial implementation, use Neon/Postgres with geometry support only if the required extension is available in the chosen Neon project; otherwise use an equivalent GeoJSON/Haversine implementation for point/radius and distance-weighted approximations. Label radius bands as distance proxies, not drive-time catchments. Do not claim 5/10/15/20-minute travel times without a routing source. Population allocation over overlapping catchments must allocate each source population once across the union/weighted overlap, not sum full PIN populations repeatedly. Competitor counts are supply indicators only.

## Purchasing power and apparel demand

Keep units explicit: monthly per-capita expenditure, household expenditure, and income proxies are separate fields. City/region apparel benchmark `C_city` and comparable monthly per-capita reference proxy `I_ref` must have the same geography class, period, price basis and units. A PIN proxy `I_pin` is a modeled proxy, not official income.

Baseline category spend:

`C_pin = C_city × (I_pin / I_ref)^e`

Default elasticity `e = 1.0`; expose 0.5, 0.75, 1.0 and 1.25 as sensitivity presets and allow category-specific configuration. If no compatible city benchmark exists, fall back only through an explicit regional/state and urban/rural selection, record the substitution, and reduce confidence. If there is no compatible benchmark/proxy, stop the estimate and request an input instead of silently manufacturing a value.

Annual total market:

`TAM = catchment population × monthly per-capita relevant apparel spend × 12`

For each segment, derive SAM once using documented category share, audience fit, price eligibility and geographic accessibility. `SOM = SAM × capture rate`. Each factor is applied exactly once. Distinguish household annual spend from per-capita spend. Do not disaggregate men/women/children/footwear/accessories beyond source-supported estimates; unsupported splits are explicit assumptions and do not inherit official-data status.

## Visits and store financial model

Keep catchment population, passing footfall, store visits, unique shoppers and transactions as distinct quantities. If observed visits or comparable store benchmarks are absent, present scenario assumptions and uncertainty, not an observed footfall prediction. A visits-based revenue estimate is `visits × conversion × AOV`; the independent spend-share estimate is SOM. Show their definitions and flag material divergence; do not average them automatically.

Inputs include store area, capital components, rent/deposit, staff, utilities, marketing, royalty, gross margin, inventory/working capital, AOV, conversion and opening ramp. Calculate revenue, contribution, EBITDA, break-even revenue/transactions, revenue per square foot, working capital, operating cash flow, cumulative cash flow, payback, ROI and NPV/IRR only when the time series and discount-rate assumptions are complete. Model conservative/base/optimistic cases and expose the required break-even capture rate. No approval recommendation can be unconditional when downside cash flows are negative, break-even capture is unsupported, or critical evidence is absent.

Three- and five-year projections separate nominal from inflation-adjusted values. With insufficient history, these are scenario projections, not statistical predictions. Expansion capacity and cannibalisation must state assumptions and avoid summing duplicate catchments.

## Market score and decision output

Create a separately named, versioned Market Viability Score using the user's provisional weights: demand 25%, purchasing power/target demographics 20%, competition/saturation 20%, accessibility/footfall 15%, financial feasibility 15%, future growth 5%. Normalize each subindicator with documented direction, caps and missing-data handling. Display subscores and evidence quality. Do not redistribute missing weights without showing it; by default mark score provisional/incomplete when a required dimension is unavailable. A high weighted score cannot override negative projected cash flow or a critical evidence gate. Keep franchisee eligibility, market viability, investment feasibility and expansion readiness as separate outcomes.

## Persistence/API and model versions

Add market tables rather than embedding the model in applicant records: source registry and dataset versions; geographic units and crosswalks; demographic/economic observations; PIN directory/geometry metadata; competitor records; sector/category definitions and assumptions; location assessments; assessment input/result snapshots; and optional evidence items. Use foreign keys, unique source identifiers, assessment ownership/workspace association, created/updated timestamps and explicit model/source version identifiers. Ingest operations should be idempotent and record validation errors. Existing workspace persistence and its optimistic revision behavior must continue to work.

Expose narrow API routes for listing source manifests, searching/validating PINs, managing a location assessment, calculating/recalculating a saved assessment and comparing saved assessments. Validate bounds and units server-side. Keep deterministic calculations in a reusable pure module; persist input/result snapshots through the existing store/database. Do not have the AI service calculate authoritative scores or mutate model inputs.

## Optional public-web qualitative evidence

Gemini Search grounding/URL Context is optional and server-side. It may discover and summarize permitted public material with URL, access date, publication date where available, and quote/snippet provenance. The workflow must retain citations and distinguish brand/design commentary from representative consumer preference research. Do not scrape prohibited sources, invent reviews, or treat sentiment as survey evidence. If no server API key exists, hide/disable the action with a clear configuration message; all core calculations remain usable.

## Rollout phases

1. Audit and source manifest; create source registry and deterministic calculation contracts.
2. Geography/PIN lookup and ingestion foundation; verify source licenses, geometry coverage and crosswalk quality.
3. Demographic and purchasing-power estimates with visible vintage and uncertainty.
4. Apparel TAM/SAM/SOM and elasticity sensitivity.
5. Competition/catchment and two independent revenue approaches.
6. Store financial cases, score, saved snapshots, explanations and UI.
7. Validate three contrasting locations, document evidence gaps, and prepare local-first deployment; do not expose the local-only API publicly without authentication/security work.

Phases can be delivered as usable increments. No external deployment, production-data import, or paid API use is implied by this design.

## Acceptance criteria

- Existing applicant scoring and workspace tests remain unchanged in behavior.
- Market assessments are separately persisted and reproducible by saved inputs, model version and source versions.
- Units and provenance are visible for every metric; unsupported PIN values are not presented as observed.
- Elasticity sensitivity, TAM/SAM/SOM, two revenue estimates, break-even and payback recalculate from editable assumptions.
- Catchment overlaps do not double-count allocated population; approximations are named accurately.
- Market score is separate from eligibility and cannot override hard financial/evidence warnings.
- Missing/old sources and sample limitations are surfaced in UI and exports.
- Case studies contain traceable evidence and clearly mark every user assumption; no fabricated production market records.

## Official source references checked

- [Census Population Finder](https://censusindia.gov.in/census.website/en/data/population-finder)
- [MoSPI HCES catalogue](https://esankhyiki.mospi.gov.in/catalogue-main/catalogue?product=HCES)
- [HCES 2023–24 detailed report](https://mospi.gov.in/sites/default/files/publication_reports/Final_Report_HCES_2023-24L.pdf)
- [HCES 2023–24 release note](https://mospi.gov.in/sites/default/files/press_release/HCES_Report202324_Press_Note_30012025.pdf)
- [MoSPI PLFS Annual Report 2023–24](https://mospi.gov.in/sites/default/files/publication_reports/AnnualReport_PLFS2023-24L2.pdf)
- [RBI DBIE brochure](https://dbieold.rbi.org.in/DBIE/doc/Brochure%20on%20DBIE%20-2022%20English.pdf)
- [MoSPI district domestic product resource](https://mospi.gov.in/district-domestic-product)
- [India Post PIN directory](https://www.indiapost.gov.in/rti/pincodelist)
- [OGD India PIN boundary catalog](https://sikkim.data.gov.in/catalog/all-india-pincode-boundary-geo-json)
- [Government Open Data License—India](https://data.gov.in/Godl)
- [MoSPI CPI catalogue](https://esankhyiki.mospi.gov.in/catalogue-main/catalogue?product=CPI)
- [Gemini Search grounding](https://ai.google.dev/gemini-api/docs/google-search) and [URL Context](https://ai.google.dev/gemini-api/docs/url-context)
