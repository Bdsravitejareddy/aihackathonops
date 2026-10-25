'use strict';

const { randomUUID, timingSafeEqual } = require('node:crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NUMBER = /(?<![\p{L}\p{N}])\d+(?:[,.]\d+)*(?![\p{L}\p{N}])/gu;

function qaTranslation(sourceText, translatedText, names = []) {
  const sourceNumbers = (sourceText.match(NUMBER) || []).sort();
  const translatedNumbers = (translatedText.match(NUMBER) || []).sort();
  const requiredNames = [...new Set(names.map(name => name.trim()).filter(Boolean))];
  const remainingNumbers = translatedNumbers.slice();
  const missingNumbers = sourceNumbers.filter(number => { const index = remainingNumbers.indexOf(number); if (index < 0) return true; remainingNumbers.splice(index, 1); return false; });
  const extraNumbers = remainingNumbers;
  const missingNames = requiredNames.filter(name => !translatedText.toLocaleLowerCase().includes(name.toLocaleLowerCase()));
  return { ok: missingNumbers.length === 0 && extraNumbers.length === 0 && missingNames.length === 0, missingNumbers, extraNumbers, missingNames };
}

function reply(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(text);
}

async function readJson(req, maxBytes = 300_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Payload too large'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

function createGeminiTranslator({ apiKey = process.env.GEMINI_API_KEY, model = process.env.GEMINI_MODEL || 'gemini-2.5-flash', fetchImpl = fetch } = {}) {
  if (!apiKey) return null;
  return async sourceText => {
    const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: 'Translate the supplied training lesson from English into clear, natural Telugu. Preserve all numbers, proper names, product names, and identifiers exactly. Return only the Telugu translation.' }] }, contents: [{ role: 'user', parts: [{ text: sourceText }] }] })
    });
    if (!response.ok) throw new Error('Translation service unavailable');
    const data = await response.json();
    const value = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
    if (!value) throw new Error('Translation service returned no text');
    return value;
  };
}

