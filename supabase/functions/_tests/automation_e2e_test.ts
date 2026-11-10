// End-to-end test of the automation engine against a real Postgres (via PostgREST) with Gmail + Gemini mocked.
// Run: deno test -A supabase/functions/_tests/automation_e2e_test.ts   (needs PostgREST on :3011 — see README "Testing")
import { createClient } from 'npm:@supabase/supabase-js@2';

const PGRST = Deno.env.get('E2E_PGRST') ?? 'http://127.0.0.1:3011';
const SECRET = Deno.env.get('E2E_JWT_SECRET') ?? 'e2e-jwt-secret-that-is-long-enough-123456';
const PROXY_PORT = 54399;

async function jwt(payload: Record<string, unknown>) {
  const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const data = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
  return `${data}.${btoa(String.fromCharCode(...sig)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}`;
}

// ---------- environment + PostgREST proxy (/rest/v1/* → PostgREST)
const SERVICE = await jwt({ role: 'service_role', iss: 'e2e', exp: 4102444800 });
Deno.env.set('SUPABASE_URL', `http://127.0.0.1:${PROXY_PORT}`);
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', SERVICE);
Deno.env.set('GOOGLE_OAUTH_CLIENT_ID', 'cid'); Deno.env.set('GOOGLE_OAUTH_CLIENT_SECRET', 'csecret');
Deno.env.set('GEMINI_API_KEY', 'gm-test');
Deno.env.delete('ANTHROPIC_API_KEY');
const realFetch = globalThis.fetch;
const server = Deno.serve({ port: PROXY_PORT, onListen() {} }, (req) => {
  const u = new URL(req.url);
  const target = PGRST + u.pathname.replace(/^\/rest\/v1/, '') + u.search;
  const h = new Headers(req.headers); h.delete('host');
  return realFetch(target, { method: req.method, headers: h, body: req.body, redirect: 'manual' });
});

