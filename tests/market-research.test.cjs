'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMarketResearchService, extractCitations, shapeContextCards } = require('../server/market-research.cjs');

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

function groundedPayload(text, json, chunks = []) {
  return response({ candidates: [{ content: { parts: [{ text }] }, groundingMetadata: { groundingChunks: chunks } }] });
}

const validContext = {
  location: { name: 'Mysuru', level: 'city', referenceYear: 2011 },
  segment: 'value apparel',
  assessment: { version: 'market-v1', metrics: { tam: { value: 1250000, unit: 'INR/year', evidenceClass: 'derived_estimate' } } },
  evidence: [{ title: 'Census', url: 'https://censusindia.gov.in/', referenceYear: 2011 }]
};

test('service reports missing credentials without calling Gemini', async () => {
  let called = false;
  const service = createMarketResearchService({ apiKey: '', fetchImpl: async () => { called = true; } });
  const result = await service.researchLocation(validContext);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'missing_api_key');
  assert.equal(called, false);
});

test('uses the current default Gemini model when no model is configured', async () => {
  let requestedUrl = '';
  const service = createMarketResearchService({ apiKey: 'primary', fetchImpl: async url => {
    requestedUrl = url;
    return groundedPayload('Grounded response. [1]', null, [{ web: { uri: 'https://example.org/source', title: 'Source' } }]);
  } });
  await service.answerQuestion({ context: validContext, question: 'Explain the assessment.' });
  assert.equal(requestedUrl, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
});

test('uses low thinking for the default Gemini 3.8 request to keep grounded research responsive', async () => {
  let body;
  const service = createMarketResearchService({ apiKey: 'primary', fetchImpl: async (_url, request) => {
    body = JSON.parse(request.body);
    return groundedPayload('Grounded response. [1]', null, [{ web: { uri: 'https://example.org/source', title: 'Source' } }]);
  } });
  await service.answerQuestion({ context: validContext, question: 'Explain the assessment.' });
  assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'LOW' });
});

test('falls through invalid and quota-limited Gemini credentials without logging keys', async () => {
  const usedKeys = [];
  const logs = [];
  const service = createMarketResearchService({
    apiKeys: ['invalid-primary', 'quota-primary', 'working-fallback'],
    model: 'gemini-test',
    logger: { error: (...args) => logs.push(args) },
    fetchImpl: async (_url, request) => {
      const key = request.headers['x-goog-api-key'];
      usedKeys.push(key);
      if (key === 'invalid-primary') return response({ error: { status: 'UNAUTHENTICATED' } }, 401);
      if (key === 'quota-primary') return response({ error: { status: 'RESOURCE_EXHAUSTED' } }, 429);
      return groundedPayload('Grounded response. [1]', null, [{ web: { uri: 'https://example.org/source', title: 'Source' } }]);
    }
  });
  const result = await service.answerQuestion({ context: validContext, question: 'Explain the assessment.' });
  assert.equal(result.ok, true);
  assert.deepEqual(usedKeys, ['invalid-primary', 'quota-primary', 'working-fallback']);
  assert.equal(JSON.stringify(logs).includes('working-fallback'), false);
});

test('rejects cyclic context as invalid input instead of throwing', async () => {
  const context = {}; context.self = context;
  const service = createMarketResearchService({ apiKey: 'secret', fetchImpl: async () => { throw new Error('must not call'); } });
  const result = await service.answerQuestion({ context, question: 'Why?' });
  assert.equal(result.error.code, 'invalid_context');
});

test('extracts only explicit grounded web citations from grounding metadata', () => {
  const citations = extractCitations({ groundingMetadata: { groundingChunks: [
    { web: { uri: 'https://example.org/report', title: 'Report' } },
    { maps: { uri: 'https://maps.example.org' } },
    { web: { uri: 'javascript:alert(1)', title: 'Bad' } }
  ] } });
  assert.deepEqual(citations, [{ url: 'https://example.org/report', title: 'Report' }]);
});

test('validates and shapes cards, dropping malformed or uncited claims', () => {
  const citations = [{ url: 'https://example.org/source', title: 'Source' }];
  const cards = shapeContextCards([
    { headline: 'Price sensitivity', insight: 'Value positioning may fit. Validate this with local pricing.', evidenceUrls: citations.map(x => x.url), confidence: 'medium', referenceDate: '2025-02', implication: 'Benchmark prices.' },
    { headline: '', insight: 'Malformed' },
    { headline: 'Unsupported', insight: 'Invented preference claim.', evidenceUrls: ['https://invented.example'], confidence: 'high', referenceDate: 'today', implication: 'Invest.' }
  ], citations);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].headline, 'Price sensitivity');
});

