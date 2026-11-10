// Integration management: real connection status, save/remove keys (admins), live connection tests.
import { getContext, handler, json, HttpError } from '../_shared/context.ts';
import { getCreds, clearCredsCache } from '../_shared/secrets.ts';
import { apolloPing } from '../_shared/providers/apollo.ts';
import { hunterPing } from '../_shared/providers/hunter.ts';
import { pdlPing } from '../_shared/providers/pdl.ts';
import { googlePing } from '../_shared/providers/google.ts';
import { aiMessage } from '../_shared/ai.ts';

const TESTABLE = ['gemini', 'anthropic', 'apollo', 'hunter', 'pdl', 'google_cse'];

Deno.serve(handler(async (req, body) => {
  const ctx = await getContext(req);
  const admins = ['super_admin', 'admin'];

  if (body.action === 'status') {
    // Self-heal: make sure the Gemini card exists (older databases were created before Gemini support).
    await ctx.admin.from('integrations').upsert({
      provider: 'gemini', display_name: 'Gemini (Google)', category: 'ai',
      description: 'AI research, discovery, signals and outreach using Grounding with Google Search. Free tier available.',
      status: 'not_configured',
    }, { onConflict: 'provider', ignoreDuplicates: true });
    const { data: rows } = await ctx.admin.from('integrations').select('*').order('category');
    const out = [];
    for (const r of rows ?? []) {
      const configured = TESTABLE.includes(r.provider) ? !!(await getCreds(ctx.admin, r.provider)) : null;
      // First time a key is detected, test it automatically so the card shows a real status.
      if (configured && r.status === 'not_configured') { const t = await test(ctx, r.provider); Object.assign(r, { status: t.status, last_error: t.error, last_checked_at: new Date().toISOString() }); }
      const source = TESTABLE.includes(r.provider) ? (Deno.env.get(envName(r.provider)) ? 'environment' : configured ? 'saved_key' : null) : null;
      out.push({ ...r, configured, key_source: source });
    }
    return json({ integrations: out });
  }

  if (!admins.includes(ctx.user.role) && body.action !== 'test') throw new HttpError(403, 'Only admins can change integrations');

  if (body.action === 'save') {
    const { provider, api_key, extra } = body;
    if (!TESTABLE.includes(provider)) throw new HttpError(400, 'Unknown or non-configurable provider');
    if (!api_key || String(api_key).length < 8) throw new HttpError(400, 'API key looks invalid');
    if (provider === 'google_cse' && !extra?.cx) throw new HttpError(400, 'Google Programmable Search also needs a Search engine ID (cx)');
    await ctx.admin.from('integration_secrets').upsert({ provider, api_key, extra: extra ?? {}, updated_at: new Date().toISOString(), updated_by: ctx.user.id });
    clearCredsCache();
    return json(await test(ctx, provider));
  }
  if (body.action === 'remove') {
    await ctx.admin.from('integration_secrets').delete().eq('provider', body.provider);
    await ctx.admin.from('integrations').update({ status: 'not_configured', last_error: null, last_checked_at: new Date().toISOString() }).eq('provider', body.provider);
    clearCredsCache();
    return json({ ok: true });
  }
  if (body.action === 'toggle') {
    await ctx.admin.from('integrations').update({ enabled: !!body.enabled }).eq('provider', body.provider);
    clearCredsCache();
    return json({ ok: true });
  }
  if (body.action === 'test') return json(await test(ctx, body.provider));
  throw new HttpError(400, 'Unknown action');
}));

function envName(p: string) { return ({ gemini: 'GEMINI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', apollo: 'APOLLO_API_KEY', hunter: 'HUNTER_API_KEY', pdl: 'PDL_API_KEY', google_cse: 'GOOGLE_CSE_KEY' } as Record<string, string>)[p] ?? ''; }

async function test(ctx: any, provider: string) {
  const creds = await getCreds(ctx.admin, provider);
  let status = 'not_configured'; let error: string | null = null;
  if (creds) {
    try {
      if (provider === 'apollo') await apolloPing(creds.apiKey);
      if (provider === 'hunter') await hunterPing(creds.apiKey);
      if (provider === 'pdl') await pdlPing(creds.apiKey);
      if (provider === 'google_cse') await googlePing(creds.apiKey, creds.extra.cx);
      if (provider === 'anthropic') await aiMessage(ctx.admin, 'Reply with OK', 'ping', { maxTokens: 5 }, 'anthropic');
      // Gemini: test WITH Google Search grounding, because discovery and research depend on it
      if (provider === 'gemini') await aiMessage(ctx.admin, 'Answer in one short sentence.', 'Search the web: what does the company World of Trade (worldoftrade.pro) offer?', { webSearch: true, maxTokens: 200 }, 'gemini');
      status = 'connected';
    } catch (e) { status = 'error'; error = (e as Error).message.slice(0, 400); }
  }
  await ctx.admin.from('integrations').update({ status, last_error: error, last_checked_at: new Date().toISOString() }).eq('provider', provider);
  return { provider, status, error };
}