function createAcademyHandler({ store, adminToken = process.env.ACADEMY_ADMIN_TOKEN, translate = createGeminiTranslator(), maxBodyBytes = 300_000 }) {
  if (!store) throw new TypeError('An academy store is required');
  const isAdmin = req => {
    const provided = Buffer.from(req.headers['x-academy-admin-token'] || '');
    const expected = Buffer.from(adminToken || '');
    return expected.length > 0 && provided.length === expected.length && timingSafeEqual(provided, expected);
  };
  const validLessonInput = value => value && typeof value.title === 'string' && value.title.trim().length > 0 && value.title.length <= 200
    && typeof value.sourceText === 'string' && value.sourceText.trim().length > 0 && value.sourceText.length <= 250_000
    && (value.teluguText === undefined || (typeof value.teluguText === 'string' && value.teluguText.trim().length > 0 && value.teluguText.length <= 250_000))
    && (value.names === undefined || (Array.isArray(value.names) && value.names.length <= 100 && value.names.every(name => typeof name === 'string' && name.length <= 100)));

  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const route = url.pathname;
    try {
      if (route === '/api/academy/lessons' && req.method === 'GET') return reply(res, 200, { lessons: await store.listPublished() });
      if (route === '/api/academy/courses' && req.method === 'GET') return reply(res, 200, { courses: await store.listPublishedCourses() });
      if (route === '/api/academy/admin/courses') {
        if (!isAdmin(req)) return reply(res, 401, { error: 'Admin credentials required' });
        if (req.method === 'GET') return reply(res, 200, { courses: await store.listCourses() });
        if (req.method === 'POST') {
          const input = await readJson(req, 10_000);
          if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200 || typeof input.description !== 'string' || input.description.length > 2000) return reply(res, 400, { error: 'A course title and short description are required' });
          return reply(res, 201, { course: await store.saveCourse({ title: input.title.trim(), description: input.description.trim() }) });
        }
        res.setHeader?.('allow', 'GET, POST');
        return reply(res, 405, { error: 'Method not allowed' });
      }
      if (route === '/api/academy/admin/lessons') {
        if (!isAdmin(req)) return reply(res, 401, { error: 'Admin credentials required' });
        if (req.method === 'GET') return reply(res, 200, { lessons: await store.listAdmin() });
        if (req.method === 'POST') {
          if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) return reply(res, 415, { error: 'Content-Type must be application/json' });
          const input = await readJson(req, maxBodyBytes);
          if (!UUID.test(input?.courseId || '') || !validLessonInput(input)) return reply(res, 400, { error: 'A course, title, English source, and valid names are required' });
          const names = [...new Set((input.names || []).map(name => name.trim()).filter(Boolean))];
          if (input.teluguText === undefined && !translate) return reply(res, 503, { error: 'Telugu translation is disabled; configure GEMINI_API_KEY or provide a translation manually.' });
          const teluguText = input.teluguText?.trim() || await translate(input.sourceText.trim());
          if (typeof teluguText !== 'string' || !teluguText.trim()) return reply(res, 502, { error: 'Translation service returned no text' });
          const lesson = { id: randomUUID(), courseId: input.courseId, title: input.title.trim(), sourceText: input.sourceText.trim(), teluguText: teluguText.trim(), names, qa: qaTranslation(input.sourceText, teluguText, names), status: 'draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
          await store.saveLesson(lesson);
          return reply(res, 201, { lesson });
        }
        res.setHeader?.('allow', 'GET, POST');
        return reply(res, 405, { error: 'Method not allowed' });
      }
      if (route === '/api/academy/admin/translate' && req.method === 'POST') {
        if (!isAdmin(req)) return reply(res, 401, { error: 'Admin credentials required' });
        if (!translate) return reply(res, 503, { error: 'Telugu translation is disabled; configure GEMINI_API_KEY or provide an approved translation manually.' });
        const input = await readJson(req, maxBodyBytes);
        if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.sourceText !== 'string' || !input.sourceText.trim() || input.sourceText.length > 250_000 || !Array.isArray(input.names || []) || (input.names || []).length > 100 || (input.names || []).some(name => typeof name !== 'string' || name.length > 100)) return reply(res, 400, { error: 'A valid English lesson and names are required' });
        const teluguText = await translate(input.sourceText.trim());
        const qa = qaTranslation(input.sourceText, teluguText, input.names || []);
        return reply(res, 200, { teluguText, qa });
      }
      const approve = route.match(/^\/api\/academy\/admin\/lessons\/([^/]+)\/approve$/);
      if (approve && req.method === 'POST') {
        if (!isAdmin(req)) return reply(res, 401, { error: 'Admin credentials required' });
        if (!UUID.test(approve[1])) return reply(res, 400, { error: 'Invalid lesson identifier' });
        const lesson = await store.getLesson(approve[1]);
        if (!lesson) return reply(res, 404, { error: 'Lesson not found' });
        const qa = qaTranslation(lesson.sourceText, lesson.teluguText, lesson.names);
        if (!qa.ok) return reply(res, 409, { error: 'Translation QA failed; restore the required numbers and names before approval', qa });
        return reply(res, 200, { lesson: await store.approveLesson(approve[1]) });
      }
      const adminLesson = route.match(/^\/api\/academy\/admin\/lessons\/([^/]+)$/);
      if (adminLesson && req.method === 'PUT') {
        if (!isAdmin(req)) return reply(res, 401, { error: 'Admin credentials required' });
        if (!UUID.test(adminLesson[1])) return reply(res, 400, { error: 'Invalid lesson identifier' });
        const current = await store.getLesson(adminLesson[1]);
        if (!current) return reply(res, 404, { error: 'Lesson not found' });
        if (current.status !== 'draft') return reply(res, 409, { error: 'Approved lessons cannot be edited; create a new draft revision.' });
        const input = await readJson(req, maxBodyBytes);
        if (!validLessonInput({ ...input, courseId: current.courseId })) return reply(res, 400, { error: 'A title, English source, Telugu translation, and valid names are required' });
        const names = [...new Set((input.names || []).map(name => name.trim()).filter(Boolean))];
        const lesson = { ...current, title: input.title.trim(), sourceText: input.sourceText.trim(), teluguText: input.teluguText.trim(), names, qa: qaTranslation(input.sourceText, input.teluguText, names), updatedAt: new Date().toISOString() };
        await store.updateLesson(lesson);
        return reply(res, 200, { lesson });
      }
      const lessonMatch = route.match(/^\/api\/academy\/lessons\/([^/]+)$/);
      if (lessonMatch && req.method === 'GET') {
        if (!UUID.test(lessonMatch[1])) return reply(res, 400, { error: 'Invalid lesson identifier' });
        const lesson = await store.getLesson(lessonMatch[1]);
        return lesson?.status === 'approved' ? reply(res, 200, { lesson }) : reply(res, 404, { error: 'Lesson not found' });
      }
      const progressMatch = route.match(/^\/api\/academy\/progress\/([^/]+)$/);
      if (route === '/api/academy/progress' && req.method === 'GET') {
        const learnerId = url.searchParams.get('learnerId') || '';
        if (!/^[a-zA-Z0-9_-]{8,80}$/.test(learnerId)) return reply(res, 400, { error: 'Invalid learner identifier' });
        return reply(res, 200, { progress: await store.getProgress(learnerId) });
      }
      if (progressMatch && req.method === 'PUT') {
        if (!UUID.test(progressMatch[1])) return reply(res, 400, { error: 'Invalid lesson identifier' });
        const input = await readJson(req, 10_000);
        if (!input || typeof input !== 'object' || Array.isArray(input) || !/^[a-zA-Z0-9_-]{8,80}$/.test(input.learnerId || '') || typeof input.completed !== 'boolean') return reply(res, 400, { error: 'Valid learner identifier and completion state are required' });
        const lesson = await store.getLesson(progressMatch[1]);
        if (lesson?.status !== 'approved') return reply(res, 404, { error: 'Lesson not found' });
        return reply(res, 200, { progress: await store.saveProgress(input.learnerId, lesson.id, input.completed) });
      }
      return reply(res, 404, { error: 'Not found' });
    } catch (error) {
      const status = error.status || 503;
      return reply(res, status, { error: status === 413 ? 'Payload too large' : status === 400 ? 'Invalid JSON' : 'Academy service unavailable' });
    }
  };
}

module.exports = { createAcademyHandler, createGeminiTranslator, qaTranslation };
