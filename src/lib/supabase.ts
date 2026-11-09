import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = !!(url && anon);
export const supabase = createClient(url || 'http://localhost:54321', anon || 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true },
});

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/** Invoke an Edge Function and surface its JSON error message. */
export async function callFn<T = any>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let msg = error.message; let status = 500;
    const ctx: any = (error as any).context;
    if (ctx && typeof ctx.json === 'function') {
      try { const j = await ctx.json(); msg = j.error ?? msg; status = ctx.status ?? status; } catch { /* ignore */ }
    }
    throw new ApiError(msg, status);
  }
  return data as T;
}
