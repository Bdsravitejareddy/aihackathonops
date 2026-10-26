# FranchiseOS Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a coherent, evidence-grounded territory assessment for Indian apparel expansion, starting with PIN 560026, while preserving partner scores and safely preparing production deployment.

**Architecture:** Extend existing Node APIs, Neon/PostGIS stores, deterministic market and financial engines, and browser modules. Keep verified observations separate from estimates and assumptions. Deployment follows only after public API access controls are verified.

**Tech Stack:** Node.js, JavaScript, PostgreSQL/PostGIS on Neon, MapLibre GL JS, Gemini Search grounding (optional), Vercel (target host).

**Spec:** `docs/superpowers/specs/2026-10-26-franchiseos-master-implementation.md` and the approved FRANCHISEOS FINAL MASTER IMPLEMENTATION PROMPT in the conversation.

## Global Constraints

- Preserve existing applicant eligibility scores and allocation restrictions.
- Never substitute city/state totals as PIN observations.
- Trace quantitative outputs to source, year, geography, method, and evidence class.
- Keep API credentials server-side and `.env` untracked.
- Do not expose unauthenticated applicant/workspace APIs to the public internet.
- Do not claim local population, footfall, competitor coverage, or store economics without evidence.

## Review Focus

- PIN code with postal but no demographic boundary: verify local demand remains unquantified and the HCES benchmark stays regional.
- Market benchmark unit mismatch: test household versus per-capita and monthly versus annual conversions.
- Missing model inputs: verify returns stay unavailable rather than silently defaulting to zero or a positive recommendation.
- Applicants with high score but blocked territory: verify suitability remains intact and allocation is separately blocked.
- Public Vercel request without authentication: verify private applicant/workspace records cannot be read or mutated.

---

### Task 1: Reconcile selected-PIN decision context

**Files:** `server/market-location-data.cjs`, `server/market-engine.cjs`, `server/market-forecast.cjs`, `dist/market-intelligence.js`, `dist/territory-screening.js`, corresponding tests.

**Interfaces:** Use existing PIN resolution, market preview/save APIs, financial forecast, applicant cache, and ranking helper.

- [ ] Add failing tests for combining 560026 postal evidence, HCES regional benchmark, market snapshot and ranked applicants without implying PIN TAM.
- [ ] Confirm the tests fail for the intended missing behavior.
- [ ] Implement only supported fields and concise missing-evidence actions.
- [ ] Run targeted and full tests; browser-check select → assess → save/reopen → applicant ranking.

### Task 2: Validate financial model outputs and terminology

**Files:** `server/market-forecast.cjs`, forecast API, financial UI, benchmark registry, tests and methodology.

**Interfaces:** `projectStoreEconomics`, `scoreMarketViability`, and the existing assessment snapshot contract.

- [ ] Add independent formula tests for cash-flow definition, payback, NPV/IRR and incomplete evidence.
- [ ] Verify red failures before changing implementation.
- [ ] Fix only demonstrated inconsistencies; preserve null results when required inputs are absent.
- [ ] Run all tests and compare three contrasting input scenarios.

### Task 3: Verify Neon schema, provenance and persistence

**Files:** `server/db.sql`, stores, ingestion scripts, Neon status documentation and tests.

**Interfaces:** Existing additive migrations and versioned source/assessment tables.

- [ ] Add tests for migrations/seeding reproducibility and source provenance.
- [ ] Inspect the configured Neon project read-only before any schema/data writes.
- [ ] Apply additive migration only when safe and authorized by the approved prompt.
- [ ] Verify assessment save/reopen/recalculate and map evidence against the live database.

### Task 4: Vercel deployment and access boundary

**Files:** serverless adapter, `api/`, `vercel.json`, authentication middleware, deployment documentation, integration tests.

**Interfaces:** Existing `createHandler` API and Neon pool configuration.

- [ ] Add failing tests for anonymous access to applicant/workspace endpoints and public health/static access.
- [ ] Implement a verified auth boundary before exposing private APIs.
- [ ] Add Vercel routing only after project linkage and runtime settings are available.
- [ ] Deploy and verify the real URL, API, Neon and optional Gemini status.

### Task 5: Final browser and release verification

**Files:** automated tests, browser verification artifacts, release notes.

- [ ] Verify required Karnataka place aliases and PIN 560026 in a real browser.
- [ ] Verify map layer stability/cache reuse, applicant ranks, saved assessment and exports.
- [ ] Run full tests and inspect deployment logs/health.
- [ ] Commit and push tested changes; report unmet acceptance gates explicitly.
