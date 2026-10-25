'use strict';

const fs = require('node:fs');
const path = require('node:path');

function build({ rootDir = path.resolve(__dirname, '..'), write = true } = {}) {
  const hcesPath = path.join(rootDir, 'data/india-geography/hces-state-sector.json');
  const benchmarkPath = path.join(rootDir, 'data/india-market-benchmarks.json');
  const hces = JSON.parse(fs.readFileSync(hcesPath, 'utf8'));
  const catalog = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8'));
  catalog.observations = catalog.observations.filter(row => typeof row.sourceId === 'string');
  const existingKeys = new Set(catalog.observations.map(row => `${row.geography?.state}|${row.geography?.sector}|${row.metric}|${row.imputation}`));
  let added = 0;
  for (const state of hces.observations) for (const sector of ['rural','urban']) {
    const data = state.sectors[sector];
    for (const [metric,value,unit] of [
      ['clothing_bedding_mpce',data.clothingBeddingINRPerPersonMonth,'INR/person/month'],
      ['footwear_mpce',data.footwearINRPerPersonMonth,'INR/person/month'],
      ['clothing_bedding_footwear_mpce',data.combinedINRPerPersonMonth,'INR/person/month']
    ]) {
      const key = `${state.state}|${sector}|${metric}|without_imputation`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      catalog.observations.push({ sourceId:hces.source.sourceId, metric, value, unit, referencePeriod:'2023-24', geography:{ level:'state_sector', state:state.state, sector }, evidenceClass:'official_survey_estimate', imputation:'without_imputation', statement:data.statement, page:data.reportPage, sourceUrl:hces.source.url,
        components:{ clothing_bedding:data.clothingBeddingINRPerPersonMonth, footwear:data.footwearINRPerPersonMonth }, notes:'Published MoSPI state/sector HCES estimate; clothing and bedding excludes tailoring charges. No household conversion or PIN allocation.' });
      added++;
    }
  }
  catalog.version = '1.1.0';
  if (write) fs.writeFileSync(benchmarkPath, `${JSON.stringify(catalog,null,2)}\n`);
  return { observations:catalog.observations.length, added, stateSectorCoverage:hces.observations.length*2 };
}
if (require.main === module) { try { process.stdout.write(`${JSON.stringify(build())}\n`); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode=1; } }
module.exports = { build };