// ---------- Gmail + Gemini mocks
interface Sent { raw: string; threadId?: string; id: string; to: string; subject: string; text: string; inReplyTo: string | null }
const sent: Sent[] = [];
const inbox: Record<string, any> = {};
let pendingHistory: string[] = [];
let historyCounter = 1000;
const b64urlDecode = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));
function parseRaw(raw: string) {
  const [head, ...rest] = raw.split('\r\n\r\n');
  const hdr = (n: string) => head.match(new RegExp(`^${n}: (.*)$`, 'mi'))?.[1] ?? null;
  const subjRaw = hdr('Subject') ?? '';
  const subject = subjRaw.startsWith('=?UTF-8?B?') ? new TextDecoder().decode(Uint8Array.from(atob(subjRaw.slice(10, -2)), c => c.charCodeAt(0))) : subjRaw;
  const textB64 = rest.join('\r\n\r\n').split('Content-Transfer-Encoding: base64\r\n\r\n')[1]?.split('\r\n--')[0] ?? '';
  const text = new TextDecoder().decode(Uint8Array.from(atob(textB64.replace(/\r\n/g, '')), c => c.charCodeAt(0)));
  return { to: hdr('To') ?? '', subject, text, inReplyTo: hdr('In-Reply-To'), messageId: hdr('Message-ID'), listUnsub: hdr('List-Unsubscribe'), head };
}
function aiReply(prompt: string): string {
  if (/opening line/i.test(prompt)) return JSON.stringify({ line: 'I saw Acme recently expanded its dealer network into tier-2 cities.' });
  const reply = prompt.split('THEIR REPLY:')[1] ?? '';
  if (/call next week|set up a call/i.test(reply)) return JSON.stringify({ category: 'meeting_request', summary: 'Wants a call next week', return_date: null, referral: {}, reply: 'Thanks Anil — glad this is relevant. Happy to walk you through how the three days run.' });
  if (/how much|pricing|cost/i.test(reply)) return JSON.stringify({ category: 'question', summary: 'Asked about pricing', return_date: null, referral: {}, reply: 'Great question — pricing depends on cohort size and location. Could we take 20 minutes to scope it?' });
  return JSON.stringify({ category: 'other', summary: 'Other', return_date: null, referral: {}, reply: '' });
}
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (url.startsWith('http://127.0.0.1')) return realFetch(input as any, init);
  const ok = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.startsWith('https://oauth2.googleapis.com/token')) return ok({ access_token: 'at', expires_in: 3600 });
  if (url.includes('generativelanguage.googleapis.com')) {
    const body = JSON.parse(String(init?.body));
    const prompt = (body.systemInstruction?.parts?.[0]?.text ?? '') + '\n' + (body.contents[0].parts[0].text as string);
    return ok({ candidates: [{ content: { parts: [{ text: aiReply(prompt) }] } }], usageMetadata: {} });
  }
  const G = 'https://gmail.googleapis.com/gmail/v1/users/me';
  if (url === `${G}/messages/send`) {
    const b = JSON.parse(String(init?.body));
    const raw = b64urlDecode(b.raw); const p = parseRaw(raw);
    const id = `s${sent.length + 1}`; const threadId = b.threadId ?? `t${sent.length + 1}`;
    sent.push({ raw, threadId, id, to: p.to, subject: p.subject, text: p.text, inReplyTo: p.inReplyTo });
    inbox[id] = { id, threadId, labelIds: ['SENT'], payload: { headers: [{ name: 'Message-ID', value: p.messageId }] } };
    return ok({ id, threadId });
  }
  if (url.startsWith(`${G}/messages/`) && url.includes('format=metadata')) {
    const id = url.split('/messages/')[1].split('?')[0];
    return ok(inbox[id] ?? { payload: { headers: [] } });
  }
  if (url.startsWith(`${G}/messages/`) && url.includes('format=full')) {
    const id = url.split('/messages/')[1].split('?')[0];
    return ok(inbox[id]);
  }
  if (url.startsWith(`${G}/history`)) { const ids = pendingHistory; pendingHistory = []; historyCounter++; return ok({ history: ids.map(id => ({ messagesAdded: [{ message: { id, labelIds: ['INBOX'] } }] })), historyId: String(historyCounter) }); }
  if (url.startsWith(`${G}/profile`)) return ok({ emailAddress: 'sales@worldoftrade.pro', historyId: String(historyCounter) });
  throw new Error('Unmocked fetch: ' + url);
}) as typeof fetch;

function deliverReply(threadOf: Sent, fromEmail: string, subject: string, body: string, headers: Record<string, string> = {}) {
  const id = `in${Object.keys(inbox).length + 1}`;
  const msgId = threadOf ? parseRaw(threadOf.raw).messageId : null;
  inbox[id] = {
    id, threadId: threadOf?.threadId ?? `tx${id}`, labelIds: ['INBOX'],
    payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: fromEmail }, { name: 'To', value: 'sales@worldoftrade.pro' }, { name: 'Subject', value: subject }, { name: 'Message-ID', value: `<${id}@prospect>` }, { name: 'In-Reply-To', value: msgId ?? '' }, { name: 'Date', value: new Date().toUTCString() }, ...Object.entries(headers).map(([name, value]) => ({ name, value }))],
      body: { data: btoa(String.fromCharCode(...new TextEncoder().encode(body))).replace(/\+/g, '-').replace(/\//g, '_') } },
  };
  pendingHistory.push(id);
}

const { tick, handleInbound: _h } = await import('../_shared/automation.ts');
const db = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE, { auth: { persistSession: false } });
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }
async function one<T = any>(p: PromiseLike<{ data: T | null; error: any }>) { const { data, error } = await p; if (error) throw new Error(error.message); return data as T; }

// ---------- seed
const userId = Deno.env.get('E2E_USER_ID')!; // created in auth.users by the setup script (trigger makes public.users)
await one(db.from('countries').select('code').limit(1));

