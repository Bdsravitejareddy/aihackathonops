'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createStaticHandler } = require('../server/static.cjs');

async function request(path) {
  const handler = createStaticHandler({ directory: require('node:path').join(__dirname, '..', 'dist') });
  const req = Readable.from([]);
  req.url = path;
  let status;
  let headers;
  let body;
  await handler(req, { writeHead(code, value) { status = code; headers = value; }, end(value) { body = value; } });
  return { status, headers, body };
}

test('static host serves workbook downloads with spreadsheet MIME type', async () => {
  const response = await request('/qa-test-data.xlsx');
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.ok(response.body.length > 1000);
});

test('static host rejects paths that resolve outside the app directory', async () => {
  const response = await request('/..%2fREADME.md');
  assert.equal(response.status, 403);
});