test('sends structured context and grounded search through the documented REST endpoint', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return groundedPayload(JSON.stringify({ cards: [{ headline: 'Opportunity', insight: 'A cited local retail update may improve access.', evidenceUrls: ['https://example.org/report'], confidence: 'medium', referenceDate: '2025-01-01', implication: 'Check opening timeline.' }] }), null, [{ web: { uri: 'https://example.org/report', title: 'Report' } }]);
  };
  const service = createMarketResearchService({ apiKey: 'secret-key', model: 'gemini-test', fetchImpl, now: () => new Date('2026-01-01T00:00:00Z') });
  const result = await service.researchLocation(validContext);
  assert.equal(result.ok, true);
  assert.equal(result.cards.length, 1);
  assert.equal(result.citations[0].url, 'https://example.org/report');
  assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent');
  assert.equal(request.options.headers['x-goog-api-key'], 'secret-key');
  assert.deepEqual(request.options.body && JSON.parse(request.options.body).tools, [{ google_search: {} }]);
  const sentBody = JSON.parse(request.options.body);
  assert.match(JSON.stringify(sentBody), /1250000/);
  assert.match(sentBody.contents[0].parts[0].text, /Google Search/i);
});

test('answers questions with grounded citations and preserves deterministic numerical context', async () => {
  let body;
  const service = createMarketResearchService({ apiKey: 'secret', fetchImpl: async (_url, options) => {
    body = JSON.parse(options.body);
    return groundedPayload('Payback depends most on capture rate and monthly fixed costs. See [1].', null, [{ web: { uri: 'https://example.org/benchmarks', title: 'Benchmarks' } }]);
  } });
  const result = await service.answerQuestion({ context: validContext, question: 'What supports the TAM?' });
  assert.equal(result.ok, true);
  assert.match(result.answer, /capture rate/);
  assert.equal(result.citations[0].url, 'https://example.org/benchmarks');
  assert.match(body.contents[0].parts[0].text, /Deterministic numerical facts/);
  assert.match(body.contents[0].parts[0].text, /1250000/);
});

test('uses evidence links already in the assessment when no new web grounding is needed', async () => {
  const service = createMarketResearchService({ apiKey: 'secret', fetchImpl: async () => groundedPayload('This is a regional benchmark and should not be interpreted as a PIN-level observation.', null) });
  const result = await service.answerQuestion({ context: validContext, question: 'Why is this not a PIN-level observed value?' });
  assert.equal(result.ok, true);
  assert.equal(result.citations[0].url, 'https://censusindia.gov.in/');
});

test('uses API sourceEvidence links when explaining an existing assessment without a new web search', async () => {
  const context = { location:{name:'PIN 560026'}, deterministicAssessment:{metrics:{}}, sourceEvidence:[{title:'MoSPI HCES report',url:'https://mospi.gov.in/hces.pdf',referenceYear:2024}] };
  const service = createMarketResearchService({ apiKey:'secret', fetchImpl:async()=>groundedPayload('The provided survey is a regional estimate, not a PIN observation.',null) });
  const result = await service.answerQuestion({ context, question:'Why is this not observed at the selected PIN?' });
  assert.equal(result.ok,true);
  assert.equal(result.citations[0].url,'https://mospi.gov.in/hces.pdf');
});

test('rejects answers that introduce a number absent from deterministic context', async () => {
  const service = createMarketResearchService({ apiKey: 'secret', fetchImpl: async () => groundedPayload('The local market grew 18% last year. [1]', null, [{ web: { uri: 'https://example.org/source', title: 'Source' } }]) });
  const result = await service.answerQuestion({ context: validContext, question: 'How fast is the market growing?' });
  assert.equal(result.error.code, 'invalid_response');
});

test('rejects numerical claims with altered precision or sign', async () => {
  const altered = [
    { context:{ benchmark:1.25 }, answer:'The benchmark is 125. [1]' },
    { context:{ balance:24 }, answer:'The balance is -24. [1]' }
  ];
  for (const item of altered) {
    const service = createMarketResearchService({ apiKey:'secret', fetchImpl:async()=>groundedPayload(item.answer,null,[{web:{uri:'https://example.org/source',title:'Source'}}]) });
    const result = await service.answerQuestion({ context:item.context, question:'What is the value?' });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'invalid_response');
  }
});

test('rejects answers when Gemini returns no grounded citations', async () => {
  const service = createMarketResearchService({ apiKey:'secret', fetchImpl:async()=>groundedPayload('The market appears promising.',null) });
  const result = await service.answerQuestion({ context:{location:{name:'Unknown'}}, question:'Why is this place promising?' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'invalid_response');
  assert.match(result.error.message,/citation|source/i);
});

test('rejects non-JSON or invalid card shapes without manufacturing citations', async () => {
  const service = createMarketResearchService({ apiKey: 'secret', fetchImpl: async () => groundedPayload('not json', null) });
  const result = await service.researchLocation(validContext);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'invalid_response');
});

