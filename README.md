# FranchiseOS
A no-login browser workspace for franchise partner screening, territory allocation and onboarding.

Live app: https://franchise-ops-ravi.cleantapir32.chatgpt.site

## Run and test
The app can run as a static browser workspace, or with the local Neon persistence API. For Neon mode, copy `.env.example` to `.env`, set `DATABASE_URL` from the `franchiseos` Neon project, then run `npm run db:init` once and `npm start`. The local server binds to `127.0.0.1:8080`; it serves the app and database API from one origin. Do not commit `.env`. If Neon is unavailable, the browser keeps using its local copy.

The Neon-backed workspace is identified by a random ID stored in that browser. This keeps reloads on that browser connected to the same workspace. Authentication and cross-user workspace sharing are not included yet; the API is intentionally bound to localhost until that is added. Vercel deployment is a later manual step.

## India fashion market intelligence

The Market Intelligence area stores a separate, versioned location assessment and does not change applicant eligibility scores. Its official-data registry currently includes Karnataka HCES 2023–24 state-sector clothing/bedding and footwear benchmarks, plus Census source metadata. PIN syntax validation does not verify postal directory membership. Census town figures are from 2011; current PIN-level population, income, apparel spend, competitors and footfall are not supplied as observed data. Use the [methodology and evidence limitations](docs/india-fashion-market-methodology.md) before interpreting scenarios. Initialize the additive Neon market tables and seed the versioned source catalog with `npm run db:init`, then start locally with `npm start`.

JSZip is vendored. Run `npm test` for the test suite.

## Current assessment policy
Industry-informed screening v2 is a **proposed pilot policy**, not an accepted universal numerical industry standard. Weights: 35% declared financial adequacy, 30% premises readiness, 25% retail/business experience, 10% feasible launch. Demonstration assumptions: ₹30 lakh required investment including an initial reserve, 400 sq ft minimum, 3–6 months feasible launch. Replace these with signed-off brand requirements. Full research, source links, methodology, examples and limits are in `dist/franchise-methodology.docx`.

Funding and area contributions are capped once requirements are met. Owned and rented premises receive equal points. Floors must be clarified and assessed; no generic ground-floor bonus. Grades A/B/C/D/U are proposed triage bands. Failed mandatory requirements and location rules override grades. Declared inputs do not establish verified funds, real identity or a viable site. See Scoring & rules for exact anchors.

The original 60/10/30 percentile model is retained in applicant detail/export for comparison. It is recomputed after parsing fixes. The models are different scales, not percentage improvement in candidate quality.

## Workflow
Upload the supplied XLSX, including incomplete records. Row 3 is excluded only when the sheet labels it as an example. Confirm proposed corrections and resolve contradictions. Inspect reasons, recorded-to-possible score ranges and recommendations. Track recommended partners through sequenced funding, site, offer, agreement, fit-out, training and opening checks. Material changes reset dependent attestations.

One recommended partner per pin; existing-store pins and territory slots are protected. Invalid/overlapping territory capacity is excluded from the overview's allocatable slots. Missing input is retained for clarification rather than dropped.

## Franchise bot
Use the floating Ask Franchise bot button, the sidebar, or Ask bot in an applicant's details. Ask general policy/assumption questions, request portfolio summaries, compare applicants, inspect reasons, draft clarification questions and follow up without repeating the selected ID. What-if changes are read-only previews showing affected recommendations. Explicit changes produce a confirmation proposal. Ambiguous ranges, negative facts, mismatched units and unparsed explicit fields trigger clarification. Supported language patterns are documented by examples; this is a grounded rule-based assistant, not an unrestricted LLM. It has no outside rent, demand or profitability data and sends no applicant messages.

## Test data and findings
`dist/qa-test-data.xlsx`: 39 synthetic applications, 5 territories, the protected existing-store list, legacy expectations and a revised rescoring snapshot.
`dist/qa-rescoring.csv`: all 39 previous/revised results under the demonstration profile.
`docs/QA-REPORT.md`: reproduced defects, fixes, verification and limits.

Automated checks include normalization, units, negation, conflicting updates, grades/gates, independent score arithmetic, importer behavior, backup schema, bot reasoning and 200 seeded capacity simulations. Cloud-browser QA covers actual workbook upload, proposed corrections, contextual preview, explicit confirmation, reload persistence, rejected policy settings and CSV/backup downloads.

## Data and scope
Data remains in each visitor's browser; export JSON to preserve the workspace. Visitors have independent data. The app does not provide a shared team database, authenticate bank statements, validate leases, collect background checks or model catchment economics. Checklist completion is an operator attestation. Training and final franchise approval remain operational steps outside automatic scoring.

## Market data registry
The versioned India market source inventory is in `data/india-market-sources.json`; validated aggregate observations are in `data/india-market-benchmarks.json`. The initial benchmark rows are Karnataka HCES 2023-24 state-sector MPCE values, with source statement and imputation status retained. Census 2011 tables are listed as historical source options without invented counts. PIN directory and boundary records support lookup or spatial work only; they do not provide PIN income or apparel expenditure. Geographic allocations must use explicit weights summing to one and remain derived estimates. Run `node scripts/validate-market-data.cjs` to validate metadata, evidence classes and observation references.
