// Connect a Gmail / Google Workspace mailbox with OAuth 2.0.
//   POST {action:'start', return_url}  (signed-in user)  → { url } to redirect the browser to Google
//   GET  ?code=…&state=…               (Google redirect)  → stores the mailbox and redirects back to the app
// Deploy with "Verify JWT" OFF: Google's redirect carries no Supabase token. The POST path checks the user itself.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getContext, json, corsHeaders, HttpError } from '../_shared/context.ts';
import { authUrl, exchangeCode, profile } from '../_shared/gmail.ts';
import { providerFetch } from '../_shared/http.ts';

const admin = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

function back(returnUrl: string | null, params: Record<string, string>) {
  const base = returnUrl || Deno.env.get('APP_URL') || 'about:blank';
  const sep = base.includes('?') ? '&' : '?';
  return new Response(null, { status: 302, headers: { Location: `${base}${sep}${new URLSearchParams(params)}` } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { ...corsHeaders, 'Access-Control-Allow-Headers': req.headers.get('access-control-request-headers') ?? corsHeaders['Access-Control-Allow-Headers'] } });
  const url = new URL(req.url);
  try {
    if (req.method === 'POST') {
      const ctx = await getContext(req);
      const body = await req.json().catch(() => ({}));
      if (body.action !== 'start') throw new HttpError(400, 'Unknown action');
      const returnUrl = typeof body.return_url === 'string' && /^https?:\/\//.test(body.return_url) ? body.return_url : null;
      const state = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
      await ctx.admin.from('oauth_states').delete().lt('created_at', new Date(Date.now() - 3600e3).toISOString());
      await ctx.admin.from('oauth_states').insert({ state, user_id: ctx.user.id, return_url: returnUrl });
      return json({ url: authUrl(state, body.login_hint) });
    }

    // ---- Google redirect (GET)
    const state = url.searchParams.get('state') ?? '';
    const db = admin();
    const { data: st } = await db.from('oauth_states').select('*').eq('state', state).maybeSingle();
    if (st) await db.from('oauth_states').delete().eq('state', state);
    if (!st || Date.now() - new Date(st.created_at).getTime() > 15 * 60e3) return back(st?.return_url ?? null, { gmail_error: 'This connection link expired. Please click Connect Gmail again.' });
    if (url.searchParams.get('error')) return back(st.return_url, { gmail_error: `Google said: ${url.searchParams.get('error')}` });
    const code = url.searchParams.get('code');
    if (!code) return back(st.return_url, { gmail_error: 'Missing authorisation code' });

    const tok = await exchangeCode(code);
    if (!tok.refresh_token) return back(st.return_url, { gmail_error: 'Google did not return offline access. Remove the app at myaccount.google.com/permissions and connect again.' });
    if (!/gmail\.modify/.test(tok.scope ?? '')) return back(st.return_url, { gmail_error: 'Gmail permission was not granted. Please tick the Gmail permission box when connecting.' });
    const prof = await profile(tok.access_token);
    const info = await providerFetch<any>('gmail', 'https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tok.access_token}` } }).catch(() => ({}));
    const { data: mb, error } = await db.from('mailboxes').upsert({
      email: prof.emailAddress.toLowerCase(), provider: 'gmail', display_name: info.name ?? null, user_id: st.user_id,
      status: 'connected', last_error: null, history_id: prof.historyId,
    }, { onConflict: 'email' }).select('id').single();
    if (error) throw error;
    await db.from('mailbox_secrets').upsert({ mailbox_id: mb.id, refresh_token: tok.refresh_token, updated_at: new Date().toISOString() });
    await db.from('integrations').update({ status: 'connected', last_error: null, last_checked_at: new Date().toISOString() }).eq('provider', 'gmail_automation');
    await db.from('audit_logs').insert({ actor_id: st.user_id, action: 'connect', entity: 'mailboxes', entity_id: mb.id, meta: { email: prof.emailAddress } });
    return back(st.return_url, { gmail: 'connected', mailbox: prof.emailAddress });
  } catch (e) {
    console.error(e);
    if (req.method === 'POST') return json({ error: (e as Error).message }, e instanceof HttpError ? e.status : (e as any).status ?? 500);
    return back(null, { gmail_error: (e as Error).message.slice(0, 300) });
  }
});
