# FranchiseOS testing and rationality review
25 October 2026

## Scope
Synthetic workbook with 39 applications and five territories, original supplied template, independent score arithmetic and 200 seeded allocation simulations. Browser tests use synthetic applicants only. No bank evidence, lease authenticity, real identity or investment-success claim was tested.

## Reproduced defects corrected
- ₹25,00,000 was proposed as 2,500,000 lakh. Now proposes 25 lakh for confirmation; crore magnitudes also convert.
- Numeric cleaner accepted unrelated measurement units. Parsing now follows each field's dimension.
- Bot interpreted negation as a positive floor and lost a minus sign. It now asks for confirmed facts.
- Bot selected one endpoint of a range, the first of conflicting amounts, or part of a combined update. It now rejects ambiguous or unparsed explicit facts.
- Lease duration could inflate retail experience. Experience is now bound to the relevant clause.
- Bot could not answer general policy questions or contextual follow-ups. Added evidence-grounded explanations, comparisons, clarification drafts, portfolio summaries and read-only scenario previews.
- Percentile changes between benchmark values jumped upward; legacy interpolation is now continuous. V2 uses absolute adequacy and does not depend on applicant cohorts.
- Business scoring rewarded a relative's business or unrelated use of “run.” Evidence matching is narrower and respects negation.
- Template row skipping could discard a real third row in an ordinary workbook. Example exclusion now requires a template instruction.
- Fixed-store changes were silently ignored. The fixed list remains protected and differences are reported.
- Rejected policy form changes could still mutate active settings. Validate a temporary candidate before activating it.
- Overview capacity included an invalid negative slot count and overlapping pins. It now reports allocatable capacity.

## Active methodology and findings
The research supports brand-specific multi-criteria selection and due diligence; it does not establish the original percentile weights. V2 uses proposed 35/30/25/10 weights with explicitly labelled demo requirements of ₹30 lakh, 400 sq ft and 3–6 months. It gives no ownership premium and caps wealth/area benefits after adequacy. Grade never overrides eligibility.

Initial v2 results: 3 recommendations, 9 waitlisted, 14 clarifications, 3 needing a site, 1 occupied location, 3 territory reviews, 4 requirement holds, 2 timeline reviews. These sum to 39. The example profile is not an actual brand's published policy.

APP-105: 35 legacy -> 95 v2, recommended. APP-218: 100 legacy -> 90 v2, timeline review because one month is earlier than three. A hypothetical three-month launch changes APP-218 to Recommended at 100 and displaces another recommendation, without changing saved records.

## Browser evidence
Actual XLSX upload read 39 applications, five territories and six corrections; the template example was excluded. Currency correction displayed 25 lakh, and range/negative/wrong-unit values remained unconfirmed. Clarification identified APP-201's missing investment. Confirming 40 lakh changed its score 60 -> 95 and status Clarification needed -> Recommended; the update and conversation survived reload. An invalid 7-to-6-month policy was rejected while the active 3-to-6-month policy stayed unchanged. Downloaded CSV had 39 rows and 13 columns; a downloaded backup passed the complete schema including v2 policy and messages. Injected name markup remained literal text, not executable markup.

## Limits
No finite suite proves every arbitrary input safe. Natural-language coverage is intentionally bounded; unsupported questions require clarification/editor use. The prototype is not an unconstrained LLM, success predictor, KYC system, bank-verification tool or final approval engine. Market-demand, site economics, working-capital detail, operating commitment and coachability require additional evidence. The synthetic injection-name fixture can meet numeric fit checks; it does not establish a real identity. Brand experts must approve the proposed thresholds/weights and validate against actual outcomes before production adoption.
