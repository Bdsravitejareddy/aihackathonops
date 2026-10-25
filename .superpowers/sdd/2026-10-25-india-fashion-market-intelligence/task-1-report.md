# Task 1 Report: Deterministic market calculations

## Status

Implemented and committed on `feat/india-fashion-market-intelligence`.

## Scope delivered

- Added `server/market-engine.cjs`, a pure CommonJS module exporting `validatePin`, `estimatePerCapitaSpend`, `calculateMarketAssessment`, and the default elasticity presets `[0.5, 0.75, 1, 1.25]`.
- Added structured metric results with status, value, unit, evidence class, assumptions, and warnings. Missing and invalid inputs remain unavailable rather than being treated as zero.
- Implemented explicit household-to-per-capita conversion requiring household size, annualized per-capita spend and TAM, and once-only category/audience/price/accessibility/capture factors for SAM and SOM.
- Implemented break-even revenue, simple constant-performance payback, and gates for negative downside cash flow and critical evidence gaps. Market decision state is never unconditional.
- Left the applicant scoring engine unchanged.

## Test-first evidence

1. Added `tests/market-engine.test.cjs` before implementation.
2. Ran `node --test tests/market-engine.test.cjs`; it failed with the expected `MODULE_NOT_FOUND` for `../server/market-engine.cjs`.
3. Implemented the calculation module and reran the focused tests: **8 passed, 0 failed**.
4. Ran `npm test`: **112 passed, 0 failed**.
5. Ran `git diff --check`: no whitespace errors. Self-review confirmed the change does not modify `dist/engine.js`.

## Limitations and concerns

- Input contracts are implemented as nested `demand`, `segmentation`, `economics`, and optional `risk` objects and should be followed by later API/UI tasks.
- Payback is a simple constant monthly contribution estimate; it does not model ramp, taxes, working capital, discounting, or cash-flow timing. It remains unavailable unless required numeric inputs support a positive contribution.
- No evidence collection, persistence, competitor model, visit-based revenue, market viability score, or scenario projection is included; these belong to subsequent tasks.
- Assessment metrics are deterministic from inputs, but this module does not independently validate source vintages or the provenance supplied by callers.

## Commit

See commit recorded in repository history for this task.

## Scoped review fix round

### Findings addressed

- Added `sourceVintage` and `geography` fields to every assessment metric. Callers supply these explicitly at the assessment input level; absent values are represented as `{ status: 'unavailable', value: null, warnings: [...] }` rather than inferred.
- Guarded annualization, TAM, SAM, SOM, break-even, and payback arithmetic. Non-finite derived values now return `status: 'unavailable'`, `value: null`, and a calculation-specific warning.
- Added the deferred SAM factor boundary coverage: zero is accepted as a valid boundary; a negative factor blocks SAM/SOM and emits a warning.

### Fix verification

1. Added provenance and overflow assertions before changing implementation. The focused suite failed on missing provenance output and on annualization producing an estimated non-finite result, confirming RED.
2. Ran `node --test tests/market-engine.test.cjs` after implementation: **11 passed, 0 failed**.
3. Ran `npm test`: **115 passed, 1 failed**. The failure is the pre-existing untracked `tests/market-data.test.cjs`, which aborts because `data/india-market-sources.json` is absent. Neither that test nor the data source file was changed in this Task 1 fix round.
4. Added tests for both important findings and the deferred factor boundary. Applicant scoring code remains untouched.
