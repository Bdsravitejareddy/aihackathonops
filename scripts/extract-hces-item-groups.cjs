'use strict';

// Builds data/india-geography/hces-state-item-groups.json from MoSPI NSS Report 592 Statements 3R/3U (PDF pages S4-S15).
// Input is the layout-mode text of PDF pages 83-94 (0-based 82-93), e.g. with pypdf:
//   python3 -c "import pypdf,sys;r=pypdf.PdfReader(sys.argv[1]);[print('=====PAGE',i,r.pages[i].extract_text(extraction_mode='layout'),sep='\n') for i in range(82,94)]" Final_Report_HCES_2023-24L.pdf > statements.txt
//   node scripts/extract-hces-item-groups.cjs statements.txt <pdf sha256>
// Checks: 36 States/UTs per sector, every item group present, food items sum to food total, non-food items to non-food total,
// and food + non-food to the published total MPCE (all within ±0.05 rupee rounding per summed item, as printed).

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const ITEMS = [
  'cereal', 'cereal substitutes', 'gram', 'pulses and pulse products', 'sugar', 'salt', 'milk and milk products', 'vegetables',
  'fruits (fresh)', 'fruits (dry)', 'egg, fish & meat', 'edible oil', 'spices', 'beverages, processed food, etc.', 'food: total',
  'pan, tobacco & intoxicants', 'fuel and light', 'toilet articles', 'other household consumables', 'education',
  'medical (hospitalization)', 'medical (non-hospitalization)', 'conveyance', 'consumer services excluding conveyance', 'entertainment',
  'rent', 'other taxes & cesses', 'clothing & bedding', 'footwear', 'durable goods', 'non-food: total', 'total expenditure'
];
const FOOD = ITEMS.slice(0, 14), NON_FOOD = ITEMS.slice(15, 30);
const NOTES = {
  'pulses and pulse products': 'excludes gram', 'beverages, processed food, etc.': 'includes purchased cooked meals',
  'clothing & bedding': 'excludes tailoring charges', 'consumer services excluding conveyance': 'includes tailoring charges'
};
const STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
  'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands',
  'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry', 'All-India'];

const number = token => token === '-' ? 0 : Number(token.replace(/,/g, ''));

function parse(text) {
  const pages = text.split(/=====PAGE\s+(\d+)/).slice(1);
  const out = { rural: {}, urban: {} };
  for (let i = 0; i < pages.length; i += 2) {
    const pageIndex = Number(pages[i]), body = pages[i + 1];
    const sector = /Statement\s+3R/.test(body) ? 'rural' : /Statement\s+3U/.test(body) ? 'urban' : null;
    if (!sector) continue;
    const pageNo = body.match(/Page\s+(S\d+)/)?.[1] || null;
    const columnOffset = (pageIndex - (sector === 'rural' ? 82 : 88)) * 6;
    for (const line of body.split('\n')) {
      const match = line.match(/^\s*(\d{1,2})\.\s+(.*?)\s{2,}((?:-|[\d,]+\.\d+)(?:\s+(?:-|[\d,]+\.\d+))+)\s*$/);
      if (!match) continue;
      const sl = Number(match[1]);
      if (sl < 1 || sl > 32) continue;
      const values = match[3].trim().split(/\s+/).map(number);
      values.forEach((value, column) => {
        const state = STATES[columnOffset + column];
        if (!state) throw new Error(`Unexpected column ${column} on page ${pageIndex}`);
        out[sector][state] ||= { items: {}, page: pageNo };
        out[sector][state].items[ITEMS[sl - 1]] = value;
      });
    }
  }
  return out;
}

