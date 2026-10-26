'use strict';

const MISSING_CAUSES = Object.freeze({
  source_unavailable: 'A suitable source or observation is unavailable.',
  not_integrated: 'A suitable source exists but is not integrated here.',
  geography_mismatch: 'Available evidence does not match the selected geography.',
  missing_calculation_dependency: 'A required input or upstream calculation is missing.',
  api_database_failure: 'The API or database could not provide the evidence.',
  user_input_required: 'A user supplied input or assumption is required.'
});

function missingEvidence(cause, nextAction) {
  if (!Object.hasOwn(MISSING_CAUSES, cause)) throw new TypeError(`Unknown missing evidence cause: ${cause}`);
  return { cause, nextAction };
}

module.exports = { MISSING_CAUSES, missingEvidence };
