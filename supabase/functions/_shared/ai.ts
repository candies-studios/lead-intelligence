// Provider-neutral AI layer: Claude (Anthropic) or Gemini (Google), chosen by settings or availability,
// with automatic fallback when the first one fails for account reasons (credit, quota, auth).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { getCreds } from './secrets.ts';
import { getSetting, HttpError } from './context.ts';
import { ProviderError } from './http.ts';
import { claudeMessage, type ClaudeConfig } from './providers/claude.ts';
import { geminiMessage } from './providers/gemini.ts';
import type { WebResult } from './providers/types.ts';

export type AiProvider = 'anthropic' | 'gemini';
export interface AiOpts { webSearch?: boolean; maxSearches?: number; blockedDomains?: string[]; maxTokens?: number }
export interface AiResponse { text: string; retrieved: WebResult[]; usage: { input_tokens?: number; output_tokens?: number }; provider: AiProvider; model: string }

interface Candidate { provider: AiProvider; apiKey: string; model: string; maxTokens: number }

const NO_AI = 'No AI provider is connected. Add a Gemini (Google) or Claude (Anthropic) API key on the Integrations page, or as a Supabase secret (GEMINI_API_KEY / ANTHROPIC_API_KEY).';

async function candidates(admin: SupabaseClient): Promise<Candidate[]> {
  const pref = await getSetting<{ provider?: string }>(admin, 'ai_provider', { provider: 'auto' });
  const claudeSet = await getSetting<{ model?: string; max_tokens?: number }>(admin, 'ai_model', {});
  const geminiSet = await getSetting<{ model?: string; max_tokens?: number }>(admin, 'gemini_model', {});
  const out: Candidate[] = [];
  const a = await getCreds(admin, 'anthropic');
  if (a) out.push({ provider: 'anthropic', apiKey: a.apiKey, model: Deno.env.get('ANTHROPIC_MODEL') ?? claudeSet.model ?? 'claude-sonnet-4-5', maxTokens: claudeSet.max_tokens ?? 4000 });
  const g = await getCreds(admin, 'gemini');
  if (g) out.push({ provider: 'gemini', apiKey: g.apiKey, model: Deno.env.get('GEMINI_MODEL') ?? geminiSet.model ?? 'gemini-flash-latest', maxTokens: geminiSet.max_tokens ?? 8000 });

  // Order: explicit preference first; in "auto", prefer a provider whose last connection test succeeded.
  const { data: rows } = await admin.from('integrations').select('provider, status').in('provider', ['anthropic', 'gemini']);
  const status = new Map((rows ?? []).map(r => [r.provider, r.status]));
  const rank = (c: Candidate) => (pref.provider === c.provider ? -10 : 0) + (status.get(c.provider) === 'connected' ? -2 : status.get(c.provider) === 'error' ? 2 : 0);
  return out.sort((x, y) => rank(x) - rank(y));
}

export async function aiAvailable(admin: SupabaseClient): Promise<boolean> {
  return (await candidates(admin)).length > 0;
}

/** Account-level failures where trying the other provider makes sense. */
function shouldFallback(e: unknown) {
  return e instanceof ProviderError && ([400, 401, 402, 403, 404, 429, 529].includes(e.status) || e.status >= 500 || e.status === 0);
}

export async function aiMessage(admin: SupabaseClient, system: string, user: string, opts: AiOpts = {}, only?: AiProvider): Promise<AiResponse> {
  let list = await candidates(admin);
  if (only) list = list.filter(c => c.provider === only);
  if (!list.length) throw new HttpError(412, only ? `${only === 'gemini' ? 'Gemini' : 'Claude'} is not connected.` : NO_AI);
  const errors: string[] = [];
  for (const c of list) {
    try {
      const maxTokens = opts.maxTokens ?? c.maxTokens;
      if (c.provider === 'anthropic') {
        const cfg: ClaudeConfig = { apiKey: c.apiKey, model: c.model, maxTokens };
        const r = await claudeMessage(cfg, system, user, { webSearch: opts.webSearch, maxSearches: opts.maxSearches, blockedDomains: opts.blockedDomains });
        return { ...r, provider: 'anthropic', model: c.model };
      }
      const r = await geminiMessage({ apiKey: c.apiKey, model: c.model, maxTokens }, system, user, { webSearch: opts.webSearch });
      const blocked = (opts.blockedDomains ?? []).map(d => d.toLowerCase());
      const retrieved = blocked.length ? r.retrieved.filter(x => !blocked.some(d => x.url.toLowerCase().includes(d))) : r.retrieved;
      return { ...r, retrieved, provider: 'gemini', model: c.model };
    } catch (e) {
      errors.push((e as Error).message);
      if (!shouldFallback(e) || c === list[list.length - 1]) {
        throw new HttpError(e instanceof ProviderError ? 502 : 500, errors.length > 1 ? errors.join(' | Fallback: ') : errors[0]);
      }
      await admin.from('integrations').update({ status: 'error', last_error: (e as Error).message.slice(0, 400), last_checked_at: new Date().toISOString() }).eq('provider', c.provider);
    }
  }
  throw new HttpError(500, errors.join(' | '));
}
