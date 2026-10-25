# FranchiseOS master implementation baseline

This repository is an existing Node.js, browser JavaScript, Neon/PostGIS, and MapLibre franchise screening application. The approved master prompt in the conversation dated 2026-10-26 is the product and acceptance specification for this work.

## Intent and success

Deliver one auditable territory decision flow, prioritising PIN 560026: resolve the best supported geography; show evidence-backed market demand; estimate investment and returns only when inputs justify it; rank applicants using the unchanged eligibility engine; and state missing evidence plainly. Keep market viability, applicant suitability, mandatory gates, and territory availability separate.

## Existing constraints

- Preserve applicant eligibility scores, territory restrictions, existing market assessment versioning, and current MapLibre functionality.
- Reuse official and already catalogued India datasets; never infer PIN population, household income, local footfall, competitor count, store sales, or brand investment requirements from unsupported proxies.
- Gemini is optional, server-side, and qualitative unless claims are independently verified. A missing key must not break deterministic features.
- Existing local API is restricted to localhost and has no user authentication. Do not expose its applicant/workspace API publicly until an access model exists.
- Vercel production URL currently returns 404; Vercel project linkage and deployment credentials are not present in this checkout.

## Approved approach

Build incrementally in the current Node/Neon architecture. Complete the selected-PIN evidence and deterministic calculation path first; then close model, applicant and browser gaps; finally deploy only after verifying Vercel project configuration and a safe authentication boundary. Do not replace scoring or fabricate coverage to meet UI targets.

## Non-goals

This baseline does not make unsupported PIN-level forecasts appear precise, claim predictive validity absent real outcome data, or expose applicant data through a public unauthenticated API.
