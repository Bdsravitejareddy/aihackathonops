'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createAcademyHandler, qaTranslation } = require('../server/academy.cjs');
const { createHandler } = require('../server/app.cjs');

const adminToken = 'test-admin-secret';
const courseId = 'cd41a70d-78f5-48f4-9d43-4af2104a905a';
function harness({ translate = async text => `తెలుగు: ${text}`, token = adminToken } = {}) {
  const lessons = new Map();
  const progress = new Map();
  const courses = [{ id: courseId, title: 'Store operations', description: 'Core store procedures' }];
  const store = {
    async listCourses() { return courses; }, async listPublishedCourses() { return courses; }, async saveCourse(course) { const saved = { ...course, id: courseId }; courses.push(saved); return saved; },
    async listPublished() { return [...lessons.values()].filter(x => x.status === 'approved'); },
    async listAdmin() { return [...lessons.values()]; },
    async getLesson(id) { return lessons.get(id) || null; },
    async saveLesson(lesson) { lessons.set(lesson.id, structuredClone(lesson)); return lesson; },
    async approveLesson(id) { const lesson = lessons.get(id); if (!lesson) return null; lesson.status = 'approved'; lessons.set(id, lesson); return lesson; },
    async getProgress(learnerId) { return progress.get(learnerId) || []; },
    async saveProgress(learnerId, lessonId, completed) { const rows = progress.get(learnerId) || []; const next = rows.filter(x => x.lessonId !== lessonId); next.push({ learnerId, lessonId, completed }); progress.set(learnerId, next); return next.find(x => x.lessonId === lessonId); }
  };
  const handle = createAcademyHandler({ store, adminToken: token, translate });
  async function call(method, path, body, auth = adminToken) {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    req.method = method; req.url = path;
    req.headers = { host: '127.0.0.1:8080', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(auth ? { 'x-academy-admin-token': auth } : {}) };
    let status, payload;
    await handle(req, { writeHead(code) { status = code; }, end(data) { payload = data ? JSON.parse(data) : null; } });
    return { status, json: payload };
  }
  return { call };
}

test('translation QA detects missing numbers and required names', () => {
  assert.deepEqual(qaTranslation('Use 3 steps at Bengaluru store.', 'దశలను అనుసరించండి.', ['Bengaluru']), {
    ok: false, missingNumbers: ['3'], extraNumbers: [], missingNames: ['Bengaluru']
  });
  assert.deepEqual(qaTranslation('Use 3 steps.', 'మొత్తం 4 దశలు.', []), { ok: false, missingNumbers: ['3'], extraNumbers: ['4'], missingNames: [] });
});

test('admin translation creates a draft and publication requires passing QA', async () => {
  const h = harness();
  const created = await h.call('POST', '/api/academy/admin/lessons', { courseId, title: 'Opening checklist', sourceText: 'Complete 3 steps at Bengaluru.', names: ['Bengaluru'] });
  assert.equal(created.status, 201);
  assert.equal(created.json.lesson.status, 'draft');
  assert.equal(created.json.lesson.qa.ok, true);
  const approved = await h.call('POST', `/api/academy/admin/lessons/${created.json.lesson.id}/approve`, {});
  assert.equal(approved.status, 200);
  const published = await h.call('GET', '/api/academy/lessons', undefined, null);
  assert.equal(published.status, 200);
  assert.equal(published.json.lessons.length, 1);
});

test('admin routes reject missing credentials and learners cannot read drafts', async () => {
  const h = harness();
  assert.equal((await h.call('GET', '/api/academy/admin/lessons', undefined, null)).status, 401);
  const created = await h.call('POST', '/api/academy/admin/lessons', { courseId, title: 'Draft', sourceText: 'Read 12 labels.' });
  assert.equal(created.status, 201);
  assert.equal((await h.call('GET', `/api/academy/lessons/${created.json.lesson.id}`, undefined, null)).status, 404);
});