test('context cards use retrieval date and citations disclose unavailable publication dates', async () => {
  const fetchImpl = async () => groundedPayload(JSON.stringify({ cards: [{ headline: 'Opportunity', insight: 'A cited market signal may merit local validation.', evidenceUrls: ['https://example.org/source'], confidence: 'low', referenceDate: '2030-01-01', implication: 'Validate with store data.' }] }), null, [{ web: { uri: 'https://example.org/source', title: 'Source' } }]);
  const service = createMarketResearchService({ apiKey: 'secret', fetchImpl, now: () => new Date('2026-05-04T09:30:00.000Z') });
  const result = await service.researchLocation(validContext);
  assert.equal(result.cards[0].referenceDate, 'Retrieved 2026-05-04; publication date not verified');
  assert.equal(result.citations[0].publicationDate, null);
  assert.equal(result.citations[0].retrievedAt, '2026-05-04T09:30:00.000Z');
});

test('applies per-key rate limits before calling the provider', async () => {
  let calls = 0;
  const service = createMarketResearchService({ apiKey: 'secret', fetchImpl: async () => { calls++; return groundedPayload('No sources found.', null); }, rateLimit: { max: 1, windowMs: 60000 } });
  await service.answerQuestion({ context: validContext, question: 'First', clientId: 'test-client' });
  const limited = await service.answerQuestion({ context: validContext, question: 'Second', clientId: 'test-client' });
  assert.equal(limited.error.code, 'rate_limited');
  assert.equal(calls, 1);
});

test('times out provider calls and reports upstream failures without leaking key', async () => {
  const logs = [];
  const service = createMarketResearchService({ apiKey: 'top-secret', timeoutMs: 5, logger: { error: (...args) => logs.push(args) }, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) });
  const result = await service.answerQuestion({ context: validContext, question: 'Why?' });
  assert.equal(result.error.code, 'timeout');
  assert.equal(JSON.stringify(logs).includes('top-secret'), false);
  assert.equal(JSON.stringify(result).includes('top-secret'), false);
});

test('handles upstream HTTP errors and never returns or logs the API key', async () => {
  const logs = [];
  const service = createMarketResearchService({ apiKey: 'never-show-this', fetchImpl: async () => response({ error: { message: 'quota' } }, 429), logger: { error: (...args) => logs.push(args) } });
  const result = await service.researchLocation(validContext);
  assert.equal(result.error.code, 'upstream_error');
  assert.equal(JSON.stringify(result).includes('never-show-this'), false);
  assert.equal(JSON.stringify(logs).includes('never-show-this'), false);
});

test('retries one transient provider or network failure without exposing credentials', async () => {
  let calls = 0;
  const service = createMarketResearchService({ apiKey:'private-key', fetchImpl:async()=>{ calls++; if(calls===1) return {ok:false,status:503}; return groundedPayload('A cited statement is useful.',null,[{web:{uri:'https://example.org/source',title:'Source'}}]); } });
  const result = await service.answerQuestion({context:validContext,question:'What evidence matters?'});
  assert.equal(result.ok,true);assert.equal(calls,2);assert.equal(JSON.stringify(result).includes('private-key'),false);
});

test('research cards take sources from grounding supports and same-site URLs, never unretrieved pages', () => {
  const { shapeContextCards } = require('../server/market-research.cjs');
  const citations = [{ url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc', title: 'censusindia.gov.in' }, { url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/def', title: 'mospi.gov.in' }];
  const supports = [{ text: 'Rajajinagar has dense residential housing and a busy retail corridor', urls: [citations[0].url] }];
  const base = { confidence: 'medium', referenceDate: '2026-10-26', implication: 'Prioritise high-street sites.' };
  const cards = shapeContextCards([
    { ...base, headline: 'Dense catchment', insight: 'Rajajinagar has dense residential housing and a busy retail corridor.', evidenceUrls: [] },
    { ...base, headline: 'Spend data', insight: 'Survey spend varies by sector.', evidenceUrls: ['https://www.mospi.gov.in/some/report.pdf'] },
    { ...base, headline: 'Unbacked', insight: 'A claim with no retrieved source.', evidenceUrls: ['https://unknown.example/page'] }
  ], citations, supports);
  assert.deepEqual(cards.map(card => [card.headline, card.evidenceUrls]), [['Dense catchment', [citations[0].url]], ['Spend data', [citations[1].url]]]);
});

test('an answer without any grounding search is retried once with an explicit search instruction', async () => {
  const { createMarketResearchService } = require('../server/market-research.cjs');
  const bodies = [];
  const reply = grounding => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, groundingMetadata: grounding }] }) });
  const service = createMarketResearchService({ apiKey: 'test', logger: { error() {}, info() {} }, fetchImpl: async (url, request) => {
    bodies.push(JSON.parse(request.body));
    return bodies.length === 1 ? reply({}) : reply({ webSearchQueries: ['q'], groundingChunks: [{ web: { uri: 'https://example.com/a', title: 'example.com' } }] });
  } });
  const result = await service.generate({ prompt: 'Find brands', clientId: 'retry-test' });
  assert.equal(bodies.length, 2);
  assert.match(bodies[1].contents[0].parts[0].text, /Run Google Search before answering/);
  assert.equal(result.citations.length, 1);
});