function check(parsed) {
  const problems = [];
  for (const sector of ['rural', 'urban']) {
    if (Object.keys(parsed[sector]).length !== STATES.length) problems.push(`${sector}: ${Object.keys(parsed[sector]).length} columns`);
    for (const [state, { items }] of Object.entries(parsed[sector])) {
      const missing = ITEMS.filter(item => !Number.isFinite(items[item]));
      if (missing.length) { problems.push(`${sector} ${state}: missing ${missing.join(', ')}`); continue; }
      const sum = keys => keys.reduce((total, key) => total + items[key], 0);
      const near = (a, b, n) => Math.abs(a - b) <= 0.005 * n + 0.011;
      if (!near(sum(FOOD), items['food: total'], FOOD.length)) problems.push(`${sector} ${state}: food items ${sum(FOOD).toFixed(2)} vs ${items['food: total']}`);
      if (!near(sum(NON_FOOD), items['non-food: total'], NON_FOOD.length)) problems.push(`${sector} ${state}: non-food items ${sum(NON_FOOD).toFixed(2)} vs ${items['non-food: total']}`);
      if (!near(items['food: total'] + items['non-food: total'], items['total expenditure'], 2)) problems.push(`${sector} ${state}: food+non-food vs total`);
    }
  }
  return problems;
}

if (require.main === module) {
  const [input, pdfSha256] = process.argv.slice(2);
  if (!input || !/^[0-9a-f]{64}$/.test(pdfSha256 || '')) { console.error('usage: extract-hces-item-groups.cjs statements.txt <pdf-sha256>'); process.exit(2); }
  const text = fs.readFileSync(input, 'utf8');
  const parsed = parse(text);
  const all = check(parsed);
  // The All-India column is reference only; its published rural food total is 0.10 above its own items (print inconsistency).
  const problems = all.filter(line => !line.includes('All-India')), allIndiaNotes = all.filter(line => line.includes('All-India'));
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  const observations = STATES.filter(state => state !== 'All-India').map(state => ({
    state,
    sectors: Object.fromEntries(['rural', 'urban'].map(sector => [sector, {
      statement: sector === 'rural' ? '3R' : '3U', reportPage: parsed[sector][state].page,
      totalMpce: parsed[sector][state].items['total expenditure'],
      items: Object.fromEntries(ITEMS.filter(item => !/total/.test(item)).map(item => [item, parsed[sector][state].items[item]]))
    }]))
  }));
  const allIndia = Object.fromEntries(['rural', 'urban'].map(sector => [sector, parsed[sector]['All-India'].items]));
  const result = {
    version: '1.0.0',
    source: {
      title: 'Household Consumption Expenditure Survey 2023-24, NSS Report No. 592', publisher: 'Ministry of Statistics and Programme Implementation',
      url: 'https://mospi.gov.in/sites/default/files/publication_reports/Final_Report_HCES_2023-24L.pdf', sourceId: 'mospi-hces-2023-24-report-592',
      statements: 'Statement 3R (rural, pages S4-S9) and Statement 3U (urban, pages S10-S15): break-up of monthly per capita consumption expenditure over broad categories of consumption items by State/UT',
      referencePeriod: '2023-08 to 2024-07', unit: 'INR per person per 30 days', imputation: 'without_imputation', evidenceClass: 'official_survey_estimate',
      pdfSha256, statementsTextSha256: createHash('sha256').update(text).digest('hex'),
      method: 'Layout text of PDF pages S4-S15 parsed by scripts/extract-hces-item-groups.cjs; a dash (no sample reported) is stored as 0. Checks: food items sum to food total, non-food items to non-food total, and food + non-food to total MPCE, within print rounding.',
      licence: 'Government statistical publication; link and attribute NSS Report 592, Statements 3R/3U.'
    },
    itemGroups: ITEMS.filter(item => !/total/.test(item)).map(item => ({ key: item, food: FOOD.includes(item), ...(NOTES[item] ? { note: NOTES[item] } : {}) })),
    observations,
    allIndia,
    allIndiaPublicationNotes: allIndiaNotes
  };
  const body = JSON.stringify(result, null, 1) + '\n';
  const target = path.resolve(__dirname, '..', 'data', 'india-geography', 'hces-state-item-groups.json');
  fs.writeFileSync(target, body);
  console.log(`Wrote ${target} (${observations.length} States/UTs, sha256 ${createHash('sha256').update(body).digest('hex')})`);
}

module.exports = { ITEMS, FOOD, NON_FOOD, STATES, parse, check };
