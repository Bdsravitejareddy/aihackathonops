# FranchiseOS
A static, no-login franchise partner assessment workspace built for the AI x Ops hackathon Case 1.

## Run
Serve dist with a static HTTP server. No build or paid API is needed. JSZip is vendored so Excel uploads do not depend on a CDN. Run `node --test tests/*.test.cjs` for the engine and importer checks.

## Use
Load the clearly labelled synthetic demo or upload the supplied XLSX. Template row 3 is excluded unless the operator opts in. Confirm proposed corrections, inspect score ranges and reasons, then track recommended partners through sequenced opening checks. Natural-language assistant supports explicit application IDs and documented patterns; it is not an unrestricted LLM.

## Model
60% investment/premises, 10% launch readiness, 30% experience/site suitability. Percentile points: >=90th 3, >=50th 2, >=30th 1, lower 0. Higher investment/area/experience is favoured; launch direction is reversed. Percentiles use at least five valid observations with variation, tier first and whole upload fallback. Midranks handle ties. References freeze per import until manually rebuilt. Missing components retain a fixed denominator and yield a confirmed-to-possible score range. Optional missing data may remain on provisional recommendations. Language must be confirmed before training completion. Upper is not assumed to mean first floor. No floor is invented for a Mall unit.

Brand minimums are unset until configured. Investment is declared rather than verified. Allocation checks valid required data, identified site, existing-store pins, one recommendation per pin, territory mapping and slots. Slots mean new openings (existing stores are not subtracted twice). Ranking is confirmed score, sooner stated launch, then application ID. No demand, catchment, payback or funding authenticity is inferred.

## Data
Application and territory data remain in each visitor's browser storage. No shared team database or outbound applicant messages. CSV exports decisions; JSON backups preserve workspace state. Public visitors have independent workspaces. Import/demo/restore replaces this browser's workspace after confirmation. Backup schema is validated before replacement. Material changes reset dependent verification tasks.

## QA
Automated engine/import tests plus cloud-browser verification of supplied XLSX import, correction confirmation, conversational investment update, recalculated status and score, and opening checklist prerequisites. Public hosting is managed by Sites.
