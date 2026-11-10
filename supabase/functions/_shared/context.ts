import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';

// Allow every header supabase-js sends (newer versions add x-retry-count and W3C tracing headers).
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-retry-count, x-region, traceparent, tracestate, baggage, sentry-trace, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

export class HttpError extends Error { constructor(public status: number, message: string, public details?: unknown) { super(message); } }

export type Role = 'super_admin' | 'admin' | 'sales_manager' | 'sales_executive' | 'researcher';

export interface Ctx {
  admin: SupabaseClient; // service role — server only
  userClient: SupabaseClient; // acts as the caller, RLS applies
  user: { id: string; email: string; role: Role };
}

export async function getContext(req: Request, allowed?: Role[]): Promise<Ctx> {
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) throw new HttpError(401, 'Not authenticated');
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: profile } = await admin.from('users').select('role,is_active').eq('id', user.id).single();
  if (!profile?.is_active) throw new HttpError(403, 'User is inactive or has no profile');
  if (allowed && !allowed.includes(profile.role)) throw new HttpError(403, `Role ${profile.role} cannot perform this action`);
  return { admin, userClient, user: { id: user.id, email: user.email ?? '', role: profile.role } };
}

export function handler(fn: (req: Request, body: any) => Promise<Response>) {
  return async (req: Request) => {
    if (req.method === 'OPTIONS') {
      // Echo whatever headers the browser asks to send, so future client headers never break the preflight.
      const requested = req.headers.get('access-control-request-headers');
      return new Response('ok', { headers: { ...corsHeaders, ...(requested ? { 'Access-Control-Allow-Headers': requested } : {}) } });
    }
    try {
      const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
      return await fn(req, body);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      console.error(e);
      return json({ error: (e as Error).message, details: (e as HttpError).details }, status);
    }
  };
}

export async function logUsage(ctx: Ctx, provider: string, operation: string, units = 1, success = true, meta: Record<string, unknown> = {}) {
  await ctx.admin.from('usage_events').insert({ user_id: ctx.user.id, provider, operation, units, success, meta });
}

export async function getSetting<T>(admin: SupabaseClient, key: string, fallback: T): Promise<T> {
  const { data } = await admin.from('app_settings').select('value').eq('key', key).maybeSingle();
  return (data?.value as T) ?? fallback;
}
