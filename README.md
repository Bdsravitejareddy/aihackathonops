# FranchiseOS
A no-login browser workspace for franchise partner screening, territory allocation and onboarding.

Live app: https://franchise-ops-ravi.cleantapir32.chatgpt.site

## Run and test
The app can run as a static browser workspace, or with the local Neon persistence API. For Neon mode, copy `.env.example` to `.env`, set `DATABASE_URL` from the `franchiseos` Neon project, then run `npm run db:init` once and `npm start`. The local server binds to `127.0.0.1:8080`; it serves the app and database API from one origin. Do not commit `.env`. If Neon is unavailable, the browser keeps using its local copy.

The Neon-backed workspace is identified by a random ID stored in that browser. This keeps reloads on that browser connected to the same workspace. Authentication and cross-user workspace sharing are not included yet; the API is intentionally bound to localhost until that is added. The Vercel URL `https://aihackathonops-zhb1.vercel.app/` currently returns 404, and this checkout is not linked to a Vercel project. Do not expose the private workspace API publicly until an authenticated access boundary is implemented.

## India fashion market intelligence

The Expansion Intelligence map now serves 36 state/UT boundary features from Neon/PostGIS. It combines Census 2011 rural/urban population with MoSPI HCES 2023–24 rural/urban clothing, bedding and footwear expenditure for 32 comparable state/UTs. These mixed-vintage annual expenditure estimates are not store revenue; Andhra Pradesh, Telangana, Jammu and Kashmir, and Ladakh remain grey because the source totals cannot be reliably split across the current boundaries. The [state heatmap source and reconciliation note](docs/india-state-heatmap-sources.md) documents source years, licences, calculations and gaps. District, city, PIN, age, household, income, competition and footfall coverage are not currently available as observed map data.

Market Intelligence stores a separate, versioned location assessment and does not change applicant eligibility scores. The Gemini-backed context research and Ask Market Intelligence endpoints use server-side credentials and Google Search grounding when configured. Set `GEMINI_API_KEY` in the local `.env` file to enable live research; without it, deterministic map and financial features remain available. Research is qualitative and cited, while official statistics and financial calculations remain in the deterministic analytics engine. Initialize the additive Neon tables with `npm run db:init`, then start locally with `npm start`.

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
Without the local Node API, data remains in each visitor's browser; export JSON to preserve the workspace. With the API running, a browser workspace is stored in Neon under its random workspace ID. There is no authentication or supported cross-user sharing yet. The app does not authenticate bank statements, validate leases, collect background checks or provide PIN-level catchment economics without compatible inputs. Checklist completion is an operator attestation. Training and final franchise approval remain operational steps outside automatic scoring.

## Market data registry
The versioned India market source inventory is in `data/india-market-sources.json`; validated aggregate observations are in `data/india-market-benchmarks.json`. The state map uses source-linked Census 2011 population counts and HCES 2023–24 clothing/bedding and footwear per-capita expenditure, retaining rural and urban values and weighting them by each geography's Census sector population. Postal directory coverage is one historical India Post record for PIN 560026 (2020); it confirms a delivery office and Bengaluru postal hierarchy but supplies no PIN polygon, coordinate, Census crosswalk or PIN population. This is not complete PIN membership validation. Karnataka HCES 2023–24 rural and urban apparel-related values are regional survey benchmarks, not observed PIN spending. PIN income and apparel spend are not presented as official observed data. Geographic allocations must use explicit weights summing to one and remain derived estimates. Run `node scripts/validate-market-data.cjs` to validate metadata, evidence classes and observation references.
