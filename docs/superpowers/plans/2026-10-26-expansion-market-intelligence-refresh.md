# Expansion and Market Intelligence Refresh

**Goal:** Keep the Expansion map responsive, make priority Karnataka locations searchable from sourced centroids, and replace the Market Intelligence spreadsheet form with a location-first assessment flow.

**Architecture:** Keep one MapLibre instance mounted while a tab remains active. Cache only public geography and market reference data, keyed by source/model version and request context; do not persist applicant records. The map emits `franchiseos:location-selected` with `{id,name,level,state,city,pin,sourceVersion,metrics,evidence}`; Market Intelligence consumes the same location context and keeps deterministic calculations and Neon assessment versions in the existing backend.

**Tech Stack:** Existing vanilla JavaScript SPA, MapLibre GL JS, Node HTTP API, Neon/PostGIS, IndexedDB, `node:test`, Playwright.

**Spec:** User request in conversation dated 2026-10-26; preserve `docs/superpowers/specs/2026-10-25-india-fashion-market-intelligence-design.md` constraints.

## Global Constraints

- Preserve applicant eligibility scoring and the deterministic market/financial engines.
- Do not invent PIN polygons, demographic values, income, competition or store sales.
- Distinguish Census city units, OSM-derived centroids, postal service areas and commercial catchments.
- Public geometry may be cached; sensitive applicant records must not be written to a shared persistent cache.
- Clear caches by source/model version, geography, metric, scenario and analysis year.
- City centroids may enable navigation without implying city boundaries or current market statistics.
- No new paid service or frontend API credential.

## Review Focus

- A late map or search response cannot replace data for the current geography/metric.
- A metric change reuses boundary geometry and keeps the map visible during loading.
- IndexedDB unavailable/private browsing falls back to memory and live API.
- Ambiguous city aliases resolve with hierarchy context; a PIN without a boundary is still distinguishable from an unknown place.
- An incomplete market snapshot has no fabricated values or unscored viability dimensions.

## Work packages

### Map, search, caching and geography

Files: `dist/market-map.js`, map-related routes/stores under `server/`, a sourced city-location artifact under `data/india-geography/`, and map/geography tests.

Required behavior: single map instance per active map view; render old data while loading; sequence/cancel viewport, metric, detail and search requests; cache map responses in a bounded LRU; cache public geometry in IndexedDB with memory fallback; serve version validators and bounded cache headers; avoid geometry payloads on metric-only refresh when cached; alias-aware city/state/district/PIN suggestions; verified centroids and Census city references for seven named Karnataka cities; location event contract from this plan; unsupported levels remain explicitly unavailable.

### Market Intelligence snapshot redesign

Files: `dist/app.js` or focused Market Intelligence module, `dist/style.css`, `dist/index.html` only if needed, and market UI tests.

Required behavior: concise location/category/format start screen; Analyze action; narrative snapshot with sourced/modeled/missing states; Level 2 commercial inputs; Level 3 advanced controls; relevant deduplicated evidence behind a disclosure; saved assessments and comparison via current market APIs; listen for the shared location event; no user-entered viability scores on the primary workflow.

### Integration and browser acceptance

Exercise 20 layer changes, 10 zoom/pan cycles, cached repeat navigation, seven aliases and current-place selections, store-specific KPI source labels, Market Intelligence autofill, save/recalculate/compare, mobile layout, and unchanged applicant screening. Record request counts and latency from the same local browser run before and after.
