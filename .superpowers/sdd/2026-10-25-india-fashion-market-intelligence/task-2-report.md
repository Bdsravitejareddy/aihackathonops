# Task 2 implementation report

## Scope delivered

- Added versioned source inventory and benchmark JSON manifests.
- Added `allocateParentTotal(total, children)` with finite/nonnegative weight checks, unique child IDs, explicit weight conservation tolerance (`1e-9`), and stable input order.
- Added a command-line manifest validator and README documentation.
- Recorded Census 2011 PCA town/ward and C-14 source availability and limitations without population observations.
- Registered MoSPI HCES, PLFS, RBI DBIE, state DES national accounts, India Post PIN directory, and OGD PIN GeoJSON. Only verified HCES figures are benchmark observations.

## HCES observations

HCES Report No. 592 covers August 2023–July 2024 and was released 31 January 2025. Karnataka Statements 3R/3U values without imputation are recorded at `state_sector` geography: clothing and bedding ₹231.22 rural / ₹315.29 urban; footwear ₹41.95 rural / ₹58.93 urban; combined broad categories ₹273.17 rural / ₹374.22 urban, all monthly per person. Urban Statement 10U with imputation is separately recorded for clothing and bedding ₹317.61 and footwear ₹59.53. Clothing and bedding excludes tailoring charges. No rural with-imputation value or PIN-level spend/income observation is included.

## Verification

The supplied focused test was run before implementation and failed as expected because `data/india-market-sources.json` did not exist. After implementation, `node --test tests/market-data.test.cjs` passed (4 tests), `node scripts/validate-market-data.cjs` reported 8 sources and 8 observations valid, and `npm test` passed (119 tests). `git diff --check` reported no whitespace errors.

## Review fix round 1

- Added the shared `tests/market-data.test.cjs` file to the versioned deliverable. It checks source metadata and evidence-class allowlisting, HCES vintage/release date, page and source URL metadata, published state-sector values, no PIN observations, and allocation order and conservation with invalid-weight rejection.
- Added direct Report 592 page references to every HCES benchmark row: Statement 3R, p. S5; Statement 3U, p. S11; Statement 10U, p. S45. Each row now carries the official PDF URL.
- Test-first evidence: the expanded focused test failed on the missing `S5` page field before the benchmark rows were updated.
- Verification after the fix: `node --test tests/market-data.test.cjs` passed (4 tests); `node scripts/validate-market-data.cjs` reported 8 sources and 8 observations valid.