Deno.test('automation end-to-end', async (t) => {
  // seed via PostgREST (public schema) — the users row is inserted directly
  await one(db.from('app_settings').upsert({ key: 'automation', value: { enabled: true, company_name: 'World of Trade', physical_address: 'Mumbai 400001, India', booking_link: 'https://cal.example/wot', send_window_start: '09:30', send_window_end: '17:30', weekdays_only: true, default_timezone: 'Asia/Kolkata', auto_reply_meetings: true, auto_reply_not_interested: true, min_days_between_touches: 3, max_sends_per_tick: 15 } }));
  await one(db.from('integrations').upsert({ provider: 'gemini', display_name: 'Gemini', category: 'ai', status: 'connected' }));
  const co = await one<any>(db.from('companies').insert({ name: 'Acme Paints', domain: 'acme.example', industry: 'Paints & Coatings', industry_segment: 'Building Materials & Construction', country_code: 'IN', employee_count: 6000, description: 'Paints maker selling through 20,000 dealers.' }).select('*').single());
  const camp = await one<any>(db.from('campaigns').insert({ name: 'Channel leaders India', countries: ['IN'], segments: ['Building Materials & Construction'], created_by: userId, owner_id: userId }).select('*').single());
  const mk = async (name: string, email: string | null, status: string, extra: Record<string, unknown> = {}) => {
    const c = await one<any>(db.from('contacts').insert({ company_id: co.id, full_name: name, first_name: name.split(' ')[0], title: 'Head of Distribution', department: 'distribution_channel', seniority: 'head', email, email_status: status, country_code: 'IN', ...extra }).select('*').single());
    const l = await one<any>(db.from('leads').insert({ company_id: co.id, primary_contact_id: c.id, campaign_id: camp.id, stage: 'contact_identified', priority: 'A', score: 90, assigned_to: userId }).select('*').single());
    return { c, l };
  };
  const anil = await mk('Anil Mehta', 'anil@acme.example', 'verified');
  const bea = await mk('Bea Shah', 'bea@acme.example', 'verified');
  const cara = await mk('Cara Iyer', 'cara@acme.example', 'verified');
  const dev = await mk('Dev Rao', 'dev@acme.example', 'provider_returned');
  void anil; void bea; void cara; void dev;
  const guess = await mk('Guess Person', 'guess.person@acme.example', 'inferred_pattern');
  const dnc = await mk('Dnc Person', 'dnc@acme.example', 'verified', { do_not_contact: true });
  const mb = await one<any>(db.from('mailboxes').insert({ email: 'sales@worldoftrade.pro', display_name: 'Priya Owner', user_id: userId, daily_limit: 40, warmup_start: '2026-11-10', warmup_start_volume: 3, warmup_increment: 5, history_id: '1000' }).select('*').single());
  await one(db.from('mailbox_secrets').insert({ mailbox_id: mb.id, refresh_token: 'rt' }));
  const { DEFAULT_SEQUENCE } = await import('../_shared/mail.ts');
  const seq = await one<any>(db.from('sequences').insert({ campaign_id: camp.id, name: 'Channel leaders', status: 'active', mailbox_id: mb.id, steps: DEFAULT_SEQUENCE, settings: { priorities: ['A', 'B'], allowed_email_statuses: ['verified', 'provider_returned'], daily_cap: 30, sender_name: 'Priya Owner' }, created_by: userId, approved_by: userId, approved_at: new Date().toISOString() }).select('*').single());

  const tue1100 = new Date('2026-11-10T05:30:00Z'); // Tue 11:00 IST — inside window

  await t.step('night-time run enrols but sends nothing (send window respected)', async () => {
    const r = await tick(db, { now: new Date('2026-11-09T20:00:00Z') }); // Tue 01:30 IST
    assert(r.enrolled === 4, `expected 4 enrolled (verified+provider only; inferred & DNC excluded), got ${r.enrolled} ${JSON.stringify(r)}`);
    assert(r.sent === 0, 'nothing sent at night');
    const ens = await one<any[]>(db.from('enrollments').select('contact_id, next_run_at'));
    assert(!ens.some(e => [guess.c.id, dnc.c.id].includes(e.contact_id)), 'inferred / DNC never enrolled');
    for (const e of ens) { const h = new Date(e.next_run_at).getTime(); assert(h >= Date.parse('2026-11-10T04:00:00Z') && h < Date.parse('2026-11-10T04:21:00Z'), 'scheduled for 09:30–09:50 IST: ' + e.next_run_at); }
  });

  await t.step('morning run sends first emails, capped by warm-up (3/day)', async () => {
    const r = await tick(db, { now: tue1100 });
    assert(r.sent === 3, `warm-up cap 3 → 3 sent, got ${r.sent} ${JSON.stringify(r.errors)}`);
    const m = parseRaw(sent[0].raw);
    assert(/^Hi (Anil|Bea|Cara|Dev),/.test(m.text), 'greets by first name: ' + m.text.slice(0, 30));
    assert(m.text.includes('expanded its dealer network'), 'grounded personal line included');
    assert(m.text.includes('Mumbai 400001, India') && /unsubscribe here: http:\/\/127\.0\.0\.1:54399\/functions\/v1\/unsubscribe\?t=/.test(m.text), 'footer with address + unsubscribe');
    assert(m.text.includes('https://cal.example/wot'), 'booking link');
    assert(m.listUnsub?.includes('mailto:sales@worldoftrade.pro'), 'List-Unsubscribe header');
    assert(!/\{\{/.test(m.text + m.subject), 'no unfilled placeholders');
    const leads = await one<any[]>(db.from('leads').select('stage').in('stage', ['first_email_sent']));
    assert(leads.length === 3, 'lead stages moved to first_email_sent');
    const comms = await one<any[]>(db.from('communications').select('id').eq('direction', 'outbound'));
    assert(comms.length === 3, 'communication log written');
  });

  await t.step('running again does not double-send', async () => {
    const r = await tick(db, { now: new Date(tue1100.getTime() + 5 * 60e3) });
    assert(r.sent === 0, 'no duplicate sends, got ' + r.sent);
  });

  const sentTo = (email: string) => sent.find(s => s.to === email)!;
  const byEmail: Record<string, any> = { 'anil@acme.example': anil, 'bea@acme.example': bea, 'cara@acme.example': cara, 'dev@acme.example': dev };
  const day1 = sent.slice(0, 3).map(s => s.to);
  const [mEmail, qEmail, uEmail] = day1;
  const oooEmail = Object.keys(byEmail).find(e => !day1.includes(e))!;

  await t.step('meeting request → booking link auto-reply in thread, sequence stopped, task created', async () => {
    deliverReply(sentTo(mEmail), `Prospect <${mEmail}>`, 'Re: ' + sentTo(mEmail).subject, 'Sounds relevant — can we set up a call next week?\n\nOn Tue, Priya wrote:\n> Hi Anil');
    const before = sent.length;
    const r = await tick(db, { now: new Date(tue1100.getTime() + 60 * 60e3) });
    assert(r.received === 1 && r.autoReplied === 1, JSON.stringify(r));
    const reply = sent[before];
    assert(reply.to === mEmail && reply.threadId === sentTo(mEmail).threadId, 'reply in same thread');
    assert(reply.inReplyTo?.includes('@prospect'), 'In-Reply-To set to their message');
    assert(reply.text.includes('https://cal.example/wot'), 'booking link in reply');
    const en = await one<any>(db.from('enrollments').select('status').eq('contact_id', byEmail[mEmail].c.id).single());
    assert(en.status === 'replied', 'sequence stopped for Anil');
    const lead = await one<any>(db.from('leads').select('stage').eq('id', byEmail[mEmail].l.id).single());
    assert(lead.stage === 'follow_up_required', 'lead stage follow_up_required, got ' + lead.stage);
    const tasks = await one<any[]>(db.from('follow_ups').select('title').eq('lead_id', byEmail[mEmail].l.id));
    assert(tasks.some(x => /confirm the meeting/i.test(x.title)), 'follow-up task created');
  });

  await t.step('pricing question → draft waits for approval (not sent)', async () => {
    deliverReply(sentTo(qEmail), qEmail, 'Re: hi', 'How much does the programme cost for 25 people?');
    const before = sent.length;
    const r = await tick(db, { now: new Date(tue1100.getTime() + 70 * 60e3) });
    assert(sent.length === before, 'nothing auto-sent for a pricing question');
    assert(r.drafts === 1, 'draft queued');
    const d = await one<any>(db.from('email_messages').select('*').eq('status', 'pending_approval').single());
    assert(d.needs_attention && d.to_email === qEmail && /pricing depends on cohort size/.test(d.body_text), 'draft content + flagged');
    const inbound = await one<any>(db.from('email_messages').select('classification, needs_attention').eq('direction', 'inbound').eq('from_email', qEmail).single());
    assert(inbound.classification === 'question' && inbound.needs_attention, 'inbound flagged');
    const { count } = await db.rpc('inbox_attention_count').then(r => ({ count: r.data }));
    assert(count === 2, 'inbox counter = inbound + draft, got ' + count);
  });

  await t.step('approved reply is sent in the thread', async () => {
    const { sendReply } = await import('../_shared/automation.ts');
    const d = await one<any>(db.from('email_messages').select('*, lead:leads(*), contact:contacts(*), enrollment:enrollments(*)').eq('status', 'pending_approval').single());
    const mbRow = await one<any>(db.from('mailboxes').select('*').single());
    const before = sent.length;
    await sendReply(db, mbRow, 'at', { threadId: d.thread_id, messageId: d.in_reply_to, subject: d.subject }, d.lead, d.contact, d.enrollment, d.body_text, 'approved_reply', new Date(), userId);
    assert(sent.length === before + 1 && sent[before].threadId === sentTo(qEmail).threadId, 'approved reply sent in thread');
  });

  await t.step('unsubscribe reply → suppressed, stopped, lead not relevant, no reply sent', async () => {
    deliverReply(sentTo(uEmail), uEmail, 'Re: hello', 'Please remove me from your mailing list.');
    const before = sent.length;
    await tick(db, { now: new Date(tue1100.getTime() + 80 * 60e3) });
    assert(sent.length === before, 'no reply to an unsubscribe');
    const c = await one<any>(db.from('contacts').select('do_not_contact').eq('id', byEmail[uEmail].c.id).single());
    const en = await one<any>(db.from('enrollments').select('status').eq('contact_id', byEmail[uEmail].c.id).single());
    const l = await one<any>(db.from('leads').select('stage').eq('id', byEmail[uEmail].l.id).single());
    const sup = await one<any[]>(db.from('suppression_list').select('email').eq('email', uEmail));
    assert(c.do_not_contact && en.status === 'unsubscribed' && l.stage === 'not_relevant' && sup.length === 1, JSON.stringify({ c, en, l, sup }));
  });

  await t.step('next day: 4th lead gets first email (warm-up 8/day)', async () => {
    const r = await tick(db, { now: new Date('2026-11-11T05:30:00Z') });
    assert(sent.some(s => s.to === oooEmail), 'remaining lead emailed on day 2 ' + JSON.stringify(r));
  });

  await t.step('out-of-office reschedules the follow-up instead of stopping', async () => {
    deliverReply(sentTo(oooEmail), oooEmail, 'Automatic reply: World of Trade', 'I am out of the office until 20 November 2026.', { 'Auto-Submitted': 'auto-replied' });
    await tick(db, { now: new Date('2026-11-11T07:00:00Z') });
    const en = await one<any>(db.from('enrollments').select('status, next_run_at').eq('contact_id', byEmail[oooEmail].c.id).single());
    assert(en.status === 'active' && en.next_run_at >= '2026-11-21', 'rescheduled after return date: ' + JSON.stringify(en));
  });

  await t.step('follow-ups: step 2 goes in the same thread with Re: subject; LinkedIn step becomes a to-do', async () => {
    // Make a fresh lead to follow through the whole sequence without replying
    const eve = await mk('Eve Kapoor', 'eve@acme.example', 'verified');
    await tick(db, { now: new Date('2026-11-12T05:30:00Z') }); // Thu: enrol (jittered 0–20 min)
    await tick(db, { now: new Date('2026-11-12T06:00:00Z') }); // next cron run sends step 1
    const first = sent.find(s => s.to === 'eve@acme.example');
    assert(first, 'Eve step 1 sent');
    await tick(db, { now: new Date('2026-11-17T06:30:00Z') }); // +5 days (Tue): step 2 due (day 4)
    const second = sent.filter(s => s.to === 'eve@acme.example')[1];
    assert(second && second.threadId === first!.threadId && /^Re: /.test(second.subject) && second.inReplyTo, 'step 2 threaded: ' + JSON.stringify(second && { s: second.subject, t: second.threadId }));
    await tick(db, { now: new Date('2026-11-19T08:00:00Z') }); // day 6+: LinkedIn task
    const tasks = await one<any[]>(db.from('follow_ups').select('title, notes').eq('lead_id', eve.l.id));
    assert(tasks.some(x => /^LinkedIn:/.test(x.title) && /connect/i.test(x.notes)), 'LinkedIn to-do created: ' + JSON.stringify(tasks));
    // moving the lead to meeting_scheduled stops the sequence immediately (DB trigger)
    await one(db.from('leads').update({ stage: 'meeting_scheduled' }).eq('id', eve.l.id));
    const en = await one<any>(db.from('enrollments').select('status').eq('contact_id', eve.c.id).single());
    assert(en.status === 'stopped', 'stage change stops sequence');
  });

  await t.step('bounce marks email invalid and stops sequence', async () => {
    const fred = await mk('Fred Nair', 'fred@acme.example', 'verified');
    await tick(db, { now: new Date('2026-11-20T05:30:00Z') });
    await tick(db, { now: new Date('2026-11-20T06:00:00Z') });
    const s1 = sent.find(s => s.to === 'fred@acme.example')!;
    deliverReply(s1, 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', 'Delivery Status Notification (Failure)', "Your message wasn't delivered to fred@acme.example because the address couldn't be found.");
    await tick(db, { now: new Date('2026-11-20T06:40:00Z') });
    const c = await one<any>(db.from('contacts').select('email_status').eq('id', fred.c.id).single());
    const en = await one<any>(db.from('enrollments').select('status').eq('contact_id', fred.c.id).single());
    assert(c.email_status === 'invalid' && en.status === 'bounced', JSON.stringify({ c, en }));
  });

  await t.step('emails from people who are not prospects are ignored and never stored', async () => {
    deliverReply(null as any, 'newsletter@random.example', 'Weekly digest', 'Hello subscriber');
    await tick(db, { now: new Date('2026-11-20T07:00:00Z') });
    const rows = await one<any[]>(db.from('email_messages').select('id').eq('from_email', 'newsletter@random.example'));
    assert(rows.length === 0, 'unrelated mail not stored');
  });

  await t.step('kill switch stops everything', async () => {
    await one(db.from('app_settings').update({ value: { enabled: false } }).eq('key', 'automation'));
    const r = await tick(db, { now: new Date('2026-11-24T05:30:00Z') });
    assert(r.skipped?.includes('switched off'), JSON.stringify(r));
  });

  console.log(`\n  ${sent.length} emails sent in total during the scenario`);
  await server.shutdown();
});
