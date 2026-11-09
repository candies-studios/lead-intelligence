import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { getCreds } from './secrets.ts';
import { getSetting, HttpError } from './context.ts';
import type { ClaudeConfig } from './providers/claude.ts';

export async function getClaudeConfig(admin: SupabaseClient, required = true): Promise<ClaudeConfig | null> {
  const creds = await getCreds(admin, 'anthropic');
  if (!creds) {
    if (required) throw new HttpError(412, 'Claude is not connected. Add an Anthropic API key on the Integrations page (or `supabase secrets set ANTHROPIC_API_KEY=...`).');
    return null;
  }
  const s = await getSetting<{ model?: string; max_tokens?: number }>(admin, 'ai_model', {});
  return { apiKey: creds.apiKey, model: Deno.env.get('ANTHROPIC_MODEL') ?? s.model ?? 'claude-sonnet-5-5', maxTokens: s.max_tokens ?? 4000 };
}
