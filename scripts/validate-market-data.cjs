'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const sourcesDoc = JSON.parse(fs.readFileSync(path.join(root, 'data/india-market-sources.json'), 'utf8'));
const benchmarksDoc = JSON.parse(fs.readFileSync(path.join(root, 'data/india-market-benchmarks.json'), 'utf8'));
const allowedClasses = new Set(['official_observed', 'official_survey_estimate', 'derived_estimate', 'derived_geometry']);
const requiredSourceFields = ['id', 'publisher', 'title', 'url', 'referencePeriod', 'geography', 'updateFrequency', 'licenseNote', 'variables', 'limitations', 'evidenceClass'];

function validate() {
  const errors = [];
  if (!sourcesDoc.version || !Array.isArray(sourcesDoc.sources)) errors.push('source manifest requires version and sources');
  const sourceIds = new Set();
  for (const source of sourcesDoc.sources || []) {
    for (const field of requiredSourceFields) if (source[field] === undefined || source[field] === '') errors.push(`source ${source.id || '(unknown)'} missing ${field}`);
    if (sourceIds.has(source.id)) errors.push(`duplicate source id ${source.id}`);
    sourceIds.add(source.id);
    if (!allowedClasses.has(source.evidenceClass)) errors.push(`source ${source.id} has invalid evidenceClass`);
    if (!Array.isArray(source.variables) || source.variables.length === 0) errors.push(`source ${source.id} variables must be non-empty`);
    if (!Array.isArray(source.limitations) || source.limitations.length === 0) errors.push(`source ${source.id} limitations must be non-empty`);
  }
  if (!benchmarksDoc.version || !Array.isArray(benchmarksDoc.observations)) errors.push('benchmark manifest requires version and observations');
  for (const [index, row] of (benchmarksDoc.observations || []).entries()) {
    const label = `observation ${index}`;
    for (const field of ['sourceId', 'metric', 'value', 'unit', 'referencePeriod', 'geography', 'evidenceClass', 'imputation']) {
      if (row[field] === undefined || row[field] === '') errors.push(`${label} missing ${field}`);
    }
    if (!sourceIds.has(row.sourceId)) errors.push(`${label} references unknown source ${row.sourceId}`);
    if (!Number.isFinite(row.value)) errors.push(`${label} value must be finite`);
    if (!allowedClasses.has(row.evidenceClass)) errors.push(`${label} has invalid evidenceClass`);
    if (row.geography && row.geography.level === 'pin') errors.push(`${label} must not contain PIN observations without verified source values`);
  }
  if (errors.length) throw new Error(`Market data validation failed:\n- ${errors.join('\n- ')}`);
  return { sourceCount: sourcesDoc.sources.length, observationCount: benchmarksDoc.observations.length };
}

if (require.main === module) {
  try {
    const result = validate();
    process.stdout.write(`Market data valid: ${result.sourceCount} sources, ${result.observationCount} observations\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { validate };
