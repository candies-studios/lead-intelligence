import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// Provider → environment variable(s). Env vars (supabase secrets) take precedence over keys saved in the UI.
const ENV: Record<string, string[]> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  gemini: ['GEMINI_API_KEY'],
  apollo: ['APOLLO_API_KEY'],
  hunter: ['HUNTER_API_KEY'],
  pdl: ['PDL_API_KEY'],
  google_cse: ['GOOGLE_CSE_KEY', 'GOOGLE_CSE_CX'],
};

export interface ProviderCreds { apiKey: string; extra: Record<string, string> }

const memo = new Map<string, ProviderCreds | null>();

export async function getCreds(admin: SupabaseClient, provider: string): Promise<ProviderCreds | null> {
  if (memo.has(provider)) return memo.get(provider)!;
  const envNames = ENV[provider] ?? [];
  const envKey = envNames[0] ? Deno.env.get(envNames[0]) : undefined;
  let creds: ProviderCreds | null = null;
  if (envKey) {
    const extra: Record<string, string> = {};
    if (provider === 'google_cse') extra.cx = Deno.env.get('GOOGLE_CSE_CX') ?? '';
    creds = { apiKey: envKey, extra };
  } else {
    const { data: integ } = await admin.from('integrations').select('enabled').eq('provider', provider).maybeSingle();
    if (integ && integ.enabled === false) { memo.set(provider, null); return null; }
    const { data } = await admin.from('integration_secrets').select('api_key, extra').eq('provider', provider).maybeSingle();
    if (data?.api_key) creds = { apiKey: data.api_key, extra: (data.extra ?? {}) as Record<string, string> };
  }
  if (provider === 'google_cse' && creds && !creds.extra.cx) creds = null;
  memo.set(provider, creds);
  return creds;
}

export function clearCredsCache() { memo.clear(); }

export async function availableProviders(admin: SupabaseClient): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const p of Object.keys(ENV)) out[p] = !!(await getCreds(admin, p));
  return out;
}
