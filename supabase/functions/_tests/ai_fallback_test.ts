// deno test -A supabase/functions/_tests/ai_fallback_test.ts
import { aiMessage } from '../_shared/ai.ts';
import { clearCredsCache } from '../_shared/secrets.ts';
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }

// Minimal fake of the Supabase admin client used by ai.ts / secrets.ts / context.ts
function fakeAdmin(settings: Record<string, unknown>, statuses: Record<string, string>) {
  const updates: { provider: string; patch: any }[] = [];
  const builder = (table: string) => {
    const st: any = { table, filters: {} as Record<string, unknown>, patch: null };
    const api: any = {
      select() { return api; }, in() { return api; },
      eq(k: string, v: unknown) { st.filters[k] = v; if (st.patch) updates.push({ provider: String(v), patch: st.patch }); return api; },
      update(p: any) { st.patch = p; return api; },
      maybeSingle() {
        if (table === 'app_settings') return Promise.resolve({ data: settings[st.filters.key as string] !== undefined ? { value: settings[st.filters.key as string] } : null });
        if (table === 'integrations') return Promise.resolve({ data: { enabled: true } });
        return Promise.resolve({ data: null });
      },
      then(res: any) { // awaited list query: integrations statuses
        return Promise.resolve({ data: Object.entries(statuses).map(([provider, status]) => ({ provider, status })) }).then(res);
      },
    };
    return api;
  };
  return { client: { from: builder } as any, updates };
}

Deno.env.set('ANTHROPIC_API_KEY', 'sk-ant-test');
Deno.env.set('GEMINI_API_KEY', 'gm-test');

function mockFetch(claudeStatus: number) {
  const hits: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input); hits.push(url);
    if (url.includes('api.anthropic.com')) {
      return Promise.resolve(claudeStatus === 200
        ? new Response(JSON.stringify({ content: [{ type: 'text', text: 'claude says hi' }], usage: {} }), { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response('{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low"}}', { status: claudeStatus }));
    }
    if (url.includes('generativelanguage')) return Promise.resolve(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'gemini says hi' }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    return Promise.resolve(new Response('', { status: 404 }));
  }) as typeof fetch;
  return hits;
}

Deno.test('Claude out of credit → automatic fallback to Gemini, Claude marked as error', async () => {
  clearCredsCache(); const real = globalThis.fetch;
  const hits = mockFetch(400);
  const { client, updates } = fakeAdmin({}, {});
  try {
    const r = await aiMessage(client, 'sys', 'hello');
    assert(r.provider === 'gemini' && r.text === 'gemini says hi', JSON.stringify(r));
    assert(hits.some(h => h.includes('anthropic')) && hits.some(h => h.includes('generativelanguage')), 'both tried');
    assert(updates.some(u => u.provider === 'anthropic' && u.patch.status === 'error'), 'claude marked error');
  } finally { globalThis.fetch = real; }
});

Deno.test('Claude previously errored → Gemini is tried first (no wasted Claude call)', async () => {
  clearCredsCache(); const real = globalThis.fetch;
  const hits = mockFetch(400);
  const { client } = fakeAdmin({}, { anthropic: 'error', gemini: 'connected' });
  try {
    const r = await aiMessage(client, 'sys', 'hello');
    assert(r.provider === 'gemini', 'gemini used');
    assert(!hits.some(h => h.includes('anthropic')), 'claude not called: ' + hits);
  } finally { globalThis.fetch = real; }
});

Deno.test('Preference "anthropic" and Claude healthy → Claude used', async () => {
  clearCredsCache(); const real = globalThis.fetch;
  mockFetch(200);
  const { client } = fakeAdmin({ ai_provider: { provider: 'anthropic' } }, { anthropic: 'connected', gemini: 'connected' });
  try { const r = await aiMessage(client, 'sys', 'hello'); assert(r.provider === 'anthropic', r.provider); }
  finally { globalThis.fetch = real; }
});

Deno.test('Testing one provider explicitly does not fall back', async () => {
  clearCredsCache(); const real = globalThis.fetch;
  mockFetch(400);
  const { client } = fakeAdmin({}, {});
  let msg = '';
  try { await aiMessage(client, 'sys', 'ping', {}, 'anthropic'); } catch (e) { msg = (e as Error).message; }
  finally { globalThis.fetch = real; }
  assert(/credit balance/.test(msg), msg);
});
