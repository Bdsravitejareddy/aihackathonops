'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../dist/outreach.js');

const DAY = 864e5, now = Date.parse('2026-10-27T10:00:00Z');

test('moving applications to a stage records the stage, activity time and history', () => {
  const map = O.setStage({}, ['a', 'b'], 'Reach out', now);
  assert.equal(map.a.stage, 'Reach out');
  assert.equal(map.a.lastActivity, new Date(now).toISOString());
  const won = O.setStage(map, ['a'], 'Won', now + DAY);
  assert.deepEqual(won.a.history.map(h => h.stage), ['Reach out', 'Won']);
  assert.equal(won.b.stage, 'Reach out');
  assert.throws(() => O.setStage({}, ['a'], 'Maybe'), /Unknown outreach stage/);
});

test('reach-out with no activity for 5 days reads as disengaged automatically; other stages do not', () => {
  const map = O.setStage(O.setStage({}, ['a', 'b'], 'Reach out', now), ['b'], 'Won', now);
  assert.deepEqual(O.effectiveStage(map.a, now + 4 * DAY), { stage: 'Reach out', auto: false, idleDays: 4 });
  assert.deepEqual(O.effectiveStage(map.a, now + 5 * DAY), { stage: 'Disengaged', auto: true, idleDays: 5 });
  assert.equal(O.effectiveStage(map.b, now + 30 * DAY).stage, 'Won');
  assert.equal(O.effectiveStage(undefined, now), null);
});

test('logging contact restarts the clock and brings a disengaged applicant back to reach out', () => {
  let map = O.setStage({}, ['a'], 'Disengaged', now);
  map = O.logActivity(map, 'a', 'Called back', now + 6 * DAY);
  assert.equal(map.a.stage, 'Reach out');
  assert.equal(O.effectiveStage(map.a, now + 7 * DAY).stage, 'Reach out');
  assert.equal(map.a.history.at(-1).note, 'Called back');
  assert.equal(O.logActivity(map, 'missing', 'x', now), map);
});

test('the board groups applications by effective stage, best score first, and forget removes records', () => {
  const apps = [{ key: 'a', score: 60 }, { key: 'b', score: 90 }, { key: 'c', score: 70 }, { key: 'd', score: 99 }];
  let map = O.setStage({}, ['a', 'b'], 'Reach out', now);
  map = O.setStage(map, ['c'], 'Failed', now);
  const board = O.board(apps, map, now + DAY);
  assert.deepEqual(board['Reach out'].map(c => c.app.key), ['b', 'a']);
  assert.deepEqual(board.Failed.map(c => c.app.key), ['c']);
  assert.equal(Object.values(board).flat().some(c => c.app.key === 'd'), false);
  assert.deepEqual(Object.keys(O.forget(map, ['a', 'c'])), ['b']);
});
