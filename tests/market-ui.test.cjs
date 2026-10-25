'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'dist/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'dist/style.css'), 'utf8');

test('Market Intelligence is a separate view with transparent evidence and comparison controls', () => {
  assert.match(app, /market:\s*'Market Intelligence'/);
  assert.match(app, /Market viability score/);
  assert.match(app, /Official survey estimate/);
  assert.match(app, /directoryStatus/);
  assert.match(app, /assessments\/compare/);
  assert.match(app, /monthlyPerCapitaSpend/);
  assert.match(app, /pinIncomeProxy/);
  assert.match(app, /regionalIncomeProxy/);
  assert.match(app, /regionalSpend\*\(pinIncomeProxy\/regionalIncomeProxy\)\*\*elasticity/);
  assert.match(app, /\[0\.5,0\.75,1,1\.25\]/);
  assert.match(app, /api\/market\/forecast/);
  assert.match(app, /breakEvenRevenue/);
  assert.match(css, /\.market-grid/);
});

test('market assumptions use dedicated market API and never enter applicant scoring', () => {
  assert.match(app, /\/api\/market\/assessments/);
  assert.match(app, /\/recalculate/);
  assert.match(app, /Market assessment is separate from franchisee eligibility/);
  assert.match(app, /\/api\/market\/pins\/validate/);
  assert.match(app, /Market assessment is separate from franchisee eligibility/);
  assert.doesNotMatch(app, /market[^\n]{0,100}E\.assess/i);
  assert.match(html, /id="nav"/);
});
