# FranchiseOS Implementation Plan
> Implement inline in this session; user asked to build now with all session permissions.
**Goal:** Working public franchise assessment and onboarding MVP.
**Architecture:** Buildless browser app, local persistence, JSZip XLSX reader, deterministic pure scoring core.
**Tech Stack:** HTML CSS JavaScript Node tests.
**Spec:** docs/superpowers/specs/2026-10-25-franchise-design.md
## Global Constraints
60/10/30 weights; no login; no external AI API; preserve original data; confirm changes; one recommendation per pin; enforce territory slots.
## Review Focus
Incomplete required fields; contradictory notes; tied/small percentile cohorts; duplicate IDs and overlapping territories; updates changing allocations.
### Task 1 Core engine
Files: dist/engine.js, tests/engine.test.cjs. Interfaces normalize(raw,key), benchmarks(apps), assess(apps,territories,stores,reference,settings), parseUpdate(text,apps).
- [ ] Write tests for normalization, incomplete rows, 100-point score, percentile ties, site and territory gates, duplicate IDs, slot limits and confirmed updates.
- [ ] Run node --test tests/*.test.cjs and observe absent behavior.
- [ ] Implement pure engine and run suite to green.
### Task 2 Workspace
Files: dist/index.html, dist/style.css, dist/app.js, dist/xlsx.js, dist/demo.json, dist/vendor/jszip.min.js.
- [ ] Build upload, correction, searchable ranking, territory view, detail editor, conversational updates, onboarding and rules.
- [ ] Test actual supplied workbook parser and interactions in cloud browser.
### Task 3 Delivery
- [ ] Verify code syntax, automated tests and browser workflows.
- [ ] Push/package exact source with Sites helper and deploy public version.