test('lesson approval is blocked if any source number is missing from Telugu', async () => {
  const h = harness({ translate: async () => 'తెలుగు పాఠం' });
  const created = await h.call('POST', '/api/academy/admin/lessons', { courseId, title: 'Cash count', sourceText: 'Count 3 tills.', teluguText: 'మూడు కౌంటర్లను లెక్కించండి.' });
  assert.equal(created.json.lesson.qa.ok, false);
  const approved = await h.call('POST', `/api/academy/admin/lessons/${created.json.lesson.id}/approve`, {});
  assert.equal(approved.status, 409);
  assert.deepEqual(approved.json.qa.missingNumbers, ['3']);
});

test('learner progress is saved only for approved lessons', async () => {
  const h = harness();
  const draft = await h.call('POST', '/api/academy/admin/lessons', { courseId, title: 'Safety', sourceText: 'Check 2 locks.' });
  const lessonId = draft.json.lesson.id;
  assert.equal((await h.call('PUT', `/api/academy/progress/${lessonId}`, { learnerId: 'learner-1', completed: true }, null)).status, 404);
  await h.call('POST', `/api/academy/admin/lessons/${lessonId}/approve`, {});
  assert.equal((await h.call('PUT', `/api/academy/progress/${lessonId}`, { learnerId: 'learner-1', completed: true }, null)).status, 200);
  assert.equal((await h.call('GET', '/api/academy/progress?learnerId=learner-1', undefined, null)).json.progress[0].completed, true);
});

test('malformed course content and invalid admin credentials are rejected', async () => {
  const h = harness();
  assert.equal((await h.call('POST', '/api/academy/admin/lessons', { courseId, title: '', sourceText: 'x' })).status, 400);
  assert.equal((await h.call('GET', '/api/academy/admin/lessons', undefined, 'wrong')).status, 401);
});

test('manual Telugu authoring works without Gemini and translation reports disabled state', async () => {
  const h = harness({ translate: null });
  const created = await h.call('POST', '/api/academy/admin/lessons', { courseId, title: 'Daily close', sourceText: 'Count 2 tills.', teluguText: '2 కౌంటర్లను లెక్కించండి.' });
  assert.equal(created.status, 201);
  assert.equal(created.json.lesson.qa.ok, true);
  assert.equal((await h.call('POST', '/api/academy/admin/translate', { sourceText: 'Count 2 tills.', names: [] })).status, 503);
});

test('admin translation never places its Gemini key in a URL', async () => {
  const { createGeminiTranslator } = require('../server/academy.cjs');
  let requestUrl, requestOptions;
  const translate = createGeminiTranslator({ apiKey: 'secret-test-key', fetchImpl: async (url, options) => {
    requestUrl = url; requestOptions = options;
    return { ok: true, async json() { return { candidates: [{ content: { parts: [{ text: 'తెలుగు పాఠం' }] } }] }; } };
  } });
  assert.equal(await translate('Count 2 tills.'), 'తెలుగు పాఠం');
  assert.equal(new URL(requestUrl).search, '');
  assert.equal(requestOptions.headers['x-goog-api-key'], 'secret-test-key');
  assert.equal(requestOptions.body.includes('secret-test-key'), false);
});

test('academy API inherits the existing local-host and same-origin boundary', async () => {
  const academy = createAcademyHandler({ store: { async listPublished() { return []; } } });
  const app = createHandler({ store: { async load() { return null; }, async save() { return 1; } }, academyHandler: academy });
  for (const headers of [
    { host: 'attacker.example' },
    { host: '127.0.0.1:8080', origin: 'http://attacker.example' }
  ]) {
    const req = Readable.from([]); req.method = 'GET'; req.url = '/api/academy/lessons'; req.headers = headers;
    let status;
    await app(req, { writeHead(code) { status = code; }, end() {} });
    assert.equal(status, 403);
  }
});
