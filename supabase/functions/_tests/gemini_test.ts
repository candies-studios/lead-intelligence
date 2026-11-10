// deno test -A supabase/functions/_tests/gemini_test.ts
import { geminiMessage, parseGeminiResponse } from '../_shared/providers/gemini.ts';
import { wasRetrieved, extractJson } from '../_shared/providers/claude.ts';

function assert(c: unknown, m: string) { if (!c) throw new Error(m); }

const REDIRECT = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbCdEf';
const sample = {
  candidates: [{
    content: { parts: [{ text: '```json\n{"companies":[{"name":"Acme Foods","source_url":"https://acmefoods.example/about"},{"name":"Ghost Co","source_url":"https://made-up.example"}]}\n```' }] },
    groundingMetadata: { groundingChunks: [{ web: { uri: REDIRECT, title: 'acmefoods.example' } }, { web: { uri: 'https://news.example/item', title: 'news.example' } }] },
  }],
  usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 80 },
};

Deno.test('parseGeminiResponse extracts text, chunks, usage', () => {
  const r = parseGeminiResponse(sample);
  assert(r.text.includes('Acme Foods'), 'text');
  assert(r.chunks.length === 2, 'chunks');
  assert(r.usage.input_tokens === 120 && r.usage.output_tokens === 80, 'usage');
});

Deno.test('parseGeminiResponse surfaces safety blocks', () => {
  let msg = '';
  try { parseGeminiResponse({ promptFeedback: { blockReason: 'SAFETY' } }); } catch (e) { msg = (e as Error).message; }
  assert(msg.includes('SAFETY'), msg);
});

Deno.test('geminiMessage resolves grounding redirects and grounding validation drops invented sources', async () => {
  const real = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('generativelanguage.googleapis.com')) {
      return Promise.resolve(new Response(JSON.stringify(sample), { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    if (url === REDIRECT) return Promise.resolve(new Response(null, { status: 302, headers: { location: 'https://acmefoods.example/about' } }));
    return Promise.resolve(new Response('nope', { status: 404 }));
  }) as typeof fetch;
  try {
    const r = await geminiMessage({ apiKey: 'test-key', model: 'gemini-flash-latest', maxTokens: 1000 }, 'sys', 'user', { webSearch: true });
    const api = calls.find(c => c.url.includes('generativelanguage'))!;
    const body = JSON.parse(String(api.init!.body));
    assert(api.url.endsWith('/models/gemini-flash-latest:generateContent'), 'endpoint ' + api.url);
    assert((api.init!.headers as Record<string, string>)['x-goog-api-key'] === 'test-key', 'auth header');
    assert(body.tools?.[0]?.google_search, 'google_search tool sent');
    assert(body.systemInstruction.parts[0].text === 'sys', 'system instruction');
    assert(body.generationConfig.temperature === undefined, 'no deprecated sampling params');
    assert(r.retrieved.some(x => x.url === 'https://acmefoods.example/about'), 'redirect resolved: ' + JSON.stringify(r.retrieved));
    const parsed = extractJson<{ companies: { name: string; source_url: string }[] }>(r.text);
    const kept = parsed.companies.filter(c => wasRetrieved(c.source_url, r.retrieved)).map(c => c.name);
    assert(kept.length === 1 && kept[0] === 'Acme Foods', 'only grounded company kept: ' + kept);
  } finally { globalThis.fetch = real; }
});

Deno.test('geminiMessage explains search-grounding quota/billing errors', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"Quota exceeded for search grounding"}}', { status: 429 }))) as typeof fetch;
  let msg = '';
  try { await geminiMessage({ apiKey: 'k', model: 'm', maxTokens: 100 }, 's', 'u', { webSearch: true }); } catch (e) { msg = (e as Error).message; }
  finally { globalThis.fetch = real; }
  assert(/billing/i.test(msg), msg);
});
