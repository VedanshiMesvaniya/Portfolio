/* Portfolio assistant: answers visitor questions with Groq (openai/gpt-oss-20b), grounded in
 * the documents from /knowledge. Deploy with Cloudflare Workers (see worker/README.md). */
import knowledgePublic from './knowledge.generated.js';
import knowledgePrivate from './knowledge.private.generated.js';
import { buildIndex, search } from './retrieval.js';
import { PROFILE, RULES } from './profile.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-oss-20b';
const MAX_QUESTION = 400;
const MAX_CONTEXT_CHARS = 3600;

let INDEX;
const getIndex = () => (INDEX ||= buildIndex([...(knowledgePublic.chunks || []), ...(knowledgePrivate.chunks || [])]));

/* Best-effort limiter: one counter per worker instance and visitor IP.
 * For hard limits add a Cloudflare rate-limiting rule (see README). */
const seen = new Map();
function limited(ip, now = Date.now()) {
  const windowMs = 60_000, max = 12;
  const list = (seen.get(ip) || []).filter((t) => now - t < windowMs);
  list.push(now);
  seen.set(ip, list);
  if (seen.size > 500) for (const [k, v] of seen) if (!v.some((t) => now - t < windowMs)) seen.delete(k);
  return list.length > max;
}

const clip = (s, n) => String(s ?? '').slice(0, n);

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function buildMessages(question, history) {
  const prior = (Array.isArray(history) ? history : []).slice(-4)
    .map((m) => ({ role: m && m.role === 'assistant' ? 'assistant' : 'user', content: clip(m && m.text, 500).trim() }))
    .filter((m) => m.content);
  while (prior.length && prior[0].role !== 'user') prior.shift();

  // short follow-ups ("and her education?") borrow the previous question for retrieval
  const lastUser = [...prior].reverse().find((m) => m.role === 'user');
  const query = question.split(/\s+/).length < 5 && lastUser ? `${lastUser.content} ${question}` : question;

  let used = 0;
  const passages = [];
  for (const hit of search(getIndex(), query, 6)) {
    const c = hit.chunk;
    const line = `[${passages.length + 1}] ${c.title}${c.page ? ` (page ${c.page})` : ''}: ${c.text.replace(/\n/g, ' ')}`;
    if (used + line.length > MAX_CONTEXT_CHARS) break;
    used += line.length;
    passages.push(line);
  }
  const context = passages.length ? passages.join('\n') : '(no matching passages)';

  return [
    { role: 'system', content: `${RULES}\n\n${PROFILE}` },     // identical every time, so Groq can cache it
    ...prior,
    { role: 'user', content: `CONTEXT:\n${context}\n\nVISITOR QUESTION: ${question}` },
  ];
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = allowedOrigins(env).includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': allowed ? origin : 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const reply = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

    if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: cors });
    if (request.method !== 'POST') return reply({ error: 'POST only' }, 405);
    if (!allowed) return reply({ error: 'Origin not allowed' }, 403);
    if (!env.GROQ_API_KEY) return reply({ error: 'Server is missing GROQ_API_KEY' }, 500);

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (limited(ip)) return reply({ error: 'Too many questions, try again in a minute' }, 429);

    let body;
    try { body = await request.json(); } catch { return reply({ error: 'Invalid JSON' }, 400); }
    const question = clip(body && body.question, MAX_QUESTION).replace(/\s+/g, ' ').trim();
    if (!question) return reply({ error: 'Empty question' }, 400);

    let upstream;
    try {
      upstream = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: env.GROQ_MODEL || DEFAULT_MODEL,
          messages: buildMessages(question, body.history),
          temperature: 0.3,
          max_completion_tokens: 1600,
          reasoning_effort: 'medium',
          include_reasoning: false,        // return only the answer
          stream: false,
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      return reply({ error: 'Model unreachable' }, 504);
    }

    if (upstream.status === 429) return reply({ error: 'Model is busy, try again shortly' }, 503);
    if (!upstream.ok) return reply({ error: 'Model error' }, 502);

    let data;
    try { data = await upstream.json(); } catch { return reply({ error: 'Bad model response' }, 502); }
    let text = clip(data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content, 2000).trim();
    const contact = /\[\[CONTACT\]\]/i.test(text);
    text = text.replace(/\[\[CONTACT\]\]/gi, '').trim();
    if (!text) return reply({ error: 'Empty model response' }, 502);

    return reply({ answer: text, contact });
  },
};
