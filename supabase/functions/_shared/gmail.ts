// Gmail API adapter (official REST API, OAuth 2.0). Docs: https://developers.google.com/gmail/api/reference/rest
import { providerFetch, ProviderError } from './http.ts';
import { toBase64Url, base64ToUtf8, htmlToText, extractEmail } from './mail.ts';

export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.modify', 'openid', 'email', 'profile'];
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export function oauthConfig() {
  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new ProviderError('gmail', 412, 'Google OAuth is not configured. Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in Supabase → Edge Functions → Secrets (see the setup guide).');
  return { clientId, clientSecret, redirectUri: `${Deno.env.get('SUPABASE_URL')}/functions/v1/gmail-oauth` };
}

export function authUrl(state: string, loginHint?: string) {
  const c = oauthConfig();
  const p = new URLSearchParams({
    client_id: c.clientId, redirect_uri: c.redirectUri, response_type: 'code', scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  });
  if (loginHint) p.set('login_hint', loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export async function exchangeCode(code: string): Promise<{ refresh_token?: string; access_token: string; scope?: string }> {
  const c = oauthConfig();
  return await providerFetch<any>('gmail', 'https://oauth2.googleapis.com/token', {
    method: 'POST', retries: 1, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: c.redirectUri, grant_type: 'authorization_code' }).toString(),
  });
}

const tokenCache = new Map<string, { token: string; exp: number }>();
export async function accessToken(refreshToken: string): Promise<string> {
  const hit = tokenCache.get(refreshToken);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const c = oauthConfig();
  try {
    const r = await providerFetch<any>('gmail', 'https://oauth2.googleapis.com/token', {
      method: 'POST', retries: 1, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ refresh_token: refreshToken, client_id: c.clientId, client_secret: c.clientSecret, grant_type: 'refresh_token' }).toString(),
    });
    tokenCache.set(refreshToken, { token: r.access_token, exp: Date.now() + (r.expires_in ?? 3600) * 1000 });
    return r.access_token;
  } catch (e) {
    if (e instanceof ProviderError && /invalid_grant/.test(e.message)) {
      throw new ProviderError('gmail', 401, 'Gmail access was revoked or expired — reconnect the mailbox on the Integrations page. (Google apps in "Testing" mode expire tokens after 7 days; publish the app or use an Internal Workspace app.)');
    }
    throw e;
  }
}

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

export async function profile(token: string): Promise<{ emailAddress: string; historyId: string }> {
  return await providerFetch<any>('gmail', `${API}/profile`, { headers: auth(token) });
}

export async function sendRaw(token: string, raw: string, threadId?: string | null): Promise<{ id: string; threadId: string }> {
  const body: Record<string, string> = { raw: toBase64Url(raw) };
  if (threadId) body.threadId = threadId;
  return await providerFetch<any>('gmail', `${API}/messages/send`, {
    method: 'POST', retries: 1, headers: { ...auth(token), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

export async function messageIdHeader(token: string, id: string): Promise<string | null> {
  const m = await providerFetch<any>('gmail', `${API}/messages/${id}?format=metadata&metadataHeaders=Message-ID`, { headers: auth(token) });
  return (m.payload?.headers ?? []).find((h: any) => h.name.toLowerCase() === 'message-id')?.value ?? null;
}

/** New INBOX message ids since `historyId`; falls back to a recent search if history expired. */
export async function newInboxMessageIds(token: string, historyId: string | null): Promise<{ ids: string[]; historyId: string }> {
  if (historyId) {
    try {
      const ids = new Set<string>(); let pageToken: string | undefined; let latest = historyId;
      do {
        const p = new URLSearchParams({ startHistoryId: historyId, historyTypes: 'messageAdded', labelId: 'INBOX', maxResults: '100' });
        if (pageToken) p.set('pageToken', pageToken);
        const r = await providerFetch<any>('gmail', `${API}/history?${p}`, { headers: auth(token) });
        for (const h of r.history ?? []) for (const a of h.messagesAdded ?? []) {
          if ((a.message?.labelIds ?? []).includes('SENT')) continue;
          ids.add(a.message.id);
        }
        latest = r.historyId ?? latest; pageToken = r.nextPageToken;
      } while (pageToken && ids.size < 300);
      return { ids: [...ids], historyId: latest };
    } catch (e) {
      if (!(e instanceof ProviderError && e.status === 404)) throw e; // 404 = history too old → resync below
    }
  }
  const prof = await profile(token);
  const r = await providerFetch<any>('gmail', `${API}/messages?${new URLSearchParams({ q: 'in:inbox newer_than:3d -from:me', maxResults: '50' })}`, { headers: auth(token) });
  return { ids: (r.messages ?? []).map((m: any) => m.id), historyId: prof.historyId };
}

export interface ParsedMessage {
  id: string; threadId: string; from: string; fromEmail: string | null; to: string; subject: string; date: string | null;
  messageId: string | null; inReplyTo: string | null; references: string | null; headers: Record<string, string>; body: string; labelIds: string[];
}

function decodePart(part: any): { plain: string; html: string } {
  let plain = '', html = '';
  const walk = (p: any) => {
    if (!p) return;
    const data = p.body?.data ? base64ToUtf8(p.body.data) : '';
    if (p.mimeType === 'text/plain' && data) plain += data + '\n';
    else if (p.mimeType === 'text/html' && data) html += data;
    for (const c of p.parts ?? []) walk(c);
  };
  walk(part);
  return { plain, html };
}

export async function getMessage(token: string, id: string): Promise<ParsedMessage> {
  const m = await providerFetch<any>('gmail', `${API}/messages/${id}?format=full`, { headers: auth(token) });
  const headers: Record<string, string> = {};
  for (const h of m.payload?.headers ?? []) headers[h.name] = h.value;
  const get = (n: string) => Object.entries(headers).find(([k]) => k.toLowerCase() === n.toLowerCase())?.[1] ?? null;
  const { plain, html } = decodePart(m.payload);
  return {
    id: m.id, threadId: m.threadId, from: get('From') ?? '', fromEmail: extractEmail(get('From')), to: get('To') ?? '',
    subject: get('Subject') ?? '', date: get('Date'), messageId: get('Message-ID'), inReplyTo: get('In-Reply-To'), references: get('References'),
    headers, body: (plain.trim() || htmlToText(html)).slice(0, 20000), labelIds: m.labelIds ?? [],
  };
}
