# Task 3 implementation report

## Delivered

- Added isolated PostgreSQL market tables for versioned source manifests, observations, geography, assessments, competitors, and append-only assessment history.
- Added transactional market persistence with optimistic version checks, workspace-scoped reads, and competitor replacement.
- Added idempotent catalog seeding. Source manifest entries are unique by `(source id, version)`; observation keys are deterministic over benchmark version, source version, and observation content. Inserts use `ON CONFLICT DO NOTHING`, preserving historical versions and provenance.
- Updated `npm run db:init` to apply the additive schema and seed `data/india-market-sources.json` plus `data/india-market-benchmarks.json`.
- Added versioned market API routes, catalog reads from Neon with checked-in JSON fallback, PIN format validation that reports `directoryStatus: 'not_verified'`, and recalculation through `market-engine.cjs`.
- Kept market assessments separate from applicant score state and retained existing host/origin, UUID, JSON content type, and body-size protections.
- Added API/store tests, including recalculation provenance and repeated catalog seed behavior.

## Verification

- Initial supplied API/store tests: expected RED; market API routes returned 404 and `server/market-store.cjs` was absent.
- Focused: `node --test tests/market-api.test.cjs tests/market-store.test.cjs` — 11 passed, 0 failed.
- Full: `npm test` — 130 passed, 0 failed.
- `git diff --check` passed.

## Neon initialization review

The market DDL and seed path are additive and contain no `DROP`, `TRUNCATE`, or writes to applicant/workspace score tables. Existing `workspaces` setup includes only the prior `CREATE TABLE IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS revision` statements. The updated `npm run db:init` can therefore initialize the market schema and catalog without replacing existing rows. It was not run against the existing Neon database; no disposable database was provided, so database execution was not used as a verification step.

PIN validation confirms only six-digit format. Postal directory membership remains unverified until the official directory is ingested.
