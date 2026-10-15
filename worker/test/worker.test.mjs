/* Run with: npm test   (builds the knowledge first, then checks the worker with a fake Groq) */
import assert from 'node:assert/strict';
import worker, { buildMessages } from '../src/index.js';

const ORIGIN = 'https://vedanshimesvaniya.github.io';
const env = { GROQ_API_KEY: 'test-key', ALLOWED_ORIGINS: ORIGIN, GROQ_MODEL: 'openai/gpt-oss-20b' };
let sent = null;
let groqReply = () => new Response(JSON.stringify({ choices: [{ message: { content: 'Qdrant is used in Antarkosh for hybrid search.' } }] }), { status: 200 });
globalThis.fetch = async (url, init) => { sent = { url, init, body: JSON.parse(init.body) }; return groqReply(); };

const call = (body, opts = {}) => worker.fetch(new Request('https://w.example/ask', {
  method: opts.method || 'POST',
  headers: { Origin: opts.origin ?? ORIGIN, 'CF-Connecting-IP': opts.ip || '1.1.1.1', 'Content-Type': 'application/json' },
  body: opts.method === 'GET' || opts.method === 'OPTIONS' ? undefined : JSON.stringify(body),
}), opts.env || env);

const results = [];
const test = async (name, fn) => { try { await fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e.message]); } };

await test('retrieval puts the relevant passage in the prompt', () => {
  const m = buildMessages('Does Vedanshi know Qdrant?', []);
  assert.equal(m[0].role, 'system');
  assert.match(m[0].content, /PROFILE/);
  assert.match(m[0].content, /Never invent/);
  assert.equal(m.at(-1).role, 'user');
  assert.match(m.at(-1).content, /CONTEXT:/);
  assert.match(m.at(-1).content, /Qdrant/);
  assert.ok(m.at(-1).content.length < 5200, 'prompt stays small for the free tier');
});

await test('short follow-ups reuse the previous question for retrieval', () => {
  const m = buildMessages('and her thesis?', [{ role: 'user', text: 'Tell me about Stash' }, { role: 'assistant', text: 'Stash is a finance app.' }]);
  assert.match(m.at(-1).content, /Stash/);
});

await test('history is cleaned: starts with a user turn, at most 4 turns', () => {
  const h = [{ role: 'assistant', text: 'x' }, { role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }, { role: 'user', text: 'c' }, { role: 'assistant', text: 'd' }, { role: 'user', text: 'e' }];
  const m = buildMessages('hello there friend now', h);
  const turns = m.slice(1, -1);
  assert.ok(turns.length <= 4);
  assert.equal(turns[0].role, 'user');
});

await test('calls Groq with the right model, key and settings', async () => {
  const r = await call({ question: 'Does Vedanshi know Qdrant?' });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.answer, 'Qdrant is used in Antarkosh for hybrid search.');
  assert.equal(j.contact, false);
  assert.equal(sent.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(sent.init.headers.Authorization, 'Bearer test-key');
  assert.equal(sent.body.model, 'openai/gpt-oss-20b');
  assert.equal(sent.body.reasoning_effort, 'medium');
  assert.equal(sent.body.include_reasoning, false);
  assert.ok(sent.body.max_completion_tokens >= 600);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

await test('[[CONTACT]] marker becomes contact:true and is removed from the text', async () => {
  groqReply = () => new Response(JSON.stringify({ choices: [{ message: { content: 'That is not in the documents. [[CONTACT]]' } }] }), { status: 200 });
  const j = await (await call({ question: 'What is her salary?' })).json();
  assert.equal(j.contact, true);
  assert.equal(j.answer, 'That is not in the documents.');
});

await test('blocks other origins and non-POST methods', async () => {
  assert.equal((await call({ question: 'hi' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await call(null, { method: 'GET' })).status, 405);
  const pre = await call(null, { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

await test('rejects bad input', async () => {
  assert.equal((await call({ question: '   ' })).status, 400);
  const r = await worker.fetch(new Request('https://w.example/', { method: 'POST', headers: { Origin: ORIGIN }, body: 'not json' }), env);
  assert.equal(r.status, 400);
});

await test('clips very long questions', async () => {
  groqReply = () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
  await call({ question: 'a'.repeat(5000) });
  assert.ok(sent.body.messages.at(-1).content.split('VISITOR QUESTION: ')[1].length <= 400);
});

await test('reports a missing key without calling Groq', async () => {
  sent = null;
  const r = await call({ question: 'hi' }, { env: { ...env, GROQ_API_KEY: '' } });
  assert.equal(r.status, 500);
  assert.equal(sent, null);
});

await test('maps Groq failures to clean errors the site can fall back from', async () => {
  groqReply = () => new Response('{}', { status: 429 });
  assert.equal((await call({ question: 'x y z' }, { ip: '2.2.2.2' })).status, 503);
  groqReply = () => new Response('{}', { status: 500 });
  assert.equal((await call({ question: 'x y z' }, { ip: '2.2.2.3' })).status, 502);
  groqReply = () => new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 });
  assert.equal((await call({ question: 'x y z' }, { ip: '2.2.2.4' })).status, 502);
  groqReply = () => { throw new Error('network'); };
  assert.equal((await call({ question: 'x y z' }, { ip: '2.2.2.5' })).status, 504);
});

await test('limits one visitor to 12 questions a minute', async () => {
  groqReply = () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
  let last;
  for (let i = 0; i < 13; i++) last = await call({ question: 'hello there' }, { ip: '9.9.9.9' });
  assert.equal(last.status, 429);
});

let failed = 0;
for (const [s, name, msg] of results) { console.log(s === 'ok' ? '  ok  ' : '  FAIL', name, msg ? '\n        ' + msg : ''); if (s !== 'ok') failed++; }
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
